import {
  createUnsecureClient,
  type Database,
  type TemplateData,
} from "../_shared/supabase.ts";
import {
  accessTokenFor,
  appIdFor,
} from "../_shared/zappion_whatsapp_credentials.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as log from "../_shared/logger.ts";
import { HTTPException } from "jsr:@hono/hono/http-exception";
import { ContentfulStatusCode } from "jsr:@hono/hono/utils/http-status";

const API_VERSION = "v24.0";

async function getBusinessCredentials(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
): Promise<{ waba_id: string; access_token: string }> {
  // The caller's client: RLS decides whether they may use this number.
  const { data, error } = await client
    .from("organizations_addresses")
    .select("extra->>waba_id")
    .eq("organization_id", organization_id)
    .eq("address", organization_address)
    .single();

  if (error || !data) {
    log.error("Could not fetch business access token", error);
    throw new HTTPException(403, {
      message: "Could not fetch business access token",
      cause: error,
    });
  }

  return {
    waba_id: data.waba_id,
    access_token: await accessTokenFor(
      createUnsecureClient(),
      organization_id,
      organization_address,
    ),
  };
}

export async function listTemplates(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
): Promise<{ data: TemplateData[] }> {
  const { waba_id, access_token } = await getBusinessCredentials(
    client,
    organization_id,
    organization_address,
  );

  // Zappion: ask for the fields the template list shows (rejection reason,
  // quality) and follow Meta's cursor so every template comes back.
  const url = new URL(
    `https://graph.facebook.com/${API_VERSION}/${waba_id}/message_templates`,
  );
  url.searchParams.set(
    "fields",
    "id,name,status,category,language,parameter_format,components,rejected_reason,quality_score",
  );
  url.searchParams.set("limit", "100");

  const data: TemplateData[] = [];
  let next: string | undefined = url.toString();
  while (next) {
    const response: Response = await fetch(next, {
      method: "GET",
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!response.ok) {
      throw new HTTPException(response.status as ContentfulStatusCode, {
        message: "Could not fetch templates",
        cause: await response.json().catch(() => ({})),
      });
    }

    const page = await response.json() as {
      data?: TemplateData[];
      paging?: { next?: string };
    };
    data.push(...(page.data ?? []));
    next = page.paging?.next;
  }

  return { data };
}

export async function fetchTemplate(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
  template: TemplateData,
): Promise<TemplateData> {
  const { access_token } = await getBusinessCredentials(
    client,
    organization_id,
    organization_address,
  );

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${template.id}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${access_token}` },
    },
  );

  if (!response.ok) {
    throw new HTTPException(response.status as ContentfulStatusCode, {
      message: "Could not fetch template",
      cause: await response.json().catch(() => ({})),
    });
  }

  return await response.json();
}

export async function createTemplate(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
  template: TemplateData,
): Promise<{
  id: string;
  status: string;
  category: string;
}> {
  const { waba_id, access_token } = await getBusinessCredentials(
    client,
    organization_id,
    organization_address,
  );

  const { name, category, language, components } = template;

  // Zappion: named variables ({{customer}}) need parameter_format.
  const parameter_format = (template as { parameter_format?: string })
    .parameter_format?.toLowerCase();
  if (
    parameter_format !== undefined &&
    parameter_format !== "named" && parameter_format !== "positional"
  ) {
    throw new HTTPException(400, {
      message: "parameter_format must be named or positional",
    });
  }

  const filteredTemplate = {
    name,
    category,
    allow_category_change: true,
    language,
    ...(parameter_format ? { parameter_format } : {}),
    components,
  };

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${waba_id}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(filteredTemplate),
    },
  );

  if (!response.ok) {
    throw new HTTPException(response.status as ContentfulStatusCode, {
      message: "Could not create template",
      cause: await response.json().catch(() => ({})),
    });
  }

  return await response.json();
}

export async function editTemplate(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
  template: TemplateData,
): Promise<{
  success: boolean;
}> {
  const { access_token } = await getBusinessCredentials(
    client,
    organization_id,
    organization_address,
  );

  const { category, components } = template;
  const filteredTemplate = { category, components };

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${template.id}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(filteredTemplate),
    },
  );

  if (!response.ok) {
    throw new HTTPException(response.status as ContentfulStatusCode, {
      message: "Could not update template",
      cause: await response.json().catch(() => ({})),
    });
  }

  return await response.json();
}

export async function deleteTemplate(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
  template: TemplateData,
): Promise<{
  success: boolean;
}> {
  const { waba_id, access_token } = await getBusinessCredentials(
    client,
    organization_id,
    organization_address,
  );

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${waba_id}/message_templates?name=${template.name}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    },
  );

  if (!response.ok) {
    throw new HTTPException(response.status as ContentfulStatusCode, {
      message: "Could not delete template",
      cause: await response.json().catch(() => ({})),
    });
  }

  return await response.json();
}

// Zappion: media headers on template CREATION take a `header_handle` from
// Meta's Resumable Upload API (not a /PHONE_NUMBER_ID/media id). The browser
// sends the file here; the WABA token never leaves the server.
const TEMPLATE_MEDIA: Record<string, { types: string[]; maxBytes: number }> = {
  IMAGE: { types: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024 },
  VIDEO: { types: ["video/mp4"], maxBytes: 16 * 1024 * 1024 },
  DOCUMENT: { types: ["application/pdf"], maxBytes: 100 * 1024 * 1024 },
};

export async function uploadTemplateMedia(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
  format: string,
  file: File,
): Promise<{ header_handle: string }> {
  const rules = TEMPLATE_MEDIA[format];
  if (!rules) {
    throw new HTTPException(400, {
      message: "format must be IMAGE, VIDEO or DOCUMENT",
    });
  }
  if (!rules.types.includes(file.type)) {
    throw new HTTPException(415, {
      message: `${format} must be one of: ${rules.types.join(", ")}`,
    });
  }
  if (file.size === 0 || file.size > rules.maxBytes) {
    throw new HTTPException(413, {
      message: `${format} must be at most ${rules.maxBytes / 1024 / 1024} MB`,
    });
  }

  const appId = await appIdFor(createUnsecureClient(), organization_id);
  if (!appId) {
    throw new HTTPException(500, {
      message:
        "No Meta App configured for this organization (Settings › Meta App) or in META_APP_ID",
    });
  }

  const { access_token } = await getBusinessCredentials(
    client,
    organization_id,
    organization_address,
  );

  const session = new URL(
    `https://graph.facebook.com/${API_VERSION}/${appId}/uploads`,
  );
  session.searchParams.set("file_name", file.name || "header");
  session.searchParams.set("file_length", String(file.size));
  session.searchParams.set("file_type", file.type);

  const sessionResponse = await fetch(session, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!sessionResponse.ok) {
    throw new HTTPException(sessionResponse.status as ContentfulStatusCode, {
      message: "Could not start template media upload",
      cause: await sessionResponse.json().catch(() => ({})),
    });
  }
  const { id: uploadId } = await sessionResponse.json() as { id: string };

  const uploadResponse = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${uploadId}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${access_token}`,
        file_offset: "0",
      },
      body: file,
    },
  );
  if (!uploadResponse.ok) {
    throw new HTTPException(uploadResponse.status as ContentfulStatusCode, {
      message: "Could not upload template media",
      cause: await uploadResponse.json().catch(() => ({})),
    });
  }
  const { h } = await uploadResponse.json() as { h?: string };
  if (!h) {
    throw new HTTPException(502, {
      message: "Meta returned no header handle",
    });
  }

  return { header_handle: h };
}
