// ============================================================================
// Database Client - Neon Serverless Postgres
// ============================================================================

import { neon } from '@neondatabase/serverless';
import type {
  GameTemplate,
  GameInstance,
  GameContent,
  Player,
  GameParticipant,
  PlayerTurn,
  Payout,
} from '../types/index.js';

export class Database {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sql: any;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  // ---- Game Templates ----

  async getGameTemplate(id: string): Promise<GameTemplate | null> {
    const rows = await this.sql`
      SELECT * FROM game_templates WHERE id = ${id}
    `;
    return (rows[0] as GameTemplate) ?? null;
  }

  async getGameTemplateByType(type: string): Promise<GameTemplate | null> {
    const rows = await this.sql`
      SELECT * FROM game_templates WHERE type = ${type} AND is_active = true
    `;
    return (rows[0] as GameTemplate) ?? null;
  }

  async listGameTemplates(): Promise<GameTemplate[]> {
    const rows = await this.sql`
      SELECT * FROM game_templates WHERE is_active = true ORDER BY name
    `;
    return rows as GameTemplate[];
  }

  // ---- Game Instances ----

  async createGameInstance(
    templateId: string,
    scheduledAt: string,
    entryFee: number,
    maxPlayers: number,
    name?: string,
    config?: Record<string, any>
  ): Promise<GameInstance> {
    const rows = await this.sql`
      INSERT INTO game_instances (template_id, name, scheduled_at, entry_fee, max_players, prize_structure, config)
      VALUES (${templateId}, ${name ?? 'Game'}, ${scheduledAt}, ${entryFee}, ${maxPlayers}, ${JSON.stringify({})}, ${JSON.stringify(config ?? {})})
      RETURNING *
    `;
    return rows[0] as GameInstance;
  }

  async getGameInstance(id: string): Promise<GameInstance | null> {
    const rows = await this.sql`
      SELECT * FROM game_instances WHERE id = ${id}
    `;
    return (rows[0] as GameInstance) ?? null;
  }

  async updateGameStatus(id: string, status: string, extraFields?: Record<string, any>): Promise<void> {
    if (status === 'active') {
      await this.sql`
        UPDATE game_instances SET status = ${status}, started_at = NOW() WHERE id = ${id}
      `;
    } else if (status === 'finished') {
      await this.sql`
        UPDATE game_instances SET status = ${status}, ended_at = NOW() WHERE id = ${id}
      `;
    } else {
      await this.sql`
        UPDATE game_instances SET status = ${status} WHERE id = ${id}
      `;
    }
  }

  async listUpcomingGames(): Promise<GameInstance[]> {
    const rows = await this.sql`
      SELECT * FROM game_instances
      WHERE status IN ('scheduled', 'registering')
      AND scheduled_at > NOW()
      ORDER BY scheduled_at ASC
    `;
    return rows as GameInstance[];
  }

  async listActiveGames(): Promise<GameInstance[]> {
    const rows = await this.sql`
      SELECT * FROM game_instances WHERE status = 'active' ORDER BY started_at DESC
    `;
    return rows as GameInstance[];
  }

  // ---- Game Content ----

  async getGameContent(id: string): Promise<GameContent | null> {
    const rows = await this.sql`
      SELECT * FROM game_content WHERE id = ${id}
    `;
    return (rows[0] as GameContent) ?? null;
  }

  async getRandomQuestions(gameType: string, count: number, difficulty?: string): Promise<GameContent[]> {
    if (difficulty) {
      const rows = await this.sql`
        SELECT * FROM game_content
        WHERE template_id IN (
          SELECT id FROM game_templates WHERE type = ${gameType}
        )
          AND is_active = true
          AND difficulty = ${difficulty}
        ORDER BY RANDOM()
        LIMIT ${count}
      `;
      return rows as GameContent[];
    }
    const rows = await this.sql`
      SELECT * FROM game_content
      WHERE template_id IN (
        SELECT id FROM game_templates WHERE type = ${gameType}
      )
        AND is_active = true
      ORDER BY RANDOM()
      LIMIT ${count}
    `;
    return rows as GameContent[];
  }

  async incrementContentUsage(contentId: string, wasCorrect: boolean): Promise<void> {
    if (wasCorrect) {
      await this.sql`
        UPDATE game_content SET times_used = times_used + 1, times_correct = times_correct + 1 WHERE id = ${contentId}
      `;
    } else {
      await this.sql`
        UPDATE game_content SET times_used = times_used + 1 WHERE id = ${contentId}
      `;
    }
  }

  // ---- Players ----

  async getPlayer(id: string): Promise<Player | null> {
    const rows = await this.sql`
      SELECT * FROM players WHERE id = ${id}
    `;
    return (rows[0] as Player) ?? null;
  }

  async getPlayerByPhone(phoneNumber: string): Promise<Player | null> {
    const rows = await this.sql`
      SELECT * FROM players WHERE phone_number = ${phoneNumber}
    `;
    return (rows[0] as Player) ?? null;
  }

