// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class InteractionTests
{
    [Fact]
    public void ReplyUsesAcknowledgedExternalIdAndPreservesFileAndFormatting()
    {
        var content = MediaContent.Create("org/file", "image/png", 12, "image.png", "*caption*");
        var reply = MessageInteractions.WithReply(content, new MessageRow { Id = "database-id", ExternalId = "wamid.original" });
        Assert.Equal("wamid.original", (string?)reply["re_message_id"]);
        Assert.Equal("**caption**", (string?)reply["text"]);
        Assert.True(JToken.DeepEquals(content["file"], reply["file"])); Assert.Null(content["re_message_id"]);
        Assert.Null(MessageInteractions.WithReply(content, new MessageRow { Id = "unacknowledged" })["re_message_id"]);
    }
    [Fact]
    public void ReactionsUseLatestPerSenderWithReplacementAndRemoval()
    {
        var rows = new List<MessageRow>();
        void Add(string? who, string emoji, int minute) => rows.Add(new MessageRow { SenderAddress = who, Timestamp = $"2026-10-16T12:{minute:00}:00Z", Content = MessageInteractions.Reaction(who is null ? rows : [], "wamid.target", emoji) });
        Add(null, "👍", 0); Add("customer", "👍", 1);
        Assert.Equal(2, MessageInteractions.Reactions(rows, "wamid.target").Count);
        Add(null, "❤️", 2);
        Assert.Equal("❤️", MessageInteractions.Reactions(rows, "wamid.target")["me"]);
        Add(null, "❤️", 3);
        Assert.Equal("removed", (string?)rows[^1].Content?["data"]?["action"]);
        Assert.Null(rows[^1].Content?["data"]?["unicode"]);
        Assert.Single(MessageInteractions.Reactions(rows.AsEnumerable().Reverse(), "wamid.target"));
        Assert.Empty(MessageInteractions.Reactions(rows, "other"));
    }
    [Fact]
    public void ContextUsesExternalIdsAndReactionRowsStayOffTimeline()
    {
        var original = new MessageRow { Id = "db", ExternalId = "wamid", Content = JObject.Parse("{type:'text',kind:'text',text:'hello'}") };
        var reply = new MessageRow { Id = "reply", Content = JObject.Parse("{type:'text',kind:'text',text:'answer',re_message_id:'wamid'}") };
        var reaction = new MessageRow { Id = "reaction", Content = MessageInteractions.Reaction([], "wamid", "👍") };
        var timeline = new MessageTimeline(); timeline.Apply([original, reply, reaction]);
        Assert.Equal(2, timeline.Items.Count);
        var item = timeline.Items.Single(i => i.Id == "reply"); item.Present([original, reply, reaction], [], "Contact", true);
        Assert.Same(original, item.Quoted);
    }
    [Theory]
    [InlineData("{cause:{error:{error_user_msg:'friendly',message:'graph'},reason:'meta'}}", "friendly", "meta")]
    [InlineData("{cause:{error:{message:'graph'}}}", "graph", null)]
    [InlineData("{message:'edge'}", "edge", null)]
    [InlineData("{}", "HTTP error 502", null)]
    [InlineData("{cause:'unstructured',message:'edge'}", "edge", null)]
    [InlineData("{cause:{error:'unstructured',reason:7}}", "HTTP error 502", null)]
    public void FunctionErrorsFollowWebPrecedence(string json, string expected, string? reason)
    {
        var error = FunctionError.FromResponse(502, JObject.Parse(json));
        Assert.Equal(expected, error.Message); Assert.Equal(502, error.Status); Assert.Equal(reason, error.Reason);
    }
    [Theory]
    [InlineData("audio/ogg; codecs=opus", true)]
    [InlineData("AUDIO/WEBM", true)]
    [InlineData("audio/mpeg", false)]
    [InlineData("audio/mp4", false)]
    public void AudioVariantMatchesWeb(string mime, bool voice) => Assert.Equal(voice, AudioWaveform.IsVoiceNote(mime));
    [Fact]
    public void ResamplingPreservesTransientsAndClampsInvalidPeaks()
    {
        Assert.Equal(new double[] { 1, .5 }, AudioWaveform.Resample([0, 1, double.NaN, .5], 2));
        Assert.Equal(new double[] { 0, 0, 0 }, AudioWaveform.Resample([], 3));
        Assert.Equal(new double[] { 1 }, AudioWaveform.Resample([2, -1], 1));
    }
    [Fact]
    public void RecordedOpusWaveformReflectsTheAudioAndNormalizesPeaks()
    {
        using var wave = new MemoryStream();
        using (var writer = new BinaryWriter(wave, System.Text.Encoding.ASCII, true))
        {
            writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(64036);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
            writer.Write((short)1); writer.Write((short)1); writer.Write(16000); writer.Write(32000); writer.Write((short)2); writer.Write((short)16);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(64000);
            for (var i = 0; i < 32000; i++) writer.Write((short)(i < 16000 ? 0 : Math.Sin(i * Math.PI * 880 / 16000) * 12000));
        }
        wave.Position = 0;
        var pcmPeaks = AudioWaveform.Peaks16BitWave(wave);
        Assert.All(pcmPeaks.Take(16), p => Assert.Equal(0, p));
        Assert.All(pcmPeaks.Skip(48), p => Assert.True(p > .9));
        wave.Position = 0;
        using var ogg = new MemoryStream(VoiceEncoder.EncodeWave(wave));
        var peaks = AudioWaveform.PeaksOpusOgg(ogg);
        Assert.Equal(64, peaks.Length);
        Assert.All(peaks.Take(16), p => Assert.True(p < .05));
        Assert.All(peaks.Skip(48), p => Assert.True(p > .5));
    }
}
