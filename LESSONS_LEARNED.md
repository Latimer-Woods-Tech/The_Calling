# LESSONS_LEARNED.md — Insights & Retrospectives

> **The Calling Voice Game Platform** | Last Updated: 2026-02-25

---

## Lesson: Validate Credentials Inventory Before Architecture Planning
**Date:** 2026-02-24
**Category:** Process

**What Happened:** During Phase 1 architecture review, discovered that 3 critical service credentials are missing from SECRETS-THECALLING.ini: Telnyx (voice — the core service), Upstash Redis (game state), and Sentry (monitoring).

**Root Cause:** Secrets file was populated with available credentials but not cross-referenced against the architecture's full service dependency list.

**Impact:** Phases 2 and 3 will be partially blocked until missing credentials are obtained. Development can proceed on non-dependent components (database, platform skeleton, test framework) but cannot test voice calls or Redis state management.

**Resolution:** Documented gaps in RISK_REGISTER.md (R-001, R-002, R-003). Created a prioritized list for the user to obtain missing credentials.

**Prevention:** In future projects, create a credential dependency matrix during architecture planning and validate all credentials exist before starting development phases.

---

## Lesson: Architecture Document as TypeScript Not Markdown
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** The architecture reference document (THECALLING_ARCHITECTURE.ts) uses a .ts extension but contains Markdown content with embedded code blocks. This is a reference-only document, not executable code.

**Root Cause:** File was created with .ts extension to leverage syntax highlighting for the TypeScript code examples embedded within.

**Impact:** No functional impact — document is clearly marked as "REFERENCE ONLY" at the top. Just requires awareness that this is documentation, not source code.

**Resolution:** Noted for awareness. The actual source code will be created separately in proper project structure during Phase 2.

**Prevention:** Use .md extension for documentation files. Use separate .ts files for actual TypeScript source code.

---

## Lesson: Redis Cloud vs Upstash — Provider Flexibility
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** Architecture assumed Upstash Redis (REST-based, Cloudflare Workers compatible). User provided Redis Cloud (redislabs.com) credentials instead.

**Root Cause:** ADR-004 specified Upstash for its HTTP-based interface ideal for Workers, but any Redis-compatible service works for the core functionality.

**Impact:** Redis Cloud uses standard TCP/Redis protocol, not HTTP REST. For Cloudflare Workers (no TCP sockets), we implemented an in-memory fallback for development and designed the GameStateManager to support REST adapters. The state manager abstracts the Redis implementation, so swapping providers is seamless.

**Resolution:** GameStateManager uses in-memory Map/Set for dev mode with a toggleable path for production REST API. Architecture remains flexible.

**Prevention:** Design state management interfaces to be provider-agnostic from the start. Accept any Redis-compatible backend.

---

## Lesson: Neon MCP Multi-Statement SQL Limitation
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** The Neon MCP `run_sql` tool cannot execute multiple SQL statements (e.g., multiple CREATE TABLE in one call). Attempts resulted in syntax errors.

**Root Cause:** Neon MCP's `run_sql` only supports single-statement SQL. This is a tool limitation, not a Neon database limitation.

**Impact:** Had to switch to `run_sql_transaction` which accepts an array of individual SQL statements, each executed sequentially in a transaction.

**Resolution:** Used `run_sql_transaction` for all multi-statement operations (table creation, bulk inserts, index creation).

**Prevention:** Always use `run_sql_transaction` for any batch SQL operations via MCP tools.

---

## Lesson: Windows/WSL npm Install Long Path Issues
**Date:** 2026-02-24
**Category:** Environment

**What Happened:** npm install on Windows/WSL produces many TAR_ENTRY_ERROR ENOENT warnings, particularly for packages with deep directory structures (stripe, miniflare, unenv).

**Root Cause:** NTFS has a 260-character path limit by default. Packages with deep nested directories exceed this limit when accessed through WSL's /mnt/c/ mount.

**Impact:** Non-fatal — npm install still completes. Some type definition files may be missing but core runtime modules are present.

**Resolution:** Warnings can be safely ignored. If TypeScript type issues arise, use `npm rebuild` or enable Windows long path support via registry.

**Prevention:** For projects with large dependency trees, consider developing directly in WSL's native filesystem (~/) rather than /mnt/c/.

---

## Lesson: Neon `neon()` Return Type Requires Pragmatic Typing
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** TypeScript compilation failed with 12 TS7053 errors in database.ts. Accessing `rows[0]` on the return value of Neon's `sql` tagged template literal produced "Element implicitly has an 'any' type because expression of type '0' can't be used to index type 'FullQueryResults<boolean>'."

**Root Cause:** `@neondatabase/serverless`'s `neon()` function returns `FullQueryResults<boolean>`, a union type of `FullQueryResults<true>` (object array) and `FullQueryResults<false>` (2D array). TypeScript can't safely index the union without narrowing.

