// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/supabase.ts";
import type { FilePart } from "../_shared/types/message_types.ts";
import { fetchMedia as fetchMediaTool } from "./zappion_media.ts";

type StorageCall = { method: string; key: string; expires?: number };
const callsByClient = new WeakMap<SupabaseClient<Database>, StorageCall[]>();

// Exercise the real privileged client factory without contacting Storage.
async function fetchMedia(params: Parameters<typeof fetchMediaTool>[0]) {
  const previousUrl = Deno.env.get("SUPABASE_URL");
  const previousKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", previousUrl ?? "http://kong:8000");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert(request.method === "POST");
    assert(request.headers.get("authorization") === "Bearer test-service-role");
    const prefix = "/storage/v1/object/sign/media/";
    const path = new URL(request.url).pathname;
    assert(path.startsWith(prefix), "Privileged client must only sign URLs");
    const { expiresIn } = await request.json();
    callsByClient.get(params.supabase)!.push({
      method: "sign",
      key: path.slice(prefix.length),
      expires: expiresIn,
    });
    return Response.json({
      signedURL:
        "/object/sign/media/organizations/org/attachments/hash?token=signed-token",
    });
  };
  try {
    return await fetchMediaTool(params);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", previousUrl);
    if (previousKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey);
  }
}

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function fixture(options: {
  part?: unknown;
  bytes?: number;
  messageOverrides?: Record<string, unknown>;
  accounts?: { address: string; phone: string; name: string }[];
} = {}) {
  const part: FilePart = {
    type: "file",
    kind: "image",
    file: {
      uri: "internal://media/organizations/org/attachments/hash",
      mime_type: "image/png",
      size: 3,
    },
    text: "Customer caption",
    artifacts: [
      { type: "text", kind: "transcription", text: "Customer transcription" },
      { type: "text", kind: "description", text: "Customer description" },
    ],
  };
  const message = {
    organization_id: "org",
    organization_address: "account-id",
    conversation_address: "15551234567",
    service: "whatsapp",
    external_id: "external-id",
    "content->internal": null,
    content: options.part ?? part,
    ...options.messageOverrides,
  };
  const storageCalls: StorageCall[] = [];
  const filters: Record<string, unknown> = {};
  const client = {
    from(table: string) {
      const rows = table === "messages" ? [message] : options.accounts ?? [{
        organization_id: "org",
        service: "whatsapp",
        status: "connected",
        address: "account-id",
        phone: "15557654321",
        name: "Account",
        "extra->>'phone_number'": "15557654321",
      }];
      const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
      const query = {
        select(_fields: string) {
          return query;
        },
        eq(field: string, value: unknown) {
          if (table === "messages") filters[field] = value;
          predicates.push((row) => row[field] === value);
          return query;
        },
        is(field: string, value: unknown) {
          return query.eq(field, value);
        },
        in(field: string, values: unknown[]) {
          predicates.push((row) => values.includes(row[field]));
          return query;
        },
        maybeSingle() {
          return {
            throwOnError() {
              return {
                data: rows.find((row) => predicates.every((p) => p(row))) ??
                  null,
              };
            },
          };
        },
        throwOnError() {
          return {
            data: rows.filter((row) => predicates.every((p) => p(row))),
          };
        },
      };
      return query;
    },
    storage: {
      from(bucket: string) {
        assert(bucket === "media");
        return {
          createSignedUrl(_key: string, _expires: number) {
            // Storage's POST policy hides objects from read-only API keys.
            return {
              data: null,
              error: { message: "Object not found" },
            };
          },
          download(key: string) {
            storageCalls.push({ method: "download", key });
            return {
              data: new Blob([new Uint8Array(options.bytes ?? 3)]),
              error: null,
            };
          },
        };
      },
    },
  };
  callsByClient.set(
    client as unknown as SupabaseClient<Database>,
    storageCalls,
  );
  return {
    params: {
      supabase: client as unknown as SupabaseClient<Database>,
      orgId: "org",
      contactPhone: "+1 (555) 123-4567",
      messageId: "external-id",
      allowedAccounts: [] as string[],
      allowedContacts: [] as string[],
    },
    part,
    storageCalls,
    filters,
  };
}

async function refuses(params: Parameters<typeof fetchMedia>[0], text: string) {
  try {
    await fetchMedia(params);
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(text),
      String(error),
    );
    return;
  }
  throw new Error("Expected media request to fail");
}

