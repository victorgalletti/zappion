// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ConversationMergerTests
{
    private static ConversationRow Row(string id, string address = "551199887766", string orgAddress = "business", string? name = null, string updated = "2026-10-01T10:00:00Z") =>
        new() { Id = id, Address = address, OrganizationAddress = orgAddress, Name = name, UpdatedAt = updated };

    private static MessageRow Message(string id, string conversation, string timestamp, string? sender = null, string json = "{type:'text',text:'hello'}") =>
        new() { Id = id, ConversationId = conversation, Timestamp = timestamp, SenderAddress = sender, Content = JObject.Parse(json) };

    [Fact]
    public void MergesNinthDigitVariantsAndUsesLatestIncomingForPrimary()
    {
        var rows = new[] { Row("nine", "5511999887766"), Row("meta") };
        var messages = new[]
        {
            Message("out", "nine", "2026-10-01T12:00:00Z"),
            Message("in", "meta", "2026-10-01T11:00:00Z", "551199887766"),
            Message("old", "nine", "2026-10-01T10:00:00Z", "5511999887766")
        };
        var view = Assert.Single(ConversationMerger.Merge(rows, messages, []));
        Assert.Equal("meta", view.Primary.Id);
        Assert.Equal(new[] { "nine", "meta" }, view.MemberIds);
        Assert.Equal("out", view.LastMessage?.Id);
        Assert.Equal("hello", view.PreviewText);
    }

    [Fact]
    public void KeepsDifferentBusinessNumbersAndLandlinesSeparate()
    {
        var rows = new[] { Row("a"), Row("b", orgAddress: "other"), Row("c", "551132345678"), Row("d", "5511932345678") };
        Assert.Equal(4, ConversationMerger.Merge(rows, [], []).Count);
    }

    [Fact]
    public void FallsBackToLatestOutgoingThenFirstRow()
    {
        var rows = new[] { Row("nine", "5511999887766"), Row("meta") };
        Assert.Equal("meta", Assert.Single(ConversationMerger.Merge(rows,
            [Message("out", "meta", "2026-10-01T12:00:00Z")], [])).Primary.Id);
        Assert.Equal("nine", Assert.Single(ConversationMerger.Merge(rows, [], [])).Primary.Id);
    }

    [Fact]
    public void IgnoresReactionsEmptyTextAndUnlinkedMessagesForPreviewAndPrimary()
    {
        var messages = new[]
        {
            Message("valid", "a", "2026-10-01T10:00:00Z"),
            Message("reaction", "b", "2026-10-01T14:00:00Z", "contact", "{type:'data',kind:'reaction'}"),
            Message("empty", "b", "2026-10-01T15:00:00Z", "contact", "{type:'text',text:''}"),
            Message("orphan", "", "2026-10-01T16:00:00Z")
        };
        var view = Assert.Single(ConversationMerger.Merge([Row("a"), Row("b", "5511999887766")], messages, []));
        Assert.Equal("a", view.Primary.Id);
        Assert.Equal("valid", view.LastMessage?.Id);
    }

    [Fact]
    public void NameLookupUsesExactAddressAndPreservesRowOrderFallback()
    {
        var contacts = new[] { new ContactAddressRow { Address = "5511999887766", OrganizationAddress = "business", Extra = JObject.Parse("{saved_name:'Saved',name:'Push'}") } };
        var rows = new[] { Row("meta", name: "Row name"), Row("nine", "5511999887766") };
        Assert.Equal("Row name", Assert.Single(ConversationMerger.Merge(rows, [], contacts)).DisplayName);
        rows[0].Name = null;
        Assert.Equal("Saved", Assert.Single(ConversationMerger.Merge(rows, [], contacts)).DisplayName);
        Assert.Equal("+55 11 99988-7766", Assert.Single(ConversationMerger.Merge(rows, [], [])).DisplayName);
    }

    [Fact]
    public void ContactNameOverridesRowNameButDoesNotLeakAcrossBusinessNumbers()
    {
        var contacts = new[] { new ContactAddressRow { Address = "551199887766", OrganizationAddress = "business", Extra = JObject.Parse("{synced:{name:'Address book'},saved_name:'Saved'}") } };
        var views = ConversationMerger.Merge([Row("a", name: "Row"), Row("b", orgAddress: "other", name: "Other")], [], contacts);
        Assert.Equal(new[] { "Address book", "Other" }, views.Select(v => v.DisplayName));
    }

    [Fact]
    public void SortsByLastRenderableMessageOrUpdatedAt()
    {
        var rows = new[] { Row("a"), Row("b", "12025551234", updated: "2026-10-03T10:00:00Z"), Row("c", "12025551235") };
        var views = ConversationMerger.Merge(rows,
            [Message("old", "a", "2026-09-01T10:00:00Z"), Message("new", "c", "2026-10-04T10:00:00Z")], []);
        Assert.Equal(new[] { "c", "b", "a" }, views.Select(v => v.Primary.Id));
    }
}
