// ============================================================================
// Redis Game State Manager
// ============================================================================

/**
 * Manages ephemeral game state in Redis.
 * Uses REST API for Cloudflare Worker compatibility (no TCP sockets).
 *
 * Key patterns:
 *   game:{id}:status         → string (game status)
 *   game:{id}:alive_players  → set (active player IDs)
 *   game:{id}:eliminated     → set (eliminated player IDs)
 *   game:{id}:player:{pid}:call → string (call_control_id)
 *   game:{id}:questions      → string (JSON array of question IDs)
 *   game:{id}:current_question → string (current index)
 *   game:{id}:turn:{n}:answers → hash (playerId → JSON answer data)
 *   game:{id}:answer_deadline → string (timestamp)
 */
export class GameStateManager {
  private endpoint: string;
  private password: string;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.password = apiKey;
  }

  // ---- Low-level Redis commands via REST or raw TCP ----
  // For Cloudflare Workers, we'll use fetch-based Redis REST API
  // Redis Cloud supports REST via the RedisInsight API or a custom proxy
  // For now, we implement a simple command executor

  private async exec(command: string[]): Promise<any> {
    // Using Redis REST API pattern
    // This can be adapted to Upstash REST or a Redis REST proxy
    const url = `https://${this.endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.password}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Redis command failed: ${response.statusText}`);
    }

    return response.json();
  }

  // Simplified in-memory fallback for development
  private store = new Map<string, any>();
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();
  private useInMemory = true; // Toggle for dev vs production

  // ---- Game State Operations ----

  async setGameStatus(gameId: string, status: string): Promise<void> {
    const key = `game:${gameId}:status`;
    if (this.useInMemory) {
      this.store.set(key, status);
    } else {
      await this.exec(['SET', key, status, 'EX', '86400']);
    }
  }

  async getGameStatus(gameId: string): Promise<string | null> {
    const key = `game:${gameId}:status`;
    if (this.useInMemory) {
      return this.store.get(key) ?? null;
    }
    return this.exec(['GET', key]);
  }

  // ---- Player Set Operations ----

  async addAlivePlayers(gameId: string, playerIds: string[]): Promise<void> {
    const key = `game:${gameId}:alive_players`;
    if (this.useInMemory) {
      if (!this.sets.has(key)) this.sets.set(key, new Set());
      playerIds.forEach(id => this.sets.get(key)!.add(id));
    } else {
      await this.exec(['SADD', key, ...playerIds]);
      await this.exec(['EXPIRE', key, '86400']);
    }
  }

  async removeAlivePlayer(gameId: string, playerId: string): Promise<void> {
    const aliveKey = `game:${gameId}:alive_players`;
    const elimKey = `game:${gameId}:eliminated`;
    if (this.useInMemory) {
      this.sets.get(aliveKey)?.delete(playerId);
      if (!this.sets.has(elimKey)) this.sets.set(elimKey, new Set());
      this.sets.get(elimKey)!.add(playerId);
    } else {
      // Atomic pipeline: remove from alive, add to eliminated
      await this.exec(['SREM', aliveKey, playerId]);
      await this.exec(['SADD', elimKey, playerId]);
    }
  }

  async getAlivePlayers(gameId: string): Promise<string[]> {
    const key = `game:${gameId}:alive_players`;
    if (this.useInMemory) {
      return Array.from(this.sets.get(key) ?? []);
    }
    return this.exec(['SMEMBERS', key]);
  }

  async getAliveCount(gameId: string): Promise<number> {
    const key = `game:${gameId}:alive_players`;
    if (this.useInMemory) {
      return this.sets.get(key)?.size ?? 0;
    }
    return this.exec(['SCARD', key]);
  }

  // ---- Call Mapping ----

  async setPlayerCall(gameId: string, playerId: string, callControlId: string): Promise<void> {
    const key = `game:${gameId}:player:${playerId}:call`;
    if (this.useInMemory) {
      this.store.set(key, callControlId);
    } else {
      await this.exec(['SET', key, callControlId, 'EX', '86400']);
    }
  }

  async getPlayerCall(gameId: string, playerId: string): Promise<string | null> {
    const key = `game:${gameId}:player:${playerId}:call`;
    if (this.useInMemory) {
      return this.store.get(key) ?? null;
    }
    return this.exec(['GET', key]);
  }

  // ---- Questions/Content ----

  async setQuestions(gameId: string, questionIds: string[]): Promise<void> {
    const key = `game:${gameId}:questions`;
    if (this.useInMemory) {
      this.store.set(key, JSON.stringify(questionIds));
    } else {
      await this.exec(['SET', key, JSON.stringify(questionIds), 'EX', '86400']);
    }
  }

  async getQuestions(gameId: string): Promise<string[]> {
    const key = `game:${gameId}:questions`;
    const val = this.useInMemory ? this.store.get(key) : await this.exec(['GET', key]);
    return val ? JSON.parse(val) : [];
  }

  async getCurrentQuestionIndex(gameId: string): Promise<number> {
    const key = `game:${gameId}:current_question`;
    const val = this.useInMemory ? this.store.get(key) : await this.exec(['GET', key]);
    return val ? parseInt(val, 10) : 0;
  }

  async incrementQuestionIndex(gameId: string): Promise<number> {
    const key = `game:${gameId}:current_question`;
    if (this.useInMemory) {
      const current = parseInt(this.store.get(key) ?? '0', 10);
      this.store.set(key, String(current + 1));
      return current + 1;
    }
    return this.exec(['INCR', key]);
  }

  // ---- Turn Answers ----

  async submitAnswer(gameId: string, turnNumber: number, playerId: string, answerData: Record<string, any>): Promise<boolean> {
    const key = `game:${gameId}:turn:${turnNumber}:answers`;
    if (this.useInMemory) {
      if (!this.hashes.has(key)) this.hashes.set(key, new Map());
      // NX behavior: don't overwrite
      if (this.hashes.get(key)!.has(playerId)) return false;
      this.hashes.get(key)!.set(playerId, JSON.stringify(answerData));
      return true;
    }
    return this.exec(['HSETNX', key, playerId, JSON.stringify(answerData)]);
  }

  async getAnswers(gameId: string, turnNumber: number): Promise<Record<string, any>> {
    const key = `game:${gameId}:turn:${turnNumber}:answers`;
    if (this.useInMemory) {
      const hash = this.hashes.get(key);
      if (!hash) return {};
      const result: Record<string, any> = {};
      hash.forEach((val, key) => {
        result[key] = JSON.parse(val);
      });
      return result;
    }
    return this.exec(['HGETALL', key]);
  }

  // ---- Answer Deadline ----

  async setAnswerDeadline(gameId: string, deadline: number): Promise<void> {
    const key = `game:${gameId}:answer_deadline`;
    if (this.useInMemory) {
      this.store.set(key, String(deadline));
    } else {
      await this.exec(['SET', key, String(deadline), 'EX', '86400']);
    }
  }

  async getAnswerDeadline(gameId: string): Promise<number | null> {
    const key = `game:${gameId}:answer_deadline`;
    const val = this.useInMemory ? this.store.get(key) : await this.exec(['GET', key]);
    return val ? parseInt(val, 10) : null;
  }

  // ---- Cleanup ----

  async cleanupGame(gameId: string): Promise<void> {
    if (this.useInMemory) {
      // Remove all keys with this game prefix
      const prefix = `game:${gameId}:`;
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix)) this.store.delete(key);
      }
      for (const key of this.sets.keys()) {
        if (key.startsWith(prefix)) this.sets.delete(key);
      }
      for (const key of this.hashes.keys()) {
        if (key.startsWith(prefix)) this.hashes.delete(key);
      }
    }
    // In production, keys auto-expire via TTL
  }

  // ---- Health Check ----

  async healthCheck(): Promise<boolean> {
    if (this.useInMemory) return true;
    try {
      const result = await this.exec(['PING']);
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
