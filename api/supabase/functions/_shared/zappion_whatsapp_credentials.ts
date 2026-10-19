// SPDX-License-Identifier: AGPL-3.0-only
// Zappion: where the WhatsApp (Meta) credentials come from.
//
// Database first, environment second, so installs that only set
// META_APP_ID / META_APP_SECRET / META_SYSTEM_USER_ACCESS_TOKEN /
// WHATSAPP_VERIFY_TOKEN keep working unchanged:
//
// - An organization's own Meta App lives in `whatsapp_apps` + Vault (see the
//   zappion_whatsapp_credentials migration). The webhook names it with
//   `?app_id=`.
// - Each connected number's token lives in Vault, never in
//   organizations_addresses.extra (which every member can read).
//
// Every lookup here uses the service role: callers must already have checked
// that the request may touch the organization.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase.ts";
import * as log from "./logger.ts";

export const GRAPH_API_VERSION = "v24.0";

const ENV_APP_IDS = (Deno.env.get("META_APP_ID") ?? "").split("|").filter(
  Boolean,
);
const ENV_APP_SECRETS = (Deno.env.get("META_APP_SECRET") ?? "").split("|")
  .filter(Boolean);
const ENV_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const ENV_ACCESS_TOKEN = Deno.env.get("META_SYSTEM_USER_ACCESS_TOKEN") ?? "";
// The public HTTPS base Meta can reach (a domain, or an ngrok tunnel in
// development). Inside the edge runtime SUPABASE_URL is internal, so it is
// not a fallback.
const WEBHOOK_PUBLIC_URL = (Deno.env.get("WEBHOOK_PUBLIC_URL") ?? "").replace(
  /\/+$/,
  "",
);

/** The webhook fields Zappion needs, coexistence included. */
const REQUIRED_WEBHOOK_FIELDS = [
  "messages",
  "smb_message_echoes",
  "history",
  "smb_app_state_sync",
  "account_update",
];

/**
 * Subscribed when the App is allowed to: Meta refuses `user_id_update`
 * (BSUID changes) to Apps without that permission, with a generic
 * "An unknown error occurred", and would reject the whole request.
 */
const OPTIONAL_WEBHOOK_FIELDS = ["user_id_update"];

export const WEBHOOK_FIELDS = [
  ...REQUIRED_WEBHOOK_FIELDS,
  ...OPTIONAL_WEBHOOK_FIELDS,
];

/** Meta's readable error text: error_user_msg when it sends one. */
function metaError(body: unknown, fallback: string): string {
  const error = (body as {
    error?: { message?: string; error_user_msg?: string };
  })?.error;
  return error?.error_user_msg || error?.message || fallback;
}

/** The callback URL to register in Meta for an App, if the public URL is set. */
export function webhookCallbackUrl(app_id: string): string | null {
  return WEBHOOK_PUBLIC_URL
    ? `${WEBHOOK_PUBLIC_URL}/functions/v1/whatsapp-webhook?app_id=${
      encodeURIComponent(app_id)
    }`
    : null;
}

type Client = SupabaseClient<Database>;

export type ResolvedApp = {
  app_id: string;
  app_secret: string;
  verify_token: string;
  /** Set when the App belongs to one organization: its webhooks may only
   * touch that organization's numbers. null for the operator's env Apps. */
  organization_id: string | null;
};

/**
 * The App a webhook or a signup speaks for. With an `app_id`, the
 * organization's App wins over the environment list; without one, the first
 * environment App (the historical behaviour).
 */
export async function resolveApp(
  client: Client,
  app_id: string | null,
): Promise<ResolvedApp | null> {
  if (app_id) {
    const { data, error } = await client
      .rpc("whatsapp_app_credentials", { p_app_id: app_id })
      .maybeSingle();

    if (error) {
      log.error("Could not read the organization's Meta App", error);
    } else if (data?.app_secret) {
      return {
        app_id: data.app_id,
        app_secret: data.app_secret,
        verify_token: data.verify_token ?? "",
        organization_id: data.organization_id,
      };
    }
  }

  if (ENV_APP_IDS.length !== ENV_APP_SECRETS.length) {
    log.warn(
      "META_APP_ID and META_APP_SECRET must have the same number of elements, separated by '|'",
    );
    return null;
  }

  const index = app_id ? ENV_APP_IDS.indexOf(app_id) : 0;
  if (index === -1 || !ENV_APP_IDS[index]) return null;

  return {
    app_id: ENV_APP_IDS[index],
    app_secret: ENV_APP_SECRETS[index],
    verify_token: ENV_VERIFY_TOKEN,
    organization_id: null,
  };
}

