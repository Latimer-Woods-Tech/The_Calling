# ADR_LOG.md — Architecture Decision Records

> **The Calling Voice Game Platform** | Last Updated: 2026-02-24

---

## ADR-001: Platform-First Architecture with Pluggable Game Handlers
**Date:** 2026-02-24
**Status:** Accepted

**Context:** We needed to decide whether to build a monolithic trivia game or a generic platform that supports multiple game types. Building only trivia would be faster initially but would require major refactoring to add new game types later.

**Decision:** Build a game-agnostic platform core with a pluggable `GameHandler` interface. Each game type implements this interface independently. The platform handles player management, call orchestration, elimination, and payouts — the handler only manages game-specific logic (questions, validation, turn structure).

**Consequences:**
- (+) New game types can be added in 1-2 days by implementing the GameHandler interface
- (+) Platform code never needs to change when adding games
- (+) Clear separation of concerns
- (-) Slightly more upfront development time (extra abstraction layer)
- (-) Interface must be designed carefully — changes affect all handlers

**Alternatives Considered:**
1. Monolithic trivia app — faster to build, impossible to extend
2. Microservices per game type — too complex for initial scale
3. Configuration-driven games — not flexible enough for diverse mechanics

---

## ADR-002: Outbound Calls via Telnyx (Not Conference Bridges)
**Date:** 2026-02-24
**Status:** Accepted

**Context:** We needed to decide how to connect players to a game. Options were: (a) outbound calls to each player individually, (b) conference bridge where all players dial in, or (c) hybrid approach.

**Decision:** Use Telnyx outbound calls to each player. The platform initiates individual calls to each registered player at game start time. Each call is controlled independently via Telnyx call control API.

**Consequences:**
- (+) Full control over each player's audio experience (individual TTS, individual recording)
- (+) Can eliminate players by simply hanging up their call
- (+) Players don't need to remember dial-in numbers
- (+) Per-player recording for answer transcription
- (-) More expensive (per-call cost × number of players)
- (-) Higher complexity managing N simultaneous calls
- (-) Need to handle call failures individually

**Alternatives Considered:**
1. Conference bridge — simpler but can't individually control/record players
2. WebRTC browser-based — requires app, not phone-only
3. SIP trunking — overkill for initial scale

---

## ADR-003: Neon Postgres for Persistent Data + Upstash Redis for Game State
**Date:** 2026-02-24
**Status:** Accepted

**Context:** Game sessions need both persistent business data (players, payments, results) and ephemeral real-time state (alive players, current turn, answers). A single database cannot optimally serve both needs.

**Decision:** Use Neon Postgres (serverless) for all persistent/business data and Upstash Redis (serverless) for ephemeral game state. Redis keys expire with 24-hour TTL. Postgres stores the permanent record.

**Consequences:**
- (+) Redis provides sub-millisecond reads during gameplay
- (+) Postgres provides ACID transactions for payments and records
- (+) Both are serverless — no infrastructure management
- (+) Cost-efficient — only pay for what we use
- (-) Data consistency between two stores requires careful design
- (-) Redis data loss risk (mitigated by TTL-based design and DB as source of truth)

**Alternatives Considered:**
1. Postgres only — too slow for real-time game state
2. Redis only — no ACID for payments, no relational queries
3. Cloudflare KV — eventually consistent, not suitable for game state
4. Cloudflare D1 — SQLite-based, less mature than Neon

---

## ADR-004: Cloudflare Workers for Compute
**Date:** 2026-02-24
**Status:** Accepted

**Context:** Need a serverless compute platform that can handle webhook callbacks from Telnyx/Stripe/Deepgram, serve admin API, and orchestrate game logic.

**Decision:** Deploy all backend logic as Cloudflare Workers. Use Worker-to-Worker communication for internal routing. Leverage Cloudflare's global edge network for low-latency webhook processing.

