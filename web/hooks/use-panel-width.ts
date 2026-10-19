// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "wa:sidebar-width";
const DEFAULT = 400;
export const MIN_SIDEBAR = 300;
/** The chat keeps at least this much room. */
const MIN_CHAT = 420;

/**
 * Width of the conversation list, dragged by the divider and remembered per
 * browser. Clamped so neither the list nor the chat collapses.
 */
export function usePanelWidth(containerRef: React.RefObject<HTMLElement | null>, offset = 0) {
  const [width, setWidth] = useState(DEFAULT);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);

  const clamp = useCallback(
    (value: number) => {
      const total = containerRef.current?.clientWidth ?? window.innerWidth;
      return Math.round(Math.min(Math.max(value, MIN_SIDEBAR), Math.max(MIN_SIDEBAR, total - offset - MIN_CHAT)));
    },
    [containerRef, offset],
  );

  useEffect(() => {
    let saved = DEFAULT;
    try {
      saved = Number(localStorage.getItem(KEY)) || DEFAULT;
    } catch {
      /* storage blocked */
    }
    setWidth(clamp(saved));
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const left = containerRef.current?.getBoundingClientRect().left ?? 0;
      setDragging(true);
      const move = (ev: PointerEvent) => setWidth(clamp(ev.clientX - left - offset));
      const up = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          localStorage.setItem(KEY, String(widthRef.current));
        } catch {
          /* storage blocked */
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [clamp, containerRef, offset],
  );

  /** Keyboard: arrows nudge the divider, for whoever is not using a mouse. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = clamp(widthRef.current + (e.key === "ArrowRight" ? 24 : -24));
      setWidth(next);
      try {
        localStorage.setItem(KEY, String(next));
      } catch {
        /* storage blocked */
      }
    },
    [clamp],
  );

  const reset = useCallback(() => {
    setWidth(clamp(DEFAULT));
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage blocked */
    }
  }, [clamp]);

  return { width, dragging, startDrag, onKeyDown, reset };
}
