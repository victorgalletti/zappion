// SPDX-License-Identifier: AGPL-3.0-only
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ConversationUpdatesTests
{
    private static ConversationRow Row(string id = "chat", string organization = "org", string name = "Before") =>
        new() { Id = id, OrganizationId = organization, Service = "whatsapp", Address = "5511999999999", OrganizationAddress = "instance", Name = name };

    [Fact]
    public void KnownRowReplacesAllFieldsWithoutMutatingSnapshotAndRebuildsViews()
    {
        var original = Row();
        var other = Row("other");
        ConversationRow[] rows = [original, other];
        var changed = Row(name: "After");
        changed.UpdatedAt = "2026-10-16T12:00:00Z";
        Assert.True(ConversationUpdates.TryUpsert(rows, changed, out var updated));
        Assert.Equal(2, updated.Count);
        Assert.Same(changed, updated[0]);
        Assert.Same(other, updated[1]);
        Assert.Same(original, rows[0]);
        var view = Assert.Single(ConversationMerger.Merge(updated.Take(1).ToArray(), [], [], new Dictionary<string, string>()));
        Assert.Equal("After", view.DisplayName);
        Assert.Equal(changed.UpdatedAt, view.Primary.UpdatedAt);
    }

    [Fact]
    public void MissingUnknownForeignAndIncompleteRowsRequireFullRefresh()
    {
        ConversationRow[] rows = [Row()];
        ConversationRow?[] changes = [null, Row("unknown"), Row(organization: "foreign"), new() { Id = "chat" }, Row("")];
        foreach (var changed in changes)
        {
            Assert.False(ConversationUpdates.TryUpsert(rows, changed, out var updated));
            Assert.Same(rows, updated);
        }
        Assert.False(ConversationUpdates.TryUpsert([], Row(), out _));
    }

    [Fact]
    public void BurstUsesLatestRowWithoutDuplicatingMembers()
    {
        IReadOnlyList<ConversationRow> rows = [Row()];
        for (var i = 0; i < 10; i++)
        {
            Assert.True(ConversationUpdates.TryUpsert(rows, Row(name: i.ToString()), out var updated));
            rows = updated;
        }
        Assert.Equal("9", Assert.Single(rows).Name);
    }
}
