# Zappion

Open-source customer service on the **official WhatsApp Business API** (Cloud API), with
coexistence: the number stays in the WhatsApp Business app on the phone and the conversations show
up here as well.

**Free and paid.** Everything one person needs to serve customers is here, free under the AGPL: the web
inbox, the Windows app, the API, the MCP and self-hosting. Paid plans will add what a team manager
needs (routing, reports, AI features, enterprise sign-in) and a hosted Zappion Cloud. What is planned
and being worked on is in the [issues](https://github.com/victorgalletti/zappion/issues).

## Folders

| Folder | What it is |
|---|---|
| `api/` | Backend (Supabase + Deno): Edge Functions, migrations and the MCP. It started from [open-bsp-api](https://github.com/matiasbattocchia/open-bsp-api), which is in the public domain. |
| `web/` | The agent inbox (Next.js 16 + Tailwind 4), reading Supabase directly and in real time. |
| `signup/` | The Embedded Signup page (`/conectar`) and a proxy to Supabase, on a single public domain. |
| `windows/` | Native Windows client (WinUI 3), with the web's layout. |
| `scripts/` | `setup-local.sh`: local install with demo data. `setup-cloud.sh`: sets up a Supabase Cloud project as the backend and database in one run. `send-webhook.mjs`: simulates signed Meta webhooks, to test without a real number. `seed-dev.mjs`: demo data for a local database. |

## Running locally

About 10 minutes, most of it Docker downloading images the first time. You need
[Docker](https://docs.docker.com/get-docker/) (running), the
[Supabase CLI](https://supabase.com/docs/guides/cli), Node 20+ and [pnpm](https://pnpm.io/installation).

```bash
git clone https://github.com/victorgalletti/zappion.git
cd zappion
scripts/setup-local.sh
pnpm --dir web dev
```

Open http://localhost:3100 and sign in with `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` from
`web/.env.local` (`dev@zappion.test` / `zappion-dev-local` by default).

`setup-local.sh` starts Supabase in Docker (database, Auth, Storage, Realtime and the Edge Functions),
writes the env files, installs the web's dependencies and creates a demo organization with a
fictitious WhatsApp number. It is safe to run again. Supabase Studio, the database UI, is at
http://127.0.0.1:54323.

### Trying it without a WhatsApp number

`scripts/send-webhook.mjs` sends webhooks signed the way Meta signs them, to the demo number:

```bash
node scripts/send-webhook.mjs inbound --phone-number-id 100000000000001 --business-number 5511900000000 --text "hi"
```

The message shows up in the inbox. Replies fail to send, since no real number is behind the demo one.
The script also simulates coexistence (`echo`, `history`), reactions and replies; see its header.

### Connecting a real number

1. Create a Meta App with the WhatsApp product, and put its values in `api/supabase/functions/.env`
   (see `.env.example`). Restart Supabase (`supabase stop && supabase start` in `api/`) so the
   functions pick them up.
2. Meta needs a public HTTPS URL for webhooks: expose port 54321 with a tunnel (ngrok, Cloudflare
   Tunnel) and set it as `WEBHOOK_PUBLIC_URL`. Point the Meta App's webhook to
   `<that URL>/functions/v1/whatsapp-webhook` with the `WHATSAPP_VERIFY_TOKEN` from `.env`, and subscribe
   to `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update` and
   `user_id_update`.
3. Connect the number in **Settings › Instances › Connect number › Manual**, with the phone number ID,
   the WABA and a permanent system user token.

Embedded Signup (customers connect their own number in a Meta pop-up) needs a Meta-approved Tech
Provider and the `signup/` page on an HTTPS domain: `cp signup/.env.example signup/.env`, then
`node signup/server.mjs`.

## Deploying to Supabase Cloud

One Supabase project is the whole backend: database, Auth, Storage, Realtime and the Edge Functions.
`scripts/setup-cloud.sh --project-ref <ref>` sets it up in one run (migrations, Vault secrets, functions
and their secrets) and prints the few steps left by hand. Details in
[`api/README.md`](api/README.md#self-host-deployment).

## Windows app

What exists, the decisions behind it and the open items: [`docs/WINDOWS.md`](docs/WINDOWS.md).

Native WinUI 3 client in `windows/`, with the web app's layout. Requires Windows 10 (1809+) or 11,
x64, and the .NET 8 SDK (Visual Studio is not required). Copy
`windows/Zappion.Windows/appsettings.example.json` to `appsettings.local.json` beside it and set
`SupabaseUrl` / `SupabaseKey` from `web/.env.local` and `WebAppUrl` (organization settings, templates
and media open in the web app). The local file is ignored.

```powershell
dotnet build windows/Zappion.Windows.sln -p:Platform=x64
dotnet test windows/Zappion.Windows.Tests
dotnet run --project windows/Zappion.Windows/Zappion.Windows.csproj -p:Platform=x64
```

Session, read positions, preferences, the media cache and daily logs (`logs/`, kept 7 days) live in
`%LOCALAPPDATA%\Zappion`. Debug render captures without a backend: set `ZAPPION_LAYOUT_REVIEW` to
an output folder. Regression runs against the local Supabase (seed account, isolated session):
`windows/tools/verify-task-*.ps1`.

## What the UI does

- Real-time conversations and messages, several numbers per organization (instances) and
  per-member archived conversations.
- Text, media with captions (paste and drag-and-drop), **audio recorded in the browser as
  OGG/Opus** (sent as a voice message), quoted replies, reactions and in-conversation search.
- Read receipts and "typing…" for the customer; time left in the 24-hour window.
- Outside the window, the composer turns into a picker of **approved templates**; full template
  builder.
- A media page with the media, links and documents from every conversation.
- Organization, members with roles and invitations, profile and preferences (theme, font size, chat
  background, Enter to send, signature and notifications).

## API keys

Admins create organization API keys in **Settings › Integrations**. Choose a scope
(`read`, `send` or `admin`), expiry, limits, and **All numbers** or selected connected
WhatsApp numbers. The list shows each key's numbers. The full key is shown once;
only its hash and visible prefix are stored. Keys can be revoked immediately.

The database enforces selected numbers for conversation and contact access through
REST and MCP. MCP's optional `Allowed-Accounts` header can only narrow a key's
selection. See [API key authentication](api/README.md#authentication-organization-api-keys)
for inputs, scopes, limits and client configuration.

## Caveats

- **The seed's sample organization has an AI agent that replies on its own.** Without an OpenAI
  key, it saves the error text as the reply to the customer. With a real number, that would be sent.
  Use your own organization without an agent.
- **History and contact sync: once each, within 24 hours of connecting.** The automatic request only
  exists in the Embedded Signup flow (`whatsapp-management/embedded_signup.ts`). Otherwise, request it
  with `POST /{phone_number_id}/smb_app_data`.
- A webhook URL that is down = nothing arrives and nothing warns you. Check
  `GET /{waba-id}/subscribed_apps`.
- Brazilian numbers come from Meta with or without the ninth digit; the UI merges both forms into a
  single conversation.

## License

Zappion is free software under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`). You can use, modify and self-host it, including commercially. If you run a modified
version as a service for others, you must publish your changes under the same license.

Companies that cannot use the AGPL can ask for a commercial license at contact@zappion.dev.
Contributions are accepted under a [Contributor License Agreement](CLA.md). Third-party material and its
licenses are listed in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Every source file starts with `SPDX-License-Identifier: AGPL-3.0-only`;
`node scripts/license-headers.mjs` adds it to new files and CI checks it.
