// ============================================================================
// 10-Player Simulation Test — Full Game Lifecycle
// ============================================================================
// Simulates a complete trivia game with 10 players, testing:
//   - Full game loop from start to winner
//   - Progressive elimination across rounds
//   - Correct/incorrect answer distribution
//   - State management across turns
//   - Game finalization with single winner
//
// Uses real Neon DB + OpenAI. No Telnyx calls.
// Run with: npx vitest run src/tests/ten-player-simulation.test.ts
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Turn, PlayerResponse, TurnResult } from '../types/index.js';

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

// Generate player IDs
const PLAYER_IDS = Array.from({ length: 10 }, (_, i) => `player-${String(i + 1).padStart(2, '0')}`);

// ============================================================================
// 10-PLAYER SIMULATION
// ============================================================================
describe('10-Player Simulation: Full Trivia Game', () => {
  let db: any;
  let state: any;
  let openai: any;
  let handler: any;

  const GAME_ID = 'sim-10p-' + Date.now();

  beforeEach(async () => {
    const { Database } = await import('../core/database.js');
    const { GameStateManager } = await import('../state/game-state.js');
    const { OpenAIClient } = await import('../integrations/openai.js');
    const { TriviaHandler } = await import('../handlers/trivia-handler.js');

    db = new Database(secrets.NEON_CONNECTION_STRING);
    state = new GameStateManager('', '');
    openai = new OpenAIClient(secrets.OPENAI_API_KEY);
    handler = new TriviaHandler(db, state, openai);

    // Mock getPaidParticipants to return our 10 simulated players
    db.getPaidParticipants = async () =>
      PLAYER_IDS.map(id => ({ player_id: id, payment_status: 'paid' }));

    // Mock eliminateParticipant to avoid writing fake data
    db.eliminateParticipant = async () => {};
    db.updateGameStatus = async () => {};
  });

  it('initializes game with 10 players and loads questions', async () => {
    await handler.initialize(GAME_ID, {
      questions_per_game: 10,
      time_limit_seconds: 15,
    });

    const alive = await state.getAlivePlayers(GAME_ID);
    expect(alive).toHaveLength(10);
    expect(alive).toEqual(expect.arrayContaining(PLAYER_IDS));

    const status = await state.getGameStatus(GAME_ID);
    expect(status).toBe('in_progress');
  }, 15000);

  it('runs a complete game eliminating players round by round', async () => {
    await handler.initialize(GAME_ID, {
      questions_per_game: 10,
      time_limit_seconds: 15,
    });

    const roundLog: Array<{
      round: number;
      question: string;
      correctAnswer: string;
      eliminated: string[];
      remaining: number;
    }> = [];

    let round = 0;
    while (true) {
      // Get next turn
      const turn: Turn | null = await handler.getNextTurn();
      if (!turn) break;

      round++;
      const aliveBefore = await state.getAlivePlayers(GAME_ID);

      // Execute turn
      await handler.executeTurn(turn);

      // Simulate answers: some correct, some wrong, some timeout
      // Strategy: each round, ~30% of remaining players get it wrong
      const responses: PlayerResponse[] = [];
      for (const playerId of aliveBefore) {
        const playerNum = parseInt(playerId.split('-')[1]);
        // Deterministic: players with number > (10 - round) answer incorrectly
        // This eliminates ~1-2 players per round
        const answersCorrectly = playerNum <= (10 - round);
        const isTimeout = playerNum === 10 && round === 1; // player-10 times out round 1

        if (isTimeout) {
          // No response = timeout = eliminated
          continue;
        }

        responses.push({
          playerId,
          answer: answersCorrectly ? turn.correctAnswer : 'wrong answer',
          timestamp: Date.now(),
          confidence: 1.0, // High confidence to skip AI validation (faster test)
        });
      }

      // Build turn result
      const turnResult: TurnResult = {
        turnNumber: turn.turnNumber,
        responses,
        eliminatedPlayerIds: [],
        correctAnswer: turn.correctAnswer,
        questionText: turn.questionText,
      };

      // Determine eliminations
      const eliminated = await handler.determineEliminations(turnResult, responses);
      const aliveAfter = await state.getAlivePlayers(GAME_ID);

      roundLog.push({
        round,
        question: turn.questionText.substring(0, 60) + '...',
        correctAnswer: turn.correctAnswer,
        eliminated,
        remaining: aliveAfter.length,
      });

      // Check if game is over
      const gameOver = await handler.isGameOver();
      if (gameOver) break;
    }

    // Verify game progressed through multiple rounds
    expect(round).toBeGreaterThanOrEqual(2);

    // Verify eliminations happened progressively
    const totalEliminated = roundLog.reduce((sum, r) => sum + r.eliminated.length, 0);
    expect(totalEliminated).toBeGreaterThanOrEqual(1);

    // Verify remaining players decreased
    const firstRoundRemaining = roundLog[0]?.remaining ?? 0;
    const lastRoundRemaining = roundLog[roundLog.length - 1]?.remaining ?? 0;
    expect(lastRoundRemaining).toBeLessThan(firstRoundRemaining);

    // Finalize game
    const result = await handler.finalizeGame();
    expect(result.gameInstanceId).toBe(GAME_ID);
    expect(result.totalPlayers).toBe(10);
    expect(result.totalRounds).toBe(round);
    expect(result.winners.length).toBeGreaterThanOrEqual(1);

    // Print summary
    console.log('\n=== 10-PLAYER SIMULATION RESULTS ===');
    for (const r of roundLog) {
      console.log(`  Round ${r.round}: "${r.correctAnswer}" | Eliminated: ${r.eliminated.length} | Remaining: ${r.remaining}`);
    }
    console.log(`  Winner(s): ${result.winners.map((w: any) => w.playerId).join(', ')}`);
    console.log(`  End reason: ${result.endReason}`);
    console.log(`  Total rounds: ${result.totalRounds}`);
    console.log('=====================================\n');
  }, 30000);

  it('handles scenario where all remaining players answer correctly', async () => {
    await handler.initialize(GAME_ID, {
      questions_per_game: 10,
      time_limit_seconds: 15,
    });

    // Get first turn
    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();

    await handler.executeTurn(turn!);

    // All 10 players answer correctly
    const responses: PlayerResponse[] = PLAYER_IDS.map(playerId => ({
      playerId,
      answer: turn!.correctAnswer,
      timestamp: Date.now(),
      confidence: 1.0,
    }));

    const turnResult: TurnResult = {
      turnNumber: turn!.turnNumber,
      responses,
      eliminatedPlayerIds: [],
      correctAnswer: turn!.correctAnswer,
      questionText: turn!.questionText,
    };

    const eliminated = await handler.determineEliminations(turnResult, responses);

    // No one should be eliminated
    expect(eliminated).toHaveLength(0);

    // All 10 should still be alive
    const alive = await state.getAlivePlayers(GAME_ID);
    expect(alive).toHaveLength(10);

    // Game should NOT be over
    const isOver = await handler.isGameOver();
    expect(isOver).toBe(false);
  }, 15000);

  it('handles scenario where all but one player answer incorrectly', async () => {
    await handler.initialize(GAME_ID, {
      questions_per_game: 10,
      time_limit_seconds: 15,
    });

    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();
    await handler.executeTurn(turn!);

    // Only player-01 answers correctly, rest answer wrong
    const responses: PlayerResponse[] = PLAYER_IDS.map(playerId => ({
      playerId,
      answer: playerId === 'player-01' ? turn!.correctAnswer : 'definitely wrong answer xyz',
      timestamp: Date.now(),
      confidence: 1.0,
    }));

    const turnResult: TurnResult = {
      turnNumber: turn!.turnNumber,
      responses,
      eliminatedPlayerIds: [],
      correctAnswer: turn!.correctAnswer,
      questionText: turn!.questionText,
    };

    const eliminated = await handler.determineEliminations(turnResult, responses);

    // 9 players eliminated
    expect(eliminated).toHaveLength(9);
    expect(eliminated).not.toContain('player-01');

    // Only 1 alive
    const alive = await state.getAlivePlayers(GAME_ID);
    expect(alive).toHaveLength(1);
    expect(alive[0]).toBe('player-01');

    // Game should be over
    const isOver = await handler.isGameOver();
    expect(isOver).toBe(true);

    // Finalize
    const result = await handler.finalizeGame();
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe('player-01');
    expect(result.endReason).toBe('last_player_standing');
  }, 15000);

  it('handles timeout players (no response submitted)', async () => {
    await handler.initialize(GAME_ID, {
      questions_per_game: 10,
      time_limit_seconds: 15,
    });

    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();
    await handler.executeTurn(turn!);

    // Only first 5 players respond, last 5 timeout (no response)
    const respondingPlayers = PLAYER_IDS.slice(0, 5);
    const timeoutPlayers = PLAYER_IDS.slice(5);

    const responses: PlayerResponse[] = respondingPlayers.map(playerId => ({
      playerId,
      answer: turn!.correctAnswer,
      timestamp: Date.now(),
      confidence: 1.0,
    }));

    const turnResult: TurnResult = {
      turnNumber: turn!.turnNumber,
      responses,
      eliminatedPlayerIds: [],
      correctAnswer: turn!.correctAnswer,
      questionText: turn!.questionText,
    };

    const eliminated = await handler.determineEliminations(turnResult, responses);

    // 5 timeout players should be eliminated
    expect(eliminated).toHaveLength(5);
    for (const tp of timeoutPlayers) {
      expect(eliminated).toContain(tp);
    }

    // 5 responders still alive
    const alive = await state.getAlivePlayers(GAME_ID);
    expect(alive).toHaveLength(5);
    for (const rp of respondingPlayers) {
      expect(alive).toContain(rp);
    }
  }, 15000);

  it('state is consistent across multiple rounds', async () => {
    await handler.initialize(GAME_ID, {
      questions_per_game: 10,
      time_limit_seconds: 15,
    });

    const aliveCountByRound: number[] = [10]; // Start with 10

    // Play 3 rounds, eliminating 2-3 players each
    for (let round = 1; round <= 3; round++) {
      const turn = await handler.getNextTurn();
      if (!turn) break;

      await handler.executeTurn(turn);

      const alive = await state.getAlivePlayers(GAME_ID);

      // Eliminate players numbered > (10 - round*2)
      // Round 1: eliminate player-09, player-10 (2 eliminated)
      // Round 2: eliminate player-07, player-08 (2 eliminated)
      // Round 3: eliminate player-05, player-06 (2 eliminated)
      const responses: PlayerResponse[] = alive.map((playerId: string) => {
        const num = parseInt(playerId.split('-')[1]);
        const threshold = 10 - round * 2;
        return {
          playerId,
          answer: num <= threshold ? turn.correctAnswer : 'wrong',
          timestamp: Date.now(),
          confidence: 1.0,
        };
      });

      const turnResult: TurnResult = {
        turnNumber: turn.turnNumber,
        responses,
        eliminatedPlayerIds: [],
        correctAnswer: turn.correctAnswer,
        questionText: turn.questionText,
      };

      await handler.determineEliminations(turnResult, responses);
      const aliveAfter = await state.getAlivePlayers(GAME_ID);
      aliveCountByRound.push(aliveAfter.length);
    }

    // Verify progressive elimination: 10 → 8 → 6 → 4
    expect(aliveCountByRound[0]).toBe(10);
    expect(aliveCountByRound[1]).toBe(8);
    expect(aliveCountByRound[2]).toBe(6);
    expect(aliveCountByRound[3]).toBe(4);

    // Verify specifically which players remain
    const alive = await state.getAlivePlayers(GAME_ID);
    expect(alive).toHaveLength(4);
    expect(alive).toContain('player-01');
    expect(alive).toContain('player-02');
    expect(alive).toContain('player-03');
    expect(alive).toContain('player-04');
  }, 30000);

  it('game ends when questions are exhausted with multiple survivors', async () => {
    // Initialize with only 2 questions
    await handler.initialize(GAME_ID, {
      questions_per_game: 2,
      time_limit_seconds: 15,
    });

    // Play 2 rounds with all players answering correctly
    for (let round = 1; round <= 2; round++) {
      const turn = await handler.getNextTurn();
      if (!turn) break;

      await handler.executeTurn(turn);

      const alive = await state.getAlivePlayers(GAME_ID);
      const responses: PlayerResponse[] = alive.map((playerId: string) => ({
        playerId,
        answer: turn.correctAnswer,
        timestamp: Date.now(),
        confidence: 1.0,
      }));

      const turnResult: TurnResult = {
        turnNumber: turn.turnNumber,
        responses,
        eliminatedPlayerIds: [],
        correctAnswer: turn.correctAnswer,
        questionText: turn.questionText,
      };

      await handler.determineEliminations(turnResult, responses);
    }

    // No more turns (ran out of questions)
    const nextTurn = await handler.getNextTurn();
    expect(nextTurn).toBeNull();

    // Game should be over (no more questions)
    const isOver = await handler.isGameOver();
    expect(isOver).toBe(true);

    // Finalize — all 10 players are winners
    const result = await handler.finalizeGame();
    expect(result.winners).toHaveLength(10);
    expect(result.endReason).toBe('all_questions_exhausted');
  }, 20000);

  it('produces a valid GameResult on finalization', async () => {
    await handler.initialize(GAME_ID, {
      questions_per_game: 10,
      time_limit_seconds: 15,
    });

    // Quick game: eliminate 9 in first round
    const turn = await handler.getNextTurn();
    expect(turn).not.toBeNull();
    await handler.executeTurn(turn!);

    const responses: PlayerResponse[] = PLAYER_IDS.map(playerId => ({
      playerId,
      answer: playerId === 'player-05' ? turn!.correctAnswer : 'wrong answer',
      timestamp: Date.now(),
      confidence: 1.0,
    }));

    const turnResult: TurnResult = {
      turnNumber: turn!.turnNumber,
      responses,
      eliminatedPlayerIds: [],
      correctAnswer: turn!.correctAnswer,
      questionText: turn!.questionText,
    };

    await handler.determineEliminations(turnResult, responses);

    const isOver = await handler.isGameOver();
    expect(isOver).toBe(true);

    const result = await handler.finalizeGame();

    // Validate GameResult shape
    expect(result).toHaveProperty('gameInstanceId', GAME_ID);
    expect(result).toHaveProperty('winners');
    expect(result).toHaveProperty('totalRounds');
    expect(result).toHaveProperty('totalPlayers', 10);
    expect(result).toHaveProperty('endReason');
    expect(result.winners).toBeInstanceOf(Array);
    expect(result.winners.length).toBe(1);
    expect(result.winners[0]).toHaveProperty('playerId', 'player-05');
    expect(result.winners[0]).toHaveProperty('placement', 1);
    expect(result.winners[0]).toHaveProperty('prizeAmount');
    expect(result.totalRounds).toBe(1);
  }, 15000);
});
