// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using System.Text.RegularExpressions;

namespace Zappion.Windows.Core;

// Mirrors web/components/chat-room.tsx, with Brazilian phone aliases from web/lib/conversations.ts.
public static class ConversationSearch
{
    public static bool PhoneMatches(string address, string query)
    {
        static string Digits(string value) => Regex.Replace(value, @"\D", "");
        static string WithoutNinth(string value) => value.StartsWith("55") && value.Length == 13 && value[4] == '9' ? value.Remove(4, 1) : value;
        var phone = Digits(address); var digits = Digits(query);
        return digits.Length > 0 && (phone.Contains(digits, StringComparison.Ordinal) || WithoutNinth(phone).Contains(WithoutNinth(digits), StringComparison.Ordinal));
    }
    public static IEnumerable<string> Messages(IEnumerable<MessageRow> messages, string query, IReadOnlyList<JObject> templates)
    {
        var term = query.Trim(); if (term.Length < 2) return [];
        string Body(MessageRow row) {
            if ((string?)row.Content?["kind"] != "template") return row.Content?["text"]?.Type == JTokenType.String ? (string)row.Content["text"]! : "";
            var name = (string?)row.Content?["data"]?["name"] ?? "";
            var template = templates.FirstOrDefault(t => (string?)t["name"] == name);
            return (string?)(template?["components"] as JArray)?.FirstOrDefault(c => (string?)c["type"] == "BODY")?["text"] ?? name;
        }
        return messages.Where(m => (string?)m.Content?["kind"] != "reaction" && Body(m).Contains(term, StringComparison.OrdinalIgnoreCase)).Select(m => m.Id).Reverse().ToArray();
    }
}