/** The token to call Meta for a number: its own, the org's, then the env's. */
export async function accessTokenFor(
  client: Client,
  organization_id: string,
  address: string,
): Promise<string> {
  const { data, error } = await client.rpc("whatsapp_access_token", {
    p_organization_id: organization_id,
    p_address: address,
  });

  if (error) log.error("Could not read the number's access token", error);

  return data || ENV_ACCESS_TOKEN;
}

/** The organization's system user token, without the env fallback. */
export async function organizationSystemToken(
  client: Client,
  organization_id: string,
): Promise<string | null> {
  const { data } = await client
    .rpc("whatsapp_org_app_credentials", {
      p_organization_id: organization_id,
    })
    .maybeSingle();

  return data?.system_token ?? null;
}

/** The App ID to use for an organization (e.g. template media uploads). */
export async function appIdFor(
  client: Client,
  organization_id: string,
): Promise<string | null> {
  const { data } = await client
    .rpc("whatsapp_org_app_credentials", {
      p_organization_id: organization_id,
    })
    .maybeSingle();

  return data?.app_id ?? ENV_APP_IDS[0] ?? null;
}

/** Stores a number's token in Vault; a null or blank token removes it. */
export async function storeAccessToken(
  client: Client,
  organization_id: string,
  address: string,
  token: string | null,
): Promise<void> {
  const { error } = await client.rpc("whatsapp_address_token_set", {
    p_organization_id: organization_id,
    p_address: address,
    p_token: token ?? "",
  });

  if (error) {
    throw new Error("Could not store the number's access token", {
      cause: error,
    });
  }
}

/** HMAC-SHA256 of the raw body, as Meta sends it in X-Hub-Signature-256. */
export async function signatureMatches(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
  );
  const expected = Array.from(signature)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const received = header.replace(/^sha256=/, "");

  // Constant-time comparison: do not leak how many leading characters match.
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

/** Stable reasons the screen translates; `message` is Meta's own text. */
export type CredentialProblem =
  | "app_not_found"
  | "app_secret_rejected"
  | "token_invalid"
  | "token_other_app"
  | "token_missing_scopes"
  | "meta_unavailable"
  | "no_public_url"
  | "webhook_rejected";

export type AppCheck = { ok: true; name: string } | {
  ok: false;
  reason: CredentialProblem;
  message: string;
};

