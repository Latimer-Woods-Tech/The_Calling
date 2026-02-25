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
app.use('*', cors());
app.use('*', logger());

// Global error handler
app.onError((err, c) => {
  console.error('[Error]', err.message, err.stack);
  return c.json(
    { error: 'Internal server error', message: err.message },
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
 * Telnyx voice webhooks - per game instance
 */
app.post('/webhooks/telnyx/:gameId', async (c) => {
  const gameId = c.req.param('gameId');
  const payload = await c.req.json();

  const platform = new VoiceGamePlatform(c.env);
  const state = new GameStateManager(c.env.REDIS_ENDPOINT, c.env.REDIS_API_KEY);
  const handler = new TelnyxWebhookHandler(platform, state);

  return handler.handleEvent(gameId, payload);
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