  async createPlayer(phoneNumber: string, name?: string, email?: string): Promise<Player> {
    const rows = await this.sql`
      INSERT INTO players (phone_number, name, email)
      VALUES (${phoneNumber}, ${name ?? null}, ${email ?? null})
      ON CONFLICT (phone_number) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, players.name),
        email = COALESCE(EXCLUDED.email, players.email)
      RETURNING *
    `;
    return rows[0] as Player;
  }

  async updatePlayerStats(playerId: string, won: boolean, spent: number = 0, winnings: number = 0): Promise<void> {
    await this.sql`
      UPDATE players SET
        total_games_played = total_games_played + 1,
        total_games_won = total_games_won + ${won ? 1 : 0},
        total_spent = total_spent + ${spent},
        total_winnings = total_winnings + ${winnings}
      WHERE id = ${playerId}
    `;
  }

  // ---- Game Participants ----

  async registerParticipant(gameInstanceId: string, playerId: string): Promise<GameParticipant> {
    const rows = await this.sql`
      INSERT INTO game_participants (game_instance_id, player_id)
      VALUES (${gameInstanceId}, ${playerId})
      ON CONFLICT (game_instance_id, player_id) DO NOTHING
      RETURNING *
    `;
    return rows[0] as GameParticipant;
  }

  async getParticipants(gameInstanceId: string): Promise<GameParticipant[]> {
    const rows = await this.sql`
      SELECT gp.*, p.phone_number, p.name as player_name
      FROM game_participants gp
      JOIN players p ON p.id = gp.player_id
      WHERE gp.game_instance_id = ${gameInstanceId}
      ORDER BY gp.created_at
    `;
    return rows as GameParticipant[];
  }

  async getPaidParticipants(gameInstanceId: string): Promise<(GameParticipant & { phone_number: string })[]> {
    const rows = await this.sql`
      SELECT gp.*, p.phone_number, p.name as player_name, p.stripe_account_id
      FROM game_participants gp
      JOIN players p ON p.id = gp.player_id
      WHERE gp.game_instance_id = ${gameInstanceId}
        AND gp.payment_status = 'paid'
      ORDER BY gp.created_at
    `;
    return rows as (GameParticipant & { phone_number: string })[];
  }

  async updateParticipantPayment(participantId: string, status: string, paymentIntentId?: string): Promise<void> {
    await this.sql`
      UPDATE game_participants
      SET payment_status = ${status}, payment_intent_id = ${paymentIntentId ?? null}, paid_at = NOW()
      WHERE id = ${participantId}
    `;
  }

  async eliminateParticipant(gameInstanceId: string, playerId: string, turnNumber: number | string): Promise<void> {
    const reason = typeof turnNumber === 'number' ? `Eliminated on turn ${turnNumber}` : turnNumber;
    await this.sql`
      UPDATE game_participants
      SET status = 'eliminated', eliminated_at = NOW(), elimination_reason = ${reason}
      WHERE game_instance_id = ${gameInstanceId} AND player_id = ${playerId}
    `;
  }

  async setParticipantResult(gameInstanceId: string, playerId: string, placement: number, prizeAmount: number): Promise<void> {
    await this.sql`
      UPDATE game_participants
      SET status = 'winner', placement = ${placement}, prize_amount = ${prizeAmount}
      WHERE game_instance_id = ${gameInstanceId} AND player_id = ${playerId}
    `;
  }

  // ---- Player Turns ----

  async insertPlayerTurn(
    gameInstanceId: string,
    playerId: string,
    turnNumber: number,
    playerResponse: string | null,
    isCorrect: boolean | null,
    responseTimeSeconds: number | null,
    responseAudioUrl?: string
  ): Promise<PlayerTurn> {
    const rows = await this.sql`
      INSERT INTO player_turns (game_instance_id, participant_id, turn_number, content_id, player_response, is_correct, response_time_seconds, response_audio_url)
      VALUES (${gameInstanceId}, ${playerId}, ${turnNumber}, ${'unknown'}, ${playerResponse}, ${isCorrect}, ${responseTimeSeconds}, ${responseAudioUrl ?? null})
      RETURNING *
    `;
    return rows[0] as PlayerTurn;
  }

  // ---- Payouts ----

  async insertPayout(gameInstanceId: string, playerId: string, amount: number, status: string = 'pending'): Promise<Payout> {
    const rows = await this.sql`
      INSERT INTO payouts (game_instance_id, player_id, amount, status)
      VALUES (${gameInstanceId}, ${playerId}, ${amount}, ${status})
      RETURNING *
    `;
    return rows[0] as Payout;
  }

  async updatePayoutStatus(payoutId: string, status: string, stripeTransferId?: string): Promise<void> {
    await this.sql`
      UPDATE payouts
      SET status = ${status}, stripe_transfer_id = ${stripeTransferId ?? null}, paid_at = ${status === 'paid' ? new Date().toISOString() : null}
      WHERE id = ${payoutId}
    `;
  }

  // ---- Utility ----

  async healthCheck(): Promise<boolean> {
    try {
      const rows = await this.sql`SELECT 1 as ok`;
      return rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }
}
