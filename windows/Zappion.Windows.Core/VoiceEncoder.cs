// SPDX-License-Identifier: AGPL-3.0-only
using System.Text;
using Concentus;
using Concentus.Enums;
using Concentus.Oggfile;

namespace Zappion.Windows.Core;

// Mirrors web/lib/ogg-recorder.ts: mono OGG/Opus, labelled audio/ogg; codecs=opus.
public static class VoiceEncoder
{
    public static byte[] EncodeWave(Stream wave)
    {
        using var reader = new BinaryReader(wave, Encoding.ASCII, leaveOpen: true);
        string Tag() => Encoding.ASCII.GetString(reader.ReadBytes(4));
        if (Tag() != "RIFF") throw new InvalidDataException("Expected a PCM WAVE recording.");
        reader.ReadUInt32();
        if (Tag() != "WAVE") throw new InvalidDataException("Expected WAVE.");
        var sampleRate = 0;
        while (wave.Position + 8 <= wave.Length)
        {
            var tag = Tag(); var length = reader.ReadUInt32(); var start = wave.Position;
            if (length > wave.Length - start) throw new InvalidDataException("Truncated recording.");
            if (tag == "fmt ")
            {
                if (length < 16) throw new InvalidDataException("Expected PCM format.");
                var format = reader.ReadUInt16();
                if (reader.ReadUInt16() != 1) throw new InvalidDataException("Expected mono PCM.");
                sampleRate = reader.ReadInt32(); reader.ReadUInt32(); reader.ReadUInt16();
                if (reader.ReadUInt16() != 16 || sampleRate is not (16000 or 48000)) throw new InvalidDataException("Expected 16-bit PCM at 16 or 48 kHz.");
                // Media Foundation can wrap PCM in WAVE_FORMAT_EXTENSIBLE.
                if (format == 0xfffe && length >= 40)
                {
                    reader.ReadUInt16(); reader.ReadUInt16(); reader.ReadUInt32();
                    if (new Guid(reader.ReadBytes(16)) != new Guid("00000001-0000-0010-8000-00aa00389b71")) throw new InvalidDataException("Expected PCM subtype.");
                }
                else if (format != 1) throw new InvalidDataException("Expected PCM.");
            }
            if (tag == "data")
            {
                if (sampleRate == 0 || length < 2) throw new InvalidDataException("Empty recording.");
                using var output = new MemoryStream();
                var encoder = OpusCodecFactory.CreateEncoder(sampleRate, 1, OpusApplication.OPUS_APPLICATION_VOIP);
                encoder.Bitrate = 32000;
                var ogg = new OpusOggWriteStream(encoder, output, leaveOpen: true);
                var samples = new short[960];
                var remaining = length / 2;
                while (remaining > 0)
                {
                    var count = (int)Math.Min(samples.Length, remaining);
                    for (var i = 0; i < count; i++) samples[i] = reader.ReadInt16();
                    ogg.WriteSamples(samples, 0, count);
                    remaining -= (uint)count;
                    if (output.Length > MediaContent.Limit(MediaContent.OpusMime)) throw new InvalidOperationException(UiStrings.Get("RecordingLimit"));
                }
                ogg.Finish();
                return output.ToArray();
            }
            wave.Position = start + length + (length & 1);
        }
        throw new InvalidDataException("Recording has no samples.");
    }
}
