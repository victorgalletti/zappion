// SPDX-License-Identifier: AGPL-3.0-only
using System.Diagnostics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
using Microsoft.UI.Xaml.Input;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow : Window
{
    private readonly MessageTimeline timeline = new();
    private readonly DesktopNotifications notifications;
    private readonly DateTimeOffset startedAt = DateTimeOffset.UtcNow;
    private MessageNotifications notificationPolicy = new(DateTimeOffset.UtcNow);
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer reconnectTimer;
    private bool connecting;
    private bool connected;
    private DateTimeOffset lastConnected = DateTimeOffset.UtcNow;
    private int loadingChatVersion;
    private readonly ChatLoadBuffer chatLoads = new();
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer conversationChangeTimer;
    private bool conversationRefreshRequired;
    private bool refreshing;
    private bool inboxLoaded;
    private bool reloadChatAfterReconnect;
    private bool recovering;
    private bool refreshPending;
    private string pendingRefreshReason = "reconnect";
    private bool closed;
    private string? pendingConversation;
    private DateTimeOffset lastTick = DateTimeOffset.UtcNow;
    private ZappionClient? client;
    private bool busy;
    private bool initialized;
    private Workspace? workspace;
    private ConversationView? selected;
    private IReadOnlyList<MessageRow> messages = Array.Empty<MessageRow>();
    private MessageRow? lastIncoming;
    private bool active;
    private bool sending;
    private int chatVersion;
    private readonly Dictionary<string, string> drafts = new();
    private readonly HashSet<string> markedRead = new();
    private readonly HashSet<string> markingRead = new();
    private WindowMinimum? minimum;
    private IReadOnlyList<ConversationView> allConversations = Array.Empty<ConversationView>();
    private bool unreadOnly;

    internal MainWindow(DesktopNotifications notifications)
    {
        InitializeLanguage();
        InitializeComponent();
        InitializeStepSix();
        NewChatIcon.SetStroke(new SolidColorBrush(Colors.White));
        ChatMedia.Owner = this;
        MessageList.ItemsSource = timeline.Items;
        // The chat starts collapsed; its ScrollViewer may be created after Loaded.
        MessageList.LayoutUpdated += DiscoverMessageScroll;
        SignInPanel.SizeChanged += (_, e) =>
        {
            var padding = e.NewSize.Width >= 1024 ? 48 : e.NewSize.Width >= 640 ? 32 : 16;
            SignInCard.Margin = new Thickness(padding);
            SignInCard.Width = Math.Max(0, Math.Min(1152, e.NewSize.Width - padding * 2));
            // A desktop window is shorter than a browser page: fit the card to the height and drop the
            // brand panel's demo chat, then the panel itself, before the page has to scroll.
            var height = e.NewSize.Height - padding * 2;
            var desktop = e.NewSize.Width >= 1024 && height >= 600;
            SignInCard.MinHeight = desktop ? Math.Min(700, height) : 0;
            LoginDemo.Visibility = height >= 820 ? Visibility.Visible : Visibility.Collapsed;
            LoginHeadline.FontSize = height >= 720 ? 48 : 40;
            LoginHeadline.LineHeight = height >= 720 ? 60 : 50;
            LoginDescription.Margin = new Thickness(0, 20, 0, LoginDemo.Visibility == Visibility.Visible ? 40 : 0);
            LoginBrandColumn.Width = desktop ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
            LoginBrandPanel.Visibility = desktop ? Visibility.Visible : Visibility.Collapsed;
            LoginCompactBrand.Visibility = desktop ? Visibility.Collapsed : Visibility.Visible;
        };
        Shell.Language = System.Globalization.CultureInfo.CurrentUICulture.Name;
        UpdateFilters();
        OpenSourceLabel.Text = UiStrings.Get("OpenSource").ToUpper(System.Globalization.CultureInfo.CurrentCulture);
        this.notifications = notifications;
        DesktopNotifications.AttachWindow(WinRT.Interop.WindowNative.GetWindowHandle(this));
        conversationChangeTimer = DispatcherQueue.CreateTimer();
        conversationChangeTimer.Interval = TimeSpan.FromMilliseconds(500);
        conversationChangeTimer.IsRepeating = false;
        InitializeSnapshots();
        conversationChangeTimer.Tick += async (_, _) => await UiCallback.RunAsync(async () =>
        {
            if (closed || client is null || workspace is null) return;
            var requiresRefresh = conversationRefreshRequired;
            conversationRefreshRequired = false;
            if (requiresRefresh) await RecoverAsync("realtime-conversation-change");
            else ReplaceConversations(client.ConversationViews());
        }, "Conversation change debounce");
        reconnectTimer = DispatcherQueue.CreateTimer();
        reconnectTimer.Interval = TimeSpan.FromSeconds(5);
        reconnectTimer.Tick += async (_, _) =>
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                var resumed = now - lastTick > TimeSpan.FromSeconds(20);
                lastTick = now;
                if (workspace is null || client is null) return;
                if (connected && !client.IsRealtimeConnected)
                {
                    connected = false;
                    Reconnecting.Visibility = Visibility.Visible;
                }
                if (resumed || (!connected && !connecting && now - lastConnected > TimeSpan.FromSeconds(30)))
                {
                    connected = false;
                    lastConnected = now;
                    client.StopRealtime();
                }
                await EnsureRealtimeAsync();
                if (refreshPending && !busy && !sending) await RecoverAsync();

            }
            catch (Exception callbackError) { AppLog.Error("UI callback failed in MainWindow.xaml", callbackError); ReportCallbackError(callbackError); }
        };
        reconnectTimer.Start();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico"));
        minimum = new WindowMinimum(this, 900, 600);
        Shell.ActualThemeChanged += (_, _) =>
        {
            UpdateCaptionTheme();
            UpdateFilters();
            if (selected is not null) RenderMessages();
        };
        Activated += async (_, e) =>
        {
            try
            {
                active = e.WindowActivationState != WindowActivationState.Deactivated;
                if (active && nativeSettings != null) await nativeSettings.OnActivatedAsync();
                UpdateServiceWindow();
                RenderMessages();
                await MarkReadAsync();

            }
            catch (Exception callbackError) { AppLog.Error("UI callback failed in MainWindow.xaml", callbackError); ReportCallbackError(callbackError); }
        };
        UpdateCaptionTheme();
        AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1280, 800));
        Closed += (_, _) =>
        {
            closed = true; chatVersion++; conversationChangeTimer.Stop(); reconnectTimer.Stop(); windowTimer?.Stop(); minimum?.Dispose();
            DisposeWorkspacePanels();
            DesktopNotifications.SetBadge(0);
            notifications.Dispose(); client?.Dispose();
            _ = CancelRecordingAsync();
            ClearAttachments();
            ChatMedia.Cache = null;
        };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
