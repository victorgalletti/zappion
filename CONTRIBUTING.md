# Contributing to Zappion

Thanks for helping. Bug reports, fixes, docs and features are all welcome. For anything larger than a
small fix, open an issue first so we can agree on the approach before you write the code.

## Getting set up

Follow [README › Running locally](README.md#running-locally): `scripts/setup-local.sh` gets you from a
clone to a working inbox with demo data, and no WhatsApp number is needed.

| Folder | What it is | Checks |
|---|---|---|
| `api/` | Supabase: migrations, Edge Functions (Deno), the MCP | `cd api && deno fmt --check`, then `cd supabase/functions && deno lint && deno check .` |
| `web/` | The inbox (Next.js) | `cd web && npx tsc --noEmit && npx vitest run` |
| `windows/` | Native Windows client (WinUI 3, .NET 8) | `dotnet test windows/Zappion.Windows.Tests` (on Windows) |
| `signup/`, `scripts/` | Embedded Signup page, setup and test scripts | |

CI runs the `api/` checks and the license-header check on every pull request.

## Changing the database

Never change a table by hand. Edit the schema files in `api/supabase/schemas/`, then generate the
migration from the difference:

```bash
cd api
supabase db diff -f <short_name>       # writes supabase/migrations/<timestamp>_<short_name>.sql
supabase migration up --local          # apply it
supabase gen types typescript --local --schema public --schema storage > supabase/functions/_shared/db_types.ts
```

`db diff` adds a few dozen `revoke ... from anon|authenticated|service_role` lines on every run; delete
them and keep only your real change. New Zappion files in `api/` use the `zappion_` prefix, which keeps
them apart from the code the backend started from (open-bsp-api).

## Conventions

- **English** for code, comments, UI copy, commit messages and docs. The UI is translated in
  `web/lib/i18n/`.
- **Commit messages:** one imperative summary line that says what changes for the user ("Show which
  member sent each message"), then a body with the why when it is not obvious.
- **License header:** every source file starts with `SPDX-License-Identifier: AGPL-3.0-only`. Run
  `node scripts/license-headers.mjs` to add it to new files.
- **Secrets:** never commit `.env`, `.env.local` or real Meta credentials. Document new variables in the
  matching `.env.example`.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep the change focused and run the checks above for the folders you touched.
3. Open the pull request with what changed, why, and how you tested it (the template asks for this).
4. On your first pull request, CLA Assistant asks you to sign the [Contributor License Agreement](CLA.md)
   with your GitHub account (one click, once). It lets the project offer Zappion under a commercial
   license besides the AGPL; you keep the copyright of your work, and the project commits to keeping
   it available as open source.

By contributing, you agree that your contribution is licensed under the
[AGPL-3.0-only](LICENSE) and the CLA.

## Reporting problems

- **Bugs and ideas:** open an issue using the templates.
- **Security vulnerabilities:** never in a public issue. See [SECURITY.md](SECURITY.md).
- **Conduct:** everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).
