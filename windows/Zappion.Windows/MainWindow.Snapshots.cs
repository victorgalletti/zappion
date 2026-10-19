// SPDX-License-Identifier: AGPL-3.0-only
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? snapshotTimer;
    private bool snapshotCloseReady;
    private bool snapshotClosing;

    private void InitializeSnapshots()
    {
        snapshotTimer = DispatcherQueue.CreateTimer();
        snapshotTimer.Interval = TimeSpan.FromSeconds(30);
        snapshotTimer.IsRepeating = false;
        snapshotTimer.Tick += async (_, _) =>
        {
            var current = client;
            if (current is not null && inboxLoaded) await Task.Run(current.SaveSnapshot);
        };
        AppWindow.Closing += async (_, args) =>
        {
            if (snapshotCloseReady) return;
            args.Cancel = true;
            if (snapshotClosing) return;
            snapshotClosing = true;
            snapshotTimer.Stop();
            var current = client;
            if (current is not null && inboxLoaded) await Task.Run(current.SaveSnapshot);
            snapshotCloseReady = true;
            Close();
        };
    }

    private void QueueSnapshotSave()
    {
        if (!closed && inboxLoaded && snapshotTimer is { IsRunning: false }) snapshotTimer.Start();
    }

    private void ShowWorkspaceHeader()
    {
        if (workspace is null) return;
        OrganizationName.Text = workspace.OrganizationName;
        AgentName.Text = workspace.Agent.Name;
        OrganizationAvatar.Set(workspace.OrganizationName, workspace.OrganizationName);
        MemberAvatar.Set(workspace.Agent.Name, workspace.Agent.Id);
        ConfigureNumbers();
    }
}
