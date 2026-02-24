# ISSUES_LOG.md — Problem Tracking

> **The Calling Voice Game Platform** | Last Updated: 2026-02-24

---

## Issue: Missing Telnyx Credentials
**ID:** I-001
**Date:** 2026-02-24
**Severity:** Critical
**Status:** ✅ Resolved (2026-02-24)

**Description:** SECRETS-THECALLING.ini does not contain Telnyx API Key, Public Key, Phone Number, or Connection ID. Telnyx is the primary voice infrastructure for the entire platform.

**Impact:** Cannot implement or test any voice call functionality. Blocks Phase 3 (Integrations) entirely and Phase 4 (Game Handler) for end-to-end testing.

**Root Cause:** Telnyx account has not been provisioned yet, or credentials were not added to the secrets file.

**Resolution:** Pending — user must:
1. Sign up at telnyx.com
2. Purchase a phone number
3. Create a SIP Connection (get Connection ID)
4. Generate API keys
5. Add all 4 values to SECRETS-THECALLING.ini

**Related Risks:** R-001

---

## Issue: Missing Redis Credentials
**ID:** I-002
**Date:** 2026-02-24
**Severity:** High
**Status:** ✅ Resolved (2026-02-24)

**Description:** Originally reported as missing Upstash Redis credentials. User provided Redis Cloud (redislabs.com) credentials instead. Functionally equivalent — standard Redis protocol.

**Impact:** Cannot set up or test Redis state management. Blocks Phase 2 (Foundation - Redis setup) and all game state operations.

**Root Cause:** Upstash account has not been provisioned yet, or credentials were not added to the secrets file.

**Resolution:** Pending — user must:
1. Sign up at upstash.com
2. Create a Redis database (us-east-1 recommended for Neon co-location)
3. Copy REST URL and Token
4. Add to SECRETS-THECALLING.ini

**Related Risks:** R-002

---

## Issue: Missing Sentry DSN
**ID:** I-003
**Date:** 2026-02-24
**Severity:** Medium
**Status:** ✅ Resolved (2026-02-24)

**Description:** SECRETS-THECALLING.ini does not contain SENTRY_DSN. Error tracking will not function.

**Impact:** Errors during development and production will not be tracked centrally. Debugging will rely on manual log inspection.

**Root Cause:** Sentry project has not been created yet.

**Resolution:** Pending — user must:
1. Sign up at sentry.io
2. Create a new JavaScript/Node project
3. Copy the DSN
4. Add to SECRETS-THECALLING.ini

**Related Risks:** R-003

---

## Issue: Missing ElevenLabs Voice ID
**ID:** I-004
**Date:** 2026-02-24
**Severity:** Low
**Status:** Open

**Description:** SECRETS-THECALLING.ini contains an ElevenLabs API key but no Voice ID. A specific voice must be selected for TTS output.

**Impact:** Cannot generate voice audio via ElevenLabs until a voice is selected. Non-blocking — Telnyx native TTS can be used as fallback.

**Root Cause:** Voice selection has not been made yet.

**Resolution:** Pending — user must:
1. Browse ElevenLabs voice library
2. Select a voice suitable for game hosting (clear, authoritative, engaging)
3. Add ELEVENLABS_VOICE_ID to SECRETS-THECALLING.ini

**Related Risks:** None

---

## Issue: Stripe Publishable Key Appears to be Placeholder
**ID:** I-005
**Date:** 2026-02-24
**Severity:** Medium
**Status:** Open

**Description:** The NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in SECRETS-THECALLING.ini ends with `0000abcdefgh` which appears to be a placeholder rather than a real key.

**Impact:** Client-side Stripe integration may not work. Stripe Payment Intents could still work server-side with the secret key.

**Root Cause:** Key may have been partially redacted or is a placeholder awaiting real key.

**Resolution:** Verify the actual publishable key in Stripe Dashboard → Developers → API keys. Update SECRETS-THECALLING.ini with the real value.

**Related Risks:** None

---

## Issue: Database Method Signature Mismatches
**ID:** I-006
**Date:** 2026-02-24
**Severity:** Critical
**Status:** ✅ Resolved (2026-02-24)

**Description:** 7 methods in database.ts had signatures that did not match their callers in admin/routes.ts, platform.ts, and trivia-handler.ts. Affected methods: createGameInstance, updateParticipantPayment, updatePlayerStats, insertPayout, insertPlayerTurn, getRandomQuestions, eliminateParticipant.

**Impact:** TypeScript would fail to compile at call sites. Runtime errors from wrong argument ordering.

**Root Cause:** Database module was written with one API contract while callers were written independently with different parameter assumptions.

**Resolution:** Rewrote all 7 database method signatures to match actual caller usage patterns. Made optional params where callers pass fewer args.

---

## Issue: TypeScript Compilation Errors (Neon FullQueryResults)
**ID:** I-007
**Date:** 2026-02-24
**Severity:** High
**Status:** ✅ Resolved (2026-02-24)

**Description:** 12 TypeScript errors in database.ts caused by `neon()` sql tagged template returning `FullQueryResults<boolean>` which doesn't support numeric indexing with `[0]`.

