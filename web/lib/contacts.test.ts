// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { contactName } from "./contacts";

describe("contact display names", () => {
  it("prefers the address book, then the organization-saved name, then the push name", () => {
    const extra = { name: "Push", saved_name: "Saved", synced: { name: "Address book" } };
    expect(contactName(extra)).toBe("Address book");
    expect(contactName({ ...extra, synced: undefined })).toBe("Saved");
    expect(contactName({ name: "Push" })).toBe("Push");
    expect(contactName({ saved_name: "Saved" })).toBe("Saved");
    expect(contactName(null)).toBeUndefined();
    expect(contactName(undefined)).toBeUndefined();
    expect(contactName({ ...extra, synced: { name: "" } })).toBe("");
  });

  it("retains the saved display name when the webhook updates the push name", () => {
    const extra = { name: "Old push", saved_name: "Saved" };
    expect(contactName({ ...extra, name: "New push" })).toBe("Saved");
  });
});
