// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { ArrowLeft } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared geometry for page, drawer and conversation headers. */
export function PageHeader({ title, titleId, subtitle, actions, leading, onBack, backLabel, className, ...props }: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: ReactNode;
  /** A status line under the title (a conversation's number and window), not an explanation. */
  subtitle?: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  leading?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  const t = useT();
  return <header {...props} className={cn("relative flex h-[72px] min-h-[72px] shrink-0 items-center gap-3 border-b border-line bg-surface px-5 text-heading", className)}>
    {onBack && <button type="button" onClick={onBack} aria-label={backLabel ?? t.pageHeader.back} title={backLabel ?? t.pageHeader.back} className="flex size-10 shrink-0 items-center justify-center rounded-full text-icon hover:bg-panel"><ArrowLeft className="size-5" /></button>}
    {leading}
    {subtitle ? <div className="min-w-0 flex-1">
      <h1 id={titleId} className="truncate text-xl font-semibold tracking-tight">{title}</h1>
      <p className="truncate text-xs text-sub">{subtitle}</p>
    </div> : <h1 id={titleId} className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{title}</h1>}
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>;
}
