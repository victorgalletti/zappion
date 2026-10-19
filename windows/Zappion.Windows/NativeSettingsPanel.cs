// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Newtonsoft.Json.Linq;
using Zappion.Windows.Core;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage.Pickers;

namespace Zappion.Windows;

// Desktop layout and behavior mirror web/components/settings-panel.tsx.
internal sealed partial class NativeSettingsPanel : UserControl, IDisposable
{
    private readonly ZappionClient client;
    private Workspace workspace;
    private readonly Func<Task<Workspace>> refresh;
    private readonly Grid root = new();
    private readonly StackPanel navigation = new() { Spacing = 4, Padding = new Thickness(12) };
    private readonly StackPanel stack = new() { Spacing = 16, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly StackPanel content = new() { Spacing = 24, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly ScrollViewer scroll;
    private readonly TextBlock title = new() { FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock feedback = new() { FontSize = 14, TextWrapping = TextWrapping.Wrap };
    private string section = "organization";
    private bool pending;
    private int dialogDepth;
    private int version;
    private bool awaitingSignup;
    private bool disposed, refreshing;
    private static readonly string[] Sections = ["organization", "members", "instances", "meta-app", "integrations"];
    private static string S(string group, string key) => SettingsRules.Text(group, key);
    private string P(string key) => S("settingsPanel", key);
    private bool Editable => SettingsRules.CanEdit(workspace.Agent.Role);
    private Brush Brush(string key) => WebBrush.Get(this, key);
    public NativeSettingsPanel(ZappionClient client, Workspace workspace, Func<Task<Workspace>> refresh)
    {
        this.client = client; this.workspace = workspace; this.refresh = refresh;
        root.Background = Brush("SurfaceBrush");
        root.RowDefinitions.Add(new() { Height = new GridLength(72) }); root.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) });
        root.Children.Add(Header(UiStrings.Get("Settings")));
        var body = new Grid(); body.ColumnDefinitions.Add(new() { Width = new GridLength(224) }); body.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); Grid.SetRow(body, 1); root.Children.Add(body);
        body.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 0, 1, 0), Child = navigation });
        var main = new Grid(); main.RowDefinitions.Add(new() { Height = new GridLength(72) }); main.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) }); Grid.SetColumn(main, 1); body.Children.Add(main);
        main.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1), Padding = new Thickness(20, 0, 20, 0), Child = title });
        stack.Children.Add(content); stack.Children.Add(feedback);
        scroll = new ScrollViewer { Content = stack, Padding = new Thickness(32), HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalContentAlignment = HorizontalAlignment.Left };
        scroll.SizeChanged += (_, _) => UpdateColumnWidth();
        Grid.SetRow(scroll, 1); main.Children.Add(scroll);
        Content = root;
        Loaded += async (_, _) => await LoadSection();
        ActualThemeChanged += async (_, _) => { root.Background = Brush("SurfaceBrush"); await LoadSection(); };
    }
    private void UpdateColumnWidth()
    {
        var max = section is "organization" or "members" ? 768 : 1024;
        if (scroll.ActualWidth > 64) stack.Width = Math.Max(0, Math.Min(max, scroll.ActualWidth - 64));
    }
    private Border Header(string text) => new() { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1), Padding = new Thickness(20, 0, 20, 0), Child = new TextBlock { Text = text, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center } };
    private TextBlock Text(string text, double size = 14) => new() { Text = text, FontSize = size, Foreground = Brush("SubBrush"), TextWrapping = TextWrapping.Wrap };
    private TextBlock Heading(string text, double size = 14, bool bold = true) => new() { Text = text, FontSize = size, Foreground = Brush("HeadingBrush"), FontWeight = bold ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal, TextWrapping = TextWrapping.Wrap };
    private TextBlock Mono(string text, double size = 14, string brush = "HeadingBrush") => new() { Text = text, FontSize = size, FontFamily = new FontFamily("Consolas"), Foreground = Brush(brush), TextWrapping = TextWrapping.Wrap };
    private StackPanel Stack(double spacing = 16) => new() { Spacing = spacing };
    private StackPanel Row(double spacing = 8) => new() { Orientation = Orientation.Horizontal, Spacing = spacing };
    private Border Card(UIElement child, bool filled = false, double padding = 20, bool bordered = true) => new() { BorderBrush = bordered ? Brush("LineBrush") : null, BorderThickness = new Thickness(bordered ? 1 : 0), CornerRadius = new CornerRadius(16), Padding = new Thickness(padding), Background = filled ? Brush("PanelBrush") : null, Child = child };
    private Border Badge(string text, bool accent = false)
    {
        var bg = accent ? WebBrush.Color(ActualTheme == ElementTheme.Dark ? "#2610b981" : "#1f10b981") : Brush("InputBrush");
        var border = accent ? WebBrush.Color("#4d10b981") : Brush("LineBrush");
        var fg = Brush(accent ? "ChatAccentBrush" : "SubBrush");
        return new Border { Background = bg, BorderBrush = border, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(10, 3, 10, 3), VerticalAlignment = VerticalAlignment.Center, Child = new TextBlock { Text = text, FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = fg } };
    }
    private Button Button(string text, Func<Task> action, bool primary = false)
    {
        var button = new Button { Content = text, Style = (Style)Application.Current.Resources["PlainButton"], Padding = new Thickness(16, 10, 16, 10), BorderThickness = new Thickness(primary ? 0 : 1), BorderBrush = Brush("LineBrush"), FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = primary ? WebBrush.Color("#ffffff") : Brush("HeadingBrush"), Background = primary ? Brush("ChatAccentBrush") : null, HorizontalAlignment = HorizontalAlignment.Left };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, text);
        button.Click += async (_, _) => {
            if (pending && dialogDepth > 0) { try { await action(); } catch (Exception ex) { feedback.Text = ex.Message; } }
            else await Run(action);
        }; return button;
    }
    private Button IconButton(string icon, string text, Func<Task> action, bool primary = false, bool danger = false)
    {
        var button = Button(text, action, primary);
        var fg = primary ? WebBrush.Color("#ffffff") : Brush(danger ? "DangerBrush" : "HeadingBrush");
        var row = Row(8);
        row.Children.Add(new LucideIcon { Kind = icon, Size = 16, Foreground = fg });
        row.Children.Add(new TextBlock { Text = text, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = fg, VerticalAlignment = VerticalAlignment.Center });
        button.Content = row;
        return button;
    }
    private Button LinkButton(string text, Func<Task> action, bool danger = false)
    {
        var button = Button(text, action);
        button.BorderThickness = new Thickness(0);
        button.Padding = new Thickness(4, 2, 4, 2);
        button.Background = null;
        button.Foreground = Brush(danger ? "DangerBrush" : "ChatAccentBrush");
        return button;
    }
    private Button MoreButton(string label, MenuFlyout menu)
    {
        var more = Button("\u2026", () => Task.CompletedTask);
        more.Flyout = menu;
        more.BorderThickness = new Thickness(0);
        more.Padding = new Thickness(10, 6, 10, 6);
        more.Foreground = Brush("SubBrush");
        more.VerticalAlignment = VerticalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(more, label);
        return more;
    }
    private async Task Run(Func<Task> action, TextBlock? status = null)
    {
        if (pending) return;
        pending = true; IsEnabled = false; (status ?? feedback).Text = "";
        try { await action(); }
        catch (Exception ex)
        {
            var message = ex is FunctionError f && f.Reason != null && UiStrings.Keys.Contains($"Settings_metaApp_{f.Reason}") ? S("metaApp", f.Reason) : ex.Message;
            (status ?? feedback).Text = message; (status ?? feedback).Foreground = Brush("DangerBrush");
        }
        finally { pending = false; IsEnabled = true; }
    }
    private TextBox Field(StackPanel parent, string label, string value = "", int max = 0, string? hint = null)
    {
        var group = Stack(8); group.Children.Add(Heading(label));
        var input = new TextBox { Text = value, Style = (Style)Application.Current.Resources["SettingsTextBox"] };
        PanelViewState.TrackInput(input);
        if (max > 0) input.MaxLength = max;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(input, label);
        group.Children.Add(input); if (hint != null) group.Children.Add(Text(hint, 12)); parent.Children.Add(group); return input;
    }
    private PasswordBox Secret(StackPanel parent, string label, string? hint = null)
    {
        var group = Stack(8); group.Children.Add(Heading(label));
        var input = new PasswordBox { CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10, 12, 10), FontSize = 14, BorderThickness = new Thickness(1), BorderBrush = Brush("LineBrush"), Background = Brush("InputBrush"), Foreground = Brush("HeadingBrush"), PasswordRevealMode = PasswordRevealMode.Peek };
        input.Resources["TextControlBorderThicknessFocused"] = new Thickness(1);
        input.Resources["TextControlBorderBrushFocused"] = Brush("ChatAccentBrush");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(input, label); group.Children.Add(input); if (hint != null) group.Children.Add(Text(hint, 12)); parent.Children.Add(group); return input;
    }
    private ComboBox Select(string label, IEnumerable<(string Id, string Label)> values, string selected)
    {
        var combo = new ComboBox { ItemsSource = values.Select(v => new Choice(v.Id, v.Label)).ToArray(), DisplayMemberPath = "Label", SelectedValuePath = "Id", SelectedValue = selected, FontSize = 14, CornerRadius = new CornerRadius(12), MinWidth = 100 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(combo, label); return combo;
    }
    private sealed record Choice(string Id, string Label);
    private ComboBox Roles(string value) => Select(P("role"), new[] { "owner", "admin", "member" }.Select(r => (r, S("useSettings", r == "admin" ? "administrator" : r))), value);
    private void CopyValue(StackPanel parent, string label, string value, bool secret = false)
    {
        var group = Stack(8); if (label.Length > 0) group.Children.Add(Text(label, 12));
        var box = new Grid { Background = Brush("InputBrush"), BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10, 12, 10), ColumnSpacing = 8 };
        box.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); box.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var field = new TextBox { Text = secret ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : value, IsReadOnly = true, BorderThickness = new Thickness(0), Background = null, Padding = new Thickness(0), FontFamily = new FontFamily("Consolas"), FontSize = 12, Foreground = Brush("HeadingBrush"), TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(field, label.Length > 0 ? label : S("integrations", "snippet")); box.Children.Add(field);
        var actions = Row(4); actions.VerticalAlignment = VerticalAlignment.Top;
        if (secret)
        {
            var toggle = Button(S("metaApp", "show"), () => { field.Text = field.Text == value ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : value; return Task.CompletedTask; });
            toggle.Padding = new Thickness(8, 4, 8, 4); actions.Children.Add(toggle);
        }
        var copy = Button(S("integrations", "copy"), () => { var data = new DataPackage(); data.SetText(value); Clipboard.SetContent(data); feedback.Text = S("integrations", "copied"); return Task.CompletedTask; });
        copy.Content = new LucideIcon { Kind = "copy", Size = 14, Foreground = Brush("SubBrush") };
        copy.Padding = new Thickness(6); copy.BorderThickness = new Thickness(0);
        actions.Children.Add(copy); Grid.SetColumn(actions, 1); box.Children.Add(actions);
        group.Children.Add(box); parent.Children.Add(group);
    }
