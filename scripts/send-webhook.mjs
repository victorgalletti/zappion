#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Sends a webhook signed exactly the way Meta signs it, so the whole receiving
// side can be exercised without a real number.
//
//   node scripts/send-webhook.mjs verify
//   node scripts/send-webhook.mjs inbound --text "hi"
//   node scripts/send-webhook.mjs echo --text "replied from the phone"
//   node scripts/send-webhook.mjs history
//   node scripts/send-webhook.mjs inbound --text "this one" --reply-to <wamid>
//   node scripts/send-webhook.mjs reaction --to-message <wamid> --emoji "❤️"
//
// Reads WHATSAPP_VERIFY_TOKEN and META_APP_SECRET from api/supabase/functions/.env.
// URL defaults to the local functions server; override with --url.
// An organization's own Meta App (Settings › Meta App): pass
// --app-id <id> --secret <app secret> (and --verify-token <token> for verify).

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, "api/supabase/functions/.env"), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const [kind = "inbound", ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, "")] = rest[i + 1];

const base = args.url ?? `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/whatsapp-webhook`;
const url = args["app-id"] ? `${base}${base.includes("?") ? "&" : "?"}app_id=${encodeURIComponent(args["app-id"])}` : base;
const secret = args.secret ?? env.META_APP_SECRET;
const verifyToken = args["verify-token"] ?? env.WHATSAPP_VERIFY_TOKEN;
// Defaults match the seeded "Mountain Peaks" organization in supabase/seed.sql.
const phoneNumberId = args["phone-number-id"] ?? "318232498042593";
const businessNumber = args["business-number"] ?? "5492604237115";
const customer = args.from ?? "541133525394";
const text = args.text ?? "Test message";
const now = Math.floor(Date.now() / 1000);

const metadata = { display_phone_number: businessNumber, phone_number_id: phoneNumberId };
// BSUID: present on every webhook since April 2026, the stable identity.
const userId = args["user-id"] ?? `BR.${customer}`;
const contact = { profile: { name: "Test Customer" }, wa_id: customer, user_id: userId };

function envelope(field, value) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "309222208943804", changes: [{ field, value }] }],
  };
}

const payloads = {
  // Customer → business, the ordinary case.
  inbound: () =>
    envelope("messages", {
      messaging_product: "whatsapp",
      metadata,
      contacts: [contact],
      messages: [{
        from: customer, from_user_id: userId, id: `wamid.test.${randomUUID()}`, timestamp: String(now), type: "text", text: { body: text },
        // --reply-to <wamid>: the customer quoting one of our messages.
        ...(args["reply-to"] ? { context: { from: businessNumber, id: args["reply-to"] } } : {}),
      }],
    }),
  // --to-message <wamid> --emoji 👍 (empty --emoji removes it).
  reaction: () =>
    envelope("messages", {
      messaging_product: "whatsapp",
      metadata,
      contacts: [contact],
      messages: [{
        from: customer, from_user_id: userId, id: `wamid.test.${randomUUID()}`, timestamp: String(now), type: "reaction",
        reaction: { message_id: args["to-message"], emoji: args.emoji ?? "👍" },
      }],
    }),
  // Business → customer, typed on the phone. Coexistence only.
  echo: () =>
    envelope("smb_message_echoes", {
      messaging_product: "whatsapp",
      metadata,
      message_echoes: [{ from: businessNumber, to: customer, to_user_id: userId, id: `wamid.test.${randomUUID()}`, timestamp: String(now), type: "text", text: { body: text } }],
    }),
  // One thread of the 180-day history import. Coexistence only.
  history: () =>
    envelope("history", {
      messaging_product: "whatsapp",
      metadata,
      history: [{
        metadata: { phase: 0, chunk_order: 1, progress: 100 },
        threads: [{
          id: customer,
          context: { wa_id: customer, user_id: userId },
          messages: [
            { from: customer, id: `wamid.test.${randomUUID()}`, timestamp: String(now - 86400), type: "text", text: { body: "Old customer message" }, history_context: { status: "READ" } },
            { from: businessNumber, to: customer, id: `wamid.test.${randomUUID()}`, timestamp: String(now - 86000), type: "text", text: { body: "Old reply from the phone" }, history_context: { status: "READ" } },
          ],
        }],
      }],
    }),
};

if (kind === "verify") {
  const challenge = randomUUID();
  const qs = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": verifyToken, "hub.challenge": challenge });
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}${qs}`);
  const body = await response.text();
  console.log(response.status, body === challenge ? "challenge echoed ✓" : `unexpected: ${body}`);
  process.exit(body === challenge ? 0 : 1);
}

if (!payloads[kind]) {
  console.error(`Unknown kind: ${kind}. Use verify, inbound, echo, history or reaction.`);
  process.exit(1);
}

const body = JSON.stringify(payloads[kind]());
const signature = createHmac("sha256", secret).update(body).digest("hex");
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}` },
  body,
});
console.log(kind, response.status, await response.text());