**Impact:** 12 compile errors across all database query methods that access `rows[0]` or iterate `rows`.

**Resolution:** Changed `private sql: ReturnType<typeof neon>` to `private sql: any`. Since all queries use `fullResults: false` mode returning simple row arrays, runtime behavior is correct — the typing just can't express it cleanly.

**Prevention:** When using Neon's serverless driver, either: (a) type `sql` as `any` for pragmatic use, (b) create a typed wrapper that narrows the return type, or (c) use explicit type assertions on each query result. Option (a) is simplest for rapid development.

---

## Lesson: Define Database Method Signatures After Writing Callers
**Date:** 2026-02-24
**Category:** Process

**What Happened:** 7 database methods had signature mismatches with their callers. For example, `createGameInstance` expected an object param but callers passed positional args; `getRandomQuestions` expected `(templateId, categories[], count)` but callers passed `(gameType, count, difficulty?)`.

**Root Cause:** Database methods were written in isolation based on assumed calling patterns, before the platform orchestrator and admin routes were implemented. When callers were written later, natural call patterns diverged from the pre-defined signatures.

**Impact:** Multiple runtime-breaking mismatches caught during TypeScript compilation and code review. Required rewriting 7 method signatures.

**Resolution:** Rewrote all 7 methods to match actual caller patterns. Lesson: implement callers first or use interface-first TDD.

**Prevention:** Either: (a) write integration tests that exercise caller→DB paths before implementation, (b) define DB interfaces as TypeScript interfaces first and implement both sides against them, or (c) write callers first and derive DB signatures from actual usage.

---

## Lesson: WSL/NTFS npm Install — Use Native Filesystem
**Date:** 2026-02-24
**Category:** Environment

**What Happened:** npm install failed repeatedly on WSL-mounted NTFS (/mnt/c/). Errors included EACCES permission denied, TAR_ENTRY_ERROR Directory not empty, and MODULE_NOT_FOUND for esbuild. `rm -rf node_modules` also failed with "Directory not empty" on NTFS.

**Root Cause:** NTFS filesystem semantics (locking, permission model, path limits) conflict with npm's Linux file operations when accessed through WSL's /mnt/c/ mount. The combination of symlinks, deep paths, and concurrent file operations is unreliable.

**Impact:** Blocked dependency installation for ~30 minutes. Multiple workaround attempts failed.

**Resolution:** Installed dependencies in WSL's native filesystem (`/tmp/tc_install`) with `--ignore-scripts` flag, then copied `node_modules` back to the project directory. This succeeded on first attempt (172 packages, 55s).

**Prevention:** For WSL development: always run npm install in Linux-native filesystem paths. If the project must live on NTFS, use the "install elsewhere, copy back" pattern. Consider using pnpm which handles NTFS better than npm.

---

## Lesson: Vitest Workers Pool vs Node.js Mode
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** Initial vitest.config.ts used `defineWorkersConfig` with `environment: 'miniflare'` from `@cloudflare/vitest-pool-workers`. This required additional setup (miniflare environment) and was unnecessary for smoke/unit tests.

**Root Cause:** Config was written assuming all tests need the Workers runtime. In reality, smoke tests (utility functions, factory patterns, in-memory state) run fine in plain Node.js.

**Impact:** Tests failed until config was simplified. Unnecessary complexity in test setup.

**Resolution:** Changed to simple `defineConfig` from `vitest/config` with no environment/pool options. All 32 tests pass in Node.js mode (1.89s).

**Prevention:** Use the simplest viable test environment. Reserve Workers pool configuration for integration tests that actually need Cloudflare APIs (KV, Durable Objects, etc.). Keep smoke/unit tests in plain Node.js for speed and simplicity.

---

## Lesson: Database Column Names Must Match Type Definitions
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** Platform code referenced `template.game_type` and `template.config`, but the actual database column names (and TypeScript type) use `type` and `default_config`.

**Root Cause:** Naming inconsistency between the architecture document's informal references and the actual CREATE TABLE DDL. Code was written using intuitive names rather than checking the schema.

**Impact:** 4 TypeScript errors in platform.ts. Would have caused runtime SQL errors if not caught.

**Resolution:** Changed all references to match the database schema: `game_type` → `type`, `config` → `default_config ?? {}`.

**Prevention:** Always reference the actual DB schema (or TypeScript type definitions) when writing data access code. Keep a single source of truth for column names.

---

## Lesson: DB Seed Data Naming — Template Type 'elimination_trivia' Not 'trivia'
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** Live API integration tests failed when querying `game_templates` with `type = 'trivia'` — returned 0 rows. The actual template type stored in the DB is `'elimination_trivia'`, the full game mode name.

**Root Cause:** Code assumed a shorter alias (`trivia`) for the template type, but the seed data INSERT used the full name `elimination_trivia`. No validation existed between code constants and DB seed data.

