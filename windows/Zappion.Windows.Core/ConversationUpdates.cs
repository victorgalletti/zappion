// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Mirrors conversation invalidation in web/hooks/use-chat.ts, applying known realtime rows locally.
public static class ConversationUpdates
{
    public static bool TryUpsert(IReadOnlyList<ConversationRow> rows, ConversationRow? row,
        out IReadOnlyList<ConversationRow> updated)
    {
        updated = rows;
        if (row is null || string.IsNullOrEmpty(row.Id) || row.Service != "whatsapp") return false;
        var index = -1;
        for (var i = 0; i < rows.Count; i++)
            if (rows[i].Id == row.Id && rows[i].OrganizationId == row.OrganizationId) { index = i; break; }
        // New members need contacts and recent messages from a full inbox refresh.
        if (index < 0) return false;
        var next = rows.ToArray();
        next[index] = row;
        updated = next;
        return true;
    }
}
