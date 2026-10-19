#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Sets up a Supabase Cloud project as Zappion's backend and database, in one run.
#
# What it does, in order (safe to run again; every step is idempotent):
#   1. links api/ to the project
#   2. applies the database migrations (no seed: demo data never goes to the cloud)
#   3. stores the two Vault secrets the database uses to call the Edge Functions
#   4. deploys every Edge Function
#   5. sets the functions' secrets from your env file
# and prints what is left to do by hand (Auth URLs, Meta webhook, the web's env vars).
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=... SUPABASE_DB_PASSWORD=... \
#     scripts/setup-cloud.sh --project-ref <ref> [--env-file <path>] [--dry-run]
#
#   SUPABASE_ACCESS_TOKEN  personal access token: https://supabase.com/dashboard/account/tokens
#   SUPABASE_DB_PASSWORD   the project's database password (set when the project was created)
#   --project-ref          the id in https://supabase.com/dashboard/project/<ref>
#   --env-file             functions secrets (default: api/supabase/functions/.env, see its .env.example)
#   --dry-run              print the commands instead of running them; nothing is changed

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/api"
ENV_FILE="$API/supabase/functions/.env"
REF=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project-ref) REF="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1 (see --help)" >&2; exit 1 ;;
  esac
done

fail() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
# Runs a command, or prints it in a dry run. Secret values never reach the screen.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    local arg prev="" line="   \$"
    for arg in "$@"; do
      if [ "$prev" = "--password" ]; then line+=" ***"; else line+=" $(printf '%q' "$arg")"; fi
      prev="$arg"
    done
    echo "$line"
  else
    "$@"
  fi
}

[ -n "$REF" ] || fail "--project-ref is required (see --help)"
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || fail "'$REF' does not look like a project ref (20 lowercase letters and digits)"
for tool in supabase jq curl; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || fail "set SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)"
[ -n "${SUPABASE_DB_PASSWORD:-}" ] || fail "set SUPABASE_DB_PASSWORD (the project's database password)"
[ -f "$ENV_FILE" ] || fail "no env file at $ENV_FILE; copy api/supabase/functions/.env.example and fill it in"

PROJECT_URL="https://$REF.supabase.co"
export SUPABASE_ACCESS_TOKEN

# Runs SQL on the project through the Management API (the CLI has no remote SQL command).
sql() {
  curl -fsS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$1" '{query: $q}')" >/dev/null
}

# Creates or updates a Vault secret by name.
vault_secret() {
  local q="'"
  local name="$1" value="${2//$q/$q$q}"
  if [ "$DRY_RUN" = 1 ]; then
    echo "   (Management API) set Vault secret $name"
    return
  fi
  sql "do \$\$ begin
    if exists (select 1 from vault.secrets where name = '$name') then
      perform vault.update_secret((select id from vault.secrets where name = '$name'), '$value');
    else
      perform vault.create_secret('$value', '$name');
    end if;
  end \$\$;"
}

[ "$DRY_RUN" = 1 ] && echo "Dry run: nothing will be changed."

step "1/5 Linking api/ to project $REF"
run supabase link --workdir "$API" --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD"

step "2/5 Applying database migrations"
run supabase db push --workdir "$API" --linked --password "$SUPABASE_DB_PASSWORD"

step "3/5 Storing the Vault secrets the database uses to call the Edge Functions"
# The new keys (sb_secret_/sb_publishable_) first: projects created since November 2025 have only
# those. The legacy service_role/anon keys are the fallback for older projects.
if [ "$DRY_RUN" = 1 ]; then
  SECRET_KEY="<secret key>"
  PUBLISHABLE_KEY="<publishable key>"
else
  KEYS="$(supabase projects api-keys --project-ref "$REF" --reveal -o json)"
  pick() { echo "$KEYS" | jq -r "[.[] | select($1) | .api_key][0] // empty"; }
  SECRET_KEY="${SUPABASE_SECRET_KEY:-$(pick '(.api_key // "") | startswith("sb_secret_")')}"
  SECRET_KEY="${SECRET_KEY:-$(pick '.name == "service_role"')}"
  PUBLISHABLE_KEY="$(pick '(.api_key // "") | startswith("sb_publishable_")')"
  PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-$(pick '.name == "anon"')}"
  [ -n "$SECRET_KEY" ] || fail "no secret key found; create one (Settings > API Keys) or set SUPABASE_SECRET_KEY"
fi
vault_secret edge_functions_url "$PROJECT_URL/functions/v1"
vault_secret edge_functions_token "$SECRET_KEY"

step "4/5 Deploying the Edge Functions"
run supabase functions deploy --workdir "$API" --project-ref "$REF" --use-api

step "5/5 Setting the functions' secrets from $ENV_FILE"
# Empty values are skipped, SUPABASE_* names are reserved by Supabase, and a local or ngrok
# WEBHOOK_PUBLIC_URL is replaced by the project URL, which is where Meta must send webhooks.
SECRETS="$(mktemp)"
trap 'rm -f "$SECRETS"' EXIT
tr -d '\r' < "$ENV_FILE" | grep -E '^[A-Z0-9_]+=.+' | grep -v -E '^SUPABASE_' \
  | grep -v -E '^WEBHOOK_PUBLIC_URL=.*(localhost|127\.0\.0\.1|ngrok)' > "$SECRETS" || true
grep -q '^WEBHOOK_PUBLIC_URL=' "$SECRETS" || echo "WEBHOOK_PUBLIC_URL=$PROJECT_URL" >> "$SECRETS"
echo "   $(cut -d= -f1 "$SECRETS" | tr '\n' ' ')"
run supabase secrets set --workdir "$API" --project-ref "$REF" --env-file "$SECRETS"

WEBHOOK_BASE="$(grep '^WEBHOOK_PUBLIC_URL=' "$SECRETS" | cut -d= -f2-)"

cat <<EOF

Done. The backend and database are live at $PROJECT_URL.

Left to do by hand:
  1. Supabase Dashboard > Authentication > URL Configuration: set Site URL to where the web
     runs (e.g. https://app.example.com) and add it to the Redirect URLs.
  2. Supabase Dashboard > Authentication > OAuth Server: enable it, with the authorization path
     /oauth/consent and dynamic registration on (needed for Claude/ChatGPT to sign in to the MCP).
  3. Meta App > WhatsApp > Configuration: callback URL
     $WEBHOOK_BASE/functions/v1/whatsapp-webhook
     (or use "Configure webhook automatically" in the web's Settings > Meta App).
  4. Host web/ (any Next.js host) with these environment variables:
     NEXT_PUBLIC_SUPABASE_URL=$PROJECT_URL
     NEXT_PUBLIC_SUPABASE_ANON_KEY=${PUBLISHABLE_KEY:-<the project's publishable key>}
     NEXT_PUBLIC_SIGNUP_URL=<where signup/ is hosted>/conectar
EOF