Deno.test("media returns metadata, artifacts, signed URL and a small image", async () => {
  const previous = Deno.env.get("SUPABASE_URL");
  try {
    for (const origin of ["http://kong:8000", "https://project.supabase.co"]) {
      Deno.env.set("SUPABASE_URL", origin);
      const { params, storageCalls, filters } = fixture();
      const result = await fetchMedia(params);
      assert(result.content[0].type === "text");
      const metadata = JSON.parse(result.content[0].text);
      const publicOrigin = origin.startsWith("https:")
        ? origin
        : "http://127.0.0.1:54321";
      assert(
        metadata.url ===
          `${publicOrigin}/storage/v1/object/sign/media/organizations/org/attachments/hash?token=signed-token`,
      );
      assert(metadata.message_id === "external-id" && metadata.name === null);
      assert(metadata.caption === "Customer caption");
      assert(metadata.transcription === "Customer transcription");
      assert(metadata.description === "Customer description");
      assert(
        result.content[1].type === "image" && result.content[1].data === "AAAA",
      );
      assert(result.content[1].mimeType === "image/png");
      assert(storageCalls[0].expires === 600);
      assert(
        storageCalls.every((call) =>
          call.key === "organizations/org/attachments/hash"
        ),
      );
      assert(filters.organization_id === "org");
      assert(filters.organization_address === "account-id");
      assert(filters.conversation_address === "15551234567");
      assert(filters.external_id === "external-id");
    }
  } finally {
    if (previous === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", previous);
  }
});

Deno.test("media enforces contact and account allowlists", async () => {
  const { params, storageCalls } = fixture();
  await refuses({ ...params, allowedContacts: ["other"] }, "not allowed");
  await refuses({ ...params, allowedAccounts: ["other"] }, "No connected");
  await refuses({ ...params, accountPhone: "+999" }, "not found");
  assert(storageCalls.length === 0);
});

Deno.test("media rejects messages outside the conversation and internal rows", async () => {
  for (
    const field of [
      "organization_id",
      "organization_address",
      "conversation_address",
      "service",
      "external_id",
      "content->internal",
    ]
  ) {
    const { params, storageCalls } = fixture({
      messageOverrides: { [field]: "other" },
    });
    await refuses(params, "not found in this conversation");
    assert(storageCalls.length === 0);
  }
  const { params } = fixture({
    part: { type: "text", kind: "text", text: "No file" },
  });
  await refuses(params, "no file part");
});

Deno.test("media rejects cross-org paths, traversal and unsupported URI schemes", async () => {
  for (
    const uri of [
      "internal://media/organizations/other/attachments/hash",
      "internal://media/organizations/org/attachments/../hash",
      "internal://media/organizations/org/attachments/%2e%2e%2fhash",
      "file:///secret",
    ]
  ) {
    const f = fixture();
    f.part.file.uri = uri;
    await refuses(f.params, "Unsupported media URI");
    assert(f.storageCalls.length === 0);
  }
});

Deno.test("media never downloads or signs external URLs, even small images", async () => {
  for (
    const uri of [
      "https://example.com/image.png?x=1",
      "http://example.com/image.png",
    ]
  ) {
    const f = fixture();
    f.part.file.uri = uri;
    const result = await fetchMedia(f.params);
    assert(result.content.length === 1 && result.content[0].type === "text");
    assert(JSON.parse(result.content[0].text).url === uri);
    assert(f.storageCalls.length === 0);
  }
});

Deno.test("media only inlines images within the actual one MB boundary", async () => {
  for (const bytes of [1_000_000, 1_000_001]) {
    const f = fixture({ bytes });
    const result = await fetchMedia(f.params);
    assert(result.content.length === (bytes === 1_000_000 ? 2 : 1));
  }
  for (const mimeType of ["audio/ogg", "video/mp4", "application/pdf"]) {
    const f = fixture();
    f.part.file.mime_type = mimeType;
    const result = await fetchMedia(f.params);
    assert(result.content.length === 1 && f.storageCalls.length === 1);
  }
  const f = fixture();
  f.part.file.size = 1_000_001;
  assert((await fetchMedia(f.params)).content.length === 1);
  assert(f.storageCalls.length === 1);
});
