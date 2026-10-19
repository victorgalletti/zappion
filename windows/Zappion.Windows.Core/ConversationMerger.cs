// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

public static class ConversationMerger
{
    public static IReadOnlyList<ConversationView> Merge(IEnumerable<ConversationRow> conversations,
        IEnumerable<MessageRow> recent, IEnumerable<ContactAddressRow> contacts,
        IReadOnlyDictionary<string, string>? lastRead = null)
    {
        var names = new Dictionary<(string, string), string>();
        foreach (var contact in contacts)
        {
            var name = MessageHelpers.ContactName(contact.Extra);
            if (!string.IsNullOrEmpty(name)) names[(contact.OrganizationAddress, contact.Address)] = name;
        }
        var byConversation = recent.Where(m => !string.IsNullOrEmpty(m.ConversationId) && MessageHelpers.IsRenderable(m))
            .ToLookup(m => m.ConversationId!);
        return conversations.GroupBy(c => (c.OrganizationAddress, MessageHelpers.PhoneKey(c.Address)))
            .Select(group =>
            {
                var rows = group.ToList();
                var messages = rows.SelectMany(c => byConversation[c.Id])
                    .OrderByDescending(m => m.Timestamp, StringComparer.Ordinal).ToList();
                var incoming = messages.FirstOrDefault(m => !string.IsNullOrEmpty(m.SenderAddress));
                var primary = rows.Find(c => c.Id == incoming?.ConversationId)
                    ?? rows.Find(c => c.Id == messages.FirstOrDefault()?.ConversationId) ?? rows[0];
                var name = rows.Select(c => names.GetValueOrDefault((c.OrganizationAddress, c.Address)) ?? c.Name)
                    .FirstOrDefault(n => !string.IsNullOrEmpty(n));
                // Mirrors useConversations in web/hooks/use-chat.ts: use the primary row's mark over all members.
                var seen = lastRead?.GetValueOrDefault(primary.Id);
                var unread = messages.Count(m => !string.IsNullOrEmpty(m.SenderAddress) &&
                    (seen is null || string.CompareOrdinal(m.Timestamp, seen) > 0));
                return new ConversationView(primary, rows.Select(c => c.Id).ToArray(),
                    name ?? MessageHelpers.FormatPhone(primary.Address), messages.FirstOrDefault(), unread);
            })
            .OrderByDescending(c => c.LastMessage?.Timestamp ?? c.Primary.UpdatedAt, StringComparer.Ordinal).ToArray();
    }
}
