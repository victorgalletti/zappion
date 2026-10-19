// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Mirrors the request cleanup and realtime merge in web/hooks/use-chat.ts.
// Owned by the UI dispatcher; stale refetch completions never consume a newer load's updates.
public sealed class ChatLoadBuffer
{
    private readonly Dictionary<string, MessageRow> changes = new();
    private int version;
    public int Begin() { changes.Clear(); return ++version; }
    public void Invalidate() { version++; changes.Clear(); }
    public void Track(MessageRow row) => changes[row.Id] = row;
    public bool TryComplete(int request, IReadOnlyList<MessageRow> history, MessageRow? incoming,
        out IReadOnlyList<MessageRow> messages, out MessageRow? lastIncoming)
    {
        messages = history;
        lastIncoming = incoming;
        if (request != version) return false;
        foreach (var row in changes.Values)
        {
            messages = MessageTimeline.Upsert(messages, row);
            if (!string.IsNullOrEmpty(row.SenderAddress) &&
                (lastIncoming is null || string.CompareOrdinal(row.Timestamp, lastIncoming.Timestamp) >= 0)) lastIncoming = row;
        }
        changes.Clear();
        return true;
    }
}
