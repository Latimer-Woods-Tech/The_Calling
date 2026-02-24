// ============================================================================
// VoiceGamePlatform - Central Orchestrator
// ============================================================================
// This is the heart of The Calling. It orchestrates the entire game lifecycle:
//   Registration → Payment → Call Players → Game Loop → Elimination → Payout
//
// Architecture: Event-driven, designed for Cloudflare Workers' 30ms CPU limit.
// Long-running operations are broken into discrete webhook-driven steps.
// ============================================================================

import type {
  Env, GameInstance, GameTemplate, Turn, TurnResult,
  PlayerResponse, Winner, GameResult, ActiveCall
} from '../types/index.js';
import { Database } from './database.js';
import { GameStateManager } from '../state/game-state.js';
import { createGameHandler } from '../handlers/factory.js';
import {
  TelnyxClient, DeepgramClient, AssemblyAIClient,
  ElevenLabsClient, StripeClient, ResendClient,
  SentryClient, OpenAIClient
} from '../integrations/index.js';

export class VoiceGamePlatform {
  private db: Database;
  private state: GameStateManager;
  private telnyx: TelnyxClient;
  private deepgram: DeepgramClient;
  private assemblyai: AssemblyAIClient;
  private elevenlabs: ElevenLabsClient;
  private stripe: StripeClient;
  private resend: ResendClient;
  private sentry: SentryClient;
  private openai: OpenAIClient;
  private webhookBaseUrl: string;

  constructor(env: Env) {
    this.db = new Database(env.NEON_DATABASE_URL);
    this.state = new GameStateManager(env.REDIS_ENDPOINT, env.REDIS_API_KEY);
    this.telnyx = new TelnyxClient(env.TELNYX_API_KEY, env.TELNYX_CONNECTION_ID, env.TELNYX_PHONE_NUMBER);
    this.deepgram = new DeepgramClient(env.DEEPGRAM_API_KEY);
    this.assemblyai = new AssemblyAIClient(env.ASSEMBLYAI_API_KEY);
    this.elevenlabs = new ElevenLabsClient(env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID);
    this.stripe = new StripeClient(env.STRIPE_SECRET_KEY);
    this.resend = new ResendClient(env.RESEND_API_KEY);
    this.sentry = new SentryClient(env.SENTRY_DSN);
    this.openai = new OpenAIClient(env.OPENAI_API_KEY);
    this.webhookBaseUrl = env.WEBHOOK_BASE_URL ?? 'https://thecalling-platform.workers.dev';
  }

  // ==========================================================================
  // GAME LOOP - Full game lifecycle orchestration
  // ==========================================================================

