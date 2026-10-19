// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { enUS, ptBR } from "date-fns/locale";
import { DEFAULT_PREFERENCES, getPreferences, usePreferences, type Language } from "@/lib/preferences";
import { en, type Messages } from "./en";
import { ptBRMessages } from "./pt-BR";

export type { Messages };

const catalogs: Record<Language, { messages: Messages; locale: string; dateLocale: typeof enUS }> = {
  en: { messages: en, locale: "en-US", dateLocale: enUS },
  "pt-BR": { messages: ptBRMessages, locale: "pt-BR", dateLocale: ptBR },
};

/** Messages for the current language, for components. Re-renders when the language changes. */
export function useT(): Messages {
  return catalogs[usePreferences().preferences.language].messages;
}

/** The current language's messages, Intl locale and date-fns locale. */
export function useLocale() {
  return catalogs[usePreferences().preferences.language];
}

/**
 * Same as useT for code outside React (formatters, error mappers). Reads the
 * current preference without subscribing, so call it at format time, never at
 * module load.
 */
export function getT(): Messages {
  return getLocale().messages;
}

export function getLocale() {
  const language = typeof window === "undefined" ? DEFAULT_PREFERENCES.language : getPreferences().language;
  return catalogs[language];
}
