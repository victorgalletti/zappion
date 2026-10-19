// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Dispatching;
using Newtonsoft.Json.Linq;
using Windows.Storage;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    private DispatcherQueueTimer? windowTimer;
    private MessageRow? replyTo;
    private IReadOnlyList<JObject> templates = [];
    private bool WindowOpen => inboxLoaded && ServiceWindow.FromIncoming(lastIncoming?.Timestamp, DateTimeOffset.UtcNow).Open;
    private void UpdateServiceWindow()
    {
        if (OpenComposer is null) return;
        windowTimer?.Stop();
        var state = ServiceWindow.FromIncoming(lastIncoming?.Timestamp, DateTimeOffset.UtcNow);
        WindowStatus.Text = " \u00b7 " + state.Text; ToolTipService.SetToolTip(WindowStatus, state.Title);
        OpenComposer.Visibility = state.Open ? Visibility.Visible : Visibility.Collapsed;
        ClosedComposer.Visibility = state.Open ? Visibility.Collapsed : Visibility.Visible;
        OpenComposer.IsHitTestVisible = ClosedComposer.IsHitTestVisible = inboxLoaded;
        Composer.IsEnabled = AttachButton.IsEnabled = MicButton.IsEnabled = WindowOpen && !sending;
        ToolTipService.SetToolTip(OpenComposer, state.Open ? null : UiStrings.Get("WindowReason"));
        if (!state.Open)
        {
            ClearReply();
            if (!sending && attachments.Count > 0) ClearAttachments();
            if (capture is not null) _ = CancelRecordingAsync();
        }
        if (state.Next is { } next && selected is not null && !closed)
        {
            windowTimer ??= DispatcherQueue.CreateTimer();
            windowTimer.IsRepeating = false;
            windowTimer.Interval = TimeSpan.FromMilliseconds(Math.Max(1, (next - DateTimeOffset.UtcNow).TotalMilliseconds));
            windowTimer.Tick -= OnWindowTick; windowTimer.Tick += OnWindowTick; windowTimer.Start();
        }
        OnComposerChanged(Composer, null!);
    }
    private void OnWindowTick(DispatcherQueueTimer sender, object args) { UpdateServiceWindow(); RenderMessages(); }
    private void ClearReply() { replyTo = null; if (ReplyPanel is not null) ReplyPanel.Visibility = Visibility.Collapsed; }
    private void OnCancelReply(object sender, RoutedEventArgs e) => ClearReply();
    private void BeginReply(MessageRow row)
    {
        if (!WindowOpen || !messages.Any(m => m.Id == row.Id) || string.IsNullOrEmpty(row.ExternalId)) return;
        replyTo = row;
        ReplyName.Text = string.IsNullOrEmpty(row.SenderAddress) ? UiStrings.Get("You") : selected?.DisplayName;
        ReplyText.Text = MessageHelpers.Preview(row).Text;
        ReplyPanel.Visibility = Visibility.Visible; Composer.Focus(FocusState.Programmatic);
    }
    private async void React(MessageRow row, string emoji)
    {
        try
        {
            if (!WindowOpen || !messages.Any(m => m.Id == row.Id) || sending || string.IsNullOrEmpty(row.ExternalId) || selected is null || client is null || workspace is null) return;
            var target = selected; sending = true; Conversations.IsEnabled = SignOutButton.IsEnabled = false; OnComposerChanged(Composer, null!);
            try { AcceptSentMedia(await client.InsertContentAsync(workspace, target.Primary, MessageInteractions.Reaction(messages, row.ExternalId, emoji))); }
            catch (Exception ex) { AppLog.Error("MainWindow.Interactions operation failed", ex); ShowChatError(UiStrings.Get("SendError")); }
            finally { sending = false; Conversations.IsEnabled = SignOutButton.IsEnabled = true; UpdateServiceWindow(); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback React failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private async void JumpToMessage(string externalId)
    {
        try
        {
            var target = timeline.Items.FirstOrDefault(i => i.Message?.ExternalId == externalId);
            if (target is null) return;
            ScrollToMessage(target);
            await Task.Delay(100);
            if (timeline.Items.Contains(target) && MessageList.ContainerFromItem(target) is ListViewItem container)
            {
                container.Background = WebBrush.Get(Shell, "AccentTint10Brush");
                await Task.Delay(1500);
                if (ReferenceEquals(MessageList.ItemFromContainer(container), target)) container.ClearValue(Control.BackgroundProperty);
            }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback JumpToMessage failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private bool IsCurrent(ConversationView target) => NewConversation.SameChat(target, selected);
    private bool loadingTemplates;
    private bool templatesReloadPending;
    private async Task LoadTemplatesAsync(ConversationView target)
    {
        if (closed || loadingTemplates || client is null || workspace is null) return;
        loadingTemplates = true;
        var version = chatVersion;
        try
        {
            var loaded = await client.GetTemplatesAsync(workspace.OrganizationId, target.Primary.OrganizationAddress);
            if (closed || version != chatVersion || !IsCurrent(target)) return;
            templates = loaded; RenderMessages();
        }
        catch (ObjectDisposedException) when (closed) { /* Window shutdown canceled the HTTP client. */ }
        catch (Exception ex) { AppLog.Error("Load chat templates failed", ex); /* The picker exposes the error with an explicit retry. */ }
        finally
        {
            loadingTemplates = false;
            var reload = templatesReloadPending;
            templatesReloadPending = false;
            if (!closed && (reload || version != chatVersion) && selected is { } current) _ = LoadTemplatesAsync(current);
        }
    }
    private void CloseTemplatePicker() { TemplatePickerHost.Visibility = Visibility.Collapsed; TemplatePickerHost.Child = null; }
    private async void OnTemplates(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!inboxLoaded || selected is null || client is null || workspace is null || sending) return;
            if (TemplatePickerHost.Visibility == Visibility.Visible) { CloseTemplatePicker(); return; }
            var target = selected; var currentWorkspace = workspace; var currentClient = client;
            TemplatePickerHost.MaxHeight = Math.Min(640, Shell.ActualHeight * .75);
            TemplatePickerHost.Visibility = Visibility.Visible;
            TemplatePickerHost.Child = new TextBlock { Text = UiStrings.Get("LoadingTemplates"), Margin = new Thickness(16) };
            try
            {
                var loaded = await currentClient.GetTemplatesAsync(currentWorkspace.OrganizationId, target.Primary.OrganizationAddress);
                if (!IsCurrent(target) || TemplatePickerHost.Visibility != Visibility.Visible) return;
                templates = loaded; RenderMessages();
                TemplatePickerHost.Child = new TemplatePicker(templates,
                    async (file, mime) =>
                    {
                        if (!IsCurrent(target)) throw new InvalidOperationException(UiStrings.Get("SendError"));
                        sending = true; Conversations.IsEnabled = SignOutButton.IsEnabled = false;
                        try { return await currentClient.UploadTemplateMediaAsync(currentWorkspace, await File.ReadAllBytesAsync(file.Path), mime); }
                        finally { sending = false; Conversations.IsEnabled = SignOutButton.IsEnabled = true; }
                    },
                    async content =>
                    {
                        if (!IsCurrent(target) || sending) throw new InvalidOperationException(UiStrings.Get("SendError"));
                        sending = true; Conversations.IsEnabled = SignOutButton.IsEnabled = false;
                        try { AcceptSentMedia(await currentClient.InsertContentAsync(currentWorkspace, target.Primary, MessageInteractions.WithReply(content, replyTo))); ClearReply(); }
                        finally { sending = false; Conversations.IsEnabled = SignOutButton.IsEnabled = true; UpdateServiceWindow(); }
                        if (NewConversation.IsDraft(selected)) await RecoverAsync("draft-message-sent");
                    }, CloseTemplatePicker);
            }
            catch (Exception ex)
            {
                AppLog.Error("MainWindow.Interactions operation failed", ex);
                if (!IsCurrent(target)) return;
                var panel = new StackPanel { Spacing = 8, Margin = new Thickness(16) };
                panel.Children.Add(new TextBlock { Text = ex is FunctionError ? ex.Message : UiStrings.Get("LoadError"), TextWrapping = TextWrapping.Wrap });
                panel.Children.Add(ChatMedia.Button(UiStrings.Get("RetryTemplates"), (_, _) => { CloseTemplatePicker(); OnTemplates(sender, e); }));
                panel.Children.Add(ChatMedia.Button(UiStrings.Get("Close"), (_, _) => CloseTemplatePicker())); TemplatePickerHost.Child = panel;
            }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnTemplates failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
}
