// SPDX-License-Identifier: AGPL-3.0-only
import { getT, getLocale } from "@/lib/i18n";
import { inferKind } from "./catalog";
import type { TemplateLike } from "./types";

// Resolve labels when read so imports never capture a language.
export const TEMPLATE_STATUS: Record<string, { label: string; style: string }> = {
  APPROVED: { get label() { return getT().templatesDisplay.approved; }, style: "bg-accent/15 text-accent" },
  PENDING: { get label() { return getT().templatesDisplay.pending; }, style: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  REJECTED: { get label() { return getT().templatesDisplay.rejected; }, style: "bg-danger/15 text-danger" },
  PAUSED: { get label() { return getT().templatesDisplay.paused; }, style: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  DISABLED: { get label() { return getT().templatesDisplay.disabled; }, style: "bg-danger/15 text-danger" },
  IN_APPEAL: { get label() { return getT().templatesDisplay.underReview; }, style: "bg-panel text-sub" },
  DELETED: { get label() { return getT().templatesDisplay.deleted; }, style: "bg-panel text-sub" },
  PENDING_DELETION: { get label() { return getT().templatesDisplay.pendingDeletion; }, style: "bg-panel text-sub" },
  LIMIT_EXCEEDED: { get label() { return getT().templatesDisplay.limitExceeded; }, style: "bg-danger/15 text-danger" },
};
const QUALITY: Record<string, string> = { get GREEN() { return getT().templatesDisplay.high; }, get YELLOW() { return getT().templatesDisplay.medium; }, get RED() { return getT().templatesDisplay.low; }, get UNKNOWN() { return getT().templatesDisplay.notYetRated; } };
export function templateQuality(score?: string) { return score ? QUALITY[score] ?? score : getT().templatesDisplay.notProvidedByTheApi; }
export type TemplateFilters = { query: string; status: string; category: string; kind: string; language: string };
export const emptyTemplateFilters: TemplateFilters = { query: "", status: "", category: "", kind: "", language: "" };
export function filterTemplates<T extends TemplateLike>(templates: T[], filters: TemplateFilters): T[] {
  const query = filters.query.trim().toLocaleLowerCase(getLocale().locale);
  return templates.filter(t => t.name.toLocaleLowerCase(getLocale().locale).includes(query)
    && (!filters.status || t.status === filters.status)
    && (!filters.category || t.category === filters.category)
    && (!filters.kind || inferKind(t) === filters.kind)
    && (!filters.language || t.language === filters.language));
}
