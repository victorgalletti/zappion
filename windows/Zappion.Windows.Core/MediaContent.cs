// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

// Mirrors web/lib/messages.ts, types.ts and components/media-preview.tsx/composer.tsx.
public static class MediaContent
{
    public const string OpusMime = "audio/ogg; codecs=opus";
    // Mirrors web/components/message-bubble.tsx: 330 px wide, max-h-80,
    // with the 200 px loading preview used when dimensions are unavailable.
    public static double PreviewHeight(JObject file, double width, bool sticker = false)
    {
        var sourceWidth = (double?)file["width"] ?? 0;
        var sourceHeight = (double?)file["height"] ?? 0;
        var limit = sticker ? 160 : 320;
        return sourceWidth > 0 && sourceHeight > 0 && double.IsFinite(sourceWidth) && double.IsFinite(sourceHeight)
            ? Math.Min(limit, width * sourceHeight / sourceWidth) : sticker ? 160 : 200;
    }
    public static JObject? FileOf(JObject? content) => (string?)content?["type"] == "file" ? content["file"] as JObject : null;
    public static string? StoragePath(string uri) => uri.StartsWith("internal://media/", StringComparison.Ordinal) ? uri[17..] : null;
    public static string Kind(string mime) => mime.StartsWith("image/", StringComparison.Ordinal) ? "image"
        : mime.StartsWith("video/", StringComparison.Ordinal) ? "video" : mime.StartsWith("audio/", StringComparison.Ordinal) ? "audio" : "document";
    public static long Limit(string mime) => Kind(mime) switch { "image" => 5_000_000, "video" or "audio" => 16_000_000, _ => 100_000_000 };
    public static void Validate(string mime, long size)
    {
        if (size <= 0) throw new InvalidOperationException(UiStrings.Get("EmptyFile"));
        if (size > Limit(mime)) throw new InvalidOperationException(string.Format(UiStrings.Get("FileTooLarge"), FormatSize(size), FormatSize(Limit(mime))));
    }
    public static string FormatSize(long size) => size < 1024 * 1024 ? $"{Math.Round(size / 1024d)} KB" : $"{size / 1024d / 1024:F1} MB";
    public static string FileName(JObject file)
    {
        if ((string?)file["name"] is { Length: > 0 } name) return Path.GetFileName(name);
        var extension = ((string?)file["mime_type"])?.Split(';')[0].Trim().ToLowerInvariant() switch
        {
            "image/jpeg" => ".jpg", "image/png" => ".png", "image/webp" => ".webp", "image/gif" => ".gif",
            "video/mp4" => ".mp4", "video/3gpp" => ".3gp", "audio/ogg" or "audio/opus" => ".ogg",
            "audio/mpeg" => ".mp3", "audio/mp4" => ".m4a", "audio/webm" => ".webm", "application/pdf" => ".pdf", _ => ".bin"
        };
        return UiStrings.Get("Document") + extension;
    }
    public static JObject Create(string path, string mime, long size, string name, string? caption = null, double? duration = null)
    {
        Validate(mime, size);
        var file = new JObject { ["uri"] = $"internal://media/{path}", ["mime_type"] = mime, ["size"] = size, ["name"] = name };
        if (duration is not null) file["duration"] = duration;
        var content = new JObject { ["version"] = "1", ["type"] = "file", ["kind"] = Kind(mime), ["file"] = file };
        if (!string.IsNullOrWhiteSpace(caption)) content["text"] = caption.Trim();
        return ChatHelpers.ToStoredContent(content);
    }
}
