# OPERATIONAL RUNBOOK — The Calling Voice Game Platform

> **Version:** 1.0 | **Last Updated:** 2026-02-25  
> **Platform:** Cloudflare Workers | **URL:** https://thecalling-platform.adrper79.workers.dev

---

## TABLE OF CONTENTS
1. [Health Monitoring](#1-health-monitoring)
2. [Deployment Procedures](#2-deployment-procedures)
3. [Secret Management](#3-secret-management)
4. [Game Management](#4-game-management)
5. [Database Operations](#5-database-operations)
6. [Scaling & Performance](#6-scaling--performance)
7. [Troubleshooting Guide](#7-troubleshooting-guide)
8. [Maintenance Windows](#8-maintenance-windows)
9. [Cost Management](#9-cost-management)

---

## 1. HEALTH MONITORING

### 1.1 Health Check Endpoint
```bash
curl -s https://thecalling-platform.adrper79.workers.dev/health | jq .
```
**Expected Response:**
```json
{
  "status": "healthy",
  "services": {
    "database": true,
    "redis": true,
    "deepgram": true,
    "elevenlabs": true,
    "stripe": true,
    "openai": true
  }
}
```
**Alert if:** Any service returns `false` or status is not `healthy`.

### 1.2 Root Endpoint (Platform Status)
```bash
curl -s https://thecalling-platform.adrper79.workers.dev/ | jq .
```

### 1.3 Monitoring Checklist (Daily)
- [ ] Health endpoint returns all services `true`
- [ ] Sentry dashboard — check for new errors (https://sentry.io)
- [ ] Cloudflare Workers dashboard — check request volume and error rate
- [ ] Stripe dashboard — check for failed payments or disputes
- [ ] Neon dashboard — check database utilization

### 1.4 Sentry Error Monitoring
- **DSN configured** — errors are auto-reported from the Worker
- **Triage:** Check Sentry for new issues at least twice daily during active games
- **Critical errors:** Database connection failures, Telnyx webhook errors, Stripe payment failures

---

## 2. DEPLOYMENT PROCEDURES

### 2.1 Standard Deployment
```bash
# From project root (in WSL)
cd "/mnt/c/Users/Ultimate Warrior/My project/THECALLING"

# Pre-deploy validation
npx tsc --noEmit           # Type check
npx vitest run             # Run all 81 tests
npx wrangler deploy --dry-run  # Validate build

# Deploy
npx wrangler deploy

# Post-deploy verification
curl -s https://thecalling-platform.adrper79.workers.dev/health | jq .
curl -s https://thecalling-platform.adrper79.workers.dev/ | jq .
```

### 2.2 Emergency Rollback
```bash
# List recent deployments
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback

# Verify rollback
curl -s https://thecalling-platform.adrper79.workers.dev/health | jq .
```

### 2.3 Deployment Checklist
- [ ] All tests pass (81/81)
- [ ] TypeScript compiles without errors
- [ ] No secrets changed (or secrets updated first via deploy-secrets.sh)
- [ ] wrangler.toml reviewed for config changes
- [ ] `wrangler deploy --dry-run` succeeds
- [ ] Deploy executed
- [ ] Post-deploy health check passes
- [ ] Smoke test admin API

---

## 3. SECRET MANAGEMENT

### 3.1 Current Secrets (15 total)
| Secret Name | Service | Rotation Frequency |
|-------------|---------|-------------------|
| NEON_DATABASE_URL | Neon Postgres | Quarterly |
| TELNYX_API_KEY | Telnyx Voice | Quarterly |
| TELNYX_CONNECTION_ID | Telnyx Voice | Rarely |
| TELNYX_PHONE_NUMBER | Telnyx Voice | Rarely |
| DEEPGRAM_API_KEY | Deepgram STT | Quarterly |
| ASSEMBLYAI_API_KEY | AssemblyAI STT | Quarterly |
| ELEVENLABS_API_KEY | ElevenLabs TTS | Quarterly |
| OPENAI_API_KEY | OpenAI GPT | Quarterly |
| STRIPE_SECRET_KEY | Stripe Payments | As needed |
| STRIPE_WEBHOOK_SECRET | Stripe Webhooks | When endpoint changes |
| REDIS_ENDPOINT | Redis Cloud | Rarely |
| REDIS_API_KEY | Redis Cloud | Quarterly |
| SENTRY_DSN | Sentry Errors | Rarely |
| RESEND_API_KEY | Resend Email | Quarterly |
| ADMIN_API_KEY | Platform Admin | Monthly |

### 3.2 Rotating a Secret
```bash
# 1. Update the secret in SECRETS-THECALLING.ini (local file)
# 2. Push updated secret to Cloudflare
echo "new_secret_value" | npx wrangler secret put SECRET_NAME

# 3. Verify by hitting health endpoint
curl -s https://thecalling-platform.adrper79.workers.dev/health | jq .
```

### 3.3 Bulk Secret Update
```bash
# Uses the deploy-secrets.sh script
bash scripts/deploy-secrets.sh
```
**IMPORTANT:** Never commit `SECRETS-THECALLING.ini` to Git. It is in `.gitignore`.

---

## 4. GAME MANAGEMENT

### 4.1 Create a New Game
```bash
ADMIN_KEY="<your-admin-api-key>"  # retrieve from wrangler secret list or your password manager
TEMPLATE_ID="7d8ef6a1-eede-4a12-bdd0-f55e8a97b5c9"

curl -s -X POST https://thecalling-platform.adrper79.workers.dev/admin/games \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"scheduledAt\": \"$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)\",
    \"entryFee\": 500,
    \"maxPlayers\": 100
  }" | jq .
```

### 4.2 List Available Games
```bash
curl -s https://thecalling-platform.adrper79.workers.dev/api/games | jq .
```

### 4.3 Check Game Status
```bash
GAME_ID="bd6bc94c-4fc0-48a0-8be7-c088582cee1c"
curl -s "https://thecalling-platform.adrper79.workers.dev/api/games/$GAME_ID" | jq .
```

### 4.4 Game Lifecycle States
```
scheduled → active → completed
                  → cancelled (admin action)
```

### 4.5 Template Types
| Type | Handler | Description |
|------|---------|-------------|
| `trivia` | TriviaHandler | Standard trivia |
| `elimination_trivia` | TriviaHandler | Progressive elimination trivia (current seed template) |

---

## 5. DATABASE OPERATIONS

### 5.1 Connection Details
- **Provider:** Neon Postgres v17
- **Project:** `floral-rain-53649452`
- **Database:** `neondb`
- **Region:** us-east-1
- **Console:** https://console.neon.tech

### 5.2 Tables (7)
| Table | Purpose |
|-------|---------|
| game_templates | Game type definitions |
| game_content | Questions/content per template |
| game_instances | Active/scheduled game sessions |
| players | Registered player profiles |
| game_participants | Player-game registrations |
| player_turns | Per-turn answer records |
| payouts | Winner payout records |

### 5.3 Adding New Questions
```sql
INSERT INTO game_content (template_id, content_data, difficulty)
VALUES (
  '7d8ef6a1-eede-4a12-bdd0-f55e8a97b5c9',
  '{"question": "What is the capital of France?", "correct_answer": "Paris", "alternatives": ["London", "Berlin", "Madrid"], "category": "geography"}'::jsonb,
  'easy'
);
```

### 5.4 Database Maintenance
- **Backups:** Managed by Neon (point-in-time recovery)
- **Branching:** Use Neon branching for schema changes
- **Migrations:** Test on a Neon branch before applying to main

---

## 6. SCALING & PERFORMANCE

### 6.1 Current Limits
| Resource | Limit | Notes |
|----------|-------|-------|
| Worker CPU | 10ms (free) / 50ms (paid) | Per-request |
| Worker Memory | 128 MB | Per isolate |
| Telnyx Concurrent Calls | Check plan | Verify with Telnyx |
| ElevenLabs Characters | Plan-dependent | Monitor usage |
| Neon Connections | 100 (pooled) | Use connection pooling |

### 6.2 Scaling Strategy (when needed)
1. **10-50 players:** Current architecture handles this
2. **50-200 players:** Monitor Worker CPU, consider Durable Objects
3. **200+ players:** Durable Objects + Redis pub/sub game coordination
4. **1000+ players:** Dedicated Telnyx SIP infrastructure

### 6.3 Performance Baselines
| Metric | Measured Value |
|--------|---------------|
| Worker startup | 29-32ms |
| Health endpoint | ~480ms (incl. all 6 service checks) |
| Full test suite | ~7 seconds (81 tests) |
| Worker bundle | 399.99 KiB (gzip: 91.47 KiB) |

---

## 7. TROUBLESHOOTING GUIDE

### 7.1 Health Check Fails
**Database = false:**
- Check Neon console for outages
- Verify NEON_DATABASE_URL secret is valid
- Try: `npx wrangler secret put NEON_DATABASE_URL` with current value

**Redis = false:**
- Check Redis Cloud console
- Verify REDIS_ENDPOINT and REDIS_API_KEY
- Note: Platform uses in-memory fallback if Redis is down

**Deepgram/ElevenLabs/OpenAI = false:**
- Check API key validity (may have expired)
- Check service status pages
- Rotate key if needed

**Stripe = false:**
- Check Stripe dashboard for key status
- Verify STRIPE_SECRET_KEY hasn't been rolled
- Check if key starts with `sk_test_` (test) or `sk_live_` (production)

### 7.2 Webhook Issues
**Telnyx webhooks not arriving:**
1. Check Telnyx portal → Messaging/Voice → Connection → Webhook URL
2. Verify URL: `https://thecalling-platform.adrper79.workers.dev/webhooks/telnyx/{gameId}`
3. Check Cloudflare Workers logs: `npx wrangler tail`

**Stripe webhooks not arriving:**
1. Check Stripe Dashboard → Developers → Webhooks
2. Verify URL: `https://thecalling-platform.adrper79.workers.dev/webhooks/stripe`
3. Check webhook signing secret matches STRIPE_WEBHOOK_SECRET
4. Review Stripe webhook attempt logs for failures

### 7.3 Game Not Starting
1. Check game status via API: should be `scheduled`
2. Verify enough paid participants
3. Check Worker logs: `npx wrangler tail`
4. Verify Telnyx can make outbound calls

### 7.4 Live Debugging
```bash
# Stream Worker logs in real-time
npx wrangler tail

# Filter for errors only
npx wrangler tail --format=json | jq 'select(.level == "error")'
```

---

## 8. MAINTENANCE WINDOWS

### 8.1 Recommended Schedule
| Task | Frequency | Duration |
|------|-----------|----------|
| Secret rotation | Monthly (ADMIN_API_KEY), Quarterly (others) | 15 min |
| Database review | Weekly | 30 min |
| Sentry triage | Daily during active games | 15 min |
| Full test suite | Before every deploy | 5 min |
| Cost review | Monthly | 30 min |
| Dependency updates | Monthly | 1 hour |

### 8.2 Best Times for Maintenance
- No games scheduled
- Low-traffic periods (early morning UTC)
- Never during an active game session

---

## 9. COST MANAGEMENT

### 9.1 Service Cost Overview
| Service | Tier | Key Cost Driver |
|---------|------|----------------|
| Cloudflare Workers | Free (100K/day) | Requests |
| Neon Postgres | Free (0.5 GB) | Storage & compute |
| Redis Cloud | Free (30 MB) | Memory usage |
| Telnyx | Pay-per-use | Call minutes |
| Deepgram | Pay-per-use | Audio minutes |
| ElevenLabs | Subscription | Characters |
| OpenAI | Pay-per-use | Tokens (gpt-4o-mini) |
| Stripe | 2.9% + $0.30 | Transactions |

### 9.2 Per-Game Cost Estimate (10 players, 5 rounds)
| Item | Est. Cost |
|------|-----------|
| Telnyx calls (10 × 5 min) | ~$2.50 |
| Deepgram STT (50 utterances) | ~$0.50 |
| ElevenLabs TTS (questions) | ~$0.10 |
| OpenAI fuzzy matching | ~$0.05 |
| Stripe processing (10 × $5) | ~$1.75 |
| **Total** | **~$4.90** |

### 9.3 Revenue Model
- Entry fee: $5.00 per player
- 10 players = $50.00 gross
- Costs: ~$4.90
- Platform take: configurable (e.g., 20% = $10.00)
- Prize pool: ~$35.10

---

*End of Operational Runbook*
