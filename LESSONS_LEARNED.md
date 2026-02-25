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

## Lesson: Next.js Static Export Cannot Use Dynamic Routes With Empty `generateStaticParams`
**Date:** 2026-02-25
**Category:** Technical

**What Happened:** Next.js 15 with `output: 'export'` threw a build error for dynamic `[id]` route segments. `generateStaticParams` must return at least one param set at build time, but game IDs are runtime-only (stored in DB).

**Root Cause:** Static export bakes all routes at build time. Dynamic segments require `generateStaticParams` to enumerate all valid values upfront. Returning `[]` is not allowed — Next won't generate any HTML for the route and errors.

**Impact:** Build failed until all `[id]` routes were eliminated from the frontend.

**Resolution:** Converted all dynamic routes (`/games/[id]`, `/admin/games/[id]`) to static routes with query params (`/games/detail?id=`, `/admin/games/detail?id=`). Client components use `useSearchParams()` to read the ID at runtime. Pages wrapped in `<Suspense>` for hydration compatibility.

**Prevention:** For fully static-exported Next.js apps, never use `[param]` route segments unless you have a fixed set of IDs known at build time (e.g., from a CMS or config file). Use query strings for runtime-variable IDs.

---

## Lesson: Cloudflare Worker Routes Must Be Narrowed to API Paths Only When Co-Hosting With Pages
**Date:** 2026-02-25
**Category:** Architecture

**What Happened:** Worker had `thecalling.club/*` as a route. This intercepted ALL traffic to the domain — including frontend page navigations — causing 400 errors on any non-API route (e.g., `/admin/games`).

**Root Cause:** Cloudflare route matching: Worker routes take priority over Pages. A wildcard Worker route swallows every request before it reaches CF Pages.

**Impact:** Frontend admin pages returned 400 Worker errors. Users couldn't navigate to any page the Worker didn't explicitly handle.

**Resolution:** Narrowed Worker routes to specific API paths: `thecalling.club/api/*`, `thecalling.club/health`, `thecalling.club/webhooks/*`. All other paths fall through to CF Pages.

**Prevention:** When deploying a Worker alongside CF Pages on the same custom domain, always use the most specific route patterns possible. Never use `domain.com/*` as a Worker route if CF Pages should serve any paths.

---

## Lesson: Worker Admin Route Prefix Must Not Conflict With Pages UI Routes
**Date:** 2026-02-25
**Category:** Architecture

**What Happened:** Worker had admin API routes at `/admin/*`. The frontend also has admin UI pages at `/admin/*` (CF Pages). Even after narrowing the Worker route from `thecalling.club/*` to specific paths, having `thecalling.club/admin/*` as a Worker route intercepted browser navigations to the frontend admin UI.

**Root Cause:** The Worker's Hono routes and the Pages frontend used the same `/admin/` path prefix. Worker route `thecalling.club/admin/*` matched browser requests to frontend admin pages.

**Impact:** `thecalling.club/admin/games` returned a Worker 400/404 instead of the frontend admin UI.

**Resolution:** Renamed all Worker admin API routes from `/admin/*` to `/api/admin/*`. Removed `thecalling.club/admin/*` Worker route. Updated all frontend `api.ts` calls from `/admin/...` to `/api/admin/...`. Now: `/admin/*` → CF Pages UI; `/api/admin/*` → Worker API.

**Prevention:** All Worker API routes should live under `/api/`. Frontend UI routes should never share a prefix with backend API routes. Adopt `/api/*` as the universal API prefix convention from project start.

---

## Lesson: Cloudflare Pages `production_branch` Can Be Corrupted by CLI
**Date:** 2026-02-25
**Category:** Deployment

**What Happened:** All `npx wrangler pages deploy --branch main` deploys showed "Deployment complete!" but were silently creating **preview** deployments instead of production. The custom domain `thecalling.club` kept serving the original (stale) production deployment from the first deploy.