  /**
   * Run the full game loop from start to completion.
   * This is the top-level orchestration method that drives the entire game.
   * 
   * In production (Cloudflare Workers), this would be broken into webhook-driven
   * steps. This unified method exists for:
   *   1. Testing and simulation
   *   2. Local development with synchronous execution
   *   3. Environments without the 30ms CPU limit
   *
   * Flow:
   *   1. Initialize handler with game config
   *   2. Loop: getNextTurn → executeTurn → collect answers → determineEliminations
   *   3. Repeat until isGameOver
   *   4. finalizeGame → distribute prizes → hang up calls
   *
   * @param gameInstanceId - The game instance UUID
   * @param options - Optional configuration for the game loop
   *   - answerCollector: async function to collect answers for a turn (default: read from Redis)
   *   - onTurnStart: callback before each turn
   *   - onTurnEnd: callback after each turn with results
   *   - skipVoice: skip TTS/call operations (for simulation mode)
   */
  async runFullGameLoop(gameInstanceId: string, options?: {
    answerCollector?: (gameInstanceId: string, turnNumber: number) => Promise<PlayerResponse[]>;
    onTurnStart?: (turn: Turn) => void;
    onTurnEnd?: (turnNumber: number, eliminated: string[], remaining: number) => void;
    skipVoice?: boolean;
  }): Promise<GameResult> {
    try {
      const gameInstance = await this.db.getGameInstance(gameInstanceId);
      if (!gameInstance) throw new Error('Game instance not found');

      const template = await this.db.getGameTemplate(gameInstance.template_id);
      if (!template) throw new Error('Game template not found');

      // Create handler
      const handler = createGameHandler(
        template.type,
        this.db,
        this.state,
        this.openai
      );

      // Initialize the handler (loads questions, sets up state)
      await handler.initialize(gameInstanceId, template.default_config ?? {});

      // Game loop
      let turnCount = 0;
      while (true) {
        // Get next turn
        const turn = await handler.getNextTurn();
        if (!turn) break;

        turnCount++;
        options?.onTurnStart?.(turn);

        // Voice: speak question to all players
        if (!options?.skipVoice) {
          const alivePlayers = await this.state.getAlivePlayers(gameInstanceId);
          const callControlIds: string[] = [];
          for (const playerId of alivePlayers) {
            const callId = await this.state.getPlayerCall(gameInstanceId, playerId);
            if (callId) callControlIds.push(callId);
          }
          if (callControlIds.length > 0) {
            await this.telnyx.speakToAll(callControlIds, this.formatQuestionForSpeech(turn));
            await this.telnyx.startRecordingAll(callControlIds);
          }
        }

        // Execute turn (sets deadline)
        const turnResult = await handler.executeTurn(turn);

        // Collect answers
        let responses: PlayerResponse[];
        if (options?.answerCollector) {
          responses = await options.answerCollector(gameInstanceId, turn.turnNumber);
        } else {
          // Default: read from Redis (collected via webhooks)
          const answers = await this.state.getAnswers(gameInstanceId, turn.turnNumber);
          responses = Object.entries(answers).map(([playerId, data]) => ({
            playerId,
            answer: data.answer ?? '',
            timestamp: data.timestamp ?? Date.now(),
            confidence: data.confidence,
            audioUrl: data.audioUrl,
          }));
        }

        // Fill in responses on turn result
        turnResult.responses = responses;

        // Determine eliminations
        const eliminatedIds = await handler.determineEliminations(turnResult, responses);
        turnResult.eliminatedPlayerIds = eliminatedIds;

        // Voice: notify eliminated players
        if (!options?.skipVoice) {
          for (const playerId of eliminatedIds) {
            const callId = await this.state.getPlayerCall(gameInstanceId, playerId);
            if (callId) {
              try {
                await this.telnyx.speak(callId,
                  "Sorry, that answer was incorrect. You've been eliminated. Thanks for playing The Calling!"
                );
              } catch {}
            }
          }
        }

        const remainingCount = await this.state.getAliveCount(gameInstanceId);
        options?.onTurnEnd?.(turn.turnNumber, eliminatedIds, remainingCount);

        // Check if game is over
        const gameOver = await handler.isGameOver();
        if (gameOver) break;
      }

      // Finalize game
      const result = await handler.finalizeGame();

      // Process payouts
      const participants = await this.db.getPaidParticipants(gameInstanceId);
      const prizePool = participants.length * gameInstance.entry_fee * 0.85;

      if (result.winners.length > 0) {
        const prizePerWinner = prizePool / result.winners.length;
        for (const winner of result.winners) {
          winner.prizeAmount = prizePerWinner;

          if (prizePerWinner > 0) {
            await this.db.insertPayout(gameInstanceId, winner.playerId, prizePerWinner, 'pending');
          }

          // Voice: announce winner
          if (!options?.skipVoice) {
            const callId = await this.state.getPlayerCall(gameInstanceId, winner.playerId);
            if (callId) {
              try {
                await this.telnyx.speak(callId,
                  `Congratulations! You won The Calling! Your prize: $${prizePerWinner.toFixed(2)}!`
                );
              } catch {}
            }
          }

          await this.db.updatePlayerStats(winner.playerId, true);
          await this.db.setParticipantResult(gameInstanceId, winner.playerId, winner.placement, prizePerWinner);
        }
      }

      // Cleanup
      await this.db.updateGameStatus(gameInstanceId, 'completed');
      await this.state.cleanupGame(gameInstanceId);

      // Hang up all remaining calls
      if (!options?.skipVoice) {
        const alivePlayers = await this.state.getAlivePlayers(gameInstanceId);
        for (const playerId of alivePlayers) {
          const callId = await this.state.getPlayerCall(gameInstanceId, playerId);
          if (callId) {
            try { await this.telnyx.hangup(callId); } catch {}
          }
        }
      }

      return result;
    } catch (error) {
      await this.sentry.captureException(error as Error, { gameInstanceId });
      throw error;
    }
  }

  // ==========================================================================
  // GAME LIFECYCLE (Webhook-driven discrete steps)
  // ==========================================================================

