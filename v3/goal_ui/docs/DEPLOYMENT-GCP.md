# Deploying RuFlo Research to Google Cloud Platform

> Concrete commands for deploying `v3/goal_ui/` to GCP. Replaces the Netlify/Lovable
> assumptions in `docs/DEPLOYMENT.md`. Adopts ADR-093 (Anthropic-direct + Secret
> Manager), ADR-094 (security primitives), and ADR-098 (MCP server topology).

## Topology

```
                ┌──────────────────────────────────┐
                │ Frontend (Vite SPA + widget.js)  │
                │  Firebase Hosting OR Cloud Run   │
                │  https://goal.ruv.io             │
                └────────────────┬─────────────────┘
                                 │ POST /functions/v1/<name>
                                 ▼
                ┌──────────────────────────────────┐
                │ Cloud Functions Gen2 (Node 22)   │
                │  4 handlers, one fn each:        │
                │   - generate-research-goal       │
                │   - research-step                │
                │   - generate-action-items        │
                │   - optimize-research-config     │
                └────────────────┬─────────────────┘
                                 │ Anthropic Messages API
                                 │ (key from Secret Manager)
                                 ▼
                ┌──────────────────────────────────┐
                │ Anthropic API                    │
                │  https://api.anthropic.com/v1/   │
                └──────────────────────────────────┘
```

The MCP server (R-5.2 / `functions/mcp/server.ts`) is **not deployed to GCP** — it
uses stdio transport and runs locally on the operator's machine via
`npx tsx` per-CLI install.

## One-time setup

### 1. Tools

```bash
# Install gcloud (skip if already installed)
brew install --cask google-cloud-sdk    # macOS
# OR: curl https://sdk.cloud.google.com | bash

gcloud auth login
gcloud config set project <PROJECT_ID>
```

### 2. Enable APIs

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com
```

### 3. Anthropic API key in Secret Manager

```bash
# Create the secret
gcloud secrets create ruflo-anthropic-api-key \
  --replication-policy=automatic

# Add the value (paste your sk-ant-... key)
echo -n "sk-ant-YOUR-KEY-HERE" | \
  gcloud secrets versions add ruflo-anthropic-api-key --data-file=-

# Allow the default Cloud Functions runtime SA to read it
gcloud secrets add-iam-policy-binding ruflo-anthropic-api-key \
  --member="serviceAccount:$(gcloud config get-value project)@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

The secret name (`ruflo-anthropic-api-key`) is what `functions/_lib/secrets.ts`
queries by default. Override via `RUFLO_ANTHROPIC_SECRET_NAME` env var if needed.

## Deploy the 4 functions

Run from `v3/goal_ui/`:

```bash
PROJECT_ID="$(gcloud config get-value project)"
REGION="us-central1"
RUFLO_TOKEN="$(openssl rand -hex 32)"   # weak abuse-control token; rotate periodically

# Deploy each handler — same env, same source dir.
# `--source` packages the entire goal_ui/ but only the named entry-point matters.
for FN in generate-research-goal research-step generate-action-items optimize-research-config; do
  gcloud functions deploy "ruflo-${FN}" \
    --gen2 \
    --runtime=nodejs22 \
    --region="${REGION}" \
    --source=. \
    --entry-point=handler \
    --trigger-http \
    --allow-unauthenticated \
    --set-env-vars="RUFLO_FUNCTIONS_TOKEN=${RUFLO_TOKEN},RUFLO_ALLOWED_ORIGINS=https://goal.ruv.io,RUFLO_RATE_LIMIT_PER_MIN=60,GCLOUD_PROJECT_ID=${PROJECT_ID}" \
    --set-secrets="ANTHROPIC_API_KEY=ruflo-anthropic-api-key:latest" \
    --memory=512MiB \
    --timeout=60s
done
```

> Each handler exports a function named `handler` (see `functions/<name>/index.ts`).
> The `--entry-point=handler` flag points GCF at it.

After deploy, capture the trigger URLs:

```bash
for FN in generate-research-goal research-step generate-action-items optimize-research-config; do
  gcloud functions describe "ruflo-${FN}" --region="${REGION}" \
    --format="value(serviceConfig.uri)"
done
```

