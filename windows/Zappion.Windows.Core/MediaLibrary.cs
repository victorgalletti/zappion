// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

public enum MediaTab { Media, Links, Docs }

public sealed record MediaFilters(MediaTab Tab, string Search = "", string Sender = "", IReadOnlyList<string>? Conversations = null,
    string Instance = "", DateOnly? From = null, DateOnly? To = null, IReadOnlyList<string>? MatchingAddresses = null);

public sealed record MediaCursor(string Timestamp, string Id);

public sealed record MediaPage(IReadOnlyList<MessageRow> Rows, int Count, MediaCursor? Next);

public sealed record MediaLink(string Url, string Domain);

public sealed record MediaGroup(string Key, string Label, DateTimeOffset Start, DateTimeOffset End, IReadOnlyList<MessageRow> Rows);

public sealed record MediaPeople(IReadOnlyList<AgentRow> Agents, IReadOnlyList<ContactAddressRow> Contacts, IReadOnlyList<ConversationRow> Conversations);

// Mirrors web/lib/media-library.ts and the query in web/hooks/use-media-library.ts.
public static class MediaLibrary
{
    public const int PageSize = 60;
    // The web's use-media-library.ts keeps infinite-query pages; refreshes merge by message id.
    public static IReadOnlyList<MessageRow> MergeRows(IEnumerable<MessageRow> cached, IEnumerable<MessageRow> incoming) =>
        cached.Concat(incoming).GroupBy(r => r.Id, StringComparer.Ordinal).Select(g => g.Last())
            .OrderByDescending(r => DateTimeOffset.Parse(r.Timestamp, CultureInfo.InvariantCulture))
            .ThenByDescending(r => r.Id, StringComparer.Ordinal).ToArray();

    private static string T(string key) => UiStrings.Get("Media_mediaLibrary_" + key);

    public static MediaTab Classify(string? mime) =>
        Regex.IsMatch(mime ?? "", "^(image|video)/", RegexOptions.IgnoreCase) ? MediaTab.Media : MediaTab.Docs;

    public static string Text(MessageRow row) => row.Content?["text"] is JValue { Type: JTokenType.String } v ? (string?)v ?? "" : "";

    public static IReadOnlyList<MediaLink> ExtractLinks(string text)
    {
        var found = new Dictionary<string, MediaLink>();
        foreach (Match match in Regex.Matches(text, @"(?:https?://|www\.)[^\s<>""']+", RegexOptions.IgnoreCase))
        {
            var raw = Regex.Replace(match.Value, "[.,;:!?]+$", "");
            // Keep balanced closing parentheses, like the web.
            var trailing = Regex.Match(raw, @"\)+$").Value;
            if (trailing.Length > 0)
            {
                var opens = match.Value.Count(c => c == '(');
                var closes = match.Value.Count(c => c == ')');
                raw = raw[..^trailing.Length] + trailing[..Math.Max(0, trailing.Length - (closes - opens))];
            }
            var candidate = raw.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? "https://" + raw : raw;
            if (Uri.TryCreate(candidate, UriKind.Absolute, out var url) && url.Scheme is "http" or "https" && url.Host.Contains('.'))
                found[url.AbsoluteUri] = new MediaLink(url.AbsoluteUri, url.Host);
        }
        return found.Values.ToArray();
    }

    public static MediaTab? TabOf(MessageRow row)
    {
        if (MediaContent.FileOf(row.Content) is { } file) return Classify((string?)file["mime_type"]);
        return (string?)row.Content?["type"] == "text" && ExtractLinks(Text(row)).Count > 0 ? MediaTab.Links : null;
    }

