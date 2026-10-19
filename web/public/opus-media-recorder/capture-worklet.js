// Captures mono PCM on the audio thread and hands it to the page in 4096-frame
// blocks, the size opus-media-recorder's encoder worker was built around.
// Used by web/lib/ogg-recorder.ts.

const BLOCK = 4096;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BLOCK);
    this.filled = 0;
    // "flush": send whatever is left (the last partial block), then confirm.
    this.port.onmessage = (event) => {
      if (event.data !== "flush") return;
      if (this.filled) this.port.postMessage(this.buffer.slice(0, this.filled));
      this.filled = 0;
      this.port.postMessage("flushed");
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(channel.length - offset, BLOCK - this.filled);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.buffer.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("ogg-capture", CaptureProcessor);
