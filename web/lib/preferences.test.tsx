// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_BACKGROUNDS, DEFAULT_PREFERENCES, setPreferences, usePreferences } from "./preferences";
import { Providers } from "@/components/providers";
import { Composer } from "@/components/composer";
import { VoiceMessagePlayer } from "@/components/voice-message-player";

beforeEach(() => { localStorage.clear(); act(() => setPreferences(DEFAULT_PREFERENCES)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function storage(value: string | null, key: string | null = "preferences", area: Storage | null = localStorage) {
  act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: area })));
}
function Sample() { return <p>{usePreferences().preferences.fontSize}</p>; }

describe("browser preferences", () => {
  it.each(["{broken", "null", "[]", '"large"', '{"fontSize":"huge","enterToSend":"false","audioRate":3,"notificationSound":"true","desktopNotifications":1}'])("falls back safely for %s", (saved) => {
    localStorage.setItem("preferences", saved);
    expect(renderHook(usePreferences).result.current.preferences).toEqual(DEFAULT_PREFERENCES);
  });
  it("reads valid keys and ignores unknown and invalid values", () => {
    localStorage.setItem("preferences", JSON.stringify({ fontSize: "large", enterToSend: false, audioRate: "2", theme: "dark" }));
    expect(renderHook(usePreferences).result.current.preferences).toEqual({ ...DEFAULT_PREFERENCES, fontSize: "large", enterToSend: false, audioRate: 1, notificationSound: true, desktopNotifications: false });
  });
  it("restores and syncs notification flags with safe defaults for older preferences", () => {
    localStorage.setItem("preferences", '{"notificationSound":false,"desktopNotifications":true}');
    const { result } = renderHook(usePreferences);
    expect(result.current.preferences.notificationSound).toBe(false);
    expect(result.current.preferences.desktopNotifications).toBe(true);
    storage('{"notificationSound":true,"desktopNotifications":false}');
    expect(result.current.preferences.notificationSound).toBe(true);
    expect(result.current.preferences.desktopNotifications).toBe(false);
  });
  it("restores and syncs signature preferences and rejects invalid values", () => {
    localStorage.setItem("preferences", '{"signatureEnabled":true,"signatureName":"Ana"}');
    const { result } = renderHook(usePreferences);
    expect(result.current.preferences.signatureEnabled).toBe(true);
    expect(result.current.preferences.signatureName).toBe("Ana");
    storage('{"signatureEnabled":true,"signatureName":"Bia"}');
    expect(result.current.preferences.signatureName).toBe("Bia");
    storage(JSON.stringify({ signatureEnabled: "true", signatureName: "a".repeat(41) }));
    expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
  });
  it("defaults older wallpaper settings and rejects invalid palette ids and booleans", () => {
    localStorage.setItem("preferences", '{"fontSize":"large"}');
    const { result } = renderHook(usePreferences);
    expect(result.current.preferences.chatBackground).toBe("default");
    expect(result.current.preferences.chatWallpaper).toBe(true);
    storage('{"chatBackground":"purple","chatWallpaper":"false"}');
    expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
  });
  it.each(CHAT_BACKGROUNDS)("restores and applies $id to every chat in both themes", ({ id }) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    localStorage.setItem("preferences", JSON.stringify({ chatBackground: id, chatWallpaper: false }));
    render(<Providers><Sample /></Providers>);
    expect(document.documentElement.dataset.chatBg).toBe(id);
    expect(document.documentElement.dataset.chatWallpaper).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("light");
    storage('{"chatBackground":"default","chatWallpaper":true}');
    expect(document.documentElement.dataset.chatBg).toBe("default");
    expect(document.documentElement.dataset.chatWallpaper).toBe("true");
    cleanup();
    localStorage.setItem("theme", "dark");
    localStorage.setItem("preferences", JSON.stringify({ chatBackground: id, chatWallpaper: false }));
    render(<Providers><Sample /></Providers>);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.chatBg).toBe(id);
    expect(document.documentElement.dataset.chatWallpaper).toBe("false");
    storage(null);
    expect(document.documentElement.dataset.chatBg).toBe("default");
    expect(document.documentElement.dataset.chatWallpaper).toBe("true");
  });
  it.each(["access", "write"])("applies chat preferences when storage %s fails", (failure) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    if (failure === "access") vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    else vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    render(<Providers><Sample /></Providers>);
    act(() => setPreferences({ chatBackground: "blue", chatWallpaper: false }));
    expect(document.documentElement.dataset.chatBg).toBe("blue");
    expect(document.documentElement.dataset.chatWallpaper).toBe("false");
  });
  it("updates every subscriber, merges patches and persists under one key", () => {
    const first = renderHook(usePreferences), second = renderHook(usePreferences);
    act(() => first.result.current.setPreferences({ fontSize: "small" }));
    act(() => second.result.current.setPreferences((current) => ({ enterToSend: !current.enterToSend, audioRate: 2 })));
    expect(first.result.current.preferences).toBe(second.result.current.preferences);
    expect(JSON.parse(localStorage.getItem("preferences")!)).toEqual({ ...DEFAULT_PREFERENCES, fontSize: "small", enterToSend: false, audioRate: 2, notificationSound: true, desktopNotifications: false });
    expect(localStorage.length).toBe(1);
  });
  it("restores saved preferences after a store reload", async () => {
    setPreferences({ audioRate: 1.5, fontSize: "large", chatBackground: "rose", chatWallpaper: false });
    vi.resetModules();
    const reloaded = await import("./preferences");
    expect(renderHook(reloaded.usePreferences).result.current.preferences).toEqual({ ...DEFAULT_PREFERENCES, fontSize: "large", enterToSend: true, audioRate: 1.5, notificationSound: true, desktopNotifications: false, chatBackground: "rose", chatWallpaper: false });
  });
  it("syncs other tabs, ignores unrelated/session storage and resets on removal or clear", () => {
    const { result } = renderHook(usePreferences);
    storage('{"audioRate":2,"fontSize":"large"}');
    expect(result.current.preferences.audioRate).toBe(2);
    storage('{"audioRate":1.5}', "theme");
    storage('{"audioRate":1.5}', "preferences", sessionStorage);
    expect(result.current.preferences.audioRate).toBe(2);
    storage(null);
    expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
    storage('{"enterToSend":false}');
    storage(null, null);
    expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
  });
  it("keeps updating in memory when storage access is blocked", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    const first = renderHook(usePreferences), second = renderHook(usePreferences);
    act(() => setPreferences({ enterToSend: false, audioRate: 1.5, signatureEnabled: true, signatureName: "Ana" }));
    expect(first.result.current.preferences.enterToSend).toBe(false);
    expect(second.result.current.preferences.audioRate).toBe(1.5);
    expect(second.result.current.preferences.signatureName).toBe("Ana");
    expect(first.result.current.preferences.signatureEnabled).toBe(true);
  });
  it("keeps updating when writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = renderHook(usePreferences);
    act(() => setPreferences({ fontSize: "small" }));
    expect(result.current.preferences.fontSize).toBe("small");
  });
  it("renders defaults on the server and hydrates saved values without a mismatch", async () => {
    localStorage.setItem("preferences", '{"fontSize":"large"}');
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Sample />);
    expect(container.textContent).toBe("default");
    const onRecoverableError = vi.fn();
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <Sample />, { onRecoverableError }); });
    expect(container.textContent).toBe("large");
    expect(onRecoverableError).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
  it("applies font size to the root and reacts to another tab", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    localStorage.setItem("preferences", '{"fontSize":"large"}');
    render(<Providers><Sample /></Providers>);
    expect(document.documentElement.dataset.fontSize).toBe("large");
    storage('{"fontSize":"small"}');
    expect(document.documentElement.dataset.fontSize).toBe("small");
    act(() => setPreferences({ fontSize: "default" }));
    expect(document.documentElement.dataset.fontSize).toBe("default");
  });
});

