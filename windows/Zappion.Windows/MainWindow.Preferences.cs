// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Zappion.Windows.Core;
using System.Globalization;
using Windows.Storage.Pickers;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    private readonly PreferencesStore preferencesStore = new(ReviewPreferencesPath());
    private static string? ReviewPreferencesPath() => Environment.GetEnvironmentVariable("ZAPPION_LAYOUT_REVIEW") is { Length: > 0 } folder ? Path.Combine(folder, "preferences.json") : VerificationStorage.FilePath("preferences.json");
    private DevicePreferences preferences = new();
    private bool archivedView;
    private Grid? profilePanel;
    private TextBlock? profileStatus;
    private bool showingPreferences;
    private Button SignOutButton = new();
    internal static DevicePreferences CurrentPreferences { get; private set; } = new();
    private TextBox? chatSearch;
    private TextBlock? searchPosition;
    private Grid? searchBar;
    private int matchIndex;
    private void InitializeLanguage()
    {
        preferences = preferencesStore.Load(); CurrentPreferences = preferences;
        CultureInfo.CurrentUICulture = CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.GetCultureInfo(preferences.Language == "pt-BR" ? "pt-BR" : "en-US");
    }
    private void InitializeStepSix()
    {
        SignOutButton.Click += OnSignOut;
        ApplyPreferences();
        // The web search row sits between the chat header and history.
        foreach (FrameworkElement child in ChatPanel.Children) if (Grid.GetRow(child) >= 1) Grid.SetRow(child, Grid.GetRow(child) + 1);
        ChatPanel.RowDefinitions.Insert(1, new RowDefinition { Height = GridLength.Auto });
        searchBar = new Grid { ColumnSpacing = 8, Padding = new Thickness(20, 8, 20, 8), Background = WebBrush.Get(Shell, "SurfaceBrush"), Visibility = Visibility.Collapsed };
        searchBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (var i = 0; i < 4; i++) searchBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        chatSearch = new TextBox { Style = (Style)Application.Current.Resources["SearchTextBox"], MinWidth = 0, PlaceholderText = UiStrings.Get("SearchMessages"), Background = WebBrush.Get(Shell, "PanelBrush"), CornerRadius = new CornerRadius(20) };
        searchPosition = new TextBlock { VerticalAlignment = VerticalAlignment.Center, FontSize = 12 };
        searchBar.Children.Add(chatSearch); Grid.SetColumn(searchPosition, 1); searchBar.Children.Add(searchPosition);
        Button SearchAction(string label, string icon, Action click)
        {
            var button = new Button { Content = new LucideIcon { Kind = icon, Size = 16 }, Width = 32, Height = 32, Style = (Style)Application.Current.Resources["PlainButton"] };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, UiStrings.Get(label)); ToolTipService.SetToolTip(button, UiStrings.Get(label)); button.Click += (_, _) => click(); return button;
        }
        var previous = SearchAction("Previous", "up", () => MoveSearch(-1)); Grid.SetColumn(previous, 2); searchBar.Children.Add(previous);
        var next = SearchAction("Next", "down", () => MoveSearch(1)); Grid.SetColumn(next, 3); searchBar.Children.Add(next);
        var close = SearchAction("Close", "close", CloseSearch); Grid.SetColumn(close, 4); searchBar.Children.Add(close);
        chatSearch.TextChanged += (_, _) => { matchIndex = 0; UpdateSearch(); };
        chatSearch.KeyDown += (_, e) =>
        {
            if (e.Key != global::Windows.System.VirtualKey.Enter) return;
            var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(global::Windows.System.VirtualKey.Shift);
            MoveSearch((shift & global::Windows.UI.Core.CoreVirtualKeyStates.Down) != 0 ? -1 : 1); e.Handled = true;
        };
        Grid.SetRow(searchBar, 1); ChatPanel.Children.Add(searchBar);
        if (ChatPanel.Children[0] is Border header && header.Child is UIElement heading)
        {
            header.Child = null; var row = new Grid(); row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.Children.Add(heading);
            var search = SearchAction("SearchMessages", "search", () => { if (searchBar.Visibility == Visibility.Visible) CloseSearch(); else { searchBar.Visibility = Visibility.Visible; chatSearch.Focus(FocusState.Programmatic); } }); Grid.SetColumn(search, 1); row.Children.Add(search); header.Child = row;
        }
        Shell.ActualThemeChanged += (_, _) => { ApplyChatAppearance(); ArchivedRowIcon.SetStroke(WebBrush.Get(Shell, "ChatAccentBrush")); };
        UpdateNavigation();
    }
    private Button Action(string key, Action action)
    {
        var button = new Button { Content = UiStrings.Get(key), Style = (Style)Application.Current.Resources["PlainButton"], CornerRadius = new CornerRadius(12), Padding = new Thickness(16, 10, 16, 10), BorderThickness = new Thickness(1), BorderBrush = WebBrush.Get(Shell, "LineBrush"), Foreground = WebBrush.Get(Shell, "HeadingBrush"), FontSize = 14 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, UiStrings.Get(key));
        button.Click += (_, _) => action(); return button;
    }
    private void ApplyPreferences()
    {
        CurrentPreferences = preferences;
        if (client != null) client.Preferences = preferences;
        Shell.RequestedTheme = preferences.Theme == "dark" ? ElementTheme.Dark : preferences.Theme == "light" ? ElementTheme.Light : ElementTheme.Default;
        Composer.FontSize = preferences.MessageFontSize;
        ApplyChatAppearance();
    }
    private void ApplyChatAppearance()
    {
        ChatPanel.Background = WebBrush.Color(preferences.BackgroundColor(Shell.ActualTheme == ElementTheme.Dark));
        Wallpaper.Visibility = preferences.ChatWallpaper ? Visibility.Visible : Visibility.Collapsed;
    }
    internal void SaveAudioRate(double rate) => SavePreferences(preferences with { AudioRate = rate });
    private void SavePreferences(DevicePreferences next)
    {
        try
        {
            var fontChanged = preferences.FontSize != next.FontSize;
            preferencesStore.Save(next); preferences = next; ApplyPreferences();
            if (fontChanged) foreach (var item in timeline.Items.ToArray()) item.RefreshPresentation();
            RenderMessages();
        }
        catch (Exception ex) { AppLog.Error("MainWindow.Preferences operation failed", ex); ShowChatError(UiStrings.Get("PreferencesSaveError")); }
    }
    private void ConfigureNumbers()
    {
        if (workspace == null) return;
        NumberFilter.ItemsSource = new[] { new { Address = "", Label = UiStrings.Get("AllInstances") } }
            .Concat(workspace.Numbers.Select(n => new { n.Address, Label = WebPresentation.NumberLabel(n) })).ToArray();
        if (!workspace.Numbers.Any(n => n.Address == preferences.Instance)) preferences = preferences with { Instance = "" };
        NumberFilter.SelectedValue = preferences.Instance;
        NumberFilter.Visibility = workspace.Numbers.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
    }
    private void OnNumberChanged(object sender, SelectionChangedEventArgs e)
    {
        if (NumberFilter.SelectedValue is string value && value != preferences.Instance) { SavePreferences(preferences with { Instance = value }); ApplyFilters(); }
    }
    private void UpdateNavigation()
    {
        var templatesActive = nativeTemplates?.Visibility == Visibility.Visible;
        var mediaActive = nativeMedia?.Visibility == Visibility.Visible;
        var inboxActive = profilePanel == null && nativeSettings?.Visibility != Visibility.Visible && !templatesActive && !mediaActive;
        ChatsIndicator.Visibility = !archivedView && inboxActive ? Visibility.Visible : Visibility.Collapsed;
        ArchivedIndicator.Visibility = archivedView && inboxActive ? Visibility.Visible : Visibility.Collapsed;
        TemplatesIndicator.Visibility = templatesActive ? Visibility.Visible : Visibility.Collapsed;
        ChatsButton.Background = WebBrush.Get(Shell, !archivedView && inboxActive ? "SurfaceBrush" : "PanelBrush");
        ArchivedButton.Background = WebBrush.Get(Shell, archivedView && inboxActive ? "SurfaceBrush" : "PanelBrush");
        RailTemplatesButton.Background = WebBrush.Get(Shell, templatesActive ? "SurfaceBrush" : "PanelBrush");
        MediaIndicator.Visibility = mediaActive ? Visibility.Visible : Visibility.Collapsed;
        RailMediaButton.Background = WebBrush.Get(Shell, mediaActive ? "SurfaceBrush" : "PanelBrush");
        NewChatButton.Visibility = archivedView ? Visibility.Collapsed : Visibility.Visible;
        ListTitle.Text = UiStrings.Get(archivedView ? "Archived" : "Chats");
        ArchiveBack.Visibility = archivedView ? Visibility.Visible : Visibility.Collapsed;
        ListFilters.Visibility = ArchivedRow.Visibility = archivedView ? Visibility.Collapsed : Visibility.Visible;
        ProfileButton.BorderThickness = new Thickness(profilePanel == null ? 0 : 2);
        ProfileButton.BorderBrush = WebBrush.Get(Shell, "ChatAccentBrush"); ProfileButton.CornerRadius = new CornerRadius(20);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(ArchivedButton, UiStrings.Get("Archived"));
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(RailTemplatesButton, UiStrings.Get("Templates"));
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(ProfileButton, UiStrings.Get("MyProfile"));
        var archivedUnread = allConversations.Count(c => c.Archived && c.Unread > 0);
        ArchivedLabel.Text = UiStrings.Get("Archived") + (archivedUnread > 0 ? "  " + archivedUnread : "");
        ArchivedBadge.Visibility = archivedUnread > 0 ? Visibility.Visible : Visibility.Collapsed;
        ArchivedCount.Text = archivedUnread > 99 ? "99+" : archivedUnread.ToString();
        ArchivedRowIcon.SetStroke(WebBrush.Get(Shell, "ChatAccentBrush"));
        ApplyFilters();
    }
    private void OnArchived(object sender, RoutedEventArgs e)
    {
        if (sending || capture != null || recordingBusy || profileSaving) return;
        OnChats(sender, e); archivedView = true; Search.Text = ""; UpdateNavigation();
    }
    private async void OnArchiveRequested(object? sender, ConversationView conversation)
    {
        try
        {
            if (client == null || workspace == null || archiving) return;
            archiving = true;
            var task = client.ArchiveAsync(workspace, conversation, !conversation.Archived);
            ReplaceConversations(client.ConversationViews());
            try { await task; }
            catch (Exception ex) { AppLog.Error("MainWindow.Preferences operation failed", ex); ShowChatError(UiStrings.Get("ArchiveError")); }
            finally { archiving = false; ReplaceConversations(client.ConversationViews()); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnArchiveRequested failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private bool archiving;
    private async void OpenWeb(string route)
    {
        try
        {
            try { var config = AppConfiguration.Load(AppContext.BaseDirectory); await global::Windows.System.Launcher.LaunchUriAsync(new Uri(config.WebAppUrl.TrimEnd('/') + route)); }
            catch (Exception ex) { AppLog.Error("MainWindow.Preferences operation failed", ex); ShowChatError(UiStrings.Get("OpenWebError")); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OpenWeb failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private NativeSettingsPanel? nativeSettings;
    private NativeTemplatesPanel? nativeTemplates;
    private int workspacePanelVersion;
    private void OnWebSettings(object sender, RoutedEventArgs e)
    {
        if (workspace == null || client == null || sending || capture != null || recordingBusy || profileSaving) return;
        CloseProfile(); InboxGrid.Visibility = Visibility.Collapsed;
        if (nativeSettings != null)
        {
            nativeSettings.Visibility = Visibility.Visible; UpdateNavigation();
            _ = nativeSettings.OnShownAsync(); return;
        }
        var panelVersion = workspacePanelVersion;
        nativeSettings = new NativeSettingsPanel(client, workspace, async () => {
            var next = await client.GetWorkspaceAsync() ?? workspace;
            if (closed || panelVersion != workspacePanelVersion || client.Session?.User == null) return next;
            if (workspace.OrganizationId != next.OrganizationId) DisposeWorkspacePanels();
            workspace = next;
            OrganizationName.Text = workspace.OrganizationName;
            OrganizationAvatar.Set(workspace.OrganizationName, workspace.OrganizationId);
            var logo = (string?)workspace.Agent.Organization?["extra"]?["logo"];
            if (logo != null)
            {
                var photo = await client.Media.GetUrlAsync(logo);
                if (closed || !ReferenceEquals(workspace, next)) return next;
                OrganizationAvatar.SetPhoto(photo);
            }
            ConfigureNumbers();
            return workspace;
        });
        ContentHost.Children.Add(nativeSettings); UpdateNavigation();
    }
    private void OnWebTemplates(object sender, RoutedEventArgs e)
    {
        if (workspace == null || client == null || sending || capture != null || recordingBusy || profileSaving) return;
        try
        {
            CloseProfile(); InboxGrid.Visibility = Visibility.Collapsed;
            if (nativeTemplates == null)
            {
                nativeTemplates = new NativeTemplatesPanel(client, workspace, string.IsNullOrEmpty(preferences.Instance) ? null : preferences.Instance);
                ContentHost.Children.Add(nativeTemplates);
            }
            else { nativeTemplates.Visibility = Visibility.Visible; _ = nativeTemplates.OnShownAsync(workspace); }
            UpdateNavigation();
        }
        catch (Exception ex)
        {
            AppLog.Error("Open templates failed", ex);
            CloseProfile(); ReportCallbackError(ex);
        }
    }
    private MediaLibraryPanel? nativeMedia;
    private void OnWebMedia(object sender, RoutedEventArgs e)
    {
        if (workspace == null || client == null || sending || capture != null || recordingBusy || profileSaving) return;
        try
        {
            CloseProfile(); InboxGrid.Visibility = Visibility.Collapsed;
            if (nativeMedia == null)
            {
                nativeMedia = new MediaLibraryPanel(client, workspace, row => _ = OpenMessageAsync(row));
                ContentHost.Children.Add(nativeMedia);
            }
            else { nativeMedia.Visibility = Visibility.Visible; _ = nativeMedia.OnShownAsync(workspace); }
            UpdateNavigation();
        }
        catch (Exception ex)
        {
            AppLog.Error("Open media library failed", ex);
            CloseProfile(); ReportCallbackError(ex);
        }
    }

    /// <summary>Mirrors onOpenMessage in the web media library: open the chat at that message.</summary>
    private async Task OpenMessageAsync(MessageRow row)
    {
        try
        {
            if (row.ConversationId is not { } id) return;
            await OpenNotificationAsync(id);
            for (var attempt = 0; attempt < 20; attempt++)
            {
                if (timeline.Items.FirstOrDefault(i => i.Message?.Id == row.Id) is { } target) { ScrollToMessage(target); return; }
                await Task.Delay(150);
            }
        }
        catch (Exception ex) { AppLog.Error("Open media message failed", ex); }
    }
    private void OnProfile(object sender, RoutedEventArgs e) { if (!sending && capture == null && !recordingBusy && !profileSaving) ShowProfile(false); }
    private void CloseProfile()
    {
        if (nativeSettings != null) nativeSettings.Visibility = Visibility.Collapsed;
        if (nativeTemplates != null) nativeTemplates.Visibility = Visibility.Collapsed;
        if (nativeMedia != null) nativeMedia.Visibility = Visibility.Collapsed;
        if (profilePanel != null) { ContentHost.Children.Remove(profilePanel); profilePanel = null; }
        InboxGrid.Visibility = Visibility.Visible;
    }
    private void DisposeWorkspacePanels()
    {
        workspacePanelVersion++;
        CloseProfile();
        if (nativeSettings != null) { nativeSettings.Dispose(); ContentHost.Children.Remove(nativeSettings); nativeSettings = null; }
        if (nativeTemplates != null) { nativeTemplates.Dispose(); ContentHost.Children.Remove(nativeTemplates); nativeTemplates = null; }
        if (nativeMedia != null) { nativeMedia.Dispose(); ContentHost.Children.Remove(nativeMedia); nativeMedia = null; }
        UpdateNavigation();
    }
    private void ShowProfile(bool settings)
    {
        if (workspace == null) return;
        var offset = settings && showingPreferences && profilePanel != null ? FindScrollViewer(profilePanel)?.VerticalOffset ?? 0 : 0;
        showingPreferences = settings;
        SignOutButton = new Button { Style = (Style)Application.Current.Resources["PlainButton"], HorizontalAlignment = HorizontalAlignment.Left, CornerRadius = new CornerRadius(12), Padding = new Thickness(16, 10, 16, 10) };
        SignOutButton.Click += OnSignOut;
        CloseProfile(); InboxGrid.Visibility = Visibility.Collapsed;
        profilePanel = new Grid { Background = WebBrush.Get(Shell, "SurfaceBrush") };
        profilePanel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(72) });
        profilePanel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        profilePanel.Children.Add(Header("MyProfile"));
        var body = new Grid(); Grid.SetRow(body, 1); profilePanel.Children.Add(body);
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(224) }); body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var nav = new StackPanel { Padding = new Thickness(12), Spacing = 4 };
        foreach (var key in new[] { "Profile", "Preferences" })
        {
            var activeSection = settings == (key == "Preferences");
            var button = Action(key, () => ShowProfile(key == "Preferences"));
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 }; row.Children.Add(new LucideIcon { Kind = key == "Profile" ? "user" : "sliders", Size = 16 }); row.Children.Add(Label(key)); button.Content = row;
            button.HorizontalAlignment = HorizontalAlignment.Stretch;
            button.BorderThickness = new Thickness(0); button.HorizontalContentAlignment = HorizontalAlignment.Left; button.Padding = new Thickness(16, 12, 16, 12);
            button.Background = activeSection ? WebBrush.Get(Shell, "PanelBrush") : new SolidColorBrush(Microsoft.UI.Colors.Transparent);
            button.FontWeight = activeSection ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal;
            nav.Children.Add(button);
        }
        body.Children.Add(new Border { BorderThickness = new Thickness(0, 0, 1, 0), BorderBrush = WebBrush.Get(Shell, "LineBrush"), Child = nav });
        var content = new Grid(); Grid.SetColumn(content, 1); body.Children.Add(content);
        content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(72) }); content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); content.Children.Add(Header(settings ? "Preferences" : "Profile"));
        var stack = new StackPanel { Spacing = 24, MaxWidth = 768, HorizontalAlignment = HorizontalAlignment.Left };
        content.SizeChanged += (_, e) => stack.Width = Math.Max(0, Math.Min(768, e.NewSize.Width - 64));
        var scroll = new ScrollViewer { Content = stack, Padding = new Thickness(32), HorizontalContentAlignment = HorizontalAlignment.Left, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        if (offset > 0) scroll.Loaded += (_, _) => DispatcherQueue.TryEnqueue(() => scroll.ChangeView(null, offset, null, true));
        Grid.SetRow(scroll, 1); content.Children.Add(scroll);
        if (settings) BuildPreferences(stack); else BuildProfile(stack);
        profileStatus = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 14, Foreground = WebBrush.Get(Shell, "ChatAccentBrush") }; stack.Children.Add(profileStatus);
        ContentHost.Children.Add(profilePanel); UpdateNavigation();
    }
    private Border Header(string key) => new() { BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = WebBrush.Get(Shell, "LineBrush"), Padding = new Thickness(20, 0, 20, 0), Child = new TextBlock { Text = UiStrings.Get(key), FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center } };
    private void BuildProfile(StackPanel stack)
    {
        var avatar = new WebAvatar { AvatarSize = 80 }; avatar.Set(workspace!.Agent.Name, workspace.Agent.Id);
        _ = SetPhotoAsync(avatar);
        var photo = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 }; photo.Children.Add(avatar);
        var details = new StackPanel { Spacing = 8 }; details.Children.Add(Label("ProfilePhoto")); details.Children.Add(Label("PhotoLimit", 12));
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        buttons.Children.Add(Action(workspace.Agent.Picture == null ? "UploadPhoto" : "ChangePhoto", async () =>
        {
            try
            {
                if (client == null) return;
                var picker = new FileOpenPicker(); foreach (var ext in new[] { ".png", ".jpg", ".jpeg", ".webp" }) picker.FileTypeFilter.Add(ext); ChatMedia.InitializePicker(picker);
                if (await picker.PickSingleFileAsync() is not { } file) return;
                await ChangeProfileAsync(async () =>
                {
                    if ((await file.GetBasicPropertiesAsync()).Size > 2 * 1024 * 1024) throw new ArgumentException();
                    var bytes = await File.ReadAllBytesAsync(file.Path); await client.UploadProfilePhotoAsync(workspace, bytes, file.ContentType);
                }, "PhotoError");

            }
            catch (Exception callbackError) { AppLog.Error("UI callback failed in MainWindow.Preferences", callbackError); ReportCallbackError(callbackError); }
        }));
        if (workspace.Agent.Picture != null) buttons.Children.Add(Action("RemovePhoto", async () => await UiCallback.RunAsync(async () => await ChangeProfileAsync(() => client!.UpdateProfileAsync(workspace, updatePicture: true), "ProfileError"), "MainWindow.Preferences callback")));
        details.Children.Add(buttons); photo.Children.Add(details); stack.Children.Add(Card(photo, 20));
        var form = new StackPanel { Spacing = 16 }; form.Children.Add(Label("YourName"));
        var name = new TextBox { Text = workspace.Agent.Name, MaxLength = 200, CornerRadius = new CornerRadius(12) }; form.Children.Add(name);
        var save = Action("SaveName", async () => await UiCallback.RunAsync(async () => await ChangeProfileAsync(() => client!.UpdateProfileAsync(workspace, name.Text), "ProfileError"), "MainWindow.Preferences callback"));
        save.Background = WebBrush.Get(Shell, "ChatAccentBrush"); save.Foreground = new SolidColorBrush(Microsoft.UI.Colors.White);
        save.HorizontalAlignment = HorizontalAlignment.Left; save.IsEnabled = false; name.TextChanged += (_, _) => save.IsEnabled = name.Text.Trim().Length > 0 && name.Text.Trim() != workspace.Agent.Name;
        form.Children.Add(save); stack.Children.Add(form);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(SignOutButton, UiStrings.Get("SignOut"));
        SignOutButton.Content = UiStrings.Get("SignOut"); stack.Children.Add(SignOutButton);
    }
    private bool profileSaving;
    private async Task ChangeProfileAsync(Func<Task> update, string errorKey)
    {
        if (profileSaving) return;
        profileSaving = true;
        var disabled = new List<(Control Control, bool WasEnabled)>();
        void Disable(DependencyObject node)
        {
            if (node is Control control) { disabled.Add((control, control.IsEnabled)); control.IsEnabled = false; }
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) Disable(VisualTreeHelper.GetChild(node, i));
        }
        if (profilePanel != null) Disable(profilePanel);
        try
        {
            await update(); await UpdateMemberPhotoAsync(); ShowProfile(false);
            if (profileStatus != null) profileStatus.Text = UiStrings.Get("ProfileUpdated");
        }
        catch (Exception ex) { AppLog.Error("MainWindow.Preferences operation failed", ex); ShowChatError(UiStrings.Get(errorKey)); }
        finally { profileSaving = false; foreach (var (control, enabled) in disabled) control.IsEnabled = enabled; }
    }
    private async Task SetPhotoAsync(WebAvatar avatar)
    {
        if (client == null || workspace?.Agent.Picture is not { } path) return;
        try { avatar.SetPhoto(await client.Media.GetUrlAsync(path)); } catch (Exception ex) { AppLog.Error("MainWindow.Preferences operation failed", ex); /* Initials remain available offline. */ }
    }
    private async Task UpdateMemberPhotoAsync()
    {
        if (workspace == null) return;
        MemberAvatar.Set(workspace.Agent.Name, workspace.Agent.Id); await SetPhotoAsync(MemberAvatar);
    }
    private TextBlock Label(string key, double size = 14) => new() { Text = UiStrings.Get(key), FontSize = size, TextWrapping = TextWrapping.Wrap };
    private Border Card(UIElement child, double padding = 16) => new() { Child = child, Padding = new Thickness(padding), CornerRadius = new CornerRadius(16), BorderThickness = new Thickness(1), BorderBrush = WebBrush.Get(Shell, "LineBrush"), HorizontalAlignment = HorizontalAlignment.Stretch };
    // Layout and order mirror web/components/profile-panel.tsx.
    private void BuildPreferences(StackPanel stack)
    {
        StackPanel Section(string title)
        {
            var section = new StackPanel { Spacing = 16 }; var heading = Label(title, 12);
            heading.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; heading.Foreground = WebBrush.Get(Shell, "SubBrush");
            section.Children.Add(heading); stack.Children.Add(section); return section;
        }
        FrameworkElement Choice(string key, string[] values, string[] labels, string current, Action<string> changed, bool vertical = false)
        {
            var field = new StackPanel { Spacing = 12 }; var legend = Label(key); legend.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; field.Children.Add(legend);
            var options = new Grid { RowSpacing = 4, ColumnSpacing = 4 }; var group = Guid.NewGuid().ToString();
            for (var i = 0; i < values.Length; i++)
            {
                var value = values[i];
                if (vertical) options.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                else options.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                object label = UiStrings.Get(labels[i]);
                if (vertical)
                {
                    var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
                    row.Children.Add(new LucideIcon { Kind = value == "light" ? "sun" : value == "dark" ? "moon" : "monitor", Size = 20 }); row.Children.Add(Label(labels[i])); label = row;
                }
                var radio = new RadioButton
                {
                    Content = label,
                    GroupName = group,
                    IsChecked = value == current,
                    Template = ProfileControls.RadioTemplate(vertical),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Stretch,
                    MinWidth = 0,
                    MinHeight = 0
                };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(radio, UiStrings.Get(labels[i]));
                radio.Checked += (_, _) => changed(value);
                if (vertical) Grid.SetRow(radio, i); else Grid.SetColumn(radio, i); options.Children.Add(radio);
            }
            field.Children.Add(Card(options, vertical ? 8 : 4)); return field;
        }
        Grid Toggle(string key, bool value, Action<bool> changed)
        {
            var row = new Grid { ColumnSpacing = 12 }; row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var label = Label(key); label.FontWeight = Microsoft.UI.Text.FontWeights.Medium; label.VerticalAlignment = VerticalAlignment.Center; row.Children.Add(label);
            var toggle = ProfileControls.Switch(Shell, value, changed);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(toggle, UiStrings.Get(key));
            Grid.SetColumn(toggle, 1); row.Children.Add(toggle); return row;
        }
        var languageSection = Section("Language");
        var language = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, Height = 42, CornerRadius = new CornerRadius(12), Background = WebBrush.Get(Shell, "InputBrush"), ItemsSource = new[] { "English", "Portugu\u00eas (Brasil)" }, SelectedIndex = preferences.Language == "pt-BR" ? 1 : 0 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(language, UiStrings.Get("Language"));
        language.SelectionChanged += (_, _) =>
        {
            var value = language.SelectedIndex == 1 ? "pt-BR" : "en"; if (value == preferences.Language) return;
            SavePreferences(preferences with { Language = value }); Relocalize(); ShowProfile(true);
        }; languageSection.Children.Add(language);
        var appearance = Section("Appearance");
        appearance.Children.Add(Choice("Theme", ["light", "dark", "system"], ["Light", "Dark", "System"], preferences.Theme, value => { SavePreferences(preferences with { Theme = value }); ShowProfile(true); }, true));
        var font = new StackPanel { Spacing = 8 };
        font.Children.Add(Choice("FontSize", ["small", "default", "large"], ["Small", "Default", "Large"], preferences.FontSize, value => { SavePreferences(preferences with { FontSize = value }); ShowProfile(true); }));
        var hint = Label("FontPreview"); hint.Foreground = WebBrush.Get(Shell, "SubBrush"); font.Children.Add(hint); appearance.Children.Add(font);
        var backgrounds = new StackPanel { Spacing = 12 }; var backgroundHeading = Label("ChatBackground"); backgroundHeading.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; backgrounds.Children.Add(backgroundHeading);
        var swatches = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        foreach (var bg in DevicePreferences.Backgrounds)
        {
            var swatch = new Button { Width = 40, Height = 40, CornerRadius = new CornerRadius(20), Padding = new Thickness(0), Content = preferences.ChatBackground == bg ? "\u2713" : "", Background = WebBrush.Color((preferences with { ChatBackground = bg }).BackgroundColor(Shell.ActualTheme == ElementTheme.Dark)), BorderThickness = new Thickness(preferences.ChatBackground == bg ? 2 : 1), BorderBrush = WebBrush.Get(Shell, preferences.ChatBackground == bg ? "ChatAccentBrush" : "LineBrush") };
            ToolTipService.SetToolTip(swatch, UiStrings.Get(bg)); Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(swatch, UiStrings.Get(bg));
            swatch.Click += (_, _) => { SavePreferences(preferences with { ChatBackground = bg }); ShowProfile(true); }; swatches.Children.Add(swatch);
        }
        backgrounds.Children.Add(swatches); appearance.Children.Add(backgrounds);
        appearance.Children.Add(Toggle("ShowDrawings", preferences.ChatWallpaper, value => { SavePreferences(preferences with { ChatWallpaper = value }); ShowProfile(true); }));
        var preview = new Grid { Background = WebBrush.Color(preferences.BackgroundColor(Shell.ActualTheme == ElementTheme.Dark)), Padding = new Thickness(16) };
        if (preferences.ChatWallpaper) preview.Children.Add(new ChatWallpaper());
        var bubbles = new StackPanel { Spacing = 12 };
        bubbles.Children.Add(new Border { Child = MessageBubble.CreateMessageText(UiStrings.Get("HiHelp")), Background = WebBrush.Get(Shell, "ReceivedBubbleBrush"), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 8, 12, 8), HorizontalAlignment = HorizontalAlignment.Left });
        bubbles.Children.Add(new Border { Child = MessageBubble.CreateMessageText(UiStrings.Get("LearnMore")), Background = WebBrush.Get(Shell, "SentBubbleBrush"), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 8, 12, 8), HorizontalAlignment = HorizontalAlignment.Right });
        preview.Children.Add(bubbles); appearance.Children.Add(Card(preview, 0));
        var chats = Section("Chats"); var enter = new StackPanel { Spacing = 8 };
        enter.Children.Add(Toggle("EnterToSend", preferences.EnterToSend, value => { SavePreferences(preferences with { EnterToSend = value }); ShowProfile(true); }));
        var enterHint = Label(preferences.EnterToSend ? "ShiftEnterHint" : "CtrlEnterHint", 12); enterHint.Foreground = WebBrush.Get(Shell, "SubBrush"); enter.Children.Add(enterHint); chats.Children.Add(Card(enter));
        var signatures = Section("Signature"); var signatureCard = new StackPanel { Spacing = 16 };
        signatureCard.Children.Add(Toggle("SignMessages", preferences.SignatureEnabled, value => { SavePreferences(preferences with { SignatureEnabled = value }); ShowProfile(true); }));
        var signatureField = new StackPanel { Spacing = 8 }; signatureField.Children.Add(Label("SignatureName"));
        var signature = new TextBox { Text = preferences.SignatureName, MaxLength = 40, PlaceholderText = workspace!.Agent.Name, CornerRadius = new CornerRadius(12), Background = WebBrush.Get(Shell, "InputBrush") }; signatureField.Children.Add(signature); signatureCard.Children.Add(signatureField);
        var signaturePreview = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Stretch };
        void PreviewSignature() => signaturePreview.Content = MessageBubble.CreateMessageText((string)preferences.Sign(new Newtonsoft.Json.Linq.JObject { ["type"] = "text", ["kind"] = "text", ["text"] = UiStrings.Get("HiHelp") }, workspace.Agent.Name)["text"]!);
        signature.TextChanged += (_, _) => { SavePreferences(preferences with { SignatureName = signature.Text }); PreviewSignature(); };
        PreviewSignature(); signatureCard.Children.Add(new Border { Child = signaturePreview, Background = WebBrush.Get(Shell, "SentBubbleBrush"), Padding = new Thickness(12, 8, 12, 8), CornerRadius = new CornerRadius(12), MaxWidth = 384, HorizontalAlignment = HorizontalAlignment.Right }); signatures.Children.Add(Card(signatureCard));
        var notificationsSection = Section("Notifications"); var notificationsCard = new StackPanel { Spacing = 16 };
        var soundRow = new Grid { ColumnSpacing = 12 }; soundRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); soundRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        soundRow.Children.Add(Toggle("NotificationSound", preferences.NotificationSound, value => SavePreferences(preferences with { NotificationSound = value })));
        var test = Action("Test", DesktopNotifications.PlaySound); Grid.SetColumn(test, 1); soundRow.Children.Add(test); notificationsCard.Children.Add(soundRow);
        var desktopHint = Label("DesktopHint", 12);
        notificationsCard.Children.Add(Toggle("DesktopNotifications", preferences.DesktopNotifications, value =>
        {
            SavePreferences(preferences with { DesktopNotifications = value && notifications.CanNotify });
            if (value && !notifications.CanNotify) { ShowProfile(true); if (profileStatus != null) profileStatus.Text = UiStrings.Get("AllowDesktopNotifications"); }
        })); desktopHint.Foreground = WebBrush.Get(Shell, "SubBrush"); notificationsCard.Children.Add(desktopHint);
        notificationsCard.Children.Add(Toggle("FlashTaskbar", preferences.FlashTaskbar, value => SavePreferences(preferences with { FlashTaskbar = value })));
        var flashHint = Label("FlashTaskbarHint", 12); flashHint.Foreground = WebBrush.Get(Shell, "SubBrush"); notificationsCard.Children.Add(flashHint); notificationsSection.Children.Add(Card(notificationsCard));
        stack.Children.Add(Choice("AudioSpeed", ["1", "1.5", "2"], ["AudioRate1", "AudioRate15", "AudioRate2"], preferences.AudioRate.ToString(CultureInfo.InvariantCulture), value => SavePreferences(preferences with { AudioRate = double.Parse(value, CultureInfo.InvariantCulture) })));
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(SignOutButton, UiStrings.Get("SignOut"));
        SignOutButton.Content = UiStrings.Get("SignOut"); stack.Children.Add(SignOutButton);
    }
    private void Relocalize()
    {
        var previous = UiStrings.Keys.Select(key => (Key: key, Value: UiStrings.Get(key))).ToArray();
        CultureInfo.CurrentUICulture = CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.GetCultureInfo(preferences.Language == "pt-BR" ? "pt-BR" : "en-US");
        var translations = previous.GroupBy(p => p.Value).ToDictionary(g => g.Key, g => UiStrings.Get(g.First().Key));
        string Translate(string text) => translations.GetValueOrDefault(text, text);
        void Refresh(DependencyObject node)
        {
            if (node == MessageList) { if (MessageList.Header is DependencyObject header) Refresh(header); return; }
            if (node == Conversations || node == ChatName || node is WebAvatar) return;
            if (node is TextBlock text) text.Text = Translate(text.Text);
            if (node is ContentControl control && control.Content is string value) control.Content = Translate(value);
            if (node is TextBox box) box.PlaceholderText = Translate(box.PlaceholderText);
            if (node is FrameworkElement element)
            {
                var name = Microsoft.UI.Xaml.Automation.AutomationProperties.GetName(element);
                if (name.Length > 0) Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(element, Translate(name));
                if (ToolTipService.GetToolTip(element) is string tip) ToolTipService.SetToolTip(element, Translate(tip));
            }
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) Refresh(VisualTreeHelper.GetChild(node, i));
        }
        Refresh(Shell);
        NewChatExplanation.Inlines.Clear();
        NewChatExplanation.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = UiStrings.Get("NewChatFirstMessage") });
        NewChatExplanation.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = UiStrings.Get("ApprovedTemplate"), FontWeight = Microsoft.UI.Text.FontWeights.Bold });
        NewChatExplanation.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = UiStrings.Get("NewChatTestNotice") });
        NewChatInstance.PlaceholderText = UiStrings.Get("ChooseInstance");
        Shell.Language = CultureInfo.CurrentUICulture.Name;
        Search.PlaceholderText = UiStrings.Get("Search"); Composer.PlaceholderText = UiStrings.Get("TypeMessage");
        AllFilter.Content = UiStrings.Get("All"); UpdateNavigation(); ConfigureNumbers();
        timeline.Items.Clear(); RenderMessages();
    }
    private void OnListSearch(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs e) { CloseProfile(); Search.Focus(FocusState.Programmatic); e.Handled = true; }
    private void OnChatSearch(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs e) { if (selected == null) return; searchBar!.Visibility = Visibility.Visible; chatSearch!.Focus(FocusState.Programmatic); e.Handled = true; }
    private void OnEscape(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs e) { if (NewChatPanel.Visibility == Visibility.Visible) CloseNewChat(); else if (searchBar?.Visibility == Visibility.Visible) CloseSearch(); else Search.Text = ""; e.Handled = true; }
    private void CloseSearch() { searchBar!.Visibility = Visibility.Collapsed; chatSearch!.Text = ""; }
    private string[] SearchMatches() => ConversationSearch.Messages(messages, chatSearch?.Text ?? "", templates).ToArray();
    private void MoveSearch(int delta) { var count = SearchMatches().Length; if (count > 0) matchIndex = (matchIndex + delta + count) % count; UpdateSearch(); }
    private void ScrollToMessage(MessageItem target)
    {
        if (closed || !timeline.Items.Contains(target)) return;
        bottomAnchor.ScrollUp();
        if (messageScroll is not { } scroll) return;
        if (MessageList.ContainerFromItem(target) is FrameworkElement element)
        {
            var bounds = element.TransformToVisual(scroll).TransformBounds(new global::Windows.Foundation.Rect(0, 0, element.ActualWidth, element.ActualHeight));
            if (bounds.Top >= 0 && bounds.Bottom <= scroll.ViewportHeight) return;
        }
        bottomAnchor.BeginProgrammaticScroll();
        try { MessageList.ScrollIntoView(target, ScrollIntoViewAlignment.Leading); }
        catch (Exception ex) { bottomAnchor.EndProgrammaticScroll(); AppLog.Error("Message jump failed", ex); }
    }

    private void UpdateSearch(bool navigate = true)
    {
        var matches = SearchMatches(); if (matchIndex >= matches.Length) matchIndex = 0;
        searchPosition!.Text = (chatSearch?.Text.Trim().Length ?? 0) < 2 ? "" : matches.Length == 0 ? UiStrings.Get("NoResults") : $"{matchIndex + 1} / {matches.Length}";
        foreach (var item in timeline.Items.ToArray()) item.SetSearchMatch(matches.Contains(item.Id));
        if (navigate && matches.Length > 0 && timeline.Items.FirstOrDefault(i => i.Id == matches[matchIndex]) is { } target) { ScrollToMessage(target); }
    }
}

