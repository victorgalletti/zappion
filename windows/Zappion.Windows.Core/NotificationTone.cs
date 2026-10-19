// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Mirrors web/lib/notification-sound.ts: two sine blips (660 Hz, then 880 Hz 120 ms later), each ramping
// to 0.035 gain in 15 ms and back to silence at 100 ms. The web synthesizes it with Web Audio, so there is
// no asset to bundle; this renders the same samples into a 16-bit mono PCM WAV.
public static class NotificationTone
{
    public const int SampleRate = 44100;
    private static readonly (double Frequency, double Start)[] Tones = [(660, 0), (880, 0.12)];
    private const double Peak = 0.035, Attack = 0.015, Release = 0.1, Length = 0.23;

    public static byte[] CreateWave()
    {
        var count = (int)(SampleRate * Length);
        var samples = new short[count];
        for (var i = 0; i < count; i++)
        {
            var time = (double)i / SampleRate; var value = 0.0;
            foreach (var (frequency, start) in Tones)
            {
                var t = time - start;
                if (t < 0 || t >= Release) continue;
                var gain = t < Attack ? Peak * t / Attack : Peak * (Release - t) / (Release - Attack);
                value += gain * Math.Sin(2 * Math.PI * frequency * t);
            }
            samples[i] = (short)Math.Round(Math.Clamp(value, -1, 1) * short.MaxValue);
        }
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream);
        writer.Write("RIFF"u8); writer.Write(36 + count * 2); writer.Write("WAVE"u8);
        writer.Write("fmt "u8); writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(SampleRate); writer.Write(SampleRate * 2); writer.Write((short)2); writer.Write((short)16);
        writer.Write("data"u8); writer.Write(count * 2);
        foreach (var sample in samples) writer.Write(sample);
        writer.Flush();
        return stream.ToArray();
    }
}
