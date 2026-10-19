// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPreferences } from "@/lib/preferences";
import { isVoiceNote, VoiceMessagePlayer } from "./voice-message-player";

describe("isVoiceNote", () => {
  it.each([
    "audio/ogg", "audio/opus", "audio/webm", " AUDIO/OGG ; charset=utf-8",
    "audio/OPUS; rate=48000", "audio/WEBM; codecs=vorbis", "audio/mpeg; CODECS=OPUS",
  ])("recognizes %s as a voice note", (mime_type) => {
    expect(isVoiceNote({ uri: "audio", mime_type })).toBe(true);
  });

  it.each(["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "Audio/MPEG; rate=44100", "", "application/ogg"])(
    "recognizes %s as file audio", (mime_type) => {
      expect(isVoiceNote({ uri: "audio", mime_type })).toBe(false);
    },
  );
});

describe("VoiceMessagePlayer", () => {
  beforeEach(() => {
    setPreferences({ language: "en", audioRate: 1.5 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No duration probe")));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("pause"));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setPreferences({ audioRate: 1 });
  });

  function mount(variant: "voice" | "file" = "file") {
    const result = render(<VoiceMessagePlayer src="https://example.com/audio" messageId="audio" variant={variant} time={<span data-testid="message-time">12:34</span>} />);
    const audio = result.container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 125 });
    fireEvent.loadedMetadata(audio);
    return { ...result, audio };
  }

  it("keeps the voice waveform, timer and speed control", () => {
    const { container, audio } = mount("voice");
    expect(container.querySelector("canvas")).toBeTruthy();
    expect(screen.getByRole("slider")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Playback speed: 1.5x/ })).toBeTruthy();
    expect(audio.playbackRate).toBe(1.5);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(audio.currentTime).toBe(5);
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: /Playback speed:/ }));
    expect(screen.getByRole("button", { name: /Playback speed: 2x/ })).toBeTruthy();
    expect(audio.playbackRate).toBe(2);
  });

  it("renders a straight range control and seeks file audio with a WhatsApp-style timer", () => {
    const { audio, container } = mount();
    const slider = screen.getByRole("slider", { name: "Seek audio" }) as HTMLInputElement;
    expect(slider.tagName).toBe("INPUT");
    expect(slider.type).toBe("range");
    expect(slider.disabled).toBe(false);
    expect(container.querySelector("canvas")).toBeNull();
    expect(audio.playbackRate).toBe(1);
    expect(screen.getByText("2:05")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Playback speed:/ })).toBeNull();
    const music = container.querySelector(".lucide-music")!;
    expect(music.parentElement?.className).toContain("size-8");
    expect(music.getAttribute("class")).toContain("size-4");
    expect(slider.className).toContain("h-4");
    expect(slider.className).toContain("[&::-webkit-slider-thumb]:-mt-1");
    fireEvent.change(slider, { target: { value: "45" } });
    expect(audio.currentTime).toBe(45);
    expect(screen.getByText("0:45")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
    audio.currentTime = 65;
    fireEvent.timeUpdate(audio);
    expect(slider.value).toBe("65");
    expect(screen.getByText("1:05")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause audio" }));
    expect(screen.getByText("1:05")).toBeTruthy();
    fireEvent.ended(audio);
    expect(slider.value).toBe("0");
  });

  it.each(["voice", "file"] as const)("places the message time in the second row inside the %s player", (variant) => {
    const { container } = mount(variant);
    const time = screen.getByTestId("message-time");
    const player = container.firstElementChild!;
    expect(player.className).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(player.className).toContain("w-[280px] max-w-full");
    expect(time.parentElement?.parentElement).toBe(player);
    expect(time.parentElement?.className).toContain("col-start-3 row-start-2 self-start justify-self-end");
  });

  it("disables seeking until a finite duration is available", () => {
    const { container } = render(<VoiceMessagePlayer src="https://example.com/unknown" messageId="unknown" variant="file" />);
    const audio = container.querySelector("audio")!;
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    Object.defineProperty(audio, "duration", { value: Infinity });
    fireEvent.loadedMetadata(audio);
    expect(slider.disabled).toBe(true);
  });

  it("caches decoded duration and peaks across concurrent variants", async () => {
    const decode = vi.fn().mockResolvedValue({
      duration: 42,
      getChannelData: () => new Float32Array([0, -0.25, 0.5, -1]),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = decode;
      close = close;
    });
    await act(async () => {
      render(<>
        <VoiceMessagePlayer src="https://example.com/cached-peaks" messageId="cached-voice" />
        <VoiceMessagePlayer src="https://example.com/cached-peaks" messageId="cached-file" variant="file" />
      </>);
    });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    const [voice, file] = screen.getAllByRole("slider");
    expect(voice.getAttribute("aria-valuemax")).toBe("42");
    expect(voice.querySelector("canvas")).toBeTruthy();
    expect((file as HTMLInputElement).max).toBe("42");
    expect(file.querySelector("canvas")).toBeNull();
  });

  it("pauses other players when file audio starts", () => {
    render(<VoiceMessagePlayer src="https://example.com/voice" messageId="voice" />);
    const { audio } = mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Play audio" })[1]);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(audio.playbackRate).toBe(1);
  });

  it.each(["voice", "file"] as const)("shows playback errors for %s audio", async (variant) => {
    mount(variant);
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("Playback failed"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
    });
    expect(screen.getByText("Could not play the audio.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
