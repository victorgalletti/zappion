// SPDX-License-Identifier: AGPL-3.0-only
import { sendResult } from "./zappion_send_result.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("an armed message is reported as sent", () => {
  assertEquals(
    sendResult({ id: "m1", status: { pending: "2026-10-16T12:00:00Z" } }),
    { status: "sent", id: "m1" },
  );
});

Deno.test("a held message is reported as pending approval", () => {
  const result = sendResult({
    id: "m2",
    status: { awaiting_approval: "2026-10-16T12:00:00Z" },
  });

  assertEquals({ status: result.status, id: result.id }, {
    status: "pending_approval",
    id: "m2",
  });
});

Deno.test("an approved message is no longer pending approval", () => {
  assertEquals(
    sendResult({
      id: "m3",
      status: {
        awaiting_approval: "2026-10-16T12:00:00Z",
        approved: "2026-10-16T12:01:00Z",
        pending: "2026-10-16T12:01:00Z",
      },
    }).status,
    "sent",
  );
});
