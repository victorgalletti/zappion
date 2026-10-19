// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceWindow, useServiceWindow } from "./use-service-window";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const closesAt = Date.UTC(2026, 0, 2);

describe("serviceWindow", () => {
  it.each([
    [24 * HOUR, "24 h remaining", 1],
    [3 * HOUR + 30 * MINUTE, "3 h remaining", 30 * MINUTE + 1],
    [HOUR, "1 h remaining", 1],
    [59 * MINUTE, "55 min remaining", 4 * MINUTE + 1],
    [10 * MINUTE, "10 min remaining", 1],
    [7 * MINUTE, "5 min remaining", 2 * MINUTE + 1],
    [5 * MINUTE, "5 min remaining", 1],
    [5 * MINUTE - 1, "less than 5 min", 5 * MINUTE - 1],
    [1, "less than 5 min", 1],
  ])("with %i ms remaining displays %s and schedules the next change", (remaining, text, delay) => {
    const now = closesAt - remaining;
    const state = serviceWindow(closesAt, now);
    expect(state).toEqual({ open: true, text: `Service window open · ${text}`, next: now + delay });
    expect(serviceWindow(closesAt, state.next! - 1).text).toBe(state.text);
    expect(serviceWindow(closesAt, state.next!).text).not.toBe(state.text);
  });

  it.each([closesAt, closesAt + 1, closesAt + HOUR, NaN])("is closed at/after the deadline or for an invalid timestamp (%s)", (now) => {
    expect(serviceWindow(closesAt, now)).toEqual({ open: false, text: "24-hour service window closed", next: null });
  });
});

describe("useServiceWindow", () => {
  afterEach(() => vi.useRealTimers());

  it("updates on the next tick and closes exactly 24 hours after the incoming message", () => {
    vi.useFakeTimers();
    vi.setSystemTime(closesAt - 5 * MINUTE);
    const timestamp = new Date(closesAt - 24 * HOUR).toISOString();
    const { result } = renderHook(() => useServiceWindow(timestamp));
    expect(result.current.text).toBe("Service window open · 5 min remaining");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.text).toBe("Service window open · less than 5 min");
    act(() => vi.advanceTimersByTime(5 * MINUTE - 2));
    expect(result.current.open).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(false);
    expect(result.current.next).toBeNull();
  });
});
