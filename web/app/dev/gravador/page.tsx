// SPDX-License-Identifier: AGPL-3.0-only
"use client";

// Development check for the OGG/Opus encoder without a microphone: a tone
// from an oscillator goes through the same recorder the chat uses.

import { useT } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { useState } from "react";
import { OggRecorder } from "@/lib/ogg-recorder";

export default function RecorderCheck() {
  const t = useT();
  if (process.env.NODE_ENV === "production") notFound();
  const [log, setLog] = useState<string[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const say = (line: string) => setLog((l) => [...l, line]);

  const run = async () => {
    setLog([]);
    setUrl(null);
    try {
      const ctx = new AudioContext();
      await ctx.resume();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 1;
      osc.connect(dest);
      osc.start();
      const recorder = new OggRecorder(dest.stream, ctx);
      await recorder.start();
      say(t.recorderCheck.capture(recorder.mode === "worklet" ? "AudioWorklet" : t.recorderCheck.scriptProcessorFallback));
      say(t.recorderCheck.recording);
      await new Promise((r) => setTimeout(r, 3000));
      const t0 = performance.now();
      const blob = await recorder.stop();
      say(t.recorderCheck.stopped(Math.round(performance.now() - t0), blob.size, blob.type));
      osc.stop();
      await ctx.close();
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      say(t.recorderCheck.header(String.fromCharCode(...head)));
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      const audio = new Audio(objectUrl);
      await new Promise((r) => {
        audio.onloadedmetadata = r;
        audio.onerror = r;
        setTimeout(r, 3000);
      });
      say(t.recorderCheck.duration(Number.isFinite(audio.duration) ? audio.duration.toFixed(2) + " s" : String(audio.duration)));
      say(t.recorderCheck.ok);
    } catch (e) {
      say(t.recorderCheck.error(e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <main className="space-y-4 p-8 text-heading">
      <h1 className="text-xl">{t.recorderCheck.title}</h1>
      <button type="button" onClick={run} className="rounded-full bg-accent px-5 py-2 text-white">
        {t.recorderCheck.runTest}
      </button>
      <pre id="log" className="rounded bg-panel p-4 text-sm">{log.join("\n")}</pre>
      {url && <audio controls src={url} />}
    </main>
  );
}
