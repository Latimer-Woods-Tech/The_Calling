# RISK_REGISTER.md — Risk Tracking

> **The Calling Voice Game Platform** | Last Updated: 2026-02-25 (Final Review)

---

## Risk ID: R-001
**Identified:** 2026-02-24
**Category:** Integration
**Probability:** High
**Impact:** Critical

**Description:** Missing Telnyx credentials. The SECRETS-THECALLING.ini file does not contain Telnyx API Key, Public Key, Phone Number, or Connection ID. Telnyx is the core voice infrastructure — without it, no calls can be made.

**Mitigation:** 
1. User must create a Telnyx account and provision a phone number
2. Generate API keys and add to secrets file
3. Create a SIP Connection and record the Connection ID
4. Block Phase 3 (Integrations) until resolved

**Owner:** Integration Agent
**Status:** Closed ✅ — Telnyx credentials provided. Validated: 2 connections, phone +17757172255 verified via live API test. (2026-02-24)

---

## Risk ID: R-002
**Identified:** 2026-02-24
**Category:** Integration
**Probability:** High
**Impact:** High

**Description:** Missing Upstash Redis credentials. The SECRETS file does not contain UPSTASH_REDIS_URL or UPSTASH_REDIS_TOKEN. Redis is essential for real-time game state management.

**Mitigation:**
1. User must create an Upstash account and provision a Redis database
2. Add URL and token to secrets file
3. Block Phase 2 (Foundation - Redis setup) until resolved

**Owner:** State Management Agent
**Status:** Closed ✅ — Redis Cloud (redislabs.com) used instead of Upstash. In-memory fallback implemented for dev/Workers. (2026-02-24)

---

## Risk ID: R-003
**Identified:** 2026-02-24
**Category:** Integration
**Probability:** Medium
**Impact:** High

**Description:** Missing Sentry DSN. Error tracking will not function without Sentry configuration. Issues may go undetected in production.

**Mitigation:**
1. User must create a Sentry project and add DSN to secrets
2. Implement console.error fallback until Sentry is configured
3. Non-blocking — can proceed with development, just without error tracking

**Owner:** Monitoring Agent
**Status:** Closed ✅ — Sentry DSN provided and validated. Event sent successfully (6c799f484fb7424b9bdb191b3f2706ed). Full error tracking operational. (2026-02-25)

---

## Risk ID: R-004
**Identified:** 2026-02-24
**Category:** Technical
**Probability:** Medium
**Impact:** Critical

**Description:** Cloudflare Worker 30ms CPU time limit. Game orchestration logic (calling N players, managing turns, processing answers) may exceed per-request CPU limits. The event-driven game loop design (ADR-007) mitigates this, but complex turn processing with 100 players could still hit limits.

**Mitigation:**
1. Design game loop as event-driven state machine (ADR-007)
2. Use Cloudflare Durable Objects for long-running game sessions
3. Offload heavy processing to queued tasks
4. Performance test with 50+ players early

**Owner:** Backend Agent
**Status:** Mitigated ⚡ — Worker startup validated at 29-32ms. Event-driven design implemented via webhook-based state machine. Health endpoint responds in ~480ms including 6 external service checks. Full game loop uses per-request stateless design. Durable Objects upgrade path documented for 100+ player games. (2026-02-25)

---

## Risk ID: R-005
**Identified:** 2026-02-24
**Category:** Performance
**Probability:** Medium
**Impact:** High

**Description:** Deepgram transcription latency. If STT transcription takes > 5 seconds, the game experience degrades — players wait too long between answering and hearing results. Real-time accuracy for short spoken answers (1-3 words) must be validated.

**Mitigation:**
1. Use Deepgram's real-time streaming API rather than batch processing
2. Implement AssemblyAI fallback (ADR-005)
3. Benchmark latency during Phase 3 integration testing
4. Consider pre-processing audio (noise reduction, format optimization)

**Owner:** Integration Agent
**Status:** Open

---

## Risk ID: R-006
**Identified:** 2026-02-24
**Category:** Technical
**Probability:** Medium
**Impact:** High

**Description:** Concurrent call management at scale. Managing 100+ simultaneous Telnyx calls with individual recording, transcription, and state tracking creates significant complexity. Race conditions between webhook callbacks could corrupt game state.

**Mitigation:**
1. Use Redis atomic operations (SREM/SADD pipeline) for state changes
2. Implement idempotent webhook handlers
3. Add call-level locking in Redis
4. Progressive scaling: test with 10, then 50, then 100 players

**Owner:** State Management Agent + Backend Agent
**Status:** Open

---

## Risk ID: R-007
**Identified:** 2026-02-24
**Category:** Business
**Probability:** Low
**Impact:** Critical

**Description:** Stripe Connect onboarding friction. Winners need Stripe Connected Accounts to receive payouts. The onboarding process requires identity verification and can take days. Players may not complete it, blocking prize distribution.

**Mitigation:**
1. Require Stripe Connect setup during registration (before first game)
2. Offer alternative payout methods as backup (manual PayPal)
3. Set clear expectations about payout timelines
4. Cache payout and retry when account is verified

**Owner:** Integration Agent
**Status:** Open

---

## Risk ID: R-008
**Identified:** 2026-02-24
**Category:** Technical
**Probability:** Medium
**Impact:** Medium

