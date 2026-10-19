// SPDX-License-Identifier: AGPL-3.0-only
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/supabase.ts";
import { keyAllowedAccounts } from "./zappion_allowed_accounts.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function fixture(rows: unknown[] = [], error = false) {
  const requests: URL[] = [];
  const supabase = createClient<Database>("https://example.test", "test-key", {
    global: {
      fetch: (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push(url);
        equal(request.method, "GET");
        equal(url.pathname, "/rest/v1/organizations_addresses");
        equal(url.searchParams.get("organization_id"), "eq.org");
        equal(url.searchParams.get("service"), "eq.whatsapp");
        equal(url.searchParams.get("select"), "phone:extra->>phone_number");
        return Promise.resolve(
          error
            ? Response.json({ message: "Read denied" }, { status: 403 })
            : Response.json(rows),
        );
      },
    },
  });
  return { supabase, requests };
}

Deno.test("unrestricted keys and OAuth retain the optional header filter", async () => {
  const { supabase, requests } = fixture();
  equal(await keyAllowedAccounts(supabase, "org", null, []), null);
  equal(await keyAllowedAccounts(supabase, "org", null, ["15550001"]), [
    "15550001",
  ]);
  equal(requests.length, 0);
});

Deno.test("key addresses resolve to phones within the org and WhatsApp service", async () => {
  const { supabase, requests } = fixture([
    { phone: "15550001" },
    { phone: "15550002" },
    { phone: "15550001" },
  ]);
  equal(
    await keyAllowedAccounts(supabase, "org", ["meta-id-1", "meta-id-2"], []),
    ["15550001", "15550002"],
  );
  equal(requests[0].searchParams.get("address"), "in.(meta-id-1,meta-id-2)");
});

Deno.test("a header can narrow a restricted key but cannot widen it", async () => {
  const { supabase } = fixture([{ phone: "15550001" }, { phone: "15550002" }]);
  equal(
    await keyAllowedAccounts(supabase, "org", ["meta-id"], [
      "15550002",
      "19999999",
    ]),
    ["15550002"],
  );
  equal(
    await keyAllowedAccounts(supabase, "org", ["meta-id"], ["19999999"]),
    [],
  );
});

Deno.test("missing accounts or phone metadata and empty restrictions fail closed", async () => {
  for (
    const rows of [[], [{ phone: null }, { phone: "" }, { phone: 123 }, {
      phone: "invalid",
    }]]
  ) {
    const { supabase } = fixture(rows);
    equal(await keyAllowedAccounts(supabase, "org", ["deleted-id"], []), []);
  }
  const { supabase, requests } = fixture();
  equal(await keyAllowedAccounts(supabase, "org", [], ["15550001"]), []);
  equal(requests.length, 0);
});

Deno.test("lookup failures propagate instead of removing the restriction", async () => {
  const { supabase } = fixture([], true);
  try {
    await keyAllowedAccounts(supabase, "org", ["meta-id"], []);
  } catch (error) {
    equal((error as Error).message, "Read denied");
    return;
  }
  throw new Error("Expected account lookup to fail");
});
