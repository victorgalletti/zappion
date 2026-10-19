// SPDX-License-Identifier: AGPL-3.0-only
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/supabase.ts";
import {
  markConversationRead,
  setConversationArchived,
} from "./zappion_conversation_actions.ts";

function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}

function fixture(options: {
  empty?: boolean;
  error?: boolean;
  multipleAccounts?: boolean;
} = {}) {
  const requests: { url: URL; body: unknown }[] = [];
  const supabase = createClient<Database>("https://example.test", "test-key", {
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : null;
        requests.push({ url, body });
        if (url.pathname.endsWith("/organizations_addresses")) {
          assert(url.searchParams.get("organization_id") === "eq.org");
          assert(url.searchParams.get("service") === "eq.whatsapp");
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
        if (url.pathname.includes("/rpc/")) {
          if (options.error) {
            return Response.json({ message: "RPC refused", code: "42501" }, {
              status: 403,
            });
          }
          return new Response(null, { status: 204 });
        }
        assert(url.searchParams.get("organization_id") === "eq.org");
        assert(url.searchParams.get("service") === "eq.whatsapp");
        assert(
          url.searchParams.get("organization_address") === "eq.account-id",
        );
        assert(url.searchParams.get("select") === "id");
        const messages = url.pathname.endsWith("/messages");
        assert(
          url.searchParams.get(
            messages ? "conversation_address" : "address",
          ) ===
            "eq.15551234567",
        );
        if (messages) {
          assert(url.searchParams.get("sender_address") === "not.is.null");
          assert(url.searchParams.get("order") === "timestamp.desc,id.desc");
          assert(url.searchParams.get("limit") === "1");
        }
        return Response.json(options.empty ? [] : [{ id: "latest-id" }]);
      },
    },
  });
  return {
    requests,
    params: {
      supabase,
      orgId: "org",
      contactPhone: "+1 (555) 123-4567",
      accountPhone: "+1 (555) 765-4321",
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

Deno.test("mark read selects one latest incoming ID and disables typing", async () => {
  const { params, requests } = fixture();
  const result = await markConversationRead(params);
  assert(result.marked_message_id === "latest-id");
  const rpc = requests.at(-1)!;
  assert(rpc.url.pathname.endsWith("/rpc/mark_read"));
  assert(
    JSON.stringify(rpc.body) ===
      JSON.stringify({ p_message_id: "latest-id", p_typing: false }),
  );
  assert(
    requests[0].url.searchParams.get("extra->>'phone_number'") ===
      "in.(15557654321)",
  );
});

Deno.test("mark read with no incoming message does not write", async () => {
  const { params, requests } = fixture({ empty: true });
  assert((await markConversationRead(params)).marked_message_id === null);
  assert(requests.every((r) => !r.url.pathname.includes("/rpc/")));
});

Deno.test("archive and unarchive use the resolved conversation and caller RPC", async () => {
  for (const archived of [true, false]) {
    const { params, requests } = fixture();
    assert(
      (await setConversationArchived(params, archived)).archived === archived,
    );
    const rpc = requests.at(-1)!;
    assert(rpc.url.pathname.endsWith("/rpc/zappion_mcp_set_archived"));
    assert(
      JSON.stringify(rpc.body) === JSON.stringify({
        p_organization_id: "org",
        p_conversation_id: "latest-id",
        p_archived: archived,
      }),
    );
  }
});

Deno.test("conversation actions enforce contact and account restrictions before writes", async () => {
  for (
    const action of [
      markConversationRead,
      (params: Parameters<typeof markConversationRead>[0]) =>
        setConversationArchived(params, true),
    ]
  ) {
    const { params, requests } = fixture();
    await refuses(
      () => action({ ...params, allowedContacts: ["other"] }),
      "is not allowed",
    );
    assert(requests.length === 0);
    await refuses(
      () => action({ ...params, accountPhone: "15550000000" }),
      "not found in allowed accounts",
    );
    assert(requests.every((r) => !r.url.pathname.includes("/rpc/")));

    const multiple = fixture({ multipleAccounts: true });
    await refuses(
      () => action({ ...multiple.params, accountPhone: undefined }),
      "Multiple accounts",
    );
  }
});

Deno.test("missing archive conversation and RPC authorization failures propagate", async () => {
  const empty = fixture({ empty: true });
  await refuses(
    () => setConversationArchived(empty.params, true),
    "Conversation not found",
  );
  assert(empty.requests.every((r) => !r.url.pathname.includes("/rpc/")));
  const failure = fixture({ error: true });
  await refuses(() => markConversationRead(failure.params), "RPC refused");
  await refuses(
    () => setConversationArchived(failure.params, false),
    "RPC refused",
  );
});