describe("message shortcuts", () => {
  function setup() {
    const onSendText = vi.fn();
    render(<Composer windowOpen onTyping={vi.fn()} replyTo={null} onCancelReply={vi.fn()} agentName="Agente teste" contactName="Contato" templates={[]} templatesLoading={false} sending={false} onSendText={onSendText} onSendFile={vi.fn()} onPickFile={vi.fn()} onSendTemplate={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Mensagem" } });
    return { input, onSendText };
  }
  it("shows the resolved signature as preferences change without signing the draft", () => {
    const { input, onSendText } = setup();
    expect(screen.queryByText(/Assinando como/)).toBeNull();
    act(() => setPreferences({ signatureEnabled: true, signatureName: "  Ana  " }));
    expect(screen.getByText("Ana").tagName).toBe("STRONG");
    act(() => setPreferences({ signatureName: "   " }));
    expect(screen.getByText("Agente teste")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSendText).toHaveBeenCalledExactlyOnceWith("Mensagem");
    act(() => setPreferences({ signatureEnabled: false }));
    expect(screen.queryByText(/Assinando como/)).toBeNull();
  });
  it("sends with Enter by default and leaves Shift+Enter and composing text alone", () => {
    const { input, onSendText } = setup();
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(true);
    expect(onSendText).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(onSendText).toHaveBeenCalledExactlyOnceWith("Mensagem");
  });
  it.each(["ctrlKey", "metaKey"])("uses %s+Enter when Enter-to-send is disabled", (modifier) => {
    const { input, onSendText } = setup();
    act(() => setPreferences({ enterToSend: false }));
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true, [modifier]: true })).toBe(true);
    expect(onSendText).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: "Enter", [modifier]: true })).toBe(false);
    expect(onSendText).toHaveBeenCalledExactlyOnceWith("Mensagem");
  });
});

it("restores, cycles and shares playback speed across every audio player", () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no probe")));
  localStorage.setItem("preferences", '{"audioRate":1.5}');
  const { container } = render(<><VoiceMessagePlayer src="https://test/one" messageId="one" /><VoiceMessagePlayer src="https://test/two" messageId="two" /></>);
  const audios = [...container.querySelectorAll("audio")];
  expect(audios.every((audio) => audio.playbackRate === 1.5 && audio.defaultPlaybackRate === 1.5)).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: /Playback speed: 1.5x/ })[0]);
  expect(audios.every((audio) => audio.playbackRate === 2)).toBe(true);
  expect(JSON.parse(localStorage.getItem("preferences")!).audioRate).toBe(2);
  fireEvent.click(screen.getAllByRole("button", { name: /Playback speed: 2x/ })[1]);
  expect(audios.every((audio) => audio.playbackRate === 1)).toBe(true);
  storage('{"audioRate":1.5}');
  expect(audios.every((audio) => audio.playbackRate === 1.5)).toBe(true);
});
