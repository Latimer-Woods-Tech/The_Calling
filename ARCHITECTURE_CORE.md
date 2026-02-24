# ARCHITECTURE_CORE.md — The Calling Voice Game Platform

> **Living Document** | Version: 1.0.0 | Last Updated: 2026-02-24
> **Architecture Agent** | Lead Architect: Opus 4 Orchestrator

---

## 1. SYSTEM OVERVIEW

**The Calling** is a voice-based game platform that enables real-time, multi-player phone games with automated call orchestration, speech recognition, voice synthesis, and prize payouts.

### 1.1 Vision Statement
Build a production-grade, extensible voice game platform where players join via phone call, interact through voice, and compete for cash prizes — starting with trivia as the proof-of-concept game type.

### 1.2 Key Principles
- **Platform-first architecture** — Game-agnostic core with pluggable game handlers
- **Voice-native** — All player interaction via phone calls (no app required)
- **Real-time** — Sub-second response processing during live games
- **Fault-tolerant** — Graceful degradation when external services fail
- **Scalable** — Support 100+ concurrent players per game session
- **Enterprise-grade** — Full observability, traceability, and documentation

### 1.3 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    THE CALLING PLATFORM                   │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Admin API   │  │  Player API   │  │  Webhook API  │   │
│  │  (Cloudflare) │  │  (Cloudflare) │  │  (Cloudflare) │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                  │                  │            │
│  ┌──────▼──────────────────▼──────────────────▼───────┐   │
│  │              VoiceGamePlatform (Core)                │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐  │   │
│  │  │   Player     │ │    Call       │ │  Elimination │  │   │
│  │  │   Manager    │ │  Orchestrator │ │    Engine    │  │   │
│  │  └─────────────┘ └──────────────┘ └─────────────┘  │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐  │   │
│  │  │   Turn       │ │   Payment    │ │   Payout     │  │   │
│  │  │   Manager    │ │   Processor  │ │   Engine     │  │   │
│  │  └─────────────┘ └──────────────┘ └─────────────┘  │   │
│  └────────────────────────┬───────────────────────────┘   │
│                           │                                │
│  ┌────────────────────────▼───────────────────────────┐   │
│  │           Game Handler System (Pluggable)           │   │
│  │  ┌──────────────┐  ┌────────────┐  ┌────────────┐  │   │
│  │  │ TriviaHandler │  │ WordChain  │  │  Riddle    │  │   │
│  │  │  (Week 1-2)   │  │  (Week 3)  │  │  (Week 4)  │  │   │
│  │  └──────────────┘  └────────────┘  └────────────┘  │   │
│  └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

