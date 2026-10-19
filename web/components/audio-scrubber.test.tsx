// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPreferences } from "@/lib/preferences";
import { AudioScrubber, resamplePeaks } from "./audio-scrubber";

describe("resamplePeaks", () => {
  it("preserves transients when reducing the bar count", () => {
    expect(resamplePeaks([0.1, 0.8, 0.3, 1], 2)).toEqual([0.8, 1]);
  });

  it("repeats peaks when increasing the bar count", () => {
    expect(resamplePeaks([0.2, 0.9], 4)).toEqual([0.2, 0.2, 0.9, 0.9]);
  });

  it("includes overlapping buckets at fractional boundaries", () => {
    expect(resamplePeaks([0.2, 0.9, 0.4], 2)).toEqual([0.9, 0.9]);
  });

  it("provides flat placeholders, clamps values and handles no bars", () => {
    expect(resamplePeaks([], 3)).toEqual([0, 0, 0]);
    expect(resamplePeaks([-1, 2, NaN], 3)).toEqual([0, 1, 0]);
    expect(resamplePeaks([1], 0)).toEqual([]);
  });
});

describe("AudioScrubber", () => {
  beforeEach(() => {
    setPreferences({ language: "en" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 10, width: 100, top: 0, right: 110, bottom: 28, height: 28, x: 10, y: 0, toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount(currentTime = 20, duration = 60) {
    const onSeek = vi.fn();
    const result = render(<AudioScrubber peaks={[0.2, 1]} currentTime={currentTime} duration={duration} onSeek={onSeek} />);
    return { ...result, slider: screen.getByRole("slider", { name: "Seek audio" }), onSeek };
  }

  it("keeps the round handle without a vertical playhead line", () => {
    const { slider } = mount(30);
    expect(slider.querySelector(".w-px")).toBeNull();
    const handle = slider.querySelector<HTMLElement>(".rounded-full");
    expect(handle?.className).toContain("size-3");
    expect(handle?.style.left).toBe("50%");
  });

  it("seeks by five seconds with arrow keys and supports Home/End", () => {
    const { slider, onSeek } = mount();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenLastCalledWith(25);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenLastCalledWith(15);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek).toHaveBeenLastCalledWith(60);
    expect(slider.getAttribute("aria-valuetext")).toBe("0:20 / 1:00");
  });

  it.each([[2, "ArrowLeft", 0], [58, "ArrowRight", 60]] as const)(
    "clamps keyboard seeking from %s with %s", (time, key, expected) => {
      const { slider, onSeek } = mount(time);
      fireEvent.keyDown(slider, { key });
      expect(onSeek).toHaveBeenCalledWith(expected);
    },
  );

  it("disables seeking and hides the handle without a duration", () => {
    const { slider, onSeek } = mount(0, 0);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.pointerDown(slider);
    expect(onSeek).not.toHaveBeenCalled();
    expect(slider.getAttribute("aria-disabled")).toBe("true");
    expect(slider.querySelector(".rounded-full")).toBeNull();
  });

  it("captures a pointer and shows its local position throughout a drag", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const { slider, onSeek } = mount();
    const capture = vi.fn();
    const release = vi.fn();
    slider.setPointerCapture = capture;
    slider.releasePointerCapture = release;
    fireEvent.pointerDown(slider, { clientX: 60, button: 0 });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenLastCalledWith(30);
    expect(slider.getAttribute("aria-valuenow")).toBe("30");
    fireEvent.pointerMove(slider, { clientX: 200 });
    expect(onSeek).toHaveBeenLastCalledWith(60);
    expect(slider.getAttribute("aria-valuenow")).toBe("60");
    fireEvent.pointerUp(slider, { clientX: 35 });
    expect(onSeek).toHaveBeenLastCalledWith(15);
    expect(release).toHaveBeenCalledTimes(1);
    expect(slider.getAttribute("aria-valuenow")).toBe("20");
  });

  it("renders safely without a canvas context or ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { slider } = mount();
    expect(slider.querySelector("canvas")).toBeTruthy();
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
  });

  it("draws at device pixel ratio and redraws for size and theme changes", async () => {
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), save: vi.fn(),
      rect: vi.fn(), clip: vi.fn(), restore: vi.fn(),
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("devicePixelRatio", 2);
    const disconnect = vi.fn();
    let resize = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const { slider, unmount } = mount();
    const canvas = slider.querySelector("canvas")!;
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(56);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.rect.mock.calls[0][2]).toBeCloseTo(100 / 3);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 150 } as DOMRect);
    act(() => resize());
    expect(canvas.width).toBe(300);
    const draws = ctx.clearRect.mock.calls.length;
    await act(async () => { document.documentElement.setAttribute("data-scrubber-test-theme", "dark"); });
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(draws);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    document.documentElement.removeAttribute("data-scrubber-test-theme");
  });
});
