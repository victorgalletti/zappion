// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class MessageCacheTests
{
    private static MessageRow Message(int index, string conversation = "a") => new()
    {
        Id = conversation + index, ConversationId = conversation, Service = "whatsapp",
        Timestamp = DateTimeOffset.Parse("2026-10-16T00:00:00Z").AddSeconds(index).ToString("O")
    };

    [Fact]
    public void UpsertReplacesReceiptsAndRetainsNewest500InTimestampOrder()
    {
        var cache = new MessageCache();
        foreach (var index in Enumerable.Range(0, 510).Reverse()) cache.Upsert(Message(index));
        var receipt = Message(300);
        receipt.Status = JObject.Parse("{read:'now'}");
        cache.Upsert(receipt);
        var snapshot = cache.Get(["a"])!;
        Assert.True(snapshot.IsStale);
        Assert.Equal(Enumerable.Range(10, 500).Select(i => "a" + i), snapshot.Rows.Select(row => row.Id));
        Assert.Same(receipt, snapshot.Rows.Single(row => row.Id == receipt.Id));
        cache.Upsert(Message(0));
        Assert.Equal(500, cache.Get(["a"])!.Rows.Count);
        Assert.Equal("a10", cache.Get(["a"])!.Rows[0].Id);
    }

    [Fact]
    public void MergedReadsReturnNewest500AcrossMembersWithoutDuplicatingRepeatedIds()
    {
        var cache = new MessageCache();
        cache.Store(["a", "b"], Enumerable.Range(0, 600).Select(i => Message(i, i % 2 == 0 ? "a" : "b")));
        var snapshot = cache.Get(["a", "b", "a"])!;
        Assert.False(snapshot.IsStale);
        Assert.Equal(Enumerable.Range(100, 500).Select(i => (i % 2 == 0 ? "a" : "b") + i), snapshot.Rows.Select(row => row.Id));
        Assert.Equal(300, cache.Get(["b"])!.Rows.Count);
        Assert.True(cache.Get(["a", "missing"])!.IsStale);
    }

    [Fact]
    public void ReadsAndWritesRefreshLruAndEvictionIsBoundedTo30MemberIds()
    {
        var cache = new MessageCache();
        for (var i = 0; i < 30; i++) cache.Upsert(Message(0, "chat" + i));
        Assert.NotNull(cache.Get(["chat0"]));
        cache.Upsert(Message(1, "chat1"));
        cache.Upsert(Message(0, "chat30"));
        Assert.Null(cache.Get(["chat2"]));
        Assert.NotNull(cache.Get(["chat0"]));
        Assert.NotNull(cache.Get(["chat1"]));
        Assert.NotNull(cache.Get(["chat30"]));
        Assert.Equal(29, Enumerable.Range(0, 30).Count(i => cache.Get(["chat" + i]) is not null));
    }

    [Fact]
    public void FullHistoryDistinguishesEmptyMissingAndStaleAndClearDropsEverything()
    {
        var cache = new MessageCache();
        Assert.Null(cache.Get([]));
        Assert.Null(cache.Get(["a"]));
        cache.Store(["a", "b"], [Message(1)]);
        Assert.Empty(cache.Get(["b"])!.Rows);
        Assert.False(cache.Get(["b"])!.IsStale);
        cache.MarkStale("a");
        Assert.True(cache.Get(["a", "b"])!.IsStale);
        Assert.False(cache.Get(["b"])!.IsStale);
        cache.Upsert(Message(2));
        Assert.True(cache.Get(["a"])!.IsStale);
        cache.Store(["a"], []);
        Assert.False(cache.Get(["a"])!.IsStale);
        Assert.Empty(cache.Get(["a"])!.Rows);
        cache.MarkAllStale();
        Assert.True(cache.Get(["a"])!.IsStale);
        Assert.True(cache.Get(["b"])!.IsStale);
        cache.Clear();
        Assert.Null(cache.Get(["a", "b"]));
        cache.Upsert(Message(3));
        Assert.Single(cache.Get(["a"])!.Rows);
    }

    [Fact]
    public async Task ClientCachesNonOpenChatsFiltersOtherServicesAndClearsOnLocalSignOut()
    {
        var directory = IsolatedClient.DirectoryPath();
        Directory.CreateDirectory(directory);
        var sessionPath = Path.Combine(directory, "session.json");
        var persistence = new FileSessionPersistence(sessionPath);
        persistence.SaveSession(new Supabase.Gotrue.Session { AccessToken = "test-access", RefreshToken = "test-refresh" });
        using var client = new ZappionClient(new AppConfiguration("http://127.0.0.1:54321", "test-key"),
            persistence,
            new LastReadStore(Path.Combine(directory, "last-read.json")));
        client.ApplyMessage(Message(1, "not-open"));
        Assert.Single(client.Messages.Get(["not-open"])!.Rows);
        var otherService = Message(2, "other");
        otherService.Service = "email";
        client.ApplyMessage(otherService);
        client.ApplyMessage(new MessageRow { Id = "unassigned", Service = "whatsapp" });
        Assert.Null(client.Messages.Get(["other", ""]));
        client.Messages.Store(["not-open"], [Message(1, "not-open")]);
        client.StopRealtime();
        Assert.True(client.Messages.Get(["not-open"])!.IsStale);
        await client.SignOutAsync();
        Assert.Null(client.Messages.Get(["not-open"]));
        Assert.False(File.Exists(sessionPath));
        Directory.Delete(directory);
    }
}
