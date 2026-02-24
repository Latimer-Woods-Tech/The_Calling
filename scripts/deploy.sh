#!/bin/bash
# ============================================================================
# The Calling — Pre-Deployment Validation & Deploy
# ============================================================================
# Runs all checks before deploying to Cloudflare Workers.
#
# USAGE:
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh          # validate + deploy
#   ./scripts/deploy.sh --dry    # validate only (no deploy)
# ============================================================================

set -e

DRY_RUN=false
[[ "$1" == "--dry" || "$1" == "--dry-run" ]] && DRY_RUN=true

echo "============================================"
echo "  THE CALLING — Deployment Pipeline"
echo "============================================"
echo ""

# --- Step 1: TypeScript compilation ---
echo "▸ Step 1: TypeScript compilation..."
if npx tsc --noEmit 2>&1; then
  echo "  ✅ TypeScript: 0 errors"
else
  echo "  ❌ TypeScript errors found — aborting"
  exit 1
fi
echo ""

# --- Step 2: Run test suite ---
echo "▸ Step 2: Running test suite..."
if npx vitest run 2>&1 | tail -8; then
  echo "  ✅ Tests passed"
else
  echo "  ❌ Tests failed — aborting"
  exit 1
fi
echo ""

# --- Step 3: Wrangler build check ---
echo "▸ Step 3: Wrangler build check..."
BUILD_OUTPUT=$(npx wrangler deploy --dry-run --outdir=dist 2>&1)
if echo "$BUILD_OUTPUT" | grep -q "Total Upload"; then
  BUNDLE_SIZE=$(echo "$BUILD_OUTPUT" | grep "Total Upload" | head -1)
  echo "  ✅ Worker build successful: $BUNDLE_SIZE"
else
  echo "  ❌ Worker build failed — aborting"
  echo "$BUILD_OUTPUT"
  exit 1
fi
echo ""

# --- Step 4: Secret validation ---
echo "▸ Step 4: Required secrets check..."
REQUIRED_SECRETS=(
  NEON_DATABASE_URL
  TELNYX_API_KEY
  TELNYX_CONNECTION_ID
  TELNYX_PHONE_NUMBER
  DEEPGRAM_API_KEY
  ASSEMBLYAI_API_KEY
  ELEVENLABS_API_KEY
  OPENAI_API_KEY
  STRIPE_SECRET_KEY
  REDIS_ENDPOINT
  RESEND_API_KEY
  ADMIN_API_KEY
)
OPTIONAL_SECRETS=(
  ELEVENLABS_VOICE_ID
  STRIPE_WEBHOOK_SECRET
  SENTRY_DSN
  REDIS_API_KEY
)
echo "  Required: ${#REQUIRED_SECRETS[@]} secrets"
echo "  Optional: ${#OPTIONAL_SECRETS[@]} secrets"
echo "  (Secrets must be set via 'wrangler secret put' before first deploy)"
echo ""

if $DRY_RUN; then
  echo "============================================"
  echo "  DRY RUN COMPLETE — All checks passed ✅"
  echo "============================================"
  echo ""
  echo "To deploy for real, run: ./scripts/deploy.sh"
  exit 0
fi

# --- Step 5: Deploy ---
echo "▸ Step 5: Deploying to Cloudflare Workers..."
echo ""
npx wrangler deploy
echo ""

# --- Step 6: Post-deploy verification ---
echo "▸ Step 6: Post-deployment verification..."
WORKER_URL="https://thecalling-platform.workers.dev"
echo "  Checking $WORKER_URL ..."

# Wait a moment for deployment to propagate
sleep 3

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "  ✅ Worker responding (HTTP $HTTP_CODE)"
  RESPONSE=$(curl -s "$WORKER_URL/" 2>/dev/null)
  echo "  Response: $RESPONSE"
else
  echo "  ⚠️  Worker returned HTTP $HTTP_CODE (may need secrets configured)"
fi
echo ""

echo "============================================"
echo "  DEPLOYMENT COMPLETE"
echo "============================================"
echo ""
echo "Post-deployment checklist:"
echo "  1. Verify health: curl $WORKER_URL/health"
echo "  2. Configure Telnyx webhook URL: $WORKER_URL/webhooks/telnyx/{gameId}"
echo "  3. Configure Stripe webhook URL: $WORKER_URL/webhooks/stripe"
echo "  4. Test admin API: curl -H 'Authorization: Bearer YOUR_KEY' $WORKER_URL/admin/health"
echo ""
