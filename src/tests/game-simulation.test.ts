// ============================================================================
// Game Simulation Test — End-to-End TriviaHandler
// ============================================================================
// Simulates a complete trivia game lifecycle using the real Neon DB
// and in-memory state manager. Does NOT make calls (no Telnyx).
//
// Run with: npx vitest run src/tests/game-simulation.test.ts
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadSecrets(): Record<string, string> {
  const secretsPath = resolve(__dirname, '../../SECRETS-THECALLING.ini');
  const content = readFileSync(secretsPath, 'utf-8');
  const secrets: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      if (key === 'OPENAI_API_KEY' && value.startsWith('OPENAI_API_KEY:')) {
        value = value.replace('OPENAI_API_KEY:', '').trim();
      }
      secrets[key] = value;
    }
  }
  return secrets;
}

const secrets = loadSecrets();

// ============================================================================
// SIMULATION: Full Trivia Game Lifecycle
// ============================================================================
describe('Game Simulation: Trivia Lifecycle', () => {
  let db: any;
  let state: any;
  let openai: any;
  let handler: any;

  beforeEach(async () => {
    const { Database } = await import('../core/database.js');
    const { GameStateManager } = await import('../state/game-state.js');
    const { OpenAIClient } = await import('../integrations/openai.js');
    const { TriviaHandler } = await import('../handlers/trivia-handler.js');

    db = new Database(secrets.NEON_CONNECTION_STRING);
    // Use in-memory state for simulation (no Redis dependency)
    state = new GameStateManager('', '');
    openai = new OpenAIClient(secrets.OPENAI_API_KEY);
    handler = new TriviaHandler(db, state, openai);
  });

  it('loads questions from Neon DB during initialize', async () => {
    // Use a fake game instance ID for simulation
    const fakeGameId = 'sim-' + Date.now();

    // Mock getPaidParticipants to return simulated players
    const originalGetPaid = db.getPaidParticipants.bind(db);
    db.getPaidParticipants = async () => [
      { player_id: 'player-1' },
      { player_id: 'player-2' },
      { player_id: 'player-3' },
    ];

    await handler.initialize(fakeGameId, {
      questions_per_game: 5,
      time_limit_seconds: 15,
    });

    // Verify questions loaded
    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();
    expect(turn!.questionText).toBeTruthy();
    expect(turn!.options).toBeDefined();
    expect(turn!.options!.length).toBeGreaterThanOrEqual(2);
    expect(turn!.correctAnswer).toBeTruthy();
    expect(turn!.timeLimit).toBe(15);
    expect(turn!.turnNumber).toBe(1);

    console.log(`  ✓ Turn 1: "${turn!.questionText}"`);
    console.log(`    Options: ${turn!.options!.join(', ')}`);
    console.log(`    Correct: ${turn!.correctAnswer}`);

    // Restore
    db.getPaidParticipants = originalGetPaid;
  }, 30000);

  it('validates correct and incorrect answers', async () => {
    const fakeGameId = 'sim-validate-' + Date.now();
    db.getPaidParticipants = async () => [
      { player_id: 'p1' },
      { player_id: 'p2' },
    ];

    await handler.initialize(fakeGameId, { questions_per_game: 3 });

    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();

    // Test correct answer
    const correctResult = await handler.validateResponse(
      { playerId: 'p1', answer: turn!.correctAnswer, timestamp: Date.now() },
      turn!
    );
    expect(correctResult.isCorrect).toBe(true);
    expect(correctResult.confidence).toBeGreaterThan(0);
    console.log(`  ✓ Correct answer validation: isCorrect=${correctResult.isCorrect}, confidence=${correctResult.confidence}`);

    // Test wrong answer
    const wrongResult = await handler.validateResponse(
      { playerId: 'p2', answer: 'definitely wrong answer xyz', timestamp: Date.now() },
      turn!
    );
    expect(wrongResult.isCorrect).toBe(false);
    console.log(`  ✓ Wrong answer validation: isCorrect=${wrongResult.isCorrect}`);
  }, 30000);

  it('eliminates players who answer incorrectly', async () => {
    const fakeGameId = 'sim-elim-' + Date.now();
    db.getPaidParticipants = async () => [
      { player_id: 'p1' },
      { player_id: 'p2' },
      { player_id: 'p3' },
    ];
    // Stub eliminateParticipant to avoid DB writes with fake data
    db.eliminateParticipant = async () => {};

    await handler.initialize(fakeGameId, { questions_per_game: 5 });

    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();

    // Execute the turn
    const turnResult = await handler.executeTurn(turn!);

    // p1 answers correctly, p2 answers wrong, p3 no answer (timeout)
    const responses = [
      { playerId: 'p1', answer: turn!.correctAnswer, timestamp: Date.now() },
      { playerId: 'p2', answer: 'wrong answer', timestamp: Date.now() },
      // p3 has no response (simulated timeout)
    ];

    const turnResultWithCorrect = {
      ...turnResult,
      correctAnswer: turn!.correctAnswer,
      questionText: turn!.questionText,
    };

    const eliminated = await handler.determineEliminations(turnResultWithCorrect, responses);

    expect(eliminated).toContain('p2'); // wrong answer
    expect(eliminated).toContain('p3'); // no answer
    expect(eliminated).not.toContain('p1'); // correct answer

    const aliveCount = await state.getAliveCount(fakeGameId);
    expect(aliveCount).toBe(1); // only p1 survives

    console.log(`  ✓ Eliminated: ${eliminated.join(', ')}`);
    console.log(`  ✓ Remaining alive: ${aliveCount}`);
  }, 30000);

  it('detects game over when 1 player remains', async () => {
    const fakeGameId = 'sim-gameover-' + Date.now();
    db.getPaidParticipants = async () => [
      { player_id: 'p1' },
      { player_id: 'p2' },
    ];
    db.eliminateParticipant = async () => {};

    await handler.initialize(fakeGameId, { questions_per_game: 5 });

    let isOver = await handler.isGameOver();
    expect(isOver).toBe(false);

    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();
    await handler.executeTurn(turn!);

    // p1 correct, p2 wrong → p2 eliminated → 1 player → game over
    const eliminated = await handler.determineEliminations(
      {
        turnNumber: 1,
        responses: [],
        eliminatedPlayerIds: [],
        correctAnswer: turn!.correctAnswer,
        questionText: turn!.questionText,
      },
      [
        { playerId: 'p1', answer: turn!.correctAnswer, timestamp: Date.now() },
        { playerId: 'p2', answer: 'wrong', timestamp: Date.now() },
      ]
    );

    expect(eliminated).toContain('p2');
    isOver = await handler.isGameOver();
    expect(isOver).toBe(true);
    console.log(`  ✓ Game over detected with 1 player remaining`);
  }, 30000);

  it('finalizes game and produces GameResult', async () => {
    const fakeGameId = 'sim-finalize-' + Date.now();
    db.getPaidParticipants = async () => [
      { player_id: 'p1' },
      { player_id: 'p2' },
    ];
    db.eliminateParticipant = async () => {};
    db.updateGameStatus = async () => {};

    await handler.initialize(fakeGameId, { questions_per_game: 3 });

    // Simulate: p2 eliminated, p1 wins
    const turn = await handler.getNextTurn();
    await handler.executeTurn(turn!);
    await handler.determineEliminations(
      {
        turnNumber: 1,
        responses: [],
        eliminatedPlayerIds: [],
        correctAnswer: turn!.correctAnswer,
        questionText: turn!.questionText,
      },
      [
        { playerId: 'p1', answer: turn!.correctAnswer, timestamp: Date.now() },
        { playerId: 'p2', answer: 'wrong', timestamp: Date.now() },
      ]
    );

    const result = await handler.finalizeGame();
    expect(result.gameInstanceId).toBe(fakeGameId);
    expect(result.winners.length).toBe(1);
    expect(result.winners[0].playerId).toBe('p1');
    expect(result.winners[0].placement).toBe(1);
    expect(result.totalRounds).toBe(1);
    expect(result.totalPlayers).toBe(2);
    expect(result.endReason).toContain('last_player');

    console.log(`  ✓ Game finalized: winner=${result.winners[0].playerId}, rounds=${result.totalRounds}, reason=${result.endReason}`);
  }, 30000);

  it('AI validates fuzzy spoken answers against real OpenAI', async () => {
    const fakeGameId = 'sim-ai-' + Date.now();
    db.getPaidParticipants = async () => [
      { player_id: 'p1' },
      { player_id: 'p2' },
    ];

    await handler.initialize(fakeGameId, { questions_per_game: 5 });

    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();

    // Simulate a fuzzy spoken answer — use partial/misspelled version
    const fuzzyAnswer = turn!.correctAnswer.substring(0, Math.ceil(turn!.correctAnswer.length * 0.7));
    const result = await handler.validateResponse(
      {
        playerId: 'p1',
        answer: fuzzyAnswer,
        timestamp: Date.now(),
        confidence: 0.5, // Low confidence triggers AI validation
      },
      turn!
    );

    console.log(`  ✓ Fuzzy validation: "${fuzzyAnswer}" → correct=${result.isCorrect}, confidence=${result.confidence}`);
    console.log(`    Details: ${result.details}`);
    // We just verify it returns a result without error — fuzzy matching may or may not be correct
    expect(result).toHaveProperty('isCorrect');
    expect(result).toHaveProperty('confidence');
  }, 30000);
});

