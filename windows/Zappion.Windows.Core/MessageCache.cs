// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

public sealed record MessageCacheSnapshot(IReadOnlyList<MessageRow> Rows, bool IsStale);

public sealed class MessageCache
{
    private const int ConversationLimit = 30;
    private const int MessageLimit = 500;
    private readonly object gate = new();
    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private readonly LinkedList<string> recency = new();

    private sealed class Entry(LinkedListNode<string> node)
    {
        public LinkedListNode<string> Node { get; } = node;
        public IReadOnlyList<MessageRow> Rows { get; set; } = [];
        // A realtime row alone is not a complete history.
        public bool IsStale { get; set; } = true;
    }

    private Entry Touch(string id)
    {
        if (entries.TryGetValue(id, out var entry)) recency.Remove(entry.Node);
        else
        {
            entry = new Entry(new LinkedListNode<string>(id));
            entries.Add(id, entry);
        }
        recency.AddLast(entry.Node);
        if (entries.Count > ConversationLimit)
        {
            entries.Remove(recency.First!.Value);
            recency.RemoveFirst();
        }
        return entry;
    }

    public void Upsert(MessageRow row)
    {
        if (string.IsNullOrEmpty(row.ConversationId) || string.IsNullOrEmpty(row.Id)) return;
        lock (gate)
        {
            var entry = Touch(row.ConversationId);
            entry.Rows = MessageTimeline.Upsert(entry.Rows, row, newestFirst: true, limit: MessageLimit)
                .Reverse().ToArray();
        }
    }

    // Seed a successful full history, including members with no messages.
    public void Store(IReadOnlyList<string> memberIds, IEnumerable<MessageRow> rows)
    {
        var snapshot = rows.ToArray();
        lock (gate)
        {
            foreach (var id in memberIds.Where(id => !string.IsNullOrEmpty(id)).Distinct(StringComparer.Ordinal))
            {
                var entry = Touch(id);
                IReadOnlyList<MessageRow> next = [];
                foreach (var row in snapshot.Where(row => row.ConversationId == id && !string.IsNullOrEmpty(row.Id)))
                    next = MessageTimeline.Upsert(next, row, newestFirst: true, limit: MessageLimit);
                entry.Rows = next.Reverse().ToArray();
                entry.IsStale = false;
            }
        }
    }

    // Mirrors useMessages in web/hooks/use-chat.ts: newest 500 across all members, oldest first.
    public MessageCacheSnapshot? Get(IReadOnlyList<string> memberIds)
    {
        lock (gate)
        {
            var found = false;
            var stale = false;
            var rows = new List<MessageRow>();
            foreach (var id in memberIds.Distinct(StringComparer.Ordinal))
            {
                if (!entries.ContainsKey(id)) { stale = true; continue; }
                var entry = Touch(id);
                found = true;
                stale |= entry.IsStale;
                rows.AddRange(entry.Rows);
            }
            return found ? new MessageCacheSnapshot(rows.OrderByDescending(row => row.Timestamp, StringComparer.Ordinal)
                .Take(MessageLimit).Reverse().ToArray(), stale) : null;
        }
    }

    public void MarkStale(string conversationId)
    {
        lock (gate)
            if (entries.TryGetValue(conversationId, out var entry)) entry.IsStale = true;
    }

    public void MarkAllStale()
    {
        lock (gate)
            foreach (var entry in entries.Values) entry.IsStale = true;
    }

    public void Clear()
    {
        lock (gate) { entries.Clear(); recency.Clear(); }
    }

    // Preserve LRU order across restarts; disk histories always require a full reload.
    public IReadOnlyDictionary<string, IReadOnlyList<MessageRow>> Export()
    {
        lock (gate) return recency.ToDictionary(id => id, id => entries[id].Rows);
    }

    public void Import(IReadOnlyDictionary<string, IReadOnlyList<MessageRow>> histories)
    {
        lock (gate)
        {
            Clear();
            foreach (var (id, rows) in histories)
            {
                Store([id], rows);
                entries[id].IsStale = true;
            }
        }
    }
}
