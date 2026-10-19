// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { usePreferences } from "@/lib/preferences";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

const ThemeContext = createContext<{ theme: Theme; preference: ThemePreference; setPreference: (value: ThemePreference) => void }>({ theme: "light", preference: "system", setPreference: () => {} });
const OrganizationContext = createContext<string | undefined>(undefined);

export const useTheme = () => useContext(ThemeContext);
export const useOrganizationId = () => useContext(OrganizationContext);

export function OrganizationProvider({ id, children }: { id: string | undefined; children: ReactNode }) {
  return <OrganizationContext.Provider value={id}>{children}</OrganizationContext.Provider>;
}

function readTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* storage blocked */
  }
  return "system";
}

export function Providers({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences();
  useEffect(() => {
    document.documentElement.lang = preferences.language;
  }, [preferences.language]);
  useEffect(() => {
    document.documentElement.dataset.fontSize = preferences.fontSize;
  }, [preferences.fontSize]);
  useEffect(() => {
    document.documentElement.dataset.chatBg = preferences.chatBackground;
    document.documentElement.dataset.chatWallpaper = String(preferences.chatWallpaper);
  }, [preferences.chatBackground, preferences.chatWallpaper]);
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }),
  );
  const [preference, setThemePreference] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<Theme>("light");
  const theme = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    setThemePreference(readTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setPreference = useCallback((value: ThemePreference) => {
    setThemePreference(value);
    try {
      localStorage.setItem("theme", value);
    } catch {
      /* storage blocked */
    }
  }, []);

  return (
    <QueryClientProvider client={client}>
      <ThemeContext.Provider value={{ theme, preference, setPreference }}>{children}</ThemeContext.Provider>
    </QueryClientProvider>
  );
}
