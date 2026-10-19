// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ChatHelpersTests
{
    private static JObject Fixtures()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var path = Path.Combine(directory.FullName, "api", "supabase", "functions", "_shared", "zappion_markdown_fixtures.json");
            if (File.Exists(path)) return JObject.Parse(File.ReadAllText(path));
            directory = directory.Parent;
        }
        throw new FileNotFoundException("Shared Markdown fixtures were not found in the repository.");
    }

    [Fact]
    public void LineBreaksFromTheTextBoxBecomeNewlines()
    {
        Assert.Equal("aa\n\n\naa", ChatHelpers.NormalizeLineBreaks("aa\r\r\raa"));
        Assert.Equal("a\nb\nc", ChatHelpers.NormalizeLineBreaks("a\r\nb\nc"));
    }

    [Fact]
    public void ListPreviewIsOneLine()
    {
        Assert.Equal("aa aa", ChatHelpers.SingleLine("aa\r\r\r\n  aa\n"));
    }

    [Fact]
    public void BothDirectionsMatchSharedFixtures()
    {
        var fixtures = Fixtures();
        foreach (var pair in fixtures["markdownToWhatsApp"]!)
            Assert.Equal((string?)pair[1], MessageHelpers.MarkdownToWhatsApp((string)pair[0]!));
        foreach (var pair in fixtures["whatsappToMarkdown"]!)
            Assert.Equal((string?)pair[1], ChatHelpers.WhatsAppToMarkdown((string)pair[0]!));
        foreach (var input in fixtures["roundTrip"]!.Values<string>())
            Assert.Equal(input, MessageHelpers.MarkdownToWhatsApp(ChatHelpers.WhatsAppToMarkdown(input!)));
    }

    [Theory]
    [InlineData("text", "text", true)]
    [InlineData("file", "image", true)]
    [InlineData("file", "video", true)]
    [InlineData("file", "document", true)]
    [InlineData("file", "audio", false)]
    [InlineData("data", "template", false)]
    public void StoredContentConvertsOnlyFormattedTypes(string type, string kind, bool converted)
    {
        var content = new JObject { ["type"] = type, ["kind"] = kind, ["text"] = "*bold*" };
        Assert.Equal(converted ? "**bold**" : "*bold*", (string?)ChatHelpers.ToStoredContent(content)["text"]);
        Assert.Equal("*bold*", (string?)content["text"]);
    }

    [Theory]
    [InlineData("{}", "sending")]
    [InlineData("{accepted:'now'}", "sent")]
    [InlineData("{sent:'now',delivered:'now'}", "delivered")]
    [InlineData("{delivered:'now',read:'now'}", "read")]
    [InlineData("{failed:'now',read:'now'}", "failed")]
    public void DeliveryPrecedenceMatchesWeb(string json, string expected) =>
        Assert.Equal(expected, ChatHelpers.DeliveryState(JObject.Parse(json)));

    [Fact]
    public void FailureDetailsWinOverMessage()
    {
        Assert.Equal("details", ChatHelpers.FailureReason(JObject.Parse("{errors:[{error:{message:'message',error_data:{details:'details'}}}]}")));
        Assert.Equal("message", ChatHelpers.FailureReason(JObject.Parse("{errors:[{error:{message:'message'}}]}")));
        Assert.Null(ChatHelpers.FailureReason(null));
    }

    [Fact]
    public void RichTextPreservesLiteralsAndNestedStyles()
    {
        var runs = MessageText.Parse("*bold _italic_* ~gone~ `*code*` a_b.pdf 2*3*4");
        Assert.Contains(runs, r => r.Text == "italic" && r.Bold && r.Italic);
        Assert.Contains(runs, r => r.Text == "gone" && r.Strike);
        Assert.Contains(runs, r => r.Text == "*code*" && r.Mono && !r.Bold);
        Assert.Equal("bold italic gone *code* a_b.pdf 2*3*4", string.Concat(runs.Select(r => r.Text)));
    }

    [Fact]
    public void LinkBoundariesPreserveTrailingPunctuation()
    {
        const string input = "See https://example.com/a(b), https://example.com/path). javascript:alert(1)";
        var runs = MessageText.Parse(input);
        Assert.Equal(input, string.Concat(runs.Select(r => r.Text)));
        Assert.Equal(new[] { "https://example.com/a(b)", "https://example.com/path" }, runs.Where(r => r.Href is not null).Select(r => r.Text));
    }
}