    public static IReadOnlyList<MediaGroup> Group(IEnumerable<MessageRow> rows, DateTimeOffset? now = null)
    {
        var local = (now ?? DateTimeOffset.Now).ToLocalTime();
        var today = new DateTimeOffset(local.Date, local.Offset);
        var week = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var previous = week.AddDays(-7);
        var groups = new List<(string Key, string Label, DateTimeOffset Start, DateTimeOffset End, List<MessageRow> Rows)>();
        foreach (var row in rows)
        {
            if (!DateTimeOffset.TryParse(row.Timestamp, CultureInfo.InvariantCulture, DateTimeStyles.None, out var stamp)) continue;
            var date = stamp.ToLocalTime();
            var key = date >= today ? "today" : date >= week ? "week" : date >= previous ? "previous" : $"{date.Year}-{date.Month}";
            var label = key switch
            {
                "today" => T("today"),
                "week" => T("thisWeek"),
                "previous" => T("lastWeek"),
                _ => date.ToString(date.Year != local.Year ? "MMMM yyyy" : "MMMM", CultureInfo.CurrentUICulture)
            };
            var index = groups.FindIndex(g => g.Key == key);
            if (index < 0) { groups.Add((key, label, date, date, [row])); continue; }
            var g = groups[index];
            g.Rows.Add(row);
            groups[index] = (g.Key, g.Label, date < g.Start ? date : g.Start, date > g.End ? date : g.End, g.Rows);
        }
        return groups.Select(g => new MediaGroup(g.Key, g.Label, g.Start, g.End, g.Rows)).ToArray();
    }

    public static string FormatBytes(long? size)
    {
        if (size is null) return T("unknownSize");
        var culture = CultureInfo.CurrentUICulture;
        return size < 1024 ? $"{size} B"
            : size < 1024 * 1024 ? $"{(size.Value / 1024d).ToString("0.#", culture)} KB"
            : $"{(size.Value / 1024d / 1024d).ToString("0.#", culture)} MB";
    }

    public static string TotalLabel(int count, MediaTab tab)
    {
        var formatted = count.ToString("N0", CultureInfo.CurrentUICulture);
        var key = tab switch
        {
            MediaTab.Docs => count == 1 ? "totalDoc" : "totalDocs",
            MediaTab.Media => count == 1 ? "totalMediaFile" : "totalMediaFiles",
            _ => count == 1 ? "totalLink" : "totalLinks"
        };
        return string.Format(T(key), formatted);
    }

    /// <summary>PostgREST query string for one page; user text is quoted and escaped, never an expression.</summary>
    public static string Query(string organizationId, MediaFilters f, MediaCursor? cursor)
    {
        var q = new List<string>
        {
            "select=*",
            "organization_id=eq." + Uri.EscapeDataString(organizationId),
            "service=eq.whatsapp",
        };
        if (f.Tab == MediaTab.Links)
        {
            q.Add("content->>type=eq.text");
            q.Add("content->>text=imatch." + Uri.EscapeDataString(@"(https?://|www\.)([[:alnum:]-]+\.)+[[:alnum:]-]+"));
        }
        else
        {
            q.Add("content->>type=eq.file");
            q.Add("or=" + Uri.EscapeDataString(f.Tab == MediaTab.Media
                ? "(content->file->>mime_type.ilike.image/*,content->file->>mime_type.ilike.video/*)"
                : "(content->file->>mime_type.is.null,and(content->file->>mime_type.not.ilike.image/*,content->file->>mime_type.not.ilike.video/*))"));
        }
        if (f.Sender == "team") q.Add("sender_address=is.null");
        else if (!string.IsNullOrEmpty(f.Sender)) q.Add("sender_address=eq." + Uri.EscapeDataString(f.Sender));
        if (f.Conversations is { Count: > 0 } ids) q.Add("conversation_id=in.(" + string.Join(",", ids.Select(Quote)) + ")");
        if (!string.IsNullOrEmpty(f.Instance)) q.Add("organization_address=eq." + Uri.EscapeDataString(f.Instance));
        if (f.From is { } from) q.Add("timestamp=gte." + Uri.EscapeDataString(LocalMidnight(from).ToString("o", CultureInfo.InvariantCulture)));
        if (f.To is { } to) q.Add("timestamp=lt." + Uri.EscapeDataString(LocalMidnight(to.AddDays(1)).ToString("o", CultureInfo.InvariantCulture)));
        var ors = new List<string>();
        var term = f.Search.Trim();
        if (term.Length > 0)
        {
            var pattern = Quote("%" + Regex.Replace(term, @"[\\%_*]", m => "\\" + m.Value) + "%");
            ors.Add($"content->>text.ilike.{pattern}");
            ors.Add($"content->file->>name.ilike.{pattern}");
            if (f.MatchingAddresses is { Count: > 0 } addresses)
                ors.Add("conversation_address.in.(" + string.Join(",", addresses.Select(Quote)) + ")");
        }
        // PostgREST combines repeated `or` params with AND, like supabase-js's chained .or().
        if (ors.Count > 0) q.Add("or=" + Uri.EscapeDataString("(" + string.Join(",", ors) + ")"));
        if (cursor is not null)
            q.Add("or=" + Uri.EscapeDataString($"(timestamp.lt.{cursor.Timestamp},and(timestamp.eq.{cursor.Timestamp},id.lt.{cursor.Id}))"));
        q.Add("order=timestamp.desc,id.desc");
        q.Add("limit=" + PageSize);
        return string.Join("&", q);
    }

