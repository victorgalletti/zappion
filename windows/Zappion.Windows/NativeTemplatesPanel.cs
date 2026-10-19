// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Windows.ApplicationModel.DataTransfer;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Mirrors web/components/templates-manager.tsx and web/components/template-detail.tsx.
internal sealed partial class NativeTemplatesPanel : Grid, IDisposable
{
    private readonly ZappionClient client;
    private Workspace workspace;
    private string activeAddress;
    private IReadOnlyList<JObject> allTemplates = [];
    private TemplateFilters filters = Templates.EmptyTemplateFilters();
    private JObject? selected;
    private bool isLoading;
    private bool subscribed;
    private bool disposed;
    private string? loadError;
    private bool copiedJson;

    public Func<JObject, Task<JObject>>? CreateTemplateOverride { get; set; }
    public Func<string, byte[], string, string, string, Task<string>>? UploadSampleOverride { get; set; }

    public NativeTemplatesPanel(ZappionClient client, Workspace workspace, string? initialAddress = null)
    {
        this.client = client;
        this.workspace = workspace;
        var numbers = ConnectedNumbers(workspace);
        activeAddress = !string.IsNullOrWhiteSpace(initialAddress) && numbers.Any(n => n.Address == initialAddress)
            ? initialAddress!
            : numbers.FirstOrDefault()?.Address ?? "";
        Loaded += (_, _) =>
        {
            if (disposed || subscribed) return;
            subscribed = true;
            client.TemplatesChanged += OnTemplatesChanged;
            if (!isLoading && !string.IsNullOrEmpty(activeAddress)) _ = LoadTemplatesAsync(false);
        };
        Unloaded += (_, _) =>
        {
            subscribed = false;
            client.TemplatesChanged -= OnTemplatesChanged;
        };
        ActualThemeChanged += (_, _) => Render();
        Render();
        if (!string.IsNullOrEmpty(activeAddress))
            _ = LoadTemplatesAsync(false);
    }

