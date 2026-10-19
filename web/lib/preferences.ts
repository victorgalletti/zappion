// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { getT } from "@/lib/i18n";
import { useSyncExternalStore } from "react";

// Resolve labels when read so imports never capture a language.
export const CHAT_BACKGROUNDS = [
  { id: "default", get label() { return getT().preferences.default; } },
  { id: "green", get label() { return getT().preferences.green; } },
  { id: "blue", get label() { return getT().preferences.blue; } },
  { id: "lavender", get label() { return getT().preferences.lavender; } },
  { id: "rose", get label() { return getT().preferences.rose; } },
  { id: "sand", get label() { return getT().preferences.sand; } },
  { id: "slate", get label() { return getT().preferences.gray; } },
] as const;

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "pt-BR", label: "Português (Brasil)" },
] as const;
export type Language = typeof LANGUAGES[number]["id"];

export type Preferences = {
  language: Language;
  signatureEnabled: boolean;
  signatureName: string;
  fontSize: "small" | "default" | "large";
  enterToSend: boolean;
  audioRate: 1 | 1.5 | 2;
  notificationSound: boolean;
  desktopNotifications: boolean;
  chatWallpaper: boolean;
  chatBackground: typeof CHAT_BACKGROUNDS[number]["id"];
};

export const DEFAULT_PREFERENCES: Readonly<Preferences> = { language: "en", signatureEnabled: false, signatureName: "", fontSize: "default", enterToSend: true, audioRate: 1, notificationSound: true, desktopNotifications: false, chatWallpaper: true, chatBackground: "default" };
const STORAGE_KEY = "preferences";
const validators: { [K in keyof Preferences]: (value: unknown) => boolean } = {
  language: (value) => LANGUAGES.some(({ id }) => id === value),
  signatureEnabled: (value) => typeof value === "boolean",
  signatureName: (value) => typeof value === "string" && value.length <= 40,
  fontSize: (value) => value === "small" || value === "default" || value === "large",
  enterToSend: (value) => typeof value === "boolean",
  notificationSound: (value) => typeof value === "boolean",
  desktopNotifications: (value) => typeof value === "boolean",
  audioRate: (value) => value === 1 || value === 1.5 || value === 2,
  chatWallpaper: (value) => typeof value === "boolean",
  chatBackground: (value) => CHAT_BACKGROUNDS.some(({ id }) => id === value),
};
const keys = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[];
const listeners = new Set<() => void>();
let snapshot = DEFAULT_PREFERENCES;
let initialized = false;

/** Until the person picks a language, follow the browser's. */
function browserLanguage(): Language {
  try {
    return navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
  } catch {
    return "en";
  }
}

function parsePreferences(raw: string | null): Readonly<Preferences> {
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...DEFAULT_PREFERENCES, language: browserLanguage() };
    const valid = Object.fromEntries(keys.filter((key) => validators[key]((saved as Record<string, unknown>)[key])).map((key) => [key, (saved as Record<string, unknown>)[key]]));
    return { ...DEFAULT_PREFERENCES, language: browserLanguage(), ...valid };
  } catch {
    return { ...DEFAULT_PREFERENCES, language: browserLanguage() };
  }
}

function updateSnapshot(next: Readonly<Preferences>) {
  if (keys.every((key) => next[key] === snapshot[key])) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function readPreferences() {
  try {
    updateSnapshot(parsePreferences(window.localStorage.getItem(STORAGE_KEY)));
  } catch {
    /* storage blocked */
  }
  initialized = true;
}

function getSnapshot() {
  if (!initialized && typeof window !== "undefined") readPreferences();
  return snapshot;
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
  } catch {
    return;
  }
  updateSnapshot(parsePreferences(event.newValue));
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    readPreferences();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setPreferences(patch: Partial<Preferences> | ((current: Readonly<Preferences>) => Partial<Preferences>)) {
  const current = getSnapshot();
  const next = parsePreferences(JSON.stringify({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  updateSnapshot(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
}

/** Current preferences outside React; does not subscribe. */
export function getPreferences() {
  return getSnapshot();
}

export function usePreferences() {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFERENCES);
  return { preferences, setPreferences };
}
