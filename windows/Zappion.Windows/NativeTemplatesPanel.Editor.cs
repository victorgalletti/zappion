// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Windows.Storage.Pickers;
using WinRT.Interop;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Mirrors web/components/template-editor.tsx.
internal sealed partial class NativeTemplatesPanel
{
    private static readonly string[] StepKeys = ["details", "content", "review"];
    private TemplateDraft? editorDraft;
    private int editorStep;
    private string? submitError;
    private bool isSubmitting;
    private string? uploadingSlot;
    private readonly Dictionary<string, string> uploadErrors = new();
    private bool showManualHeaderHandle;
    private bool showGraphPayload;
    private Border? livePreviewHost;

    public int EditorStep => editorStep;
    public string? EditorSubmitError => submitError;

    public void OpenEditor(TemplateDraft? initial = null)
    {
        editorDraft = initial != null ? initial.Clone() : Templates.NewDraft("standard");
        editorStep = 0;
        submitError = null;
        isSubmitting = false;
        uploadingSlot = null;
        uploadErrors.Clear();
        showManualHeaderHandle = !string.IsNullOrWhiteSpace(editorDraft.Header.SampleHandle);
        showGraphPayload = false;
        Render();
    }

    public void CloseEditor()
    {
        editorDraft = null;
        submitError = null;
        isSubmitting = false;
        Render();
    }

    public void SetEditorStep(int step)
    {
        editorStep = Math.Clamp(step, 0, 2);
        Render();
    }

    public static JObject PreviewTemplateFromDraft(TemplateDraft draft) => new()
    {
        ["name"] = string.IsNullOrWhiteSpace(draft.Name) ? "new_template" : draft.Name,
        ["language"] = draft.Language,
        ["category"] = draft.Category,
        ["status"] = "PENDING",
        ["components"] = Templates.DraftComponents(draft)
    };

    private static string[] AllowedHeaderFormats(string kind) => kind switch
    {
        "product" => ["PRODUCT"],
        "offer" => ["NONE", "IMAGE", "VIDEO"],
        "mpm" => ["TEXT"],
        "media" => ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"],
        "coupon" or "flow" or "callPermission" => ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"],
        _ => ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"]
    };

    private static string[] AllowedButtonTypes(string kind) => kind switch
    {
        "catalog" => ["CATALOG"],
        "mpm" => ["MPM"],
        "product" => ["SPM"],
        "offer" => ["COPY_CODE", "URL"],
        "coupon" => ["COPY_CODE", "QUICK_REPLY", "URL"],
        "flow" => ["FLOW"],
        "callPermission" => [],
        _ => ["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE", "FLOW", "VOICE_CALL"]
    };

    public void ApplyKindPreset(string kind)
    {
        if (editorDraft == null) return;
        var baseDraft = Templates.NewDraft(kind);
        var kinds = Templates.GetKindLabels();
        var allowedCats = kinds[kind].Categories;
        baseDraft.Name = editorDraft.Name;
        baseDraft.Language = editorDraft.Language;
        baseDraft.Category = allowedCats.Contains(editorDraft.Category) ? editorDraft.Category : allowedCats[0];
        if (!string.IsNullOrEmpty(editorDraft.Body.Text))
            baseDraft.Body = editorDraft.Body.Clone();
        if (kind != "offer")
            baseDraft.Footer = editorDraft.Footer;
        editorDraft = baseDraft;
        Render();
    }

    private void RefreshEditorPreviewOnly()
    {
        if (livePreviewHost == null || editorDraft == null) return;
        var previewTpl = PreviewTemplateFromDraft(editorDraft);
        var exampleVals = Templates.ExampleSendValues(previewTpl);
        exampleVals.HeaderMediaFilename = editorDraft.Header.SampleFilename;
        livePreviewHost.Child = new TemplatePreview(previewTpl, exampleVals, framed: true);
    }

