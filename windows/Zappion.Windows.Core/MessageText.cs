// SPDX-License-Identifier: AGPL-3.0-only
using System.Text.RegularExpressions;

namespace Zappion.Windows.Core;

public sealed record TextRun(string Text, bool Bold = false, bool Italic = false, bool Strike = false,
    bool Mono = false, string? Href = null);

public static class MessageText
{
    // WhatsApp emphasis boundaries follow web/lib/markdown.ts; URLs mirror web/lib/linkify.ts.
    public static IReadOnlyList<TextRun> Parse(string text) => ParsePart(text, new TextRun(""));

    private static List<TextRun> ParsePart(string text, TextRun style)
    {
        var result = new List<TextRun>();
        var pattern = @"```[\s\S]*?```|`[^`\n]+`|(?<![\p{L}\p{N}*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_([^\s_](?:[^_\n]*?[^\s_])?)_(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}~])~([^\s~](?:[^~\n]*?[^\s~])?)~(?![\p{L}\p{N}~])";
        var offset = 0;
        foreach (Match match in Regex.Matches(text, pattern))
        {
            AddLinks(result, text[offset..match.Index], style);
            var token = match.Value;
            if (token[0] == '`')
            {
                var length = token.StartsWith("```", StringComparison.Ordinal) ? 3 : 1;
                result.Add(style with { Text = token[length..^length], Mono = true });
            }
            else result.AddRange(ParsePart(token[1..^1], style with
            {
                Bold = style.Bold || token[0] == '*', Italic = style.Italic || token[0] == '_',
                Strike = style.Strike || token[0] == '~'
            }));
            offset = match.Index + match.Length;
        }
        AddLinks(result, text[offset..], style);
        return result;
    }

    private static void AddLinks(List<TextRun> result, string text, TextRun style)
    {
        var offset = 0;
        foreach (Match match in Regex.Matches(text, "https?://[^\\s<>\"'`]+", RegexOptions.IgnoreCase))
        {
            var url = match.Value;
            while (url.Length > 0 && (".,;:!]}".Contains(url[^1]) || (url[^1] == ')' && !url.Contains('(')))) url = url[..^1];
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host)) continue;
            if (match.Index > offset) result.Add(style with { Text = text[offset..match.Index] });
            result.Add(style with { Text = url, Href = uri.AbsoluteUri });
            offset = match.Index + url.Length;
        }
        if (offset < text.Length) result.Add(style with { Text = text[offset..] });
    }
}
