// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class RealtimeAndUnreadTests
{
    private static MessageRow Message(string id, string at, string conversation = "a", string? sender = "contact",
        string json = "{type:'text',text:'Hello'}") => new()
    {
        Id = id, Timestamp = at, ConversationId = conversation, SenderAddress = sender,
        OrganizationId = "org", Service = "whatsapp", Content = JObject.Parse(json)
    };

    [Fact]
    public void UnreadUsesPrimaryMarkAcrossMergedMembersAndIgnoresNonRenderableAndOutgoing()
    {
        var rows = new[]
        {
            new ConversationRow { Id = "a", Address = "551199887766", OrganizationAddress = "business" },
            new ConversationRow { Id = "b", Address = "5511999887766", OrganizationAddress = "business" }
        };
        var messages = new[]
        {
            Message("1", "2026-10-15T10:00:00Z"),
            Message("2", "2026-10-15T11:00:00Z", "b"),
            Message("3", "2026-10-15T12:00:00Z"),
            Message("4", "2026-10-15T13:00:00Z", sender: null),
            Message("5", "2026-10-15T14:00:00Z", "b", json: "{type:'data',kind:'reaction'}"),
            Message("6", "2026-10-15T15:00:00Z", "b", json: "{type:'text',text:''}")
        };
        var view = Assert.Single(ConversationMerger.Merge(rows, messages, [],
            new Dictionary<string, string> { ["a"] = "2026-10-15T10:00:00Z", ["b"] = "2026-10-15T23:00:00Z" }));
        Assert.Equal("a", view.Primary.Id);
        Assert.Equal(2, view.Unread);
        Assert.Contains("2 unread", view.AccessibilityName);
        Assert.Equal(3, Assert.Single(ConversationMerger.Merge(rows, messages, [])).Unread);
    }

    [Fact]
    public void LastReadPersistsAtomicallyAndOnlyMovesForward()
    {
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        var path = Path.Combine(directory, "last-read.json");
        try
        {
            var store = new LastReadStore(path);
            Assert.True(store.Mark("a", "2026-10-15T10:00:00Z"));
            Assert.False(store.Mark("a", "2026-10-15T09:00:00Z"));
            Assert.False(store.Mark("a", "invalid"));
            Assert.Equal("2026-10-15T10:00:00Z", new LastReadStore(path).Snapshot()["a"]);
            Assert.False(File.Exists(path + ".tmp"));
            Assert.False(File.ReadAllBytes(path).Take(3).SequenceEqual(new byte[] { 239, 187, 191 }));
            File.WriteAllText(path, "invalid");
            Assert.Empty(new LastReadStore(path).Snapshot());
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Fact]
    public void ReceiptUpdateKeepsBubbleAndDateIdentitiesAndNotifiesOnlyChangedItem()
    {
        var first = Message("first", "2026-10-15T10:00:00Z");
        var outgoing = Message("out", "2026-10-15T11:00:00Z", sender: null);
        var timeline = new MessageTimeline();
        timeline.Apply([first, outgoing]);
        var date = timeline.Items[0];
        var bubble = timeline.Items[2];
        var changes = 0;
        var collectionChanges = 0;
        bubble.PropertyChanged += (_, e) => { if (e.PropertyName == nameof(MessageItem.Message)) changes++; };
        timeline.Items.CollectionChanged += (_, _) => collectionChanges++;
        var receipt = Message("out", outgoing.Timestamp, sender: null);
        receipt.Status = JObject.Parse("{read:'2026-10-15T12:00:00Z'}");
        timeline.Apply(MessageTimeline.Upsert([first, outgoing], receipt));
        Assert.Same(date, timeline.Items[0]);
        Assert.Same(bubble, timeline.Items[2]);
        Assert.Equal("read", ChatHelpers.DeliveryState(bubble.Message!.Status));
        Assert.Equal(1, changes);
        Assert.Equal(0, collectionChanges);
        timeline.Apply([first, receipt, Message("tomorrow", "2026-10-17T10:00:00Z")]);
        Assert.Equal(2, timeline.Items.Count(i => i.DateLabel is not null));
        Assert.Same(bubble, timeline.Items[2]);
    }

    [Fact]
    public void RecentUpsertsSortDeduplicateAndBoundHistory()
    {
        var old = Message("old", "2026-10-15T10:00:00Z");
        var newer = Message("new", "2026-10-15T11:00:00Z");
        var recent = MessageTimeline.Upsert([old], newer, true, 1);
        Assert.Equal("new", Assert.Single(recent).Id);
        Assert.Single(MessageTimeline.Upsert(recent, newer));
        Assert.Equal(new[] { "old", "new" }, MessageTimeline.Upsert([newer], old).Select(m => m.Id));
    }

    [Fact]
    public void NotificationsSuppressReplayWrongOrganizationAndOpenFocusedChatAndThrottleSound()
    {
        var start = DateTimeOffset.Parse("2026-10-15T10:00:00Z");
        var policy = new MessageNotifications(start);
        var old = Message("old", "2026-10-15T09:59:59Z");
        Assert.False(policy.Evaluate(old, "org", false, [], start).Toast);
        var message = Message("first", "2026-10-15T10:00:01Z");
        Assert.False(policy.Evaluate(message, "other", false, [], start).Toast);
        var first = policy.Evaluate(message, "org", false, [], start);
        Assert.True(first.Toast); Assert.True(first.Sound);
        Assert.False(policy.Evaluate(message, "org", false, [], start.AddSeconds(3)).Toast);
        var second = policy.Evaluate(Message("second", message.Timestamp), "org", true, ["different"], start.AddSeconds(1));
        Assert.True(second.Toast); Assert.False(second.Sound);
        Assert.True(policy.Evaluate(Message("third", message.Timestamp), "org", false, [], start.AddSeconds(2)).Sound);
        var focused = policy.Evaluate(Message("focused", message.Timestamp, "merged"), "org", true, ["a", "merged"], start.AddSeconds(5));
        Assert.False(focused.Toast); Assert.False(focused.Sound);
        Assert.False(policy.Evaluate(Message("out", message.Timestamp, sender: null), "org", false, [], start).Toast);
        Assert.False(policy.Evaluate(Message("reaction", message.Timestamp, json: "{type:'data',kind:'reaction'}"), "org", false, [], start).Toast);
        Assert.False(policy.Evaluate(Message("unsupported", message.Timestamp, json: "{type:'data',kind:'unknown'}"), "org", false, [], start).Toast);
    }

    [Theory]
    [InlineData("{type:'file',kind:'audio'}", "\uD83C\uDFA4 Voice message")]
    [InlineData("{type:'file',kind:'image',text:'Caption'}", "\uD83D\uDCF7 Caption")]
    [InlineData("{type:'file',kind:'video'}", "\uD83C\uDFA5 Video")]
    [InlineData("{type:'file',kind:'document'}", "\uD83D\uDCC4 Document")]
    [InlineData("{type:'file',kind:'sticker'}", "\uD83C\uDFF7\uFE0F Sticker")]
    [InlineData("{type:'data',kind:'template',data:{name:'Welcome'}}", "\uD83D\uDCCB Welcome")]
    [InlineData("{type:'data',kind:'location'}", "\uD83D\uDCCD Location")]
    [InlineData("{type:'data',kind:'contacts'}", "\uD83D\uDC64 Contact")]
    public void NotificationPreviewMatchesWebEmojiMap(string json, string expected) =>
        Assert.Equal(expected, MessageNotifications.PreviewLine(Message("id", "2026-10-15T10:00:00Z", json: json)));

    [Fact]
    public void ToastXmlAndConversationArgumentsRoundTripSafely()
    {
        var xml = MessageNotifications.BuildToastXml("conv/1&2", "Alice <Admin>", "Hello & \"welcome\"");
        var doc = System.Xml.Linq.XDocument.Parse(xml);
        Assert.Equal("conversation=conv%2F1%262", doc.Root?.Attribute("launch")?.Value);
        Assert.Equal(new[] { "Alice <Admin>", "Hello & \"welcome\"" }, doc.Descendants("text").Select(t => t.Value));
        Assert.Equal("true", doc.Root?.Element("audio")?.Attribute("silent")?.Value);
        Assert.True(MessageNotifications.TryParseConversation(doc.Root?.Attribute("launch")?.Value, out var parsed));
        Assert.Equal("conv/1&2", parsed);
        Assert.True(MessageNotifications.TryParseConversation("-ToastActivated --conversation=abc-123", out parsed));
        Assert.Equal("abc-123", parsed);
        Assert.True(MessageNotifications.TryParseConversation(new[] { "--conversation", "cold-start-id" }, out parsed));
        Assert.Equal("cold-start-id", parsed);
        Assert.False(MessageNotifications.TryParseConversation("", out _));
        Assert.Equal(64, MessageNotifications.ToastTag(new string('x', 80)).Length);
    }
}

