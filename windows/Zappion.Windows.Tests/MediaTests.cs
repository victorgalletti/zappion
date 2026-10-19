// SPDX-License-Identifier: AGPL-3.0-only
using System.Net;
using System.Text;
using Concentus;
using Concentus.Oggfile;
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class MediaTests
{
    [Theory]
    [InlineData("image/png", "image", 5_000_000)]
    [InlineData("video/mp4", "video", 16_000_000)]
    [InlineData("audio/ogg; codecs=opus", "audio", 16_000_000)]
    [InlineData("application/pdf", "document", 100_000_000)]
    public void AttachmentShapeAndLimitsMatchWeb(string mime, string kind, long limit)
    {
        var content = MediaContent.Create("organizations/org/attachments/id", mime, limit, "sample", "*caption*");
        Assert.Equal(kind, (string?)content["kind"]);
        Assert.Equal("file", (string?)content["type"]);
        Assert.Equal("1", (string?)content["version"]);
        Assert.Equal(kind == "audio" ? "*caption*" : "**caption**", (string?)content["text"]);
        var file = MediaContent.FileOf(content)!;
        Assert.Equal(mime, (string?)file["mime_type"]);
        Assert.Equal(limit, (long?)file["size"]);
        Assert.Equal("sample", (string?)file["name"]);
        Assert.Equal("organizations/org/attachments/id", MediaContent.StoragePath((string)file["uri"]!));
        Assert.Throws<InvalidOperationException>(() => MediaContent.Validate(mime, limit + 1));
        Assert.Throws<InvalidOperationException>(() => MediaContent.Validate(mime, 0));
    }

    [Theory]
    [InlineData("https://example.com/image.png")]
    [InlineData("123456789")]
    [InlineData("internal://other/path")]
    public void NonStoredUrisWaitForTheBackend(string uri) => Assert.Null(MediaContent.StoragePath(uri));

    [Fact]
    public void VoiceContentKeepsDurationAndExactOpusMime()
    {
        var content = MediaContent.Create("voice", MediaContent.OpusMime, 1024, "audio.ogg", duration: 7);
        Assert.Equal(7, (double?)content["file"]?["duration"]);
        Assert.Null(content["text"]);
        Assert.Equal("audio/ogg; codecs=opus", (string?)content["file"]?["mime_type"]);
    }

    [Theory]
    [InlineData(16000, false)]
    [InlineData(48000, false)]
    [InlineData(16000, true)]
    [InlineData(48000, true)]
    public void EncoderProducesDecodableMonoOggOpus(int sampleRate, bool extensible)
    {
        using var wave = new MemoryStream();
        using (var writer = new BinaryWriter(wave, Encoding.ASCII, true))
        {
            writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write((extensible ? 60 : 36) + sampleRate * 2);
            writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(extensible ? 40 : 16); writer.Write(extensible ? (ushort)0xfffe : (ushort)1); writer.Write((short)1);
            writer.Write(sampleRate); writer.Write(sampleRate * 2); writer.Write((short)2); writer.Write((short)16);
            if (extensible)
            {
                writer.Write((short)22); writer.Write((short)16); writer.Write(4);
                writer.Write(new Guid("00000001-0000-0010-8000-00aa00389b71").ToByteArray());
            }
            writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(sampleRate * 2);
            for (var i = 0; i < sampleRate; i++) writer.Write((short)(Math.Sin(i * Math.PI * 2 * 440 / sampleRate) * 12000));
        }
        wave.Position = 0;
        var bytes = VoiceEncoder.EncodeWave(wave);
        Assert.Equal("OggS", Encoding.ASCII.GetString(bytes, 0, 4));
        var header = Encoding.ASCII.GetString(bytes).IndexOf("OpusHead", StringComparison.Ordinal);
        Assert.True(header > 0); Assert.Equal(1, bytes[header + 9]);
        using var stream = new MemoryStream(bytes);
        var decoder = new OpusOggReadStream(OpusCodecFactory.CreateDecoder(sampleRate, 1), stream);
        var decoded = new List<short>();
        while (decoder.HasNextPacket)
        {
            var packet = decoder.DecodeNextPacket();
            if (packet is not null) decoded.AddRange(packet);
        }
        Assert.InRange(decoded.Count, sampleRate - 960, sampleRate + 1920);
        Assert.Contains(decoded, s => Math.Abs((int)s) > 1000);
        Assert.Throws<InvalidDataException>(() => VoiceEncoder.EncodeWave(new MemoryStream([0, 0, 0, 0])));
    }

    [Fact]
    public void OggOpusVoiceNotesDecodeToPlayableWave()
    {
        using var wave = new MemoryStream();
        using (var writer = new BinaryWriter(wave, Encoding.ASCII, true))
        {
            writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + 48000 * 2);
            writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16); writer.Write((ushort)1); writer.Write((short)1);
            writer.Write(48000); writer.Write(48000 * 2); writer.Write((short)2); writer.Write((short)16);
            writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(48000 * 2);
            for (var i = 0; i < 48000; i++) writer.Write((short)(Math.Sin(i * Math.PI * 2 * 440 / 48000) * 12000));
        }
        wave.Position = 0;
        var directory = Path.Combine(Path.GetTempPath(), "zappion-opus-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        try
        {
            var ogg = Path.Combine(directory, "voice.ogg");
            File.WriteAllBytes(ogg, VoiceEncoder.EncodeWave(wave));
            var playable = OpusWave.PlayablePath(ogg);
            Assert.Equal(ogg + ".wav", playable);
            using (var stream = File.OpenRead(playable))
            using (var reader = new BinaryReader(stream))
            {
                Assert.Equal("RIFF", Encoding.ASCII.GetString(reader.ReadBytes(4)));
                Assert.Equal(stream.Length - 8, reader.ReadUInt32());
                stream.Position = 40;
                var data = reader.ReadUInt32();
                Assert.Equal(stream.Length - 44, data);
                Assert.InRange((int)data / 2, 48000 - 960, 48000 + 1920);
                stream.Position = 0;
                Assert.Contains(AudioWaveform.Peaks16BitWave(stream), p => p > .5);
            }
            Assert.Equal(playable, OpusWave.PlayablePath(ogg));
            var mp3 = Path.Combine(directory, "song.mp3");
            File.WriteAllBytes(mp3, [0x49, 0x44, 0x33, 0x04, 0, 0]);
            Assert.Equal(mp3, OpusWave.PlayablePath(mp3));
            Assert.Throws<InvalidDataException>(() => OpusWave.Decode(new MemoryStream(Encoding.ASCII.GetBytes("OggS")), new MemoryStream()));
        }
        finally { Directory.Delete(directory, true); }
    }

    // One page per packet. OpusWave does not check page CRCs, so they stay zero.
    private static byte[] Ogg(IEnumerable<byte[]> packets)
    {
        using var ogg = new MemoryStream();
        var sequence = 0;
        foreach (var packet in packets)
        {
            var lacing = new List<byte>();
            for (var left = packet.Length; ; left -= 255) { lacing.Add((byte)Math.Min(255, left)); if (left < 255) break; }
            ogg.Write(Encoding.ASCII.GetBytes("OggS")); ogg.WriteByte(0); ogg.WriteByte((byte)(sequence == 0 ? 2 : 0));
            ogg.Write(new byte[8]); ogg.Write(BitConverter.GetBytes(7)); ogg.Write(BitConverter.GetBytes(sequence++)); ogg.Write(new byte[4]);
            ogg.WriteByte((byte)lacing.Count); ogg.Write(lacing.ToArray()); ogg.Write(packet);
        }
        return ogg.ToArray();
    }
    [Fact]
    public async Task OggOpusDecodingConcealsPacketsTheDecoderRejects()
    {
        var encoder = OpusCodecFactory.CreateEncoder(48000, 1, Concentus.Enums.OpusApplication.OPUS_APPLICATION_VOIP);
        var frame = new short[960];
        var encoded = new byte[1275];
        var audio = new List<byte[]>();
        for (var f = 0; f < 10; f++)
        {
            for (var i = 0; i < frame.Length; i++) frame[i] = (short)(Math.Sin((f * 960 + i) * Math.PI * 2 * 440 / 48000) * 12000);
            audio.Add(encoded[..encoder.Encode(frame, 960, encoded, encoded.Length)]);
        }
        // Code 3 with a frame count of zero: Concentus throws on it, and OpusOggReadStream then loops forever.
        audio.Insert(5, [0x03, 0x00]);
        var head = Encoding.ASCII.GetBytes("OpusHead").Concat(new byte[] { 1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0 }).ToArray();
        var bytes = Ogg(new[] { head, Encoding.ASCII.GetBytes("OpusTags").Concat(new byte[8]).ToArray() }.Concat(audio));
        var packets = await Task.Run(() => OpusWave.DecodePackets(new MemoryStream(bytes), 48000).ToList()).WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(11, packets.Count);
        Assert.All(packets, p => Assert.Equal(960, p.Length));
        Assert.Contains(packets[^1], s => Math.Abs((int)s) > 1000);
        Assert.Equal(64, AudioWaveform.PeaksOpusOgg(new MemoryStream(bytes)).Length);
    }

    private sealed class DownloadHandler : HttpMessageHandler
    {
        public int Requests;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1, 2, 3, 4]) });
        }
    }
    [Fact]
    public async Task SignedUrlsRefreshBeforeTheirOneHourExpiry()
    {
        var now = DateTimeOffset.UtcNow; var calls = 0;
        var cache = new MediaCache(_ => Task.FromResult("https://example.com/" + ++calls), now: () => now);
        var first = await cache.GetUrlAsync("path");
        now = now.AddMinutes(49);
        Assert.Equal(first, await cache.GetUrlAsync("path"));
        now = now.AddMinutes(2);
        Assert.NotEqual(first, await cache.GetUrlAsync("path"));
        Assert.Equal(2, calls);
    }
    [Fact]
    public async Task CacheReusesDownloadsAndSignedUrlsAndEvictsOldest()
    {
        var folder = Path.Combine(Path.GetTempPath(), "zappion-media-test-" + Guid.NewGuid());
        try
        {
            var signatures = 0;
            var handler = new DownloadHandler(); using var http = new HttpClient(handler);
            var cache = new MediaCache(p => { signatures++; return Task.FromResult("https://example.com/" + p); }, folder, 8, http);
            Assert.Equal(await cache.GetUrlAsync("a"), await cache.GetUrlAsync("a"));
            var a = await cache.GetFileAsync("internal://media/a", "../../example.png");
            Assert.Equal(a, await cache.GetFileAsync("internal://media/a", "example.png"));
            Assert.Equal(1, handler.Requests); Assert.Equal(1, signatures);
            Assert.Equal(Path.GetFullPath(folder), Path.GetDirectoryName(a));
            File.SetLastWriteTimeUtc(a, DateTime.UtcNow.AddDays(-1));
            await cache.GetFileAsync("internal://media/b", "b.png");
            await cache.GetFileAsync("internal://media/c", "c.png");
            Assert.False(File.Exists(a)); Assert.Equal(8, new DirectoryInfo(folder).GetFiles().Sum(f => f.Length));
            await Assert.ThrowsAsync<InvalidOperationException>(() => cache.GetFileAsync("meta-id", "x"));
            var tooSmall = new MediaCache(_ => Task.FromResult("https://example.com/large"), folder, 2, http);
            await Assert.ThrowsAsync<IOException>(() => tooSmall.GetFileAsync("internal://media/large", "large"));
            Assert.Empty(Directory.GetFiles(folder, "*.part"));
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }
}
