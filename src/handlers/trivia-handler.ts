// ============================================================================
// Trivia Game Handler
// ============================================================================
// Implements the GameHandler interface for trivia-style games.
// Supports multiple-choice questions with voice-based answers.
// ============================================================================

import type {
  Turn, TurnResult, PlayerResponse, ValidationResult,
  Winner, GameResult, TriviaConfig, TriviaQuestion
} from '../types/index.js';
import type { GameHandler } from '../core/game-handler.js';
import { Database } from '../core/database.js';
import { GameStateManager } from '../state/game-state.js';
import { OpenAIClient } from '../integrations/openai.js';

interface TriviaState {
  questions: TriviaQuestion[];
  currentQuestionIndex: number;
  alivePlayers: string[];
  eliminatedThisRound: string[];
  roundNumber: number;
}

export class TriviaHandler implements GameHandler {
  readonly gameType = 'trivia';

  private db: Database;
  private state: GameStateManager;
  private openai: OpenAIClient;
  private config: TriviaConfig | null = null;
  private gameInstanceId: string = '';
  private triviaState: TriviaState | null = null;

  constructor(db: Database, state: GameStateManager, openai: OpenAIClient) {
    this.db = db;
    this.state = state;
    this.openai = openai;
  }

  async initialize(gameInstanceId: string, config: TriviaConfig): Promise<void> {
    this.gameInstanceId = gameInstanceId;
    this.config = config;

    const questionCount = config.questions_per_game ?? 10;

    // Load random questions from database
    // DB type is 'elimination_trivia' — accept either for flexibility
    const gameType = config.categories?.length ? 'elimination_trivia' : 'elimination_trivia';
    const contentRows = await this.db.getRandomQuestions(
      gameType,
      questionCount,
      config.difficulty
    );

    if (contentRows.length < questionCount) {
      console.warn(`Only ${contentRows.length} questions available, requested ${questionCount}`);
    }

    // Transform GameContent rows into TriviaQuestion objects
    // DB stores question data in content_data JSONB: { question, correct_answer, alternatives, category }
    const questions: TriviaQuestion[] = contentRows.map((row: any) => {
      const data = row.content_data ?? {};
      return {
        id: row.id,
        question_text: data.question ?? '',
        options: [data.correct_answer, ...(data.alternatives ?? [])].sort(() => Math.random() - 0.5),
        correct_answer: data.correct_answer ?? '',
        category: data.category ?? row.category ?? '',
        difficulty: row.difficulty ?? 'medium',
      };
    });

    // Store question IDs in Redis for fast access
    const questionIds = questions.map(q => q.id);
    await this.state.setQuestions(gameInstanceId, questionIds);

    // Get alive players
    const participants = await this.db.getPaidParticipants(gameInstanceId);
    const playerIds = participants.map(p => p.player_id);
    await this.state.addAlivePlayers(gameInstanceId, playerIds);

    this.triviaState = {
      questions,
      currentQuestionIndex: 0,
      alivePlayers: playerIds,
      eliminatedThisRound: [],
      roundNumber: 1,
    };

    await this.state.setGameStatus(gameInstanceId, 'in_progress');
  }

  async getNextTurn(): Promise<Turn | null> {
    if (!this.triviaState || !this.config) return null;

    const { questions, currentQuestionIndex } = this.triviaState;

    // No more questions
    if (currentQuestionIndex >= questions.length) return null;

    // Only 1 player left = game over
    const alive = await this.state.getAlivePlayers(this.gameInstanceId);
    if (alive.length <= 1) return null;

    const question = questions[currentQuestionIndex];
    const timeLimit = this.config.time_limit_seconds ?? 30;

    return {
      turnNumber: currentQuestionIndex + 1,
      questionText: question.question_text,
      options: question.options,
      correctAnswer: question.correct_answer,
      timeLimit,
      metadata: {
        category: question.category,
        difficulty: question.difficulty,
        questionId: question.id,
      },
    };
  }

  async executeTurn(turn: Turn): Promise<TurnResult> {
    if (!this.triviaState) {
      throw new Error('Game not initialized');
    }

    // Set deadline in Redis
    const deadline = Date.now() + (turn.timeLimit * 1000);
    await this.state.setAnswerDeadline(this.gameInstanceId, deadline);

    // The actual answer collection happens via webhooks (Telnyx voice → STT → submitAnswer)
    // This method sets up the turn; results are collected after deadline

    return {
      turnNumber: turn.turnNumber,
      responses: [], // Populated after answer collection
      eliminatedPlayerIds: [],
      correctAnswer: turn.correctAnswer,
      questionText: turn.questionText,
    };
  }

