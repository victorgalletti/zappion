// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Mirrors web/components/voice-message-player.tsx and audio-scrubber.tsx.
public static class AudioWaveform
{
    public static double[] PeaksOpusOgg(Stream stream, CancellationToken token = default)
    {
        // WhatsApp voice notes are mono; decode in managed code without optional Windows codecs.
        // 48 kHz: Concentus decodes hybrid (super-wideband) packets to silence at 16 kHz.
        var packets = OpusWave.DecodePackets(stream, OpusWave.SampleRate, token).Select(samples => samples.Select(s => Math.Abs(s / 32768d)).DefaultIfEmpty().Max()).ToList();
        var loudest = packets.DefaultIfEmpty().Max();
        return Resample(loudest > 0 ? packets.Select(p => p / loudest).ToArray() : packets, 64);
    }
    public static bool IsVoiceNote(string mime)
    {
        mime = mime.ToLowerInvariant();
        return new[] { "audio/ogg", "audio/opus", "audio/webm" }.Contains(mime.Split(';')[0].Trim()) || mime.Contains("codecs=opus", StringComparison.Ordinal);
    }
    public static double[] Peaks16BitWave(Stream stream, int count = 64)
    {
        using var reader = new BinaryReader(stream, System.Text.Encoding.UTF8, leaveOpen: true);
        if (new string(reader.ReadChars(4)) != "RIFF") throw new InvalidDataException();
        reader.ReadUInt32();
        if (new string(reader.ReadChars(4)) != "WAVE") throw new InvalidDataException();
        ushort channels = 1, bits = 0, format = 0;
        while (stream.Position + 8 <= stream.Length)
        {
            var id = new string(reader.ReadChars(4)); var length = reader.ReadUInt32(); var start = stream.Position;
            if (id == "fmt ")
            {
                format = reader.ReadUInt16(); channels = reader.ReadUInt16(); reader.ReadUInt32(); reader.ReadUInt32(); reader.ReadUInt16(); bits = reader.ReadUInt16();
                if (format == 0xfffe && length >= 40)
                {
                    reader.ReadUInt16(); reader.ReadUInt16(); reader.ReadUInt32();
                    if (new Guid(reader.ReadBytes(16)) == new Guid("00000001-0000-0010-8000-00aa00389b71")) format = 1;
                }
            }
            if (id == "data")
            {
                if (format != 1 || bits != 16 || channels == 0) throw new InvalidDataException();
                var samples = Math.Min(length, stream.Length - start) / 2 / channels;
                var peaks = new double[count];
                for (long i = 0; i < samples; i++)
                {
                    var value = Math.Abs(reader.ReadInt16() / 32768d);
                    for (var c = 1; c < channels; c++) reader.ReadInt16();
                    var bucket = (int)(i * count / samples);
                    peaks[bucket] = Math.Max(peaks[bucket], value);
                }
                var loudest = peaks.DefaultIfEmpty().Max();
                return loudest > 0 ? peaks.Select(p => p / loudest).ToArray() : peaks;
            }
            stream.Position = start + length + (length % 2);
        }
        return new double[count];
    }
    public static double[] Resample(IReadOnlyList<double> peaks, int count) => Enumerable.Range(0, Math.Max(0, count)).Select(i =>
        peaks.Skip((int)Math.Floor(i * peaks.Count / (double)count)).Take((int)Math.Ceiling((i + 1) * peaks.Count / (double)count) - (int)Math.Floor(i * peaks.Count / (double)count))
            .Where(double.IsFinite).Select(p => Math.Clamp(p, 0, 1)).DefaultIfEmpty().Max()).ToArray();
}
