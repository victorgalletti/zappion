// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
// Ported from an earlier CRM (delivery-status.tsx), reading the Zappion API's status map.

import { AlertCircle, Check, CheckCheck, Clock, Hourglass } from "lucide-react";
import { deliveryState, failureReason } from "@/lib/messages";
import type { MessageStatusMap } from "@/lib/types";

export function DeliveryStatus({ status }: { status: MessageStatusMap | null }) {
  const t = useT();
  const state = deliveryState(status);

  if (state === "failed") {
    const reason = failureReason(status) ?? t.deliveryStatus.failedToSend;
    return (
      <span className="group/tip relative inline-flex">
        <AlertCircle className="text-orange-500" size={14} aria-label={t.deliveryStatus.failedToSend} />
        <span className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 hidden w-max max-w-64 rounded-md bg-gray-900 px-2 py-1 text-[0.6875rem] leading-snug text-white shadow-lg group-hover/tip:block">
          {reason}
        </span>
      </span>
    );
  }
  // Held messages never reached WhatsApp, so they get no ticks.
  if (state === "rejected") return <span className="text-danger">{t.deliveryStatus.rejected}</span>;
  if (state === "awaiting_approval") return <Hourglass className="text-sub" size={13} aria-label={t.deliveryStatus.awaitingApproval} />;
  if (state === "sending") return <Clock className="text-sub" size={13} aria-label={t.deliveryStatus.sending} />;
  if (state === "sent") return <Check className="text-sub" size={15} aria-label={t.deliveryStatus.sent} />;
  if (state === "read") return <CheckCheck className="text-read" size={15} aria-label={t.deliveryStatus.read} />;
  return <CheckCheck className="text-sub" size={15} aria-label={t.deliveryStatus.delivered} />;
}
