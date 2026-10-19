// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Messages an API key holds for a member to approve. Mirrors web/hooks/use-message-approvals.ts
// and its use in web/components/chat-room.tsx, app-shell.tsx and sidebar.tsx.
public sealed partial class MainWindow
{
    private IReadOnlyList<MessageApprovalRow> approvals = [];
    private IReadOnlySet<string> approvalConversations = new HashSet<string>();
    private int approvalsVersion;
    private string? decidingMessage;
    private (string MessageId, string Text)? approvalError;

    private async Task LoadApprovalsAsync()
    {
        if (closed || client is null || workspace is null) return;
        var version = ++approvalsVersion;
        var organization = workspace.OrganizationId;
        IReadOnlyList<MessageApprovalRow> waiting;
        try { waiting = await client.GetWaitingApprovalsAsync(organization); }
        catch (Exception ex) { AppLog.Error("Loading message approvals failed", ex); return; }
        if (closed || version != approvalsVersion || workspace?.OrganizationId != organization) return;
        approvals = waiting;
        approvalConversations = MessageApprovals.ConversationIds(waiting);
        ApplyFilters();
        UpdateApprovalBadge();
        if (selected is not null) RenderMessages();
    }

    private void ClearApprovals()
    {
        approvalsVersion++;
        approvals = [];
        approvalConversations = new HashSet<string>();
        decidingMessage = null;
        approvalError = null;
        UpdateApprovalBadge();
    }

    private void UpdateApprovalBadge()
    {
        var waiting = approvals.Count;
        ApprovalBadge.Visibility = waiting > 0 ? Visibility.Visible : Visibility.Collapsed;
        ApprovalCount.Text = MessageApprovals.Badge(waiting);
        var name = UiStrings.Get("Chats");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(ChatsButton, waiting == 0 ? name
            : $"{name}, {(waiting == 1 ? UiStrings.Get("ApprovalsOne") : string.Format(System.Globalization.CultureInfo.CurrentCulture, UiStrings.Get("ApprovalsMany"), waiting))}");
    }

    private ApprovalView? ApprovalFor(MessageRow? message) => message is not null && MessageApprovals.IsAwaitingApproval(message)
        ? new ApprovalView(approvals.FirstOrDefault(a => a.MessageId == message.Id)?.ApiKeyName, decidingMessage is not null,
            approvalError is { } error && error.MessageId == message.Id ? error.Text : null)
        : null;

    private async void DecideMessage(MessageRow message, bool approve)
    {
        try
        {
            if (decidingMessage is not null || client is null) return;
            decidingMessage = message.Id;
            approvalError = null;
            RenderMessages();
            try
            {
                await client.DecideMessageAsync(message.Id, approve);
                // Realtime brings the new status too; this covers a missed event.
                if (await client.GetMessageAsync(message.Id) is { } updated) await ApplyRealtimeAsync(updated, insert: false);
            }
            catch (Exception ex)
            {
                AppLog.Error("Message approval decision failed", ex);
                approvalError = (message.Id, MessageApprovals.ErrorMessage(ex));
            }
            finally { decidingMessage = null; }
            await LoadApprovalsAsync();
            RenderMessages();
        }
        catch (Exception callbackError) { AppLog.Error("UI callback DecideMessage failed", callbackError); ReportCallbackError(callbackError); }
    }
}
