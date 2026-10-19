# Tech Provider as a Service

Ship a WhatsApp (or Instagram) product **without registering with Meta as a Tech
Provider**. Your customers connect their own WhatsApp Business accounts _under
Zappion's_ Meta app via Embedded Signup; from then on you drive everything over
a plain REST API with an API key, and — if you want — that account's message
webhooks are delivered **straight to your app**.

Zappion is the Tech Provider. You are its API consumer. No Meta app review, no
business verification, no JS SDK on your side.

```
your customer ──(onboarding link)──► Zappion Embedded Signup ──► WABA connected
                                                                      │
your app ◄── messages (per-account webhook) ── Meta Cloud API ◄───────┘
your app ◄── account events / logs (Zappion webhooks or polling) ── Zappion
your app ──► send (Zappion REST  *or*  Meta directly with the account token)
```

There is exactly **one thing you do in the dashboard** — create your org and an
API key. Everything else is REST.

---

## Conventions

- **Base URL:** `https://<seu-projeto>.supabase.co`
- **Dashboard:** `https://<your-zappion-web>`
- Every REST call sends **two** headers:

  ```
  apikey: <PUBLISHABLE_KEY>     # public Supabase publishable key (it's in the web bundle)
  api-key: <ZAPPION_API_KEY>    # the secret key you generate below
  ```

  Do **not** send `Authorization: Bearer <api-key>` — PostgREST would reject it
  as a non-JWT. See [AUTH.md](AUTH.md) for the full model.

---

## 1. Create your organization (dashboard, one-time)

Sign in at your Zappion Web instance with Google or GitHub. Your organization is
created on first sign-in.

> This is the **only** step that needs a logged-in user — creating an
> organization (and your owner membership) is the one operation an API key can't
> do. After this you never need the UI again.

## 2. Generate an API key

Dashboard → **Settings → API Keys → New**. Pick a role:

- **owner** — full access, including minting onboarding links.
- **admin** — manage templates, contacts, webhooks, send messages.
- **member** — read + send.

Copy the key. It's scoped to this one organization and carries that role.

## 3. Make REST calls

PostgREST is exposed at `/rest/v1/<table>`; edge functions at
`/functions/v1/<function>`. A couple of reads:

```bash
# Connected accounts (phone numbers) in your org
curl 'https://<seu-projeto>.supabase.co/rest/v1/organizations_addresses?service=eq.whatsapp&select=address,status,extra' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <ZAPPION_API_KEY>'

# Recent platform/Meta events for your org (account updates, signup/history errors)
curl 'https://<seu-projeto>.supabase.co/rest/v1/logs?select=level,category,service,message,metadata,created_at&order=created_at.desc&limit=20' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <ZAPPION_API_KEY>'
```

## 4. (Optional) Register webhooks instead of polling

So your app is _pushed_ events. Dashboard → **Settings → Webhooks → New**, or
via REST:

```bash
curl -X POST 'https://<seu-projeto>.supabase.co/rest/v1/webhooks' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <ZAPPION_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "table_name": "organizations_addresses",
    "operations": ["insert", "update"],
    "url": "https://your-app.com/zappion/accounts",
    "token": "<your shared secret>"
  }'
```

Subscribable tables: `organizations_addresses` (account connected / disconnected
— **the payload includes the account access token**), `logs` (Meta events &
errors), `contacts`, `contacts_addresses`, plus `messages` / `conversations`
(the latter two only carry data for accounts _not_ using a per-account webhook —
see step 7). Zappion `POST`s `{ entity, action, data: <row> }` to your `url`,
with `Authorization: Bearer <token>` if you set one.

## 5. Mint an onboarding link (API key)

This is how you hand a customer a link to connect their WhatsApp. Create an
`onboarding_token` — and, if you want their traffic delivered to **your** app,
set `callback_url` + `verify_token` (the per-account webhook override):

```bash
curl -X POST 'https://<seu-projeto>.supabase.co/rest/v1/onboarding_tokens?select=id' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <OWNER_ZAPPION_API_KEY>' \
  -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
  -d '{
    "name": "Acme Corp",
    "organization_id": "<YOUR_ORG_ID>",
    "service": "whatsapp",
    "expires_at": "2026-07-01T00:00:00Z",
    "callback_url": "https://your-app.com/acme/whatsapp",
    "verify_token": "a-long-random-secret"
  }'
```

