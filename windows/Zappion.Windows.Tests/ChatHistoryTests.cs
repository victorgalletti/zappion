// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ChatHistoryTests
{
    private static MessageRow Message(int index, string conversation = "a", bool incoming = false) => new()
    {
        Id = conversation + index, ConversationId = conversation, SenderAddress = incoming ? "contact" : null,
        Timestamp = DateTimeOffset.Parse("2026-10-16T00:00:00Z").AddSeconds(index).ToString("O")
    };

    [Fact]
    public void IncrementalMergeKeepsHistoryReplacesBoundaryAndIncludesEqualTimestampRows()
    {
        var boundary = Message(2);
        boundary.Status = JObject.Parse("{read:'now'}");
        var sameTime = Message(2, "b");
        var merged = ChatHistory.Merge([Message(1), Message(2)], [Message(3), boundary, sameTime]);
        Assert.Equal(["a1", "a2", "a3", "b2"], merged.Select(row => row.Id).Order());
        Assert.Equal(merged.OrderBy(row => row.Timestamp, StringComparer.Ordinal), merged);
        Assert.Same(boundary, merged.Single(row => row.Id == "a2"));
        Assert.Equal(merged.Select(row => row.Id).Order(), ChatHistory.Merge(merged, [boundary, sameTime, Message(3)]).Select(row => row.Id).Order());
    }

    [Fact]
    public void MergeKeepsNewest500AcrossMembersAndAnEmptyDeltaKeepsCachedHistory()
    {
        var cached = Enumerable.Range(0, 500).Select(i => Message(i)).ToArray();
        Assert.Equal(cached, ChatHistory.Merge(cached, []));
        var merged = ChatHistory.Merge(cached, Enumerable.Range(500, 20).Select(i => Message(i, "b")));
        Assert.Equal(500, merged.Count);
        Assert.Equal("a20", merged[0].Id);
        Assert.Equal("b519", merged[^1].Id);
    }

    [Fact]
    public void IncomingUsesCacheImmediatelyAndRefreshCannotMoveItBackwards()
    {
        var recent = Message(2, incoming: true);
        Assert.Same(recent, ChatHistory.LastIncoming([Message(3), recent, Message(1, incoming: true)]));
        Assert.Same(recent, ChatHistory.LastIncoming([recent], Message(1, incoming: true)));
        var outsideHistory = Message(0, incoming: true);
        Assert.Same(outsideHistory, ChatHistory.LastIncoming([Message(3)], outsideHistory));
        Assert.Null(ChatHistory.LastIncoming([Message(3)]));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RealtimeAndSentRowsWinOverFullOrIncrementalResponseAndFillCache(bool incremental)
    {
        var cache = new MessageCache();
        cache.Store(["a"], [Message(0), Message(1)]);
        if (!incremental) cache.MarkAllStale();
        var snapshot = cache.Get(["a"])!;
        var buffer = new ChatLoadBuffer();
        var request = buffer.Begin();
        var receipt = Message(1, incoming: true);
        receipt.Status = JObject.Parse("{read:'now'}");
        var sent = Message(3);
        buffer.Track(receipt);
        buffer.Track(sent);
        var merged = ChatHistory.Merge(incremental ? snapshot.Rows : [], [Message(1), Message(2)]);
        Assert.True(buffer.TryComplete(request, merged, null, out var rows, out var incoming));
        cache.Store(["a"], rows);
        Assert.Equal(incremental ? 4 : 3, rows.Count);
        Assert.Same(receipt, rows.Single(row => row.Id == "a1"));
        Assert.Same(sent, rows[^1]);
        Assert.Same(receipt, incoming);
        Assert.Equal(rows, cache.Get(["a"])!.Rows);
        Assert.False(cache.Get(["a"])!.IsStale);
    }

    [Fact]
    public async Task EmptyMemberIncrementalQueryDoesNotContactSupabase()
    {
        using var client = IsolatedClient.Create(new AppConfiguration("http://127.0.0.1:1", "test-key"));
        Assert.Empty(await client.GetMessagesSinceAsync([], Message(0).Timestamp));
    }
}
