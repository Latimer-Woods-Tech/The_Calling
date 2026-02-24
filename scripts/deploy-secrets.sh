#!/bin/bash
# ============================================================================
# The Calling — Deploy Secrets to Cloudflare Workers
# ============================================================================
# Reads SECRETS-THECALLING.ini and pushes each value to Cloudflare Workers
# as a secret via `wrangler secret put`.
#
# USAGE:
#   chmod +x scripts/deploy-secrets.sh
#   ./scripts/deploy-secrets.sh
#
# PREREQUISITES:
#   - wrangler CLI installed and authenticated (`wrangler login`)
#   - SECRETS-THECALLING.ini in project root
# ============================================================================

set -e

SECRETS_FILE="${1:-SECRETS-THECALLING.ini}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ ! -f "$PROJECT_DIR/$SECRETS_FILE" ]]; then
  echo "❌ $SECRETS_FILE not found in $PROJECT_DIR"
  exit 1
fi

echo "=== Deploying secrets from $SECRETS_FILE ==="
echo ""

# Mapping: SECRETS-THECALLING.ini key → Cloudflare Worker env var name
declare -A SECRET_MAP=(
  ["NEON_CONNECTION_STRING"]="NEON_DATABASE_URL"
  ["TELNYX_API_KEY"]="TELNYX_API_KEY"
  ["TELNYX_CONNECTION_ID"]="TELNYX_CONNECTION_ID"
  ["TELNYX_PHONE_NUMBER"]="TELNYX_PHONE_NUMBER"
  ["DEEPGRAM_API_TOKEN"]="DEEPGRAM_API_KEY"
  ["ASSEMBLYAI_API_KEY"]="ASSEMBLYAI_API_KEY"
  ["ELEVENLABS_API_KEY"]="ELEVENLABS_API_KEY"
  ["OPENAI_API_KEY"]="OPENAI_API_KEY"
  ["STRIPE_SECRET_KEY"]="STRIPE_SECRET_KEY"
  ["REDIS_PUBLIC_ENDPOINT"]="REDIS_ENDPOINT"
  ["REDIS_API_KEY"]="REDIS_API_KEY"
  ["SENTRY_DSN"]="SENTRY_DSN"
  ["RESEND_API_TOKEN"]="RESEND_API_KEY"
  ["STRIPE_WEBHOOK_SECRET"]="STRIPE_WEBHOOK_SECRET"
)

# Read secrets file
declare -A SECRETS
while IFS='=' read -r key value; do
  key="$(echo "$key" | xargs)"
  value="$(echo "$value" | xargs)"
  [[ -z "$key" || "$key" == \#* || "$key" == \[* ]] && continue

  # Handle OPENAI_API_KEY prefix quirk
  if [[ "$key" == "OPENAI_API_KEY" && "$value" == OPENAI_API_KEY:* ]]; then
    value="${value#OPENAI_API_KEY:}"
    value="$(echo "$value" | xargs)"
  fi

  SECRETS["$key"]="$value"
done < "$PROJECT_DIR/$SECRETS_FILE"

# Push each secret
SUCCESS=0
SKIPPED=0
FAILED=0

for ini_key in "${!SECRET_MAP[@]}"; do
  cf_key="${SECRET_MAP[$ini_key]}"
  value="${SECRETS[$ini_key]:-}"

  if [[ -z "$value" ]]; then
    echo "⚠️  SKIP: $ini_key → $cf_key (no value in secrets file)"
    ((SKIPPED++))
    continue
  fi

  echo -n "  $ini_key → $cf_key ... "
  if echo "$value" | wrangler secret put "$cf_key" --name "thecalling-platform" 2>/dev/null; then
    echo "✅"
    ((SUCCESS++))
  else
    echo "❌ FAILED"
    ((FAILED++))
  fi
done

# Additional secrets not in the INI file
echo ""
echo "=== Manual secrets (set these yourself): ==="
echo "  wrangler secret put ELEVENLABS_VOICE_ID    # e.g., 21m00Tcm4TlvDq8ikWAM"
echo "  wrangler secret put STRIPE_WEBHOOK_SECRET   # from Stripe Dashboard"
echo "  wrangler secret put ADMIN_API_KEY           # generate: openssl rand -hex 32"

echo ""
echo "=== Summary ==="
echo "  ✅ Pushed: $SUCCESS"
echo "  ⚠️  Skipped: $SKIPPED"
echo "  ❌ Failed: $FAILED"
echo ""
echo "Next steps:"
echo "  1. Set manual secrets listed above"
echo "  2. Run: wrangler deploy"
echo "  3. Verify: curl https://thecalling-platform.workers.dev/"
