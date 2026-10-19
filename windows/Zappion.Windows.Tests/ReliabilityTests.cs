// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ReliabilityTests
{
    private static MessageRow Message(string id, string timestamp = "2026-10-16T10:00:00Z") =>
        new() { Id = id, Timestamp = timestamp, SenderAddress = "contact", Content = JObject.Parse("{type:'text',text:'Hello'}") };

    [Theory]
    [InlineData("{type:'interactive',kind:'contacts',data:[{name:{formatted_name:'Contact'}}]}")]
    [InlineData("{type:'interactive',kind:'location',data:{latitude:1,longitude:2}}")]
    [InlineData("{type:'interactive',kind:'other',data:'legacy'}")]
    public void NonTemplatePayloadDoesNotGetIndexedAsATemplate(string json)
    {
        var row = Message("contact"); row.Content = JObject.Parse(json);
        var item = new MessageItem(row.Id, row);
        item.Present([row], [JObject.Parse("{name:'test',language:'en_US'}")], "Contact", true);
        Assert.Null(item.Template);
    }

    [Fact]
    public void MatchingTemplateStillRespectsLanguage()
    {
        var row = Message("template"); row.Content = JObject.Parse("{type:'template',kind:'template',data:{name:'test',language:{code:'en_US'}}}");
        var template = JObject.Parse("{name:'test',language:'en_US'}");
        var item = new MessageItem(row.Id, row);
        item.Present([row], [JObject.Parse("{name:'test',language:'pt_BR'}"), template], "Contact", false);
        Assert.Same(template, item.Template);
    }

    [Fact]
    public void TimelineDeduplicatesMessagesAndRepeatedLocalDateSeparators()
    {
        var timeline = new MessageTimeline();
        // These sort lexically into local day A, B, A irrespective of the test machine's zone.
        var today = DateTimeOffset.Now.Date.AddDays(-1);
        var first = Message("a", new DateTimeOffset(today.AddHours(12)).ToString("O"));
        var other = Message("b", new DateTimeOffset(today.AddDays(1).AddHours(12)).ToOffset(TimeSpan.FromHours(-14)).ToString("O"));
        var last = Message("c", new DateTimeOffset(today.AddHours(23)).ToOffset(TimeSpan.FromHours(14)).ToString("O"));
        var duplicate = Message("a", first.Timestamp); duplicate.Status = JObject.Parse("{read:'now'}");
        timeline.Apply([first, other, last, duplicate]);
        timeline.Apply([first, other, last, duplicate]);
        Assert.Equal(timeline.Items.Count, timeline.Items.Select(i => i.Id).Distinct().Count());
        Assert.Equal(3, timeline.Items.Count(i => i.Message is not null));
        Assert.Equal("read", ChatHelpers.DeliveryState(timeline.Items.Single(i => i.Id == "a").Message!.Status));
    }

    [Fact]
    public void NewerLoadOwnsRealtimeUpdatesAndOldCompletionsCannotConsumeThem()
    {
        var buffer = new ChatLoadBuffer();
        var old = buffer.Begin();
        var current = buffer.Begin();
        var update = Message("live");
        buffer.Track(update);
        Assert.False(buffer.TryComplete(old, [Message("old-chat")], null, out _, out _));
        Assert.True(buffer.TryComplete(current, [Message("history")], null, out var rows, out var incoming));
        Assert.Contains(update, rows);
        Assert.Same(update, incoming);
        buffer.Invalidate();
        Assert.False(buffer.TryComplete(current, [], null, out _, out _));
    }

    [Fact]
    public void VerificationStorageCannotPointAtTheOwnerProfile()
    {
        Assert.Null(VerificationStorage.Validate(null));
        var path = IsolatedClient.DirectoryPath();
        Assert.Equal(Path.GetFullPath(path), VerificationStorage.Validate(path));
        Assert.Throws<InvalidOperationException>(() => VerificationStorage.Validate(Path.Combine(Path.GetTempPath(), "Zappion")));
    }

    [Fact]
    public async Task CallbackBoundaryObservesFailuresBeforeAndAfterAnAwait()
    {
        var directory = IsolatedClient.DirectoryPath();
        var logger = new FileLogger(directory);
        await UiCallback.RunAsync(() => throw new ArgumentException("synchronous failure"), "Callback", logger);
        await UiCallback.RunAsync(async () => { await Task.Yield(); throw new NullReferenceException("async failure"); }, "Callback", logger);
        var text = File.ReadAllText(Directory.GetFiles(directory).Single());
        Assert.Contains("ArgumentException", text);
        Assert.Contains("NullReferenceException", text);
    }

    [Fact]
    public void LoggerKeepsSevenDatesAndFullInnerExceptionAndSurvivesConcurrentWrites()
    {
        var directory = IsolatedClient.DirectoryPath(); Directory.CreateDirectory(directory);
        var expired = Path.Combine(directory, $"zappion-{DateTime.Today.AddDays(-7):yyyy-MM-dd}.log");
        var kept = Path.Combine(directory, $"zappion-{DateTime.Today.AddDays(-6):yyyy-MM-dd}.log");
        File.WriteAllText(expired, "old"); File.WriteAllText(kept, "keep");
        var logger = new FileLogger(directory);
        var exception = new ArgumentException("outer", new NullReferenceException("inner"));
        Parallel.For(0, 20, i => logger.Write("ERROR", $"failure {i}", exception));
        Assert.False(File.Exists(expired)); Assert.True(File.Exists(kept));
        var text = File.ReadAllText(Path.Combine(directory, $"zappion-{DateTime.Today:yyyy-MM-dd}.log"));
        Assert.Equal(20, text.Split("[ERROR]").Length - 1);
        Assert.Contains(exception.ToString(), text);
        var blocked = Path.Combine(directory, "file"); File.WriteAllText(blocked, "occupied");
        new FileLogger(blocked).Write("ERROR", "cannot write", exception);
    }
}
