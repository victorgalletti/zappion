// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { Lock } from "lucide-react";

/** Right pane with no conversation open, as whatsapp-web-ui's unselected-page. */
export function Unselected() {
  const t = useT();
  return (
    <section className="flex min-w-0 flex-1 flex-col items-center justify-center border-b-[6px] border-accent bg-unselected px-10 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/zappion-logo.png" alt="" className="mb-8 size-40 max-w-full drop-shadow-xl" />
      <h1 className="text-[2rem] font-light text-heading">Zappion</h1>
      <p className="mt-4 max-w-md text-sm leading-6 text-sub">
        {t.unselected.helpYourCustomersThroughTheOfficialApiChats}
      </p>
      <p className="mt-10 flex items-center gap-1.5 text-xs text-sub">
        <Lock className="size-3" /> {t.unselected.connectedThroughTheOfficialWhatsappBusinessApi}
      </p>
    </section>
  );
}
