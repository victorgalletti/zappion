// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { getT, useLocale } from "@/lib/i18n";
import { useEffect, useState } from "react";

const HOUR = 60 * 60_000;
const STEP = 5 * 60_000;

/** Pure scheduling logic: wake only when the displayed bucket changes. */
export function serviceWindow(closesAt: number, now: number) {
  const remaining = closesAt - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { open: false, text: getT().serviceWindow.closed, next: null };
  if (remaining >= HOUR) {
    const hours = Math.floor(remaining / HOUR);
    return { open: true, text: getT().serviceWindow.hours(hours), next: closesAt - hours * HOUR + 1 };
  }
  const minutes = Math.floor(remaining / STEP) * 5;
  return {
    open: true,
    text: getT().serviceWindow.minutes(minutes),
    next: minutes ? closesAt - minutes * 60_000 + 1 : closesAt,
  };
}

export function useServiceWindow(timestamp?: string) {
  const { messages: t, locale } = useLocale();
  const closesAt = timestamp ? new Date(timestamp).getTime() + 24 * HOUR : NaN;
  const [now, setNow] = useState(() => Date.now());
  const state = serviceWindow(closesAt, now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const refresh = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", tick);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", tick); };
  }, [closesAt]);
  useEffect(() => {
    if (state.next === null) return;
    const timeout = setTimeout(() => setNow(Date.now()), Math.max(1, state.next - Date.now()));
    return () => clearTimeout(timeout);
  }, [state.next, now]);
  return { ...state, title: Number.isFinite(closesAt) ? t.serviceWindow.closesAt(new Date(closesAt).toLocaleString(locale)) : t.serviceWindow.noMessages };
}
