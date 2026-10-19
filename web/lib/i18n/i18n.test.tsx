// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers";
import { DEFAULT_PREFERENCES, setPreferences, usePreferences } from "@/lib/preferences";
import { getLocale, getT, useT } from ".";
import { en } from "./en";
import { ptBRMessages } from "./pt-BR";

beforeEach(() => { localStorage.clear(); act(() => setPreferences(DEFAULT_PREFERENCES)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => typeof child === "object" && child ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
}
function Label() { return <p>{useT().preferences.language}</p>; }

describe("language preference", () => {
  it("defaults to English and rejects unknown languages", () => {
    localStorage.setItem("preferences", '{"language":"fr"}');
    expect(renderHook(usePreferences).result.current.preferences.language).toBe("en");
  });
  it("follows a Portuguese browser until the person picks a language", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("pt-PT");
    localStorage.setItem("preferences", '{"fontSize":"large"}');
    expect(renderHook(usePreferences).result.current.preferences.language).toBe("pt-BR");
    localStorage.setItem("preferences", '{"language":"en"}');
    window.dispatchEvent(new StorageEvent("storage", { key: "preferences", newValue: '{"language":"en"}', storageArea: localStorage }));
    expect(renderHook(usePreferences).result.current.preferences.language).toBe("en");
  });
  it("switches the copy, the locales and <html lang> together", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<Providers><Label /></Providers>);
    expect(screen.getByText("Language")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    act(() => setPreferences({ language: "pt-BR" }));
    expect(screen.getByText("Idioma")).toBeTruthy();
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(getT()).toBe(ptBRMessages);
    expect(getLocale().locale).toBe("pt-BR");
  });
  it("has the same keys in every language", () => {
    expect(keys(ptBRMessages)).toEqual(keys(en));
  });
});
