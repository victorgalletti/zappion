// SPDX-License-Identifier: AGPL-3.0-only
import { getT, getLocale } from "@/lib/i18n";
import { clsx, type ClassValue } from "clsx";
import { format, isToday, isYesterday, differenceInCalendarDays } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const timeOf = (iso: string) => format(new Date(iso), "p", { locale: getLocale().dateLocale });

/** Sidebar timestamp, like WhatsApp: time today, "Yesterday", weekday this week, date after. */
export function listTime(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "p", { locale: getLocale().dateLocale });
  if (isYesterday(d)) return getT().utils.yesterday;
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEEE", { locale: getLocale().dateLocale });
  return format(d, "P", { locale: getLocale().dateLocale });
}

/** Day separator in the chat. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return getT().utils.today;
  if (isYesterday(d)) return getT().utils.yesterday;
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEEE", { locale: getLocale().dateLocale });
  return format(d, "P", { locale: getLocale().dateLocale });
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/);
  if (!parts[0]) return "#";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