Minting requires an **owner** API key, and `organization_id` is required — it
must be the organization your API key belongs to (row-level security rejects the
insert otherwise, with a 42501 error). Find it in the dashboard URL or via
`GET /rest/v1/organizations?select=id,name`. The response `id` is the link
token; hand the customer:

```
https://<your-zappion-web>/onboard/whatsapp/<id>
```

(`callback_url`/`verify_token` are optional — omit them to keep messages flowing
through Zappion instead.)

## 6. The customer connects

They open the link and complete Embedded Signup (no Zappion account, no Meta
developer setup needed). On success:

- the onboarding token flips to `used`;
- a row appears in `organizations_addresses` (`status = connected`) whose
  `extra` holds `waba_id`, `phone_number`, and the **`access_token`**;
- if you set a `callback_url`, that WABA's message webhooks are pointed at it.

You learn about it via your `organizations_addresses` webhook (step 4) or by
polling (step 8).

### Capturing the credentials

A common pitfall: the `callback_url` you set on the token is registered **with
Meta** — Meta sends message traffic there, and its payloads carry only the
`phone_number_id`, **never credentials**. The `waba_id` / `access_token` /
`phone_number` your app needs to call the Cloud API arrive on the **Zappion
plane**: the `organizations_addresses` webhook (step 4). Its payload is the full
row:

```jsonc
{
  "entity": "organizations_addresses",
  "action": "insert", // or "update"
  "data": {
    "organization_id": "…",
    "service": "whatsapp",
    "address": "883…", // = phone_number_id
    "status": "connected",
    "extra": {
      "waba_id": "…",
      "access_token": "EAAG…",
      "phone_number": "54911…",
      "verified_name": "…",
      "flow_type": "existing_phone_number",
      "callback_url": "https://your-app.com/tenant-42/whatsapp",
      "verify_token": "…"
    }
  }
}
```

**Mapping the row to your tenant:** the onboarding token id is not in the row —
correlate with `extra.callback_url` or `extra.verify_token` instead: you chose
those values when you minted the link, so mint each tenant's link with a unique
one (e.g. `…/tenant-42/whatsapp`) and match on it when the webhook arrives.

## 7. Receive messages and send

**Receiving** — with a `callback_url` set, Meta delivers that account's incoming
messages and statuses **directly to your app's URL** (verified with your
`verify_token`). Account-level events (connect/disconnect, errors) still come
from Zappion via the `organizations_addresses` / `logs` channels. Zappion does
**not** store these messages.

**Sending** — two options:

- **Through Zappion** (simplest): `POST /rest/v1/messages` with the
  `organization_address` (the `phone_number_id`), `conversation_address`, and a
  `content` object. The message shapes are typed in
  [`message_types.ts`](supabase/functions/_shared/types/message_types.ts).
- **Directly to Meta** (fully autonomous): read `extra.access_token` from
  `organizations_addresses` and call the WhatsApp Cloud API yourself.

## 8. (Optional) Poll instead of webhooks

If you'd rather pull than receive pushes:

```bash
# Has the account connected yet?
curl 'https://<seu-projeto>.supabase.co/rest/v1/organizations_addresses?service=eq.whatsapp&status=eq.connected&select=address,extra,updated_at' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <ZAPPION_API_KEY>'

# Any onboarding/Meta errors?
curl 'https://<seu-projeto>.supabase.co/rest/v1/logs?level=eq.error&select=category,service,message,metadata,created_at&order=created_at.desc' \
  -H 'apikey: <PUBLISHABLE_KEY>' -H 'api-key: <ZAPPION_API_KEY>'
```

---

## Recap

1. Create your org + API key in the dashboard (once).
2. (Optional) Register `organizations_addresses` + `logs` webhooks.
3. Mint an onboarding link (with `callback_url`/`verify_token`) via the API.
4. Customer connects → account appears in `organizations_addresses` with its
   token.
5. Their messages arrive at your `callback_url`; you send via Zappion or Meta.

You shipped a multi-tenant WhatsApp product and never touched Meta's Tech
Provider program — Zappion is the Tech Provider, as a service.
