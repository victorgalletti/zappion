// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Mirrors useMessages/applyMessage in web/hooks/use-chat.ts and lastIncoming in web/components/chat-room.tsx.
public static class ChatHistory
{
    public static IReadOnlyList<MessageRow> Merge(IEnumerable<MessageRow> cached, IEnumerable<MessageRow> fetched)
    {
        IReadOnlyList<MessageRow> rows = [];
        foreach (var row in cached.Concat(fetched))
            rows = MessageTimeline.Upsert(rows, row, newestFirst: true, limit: 500);
        return rows.Reverse().ToArray();
    }

    public static MessageRow? LastIncoming(IEnumerable<MessageRow> rows, MessageRow? incoming = null)
    {
        var recent = rows.Where(row => !string.IsNullOrEmpty(row.SenderAddress))
            .OrderByDescending(row => row.Timestamp, StringComparer.Ordinal).FirstOrDefault();
        return incoming is not null && (recent is null || string.CompareOrdinal(incoming.Timestamp, recent.Timestamp) > 0)
            ? incoming : recent;
    }
}
