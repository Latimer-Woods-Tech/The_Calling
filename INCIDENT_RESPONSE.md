# INCIDENT RESPONSE PROCEDURES — The Calling Voice Game Platform

> **Version:** 1.0 | **Last Updated:** 2026-02-25  
> **Severity Levels:** SEV-1 (Critical) → SEV-4 (Informational)

---

## 1. SEVERITY CLASSIFICATION

| Severity | Description | Response Time | Examples |
|----------|-------------|---------------|----------|
| **SEV-1** | Platform down, active game affected | 15 min | Worker crash, DB unreachable during game |
| **SEV-2** | Major feature broken, no active game | 1 hour | Payment processing failed, voice calls not connecting |
| **SEV-3** | Degraded performance or minor feature broken | 4 hours | Slow STT response, email delivery delayed |
| **SEV-4** | Cosmetic or informational | 24 hours | Sentry noise, non-critical log warnings |

---

## 2. INCIDENT DETECTION

### 2.1 Automated Detection
| Source | What It Detects | Action |
|--------|----------------|--------|
| Sentry | Runtime errors, unhandled exceptions | Check Sentry dashboard |
| Cloudflare Analytics | Error rate spikes, request failures | Check Workers dashboard |
| Stripe Webhooks | Failed payments, disputes | Check Stripe dashboard |
| Health Endpoint | Service connectivity failures | Automated monitoring (recommended) |

### 2.2 Manual Detection
- Player complaints (no call received, audio issues)
- Admin API returns errors
- Game doesn't start at scheduled time
- Webhook delivery failures in Telnyx/Stripe dashboards

### 2.3 Quick Diagnosis Command
```bash
# Check all services at once
curl -s https://thecalling-platform.adrper79.workers.dev/health | jq .

# Stream live Worker logs
npx wrangler tail

# Check Sentry for recent errors
# → https://sentry.io (check project dashboard)
```

---

## 3. RESPONSE PROCEDURES BY SCENARIO

### 3.1 SEV-1: Worker Completely Down

**Symptoms:** All endpoints return 5xx or timeout  
**Response Time:** 15 minutes

