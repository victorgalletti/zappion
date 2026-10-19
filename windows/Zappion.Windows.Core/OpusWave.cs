// SPDX-License-Identifier: AGPL-3.0-only
using System.Text;

namespace Zappion.Windows.Core;

// Windows' MediaPlayer has no Ogg/Opus decoder without the optional Web Media Extensions, so voice
// notes (audio/ogg; codecs=opus, like the web's <audio>) are decoded in managed code to 16-bit PCM WAV.
public static class OpusWave
{
    public const int SampleRate = 48000;
    public static bool IsOgg(Stream stream)
    {
        var start = stream.Position;
        var magic = new byte[4];
        var read = stream.Read(magic, 0, 4);
        stream.Position = start;
        return read == 4 && Encoding.ASCII.GetString(magic) == "OggS";
    }
    // Concentus.Oggfile's OpusOggReadStream loops forever once a packet fails to decode (HasNextPacket
    // stays true and every later packet fails too), and Concentus rejects some packets in WhatsApp voice
    // notes that libopus plays. Read the Ogg pages here and conceal the packets Concentus cannot decode.
    public static IEnumerable<short[]> DecodePackets(Stream ogg, int sampleRate, CancellationToken token = default)
    {
        var decoder = Concentus.OpusCodecFactory.CreateDecoder(sampleRate, 1);
        var buffer = new short[sampleRate * 120 / 1000];
        foreach (var packet in Packets(ogg))
        {
            token.ThrowIfCancellationRequested();
            if (packet.Length == 0 || StartsWith(packet, "OpusHead") || StartsWith(packet, "OpusTags")) continue;
            int count;
            try { count = decoder.Decode(packet, buffer, buffer.Length); }
            catch (Exception) { count = 0; }
            if (count <= 0)
            {
                int expected;
                try { expected = Math.Clamp(Concentus.Structs.OpusPacketInfo.GetNumSamples(packet, sampleRate), 0, buffer.Length); }
                catch (Exception) { expected = 0; }
                if (expected <= 0) expected = sampleRate / 50;
                decoder.ResetState();
                try { count = decoder.Decode(ReadOnlySpan<byte>.Empty, buffer, expected); }
                catch (Exception) { decoder.ResetState(); Array.Clear(buffer); count = expected; }
            }
            if (count > 0) yield return buffer[..count];
        }
    }
    private static bool StartsWith(byte[] packet, string magic) => packet.Length >= magic.Length && Encoding.ASCII.GetString(packet, 0, magic.Length) == magic;
    // Packets of the first logical stream; stops at the first malformed page.
    private static IEnumerable<byte[]> Packets(Stream ogg)
    {
        var header = new byte[27];
        var lacing = new byte[255];
        var packet = new MemoryStream();
        int? serial = null;
        while (ReadFully(ogg, header, 27) && Encoding.ASCII.GetString(header, 0, 4) == "OggS")
        {
            var segments = header[26];
            if (!ReadFully(ogg, lacing, segments)) yield break;
            var body = new byte[lacing.Take(segments).Sum(b => b)];
            if (!ReadFully(ogg, body, body.Length)) yield break;
            var page = BitConverter.ToInt32(header, 14);
            serial ??= page;
            if (page != serial) continue;
            var offset = 0;
            for (var i = 0; i < segments; i++)
            {
                packet.Write(body, offset, lacing[i]);
                offset += lacing[i];
                if (lacing[i] < 255) { yield return packet.ToArray(); packet.SetLength(0); }
            }
        }
    }
    private static bool ReadFully(Stream stream, byte[] buffer, int count)
    {
        var read = 0;
        while (read < count)
        {
            var n = stream.Read(buffer, read, count - read);
            if (n == 0) return false;
            read += n;
        }
        return true;
    }
    public static void Decode(Stream ogg, Stream wav, CancellationToken token = default)
    {
        using var writer = new BinaryWriter(wav, Encoding.ASCII, leaveOpen: true);
        var header = wav.Position;
        WriteHeader(writer, 0);
        long samples = 0;
        foreach (var packet in DecodePackets(ogg, SampleRate, token))
        {
            foreach (var sample in packet) writer.Write(sample);
            samples += packet.Length;
        }
        if (samples == 0) throw new InvalidDataException("No Opus audio in the Ogg stream.");
        var end = wav.Position;
        wav.Position = header;
        WriteHeader(writer, samples * 2);
        wav.Position = end;
    }
    // Returns a playable copy next to the cached file; non-Ogg files are returned unchanged.
    public static string PlayablePath(string path, CancellationToken token = default)
    {
        using (var input = File.OpenRead(path)) if (!IsOgg(input)) return path;
        var target = path + ".wav";
        if (File.Exists(target)) return target;
        // One temporary file per call: cards that reload while a conversion runs must not share it.
        var temporary = $"{target}.{Guid.NewGuid():N}.part";
        try
        {
            using (var input = File.OpenRead(path))
            using (var output = File.Create(temporary)) Decode(input, output, token);
            File.Move(temporary, target, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        return target;
    }
    private static void WriteHeader(BinaryWriter writer, long dataLength)
    {
        writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write((uint)(36 + dataLength));
        writer.Write(Encoding.ASCII.GetBytes("WAVE"));
        writer.Write(Encoding.ASCII.GetBytes("fmt ")); writer.Write(16u); writer.Write((ushort)1); writer.Write((ushort)1);
        writer.Write((uint)SampleRate); writer.Write((uint)(SampleRate * 2)); writer.Write((ushort)2); writer.Write((ushort)16);
        writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write((uint)dataLength);
    }
}
