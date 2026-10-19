// SPDX-License-Identifier: AGPL-3.0-only
using System.Text.RegularExpressions;

namespace Zappion.Windows.Core;

// Mirrors web/components/sidebar.tsx and the onStartChat handler in web/components/app-shell.tsx.
public static class NewConversation
{
    public static string Normalize(string value) => Regex.Replace(value, "[^0-9]", "");
    public static bool CanOpen(string value, string? instance) => Normalize(value).Length >= 10 && !string.IsNullOrEmpty(instance);
    public static bool IsDraft(ConversationView? conversation) => conversation is not null && conversation.MemberIds.Count == 0;
    public static ConversationView? Find(IEnumerable<ConversationView> conversations, string address, string instance) =>
        conversations.FirstOrDefault(c => c.Primary.OrganizationAddress == instance && MessageHelpers.PhoneKey(c.Primary.Address) == MessageHelpers.PhoneKey(address));
    public static ConversationView Open(IEnumerable<ConversationView> conversations, string organizationId, string value, string instance)
    {
        if (!CanOpen(value, instance)) throw new ArgumentException("A connected instance and at least ten phone digits are required.");
        var address = Normalize(value);
        return Find(conversations, address, instance) ?? new ConversationView(new ConversationRow
        {
            OrganizationId = organizationId, OrganizationAddress = instance, Address = address, Service = "whatsapp"
        }, [], MessageHelpers.FormatPhone(address), null);
    }
    public static bool SameChat(ConversationView target, ConversationView? current) => current is not null &&
        current.Primary.OrganizationId == target.Primary.OrganizationId &&
        current.Primary.OrganizationAddress == target.Primary.OrganizationAddress &&
        (target.MemberIds.Contains(current.Primary.Id) ||
         (IsDraft(target) && IsDraft(current) && target.Primary.Address == current.Primary.Address));
    public static string DraftKey(ConversationView conversation) => IsDraft(conversation)
        ? $"draft:{conversation.Primary.OrganizationAddress}:{conversation.Primary.Address}" : conversation.Primary.Id;
}
