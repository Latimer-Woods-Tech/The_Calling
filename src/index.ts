// ============================================================================
// The Calling - Voice Game Platform
// ============================================================================
// Hono entry point for Cloudflare Workers
// Routes: Public API, Webhooks, Admin API, Health
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types/index.js';
import { VoiceGamePlatform } from './core/platform.js';
import { GameStateManager } from './state/game-state.js';
import { StripeClient } from './integrations/stripe.js';
import { TelnyxWebhookHandler } from './webhooks/telnyx-webhooks.js';
import { StripeWebhookHandler } from './webhooks/stripe-webhooks.js';
import { admin } from './admin/routes.js';

const app = new Hono<{ Bindings: Env }>();

// ---- Global Middleware ----
app.use('*', cors({
  origin: ['https://thecalling.club', 'https://www.thecalling.club'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
}));
app.use('*', logger());

// Global error handler
app.onError((err, c) => {
  console.error('[Error]', err.message, err.stack);
  const isDev = c.env.ENVIRONMENT !== 'production';
  return c.json(
    { error: 'Internal server error', ...(isDev && { message: err.message }) },
    500
  );
});

// ============================================================================
// PUBLIC API ROUTES
// ============================================================================

/**
 * Health check
 */
app.get('/', (c) => {
  return c.json({
    name: 'The Calling - Voice Game Platform',
    version: '1.0.0',
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', async (c) => {
  const platform = new VoiceGamePlatform(c.env);
  const health = await platform.healthCheck();
  const allHealthy = Object.values(health).every(Boolean);
  return c.json(
    { status: allHealthy ? 'healthy' : 'degraded', services: health },
    allHealthy ? 200 : 503
  );
});

/**
 * List upcoming games
 */
app.get('/api/games', async (c) => {
  const { Database } = await import('./core/database.js');
  const db = new Database(c.env.NEON_DATABASE_URL);
  const games = await db.listUpcomingGames();
  return c.json({ games });
});

/**
 * Get game details
 */
app.get('/api/games/:id', async (c) => {
  const { Database } = await import('./core/database.js');
  const db = new Database(c.env.NEON_DATABASE_URL);
  const game = await db.getGameInstance(c.req.param('id'));
  if (!game) return c.json({ error: 'Game not found' }, 404);
  return c.json({ game });
});

/**
 * Register for a game
 */
app.post('/api/games/:id/register', async (c) => {
  const platform = new VoiceGamePlatform(c.env);
  const body = await c.req.json();

  const { phone_number, display_name, email } = body;
  if (!phone_number || !display_name) {
    return c.json({ error: 'phone_number and display_name are required' }, 400);
  }

  const result = await platform.registerPlayer(c.req.param('id'), {
    phone_number,
    display_name,
    email,
  });

  return c.json(result, 201);
});

// ============================================================================
// WEBHOOK ROUTES
// ============================================================================

/**
 * Verify a Telnyx Ed25519 webhook signature.
 * See: https://developers.telnyx.com/docs/webhooks/receiving-webhooks#validate-signatures
 */
async function verifyTelnyxSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKeyBase64: string
): Promise<boolean> {
  try {
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (age > 300) return false; // reject events older than 5 minutes

    const encoder = new TextEncoder();
    const message = encoder.encode(`${timestamp}|${body}`);
    const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const keyBytes = Uint8Array.from(atob(publicKeyBase64), (c) => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return crypto.subtle.verify('Ed25519', key, sigBytes, message);
  } catch {
    return false;
  }
}

/**
 * Telnyx voice webhooks - per game instance
 */
app.post('/webhooks/telnyx/:gameId', async (c) => {
  const gameId = c.req.param('gameId');
  const rawBody = await c.req.text();

  // Verify Telnyx webhook signature when public key is configured
  if (c.env.TELNYX_WEBHOOK_PUBLIC_KEY) {
    const signature = c.req.header('telnyx-signature-ed25519') ?? '';
    const timestamp = c.req.header('telnyx-timestamp') ?? '';

    if (!signature || !timestamp) {
      return c.json({ error: 'Missing webhook signature headers' }, 401);
    }

    const isValid = await verifyTelnyxSignature(
      rawBody,
      signature,
      timestamp,
      c.env.TELNYX_WEBHOOK_PUBLIC_KEY
    );
    if (!isValid) {
      console.error('[Telnyx Webhook] Invalid signature for game:', gameId);
      return c.json({ error: 'Invalid signature' }, 401);
    }
  } else {
    console.warn('[Telnyx Webhook] TELNYX_WEBHOOK_PUBLIC_KEY not set — signature validation is disabled');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const platform = new VoiceGamePlatform(c.env);
  const state = new GameStateManager(c.env.REDIS_ENDPOINT, c.env.REDIS_API_KEY);
  const handler = new TelnyxWebhookHandler(platform, state);

  return handler.handleEvent(gameId, payload as any);
});

/**
 * Stripe payment webhooks
 */
app.post('/webhooks/stripe', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature') ?? '';

  const platform = new VoiceGamePlatform(c.env);
  const stripe = new StripeClient(c.env.STRIPE_SECRET_KEY);
  const handler = new StripeWebhookHandler(platform, stripe, c.env.STRIPE_WEBHOOK_SECRET);

  return handler.handleEvent(rawBody, signature);
});

// ============================================================================
// ADMIN ROUTES (protected)
// ============================================================================

app.route('/api/admin', admin);

// ============================================================================
// EXPORT
// ============================================================================

export default app;
