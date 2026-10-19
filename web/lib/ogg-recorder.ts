// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { getT } from "@/lib/i18n";
/** WhatsApp plays a file as a voice note only with this exact type (and mono). */
export const OGG_OPUS = "audio/ogg; codecs=opus";

const WORKER_URL = "/opus-media-recorder/encoderWorker.umd.js";
const WASM_URL = "/opus-media-recorder/OggOpusEncoder.wasm";
const WORKLET_URL = "/opus-media-recorder/capture-worklet.js";
const BUFFER_SIZE = 4096;

type WorkerMessage = { command: string; buffers?: ArrayBuffer[] };

/**
 * Records mono OGG/Opus in any browser by driving opus-media-recorder's encoder
 * worker directly (files in public/opus-media-recorder).
 *
 * The library's own MediaRecorder wrapper is not used: its event-target-shim
 * calls console.assert with event objects, and Next's development console
 * logger, serialising them, recursed until the stack overflowed — the
 * "Maximum call stack size exceeded" that left recordings unfinished.
 */
export class OggRecorder {
  private worker = new Worker(WORKER_URL);
  private ready: Promise<void>;
  private source: MediaStreamAudioSourceNode | null = null;
  /** AudioWorklet where available (audio thread); ScriptProcessor as the fallback. */
  private processor: AudioWorkletNode | ScriptProcessorNode | null = null;
  private finished: ((buffers: ArrayBuffer[]) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;

  constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const { command, buffers } = event.data ?? {};
        if (command === "readyToInit") resolve();
        if (command === "lastEncodedData") this.finished?.(buffers ?? []);
      };
      this.worker.onerror = (event) => {
        const error = new Error(event.message || getT().oggRecorder.theAudioEncoderFailed);
        reject(error);
        this.failed?.(error);
      };
    });
    this.worker.postMessage({ command: "loadEncoder", mimeType: "audio/ogg", wasmPath: WASM_URL });
  }

  async start() {
    await this.ready;
    this.worker.postMessage({
      command: "init",
      sampleRate: this.context.sampleRate,
      channelCount: 1,
      bitsPerSecond: 32000,
    });
    this.source = this.context.createMediaStreamSource(this.stream);
    const push = (samples: Float32Array) =>
      this.worker.postMessage({
        command: "pushInputData",
        channelBuffers: [samples],
        length: samples.length,
        duration: samples.length / this.context.sampleRate,
      });
    try {
      await this.context.audioWorklet.addModule(WORKLET_URL);
      const node = new AudioWorkletNode(this.context, "ogg-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
      });
      node.port.onmessage = (e: MessageEvent<Float32Array | string>) => {
        if (typeof e.data === "string") return this.flushed?.();
        push(e.data);
      };
      this.processor = node;
    } catch {
      const node = this.context.createScriptProcessor(BUFFER_SIZE, 1, 1);
      node.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0).slice());
      this.processor = node;
    }
    // The processor writes nothing to its output; the connection only keeps it running.
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
    if (this.context.state === "suspended") await this.context.resume().catch(() => {});
  }

  private flushed: (() => void) | null = null;

  /** Which capture path is running, for diagnostics. */
  get mode(): "worklet" | "script" | "idle" {
    if (!this.processor) return "idle";
    return this.processor instanceof AudioWorkletNode ? "worklet" : "script";
  }

  /** The worklet holds up to one partial block; collect it before finishing. */
  private async drain() {
    const node = this.processor;
    this.source?.disconnect();
    if (node instanceof AudioWorkletNode) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.flushed = resolve;
          node.port.postMessage("flush");
        }),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    } else if (node) {
      node.onaudioprocess = null;
    }
    node?.disconnect();
  }

  /** Finishes the file. Rejects if the encoder does not answer in time. */
  async stop(timeoutMs = 5000): Promise<Blob> {
    await this.drain();
    return new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose();
        reject(new Error(getT().oggRecorder.theAudioEncoderDidNotRespond));
      }, timeoutMs);
      this.finished = (buffers) => {
        clearTimeout(timer);
        this.dispose();
        const blob = new Blob(buffers, { type: OGG_OPUS });
        if (blob.size > 0) resolve(blob);
        else reject(new Error(getT().oggRecorder.theRecordingIsEmpty));
      };
      this.failed = (error) => {
        clearTimeout(timer);
        this.dispose();
        reject(error);
      };
      this.worker.postMessage({ command: "done" });
    });
  }

  /** Abandons the recording without producing a file. */
  dispose() {
    this.source?.disconnect();
    this.processor?.disconnect();
    this.worker.terminate();
  }
}
