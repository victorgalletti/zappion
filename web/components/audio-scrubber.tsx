// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useT } from "@/lib/i18n";

/** Preserve transients by taking the maximum of each overlapping peak bucket. */
export function resamplePeaks(peaks: readonly number[], count: number): number[] {
  const size = Math.max(0, Math.floor(count));
  return Array.from({ length: size }, (_, i) => {
    if (!peaks.length) return 0;
    const start = Math.floor(i * peaks.length / size);
    const end = Math.ceil((i + 1) * peaks.length / size);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const value = peaks[j];
      if (Number.isFinite(value)) peak = Math.max(peak, Math.min(1, value));
    }
    return peak;
  });
}

function formatTime(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

type Props = {
  peaks: readonly number[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  className?: string;
  height?: number;
  barWidth?: number;
  barGap?: number;
};

export function AudioScrubber({
  peaks, currentTime, duration, onSeek, className = "", height = 28, barWidth = 3, barGap = 2,
}: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentRef = useRef<HTMLSpanElement>(null);
  const mutedRef = useRef<HTMLSpanElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  const [themeVersion, setThemeVersion] = useState(0);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const time = Math.min(total, Math.max(0, dragTime ?? (Number.isFinite(currentTime) ? currentTime : 0)));
  const progress = total > 0 ? time / total : 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setWidth(container.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setThemeVersion((version) => version + 1);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", refresh);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", refresh);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !accentRef.current || !mutedRef.current || width <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const stroke = Math.max(1, barWidth);
    const gap = Math.max(0, barGap);
    const count = Math.max(1, Math.floor((width + gap) / (stroke + gap)));
    const bars = resamplePeaks(peaks, count);
    const offset = (width - (count * (stroke + gap) - gap)) / 2;
    const draw = (color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.lineCap = "round";
      bars.forEach((peak, i) => {
        const barHeight = Math.min(height, Math.max(3, peak * height));
        const x = offset + i * (stroke + gap) + stroke / 2;
        const halfLine = Math.max(0.01, (barHeight - stroke) / 2);
        ctx.beginPath();
        ctx.moveTo(x, height / 2 - halfLine);
        ctx.lineTo(x, height / 2 + halfLine);
        ctx.stroke();
      });
    };
    draw(getComputedStyle(mutedRef.current).color);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width * progress, height);
    ctx.clip();
    draw(getComputedStyle(accentRef.current).color);
    ctx.restore();
  }, [peaks, width, height, barWidth, barGap, progress, themeVersion]);

  const seekPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!total || rect.width <= 0) return;
    const next = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * total;
    setDragTime(next);
    onSeek(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!total) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = time - 5; break;
      case "ArrowRight": next = time + 5; break;
      case "Home": next = 0; break;
      case "End": next = total; break;
      default: return;
    }
    event.preventDefault();
    onSeek(Math.min(total, Math.max(0, next)));
  };

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label={t.voiceMessagePlayer.seekAudio}
      aria-disabled={!total}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={time}
      aria-valuetext={`${formatTime(time)} / ${formatTime(total)}`}
      className={`relative min-w-0 touch-none select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${total ? "cursor-pointer" : "cursor-default"} ${className}`}
      style={{ height }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!total || event.button !== 0 || pointerRef.current !== null) return;
        event.preventDefault();
        event.currentTarget.focus();
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekPointer(event);
      }}
      onPointerMove={(event) => {
        if (pointerRef.current === event.pointerId) seekPointer(event);
      }}
      onPointerUp={(event) => {
        if (pointerRef.current !== event.pointerId) return;
        seekPointer(event);
        pointerRef.current = null;
        setDragTime(null);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { pointerRef.current = null; setDragTime(null); }}
      onLostPointerCapture={() => { pointerRef.current = null; setDragTime(null); }}
    >
      <span ref={accentRef} aria-hidden className="hidden text-accent" />
      <span ref={mutedRef} aria-hidden className="hidden text-sub/50" />
      <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />
      {total > 0 && (
        <div aria-hidden className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${progress * 100}%` }} />
      )}
    </div>
  );
}
