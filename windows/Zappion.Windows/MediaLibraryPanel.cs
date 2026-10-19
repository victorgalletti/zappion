// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Newtonsoft.Json.Linq;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Storage;
using Windows.Storage.Pickers;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Mirrors web/components/media-library.tsx.
internal sealed class MediaLibraryPanel : Grid, IDisposable
{
    private readonly ZappionClient client;
    private Workspace workspace;
    private readonly Action<MessageRow> openMessage;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer searchTimer;

    private MediaTab tab = MediaTab.Media;
    private string term = "", sender = "", conversation = "", instance = "";
    private DateOnly? from, to;
    private bool selecting, busy, loading, loadingMore, loadError, nextError;
    private readonly HashSet<string> selected = [];
    private readonly HashSet<string> sentReceipts = [];
    private readonly List<MessageRow> rows = [];
    private MediaCursor? next;
    private int total;
    private int version;
    private MediaPeople? people;
    private bool peopleError;
    private bool disposed, refreshing;
    private string notice = "";

    private readonly TextBlock title = new() { FontSize = 20, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
    private readonly Button selectButton = new();
    private readonly StackPanel tabs = new() { Orientation = Orientation.Horizontal };
    private readonly TextBox search = new();
    private readonly TextBox contactSearch = new();
    private readonly ComboBox senderBox = new(), chatBox = new(), instanceBox = new();
    private readonly CalendarDatePicker fromPicker = new(), toPicker = new();
    private readonly TextBlock noticeText = new() { TextWrapping = TextWrapping.Wrap, FontSize = 14 };
    private readonly Border noticeBar = new();
    private readonly StackPanel results = new() { Spacing = 0 };
    private readonly ScrollViewer resultsScroll = new();
    private readonly Grid footer = new();
    private Grid overlay = new() { Visibility = Visibility.Collapsed };
    private MediaAttachment? viewerAttachment;
    private string? viewerId;

    private static string M(string key) => UiStrings.Get("Media_mediaLibrary_" + key);
    private static string M(string key, params object[] args) => string.Format(CultureInfo.CurrentUICulture, M(key), args);
    private Brush B(string key) => WebBrush.Get(this, key);

    public MediaLibraryPanel(ZappionClient client, Workspace workspace, Action<MessageRow> openMessage)
    {
        this.client = client;
        this.workspace = workspace;
        this.openMessage = openMessage;
        Background = B("SurfaceBrush");
        searchTimer = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread().CreateTimer();
        searchTimer.Interval = TimeSpan.FromMilliseconds(300);
        searchTimer.IsRepeating = false;
        searchTimer.Tick += (_, _) => { term = search.Text; ResetAndLoad(); };
        Build();
        KeyDown += OnKeyDown;
        _ = LoadPeopleAsync();
        ResetAndLoad();
    }

    public void Dispose()
    {
        disposed = true;
        version++;
        searchTimer.Stop();
        CloseViewer();
    }

    public async Task OnShownAsync(Workspace nextWorkspace)
    {
        if (disposed || refreshing || loading || loadingMore || busy) return;
        refreshing = true;
        workspace = nextWorkspace;
        var mine = version;
        var oldestId = rows.LastOrDefault()?.Id;
        var hadRows = rows.Count > 0;
        var filters = Filters();
        try
        {
            var updatedPeople = await client.GetMediaPeopleAsync(workspace.OrganizationId);
            if (disposed || mine != version) return;
            var incoming = new List<MessageRow>();
            MediaCursor? cursor = null;
            MediaPage page;
            do
            {
                page = await client.GetMediaPageAsync(workspace.OrganizationId, filters, cursor);
                if (disposed || mine != version) return;
                incoming.AddRange(page.Rows);
                cursor = page.Next;
            }
            while (hadRows && cursor != null && !page.Rows.Any(r => r.Id == oldestId));

            people = updatedPeople; peopleError = false;
            var merged = MediaLibrary.MergeRows(rows, incoming);
            rows.Clear(); rows.AddRange(merged);
            total = page.Count; loadError = false;
            // Keep the oldest loaded page's cursor, so new rows cannot discard older pages.
            if (!hadRows) next = page.Next;
            var offset = resultsScroll.VerticalOffset;
            FillSelectors(); RenderAll();
            resultsScroll.UpdateLayout(); resultsScroll.ChangeView(null, offset, null, true);
        }
        catch (Exception ex) { if (!disposed) AppLog.Error("Refresh media library failed", ex); }
        finally { refreshing = false; }
    }

    // ---------------------------------------------------------------- layout

    private void Build()
    {
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(72) });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // PageHeader
        var header = new Grid { Padding = new Thickness(20, 0, 20, 0), BorderBrush = B("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1) };
        header.ColumnDefinitions.Add(new ColumnDefinition());
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(title);
        // Bordered pill like the other header actions (template-detail.tsx: rounded-full border border-line px-4 py-2 text-sm).
        StyleTextButton(selectButton);
        selectButton.BorderBrush = B("LineBrush");
        selectButton.BorderThickness = new Thickness(1);
        selectButton.CornerRadius = new CornerRadius(18);
        selectButton.Padding = new Thickness(16, 8, 16, 8);
        selectButton.VerticalAlignment = VerticalAlignment.Center;
        selectButton.Click += (_, _) => { selecting = !selecting; selected.Clear(); RenderAll(); };
        SetColumn(selectButton, 1);
        header.Children.Add(selectButton);
        Children.Add(header);

        // Tabs: rounded-full bg-panel p-1, active bg-surface
        var tabsHost = new Border { Padding = new Thickness(20, 12, 20, 12), BorderBrush = B("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1) };
        var pill = new Border { Background = B("PanelBrush"), CornerRadius = new CornerRadius(20), Padding = new Thickness(4), Child = tabs };
        tabsHost.Child = pill;
        AutomationProperties.SetName(tabs, M("contentTypes"));
        SetRow(tabsHost, 1);
        Children.Add(tabsHost);

        // Filters
        var filters = new StackPanel { Spacing = 12, Padding = new Thickness(16), BorderBrush = B("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1) };
        search.Style = (Style)Application.Current.Resources["SearchTextBox"];
        search.PlaceholderText = M("searchByFileCaptionLinkOrContact");
        AutomationProperties.SetName(search, M("searchMedia"));
        search.TextChanged += (_, _) => { searchTimer.Stop(); searchTimer.Start(); };
        filters.Children.Add(search);
        var row = new Grid { ColumnSpacing = 8 };
        var wrap = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        contactSearch.Style = (Style)Application.Current.Resources["SettingsTextBox"];
        StyleFilter(contactSearch);
        contactSearch.Padding = new Thickness(12, 7, 12, 7);
        contactSearch.Width = 160;
        contactSearch.PlaceholderText = M("searchContacts");
        AutomationProperties.SetName(contactSearch, M("searchSenders"));
        contactSearch.TextChanged += (_, _) => FillSelectors();
        wrap.Children.Add(contactSearch);
        foreach (var (box, name) in new[] { (senderBox, M("sentBy")), (chatBox, M("chat")), (instanceBox, M("instance")) })
        {
            box.MinWidth = 150;
            StyleFilter(box);
            AutomationProperties.SetName(box, name);
            wrap.Children.Add(box);
        }
        senderBox.SelectionChanged += (_, _) => { if (!filling && senderBox.SelectedValue is string v && v != sender) { sender = v; ResetAndLoad(); } };
        chatBox.SelectionChanged += (_, _) => { if (!filling && chatBox.SelectedValue is string v && v != conversation) { conversation = v; ResetAndLoad(); } };
        instanceBox.SelectionChanged += (_, _) => { if (!filling && instanceBox.SelectedValue is string v && v != instance) { instance = v; ResetAndLoad(); } };
        instanceBox.Visibility = workspace.Numbers.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
        wrap.Children.Add(DateField(M("from"), M("startDate"), fromPicker));
        wrap.Children.Add(DateField(M("to"), M("endDate"), toPicker));
        fromPicker.DateChanged += (_, e) => { from = e.NewDate is { } d ? DateOnly.FromDateTime(d.Date) : null; toPicker.MinDate = e.NewDate ?? DateTimeOffset.MinValue; ResetAndLoad(); };
        toPicker.DateChanged += (_, e) => { to = e.NewDate is { } d ? DateOnly.FromDateTime(d.Date) : null; fromPicker.MaxDate = e.NewDate ?? DateTimeOffset.MaxValue; ResetAndLoad(); };
        var clear = new Button { Content = M("clearFilters") };
        StyleTextButton(clear);
        clear.Height = FilterHeight;
        clear.Padding = new Thickness(12, 0, 12, 0);
        clear.VerticalAlignment = VerticalAlignment.Center;
        clear.Click += (_, _) => ClearFilters();
        wrap.Children.Add(clear);
        row.Children.Add(new ScrollViewer { Content = wrap, HorizontalScrollMode = ScrollMode.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, VerticalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled });
        filters.Children.Add(row);
        SetRow(filters, 2);
        Children.Add(filters);

        // Notice (status line)
        noticeBar.Padding = new Thickness(16, 12, 16, 12);
        noticeBar.BorderBrush = B("LineBrush");
        noticeBar.BorderThickness = new Thickness(0, 0, 0, 1);
        noticeBar.Child = noticeText;
        noticeText.Foreground = B("ChatAccentBrush");
        noticeBar.Visibility = Visibility.Collapsed;
        SetRow(noticeBar, 3);
        Children.Add(noticeBar);

        // Results
        resultsScroll.Content = results;
        resultsScroll.Padding = new Thickness(20);
        resultsScroll.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        resultsScroll.ViewChanged += (_, e) =>
        {
            if (e.IsIntermediate || loading || loadingMore || next is null || nextError) return;
            if (resultsScroll.ScrollableHeight - resultsScroll.VerticalOffset < 300) _ = LoadMoreAsync();
        };
        resultsScroll.SizeChanged += (_, e) => { if (Math.Abs(e.NewSize.Width - e.PreviousSize.Width) > 1) RenderResults(); };
        AutomationProperties.SetName(resultsScroll, M("media"));
        SetRow(resultsScroll, 4);
        Children.Add(resultsScroll);

        // Footer: border-t bg-panel
        footer.Background = B("PanelBrush");
        footer.BorderBrush = B("LineBrush");
        footer.BorderThickness = new Thickness(0, 1, 0, 0);
        footer.Padding = new Thickness(16, 12, 16, 12);
        footer.MinHeight = 48;
        SetRow(footer, 5);
        Children.Add(footer);

        // Modal layer (viewer / forward)
        AddOverlay();

        RenderAll();
    }

    private bool filling;

    private UIElement DateField(string label, string name, CalendarDatePicker picker)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = label, FontSize = 12, Foreground = B("SubBrush"), VerticalAlignment = VerticalAlignment.Center });
        picker.PlaceholderText = CultureInfo.CurrentUICulture.DateTimeFormat.ShortDatePattern.ToLowerInvariant();
        StyleFilter(picker);
        AutomationProperties.SetName(picker, name);
        panel.Children.Add(picker);
        return panel;
    }

    // media-library.tsx filters: rounded-lg border border-line bg-input px-3 py-2 text-sm, one height for every control.
    private const double FilterHeight = 36;

    private void StyleFilter(Control control)
    {
        control.Height = FilterHeight;
        control.MinHeight = 0;
        control.VerticalAlignment = VerticalAlignment.Center;
        control.FontSize = 14;
        control.CornerRadius = new CornerRadius(8);
        control.Background = B("InputBrush");
        control.BorderBrush = B("LineBrush");
        control.BorderThickness = new Thickness(1);
        control.Foreground = B("HeadingBrush");
    }

    private void StyleTextButton(Button button)
    {
        button.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        button.BorderThickness = new Thickness(0);
        button.CornerRadius = new CornerRadius(8);
        button.Padding = new Thickness(12, 8, 12, 8);
        button.Foreground = B("HeadingBrush");
        button.FontSize = 14;
    }

    private Button IconButton(string icon, string name, Action action, string? label = null)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        content.Children.Add(new LucideIcon { Kind = icon, Size = 16 });
        if (label is not null) content.Children.Add(new TextBlock { Text = label, FontSize = 14 });
        var button = new Button { Content = content };
        StyleTextButton(button);
        AutomationProperties.SetName(button, name);
        ToolTipService.SetToolTip(button, name);
        button.Click += (_, _) => action();
        return button;
    }

    private void RenderAll()
    {
        title.Text = selecting ? M("selectedCount", selected.Count) : M("media");
        selectButton.Content = selecting ? M("cancelSelection") : M("select");
        RenderTabs();
        RenderResults();
        RenderFooter();
        noticeText.Text = notice;
        noticeBar.Visibility = notice.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderTabs()
    {
        tabs.Children.Clear();
        foreach (var (value, label) in new[] { (MediaTab.Media, M("media")), (MediaTab.Links, M("links")), (MediaTab.Docs, M("docs")) })
        {
            var active = tab == value;
            var button = new Button
            {
                Content = label,
                Padding = new Thickness(24, 6, 24, 6),
                CornerRadius = new CornerRadius(16),
                BorderThickness = new Thickness(0),
                FontSize = 14,
                FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal,
                Foreground = B(active ? "HeadingBrush" : "SubBrush"),
                Background = active ? B("SurfaceBrush") : new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            };
            AutomationProperties.SetName(button, label);
            button.Click += (_, _) => { if (tab == value) return; tab = value; ResetAndLoad(); };
            tabs.Children.Add(button);
        }
    }

    // ---------------------------------------------------------------- data

    private async Task LoadPeopleAsync()
    {
        try
        {
            var loaded = await client.GetMediaPeopleAsync(workspace.OrganizationId);
            if (disposed) return;
            people = loaded; peopleError = false;
        }
        catch (Exception ex) { AppLog.Error("Load media people failed", ex); peopleError = true; }
        if (disposed) return;
        FillSelectors();
        RenderAll();
    }

    private void FillSelectors()
    {
        filling = true;
        try
        {
            var filter = contactSearch.Text.Trim().ToLowerInvariant();
            var conversations = people?.Conversations ?? [];
            var senderItems = new List<(string, string)> { ("", M("allSenders")), ("team", M("meTeam")) };
            senderItems.AddRange(conversations
                .GroupBy(c => c.Address).Select(g => (g.Key, MediaLibrary.ConversationName(g.First(), people!)))
                .Where(c => c.Key == sender || c.Item2.ToLowerInvariant().Contains(filter)));
            Fill(senderBox, senderItems, sender);
            var chatItems = new List<(string, string)> { ("", M("allChats")) };
            chatItems.AddRange(conversations
                .Select(c => (c.Id, $"{MediaLibrary.ConversationName(c, people!)} · {InstanceLabel(c.OrganizationAddress)}"))
                .Where(c => c.Id == conversation || c.Item2.ToLowerInvariant().Contains(filter)));
            Fill(chatBox, chatItems, conversation);
            var instanceItems = new List<(string, string)> { ("", M("allInstances")) };
            instanceItems.AddRange(workspace.Numbers.Select(n => (n.Address, SettingsRules.InstanceName(n))));
            Fill(instanceBox, instanceItems, instance);
        }
        finally { filling = false; }
    }

    private static void Fill(ComboBox box, IEnumerable<(string Value, string Label)> items, string current)
    {
        box.Items.Clear();
        foreach (var (value, label) in items) box.Items.Add(new ComboBoxItem { Content = label, Tag = value });
        box.SelectedValuePath = "Tag";
        box.SelectedValue = current;
    }

    private string InstanceLabel(string address) =>
        workspace.Numbers.FirstOrDefault(n => n.Address == address) is { } number ? SettingsRules.InstanceName(number) : MessageHelpers.FormatPhone(address);

    private MediaFilters Filters() => new(tab, term, sender, conversation.Length > 0 ? [conversation] : null, instance, from, to,
        term.Trim().Length > 0 && people is not null ? MediaLibrary.MatchingAddresses(term, people) : null);

    private void ClearFilters()
    {
        search.Text = ""; term = ""; sender = ""; conversation = ""; instance = ""; contactSearch.Text = "";
        from = to = null; fromPicker.Date = null; toPicker.Date = null;
        FillSelectors();
        ResetAndLoad();
    }

    private void ResetAndLoad()
    {
        selected.Clear();
        CloseViewer();
        _ = LoadFirstAsync();
    }

    private async Task LoadFirstAsync()
    {
        if (disposed) return;
        var mine = ++version;
        loading = true; loadError = false; nextError = false;
        rows.Clear(); next = null; total = 0;
        RenderAll();
        try
        {
            var page = await client.GetMediaPageAsync(workspace.OrganizationId, Filters(), null);
            if (mine != version) return;
            rows.AddRange(page.Rows); next = page.Next; total = page.Count;
        }
        catch (Exception ex)
        {
            if (mine != version) return;
            AppLog.Error("Load media library failed", ex);
            loadError = true;
        }
        finally
        {
            if (mine == version) { loading = false; RenderAll(); }
        }
    }

    private async Task<bool> LoadMoreAsync()
    {
        if (disposed || next is null || loadingMore || refreshing) return false;
        var mine = version;
        loadingMore = true; nextError = false;
        RenderFooterOfResults();
        try
        {
            var page = await client.GetMediaPageAsync(workspace.OrganizationId, Filters(), next);
            if (mine != version) return false;
            rows.AddRange(page.Rows); next = page.Next;
            return true;
        }
        catch (Exception ex)
        {
            if (mine != version) return false;
            AppLog.Error("Load more media failed", ex);
            nextError = true;
            return false;
        }
        finally
        {
            if (mine == version) { loadingMore = false; RenderResults(); RenderFooter(); }
        }
    }

    // ---------------------------------------------------------------- results

    private Border? moreHost;

    private void RenderResults()
    {
        results.Children.Clear();
        if (peopleError)
        {
            var retry = new Button { Content = UiStrings.Get("Retry") };
            StyleTextButton(retry);
            retry.Click += (_, _) => _ = LoadPeopleAsync();
            var alert = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 0, 12) };
            alert.Children.Add(new TextBlock { Text = M("couldNotLoadContactsAndChats"), Foreground = B("DangerBrush"), FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
            alert.Children.Add(retry);
            results.Children.Add(alert);
        }
        if (loading)
        {
            results.Children.Add(Centered(new TextBlock { Text = M("loading"), Foreground = B("SubBrush"), FontSize = 14 }));
            return;
        }
        if (loadError && rows.Count == 0)
        {
            var retry = new Button { Content = UiStrings.Get("Retry") };
            StyleTextButton(retry);
            retry.Click += (_, _) => ResetAndLoad();
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
            line.Children.Add(new TextBlock { Text = M("couldNotLoadMedia"), Foreground = B("DangerBrush"), FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
            line.Children.Add(retry);
            results.Children.Add(Centered(line));
            return;
        }
        if (rows.Count == 0)
        {
            var empty = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center, Padding = new Thickness(48) };
            var icon = new LucideIcon { Kind = "images", Size = 40, HorizontalAlignment = HorizontalAlignment.Center };
            icon.SetStroke(B("SubBrush"));
            empty.Children.Add(icon);
            empty.Children.Add(new TextBlock { Text = M("noItemsFound"), Foreground = B("SubBrush"), FontSize = 16, HorizontalAlignment = HorizontalAlignment.Center });
            empty.Children.Add(new TextBlock { Text = M("adjustTheFiltersOrWaitForNewMessages"), Foreground = B("SubBrush"), FontSize = 14, HorizontalAlignment = HorizontalAlignment.Center });
            results.Children.Add(empty);
            return;
        }
        if (tab == MediaTab.Docs) results.Children.Add(DocsHeader());
        foreach (var group in MediaLibrary.Group(rows))
        {
            var section = new StackPanel { Margin = new Thickness(0, 0, 0, 24) };
            var head = new StackPanel { Padding = new Thickness(0, 12, 0, 12), Margin = new Thickness(0, 0, 0, 12), BorderBrush = B("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1) };
            head.Children.Add(new TextBlock { Text = group.Label, FontSize = 16, FontWeight = FontWeights.SemiBold, Foreground = B("HeadingBrush") });
            var start = DateLabel(group.Start);
            var end = DateLabel(group.End);
            head.Children.Add(new TextBlock { Text = start == end ? start : $"{start} – {end}", FontSize = 12, Foreground = B("SubBrush") });
            section.Children.Add(head);
            section.Children.Add(tab == MediaTab.Media ? MediaGrid(group.Rows) : RowList(group.Rows));
            results.Children.Add(section);
        }
        moreHost = new Border { Padding = new Thickness(0, 12, 0, 12) };
        results.Children.Add(moreHost);
        RenderFooterOfResults();
    }

    private void RenderFooterOfResults()
    {
        if (moreHost is null) return;
        if (loadingMore) { moreHost.Child = Centered(new TextBlock { Text = M("loadingMore"), Foreground = B("SubBrush"), FontSize = 14 }); return; }
        if (next is null) { moreHost.Child = null; return; }
        var more = new Button { Content = nextError ? M("couldNotLoadTryAgain") : M("loadMore"), HorizontalAlignment = HorizontalAlignment.Center };
        StyleTextButton(more);
        more.Click += (_, _) => _ = LoadMoreAsync();
        moreHost.Child = more;
    }

    private static string DateLabel(DateTimeOffset date) => date.ToString("d MMM yyyy", CultureInfo.CurrentUICulture);

    private UIElement Centered(UIElement child) => new Border { Padding = new Thickness(40), Child = child, HorizontalAlignment = HorizontalAlignment.Center };

    private UIElement MediaGrid(IReadOnlyList<MessageRow> items)
    {
        // grid-cols-2 sm:3 lg:5 xl:6 gap-2
        // ViewportWidth excludes the vertical scrollbar; 40 = the results padding, 2 = rounding slack.
        var width = Math.Max(200, (resultsScroll.ViewportWidth > 0 ? resultsScroll.ViewportWidth : resultsScroll.ActualWidth) - 40 - 2);
        // Tailwind breakpoints apply to the viewport: add the 64 px rail back to the page width.
        var viewport = ActualWidth + 64;
        var columns = viewport >= 1280 ? 6 : viewport >= 1024 ? 5 : viewport >= 640 ? 3 : 2;
        // Each cell carries its 8 px gap on the right, so the row holds columns * (size + 8) = width + 8.
        var size = Math.Floor((width + 8) / columns) - 8;
        var grid = new VariableSizedWrapGrid { Orientation = Orientation.Horizontal, ItemWidth = size + 8, ItemHeight = size + 8 };
        foreach (var row in items) grid.Children.Add(MediaTile(row, size));
        return grid;
    }

    private UIElement MediaTile(MessageRow row, double size)
    {
        var file = MediaContent.FileOf(row.Content);
        var checkedNow = selected.Contains(row.Id);
        var tile = new Grid { Width = size, Height = size };
        tile.Children.Add(new MediaAttachment(row, false));
        if (selecting)
        {
            tile.Children.Add(new Border
            {
                Width = 20, Height = 20, CornerRadius = new CornerRadius(10), Margin = new Thickness(8),
                HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top,
                BorderBrush = new SolidColorBrush(Microsoft.UI.Colors.White), BorderThickness = new Thickness(1),
                Background = checkedNow ? B("ChatAccentBrush") : WebBrush.Color("#4D000000"),
                Child = new TextBlock { Text = checkedNow ? "✓" : "", FontSize = 12, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }
            });
        }
        tile.Children.Add(new Border
        {
            VerticalAlignment = VerticalAlignment.Bottom, Background = WebBrush.Color("#99000000"), Padding = new Thickness(8),
            Child = SenderLabel(row, new SolidColorBrush(Microsoft.UI.Colors.White), 12)
        });
        var button = new Button
        {
            Content = tile, Padding = new Thickness(0), CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(2), BorderBrush = checkedNow ? B("ChatAccentBrush") : new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            Background = B("PanelBrush"), Margin = new Thickness(0, 0, 8, 8),
        };
        var action = selecting ? M(checkedNow ? "deselect" : "select") : M("open");
        AutomationProperties.SetName(button, M("itemLabel", action, (string?)file?["name"] ?? M("mediaFallback"), SenderName(row)));
        button.Click += (_, _) => { if (selecting) Toggle(row.Id); else OpenViewer(row.Id); };
        return button;
    }

    private UIElement DocsHeader()
    {
        var grid = DocsGrid();
        grid.Padding = new Thickness(12, 0, 12, 8);
        string[] labels = [M("document"), M("caption"), M("senderDate"), M("actions")];
        for (var i = 0; i < labels.Length; i++)
        {
            var text = new TextBlock { Text = labels[i], FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = B("SubBrush") };
            SetColumn(text, i);
            grid.Children.Add(text);
        }
        return grid;
    }

    private static Grid DocsGrid()
    {
        // grid-cols-[minmax(220px,2fr)_1fr_1fr_140px] gap-4
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star), MinWidth = 220 });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
        return grid;
    }

    private UIElement RowList(IReadOnlyList<MessageRow> items)
    {
        var list = new StackPanel { Spacing = 4 };
        foreach (var row in items) list.Children.Add(tab == MediaTab.Docs ? DocRow(row) : LinkRow(row));
        return list;
    }

    private Border RowShell(MessageRow row, UIElement content)
    {
        var checkedNow = selected.Contains(row.Id);
        var line = new Grid { ColumnSpacing = 8 };
        line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        line.ColumnDefinitions.Add(new ColumnDefinition());
        if (selecting)
        {
            var box = new CheckBox { IsChecked = checkedNow, MinWidth = 0, VerticalAlignment = VerticalAlignment.Center };
            var file = MediaContent.FileOf(row.Content);
            AutomationProperties.SetName(box, M("selectItem", (string?)file?["name"] ?? MediaLibrary.ExtractLinks(MediaLibrary.Text(row)).FirstOrDefault()?.Domain ?? M("link")));
            box.Click += (_, _) => Toggle(row.Id);
            line.Children.Add(box);
        }
        SetColumn((FrameworkElement)content, 1);
        line.Children.Add(content);
        var tint = ((SolidColorBrush)B("ChatAccentBrush")).Color;
        var panel = ((SolidColorBrush)B("PanelBrush")).Color;
        return new Border
        {
            Child = line, Padding = new Thickness(12), CornerRadius = new CornerRadius(8),
            BorderBrush = B("LineBrush"), BorderThickness = new Thickness(1),
            Background = new SolidColorBrush(checkedNow
                ? global::Windows.UI.Color.FromArgb(0x1A, tint.R, tint.G, tint.B)
                : global::Windows.UI.Color.FromArgb(0x66, panel.R, panel.G, panel.B)),
        };
    }

    private UIElement DocRow(MessageRow row)
    {
        var file = MediaContent.FileOf(row.Content);
        var name = (string?)file?["name"];
        var mime = (string?)file?["mime_type"] ?? "";
        var grid = DocsGrid();
        var open = new Button { Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent), BorderThickness = new Thickness(0), Padding = new Thickness(0), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left };
        var openContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        openContent.Children.Add(new Border { Width = 48, Height = 48, CornerRadius = new CornerRadius(8), Child = new MediaAttachment(row, false) });
        var info = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        info.Children.Add(new TextBlock { Text = name ?? (mime.StartsWith("audio/", StringComparison.Ordinal) ? M("audio") : M("document")), FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = B("HeadingBrush"), TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 260 });
        var extension = name?.Split('.').LastOrDefault()?.ToUpperInvariant() ?? mime.Split('/').LastOrDefault()?.ToUpperInvariant();
        info.Children.Add(new TextBlock { Text = $"{MediaLibrary.FormatBytes((long?)file?["size"])} · {extension}", FontSize = 12, Foreground = B("SubBrush") });
        openContent.Children.Add(info);
        open.Content = openContent;
        open.Click += (_, _) => { if (selecting) Toggle(row.Id); else OpenViewer(row.Id); };
        grid.Children.Add(open);
        var caption = MediaLibrary.Text(row);
        var captionText = new TextBlock { Text = caption.Length > 0 ? caption : M("noCaption"), FontSize = 14, Foreground = B("SubBrush"), TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        if (caption.Length > 0) ToolTipService.SetToolTip(captionText, caption);
        SetColumn(captionText, 1);
        grid.Children.Add(captionText);
        var who = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        who.Children.Add(SenderLabel(row, B("HeadingBrush"), 14));
        who.Children.Add(new TextBlock { Text = When(row), FontSize = 12, Foreground = B("SubBrush") });
        SetColumn(who, 2);
        grid.Children.Add(who);
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        actions.Children.Add(IconButton("document", M("goToMessage"), () => openMessage(row)));
        var download = IconButton("download", M("download"), () => _ = DownloadAsync([row]));
        download.IsEnabled = !busy;
        actions.Children.Add(download);
        var forward = IconButton("forward", M("forward"), () => OpenForward([row]));
        forward.IsEnabled = !busy;
        actions.Children.Add(forward);
        SetColumn(actions, 3);
        grid.Children.Add(actions);
        return RowShell(row, grid);
    }

    private UIElement LinkRow(MessageRow row)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var icon = new LucideIcon { Kind = "link", Size = 28, VerticalAlignment = VerticalAlignment.Center };
        icon.SetStroke(B("ChatAccentBrush"));
        grid.Children.Add(icon);
        var body = new StackPanel();
        foreach (var link in MediaLibrary.ExtractLinks(MediaLibrary.Text(row)))
        {
            var anchor = new HyperlinkButton { NavigateUri = new Uri(link.Url), Padding = new Thickness(0), Margin = new Thickness(0, 0, 0, 4) };
            var text = new TextBlock { TextTrimming = TextTrimming.CharacterEllipsis };
            text.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = link.Domain, FontWeight = FontWeights.Bold, Foreground = B("ChatAccentBrush") });
            text.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "  " + link.Url, FontSize = 12, Foreground = B("SubBrush") });
            anchor.Content = text;
            body.Children.Add(anchor);
        }
        body.Children.Add(new TextBlock { Text = MediaLibrary.Text(row), FontSize = 14, Foreground = B("HeadingBrush"), TextTrimming = TextTrimming.CharacterEllipsis });
        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Margin = new Thickness(0, 4, 0, 0) };
        meta.Children.Add(SenderLabel(row, B("SubBrush"), 12));
        meta.Children.Add(new TextBlock { Text = "· " + When(row), FontSize = 12, Foreground = B("SubBrush") });
        body.Children.Add(meta);
        SetColumn(body, 1);
        grid.Children.Add(body);
        var go = new Button { Content = M("goToMessage"), VerticalAlignment = VerticalAlignment.Center };
        StyleTextButton(go);
        go.Click += (_, _) => openMessage(row);
        SetColumn(go, 2);
        grid.Children.Add(go);
        var forward = IconButton("forward", M("forward"), () => OpenForward([row]));
        forward.VerticalAlignment = VerticalAlignment.Center;
        SetColumn(forward, 3);
        grid.Children.Add(forward);
        return RowShell(row, grid);
    }

    private string SenderName(MessageRow row) => people is null
        ? (row.SenderAddress is null ? M("team") : MessageHelpers.FormatPhone(row.SenderAddress))
        : MediaLibrary.SenderName(row, people, workspace.Agent.Id);

    private UIElement SenderLabel(MessageRow row, Brush foreground, double size)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (row.SenderAddress is null)
        {
            var agentId = row.AgentId ?? "";
            var agent = agentId == workspace.Agent.Id ? workspace.Agent : people?.Agents.FirstOrDefault(a => a.Id == agentId);
            if (agent is not null)
            {
                var avatar = new WebAvatar { AvatarSize = 20 };
                avatar.Set(agent.Name, agent.Id);
                if (agent.Picture is { } picture) _ = SetPhotoAsync(avatar, picture);
                panel.Children.Add(avatar);
            }
        }
        panel.Children.Add(new TextBlock { Text = SenderName(row), FontSize = size, Foreground = foreground, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center });
        return panel;
    }

    private async Task SetPhotoAsync(WebAvatar avatar, string path)
    {
        try { avatar.SetPhoto(await client.Media.GetUrlAsync(path)); }
        catch (Exception ex) { AppLog.Error("Media library avatar failed", ex); }
    }

    private static string When(MessageRow row) =>
        DateTimeOffset.TryParse(row.Timestamp, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)
            ? at.ToLocalTime().ToString("g", CultureInfo.CurrentUICulture) : "";

    private void Toggle(string id)
    {
        if (!selected.Remove(id)) selected.Add(id);
        var offset = resultsScroll.VerticalOffset;
        RenderAll();
        DispatcherQueue.TryEnqueue(() => resultsScroll.ChangeView(null, offset, null, true));
    }

    // ---------------------------------------------------------------- footer

    private void RenderFooter()
    {
        footer.Children.Clear();
        footer.ColumnDefinitions.Clear();
        if (!selecting)
        {
            footer.Children.Add(new TextBlock { Text = MediaLibrary.TotalLabel(total, tab), FontSize = 14, Foreground = B("SubBrush"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
            return;
        }
        footer.ColumnDefinitions.Add(new ColumnDefinition());
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.Children.Add(new TextBlock { Text = M("selectedCount", selected.Count), FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = B("HeadingBrush"), VerticalAlignment = VerticalAlignment.Center });
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var all = new Button { Content = M("selectAll") };
        StyleTextButton(all);
        all.Click += (_, _) =>
        {
            if (selected.Count == rows.Count) selected.Clear(); else foreach (var r in rows) selected.Add(r.Id);
            RenderAll();
        };
        actions.Children.Add(all);
        actions.Children.Add(new TextBlock { Text = M("loadedCount", rows.Count), FontSize = 12, Foreground = B("SubBrush"), VerticalAlignment = VerticalAlignment.Center });
        var chosen = rows.Where(r => selected.Contains(r.Id)).ToArray();
        var forward = IconButton("forward", M("forward"), () => OpenForward(chosen), M("forward"));
        forward.IsEnabled = chosen.Length > 0 && !busy && people is not null && !peopleError;
        actions.Children.Add(forward);
        if (tab != MediaTab.Links)
        {
            var download = IconButton("download", M("download"), () => _ = DownloadAsync(chosen), M("download"));
            download.IsEnabled = chosen.Length > 0 && !busy;
            actions.Children.Add(download);
        }
        SetColumn(actions, 1);
        footer.Children.Add(actions);
    }

    // ---------------------------------------------------------------- download

    private async Task DownloadAsync(IReadOnlyList<MessageRow> items)
    {
        if (items.Count == 0 || busy) return;
        busy = true; notice = ""; RenderAll();
        var count = 0;
        try
        {
            if (items.Count == 1)
            {
                var file = MediaContent.FileOf(items[0].Content) ?? throw new InvalidOperationException(M("thisItemDoesNotContainAFile"));
                var path = await LocalFileAsync(items[0]);
                await ChatMedia.SaveAsync(path, NameOf(items[0], file));
                count = 1;
            }
            else
            {
                var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.Downloads };
                picker.FileTypeFilter.Add("*");
                ChatMedia.InitializePicker(picker);
                var folder = await picker.PickSingleFolderAsync();
                if (folder is null) return;
                foreach (var row in items)
                {
                    var file = MediaContent.FileOf(row.Content) ?? throw new InvalidOperationException(M("thisItemDoesNotContainAFile"));
                    var source = await StorageFile.GetFileFromPathAsync(await LocalFileAsync(row));
                    await source.CopyAsync(folder, NameOf(row, file), NameCollisionOption.GenerateUniqueName);
                    count++;
                }
            }
            notice = M("downloaded", count);
        }
        catch (Exception ex)
        {
            AppLog.Error("Media library download failed", ex);
            notice = M("downloadError", count, ex is InvalidOperationException ? ex.Message : M("downloadFailed"));
        }
        finally { busy = false; RenderAll(); }
    }

    private string NameOf(MessageRow row, JObject file) => (string?)file["name"] is { Length: > 0 } name ? name : $"{M("mediaFallback")}-{row.Id}";

    private async Task<string> LocalFileAsync(MessageRow row)
    {
        var file = MediaContent.FileOf(row.Content) ?? throw new InvalidOperationException(M("thisItemDoesNotContainAFile"));
        var uri = (string?)file["uri"] ?? "";
        if (MediaContent.StoragePath(uri) is null && !uri.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(M("fileNotYetAvailableToDownload"));
        if (MediaContent.StoragePath(uri) is not null)
            return await (ChatMedia.Cache ?? throw new InvalidOperationException(M("couldNotDownloadTheFile"))).GetFileAsync(uri, (string?)file["name"]);
        // External links are downloaded straight away, like the web's fetch.
        using var http = new HttpClient();
        var bytes = await http.GetByteArrayAsync(uri);
        var target = Path.Combine(Path.GetTempPath(), "zappion-" + row.Id + Path.GetExtension((string?)file["name"] ?? ""));
        await File.WriteAllBytesAsync(target, bytes);
        return target;
    }

    // ---------------------------------------------------------------- viewer

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (viewerId is null) return;
        var index = rows.FindIndex(r => r.Id == viewerId);
        if (e.Key == global::Windows.System.VirtualKey.Left && index > 0) { OpenViewer(rows[index - 1].Id); e.Handled = true; }
        else if (e.Key == global::Windows.System.VirtualKey.Right && index >= 0 && index < rows.Count - 1) { OpenViewer(rows[index + 1].Id); e.Handled = true; }
        else if (e.Key == global::Windows.System.VirtualKey.Escape) { CloseViewer(); e.Handled = true; }
    }

    private void AddOverlay()
    {
        overlay = new Grid { Visibility = Visibility.Collapsed, Background = WebBrush.Color("#BF000000") };
        SetRowSpan(overlay, 6);
        Children.Add(overlay);
    }

    private void CloseViewer()
    {
        viewerAttachment?.Release(); viewerAttachment = null;
        viewerId = null;
        if (overlay.Children.Count == 0 && overlay.Visibility == Visibility.Collapsed) return;
        // Replace the layer instead of emptying it: an emptied, collapsed layer can leave stale visuals behind.
        Children.Remove(overlay);
        AddOverlay();
    }

    private Grid Modal(string heading, bool wide, Action onClose)
    {
        overlay.Children.Clear();
        overlay.Visibility = Visibility.Visible;
        var dialog = new Grid
        {
            Background = B("SurfaceBrush"), BorderBrush = B("LineBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12),
            Margin = wide ? new Thickness(24) : new Thickness(0), MaxWidth = wide ? 1400 : 600,
            HorizontalAlignment = wide ? HorizontalAlignment.Stretch : HorizontalAlignment.Center,
            VerticalAlignment = wide ? VerticalAlignment.Stretch : VerticalAlignment.Center,
        };
        dialog.RowDefinitions.Add(new RowDefinition { Height = new GridLength(64) });
        dialog.RowDefinitions.Add(new RowDefinition());
        var head = new Grid { Padding = new Thickness(20, 0, 12, 0), BorderBrush = B("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1) };
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(new TextBlock { Text = heading, FontSize = 18, FontWeight = FontWeights.SemiBold, Foreground = B("HeadingBrush"), VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
        var close = IconButton("close", UiStrings.Get("Close"), onClose);
        AutomationProperties.SetAutomationId(close, "MediaModalClose");
        close.VerticalAlignment = VerticalAlignment.Center;
        SetColumn(close, 1);
        head.Children.Add(close);
        dialog.Children.Add(head);
        overlay.Children.Add(dialog);
        return dialog;
    }

    private void OpenViewer(string id)
    {
        viewerAttachment?.Release(); viewerAttachment = null;
        var index = rows.FindIndex(r => r.Id == id);
        if (index < 0) return;
        viewerId = id;
        var row = rows[index];
        var file = MediaContent.FileOf(row.Content);
        var dialog = Modal((string?)file?["name"] ?? M("viewer"), true, CloseViewer);
        var body = new Grid();
        body.RowDefinitions.Add(new RowDefinition());
        body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        SetRow(body, 1);
        dialog.Children.Add(body);

        var stage = new Grid { Padding = new Thickness(16), ColumnSpacing = 8 };
        stage.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        stage.ColumnDefinitions.Add(new ColumnDefinition());
        stage.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var previous = IconButton("chevron-left", M("previous"), () => OpenViewer(rows[index - 1].Id));
        previous.IsEnabled = index > 0;
        previous.VerticalAlignment = VerticalAlignment.Center;
        stage.Children.Add(previous);
        var center = new Grid { RowSpacing = 12 };
        center.RowDefinitions.Add(new RowDefinition());
        center.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        center.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var attachment = new MediaAttachment(row, true);
        center.Children.Add(attachment);
        viewerAttachment = attachment;
        var caption = new TextBlock { Text = MediaLibrary.Text(row) is { Length: > 0 } text ? text : (string?)file?["name"] ?? "", FontSize = 14, Foreground = B("HeadingBrush"), HorizontalAlignment = HorizontalAlignment.Center, TextWrapping = TextWrapping.Wrap };
        SetRow(caption, 1);
        center.Children.Add(caption);
        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        meta.Children.Add(SenderLabel(row, B("SubBrush"), 12));
        meta.Children.Add(new TextBlock { Text = "· " + When(row), FontSize = 12, Foreground = B("SubBrush"), VerticalAlignment = VerticalAlignment.Center });
        SetRow(meta, 2);
        center.Children.Add(meta);
        SetColumn(center, 1);
        stage.Children.Add(center);
        var nextButton = IconButton("chevron-right", M("next"), async () =>
        {
            if (index < rows.Count - 1) { OpenViewer(rows[index + 1].Id); return; }
            if (await LoadMoreAsync() && index + 1 < rows.Count) OpenViewer(rows[index + 1].Id);
        });
        nextButton.IsEnabled = index < rows.Count - 1 || next is not null;
        nextButton.VerticalAlignment = VerticalAlignment.Center;
        SetColumn(nextButton, 2);
        stage.Children.Add(nextButton);
        body.Children.Add(stage);

        var bar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center, Padding = new Thickness(12) };
        var barBorder = new Border { BorderBrush = B("LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0), Child = bar };
        var go = new Button { Content = M("goToMessage") };
        StyleTextButton(go);
        go.Click += (_, _) => { CloseViewer(); openMessage(row); };
        bar.Children.Add(go);
        var download = IconButton("download", M("download"), () => _ = DownloadAsync([row]), M("download"));
        download.IsEnabled = !busy;
        bar.Children.Add(download);
        var forward = IconButton("forward", M("forward"), () => { CloseViewer(); OpenForward([row]); }, M("forward"));
        forward.IsEnabled = !busy && people is not null && !peopleError;
        bar.Children.Add(forward);
        SetRow(barBorder, 1);
        body.Children.Add(barBorder);
        Focus(FocusState.Programmatic);
    }

    // ---------------------------------------------------------------- forward

    private void OpenForward(IReadOnlyList<MessageRow> items)
    {
        if (people is null || items.Count == 0) return;
        sentReceipts.Clear();
        notice = "";
        var destinations = new HashSet<string>();
        var dialog = Modal(M("forwardItems", items.Count), false, () => { if (!busy) CloseViewer(); });
        dialog.Width = 600;
        var body = new StackPanel { Spacing = 12, Padding = new Thickness(16) };
        SetRow(body, 1);
        dialog.Children.Add(body);
        var filter = new TextBox { PlaceholderText = M("searchDestinationChats"), Style = (Style)Application.Current.Resources["SettingsTextBox"] };
        AutomationProperties.SetName(filter, M("searchDestinations"));
        body.Children.Add(filter);
        body.Children.Add(new TextBlock { Text = M("forwardNotice"), FontSize = 12, Foreground = B("SubBrush"), TextWrapping = TextWrapping.Wrap });
        var list = new StackPanel();
        body.Children.Add(new ScrollViewer { Content = list, MaxHeight = 288 });
        var status = new TextBlock { FontSize = 14, Foreground = B("ChatAccentBrush"), TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed };
        body.Children.Add(status);
        var send = new Button { Content = M("forward"), HorizontalAlignment = HorizontalAlignment.Stretch, IsEnabled = false };
        StyleTextButton(send);
        var accent = ((SolidColorBrush)B("ChatAccentBrush")).Color;
        send.Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0x26, accent.R, accent.G, accent.B));
        body.Children.Add(send);

        void Render()
        {
            list.Children.Clear();
            var needle = filter.Text.ToLowerInvariant();
            var matches = people!.Conversations.Where(c => $"{MediaLibrary.ConversationName(c, people)} {InstanceLabel(c.OrganizationAddress)}".ToLowerInvariant().Contains(needle)).ToArray();
            if (people.Conversations.Count == 0)
                list.Children.Add(new TextBlock { Text = M("noChatsAvailable"), Foreground = B("SubBrush"), Margin = new Thickness(16) });
            foreach (var c in matches)
            {
                var label = new StackPanel();
                label.Children.Add(new TextBlock { Text = MediaLibrary.ConversationName(c, people), FontSize = 14, Foreground = B("HeadingBrush") });
                label.Children.Add(new TextBlock { Text = InstanceLabel(c.OrganizationAddress), FontSize = 12, Foreground = B("SubBrush") });
                var box = new CheckBox { Content = label, IsChecked = destinations.Contains(c.Id), IsEnabled = !busy, Padding = new Thickness(12, 8, 12, 8) };
                box.Click += (_, _) => { if (!destinations.Remove(c.Id)) destinations.Add(c.Id); send.IsEnabled = destinations.Count > 0 && !busy; };
                list.Children.Add(box);
            }
        }
        filter.TextChanged += (_, _) => Render();
        send.Click += async (_, _) =>
        {
            busy = true; send.IsEnabled = false; send.Content = M("forwarding"); Render();
            var lines = new List<string>();
            foreach (var id in destinations)
            {
                var destination = people.Conversations.FirstOrDefault(c => c.Id == id);
                if (destination is null) continue;
                var count = 0;
                try
                {
                    foreach (var row in items)
                    {
                        var receipt = $"{id}:{row.Id}";
                        if (sentReceipts.Contains(receipt)) continue;
                        var incoming = await client.GetLastIncomingAtAsync(workspace.OrganizationId, id);
                        if (incoming is null || DateTimeOffset.UtcNow >= incoming.Value.AddHours(24)) throw new InvalidOperationException(M("windowClosed"));
                        await client.InsertContentAsync(workspace, destination, MediaLibrary.ForwardContent(row));
                        sentReceipts.Add(receipt);
                        count++;
                    }
                    lines.Add(M("sent", MediaLibrary.ConversationName(destination, people), count));
                }
                catch (Exception ex)
                {
                    AppLog.Error("Media library forward failed", ex);
                    lines.Add(M("sendError", MediaLibrary.ConversationName(destination, people), count, ex is InvalidOperationException ? ex.Message : M("couldNotSend")));
                }
            }
            busy = false;
            status.Text = string.Join(" ", lines);
            status.Visibility = Visibility.Visible;
            send.Content = M("forward");
            send.IsEnabled = destinations.Count > 0;
            Render();
        };
        Render();
        filter.Focus(FocusState.Programmatic);
    }
}


/// <summary>Mirrors Attachment in media-library.tsx: lazy thumbnail, or the full viewer content.</summary>
internal sealed class MediaAttachment : Grid
{
    private readonly MessageRow row;
    private readonly bool full;
    private bool started;
    private bool released;
    private MediaPlayer? player;
    private MediaPlayerElement? element;

    /// <summary>
    /// Detach the element from the player before disposing it. Disposing a player that a live
    /// MediaPlayerElement still renders leaves ghost visuals and can crash the compositor (E_ABORT).
    /// </summary>
    internal void Release()
    {
        released = started = true;
        if (player is null) return;
        try
        {
            player.Pause();
            element?.SetMediaPlayer(null);
            player.Source = null;
        }
        catch (Exception ex) { AppLog.Error("Media viewer release failed", ex); }
        Children.Clear();
        ChatMedia.Release(player);
        player = null; element = null;
    }

    public MediaAttachment(MessageRow row, bool full)
    {
        this.row = row;
        this.full = full;
        Background = full ? null : WebBrush.Get(this, "PanelBrush");
        MinHeight = full ? 160 : 0;
        ShowIcon();
        if (full) Loaded += async (_, _) => await StartAsync();
        else EffectiveViewportChanged += async (_, e) =>
        {
            // rootMargin 200px: start once the tile is within 200px of the viewport.
            if (!started && e.BringIntoViewDistanceY < 200 && e.BringIntoViewDistanceX < 200) await StartAsync();
        };
    }

    private string Mime => ((string?)MediaContent.FileOf(row.Content)?["mime_type"] ?? "").ToLowerInvariant();

    private void ShowIcon()
    {
        Children.Clear();
        var kind = Mime.StartsWith("audio/", StringComparison.Ordinal) ? "music" : Mime.StartsWith("video/", StringComparison.Ordinal) ? "play" : "document";
        var icon = new LucideIcon { Kind = kind, Size = 32, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        icon.SetStroke(WebBrush.Get(this, "ChatAccentBrush"));
        Children.Add(icon);
    }

    private void ShowError()
    {
        Children.Clear();
        Children.Add(new TextBlock { Text = UiStrings.Get("Media_mediaLibrary_previewUnavailable"), FontSize = 12, Foreground = WebBrush.Get(this, "DangerBrush"), Margin = new Thickness(12), TextWrapping = TextWrapping.Wrap, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
    }

    private async Task StartAsync()
    {
        if (started) return;
        started = true;
        var file = MediaContent.FileOf(row.Content);
        var uri = (string?)file?["uri"] ?? "";
        var image = Mime.StartsWith("image/", StringComparison.Ordinal);
        var video = Mime.StartsWith("video/", StringComparison.Ordinal);
        var audio = Mime.StartsWith("audio/", StringComparison.Ordinal);
        if (!image && !video && !(full && audio)) return;
        var stored = MediaContent.StoragePath(uri) is not null;
        if (!stored && !uri.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            Children.Clear();
            var spinner = new ProgressRing { IsActive = true, Width = 24, Height = 24 };
            Children.Add(spinner);
            Uri source;
            string? local = null;
            if (stored)
            {
                local = await (ChatMedia.Cache ?? throw new InvalidOperationException()).GetFileAsync(uri, (string?)file?["name"]);
                source = new Uri(audio ? await Task.Run(() => OpusWave.PlayablePath(local)) : local);
            }
            else source = new Uri(uri);
            // The viewer may have closed while the file was downloading.
            if (released) return;
            Children.Clear();
            if (image)
            {
                var bitmap = new BitmapImage(source);
                if (!full) bitmap.DecodePixelWidth = 400;
                bitmap.ImageFailed += (_, _) => ShowError();
                Children.Add(new Image { Source = bitmap, Stretch = full ? Stretch.Uniform : Stretch.UniformToFill });
            }
            else if (full)
            {
                var player = this.player = new MediaPlayer { Source = MediaSource.CreateFromUri(source), AutoPlay = false };
                // Controls sit under the frame, never over it, so the whole video stays visible.
                var layout = new Grid { RowSpacing = 12, VerticalAlignment = audio ? VerticalAlignment.Center : VerticalAlignment.Stretch };
                layout.RowDefinitions.Add(new RowDefinition { Height = audio ? GridLength.Auto : new GridLength(1, GridUnitType.Star) });
                layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                if (!audio)
                {
                    var element = this.element = new MediaPlayerElement { AreTransportControlsEnabled = false, Stretch = Stretch.Uniform };
                    element.SetMediaPlayer(player);
                    element.Tapped += (_, _) => MediaTransportBar.Toggle(player);
                    layout.Children.Add(element);
                }
                var bar = new MediaTransportBar(player, !audio) { MaxWidth = audio ? 480 : double.PositiveInfinity };
                SetRow(bar, 1);
                layout.Children.Add(bar);
                Children.Add(layout);
            }
            else
            {
                // Video tile: first decoded frame with the play overlay, like the web's <video preload="metadata">.
                if (local is not null)
                {
                    var storage = await StorageFile.GetFileFromPathAsync(local);
                    var clip = await global::Windows.Media.Editing.MediaClip.CreateFromFileAsync(storage);
                    var composition = new global::Windows.Media.Editing.MediaComposition();
                    composition.Clips.Add(clip);
                    using var thumbnail = await composition.GetThumbnailAsync(TimeSpan.Zero, 400, 0, global::Windows.Media.Editing.VideoFramePrecision.NearestFrame);
                    var bitmap = new BitmapImage();
                    await bitmap.SetSourceAsync(thumbnail);
                    Children.Add(new Image { Source = bitmap, Stretch = Stretch.UniformToFill });
                }
                var play = new LucideIcon { Kind = "play", Size = 24, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
                play.SetStroke(new SolidColorBrush(Microsoft.UI.Colors.White));
                Children.Add(new Border { Width = 40, Height = 40, CornerRadius = new CornerRadius(20), Background = WebBrush.Color("#80000000"), Child = play, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
            }
        }
        catch (Exception ex)
        {
            AppLog.Error("Media library preview failed", ex);
            ShowError();
        }
    }
}

/// <summary>Play/pause, seek bar and time under the viewer's video (the web's &lt;video controls&gt; without covering the frame).</summary>
internal sealed class MediaTransportBar : Grid
{
    private readonly MediaPlayer player;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer timer;
    private bool updating;

    internal static void Toggle(MediaPlayer player)
    {
        if (player.PlaybackSession.PlaybackState == MediaPlaybackState.Playing) player.Pause();
        else ChatMedia.Play(player);
    }

    public MediaTransportBar(MediaPlayer player, bool video)
    {
        this.player = player;
        ColumnSpacing = 12;
        ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        ColumnDefinitions.Add(new ColumnDefinition());
        ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var icon = new LucideIcon { Kind = "play", Size = 16 };
        var play = new Button
        {
            Content = icon, Width = 36, Height = 36, Padding = new Thickness(0), BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(18), Background = WebBrush.Get(this, "PanelBrush"), VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(play, UiStrings.Get(video ? "PlayVideo" : "PlayAudio"));
        play.Click += (_, _) => Toggle(player);
        Children.Add(play);
        var seek = new Slider { Minimum = 0, Maximum = 1, StepFrequency = 0.1, IsThumbToolTipEnabled = false, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(seek, UiStrings.Get(video ? "SeekVideo" : "SeekAudio"));
        seek.ValueChanged += (_, e) => { if (!updating) player.PlaybackSession.Position = TimeSpan.FromSeconds(e.NewValue); };
        SetColumn(seek, 1);
        Children.Add(seek);
        var time = new TextBlock { Text = ChatMedia.Time(0) + " / " + ChatMedia.Time(0), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush"), VerticalAlignment = VerticalAlignment.Center };
        SetColumn(time, 2);
        Children.Add(time);
        timer = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread().CreateTimer();
        timer.Interval = TimeSpan.FromMilliseconds(250);
        timer.Tick += (_, _) =>
        {
            var session = this.player.PlaybackSession;
            var playing = session.PlaybackState == MediaPlaybackState.Playing;
            icon.Kind = playing ? "pause" : "play";
            AutomationProperties.SetName(play, UiStrings.Get(playing ? (video ? "PauseVideo" : "PauseAudio") : (video ? "PlayVideo" : "PlayAudio")));
            var total = session.NaturalDuration.TotalSeconds;
            updating = true;
            seek.Maximum = Math.Max(1, total);
            seek.Value = Math.Min(seek.Maximum, session.Position.TotalSeconds);
            updating = false;
            time.Text = ChatMedia.Time(session.Position.TotalSeconds) + " / " + ChatMedia.Time(total);
        };
        Loaded += (_, _) => timer.Start();
        Unloaded += (_, _) => timer.Stop();
    }
}
