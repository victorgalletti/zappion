# Zappion

Open-source customer service on the official WhatsApp Business API (Cloud API), with coexistence.
Read `README.md` for the layout; what comes next is in the GitHub issues. The native Windows client
(`windows/`) is documented in `docs/WINDOWS.md`.

## Conventions

- **English** for code, comments, UI copy, commit messages, PRs and docs.
- `api/` started from open-bsp-api. Zappion-specific files use the `zappion_` prefix, which keeps them
  apart from the original code. `api/CLAUDE.md` covers the backend itself.
- Never commit `.env`, `.env.local` or real Meta credentials; document new variables in the matching
  `.env.example`.

## Development

- Local setup: `scripts/setup-local.sh` (README › Running locally). One local Supabase per checkout, in
  `api/` (`supabase start`); its data survives `supabase stop`/`start` and is lost only with
  `supabase db reset` or `supabase stop --no-backup`, so never run those without asking.
- The functions read `api/supabase/functions/.env` when their containers are created: after changing it,
  `supabase stop && supabase start` (data is kept).
- Web: `pnpm --dir web dev` (http://localhost:3100). Tests: `npx vitest run`, types: `npx tsc --noEmit`
  (in `web/`).
- Backend checks and the database workflow: `api/CLAUDE.md`. Contribution rules: `CONTRIBUTING.md`.
- MCP in Claude Code: `claude mcp add --scope local --transport http zappion
  http://127.0.0.1:54321/functions/v1/mcp --header "api-key: <key>"` (create the key in Settings ›
  Integrations).
- New source files need `SPDX-License-Identifier: AGPL-3.0-only`: `node scripts/license-headers.mjs`.

