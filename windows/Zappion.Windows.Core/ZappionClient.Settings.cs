// SPDX-License-Identifier: AGPL-3.0-only
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

public sealed partial class ZappionClient
{
    private readonly string settingsPublicKey;
    // Mirrors web/hooks/use-settings.ts and use-api-keys.ts. Uses the SDK session;
    // PostgREST is used for sparse patches and projections without model serialization.
    private async Task<JToken> SettingsRequest(string path, HttpMethod method, object? body = null, bool single = false)
    {
        using var request = new HttpRequestMessage(method, functionsUrl.Replace("/functions/v1/", "/rest/v1/") + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Session?.AccessToken ?? "");
        request.Headers.Add("apikey", settingsPublicKey);
        if (single) request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.pgrst.object+json"));
        if (method == HttpMethod.Patch) request.Headers.Add("Prefer", "return=representation");
        if (body != null) request.Content = new StringContent(JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request);
        var raw = await response.Content.ReadAsStringAsync();
        JToken json;
        try { json = string.IsNullOrWhiteSpace(raw) ? JValue.CreateNull() : JToken.Parse(raw); } catch (JsonException) { json = JValue.CreateNull(); }
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException((string?)(json as JObject)?["message"] ?? $"HTTP {(int)response.StatusCode}");
        return json;
    }
    private static string Eq(string value) => Uri.EscapeDataString(value);
    private static void RequireEditor(Workspace w) { if (!SettingsRules.CanEdit(w.Agent.Role)) throw new UnauthorizedAccessException(SettingsRules.Text("useSettings", "youDoNotHavePermissionForThisAction")); }
    private static void RequireOwner(Workspace w) { if (!SettingsRules.CanManageMembers(w.Agent.Role)) throw new UnauthorizedAccessException(SettingsRules.Text("useSettings", "youDoNotHavePermissionForThisAction")); }
    public async Task UpdateOrganizationNameAsync(Workspace w, string name)
    {
        RequireEditor(w);
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 200) throw new ArgumentException(SettingsRules.Text("settingsPanel", "organizationName"));
        await SettingsRequest($"organizations?id=eq.{Eq(w.OrganizationId)}&select=id", HttpMethod.Patch, new { name = name.Trim() }, true);
    }
    public async Task UpdateOrganizationLogoAsync(Workspace w, byte[]? bytes = null, string mime = "")
    {
        RequireEditor(w); string? path = null;
        if (bytes != null)
        {
            var extension = SettingsRules.LogoExtension(mime, bytes.Length) ?? throw new ArgumentException(SettingsRules.Text("profileSettings", "chooseAPngJpgOrWebpImageUp"));
            path = $"organizations/{w.OrganizationId}/logo/{Guid.NewGuid()}.{extension}";
            await client.Storage.From("media").Upload(bytes, path, new Supabase.Storage.FileOptions { ContentType = mime, Upsert = false }, inferContentType: false);
        }
        await SettingsRequest($"organizations?id=eq.{Eq(w.OrganizationId)}&select=id", HttpMethod.Patch, new { extra = new { logo = path } }, true);
    }
    public async Task<JArray> GetMembersAsync(string organizationId) => (JArray)await SettingsRequest($"agents?select=id,organization_id,name,picture,role,user_id&organization_id=eq.{Eq(organizationId)}&user_id=not.is.null&deleted_at=is.null&order=name", HttpMethod.Get);
    public async Task<JArray> GetInvitationsAsync(string? organizationId = null) => (JArray)await SettingsRequest("invitations?select=id,organization_id,email,role,status,created_at" + (organizationId == null ? ",organization_name,invited_by_name" : "&organization_id=eq." + Eq(organizationId)) + "&status=eq.pending&order=created_at.desc", HttpMethod.Get);
    public async Task ChangeMemberRoleAsync(Workspace w, string id, string role)
    {
        RequireOwner(w); if (role is not ("owner" or "admin" or "member")) throw new ArgumentException(nameof(role));
        await SettingsRequest($"agents?organization_id=eq.{Eq(w.OrganizationId)}&id=eq.{Eq(id)}&select=id", HttpMethod.Patch, new { role }, true);
    }
    public async Task RemoveMemberAsync(Workspace w, string id) { RequireOwner(w); await SettingsRequest($"agents?organization_id=eq.{Eq(w.OrganizationId)}&id=eq.{Eq(id)}", HttpMethod.Delete); }
    public async Task CreateInvitationAsync(Workspace w, string email, string role)
    {
        RequireOwner(w);
        if (!System.Net.Mail.MailAddress.TryCreate(email.Trim(), out var address) || address.Address != email.Trim() || role is not ("owner" or "admin" or "member")) throw new ArgumentException(SettingsRules.Text("login", "email"));
        await SettingsRequest("invitations", HttpMethod.Post, new { organization_id = w.OrganizationId, email = email.Trim().ToLowerInvariant(), role });
    }
    public async Task RevokeInvitationAsync(Workspace w, string id) { RequireOwner(w); await SettingsRequest($"invitations?organization_id=eq.{Eq(w.OrganizationId)}&id=eq.{Eq(id)}&status=eq.pending&select=id", HttpMethod.Patch, new { status = "revoked" }, true); }
    public async Task RespondToInvitationAsync(string id, bool accept) => await SettingsRequest("rpc/" + (accept ? "accept_invitation" : "reject_invitation"), HttpMethod.Post, new { invitation_id = id });
    public async Task RenameInstanceAsync(Workspace w, string address, string label)
    {
        RequireEditor(w); if (label.Trim().Length > 100) throw new ArgumentException(SettingsRules.Text("manualConnect", "theInstanceNameMustBe100CharactersOr"));
        await SettingsRequest("rpc/set_address_label", HttpMethod.Post, new { p_service = "whatsapp", p_address = address, p_label = label.Trim() });
    }
    public async Task<int> GetInstanceCountAsync(Workspace w, string address)
    {
        using var request = new HttpRequestMessage(HttpMethod.Head, functionsUrl.Replace("/functions/v1/", "/rest/v1/") + $"conversations?select=id&organization_id=eq.{Eq(w.OrganizationId)}&service=eq.whatsapp&organization_address=eq.{Eq(address)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Session?.AccessToken ?? ""); request.Headers.Add("apikey", settingsPublicKey); request.Headers.Add("Prefer", "count=exact");
        using var response = await http.SendAsync(request); response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentRange?.Length is { } length) return (int)length;
        var raw = (response.Content.Headers.TryGetValues("Content-Range", out var values) || response.Headers.TryGetValues("Content-Range", out values)) ? values.FirstOrDefault() : null;
        return raw != null && int.TryParse(raw.Split('/').Last(), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var count) ? count : 0;
    }
    // Mirrors web/hooks/use-meta-app.ts; null GET responses are meaningful.
    public async Task<JObject?> GetMetaAppAsync(Workspace w)
    {
        RequireEditor(w);
        var result = await CallFunctionAsync("whatsapp-management/app?organization_id=" + Eq(w.OrganizationId), HttpMethod.Get, new { });
        return result.HasValues ? result : null;
    }
    public async Task SaveMetaAppAsync(Workspace w, string id, string? secret = null, string? token = null)
    {
        RequireEditor(w);
        var body = new JObject { ["organization_id"] = w.OrganizationId, ["app_id"] = id.Trim() };
        if (secret != null) body["app_secret"] = secret; if (token != null) body["system_user_token"] = token;
        try { await CallFunctionAsync("whatsapp-management/app", HttpMethod.Put, body); }
        catch (Exception ex)
        {
            var message = ex.Message; foreach (var value in new[] { secret, token }.Where(v => !string.IsNullOrEmpty(v))) message = message.Replace(value!, "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", StringComparison.Ordinal);
            throw ex is FunctionError f ? new FunctionError(message, f.Status, f.Reason) : new InvalidOperationException(message);
        }
        finally { body.Remove("app_secret"); body.Remove("system_user_token"); }
    }
    public async Task DisconnectMetaAppAsync(Workspace w) { RequireEditor(w); await CallFunctionAsync("whatsapp-management/app?organization_id=" + Eq(w.OrganizationId), HttpMethod.Delete, new { }); }
    public async Task<JObject> TestMetaAppAsync(Workspace w) { RequireEditor(w); return await CallFunctionAsync("whatsapp-management/app/test", HttpMethod.Post, new { organization_id = w.OrganizationId }); }
    public async Task<JObject> ConfigureWebhookAsync(Workspace w) { RequireEditor(w); return await CallFunctionAsync("whatsapp-management/app/webhook", HttpMethod.Post, new { organization_id = w.OrganizationId }); }
    public async Task ConnectNumberAsync(Workspace w, ManualConnectFields fields, bool hasSystemToken)
    {
        RequireEditor(w);
        if (SettingsRules.ValidateManualConnect(fields, hasSystemToken) is { } validation) throw new ArgumentException(validation);
        var body = SettingsRules.ManualPayload(w.OrganizationId, fields);
        try { await CallFunctionAsync("whatsapp-management/manual-connect", HttpMethod.Post, body); }
        catch (Exception ex) { throw new InvalidOperationException(SettingsRules.ManualError(ex.Message, fields.AccessToken, fields.AccessToken.Trim(), fields.VerifyToken, fields.Pin)); }
        finally { body.Remove("access_token"); body.Remove("pin"); body.Remove("verify_token"); }
    }
    public async Task<JArray> GetApiKeysAsync(Workspace w) { RequireEditor(w); return (JArray)await SettingsRequest($"api_keys?select=id,organization_id,name,key_prefix,scope,allowed_addresses,role,expires_at,last_used_at,revoked_at,send_limit_per_hour,template_limit_per_hour,created_by,created_at,updated_at&organization_id=eq.{Eq(w.OrganizationId)}&order=created_at.desc", HttpMethod.Get); }
    public async Task<JObject> CreateApiKeyAsync(Workspace w, string name, string scope, string? expires, string[]? addresses, int messages, int templates)
    {
        RequireEditor(w);
        if (!SettingsRules.ValidKey(name, scope, messages, templates, addresses, w.Numbers.Where(n => n.Status == "connected" && n.Service == "whatsapp").Select(n => n.Address))) throw new ArgumentException(SettingsRules.Text("integrations", "selectNumbersHint"));
        return (JObject)await SettingsRequest("rpc/zappion_create_api_key", HttpMethod.Post, new { p_organization_id = w.OrganizationId, p_name = name.Trim(), p_scope = scope, p_expires_at = expires, p_allowed_addresses = addresses, p_send_limit_per_hour = messages, p_template_limit_per_hour = templates });
    }
    public async Task RevokeApiKeyAsync(Workspace w, string id) { RequireEditor(w); await SettingsRequest("rpc/zappion_revoke_api_key", HttpMethod.Post, new { p_id = id }); }
    public async Task DeleteApiKeyAsync(Workspace w, string id) { RequireEditor(w); await SettingsRequest("api_keys?id=eq." + Eq(id), HttpMethod.Delete); }
    public async Task<JArray> GetMcpCallsAsync(Workspace w) { RequireEditor(w); return (JArray)await SettingsRequest($"mcp_calls?select=id,organization_id,api_key_id,user_id,tool,contact_phone,send_kind,status,error,created_at,finished_at&organization_id=eq.{Eq(w.OrganizationId)}&order=created_at.desc&limit=50", HttpMethod.Get); }
}