  /**
   * Phase 1: Register a player for a game instance
   */
  async registerPlayer(
    gameInstanceId: string,
    playerData: { phone_number: string; display_name: string; email?: string }
  ): Promise<{ participantId: string; paymentIntent?: { clientSecret: string } }> {
    try {
      // Get or create player
      let player = await this.db.getPlayerByPhone(playerData.phone_number);
      if (!player) {
        player = await this.db.createPlayer(
          playerData.phone_number,
          playerData.display_name,
          playerData.email
        );
      }

      // Get game instance for entry fee
      const gameInstance = await this.db.getGameInstance(gameInstanceId);
      if (!gameInstance) throw new Error('Game instance not found');
      if (gameInstance.status !== 'scheduled') throw new Error('Game is not open for registration');

      // Register participant
      const participant = await this.db.registerParticipant(gameInstanceId, player.id);

      // Create payment intent if there's an entry fee
      let paymentIntent: { clientSecret: string } | undefined;
      if (gameInstance.entry_fee > 0) {
        const pi = await this.stripe.createPaymentIntent(gameInstance.entry_fee, {
          gameInstanceId,
          playerId: player.id,
          participantId: participant.id,
        });
        paymentIntent = { clientSecret: pi.clientSecret };
      } else {
        // Free game — mark as paid
        await this.db.updateParticipantPayment(participant.id, 'paid', 'free_entry');
      }

      return { participantId: participant.id, paymentIntent };
    } catch (error) {
      await this.sentry.captureException(error as Error, { gameInstanceId, playerData });
      throw error;
    }
  }

  /**
   * Phase 2: Handle payment confirmation (called by Stripe webhook)
   */
  async handlePaymentConfirmed(
    participantId: string,
    stripePaymentIntentId: string
  ): Promise<void> {
    try {
      await this.db.updateParticipantPayment(participantId, 'paid', stripePaymentIntentId);

      // Optionally send confirmation email
      // const participant = ... (fetch participant + player data)
      // await this.resend.sendRegistrationConfirmation(...)
    } catch (error) {
      await this.sentry.captureException(error as Error, { participantId, stripePaymentIntentId });
      throw error;
    }
  }

  /**
   * Phase 3: Start the game — call all paid players
   */
  async startGame(gameInstanceId: string): Promise<{
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
  }> {
    try {
      // Update game status
      await this.db.updateGameStatus(gameInstanceId, 'calling');

      // Get all paid participants
      const participants = await this.db.getPaidParticipants(gameInstanceId);
      if (participants.length < 2) {
        await this.db.updateGameStatus(gameInstanceId, 'cancelled');
        throw new Error('Not enough paid participants to start game');
      }

      // Fetch player phone numbers
      const playersToCall: { id: string; phoneNumber: string }[] = [];
      for (const p of participants) {
        const player = await this.db.getPlayer(p.player_id);
        if (player) {
          playersToCall.push({ id: player.id, phoneNumber: player.phone_number });
        }
      }

      // Initiate calls to all players
      const { successful, failed } = await this.telnyx.callAllPlayers(
        playersToCall,
        gameInstanceId,
        this.webhookBaseUrl
      );

      // Store call mappings in Redis
      for (const call of successful) {
        await this.state.setPlayerCall(gameInstanceId, call.playerId, call.callControlId);
      }

      // Add successful callers to the alive set
      await this.state.addAlivePlayers(
        gameInstanceId,
        successful.map(c => c.playerId)
      );

      // Log failed calls
      if (failed.length > 0) {
        await this.sentry.captureMessage(
          `${failed.length} calls failed for game ${gameInstanceId}`,
          'warning',
          { failed }
        );
      }

      // Update game status
      await this.db.updateGameStatus(gameInstanceId, 'in_progress');

      return {
        totalCalls: playersToCall.length,
        successfulCalls: successful.length,
        failedCalls: failed.length,
      };
    } catch (error) {
      await this.sentry.captureException(error as Error, { gameInstanceId });
      throw error;
    }
  }

