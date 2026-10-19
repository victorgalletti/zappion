// SPDX-License-Identifier: AGPL-3.0-only
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class NewConversationTests
{
    [Theory]
    [InlineData("+55 (61) 99999-9999", "5561999999999", true)]
    [InlineData("123456789", "123456789", false)]
    [InlineData("abcdefghij", "", false)]
    [InlineData("??????????", "", false)]
    public void MatchesWebValidation(string input, string expected, bool valid)
    {
        Assert.Equal(expected, NewConversation.Normalize(input));
        Assert.Equal(valid, NewConversation.CanOpen(input, "business"));
        Assert.False(NewConversation.CanOpen(input, ""));
    }

    [Fact]
    public void ReusesNinthDigitMatchOnlyOnChosenBusinessNumber()
    {
        var existing = new ConversationView(new ConversationRow { Id = "row", Address = "556199887766", OrganizationAddress = "business" }, ["row"], "Contact", null);
        Assert.Same(existing, NewConversation.Open([existing], "org", "+55 61 99988-7766", "business"));
        var draft = NewConversation.Open([existing], "org", "+55 61 99988-7766", "other");
        Assert.True(NewConversation.IsDraft(draft));
        Assert.Empty(draft.Primary.Id);
        Assert.Empty(draft.MemberIds);
        Assert.Equal("5561999887766", draft.Primary.Address);
        Assert.Equal("other", draft.Primary.OrganizationAddress);
        Assert.False(NewConversation.SameChat(draft, NewConversation.Open([], "org", "12025550198", "other")));
        Assert.True(NewConversation.SameChat(draft, NewConversation.Open([], "org", "+55 61 99988-7766", "other")));
        Assert.False(NewConversation.SameChat(draft, NewConversation.Open([], "org", "+55 61 99988-7766", "business")));
        Assert.False(NewConversation.SameChat(draft, null));
        Assert.False(ServiceWindow.FromIncoming(null, DateTimeOffset.UtcNow).Open);
    }
}
