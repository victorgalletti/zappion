// SPDX-License-Identifier: AGPL-3.0-only
using static Supabase.Postgrest.Constants;

namespace Zappion.Windows.Core;

// Mirrors web/hooks/use-message-approvals.ts.
public sealed partial class ZappionClient
{
    /// <summary>Raised when a zappion_message_approvals row changes; the owner reloads the waiting list.</summary>
    public event Action? ApprovalsChanged;

    /// <summary>Every approval still waiting for a decision in the organization, oldest first.</summary>
    public async Task<IReadOnlyList<MessageApprovalRow>> GetWaitingApprovalsAsync(string organizationId)
    {
        var response = await client.From<MessageApprovalRow>()
            .Select("message_id, organization_id, conversation_id, api_key_name, requested_at, decision")
            .Filter("organization_id", Operator.Equals, organizationId)
            .Filter("decision", Operator.Is, "null")
            .Order("requested_at", Ordering.Ascending).Get();
        return response.Models;
    }

    /// <summary>Approves or rejects a held message. Errors carry the RPC's message (MessageApprovals.ErrorMessage).</summary>
    public async Task DecideMessageAsync(string messageId, bool approve) =>
        await client.Rpc(approve ? "zappion_approve_message" : "zappion_reject_message", new { p_message_id = messageId });

    public async Task<MessageRow?> GetMessageAsync(string messageId)
    {
        var response = await client.From<MessageRow>().Select("*").Filter("id", Operator.Equals, messageId).Limit(1).Get();
        return response.Models.FirstOrDefault();
    }
}
