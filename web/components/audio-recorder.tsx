// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, getT } from "@/lib/i18n";

// Ported from an earlier CRM (components/crm/conversation/audio-recorder.tsx):
// same live waveform and timer. The difference is the output format: the CRM
// recorded whatever the browser offered (WebM in Chrome, MP4 in Safari) and
// converted it on the server with ffmpeg. The Zappion API has no such step, so this
// encodes OGG/Opus in the browser — the format WhatsApp plays as a voice note.

import { Pause, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OGG_OPUS, OggRecorder } from "@/lib/ogg-recorder";
import { cn, formatDuration } from "@/lib/utils";

const BAR_W = 3;
const BAR_GAP = 2;
const BAR_STEP = BAR_W + BAR_GAP;
const MAX_SAMPLES = 300;

interface Props {
  onComplete: (file: File, seconds: number) => void;
  onCancel: () => void;
}

/** Starts recording on mount; the bar replaces the composer while it runs. */
export function AudioRecorder({ onComplete, onCancel }: Props) {
  const t = useT();
  const [seconds, setSeconds] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<OggRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<number[]>([]);
  const frameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleRef = useRef(0);
  const startedRef = useRef(0);

  /** Microphone, meter and timer off. The recorder itself is stopped by its owner. */
  const releaseInputs = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const drawLoop = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        if (now - lastSampleRef.current >= 50) {
          lastSampleRef.current = now;
          analyser.getByteFrequencyData(data);
          const slice = Math.floor(data.length * 0.6);
          let sum = 0;
          for (let i = 0; i < slice; i++) sum += data[i];
          samplesRef.current.push(Math.max(0.05, sum / slice / 255));
          if (samplesRef.current.length > MAX_SAMPLES) samplesRef.current.shift();
        }
        ctx.clearRect(0, 0, w, h);
        const visible = samplesRef.current.slice(-Math.floor(w / BAR_STEP));
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--wa-sub").trim() || "#888";
        for (let i = 0; i < visible.length; i++) {
          const barH = Math.max(2, Math.round(visible[i] * (h - 4)));
          ctx.fillRect(i * BAR_STEP, (h - barH) / 2, BAR_W, barH);
        }
      }
      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // WhatsApp voice notes must be mono.
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;

        // The meter. Safari only processes nodes that end at the output, so the
        // analyser feeds a muted gain into the destination.
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        const mute = audioCtx.createGain();
        mute.gain.value = 0;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        analyser.connect(mute).connect(audioCtx.destination);
        if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
        drawLoop(analyser);

        // The encoder shares the meter's context, so one resume wakes both.
        const recorder = new OggRecorder(stream, audioCtx);
        recorderRef.current = recorder;
        await recorder.start();
        if (cancelled) return;
        startedRef.current = Date.now();
        timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedRef.current) / 1000)), 250);
      } catch (e) {
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? getT().audioRecorder.microphonePermissionDenied
            : getT().audioRecorder.couldNotRecord(e instanceof Error ? `: ${e.message}` : ""),
        );
      }
    })();
    return () => {
      cancelled = true;
      recorderRef.current?.dispose();
      recorderRef.current = null;
      releaseInputs();
    };
  }, [drawLoop, releaseInputs]);

  const send = async () => {
    const recorder = recorderRef.current;
    if (!recorder || processing) return;
    setProcessing(true);
    const elapsed = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      const blob = await recorder.stop();
      recorderRef.current = null;
      releaseInputs();
      // Meta plays it as a voice note only when labelled "audio/ogg; codecs=opus".
      onComplete(new File([blob], `audio-${Date.now()}.ogg`, { type: OGG_OPUS }), elapsed);
    } catch (e) {
      recorderRef.current = null;
      releaseInputs();
      setProcessing(false);
      setError(e instanceof Error ? e.message : t.audioRecorder.couldNotFinishRecording);
    }
  };

  const cancel = () => onCancel();

  return (
    <div className="flex flex-1 items-center gap-3">
      <button type="button" onClick={cancel} className="flex size-[44px] shrink-0 items-center justify-center text-icon hover:text-danger md:size-auto" title={t.audioRecorder.discard}>
        <Trash2 className="size-5" />
      </button>
      {error ? (
        <span className="flex-1 text-sm text-danger">{error}</span>
      ) : (
        <>
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
          </span>
          <span className="min-w-10 font-mono text-sm tabular-nums text-heading">{formatDuration(seconds)}</span>
          <canvas ref={canvasRef} className="block h-7 min-w-0 flex-1" />
          <Pause className="size-5 text-red-500" aria-hidden />
        </>
      )}
      <button
        type="button"
        onClick={send}
        disabled={processing || !!error}
        title={t.audioRecorder.sendAudio}
        className={cn(
          "flex size-[44px] shrink-0 items-center md:size-10 justify-center rounded-full bg-accent text-white shadow",
          (processing || error) && "opacity-60",
        )}
      >
        {processing ? (
          <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <Send className="size-4" />
        )}
      </button>
    </div>
  );
}
