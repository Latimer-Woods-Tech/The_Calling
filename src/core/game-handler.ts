// ============================================================================
// Game Handler Interface - Contract for all game types
// ============================================================================

import type {
  Turn,
  TurnResult,
  PlayerResponse,
  ValidationResult,
  GameResult,
} from '../types/index.js';

/**
 * GameHandler is the contract that every game type must implement.
 * The platform core (VoiceGamePlatform) is game-agnostic — it delegates
 * all game-specific logic to the handler.
 *
 * IMPORTANT: Handlers must be stateless between turns. All state is stored
 * in Redis and Postgres. This ensures the event-driven architecture works
 * correctly with Cloudflare Workers' request-per-execution model.
 */
export interface GameHandler {
  /** Game type identifier (matches game_templates.game_type) */
  readonly gameType: string;

  /**
   * Initialize game-specific state before the game loop starts.
   * Called once after all players' calls are connected.
   * - Pre-select content (questions, prompts)
   * - Store game-specific state in Redis
   * @param gameInstanceId - the game instance UUID
   * @param config - game template configuration
   */
  initialize(gameInstanceId: string, config: Record<string, any>): Promise<void>;

  /**
   * Get the next turn/round content.
   * Returns null when there are no more turns (game should end).
   */
  getNextTurn(): Promise<Turn | null>;

  /**
   * Execute a single turn:
   * 1. Set deadline in Redis
   * 2. Prepare turn-specific state
   * 3. Return the turn result skeleton (populated after answer collection)
   */
  executeTurn(turn: Turn): Promise<TurnResult>;

  /**
   * Validate a single player's response against the expected answer.
   * Handles normalization, fuzzy matching, alternatives.
   */
  validateResponse(response: PlayerResponse, turn: Turn): Promise<ValidationResult>;

  /**
   * Determine which players should be eliminated after a turn.
   * Returns array of player IDs to eliminate.
   */
  determineEliminations(
    turnResult: TurnResult,
    responses: PlayerResponse[]
  ): Promise<string[]>;

  /**
   * Check if the game should end.
   * Typically: only 1 player left, or no more content.
   */
  isGameOver(): Promise<boolean>;

  /**
   * Finalize the game — determine winners, calculate prizes.
   * Called after the game loop exits.
   */
  finalizeGame(): Promise<GameResult>;
}
