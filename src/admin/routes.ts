// ============================================================================
// Admin API Routes
// ============================================================================
// Protected admin endpoints for game management, monitoring, and operations.
// ============================================================================

import { Hono } from 'hono';
import type { Env } from '../types/index.js';
import { Database } from '../core/database.js';
import { VoiceGamePlatform } from '../core/platform.js';

const admin = new Hono<{ Bindings: Env }>();

/**
 * Constant-time string comparison to prevent timing attacks on the API key.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  ) as CryptoKey;
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ]);
  const aArr = new Uint8Array(sigA);
  const bArr = new Uint8Array(sigB);
  if (aArr.length !== bArr.length) return false;
  let diff = 0;
  for (let i = 0; i < aArr.length; i++) {
    diff |= aArr[i] ^ bArr[i];
  }
  return diff === 0;
}

// ---- Middleware: API key authentication ----
admin.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '');

  if (!apiKey || !(await timingSafeEqual(apiKey, c.env.ADMIN_API_KEY))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});

// ---- Game Template Management ----

admin.get('/templates', async (c) => {
  const db = new Database(c.env.NEON_DATABASE_URL);
  const templates = await db.listGameTemplates();
  return c.json({ templates });
});

admin.get('/templates/:type', async (c) => {
  const db = new Database(c.env.NEON_DATABASE_URL);
  const template = await db.getGameTemplateByType(c.req.param('type'));
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json({ template });
});

// ---- Game Instance Management ----

admin.post('/games', async (c) => {
  const db = new Database(c.env.NEON_DATABASE_URL);
  const body = await c.req.json();

  const { templateId, scheduledAt, entryFee, maxPlayers } = body;
  if (!templateId || !scheduledAt || entryFee === undefined || !maxPlayers) {
    return c.json({ error: 'Missing required fields: templateId, scheduledAt, entryFee, maxPlayers' }, 400);
  }

  const instance = await db.createGameInstance(templateId, scheduledAt, entryFee, maxPlayers);
  return c.json({ instance }, 201);
});

admin.get('/games', async (c) => {
  const db = new Database(c.env.NEON_DATABASE_URL);
  const status = c.req.query('status');

  let games;
  if (status === 'upcoming') {
    games = await db.listUpcomingGames();
  } else if (status === 'active') {
    games = await db.listActiveGames();
  } else {
    // List all — default to upcoming
    games = await db.listUpcomingGames();
  }

  return c.json({ games });
});

admin.get('/games/:id', async (c) => {
  const db = new Database(c.env.NEON_DATABASE_URL);
  const game = await db.getGameInstance(c.req.param('id'));
  if (!game) return c.json({ error: 'Game not found' }, 404);
  return c.json({ game });
});

admin.get('/games/:id/participants', async (c) => {
  const db = new Database(c.env.NEON_DATABASE_URL);
  const participants = await db.getParticipants(c.req.param('id'));
  return c.json({ participants, count: participants.length });
});

// ---- Game Control ----

admin.post('/games/:id/start', async (c) => {
  const platform = new VoiceGamePlatform(c.env);
  const result = await platform.startGame(c.req.param('id'));
  return c.json({ status: 'started', ...result });
});

admin.post('/games/:id/next-turn', async (c) => {
  const platform = new VoiceGamePlatform(c.env);
  const result = await platform.executeGameTurn(c.req.param('id'));
  return c.json(result);
});

admin.post('/games/:id/process-answers/:turnNumber', async (c) => {
  const platform = new VoiceGamePlatform(c.env);
  const turnNumber = parseInt(c.req.param('turnNumber'), 10);
  const result = await platform.processAnswers(c.req.param('id'), turnNumber);
  return c.json(result);
});

admin.post('/games/:id/finalize', async (c) => {
  const platform = new VoiceGamePlatform(c.env);
  const result = await platform.finalizeGame(c.req.param('id'));
  return c.json(result);
});

// ---- Player Management ----

admin.get('/players/:phone', async (c) => {
  const db = new Database(c.env.NEON_DATABASE_URL);
  const player = await db.getPlayerByPhone(c.req.param('phone'));
  if (!player) return c.json({ error: 'Player not found' }, 404);
  return c.json({ player });
});

// ---- System ----

admin.get('/health', async (c) => {
  const platform = new VoiceGamePlatform(c.env);
  const health = await platform.healthCheck();
  const allHealthy = Object.values(health).every(Boolean);
  return c.json({ status: allHealthy ? 'healthy' : 'degraded', services: health }, allHealthy ? 200 : 503);
});

export { admin };