**Consequences:**
- (+) Global edge deployment — webhooks processed at nearest PoP
- (+) No server management, auto-scaling
- (+) Generous free tier, pay-per-request pricing
- (+) Built-in DDoS protection
- (-) 30ms CPU time limit per request (need to design for this)
- (-) No long-running processes — game loops must be event-driven
- (-) Cold start latency possible

**Alternatives Considered:**
1. AWS Lambda — more expensive, slower cold starts
2. Vercel Functions — limited runtime, less control
3. Self-hosted Node.js — operational burden, scaling complexity
4. Deno Deploy — less mature ecosystem

---

## ADR-005: Deepgram as Primary STT with AssemblyAI Fallback
**Date:** 2026-02-24
**Status:** Accepted

**Context:** Need reliable speech-to-text for transcribing player answers during live games. Latency must be under 5 seconds for good UX. Accuracy must be high for single-word/short-phrase answers.

**Decision:** Use Deepgram as primary STT service. Implement AssemblyAI as automatic fallback if Deepgram fails or returns low-confidence results.

**Consequences:**
- (+) Deepgram offers real-time streaming transcription with low latency
- (+) Fallback prevents single-point-of-failure for core gameplay feature
- (+) Can A/B test accuracy between providers
- (-) Two STT integrations to maintain
- (-) Fallback adds latency when triggered

**Alternatives Considered:**
1. Deepgram only — no redundancy
2. AssemblyAI only — higher latency for real-time use
3. Google Cloud Speech — more expensive, complex auth
4. Whisper (self-hosted) — requires GPU, can't run on Cloudflare Workers

---

## ADR-006: Stripe for Payments and Payouts
**Date:** 2026-02-24
**Status:** Accepted

**Context:** Platform needs to collect entry fees and distribute prizes. Need PCI-compliant payment processing with payout capabilities.

**Decision:** Use Stripe for both collecting entry fees (Payment Intents) and distributing prizes (Stripe Transfers to Connected Accounts via Stripe Connect).

**Consequences:**
- (+) Industry-standard PCI compliance
- (+) Stripe Connect handles payout KYC/tax requirements
- (+) Webhook-based reconciliation
- (+) Test mode for development
- (-) Stripe Connect onboarding is complex for winners
- (-) Processing fees reduce prize pool slightly

**Alternatives Considered:**
1. PayPal — harder to automate, higher fees for payouts
2. Direct bank transfers — regulatory nightmare
3. Crypto payouts — too niche for target audience

---

## ADR-007: Event-Driven Game Loop Architecture
**Date:** 2026-02-24
**Status:** Accepted

**Context:** Cloudflare Workers have a 30ms CPU time limit per request. Traditional game loops (while loops running continuously) are impossible. We need an alternative execution model.

**Decision:** Implement the game loop as an event-driven state machine. Each webhook callback (call answered, recording complete, transcription ready) triggers the next step. Redis stores the current game state between events. Cloudflare Durable Objects or scheduled workers can handle time-based transitions (answer deadlines).

**Consequences:**
- (+) Fits within Cloudflare Worker execution model
- (+) Naturally resilient — state persists in Redis between events
- (+) Easy to debug — each event is a discrete, logged request
- (-) More complex than a simple while loop
- (-) Requires careful state machine design
- (-) Race conditions possible with concurrent webhooks

**Alternatives Considered:**
1. Long-running server process — not compatible with Cloudflare Workers
2. Cloudflare Durable Objects only — more expensive, less flexible
3. External orchestrator (Step Functions equivalent) — over-engineered for current scale

---

## TEMPLATE FOR NEW ADRs

```
## ADR-XXX: [Decision Title]
Date: YYYY-MM-DD
Status: [Proposed | Accepted | Deprecated | Superseded]

Context: Why we needed to make this decision
Decision: What we decided
Consequences: Implications and trade-offs
Alternatives Considered: Other options we evaluated
```
