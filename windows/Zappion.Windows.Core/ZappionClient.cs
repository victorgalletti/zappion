// SPDX-License-Identifier: AGPL-3.0-only
using System.Diagnostics;
using Supabase;
using Supabase.Gotrue;
using Supabase.Realtime;
using Supabase.Realtime.PostgresChanges;
using static Supabase.Postgrest.Constants;

namespace Zappion.Windows.Core;

public sealed partial class ZappionClient : IDisposable
{
    private readonly Supabase.Client client;
    private readonly string functionsUrl;
    private readonly HttpClient http = new();
    private readonly TemplateCache templateCache = new();
    private readonly FileSessionPersistence persistence;
    private RealtimeChannel? channel;
    private string? realtimeOrganization;
    private int realtimeVersion;
    private bool subscriptionReady;
    private readonly List<MessageRow> pendingMessages = new();
    private readonly List<ConversationRow> pendingConversations = new();
    private bool loadingConversations;
    private readonly object conversationStateGate = new();
    private readonly SemaphoreSlim conversationLoadGate = new(1);
    private IReadOnlyList<ConversationRow> conversationRows = Array.Empty<ConversationRow>();
    private IReadOnlyList<ContactAddressRow> contactRows = Array.Empty<ContactAddressRow>();
    private IReadOnlyList<MessageRow> recentMessages = Array.Empty<MessageRow>();
    public DevicePreferences Preferences { get; set; } = new();
    private string agentId = "";
    private IReadOnlyList<ConversationPreferenceRow> conversationPreferences = [];
    public LastReadStore LastRead { get; }
    public MessageCache Messages { get; } = new();
    public event Action<MessageRow, bool>? MessageChanged;
    public event Action<ConversationRow?>? ConversationsChanged;
    public event Action<bool>? ConnectionChanged;
    public event Action<string, string>? TemplatesChanged;

    public ZappionClient(AppConfiguration config, FileSessionPersistence? persistence = null, LastReadStore? lastRead = null, SnapshotStore? snapshots = null)
    {
        this.snapshots = snapshots ?? new SnapshotStore();
        templateCache.Changed += (org, address) => TemplatesChanged?.Invoke(org, address);
        settingsPublicKey = config.SupabaseKey;
        functionsUrl = config.SupabaseUrl.TrimEnd('/') + "/functions/v1/";
        this.persistence = persistence ?? new FileSessionPersistence();
        LastRead = lastRead ?? new LastReadStore();
        client = new Supabase.Client(config.SupabaseUrl, config.SupabaseKey, new SupabaseOptions
        {
            AutoRefreshToken = true,
            AutoConnectRealtime = false,
            SessionHandler = this.persistence
        });
        var realtime = (Supabase.Realtime.Client)client.Realtime;
        var defaultEncoder = realtime.Options.Encode;
        realtime.Options.Encode = (payload, send) =>
        {
            // The SDK's socket encoder is separate from the channel's receipt decoder.
            void Authorize(string json) => send(RealtimeJoinEncoder.Authorize(json, Session?.AccessToken));
            if (defaultEncoder is not null) defaultEncoder(payload, Authorize);
            else Authorize(Newtonsoft.Json.JsonConvert.SerializeObject(payload));
        };
        client.Auth.AddStateChangedListener((_, _) =>
        {
            if (Session?.AccessToken is { } token) client.Realtime.SetAuth(token);
        });
    }

    public Session? Session => client.Auth.CurrentSession;
    public MediaCache Media { get; private set; } = null!;
    public bool IsRealtimeConnected => client.Realtime.Socket?.IsConnected == true && channel?.IsJoined == true && subscriptionReady;

    public async Task InitializeAsync()
    {
        // Gotrue requires explicit loading before RetrieveSessionAsync (called by InitializeAsync).
        client.Auth.LoadSession();
        await client.InitializeAsync();
        Media = new MediaCache(path => client.Storage.From("media").CreateSignedUrl(path, 3600));
    }

