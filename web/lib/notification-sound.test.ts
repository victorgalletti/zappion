// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, afterEach, expect, it, vi } from "vitest";

let audio: { state: string; currentTime: number; destination: object; resume: ReturnType<typeof vi.fn>; createOscillator: ReturnType<typeof vi.fn>; createGain: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetModules();
  audio = {
    state: "suspended", currentTime: 5, destination: {}, resume: vi.fn(async () => { audio.state = "running"; }),
    createOscillator: vi.fn(() => ({ type: "", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() })),
  };
  vi.stubGlobal("AudioContext", class { constructor() { return audio; } });
});
afterEach(() => vi.unstubAllGlobals());
it("waits for a gesture then synthesizes two soft sine notes with a short envelope", async () => {
  const sound = await import("./notification-sound");
  expect(sound.playNotificationTone()).toBe(false); expect(audio.resume).not.toHaveBeenCalled();
  await sound.unlockNotificationSound(); expect(sound.playNotificationTone()).toBe(true);
  expect(audio.createOscillator).toHaveBeenCalledTimes(2);
  for (const [index, result] of audio.createOscillator.mock.results.entries()) {
    expect(result.value.type).toBe("sine");
    expect(result.value.frequency.setValueAtTime).toHaveBeenCalledWith(index ? 880 : 660, 5 + index * 0.12);
    expect(audio.createGain.mock.results[index].value.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.035, 5 + index * 0.12 + 0.015);
  }
});
it("the test button resumes audio before playing", async () => {
  const sound = await import("./notification-sound"); await sound.testNotificationSound();
  expect(audio.resume).toHaveBeenCalledTimes(1); expect(audio.createOscillator).toHaveBeenCalledTimes(2);
});
it("silently handles autoplay rejection and unsupported audio", async () => {
  const sound = await import("./notification-sound"); audio.resume.mockRejectedValue(new Error("blocked"));
  await expect(sound.testNotificationSound()).resolves.toBeUndefined(); expect(audio.createOscillator).not.toHaveBeenCalled();
  vi.resetModules(); vi.stubGlobal("AudioContext", undefined);
  expect((await import("./notification-sound")).playNotificationTone()).toBe(false);
});