#if DEBUG
    internal string VerificationFeedback => feedback.Text;
    internal Task NavigateForVerificationAsync(string target, string tab = "keys") { section = target; integrationTab = tab; return LoadSection(); }
#endif
    private async Task LoadSection()
    {
        if (disposed) return;
        var current = ++version; var requested = section;
        navigation.Children.Clear();
        foreach (var id in Sections)
        {
            var active = id == section;
            var nav = Button(P(id), async () => { section = id; await LoadSection(); });
            var fg = Brush(active ? "HeadingBrush" : "SubBrush");
            var row = Row(12);
            row.Children.Add(new LucideIcon { Kind = id switch { "organization" => "building", "members" => "users", "instances" or "meta-app" => "smartphone", _ => "plug" }, Size = 16, Foreground = fg });
            row.Children.Add(new TextBlock { Text = P(id), FontSize = 14, Foreground = fg, FontWeight = active ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal, VerticalAlignment = VerticalAlignment.Center });
            nav.Content = row;
            nav.HorizontalAlignment = HorizontalAlignment.Stretch;
            nav.HorizontalContentAlignment = HorizontalAlignment.Left;
            nav.Padding = new Thickness(16, 12, 16, 12);
            nav.BorderThickness = new Thickness(0);
            nav.Background = active ? Brush("PanelBrush") : null;
            navigation.Children.Add(nav);
        }
        title.Text = P(section); UpdateColumnWidth(); content.Children.Clear(); feedback.Text = "";
        if (!Editable && section is "meta-app" or "integrations") { content.Children.Add(Text(S(section == "meta-app" ? "metaApp" : "integrations", "adminOnly"))); return; }
        if (!Editable) content.Children.Add(Card(Text(P("yourMemberRoleAllowsYouToViewTheseSettings")), true, 16, false));
        try
        {
            switch (requested)
            {
                case "organization": await Organization(content); break;
                case "members": await Members(current, content); break;
                case "instances": await Instances(current, content); break;
                case "meta-app": await MetaApp(current, content); break;
                case "integrations": await Integrations(current, content); break;
            }
        }
        catch (Exception ex) { if (current == version) { feedback.Text = ex.Message; content.Children.Add(Button(S("integrations", "retry"), LoadSection)); } }
    }
    private async Task Saved()
    {
        workspace = await refresh(); await LoadSection(); feedback.Text = P("changesSaved"); feedback.Foreground = Brush("ChatAccentBrush");
    }
    private async Task Mutate(Func<Task> action) { try { await action(); } catch (Exception ex) { throw new InvalidOperationException(SettingsRules.ActionError(ex.Message)); } await Saved(); }
    private async Task<bool> Confirm(string title, string description)
    {
        var dialog = new ContentDialog { XamlRoot = XamlRoot, Title = title, Content = Text(description), PrimaryButtonText = title, CloseButtonText = S("connectNumber", "cancel"), RequestedTheme = ActualTheme };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }
    private async Task<ContentDialogResult> Form(string title, StackPanel fields, string submit, Func<Task> save, Action? clear = null, string? back = null)
    {
        var error = Text(""); fields.Children.Add(error);
        var dialog = new ContentDialog { XamlRoot = XamlRoot, Title = title, Content = new ScrollViewer { Content = fields, MaxHeight = 560, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled }, PrimaryButtonText = submit, CloseButtonText = S("connectNumber", "cancel"), RequestedTheme = ActualTheme };
        if (back != null) dialog.SecondaryButtonText = back;
        var submitting = false;
        dialog.Closing += (_, e) => { if (submitting) e.Cancel = true; };
        dialog.PrimaryButtonClick += async (_, e) =>
        {
            var deferral = e.GetDeferral(); submitting = true; dialog.IsPrimaryButtonEnabled = dialog.IsSecondaryButtonEnabled = false; fields.IsHitTestVisible = false;
            try { await save(); }
            catch (Exception ex) { error.Text = ex is FunctionError f && f.Reason != null && UiStrings.Keys.Contains($"Settings_metaApp_{f.Reason}") ? S("metaApp", f.Reason) : ex.Message; error.Foreground = Brush("DangerBrush"); e.Cancel = true; }
            finally { dialog.IsPrimaryButtonEnabled = true; fields.IsHitTestVisible = true; submitting = false; deferral.Complete(); }
        };
        try { dialogDepth++; return await dialog.ShowAsync(); } finally { dialogDepth--; clear?.Invoke(); }
    }
    private async Task Organization(StackPanel content)
    {
        var row = Row(20); row.VerticalAlignment = VerticalAlignment.Center;
        var avatar = new WebAvatar { AvatarSize = 80, VerticalAlignment = VerticalAlignment.Center }; avatar.Set(workspace.OrganizationName, workspace.OrganizationId); row.Children.Add(avatar);
        var details = Stack(6); details.VerticalAlignment = VerticalAlignment.Center; details.Children.Add(Heading(P("organizationLogo"))); details.Children.Add(Text(S("profileSettings", "pngJpgOrWebpUpTo2Mb"), 12)); row.Children.Add(details);
        var logo = (string?)workspace.Agent.Organization?["extra"]?["logo"];
        if (Editable)
        {
            var buttons = Row(8); buttons.Margin = new Thickness(0, 4, 0, 0); details.Children.Add(buttons);
            buttons.Children.Add(IconButton("upload", P(logo == null ? "uploadLogo" : "changeLogo"), async () => {
                var picker = new FileOpenPicker(); foreach (var ext in new[] { ".png", ".jpg", ".jpeg", ".webp" }) picker.FileTypeFilter.Add(ext); ChatMedia.InitializePicker(picker);
                if (await picker.PickSingleFileAsync() is not { } file) return;
                if (SettingsRules.LogoExtension(file.ContentType, (long)(await file.GetBasicPropertiesAsync()).Size) == null) throw new ArgumentException(S("profileSettings", "chooseAPngJpgOrWebpImageUp"));
                await Mutate(() => client.UpdateOrganizationLogoAsync(workspace, File.ReadAllBytes(file.Path), file.ContentType));
            }));
            if (logo != null) buttons.Children.Add(IconButton("trash", P("remove"), () => Mutate(() => client.UpdateOrganizationLogoAsync(workspace)), danger: true));
        }
        content.Children.Add(Card(row));
        var form = Stack(); var name = Field(form, P("organizationName"), workspace.OrganizationName, 200); name.IsEnabled = Editable;
        if (Editable)
        {
            var save = Button(S("profileSettings", "saveName"), () => Mutate(() => client.UpdateOrganizationNameAsync(workspace, name.Text)), true); save.IsEnabled = false;
            name.TextChanged += (_, _) => save.IsEnabled = name.Text.Trim().Length > 0 && name.Text.Trim() != workspace.OrganizationName; form.Children.Add(save);
        }
        content.Children.Add(form);
        if (logo != null) { try { avatar.SetPhoto(await client.Media.GetUrlAsync(logo)); } catch { /* Initials remain available offline. */ } }
    }
    private async Task Members(int current, StackPanel content)
    {
        var legend = Stack(6);
        foreach (var role in new[] { ("owner", "managesMembersRolesInvitationsOrganizationAndInstances"), ("administrator", "editsTheOrganizationAndInstancesCannotManageMembers"), ("member", "viewsOrganizationDetailsMembersAndInstances") })
        {
            var item = new TextBlock { FontSize = 14, Foreground = Brush("SubBrush"), TextWrapping = TextWrapping.Wrap };
            item.Inlines.Add(new Run { Text = S("useSettings", role.Item1) + ": ", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Brush("HeadingBrush") });
            item.Inlines.Add(new Run { Text = S("useSettings", role.Item2) });
            legend.Children.Add(item);
        }
        content.Children.Add(Card(legend, true, 16, false));
        var members = await client.GetMembersAsync(workspace.OrganizationId); if (current != version) return;
        var owners = members.Count(m => (string?)m["role"] == "owner");
        var list = Stack(12); content.Children.Add(list);
        foreach (var member in members.OfType<JObject>())
        {
            var row = new Grid { ColumnSpacing = 12 }; row.ColumnDefinitions.Add(new() { Width = new GridLength(40) }); row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
            var avatar = new WebAvatar { AvatarSize = 40, VerticalAlignment = VerticalAlignment.Center }; avatar.Set((string)member["name"]!, (string)member["id"]!); row.Children.Add(avatar);
            var lines = Stack(2); lines.VerticalAlignment = VerticalAlignment.Center;
            var nameRow = Row(6); nameRow.Children.Add(Heading((string)member["name"]!));
            if ((string?)member["user_id"] == workspace.Agent.UserId) nameRow.Children.Add(new TextBlock { Text = P("you"), FontSize = 12, Foreground = Brush("SubBrush"), VerticalAlignment = VerticalAlignment.Center });
            lines.Children.Add(nameRow);
            lines.Children.Add(Text(S("useSettings", (string?)member["role"] == "admin" ? "administrator" : (string)member["role"]!) + ((string?)member["role"] == "owner" && owners == 1 ? P("onlyOwner") : ""), 12));
            Grid.SetColumn(lines, 1); row.Children.Add(lines);
            if (SettingsRules.CanManageMembers(workspace.Agent.Role))
            {
                var actions = Row(8); actions.VerticalAlignment = VerticalAlignment.Center;
                var roles = Roles((string)member["role"]!); roles.CornerRadius = new CornerRadius(8); roles.IsEnabled = SettingsRules.CanChangeMember(workspace.Agent.Role, (string)member["role"]!, owners);
                roles.SelectionChanged += async (_, _) => { if ((string?)roles.SelectedValue != (string?)member["role"]) await Run(() => Mutate(() => client.ChangeMemberRoleAsync(workspace, (string)member["id"]!, (string)roles.SelectedValue))); };
                actions.Children.Add(roles);
                var remove = Button(P("remove"), async () => { if (await Confirm(P("remove"), string.Format(P("removeFromTheOrganization"), (string)member["name"]!))) await Mutate(() => client.RemoveMemberAsync(workspace, (string)member["id"]!)); });
                remove.Foreground = Brush("DangerBrush"); remove.CornerRadius = new CornerRadius(8); remove.Padding = new Thickness(12, 7, 12, 7); remove.IsEnabled = roles.IsEnabled;
                actions.Children.Add(remove); Grid.SetColumn(actions, 2); row.Children.Add(actions);
            }
            list.Children.Add(Card(row, padding: 16));
            if ((string?)member["picture"] is { Length: > 0 } picture) { try { avatar.SetPhoto(await client.Media.GetUrlAsync(picture)); } catch { } }
        }
        if (!SettingsRules.CanManageMembers(workspace.Agent.Role)) return;
        var invites = Stack(16); invites.Children.Add(Heading(P("pendingInvitations"), 16));
        var formRow = new Grid { ColumnSpacing = 12 };
        formRow.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        formRow.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        formRow.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var emailGroup = Stack(8);
        var email = Field(emailGroup, UiStrings.Get("Email"));
        email.InputScope = new Microsoft.UI.Xaml.Input.InputScope { Names = { new Microsoft.UI.Xaml.Input.InputScopeName { NameValue = Microsoft.UI.Xaml.Input.InputScopeNameValue.EmailSmtpAddress } } };
        formRow.Children.Add(emailGroup);
        var roleGroup = Stack(8); roleGroup.Children.Add(Heading(P("role")));
        var roleSelect = Roles("member"); roleSelect.MinWidth = 140; roleGroup.Children.Add(roleSelect);
        Grid.SetColumn(roleGroup, 1); formRow.Children.Add(roleGroup);
        var createBtn = Button(P("createInvitation"), () => Mutate(() => client.CreateInvitationAsync(workspace, email.Text, (string)roleSelect.SelectedValue)), true);
        createBtn.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(createBtn, 2); formRow.Children.Add(createBtn);
        var formBlock = Stack(8); formBlock.Children.Add(formRow); formBlock.Children.Add(Text(P("afterYouCreateTheInvitationTheRecipientCanCreate"), 12));
        invites.Children.Add(formBlock);
        content.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 24, 0, 0), Child = invites });
        var invitations = await client.GetInvitationsAsync(workspace.OrganizationId); if (current != version) return;
        if (invitations.Count == 0) invites.Children.Add(Text(P("noPendingInvitations")));
        foreach (var invite in invitations)
        {
            var row = new Grid { ColumnSpacing = 12 }; row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
            var info = Stack(2); info.Children.Add(Heading((string)invite["email"]!));
            info.Children.Add(Text($"{S("useSettings", (string?)invite["role"] == "admin" ? "administrator" : (string)invite["role"]!)} \u00b7 {Date(invite["created_at"])}", 12));
            row.Children.Add(info);
            var revoke = Button(P("revoke"), () => Mutate(() => client.RevokeInvitationAsync(workspace, (string)invite["id"]!)));
            revoke.Foreground = Brush("DangerBrush"); revoke.CornerRadius = new CornerRadius(8); revoke.Padding = new Thickness(12, 7, 12, 7); revoke.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(revoke, 1); row.Children.Add(revoke);
            invites.Children.Add(Card(row, padding: 16));
        }
    }
    private static string Date(JToken? value, string? emptyText = null) => SettingsRules.FormatDate(value, emptyText: emptyText);
    public void Dispose() { disposed = true; version++; }

    // Like web/components/settings-panel.tsx, keep the current section while queries refresh.
    public async Task OnShownAsync()
    {
        if (disposed || refreshing || pending || dialogDepth > 0) return;
        refreshing = true;
        var current = version;
        var requested = section;
        try
        {
            var next = await refresh();
            if (disposed || current != version || pending || dialogDepth > 0) return;
            workspace = next;
            var replacement = new StackPanel { Spacing = 24, HorizontalAlignment = HorizontalAlignment.Stretch };
            if (!Editable && requested is "meta-app" or "integrations")
                replacement.Children.Add(Text(S(requested == "meta-app" ? "metaApp" : "integrations", "adminOnly")));
            else
            {
                if (!Editable) replacement.Children.Add(Card(Text(P("yourMemberRoleAllowsYouToViewTheseSettings")), true, 16, false));
                switch (requested)
                {
                    case "organization": await Organization(replacement); break;
                    case "members": await Members(current, replacement); break;
                    case "instances": await Instances(current, replacement); break;
                    case "meta-app": await MetaApp(current, replacement); break;
                    case "integrations": await Integrations(current, replacement); break;
                }
            }
            if (disposed || current != version || pending || dialogDepth > 0) return;
            var restore = PanelViewState.Capture(content, preserveInputs: true);
            var offset = scroll.VerticalOffset;
            content.Children.Clear();
            while (replacement.Children.Count > 0)
            {
                var child = replacement.Children[0]; replacement.Children.RemoveAt(0); content.Children.Add(child);
            }
            restore(content);
            DispatcherQueue.TryEnqueue(() => { if (!disposed && current == version) scroll.ChangeView(null, offset, null, true); });
        }
        catch (Exception ex) { if (!disposed) AppLog.Error("Refresh settings failed", ex); }
        finally { refreshing = false; }
    }

    public async Task OnActivatedAsync() { if (disposed || !awaitingSignup) return; awaitingSignup = false; await Run(async () => { workspace = await refresh(); if (section == "instances") await LoadSection(); }); }
}
