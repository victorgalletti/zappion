// SPDX-License-Identifier: AGPL-3.0-only
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Zappion.Windows.Core;

// Persists the query data mirrored from web/hooks/use-chat.ts and use-conversation-preferences.ts.
public sealed record WorkspaceSnapshot(int Version, DateTimeOffset SavedAt, Workspace Workspace,
    IReadOnlyList<ConversationRow> Conversations, IReadOnlyList<ContactAddressRow> Contacts,
    IReadOnlyList<MessageRow> RecentMessages, IReadOnlyList<ConversationPreferenceRow> Preferences,
    IReadOnlyDictionary<string, IReadOnlyList<MessageRow>> Histories);

public sealed class SnapshotStore(string? directory = null)
{
    public const int CurrentVersion = 1;
    private readonly string directory = directory ?? VerificationStorage.DirectoryPath ?? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zappion", "cache");
    private readonly object gate = new();
    private static readonly JsonSerializerSettings Settings = new()
    {
        ContractResolver = new SnapshotResolver(), DateParseHandling = DateParseHandling.None
    };

    // BaseModel carries SDK transport metadata, which is not customer data or part of the snapshot.
    private sealed class SnapshotResolver : DefaultContractResolver
    {
        protected override IList<JsonProperty> CreateProperties(Type type, MemberSerialization serialization) =>
            base.CreateProperties(type, serialization).Where(p => p.DeclaringType != typeof(Supabase.Postgrest.Models.BaseModel)).ToList();
    }

    private static string Key(string id) => Guid.Parse(id).ToString("D");
    private string FilePath(string user, string organization) => Path.Combine(directory, $"snapshot-{Key(user)}-{Key(organization)}.bin");

    public long Save(WorkspaceSnapshot snapshot)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Snapshots require Windows DPAPI.");
        lock (gate)
        {
            var timer = Stopwatch.StartNew();
            var path = FilePath(snapshot.Workspace.Agent.UserId, snapshot.Workspace.OrganizationId);
            var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(snapshot, Settings)), null, DataProtectionScope.CurrentUser);
            Directory.CreateDirectory(directory);
            var temporary = path + ".tmp";
            try { File.WriteAllBytes(temporary, bytes); File.Move(temporary, path, true); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            AppLog.Info($"Snapshot save: {timer.ElapsedMilliseconds} ms, {bytes.Length} bytes");
            return bytes.LongLength;
        }
    }

    public WorkspaceSnapshot? LoadNewest(string userId)
    {
        lock (gate)
        {
            if (!Directory.Exists(directory)) return null;
            WorkspaceSnapshot? newest = null;
            foreach (var path in Directory.EnumerateFiles(directory, $"snapshot-{Key(userId)}-*.bin"))
            {
                try
                {
                    if (!OperatingSystem.IsWindows()) return null;
                    var json = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser));
                    var snapshot = JsonConvert.DeserializeObject<WorkspaceSnapshot>(json, Settings);
                    if (snapshot is null || snapshot.Version != CurrentVersion || snapshot.Workspace.Agent.UserId != userId ||
                        path != FilePath(userId, snapshot.Workspace.OrganizationId) || snapshot.Conversations is null ||
                        snapshot.Contacts is null || snapshot.RecentMessages is null || snapshot.Preferences is null || snapshot.Histories is null ||
                        snapshot.Workspace.Numbers is null || snapshot.Workspace.Numbers.Any(row => row is null) ||
                        snapshot.Conversations.Any(row => row is null) || snapshot.Contacts.Any(row => row is null) ||
                        snapshot.RecentMessages.Any(row => row is null) || snapshot.Preferences.Any(row => row is null) ||
                        snapshot.Histories.Any(pair => string.IsNullOrEmpty(pair.Key) || pair.Value is null || pair.Value.Any(row => row is null)))
                        throw new JsonException("Invalid snapshot.");
                    if (newest is null || snapshot.SavedAt > newest.SavedAt) newest = snapshot;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException or JsonException or ArgumentException or NullReferenceException)
                {
                    try { File.Delete(path); }
                    catch (Exception deleteError) when (deleteError is IOException or UnauthorizedAccessException) { AppLog.Error("Snapshot discard failed", deleteError); }
                }
            }
            return newest;
        }
    }

    public void DeleteUser(string userId)
    {
        lock (gate)
        {
            if (!Directory.Exists(directory)) return;
            foreach (var path in Directory.EnumerateFiles(directory, $"snapshot-{Key(userId)}-*.bin*")) File.Delete(path);
        }
    }
}