External Services:
┌───────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐
│  Telnyx    │ │ Deepgram │ │ ElevenLabs │ │  Stripe  │
│  (Voice)   │ │  (STT)   │ │   (TTS)    │ │(Payments)│
└───────────┘ └──────────┘ └────────────┘ └──────────┘
┌───────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐
│  Neon DB   │ │ Upstash  │ │  Resend    │ │  Sentry  │
│ (Postgres) │ │ (Redis)  │ │  (Email)   │ │(Monitor) │
└───────────┘ └──────────┘ └────────────┘ └──────────┘
```

---

## 2. COMPONENT DIAGRAMS

### 2.1 Core Platform Components

| Component | Responsibility | Technology |
|-----------|----------------|------------|
| **VoiceGamePlatform** | Top-level orchestrator; manages game lifecycle | TypeScript / Cloudflare Worker |
| **PlayerManager** | Registration, auth, profile management | Neon Postgres |
| **CallOrchestrator** | Initiate/manage/hangup phone calls | Telnyx API |
| **TurnManager** | Coordinate turn-by-turn gameplay | Redis + Handler |
| **EliminationEngine** | Track alive/eliminated players, announce eliminations | Redis + Telnyx |
| **PaymentProcessor** | Collect entry fees | Stripe |
| **PayoutEngine** | Distribute prizes to winners | Stripe Connect |
| **GameHandlerFactory** | Instantiate correct handler for game type | TypeScript |

### 2.2 Game Handler Interface

The `GameHandler` interface is the **contract** that all game types must implement.
Handlers are **stateless between requests** — all game state lives in Redis and Postgres.

**File:** `src/core/game-handler.ts`

```typescript
interface GameHandler {
  readonly gameType: string;
  initialize(gameInstanceId: string, config: Record<string, any>): Promise<void>;
  getNextTurn(): Promise<Turn | null>;
  executeTurn(turn: Turn): Promise<TurnResult>;
  validateResponse(response: PlayerResponse, turn: Turn): Promise<ValidationResult>;
  determineEliminations(turnResult: TurnResult, responses: PlayerResponse[]): Promise<string[]>;
  isGameOver(): Promise<boolean>;
  finalizeGame(): Promise<GameResult>;
}
```

| Method | Responsibility | Called When |
|--------|----------------|------------|
| `initialize` | Load content from DB, seed Redis state, register alive players | Once after all players' calls connect |
| `getNextTurn` | Return next question/prompt; `null` when exhausted | Start of each round |
| `executeTurn` | Set answer deadline, prepare turn-specific state | After question is spoken to players |
| `validateResponse` | Check if a player's spoken answer is correct (exact + AI fuzzy) | Per player response |
| `determineEliminations` | Identify who answered wrong or timed out; eliminate from Redis + DB | After answer deadline passes |
| `isGameOver` | Check termination conditions (≤1 player, no more content) | After each elimination round |
| `finalizeGame` | Determine winners, update DB status, cleanup Redis | Once after game loop exits |

### 2.2.1 TriviaHandler Implementation

**File:** `src/handlers/trivia-handler.ts` | **Type:** `elimination_trivia`

The proof-of-concept handler implementing voice-based trivia with progressive elimination.

**Key Design Decisions:**
- Questions stored in Neon `game_content` table as `content_data` JSONB: `{ question, correct_answer, alternatives, category }`
- `initialize()` transforms `GameContent` → `TriviaQuestion` objects (shuffles options, extracts nested JSONB)
- Answer validation: exact match → option-letter match → AI fuzzy match (OpenAI gpt-4o-mini)
- No response = elimination (timeout handling)
- Game ends when ≤1 player remains or all questions exhausted

**Validation Pipeline:**
```
Player speaks answer → STT transcription (Deepgram/AssemblyAI)
    │
    ├── Exact string match against correct_answer? → ✅ correct
    │
    ├── Option letter match (A/B/C/D)? → ✅ correct
    │
    ├── Confidence < 0.8? → OpenAI AI fuzzy validation
    │   └── Returns { isCorrect, confidence, reasoning }
    │
    └── No match → ❌ incorrect → eliminated
```

**10-Player Simulation Results (validated):**
- Progressive elimination: 10 → 9 → 8 → 7 → ... → 1 winner
- Full game completes in ~9 rounds with 20 questions available
- Handles: all-correct (no eliminations), all-wrong (mass elimination), timeouts
- End conditions: `last_player_standing`, `all_questions_exhausted`

### 2.2.2 GameHandlerFactory

**File:** `src/handlers/factory.ts`

Registry-based factory pattern. Maps game type strings to handler constructors.

```typescript
const HANDLER_REGISTRY = {
  trivia: TriviaHandler,
  elimination_trivia: TriviaHandler,
  // Future: word_chain: WordChainHandler, riddle: RiddleHandler
};
```

Adding a new game type requires:
1. Implement `GameHandler` interface
2. Register in `HANDLER_REGISTRY`
3. Add game template + content to database
4. Deploy — no platform code changes needed

### 2.2.3 VoiceGamePlatform Orchestrator

**File:** `src/core/platform.ts`

The platform is **game-agnostic** — it delegates all game logic to the handler while managing:
- Player registration + payment (Stripe)
- Call orchestration (Telnyx)
- Voice I/O (TTS via ElevenLabs, STT via Deepgram)
- Game loop coordination
- Prize distribution
- Error tracking (Sentry)

**Key method — `runFullGameLoop`:**
```
initialize handler → loop { getNextTurn → speak → record → collect → 
  determineEliminations → notify eliminated } → finalizeGame → payouts
