<h1 align="center">Zappion API</h1>
<p align="center">
  <strong>Zappion's open-source backend: WhatsApp and Instagram Business Platform</strong>
</p>
<p align="center">
  Self-hostable, multi-tenant, AI-agent ready. Built with Deno 🦕 and Postgres 🐘, powered by Supabase ⚡
</p>

Based on [open-bsp-api](https://github.com/matiasbattocchia/open-bsp-api)
(public domain).

## Table of contents

- [Quickstart](#quickstart)
- [Description](#description)

#### Platforms

- [Self-host deployment](#self-host-deployment)

#### Channels

- [WhatsApp integration](#whatsapp-integration)
- [Instagram integration](#instagram-integration)

#### Development

- [Architecture](#architecture)
- [Local development](#local-development)

## Quickstart

Receive and send WhatsApp messages in two steps. Before you start (once): open
your Zappion Web instance, connect your WhatsApp number (Integrations →
WhatsApp), and create an API key (Settings → API Keys). Every call below sends
two headers: `apikey` (the public Supabase key) and `api-key` (your secret key).

The API is [PostgREST](https://postgrest.org) over the database, every table is
an endpoint, so you can use plain REST or any
[Supabase SDK](https://supabase.com/docs/reference) (JS, Python, Dart, …).

**1. Receive messages** — register a webhook; Zappion POSTs every new message to
your URL:

```bash
curl -X POST 'https://<seu-projeto>.supabase.co/rest/v1/webhooks' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "organization_id": "<ORG_ID>",
    "table_name": "messages",
    "operations": ["insert"],
    "url": "https://your-app.com/webhook"
  }'
```

Your endpoint receives the **`messages` table row as is**, wrapped in a thin
envelope:

```jsonc
{
  "entity": "messages",
  "action": "insert",
  "data": {
    // the row, exactly as stored
    "id": "9b2d…",
    "organization_id": "…",
    "conversation_id": "…",
    "external_id": "wamid.…",
    "service": "whatsapp",
    "organization_address": "<PHONE_NUMBER_ID>",
    "conversation_address": "5491155551234",
    "sender_address": "5491155551234",
    "content": {
      "version": "1",
      "type": "text",
      "kind": "text",
      "text": "Hi!"
    },
    "status": { "delivered": "2026-07-17T12:00:00Z" },
    "timestamp": "2026-07-17T12:00:00Z"
  }
}
```

Reply when `data.sender_address` is set — the contact authored it; it is null on
your own outgoing rows, which the webhook also fires for (and, with `"update"`,
for status changes).

**2. Send a message** — insert a row; Zappion dispatches it to WhatsApp:

```bash
curl -X POST 'https://<seu-projeto>.supabase.co/rest/v1/messages' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "organization_id": "<ORG_ID>",
    "organization_address": "<PHONE_NUMBER_ID>",
    "conversation_address": "5491155551234",
    "service": "whatsapp",
    "content": {
      "version": "1",
      "type": "text",
      "kind": "text",
      "text": "Hello from Zappion!"
    }
  }'
```

The same insert through the Supabase JS SDK:

```js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://<seu-projeto>.supabase.co",
  "<PUBLISHABLE_KEY>",
  { global: { headers: { "api-key": "<API_KEY>" } } },
);

await supabase.from("messages").insert({
  organization_id: "<ORG_ID>",
  organization_address: "<PHONE_NUMBER_ID>",
  conversation_address: "5491155551234",
  service: "whatsapp",
  content: {
    version: "1",
    type: "text",
    kind: "text",
    text: "Hello from Zappion!",
  },
});
```

That's it. Media, templates, locations and the full message schema are typed in
[`message_types.ts`](supabase/functions/_shared/types/message_types.ts);
third-party onboarding and credential capture are in
[INTEGRATING.md](INTEGRATING.md).

## Description

Zappion API is a multi-tenant platform that connects to the official WhatsApp
and Instagram APIs to receive and send messages, storing them in a
Supabase-backed database.

### Core features

- 🤝 **Meta Business Partner ready**: Built to facilitate the transition to an
  official solution provider.
- 🔗 **WhatsApp account Coexistence**: Connect existing WhatsApp Business
  accounts via
  [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).
- 🏢 **Multi-tenant architecture**: Native support for multiple organizations
  with isolated environments.
- 🔌 **External integration**: Seamlessly connect with external services using
  webhooks and the API.

### AI agents

Create lightweight agents or connect to external, more advanced agents using
different protocols like `chat-completions` and
[`responses`](https://openresponses.org). Lightweight agents can use built-in
tools:

- MCP client
- SQL client
- HTTP client
- Calculator

> [!IMPORTANT]
> This project prioritizes a decoupled architecture between communication and
> agent logic. Advanced agents built with frameworks like the OpenAI SDK or
> Google ADK should be deployed as external services.

### Media processing

Interpret and extract information from media and document files, including:

- Audio
- Images
- Video
- PDF
- Other text-based documents (CSV, HTML, TXT, etc.)

### MCP server

The `mcp` Edge Function exposes an [MCP](https://modelcontextprotocol.io) server
over Streamable HTTP, giving agentic access to the WhatsApp API from clients
like Claude Code, Claude Desktop, ChatGPT, or other agent platforms.

On your Zappion instance, the MCP server URL is:

```
https://<your-project>.supabase.co/functions/v1/mcp
```

#### Authentication: organization API keys

The standard way in is an **organization API key**. An admin creates one in
Zappion > Settings > Integrations, picks its scope, numbers, expiry and limits,
and copies the key, which is shown only once (only a SHA-256 hash and the first
12 characters are stored). Send it in the `api-key` header:

```bash
curl https://<your-project>.supabase.co/functions/v1/mcp \
  -H "api-key: zpn_…" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}'
```

`Authorization: Bearer zpn_…` also works, for clients that can only set a bearer
token. Optionally, `Allowed-Contacts` and `Allowed-Accounts` headers
(comma-separated phone numbers) narrow what a request can reach.
`Allowed-Accounts` is intersected with the key's permitted numbers; it can never
widen them. A restricted key with no matching numbers gets HTTP 403
(`no_allowed_accounts`).

**Numbers.** Choose **All numbers** (the default, including future connections),
or select one or more connected WhatsApp numbers. The key list shows its number
selection. `public.api_keys.allowed_addresses` stores the account addresses
(`organizations_addresses.address`), not the displayed phone numbers; null means
unrestricted. Database conversation visibility enforces the selection for both
REST reads/writes and MCP calls. A restricted key sees only those WhatsApp
shared inboxes; personal-account visibility rules still apply. MCP resolves the
selected addresses to `extra.phone_number` before applying its account filter.

`zappion_create_api_key` accepts optional `p_allowed_addresses: text[]` (default
null) in addition to the existing inputs. It rejects empty arrays, null
elements, foreign organization addresses and non-WhatsApp addresses, and
deduplicates valid selections. Existing callers can omit the new input. Its
result remains
`{"id":"<uuid>","key":"<one-time secret>","key_prefix":"<prefix>"}`.
`zappion_mcp_authenticate` adds `allowed_addresses: string[] | null` to its
successful `{id, organization_id, scope}` result. No new MCP tool is introduced;
the existing tool list and read/send scopes below apply within the selected
numbers.

Ready-made configs (the Integrations screen fills in the URL and key):

- Claude Code:
  `claude mcp add --transport http zappion <URL> --header "api-key: <API_KEY>"`
- Cursor (`.cursor/mcp.json`):
  `{"mcpServers":{"zappion":{"url":"<URL>","headers":{"api-key":"<API_KEY>"}}}}`
- Claude Desktop (`claude_desktop_config.json`, through `mcp-remote`):
  `{"mcpServers":{"zappion":{"command":"npx","args":["-y","mcp-remote","<URL>","--header","api-key:${ZAPPION_API_KEY}"],"env":{"ZAPPION_API_KEY":"<API_KEY>"}}}}`
- OpenAI API (Responses, Agents SDK): a
  `{"type":"mcp","server_label":"zappion","server_url":"<URL>","headers":{"api-key":"<API_KEY>"}}`
  tool. The ChatGPT app's custom connectors cannot send a static key; use OAuth
  there (below).

**Scopes.** Each key has one, and each includes the one before it:

| Scope   | MCP tools                                                                                                               | Elsewhere in the API (RLS)                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `read`  | `list_*`, `fetch_*` (including `fetch_media`), `search_contacts`, `get_service_window`, `show_*`                        | member, reads only: any request but GET/HEAD authorizes nothing |
| `send`  | the above, `send_message`, `mark_conversation_read`, `archive_conversation`, `unarchive_conversation`, `update_contact` | member                                                          |
| `admin` | the above                                                                                                               | admin (e.g. `whatsapp-management`)                              |

All three scopes restrict conversation and contact visibility to the key's
selected numbers; scope never widens that visibility.

A key never creates, lists or revokes keys: that takes a signed-in admin.

**Limits.** Each key has `send_limit_per_hour` (default 60) and
`template_limit_per_hour` (default 10), counted over a rolling hour in Postgres
(`public.mcp_calls`), so they hold across stateless edge invocations. Every
`send_message` counts against the message limit; a template also counts against
the template limit, because Meta charges for templates. Sends that fail do not
count.

**Approval before sending.** A key created with **Require approval before
sending** (`api_keys.requires_approval`, `p_requires_approval` on
`zappion_create_api_key`) never sends on its own. The hold is in Postgres
(`zappion_hold_for_approval`), so it covers `send_message` and inserts through
PostgREST alike: an outgoing message the key inserts is stored with status
`{awaiting_approval}` instead of `{pending}`, which neither the dispatch trigger
nor the retry sweep sends, and gets a row in `public.zappion_message_approvals`.
`send_message` then returns `{status: "pending_approval", id}` instead of
`{status: "sent", id}`. A signed-in member approves it in the chat
(`zappion_approve_message(p_message_id)`), which arms and dispatches it at once,
or rejects it (`zappion_reject_message(p_message_id)`, status `{rejected}`). An
API key can never approve. Approval still applies the 24h service window (only a
template may go once it is closed) and the key's hourly limits, counted over
approved sends, so approving a backlog cannot burst past them. The request
itself also counts against the limits when it is made, as any send does.

**Expiry and revocation.** A key may have an expiry. Revoking it in the screen
stops it on the next request, everywhere in the API.

**Log.** Every tool call is logged in `public.mcp_calls` (key or user, tool,
contact, kind of send, result, error), readable by the org's admins.

**Errors.** Authentication fails with HTTP 401 and
`{"error": "<message>", "code": "<code>"}`. A refused tool call is an MCP tool
result with `isError: true` whose text is `{"error": {"code", "message", …}}`.

| Code                 | Where      | Meaning                                                                                                                                                           |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_key`        | 401        | No such key                                                                                                                                                       |
| `key_revoked`        | 401 / tool | The key was revoked (`revoked_at`)                                                                                                                                |
| `key_expired`        | 401 / tool | The key expired (`expires_at`)                                                                                                                                    |
| `insufficient_scope` | tool       | The tool needs a wider scope (`scope`, `required_scope`)                                                                                                          |
| `rate_limited`       | tool       | Over the hourly limit; `limit` is `messages` or `templates`, `limit_per_hour`, and `retry_at` (ISO 8601) is when a slot frees (null when the template limit is 0) |

#### OAuth (people in their own MCP client)

Add only the URL; the client discovers Supabase Auth's OAuth 2.1 server (dynamic
client registration), opens the browser, and you sign in with your Zappion
account. Access is your user's, through RLS, in your first organization. Calls
are logged; scopes and limits do not apply. This is also the way to connect the
ChatGPT app.

Available tools:

| Tool                     | Description                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `list_accounts`          | List connected WhatsApp accounts                                                     |
| `list_conversations`     | Get recent active conversations                                                      |
| `fetch_conversation`     | Fetch messages (with ids), service window status and `closes_at` for a contact       |
| `fetch_media`            | Get a message's media URL, metadata and inline stored images up to 1 MB              |
| `get_service_window`     | Check the 24h window and allowed message types before sending                        |
| `mark_conversation_read` | Send WhatsApp blue ticks through the latest incoming message                         |
| `archive_conversation`   | Archive a conversation for one member                                                |
| `unarchive_conversation` | Unarchive a conversation for one member                                              |
| `search_contacts`        | Find contacts by name or phone number                                                |
| `update_contact`         | Update a contact name for one WhatsApp account                                       |
| `send_message`           | Send text, media, location, contacts, a reaction, a reply or a template (24h window) |
| `list_templates`         | List available WhatsApp templates                                                    |
| `fetch_template`         | Fetch details of a specific template                                                 |
| `show_conversation`      | Open the conversation as a chat screen (MCP Apps); same data as `fetch_conversation` |
| `show_template_picker`   | Open a screen to pick a template, fill its variables with a preview and send it      |

`update_contact` requires scope `send`, required `contact_phone` and `name`
(trimmed, 1–100 characters), and optional `account_phone` (required when more
than one allowed account is connected). It applies the usual phone normalization
and `Allowed-Contacts` / `Allowed-Accounts` checks, updates only
`extra.saved_name`, and inserts a missing account-specific contact entry. It
returns `{"contact":{"phone":"<normalized phone>","name":"<display name>"}}`,
using `contactName()` on the stored result: `synced.name`, then the
organization's `saved_name`, then the contact's own push `name`. Webhook
push-name updates therefore preserve the organization's saved name. The web app
uses the same order. Entries with `extra.synced.action = 'add'` are refused:
their name comes from the WhatsApp Business app address book and must be changed
there. Calls are logged without consuming message/template send limits. Custom
contact fields are not available yet (roadmap section 4, spreadsheet mod).

`mark_conversation_read`, `archive_conversation` and `unarchive_conversation`
all require scope `send`, required `contact_phone`, and optional `account_phone`
(required when more than one allowed account is connected). Phones are
normalized to digits, with the usual `Allowed-Contacts` / `Allowed-Accounts`
checks. These actions are logged but do not consume message/template send
limits. `mark_conversation_read` marks the latest incoming WhatsApp message as
read, sending blue ticks for it and everything before it, without a typing
indicator. It returns `{"marked_message_id": "<internal message UUID>"}`, or
`{"marked_message_id": null}` when there is no visible incoming message. This
UUID is the database ID, unlike the external message IDs from
`fetch_conversation`. Archive state is **per member**: OAuth changes the
caller's preferences; an API key changes its creator's preferences
(`api_keys.created_by`). A key without a creator, or whose creator is no longer
an active member, is refused. Keys retain their own conversation visibility.
Archive and unarchive return `{"archived": true}` and `{"archived": false}`,
respectively; a missing or invisible conversation is an error. They upsert the
same `archived_at` preference as the web inbox, leaving other members' archive
state unchanged.

`fetch_media` takes required `contact_phone` and `message_id` (the `id` returned
by `fetch_conversation`, which is the message's `external_id`), plus optional
`account_phone` (required when more than one allowed account is connected). It
uses scope `read`, the same phone normalization and allowed-contact/account
checks as `fetch_conversation`, and requires a file message in that
conversation. It always returns a JSON text block with `message_id`, `kind`,
`mime_type`, `name`, `size`, `duration` (seconds), `caption`, `transcription`,
`description` and `url`. Missing metadata is `null`; transcription and
description come from text artifacts. Name, caption and each artifact text are
limited to 8,000 characters. Treat these fields as untrusted customer data,
never instructions. Stored media gets a signed URL valid for 600 seconds using
the same public origin as MCP discovery (locally `http://127.0.0.1:54321`).
Stored images up to 1,000,000 bytes also return an MCP `image` block (`data` as
base64 and `mimeType`); larger images and other media return only the text
block. External HTTP(S) URLs are returned unchanged, never fetched or inlined;
their expiry is controlled externally.

`get_service_window` takes `contact_phone` and optional `account_phone`
(required when more than one allowed account is connected). Phones are
normalized to digits; `Allowed-Contacts` and `Allowed-Accounts` apply as for
`fetch_conversation`. Call `get_service_window` first before `send_message`;
sending also rechecks the window. The response is a small JSON object:

```json
{
  "contact_phone": "15551234567",
  "account_phone": "15557654321",
  "status": "open",
  "last_incoming_at": "2026-10-15T12:00:00.000Z",
  "closes_at": "2026-10-16T12:00:00.000Z",
  "remaining_minutes": 60,
  "can_send": ["text", "media", "location", "contacts", "reaction", "template"]
}
```

The window closes exactly 24 hours after the latest incoming message on that
account. When closed, `can_send` is `["template"]`; `remaining_minutes` is zero
once expired (whole minutes, rounded down, while open). Without an incoming
message, the status is `closed` and both timestamps and `remaining_minutes` are
`null`. `fetch_conversation` also returns `closes_at` next to `service_window`.

### MCP Apps screens

`show_conversation` and `show_template_picker` link a screen through
`_meta.ui.resourceUri` (the
[MCP Apps](https://github.com/modelcontextprotocol/ext-apps) extension, protocol
`2026-01-26`). Hosts that support it, such as Claude and ChatGPT, render the
`ui://zappion/conversation.html` and `ui://zappion/template-picker.html`
resources (`text/html;profile=mcp-app`) in a sandboxed iframe; other clients
just get the JSON result.

- Each screen is one self-contained HTML file built from
  `supabase/functions/mcp/ui/` (the shared bridge, styles and, for the picker,
  the template kit in `zappion_template_kit.ts` are inlined when the resource is
  read). It loads nothing from the network, so the host's default CSP applies.
  The function ships the files through `static_files` in `config.toml`.
- Opening a screen needs scope `read`. What the screen does goes back through
  the host as ordinary tool calls (`fetch_conversation` to refresh,
  `send_message` to reply or send the template), so the key's scope, hourly
  limits, approval and number restrictions apply unchanged: on a read-only key
  the screens show the `insufficient_scope` error instead of sending.
- `show_conversation` takes `contact_phone`, optional `account_phone` and
  `limit` (default 20). The screen shows the window state and a reply box while
  it is open. `show_template_picker` takes `contact_phone`, optional
  `account_phone` and `template_name` to preselect; it returns the account's
  approved templates with their components (read live from Meta) and sends
  nothing until the user presses Send. After a send, the screens tell the model
  what happened (`ui/update-model-context`) when the host supports it.

## Self-host deployment

Zappion runs on one [Supabase](https://supabase.com) project, which is both the
backend (Edge Functions, Auth, Storage, Realtime) and the database. `api/` is a
folder of the Zappion repository, so every path below starts from the repository
root.

### First setup (one command)

1. Create a Supabase project and note its ref (the id in
   `https://supabase.com/dashboard/project/<ref>`) and database password.
2. Create a
   [personal access token](https://supabase.com/dashboard/account/tokens).
3. Copy `api/supabase/functions/.env.example` to `api/supabase/functions/.env`
   and fill in the Meta App values.
4. From the repository root:

   ```bash
   SUPABASE_ACCESS_TOKEN=... SUPABASE_DB_PASSWORD=... \
     scripts/setup-cloud.sh --project-ref <ref>
   ```

The script links `api/` to the project, applies the migrations (never the seed),
stores the two Vault secrets the database uses to call the Edge Functions
(`edge_functions_url` and `edge_functions_token`), deploys every Edge Function
and sets the functions' secrets from your `.env`. It is safe to run again, and
`--dry-run` prints what it would do without changing anything.

It ends with what is left to do by hand: the Auth Site URL and Redirect URLs,
enabling the OAuth Server (for MCP clients), the Meta webhook URL, and the
environment variables for hosting `web/`.

### Updates

Run `scripts/setup-cloud.sh` again after pulling a new version. To deploy on
every push instead, connect the project to your fork with the
[Supabase GitHub Integration](https://supabase.com/docs/guides/deployment/branching/github-integration)
(Project Settings > Integrations), with **Working directory** set to `api` and
**Production branch** set to `main`. It deploys migrations and Edge Functions;
the Vault and function secrets stay as the script set them.

## WhatsApp integration

To connect your Zappion project to the WhatsApp API, you'll need to setup a Meta
App with the WhatsApp product and configure the following Edge Functions
secrets. You can set these up in two ways:

- **Direct configuration**: Add them directly in your Supabase dashboard at
  Supabase > Project > Edge Functions > Secrets.
  <!-- `https://supabase.com/dashboard/project/{project_id}/functions/secrets` -->
- **GitHub Actions**: Set them as GitHub Actions secrets in your repository
  settings and re-run the _Release_ action to automatically deploy them.

#### Secrets

- **META_SYSTEM_USER_ID**
- **META_SYSTEM_USER_ACCESS_TOKEN**
- **META_APP_ID**
- **META_APP_SECRET**
- **WHATSAPP_VERIFY_TOKEN**

Follow these steps to obtain the required credentials.

<details>
<summary>
Step 0: Overview
</summary>

There is quiet a Meta nomenclature of entities that you might want to get in
order to not to get lost in the platform.

- **Business profile** - This is the top-level entity, represents a business.
  Has users and assets.
- **User** - Real or system users. System users can have access tokens. Users
  belong to a business portfolio and can have assigned assets.
- **Asset** - WhatsApp accounts, Instagram accounts, Meta apps, among others.
  Assets belong to a business portfolio and are assigned to users.
- **App** - An asset that integrates Meta products such as the WhatsApp Cloud
  API.
- **WhatsApp Business Account (WABA)** - A WhatsApp account asset, can have many
  phone numbers.
- **Phone number** - A registered phone number within the WhatsApp Cloud API.
  Belongs to a WABA.

> For more details, refer to
> [Cloud API overview](https://developers.facebook.com/docs/whatsapp/cloud-api/overview).

</details>

<details>
<summary>
Step 1: Create a Meta app (skip if you already have one)
</summary>

1. Navigate to [My Apps](https://developers.facebook.com/apps)
2. Click **Create App**
3. Select the following options:
   - **Use case**: Other
   - **App type**: Business
4. Add the **WhatsApp** product to your app
5. Click **Add API**
6. Disregard the screen that appears next and proceed to the next step

</details>

<details>
<summary>
Step 2: Create a system user
</summary>

1. Get into the [Meta Business Suite](https://business.facebook.com). If you
   have multiple portfolios, select the one associated with your app
2. Go to Settings > Users > System users
   <!-- `https://business.facebook.com/latest/settings/system_users` -->
3. Add an **admin system user**
4. Copy the **ID** → **META_SYSTEM_USER_ID**
5. Assign your app to the user with **full control** permissions
6. Generate a token with these permissions:
   - `business_management`
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
7. Copy the **Access Token** → **META_SYSTEM_USER_ACCESS_TOKEN**

> For detailed instructions on system user setup, refer to the
> [WhatsApp Business Management API documentation](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started).

</details>

<details>
<summary>
Step 3: Get the app credentials
</summary>

1. Navigate to [My Apps](`https://developers.facebook.com/apps`) > App Dashboard
   <!-- `https://developers.facebook.com/apps/{app_id}` -->
2. Go to App settings > Basic
   <!-- `https://developers.facebook.com/apps/{app_id}/settings/basic` -->
3. Copy the following values:
   - **App ID** → **META_APP_ID**
   - **App secret** → **META_APP_SECRET**

> Multiple Meta apps are supported by separating values with `|` (pipe)
> characters. For example: `META_APP_ID=app_id_1|app_id_2` and
> `META_APP_SECRET=app_secret_1|app_secret_2`.

</details>

<details>
<summary>
Step 4: Configure the WhatsApp Business Account webhook
</summary>

### Part A

1. Within the App Dashboard
2. Go to WhatsApp > Configuration
   <!-- `https://developers.facebook.com/apps/{app_id}/whatsapp-business/wa-settings` -->
3. Set the **Callback URL** to:
   `https://{SUPABASE_PROJECT_ID}.supabase.co/functions/v1/whatsapp-webhook`
4. Choose a secure token for **WHATSAPP_VERIFY_TOKEN** → Set it as the **Verify
   token**, but **do not** click **Verify and save** yet!
5. Ensure your Edge Functions environment variables are up-to-date
   - If you configured secrets directly in your Supabase dashboard, no further
     action is needed at this point
   - If you set secrets via GitHub Actions, re-run the _Release_ action now to
     deploy them to your Edge Functions
6. Click **Verify and save**
7. Disregard the screen that appears next and proceed to the next step

> Multiple Meta apps are supported by appending the query param
> `?app_id={META_APP_ID}` to the callback URL. For example:
> `https://{SUPABASE_PROJECT_ID}.supabase.co/functions/v1/whatsapp-webhook?app_id=app_id_2`.

### Part B

1. Within the App Dashboard
2. Go to WhatsApp > Configuration
   <!-- `https://developers.facebook.com/apps/{app_id}/whatsapp-business/wa-settings` -->
3. Subscribe to the following **Webhook fields**:
   - `account_update`
   - `messages`
   - `history`
   - `smb_app_state_sync`
   - `smb_message_echoes`
   - `user_id_update`

> Optionally, test the configuration so far. In the `messages` subscription
> section, click **Test**. You should see the request in Supabase > Project >
> Edge Functions > Functions > whatsapp-webhook > Logs.
>
> <!-- `https://supabase.com/dashboard/project/{project_id}/functions/whatsapp-webhook/logs` -->
>
> You might observe an error in the logs. This is an expected outcome at this
> stage; the simple fact that a log entry appears confirms that the webhook is
> successfully receiving events.

</details>

<details>
<summary>
Step 5: Add a phone number
</summary>

If you decide to add the **test number**,

1. Within the App Dashboard
2. Go to WhatsApp > API Setup
   <!-- `https://developers.facebook.com/apps/{app_id}/whatsapp-business/wa-dev-console` -->
3. Click **Generate access token** (you can't use the one you got from step 2
   here)
4. Copy these values:
   - **Phone number ID**
   - **WhatsApp Business Account ID**
5. Select a recipient phone number
6. Send messages with the API > **Send message**

> The test number doesn't seem to fully activate to receive messages unless you
> send a test message at least once.

In order to add a **production number**,

1. Click **Add phone number**
2. Follow the flow
3. Navigate to
   [WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager/overview)
4. Go to Account tools > Phone numbers
   <!-- `https://business.facebook.com/latest/whatsapp_manager/phone_numbers` -->
5. Copy these values:
   - **Phone number ID**
   - **WhatsApp Business Account ID**

### For any number you add

Create an organization if you haven't done that already.

```sql
insert into public.organizations (name, extra) values
  ('Default', '{}')
;
```

Note the **organization ID**.

Register the phone number with your organization in the system.

```sql
insert into public.organizations_addresses (
    organization_id,
    service,
    address,
    status,
    extra
  ) values (
    '<Organization ID>',                     -- ID from the previous step
    'whatsapp',
    '<Phone number ID>',                     -- Meta's phone_number_id (NOT the phone number)
    'connected',                             -- 'connected' | 'disconnected'
    jsonb_build_object(
      'waba_id',       '<WhatsApp Business Account ID>', -- WhatsApp Business Account ID
      'phone_number',  '<Phone number>',      -- bare E.164 digits, no '+', no spaces
      'verified_name', 'Acme Inc.',           -- Optional: display name shown to recipients
      'business_id',   '<Meta Business Portfolio ID>', -- Optional: Meta Business Portfolio ID (parent of the WABA)
      'flow_type',     'new_phone_number',    -- 'new_phone_number' | 'existing_phone_number'
      'access_token',  '<System User Token>'  -- Optional: per-WABA token; if not provided, the system user token is used
    )
  );
```

</details>

## Instagram integration

To connect your Zappion project to the Instagram API, you'll need to setup a
Meta App with the Instagram product and configure the following Edge Functions
secrets.

Please go through the WhatsApp integration step 1 if you haven't got a Meta App
yet.

> [!IMPORTANT]
> Zappion integrates with Instagram using **Instagram login** (not Facebook
> login).

#### Secrets

- **INSTAGRAM_APP_ID**
- **INSTAGRAM_APP_SECRET**
- **INSTAGRAM_VERIFY_TOKEN**

<details>
<summary>
Configure the Instagram app
</summary>

1. Within the App Dashboard
2. Go to Instagram > API setup with Instagram login
3. Copy the following values:
   - **Instagram app ID** → **INSTAGRAM_APP_ID**
   - **Instagram app secret** → **INSTAGRAM_APP_SECRET**

### Configure webhooks

4. Set the **Callback URL** to:
   `https://{SUPABASE_PROJECT_ID}.supabase.co/functions/v1/instagram-webhook`
5. Choose a secure token for **INSTAGRAM_VERIFY_TOKEN** → Set it as the **Verify
   token**, but **do not** click **Verify and save** yet!
6. Ensure your Edge Functions environment variables are up-to-date
   - If you configured secrets directly in your Supabase dashboard, no further
     action is needed at this point
   - If you set secrets via GitHub Actions, re-run the _Release_ action now to
     deploy them to your Edge Functions
7. Click **Verify and save**

### Set up Instagram business login

8. Click **Business login settings**
9. Set the following fields:
   - OAuth redirect URIs: `{PUBLIC_URL}/oauth/instagram` and
     `{PUBLIC_URL}/onboard-instagram/callback`
   - Deauthorize callback URL:
     `https://{SUPABASE_PROJECT_ID}.supabase.co/functions/v1/instagram-management/deauthorize`
   - Data deletion request URL:
     `https://{SUPABASE_PROJECT_ID}.supabase.co/functions/v1/instagram-management/data-deletion`
10. Click **Save**

> Note that `PUBLIC_URL` is _your_ app/UI public domain. For example, mine is
> https://<your-zappion-web>.

</details>

## Architecture

New to Supabase? In one sentence: it's a hosted Postgres platform that
auto-exposes your tables over a REST and realtime API, runs Deno-based Edge
Functions for server-side logic, and handles auth and file storage on top.
Zappion leans heavily on those primitives — most business logic lives as SQL
triggers and Edge Functions, and clients (the web UI, the Claude Code plugin,
custom integrations) talk to Postgres directly through a
[Supabase client library](https://supabase.com/docs/guides/api/rest/client-libs)
rather than through a separate backend layer.

<img src="./architecture.png" alt="Architecture diagram" width="600">

In the image, green boxes are external services, red are Edge Functions and
blue, database tables. White boxes are clients.

The system uses a reactive, function-based architecture:

1. A request from the WhatsApp API is received by the `whatsapp-webhook`
   function.
2. `whatsapp-webhook` processes the incoming message and stores it in the
   `messages` table.
3. An insert trigger on the `messages` table forwards the message to the
   `agent-client` function (incoming trigger).
4. `agent-client` builds the conversation context and sends a request to an
   agent API using the
   [Chat Completions](https://platform.openai.com/docs/api-reference/chat)
   format.
5. `agent-client` waits for the agent's response and saves it back to the
   `messages` table.
6. An outgoing trigger on the `messages` table forwards the new message to the
   `whatsapp-dispatcher` function.
7. `whatsapp-dispatcher` processes the message and sends a request to the
   WhatsApp API to deliver it.

This event-driven flow ensures that each component is decoupled and scalable.

### Edge Functions

#### WhatsApp

- `whatsapp-webhook`: Handles incoming webhook events from the
  [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
- `whatsapp-dispatcher`: Sends outbound messages to the WhatsApp Cloud API.
- `whatsapp-manager`: Integrates with the
  [WhatsApp Business Management API](https://developers.facebook.com/docs/whatsapp/business-management-api)
  for business and phone number management.

#### Agent

- `agent-client`: Orchestrates agent interactions, builds conversation context,
  and communicates with external agent APIs over
  [Chat Completions](https://platform.openai.com/docs/api-reference/chat) or
  [Open Responses](https://openresponses.org) protocols.

### Database models

- **users**: Registered user in the application (mapped to Supabase Auth).
- **organizations**: Tenant entity; holds organization metadata.
- **organizations_addresses**: An organization's connected addresses per service
  — e.g. a WhatsApp phone number. Belongs to an `organization`.
- **contacts_addresses**: The address-book entries — an address a contact can be
  reached at (e.g. a phone number for WhatsApp), with its display name in
  `extra`. Each row is an entry in one connection's address book — it belongs to
  an `organization_address`, and its visibility follows that account's (a
  personal connection's contacts are the owner's). There is deliberately no
  cross-service contact identity: zappion is a comm layer, and who-is-who across
  services belongs to the consumer.
- **conversations**: A channel between an `organization_address` and an
  `address` (a phone number, a WhatsApp group JID, a Slack channel id) for a
  given service; belongs to an `organization`. Its `type` says which shape it
  is: `direct`, `group` or `channel`. Except on the internal `local` service, it
  mirrors state owned by the external service and is read-only to members.
- **messages**: Messages within a `conversation`; carry authorship, type,
  payload, status, and timestamps.
- **agents**: Human or AI agents for an `organization`; optionally linked to an
  auth `user`.
- **api_keys**: API access keys scoped to an `organization`, stored hashed, with
  a scope, expiry, revocation and hourly send limits.
- **mcp_calls**: one row per MCP tool call (key or user, tool, contact, result),
  for admins and the send limits.
- **webhooks**: Outbound webhook subscriptions per `organization`.
- **conversations_agents**: Who is in a `conversation` — membership mirrored
  from the external service, or managed by members on the internal `local` chat.
  Also carries each member's own state for the conversation.
- **logs**: Application-level log entries (errors, warnings) written by Edge
  Functions.

## Local development

Requires Node 🐢 and Docker 🐋.

### Database

```
npx supabase start
```

After editing the schema files, generate a migration

```
npx supabase db diff -f <migration_name>
```

Apply the migration to the local database

```
npx supabase migration up
```

Finally, update the types

```
npx supabase gen types typescript --local --schema public --schema storage \
  | npx prettier --no-semi --parser typescript > supabase/functions/_shared/db_types.ts
```

### Edge Functions

```
npx supabase functions serve
```

### REST API docs

Fetch the OpenAPI spec from PostgREST (requires the service role key):

```
curl "https://<project-id>.supabase.co/rest/v1/" -H "apikey: <service_role_key>" > openapi.json
```
