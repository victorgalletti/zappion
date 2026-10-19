// Zappion: connect a WhatsApp number by hand, without Embedded Signup — for
// numbers created directly in Meta's WhatsApp Manager, using a permanent
// (System User) token. Same end state as performEmbeddedSignup: the WABA
// subscribed to our webhooks, optionally the number registered on Cloud API,
// an organizations_addresses row, and the token in Vault. The token may be
// left out when the organization has its own Meta App with a system user
// token (Settings › Meta App).
import * as log from "../_shared/logger.ts";
import { HTTPException } from "jsr:@hono/hono/http-exception";
import { ContentfulStatusCode } from "jsr:@hono/hono/utils/http-status";
import {
  type createClient,
  createUnsecureClient,
} from "../_shared/supabase.ts";
import {
  organizationSystemToken,
  storeAccessToken,
} from "../_shared/zappion_whatsapp_credentials.ts";
import {
  getPhoneNumber,
  normalizePhoneNumber,
  postRegisterPhoneNumber,
  postSubscribeToWebhooks,
} from "./embedded_signup.ts";

const API_VERSION = "v24.0";

export type ManualConnectPayload = {
  organization_id: string;
  phone_number_id: string;
  waba_id: string;
  /** Optional when the organization has its own App's system user token. */
  access_token?: string;
  /** Register the number on Cloud API (new numbers). Needs `pin`. */
  register?: boolean;
  /** Two-step verification PIN, 6 digits. */
  pin?: string;
  label?: string;
  callback_url?: string;
  verify_token?: string;
};

async function wabaHasNumber(
  access_token: string,
  waba_id: string,
  phone_number_id: string,
): Promise<boolean> {
  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${waba_id}/phone_numbers?fields=id&limit=100`,
    { headers: { Authorization: `Bearer ${access_token}` } },
  );

  if (!response.ok) {
    throw new HTTPException(response.status as ContentfulStatusCode, {
      message: "Could not read the WABA (check the WABA id and the token)",
      cause: await response.json().catch(() => ({})),
    });
  }

  const { data } = (await response.json()) as { data: { id: string }[] };
  return data.some((n) => n.id === phone_number_id);
}

export async function performManualConnect(
  client: ReturnType<typeof createClient>,
  payload: ManualConnectPayload,
) {
  const phone_number_id = payload.phone_number_id?.trim();
  const waba_id = payload.waba_id?.trim();
  const own_token = payload.access_token?.trim() || null;
  const access_token = own_token ??
    await organizationSystemToken(
      createUnsecureClient(),
      payload.organization_id,
    );

  if (!phone_number_id || !waba_id) {
    throw new HTTPException(400, {
      message: "phone_number_id and waba_id are required",
    });
  }
  if (!access_token) {
    throw new HTTPException(400, {
      message:
        "access_token is required (or set up the organization's Meta App with a system user token)",
    });
  }
  if (!/^\d+$/.test(phone_number_id) || !/^\d+$/.test(waba_id)) {
    throw new HTTPException(400, {
      message: "phone_number_id and waba_id are numeric ids",
    });
  }
  if (payload.register && !/^\d{6}$/.test(payload.pin ?? "")) {
    throw new HTTPException(400, {
      message: "Registering needs the 6-digit two-step verification PIN",
    });
  }

  const ctx = { organization_id: payload.organization_id, phone_number_id };

  log.info("Manual connect: checking token and number", ctx);
  const phone_number = await getPhoneNumber(access_token, phone_number_id);
  if (!await wabaHasNumber(access_token, waba_id, phone_number_id)) {
    throw new HTTPException(422, {
      message: `Phone number ${phone_number_id} is not on WABA ${waba_id}`,
    });
  }

  log.info("Manual connect: subscribing the WABA to webhooks", ctx);
  await postSubscribeToWebhooks(
    access_token,
    waba_id,
    payload.callback_url,
    payload.verify_token,
  );

  if (payload.register) {
    log.info("Manual connect: registering the number", ctx);
    await postRegisterPhoneNumber(access_token, phone_number_id, payload.pin!);
  }

  const label = payload.label?.trim();
  const { data, error } = await client
    .from("organizations_addresses")
    .upsert({
      service: "whatsapp",
      address: phone_number_id,
      organization_id: payload.organization_id,
      status: "connected",
      extra: {
        waba_id,
        flow_type: "manual",
        phone_number: normalizePhoneNumber(phone_number.display_phone_number),
        verified_name: phone_number.verified_name,
        callback_url: payload.callback_url || null,
        verify_token: payload.verify_token || null,
        ...(label ? { label } : {}),
      },
    })
    .select("organization_id, service, address, status")
    .single();

  if (error) {
    throw new HTTPException(500, {
      message: "Could not persist phone number data",
      cause: error,
    });
  }

  // Only a token typed for this number is stored; without one the number uses
  // the organization's token, so a stale per-number token is removed.
  await storeAccessToken(
    createUnsecureClient(),
    payload.organization_id,
    phone_number_id,
    own_token,
  );

  await client.from("logs").insert({
    organization_id: payload.organization_id,
    organization_address: data.address,
    category: "signup",
    service: "whatsapp",
    level: "info",
    message: "WhatsApp account connected manually",
  });

  log.info("Manual connect: account connected", ctx);
  return data;
}
