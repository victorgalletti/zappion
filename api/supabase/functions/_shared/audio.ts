/**
 * Duration of an Ogg/Opus file, in seconds, read from its headers alone.
 *
 * The granule position of the last Ogg page is the stream's total sample count
 * (Opus always counts at 48 kHz), and the OpusHead header says how many of the
 * first samples are encoder pre-skip. No decoding, no dependencies.
 * Returns undefined when the bytes are not Ogg/Opus.
 */
export function oggOpusDuration(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isAt = (i: number, text: string) =>
    i >= 0 && i + text.length <= bytes.length &&
    [...text].every((ch, k) => bytes[i + k] === ch.charCodeAt(0));

  if (!isAt(0, "OggS")) return undefined;

  // OpusHead lives in the first page; pre-skip is a little-endian uint16 at +10.
  let preSkip = 0;
  const headLimit = Math.min(bytes.length - 12, 512);
  for (let i = 0; i < headLimit; i++) {
    if (isAt(i, "OpusHead")) {
      preSkip = view.getUint16(i + 10, true);
      break;
    }
    if (i === headLimit - 1) return undefined;
  }

  // Last page: scan back for the capture pattern; granule is a LE int64 at +6.
  for (let i = bytes.length - 27; i >= 0; i--) {
    if (!isAt(i, "OggS")) continue;
    const granule = Number(view.getBigInt64(i + 6, true));
    if (granule < 0) continue; // -1 marks a page with no completed packet
    const seconds = (granule - preSkip) / 48000;
    return seconds > 0 ? Math.round(seconds * 10) / 10 : undefined;
  }
  return undefined;
}
