// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

// Mirrors web/components/chat-room.tsx and message-list.tsx. Targets are WhatsApp external IDs.
public static class MessageInteractions
{
    public static readonly string[] QuickReactions = ["\U0001f44d", "\u2764\ufe0f", "\U0001f602", "\U0001f62e", "\U0001f622", "\U0001f64f"];
    public static JObject WithReply(JObject content, MessageRow? quoted)
    {
        var result = (JObject)content.DeepClone();
        if (!string.IsNullOrEmpty(quoted?.ExternalId)) result["re_message_id"] = quoted.ExternalId;
        return result;
    }
    public static JObject Reaction(IEnumerable<MessageRow> messages, string externalId, string emoji)
    {
        var mine = messages.OrderBy(m => m.Timestamp, StringComparer.Ordinal).LastOrDefault(m =>
            string.IsNullOrEmpty(m.SenderAddress) && (string?)m.Content?["kind"] == "reaction" && (string?)m.Content?["re_message_id"] == externalId);
        var remove = (string?)mine?.Content?["data"]?["action"] == "added" && (string?)mine.Content?["data"]?["unicode"] == emoji;
        return new JObject { ["version"] = "1", ["type"] = "data", ["kind"] = "reaction", ["re_message_id"] = externalId,
            ["data"] = remove ? new JObject { ["action"] = "removed" } : new JObject { ["action"] = "added", ["unicode"] = emoji, ["name"] = emoji } };
    }
    public static IReadOnlyDictionary<string, string> Reactions(IEnumerable<MessageRow> messages, string? externalId)
    {
        var people = new Dictionary<string, string>();
        if (string.IsNullOrEmpty(externalId)) return people;
        foreach (var m in messages.OrderBy(m => m.Timestamp, StringComparer.Ordinal))
        {
            if ((string?)m.Content?["kind"] != "reaction" || (string?)m.Content?["re_message_id"] != externalId) continue;
            var who = m.SenderAddress ?? "me";
            if ((string?)m.Content?["data"]?["action"] == "removed" || (string?)m.Content?["data"]?["unicode"] is not { Length: > 0 } emoji) people.Remove(who);
            else people[who] = emoji;
        }
        return people;
    }
}