// ============================================================================
// SIMULATION: Factory Integration
// ============================================================================
describe('Game Simulation: Factory creates correct handler', () => {
  it('creates TriviaHandler for elimination_trivia type', async () => {
    const { createGameHandler } = await import('../handlers/factory.js');
    const { Database } = await import('../core/database.js');
    const { GameStateManager } = await import('../state/game-state.js');
    const { OpenAIClient } = await import('../integrations/openai.js');

    const db = new Database(secrets.NEON_CONNECTION_STRING);
    const state = new GameStateManager('', '');
    const openai = new OpenAIClient(secrets.OPENAI_API_KEY);

    const handler = createGameHandler('elimination_trivia', db, state, openai);
    expect(handler).toBeDefined();
    expect(handler.gameType).toBe('trivia');
  });

  it('throws for unknown game type', async () => {
    const { createGameHandler } = await import('../handlers/factory.js');
    const { Database } = await import('../core/database.js');
    const { GameStateManager } = await import('../state/game-state.js');
    const { OpenAIClient } = await import('../integrations/openai.js');

    const db = new Database(secrets.NEON_CONNECTION_STRING);
    const state = new GameStateManager('', '');
    const openai = new OpenAIClient(secrets.OPENAI_API_KEY);

    expect(() => createGameHandler('mystery_game', db, state, openai)).toThrow('Unknown game type');
  });
});
