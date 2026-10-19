// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class WebPresentationTests
{
    [Theory]
    [InlineData("Ana Souza", "AS")]
    [InlineData(" Ana Maria ", "AM")]
    [InlineData("!!!", "#")]
    [InlineData("André", "A")]
    public void InitialsMatchWeb(string name, string expected) => Assert.Equal(expected, WebPresentation.Initials(name));

    [Fact]
    public void AvatarHashUsesSignedJavascriptOverflow()
    {
        Assert.Equal("#00a884", WebPresentation.AvatarColor("551199887766"));
        Assert.Equal(WebPresentation.AvatarColor("repeat"), WebPresentation.AvatarColor("repeat"));
    }

    [Fact]
    public void PortugueseResourcesAndRelativeDatesFollowCulture()
    {
        var culture = CultureInfo.CurrentCulture;
        var ui = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("pt-BR");
            var today = DateTimeOffset.Now;
            Assert.Equal("Hoje", WebPresentation.DayLabel(today.ToString("O"), today));
            Assert.Equal("Ontem", WebPresentation.ListTime(today.AddDays(-1).ToString("O"), today));
            Assert.Equal(today.ToString("HH:mm"), WebPresentation.ListTime(today.ToString("O"), today));
            Assert.Equal("Foto", MessageHelpers.Preview(new MessageRow { Content = Newtonsoft.Json.Linq.JObject.Parse("{type:'file',kind:'image'}") }).Text);
            Assert.Equal("Conversas", UiStrings.Get("Chats"));
        }
        finally { CultureInfo.CurrentCulture = culture; CultureInfo.CurrentUICulture = ui; }
    }

    [Fact]
    public void SearchFiltersNamePhoneAndUnread()
    {
        var row = new ConversationView(new ConversationRow { Address = "551199887766" }, ["c"], "Ana Souza", null, 2);
        Assert.True(WebPresentation.Matches(row, "SOUZA", false));
        Assert.True(WebPresentation.Matches(row, "99887766", true));
        Assert.True(WebPresentation.Matches(row, "(11) 9988-7766", false));
        Assert.False(WebPresentation.Matches(row with { Unread = 0 }, "Victor", true));
        Assert.False(WebPresentation.Matches(row, "missing", false));
    }

    [Fact]
    public void GroupingRestartsOnSideChangeAndDateBoundary()
    {
        var timeline = new MessageTimeline();
        MessageRow Row(string id, string at, string? sender) => new() { Id = id, Timestamp = at, SenderAddress = sender, Content = Newtonsoft.Json.Linq.JObject.Parse("{type:'text',text:'hello'}") };
        timeline.Apply([Row("a", "2026-10-15T12:00:00Z", null), Row("b", "2026-10-15T12:01:00Z", null), Row("c", "2026-10-15T12:02:00Z", "contact"), Row("d", "2026-10-16T12:00:00Z", "contact")]);
        Assert.Equal(new[] { true, false, true, true }, timeline.Items.Where(i => i.Message is not null).Select(i => i.Tail));
    }

    [Fact]
    public void JoinSerializationCarriesCurrentTokenIncludingRefresh()
    {
        const string join = "{\"event\":\"phx_join\",\"topic\":\"org:test\",\"payload\":{\"config\":{\"postgres_changes\":[]}}}";
        var encoded = Newtonsoft.Json.Linq.JObject.Parse(RealtimeJoinEncoder.Authorize(join, "synthetic-user-jwt"));
        Assert.Equal("synthetic-user-jwt", (string?)encoded["payload"]!["access_token"]);
        Assert.NotNull(encoded["payload"]!["config"]);
        var refreshed = Newtonsoft.Json.Linq.JObject.Parse(RealtimeJoinEncoder.Authorize(join, "refreshed-synthetic-jwt"));
        Assert.Equal("refreshed-synthetic-jwt", (string?)refreshed["payload"]!["access_token"]);
        const string heartbeat = "{\"event\":\"heartbeat\",\"payload\":{}}";
        Assert.Equal(heartbeat, RealtimeJoinEncoder.Authorize(heartbeat, "synthetic-user-jwt"));
    }
}