```

Supports both:
- **Webhook-driven** (production): discrete steps triggered by Telnyx/Stripe events
- **Synchronous** (testing): `runFullGameLoop()` with injectable answer collectors

### 2.3 Data Layer

| Store | Purpose | Data Types |
|-------|---------|------------|
| **Neon Postgres** | Persistent data, business records | Players, games, payments, content, results |
| **Upstash Redis** | Ephemeral game state, real-time data | Active games, alive players, answers, call mappings |

---

## 3. DATA FLOW DIAGRAMS

### 3.1 Game Lifecycle Flow

```
1. Admin creates game instance (POST /admin/games/create)
         │
2. Players register + pay entry fee (Stripe)
         │
3. Scheduled time arrives → Platform starts game
         │
4. Platform calls all registered players (Telnyx outbound)
         │
5. Game handler takes over:
   ┌─────────────────────────────────────────┐
   │  GAME LOOP:                              │
   │  a. getNextTurn() → question/prompt      │
   │  b. speakToAllCalls() → TTS via Telnyx   │
   │  c. Record responses → Telnyx recording  │
   │  d. Transcribe → Deepgram STT            │
   │  e. validateResponse() → correct/wrong   │
   │  f. determineEliminations()              │
   │  g. eliminatePlayers() → hang up losers  │
   │  h. Repeat until isGameOver()            │
   └─────────────────────────────────────────┘
         │
6. finalizeGame() → determine winners
         │
7. payoutWinners() → Stripe transfers
         │
8. cleanupGame() → flush Redis, update DB
```

### 3.2 Call Flow (Per Player)

```
Telnyx outbound call → Player answers phone
    │
    ├── Webhook: call.answered → Store call_control_id in Redis
    │
    ├── Platform speaks question (Telnyx TTS or ElevenLabs audio)
    │
    ├── Start recording (Telnyx record_start)
    │
    ├── Player speaks answer
    │
    ├── Stop recording (Telnyx record_stop)
    │
    ├── Webhook: recording.completed → Get audio URL
    │
    ├── Send audio to Deepgram → Get transcription
    │
    ├── Store answer in Redis (game:{id}:turn:{n}:answers)
    │
    ├── Validate answer → correct/incorrect
    │
    └── If incorrect → Speak elimination message → Hang up
```

### 3.3 Payment Flow

```
Player registers for game
    │
    ├── Stripe Payment Intent created ($1.00 entry fee)
    │
    ├── Player confirms payment
    │
    ├── Webhook: payment_intent.succeeded
    │
    ├── Update game_participants.payment_status = 'paid'
    │
    └── Player added to game roster
    
Game ends → Winner determined
    │
    ├── Calculate prize: entry_fee × num_players × (1 - house_cut)
    │
    ├── Stripe Transfer to winner's connected account
    │
    ├── Record in payouts table
    │
    └── Send confirmation email (Resend)
