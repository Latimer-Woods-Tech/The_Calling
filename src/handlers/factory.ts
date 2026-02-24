// ============================================================================
// Game Handler Factory
// ============================================================================
// Creates the appropriate GameHandler instance based on game type.
// Extensible: add new handler mappings for new game types.
// ============================================================================

import type { GameHandler } from '../core/game-handler.js';
import { Database } from '../core/database.js';
import { GameStateManager } from '../state/game-state.js';
import { OpenAIClient } from '../integrations/openai.js';
import { TriviaHandler } from './trivia-handler.js';

const HANDLER_REGISTRY: Record<string, new (db: Database, state: GameStateManager, openai: OpenAIClient) => GameHandler> = {
  trivia: TriviaHandler,
  elimination_trivia: TriviaHandler,
};

/**
 * Create a GameHandler for the specified game type.
 * @throws Error if the game type is not registered.
 */
export function createGameHandler(
  gameType: string,
  db: Database,
  state: GameStateManager,
  openai: OpenAIClient
): GameHandler {
  const HandlerClass = HANDLER_REGISTRY[gameType];
  if (!HandlerClass) {
    throw new Error(`Unknown game type: ${gameType}. Registered: ${Object.keys(HANDLER_REGISTRY).join(', ')}`);
  }
  return new HandlerClass(db, state, openai);
}

/**
 * List all registered game types
 */
export function getRegisteredGameTypes(): string[] {
  return Object.keys(HANDLER_REGISTRY);
}
