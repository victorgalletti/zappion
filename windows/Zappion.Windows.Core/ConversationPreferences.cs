// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Mirrors web/lib/conversation-preferences.ts: a partially archived merged group stays together.
public static class ConversationPreferences
{
    public static IReadOnlyList<ConversationView> Apply(IEnumerable<ConversationView> conversations, IEnumerable<ConversationPreferenceRow> preferences)
    {
        var archived = preferences.Where(p => p.ArchivedAt != null).Select(p => p.ConversationId).ToHashSet();
        return conversations.Select(c => c with { Archived = c.MemberIds.Any(archived.Contains) }).ToArray();
    }
    public static List<ConversationPreferenceRow> Rows(string agentId, string organizationId, IEnumerable<string> memberIds, string? archivedAt) =>
        memberIds.Distinct().Select(id => new ConversationPreferenceRow { AgentId = agentId, OrganizationId = organizationId, ConversationId = id, ArchivedAt = archivedAt }).ToList();
}
