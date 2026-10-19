// SPDX-License-Identifier: AGPL-3.0-only
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

public sealed record MessagePreview(string Text, string? Icon = null);

public static class MessageHelpers
{
    public static string PhoneKey(string address)
    {
        var digits = Regex.Replace(address, "[^0-9]", "");
        var mobile = Regex.Match(digits, @"^55([0-9]{2})9?([6-9][0-9]{7})$");
        return mobile.Success ? $"55{mobile.Groups[1]}{mobile.Groups[2]}" : digits.Length > 0 ? digits : address;
    }

    public static string FormatPhone(string address)
    {
        var digits = Regex.Replace(address, "[^0-9]", "");
        var br = Regex.Match(digits, @"^55([0-9]{2})(9?)([0-9]{4})([0-9]{4})$");
        if (!br.Success) return digits.Length > 6 ? $"+{digits}" : address;
        var nine = br.Groups[2].Value;
        if (nine.Length == 0 && br.Groups[3].Value[0] is >= '6' and <= '9') nine = "9";
        return $"+55 {br.Groups[1]} {nine}{br.Groups[3]}-{br.Groups[4]}";
    }

    // Null-coalescing is intentional: an explicitly empty synced name wins.
    public static string? ContactName(JObject? extra) =>
        (string?)(extra?["synced"] as JObject)?["name"] ?? (string?)extra?["saved_name"] ?? (string?)extra?["name"];

    public static bool IsRenderable(MessageRow message)
    {
        var c = message.Content;
        if (c is null || (string?)c["kind"] == "reaction") return false;
        if ((string?)c["type"] == "text" && c.TryGetValue("text", out var text))
            return text.Type != JTokenType.Null && text.ToString().Length > 0 &&
                !(text.Type == JTokenType.Boolean && !text.Value<bool>());
        return true;
    }

    public static MessagePreview Preview(MessageRow? message)
    {
        var c = message?.Content;
        if (c is null) return new("");
        var text = c["text"];
        if ((string?)c["type"] == "text" && c.ContainsKey("text"))
            return new(MarkdownToWhatsApp(text?.Type == JTokenType.Null ? "null" : text?.ToString() ?? ""));
        var kind = (string?)c["kind"];
        if ((string?)c["type"] == "file")
        {
            var caption = text?.Type == JTokenType.String ? MarkdownToWhatsApp(text.Value<string>() ?? "") : "";
            var file = c["file"] as JObject;
            var duration = (double?)file?["duration"];
            var clock = duration is null or 0 ? "" : $" ({Math.Floor(duration.Value / 60)}:{(int)Math.Floor(duration.Value + 0.5) % 60:00})";
            return kind switch
            {
                "audio" => new($"{UiStrings.Get("VoiceMessage")}{clock}", "voice"),
                "image" => new(caption.Length > 0 ? caption : UiStrings.Get("Photo"), "image"),
                "video" => new(caption.Length > 0 ? caption : UiStrings.Get("Video"), "video"),
                "sticker" => new(UiStrings.Get("Sticker"), "sticker"),
                _ => new(caption.Length > 0 ? caption : (string?)file?["name"] ?? UiStrings.Get("Document"), "document")
            };
        }
        return kind switch
        {
            "template" => new((string?)(c["data"] as JObject)?["name"] ?? UiStrings.Get("Template"), "template"),
            "location" => new(UiStrings.Get("Location"), "location"),
            "contacts" => new(UiStrings.Get("Contact"), "contact"),
            _ => new(text?.Type == JTokenType.String ? text.Value<string>() ?? "" : UiStrings.Get("Message"))
        };
    }

    public static string MarkdownToWhatsApp(string text)
    {
        // Preserve fenced and inline code, matching the web conversion boundary.
        return string.Concat(Regex.Split(text, @"(`{3}[\s\S]*?`{3})").Select(block =>
            block.StartsWith("```", StringComparison.Ordinal) ? block : string.Concat(
                Regex.Split(block, @"(`[^`\n]+`)").Select(part => part.StartsWith('`') ? part : ConvertMarkdown(part)))));
    }

    private static string ConvertMarkdown(string text)
    {
        text = Regex.Replace(text, @"^#+\s+(.*)$", "\u0002$1\u0002", RegexOptions.Multiline);
        text = Regex.Replace(text, @"\*\*(?![\s*])(.+?)(?<![\s*])\*\*", "\u0002$1\u0002");
        text = Regex.Replace(text, @"__(?![\s_])(.+?)(?<![\s_])__", "\u0002$1\u0002");
        const string italic = @"(^|[^\p{L}\p{N}*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?=$|[^\p{L}\p{N}*])";
        string previous;
        do
        {
            previous = text;
            text = Regex.Replace(text, italic, "$1_$2_", RegexOptions.Multiline);
        } while (previous != text);
        text = Regex.Replace(text, @"~~(?![\s~])(.+?)(?<![\s~])~~", "~$1~");
        return text.Replace('\u0002', '*');
    }
}
