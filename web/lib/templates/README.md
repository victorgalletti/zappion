# WhatsApp Cloud API templates

Reviewed on **10/14/2026**. The official URLs consulted are listed at the beginning of `types.ts`.
Web search received HTTP 429 from Meta; pages were read directly over HTTP.
The Message Template API reference confirmed the Flow fields; the old
Flow-specific guides returned login/404. We do not use BSP documentation as authority.
The Zappion API uses Graph **v24.0**; some examples in the current documentation use v25.0.
WABA eligibility and semantic approval remain Meta's decisions.

## Implemented types and limits

| Type | Categories | Creation and sending |
| --- | --- | --- |
| Standard | MARKETING, UTILITY | Body up to 1024, text header up to 60/one variable, footer up to 60 without variables. |
| Media / location | MARKETING, UTILITY | Image, video, PDF, or location; media uses a resumable upload handle at creation and an ID/link when sending. Location is chosen when sending. |
| Media carousel | MARKETING | 2–10 cards at creation and exactly that number when sending. Image/video, optional body up to 160 on all cards, and up to two buttons per card. Uniform format, body presence, and button types/order. |
| Product carousel | MARKETING | Exactly two PRODUCT cards at creation; 2–10 products when sending. One SPM or URL button per card, with uniform structure. Catalog ID and SKU per card. |
| Catalog | MARKETING | Body, optional footer, fixed CATALOG button; optional thumbnail SKU when sending. |
| Multiple products (MPM) | MARKETING | Required text header, body, optional footer, and fixed MPM button. When sending: thumbnail, up to 10 sections (title up to 24), and 30 products total. |
| Product (SPM) | MARKETING | PRODUCT header, body up to 160, optional footer, and fixed SPM button. Catalog/SKU when sending. |
| Coupon | MARKETING | One COPY_CODE, required example up to 20 characters; code chosen when sending. Label defined by Meta. |
| Limited-time offer | MARKETING | Body up to 600; offer title up to 16; optional image/video, no footer. URL and optional COPY_CODE before the URL; coupon up to 15. Expiration sent as epoch milliseconds when enabled. |
| Authentication / OTP | AUTHENTICATION | Predefined text, optional security recommendation, optional expiration of 1–90 min. COPY_CODE, ONE_TAP, or ZERO_TAP; code up to 15 in the body and send URL button. Up to five Android apps, package up to 224, and 11-character hash. Zero-tap requires explicit acceptance in the form. |
| Flow | MARKETING, UTILITY | Published Flow by ID, navigate with an initial screen or data_exchange. Optional token/initial data when sending. |
| Call permission | MARKETING, UTILITY | Body + CALL_PERMISSION_REQUEST, no other interactive components. |

Name: up to 512 characters, lowercase letters/numbers/underscores. Languages: official list
in `languages.ts`. Variables: sequential positional or named (lowercase letters
/underscores), examples for each variable, no invalid braces or dangling variables
at the ends of the body. Filled text must also respect the limits.

Common buttons: up to 10 total; QUICK_REPLY up to 10, URL up to two (up to 2000 characters,
one variable at the end), PHONE_NUMBER up to one (phone up to 20), COPY_CODE up to one,
FLOW up to one, and VOICE_CALL up to one. Labels up to 25; VOICE_CALL up to 20 and validity at
creation of 1440–43200 minutes (sending accepts an override of 1–43200). Quick replies
must form a group before or after the other buttons. Catalog/MPM/SPM have
fixed labels. OTP cannot be mixed with other types.

The preview is illustrative; visual details depend on the client version. More than three
buttons show two and “View all options”. Products show placeholders/SKUs because
the integration does not read catalog images, prices, or titles. Offers/coupons and some
button combinations have limitations on WhatsApp Web/Desktop.

## Backend (`api/supabase/functions/whatsapp-management`)

- `POST /whatsapp-management/template-media?organization_id=<uuid>` (admin/owner):
  multipart with `organization_address`, `format` (`IMAGE`/`VIDEO`/`DOCUMENT`), and `file`.
  Validates type and size, calls Meta's Resumable Upload API with the WABA token
  (which never reaches the browser), and returns `{ "header_handle": "4::..." }`.
- Creation passes through `parameter_format` (`named`/`positional`).
- Listing requests `id,name,status,category,language,parameter_format,components,rejected_reason,quality_score`
  and follows Meta pagination to the end. Meta returns `parameter_format` in
  uppercase (`POSITIONAL`); `catalog.ts` normalizes it.

## Outside this step

No API/database changes, commits, or test writes to the real organization.
We do not implement Flow publishing/editing, catalog/inventory, Android handshake,
SIP telephony, permission requests outside templates, or payment management.
GIF requires the Marketing Messages API; it is not offered as a Cloud API header.
Regional payments, booking/location-request, and unified-catalog require
specific integrations and are outside the editor. Unknown components in listings are
preserved and blocked from duplication/sending rather than discarded.
Policy validation and semantic classifications are handled by Meta.

## Verification

Vitest uses fixtures, mocked session/fetch, and mocked creation/send callbacks.
No test calls Meta or writes to the database. Run in `web/`:
`pnpm test`, `pnpm typecheck`, and `pnpm build`.
