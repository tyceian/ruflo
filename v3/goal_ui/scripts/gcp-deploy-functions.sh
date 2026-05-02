#!/usr/bin/env bash
#
# Deploy the 4 wired goal_ui functions to Google Cloud Functions Gen2.
# See docs/DEPLOYMENT-GCP.md for one-time setup (gcloud auth, secret
# manager, IAM bindings).
#
# Usage:
#   bash scripts/gcp-deploy-functions.sh             # uses defaults
#   PROJECT_ID=my-proj REGION=us-east1 bash scripts/gcp-deploy-functions.sh
#
# Idempotent: re-running redeploys with the latest source.

set -euo pipefail

cd "$(dirname "$0")/.." # → v3/goal_ui/

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo '')}"
REGION="${REGION:-us-central1}"
SECRET_NAME="${RUFLO_ANTHROPIC_SECRET_NAME:-ruflo-anthropic-api-key}"
RUFLO_TOKEN="${RUFLO_FUNCTIONS_TOKEN:-}"
ALLOWED_ORIGINS="${RUFLO_ALLOWED_ORIGINS:-https://goal.ruv.io}"
RATE_LIMIT="${RUFLO_RATE_LIMIT_PER_MIN:-60}"

FUNCTIONS=(
  generate-research-goal
  research-step
  generate-action-items
  optimize-research-config
)

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID not set and \`gcloud config get-value project\` is empty" >&2
  echo "Run: gcloud config set project <PROJECT_ID>" >&2
  exit 2
fi

if [[ -z "$RUFLO_TOKEN" ]]; then
  echo "WARNING: RUFLO_FUNCTIONS_TOKEN not set — generating a fresh one for this deploy:"
  RUFLO_TOKEN="$(openssl rand -hex 32)"
  echo "  $RUFLO_TOKEN"
  echo "  (paste this as VITE_FUNCTIONS_PUBLIC_TOKEN in the frontend .env.production)"
fi

# Verify the secret exists. If not, refuse to deploy — better to fail
# loudly than to deploy a function that crashes on first invocation.
if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "ERROR: Secret Manager secret '$SECRET_NAME' not found in project '$PROJECT_ID'" >&2
  echo "  Create it: gcloud secrets create $SECRET_NAME --replication-policy=automatic" >&2
  echo "  Add value: echo -n 'sk-ant-…' | gcloud secrets versions add $SECRET_NAME --data-file=-" >&2
  exit 3
fi

echo "Deploying ${#FUNCTIONS[@]} functions to $PROJECT_ID/$REGION (secret: $SECRET_NAME)"
echo ""

for FN in "${FUNCTIONS[@]}"; do
  echo "→ deploying ruflo-$FN"
  gcloud functions deploy "ruflo-${FN}" \
    --gen2 \
    --runtime=nodejs22 \
    --region="$REGION" \
    --source=. \
    --entry-point=handler \
    --trigger-http \
    --allow-unauthenticated \
    --set-env-vars="RUFLO_FUNCTIONS_TOKEN=${RUFLO_TOKEN},RUFLO_ALLOWED_ORIGINS=${ALLOWED_ORIGINS},RUFLO_RATE_LIMIT_PER_MIN=${RATE_LIMIT},GCLOUD_PROJECT_ID=${PROJECT_ID}" \
    --set-secrets="ANTHROPIC_API_KEY=${SECRET_NAME}:latest" \
    --memory=512MiB \
    --timeout=60s \
    --quiet
  echo ""
done

echo "✓ All ${#FUNCTIONS[@]} functions deployed."
echo ""
echo "Trigger URLs:"
for FN in "${FUNCTIONS[@]}"; do
  URL="$(gcloud functions describe "ruflo-${FN}" --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null || echo 'unknown')"
  echo "  ruflo-${FN}: $URL"
done
echo ""
echo "Set the frontend's VITE_FUNCTIONS_BASE_URL to:"
echo "  https://${REGION}-${PROJECT_ID}.cloudfunctions.net/ruflo-"
echo "(SPA appends each function name; final URLs match the trigger URLs above.)"
