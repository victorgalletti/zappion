// SPDX-License-Identifier: AGPL-3.0-only
using Xunit;
using Newtonsoft.Json.Linq;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

// Mirrors web/lib/media-library.ts and the query in web/hooks/use-media-library.ts.
public class MediaLibraryTests
{
    private static MessageRow Row(string id, string timestamp, JObject content, string? sender = null) =>
        new() { Id = id, Timestamp = timestamp, Content = content, SenderAddress = sender };

    [Theory]
    [InlineData("image/png", MediaTab.Media)]
    [InlineData("VIDEO/mp4", MediaTab.Media)]
    [InlineData("application/pdf", MediaTab.Docs)]
    [InlineData("audio/ogg", MediaTab.Docs)]
    [InlineData(null, MediaTab.Docs)]
    public void ClassifiesLikeTheWeb(string? mime, MediaTab expected) => Assert.Equal(expected, MediaLibrary.Classify(mime));

    [Fact]
    public void ExtractsLinksTrimmingPunctuationAndUnbalancedParentheses()
    {
        var links = MediaLibrary.ExtractLinks("See https://example.com/a. and (www.test.org/x) or https://wiki.org/A_(b)) end");
        Assert.Equal(["https://example.com/a", "https://www.test.org/x", "https://wiki.org/A_(b)"], links.Select(l => l.Url));
        Assert.Equal("www.test.org", links[1].Domain);
        Assert.Empty(MediaLibrary.ExtractLinks("ftp://nope.com and http://localhost"));
    }

    [Fact]
    public void TabOfRecognizesFilesAndLinks()
    {
        Assert.Equal(MediaTab.Media, MediaLibrary.TabOf(Row("1", "", new JObject { ["type"] = "file", ["file"] = new JObject { ["mime_type"] = "image/jpeg" } })));
        Assert.Equal(MediaTab.Links, MediaLibrary.TabOf(Row("2", "", new JObject { ["type"] = "text", ["text"] = "go to https://a.com" })));
        Assert.Null(MediaLibrary.TabOf(Row("3", "", new JObject { ["type"] = "text", ["text"] = "hello" })));
    }

    [Fact]
    public void GroupsByTodayWeekPreviousAndMonth()
    {
        // Thursday 2026-10-15 noon, local time.
        var now = new DateTimeOffset(2026, 10, 15, 12, 0, 0, TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026, 10, 15)));
        string At(int days) => now.AddDays(days).ToUniversalTime().ToString("o");
        var rows = new[] { Row("a", At(0), []), Row("b", At(-2), []), Row("c", At(-5), []), Row("d", At(-40), []) };
        var groups = MediaLibrary.Group(rows, now);
        Assert.Equal(["today", "week", "previous", "2026-9"], groups.Select(g => g.Key));
        Assert.All(groups, g => Assert.Single(g.Rows));
    }

    [Fact]
    public void FormatsBytes()
    {
        Assert.Equal("512 B", MediaLibrary.FormatBytes(512));
        Assert.Contains("KB", MediaLibrary.FormatBytes(6_758));
        Assert.Contains("MB", MediaLibrary.FormatBytes(3_500_000));
    }

    [Fact]
    public void QueryFiltersByTabAndPagesWithCursor()
    {
        var media = Uri.UnescapeDataString(MediaLibrary.Query("org", new MediaFilters(MediaTab.Media), null));
        Assert.Contains("content->>type=eq.file", media);
        Assert.Contains("or=(content->file->>mime_type.ilike.image/*,content->file->>mime_type.ilike.video/*)", media);
        Assert.Contains("order=timestamp.desc,id.desc", media);
        Assert.Contains("limit=60", media);

        var links = Uri.UnescapeDataString(MediaLibrary.Query("org", new MediaFilters(MediaTab.Links, Sender: "team"), new MediaCursor("2026-10-15T10:00:00Z", "id9")));
        Assert.Contains("content->>type=eq.text", links);
        Assert.Contains("sender_address=is.null", links);
        Assert.Contains("or=(timestamp.lt.2026-10-15T10:00:00Z,and(timestamp.eq.2026-10-15T10:00:00Z,id.lt.id9))", links);
    }

    [Fact]
    public void SearchTextIsQuotedAndEscaped()
    {
        var query = Uri.UnescapeDataString(MediaLibrary.Query("org", new MediaFilters(MediaTab.Docs, Search: "50%_off,\"x\")", MatchingAddresses: ["5511"]), null));
        Assert.Contains("content->>text.ilike.\"%50\\\\%\\\\_off,\\\"x\\\")%\"", query);
        Assert.Contains("conversation_address.in.(\"5511\")", query);
    }

    [Fact]
    public void ForwardReusesFilesAndResendsText()
    {
        var file = Row("f", "", new JObject { ["type"] = "file", ["kind"] = "image", ["text"] = "cap", ["file"] = new JObject { ["uri"] = "internal://media/x" } });
        var forwarded = MediaLibrary.ForwardContent(file);
        Assert.Equal("internal://media/x", (string?)forwarded["file"]?["uri"]);
        Assert.Equal("cap", (string?)forwarded["text"]);
        var text = MediaLibrary.ForwardContent(Row("t", "", new JObject { ["type"] = "text", ["text"] = "https://a.com" }));
        Assert.Equal("text", (string?)text["kind"]);
    }
}
