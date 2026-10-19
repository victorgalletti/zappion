// SPDX-License-Identifier: AGPL-3.0-only
using static Supabase.Postgrest.Constants;

namespace Zappion.Windows.Core;

public sealed partial class ZappionClient
{
    // Optimistic grouped update and member-scoped rollback mirror useArchiveConversation.
    public async Task ArchiveAsync(Workspace workspace, ConversationView conversation, bool archived)
    {
        var ids = conversation.MemberIds.Distinct().ToArray();
        if (ids.Length == 0 || string.IsNullOrEmpty(workspace.Agent.Id)) throw new InvalidOperationException("Member or chat unavailable.");
        var previous = conversationPreferences.Where(p => ids.Contains(p.ConversationId)).ToArray();
        var rows = ConversationPreferences.Rows(workspace.Agent.Id, workspace.OrganizationId, ids, archived ? DateTimeOffset.UtcNow.ToString("O") : null);
        void Replace(IEnumerable<ConversationPreferenceRow> replacement) => conversationPreferences = conversationPreferences.Where(p => !ids.Contains(p.ConversationId)).Concat(replacement).ToArray();
        Replace(rows);
        try { await client.From<ConversationPreferenceRow>().OnConflict("agent_id,conversation_id").Upsert(rows); }
        catch { Replace(previous); ConversationsChanged?.Invoke(null); throw; }
        ConversationsChanged?.Invoke(null);
    }
    // Mirrors web/components/profile-settings.tsx: constrain all three identity columns.
    public async Task UpdateProfileAsync(Workspace workspace, string? name = null, string? picture = null, bool updatePicture = false)
    {
        if (!updatePicture && (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 200)) throw new ArgumentException("Invalid profile name.");
        var query = client.From<AgentRow>().Filter("id", Operator.Equals, workspace.Agent.Id)
            .Filter("user_id", Operator.Equals, workspace.Agent.UserId).Filter("organization_id", Operator.Equals, workspace.OrganizationId);
        var response = updatePicture ? await query.Set(a => a.Picture!, picture!).Update() : await query.Set(a => a.Name, name!.Trim()).Update();
        if (response.Models.Count != 1) throw new InvalidOperationException("Profile update failed.");
        if (updatePicture) workspace.Agent.Picture = picture; else workspace.Agent.Name = name!.Trim();
    }
    public async Task<string> UploadProfilePhotoAsync(Workspace workspace, byte[] bytes, string mime)
    {
        var extension = mime switch { "image/png" => "png", "image/jpeg" => "jpg", "image/webp" => "webp", _ => throw new ArgumentException("Invalid photo type.") };
        if (bytes.Length > 2 * 1024 * 1024) throw new ArgumentException("Photo exceeds 2 MB.");
        var path = $"organizations/{workspace.OrganizationId}/agents/{workspace.Agent.Id}/{Guid.NewGuid()}.{extension}";
        await client.Storage.From("media").Upload(bytes, path, new Supabase.Storage.FileOptions { ContentType = mime, Upsert = false }, inferContentType: false);
        await UpdateProfileAsync(workspace, picture: path, updatePicture: true); return path;
    }
}
