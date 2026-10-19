// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { deliveryState, isAwaitingApproval } from "./messages";

describe("deliveryState with approval statuses", () => {
  it.each([
    [null, "sending"],
    [{ pending: "t" }, "sending"],
    [{ awaiting_approval: "t" }, "awaiting_approval"],
    [{ awaiting_approval: "t", approved: "t" }, "sending"],
    [{ awaiting_approval: "t", approved: "t", pending: "t" }, "sending"],
    [{ awaiting_approval: "t", approved: "t", pending: "t", accepted: "t" }, "sent"],
    [{ awaiting_approval: "t", approved: "t", pending: "t", sent: "t", delivered: "t", read: "t" }, "read"],
    [{ awaiting_approval: "t", approved: "t", pending: "t", failed: "t" }, "failed"],
    [{ awaiting_approval: "t", rejected: "t" }, "rejected"],
  ] as const)("maps %j to %s", (status, state) => {
    expect(deliveryState(status)).toBe(state);
  });

  it("waits for approval only while no decision or dispatch is recorded", () => {
    expect(isAwaitingApproval({ awaiting_approval: "t" })).toBe(true);
    expect(isAwaitingApproval({ awaiting_approval: "t", pending: "t" })).toBe(false);
    expect(isAwaitingApproval({ awaiting_approval: "t", approved: "t" })).toBe(false);
    expect(isAwaitingApproval({ awaiting_approval: "t", rejected: "t" })).toBe(false);
    expect(isAwaitingApproval({ sent: "t" })).toBe(false);
    expect(isAwaitingApproval(null)).toBe(false);
  });
});
