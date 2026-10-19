// SPDX-License-Identifier: AGPL-3.0-only
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

public static class ChatHelpers
{
    // WinUI text boxes break lines with a bare \r, which WhatsApp drops; store \n like the web composer.
    public static string NormalizeLineBreaks(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    // List rows show one line, like the web's truncated preview, which collapses whitespace.
    public static string SingleLine(string text) => Regex.Replace(text, @"\s+", " ").Trim();

    // Mirrors web/lib/markdown.ts, including the boundaries and code-span protection.
    public static string WhatsAppToMarkdown(string text) => string.Concat(
        Regex.Split(text, @"(`{3}[\s\S]*?`{3})").Select(block => block.StartsWith("```", StringComparison.Ordinal)
            ? block : string.Concat(Regex.Split(block, @"(`[^`\n]+`)").Select(part =>
                part.StartsWith('`') ? part : ConvertMarker(ConvertMarker(part, '*'), '~')))));

    private static string ConvertMarker(string text, char marker)
    {
        var m = Regex.Escape(marker.ToString());
        var pattern = $@"(^|[^\p{{L}}\p{{N}}{m}]){m}([^\s{m}](?:[^{m}\n]*?[^\s{m}])?){m}(?=$|[^\p{{L}}\p{{N}}{m}])";
        string previous;
        do
        {
            previous = text;
            text = Regex.Replace(text, pattern, match => match.Groups[1].Value + new string(marker, 2) + match.Groups[2].Value + new string(marker, 2), RegexOptions.Multiline);
        } while (text != previous);
        return text;
    }

    public static JObject ToStoredContent(JObject content)
    {
        var result = (JObject)content.DeepClone();
        // Text messages and image/video/document captions are the formatted content types.
        if (result["text"]?.Type == JTokenType.String &&
            (((string?)result["type"] == "text" && (string?)result["kind"] == "text") ||
             ((string?)result["type"] == "file" && new[] { "image", "video", "document" }.Contains((string?)result["kind"]))))
            result["text"] = WhatsAppToMarkdown((string)result["text"]!);
        return result;
    }

    // Mirrors web/lib/messages.ts. Failure takes precedence over every success state; a held
    // message (rejected or waiting for approval) never reached WhatsApp.
    public static string DeliveryState(JObject? status)
    {
        if (MessageApprovals.Has(status, "failed")) return "failed";
        if (MessageApprovals.Has(status, "rejected")) return "rejected";
        if (MessageApprovals.IsAwaitingApproval(status)) return "awaiting_approval";
        foreach (var state in new[] { "read", "delivered", "sent", "accepted" })
            if (MessageApprovals.Has(status, state)) return state == "accepted" ? "sent" : state;
        return "sending";
    }

    public static string? FailureReason(JObject? status) =>
        (string?)status?["errors"]?.First?["error"]?["error_data"]?["details"] ??
        (string?)status?["errors"]?.First?["error"]?["message"];
}
