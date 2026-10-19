// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { Music, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePreferences, type Preferences } from "@/lib/preferences";
import type { FileInfo } from "@/lib/types";
import { AudioScrubber } from "./audio-scrubber";

export function isVoiceNote(file: FileInfo) {
  const mime = (file.mime_type ?? "").toLowerCase();
  const type = mime.split(";")[0].trim();
  return ["audio/ogg", "audio/opus", "audio/webm"].includes(type) || mime.includes("codecs=opus");
}

// ─── Audio probe for duration and waveform peaks ─────────────────────────────
// Legacy data URLs and MediaRecorder WebM can lack a duration header, so decode
// the full file to get its duration. Storage URLs can provide native metadata,
// but still need decoding for waveform peaks.
// The queue serialises decodes so concurrent mounts don't saturate AudioContext.
// Results are cached by src so the same audio is never decoded twice per session.

type AudioProbe = { duration: number; peaks: number[] };
const audioCache = new Map<string, AudioProbe>();
let probeQueue: Promise<void> = Promise.resolve();

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function probeAudioQueued(src: string): Promise<AudioProbe> {
  if (audioCache.has(src)) return Promise.resolve(audioCache.get(src)!);

  return new Promise<AudioProbe>((resolve) => {
    probeQueue = probeQueue.then(async () => {
      if (audioCache.has(src)) { resolve(audioCache.get(src)!); return; }
      let ctx: AudioContext | undefined;
      try {
        const arrayBuffer = src.startsWith("data:")
          ? dataUrlToArrayBuffer(src)
          : await fetch(src).then((r) => r.arrayBuffer());
        ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        const samples = decoded.getChannelData(0);
        const peaks = Array.from({ length: 64 }, (_, i) => {
          const start = Math.floor(i * samples.length / 64);
          const end = Math.floor((i + 1) * samples.length / 64);
          let peak = 0;
          for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
          return peak;
        });
        const loudest = Math.max(...peaks);
        const result = {
          duration: Number.isFinite(decoded.duration) && decoded.duration > 0 ? decoded.duration : 0,
          peaks: peaks.map((peak) => Math.max(0.05, loudest > 0 ? peak / loudest : 0)),
        };
        audioCache.set(src, result);
        resolve(result);
      } catch {
        resolve({ duration: 0, peaks: [] });
      } finally {
        if (ctx) await ctx.close().catch(() => {});
      }
    });
  });
}
// ─────────────────────────────────────────────────────────────────────────────

function formatAudioTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  src: string;
  messageId: string;
  variant?: "voice" | "file";
  time?: ReactNode;
};

const SPEED_STEPS = [1, 1.5, 2] as const;

function nextPlaybackRate(current: number): Preferences["audioRate"] {
  const i = SPEED_STEPS.findIndex((s) => Math.abs(s - current) < 0.01);
  const idx = i >= 0 ? i : 0;
  return SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
}

function formatRateLabel(rate: number) {
  if (Math.abs(rate - 1.5) < 0.01) return "1.5x";
  if (Number.isInteger(rate)) return `${rate}x`;
  return `${rate}x`;
}