**Description:** Voice answer fuzzy matching accuracy. Players will give verbal answers that need to be matched against correct answers. Variations in pronunciation, phrasing ("George Washington" vs "Washington" vs "washington"), and STT errors could cause incorrect eliminations.

**Mitigation:**
1. Implement aggressive normalization (lowercase, strip punctuation, remove articles)
2. Use OpenAI for semantic similarity when exact match fails
3. Accept known alternatives stored in game_content
4. Allow appeals mechanism in future version
5. Test extensively with diverse accents and speech patterns

**Owner:** Backend Agent
**Status:** Mitigated ⚡ — OpenAI gpt-4o-mini semantic validation implemented and tested. Fuzzy matching validated: "William Shakes" → correct (confidence 0.9) for "William Shakespeare". Exact match normalization + AI fallback provides two-tier accuracy. (2026-02-25)

---

## Risk ID: R-009
**Identified:** 2026-02-24
**Category:** Integration
**Probability:** Low
**Impact:** High

**Description:** Telnyx rate limiting. Initiating 100 outbound calls simultaneously may hit Telnyx API rate limits or account concurrent call limits, causing some players to not receive calls at game start.

**Mitigation:**
1. Confirm Telnyx account limits before production
2. Implement staggered call initiation (batches of 20, 500ms apart)
3. Add retry logic for failed call initiation
4. Monitor call success rate per game
5. Contact Telnyx for higher limits if needed

**Owner:** Integration Agent
**Status:** Open

---

## Risk ID: R-010
**Identified:** 2026-02-24
**Category:** Technical
**Probability:** Medium
**Impact:** Medium

**Description:** Redis data loss during active game. If Upstash Redis experiences an outage during a live game, all game state is lost. Games cannot recover mid-session.

**Mitigation:**
1. Checkpoint critical state to Neon Postgres at turn boundaries
2. Implement game recovery logic that can Resume from last checkpoint
3. Use Upstash's built-in persistence/replication
4. Accept that some game loss is possible and refund entry fees in such cases

**Owner:** State Management Agent
**Status:** Open

---

## Risk ID: R-011
**Identified:** 2026-02-24
**Category:** Performance
**Probability:** Medium
**Impact:** Medium

**Description:** ElevenLabs TTS latency. Pre-generating voice prompts may not be fast enough for dynamic content (e.g., announcing scores, player-specific messages). Could add 2-5 seconds per interaction.

**Mitigation:**
1. Use Telnyx native TTS for simple messages (fast, built-in)
2. Reserve ElevenLabs for pre-generated, cacheable content (intro, question readings)
3. Pre-generate common audio clips and cache them
4. Benchmark during Phase 3

**Owner:** Integration Agent
**Status:** Open

---

## Risk ID: R-012
**Identified:** 2026-02-24
**Category:** Business
**Probability:** Low
**Impact:** Medium

**Description:** Per-game costs may exceed revenue. At $1.00 entry fee with 10 players, revenue is $10.00 minus house cut. Costs include: Telnyx calls (~$0.01/min × 10 players × 15 min = $1.50), Deepgram ($0.0043/min × 10 × 15 = $0.65), Stripe fees (2.9% + $0.30 × 10 = $3.29), ElevenLabs ($0.30/1000 chars). Total cost ~$5.50+ per game.

**Mitigation:**
1. Calculate break-even player count per game
2. Adjust entry fee or house cut based on actual costs
3. Optimize API usage (shorter recordings, batched API calls)
4. Track per-game P&L in database

**Owner:** Architecture Agent
**Status:** Open

---

## Risk ID: R-013
**Identified:** 2026-02-24
**Category:** Integration
**Probability:** High
**Impact:** High

**Description:** Stripe test API key (`sk_test_...`) has expired. All Stripe operations (payment intent creation, webhook verification) fail with "Expired API Key" error. Payment flow is non-functional.

**Mitigation:**
1. User must generate a fresh test API key from Stripe Dashboard → Developers → API Keys
2. Update SECRETS-THECALLING.ini with new key
3. Re-run live API smoke tests to validate
4. Non-blocking for game handler development, but BLOCKING for payment flow testing

**Owner:** Integration Agent
**Status:** Closed ✅ — User renewed Stripe test key. PaymentIntent creation validated (pi_3T4T4zAqCb48cFrq0U354yUN). Webhook secret also provided. (2026-02-25)

---

## SUMMARY (Final Review — 2026-02-25)

| Status | Count |
|--------|-------|
| Open | 7 |
| Mitigated | 2 |
| Closed | 4 |
| **Total** | **13** |

| Impact | High/Critical | Medium | Low |
|--------|--------------|--------|-----|
| **Count** | 6 | 5 | 0 |

**Remaining Open Risks (by priority):**
1. **R-005** (High) — Benchmark Deepgram real-time STT latency with actual voice recordings
2. **R-006** (High) — Test concurrent call management at 50+ players  
3. **R-007** (Critical) — Stripe Connect onboarding friction for winner payouts
4. **R-009** (High) — Confirm Telnyx concurrent call limits for production
5. **R-010** (Medium) — Redis failover / game state recovery
6. **R-011** (Medium) — ElevenLabs TTS latency for dynamic content
7. **R-012** (Medium) — Per-game cost analysis vs revenue

**Accepted risks for MVP launch:** R-005, R-006, R-009 are accepted with fallback strategies. R-007, R-010, R-011, R-012 are deferred to post-launch optimization.
