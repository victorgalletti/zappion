#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Creates the development data on a local Supabase: a login user and an
// organization where that user is the owner. Idempotent: run it again after a
// `supabase db reset`. Connect a number afterwards in Settings › Instances.
//
//   node scripts/seed-dev.mjs
//   node scripts/seed-dev.mjs --demo-number   # also connect a fictitious number
//
// --demo-number connects DEMO_PHONE_NUMBER_ID to the organization, so
// `node scripts/send-webhook.mjs inbound --phone-number-id <it>` lands in this
// inbox. Sending from it fails, since no real number is behind it.
//
// Reads TEST_USER_EMAIL / TEST_USER_PASSWORD from web/.env.local (see
// web/.env.example). SUPABASE_URL and SUPABASE_SECRET_KEY default to the local
// Supabase CLI values, which are public.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "web/.env.local");
const env = Object.fromEntries(
  (existsSync(envFile) ? readFileSync(envFile, "utf8") : "").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const get = (key, fallback) => process.env[key] ?? env[key] ?? fallback;

const url = get("SUPABASE_URL", "http://127.0.0.1:54321");
const secret = get("SUPABASE_SECRET_KEY", "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz");
const email = get("TEST_USER_EMAIL");
const password = get("TEST_USER_PASSWORD");
const organizationName = get("TEST_ORGANIZATION_NAME", "Zappion Demo");
if (!email || !password) throw new Error("Set TEST_USER_EMAIL and TEST_USER_PASSWORD in web/.env.local.");

const headers = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
async function call(path, init = {}) {
  const response = await fetch(url + path, { ...init, headers: { ...headers, ...init.headers } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

const { users } = await call("/auth/v1/admin/users?per_page=1000");
const user = users.find((u) => u.email === email) ??
  await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });

const [agent] = await call(`/rest/v1/agents?select=organization_id&user_id=eq.${user.id}&limit=1`);
let organizationId = agent?.organization_id;
if (agent) {
  console.log(`User ${email} is already a member of organization ${agent.organization_id}.`);
} else {
  const [organization] = await call("/rest/v1/organizations?select=id", {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: organizationName, extra: {} }),
  });
  await call("/rest/v1/agents", {
    method: "POST",
    body: JSON.stringify({ name: email.split("@")[0], user_id: user.id, organization_id: organization.id, role: "owner" }),
  });
  organizationId = organization.id;
  console.log(`Created organization "${organizationName}" (${organization.id}) with ${email} as owner.`);
}

const DEMO_PHONE_NUMBER_ID = "100000000000001";
const DEMO_BUSINESS_NUMBER = "5511900000000";

if (process.argv.includes("--demo-number")) {
  const [existing] = await call(
    `/rest/v1/organizations_addresses?select=organization_id&service=eq.whatsapp&address=eq.${DEMO_PHONE_NUMBER_ID}`,
  );
  if (existing && existing.organization_id !== organizationId) {
    console.log(`Demo number ${DEMO_PHONE_NUMBER_ID} already belongs to organization ${existing.organization_id}.`);
  } else if (existing) {
    console.log(`Demo number ${DEMO_PHONE_NUMBER_ID} is already connected.`);
  } else {
    await call("/rest/v1/organizations_addresses", {
      method: "POST",
      body: JSON.stringify({
        organization_id: organizationId,
        service: "whatsapp",
        address: DEMO_PHONE_NUMBER_ID,
        status: "connected",
        extra: { phone_number: DEMO_BUSINESS_NUMBER, verified_name: "Zappion Demo", waba_id: "100000000000002" },
      }),
    });
    console.log(`Connected the demo number ${DEMO_PHONE_NUMBER_ID} (+${DEMO_BUSINESS_NUMBER}).`);
  }
}