    private void OnTemplatesChanged(string organizationId, string address)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            if (!disposed && subscribed && workspace.OrganizationId == organizationId && activeAddress == address && !isLoading)
                _ = LoadTemplatesAsync(false);
        });
    }

    public void Dispose()
    {
        disposed = true;
        subscribed = false;
        client.TemplatesChanged -= OnTemplatesChanged;
    }

    public async Task OnShownAsync(Workspace next)
    {
        if (disposed || isLoading) return;
        var previous = activeAddress;
        workspace = next;
        if (!ConnectedNumbers(workspace).Any(n => n.Address == activeAddress))
            activeAddress = ConnectedNumbers(workspace).FirstOrDefault()?.Address ?? "";
        if (previous != activeAddress) { allTemplates = []; selected = null; }
        await LoadTemplatesAsync(false);
    }

    public IReadOnlyList<JObject> CurrentTemplates => allTemplates;
    public JObject? SelectedTemplate => selected;
    public TemplateDraft? ActiveDraft => editorDraft;

    public void UpdateWorkspace(Workspace next)
    {
        workspace = next;
        var numbers = ConnectedNumbers(workspace);
        if (!numbers.Any(n => n.Address == activeAddress))
            activeAddress = numbers.FirstOrDefault()?.Address ?? "";
        Render();
    }

    public void SetTemplatesForPreview(IReadOnlyList<JObject> templates, JObject? select = null)
    {
        allTemplates = templates;
        isLoading = false;
        loadError = null;
        selected = select ?? templates.FirstOrDefault();
        Render();
    }

    private static IReadOnlyList<OrganizationAddressRow> ConnectedNumbers(Workspace w) =>
        w.Numbers.Where(n => n.Service == "whatsapp" && n.Status == "connected").ToArray();

    public async Task LoadTemplatesAsync(bool forceRefresh)
    {
        if (disposed) return;
        if (string.IsNullOrEmpty(activeAddress))
        {
            allTemplates = [];
            selected = null;
            Render();
            return;
        }
        var organizationId = workspace.OrganizationId;
        var address = activeAddress;
        isLoading = true;
        loadError = null;
        if (allTemplates.Count == 0) Render();
        try
        {
            var loaded = await client.GetAllTemplatesAsync(organizationId, address, forceRefresh);
            if (disposed || organizationId != workspace.OrganizationId || address != activeAddress) return;
            allTemplates = loaded;
            if (selected != null)
            {
                var selKey = TemplateKey(selected);
                selected = allTemplates.FirstOrDefault(t => TemplateKey(t) == selKey);
            }
            loadError = null;
        }
        catch (Exception ex)
        {
            loadError = ex.Message;
        }
        finally
        {
            isLoading = false;
            if (!disposed)
            {
                if (editorDraft != null) RefreshTemplateListOnly();
                else Render(preserveViewState: true);
            }
        }
    }

    private static string TemplateKey(JObject t) =>
        (string?)t["id"] ?? $"{(string?)t["name"]}:{(string?)t["language"]}";

    private static (SolidColorBrush Bg, SolidColorBrush Fg, SolidColorBrush Border) ToneColors(FrameworkElement el, string tone)
    {
        var dark = el.ActualTheme == ElementTheme.Dark;
        return tone switch
        {
            "emerald" => (
                WebBrush.Color(dark ? "#1F10B981" : "#FFE6F9F1"),
                WebBrush.Color(dark ? "#FF6EE7B7" : "#FF047857"),
                WebBrush.Color(dark ? "#4D10B981" : "#FFA7F3D0")),
            "amber" => (
                WebBrush.Color(dark ? "#1FF59E0B" : "#FFFEF3C7"),
                WebBrush.Color(dark ? "#FFFCD34D" : "#FFB45309"),
                WebBrush.Color(dark ? "#4DF59E0B" : "#FFFDE68A")),
            "red" => (
                WebBrush.Color(dark ? "#1FEF4444" : "#FFFEE2E2"),
                WebBrush.Color(dark ? "#FFFCA5A5" : "#FFB91C1C"),
                WebBrush.Color(dark ? "#4DEF4444" : "#FFFECACA")),
            _ => (
                (SolidColorBrush)WebBrush.Get(el, "SurfaceBrush"),
                (SolidColorBrush)WebBrush.Get(el, "SubBrush"),
                (SolidColorBrush)WebBrush.Get(el, "LineBrush"))
        };
    }

    /// <summary>The web's accent/5 tint for selected cards.</summary>
    // bg-panel/30 over the surface, as in templates-manager.tsx and template-detail.tsx.
    private SolidColorBrush PanelTint()
    {
        var panel = ((SolidColorBrush)WebBrush.Get(this, "PanelBrush")).Color;
        return new SolidColorBrush(global::Windows.UI.Color.FromArgb(0x4D, panel.R, panel.G, panel.B));
    }

    internal SolidColorBrush AccentTint()
    {
        var accent = ((SolidColorBrush)WebBrush.Get(this, "ChatAccentBrush")).Color;
        return new SolidColorBrush(global::Windows.UI.Color.FromArgb(0x14, accent.R, accent.G, accent.B));
    }

    private Border DetailSection(UIElement content) => new()
    {
        Background = WebBrush.Get(this, "SurfaceBrush"), BorderBrush = WebBrush.Get(this, "LineBrush"),
        BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(16), Child = content
    };

    public void Render(bool preserveViewState = false)
    {
        if (disposed) return;
        var restore = preserveViewState ? PanelViewState.Capture(this) : null;
        Children.Clear();
        RowDefinitions.Clear();
        ColumnDefinitions.Clear();
        Background = WebBrush.Get(this, "SurfaceBrush");

        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(72) });
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // PageHeader
        var headerGrid = new Grid
        {
            Background = WebBrush.Get(this, "SurfaceBrush"),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(20, 0, 20, 0)
        };
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        headerGrid.Children.Add(new TextBlock
        {
            Text = Templates.Text("templatesManager", "templates"),
            FontSize = 16, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush"),
            VerticalAlignment = VerticalAlignment.Center
        });

        var createBtnContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var plusIcon = new LucideIcon { Kind = "plus", Size = 16 };
        plusIcon.SetStroke(WebBrush.Color("#FFFFFFFF"));
        createBtnContent.Children.Add(plusIcon);
        createBtnContent.Children.Add(new TextBlock
        {
            Text = Templates.Text("templatesManager", "newTemplate"),
            FontSize = 14, FontWeight = FontWeights.Medium, Foreground = WebBrush.Color("#FFFFFFFF")
        });

        var createBtn = new Button
        {
            Background = WebBrush.Get(this, "ChatAccentBrush"),
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(16, 8, 16, 8),
            IsEnabled = !string.IsNullOrEmpty(activeAddress),
            VerticalAlignment = VerticalAlignment.Center,
            Content = createBtnContent
        };
        AutomationProperties.SetAutomationId(createBtn, "TemplatesCreateButton");
        AutomationProperties.SetName(createBtn, Templates.Text("templatesManager", "newTemplate"));
        createBtn.Click += (_, _) => OpenEditor(null);
        Grid.SetColumn(createBtn, 1);
        headerGrid.Children.Add(createBtn);
        rootGrid.Children.Add(headerGrid);

        // Split Body: Left column (384px) + Right column (*)
        var bodyGrid = new Grid();
        bodyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(384) });
        bodyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(bodyGrid, 1);

        var leftCol = BuildLeftColumn();
        bodyGrid.Children.Add(leftCol);

        var rightCol = BuildRightColumn();
        Grid.SetColumn(rightCol, 1);
        bodyGrid.Children.Add(rightCol);

        rootGrid.Children.Add(bodyGrid);
        Children.Add(rootGrid);

        if (editorDraft != null)
            Children.Add(BuildEditorOverlay());
        restore?.Invoke(this);
    }

    private FrameworkElement BuildLeftColumn()
    {
        var panel = new Grid
        {
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(0, 0, 1, 0)
        };
        panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        panel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var filterStack = new StackPanel
        {
            Spacing = 12,
            Padding = new Thickness(16),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(0, 0, 0, 1)
        };

        var numbers = ConnectedNumbers(workspace);
        if (numbers.Count > 1)
        {
            var instCombo = new ComboBox
            {
                HorizontalAlignment = HorizontalAlignment.Stretch,
                FontSize = 12,
                Background = WebBrush.Get(this, "InputBrush"),
                BorderBrush = WebBrush.Get(this, "LineBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16)
            };
            AutomationProperties.SetAutomationId(instCombo, "TemplatesInstanceSelect");
            AutomationProperties.SetName(instCombo, Templates.Text("mediaLibrary", "instance"));
            foreach (var n in numbers)
            {
                var label = (string?)n.Extra?["label"] ?? (string?)n.Extra?["verified_name"] ?? (string?)n.Extra?["display_phone_number"] ?? n.Address;
                var phone = (string?)n.Extra?["display_phone_number"];
                var display = !string.IsNullOrEmpty(phone) && phone != label ? $"{label} · {phone}" : label;
                instCombo.Items.Add(new ComboBoxItem { Content = display, Tag = n.Address });
            }
            instCombo.SelectedIndex = Math.Max(0, numbers.ToList().FindIndex(n => n.Address == activeAddress));
            instCombo.SelectionChanged += (_, _) =>
            {
                if (instCombo.SelectedItem is ComboBoxItem { Tag: string addr } && addr != activeAddress)
                {
                    activeAddress = addr;
                    selected = null;
                    _ = LoadTemplatesAsync(false);
                }
            };
            filterStack.Children.Add(instCombo);
        }

        // Search box
        var searchGrid = new Grid
        {
            Background = WebBrush.Get(this, "InputBrush"),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Height = 38,
            Padding = new Thickness(12, 0, 6, 0)
        };
        searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var searchIcon = new LucideIcon { Kind = "search", Size = 15, VerticalAlignment = VerticalAlignment.Center };
        searchIcon.SetStroke(WebBrush.Get(this, "SubBrush"));
        searchGrid.Children.Add(searchIcon);

        var searchBox = new TextBox
        {
            Text = filters.Query,
            PlaceholderText = Templates.Text("templatesManager", "searchTemplates"),
            FontSize = 13,
            Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)),
            BorderThickness = new Thickness(0),
            VerticalAlignment = VerticalAlignment.Center,
            Padding = new Thickness(8, 6, 8, 6)
        };
        AutomationProperties.SetAutomationId(searchBox, "TemplatesSearchBox");
        searchBox.TextChanged += (_, _) =>
        {
            filters = filters with { Query = searchBox.Text };
            RefreshTemplateListOnly();
        };
        Grid.SetColumn(searchBox, 1);
        searchGrid.Children.Add(searchBox);

        if (!string.IsNullOrEmpty(filters.Query))
        {
            var clearQueryBtn = new Button
            {
                Width = 24, Height = 24, Padding = new Thickness(0),
                Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)),
                BorderThickness = new Thickness(0),
                VerticalAlignment = VerticalAlignment.Center,
                Content = new LucideIcon { Kind = "close", Size = 14 }
            };
            clearQueryBtn.Click += (_, _) => { filters = filters with { Query = "" }; Render(); };
            Grid.SetColumn(clearQueryBtn, 2);
            searchGrid.Children.Add(clearQueryBtn);
        }
        filterStack.Children.Add(searchGrid);

        // 2x2 filter grid: Status, Category, Type, Language
        var filterGrid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        filterGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        filterGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        filterGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        filterGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var statuses = Templates.GetTemplateStatuses();
        var statusOptions = new List<(string Key, string Label)> { ("ALL", Templates.Text("templatesManager", "allStatuses")) };
        statusOptions.AddRange(Templates.StatusOrder.Select(s => (s, statuses[s].Label)));
        var statusCombo = BuildFilterCombo("TemplatesFilterStatus", statusOptions, filters.Status, val => { filters = filters with { Status = val }; Render(); });
        filterGrid.Children.Add(statusCombo);

        var categories = Templates.GetCategoryLabels();
        var categoryOptions = new List<(string Key, string Label)> { ("ALL", Templates.Text("templatesManager", "allCategories")) };
        categoryOptions.AddRange(Templates.CategoryOrder.Select(c => (c, categories[c].Label)));
        var categoryCombo = BuildFilterCombo("TemplatesFilterCategory", categoryOptions, filters.Category, val => { filters = filters with { Category = val }; Render(); });
        Grid.SetColumn(categoryCombo, 1);
        filterGrid.Children.Add(categoryCombo);

        var kinds = Templates.GetKindLabels();
        var kindOptions = new List<(string Key, string Label)> { ("ALL", Templates.Text("templatesManager", "allTypes")) };
        kindOptions.AddRange(Templates.KindOrder.Select(k => (k, kinds[k].Label)));
        var kindCombo = BuildFilterCombo("TemplatesFilterKind", kindOptions, filters.Kind, val => { filters = filters with { Kind = val }; Render(); });
        Grid.SetRow(kindCombo, 1);
        filterGrid.Children.Add(kindCombo);

        var distinctLangs = allTemplates.Select(t => (string?)t["language"] ?? "").Where(l => !string.IsNullOrEmpty(l)).Distinct().OrderBy(l => l).ToArray();
        var langOptions = new List<(string Key, string Label)> { ("ALL", Templates.Text("templatesManager", "allLanguages")) };
        langOptions.AddRange(distinctLangs.Select(l => (l, Templates.LanguageLabel(l))));
        var langCombo = BuildFilterCombo("TemplatesFilterLanguage", langOptions, filters.Language, val => { filters = filters with { Language = val }; Render(); });
        Grid.SetRow(langCombo, 1);
        Grid.SetColumn(langCombo, 1);
        filterGrid.Children.Add(langCombo);

        filterStack.Children.Add(filterGrid);

        var hasActiveFilter = !string.IsNullOrWhiteSpace(filters.Query)
            || filters.Status != "ALL" || filters.Category != "ALL" || filters.Kind != "ALL" || filters.Language != "ALL";
        if (hasActiveFilter)
        {
            var clearFiltersBtn = new Button
            {
                Padding = new Thickness(0),
                Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)),
                BorderThickness = new Thickness(0),
                Content = new TextBlock
                {
                    Text = Templates.Text("mediaLibrary", "clearFilters"),
                    FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "ChatAccentBrush")
                }
            };
            AutomationProperties.SetAutomationId(clearFiltersBtn, "TemplatesClearFiltersButton");
            clearFiltersBtn.Click += (_, _) => { filters = Templates.EmptyTemplateFilters(); Render(); };
            filterStack.Children.Add(clearFiltersBtn);
        }

        panel.Children.Add(filterStack);

        listHost = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        PopulateTemplateList();
        Grid.SetRow(listHost, 1);
        panel.Children.Add(listHost);

        return panel;
    }

    private ScrollViewer? listHost;

    private void RefreshTemplateListOnly()
    {
        if (listHost == null) return;
        var offset = listHost.VerticalOffset;
        PopulateTemplateList();
        listHost.UpdateLayout(); listHost.ChangeView(null, offset, null, true);
    }

    private void PopulateTemplateList()
    {
        if (listHost == null) return;
        var listStack = new StackPanel { Spacing = 8, Padding = new Thickness(12) };
        var filtered = Templates.FilterTemplates(allTemplates, filters);

        if (loadError != null && allTemplates.Count == 0)
        {
            var (_, fg, _) = ToneColors(this, "red");
            var errBox = new StackPanel { Spacing = 8, Padding = new Thickness(16) };
            errBox.Children.Add(new TextBlock
            {
                Text = Templates.Text("templatesManager", "FailedToLoadTemplates", ("message", loadError)),
                FontSize = 12, Foreground = fg, TextWrapping = TextWrapping.Wrap
            });
            var retryBtn = new Button
            {
                Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0),
                Content = new TextBlock { Text = Templates.Text("home", "tryAgain"), FontSize = 12, FontWeight = FontWeights.Medium, Foreground = fg }
            };
            retryBtn.Click += (_, _) => _ = LoadTemplatesAsync(true);
            errBox.Children.Add(retryBtn);
            listStack.Children.Add(errBox);
        }
        else if (string.IsNullOrEmpty(activeAddress))
        {
            listStack.Children.Add(new TextBlock
            {
                Text = Templates.Text("templatesManager", "connectAWhatsappNumberToViewTemplates"),
                FontSize = 13, Foreground = WebBrush.Get(this, "SubBrush"), TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24, 40, 24, 40)
            });
        }
        else if (isLoading && allTemplates.Count == 0)
        {
            for (var i = 0; i < 5; i++)
            {
                var skel = new StackPanel { Spacing = 8, Padding = new Thickness(16, 12, 16, 12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1) };
                skel.Children.Add(new Border { Width = 144, Height = 12, CornerRadius = new CornerRadius(4), Background = WebBrush.Get(this, "PanelBrush"), HorizontalAlignment = HorizontalAlignment.Left });
                skel.Children.Add(new Border { Width = 224, Height = 10, CornerRadius = new CornerRadius(4), Background = WebBrush.Get(this, "PanelBrush"), HorizontalAlignment = HorizontalAlignment.Left });
                listStack.Children.Add(skel);
            }
        }
        else if (filtered.Count == 0)
        {
            listStack.Children.Add(new TextBlock
            {
                Text = allTemplates.Count == 0
                    ? Templates.Text("templatesManager", "noTemplatesCreatedOnThisWabaYet")
                    : Templates.Text("templatesManager", "noTemplatesMatchTheCurrentFilters"),
                FontSize = 13, Foreground = WebBrush.Get(this, "SubBrush"), TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24, 40, 24, 40)
            });
        }
        else
        {
            var statuses = Templates.GetTemplateStatuses();
            var kinds = Templates.GetKindLabels();
            var categories = Templates.GetCategoryLabels();

            foreach (var t in filtered)
            {
                var key = TemplateKey(t);
                var isSelected = selected != null && TemplateKey(selected) == key;
                var statusStr = ((string?)t["status"] ?? "PENDING").ToUpperInvariant();
                var statusMeta = statuses.TryGetValue(statusStr, out var sm) ? sm : statuses["PENDING"];
                var kind = Templates.InferKind(t);
                var kindLabel = kinds.TryGetValue(kind, out var km) ? km.Label : kind;
                var catStr = ((string?)t["category"] ?? "MARKETING").ToUpperInvariant();
                var catLabel = categories.TryGetValue(catStr, out var cm) ? cm.Label : catStr;
                var quality = Templates.TemplateQuality(t);

                var cardStack = new StackPanel { Spacing = 4 };
                var topRow = new Grid();
                topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                topRow.Children.Add(new TextBlock
                {
                    Text = (string?)t["name"] ?? "",
                    FontSize = 14, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center
                });

                var (badgeBg, badgeFg, _) = ToneColors(this, statusMeta.Tone);
                var badge = new Border
                {
                    Background = badgeBg, CornerRadius = new CornerRadius(10), Padding = new Thickness(8, 2, 8, 2),
                    Margin = new Thickness(8, 0, 0, 0),
                    Child = new TextBlock { Text = statusMeta.Label, FontSize = 10, FontWeight = FontWeights.Medium, Foreground = badgeFg }
                };
                Grid.SetColumn(badge, 1);
                topRow.Children.Add(badge);
                cardStack.Children.Add(topRow);

                cardStack.Children.Add(new TextBlock
                {
                    Text = $"{kindLabel} · {catLabel} · {(string?)t["language"] ?? ""}",
                    FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush"), TextTrimming = TextTrimming.CharacterEllipsis
                });

                var (_, qFg, _) = ToneColors(this, quality.Tone);
                cardStack.Children.Add(new TextBlock
                {
                    Text = Templates.Text("templatesManager", "qualityScore", ("score", quality.Label)),
                    FontSize = 11, Foreground = qFg
                });

                // templates-manager.tsx: rounded-xl bordered card; selected = accent border on accent/5.
                var itemBtn = new Button
                {
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Stretch,
                    Background = isSelected ? AccentTint() : new SolidColorBrush(Microsoft.UI.Colors.Transparent),
                    BorderBrush = WebBrush.Get(this, isSelected ? "ChatAccentBrush" : "LineBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(12),
                    Padding = new Thickness(16),
                    Content = cardStack
                };
                AutomationProperties.SetAutomationId(itemBtn, $"TemplateCard_{(string?)t["name"]}");
                AutomationProperties.SetName(itemBtn, (string?)t["name"] ?? "");
                var captured = t;
                itemBtn.Click += (_, _) => { selected = captured; copiedJson = false; Render(); };
                listStack.Children.Add(itemBtn);
            }
        }
        listHost.Content = listStack;
    }

    private ComboBox BuildFilterCombo(string automationId, IReadOnlyList<(string Key, string Label)> options, string currentKey, Action<string> onChanged)
    {
        var combo = new ComboBox
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            FontSize = 12,
            Background = WebBrush.Get(this, "InputBrush"),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(16)
        };
        AutomationProperties.SetAutomationId(combo, automationId);
        var idx = 0;
        for (var i = 0; i < options.Count; i++)
        {
            combo.Items.Add(new ComboBoxItem { Content = options[i].Label, Tag = options[i].Key });
            if (options[i].Key == currentKey) idx = i;
        }
        combo.SelectedIndex = idx;
        combo.SelectionChanged += (_, _) =>
        {
            if (combo.SelectedItem is ComboBoxItem { Tag: string k } && k != currentKey)
                onChanged(k);
        };
        return combo;
    }

    private FrameworkElement BuildRightColumn()
    {
        if (selected == null)
        {
            return new Grid
            {
                Background = PanelTint(),
                Children =
                {
                    new TextBlock
                    {
                        Text = Templates.Text("templatesManager", "selectATemplateToSeeItsPreview"),
                        FontSize = 14, Foreground = WebBrush.Get(this, "SubBrush"),
                        HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
                    }
                }
            };
        }

        var t = selected;
        // template-detail.tsx: bg-panel/30 p-6, then a centered mx-auto max-w-3xl column that holds the title row too.
        var bodyStack = new StackPanel { Spacing = 20, MaxWidth = 768, HorizontalAlignment = HorizontalAlignment.Center };
        var detailScroll = new ScrollViewer
        {
            Background = PanelTint(),
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = new Border { Padding = new Thickness(24), Child = bodyStack }
        };
        detailScroll.SizeChanged += (_, e) => bodyStack.Width = Math.Max(0, Math.Min(768, e.NewSize.Width - 48));

        var topBar = new Grid { ColumnSpacing = 12 };
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        topBar.Children.Add(new TextBlock
        {
            Text = (string?)t["name"] ?? "",
            FontSize = 18, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush"),
            TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center
        });

        var actionsRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };

        var dupBtn = new Button
        {
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(16, 8, 16, 8),
            Content = new TextBlock { Text = Templates.Text("templateDetail", "duplicateAsNew"), FontSize = 14, Foreground = WebBrush.Get(this, "HeadingBrush") },
            IsEnabled = Templates.UnsupportedTemplateReason(t) is null
        };
        AutomationProperties.SetAutomationId(dupBtn, "TemplateDuplicateButton");
        dupBtn.Click += (_, _) => OpenEditor(Templates.DuplicateTemplate(t));
        actionsRow.Children.Add(dupBtn);

        var copyContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        copyContent.Children.Add(new LucideIcon { Kind = copiedJson ? "check" : "copy", Size = 14 });
        copyContent.Children.Add(new TextBlock
        {
            Text = Templates.Text("templateDetail", copiedJson ? "copied" : "copyJson"),
            FontSize = 14, Foreground = WebBrush.Get(this, "HeadingBrush")
        });
        var copyBtn = new Button
        {
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(16, 8, 16, 8),
            Content = copyContent
        };
        AutomationProperties.SetAutomationId(copyBtn, "TemplateCopyJsonButton");
        copyBtn.Click += async (_, _) =>
        {
            try
            {
                var pkg = new DataPackage();
                pkg.SetText(t.ToString(Formatting.Indented));
                Clipboard.SetContent(pkg);
                copiedJson = true;
                Render();
                await Task.Delay(1500);
                copiedJson = false;
                Render();
            }
            catch { }
        };
        actionsRow.Children.Add(copyBtn);
        Grid.SetColumn(actionsRow, 1);
        topBar.Children.Add(actionsRow);
        bodyStack.Children.Add(topBar);

        var rejectedReason = (string?)t["rejected_reason"];
        if (!string.IsNullOrWhiteSpace(rejectedReason) && !rejectedReason.Equals("NONE", StringComparison.OrdinalIgnoreCase))
        {
            var (rBg, rFg, rBorder) = ToneColors(this, "red");
            var rejRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var alertIc = new LucideIcon { Kind = "alert", Size = 16 };
            alertIc.SetStroke(rFg);
            rejRow.Children.Add(alertIc);
            rejRow.Children.Add(new TextBlock
            {
                Text = Templates.Text("templateDetail", "RejectionReason", ("reason", rejectedReason)),
                FontSize = 12, Foreground = rFg, TextWrapping = TextWrapping.Wrap
            });
            bodyStack.Children.Add(new Border
            {
                Background = rBg, BorderBrush = rBorder, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 8, 12, 8), Child = rejRow
            });
        }

        if (Templates.UnsupportedTemplateReason(t) is { } unsupported)
        {
            var (wBg, wFg, wBorder) = ToneColors(this, "amber");
            var warnRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var alertIc = new LucideIcon { Kind = "alert", Size = 16 };
            alertIc.SetStroke(wFg);
            warnRow.Children.Add(alertIc);
            warnRow.Children.Add(new TextBlock
            {
                Text = unsupported, FontSize = 12, Foreground = wFg, TextWrapping = TextWrapping.Wrap, MaxWidth = 580
            });
            bodyStack.Children.Add(new Border
            {
                Background = wBg, BorderBrush = wBorder, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 8, 12, 8), Child = warnRow
            });
        }

        // Mirrors web/components/template-detail.tsx.
        var previewCardStack = new StackPanel();
        var customerHeader = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Padding = new Thickness(16, 12, 16, 12), Background = WebBrush.Get(this, "SurfaceBrush") };
        customerHeader.Children.Add(new Border
        {
            Width = 36, Height = 36, CornerRadius = new CornerRadius(18), Background = AccentTint(),
            Child = new TextBlock
            {
                Text = "C", FontSize = 14, Foreground = WebBrush.Get(this, "ChatAccentBrush"),
                HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
            }
        });
        var custLabels = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        custLabels.Children.Add(new TextBlock { Text = Templates.Text("templateDetail", "sampleCustomer"), FontSize = 14, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush") });
        custLabels.Children.Add(new TextBlock { Text = Templates.Text("templateDetail", "sampleChatNoMessagesWillBeSent"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush") });
        customerHeader.Children.Add(custLabels);
        previewCardStack.Children.Add(customerHeader);
        previewCardStack.Children.Add(new Border { Padding = new Thickness(16), Child = new TemplatePreview(t, Templates.ExampleSendValues(t), framed: true) });
        bodyStack.Children.Add(new Border
        {
            BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12), Child = previewCardStack
        });

        var statuses = Templates.GetTemplateStatuses();
        var statusStr = ((string?)t["status"] ?? "").ToUpperInvariant();
        var kind = Templates.InferKind(t);
        var categories = Templates.GetCategoryLabels();
        var catStr = ((string?)t["category"] ?? "").ToUpperInvariant();
        var rejected = (string?)t["rejected_reason"];
        var qualityReason = (string?)t["quality_score"]?["reason"];
        if (string.IsNullOrEmpty(qualityReason) && t["quality_score"]?["reasons"] is JArray reasons && reasons.Count > 0)
            qualityReason = string.Join(" · ", reasons.Select(r => (string?)r));
        var data = new (string Label, string Value)[]
        {
            (Templates.Text("templateDetail", "type"), Templates.GetKindLabels().TryGetValue(kind, out var km) ? km.Label : kind),
            (Templates.Text("templateDetail", "category"), categories.TryGetValue(catStr, out var cm) ? cm.Label : (string?)t["category"] ?? ""),
            (Templates.Text("preferences", "language"), (string?)t["language"] ?? ""),
            (Templates.Text("templateDetail", "variableFormat"), Templates.Text("templateDetail", Templates.UsesNamedFormat(t) ? "named" : "positional")),
            (Templates.Text("templateDetail", "status"), statuses.TryGetValue(statusStr, out var sm) ? sm.Label : (string?)t["status"] ?? ""),
            (Templates.Text("templateDetail", "rejectionReason"), !string.IsNullOrEmpty(rejected) && rejected != "NONE" ? rejected
                : Templates.Text("templateDetail", statusStr == "REJECTED" ? "missingRejectionReason" : "notApplicable")),
            (Templates.Text("templateDetail", "quality"), Templates.TemplateQuality(t).Label),
            (Templates.Text("templateDetail", "qualityDetails"), !string.IsNullOrEmpty(qualityReason) ? qualityReason : Templates.Text("templateDetail", "missingQualityDetails")),
            (Templates.Text("templateDetail", "id"), (string?)t["id"] ?? ""),
        };
        var dataStack = new StackPanel { Spacing = 16 };
        dataStack.Children.Add(new TextBlock { Text = Templates.Text("templateDetail", "templateData"), FontSize = 16, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush") });
        var metaGrid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        metaGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        metaGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (var i = 0; i < data.Length; i++)
        {
            if (i % 2 == 0) metaGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var cell = new StackPanel { Spacing = 4 };
            cell.Children.Add(new TextBlock { Text = data[i].Label, FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush") });
            cell.Children.Add(new TextBlock { Text = data[i].Value, FontSize = 14, Foreground = WebBrush.Get(this, "HeadingBrush"), TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
            Grid.SetRow(cell, i / 2); Grid.SetColumn(cell, i % 2);
            metaGrid.Children.Add(cell);
        }
        dataStack.Children.Add(metaGrid);
        bodyStack.Children.Add(DetailSection(dataStack));

        var examples = Templates.ExampleFieldValues(t);
        var fields = Templates.Fields(t).Where(f => f.Required).ToArray();
        var varStack = new StackPanel { Spacing = 12 };
        varStack.Children.Add(new TextBlock { Text = Templates.Text("templateDetail", "variablesAndExamples"), FontSize = 16, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush") });
        varStack.Children.Add(new TextBlock { Text = Templates.Text("templateDetail", "examplesProvidedByTheTemplateParametersWithoutExamplesAre"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap });
        if (fields.Length == 0)
            varStack.Children.Add(new TextBlock { Text = Templates.Text("templateDetail", "thisTemplateHasNoVariables"), FontSize = 14, Foreground = WebBrush.Get(this, "SubBrush") });
        foreach (var field in fields)
        {
            var cell = new StackPanel { Spacing = 4 };
            cell.Children.Add(new TextBlock { Text = field.Label, FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush") });
            var value = examples.GetValueOrDefault(field.Key, "");
            cell.Children.Add(new TextBlock { Text = string.IsNullOrEmpty(value) ? Templates.Text("templateDetail", "noExampleProvided") : value, FontSize = 14, Foreground = WebBrush.Get(this, "HeadingBrush"), TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
            varStack.Children.Add(cell);
        }
        bodyStack.Children.Add(DetailSection(varStack));

        return detailScroll;
    }
}