/** Checks an App ID + App Secret pair against Meta with an app token. */
export async function checkApp(
  app_id: string,
  app_secret: string,
): Promise<AppCheck> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${app_id}`,
  );
  url.searchParams.set("fields", "name");
  url.searchParams.set("access_token", `${app_id}|${app_secret}`);

  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message: string = body?.error?.message ??
      "Meta rejected the App ID or Secret";
    // Meta answers an id that is not an App (a business portfolio, WABA or
    // Page id, or a typo) with code 190 "Cannot get application info", and a
    // real App with the wrong secret with some other error (often code 100).
    const reason: CredentialProblem = response.status >= 500
      ? "meta_unavailable"
      : body?.error?.code === 190 &&
          /application info|invalid application id/i.test(message)
      ? "app_not_found"
      : "app_secret_rejected";
    return { ok: false, reason, message };
  }

  return { ok: true, name: body.name ?? app_id };
}

export type TokenCheck =
  | { ok: true; scopes: string[]; expires_at: number | null }
  | { ok: false; reason: CredentialProblem; message: string };

const REQUIRED_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
];

/** Checks that a system user token is valid, belongs to the App and can use
 * WhatsApp. */
export async function checkSystemToken(
  app_id: string,
  app_secret: string,
  token: string,
): Promise<TokenCheck> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token`,
  );
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${app_id}|${app_secret}`);

  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  const data = body?.data;

  if (!response.ok || !data) {
    return {
      ok: false,
      reason: response.status >= 500 ? "meta_unavailable" : "token_invalid",
      message: body?.error?.message ?? "Meta could not check the token",
    };
  }
  if (!data.is_valid) {
    return {
      ok: false,
      reason: "token_invalid",
      message: data.error?.message ?? "The token is invalid or expired",
    };
  }
  if (String(data.app_id) !== app_id) {
    return {
      ok: false,
      reason: "token_other_app",
      message: "The token belongs to a different App",
    };
  }

  const scopes: string[] = data.scopes ?? [];
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
  if (missing.length) {
    return {
      ok: false,
      reason: "token_missing_scopes",
      message: `The token is missing permissions: ${missing.join(", ")}`,
    };
  }

  return {
    ok: true,
    scopes,
    expires_at: data.expires_at ? Number(data.expires_at) : null,
  };
}

export type WebhookStatus = {
  /** What Meta has for the App's whatsapp_business_account webhook. */
  callback_url: string | null;
  active: boolean;
  missing_fields: string[];
  /** True when Meta points at this install's callback URL. */
  matches: boolean;
};

/** Reads the App's WhatsApp webhook subscription from Meta. */
export async function appWebhookStatus(
  app_id: string,
  app_secret: string,
): Promise<
  WebhookStatus | { ok: false; reason: CredentialProblem; message: string }
> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${app_id}/subscriptions`,
  );
  url.searchParams.set("access_token", `${app_id}|${app_secret}`);

  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      reason: response.status >= 500
        ? "meta_unavailable"
        : "app_secret_rejected",
      message: metaError(body, "Meta could not read the webhook"),
    };
  }

  type Subscription = {
    object: string;
    callback_url: string;
    active: boolean;
    fields: { name: string }[];
  };
  const subscription = (body.data as Subscription[] | undefined)?.find((s) =>
    s.object === "whatsapp_business_account"
  );
  const names = subscription?.fields.map((f) => f.name) ?? [];
  const expected = webhookCallbackUrl(app_id);

  return {
    callback_url: subscription?.callback_url ?? null,
    active: subscription?.active ?? false,
    missing_fields: WEBHOOK_FIELDS.filter((f) => !names.includes(f)),
    matches: !!expected && subscription?.callback_url === expected,
  };
}

/**
 * Registers this install's callback URL and fields on the App. Meta calls the
 * callback with the verify token right away, so the App's verify token must
 * already be saved and the public URL reachable.
 */
export async function subscribeAppWebhook(
  app_id: string,
  app_secret: string,
  verify_token: string,
): Promise<
  { ok: true } | { ok: false; reason: CredentialProblem; message: string }
> {
  const callback_url = webhookCallbackUrl(app_id);

  if (!callback_url) {
    return {
      ok: false,
      reason: "no_public_url",
      message: "WEBHOOK_PUBLIC_URL is not set on the server",
    };
  }

  const subscribe = async (fields: string[]) => {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${app_id}/subscriptions`,
      {
        method: "POST",
        body: new URLSearchParams({
          object: "whatsapp_business_account",
          callback_url,
          verify_token,
          fields: fields.join(","),
          include_values: "true",
          access_token: `${app_id}|${app_secret}`,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    return { response, body, ok: response.ok && body?.success !== false };
  };

  const required = await subscribe(REQUIRED_WEBHOOK_FIELDS);

  if (!required.ok) {
    return {
      ok: false,
      reason: required.response.status >= 500
        ? "meta_unavailable"
        : "webhook_rejected",
      message: metaError(required.body, "Meta did not accept the webhook"),
    };
  }

  // Optional fields one by one; a refusal only leaves them in missing_fields.
  for (const field of OPTIONAL_WEBHOOK_FIELDS) {
    const optional = await subscribe([field]);
    if (!optional.ok) {
      log.warn("Meta refused an optional webhook field", {
        app_id,
        field,
        message: metaError(optional.body, "refused"),
      });
    }
  }

  return { ok: true };
}
