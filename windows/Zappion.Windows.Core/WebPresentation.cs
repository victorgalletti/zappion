// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Text.RegularExpressions;

namespace Zappion.Windows.Core;

// Mirrors web/components/avatar.tsx and web/lib/utils.ts.
public static class WebPresentation
{
    private static readonly string[] Palette = ["#00a884", "#53bdeb", "#ff8f6b", "#a685e2", "#f0b330", "#e26a91", "#4fb4a6", "#6b8cff"];
    public static string AvatarColor(string seed)
    {
        var hash = 0;
        foreach (var rune in seed.EnumerateRunes()) hash = unchecked(hash * 31 + (rune.Value > 0xffff ? char.ConvertFromUtf32(rune.Value)[0] : rune.Value));
        return Palette[(int)(Math.Abs((long)hash) % Palette.Length)];
    }
    public static string Initials(string name)
    {
        var parts = Regex.Replace(name, @"[^\p{L}\p{N} ]", "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 0 ? "#" : (parts[0][..1] + (parts.Length > 1 ? parts[^1][..1] : "")).ToUpperInvariant();
    }
    public static string ListTime(string? iso, DateTimeOffset? now = null)
    {
        if (!DateTimeOffset.TryParse(iso, out var time)) return "";
        var local = time.ToLocalTime();
        return local.Date == (now ?? DateTimeOffset.Now).LocalDateTime.Date ? local.ToString("t") : DayLabel(iso!, now);
    }
    public static string DayLabel(string iso, DateTimeOffset? now = null)
    {
        if (!DateTimeOffset.TryParse(iso, out var time)) return "";
        var local = time.ToLocalTime();
        var days = ((now ?? DateTimeOffset.Now).LocalDateTime.Date - local.Date).Days;
        return days switch { 0 => UiStrings.Get("Today"), 1 => UiStrings.Get("Yesterday"), < 7 => local.ToString("dddd"), _ => local.ToString("d") };
    }
    // Mirrors filterConversations in web/lib/conversation-preferences.ts (archive/instance filters come later).
    public static bool Matches(ConversationView conversation, string query, bool unreadOnly)
    {
        var q = query.Trim();
        var digits = Regex.Replace(q, @"\D", "");
        return (!unreadOnly || conversation.Unread > 0) &&
            (q.Length == 0 || conversation.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase) ||
             (digits.Length > 0 && ConversationSearch.PhoneMatches(conversation.Primary.Address, digits)));
    }
    // Mirrors web/lib/instances.ts.
    public static string NumberLabel(OrganizationAddressRow number) =>
        (string?)number.Extra?["label"] is { Length: > 0 } label ? label :
        (string?)number.Extra?["verified_name"] is { Length: > 0 } verified ? verified :
        MessageHelpers.FormatPhone((string?)number.Extra?["phone_number"] ?? number.Address);
}
