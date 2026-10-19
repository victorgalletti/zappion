// SPDX-License-Identifier: AGPL-3.0-only
using System.Diagnostics;

namespace Zappion.Windows.Core;

public sealed partial class ZappionClient
{
    private readonly object snapshotGate = new();
    private readonly SnapshotStore snapshots;
    private Workspace? snapshotWorkspace;

    public Workspace? TryRestoreSnapshot(string userId)
    {
        lock (snapshotGate)
        {
            if (Session?.User?.Id != userId) return null;
            var timer = Stopwatch.StartNew();
            WorkspaceSnapshot? snapshot;
            try { snapshot = snapshots.LoadNewest(userId); }
            catch (Exception ex) { AppLog.Error("Snapshot restore failed", ex); return null; }
            if (snapshot is null) return null;
            lock (conversationStateGate)
            {
                conversationRows = snapshot.Conversations;
                contactRows = snapshot.Contacts;
                recentMessages = snapshot.RecentMessages;
                conversationPreferences = snapshot.Preferences;
                Messages.Import(snapshot.Histories);
                agentId = snapshot.Workspace.Agent.Id;
                snapshotWorkspace = snapshot.Workspace;
            }
            AppLog.Info($"Snapshot restore: {timer.ElapsedMilliseconds} ms, {snapshot.Conversations.Count} conversations, {snapshot.Histories.Count} cached chats");
            return snapshot.Workspace;
        }
    }

    public void SaveSnapshot()
    {
        try
        {
            lock (snapshotGate)
            {
                if (snapshotWorkspace is not { } current || Session?.User?.Id != current.Agent.UserId) return;
                WorkspaceSnapshot snapshot;
                lock (conversationStateGate)
                    snapshot = new(SnapshotStore.CurrentVersion, DateTimeOffset.UtcNow, current,
                        conversationRows, contactRows, recentMessages, conversationPreferences, Messages.Export());
                snapshots.Save(snapshot);
            }
        }
        catch (Exception ex) { AppLog.Error("Snapshot save failed", ex); }
    }

    private void SetSnapshotWorkspace(Workspace? next)
    {
        lock (snapshotGate)
        {
            if (snapshotWorkspace?.OrganizationId != next?.OrganizationId)
            {
                lock (conversationStateGate)
                {
                    conversationRows = []; contactRows = []; recentMessages = []; conversationPreferences = [];
                    Messages.Clear();
                }
            }
            snapshotWorkspace = next;
        }
    }
}