**Steps:**
1. **Confirm** — Hit health endpoint. If 5xx, confirm via Cloudflare dashboard
2. **Check** — Cloudflare status page (https://cloudflarestatus.com)
3. **If Cloudflare outage:** Wait for resolution, notify players via email (Resend)
4. **If our code broke:**
   ```bash
   # Check recent deployments
   npx wrangler deployments list
   
   # Rollback to last known good version
   npx wrangler rollback
   
   # Verify
   curl -s https://thecalling-platform.adrper79.workers.dev/health | jq .
   ```
5. **If active game:** Mark game as `cancelled`, process refunds via Stripe
6. **Post-incident:** RCA within 24 hours

### 3.2 SEV-1: Database Unreachable During Active Game

**Symptoms:** Health check shows `database: false`, game operations fail  
**Response Time:** 15 minutes

**Steps:**
1. **Check Neon status:** https://console.neon.tech
2. **If Neon outage:** In-memory game state continues. Game can proceed but results won't persist
3. **If connection error:**
   ```bash
   # Verify DATABASE_URL is correct
   # Re-push if needed
   echo "NEW_URL" | npx wrangler secret put NEON_DATABASE_URL
   ```
4. **Immediate action:** Game state is maintained in-memory (GameStateManager fallback)
5. **Post-game:** Manually reconcile results if database was unavailable during game

### 3.3 SEV-2: Telnyx Voice Calls Not Connecting

**Symptoms:** Players don't receive calls, Telnyx webhook errors  
**Response Time:** 1 hour

**Steps:**
1. **Check Telnyx portal** for service status
2. **Check connection ID:**
   - Verify Connection ID `2887319279378629637` is active
   - Verify phone number `+17757172255` is attached
3. **Check webhook URL:**
   - Must be `https://thecalling-platform.adrper79.workers.dev/webhooks/telnyx/{gameId}`
4. **Test outbound call manually** via Telnyx portal
5. **If API key issue:**
   ```bash
   echo "NEW_KEY" | npx wrangler secret put TELNYX_API_KEY
   ```
6. **If pre-game:** Delay game start, notify registered players via email
7. **If mid-game:** Cannot recover voice; cancel game and refund

### 3.4 SEV-2: Stripe Payment Processing Failed

**Symptoms:** Players can't pay entry fees, webhook errors  
**Response Time:** 1 hour

**Steps:**
1. **Check Stripe dashboard** for system status
2. **Check webhook delivery** in Stripe Dashboard → Developers → Webhooks
3. **Verify webhook secret:**
   ```bash
   # If signing secret changed
   echo "NEW_SECRET" | npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
4. **Check test vs live keys:** Ensure correct mode for environment
5. **If pre-game:** Players cannot register; delay game
6. **Manual override:** Admin can mark players as paid if Stripe confirms payment received

### 3.5 SEV-2: Speech Services Degraded (Deepgram/ElevenLabs)

**Symptoms:** Slow/failed transcription or text-to-speech  
**Response Time:** 1 hour

**Steps:**
1. **Deepgram down:**
   - Platform has AssemblyAI as fallback STT
   - Modify transcription client to route to AssemblyAI
2. **ElevenLabs down:**
   - No automated fallback currently
   - Option: Use Telnyx TTS (built-in, lower quality) as emergency fallback
3. **Both down:**
   - Cannot run voice games; delay/cancel
4. **Rotate keys if expired:**
   ```bash
   echo "NEW_KEY" | npx wrangler secret put DEEPGRAM_API_KEY
   echo "NEW_KEY" | npx wrangler secret put ELEVENLABS_API_KEY
   ```

### 3.6 SEV-3: OpenAI Fuzzy Matching Slow/Failed

**Symptoms:** Answer validation takes too long or returns errors  
**Response Time:** 4 hours

**Steps:**
1. **Check OpenAI status** page
2. **Impact:** Answers may be validated only via exact match (stricter but functional)
3. **Temporary fix:** Lower timeout for AI calls, fall back to string comparison
4. **Rotate key if needed:**
   ```bash
   echo "NEW_KEY" | npx wrangler secret put OPENAI_API_KEY
   ```

### 3.7 SEV-3: Redis Down

**Symptoms:** Health check shows `redis: false`  
**Response Time:** 4 hours

**Steps:**
1. **Impact: LOW** — Platform uses in-memory fallback automatically
2. **Check Redis Cloud console** for service status
3. **If persistent:** Verify REDIS_ENDPOINT and REDIS_API_KEY
4. **No immediate action needed** — game state is maintained in-memory

### 3.8 SEV-3: Email Delivery Failed (Resend)

**Symptoms:** Confirmation/notification emails not delivered  
**Response Time:** 4 hours

**Steps:**
1. **Check Resend dashboard** for delivery status
2. **Impact: LOW** — Email is not critical to game operations
3. **Rotate key if expired:**
   ```bash
   echo "NEW_KEY" | npx wrangler secret put RESEND_API_KEY
   ```

---

## 4. GAME CANCELLATION & REFUND PROCEDURE

### 4.1 When to Cancel
- SEV-1 incident during active game that cannot be resolved in 5 minutes
- Voice services completely unavailable
- Database unreachable AND no in-memory state available

### 4.2 Refund Process
```bash
# 1. Get game participants with payment info
ADMIN_KEY="YOUR_ADMIN_KEY"
GAME_ID="GAME_ID_HERE"

curl -s "https://thecalling-platform.adrper79.workers.dev/api/games/$GAME_ID" \
  -H "Authorization: Bearer $ADMIN_KEY" | jq .

# 2. Process refunds via Stripe Dashboard
# → Stripe Dashboard → Payments → Select payments → Issue Refund

# 3. Update game status (via direct DB if needed)
# UPDATE game_instances SET status = 'cancelled' WHERE id = 'GAME_ID';
```

### 4.3 Player Communication
- Send email via Resend explaining cancellation and refund
- Include estimated time for next game

---

## 5. ROLLBACK PROCEDURES

### 5.1 Code Rollback
```bash
# List deployments
npx wrangler deployments list

# Rollback
npx wrangler rollback

# Verify
curl -s https://thecalling-platform.adrper79.workers.dev/health | jq .
```

### 5.2 Secret Rollback
Secrets cannot be "rolled back" — you must re-push the previous value:
```bash
echo "PREVIOUS_VALUE" | npx wrangler secret put SECRET_NAME
```
Keep a secure backup of all active secrets in `SECRETS-THECALLING.ini`.

### 5.3 Database Rollback
```
Neon provides point-in-time recovery:
1. Go to Neon Console → Project → Branches
2. Create a new branch from a point before the incident
3. Update DATABASE_URL to point to the recovery branch
4. Push updated secret to Cloudflare
```

---

## 6. POST-INCIDENT PROCESS

### 6.1 Root Cause Analysis (RCA) Template
```markdown
## Incident Report: [TITLE]
**Date:** YYYY-MM-DD
**Severity:** SEV-X
**Duration:** HH:MM
**Impact:** [Who/what was affected]

### Timeline
- HH:MM — Incident detected
- HH:MM — Response initiated
- HH:MM — Root cause identified
- HH:MM — Fix deployed
- HH:MM — Normal operations restored

### Root Cause
[Description]

### Resolution
[What was done]

### Action Items
- [ ] Preventive measure 1
- [ ] Preventive measure 2

### Lessons Learned
[What we learned]
```

### 6.2 Post-Incident Checklist
- [ ] Health endpoint returns healthy
- [ ] Full test suite passes (81/81)
- [ ] Sentry shows no new errors
- [ ] RCA document created
- [ ] LESSONS_LEARNED.md updated
- [ ] RISK_REGISTER.md updated if new risk identified
- [ ] Team notified of resolution

---

## 7. CONTACT REFERENCE

| Service | Status Page | Support |
|---------|-------------|---------|
| Cloudflare | cloudflarestatus.com | support@cloudflare.com |
| Neon | neon.tech/status | support@neon.tech |
| Telnyx | status.telnyx.com | support@telnyx.com |
| Stripe | status.stripe.com | support@stripe.com |
| Deepgram | status.deepgram.com | support@deepgram.com |
| ElevenLabs | status.elevenlabs.io | support@elevenlabs.io |
| OpenAI | status.openai.com | N/A |
| Sentry | status.sentry.io | support@sentry.io |

---

*End of Incident Response Procedures*
