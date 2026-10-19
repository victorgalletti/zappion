// SPDX-License-Identifier: AGPL-3.0-only
using System.Collections.ObjectModel;
using System.ComponentModel;
using Newtonsoft.Json;

namespace Zappion.Windows.Core;

public sealed class MessageItem : INotifyPropertyChanged
{
    public MessageRow? Quoted { get; private set; }
    public IReadOnlyDictionary<string, string> Reactions { get; private set; } = new Dictionary<string, string>();
    public Newtonsoft.Json.Linq.JObject? Template { get; private set; }
    public string ContactName { get; private set; } = "";
    public bool Interactive { get; private set; }
    public Action<MessageRow>? Reply { get; set; }
    public Action<MessageRow, string>? React { get; set; }
    public Action<string>? Jump { get; set; }
    /// <summary>Approves (true) or rejects (false) a message waiting for approval.</summary>
    public Action<MessageRow, bool>? Decide { get; set; }
    /// <summary>Set only while the message is waiting for approval; mirrors BubbleApproval in web/components/message-bubble.tsx.</summary>
    public ApprovalView? Approval { get; private set; }
    public void SetApproval(ApprovalView? approval)
    {
        if (Approval == approval) return;
        Approval = approval;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Presentation"));
    }
    public void Present(IReadOnlyList<MessageRow> rows, IReadOnlyList<Newtonsoft.Json.Linq.JObject> templates, string contactName, bool interactive)
    {
        var quote = rows.FirstOrDefault(m => !string.IsNullOrEmpty(m.ExternalId) && m.ExternalId == (string?)Message?.Content?["re_message_id"]);
        var reactions = MessageInteractions.Reactions(rows, Message?.ExternalId);
        // Contacts use a data array; location uses an object without template fields.
        // Mirrors type-specific template lookup in web/components/message-bubble.tsx.
        var data = Message?.Content?["data"] as Newtonsoft.Json.Linq.JObject;
        var language = (data?["language"] as Newtonsoft.Json.Linq.JObject)?["code"]?.ToString();
        var template = (string?)Message?.Content?["kind"] == "template" && data is not null
            ? templates.FirstOrDefault(t => (string?)t["name"] == (string?)data["name"] &&
                (language is null || (string?)t["language"] == language))
            : null;
        if (Quoted == quote && JsonConvert.SerializeObject(Reactions) == JsonConvert.SerializeObject(reactions) && ReferenceEquals(Template, template) && Interactive == interactive && ContactName == contactName) return;
        Quoted = quote; Reactions = reactions; Template = template; Interactive = interactive; ContactName = contactName;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Presentation"));
    }
    public void RefreshPresentation() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Presentation"));
    public bool SearchMatch { get; private set; }
    public void SetSearchMatch(bool value) { if (SearchMatch == value) return; SearchMatch = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Presentation")); }
    public string Id { get; }
    public MessageRow? Message { get; private set; }
    public string? DateLabel { get; }
    public bool Tail { get; private set; } = true;
    internal void SetTail(bool tail) { if (Tail == tail) return; Tail = tail; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Tail))); }
    public string AccessibilityName => Message is { } row
        ? $"{(string.IsNullOrEmpty(row.SenderAddress) ? UiStrings.Get("You") : UiStrings.Get("Contact"))}, {MessageHelpers.Preview(row).Text}, " +
          (DateTimeOffset.TryParse(row.Timestamp, out var at) ? at.ToLocalTime().ToString("g") : "") +
          (string.IsNullOrEmpty(row.SenderAddress) ? $", {UiStrings.Get(ChatHelpers.DeliveryState(row.Status))}" : "")
        : DateLabel ?? UiStrings.Get("Date");
    public event PropertyChangedEventHandler? PropertyChanged;

    public MessageItem(string id, MessageRow? message, string? dateLabel = null)
    { Id = id; Message = message; DateLabel = dateLabel; }

    internal void Update(MessageRow row)
    {
        if (JsonConvert.SerializeObject(Message) == JsonConvert.SerializeObject(row)) return;
        Message = row;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Message)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(AccessibilityName)));
    }
}

public sealed class MessageTimeline
{
    public ObservableCollection<MessageItem> Items { get; } = new();

    // Mirrors applyMessage/upsertById in web/hooks/use-chat.ts. Keep unchanged item identities.
    public static IReadOnlyList<MessageRow> Upsert(IEnumerable<MessageRow> rows, MessageRow row,
        bool newestFirst = false, int? limit = null)
    {
        var next = rows.Where(m => m.Id != row.Id).Append(row);
        var sorted = newestFirst ? next.OrderByDescending(m => m.Timestamp, StringComparer.Ordinal)
            : next.OrderBy(m => m.Timestamp, StringComparer.Ordinal);
        return (limit is { } count ? sorted.Take(count) : sorted).ToArray();
    }

    public void Apply(IEnumerable<MessageRow> rows)
    {
        var desired = new List<MessageItem>();
        var existing = Items.ToArray().DistinctBy(i => i.Id).ToDictionary(i => i.Id);
        var separatorIds = new HashSet<string>();
        DateOnly? day = null;
        bool? lastSide = null;
        foreach (var row in rows.ToArray().Where(m => !string.IsNullOrEmpty(m.Id)).GroupBy(m => m.Id).Select(g => g.Last()).Where(MessageHelpers.IsRenderable).OrderBy(m => m.Timestamp, StringComparer.Ordinal))
        {
            if (DateTimeOffset.TryParse(row.Timestamp, out var timestamp))
            {
                var local = timestamp.ToLocalTime();
                var next = DateOnly.FromDateTime(local.DateTime);
                if (day != next)
                {
                    var key = "date:" + next.ToString("yyyy-MM-dd");
                    // Different timestamp offsets can revisit a local day in string order.
                    if (!separatorIds.Add(key)) key += ":" + row.Id;
                    desired.Add(existing.GetValueOrDefault(key) ?? new MessageItem(key, null, WebPresentation.DayLabel(row.Timestamp)));
                    day = next;
                    lastSide = null;
                }
            }
            var item = existing.GetValueOrDefault(row.Id) ?? new MessageItem(row.Id, row);
            item.SetTail(lastSide != string.IsNullOrEmpty(row.SenderAddress));
            lastSide = string.IsNullOrEmpty(row.SenderAddress);
            item.Update(row);
            desired.Add(item);
        }
        var ids = desired.Select(i => i.Id).ToHashSet();
        for (var i = Items.Count - 1; i >= 0; i--) if (!ids.Contains(Items[i].Id)) Items.RemoveAt(i);
        for (var i = 0; i < desired.Count; i++)
        {
            if (i < Items.Count && ReferenceEquals(Items[i], desired[i])) continue;
            var old = Items.IndexOf(desired[i]);
            if (old >= 0) Items.Move(old, i); else Items.Insert(i, desired[i]);
        }
    }
}