    private static string Quote(string value) => Newtonsoft.Json.JsonConvert.ToString(value);

    private static DateTimeOffset LocalMidnight(DateOnly date)
    {
        var local = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Local);
        return new DateTimeOffset(local).ToUniversalTime();
    }

    /// <summary>Addresses of contacts and conversations whose name or phone contains the term (web: matchingAddresses).</summary>
    public static IReadOnlyList<string> MatchingAddresses(string term, MediaPeople people)
    {
        var needle = term.Trim().ToLowerInvariant();
        if (needle.Length == 0) return [];
        var fromContacts = people.Contacts.Where(c =>
            $"{(string?)c.Extra?["synced"]?["name"]} {(string?)c.Extra?["saved_name"]} {(string?)c.Extra?["name"]} {MessageHelpers.FormatPhone(c.Address)}"
                .ToLowerInvariant().Contains(needle)).Select(c => c.Address);
        var fromConversations = people.Conversations.Where(c =>
            $"{c.Name} {MessageHelpers.FormatPhone(c.Address)}".ToLowerInvariant().Contains(needle)).Select(c => c.Address);
        return fromContacts.Concat(fromConversations).Distinct().ToArray();
    }

    public static string ConversationName(ConversationRow c, MediaPeople people) =>
        MessageHelpers.ContactName(people.Contacts.FirstOrDefault(x => x.Address == c.Address && x.OrganizationAddress == c.OrganizationAddress)?.Extra)
        ?? c.Name ?? MessageHelpers.FormatPhone(c.Address);

    public static string SenderName(MessageRow row, MediaPeople people, string myAgentId)
    {
        if (row.SenderAddress is null)
            return row.AgentId == myAgentId ? T("you") : people.Agents.FirstOrDefault(a => a.Id == row.AgentId)?.Name ?? T("team");
        return MessageHelpers.ContactName(people.Contacts.FirstOrDefault(c => c.Address == row.SenderAddress && c.OrganizationAddress == row.OrganizationAddress)?.Extra)
            ?? people.Conversations.FirstOrDefault(c => c.Id == row.ConversationId)?.Name
            ?? MessageHelpers.FormatPhone(row.SenderAddress);
    }

    /// <summary>Content to send when forwarding a library item: files are reused, text is resent.</summary>
    public static JObject ForwardContent(MessageRow row)
    {
        var text = Text(row);
        if (MediaContent.FileOf(row.Content) is { } file)
        {
            var content = new JObject { ["version"] = "1", ["type"] = "file", ["kind"] = row.Content?["kind"], ["file"] = file.DeepClone() };
            if (text.Length > 0) content["text"] = text;
            return content;
        }
        return new JObject { ["version"] = "1", ["type"] = "text", ["kind"] = "text", ["text"] = text };
    }
}
