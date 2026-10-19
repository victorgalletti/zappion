// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace Zappion.Windows.Core;

// Mirrors MessageApproval in web/hooks/use-message-approvals.ts.
[Table("zappion_message_approvals")]
public class MessageApprovalRow : BaseModel
{
    [PrimaryKey("message_id", false)] public string MessageId { get; set; } = "";
    [Column("organization_id")] public string OrganizationId { get; set; } = "";
    [Column("conversation_id")] public string ConversationId { get; set; } = "";
    [Column("api_key_name")] public string ApiKeyName { get; set; } = "";
    [Column("requested_at")] public string RequestedAt { get; set; } = "";
    [Column("decision")] public string? Decision { get; set; }
}

/// <summary>What a held bubble shows: the key that sent it, a decision in flight, the last error.</summary>
public sealed record ApprovalView(string? KeyName, bool Busy, string? Error);

// Mirrors isAwaitingApproval in web/lib/messages.ts and the badges in web/components/app-shell.tsx and sidebar.tsx.
public static class MessageApprovals
{
    internal static bool Has(JObject? status, string key) =>
        status?[key] is { Type: not JTokenType.Null } value && value.ToString() is not "" and not "False";

    /// <summary>Held by an API key that requires approval, and not yet approved, rejected or queued.</summary>
    public static bool IsAwaitingApproval(JObject? status) =>
        Has(status, "awaiting_approval") && !Has(status, "approved") && !Has(status, "rejected") && !Has(status, "pending");

    public static bool IsAwaitingApproval(MessageRow row) => string.IsNullOrEmpty(row.SenderAddress) && IsAwaitingApproval(row.Status);

    /// <summary>"Waiting for approval · key", or without the key until the approval row is loaded.</summary>
    public static string WaitingLabel(string? keyName) =>
        string.IsNullOrWhiteSpace(keyName) ? UiStrings.Get("awaiting_approval") : $"{UiStrings.Get("awaiting_approval")} · {keyName}";

    /// <summary>Conversation ids with a message still waiting for a decision.</summary>
    public static IReadOnlySet<string> ConversationIds(IEnumerable<MessageApprovalRow> approvals) =>
        approvals.Where(a => a.Decision is null).Select(a => a.ConversationId).ToHashSet();

    public static bool AnyWaiting(ConversationView conversation, IReadOnlySet<string> conversationIds) =>
        conversation.MemberIds.Any(conversationIds.Contains);

    public static string Badge(int count) => count > 99 ? "99+" : count.ToString();

    /// <summary>The RPCs raise human-readable errors; PostgREST wraps them in a JSON body.</summary>
    public static string ErrorMessage(Exception error)
    {
        var text = error.Message;
        try
        {
            if (JToken.Parse(text) is JObject body && (string?)body["message"] is { Length: > 0 } message) return message;
        }
        catch (Newtonsoft.Json.JsonException) { }
        return string.IsNullOrWhiteSpace(text) ? UiStrings.Get("GenericError") : text;
    }
}
