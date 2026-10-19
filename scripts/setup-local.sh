#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Sets up Zappion on this machine: local Supabase (database, Auth, Storage, Edge Functions), the web's
# env file, its dependencies, and a demo login. Safe to run again.
#
#   scripts/setup-local.sh
#
# Needs Docker (running), the Supabase CLI, Node 20+ and pnpm. Meta credentials are optional: without
# them the inbox works with simulated webhooks (scripts/send-webhook.mjs).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

for tool in docker supabase node pnpm; do
  command -v "$tool" >/dev/null || fail "$tool is not installed (see README › Running locally)"
done
docker info >/dev/null 2>&1 || fail "Docker is not running"

step "1/4 Env files"
# The functions read their .env when the containers are created, so it must exist before `supabase start`.
if [ ! -f api/supabase/functions/.env ]; then
  # Local-only Meta App values, so scripts/send-webhook.mjs can sign simulated webhooks. Replace them
  # with a real Meta App's values to connect a real number.
  random() { node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))'; }
  sed -e "s/^META_APP_ID=$/META_APP_ID=local-demo/" \
      -e "s/^META_APP_SECRET=$/META_APP_SECRET=$(random)/" \
      -e "s/^WHATSAPP_VERIFY_TOKEN=$/WHATSAPP_VERIFY_TOKEN=$(random)/" \
      api/supabase/functions/.env.example > api/supabase/functions/.env
  echo "   created api/supabase/functions/.env with local demo values (no real Meta App)"
else
  echo "   api/supabase/functions/.env already exists"
fi
if [ ! -f web/.env.local ]; then
  cp web/.env.example web/.env.local
  echo "   created web/.env.local"
fi

step "2/4 Starting Supabase (the first run downloads its Docker images)"
supabase start --workdir api

# Put the local URL and public key into web/.env.local.
STATUS="$(supabase status --workdir api -o env)"
value() { echo "$STATUS" | grep "^$1=" | head -1 | cut -d= -f2- | tr -d '"'; }
URL="$(value API_URL)"
KEY="$(value PUBLISHABLE_KEY)"
KEY="${KEY:-$(value ANON_KEY)}"
[ -n "$URL" ] && [ -n "$KEY" ] || fail "could not read the API URL and key from 'supabase status'"
set_env() {
  local file="web/.env.local" tmp
  tmp="$(mktemp)"
  awk -v k="$1" -v v="$2" 'BEGIN { done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next } { print }
    END { if (!done) print k "=" v }' "$file" > "$tmp" && mv "$tmp" "$file"
}
set_env NEXT_PUBLIC_SUPABASE_URL "$URL"
set_env NEXT_PUBLIC_SUPABASE_ANON_KEY "$KEY"
echo "   web/.env.local points to $URL"

step "3/4 Installing the web's dependencies"
pnpm --dir web install

step "4/4 Creating the demo login and organization"
node scripts/seed-dev.mjs --demo-number

EMAIL="$(grep '^TEST_USER_EMAIL=' web/.env.local | cut -d= -f2-)"
cat <<EOF

Done. Start the web and sign in:

  pnpm --dir web dev        # http://localhost:3100
  login: $EMAIL (password: TEST_USER_PASSWORD in web/.env.local)

Then simulate a customer writing to the demo number:

  node scripts/send-webhook.mjs inbound --phone-number-id 100000000000001 --business-number 5511900000000 --text "hi"

Supabase Studio (the database UI) is at http://127.0.0.1:54323.
EOF