## Deploy the frontend

Pick **one** of these.

### Option A — Firebase Hosting (simplest)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# - Public directory: dist
# - Single-page app: yes
# - Set up GitHub integration: no
firebase deploy --only hosting
```

Set the SPA's function base URL **before** building:

```bash
# In v3/goal_ui/.env.production:
VITE_FUNCTIONS_BASE_URL=https://us-central1-${PROJECT_ID}.cloudfunctions.net/ruflo-
VITE_FUNCTIONS_PUBLIC_TOKEN=<same as RUFLO_TOKEN above>
VITE_RVF_ENABLED=true
```

The SPA appends each function name to `VITE_FUNCTIONS_BASE_URL`; with the prefix
`ruflo-`, calls become `…/ruflo-generate-research-goal` etc., matching the GCF
deploy names.

### Option B — Cloud Run + nginx

```bash
# Build
npm run build

# Containerize (adds a Dockerfile if not present)
cat > Dockerfile <<'EOF'
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EOF

cat > nginx.conf <<'EOF'
server {
  listen 8080;
  root /usr/share/nginx/html;
  location / { try_files $uri /index.html; }
}
EOF

# Deploy
gcloud run deploy ruflo-research \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

## Update CORS allowlist on functions

After the frontend URL is known, update `RUFLO_ALLOWED_ORIGINS`:

```bash
for FN in generate-research-goal research-step generate-action-items optimize-research-config; do
  gcloud functions deploy "ruflo-${FN}" \
    --update-env-vars="RUFLO_ALLOWED_ORIGINS=https://goal.ruv.io,https://${PROJECT_ID}.web.app"
done
```

## Quick local-dev to GCP-prod cutover checklist

| Concern | Local dev | GCP prod |
|---|---|---|
| Functions URL | `http://localhost:8787` | `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/ruflo-…` |
| Anthropic key source | `ANTHROPIC_API_KEY` env | Secret Manager (`ruflo-anthropic-api-key`) |
| `VITE_FUNCTIONS_BASE_URL` | `http://localhost:8787` | `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/ruflo-` |
| `VITE_FUNCTIONS_PUBLIC_TOKEN` | `dev-token-change-me` | rotate per deploy (`openssl rand -hex 32`) |
| `RUFLO_FUNCTIONS_TOKEN` | n/a | matches public token |
| `RUFLO_ALLOWED_ORIGINS` | `localhost:8080,goal.ruv.io` | `goal.ruv.io,${PROJECT_ID}.web.app` |
| `RUFLO_USE_SWARM` (R-3.2) | unset = single-call | set `true` if quality > cost |

## Rollback

```bash
# Roll a function back to a previous version
gcloud functions describe "ruflo-${FN}" --region="${REGION}" \
  --format="value(buildConfig.source.versionId)"
gcloud functions deploy "ruflo-${FN}" --region="${REGION}" \
  --source=https://source.developers.google.com/projects/${PROJECT_ID}/repos/${REPO}/revisions/${PREV_VERSION}/paths/v3/goal_ui

# Or simply re-deploy from a known-good git ref:
git checkout <good-sha> -- v3/goal_ui/functions/${FN}/
# … then re-run the deploy loop above.
```

## Known caveats / TODOs

- **Cold start**: first call to each function ~2-5s; subsequent calls warm (~50ms).
  Consider `--min-instances=1` per function if user-perceived latency matters.
- **Region pinning**: keep frontend and functions in the same region to avoid
  egress costs. `us-central1` is the cheapest default.
- **Cost tracking**: per ADR-093 §S5, run `npm run check:audit` before each
  deploy. Bundle-size-watcher (R-7.3) catches frontend bloat regressions.
- **MCP server topology**: ADR-098's `goal_ui-research` MCP server is operator-
  local. To make it remote-callable, wrap it in a Cloud Run service with HTTP
  transport — out of scope for the initial GCP deploy.
- **Auto-deploy from CI**: not wired today. R-7.x covers PR/nightly worker
  workflows but doesn't push code to GCP. Add a `goal_ui-deploy.yml` workflow
  that runs the deploy loop on `push: main` once the staging->prod story is
  agreed.
