// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace Zappion.Windows.Core;

[Table("conversations")]
public class ConversationRow : BaseModel
{
    [PrimaryKey("id", false)] public string Id { get; set; } = "";
    [Column("organization_id")] public string OrganizationId { get; set; } = "";
    [Column("service")] public string Service { get; set; } = "";
    [Column("organization_address")] public string OrganizationAddress { get; set; } = "";
    [Column("address")] public string Address { get; set; } = "";
    [Column("name")] public string? Name { get; set; }
    [Column("updated_at")] public string UpdatedAt { get; set; } = "";
}

[Table("messages")]
public class MessageRow : BaseModel
{
    [Column("organization_id")] public string OrganizationId { get; set; } = "";
    [Column("organization_address")] public string OrganizationAddress { get; set; } = "";
    [Column("conversation_address")] public string ConversationAddress { get; set; } = "";
    [Column("service")] public string Service { get; set; } = "";
    [Column("agent_id")] public string? AgentId { get; set; }
    [Column("status", ignoreOnInsert: true)] public JObject? Status { get; set; }
    [PrimaryKey("id", true)] public string Id { get; set; } = "";
    [Column("external_id", ignoreOnInsert: true)] public string? ExternalId { get; set; }
    [Column("conversation_id")] public string? ConversationId { get; set; }
    public bool ShouldSerializeConversationId() => !string.IsNullOrEmpty(ConversationId);
    [Column("sender_address")] public string? SenderAddress { get; set; }
    [Column("content")] public JObject? Content { get; set; }
    [Column("timestamp", ignoreOnInsert: true)] public string Timestamp { get; set; } = "";
}

[Table("contacts_addresses")]
public class ContactAddressRow : BaseModel
{
    [Column("address")] public string Address { get; set; } = "";
    [Column("organization_address")] public string OrganizationAddress { get; set; } = "";
    [Column("extra")] public JObject? Extra { get; set; }
}

[Table("agents")]
public class AgentRow : BaseModel
{
    [PrimaryKey("id", false)] public string Id { get; set; } = "";
    [Column("organization_id")] public string OrganizationId { get; set; } = "";
    [Column("user_id")] public string UserId { get; set; } = "";
    [Column("name")] public string Name { get; set; } = "";
    [Column("picture")] public string? Picture { get; set; }
    [Column("role")] public string Role { get; set; } = "";
    [Column("organizations")] public JObject? Organization { get; set; }
}

[Table("organizations_addresses")]
public class OrganizationAddressRow : BaseModel
{
    [Column("organization_id")] public string OrganizationId { get; set; } = "";
    [Column("address")] public string Address { get; set; } = "";
    [Column("service")] public string Service { get; set; } = "";
    [Column("status", ignoreOnInsert: true)] public string Status { get; set; } = "";
    [Column("extra")] public JObject? Extra { get; set; }
}

public sealed record Workspace(AgentRow Agent, string OrganizationName,
    IReadOnlyList<OrganizationAddressRow> Numbers)
{
    public string OrganizationId => Agent.OrganizationId;
}

public sealed record ConversationView(ConversationRow Primary, IReadOnlyList<string> MemberIds,
    string DisplayName, MessageRow? LastMessage, int Unread = 0)
{
    public bool Archived { get; init; }
    public string? InstanceLabel { get; init; }
    /// <summary>One of its messages is waiting for a member to approve it.</summary>
    public bool AwaitingApproval { get; init; }
    public string AccessibilityName => $"{DisplayName}, {PreviewText}, {TimeText}" + (Unread > 0 ? $", {Unread} {UiStrings.Get("Unread").ToLower(System.Globalization.CultureInfo.CurrentCulture)}" : "") +
        (AwaitingApproval ? $", {UiStrings.Get("ApprovalMarkerTitle")}" : "");
    public string PreviewText => ChatHelpers.SingleLine(MessageHelpers.Preview(LastMessage).Text);
    public string TimeText => WebPresentation.ListTime(LastMessage?.Timestamp ?? Primary.UpdatedAt);
}

// Mirrors web/hooks/use-conversation-preferences.ts.
[Table("conversation_preferences")]
public class ConversationPreferenceRow : BaseModel
{
    [PrimaryKey("agent_id", false)] public string AgentId { get; set; } = "";
    [PrimaryKey("conversation_id", false)] public string ConversationId { get; set; } = "";
    [Column("organization_id")] public string OrganizationId { get; set; } = "";
    [Column("archived_at")] public string? ArchivedAt { get; set; }
}
