// SPDX-License-Identifier: AGPL-3.0-only
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public sealed class SnapshotStoreTests : IDisposable
{
    private readonly string directory = IsolatedClient.DirectoryPath();
    private readonly string user = Guid.NewGuid().ToString();
    private readonly string organization = Guid.NewGuid().ToString();
    private WorkspaceSnapshot Snapshot(string? userId = null, string? organizationId = null, int version = SnapshotStore.CurrentVersion) => new(
        version, DateTimeOffset.UtcNow, new(new AgentRow { Id = "agent", UserId = userId ?? user, OrganizationId = organizationId ?? organization, Name = "Seed agent", Organization = JObject.Parse("{name:'Test'}") },
            "Test", [new() { Address = "123", Extra = JObject.Parse("{name:'Number'}") }]),
        [new() { Id = "chat", OrganizationId = organizationId ?? organization, Address = "456", Service = "whatsapp" }],
        [new() { Address = "456", Extra = JObject.Parse("{name:'Customer'}") }],
        [Message()], [new() { AgentId = "agent", ConversationId = "chat", OrganizationId = organizationId ?? organization, ArchivedAt = "2026-10-16T10:00:00Z" }],
        new Dictionary<string, IReadOnlyList<MessageRow>> { ["chat"] = [Message()], ["empty"] = [] });

    private static MessageRow Message() => new() { Id = "message", ConversationId = "chat", Timestamp = "2026-10-16T09:00:00Z", Content = JObject.Parse("{type:'text',text:'Private customer message'}"), Status = JObject.Parse("{read:'2026-10-16T10:00:00Z'}") };

    [Fact]
    public void RoundTripEncryptsAllQueryDataAndImportsHistoriesAsStale()
    {
        var store = new SnapshotStore(directory);
        var original = Snapshot();
        Assert.True(store.Save(original) > 0);
        var bytes = File.ReadAllBytes(Directory.GetFiles(directory).Single());
        Assert.DoesNotContain("Private customer message", Encoding.UTF8.GetString(bytes));
        var loaded = store.LoadNewest(user)!;
        Assert.Equal(original.SavedAt, loaded.SavedAt);
        Assert.Equal("Seed agent", loaded.Workspace.Agent.Name);
        Assert.Equal("Test", (string?)loaded.Workspace.Agent.Organization?["name"]);
        Assert.Equal("Number", (string?)loaded.Workspace.Numbers.Single().Extra?["name"]);
        Assert.Equal("456", loaded.Conversations.Single().Address);
        Assert.Equal("Customer", (string?)loaded.Contacts.Single().Extra?["name"]);
        Assert.Equal("2026-10-16T10:00:00Z", loaded.Preferences.Single().ArchivedAt);
        Assert.Equal("Private customer message", (string?)loaded.RecentMessages.Single().Content?["text"]);
        Assert.Equal("2026-10-16T10:00:00Z", (string?)loaded.Histories["chat"].Single().Status?["read"]);
        var cache = new MessageCache();
        cache.Import(loaded.Histories);
        Assert.True(cache.Get(["chat"])!.IsStale);
        Assert.True(cache.Get(["empty"])!.IsStale);
        Assert.Empty(cache.Get(["empty"])!.Rows);
    }

    [Fact]
    public void OtherVersionsAndCorruptOrUndecryptableFilesAreDeleted()
    {
        var store = new SnapshotStore(directory);
        store.Save(Snapshot(version: 999));
        Assert.Null(store.LoadNewest(user));
        Assert.Empty(Directory.GetFiles(directory));
        store.Save(Snapshot());
        var path = Directory.GetFiles(directory).Single();
        File.WriteAllBytes(path, [1, 2, 3]);
        Assert.Null(store.LoadNewest(user));
        Assert.False(File.Exists(path));
        store.Save(Snapshot() with { Histories = new Dictionary<string, IReadOnlyList<MessageRow>> { ["chat"] = null! } });
        Assert.Null(store.LoadNewest(user));
        Assert.False(File.Exists(path));
        if (!OperatingSystem.IsWindows()) return;
        File.WriteAllBytes(path, ProtectedData.Protect(Encoding.UTF8.GetBytes("invalid JSON"), null, DataProtectionScope.CurrentUser));
        Assert.Null(store.LoadNewest(user));
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void NewestOrganizationIsRestoredAndDeletionIsScopedToUser()
    {
        var store = new SnapshotStore(directory);
        var otherUser = Guid.NewGuid().ToString();
        var otherOrganization = Guid.NewGuid().ToString();
        store.Save(Snapshot() with { SavedAt = DateTimeOffset.UtcNow.AddHours(-1) });
        store.Save(Snapshot(organizationId: otherOrganization));
        store.Save(Snapshot(userId: otherUser));
        Assert.Equal(otherOrganization, store.LoadNewest(user)!.Workspace.OrganizationId);
        Assert.Equal(organization, store.LoadNewest(otherUser)!.Workspace.OrganizationId);
        Assert.Null(store.LoadNewest(Guid.NewGuid().ToString()));
        store.DeleteUser(user);
        Assert.Null(store.LoadNewest(user));
        Assert.NotNull(store.LoadNewest(otherUser));
        Assert.Single(Directory.GetFiles(directory));
    }

    [Fact]
    public void PayloadCannotBeRestoredUnderAnotherUserOrOrganizationFilename()
    {
        var store = new SnapshotStore(directory);
        store.Save(Snapshot());
        var path = Directory.GetFiles(directory).Single();
        var otherUser = Guid.NewGuid().ToString();
        var moved = Path.Combine(directory, $"snapshot-{otherUser}-{organization}.bin");
        File.Move(path, moved);
        Assert.Null(store.LoadNewest(otherUser));
        Assert.False(File.Exists(moved));
        store.Save(Snapshot());
        path = Directory.GetFiles(directory).Single();
        moved = Path.Combine(directory, $"snapshot-{user}-{Guid.NewGuid()}.bin");
        File.Move(path, moved);
        Assert.Null(store.LoadNewest(user));
        Assert.False(File.Exists(moved));
    }

    [Fact]
    public async Task UnauthenticatedClientCannotRestoreOrOverwriteSnapshots()
    {
        Directory.CreateDirectory(directory);
        var store = new SnapshotStore(directory);
        store.Save(Snapshot());
        store.Save(Snapshot(organizationId: Guid.NewGuid().ToString()));
        var persistence = new FileSessionPersistence(Path.Combine(directory, "session.json"));
        using var client = new ZappionClient(new("http://127.0.0.1:54321", "test-key"), persistence,
            new LastReadStore(Path.Combine(directory, "last-read.json")), store);
        Assert.Null(client.TryRestoreSnapshot(user));
        client.SaveSnapshot();
        Assert.Equal(2, Directory.GetFiles(directory, "snapshot-*.bin").Length);
        await client.SignOutAsync();
        Assert.Equal(2, Directory.GetFiles(directory, "snapshot-*.bin").Length);
    }

    [Fact]
    public void ExportImportPreservesLruCapAndEmptyEntries()
    {
        var cache = new MessageCache();
        for (var i = 0; i < 31; i++) cache.Store(["chat" + i], []);
        cache.Get(["chat1"]);
        var restored = new MessageCache();
        restored.Import(cache.Export());
        Assert.Equal(30, restored.Export().Count);
        restored.Store(["new"], []);
        Assert.Null(restored.Get(["chat2"]));
        Assert.True(restored.Get(["chat1"])!.IsStale);
    }

    [Fact]
    public async Task MatchingSavedSessionRestoresInboxAndLocalSignOutDeletesAllItsSnapshots()
    {
        Directory.CreateDirectory(directory);
        var store = new SnapshotStore(directory);
        store.Save(Snapshot() with { SavedAt = DateTimeOffset.UtcNow.AddHours(-1) });
        store.Save(Snapshot(organizationId: Guid.NewGuid().ToString()));
        var persistence = new FileSessionPersistence(Path.Combine(directory, "session.json"));
        // A token-free synthetic session; LoadSession does no network I/O or refresh.
        persistence.SaveSession(new Supabase.Gotrue.Session { User = new() { Id = user } });
        using var client = new ZappionClient(new("http://127.0.0.1:54321", "test-key"), persistence,
            new LastReadStore(Path.Combine(directory, "last-read.json")), store);
        var sdk = (Supabase.Client)typeof(ZappionClient).GetField("client", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.GetValue(client)!;
        sdk.Auth.LoadSession();
        Assert.Null(client.TryRestoreSnapshot(Guid.NewGuid().ToString()));
        Assert.NotNull(client.TryRestoreSnapshot(user));
        Assert.Single(client.ConversationViews());
        Assert.True(client.Messages.Get(["chat"])!.IsStale);
        await client.SignOutAsync();
        client.SaveSnapshot();
        Assert.Null(store.LoadNewest(user));
        Assert.False(File.Exists(Path.Combine(directory, "session.json")));
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
