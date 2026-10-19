// SPDX-License-Identifier: AGPL-3.0-only
using System.Security;

namespace Zappion.Windows.Core;

public sealed record NotificationDecision(bool Toast, bool Sound, string Body);

// Mirrors web/hooks/use-message-notifications.ts. Desktop also alerts for a different open chat.
public sealed class MessageNotifications
{
    public const string ToastGroup = "messages";
    private readonly DateTimeOffset startedAt;
    private readonly HashSet<string> seen = new();
    private readonly Queue<string> seenOrder = new();
    private DateTimeOffset? lastSound;

    public MessageNotifications(DateTimeOffset startedAt) => this.startedAt = startedAt;

    public NotificationDecision Evaluate(MessageRow message, string organizationId, bool foreground,
        IReadOnlyList<string> openIds, DateTimeOffset now)
    {
        var content = message.Content;
        if (message.OrganizationId != organizationId || message.Service != "whatsapp" ||
            string.IsNullOrEmpty(message.ConversationId) || string.IsNullOrEmpty(message.SenderAddress) ||
            !MessageHelpers.IsRenderable(message) || content is null ||
            !(new[] { "text", "file" }.Contains((string?)content["type"]) ||
              new[] { "template", "location", "contacts" }.Contains((string?)content["kind"])) ||
            !DateTimeOffset.TryParse(message.Timestamp, out var at) || at < startedAt || !seen.Add(message.Id))
            return new(false, false, "");
        seenOrder.Enqueue(message.Id);
        if (seenOrder.Count > 1000) seen.Remove(seenOrder.Dequeue());
        var alert = !(foreground && openIds.Contains(message.ConversationId));
        var sound = alert && (lastSound is null || now - lastSound >= TimeSpan.FromSeconds(2));
        if (sound) lastSound = now;
        return new(alert, sound, PreviewLine(message));
    }

    public static string PreviewLine(MessageRow message)
    {
        var preview = MessageHelpers.Preview(message);
        var icon = preview.Icon switch
        {
            "voice" => "\uD83C\uDFA4", "image" => "\uD83D\uDCF7", "video" => "\uD83C\uDFA5",
            "document" => "\uD83D\uDCC4", "sticker" => "\uD83C\uDFF7\uFE0F", "template" => "\uD83D\uDCCB",
            "location" => "\uD83D\uDCCD", "contact" => "\uD83D\uDC64", _ => ""
        };
        return (icon.Length == 0 ? "" : icon + " ") + preview.Text;
    }

    public static string ToastTag(string conversationId)
    {
        var trimmed = (conversationId ?? "").Trim();
        return trimmed.Length <= 64 ? trimmed : trimmed[..64];
    }

    public static string BuildToastXml(string conversationId, string title, string body)
    {
        var launch = SecurityElement.Escape("conversation=" + Uri.EscapeDataString(conversationId ?? ""));
        var safeTitle = SecurityElement.Escape(title ?? "");
        var safeBody = SecurityElement.Escape(body ?? "");
        return $"<toast launch=\"{launch}\"><visual><binding template=\"ToastGeneric\"><text>{safeTitle}</text><text>{safeBody}</text></binding></visual><audio silent=\"true\"/></toast>";
    }

    public static bool TryParseConversation(string? arguments, out string conversationId)
    {
        conversationId = "";
        if (string.IsNullOrWhiteSpace(arguments)) return false;
        foreach (var token in arguments.Split([' ', '\t', '&', ';'], StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = token.Trim().Trim('"');
            const string prefix = "conversation=";
            const string flagPrefix = "--conversation=";
            var raw = trimmed.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? trimmed[prefix.Length..]
                : trimmed.StartsWith(flagPrefix, StringComparison.OrdinalIgnoreCase) ? trimmed[flagPrefix.Length..]
                : null;
            if (string.IsNullOrWhiteSpace(raw)) continue;
            conversationId = Uri.UnescapeDataString(raw.Trim().Trim('"'));
            return conversationId.Length > 0;
        }
        return false;
    }

    public static bool TryParseConversation(IEnumerable<string> args, out string conversationId)
    {
        conversationId = "";
        var list = args.ToArray();
        for (var i = 0; i < list.Length; i++)
        {
            if (TryParseConversation(list[i], out conversationId)) return true;
            if (string.Equals(list[i], "--conversation", StringComparison.OrdinalIgnoreCase) &&
                i + 1 < list.Length && !string.IsNullOrWhiteSpace(list[i + 1]))
            {
                conversationId = Uri.UnescapeDataString(list[i + 1].Trim().Trim('"'));
                return conversationId.Length > 0;
            }
        }
        return false;
    }
}