  async validateResponse(response: PlayerResponse, turn: Turn): Promise<ValidationResult> {
    // First try exact match
    const normalizedAnswer = response.answer.trim().toLowerCase();
    const normalizedCorrect = turn.correctAnswer.trim().toLowerCase();

    // Direct match
    if (normalizedAnswer === normalizedCorrect) {
      return { isCorrect: true, confidence: 1.0, details: 'Exact match' };
    }

    // Option letter match (A, B, C, D)
    if (turn.options) {
      const optionIndex = turn.options.findIndex(
        o => o.toLowerCase() === normalizedCorrect
      );
      const letterMap = ['a', 'b', 'c', 'd'];
      if (optionIndex >= 0 && normalizedAnswer === letterMap[optionIndex]) {
        return { isCorrect: true, confidence: 0.95, details: 'Letter option match' };
      }
    }

    // If confidence is low, use AI validation for fuzzy matching
    if (response.confidence !== undefined && response.confidence < 0.8) {
      try {
        const aiResult = await this.openai.validateSpokenAnswer(
          turn.questionText,
          turn.correctAnswer,
          response.answer,
          turn.options ?? []
        );
        return {
          isCorrect: aiResult.isCorrect,
          confidence: aiResult.confidence,
          details: aiResult.reasoning,
        };
      } catch (error) {
        // If AI validation fails, fall back to string match
        return { isCorrect: false, confidence: 0, details: 'AI validation failed, answer did not match' };
      }
    }

    return { isCorrect: false, confidence: 0, details: 'No match' };
  }

  async determineEliminations(
    turnResult: TurnResult,
    responses: PlayerResponse[]
  ): Promise<string[]> {
    if (!this.triviaState) return [];

    const correctAnswer = turnResult.correctAnswer;
    const alivePlayers = await this.state.getAlivePlayers(this.gameInstanceId);
    const eliminatedIds: string[] = [];

    // Get the turn for validation
    const turn: Turn = {
      turnNumber: turnResult.turnNumber,
      questionText: turnResult.questionText,
      correctAnswer,
      options: [],
      timeLimit: 30,
    };

    for (const playerId of alivePlayers) {
      const playerResponse = responses.find(r => r.playerId === playerId);

      if (!playerResponse) {
        // No answer = eliminated (timeout or disconnected)
        eliminatedIds.push(playerId);
        continue;
      }

      const validation = await this.validateResponse(playerResponse, turn);
      if (!validation.isCorrect) {
        eliminatedIds.push(playerId);
      }
    }

    // Apply eliminations
    for (const id of eliminatedIds) {
      await this.state.removeAlivePlayer(this.gameInstanceId, id);
      // Record in database
      await this.db.eliminateParticipant(this.gameInstanceId, id, turnResult.turnNumber);
    }

    // Advance to next question
    this.triviaState.currentQuestionIndex++;
    await this.state.incrementQuestionIndex(this.gameInstanceId);

    return eliminatedIds;
  }

  async isGameOver(): Promise<boolean> {
    if (!this.triviaState) return true;

    const aliveCount = await this.state.getAliveCount(this.gameInstanceId);

    // Game over if 1 or 0 players left
    if (aliveCount <= 1) return true;

    // Game over if no more questions
    if (this.triviaState.currentQuestionIndex >= this.triviaState.questions.length) return true;

    return false;
  }

  async finalizeGame(): Promise<GameResult> {
    if (!this.triviaState) {
      throw new Error('Game not initialized');
    }

    const alivePlayers = await this.state.getAlivePlayers(this.gameInstanceId);
    const totalRounds = this.triviaState.currentQuestionIndex;

    const winners: Winner[] = alivePlayers.map((playerId, index) => ({
      playerId,
      placement: index + 1,
      prizeAmount: 0, // Calculated by platform based on prize pool
    }));

    // Update game status
    await this.state.setGameStatus(this.gameInstanceId, 'completed');
    await this.db.updateGameStatus(this.gameInstanceId, 'completed');

    // Cleanup Redis state
    await this.state.cleanupGame(this.gameInstanceId);

    return {
      gameInstanceId: this.gameInstanceId,
      winners,
      totalRounds,
      totalPlayers: this.triviaState.alivePlayers.length,
      endReason: alivePlayers.length <= 1 ? 'last_player_standing' : 'all_questions_exhausted',
    };
  }
}