```

---

## 4. INTEGRATION PATTERNS

### 4.1 External Service Integration Matrix

| Service | Protocol | Auth | Rate Limits | Fallback |
|---------|----------|------|-------------|----------|
| **Telnyx** | REST + WebSocket | API Key | 1000 calls/min | Queue + retry |
| **Deepgram** | REST + WebSocket | API Key | Varies by plan | AssemblyAI fallback |
| **ElevenLabs** | REST | API Key | Varies by plan | Telnyx native TTS |
| **Stripe** | REST | Secret Key | 100 req/sec | Queue + retry |
| **Resend** | REST | API Key | Varies by plan | Log + retry |
| **OpenAI** | REST | API Key | Varies by plan | Cached responses |
| **Neon** | PostgreSQL | Connection string | Connection pooling | Read replica |
| **Upstash** | REST + Redis protocol | Token | Varies by plan | In-memory fallback |
| **Sentry** | REST | DSN | Unlimited | Console logging |

### 4.2 Webhook Architecture

All external webhooks route through Cloudflare Workers:

```
Telnyx webhooks  → POST /webhooks/telnyx/{gameId}
Stripe webhooks  → POST /webhooks/stripe
Deepgram events  → POST /webhooks/deepgram/{gameId}
```

### 4.3 Error Handling Strategy

Every external call follows this pattern:
1. **Try** primary service
2. **Retry** up to 3 times with exponential backoff
3. **Fallback** to alternative service (if available)
4. **Circuit break** if failure rate > 50% in 60s window
5. **Log** to Sentry + structured logging
6. **Graceful degradation** — never crash the game loop

---

## 5. SECURITY MODEL

### 5.1 Authentication & Authorization

| Layer | Mechanism |
|-------|-----------|
| Admin API | API Key + IP allowlist |
| Player API | Phone number verification via Telnyx |
| Webhook API | Signature verification (Telnyx, Stripe) |
| Database | SSL-required connection, connection pooling |
| Redis | Token-based auth, TLS |

### 5.2 Secrets Management

- All secrets stored in Cloudflare Worker environment variables
- Never committed to source control
- Rotated quarterly
- Source of truth: SECRETS-THECALLING.ini (local only)

### 5.3 Data Protection

- PII (phone numbers, emails) encrypted at rest in Neon
- Payment data handled entirely by Stripe (PCI compliance)
- Call recordings auto-deleted after 24 hours
- Redis game state auto-expires via TTL

---

## 6. SCALABILITY CONSIDERATIONS

### 6.1 Current Capacity Targets

| Metric | Target | Bottleneck |
|--------|--------|------------|
| Concurrent players per game | 100 | Telnyx concurrent calls |
| Concurrent games | 5 | Redis memory + worker CPU |
| Questions per game | 20-50 | Content database |
| Response processing time | < 5 seconds | Deepgram transcription |
| Call setup time | < 10 seconds for all players | Telnyx parallelism |

### 6.2 Scaling Strategy

| Phase | Players/Game | Approach |
|-------|-------------|----------|
| Launch | 10-50 | Single Cloudflare Worker |
| Growth | 50-200 | Worker per game, Redis sharding |
| Scale | 200-1000 | Dedicated Telnyx SIP trunk, multiple workers |

### 6.3 Key Bottlenecks

1. **Telnyx concurrent call limit** — Need to confirm account limits
2. **Deepgram transcription latency** — Batch vs real-time tradeoff
3. **Redis memory** — Game state for 100 players × 20 turns
4. **Cloudflare Worker CPU time** — 30ms wall-clock limit per request

---

## 7. TOGAF COMPLIANCE MAPPING

### 7.1 Architecture Development Method (ADM) Phases

| ADM Phase | The Calling Mapping | Status |
|-----------|-------------------|--------|
| **Preliminary** | Establish architecture governance, select TOGAF as framework, define stakeholders | ✅ Complete |
| **Phase A: Vision** | Voice game platform vision — players join via phone, compete for cash prizes | ✅ Complete |
| **Phase B: Business Architecture** | Game business model: entry fees → prize pool → house cut; multiple game types | ✅ Complete |
| **Phase C: Information Systems** | Database schema (7 tables), Redis state model, API contracts (GameHandler interface) | ✅ Complete |
| **Phase D: Technology** | Cloudflare Workers, Neon Postgres, Upstash Redis, Telnyx, Deepgram, ElevenLabs, Stripe | ✅ Complete |
| **Phase E: Opportunities** | Platform extensibility via GameHandler; new game types in 1-2 days | ✅ Complete |
| **Phase F: Migration** | 6-phase build plan (10 days), incremental deployment | 🔄 In Progress |
| **Phase G: Governance** | ADR log, risk register, issues log, backlog tracking | 🔄 In Progress |
| **Phase H: Change Management** | Lessons learned, architecture review process | 🔄 In Progress |

### 7.2 Architecture Repository

| Repository Component | Artifact | Status |
|----------------------|----------|--------|
| Architecture Landscape | ARCHITECTURE_CORE.md | ✅ Current document |
| Standards Information Base | TypeScript, Cloudflare Workers, PostgreSQL, Redis | ✅ Defined |
| Reference Library | GameHandler interface, webhook patterns, error handling | ✅ Defined |
| Governance Log | ADR_LOG.md | 🔄 In Progress |

### 7.3 Architecture Building Blocks (ABBs)

| ABB | Type | Reusability |
|-----|------|-------------|
| VoiceGamePlatform | Core Component | Foundation for all games |
| GameHandler Interface | Contract | Implemented per game type |
| CallOrchestrator | Component | Reusable across all games |
| StateManager (Redis) | Component | Reusable across all games |
| PaymentProcessor | Component | Reusable across all games |
| WebhookRouter | Component | Reusable across all integrations |
| ErrorHandler | Cross-cutting | Applied everywhere |
| MonitoringHarness | Cross-cutting | Applied everywhere |

---

## 8. DATABASE SCHEMA

### 8.1 Entity Relationship Diagram

```
game_templates (1) ──── (N) game_instances
game_templates (1) ──── (N) game_content
game_instances (1) ──── (N) game_participants
players        (1) ──── (N) game_participants
game_participants (1) ── (N) player_turns
game_content   (1) ──── (N) player_turns
game_instances (1) ──── (N) payouts
players        (1) ──── (N) payouts
```

### 8.2 Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `game_templates` | Game type definitions | type, default_config, mechanics |
| `game_instances` | Scheduled/active games | template_id, scheduled_at, status, entry_fee, prize_structure |
| `game_content` | Questions/prompts/challenges | template_id, content_type, content_data, category, difficulty |
| `players` | Player profiles | phone_number, stripe_account_id, stats |
| `game_participants` | Game roster + results | game_instance_id, player_id, payment_status, status, placement |
| `player_turns` | Per-turn responses | participant_id, turn_number, content_id, player_response, is_correct |
| `payouts` | Prize distributions | game_instance_id, player_id, amount, stripe_transfer_id |

---

## 9. REDIS STATE MODEL

### 9.1 Key Patterns

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `game:{id}:status` | String | 24h | Game state (waiting/active/finished) |
| `game:{id}:alive_players` | Set | 24h | Currently active player IDs |
| `game:{id}:eliminated_players` | Set | 24h | Eliminated player IDs |
| `game:{id}:player:{pid}:call` | String | 24h | Player → call_control_id mapping |
| `game:{id}:questions` | String (JSON) | 24h | Ordered list of question IDs |
| `game:{id}:current_question` | String (int) | 24h | Current question index |
| `game:{id}:turn:{n}:answers` | Hash | 24h | Player answers for turn N |
| `game:{id}:answer_deadline` | String (timestamp) | 24h | Answer submission deadline |

### 9.2 Atomic Operations

- Player elimination: SREM from alive, SADD to eliminated (pipeline)
- Answer submission: HSET with NX (prevent overwrite)
- Turn advancement: INCR for question index

---

## 10. DEPLOYMENT ARCHITECTURE

```
Cloudflare Edge Network
├── Worker: api-gateway (routes requests)
├── Worker: game-engine (core game logic)
├── Worker: webhook-handler (processes Telnyx/Stripe/Deepgram callbacks)
└── Pages: admin-dashboard (game management UI)

Data Layer
├── Neon Postgres (us-east-1) — persistent data
└── Upstash Redis (us-east-1) — ephemeral game state

External Services
├── Telnyx — voice calls (outbound + webhooks)
├── Deepgram — speech-to-text transcription
├── ElevenLabs — text-to-speech (premium voices)
├── Stripe — payments + payouts
├── Resend — email notifications
├── OpenAI — AI-powered features (question generation, answer fuzzy-matching)
└── Sentry — error tracking + performance monitoring
```

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-24 | Architecture Agent | Initial architecture document created from THECALLING_ARCHITECTURE.ts review |
| 1.1.0 | 2026-02-24 | Backend Agent | Updated §2.2 with actual GameHandler interface, TriviaHandler implementation, Factory pattern, Platform orchestrator docs. Added §2.2.1-2.2.3. |
