// SPDX-License-Identifier: AGPL-3.0-only
// Zappion: what send_message reports. A key that requires approval has its
// messages held by the database (zappion_hold_for_approval, 04-95) until a
// member approves them in Zappion, so the agent learns it was not sent yet.
export function sendResult(row: { id: string; status: unknown }) {
  const status = row.status as Record<string, unknown> | null;

  if (status?.awaiting_approval && !status.pending) {
    return {
      status: "pending_approval" as const,
      id: row.id,
      message:
        "Held for approval: a member must approve this message in Zappion before it is sent.",
    };
  }

  return { status: "sent" as const, id: row.id };
}