    private FrameworkElement BuildEditorOverlay()
    {
        var draft = editorDraft!;
        var issues = Templates.ValidateDraft(draft);

        var backdrop = new Grid
        {
            Background = WebBrush.Color("#99000000"),
            Padding = new Thickness(24)
        };

        var dialog = new Grid
        {
            MaxWidth = 1152,
            MaxHeight = 760,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Background = WebBrush.Get(this, "SurfaceBrush"),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(16)
        };
        AutomationProperties.SetAutomationId(dialog, "TemplateEditorDialog");
        dialog.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        dialog.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        dialog.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // Header
        var headerBar = new Grid
        {
            Padding = new Thickness(20, 14, 20, 14),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(0, 0, 0, 1)
        };
        headerBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleStack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(new TextBlock
        {
            Text = Templates.Text("templateEditor", "createMessageTemplate"),
            FontSize = 16, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush")
        });
        titleStack.Children.Add(new TextBlock
        {
            Text = Templates.Text("templateEditor", "stepIndexOf", ("index", editorStep + 1), ("total", StepKeys.Length)),
            FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush")
        });
        headerBar.Children.Add(titleStack);

        var stepPills = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        for (var i = 0; i < StepKeys.Length; i++)
        {
            var isCurrent = editorStep == i;
            var pillBtn = new Button
            {
                Background = isCurrent ? WebBrush.Get(this, "ChatAccentBrush") : WebBrush.Get(this, "PanelBrush"),
                BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(12, 5, 12, 5),
                Content = new TextBlock
                {
                    Text = Templates.Text("templateEditor", StepKeys[i]),
                    FontSize = 12, FontWeight = FontWeights.Medium,
                    Foreground = isCurrent ? WebBrush.Color("#FFFFFFFF") : WebBrush.Get(this, "SubBrush")
                }
            };
            AutomationProperties.SetAutomationId(pillBtn, $"TemplateEditorStep_{StepKeys[i]}");
            var targetStep = i;
            pillBtn.Click += (_, _) => SetEditorStep(targetStep);
            stepPills.Children.Add(pillBtn);
        }

        var closeBtn = new Button
        {
            Width = 32, Height = 32, Padding = new Thickness(0), Margin = new Thickness(8, 0, 0, 0),
            Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)),
            BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8),
            Content = new LucideIcon { Kind = "close", Size = 18 }
        };
        AutomationProperties.SetAutomationId(closeBtn, "TemplateEditorCloseButton");
        closeBtn.Click += (_, _) => CloseEditor();
        stepPills.Children.Add(closeBtn);

        Grid.SetColumn(stepPills, 1);
        headerBar.Children.Add(stepPills);
        dialog.Children.Add(headerBar);

        // Body: Left Form (60%) + Right Live Preview (40%)
        var bodyGrid = new Grid();
        bodyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(6, GridUnitType.Star) });
        bodyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(4, GridUnitType.Star) });
        Grid.SetRow(bodyGrid, 1);

        var formContent = editorStep switch
        {
            0 => BuildEditorStepDetails(draft),
            1 => BuildEditorStepContent(draft),
            _ => BuildEditorStepReview(draft, issues)
        };
        var formScroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(0, 0, 1, 0),
            Content = new Border { Padding = new Thickness(20), Child = formContent }
        };
        bodyGrid.Children.Add(formScroll);

        livePreviewHost = new Border { Padding = new Thickness(20) };
        RefreshEditorPreviewOnly();
        var previewScroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = livePreviewHost
        };
        Grid.SetColumn(previewScroll, 1);
        bodyGrid.Children.Add(previewScroll);
        dialog.Children.Add(bodyGrid);

        // Footer
        var footerBar = new Grid
        {
            Padding = new Thickness(20, 12, 20, 12),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(0, 1, 0, 0)
        };
        footerBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footerBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footerBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var backContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        if (editorStep > 0) backContent.Children.Add(new LucideIcon { Kind = "chevron-left", Size = 14 });
        backContent.Children.Add(new TextBlock
        {
            Text = editorStep == 0 ? Templates.Text("metaApp", "cancel") : Templates.Text("pageHeader", "back"),
            FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush")
        });
        var backBtn = new Button
        {
            Background = WebBrush.Get(this, "SurfaceBrush"),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(14, 8, 14, 8),
            Content = backContent
        };
        AutomationProperties.SetAutomationId(backBtn, "TemplateEditorBackButton");
        backBtn.Click += (_, _) =>
        {
            if (editorStep == 0) CloseEditor();
            else SetEditorStep(editorStep - 1);
        };
        footerBar.Children.Add(backBtn);

        if (editorStep < 2)
        {
            var nextContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            nextContent.Children.Add(new TextBlock
            {
                Text = Templates.Text("templateEditor", StepKeys[editorStep + 1]),
                FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Color("#FFFFFFFF")
            });
            var chRight = new LucideIcon { Kind = "chevron-right", Size = 14 };
            chRight.SetStroke(WebBrush.Color("#FFFFFFFF"));
            nextContent.Children.Add(chRight);

            var nextBtn = new Button
            {
                Background = WebBrush.Get(this, "ChatAccentBrush"),
                BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(16, 8, 16, 8),
                Content = nextContent
            };
            AutomationProperties.SetAutomationId(nextBtn, "TemplateEditorNextButton");
            nextBtn.Click += (_, _) => SetEditorStep(editorStep + 1);
            Grid.SetColumn(nextBtn, 2);
            footerBar.Children.Add(nextBtn);
        }
        else
        {
            var submitBtn = new Button
            {
                Background = WebBrush.Get(this, "ChatAccentBrush"),
                BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(16, 8, 16, 8),
                IsEnabled = issues.Count == 0 && !isSubmitting,
                Content = new TextBlock
                {
                    Text = isSubmitting ? Templates.Text("templateEditor", "submittingToMeta") : Templates.Text("templatesManager", "newTemplate"),
                    FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Color("#FFFFFFFF")
                }
            };
            AutomationProperties.SetAutomationId(submitBtn, "TemplateEditorSubmitButton");
            submitBtn.Click += async (_, _) => await SubmitDraftAsync();
            Grid.SetColumn(submitBtn, 2);
            footerBar.Children.Add(submitBtn);
        }

        Grid.SetRow(footerBar, 2);
        dialog.Children.Add(footerBar);

        backdrop.Children.Add(dialog);
        return backdrop;
    }

    private FrameworkElement BuildEditorStepDetails(TemplateDraft draft)
    {
        var stack = new StackPanel { Spacing = 18 };
        var kinds = Templates.GetKindLabels();
        var categories = Templates.GetCategoryLabels();

        // Name + Language Grid
        var topGrid = new Grid { ColumnSpacing = 12 };
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var nameStack = new StackPanel { Spacing = 4 };
        nameStack.Children.Add(BuildFieldLabel(Templates.Text("templateEditor", "templateName"), true));
        var nameBox = new TextBox
        {
            Text = draft.Name,
            PlaceholderText = "pedido_confirmado",
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13
        };
        AutomationProperties.SetAutomationId(nameBox, "TemplateEditorNameBox");
        nameBox.TextChanged += (_, _) =>
        {
            var sanitized = Regex.Replace(nameBox.Text.ToLowerInvariant(), @"[^a-z0-9_]", "_");
            if (nameBox.Text != sanitized)
            {
                var pos = nameBox.SelectionStart;
                nameBox.Text = sanitized;
                nameBox.SelectionStart = Math.Min(pos, sanitized.Length);
            }
            draft.Name = nameBox.Text;
            RefreshEditorPreviewOnly();
        };
        nameStack.Children.Add(nameBox);
        nameStack.Children.Add(new TextBlock
        {
            Text = Templates.Text("templateEditor", "useLowercaseLettersNumbersAndUnderscoresChanging"),
            FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap
        });
        topGrid.Children.Add(nameStack);

        var langStack = new StackPanel { Spacing = 4 };
        langStack.Children.Add(BuildFieldLabel(Templates.Text("preferences", "language"), true));
        var langCombo = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, FontSize = 13 };
        AutomationProperties.SetAutomationId(langCombo, "TemplateEditorLanguageSelect");
        var languages = Templates.GetTemplateLanguages();
        var langIdx = 0;
        for (var i = 0; i < languages.Count; i++)
        {
            langCombo.Items.Add(new ComboBoxItem { Content = languages[i].Label, Tag = languages[i].Code });
            if (languages[i].Code == draft.Language) langIdx = i;
        }
        langCombo.SelectedIndex = langIdx;
        langCombo.SelectionChanged += (_, _) =>
        {
            if (langCombo.SelectedItem is ComboBoxItem { Tag: string code } && code != draft.Language)
            {
                draft.Language = code;
                RefreshEditorPreviewOnly();
            }
        };
        langStack.Children.Add(langCombo);
        Grid.SetColumn(langStack, 1);
        topGrid.Children.Add(langStack);
        stack.Children.Add(topGrid);

        // Category Cards
        var catSection = new StackPanel { Spacing = 8 };
        catSection.Children.Add(BuildFieldLabel(Templates.Text("templateEditor", "category"), true));
        var catGrid = new Grid { ColumnSpacing = 8 };
        for (var i = 0; i < 3; i++) catGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var allowedCats = kinds[draft.Kind].Categories;
        for (var i = 0; i < Templates.CategoryOrder.Length; i++)
        {
            var c = Templates.CategoryOrder[i];
            var meta = categories[c];
            var isSelected = draft.Category == c;
            var isAllowed = allowedCats.Contains(c);
            var cardContent = new StackPanel { Spacing = 2 };
            cardContent.Children.Add(new TextBlock { Text = meta.Label, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush") });
            cardContent.Children.Add(new TextBlock { Text = meta.Description, FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap });
            var catBtn = new Button
            {
                HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left, VerticalContentAlignment = VerticalAlignment.Top,
                Background = isSelected ? AccentTint() : WebBrush.Get(this, "InputBrush"),
                BorderBrush = WebBrush.Get(this, isSelected ? "ChatAccentBrush" : "LineBrush"),
                BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10, 12, 10),
                IsEnabled = isAllowed, Opacity = isAllowed ? 1.0 : 0.45,
                Content = cardContent
            };
            AutomationProperties.SetAutomationId(catBtn, $"TemplateCategory_{c}");
            var capturedCat = c;
            catBtn.Click += (_, _) => { draft.Category = capturedCat; Render(); };
            Grid.SetColumn(catBtn, i);
            catGrid.Children.Add(catBtn);
        }
        catSection.Children.Add(catGrid);
        stack.Children.Add(catSection);

        // Template Type (Kind) 2-column Grid
        var kindSection = new StackPanel { Spacing = 8 };
        kindSection.Children.Add(BuildFieldLabel(Templates.Text("templateEditor", "templateType"), true));
        var kindGrid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        kindGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        kindGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (var i = 0; i < (Templates.KindOrder.Length + 1) / 2; i++)
            kindGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        for (var i = 0; i < Templates.KindOrder.Length; i++)
        {
            var k = Templates.KindOrder[i];
            var meta = kinds[k];
            var isSelected = draft.Kind == k;
            var cardContent = new StackPanel { Spacing = 2 };
            cardContent.Children.Add(new TextBlock { Text = meta.Label, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush") });
            cardContent.Children.Add(new TextBlock { Text = meta.Description, FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap });
            var kindBtn = new Button
            {
                HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left, VerticalContentAlignment = VerticalAlignment.Top,
                Background = isSelected ? AccentTint() : WebBrush.Get(this, "InputBrush"),
                BorderBrush = WebBrush.Get(this, isSelected ? "ChatAccentBrush" : "LineBrush"),
                BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10, 12, 10),
                Content = cardContent
            };
            AutomationProperties.SetAutomationId(kindBtn, $"TemplateKind_{k}");
            var capturedKind = k;
            kindBtn.Click += (_, _) => ApplyKindPreset(capturedKind);
            Grid.SetRow(kindBtn, i / 2);
            Grid.SetColumn(kindBtn, i % 2);
            kindGrid.Children.Add(kindBtn);
        }
        kindSection.Children.Add(kindGrid);
        stack.Children.Add(kindSection);

        return stack;
    }

    private FrameworkElement BuildEditorStepContent(TemplateDraft draft)
    {
        var stack = new StackPanel { Spacing = 18 };
        if (draft.Kind == "authentication")
        {
            stack.Children.Add(BuildAuthSection(draft));
            return stack;
        }

        // Header Section
        if (draft.Kind is not ("carousel" or "productCarousel" or "catalog"))
            stack.Children.Add(BuildHeaderSection(draft));

        // Limited-time Offer Section
        if (draft.Kind == "offer")
            stack.Children.Add(BuildOfferSection(draft));

        // Body Section
        stack.Children.Add(BuildBodySection(draft));

        // Footer Section
        if (draft.Kind != "offer")
        {
            var footerStack = new StackPanel { Spacing = 4 };
            footerStack.Children.Add(BuildFieldLabel(Templates.Text("templateEditor", "footer"), false, Templates.Text("templateEditor", "optional")));
            var footerBox = new TextBox
            {
                Text = draft.Footer,
                MaxLength = Templates.Limits.Footer,
                PlaceholderText = Templates.Text("templateEditor", "upTo60CharactersNoVariablesAllowed"),
                FontSize = 13
            };
            AutomationProperties.SetAutomationId(footerBox, "TemplateEditorFooterBox");
            footerBox.TextChanged += (_, _) => { draft.Footer = footerBox.Text; RefreshEditorPreviewOnly(); };
            footerStack.Children.Add(footerBox);
            stack.Children.Add(footerStack);
        }

        // Buttons Section
        var allowedBtns = AllowedButtonTypes(draft.Kind);
        if (draft.Kind is not ("carousel" or "productCarousel") && allowedBtns.Length > 0)
            stack.Children.Add(BuildButtonsSection(draft, allowedBtns));

        // Carousel Cards Section
        if (draft.Kind is "carousel" or "productCarousel")
            stack.Children.Add(BuildCardsSection(draft));

        return stack;
    }

    private FrameworkElement BuildHeaderSection(TemplateDraft draft)
    {
        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(BuildFieldLabel(Templates.Text("templateEditor", "header"), false));

        var formats = AllowedHeaderFormats(draft.Kind);
        var formatRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var formatLabels = new Dictionary<string, string>
        {
            ["NONE"] = Templates.Text("templateEditor", "noHeader"),
            ["TEXT"] = Templates.Text("templateEditor", "text"),
            ["IMAGE"] = Templates.Text("mediaLibrary", "image"),
            ["VIDEO"] = Templates.Text("messages", "video"),
            ["DOCUMENT"] = Templates.Text("templateEditor", "document"),
            ["LOCATION"] = Templates.Text("messages", "location"),
            ["PRODUCT"] = Templates.Text("templateEditor", "productCatalog")
        };

        foreach (var fmt in formats)
        {
            var isCurrent = draft.Header.Format == fmt;
            var btn = new Button
            {
                Background = isCurrent ? WebBrush.Get(this, "ChatAccentBrush") : WebBrush.Get(this, "PanelBrush"),
                BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 5, 10, 5),
                Content = new TextBlock
                {
                    Text = formatLabels.GetValueOrDefault(fmt, fmt),
                    FontSize = 12, FontWeight = FontWeights.Medium,
                    Foreground = isCurrent ? WebBrush.Color("#FFFFFFFF") : WebBrush.Get(this, "HeadingBrush")
                }
            };
            AutomationProperties.SetAutomationId(btn, $"TemplateHeaderFormat_{fmt}");
            var capturedFmt = fmt;
            btn.Click += (_, _) =>
            {
                draft.Header = new HeaderDraft { Format = capturedFmt, Text = "", Examples = new(), SampleHandle = "" };
                Render();
            };
            formatRow.Children.Add(btn);
        }
        stack.Children.Add(formatRow);

        if (draft.Header.Format == "TEXT")
        {
            var hBox = new TextBox
            {
                Text = draft.Header.Text,
                MaxLength = Templates.Limits.HeaderText,
                PlaceholderText = "Pedido {{1}} confirmado",
                FontSize = 13
            };
            AutomationProperties.SetAutomationId(hBox, "TemplateEditorHeaderTextBox");
            var prevVars = string.Join(",", Templates.Variables(draft.Header.Text));
            hBox.TextChanged += (_, _) =>
            {
                draft.Header.Text = hBox.Text;
                var curVars = string.Join(",", Templates.Variables(draft.Header.Text));
                if (curVars != prevVars) Render();
                else RefreshEditorPreviewOnly();
            };
            stack.Children.Add(hBox);

            var hVars = Templates.Variables(draft.Header.Text);
            if (hVars.Length > 0)
            {
                var exBox = new StackPanel { Spacing = 6, Padding = new Thickness(12), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
                exBox.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "exampleForEachHeaderVariable"), FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "SubBrush") });
                foreach (var v in hVars)
                {
                    var row = new Grid { ColumnSpacing = 8 };
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    row.Children.Add(new TextBlock { Text = $"{{{{{v}}}}}", FontFamily = new FontFamily("Consolas"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush"), VerticalAlignment = VerticalAlignment.Center });
                    var vInput = new TextBox
                    {
                        Text = draft.Header.Examples.GetValueOrDefault(v, ""),
                        PlaceholderText = Templates.Text("templateEditor", "exampleValueForV", ("v", v)),
                        FontSize = 12
                    };
                    AutomationProperties.SetAutomationId(vInput, $"TemplateHeaderVarExample_{v}");
                    var capturedV = v;
                    vInput.TextChanged += (_, _) => { draft.Header.Examples[capturedV] = vInput.Text; RefreshEditorPreviewOnly(); };
                    Grid.SetColumn(vInput, 1);
                    row.Children.Add(vInput);
                    exBox.Children.Add(row);
                }
                stack.Children.Add(exBox);
            }
        }
        else if (draft.Header.Format is "IMAGE" or "VIDEO" or "DOCUMENT")
        {
            var limits = Templates.GetTemplateMediaLimits()[draft.Header.Format];
            var mediaBox = new StackPanel { Spacing = 8, Padding = new Thickness(12), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
            mediaBox.Children.Add(new TextBlock { Text = $"{Templates.Text("templateEditor", "headerSampleMedia")} *", FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "SubBrush") });

            var upRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var upContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            upContent.Children.Add(new LucideIcon { Kind = "upload", Size = 14 });
            upContent.Children.Add(new TextBlock
            {
                Text = uploadingSlot == "header"
                    ? Templates.Text("templateEditor", "uploadingSample")
                    : !string.IsNullOrEmpty(draft.Header.SampleFilename)
                        ? draft.Header.SampleFilename
                        : Templates.Text("templateEditor", "uploadFileFromComputer"),
                FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush")
            });
            var upBtn = new Button
            {
                Background = WebBrush.Get(this, "SurfaceBrush"), BorderBrush = WebBrush.Get(this, "LineBrush"),
                BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 6, 12, 6),
                IsEnabled = uploadingSlot != "header", Content = upContent
            };
            AutomationProperties.SetAutomationId(upBtn, "TemplateHeaderUploadButton");
            upBtn.Click += async (_, _) => await PickAndUploadSampleAsync("header", draft.Header.Format, (handle, fileName) =>
            {
                draft.Header.SampleHandle = handle;
                draft.Header.SampleFilename = fileName;
            });
            upRow.Children.Add(upBtn);

            if (!string.IsNullOrWhiteSpace(draft.Header.SampleHandle))
            {
                var clearSampleBtn = new Button
                {
                    Width = 28, Height = 28, Padding = new Thickness(0),
                    Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0),
                    Content = new LucideIcon { Kind = "close", Size = 14 }
                };
                clearSampleBtn.Click += (_, _) => { draft.Header.SampleHandle = ""; draft.Header.SampleFilename = null; Render(); };
                upRow.Children.Add(clearSampleBtn);
            }
            mediaBox.Children.Add(upRow);

            var maxMb = Math.Round(limits.MaxBytes / (1024.0 * 1024.0));
            mediaBox.Children.Add(new TextBlock
            {
                Text = Templates.Text("templateEditor", "acceptedTypesMaxMaxmbMbSentTo", ("types", limits.Accept), ("maxMb", maxMb)),
                FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap
            });

            if (uploadErrors.TryGetValue("header", out var upErr) && !string.IsNullOrEmpty(upErr))
            {
                var (_, rFg, _) = ToneColors(this, "red");
                mediaBox.Children.Add(new TextBlock { Text = upErr, FontSize = 11, Foreground = rFg, TextWrapping = TextWrapping.Wrap });
            }

            var manualToggle = new Button
            {
                Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0),
                Content = new TextBlock { Text = Templates.Text("templateEditor", "enterHeaderHandleManuallyAdvanced"), FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush") }
            };
            AutomationProperties.SetAutomationId(manualToggle, "TemplateHeaderManualToggle");
            manualToggle.Click += (_, _) => { showManualHeaderHandle = !showManualHeaderHandle; Render(); };
            mediaBox.Children.Add(manualToggle);

            if (showManualHeaderHandle)
            {
                var handleBox = new TextBox
                {
                    Text = draft.Header.SampleHandle,
                    PlaceholderText = Templates.Text("templateEditor", "headerHandleOrSampleMediaUrl"),
                    FontFamily = new FontFamily("Consolas"), FontSize = 12
                };
                AutomationProperties.SetAutomationId(handleBox, "TemplateEditorHeaderHandleBox");
                handleBox.TextChanged += (_, _) => { draft.Header.SampleHandle = handleBox.Text; RefreshEditorPreviewOnly(); };
                mediaBox.Children.Add(handleBox);
            }
            stack.Children.Add(mediaBox);
        }
        else if (draft.Header.Format == "PRODUCT")
        {
            stack.Children.Add(new Border
            {
                Background = WebBrush.Get(this, "PanelBrush"), CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 8, 12, 8),
                Child = new TextBlock { Text = Templates.Text("templateEditor", "ProductHeaderRequiresACatalogConnectedTo"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap }
            });
        }

        return stack;
    }

    private FrameworkElement BuildOfferSection(TemplateDraft draft)
    {
        var box = new StackPanel { Spacing = 8, Padding = new Thickness(12), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
        box.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "limitedTimeOffer"), FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush") });
        var offerBox = new TextBox
        {
            Text = draft.OfferText,
            MaxLength = Templates.Limits.OfferText,
            PlaceholderText = Templates.Text("templateEditor", "offerTextMaxCharsCharacters", ("chars", Templates.Limits.OfferText)),
            FontSize = 13
        };
        AutomationProperties.SetAutomationId(offerBox, "TemplateEditorOfferTextBox");
        offerBox.TextChanged += (_, _) => { draft.OfferText = offerBox.Text; RefreshEditorPreviewOnly(); };
        box.Children.Add(offerBox);

        var expCheck = new CheckBox
        {
            IsChecked = draft.OfferHasExpiration,
            Content = new TextBlock { Text = Templates.Text("templateEditor", "showOfferExpirationCountdown"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush") }
        };
        expCheck.Checked += (_, _) => { draft.OfferHasExpiration = true; RefreshEditorPreviewOnly(); };
        expCheck.Unchecked += (_, _) => { draft.OfferHasExpiration = false; RefreshEditorPreviewOnly(); };
        box.Children.Add(expCheck);
        return box;
    }

    private FrameworkElement BuildBodySection(TemplateDraft draft)
    {
        var stack = new StackPanel { Spacing = 6 };
        var topRow = new Grid();
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        topRow.Children.Add(BuildFieldLabel(Templates.Text("templateEditor", "body"), true));

        var rightControls = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var addVarBtn = new Button
        {
            Background = WebBrush.Get(this, "PanelBrush"), BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 3, 8, 3),
            Content = new TextBlock { Text = Templates.Text("templateEditor", "addVariable"), FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "ChatAccentBrush") }
        };
        AutomationProperties.SetAutomationId(addVarBtn, "TemplateEditorAddVariableButton");
        addVarBtn.Click += (_, _) =>
        {
            var vars = Templates.Variables(draft.Body.Text);
            var nums = vars.Where(v => Regex.IsMatch(v, @"^\d+$")).Select(int.Parse).ToArray();
            var next = nums.Length > 0 ? nums.Max() + 1 : vars.Length + 1;
            var sep = draft.Body.Text.Length == 0 || draft.Body.Text.EndsWith(' ') ? "" : " ";
            draft.Body.Text = $"{draft.Body.Text}{sep}{{{{{next}}}}} ";
            Render();
        };
        rightControls.Children.Add(addVarBtn);

        var counterBlock = new TextBlock
        {
            Text = $"{draft.Body.Text.Length}/{Templates.Limits.Body}",
            FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), VerticalAlignment = VerticalAlignment.Center
        };
        rightControls.Children.Add(counterBlock);
        Grid.SetColumn(rightControls, 1);
        topRow.Children.Add(rightControls);
        stack.Children.Add(topRow);

        var bodyBox = new TextBox
        {
            Text = draft.Body.Text,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 96,
            PlaceholderText = "Olá {{1}}, seu pedido {{2}} foi confirmado e será entregue hoje.",
            FontSize = 13
        };
        AutomationProperties.SetAutomationId(bodyBox, "TemplateEditorBodyBox");
        var prevBodyVars = string.Join(",", Templates.Variables(draft.Body.Text));
        bodyBox.TextChanged += (_, _) =>
        {
            draft.Body.Text = bodyBox.Text;
            counterBlock.Text = $"{draft.Body.Text.Length}/{Templates.Limits.Body}";
            var curVars = string.Join(",", Templates.Variables(draft.Body.Text));
            if (curVars != prevBodyVars) Render();
            else RefreshEditorPreviewOnly();
        };
        stack.Children.Add(bodyBox);
        stack.Children.Add(new TextBlock
        {
            Text = Templates.Text("templateEditor", "boldItalicStrikethroughCodeVariablesLookLike"),
            FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap
        });

        var bodyVars = Templates.Variables(draft.Body.Text);
        if (bodyVars.Length > 0)
        {
            var exStack = new StackPanel { Spacing = 6, Padding = new Thickness(12), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
            exStack.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "exampleValuesRequiredByMetaWhenVariables"), FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "SubBrush") });
            foreach (var v in bodyVars)
            {
                var row = new Grid { ColumnSpacing = 8 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(64) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.Children.Add(new TextBlock { Text = $"{{{{{v}}}}}", FontFamily = new FontFamily("Consolas"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush"), VerticalAlignment = VerticalAlignment.Center });
                var vInput = new TextBox
                {
                    Text = draft.Body.Examples.GetValueOrDefault(v, ""),
                    PlaceholderText = v == "1" ? "Maria" : v == "2" ? "#1042" : $"Exemplo para {v}",
                    FontSize = 12
                };
                AutomationProperties.SetAutomationId(vInput, $"TemplateBodyVarExample_{v}");
                var capturedV = v;
                vInput.TextChanged += (_, _) => { draft.Body.Examples[capturedV] = vInput.Text; RefreshEditorPreviewOnly(); };
                Grid.SetColumn(vInput, 1);
                row.Children.Add(vInput);
                exStack.Children.Add(row);
            }
            stack.Children.Add(exStack);
        }

        return stack;
    }

    private FrameworkElement BuildAuthSection(TemplateDraft draft)
    {
        var box = new StackPanel { Spacing = 12, Padding = new Thickness(16), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
        box.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "authenticationSettings"), FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush") });

        var otpStack = new StackPanel { Spacing = 6 };
        otpStack.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "codeDeliveryMethod"), FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush") });
        var otpRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var otpMethods = new (string Type, string Label)[]
        {
            ("COPY_CODE", Templates.Text("templateEditor", "copyCodeButton")),
            ("ONE_TAP", Templates.Text("templateEditor", "oneTapAutofillAndroid")),
            ("ZERO_TAP", Templates.Text("templateEditor", "zeroTapAutofillAndroid"))
        };
        foreach (var (mType, mLabel) in otpMethods)
        {
            var isCurrent = (draft.AuthButton.OtpType ?? "COPY_CODE") == mType;
            var btn = new Button
            {
                Background = isCurrent ? WebBrush.Get(this, "ChatAccentBrush") : WebBrush.Get(this, "SurfaceBrush"),
                BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(isCurrent ? 0 : 1),
                CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 5, 10, 5),
                Content = new TextBlock { Text = mLabel, FontSize = 12, FontWeight = FontWeights.Medium, Foreground = isCurrent ? WebBrush.Color("#FFFFFFFF") : WebBrush.Get(this, "HeadingBrush") }
            };
            AutomationProperties.SetAutomationId(btn, $"TemplateAuthOtpType_{mType}");
            var capturedType = mType;
            btn.Click += (_, _) => { draft.AuthButton.OtpType = capturedType; Render(); };
            otpRow.Children.Add(btn);
        }
        otpStack.Children.Add(otpRow);
        box.Children.Add(otpStack);

        var secCheck = new CheckBox
        {
            IsChecked = draft.AddSecurityRecommendation,
            Content = new TextBlock { Text = Templates.Text("templateEditor", "addSecurityRecommendationInBody"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush") }
        };
        secCheck.Checked += (_, _) => { draft.AddSecurityRecommendation = true; RefreshEditorPreviewOnly(); };
        secCheck.Unchecked += (_, _) => { draft.AddSecurityRecommendation = false; RefreshEditorPreviewOnly(); };
        box.Children.Add(secCheck);

        var fieldsGrid = new Grid { ColumnSpacing = 8 };
        fieldsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        fieldsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var expStack = new StackPanel { Spacing = 4 };
        expStack.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "codeExpirationMinutesOptional"), FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush") });
        var expBox = new TextBox { Text = draft.CodeExpirationMinutes, PlaceholderText = Templates.Text("templateEditor", "noExpiration"), FontSize = 12 };
        expBox.TextChanged += (_, _) => { draft.CodeExpirationMinutes = expBox.Text; RefreshEditorPreviewOnly(); };
        expStack.Children.Add(expBox);
        fieldsGrid.Children.Add(expStack);

        var lblStack = new StackPanel { Spacing = 4 };
        lblStack.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "buttonLabel"), FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush") });
        var lblBox = new TextBox { Text = draft.AuthButton.Text, MaxLength = Templates.Limits.ButtonText, PlaceholderText = Templates.Text("templatePreview", "copyCode"), FontSize = 12 };
        lblBox.TextChanged += (_, _) => { draft.AuthButton.Text = lblBox.Text; RefreshEditorPreviewOnly(); };
        lblStack.Children.Add(lblBox);
        Grid.SetColumn(lblStack, 1);
        fieldsGrid.Children.Add(lblStack);
        box.Children.Add(fieldsGrid);

        if (draft.AuthButton.OtpType is "ONE_TAP" or "ZERO_TAP")
        {
            var autoBox = new TextBox
            {
                Text = draft.AuthButton.AutofillText ?? "",
                MaxLength = Templates.Limits.ButtonText,
                PlaceholderText = Templates.Text("templateEditor", "autofillButtonLabel"),
                FontSize = 12
            };
            autoBox.TextChanged += (_, _) => { draft.AuthButton.AutofillText = autoBox.Text; RefreshEditorPreviewOnly(); };
            box.Children.Add(autoBox);

            var appsHeader = new Grid();
            appsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            appsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            appsHeader.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "androidApps"), FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "SubBrush") });
            var addAppBtn = new Button
            {
                Padding = new Thickness(4, 2, 4, 2), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0),
                Content = new TextBlock { Text = Templates.Text("templateEditor", "addApp"), FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "ChatAccentBrush") }
            };
            addAppBtn.Click += (_, _) =>
            {
                draft.AuthButton.SupportedApps ??= [];
                draft.AuthButton.SupportedApps.Add(new SupportedApp("", ""));
                Render();
            };
            Grid.SetColumn(addAppBtn, 1);
            appsHeader.Children.Add(addAppBtn);
            box.Children.Add(appsHeader);

            var apps = draft.AuthButton.SupportedApps ?? [];
            for (var idx = 0; idx < apps.Count; idx++)
            {
                var appIdx = idx;
                var appRow = new Grid { ColumnSpacing = 6 };
                appRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                appRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
                appRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var pkgBox = new TextBox { Text = apps[appIdx].PackageName, PlaceholderText = Templates.Text("templateEditor", "androidPackageNameComExampleApp"), FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                pkgBox.TextChanged += (_, _) => draft.AuthButton.SupportedApps![appIdx] = draft.AuthButton.SupportedApps[appIdx] with { PackageName = pkgBox.Text };
                appRow.Children.Add(pkgBox);

                var hashBox = new TextBox { Text = apps[appIdx].SignatureHash, MaxLength = 11, PlaceholderText = Templates.Text("templateEditor", "11CharKeyHash"), FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                hashBox.TextChanged += (_, _) => draft.AuthButton.SupportedApps![appIdx] = draft.AuthButton.SupportedApps[appIdx] with { SignatureHash = hashBox.Text };
                Grid.SetColumn(hashBox, 1);
                appRow.Children.Add(hashBox);

                if (apps.Count > 1)
                {
                    var remAppBtn = new Button
                    {
                        Width = 28, Height = 28, Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0),
                        Content = new LucideIcon { Kind = "trash", Size = 14 }
                    };
                    remAppBtn.Click += (_, _) => { draft.AuthButton.SupportedApps!.RemoveAt(appIdx); Render(); };
                    Grid.SetColumn(remAppBtn, 2);
                    appRow.Children.Add(remAppBtn);
                }
                box.Children.Add(appRow);
            }

            if (draft.AuthButton.OtpType == "ZERO_TAP")
            {
                var ztCheck = new CheckBox
                {
                    IsChecked = draft.AuthButton.ZeroTapTermsAccepted ?? true,
                    Content = new TextBlock { Text = Templates.Text("templateEditor", "iUnderstandZeroTapTermsAndRequirements"), FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush") }
                };
                ztCheck.Checked += (_, _) => draft.AuthButton.ZeroTapTermsAccepted = true;
                ztCheck.Unchecked += (_, _) => draft.AuthButton.ZeroTapTermsAccepted = false;
                box.Children.Add(ztCheck);
            }
        }
        return box;
    }

    private FrameworkElement BuildButtonsSection(TemplateDraft draft, string[] allowedTypes)
    {
        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(BuildFieldLabel(Templates.Text("templateEditor", "buttons"), false, Templates.Text("templateEditor", "max10QuickRepliesAndCallTo")));

        var addRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var buttonTypeLabels = new Dictionary<string, string>
        {
            ["QUICK_REPLY"] = Templates.Text("templatesCatalog", "quickReply"),
            ["URL"] = "URL",
            ["PHONE_NUMBER"] = Templates.Text("templateEditor", "phoneCall"),
            ["COPY_CODE"] = Templates.Text("templateEditor", "copyCode"),
            ["FLOW"] = Templates.Text("templateEditor", "whatsappFlow"),
            ["VOICE_CALL"] = Templates.Text("templateEditor", "voiceCall"),
            ["CATALOG"] = Templates.Text("templateEditor", "catalog"),
            ["MPM"] = Templates.Text("templateEditor", "multiProductMpm"),
            ["SPM"] = Templates.Text("templateEditor", "singleProductSpm"),
            ["OTP"] = Templates.Text("templateEditor", "otp")
        };

        foreach (var bt in allowedTypes)
        {
            var addBtn = new Button
            {
                Background = WebBrush.Get(this, "PanelBrush"), BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 4, 10, 4),
                IsEnabled = draft.Buttons.Count < Templates.Limits.MaxButtons,
                Content = new TextBlock { Text = $"+ {buttonTypeLabels.GetValueOrDefault(bt, bt)}", FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush") }
            };
            AutomationProperties.SetAutomationId(addBtn, $"TemplateAddButton_{bt}");
            var capturedBt = bt;
            addBtn.Click += (_, _) => { draft.Buttons.Add(Templates.NewButton(capturedBt)); Render(); };
            addRow.Children.Add(addBtn);
        }
        stack.Children.Add(addRow);

        for (var idx = 0; idx < draft.Buttons.Count; idx++)
        {
            var bIdx = idx;
            var b = draft.Buttons[bIdx];
            var card = new StackPanel { Spacing = 8, Padding = new Thickness(12), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };

            var headerRow = new Grid();
            headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            headerRow.Children.Add(new TextBlock { Text = $"{bIdx + 1}. {buttonTypeLabels.GetValueOrDefault(b.Type, b.Type)}", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "SubBrush"), VerticalAlignment = VerticalAlignment.Center });

            var moveRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            var upBtn = new Button { Width = 26, Height = 26, Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), IsEnabled = bIdx > 0, Content = new LucideIcon { Kind = "up", Size = 13 } };
            upBtn.Click += (_, _) => { (draft.Buttons[bIdx - 1], draft.Buttons[bIdx]) = (draft.Buttons[bIdx], draft.Buttons[bIdx - 1]); Render(); };
            var downBtn = new Button { Width = 26, Height = 26, Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), IsEnabled = bIdx < draft.Buttons.Count - 1, Content = new LucideIcon { Kind = "down", Size = 13 } };
            downBtn.Click += (_, _) => { (draft.Buttons[bIdx + 1], draft.Buttons[bIdx]) = (draft.Buttons[bIdx], draft.Buttons[bIdx + 1]); Render(); };
            var delBtn = new Button { Width = 26, Height = 26, Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Content = new LucideIcon { Kind = "trash", Size = 13 } };
            delBtn.Click += (_, _) => { draft.Buttons.RemoveAt(bIdx); Render(); };
            moveRow.Children.Add(upBtn);
            moveRow.Children.Add(downBtn);
            moveRow.Children.Add(delBtn);
            Grid.SetColumn(moveRow, 1);
            headerRow.Children.Add(moveRow);
            card.Children.Add(headerRow);

            if (b.Type != "COPY_CODE")
            {
                var txtBox = new TextBox { Text = b.Text, MaxLength = Templates.Limits.ButtonText, PlaceholderText = Templates.Text("templateEditor", "buttonText"), FontSize = 12 };
                AutomationProperties.SetAutomationId(txtBox, $"TemplateButtonText_{bIdx}");
                txtBox.TextChanged += (_, _) => { b.Text = txtBox.Text; RefreshEditorPreviewOnly(); };
                card.Children.Add(txtBox);
            }

            if (b.Type == "URL")
            {
                var urlBox = new TextBox { Text = b.Url ?? "", PlaceholderText = Templates.Text("templateEditor", "httpsExampleComPath1"), FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                var hadUrlVars = Templates.Variables(b.Url ?? "").Length > 0;
                urlBox.TextChanged += (_, _) =>
                {
                    b.Url = urlBox.Text;
                    var hasUrlVars = Templates.Variables(b.Url ?? "").Length > 0;
                    if (hasUrlVars != hadUrlVars) Render();
                    else RefreshEditorPreviewOnly();
                };
                card.Children.Add(urlBox);
                if (Templates.Variables(b.Url ?? "").Length > 0)
                {
                    var urlExBox = new TextBox { Text = b.UrlExample ?? "", PlaceholderText = Templates.Text("templateEditor", "exampleFullUrlWithVariableResolved"), FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                    urlExBox.TextChanged += (_, _) => { b.UrlExample = urlExBox.Text; RefreshEditorPreviewOnly(); };
                    card.Children.Add(urlExBox);
                }
            }
            else if (b.Type == "PHONE_NUMBER")
            {
                var phoneBox = new TextBox { Text = b.PhoneNumber ?? "", PlaceholderText = "+5511999999999", FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                phoneBox.TextChanged += (_, _) => { b.PhoneNumber = phoneBox.Text; RefreshEditorPreviewOnly(); };
                card.Children.Add(phoneBox);
            }
            else if (b.Type == "COPY_CODE")
            {
                var codeBox = new TextBox { Text = b.Example ?? "", MaxLength = Templates.Limits.CopyCode, PlaceholderText = Templates.Text("templateEditor", "exampleCouponOrCode"), FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                codeBox.TextChanged += (_, _) => { b.Example = codeBox.Text; RefreshEditorPreviewOnly(); };
                card.Children.Add(codeBox);
            }
            else if (b.Type == "FLOW")
            {
                var flowGrid = new Grid { ColumnSpacing = 6 };
                for (var c = 0; c < 3; c++) flowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var flowIdBox = new TextBox { Text = b.FlowId ?? "", PlaceholderText = Templates.Text("templateEditor", "flowId"), FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                flowIdBox.TextChanged += (_, _) => { b.FlowId = flowIdBox.Text; RefreshEditorPreviewOnly(); };
                flowGrid.Children.Add(flowIdBox);

                var actionCombo = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, FontSize = 12 };
                actionCombo.Items.Add(new ComboBoxItem { Content = "navigate", Tag = "navigate" });
                actionCombo.Items.Add(new ComboBoxItem { Content = "data_exchange", Tag = "data_exchange" });
                actionCombo.SelectedIndex = b.FlowAction == "data_exchange" ? 1 : 0;
                actionCombo.SelectionChanged += (_, _) => { if (actionCombo.SelectedItem is ComboBoxItem { Tag: string fa }) b.FlowAction = fa; };
                Grid.SetColumn(actionCombo, 1);
                flowGrid.Children.Add(actionCombo);

                var screenBox = new TextBox { Text = b.NavigateScreen ?? "", PlaceholderText = Templates.Text("templateEditor", "firstScreenIdOptional"), FontFamily = new FontFamily("Consolas"), FontSize = 12 };
                screenBox.TextChanged += (_, _) => b.NavigateScreen = screenBox.Text;
                Grid.SetColumn(screenBox, 2);
                flowGrid.Children.Add(screenBox);
                card.Children.Add(flowGrid);
            }

            stack.Children.Add(card);
        }

        return stack;
    }

    private FrameworkElement BuildCardsSection(TemplateDraft draft)
    {
        var stack = new StackPanel { Spacing = 10 };
        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        headerRow.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "carouselCardsCount", ("count", draft.Cards.Count)), FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush"), VerticalAlignment = VerticalAlignment.Center });

        var addCardBtn = new Button
        {
            Background = WebBrush.Get(this, "PanelBrush"), BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 4, 10, 4),
            IsEnabled = draft.Cards.Count < Templates.Limits.MaxCards,
            Content = new TextBlock { Text = Templates.Text("templateEditor", "addCard"), FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "ChatAccentBrush") }
        };
        addCardBtn.Click += (_, _) =>
        {
            if (draft.Cards.Count >= Templates.Limits.MaxCards) return;
            var templateCard = draft.Cards[0];
            draft.Cards.Add(new CardDraft
            {
                HeaderFormat = templateCard.HeaderFormat,
                SampleHandle = "",
                Body = "",
                BodyExamples = new(),
                Buttons = templateCard.Buttons.Select(b => Templates.NewButton(b.Type)).ToList()
            });
            Render();
        };
        Grid.SetColumn(addCardBtn, 1);
        headerRow.Children.Add(addCardBtn);
        stack.Children.Add(headerRow);

        if (draft.Kind == "carousel")
        {
            stack.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "eachCardNeedsAnImageOrVideo"), FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap });
        }

        for (var idx = 0; idx < draft.Cards.Count; idx++)
        {
            var cIdx = idx;
            var card = draft.Cards[cIdx];
            var cardBox = new StackPanel { Spacing = 8, Padding = new Thickness(12), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };

            var cTop = new Grid();
            cTop.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            cTop.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "CardIndex", ("index", cIdx + 1)), FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush") });

            if (draft.Cards.Count > Templates.Limits.MinCards)
            {
                var remCardBtn = new Button
                {
                    Width = 26, Height = 26, Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0),
                    Content = new LucideIcon { Kind = "trash", Size = 13 }
                };
                remCardBtn.Click += (_, _) => { draft.Cards.RemoveAt(cIdx); Render(); };
                Grid.SetColumn(remCardBtn, 1);
                cTop.Children.Add(remCardBtn);
            }
            cardBox.Children.Add(cTop);

            if (draft.Kind == "carousel")
            {
                var fmtRow = new Grid { ColumnSpacing = 8 };
                fmtRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                fmtRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                fmtRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

                var fmtCombo = new ComboBox { FontSize = 12 };
                fmtCombo.Items.Add(new ComboBoxItem { Content = Templates.Text("mediaLibrary", "image"), Tag = "IMAGE" });
                fmtCombo.Items.Add(new ComboBoxItem { Content = Templates.Text("messages", "video"), Tag = "VIDEO" });
                fmtCombo.SelectedIndex = card.HeaderFormat == "VIDEO" ? 1 : 0;
                fmtCombo.SelectionChanged += (_, _) =>
                {
                    if (fmtCombo.SelectedItem is ComboBoxItem { Tag: string cf } && cf != card.HeaderFormat)
                    {
                        foreach (var c in draft.Cards) c.HeaderFormat = cf;
                        Render();
                    }
                };
                fmtRow.Children.Add(fmtCombo);

                var slot = $"card-{cIdx}";
                var upCardBtn = new Button
                {
                    Background = WebBrush.Get(this, "SurfaceBrush"), BorderBrush = WebBrush.Get(this, "LineBrush"),
                    BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 5, 10, 5),
                    IsEnabled = uploadingSlot != slot,
                    Content = new TextBlock
                    {
                        Text = uploadingSlot == slot ? Templates.Text("templateEditor", "uploadSample") : !string.IsNullOrEmpty(card.SampleFilename) ? card.SampleFilename : Templates.Text("templateEditor", "uploadImageOrVideoSample"),
                        FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush")
                    }
                };
                upCardBtn.Click += async (_, _) => await PickAndUploadSampleAsync(slot, card.HeaderFormat, (handle, fileName) =>
                {
                    card.SampleHandle = handle;
                    card.SampleFilename = fileName;
                });
                Grid.SetColumn(upCardBtn, 1);
                fmtRow.Children.Add(upCardBtn);

                var cHandleBox = new TextBox
                {
                    Text = card.SampleHandle,
                    PlaceholderText = Templates.Text("templateEditor", "headerHandle"),
                    FontFamily = new FontFamily("Consolas"), FontSize = 12
                };
                AutomationProperties.SetAutomationId(cHandleBox, $"TemplateCardHandleBox_{cIdx}");
                cHandleBox.TextChanged += (_, _) => { card.SampleHandle = cHandleBox.Text; RefreshEditorPreviewOnly(); };
                Grid.SetColumn(cHandleBox, 2);
                fmtRow.Children.Add(cHandleBox);
                cardBox.Children.Add(fmtRow);

                var cBodyBox = new TextBox
                {
                    Text = card.Body,
                    AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 56,
                    MaxLength = Templates.Limits.CardBody,
                    PlaceholderText = Templates.Text("templateEditor", "cardBody"),
                    FontSize = 12
                };
                AutomationProperties.SetAutomationId(cBodyBox, $"TemplateCardBodyBox_{cIdx}");
                var prevCardVars = string.Join(",", Templates.Variables(card.Body));
                cBodyBox.TextChanged += (_, _) =>
                {
                    card.Body = cBodyBox.Text;
                    var curVars = string.Join(",", Templates.Variables(card.Body));
                    if (curVars != prevCardVars) Render();
                    else RefreshEditorPreviewOnly();
                };
                cardBox.Children.Add(cBodyBox);

                foreach (var v in Templates.Variables(card.Body))
                {
                    var capturedV = v;
                    var cExBox = new TextBox
                    {
                        Text = card.BodyExamples.GetValueOrDefault(capturedV, ""),
                        PlaceholderText = Templates.Text("templateEditor", "exampleForV", ("v", capturedV)),
                        FontSize = 12
                    };
                    cExBox.TextChanged += (_, _) => { card.BodyExamples[capturedV] = cExBox.Text; RefreshEditorPreviewOnly(); };
                    cardBox.Children.Add(cExBox);
                }
            }

            // Card Buttons (max 2)
            var cBtnHeader = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            cBtnHeader.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "cardButtonsMax2"), FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), VerticalAlignment = VerticalAlignment.Center });
            if (draft.Kind == "carousel" && card.Buttons.Count < Templates.Limits.MaxCardButtons)
            {
                foreach (var bt in new[] { "QUICK_REPLY", "URL", "PHONE_NUMBER" })
                {
                    var capturedBt = bt;
                    var addCbBtn = new Button
                    {
                        Background = WebBrush.Get(this, "SurfaceBrush"), BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(6), Padding = new Thickness(6, 2, 6, 2),
                        Content = new TextBlock { Text = $"+ {bt}", FontSize = 10, Foreground = WebBrush.Get(this, "HeadingBrush") }
                    };
                    addCbBtn.Click += (_, _) => { card.Buttons.Add(Templates.NewButton(capturedBt)); Render(); };
                    cBtnHeader.Children.Add(addCbBtn);
                }
            }
            cardBox.Children.Add(cBtnHeader);

            for (var bIdx = 0; bIdx < card.Buttons.Count; bIdx++)
            {
                var cbIdx = bIdx;
                var cb = card.Buttons[cbIdx];
                var cbStack = new StackPanel { Spacing = 4, Padding = new Thickness(8), CornerRadius = new CornerRadius(8), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
                var cbTop = new Grid { ColumnSpacing = 6 };
                cbTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                cbTop.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                cbTop.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                cbTop.Children.Add(new TextBlock { Text = cb.Type, FontSize = 10, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "SubBrush"), VerticalAlignment = VerticalAlignment.Center });
                var cbText = new TextBox { Text = cb.Text, MaxLength = Templates.Limits.ButtonText, PlaceholderText = Templates.Text("templateEditor", "buttonText"), FontSize = 12 };
                cbText.TextChanged += (_, _) => { cb.Text = cbText.Text; RefreshEditorPreviewOnly(); };
                Grid.SetColumn(cbText, 1);
                cbTop.Children.Add(cbText);
                if (draft.Kind == "carousel")
                {
                    var remCbBtn = new Button { Width = 24, Height = 24, Padding = new Thickness(0), Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Content = new LucideIcon { Kind = "close", Size = 12 } };
                    remCbBtn.Click += (_, _) => { card.Buttons.RemoveAt(cbIdx); Render(); };
                    Grid.SetColumn(remCbBtn, 2);
                    cbTop.Children.Add(remCbBtn);
                }
                cbStack.Children.Add(cbTop);
                if (cb.Type == "URL")
                {
                    var cbUrl = new TextBox { Text = cb.Url ?? "", PlaceholderText = Templates.Text("templateEditor", "httpsExampleComPath1"), FontFamily = new FontFamily("Consolas"), FontSize = 11 };
                    cbUrl.TextChanged += (_, _) => { cb.Url = cbUrl.Text; RefreshEditorPreviewOnly(); };
                    cbStack.Children.Add(cbUrl);
                }
                cardBox.Children.Add(cbStack);
            }

            stack.Children.Add(cardBox);
        }

        return stack;
    }

    private FrameworkElement BuildEditorStepReview(TemplateDraft draft, IReadOnlyList<ValidationIssue> issues)
    {
        var stack = new StackPanel { Spacing = 16 };

        if (issues.Count > 0)
        {
            var (aBg, aFg, aBorder) = ToneColors(this, "amber");
            var warnStack = new StackPanel { Spacing = 6 };
            var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            var alertIc = new LucideIcon { Kind = "alert", Size = 15 };
            alertIc.SetStroke(aFg);
            titleRow.Children.Add(alertIc);
            titleRow.Children.Add(new TextBlock { Text = $"{Templates.Text("templateEditor", "fixBeforeSubmitting")} ({issues.Count})", FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = aFg });
            warnStack.Children.Add(titleRow);
            foreach (var issue in issues)
            {
                warnStack.Children.Add(new TextBlock { Text = $"• {issue.Message}", FontSize = 12, Foreground = aFg, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(8, 0, 0, 0) });
            }
            stack.Children.Add(new Border
            {
                Background = aBg, BorderBrush = aBorder, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12), Padding = new Thickness(14), Child = warnStack
            });
        }
        else
        {
            var (eBg, eFg, eBorder) = ToneColors(this, "emerald");
            var okRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var checkIc = new LucideIcon { Kind = "check", Size = 16 };
            checkIc.SetStroke(eFg);
            okRow.Children.Add(checkIc);
            okRow.Children.Add(new TextBlock { Text = Templates.Text("templateEditor", "readyToSubmitToMetaApprovalUsually"), FontSize = 12, Foreground = eFg, TextWrapping = TextWrapping.Wrap });
            stack.Children.Add(new Border
            {
                Background = eBg, BorderBrush = eBorder, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12), Padding = new Thickness(14), Child = okRow
            });
        }

        var kinds = Templates.GetKindLabels();
        var categories = Templates.GetCategoryLabels();
        var summaryItems = new (string Label, string Value)[]
        {
            (Templates.Text("templateEditor", "name"), string.IsNullOrWhiteSpace(draft.Name) ? "—" : draft.Name),
            (Templates.Text("preferences", "language"), Templates.LanguageLabel(draft.Language)),
            (Templates.Text("templateEditor", "category"), categories[draft.Category].Label),
            (Templates.Text("templateEditor", "type"), kinds[draft.Kind].Label),
            (Templates.Text("templateEditor", "buttons"), draft.Kind == "authentication" ? (draft.AuthButton.OtpType ?? "COPY_CODE") : draft.Buttons.Count.ToString(CultureInfo.InvariantCulture)),
            (Templates.Text("templateEditor", "cards"), draft.Cards.Count.ToString(CultureInfo.InvariantCulture))
        };

        var summaryGrid = new Grid { ColumnSpacing = 12, RowSpacing = 12, Padding = new Thickness(16), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
        summaryGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        summaryGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (var r = 0; r < 3; r++) summaryGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        for (var i = 0; i < summaryItems.Length; i++)
        {
            var cell = new StackPanel { Spacing = 2 };
            cell.Children.Add(new TextBlock { Text = summaryItems[i].Label, FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush") });
            cell.Children.Add(new TextBlock { Text = summaryItems[i].Value, FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush") });
            Grid.SetRow(cell, i / 2);
            Grid.SetColumn(cell, i % 2);
            summaryGrid.Children.Add(cell);
        }
        stack.Children.Add(summaryGrid);

        // Graph API Payload Expander
        var payloadBox = new StackPanel { Spacing = 8, Padding = new Thickness(12), CornerRadius = new CornerRadius(12), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1) };
        var togglePayloadBtn = new Button
        {
            HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left,
            Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Padding = new Thickness(0),
            Content = new TextBlock { Text = Templates.Text("templateEditor", "graphApiPayload"), FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "SubBrush") }
        };
        AutomationProperties.SetAutomationId(togglePayloadBtn, "TemplateEditorPayloadToggle");
        togglePayloadBtn.Click += (_, _) => { showGraphPayload = !showGraphPayload; Render(); };
        payloadBox.Children.Add(togglePayloadBtn);

        if (showGraphPayload)
        {
            var payloadJson = Templates.BuildCreatePayload(draft, workspace.OrganizationId, activeAddress).ToString(Formatting.Indented);
            payloadBox.Children.Add(new TextBlock
            {
                Text = payloadJson,
                FontFamily = new FontFamily("Consolas"),
                FontSize = 11,
                Foreground = WebBrush.Get(this, "HeadingBrush"),
                IsTextSelectionEnabled = true,
                TextWrapping = TextWrapping.Wrap
            });
        }
        stack.Children.Add(payloadBox);

        if (!string.IsNullOrEmpty(submitError))
        {
            var (rBg, rFg, rBorder) = ToneColors(this, "red");
            var errRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var alertIc = new LucideIcon { Kind = "alert", Size = 16 };
            alertIc.SetStroke(rFg);
            errRow.Children.Add(alertIc);
            errRow.Children.Add(new TextBlock { Text = submitError, FontSize = 12, Foreground = rFg, TextWrapping = TextWrapping.Wrap });
            stack.Children.Add(new Border
            {
                Background = rBg, BorderBrush = rBorder, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 8, 12, 8), Child = errRow
            });
        }

        return stack;
    }

    private TextBlock BuildFieldLabel(string label, bool required, string? hint = null) => new()
    {
        Text = required ? $"{label} *" : !string.IsNullOrEmpty(hint) ? $"{label} ({hint})" : label,
        FontSize = 12,
        FontWeight = FontWeights.Medium,
        Foreground = WebBrush.Get(this, "HeadingBrush")
    };

    private async Task PickAndUploadSampleAsync(string slot, string format, Action<string, string> onUploaded)
    {
        try
        {
            var picker = new FileOpenPicker();
            ChatMedia.InitializePicker(picker);
            if (format == "IMAGE") { picker.FileTypeFilter.Add(".jpg"); picker.FileTypeFilter.Add(".jpeg"); picker.FileTypeFilter.Add(".png"); }
            else if (format == "VIDEO") { picker.FileTypeFilter.Add(".mp4"); }
            else { picker.FileTypeFilter.Add(".pdf"); }

            var file = await picker.PickSingleFileAsync();
            if (file == null) return;
            var bytes = await File.ReadAllBytesAsync(file.Path);
            var ext = Path.GetExtension(file.Name).ToLowerInvariant();
            var mime = ext switch { ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png", ".mp4" => "video/mp4", ".pdf" => "application/pdf", _ => file.ContentType };
            await UploadSampleBytesAsync(slot, format, bytes, file.Name, mime, onUploaded);
        }
        catch (Exception ex)
        {
            uploadErrors[slot] = ex.Message;
            Render();
        }
    }

    public async Task UploadSampleBytesAsync(string slot, string format, byte[] bytes, string fileName, string mime, Action<string, string> onUploaded)
    {
        uploadErrors.Remove(slot);
        if (Templates.ValidateTemplateMedia(fileName, bytes.LongLength, mime, format) is { } err)
        {
            uploadErrors[slot] = err;
            Render();
            return;
        }
        uploadingSlot = slot;
        Render();
        try
        {
            var handle = UploadSampleOverride != null
                ? await UploadSampleOverride(workspace.OrganizationId, bytes, fileName, mime, format)
                : await client.UploadTemplateSampleAsync(workspace.OrganizationId, bytes, fileName, mime, format);
            onUploaded(handle, fileName);
        }
        catch (Exception ex)
        {
            uploadErrors[slot] = ex.Message;
        }
        finally
        {
            uploadingSlot = null;
            Render();
        }
    }

    public async Task SubmitDraftAsync()
    {
        if (editorDraft == null) return;
        var issues = Templates.ValidateDraft(editorDraft);
        if (issues.Count > 0)
        {
            editorStep = 2;
            Render();
            return;
        }
        isSubmitting = true;
        submitError = null;
        Render();
        try
        {
            var payload = Templates.BuildCreatePayload(editorDraft, workspace.OrganizationId, activeAddress);
            if (CreateTemplateOverride != null)
                await CreateTemplateOverride(payload);
            else
                await client.CreateTemplateAsync(payload);
            CloseEditor();
            await LoadTemplatesAsync(true);
        }
        catch (Exception ex)
        {
            submitError = ex.Message;
            isSubmitting = false;
            Render();
        }
    }
}
