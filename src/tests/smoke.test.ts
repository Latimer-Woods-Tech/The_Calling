// ============================================================================
// Smoke Tests - Platform Basics
// ============================================================================

import { describe, it, expect } from 'vitest';

// ---- Unit Tests (no external dependencies) ----

describe('Utility Functions', () => {
  it('formatPhoneE164: 10-digit number', async () => {
    const { formatPhoneE164 } = await import('../utils/index.js');
    expect(formatPhoneE164('7757172255')).toBe('+17757172255');
  });

  it('formatPhoneE164: 11-digit number', async () => {
    const { formatPhoneE164 } = await import('../utils/index.js');
    expect(formatPhoneE164('17757172255')).toBe('+17757172255');
  });

  it('formatPhoneE164: already E.164', async () => {
    const { formatPhoneE164 } = await import('../utils/index.js');
    expect(formatPhoneE164('+17757172255')).toBe('+17757172255');
  });

  it('formatPhoneE164: formatted number', async () => {
    const { formatPhoneE164 } = await import('../utils/index.js');
    expect(formatPhoneE164('(775) 717-2255')).toBe('+17757172255');
  });

  it('calculatePrizeDistribution: basic', async () => {
    const { calculatePrizeDistribution } = await import('../utils/index.js');
    const result = calculatePrizeDistribution(10, 100);
    expect(result.prizePool).toBe(850);
    expect(result.platformFee).toBe(150);
    expect(result.winnerPrizes[0]).toBe(850);
  });

  it('calculatePrizeDistribution: custom fee', async () => {
    const { calculatePrizeDistribution } = await import('../utils/index.js');
    const result = calculatePrizeDistribution(10, 100, 10);
    expect(result.prizePool).toBe(900);
    expect(result.platformFee).toBe(100);
  });

  it('randomString: correct length', async () => {
    const { randomString } = await import('../utils/index.js');
    const s = randomString(16);
    expect(s.length).toBe(16);
  });

  it('truncate: short text unchanged', async () => {
    const { truncate } = await import('../utils/index.js');
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncate: long text trimmed', async () => {
    const { truncate } = await import('../utils/index.js');
    const result = truncate('hello world this is a long string', 10);
    expect(result.length).toBe(10);
    expect(result.endsWith('...')).toBe(true);
  });

  it('formatCurrency: formats correctly', async () => {
    const { formatCurrency } = await import('../utils/index.js');
    expect(formatCurrency(10)).toBe('$10.00');
    expect(formatCurrency(0.5)).toBe('$0.50');
    expect(formatCurrency(1234.56)).toBe('$1234.56');
  });

  it('safeJsonParse: valid JSON', async () => {
    const { safeJsonParse } = await import('../utils/index.js');
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('safeJsonParse: invalid JSON returns fallback', async () => {
    const { safeJsonParse } = await import('../utils/index.js');
    expect(safeJsonParse('invalid', { default: true })).toEqual({ default: true });
  });

  it('retry: succeeds on first try', async () => {
    const { retry } = await import('../utils/index.js');
    const result = await retry(async () => 42, 3, 10);
    expect(result).toBe(42);
  });

  it('retry: retries on failure then succeeds', async () => {
    const { retry } = await import('../utils/index.js');
    let attempts = 0;
    const result = await retry(async () => {
      attempts++;
      if (attempts < 3) throw new Error('not yet');
      return 'done';
    }, 5, 10);
    expect(result).toBe('done');
    expect(attempts).toBe(3);
  });
});

describe('GameHandler Factory', () => {
  it('creates trivia handler', async () => {
    const { createGameHandler, getRegisteredGameTypes } = await import('../handlers/factory.js');
    const types = getRegisteredGameTypes();
    expect(types).toContain('trivia');
  });

  it('throws for unknown game type', async () => {
    const { createGameHandler } = await import('../handlers/factory.js');
    // Need mock dependencies - just test error case
    expect(() => createGameHandler('nonexistent', {} as any, {} as any, {} as any))
      .toThrow('Unknown game type: nonexistent');
  });
});

describe('GameStateManager', () => {
  it('in-memory: set and get game status', async () => {
    const { GameStateManager } = await import('../state/game-state.js');
    const state = new GameStateManager('test', 'test');

    await state.setGameStatus('game1', 'in_progress');
    const status = await state.getGameStatus('game1');
    expect(status).toBe('in_progress');
  });

  it('in-memory: alive players tracking', async () => {
    const { GameStateManager } = await import('../state/game-state.js');
    const state = new GameStateManager('test', 'test');

    await state.addAlivePlayers('game1', ['p1', 'p2', 'p3']);
    expect(await state.getAliveCount('game1')).toBe(3);

    await state.removeAlivePlayer('game1', 'p2');
    expect(await state.getAliveCount('game1')).toBe(2);

    const alive = await state.getAlivePlayers('game1');
    expect(alive).toContain('p1');
    expect(alive).toContain('p3');
    expect(alive).not.toContain('p2');
  });

  it('in-memory: question index tracking', async () => {
    const { GameStateManager } = await import('../state/game-state.js');
    const state = new GameStateManager('test', 'test');

    expect(await state.getCurrentQuestionIndex('game1')).toBe(0);
    await state.incrementQuestionIndex('game1');
    expect(await state.getCurrentQuestionIndex('game1')).toBe(1);
    await state.incrementQuestionIndex('game1');
    expect(await state.getCurrentQuestionIndex('game1')).toBe(2);
  });

  it('in-memory: answer submission (NX behavior)', async () => {
    const { GameStateManager } = await import('../state/game-state.js');
    const state = new GameStateManager('test', 'test');

    const first = await state.submitAnswer('game1', 1, 'p1', { answer: 'A' });
    expect(first).toBe(true);

    // Second submission should be rejected (NX)
    const second = await state.submitAnswer('game1', 1, 'p1', { answer: 'B' });
    expect(second).toBe(false);
  });

  it('in-memory: cleanup removes all game keys', async () => {
    const { GameStateManager } = await import('../state/game-state.js');
    const state = new GameStateManager('test', 'test');

    await state.setGameStatus('game1', 'in_progress');
    await state.addAlivePlayers('game1', ['p1']);
    await state.submitAnswer('game1', 1, 'p1', { answer: 'A' });

    await state.cleanupGame('game1');

    expect(await state.getGameStatus('game1')).toBeNull();
    expect(await state.getAliveCount('game1')).toBe(0);
  });
});

describe('Type Definitions', () => {
  it('Env type has required properties', async () => {
    // Just verify the types compile — this is a compile-time check
    const env: Partial<import('../types/index.js').Env> = {
      NEON_DATABASE_URL: 'test',
      TELNYX_API_KEY: 'test',
    };
    expect(env.NEON_DATABASE_URL).toBe('test');
  });
});
