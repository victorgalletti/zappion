// SPDX-License-Identifier: AGPL-3.0-only
import { createClient } from "@supabase/supabase-js";
import type {
  Database,
  WhatsAppContactAddressExtra,
} from "../_shared/supabase.ts";
import { updateContact } from "./zappion_contacts.ts";
import { contactName } from "../_shared/supabase.ts";

function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}

function fixture(options: {
  extra?: WhatsAppContactAddressExtra;
  missing?: boolean;
  multipleAccounts?: boolean;
  writeError?: boolean;
} = {}) {
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  let storedExtra: WhatsAppContactAddressExtra | undefined;
  let reads = 0;
  const supabase = createClient<Database>("https://example.test", "test-key", {
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        reads++;
        assert(
          url.searchParams.get("organization_id") === "eq.org" ||
            request.method === "POST",
        );
        if (url.pathname.endsWith("/organizations_addresses")) {
          assert(url.searchParams.get("service") === "eq.whatsapp");
          assert(
            url.searchParams.get("extra->>'phone_number'") ===
              "in.(15557654321)",
          );
          const account = {
            address: "account-id",
            phone: "15557654321",
            name: "Account",
          };
          return Response.json(
            options.multipleAccounts
              ? [account, { ...account, phone: "15557654322" }]
              : [account],
          );
        }
        assert(url.pathname.endsWith("/contacts_addresses"));
        assert(url.searchParams.get("select") === "extra");
        if (request.method !== "POST") {
          assert(url.searchParams.get("service") === "eq.whatsapp");
          assert(
            url.searchParams.get("organization_address") === "eq.account-id",
          );
          assert(url.searchParams.get("address") === "eq.15551234567");
        }
        const extra = options.extra ?? { name: "Old", username: "keep-me" };
        if (request.method === "GET") {
          return Response.json(options.missing ? null : { extra });
        }
        const body = await request.json();
        writes.push({ method: request.method, body });
        assert(
          JSON.stringify(body.extra) === JSON.stringify({ saved_name: "New" }),
        );
        if (options.writeError) {
          return Response.json({ message: "Write refused", code: "42501" }, {
            status: 403,
          });
        }
        storedExtra = { ...extra, ...body.extra };
        return Response.json({ extra: storedExtra });
      },
    },
  });
  return {
    writes,
    storedExtra: () => storedExtra,
    reads: () => reads,
    params: {
      supabase,
      orgId: "org",
      contactPhone: "+1 (555) 123-4567",
      accountPhone: "+1 (555) 765-4321",
      name: "  New  ",
      allowedAccounts: ["15557654321"],
      allowedContacts: ["15551234567"],
    },
  };
}

async function refuses(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    assert((error as { message: string }).message.includes(message));
    return;
  }
  throw new Error("Expected refusal");
}

Deno.test("contact update patches only saved_name and inserts the account-scoped missing row", async () => {
  for (const missing of [false, true]) {
    const { params, writes } = fixture({ missing });
    const result = await updateContact(params);
    assert(
      JSON.stringify(result) ===
        JSON.stringify({ contact: { phone: "15551234567", name: "New" } }),
    );
    assert(writes.length === 1);
    assert(writes[0].method === (missing ? "POST" : "PATCH"));
    assert(
      JSON.stringify(writes[0].body) === JSON.stringify(
        missing
          ? {
            organization_id: "org",
            organization_address: "account-id",
            service: "whatsapp",
            address: "15551234567",
            extra: { saved_name: "New" },
          }
          : { extra: { saved_name: "New" } },
      ),
    );
  }
});

Deno.test("synced add refuses without writing; removed sync keeps contactName precedence", async () => {
  const synced = fixture({
    extra: { synced: { action: "add", name: "Synced" } },
  });
  await refuses(
    () => updateContact(synced.params),
    "WhatsApp Business app address book",
  );
  assert(synced.writes.length === 0);
  const removed = fixture({
    extra: { synced: { action: "remove", name: "Retained" } },
  });
  assert((await updateContact(removed.params)).contact.name === "Retained");
});

Deno.test("saved contact name survives webhook push-name merges", async () => {
  const f = fixture({
    extra: { name: "Old push name", saved_name: "Old saved name" },
  });
  await updateContact(f.params);
  assert(f.storedExtra()?.name === "Old push name");
  assert(f.storedExtra()?.saved_name === "New");
  // The webhook keeps writing name; set_extra merges it into the stored extra.
  const afterWebhook = { ...f.storedExtra(), name: "New push name" };
  assert(contactName(afterWebhook) === "New");
  assert(
    contactName({
      ...afterWebhook,
      synced: { action: "add", name: "Address book" },
    }) === "Address book",
  );
  assert(contactName({ name: "Push only" }) === "Push only");
  assert(contactName({ saved_name: "Saved only" }) === "Saved only");
  assert(contactName(null) === undefined);
});

Deno.test("contact update enforces allowlists and account selection before writes", async () => {
  const f = fixture();
  await refuses(
    () => updateContact({ ...f.params, allowedContacts: ["other"] }),
    "is not allowed",
  );
  assert(f.reads() === 0);
  await refuses(
    () => updateContact({ ...f.params, accountPhone: "15550000000" }),
    "not found in allowed accounts",
  );
  assert(f.writes.length === 0);
  const multiple = fixture({ multipleAccounts: true });
  await refuses(
    () => updateContact({ ...multiple.params, accountPhone: undefined }),
    "Multiple accounts",
  );
  assert(multiple.writes.length === 0);
  const single = fixture();
  await updateContact({ ...single.params, accountPhone: undefined });
  assert(single.writes.length === 1);
});

Deno.test("contact update validates trimmed name and propagates write errors", async () => {
  for (const name of ["   ", "x".repeat(101)]) {
    const f = fixture();
    await refuses(() => updateContact({ ...f.params, name }), "");
    assert(f.reads() === 0);
  }
  const failure = fixture({ writeError: true });
  await refuses(() => updateContact(failure.params), "Write refused");
});