export function VoiceMessagePlayer({ src, variant = "voice", time }: Props) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const { preferences, setPreferences } = usePreferences();
  const playbackRate = variant === "file" ? 1 : preferences.audioRate;
  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [error, setError] = useState(false);
  const maxGhostRef = useRef("0:00");

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.defaultPlaybackRate = playbackRate;
    el.playbackRate = playbackRate;
  }, [playbackRate]);

  const pauseOthers = useCallback(() => {
    document.querySelectorAll("audio[data-crm-audio]").forEach((node) => {
      if (node !== audioRef.current) {
        (node as HTMLAudioElement).pause();
      }
    });
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || error) return;
    if (isPlaying) {
      el.pause();
      return;
    }
    pauseOthers();
    void el.play().catch(() => setError(true));
  }, [error, isPlaying, pauseOthers]);

  const cycleSpeed = useCallback(() => {
    setPreferences((current) => ({ audioRate: nextPlaybackRate(current.audioRate) }));
  }, [setPreferences]);

  // WebM produced by MediaRecorder lacks a duration header regardless of whether
  // the file is a data URL or a Supabase Storage https URL. We always probe via
  // the AudioContext queue so the duration shows before the user presses play.
  // The queue serialises decodes and caches results, so concurrent mounts and
  // repeated mounts are both handled efficiently within this session.
  useEffect(() => {
    let cancelled = false;
    setDuration(0);
    setCurrent(0);
    setPeaks([]);
    setIsPlaying(false);
    setError(false);
    maxGhostRef.current = "0:00";
    probeAudioQueued(src).then((result) => {
      if (cancelled) return;
      if (result.duration > 0) setDuration(result.duration);
      setPeaks(result.peaks);
    });
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrent(0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => setError(true);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, [src]);

  const seek = useCallback((time: number) => {
    const el = audioRef.current;
    if (!el || duration <= 0) return;
    el.currentTime = time;
    setCurrent(time);
  }, [duration]);

  if (error) {
    return (
      <div className="flex w-[300px] max-w-full items-center gap-2 text-sub">
        <p className="text-sm italic">{t.voiceMessagePlayer.couldNotPlayTheAudio}</p>
        <span className="ml-auto">{time}</span>
      </div>
    );
  }

  const hasDuration = duration > 0;
  // While playing: show current position. While paused/stopped: show total duration.
  const visibleLabel = isPlaying
    ? formatAudioTime(current)
    : formatAudioTime(hasDuration ? duration : current);

  // The ghost span reserves the width of the widest label we've ever seen so the
  // timer container never shrinks. We track the max via a ref so it only grows.
  const candidate = formatAudioTime(Math.max(duration, current));
  if (candidate.length > maxGhostRef.current.length ||
      (candidate.length === maxGhostRef.current.length && candidate > maxGhostRef.current)) {
    maxGhostRef.current = candidate;
  }
  const ghostLabel = maxGhostRef.current;

  return (
    <div className={`grid w-[280px] max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 ${variant === "file" ? "gap-y-0" : "gap-y-1.5"}`}>
      <audio
        ref={audioRef}
        data-crm-audio
        preload="metadata"
        className="hidden"
        src={src}
      />
      <button
        type="button"
        onClick={toggle}
        className={`row-span-2 inline-flex ${variant === "file" ? "size-8" : "size-10"} shrink-0 self-center items-center justify-center rounded-full bg-black/12 text-bubble transition-[color,background-color] hover:bg-black/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/15  dark:hover:bg-white/22`}
        aria-label={isPlaying ? t.voiceMessagePlayer.pauseAudio : t.voiceMessagePlayer.playAudio}
      >
        {isPlaying ? (
          <Pause className="size-4" strokeWidth={2.25} />
        ) : (
          <Play className="size-4 translate-x-px" strokeWidth={2.25} />
        )}
      </button>
      {variant === "file" ? (
        <>
          <div className="col-start-2 row-start-1 relative flex h-4 min-w-0 self-end items-center">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 h-1 overflow-hidden rounded-full bg-black/15 dark:bg-white/20">
              <div className="h-full rounded-full bg-accent" style={{ width: `${hasDuration ? Math.min(100, Math.max(0, current / duration * 100)) : 0}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={hasDuration ? duration : 0}
              step="any"
              value={hasDuration ? Math.min(duration, Math.max(0, current)) : 0}
              disabled={!hasDuration}
              aria-label={t.voiceMessagePlayer.seekAudio}
              aria-valuetext={`${formatAudioTime(current)} / ${formatAudioTime(duration)}`}
              onChange={(event) => seek(Number(event.target.value))}
              className="relative h-4 w-full min-w-0 cursor-pointer appearance-none bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent"
            />
          </div>
          <span aria-hidden="true" className="col-start-3 row-start-1 flex size-8 shrink-0 self-end justify-self-center items-center justify-center rounded-full bg-[#f59e0b] text-white">
            <Music className="size-4" />
          </span>
        </>
      ) : (
        <>
          <div className="col-start-2 row-span-2 flex min-w-0 flex-1 self-center items-center gap-2">
            <AudioScrubber peaks={peaks} currentTime={current} duration={duration} onSeek={seek} height={36} className="flex-1" />
            {/* Fixed-width timer: ghost span reserves the width of the longest label
                so the layout never shifts as the counter changes. */}
            <span className="relative shrink-0 text-xs font-medium tabular-nums">
              <span aria-hidden className="invisible">{ghostLabel}</span>
              <span className="absolute inset-0 flex items-center justify-end text-bubble">
                {visibleLabel}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={cycleSpeed}
            className="col-start-3 row-start-1 relative shrink-0 self-end justify-self-center rounded-full bg-black/12 px-2.5 py-1 text-[0.6875rem] font-semibold leading-none tabular-nums text-bubble transition-[background-color] hover:bg-black/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/15  dark:hover:bg-white/22"
            aria-label={t.voiceMessagePlayer.playbackSpeed(formatRateLabel(playbackRate))}
          >
            {/* Ghost text reserves the width of the widest label (1.5x) so the
                button never changes size when cycling between 1x / 1.5x / 2x. */}
            <span aria-hidden className="invisible">1.5x</span>
            <span className="absolute inset-0 flex items-center justify-center">
              {formatRateLabel(playbackRate)}
            </span>
          </button>
        </>
      )}
      {variant === "file" && (
        <div className="col-start-2 row-start-2 self-start text-[0.68rem] tabular-nums text-sub">
          {formatAudioTime(isPlaying || current > 0 ? current : duration)}
        </div>
      )}
      <div className="col-start-3 row-start-2 self-start justify-self-end text-[0.68rem] text-sub">{time}</div>
    </div>
  );
}