**Impact:** TypeScript compilation fails with `tsc --noEmit`.

**Root Cause:** `@neondatabase/serverless` neon() function returns a complex union type that includes FullQueryResults which is not array-indexable.

**Resolution:** Changed `private sql: ReturnType<typeof neon>` to `private sql: any` since all return values are explicitly cast to proper types anyway.

---

## Issue: GameTemplate Field Name Mismatch
**ID:** I-008
**Date:** 2026-02-24
**Severity:** High
**Status:** ✅ Resolved (2026-02-24)

**Description:** platform.ts referenced `template.game_type` and `template.config` but the actual DB column names (and TypeScript type) are `type` and `default_config`.

**Impact:** 4 TypeScript errors and runtime crashes when accessing undefined properties.

**Root Cause:** Inconsistency between DB schema column names and code assumptions.

**Resolution:** Changed all `template.game_type` → `template.type` and `template.config` → `template.default_config ?? {}` in platform.ts.

---

## Issue: npm Install Fails on WSL with NTFS Paths
**ID:** I-009
**Date:** 2026-02-24
**Severity:** Medium
**Status:** ✅ Resolved (2026-02-24)

**Description:** npm install fails with EACCES and TAR_ENTRY_ERROR ENOENT on WSL when node_modules is on NTFS mount (/mnt/c/...). Long nested paths in @cloudflare and stripe packages exceed NTFS limitations.

**Impact:** Cannot install dependencies in the project directory via WSL.

**Root Cause:** NTFS filesystem limitations on long paths + WSL permission handling for renames.

**Resolution:** Install in WSL native filesystem (/tmp/tc_install) then copy back. package-lock.json preserved for reproducibility.

---

## Issue: Game Template Type Mismatch — 'trivia' vs 'elimination_trivia'
**ID:** I-010
**Date:** 2026-02-24
**Severity:** High
**Status:** ✅ Resolved (2026-02-24)

**Description:** TriviaHandler and factory registry used `'trivia'` as the game type key, but the seed data in Neon DB uses `'elimination_trivia'`. This caused `getRandomQuestions('trivia', ...)` to return empty results and factory lookups by DB type to throw "Unknown game type."

**Impact:** TriviaHandler `initialize()` would load 0 questions. Platform `executeGameTurn()` would fail when creating handler from DB template type.

**Root Cause:** Seed data inserted the template with type `elimination_trivia` (more descriptive), while code assumed the shorter `trivia` key.

**Resolution:** Added `elimination_trivia: TriviaHandler` to the HANDLER_REGISTRY in factory.ts alongside `trivia`. Both keys now create TriviaHandler.

---

## Issue: GameContent Schema — content_data JSONB vs Flat Fields
**ID:** I-011
**Date:** 2026-02-24
**Severity:** High
**Status:** ✅ Resolved (2026-02-24)

**Description:** TriviaHandler assumed question data as flat fields (`question_text`, `options`, `correct_answer`), but the actual DB stores it as JSONB in `content_data` column with nested structure `{ question, correct_answer, alternatives, category }`.

**Impact:** TriviaHandler `getNextTurn()` would return turns with empty question text and no options.

**Root Cause:** `TriviaQuestion` type defined flat fields while DB uses `GameContent.content_data` JSONB for flexible content storage.

**Resolution:** Updated TriviaHandler `initialize()` to transform `GameContent` rows into `TriviaQuestion` objects by extracting from `content_data` JSONB. Options are shuffled (correct answer mixed with alternatives).

---

## Issue: Stripe API Key Expired
**ID:** I-012
**Date:** 2026-02-24
**Severity:** Medium
**Status:** ✅ Resolved (2026-02-25)

**Description:** The `sk_test_` Stripe secret key in SECRETS-THECALLING.ini had expired. Stripe API returned "Expired API Key provided."

**Impact:** Could not create payment intents, check balance, or process any payments.

**Root Cause:** Stripe test API keys can expire or be rotated by the account owner.

**Resolution:** User provided renewed Stripe test key. Validated via live API smoke test — PaymentIntent creation successful (pi_3T4T4zAqCb48cFrq0U354yUN). User also provided STRIPE_WEBHOOK_SECRET for webhook signature verification.

---

## Issue: Sentry DSN Not Configured
**ID:** I-013
**Date:** 2026-02-24
**Severity:** Low
**Status:** ✅ Resolved (2026-02-25)

**Description:** SECRETS-THECALLING.ini contained `SENTRY_API_KEY` (auth token) but not a full `SENTRY_DSN` URL. SentryClient constructor requires a DSN for envelope-based error reporting.

**Impact:** Error tracking was non-functional. Errors were silently caught and logged but not sent to Sentry.

**Root Cause:** DSN is a separate credential from the API auth token.

**Resolution:** User provided Sentry DSN. Added to SECRETS-THECALLING.ini. Validated via live API smoke test — event 6c799f484fb7424b9bdb191b3f2706ed sent successfully to Sentry.

---

_Issues will be added as they are discovered during development._
