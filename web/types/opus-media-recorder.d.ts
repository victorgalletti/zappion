// SPDX-License-Identifier: AGPL-3.0-only
declare module "opus-media-recorder" {
  export default class OpusMediaRecorder {
    constructor(
      stream: MediaStream,
      options?: { mimeType?: string; audioBitsPerSecond?: number },
      workerOptions?: {
        encoderWorkerFactory?: () => Worker;
        OggOpusEncoderWasmPath?: string;
        WebMOpusEncoderWasmPath?: string;
      },
    );
  }
}