  /**
   * Phase 4: Execute a single game turn
   * Called by the game loop (triggered by webhook or scheduled event)
   */
  async executeGameTurn(gameInstanceId: string): Promise<{
    turn: Turn | null;
    isGameOver: boolean;
  }> {
    try {
      const gameInstance = await this.db.getGameInstance(gameInstanceId);
      if (!gameInstance) throw new Error('Game instance not found');

      const template = await this.db.getGameTemplate(gameInstance.template_id);
      if (!template) throw new Error('Game template not found');

      // Create handler for this game type
      const handler = createGameHandler(
        template.type,
        this.db,
        this.state,
        this.openai
      );

      // Check if handler needs initialization
      const gameStatus = await this.state.getGameStatus(gameInstanceId);
      if (gameStatus !== 'in_progress') {
        await handler.initialize(gameInstanceId, template.default_config ?? {});
      }

      // Get next turn
      const turn = await handler.getNextTurn();
      if (!turn) {
        return { turn: null, isGameOver: true };
      }

      // Generate TTS for the question
      const questionAudio = await this.generateQuestionAudio(turn);

      // Get all active call control IDs
      const alivePlayers = await this.state.getAlivePlayers(gameInstanceId);
      const callControlIds: string[] = [];
      for (const playerId of alivePlayers) {
        const callId = await this.state.getPlayerCall(gameInstanceId, playerId);
        if (callId) callControlIds.push(callId);
      }

      // Speak the question to all players
      if (questionAudio) {
        // If we have TTS audio, play it
        // For now, use Telnyx built-in TTS as fallback
        await this.telnyx.speakToAll(callControlIds, this.formatQuestionForSpeech(turn));
      }

      // Start recording all calls for answer capture
      await this.telnyx.startRecordingAll(callControlIds);

      // Execute turn (sets deadline, etc.)
      await handler.executeTurn(turn);

      const isGameOver = await handler.isGameOver();

      return { turn, isGameOver };
    } catch (error) {
      await this.sentry.captureException(error as Error, { gameInstanceId });
      throw error;
    }
  }

  /**
   * Phase 5: Process answers after turn deadline
   */
  async processAnswers(gameInstanceId: string, turnNumber: number): Promise<{
    eliminatedCount: number;
    remainingCount: number;
    isGameOver: boolean;
  }> {
    try {
      const gameInstance = await this.db.getGameInstance(gameInstanceId);
      if (!gameInstance) throw new Error('Game instance not found');

      const template = await this.db.getGameTemplate(gameInstance.template_id);
      if (!template) throw new Error('Game template not found');

      const handler = createGameHandler(
        template.type,
        this.db,
        this.state,
        this.openai
      );

      // Get collected answers from Redis
      const answers = await this.state.getAnswers(gameInstanceId, turnNumber);
      const responses: PlayerResponse[] = Object.entries(answers).map(([playerId, data]) => ({
        playerId,
        answer: data.answer ?? '',
        timestamp: data.timestamp ?? Date.now(),
        confidence: data.confidence,
        audioUrl: data.audioUrl,
      }));

      // Build turn result
      const turn = await handler.getNextTurn();
      if (!turn) {
        return { eliminatedCount: 0, remainingCount: 0, isGameOver: true };
      }

      const turnResult: TurnResult = {
        turnNumber,
        responses,
        eliminatedPlayerIds: [],
        correctAnswer: turn.correctAnswer,
        questionText: turn.questionText,
      };

      // Determine eliminations
      const eliminatedIds = await handler.determineEliminations(turnResult, responses);
      const remainingCount = await this.state.getAliveCount(gameInstanceId);

      // Notify eliminated players
      for (const playerId of eliminatedIds) {
        const callId = await this.state.getPlayerCall(gameInstanceId, playerId);
        if (callId) {
          try {
            await this.telnyx.speak(callId,
              "Sorry, that answer was incorrect. You've been eliminated from the game. Thanks for playing The Calling!"
            );
            // Give them a moment to hear the message, then hang up
            setTimeout(async () => {
              try { await this.telnyx.hangup(callId); } catch {}
            }, 5000);
          } catch {
            // Player may have already disconnected
          }
        }
      }

      const isGameOver = await handler.isGameOver();

      // If game is over, finalize
      if (isGameOver) {
        await this.finalizeGame(gameInstanceId);
      }

      return {
        eliminatedCount: eliminatedIds.length,
        remainingCount,
        isGameOver,
      };
    } catch (error) {
      await this.sentry.captureException(error as Error, { gameInstanceId, turnNumber });
      throw error;
    }
  }

