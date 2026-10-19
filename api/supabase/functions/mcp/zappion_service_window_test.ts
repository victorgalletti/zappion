// SPDX-License-Identifier: AGPL-3.0-only
import { calculateServiceWindow } from "./zappion_service_window.ts";

const incoming = "2026-10-15T12:00:00.000Z";
const incomingMs = Date.parse(incoming);

function assertWindow(
  actual: ReturnType<typeof calculateServiceWindow>,
  expected: ReturnType<typeof calculateServiceWindow>,
) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("service window is open at 23h59", () => {
  assertWindow(
    calculateServiceWindow(incoming, incomingMs + 1439 * 60 * 1000),
    {
      status: "open",
      last_incoming_at: incoming,
      closes_at: "2026-10-16T12:00:00.000Z",
      remaining_minutes: 1,
    },
  );
});

Deno.test("service window is closed at exactly 24h00", () => {
  assertWindow(
    calculateServiceWindow(incoming, incomingMs + 1440 * 60 * 1000),
    {
      status: "closed",
      last_incoming_at: incoming,
      closes_at: "2026-10-16T12:00:00.000Z",
      remaining_minutes: 0,
    },
  );
});

Deno.test("service window has null timestamps without an incoming message", () => {
  assertWindow(calculateServiceWindow(null, incomingMs), {
    status: "closed",
    last_incoming_at: null,
    closes_at: null,
    remaining_minutes: null,
  });
});

Deno.test("service window keeps millisecond precision at the cutoff", () => {
  const closesMs = incomingMs + 24 * 60 * 60 * 1000;
  assertWindow(calculateServiceWindow(incoming, closesMs - 1), {
    status: "open",
    last_incoming_at: incoming,
    closes_at: "2026-10-16T12:00:00.000Z",
    remaining_minutes: 0,
  });
  assertWindow(calculateServiceWindow(incoming, closesMs + 1), {
    status: "closed",
    last_incoming_at: incoming,
    closes_at: "2026-10-16T12:00:00.000Z",
    remaining_minutes: 0,
  });
});
