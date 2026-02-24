// ============================================================================
// THE CALLING - Type Definitions
// ============================================================================

// ---- Environment Bindings ----
export interface Env {
  ENVIRONMENT: string;
  NEON_DATABASE_URL: string;
  TELNYX_API_KEY: string;
  TELNYX_CONNECTION_ID: string;
  TELNYX_PHONE_NUMBER: string;
  DEEPGRAM_API_KEY: string;
  ASSEMBLYAI_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  OPENAI_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  REDIS_ENDPOINT: string;
  REDIS_API_KEY: string;
  SENTRY_DSN: string;
  RESEND_API_KEY: string;
  WEBHOOK_BASE_URL: string;
  ADMIN_API_KEY: string;
}

// ---- Database Models ----
export interface GameTemplate {
  id: string;
  name: string;
  type: string;
  description: string | null;
  default_config: Record<string, any> | null;
  mechanics: Record<string, any> | null;
  icon_url: string | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
}

export interface GameInstance {
  id: string;
  template_id: string;
  name: string | null;
  description: string | null;
  scheduled_at: string;
  started_at: string | null;
  ended_at: string | null;
  status: GameStatus;
  config: Record<string, any> | null;
  entry_fee: number;
  max_players: number;
  prize_structure: PrizeStructure | null;
  total_players: number;
  total_revenue: number;
  total_prize_paid: number;
  created_at: string;
}

export type GameStatus = 'scheduled' | 'registering' | 'starting' | 'active' | 'paused' | 'finished' | 'cancelled';

export interface PrizeStructure {
  winner_amount: number;
  runner_up_amount?: number;
  house_cut: number;
}

export interface GameContent {
  id: string;
  template_id: string;
  content_type: string;
  content_data: Record<string, any>;
  category: string | null;
  difficulty: string | null;
  tags: string[] | null;
  times_used: number;
  times_correct: number;
  avg_response_time: number | null;
  is_active: boolean;
  created_at: string;
}

export interface Player {
  id: string;
  phone_number: string;
  name: string | null;
  email: string | null;
  stripe_account_id: string | null;
  total_games_played: number;
  total_games_won: number;
  total_spent: number;
  total_winnings: number;
  created_at: string;
}

export interface GameParticipant {
  id: string;
  game_instance_id: string;
  player_id: string;
  payment_status: PaymentStatus;
  payment_intent_id: string | null;
  paid_at: string | null;
  amount_paid: number | null;
  status: ParticipantStatus;
  score: number;
  strikes: number;
  turns_taken: number;
  correct_responses: number;
  placement: number | null;
  prize_amount: number;
  eliminated_at: string | null;
  elimination_reason: string | null;
  created_at: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed';
export type ParticipantStatus = 'registered' | 'active' | 'eliminated' | 'winner' | 'disconnected';

export interface PlayerTurn {
  id: string;
  game_instance_id: string;
  participant_id: string;
  turn_number: number;
  content_id: string;
  player_response: string | null;
  response_audio_url: string | null;
  response_time_seconds: number | null;
  is_correct: boolean | null;
  is_valid: boolean | null;
  points_earned: number;
  created_at: string;
}

export interface Payout {
  id: string;
  game_instance_id: string;
  player_id: string;
  amount: number;
  status: PayoutStatus;
  stripe_transfer_id: string | null;
  created_at: string;
  paid_at: string | null;
}

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

// ---- Game Handler Types ----
export interface Turn {
  turnNumber: number;
  questionText: string;
  options?: string[];
  correctAnswer: string;
  timeLimit: number;
  metadata?: Record<string, any>;
}

export interface TurnResult {
  turnNumber: number;
  responses: PlayerResponse[];
  eliminatedPlayerIds: string[];
  correctAnswer: string;
  questionText: string;
}

export interface PlayerResponse {
  playerId: string;
  answer: string;
  timestamp: number;
  confidence?: number;
  audioUrl?: string;
}

export interface ValidationResult {
  isCorrect: boolean;
  confidence: number;
  details: string;
}

export interface Winner {
  playerId: string;
  placement: number;
  prizeAmount: number;
}

export interface GameResult {
  gameInstanceId: string;
  winners: Winner[];
  totalRounds: number;
  totalPlayers: number;
  endReason: string;
}

// ---- Trivia-Specific Types ----
export interface TriviaConfig {
  questions_per_game?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  time_limit_seconds?: number;
  categories?: string[];
}

export interface TriviaQuestion {
  id: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  category: string;
  difficulty: string;
}

// ---- Call Types ----
export interface ActiveCall {
  callControlId: string;
  playerId: string;
  gameId: string;
  status: 'ringing' | 'answered' | 'active' | 'hangup';
  answeredAt?: number;
}

// ---- Webhook Payloads ----
export interface TelnyxWebhookPayload {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: {
      call_control_id?: string;
      call_leg_id?: string;
      client_state?: string;
      recording_urls?: { mp3?: string; wav?: string };
      digit?: string;
      [key: string]: any;
    };
    record_type?: string;
  };
  meta?: Record<string, any>;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, any>;
  };
}

// ---- API Request/Response Types ----
export interface CreateGameRequest {
  templateType: string;
  name: string;
  scheduledAt: string;
  entryFee: number;
  maxPlayers: number;
  houseCut: number;
  config?: Record<string, any>;
}

export interface RegisterPlayerRequest {
  phoneNumber: string;
  name?: string;
  email?: string;
  gameInstanceId: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