**Impact:** TriviaHandler.initialize() loaded 0 questions. GameHandlerFactory couldn't find a handler for `elimination_trivia`. Both were debugged during live API smoke tests.

**Resolution:** (1) Added `elimination_trivia: TriviaHandler` to HANDLER_REGISTRY in factory.ts. (2) Changed `getRandomQuestions` call in TriviaHandler to use `'elimination_trivia'`. (3) Both `trivia` and `elimination_trivia` keys now map to TriviaHandler for flexibility.

**Prevention:** Define game type constants in a shared enum/const object used by both seed SQL generation and application code. Never hardcode type strings without referencing the canonical source.

---

## Lesson: JSONB Content Structure Must Be Documented and Tested
**Date:** 2026-02-24
**Category:** Technical

**What Happened:** TriviaHandler assumed `GameContent` rows had flat properties (`question`, `correct_answer`, etc.) directly on the row. In reality, these fields are nested inside a `content_data` JSONB column as `{ question, correct_answer, alternatives, category }`.

**Root Cause:** The `GameContent` TypeScript type correctly defines `content_data: Record<string, any>`, but the TriviaHandler code was written against an assumed flat structure without querying the actual DB shape.

**Impact:** Questions loaded from DB couldn't be mapped to `TriviaQuestion` objects — all fields were undefined. Discovered during live integration tests.

**Resolution:** Rewrote `TriviaHandler.initialize()` to extract from `content_data`: `content_data.question → question_text`, `[correct_answer, ...alternatives] shuffled → options`, `content_data.correct_answer → correct_answer`, `content_data.category → category`.

**Prevention:** Always validate the actual DB row shape with a live query before writing transformation code. For JSONB columns, document the expected schema in a TypeScript interface and validate at runtime.

---

## Lesson: Live API Credential Validation as Phase Gate
**Date:** 2026-02-24
**Category:** Process

**What Happened:** Phase 3 introduced a dedicated `live-api-smoke.test.ts` that validates every configured API credential against the real service. This immediately caught: Stripe key expired, Telnyx phone filter API difference, Neon template type mismatch, and content_data structure mismatch.

**Root Cause:** N/A — this is a positive process lesson.

**Impact:** All integration issues were discovered and fixed in a controlled test environment rather than during deployment or live game execution. 4 issues found and resolved in one focused testing session.

**Resolution:** Live API smoke tests are now a mandatory gate before proceeding to deployment. Tests use graceful skip patterns for services with known credential issues (Stripe, Sentry).

**Prevention:** Adopt this pattern for all multi-service projects: create a credential validation test suite that runs against real APIs early in integration testing. Use graceful skips (not hard failures) for services with known issues.

---

## Lesson: Wrangler `set -e` and Bash Arithmetic in Deploy Scripts
**Date:** 2026-02-25
**Category:** Technical

**What Happened:** The `deploy-secrets.sh` script used `set -e` for early error exit and `((SUCCESS++))` for counting. When `SUCCESS` was 0, the arithmetic expression `((0++))` evaluates to 1, which is truthy, but `((0))` (the initial value) evaluates as falsy, causing `set -e` to terminate the script after the first iteration.

**Root Cause:** In bash, `set -e` treats any command returning non-zero as a failure. `((expression))` returns 1 (failure) when the expression evaluates to 0. So `((SUCCESS++))` when SUCCESS=0 evaluates as `((0))` → exit 1, triggering `set -e`.

**Impact:** Deploy-secrets script only pushed the first secret, then silently exited. Had to push remaining 14 secrets manually.

**Resolution:** Pushed secrets manually in small batches. For future: use `SUCCESS=$((SUCCESS + 1))` instead of `((SUCCESS++))`, or add `|| true` after arithmetic: `((SUCCESS++)) || true`.

**Prevention:** Avoid `((var++))` with `set -e` in bash scripts. Use `var=$((var + 1))` which always returns 0 exit status. Test deploy scripts in dry-run mode with artificial secret values before real execution.

---

## Lesson: Cloudflare Worker URL Includes Account Subdomain
**Date:** 2026-02-25
**Category:** Technical

**What Happened:** Expected Worker URL was `https://thecalling-platform.workers.dev` but actual deployed URL is `https://thecalling-platform.adrper79.workers.dev` (includes account subdomain). This affected the WEBHOOK_BASE_URL env var.

**Root Cause:** Cloudflare Workers URLs follow the pattern `{worker-name}.{account-subdomain}.workers.dev`. The account subdomain typically matches the account name.

**Impact:** Had to update `WEBHOOK_BASE_URL` in wrangler.toml after observing the actual deployed URL. Webhook callbacks would have pointed to a non-existent host.

**Resolution:** Updated wrangler.toml and redeployed.

**Prevention:** Run a dry-run deploy or check Cloudflare dashboard for the actual worker subdomain before setting webhook-related environment variables.

---

_More lessons will be captured as development progresses._