    public async Task SignInAsync(string email, string password)
    {
        await client.Auth.SignIn(email, password);
        if (Session?.User is null) throw new InvalidOperationException("Sign-in did not return a session. Please try again.");
    }

    public async Task SignOutAsync()
    {
        await Task.Run(() =>
        {
            lock (snapshotGate)
            {
                var userId = Session?.User?.Id;
                snapshotWorkspace = null;
                if (userId is not null) snapshots.DeleteUser(userId);
            }
        });
        templateCache.Clear();
        StopRealtime();
        Messages.Clear();
        await client.Auth.SignOut(Supabase.Gotrue.Constants.SignOutScope.Local);
        persistence.DestroySession();
        templateCache.Clear();
    }

    public async Task<Workspace?> GetWorkspaceAsync()
    {
        var userId = Session?.User?.Id ?? throw new InvalidOperationException("Please sign in again.");
        var agents = await client.From<AgentRow>()
            .Select("id, organization_id, user_id, name, picture, role, organizations(name, extra)")
            .Filter("user_id", Operator.Equals, userId)
            .Filter("deleted_at", Operator.Is, "null").Limit(1).Get();
        var agent = agents.Models.FirstOrDefault();
        if (agent is null) { await Task.Run(() => SetSnapshotWorkspace(null)); return null; }
        agentId = agent.Id;
        var numbers = await client.From<OrganizationAddressRow>()
            .Select("organization_id, address, service, status, extra")
            .Filter("organization_id", Operator.Equals, agent.OrganizationId)
            .Filter("service", Operator.Equals, "whatsapp").Get();
        var workspace = new Workspace(agent, (string?)agent.Organization?["name"] ?? "", numbers.Models);
        await Task.Run(() => SetSnapshotWorkspace(workspace));
        return workspace;
    }

    public async Task<IReadOnlyList<ConversationView>> GetConversationsAsync(string organizationId, string? memberId = null)
    {
        await conversationLoadGate.WaitAsync();
        try { return await LoadConversationsAsync(organizationId, memberId); }
        finally { conversationLoadGate.Release(); }
    }

    private async Task<IReadOnlyList<ConversationView>> LoadConversationsAsync(string organizationId, string? memberId)
    {
        var timer = Stopwatch.StartNew();
        int? conversationCount = null, recentMessageCount = null, contactCount = null;
        if (memberId != null) agentId = memberId;
        lock (conversationStateGate) loadingConversations = true;
        try
        {
            var conversations = client.From<ConversationRow>().Select("*")
                .Filter("organization_id", Operator.Equals, organizationId)
                .Filter("service", Operator.Equals, "whatsapp")
                .Order("updated_at", Ordering.Descending).Limit(500).Get();
            var recent = client.From<MessageRow>().Select("*")
                .Filter("organization_id", Operator.Equals, organizationId)
                .Filter("service", Operator.Equals, "whatsapp")
                .Order("timestamp", Ordering.Descending).Limit(1000).Get();
            var contacts = client.From<ContactAddressRow>().Select("address, organization_address, extra")
                .Filter("organization_id", Operator.Equals, organizationId)
                .Filter("service", Operator.Equals, "whatsapp").Get();
            await Task.WhenAll(conversations, recent, contacts);
            conversationCount = conversations.Result.Models.Count;
            recentMessageCount = recent.Result.Models.Count;
            contactCount = contacts.Result.Models.Count;
            var preferences = (await client.From<ConversationPreferenceRow>().Filter("organization_id", Operator.Equals, organizationId).Filter("agent_id", Operator.Equals, agentId).Get()).Models;
            lock (conversationStateGate)
            {
                conversationPreferences = preferences;
                conversationRows = conversations.Result.Models;
                foreach (var row in pendingConversations)
                    if (ConversationUpdates.TryUpsert(conversationRows, row, out var updated)) conversationRows = updated;
                recentMessages = recent.Result.Models;
                contactRows = contacts.Result.Models;
                loadingConversations = false;
                foreach (var row in pendingMessages) ApplyMessage(row);
                return ConversationViews();
            }
        }
        finally
        {
            lock (conversationStateGate) { loadingConversations = false; pendingMessages.Clear(); pendingConversations.Clear(); }
            AppLog.Info($"LoadConversationsAsync ms={timer.ElapsedMilliseconds} conversations={conversationCount?.ToString() ?? "unknown"} recentMessages={recentMessageCount?.ToString() ?? "unknown"} contacts={contactCount?.ToString() ?? "unknown"}");
        }
    }