#if DEBUG
        if (Environment.GetEnvironmentVariable("ZAPPION_LAYOUT_REVIEW") is { Length: > 0 } folder)
        {
            reconnectTimer.Stop();
            await CaptureLayoutReviewAsync(folder);
            return;
        }
#endif
            await InitializeAsync();
#if DEBUG
            if (Environment.GetEnvironmentVariable("ZAPPION_TASK_F_VERIFY") == "1") await VerifyTaskFAsync();
            if (Environment.GetEnvironmentVariable("ZAPPION_TASK_C_VERIFY") == "1") await VerifyTaskCAsync();
            if (Environment.GetEnvironmentVariable("ZAPPION_TASK_B_VERIFY") == "1") await VerifyTaskBAsync();
            if (Environment.GetEnvironmentVariable("ZAPPION_TASK_A_VERIFY") == "1") await VerifyTaskAAsync();
#endif
        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnLoaded failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }

    private async Task InitializeAsync()
    {
        if (busy) return;
        SetBusy(true);
        try
        {
            if (client is null)
            {
                client = new ZappionClient(AppConfiguration.Load(AppContext.BaseDirectory),
                    new FileSessionPersistence(VerificationStorage.FilePath("session.json")),
                    new LastReadStore(VerificationStorage.FilePath("last-read.json")))
                { Preferences = preferences };
                client.TemplatesChanged += (organizationId, address) => DispatcherQueue.TryEnqueue(() =>
                {
                    if (!closed && workspace?.OrganizationId == organizationId && selected is { } current && current.Primary.OrganizationAddress == address)
                    {
                        if (loadingTemplates) templatesReloadPending = true;
                        else _ = LoadTemplatesAsync(current);
                    }
                });
                client.ApprovalsChanged += () => DispatcherQueue.TryEnqueue(async () => await UiCallback.RunAsync(LoadApprovalsAsync, "Approvals change"));
                client.MessageChanged += (row, insert) => DispatcherQueue.TryEnqueue(async () => await UiCallback.RunAsync(async () => await ApplyRealtimeAsync(row, insert), "MainWindow.xaml callback"));
                client.ConversationsChanged += row => DispatcherQueue.TryEnqueue(() =>
                {
                    if (closed || client is null || workspace is null) return;
                    if (row is not null && !string.IsNullOrEmpty(row.OrganizationId) && row.OrganizationId != workspace.OrganizationId) return;
                    conversationRefreshRequired |= !client.ApplyConversation(row);
                    conversationChangeTimer.Stop();
                    conversationChangeTimer.Start();
                });
                client.ConnectionChanged += value => DispatcherQueue.TryEnqueue(async () =>
                {
                    try
                    {
                        if (closed || workspace is null) return;
                        connected = value;
                        if (value) lastConnected = DateTimeOffset.UtcNow;
                        Reconnecting.Visibility = value ? Visibility.Collapsed : Visibility.Visible;
                        if (value) { reloadChatAfterReconnect = true; refreshPending = true; await RecoverAsync("reconnect"); }

                    }
                    catch (Exception callbackError) { AppLog.Error("UI callback failed in MainWindow.xaml", callbackError); ReportCallbackError(callbackError); }
                });
            }
            await client.InitializeAsync();
            ChatMedia.Cache = client.Media;
            initialized = true;
            await ShowSessionAsync();
        }
        catch (Exception ex) { AppLog.Error("MainWindow.xaml operation failed", ex); ShowError(ex); }
        finally { SetBusy(false); }
    }

    private async Task ShowSessionAsync()
    {
        SignInPanel.Visibility = Visibility.Collapsed;
        WorkspacePanel.Visibility = Visibility.Collapsed;
        NoOrganization.Visibility = Visibility.Collapsed;
        if (invitationInbox != null) { Shell.Children.Remove(invitationInbox); invitationInbox = null; }
        var signedIn = client?.Session?.User is not null;
        SignOutButton.Visibility = signedIn ? Visibility.Visible : Visibility.Collapsed;
        if (!signedIn)
        {
            CloseNewChat(); NewChatNumber.Text = ""; chosenNewChatInstance = null;
            DisposeWorkspacePanels(); archivedView = false; UpdateNavigation();
            ChatMedia.Cache = null;
            ClearAttachments();
            OrganizationName.Text = UiStrings.Get("ProductName");
            AgentName.Text = "";
            client?.StopRealtime();
            connected = false;
            Reconnecting.Visibility = Visibility.Collapsed;
            DesktopNotifications.SetBadge(0);
            ClearApprovals();
            timeline.Items.Clear();
            conversationChangeTimer.Stop();
            conversationRefreshRequired = false;
            reloadChatAfterReconnect = false;
            refreshPending = false;
            allConversations = Array.Empty<ConversationView>();
            inboxLoaded = false;
            workspace = null;
            selected = null;
            chatVersion++;
            messages = Array.Empty<MessageRow>();
            lastIncoming = null;
            drafts.Clear();
            markedRead.Clear();
            ChatPanel.Visibility = Visibility.Collapsed;
            SelectChat.Visibility = Visibility.Visible;
            Conversations.ItemsSource = null;
            SignInPanel.Visibility = Visibility.Visible;
            return;
        }
        inboxLoaded = false;
        var restored = await Task.Run(() => client!.TryRestoreSnapshot(client.Session!.User!.Id!));
        if (restored is not null)
        {
            workspace = restored;
            ShowWorkspaceHeader();
            ReplaceConversations(client!.ConversationViews());
            WorkspacePanel.Visibility = Visibility.Visible;
            Progress.Visibility = Visibility.Collapsed;
            UpdateServiceWindow();
        }
        var nextWorkspace = await client!.GetWorkspaceAsync();
        if (workspace?.OrganizationId != nextWorkspace?.OrganizationId)
        {
            WorkspacePanel.Visibility = Visibility.Collapsed;
            selected = null; chatVersion++; messages = []; timeline.Items.Clear();
            ChatPanel.Visibility = Visibility.Collapsed; SelectChat.Visibility = Visibility.Visible;
            allConversations = []; Conversations.ItemsSource = null;
        }
        if (workspace?.OrganizationId != nextWorkspace?.OrganizationId) DisposeWorkspacePanels();
        workspace = nextWorkspace;
        ChatMedia.Cache = client.Media;
        if (workspace is null)
        {
            await ShowInvitationInboxAsync();
            return;
        }
        ShowWorkspaceHeader();
        await UpdateMemberPhotoAsync();
        var conversations = await client.GetConversationsAsync(workspace.OrganizationId);
        ReplaceConversations(conversations);
        inboxLoaded = true;
        _ = LoadApprovalsAsync();
        QueueSnapshotSave();
        UpdateServiceWindow();
        if (selected is not null) await LoadChatAsync();
        notificationPolicy = new MessageNotifications(startedAt);
        _ = EnsureRealtimeAsync();
        if (pendingConversation is { } pending) await OpenNotificationAsync(pending);
        WorkspacePanel.Visibility = Visibility.Visible;
    }

    private async void OnSignIn(object sender, RoutedEventArgs e)
    {
        try
        {
            if (busy || client is null) return;
            if (string.IsNullOrWhiteSpace(Email.Text) || Password.Password.Length == 0)
            {
                ErrorBar.Message = UiStrings.Get("CredentialsRequired");
                ErrorBar.IsOpen = true;
                return;
            }
            SetBusy(true);
            try
            {
                await client.SignInAsync(Email.Text.Trim(), Password.Password);
                Password.Password = "";
                await ShowSessionAsync();
            }
            catch (Exception ex) { AppLog.Error("MainWindow.xaml operation failed", ex); ShowError(ex); }
            finally { SetBusy(false); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnSignIn failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }

    private void OnPasswordKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == global::Windows.System.VirtualKey.Enter) OnSignIn(sender, new RoutedEventArgs());
    }

    private async void OnSignOut(object sender, RoutedEventArgs e)
    {
        try
        {
            if (busy || client is null) return;
            SetBusy(true);
            try
            {
                await client.SignOutAsync();
                await ShowSessionAsync();
            }
            catch (Exception ex) { AppLog.Error("MainWindow.xaml operation failed", ex); ShowError(ex); }
            finally { SetBusy(false); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnSignOut failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }

    private async void OnRetry(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!initialized) { await InitializeAsync(); return; }
            if (busy) return;
            SetBusy(true);
            try { await ShowSessionAsync(); }
            catch (Exception ex) { AppLog.Error("MainWindow.xaml operation failed", ex); ShowError(ex); }
            finally { SetBusy(false); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnRetry failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }

    private void SetBusy(bool value)
    {
        busy = value;
        Progress.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
        SignInButton.IsEnabled = SignOutButton.IsEnabled = !value;
        Email.IsEnabled = Password.IsEnabled = !value;
        if (value)
        {
            ErrorBar.IsOpen = false;
            RetryButton.Visibility = Visibility.Collapsed;
        }
    }

    private void ShowError(Exception ex)
    {
        AppLog.Error("Session operation failed", ex);
        // Auth exceptions can contain server response bodies; keep token-bearing details out of UI.
        ErrorBar.Message = ex is Supabase.Gotrue.Exceptions.GotrueException
            ? UiStrings.Get("AuthError")
            : ex is Supabase.Postgrest.Exceptions.PostgrestException
                ? UiStrings.Get("WorkspaceError")
                : ex is System.Text.Json.JsonException
                    ? UiStrings.Get("ConfigError")
                    : UiStrings.Get("GenericError");
        ErrorBar.IsOpen = true;
        RetryButton.Visibility = Visibility.Visible;
    }
    private void UpdateCaptionTheme()
    {
        if (closed || SignInArrow == null) return;
        SignInArrow.SetStroke(WebBrush.Get(Shell, "SurfaceBrush"));
        var title = AppWindow.TitleBar;
        var dark = Shell.ActualTheme == ElementTheme.Dark;
        title.ButtonBackgroundColor = ((SolidColorBrush)WebBrush.Get(Shell, "PanelBrush")).Color;
        title.ButtonInactiveBackgroundColor = title.ButtonBackgroundColor;
        title.ButtonForegroundColor = ((SolidColorBrush)WebBrush.Get(Shell, "HeadingBrush")).Color;
        title.ButtonInactiveForegroundColor = dark ? Colors.Gray : Colors.DimGray;
        title.ButtonHoverBackgroundColor = dark ? ColorHelper.FromArgb(40, 255, 255, 255) : ColorHelper.FromArgb(25, 0, 0, 0);
        title.ButtonHoverForegroundColor = dark ? Colors.White : Colors.Black;
        title.ButtonPressedBackgroundColor = dark ? ColorHelper.FromArgb(60, 255, 255, 255) : ColorHelper.FromArgb(45, 0, 0, 0);
        title.ButtonPressedForegroundColor = dark ? Colors.White : Colors.Black;
    }

    private async void OnConversationSelected(object sender, SelectionChangedEventArgs e)
    {
        try
        {
#if DEBUG
        if (Environment.GetEnvironmentVariable("ZAPPION_LAYOUT_REVIEW") is { Length: > 0 }) return;
#endif
            if (Conversations.SelectedItem is not ConversationView conversation || conversation.Primary.Id == selected?.Primary.Id) return;
            if (selected is not null) drafts[NewConversation.DraftKey(selected)] = Composer.Text;
            await SelectConversationAsync(conversation);
        }
        catch (Exception ex) { AppLog.Error("Open conversation failed", ex); ReportCallbackError(ex); }
    }

    private async Task SelectConversationAsync(ConversationView conversation)
    {
        ClearAttachments();
        selected = conversation;
        CloseSearch();
        ClearReply(); CloseTemplatePicker(); templates = [];
        bottomAnchor.Open();
        Composer.Text = drafts.GetValueOrDefault(NewConversation.DraftKey(conversation), "");
        ChatName.Text = conversation.DisplayName;
        UpdateChatHeader(conversation);
        ChatPanel.Visibility = Visibility.Visible;
        SelectChat.Visibility = Visibility.Collapsed;
        ChatError.IsOpen = false;
        await LoadChatAsync(forceBottom: true);
        if (IsCurrent(conversation) && NewConversation.IsDraft(selected)) OnTemplates(this, new RoutedEventArgs());

    }

    private async Task LoadChatAsync(bool forceBottom = false)
    {
        if (selected is null || client is null) return;
        var timer = Stopwatch.StartNew();
        int? messageCount = null;
        var conversation = selected;
        var version = ++chatVersion;
        loadingChatVersion = version;
        var request = chatLoads.Begin();
        try
        {
            var cached = client.Messages.Get(conversation.MemberIds);
            var cachedRows = cached?.Rows ?? Array.Empty<MessageRow>();
            if (forceBottom || cachedRows.Count > 0)
            {
                messages = cachedRows;
                lastIncoming = ChatHistory.LastIncoming(cachedRows);
                UpdateServiceWindow();
                RenderMessages();
            }
            var incremental = cached is { IsStale: false } && cachedRows.Count > 0;
            if (!inboxLoaded) return;
            var history = incremental
                ? client.GetMessagesSinceAsync(conversation.MemberIds, cachedRows[^1].Timestamp)
                : client.GetMessagesAsync(conversation.MemberIds);
            var incoming = client.GetLastIncomingAsync(conversation.MemberIds);
            await Task.WhenAll(history, incoming);
            messageCount = history.Result.Count;
            if (closed || version != chatVersion || selected is null || !IsCurrent(conversation)) return;
            var merged = ChatHistory.Merge(incremental ? cachedRows : [], await history);
            if (!chatLoads.TryComplete(request, merged, ChatHistory.LastIncoming(merged, await incoming), out var loaded, out var latestIncoming)) return;
            client.Messages.Store(conversation.MemberIds, loaded);
            if (latestIncoming is not null) client.Messages.Upsert(latestIncoming);
            QueueSnapshotSave();
            messages = loaded;
            messageCount = loaded.Count;
            lastIncoming = latestIncoming;
            UpdateServiceWindow();
            _ = LoadTemplatesAsync(conversation);
            RenderMessages();
            await MarkReadAsync();
        }
        catch (Exception ex)
        {
            AppLog.Error("MainWindow.xaml operation failed", ex);
            if (version == chatVersion) ShowChatError(UiStrings.Get("LoadError"));
        }
        finally
        {
            if (loadingChatVersion == version) { loadingChatVersion = 0; chatLoads.Invalidate(); }
            AppLog.Info($"LoadChatAsync ms={timer.ElapsedMilliseconds} messages={messageCount?.ToString() ?? "unknown"} operation={(forceBottom ? "chat-open" : "refresh")}");
        }
    }

    private async Task MarkReadAsync()
    {
        if (!inboxLoaded) return;
        // Mirrors web/components/chat-room.tsx: only while this chat is visible and active.
        if (active && profilePanel == null && ChatPanel.Visibility == Visibility.Visible && selected is not null && client is not null && messages.LastOrDefault() is { } newest)
        {
            try
            {
                if (client.LastRead.Mark(selected.Primary.Id, newest.Timestamp)) ReplaceConversations(client.ConversationViews());
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { AppLog.Error("MainWindow.xaml operation failed", ex); ShowChatError(UiStrings.Get("SaveReadError")); }
        }
        var incoming = lastIncoming;
        if (!active || profilePanel != null || ChatPanel.Visibility != Visibility.Visible || selected is null || incoming is null || client is null ||
            incoming.Status?["read"] is { Type: not Newtonsoft.Json.Linq.JTokenType.Null } ||
            markedRead.Contains(incoming.Id) || !markingRead.Add(incoming.Id)) return;
        try { await client.MarkReadAsync(incoming.Id); markedRead.Add(incoming.Id); }
        catch (Exception ex) { AppLog.Error("MainWindow.xaml operation failed", ex); ShowChatError(UiStrings.Get("ReadError")); }
        finally { markingRead.Remove(incoming.Id); }
    }

    private void RenderMessages(bool forceBottom = false)
    {
        if (forceBottom) bottomAnchor.Resume();
        var bottom = bottomAnchor.Following;
        var hasNew = messages.Any(m => MessageHelpers.IsRenderable(m) && !timeline.Items.Any(i => i.Id == m.Id));
        timeline.Apply(messages);
        foreach (var item in timeline.Items.ToArray())
        {
            item.Reply = BeginReply; item.React = React; item.Jump = JumpToMessage; item.Decide = DecideMessage;
            item.SetApproval(ApprovalFor(item.Message));
            item.Present(messages, templates, selected?.DisplayName ?? "", WindowOpen);
        }
        if (searchBar?.Visibility == Visibility.Visible) UpdateSearch(navigate: false);
        if (bottom) QueueBottomScroll();
        else if (hasNew) NewMessages.Visibility = Visibility.Visible;
    }

    private readonly BottomAnchor bottomAnchor = new();
    private bool bottomScrollQueued;
    private ScrollViewer? messageScroll;

    private void ScrollToBottom()
    {
        bottomAnchor.Resume();
        QueueBottomScroll();
    }

    private void QueueBottomScroll()
    {
        if (!bottomAnchor.Following || bottomScrollQueued) return;
        NewMessages.Visibility = Visibility.Collapsed;
        bottomScrollQueued = DispatcherQueue.TryEnqueue(() =>
        {
            bottomScrollQueued = false;
            if (!bottomAnchor.Following || bottomAnchor.Programmatic || timeline.Items.Count == 0) return;
            if (closed || selected is null || messageScroll is not { } scroll ||
                BottomAnchor.ValidOffset(scroll.ScrollableHeight) is not { } offset) return;
            try
            {
                bottomAnchor.BeginProgrammaticScroll();
                if (!scroll.ChangeView(null, offset, null, true)) bottomAnchor.EndProgrammaticScroll();
            }
            catch (Exception ex)
            {
                bottomAnchor.EndProgrammaticScroll();
                AppLog.Error("Scroll to bottom failed", ex);
            }
        });
    }

    private void DiscoverMessageScroll(object? sender, object e) => OnMessagesLoaded(MessageList, new RoutedEventArgs());

    private void OnMessagesLoaded(object sender, RoutedEventArgs e)
    {
        var scroll = FindScrollViewer(MessageList);
        if (scroll is null || scroll == messageScroll) return;
        messageScroll = scroll;
        MessageList.LayoutUpdated -= DiscoverMessageScroll;
        scroll.ViewChanged += (_, args) =>
        {
            if (scroll != messageScroll || closed) return;
            var extentChanged = bottomAnchor.ViewChanged(scroll.ScrollableHeight, scroll.VerticalOffset, args.IsIntermediate);
            if (extentChanged || (!args.IsIntermediate && bottomAnchor.Following &&
                !BottomAnchor.IsAtBottom(scroll.ScrollableHeight, scroll.VerticalOffset))) QueueBottomScroll();
            if (BottomAnchor.IsAtBottom(scroll.ScrollableHeight, scroll.VerticalOffset))
                NewMessages.Visibility = Visibility.Collapsed;
        };
        // Wheel, pointer (including the scrollbar thumb) and keyboard are the reader's gestures.
        scroll.AddHandler(UIElement.PointerWheelChangedEvent, new PointerEventHandler((_, _) => bottomAnchor.UserInput()), true);
        scroll.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => bottomAnchor.UserInput()), true);
        scroll.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler((_, _) => bottomAnchor.UserInput()), true);
        scroll.RegisterPropertyChangedCallback(ScrollViewer.ExtentHeightProperty, (_, _) => QueueBottomScroll());
        scroll.SizeChanged += (_, _) => QueueBottomScroll();
        QueueBottomScroll();
    }
    private static ScrollViewer? FindScrollViewer(DependencyObject parent)
    {
        if (parent is ScrollViewer scroll) return scroll;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
            if (FindScrollViewer(VisualTreeHelper.GetChild(parent, i)) is { } child) return child;
        return null;
    }
    private void OnNewMessages(object sender, RoutedEventArgs e) => ScrollToBottom();

    private void OnComposerChanged(object sender, TextChangedEventArgs e)
    {
        if (SendButton is not null)
        {
            TemplatesButton.IsEnabled = inboxLoaded && !sending && !recordingBusy;
            var canSend = !string.IsNullOrWhiteSpace(Composer.Text) || attachments.Count > 0;
            SendButton.IsEnabled = WindowOpen && !sending && canSend;
            SendButton.Visibility = canSend ? Visibility.Visible : Visibility.Collapsed;
            if (MicButton is not null)
            {
                MicButton.Visibility = !canSend && capture is null ? Visibility.Visible : Visibility.Collapsed;
                MicButton.IsEnabled = WindowOpen && !sending && !recordingBusy;
            }
        }
    }

    private void OnComposerKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != global::Windows.System.VirtualKey.Enter) return;
        var ctrl = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(global::Windows.System.VirtualKey.Control);
        if (!preferences.EnterToSend && (ctrl & global::Windows.UI.Core.CoreVirtualKeyStates.Down) == 0) return;
        var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(global::Windows.System.VirtualKey.Shift);
        if ((shift & global::Windows.UI.Core.CoreVirtualKeyStates.Down) != 0) return;
        e.Handled = true;
        OnSend(sender, new RoutedEventArgs());
    }

    private async void OnSend(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!WindowOpen) { UpdateServiceWindow(); return; }
            if (attachments.Count > 0) { await SendAttachmentsAsync(); return; }
            if (sending || selected is null || client is null || workspace is null || string.IsNullOrWhiteSpace(Composer.Text)) return;
            var target = selected;
            var text = Composer.Text.Trim();
            sending = true;
            Conversations.IsEnabled = SignOutButton.IsEnabled = false;
            Composer.IsReadOnly = true;
            OnComposerChanged(Composer, null!);
            ChatError.IsOpen = false;
            try
            {
                var row = await client.SendTextAsync(workspace, target.Primary, text, replyTo);
                ClearReply();
                drafts.Remove(target.Primary.Id);
                if (selected?.Primary.Id == target.Primary.Id)
                {
                    Composer.Text = "";
                    messages = MessageTimeline.Upsert(messages, row);
                    if (loadingChatVersion != 0) chatLoads.Track(row);
                    RenderMessages(forceBottom: true);
                }
                client.ApplyMessage(row);
                ReplaceConversations(client.ConversationViews());
                await MarkReadAsync();
            }
            catch (Exception ex) { AppLog.Error("MainWindow.xaml operation failed", ex); ShowChatError(UiStrings.Get("SendError")); return; }
            finally
            {
                sending = false;
                Conversations.IsEnabled = SignOutButton.IsEnabled = true;
                Composer.IsReadOnly = false;
                OnComposerChanged(Composer, null!);
            }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnSend failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }

    private void ReplaceConversations(IReadOnlyList<ConversationView> list)
    {
        QueueSnapshotSave();
        var id = selected?.Primary.Id;
        var draft = NewConversation.IsDraft(selected) ? selected : null;
        var replacement = list.FirstOrDefault(c => c.Primary.Id == id || (id is not null && c.MemberIds.Contains(id)))
            ?? (draft is null ? null : NewConversation.Find(list, draft.Primary.Address, draft.Primary.OrganizationAddress) ?? draft);
        selected = replacement;
        if (replacement is not null)
        {
            ChatName.Text = replacement.DisplayName;
            UpdateChatHeader(replacement);
        }
        allConversations = list;
        UpdateNavigation();
        var unread = list.Where(c => !c.Archived).Sum(c => c.Unread);
        DesktopNotifications.SetBadge(unread);
        RailBadge.Visibility = unread > 0 ? Visibility.Visible : Visibility.Collapsed;
        RailCount.Text = unread > 99 ? "99+" : unread.ToString();
        UpdateApprovalBadge();
        if (replacement is null)
        {
            chatVersion++;
            lastIncoming = null;
            ChatPanel.Visibility = Visibility.Collapsed;
            SelectChat.Visibility = Visibility.Visible;
        }
    }

    private async Task RefreshAsync(string reason)
    {
        pendingRefreshReason = reason;
        if (busy || refreshing || sending || client is null || workspace is null) { refreshPending = true; return; }
        var timer = Stopwatch.StartNew();
        var showProgress = reason == "Ctrl+R" || !inboxLoaded;
        var refreshingWorkspace = workspace;
        refreshing = true;
        if (showProgress) SetBusy(true);
        try
        {
            var organization = workspace.OrganizationId;
            var list = await client.GetConversationsAsync(organization);
            if (!ReferenceEquals(workspace, refreshingWorkspace) || closed) return;
            ReplaceConversations(list);
            inboxLoaded = true;
            _ = LoadApprovalsAsync();
            if (reloadChatAfterReconnect)
            {
                reloadChatAfterReconnect = false;
                client.Messages.MarkAllStale();
            }
            await LoadChatAsync();
            if (pendingConversation is { } pending && list.Any(c => c.MemberIds.Contains(pending)))
                await OpenNotificationAsync(pending);
        }
        catch (Exception ex)
        {
            AppLog.Error("MainWindow.xaml operation failed", ex);
            if (ReferenceEquals(workspace, refreshingWorkspace) && !closed)
            {
                refreshPending = true;
                ShowChatError(UiStrings.Get("RefreshError"));
            }
        }
        finally
        {
            refreshing = false;
            if (showProgress) SetBusy(false);
            AppLog.Info($"RefreshAsync ms={timer.ElapsedMilliseconds} reason={reason}");
        }
    }

    private async void OnRefreshAccelerator(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs e)
    {
        try
        {
            e.Handled = true;
            await RefreshAsync("Ctrl+R");

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnRefreshAccelerator failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private async Task EnsureRealtimeAsync()
    {
        if (!inboxLoaded || connecting || closed || client is null || workspace is null) return;
        connecting = true;
        try { await client.StartRealtimeAsync(workspace.OrganizationId); }
        catch (Exception ex) { AppLog.Error("MainWindow.xaml operation failed", ex); connected = false; Reconnecting.Visibility = Visibility.Visible; }
        finally { connecting = false; }
    }

    private async Task RecoverAsync(string? reason = null)
    {
        if (reason is not null) pendingRefreshReason = reason;
        if (recovering || refreshing || busy || sending || closed || workspace is null) { refreshPending = true; return; }
        recovering = true;
        refreshPending = false;
        try { await RefreshAsync(pendingRefreshReason); }
        finally { recovering = false; }
    }

    private async Task ApplyRealtimeAsync(MessageRow row, bool insert)
    {
        if (closed || client is null || workspace?.OrganizationId != row.OrganizationId || row.Service != "whatsapp") return;
        client.ApplyMessage(row);
        var isOpen = row.ConversationId is { } id && selected?.MemberIds.Contains(id) == true;
        // A new incoming member can become the merged primary; mark that row's read position.
        ReplaceConversations(client.ConversationViews());
        if (isOpen)
        {
            var atBottom = bottomAnchor.Following;
            var isNew = !messages.Any(m => m.Id == row.Id);
            messages = MessageTimeline.Upsert(messages, row);
            if (loadingChatVersion != 0) chatLoads.Track(row);
            if (!string.IsNullOrEmpty(row.SenderAddress) &&
                (lastIncoming is null || string.CompareOrdinal(row.Timestamp, lastIncoming.Timestamp) >= 0)) lastIncoming = row;
            UpdateServiceWindow();
            RenderMessages();
            if (isNew && MessageHelpers.IsRenderable(row) && !atBottom) NewMessages.Visibility = Visibility.Visible;
            await MarkReadAsync();
        }
        ReplaceConversations(client.ConversationViews());
        if (!client.ConversationViews().Any(c => c.MemberIds.Contains(row.ConversationId ?? "")))
        { refreshPending = true; await RecoverAsync("realtime-message-change"); }
        if (!insert || workspace?.OrganizationId != row.OrganizationId || closed) return;
        var decision = notificationPolicy.Evaluate(row, workspace.OrganizationId, active,
            profilePanel == null ? selected?.MemberIds ?? Array.Empty<string>() : Array.Empty<string>(), DateTimeOffset.UtcNow);
        if (decision.Sound && preferences.NotificationSound) DesktopNotifications.PlaySound();
        // Like WhatsApp: the taskbar button flashes even when Windows notifications are off.
        if (!active && preferences.FlashTaskbar && (decision.Sound || decision.Toast)) DesktopNotifications.FlashTaskbar();
        if (decision.Toast && preferences.DesktopNotifications && row.ConversationId is { } conversationId)
        {
            var conversation = client.ConversationViews().FirstOrDefault(c => c.MemberIds.Contains(conversationId));
            notifications.Show(conversationId, conversation?.DisplayName ?? MessageHelpers.FormatPhone(row.ConversationAddress), decision.Body);
        }
    }

    internal async Task OpenNotificationAsync(string id)
    {
        pendingConversation = id;
        if (closed) return;
        AppWindow.Show();
        if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter presenter) presenter.Restore();
        Activate();
        if (sending || capture is not null || recordingBusy || profileSaving) return;
        if (client is null || workspace is null) return;
        archivedView = allConversations.Any(c => c.Archived && c.MemberIds.Contains(id));
        preferences = preferences with { Instance = "" }; CloseProfile(); UpdateNavigation();
        unreadOnly = false; Search.Text = ""; ApplyFilters();
        var conversation = VisibleConversation(id);
        pendingConversation = null;
        if (conversation is null)
        {
            await RefreshAsync("notification");
            conversation = VisibleConversation(id);
        }
        if (conversation is null)
        {
            AppLog.Info("Notification conversation is no longer available");
            return;
        }
        Conversations.SelectedItem = conversation;
        await MarkReadAsync();
    }

    private ConversationView? VisibleConversation(string id) =>
        (Conversations.ItemsSource as IEnumerable<ConversationView>)?.FirstOrDefault(c => c.MemberIds.Contains(id));

    private void UpdateChatHeader(ConversationView conversation)
    {
        ChatAvatar.Set(conversation.DisplayName, conversation.Primary.Address);
        var number = workspace?.Numbers.FirstOrDefault(n => n.Address == conversation.Primary.OrganizationAddress);
        ChatPhone.Text = MessageHelpers.FormatPhone(conversation.Primary.Address) + " · " +
            (number is null ? conversation.Primary.OrganizationAddress : WebPresentation.NumberLabel(number));
    }
    private void OnFilterChanged(object sender, TextChangedEventArgs e) => ApplyFilters();
    private void OnAllFilter(object sender, RoutedEventArgs e) { unreadOnly = false; ApplyFilters(); }
    private void OnUnreadFilter(object sender, RoutedEventArgs e) { unreadOnly = true; ApplyFilters(); }
    private void OnChats(object sender, RoutedEventArgs e)
    {
        if (sending || capture is not null || recordingBusy || profileSaving) return;
        var returning = InboxGrid.Visibility != Visibility.Visible || profilePanel != null;
        CloseNewChat();
        archivedView = false;
        CloseProfile();
        UpdateNavigation();
        // Coming back from another page keeps the open chat as it was (scroll, draft, attachments);
        // Chats while already on the chat list closes it.
        if (returning && selected is not null) { ApplyFilters(); return; }
        ClearAttachments();
        if (selected is not null) drafts[NewConversation.DraftKey(selected)] = Composer.Text;
        selected = null; Conversations.SelectedItem = null; chatVersion++;
        ChatPanel.Visibility = Visibility.Collapsed; SelectChat.Visibility = Visibility.Visible;
    }
    private void UpdateFilters()
    {
        if (UnreadFilter is null) return;
        var count = allConversations.Count(c => !c.Archived && c.Unread > 0);
        UnreadFilter.Content = UiStrings.Get("Unread") + (count > 0 ? " " + count : "");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(UnreadFilter, (string)UnreadFilter.Content);
        var accent = ((SolidColorBrush)WebBrush.Get(Shell, "ChatAccentBrush")).Color;
        var tint = new SolidColorBrush(ColorHelper.FromArgb(38, accent.R, accent.G, accent.B));
        var outline = new SolidColorBrush(ColorHelper.FromArgb(51, accent.R, accent.G, accent.B));
        AllFilter.Background = unreadOnly ? new SolidColorBrush(Colors.Transparent) : tint;
        AllFilter.Foreground = WebBrush.Get(Shell, unreadOnly ? "SubBrush" : "ChatAccentBrush");
        AllFilter.BorderBrush = unreadOnly ? WebBrush.Get(Shell, "LineBrush") : outline;
        UnreadFilter.Background = unreadOnly ? tint : new SolidColorBrush(Colors.Transparent);
        UnreadFilter.Foreground = WebBrush.Get(Shell, unreadOnly ? "ChatAccentBrush" : "SubBrush");
        UnreadFilter.BorderBrush = unreadOnly ? outline : WebBrush.Get(Shell, "LineBrush");
    }
    private void ApplyFilters()
    {
        if (Conversations is null || Search is null) return;
        var list = allConversations.Where(c => c.Archived == archivedView &&
            (archivedView || preferences.Instance.Length == 0 || c.Primary.OrganizationAddress == preferences.Instance) &&
            WebPresentation.Matches(c, Search.Text, !archivedView && unreadOnly))
            .Select(c => c with
            {
                InstanceLabel = workspace?.Numbers.Count > 1 && (archivedView || preferences.Instance.Length == 0)
                ? workspace.Numbers.FirstOrDefault(n => n.Address == c.Primary.OrganizationAddress) is { } number ? WebPresentation.NumberLabel(number) : c.Primary.OrganizationAddress : null,
                AwaitingApproval = MessageApprovals.AnyWaiting(c, approvalConversations)
            }).ToArray();
        Conversations.ItemsSource = list;
        Conversations.SelectedItem = list.FirstOrDefault(c => c.Primary.Id == selected?.Primary.Id);
        EmptyList.Visibility = list.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        EmptyList.Text = UiStrings.Get(archivedView ? "NoArchivedChats" : "EmptyList");
        UpdateFilters();
    }

    private void ReportCallbackError(Exception exception)
    {
        try { if (!closed) ShowChatError(UiStrings.Get("GenericError")); }
        catch (Exception reportingError) { AppLog.Error("Could not display callback failure", reportingError); }
    }

    private void ShowChatError(string message) { if (profilePanel != null && profileStatus != null) profileStatus.Text = message; ChatError.ActionButton = null; ChatError.Message = message; ChatError.IsOpen = true; }

}

