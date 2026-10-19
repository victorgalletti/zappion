// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    private string? chosenNewChatInstance;
    private bool configuringNewChat;

    // Mirrors the new-chat drawer in web/components/sidebar.tsx.
    private void OnNewChat(object sender, RoutedEventArgs e)
    {
        if (workspace is null || sending || recordingBusy || capture is not null) return;
        var connectedNumbers = workspace.Numbers.Where(n => n.Status == "connected")
            .Select(n => new { n.Address, Label = WebPresentation.NumberLabel(n) }).ToArray();
        configuringNewChat = true;
        NewChatInstance.ItemsSource = connectedNumbers;
        NewChatInstance.SelectedValue = connectedNumbers.FirstOrDefault(n => n.Address == chosenNewChatInstance)?.Address;
        if (connectedNumbers.Length == 1) NewChatInstance.SelectedValue = connectedNumbers[0].Address;
        configuringNewChat = false;
        NewChatInstancePanel.Visibility = connectedNumbers.Length > 1 ? Visibility.Visible : Visibility.Collapsed;
        ConnectNumberNotice.Visibility = connectedNumbers.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        NewChatPanel.Visibility = Visibility.Visible;
        UpdateNewChatValidation();
        NewChatNumber.Focus(FocusState.Programmatic);
    }
    private void CloseNewChat() => NewChatPanel.Visibility = Visibility.Collapsed;
    private void OnNewChatBack(object sender, RoutedEventArgs e) => CloseNewChat();
    private void OnNewChatInstanceChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!configuringNewChat) chosenNewChatInstance = NewChatInstance.SelectedValue as string;
        UpdateNewChatValidation();
    }
    private void OnNewChatNumberChanged(object sender, TextChangedEventArgs e) => UpdateNewChatValidation();
    private void UpdateNewChatValidation()
    {
        if (OpenNewChatButton is not null)
            OpenNewChatButton.IsEnabled = NewConversation.CanOpen(NewChatNumber.Text, NewChatInstance.SelectedValue as string);
    }
    private void OnNewChatNumberKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != global::Windows.System.VirtualKey.Enter) return;
        e.Handled = true; OnOpenNewChat(sender, new RoutedEventArgs());
    }
    private async void OnOpenNewChat(object sender, RoutedEventArgs e)
    {
        try
        {
            if (workspace is null || sending || !NewConversation.CanOpen(NewChatNumber.Text, NewChatInstance.SelectedValue as string)) return;
            var conversation = NewConversation.Open(allConversations, workspace.OrganizationId, NewChatNumber.Text, (string)NewChatInstance.SelectedValue);
            if (selected is not null) drafts[NewConversation.DraftKey(selected)] = Composer.Text;
            CloseNewChat(); NewChatNumber.Text = "";
            archivedView = conversation.Archived; Search.Text = ""; unreadOnly = false;
            preferences = preferences with { Instance = "" };
            CloseProfile(); UpdateNavigation();
            // Select explicitly: a draft deliberately has no row in the sidebar.
            selected = conversation;
            Conversations.SelectedItem = NewConversation.IsDraft(conversation) ? null : VisibleConversation(conversation.Primary.Id);
            await SelectConversationAsync(conversation);
        }
        catch (Exception ex) { AppLog.Error("Open new chat failed", ex); ReportCallbackError(ex); }
    }
}