    public IReadOnlyList<ConversationView> ConversationViews()
    {
        lock (conversationStateGate)
            return ConversationPreferences.Apply(ConversationMerger.Merge(conversationRows, recentMessages, contactRows, LastRead.Snapshot()), conversationPreferences);
    }

    // False requests a full refresh for a missing/deleted payload or an unknown member.
    public bool ApplyConversation(ConversationRow? row)
    {
        lock (conversationStateGate)
        {
            if (!ConversationUpdates.TryUpsert(conversationRows, row, out var updated)) return false;
            conversationRows = updated;
            if (loadingConversations) pendingConversations.Add(row!);
            return true;
        }
    }

    public void ApplyMessage(MessageRow row)
    {
        if (row.Service != "whatsapp") return;
        lock (conversationStateGate)
        {
            Messages.Upsert(row);
            recentMessages = MessageTimeline.Upsert(recentMessages, row, newestFirst: true, limit: 1000);
            if (loadingConversations) pendingMessages.Add(row);
        }
    }

    // Mirrors useRealtime in web/hooks/use-chat.ts. Callbacks are dispatched by the UI owner.
    public async Task StartRealtimeAsync(string organizationId)
    {
        if (realtimeOrganization == organizationId && channel is not null) return;
        StopRealtime();
        realtimeOrganization = organizationId;
        var version = realtimeVersion;
        ConnectionChanged?.Invoke(false);
        try
        {
            client.Realtime.SetAuth(Session?.AccessToken ?? "");
            // The C# client requires an initialized socket before creating a channel.
            await client.Realtime.ConnectAsync().WaitAsync(TimeSpan.FromSeconds(10));
            if (version != realtimeVersion) return;
            client.Realtime.Socket!.AddStateChangedHandler((_, state) =>
            {
                if (version == realtimeVersion && state != Supabase.Realtime.Constants.SocketState.Open)
                {
                    Messages.MarkAllStale();
                    subscriptionReady = false;
                    ConnectionChanged?.Invoke(false);
                }
            });
            channel = client.Realtime.Channel($"org:{organizationId}");
            var current = channel;
            current.Options.SerializerSettings.ContractResolver = new RealtimeContractResolver(current.Options.SerializerSettings.ContractResolver!);
            var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var filter = $"organization_id=eq.{organizationId}";
            current.Register(new PostgresChangesOptions("public", "messages", PostgresChangesOptions.ListenType.All, filter));
            current.Register(new PostgresChangesOptions("public", "conversations", PostgresChangesOptions.ListenType.All, filter));
            current.Register(new PostgresChangesOptions("public", "zappion_message_approvals", PostgresChangesOptions.ListenType.All, filter));
            current.AddPostgresChangeHandler(PostgresChangesOptions.ListenType.All, (_, change) =>
            {
                if (channel != current) return;
                if (change.Payload?.Data?.Table == "messages")
                {
                    var row = change.Model<MessageRow>();
                    if (row is not null && row.OrganizationId == organizationId)
                    {
                        ApplyMessage(row);
                        MessageChanged?.Invoke(row, change.Payload.Data.Type == Supabase.Realtime.Constants.EventType.Insert);
                    }
                }
                // Messages held for approval: the chat bubbles and the badges read this list.
                else if (change.Payload?.Data?.Table == "zappion_message_approvals") ApprovalsChanged?.Invoke();
                else if (change.Payload?.Data?.Table == "conversations")
                {
                    var row = change.Payload.Data.Type == Supabase.Realtime.Constants.EventType.Delete
                        ? null : change.Model<ConversationRow>();
                    if (row is null || string.IsNullOrEmpty(row.OrganizationId) || row.OrganizationId == organizationId)
                        ConversationsChanged?.Invoke(row);
                }
            });
            current.AddStateChangedHandler((_, state) =>
            {
                if (channel == current && state != Supabase.Realtime.Constants.ChannelState.Joined)
                {
                    Messages.MarkAllStale();
                    subscriptionReady = false;
                    ConnectionChanged?.Invoke(false);
                }
            });
            current.AddMessageReceivedHandler((_, response) =>
            {
                // Joined precedes WAL subscription readiness. Refetch only after postgres_changes is live.
                if (channel != current || response.Event != Supabase.Realtime.Constants.EventType.System ||
                    response.Payload?.Extension != "postgres_changes") return;
                var connected = response.Payload.Status == "ok";
                if (!connected) Messages.MarkAllStale();
                subscriptionReady = connected;
                ConnectionChanged?.Invoke(connected);
                if (connected) ready.TrySetResult();
            });
            await current.Subscribe().WaitAsync(TimeSpan.FromSeconds(15));
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(15));
        }
        catch
        {
            if (version == realtimeVersion) StopRealtime();
            throw;
        }
    }

    public void StopRealtime()
    {
        Messages.MarkAllStale();
        subscriptionReady = false;
        realtimeVersion++;
        var old = channel;
        channel = null;
        realtimeOrganization = null;
        if (old is not null)
        {
            old.ClearStateChangedHandlers(); old.ClearPostgresChangeHandlers(); old.ClearMessageReceivedHandlers();
            client.Realtime.Remove(old);
        }
        client.Realtime.Disconnect();
    }

    public void Dispose() { templateCache.Clear(); StopRealtime(); client.Auth.Shutdown(); http.Dispose(); }

    // Mirrors useMessages/useLastIncoming/useSendMessage in web/hooks/use-chat.ts.
    public async Task<IReadOnlyList<MessageRow>> GetMessagesAsync(IReadOnlyList<string> memberIds)
    {
        if (memberIds.Count == 0) return Array.Empty<MessageRow>();
        var response = await client.From<MessageRow>().Select("*")
            .Filter("conversation_id", Operator.In, memberIds.ToList())
            .Order("timestamp", Ordering.Descending).Limit(500).Get();
        return response.Models.AsEnumerable().Reverse().ToArray();
    }

    // Mirrors useMessages in web/hooks/use-chat.ts; include the boundary for receipt/reaction updates.
    public async Task<IReadOnlyList<MessageRow>> GetMessagesSinceAsync(IReadOnlyList<string> memberIds, string timestamp)
    {
        if (memberIds.Count == 0) return Array.Empty<MessageRow>();
        var response = await client.From<MessageRow>().Select("*")
            .Filter("conversation_id", Operator.In, memberIds.ToList())
            .Filter("timestamp", Operator.GreaterThanOrEqual, timestamp)
            .Order("timestamp", Ordering.Descending).Limit(500).Get();
        return response.Models.AsEnumerable().Reverse().ToArray();
    }

    public async Task<MessageRow?> GetLastIncomingAsync(IReadOnlyList<string> memberIds)
    {
        if (memberIds.Count == 0) return null;
        var response = await client.From<MessageRow>().Select("*")
            .Filter("conversation_id", Operator.In, memberIds.ToList())
            .Not("sender_address", Operator.Is, "null")
            .Order("timestamp", Ordering.Descending).Limit(1).Get();
        return response.Models.FirstOrDefault();
    }

    public async Task MarkReadAsync(string messageId) =>
        await client.Rpc("mark_read", new { p_message_id = messageId, p_typing = false });

    public async Task<MessageRow> SendTextAsync(Workspace workspace, ConversationRow conversation, string text, MessageRow? replyTo = null)
        => await InsertContentAsync(workspace, conversation, MessageInteractions.WithReply(ChatHelpers.ToStoredContent(new Newtonsoft.Json.Linq.JObject
        {
            ["version"] = "1", ["type"] = "text", ["kind"] = "text", ["text"] = ChatHelpers.NormalizeLineBreaks(text)
        }), replyTo));

    // Mirrors callFunction in web/lib/supabase.ts, with the signed-in user's bearer token.
    public async Task<Newtonsoft.Json.Linq.JObject> CallFunctionAsync(string path, HttpMethod method, object body)
    {
        using var request = new HttpRequestMessage(method, functionsUrl + path);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Session?.AccessToken ?? "");
        request.Content = new StringContent(Newtonsoft.Json.JsonConvert.SerializeObject(body), System.Text.Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request);
        var json = await response.Content.ReadAsStringAsync();
        Newtonsoft.Json.Linq.JObject result;
        try { result = Newtonsoft.Json.Linq.JObject.Parse(json); } catch (Newtonsoft.Json.JsonException) { result = new(); }
        if (!response.IsSuccessStatusCode) throw FunctionError.FromResponse((int)response.StatusCode, result);
        return result;
    }
    // Mirrors useTemplates and useCreateTemplate in web/hooks/use-chat.ts and uploadTemplateSample in web/lib/templates/upload.ts.
    public async Task<IReadOnlyList<Newtonsoft.Json.Linq.JObject>> GetAllTemplatesAsync(string organizationId, string address, bool forceRefresh = false)
        => (await templateCache.GetAsync(organizationId, address, background => FetchTemplatesAsync(organizationId, address, background), forceRefresh)).All;

    public async Task<IReadOnlyList<Newtonsoft.Json.Linq.JObject>> GetTemplatesAsync(string organizationId, string address, bool forceRefresh = false)
        => (await templateCache.GetAsync(organizationId, address, background => FetchTemplatesAsync(organizationId, address, background), forceRefresh)).Approved;

    private async Task<TemplateCache.Lists> FetchTemplatesAsync(string organizationId, string address, bool background)
    {
        var timer = System.Diagnostics.Stopwatch.StartNew();
        var result = await CallFunctionAsync("whatsapp-management/templates", HttpMethod.Put, new { organization_id = organizationId, organization_address = address });
        var all = (result["data"] as Newtonsoft.Json.Linq.JArray)?.OfType<Newtonsoft.Json.Linq.JObject>().ToArray() ?? [];
        AppLog.Info($"Templates fetch: {timer.ElapsedMilliseconds} ms, count={all.Length}, background={background}");
        return new(all, all.Where(t => (string?)t["status"] == "APPROVED").ToArray());
    }

    public async Task<Newtonsoft.Json.Linq.JObject> CreateTemplateAsync(Newtonsoft.Json.Linq.JObject payload)
    {
        var orgId = (string?)payload["organization_id"] ?? "";
        var address = (string?)payload["organization_address"] ?? "";
        if (string.IsNullOrWhiteSpace(address))
            throw new InvalidOperationException(Templates.Text("useChat", "selectAWhatsappInstanceFirst"));
        var result = await CallFunctionAsync("whatsapp-management/templates", HttpMethod.Post, payload);
        templateCache.Invalidate(orgId, address);
        return result;
    }
    // Mirrors the DELETE templates endpoint in api/supabase/functions/whatsapp-management/index.ts.
    public async Task DeleteTemplateAsync(string organizationId, string address, Newtonsoft.Json.Linq.JObject template)
    {
        await CallFunctionAsync("whatsapp-management/templates", HttpMethod.Delete,
            new { organization_id = organizationId, organization_address = address, template });
        templateCache.Invalidate(organizationId, address);
    }

    public async Task<string> UploadTemplateSampleAsync(string organizationId, byte[] bytes, string fileName, string contentType, string format)
    {
        if (Templates.ValidateTemplateMedia(fileName, bytes.LongLength, contentType, format) is { } validationError)
            throw new InvalidOperationException(validationError);
        var url = $"{functionsUrl}whatsapp-management/template-media?organization_id={Uri.EscapeDataString(organizationId)}";
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Session?.AccessToken ?? "");
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        if (!string.IsNullOrWhiteSpace(contentType))
            fileContent.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(contentType);
        form.Add(fileContent, "file", string.IsNullOrWhiteSpace(fileName) ? "sample" : fileName);
        request.Content = form;
        using var response = await http.SendAsync(request);
        var raw = await response.Content.ReadAsStringAsync();
        Newtonsoft.Json.Linq.JObject json;
        try { json = Newtonsoft.Json.Linq.JObject.Parse(raw); } catch (Newtonsoft.Json.JsonException) { json = new(); }
        if (!response.IsSuccessStatusCode || string.IsNullOrWhiteSpace((string?)json["handle"]))
            throw new InvalidOperationException((string?)json["message"] ?? $"Upload failed ({(int)response.StatusCode})");
        return (string)json["handle"]!;
    }
    public async Task<string> UploadTemplateMediaAsync(Workspace workspace, byte[] bytes, string mime)
    {
        MediaContent.Validate(mime, bytes.LongLength);
        var path = $"organizations/{workspace.OrganizationId}/attachments/{Guid.NewGuid()}";
        await client.Storage.From("media").Upload(bytes, path, new Supabase.Storage.FileOptions { ContentType = mime, Upsert = false }, inferContentType: false);
        return await client.Storage.From("media").CreateSignedUrl(path, 3600);
    }

    // Mirrors useSendMessage in web/hooks/use-chat.ts: upload first, then insert.
    public async Task<MessageRow> SendFileAsync(Workspace workspace, ConversationRow conversation, byte[] bytes,
        string name, string mime, string? caption = null, double? duration = null, MessageRow? replyTo = null)
    {
        MediaContent.Validate(mime, bytes.LongLength);
        var path = $"organizations/{workspace.OrganizationId}/attachments/{Guid.NewGuid()}";
        // UUID paths have no extension. Disable the SDK's inference so it preserves MIME/Opus parameters.
        await client.Storage.From("media").Upload(bytes, path, new Supabase.Storage.FileOptions { ContentType = mime, Upsert = false }, inferContentType: false);
        return await InsertContentAsync(workspace, conversation, MessageInteractions.WithReply(MediaContent.Create(path, mime, bytes.LongLength, name, caption is null ? null : ChatHelpers.NormalizeLineBreaks(caption), duration), replyTo));
    }

    public async Task<MessageRow> InsertContentAsync(Workspace workspace, ConversationRow conversation, Newtonsoft.Json.Linq.JObject content)
    {
        var row = new MessageRow
        {
            Id = Guid.NewGuid().ToString(), OrganizationId = workspace.OrganizationId,
            OrganizationAddress = conversation.OrganizationAddress, ConversationAddress = conversation.Address,
            ConversationId = string.IsNullOrEmpty(conversation.Id) ? null : conversation.Id, Service = "whatsapp", SenderAddress = null,
            AgentId = workspace.Agent.Id,
            Content = Preferences.Sign(content, workspace.Agent.Name)
        };
        var response = await client.From<MessageRow>().Insert(row);
        // Insert's resolver suppresses server-owned columns in both directions. Read the
        // representation with a fresh resolver so timestamp and status are preserved.
        var settings = Supabase.Postgrest.Client.SerializerSettings(new Supabase.Postgrest.ClientOptions());
        var saved = Newtonsoft.Json.JsonConvert.DeserializeObject<List<MessageRow>>(response.Content ?? "[]", settings)?.FirstOrDefault()
            ?? throw new InvalidOperationException("The message was saved but no row was returned.");
        Messages.Upsert(saved);
        return saved;
    }
}
