// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    private ScrollViewer? invitationInbox;
    // Mirrors web/components/invitation-inbox.tsx for authenticated users without an organization.
    private async Task ShowInvitationInboxAsync()
    {
        if (client == null) return;
        if (invitationInbox != null) Shell.Children.Remove(invitationInbox);
        var stack = new StackPanel { Spacing = 20, MaxWidth = 576, Margin = new Thickness(24, 64, 24, 24), HorizontalAlignment = HorizontalAlignment.Center };
        var status = new TextBlock { FontSize = 14, TextWrapping = TextWrapping.Wrap };
        stack.Children.Add(new TextBlock { Text = SettingsRules.Text("invitationInbox", "welcome"), FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        stack.Children.Add(new TextBlock { Text = SettingsRules.Text("invitationInbox", "noOrganization"), FontSize = 14, TextWrapping = TextWrapping.Wrap });
        invitationInbox = new ScrollViewer { Content = stack, Background = WebBrush.Get(Shell, "SurfaceBrush"), HorizontalContentAlignment = HorizontalAlignment.Stretch }; Grid.SetRow(invitationInbox, 1); Shell.Children.Add(invitationInbox);
        try
        {
            var invitations = await client.GetInvitationsAsync();
            if (invitations.Count == 0) stack.Children.Add(new TextBlock { Text = SettingsRules.Text("invitationInbox", "noPendingInvitationsForYourEmail"), TextWrapping = TextWrapping.Wrap });
            foreach (var invitation in invitations)
            {
                var card = new StackPanel { Spacing = 12 }; card.Children.Add(new TextBlock { Text = (string?)invitation["organization_name"] ?? UiStrings.Get("Organization"), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
                card.Children.Add(new TextBlock { Text = ((string?)invitation["invited_by_name"] ?? SettingsRules.Text("invitationInbox", "anOwner")) + " · " + SettingsRules.Text("useSettings", (string?)invitation["role"] == "admin" ? "administrator" : (string)invitation["role"]!), FontSize = 14 });
                var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
                foreach (var accept in new[] { true, false })
                {
                    var button = Action("Settings_invitationInbox_" + (accept ? "accept" : "decline"), () => { });
                    button.Click += async (_, _) =>
                    {
                        if (busy) return; busy = true; invitationInbox.IsEnabled = false;
                        try { await client.RespondToInvitationAsync((string)invitation["id"]!, accept); await ShowSessionAsync(); }
                        catch (Exception ex) { status.Text = SettingsRules.ActionError(ex.Message); }
                        finally { busy = false; if (invitationInbox != null) invitationInbox.IsEnabled = true; }
                    };
                    actions.Children.Add(button);
                }
                card.Children.Add(actions); stack.Children.Add(Card(card, 16));
            }
        }
        catch (Exception ex) { status.Text = SettingsRules.ActionError(ex.Message); stack.Children.Add(Action("Retry", async () => await UiCallback.RunAsync(ShowInvitationInboxAsync, "Invitation inbox retry"))); }
        stack.Children.Add(status); var signOut = Action("SignOut", () => OnSignOut(this, new RoutedEventArgs())); stack.Children.Add(signOut);
    }
}