**Root Cause:** The `production_branch` project setting was corrupted — it was set to the command string `"ler pages deploy out/ --project-name thecalling-web --commit-dirty=true 2>&1"` instead of `"main"`. With no matching production branch, all subsequent deploys defaulted to preview environment.

**Impact:** Every fix deployed over 5+ rounds was silently going to preview only. Live site was serving the stale first deploy (missing favicon, old routes, etc.).

**Resolution:** Used `PATCH /accounts/{id}/pages/projects/{name}` CF API to set `production_branch: "main"`. Next deploy immediately became production and served updated build.

**Prevention:** After initial Pages project creation, verify `production_branch` via the API or dashboard before iterating. Check deployment environment in the deploy output — "production" vs "preview" indicates whether the custom domain will update. Add a verification step: `curl CF_API .../deployments | check environment == production`.

---

## Lesson: Next.js 15 `themeColor` Must Be in `Viewport` Export, Not `Metadata`
**Date:** 2026-02-25
**Category:** Technical

**What Happened:** Build produced a warning: "Unsupported metadata `themeColor` is configured in metadata export. Please move it to `viewport` export instead."

**Root Cause:** Next.js 15 separated viewport-specific metadata (themeColor, colorScheme, width, etc.) into a dedicated `Viewport` type that must be exported separately.

**Impact:** Build warning; themeColor may not render correctly in browser.

**Resolution:** 
```typescript
// Before (incorrect):
export const metadata: Metadata = { themeColor: '#0A0A0F' };

// After (correct):
import type { Metadata, Viewport } from 'next';
export const viewport: Viewport = { themeColor: '#0A0A0F' };
```

**Prevention:** In Next.js 15+, always use `export const viewport: Viewport = {...}` for any viewport-related meta tags. Reserve `metadata` export for title, description, icons, openGraph, etc.

---

## Lesson: `wrangler pages deploy` With `--branch` Does Not Equal CI/CD Production Deploy
**Date:** 2026-02-25
**Category:** Deployment

**What Happened:** Passing `--branch main` to `wrangler pages deploy` was assumed to make a production deployment. It does not — branch name alone doesn't determine environment. The project's `production_branch` setting must match the branch name for the deploy to be classified as "production".

**Root Cause:** Misunderstanding of how CF Pages classifies deployments: the project-level `production_branch` config (set in the project settings) is what determines if a deploy is production. The `--branch` flag is just metadata.

**Impact:** Multiple rounds of fixes deployed as preview-only, wasting time diagnosing why the live site wasn't updating.

**Prevention:** After creating a Pages project via CLI, immediately verify `production_branch` matches your deploy branch (`"main"`) via the API. Alternatively, use the CF Pages dashboard to connect a GitHub repo for automatic production deploys on push, which handles this correctly.

---

## Lesson: `public/` Assets Must Be Synced to WSL Build Dir Before Deploy
**Date:** 2026-02-25
**Category:** Process

**What Happened:** `favicon.svg` was created in `THECALLING-WEB/public/` (Windows path) but the WSL build dir `/tmp/tcweb2/` had been set up via `rsync` earlier. New files added to the Windows project after the rsync are not automatically present in the WSL build dir.

**Root Cause:** WSL build dir is a one-time rsync snapshot. Any new files added to the Windows project path are not automatically propagated.

**Impact:** `favicon.svg` was missing from `out/` (build output), causing 404 on the live site even though the file existed in `public/`.

**Resolution:** Manually copied the file: `cp "/mnt/c/.../public/favicon.svg" /tmp/tcweb2/out/favicon.svg`. Then redeployed.

**Prevention:** When adding files to `public/` or any static asset directory, always re-rsync (or manually copy) to the WSL build dir before deploying. Consider making the deploy workflow script include a targeted rsync of `public/` before running `npm run build`.

---

_More lessons will be captured as development progresses._
