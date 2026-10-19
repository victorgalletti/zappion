// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

// Mirrors the approval cases in web/lib/messages.test.ts and web/components/message-bubble.test.tsx.
public class MessageApprovalsTests
{
    private const string At = "2026-10-16T18:00:00Z";

    [Theory]
    [InlineData("{awaiting_approval:'" + At + "'}", true)]
    [InlineData("{awaiting_approval:'" + At + "', approved:'" + At + "'}", false)]
    [InlineData("{awaiting_approval:'" + At + "', rejected:'" + At + "'}", false)]
    [InlineData("{awaiting_approval:'" + At + "', pending:'" + At + "'}", false)]
    [InlineData("{awaiting_approval:null}", false)]
    [InlineData("{pending:'" + At + "'}", false)]
    [InlineData("{}", false)]
    public void AwaitingApprovalNeedsTheHoldAndNoDecisionOrQueue(string status, bool expected) =>
        Assert.Equal(expected, MessageApprovals.IsAwaitingApproval(JObject.Parse(status)));

    [Fact]
    public void NullStatusIsNotHeld() => Assert.False(MessageApprovals.IsAwaitingApproval((JObject?)null));

    [Theory]
    [InlineData("{awaiting_approval:'" + At + "'}", "awaiting_approval")]
    [InlineData("{awaiting_approval:'" + At + "', rejected:'" + At + "'}", "rejected")]
    [InlineData("{awaiting_approval:'" + At + "', approved:'" + At + "', pending:'" + At + "'}", "sending")]
    [InlineData("{awaiting_approval:'" + At + "', approved:'" + At + "', pending:'" + At + "', sent:'" + At + "'}", "sent")]
    [InlineData("{awaiting_approval:'" + At + "', approved:'" + At + "', pending:'" + At + "', read:'" + At + "'}", "read")]
    [InlineData("{awaiting_approval:'" + At + "', approved:'" + At + "', failed:'" + At + "'}", "failed")]
    [InlineData("{rejected:'" + At + "', failed:'" + At + "'}", "failed")]
    public void DeliveryStateShowsHeldAndRejectedBeforeTicks(string status, string expected) =>
        Assert.Equal(expected, ChatHelpers.DeliveryState(JObject.Parse(status)));

    [Fact]
    public void OnlyOutgoingRowsAreHeld()
    {
        var status = JObject.Parse("{awaiting_approval:'" + At + "'}");
        Assert.True(MessageApprovals.IsAwaitingApproval(new MessageRow { SenderAddress = null, Status = status }));
        Assert.False(MessageApprovals.IsAwaitingApproval(new MessageRow { SenderAddress = "5511999999999", Status = status }));
    }

    [Fact]
    public void WaitingLabelNamesTheKeyOnceLoaded()
    {
        Assert.Equal("Waiting for approval · Sales bot", MessageApprovals.WaitingLabel("Sales bot"));
        Assert.Equal("Waiting for approval", MessageApprovals.WaitingLabel(null));
        Assert.Equal("Waiting for approval", MessageApprovals.WaitingLabel(" "));
    }

    [Fact]
    public void ConversationMarkersCoverEveryMergedMember()
    {
        var approvals = new[]
        {
            new MessageApprovalRow { MessageId = "m1", ConversationId = "c2" },
            new MessageApprovalRow { MessageId = "m2", ConversationId = "c3", Decision = "approved" },
        };
        var ids = MessageApprovals.ConversationIds(approvals);
        Assert.Equal(new[] { "c2" }, ids);
        var merged = new ConversationView(new ConversationRow { Id = "c1" }, new[] { "c1", "c2" }, "Ana", null);
        var other = new ConversationView(new ConversationRow { Id = "c3" }, new[] { "c3" }, "Bia", null);
        Assert.True(MessageApprovals.AnyWaiting(merged, ids));
        Assert.False(MessageApprovals.AnyWaiting(other, ids));
    }

    [Theory]
    [InlineData(1, "1")]
    [InlineData(99, "99")]
    [InlineData(100, "99+")]
    public void BadgeCapsAtNinetyNine(int count, string expected) => Assert.Equal(expected, MessageApprovals.Badge(count));

    [Fact]
    public void RpcErrorsSurfaceAsRaised()
    {
        var wrapped = new Exception("{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"the 24-hour service window is closed\"}");
        Assert.Equal("the 24-hour service window is closed", MessageApprovals.ErrorMessage(wrapped));
        Assert.Equal("network down", MessageApprovals.ErrorMessage(new Exception("network down")));
    }
}