  /**
   * Phase 6: Finalize the game — determine winners, process payouts
   */
  async finalizeGame(gameInstanceId: string): Promise<GameResult> {
    try {
      const gameInstance = await this.db.getGameInstance(gameInstanceId);
      if (!gameInstance) throw new Error('Game instance not found');

      const template = await this.db.getGameTemplate(gameInstance.template_id);
      if (!template) throw new Error('Game template not found');

      const handler = createGameHandler(
        template.type,
        this.db,
        this.state,
        this.openai
      );

      const result = await handler.finalizeGame();

      // Calculate prize pool
      const participants = await this.db.getPaidParticipants(gameInstanceId);
      const prizePool = participants.length * gameInstance.entry_fee * 0.85; // 15% platform fee

      // Distribute prizes
      if (result.winners.length > 0) {
        const prizePerWinner = prizePool / result.winners.length;
        for (const winner of result.winners) {
          winner.prizeAmount = prizePerWinner;

          // Record payout
          await this.db.insertPayout(
            gameInstanceId,
            winner.playerId,
            prizePerWinner,
            'pending'
          );

          // Announce winner on call
          const callId = await this.state.getPlayerCall(gameInstanceId, winner.playerId);
          if (callId) {
            try {
              await this.telnyx.speak(callId,
                `Congratulations! You are the winner of The Calling! ` +
                `You've won $${prizePerWinner.toFixed(2)}! ` +
                `Your prize will be sent to you shortly. Thank you for playing!`
              );
            } catch {}
          }

          // Update player stats
          await this.db.updatePlayerStats(winner.playerId, true);

          // Set participant result
          await this.db.setParticipantResult(
            gameInstanceId,
            winner.playerId,
            winner.placement,
            prizePerWinner
          );
        }
      }

      // Hang up all remaining calls
      const alivePlayers = await this.state.getAlivePlayers(gameInstanceId);
      for (const playerId of alivePlayers) {
        const callId = await this.state.getPlayerCall(gameInstanceId, playerId);
        if (callId) {
          try {
            // Give time for winner announcement
            setTimeout(async () => {
              try { await this.telnyx.hangup(callId); } catch {}
            }, 10000);
          } catch {}
        }
      }

      // Update game status
      await this.db.updateGameStatus(gameInstanceId, 'completed');

      // Cleanup Redis
      await this.state.cleanupGame(gameInstanceId);

      return result;
    } catch (error) {
      await this.sentry.captureException(error as Error, { gameInstanceId });
      throw error;
    }
  }

  // ==========================================================================
  // VOICE PROCESSING
  // ==========================================================================

  /**
   * Process a player's voice answer (called after recording webhook)
   */
  async processVoiceAnswer(
    gameInstanceId: string,
    playerId: string,
    audioUrl: string,
    turnNumber: number
  ): Promise<void> {
    try {
      // Transcribe with Deepgram (primary)
      let transcription;
      try {
        transcription = await this.deepgram.transcribeUrl(audioUrl);
      } catch (error) {
        // Fallback to AssemblyAI
        await this.sentry.captureMessage('Deepgram STT failed, falling back to AssemblyAI', 'warning');
        transcription = await this.assemblyai.transcribeUrl(audioUrl);
      }

      // Submit answer to Redis
      await this.state.submitAnswer(gameInstanceId, turnNumber, playerId, {
        answer: transcription.transcript,
        confidence: transcription.confidence,
        audioUrl,
        timestamp: Date.now(),
      });

      // Record in database
      await this.db.insertPlayerTurn(
        gameInstanceId,
        playerId,
        turnNumber,
        transcription.transcript,
        false, // is_correct — determined later during elimination phase
        transcription.confidence * 30, // response_time_ms approximation
        audioUrl
      );
    } catch (error) {
      await this.sentry.captureException(error as Error, { gameInstanceId, playerId, audioUrl });
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private async generateQuestionAudio(turn: Turn): Promise<ArrayBuffer | null> {
    try {
      const speechText = this.formatQuestionForSpeech(turn);
      return await this.elevenlabs.generateSpeech(speechText);
    } catch {
      return null; // Fall back to Telnyx TTS
    }
  }

  private formatQuestionForSpeech(turn: Turn): string {
    let speech = `Question ${turn.turnNumber}. ${turn.questionText}`;
    if (turn.options && turn.options.length > 0) {
      const labels = ['A', 'B', 'C', 'D'];
      turn.options.forEach((option, i) => {
        speech += `. ${labels[i]}: ${option}`;
      });
    }
    speech += `. You have ${turn.timeLimit} seconds to answer.`;
    return speech;
  }

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================

  async healthCheck(): Promise<Record<string, boolean>> {
    const [db, state, deepgram, elevenlabs, stripe, openai] = await Promise.allSettled([
      this.db.healthCheck(),
      this.state.healthCheck(),
      this.deepgram.healthCheck(),
      this.elevenlabs.healthCheck(),
      this.stripe.healthCheck(),
      this.openai.healthCheck(),
    ]);

    return {
      database: db.status === 'fulfilled' && db.value,
      redis: state.status === 'fulfilled' && state.value,
      deepgram: deepgram.status === 'fulfilled' && deepgram.value,
      elevenlabs: elevenlabs.status === 'fulfilled' && elevenlabs.value,
      stripe: stripe.status === 'fulfilled' && stripe.value,
      openai: openai.status === 'fulfilled' && openai.value,
    };
  }
}
