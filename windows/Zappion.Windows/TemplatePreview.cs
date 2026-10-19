// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Newtonsoft.Json.Linq;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Mirrors web/components/template-preview.tsx; used in picker, bubbles, template detail, and template editor.
internal sealed class TemplatePreview : StackPanel
{
    private readonly JObject template;
    private readonly IReadOnlyDictionary<string, string>? flatValues;
    private readonly TemplateSendValues? sendValues;
    private readonly bool framedMode;
    private bool showAllButtons;

    public TemplatePreview(JObject template, IReadOnlyDictionary<string, string> values)
    {
        this.template = template;
        flatValues = values;
        framedMode = false;
        Loaded += (_, _) => Render();
        ActualThemeChanged += (_, _) => Render();
        Render();
    }

    public TemplatePreview(JObject template, TemplateSendValues? sendValues = null, bool framed = true)
    {
        this.template = template;
        this.sendValues = sendValues;
        framedMode = framed;
        Loaded += (_, _) => Render();
        ActualThemeChanged += (_, _) => Render();
        Render();
    }

    private void Render()
    {
        Children.Clear();
        if (!framedMode && flatValues != null)
        {
            RenderFlat();
            return;
        }
        RenderFramed();
    }

    private void RenderFlat()
    {
        var values = flatValues!;
        Spacing = 8;
        foreach (var (components, scope) in Templates.Scopes(template))
        {
            var content = new StackPanel { Spacing = 4 };
            var bubble = new Border { Background = WebBrush.Get(this, "SentBubbleBrush"), CornerRadius = new CornerRadius(8), Child = content };
            foreach (var c in components)
            {
                var type = Templates.Type(c); var format = ((string?)c["format"])?.ToUpperInvariant();
                if (type == "HEADER" && format is "IMAGE" or "VIDEO" or "DOCUMENT" or "LOCATION" or "PRODUCT")
                {
                    var media = values.GetValueOrDefault(scope + ".media", "");
                    var box = new Border { MinHeight = 128, CornerRadius = new CornerRadius(4), Margin = new Thickness(4), Background = WebBrush.Get(this, "PanelBrush") };
                    if (format == "IMAGE" && Uri.TryCreate(media, UriKind.Absolute, out var uri) && uri.Scheme is "file" or "https" or "http") box.Child = new Image { Source = new BitmapImage(uri), MaxHeight = 192, Stretch = Stretch.UniformToFill };
                    else if (format == "VIDEO" && Uri.TryCreate(media, UriKind.Absolute, out var videoUri) && videoUri.Scheme is "file" or "https" or "http") box.Child = new MediaPlayerElement { Source = global::Windows.Media.Core.MediaSource.CreateFromUri(videoUri), AreTransportControlsEnabled = true, MaxHeight = 192 };
                    else box.Child = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Children = { new FontIcon { Glyph = format == "VIDEO" ? "\uE714" : format == "IMAGE" ? "\uEB9F" : format == "LOCATION" ? "\uE707" : "\uE8A5", FontSize = 36 }, new TextBlock { Text = UiStrings.Get(format == "IMAGE" ? "Photo" : format == "VIDEO" ? "Video" : format == "LOCATION" ? "Location" : "Document"), FontSize = 12 } } };
                    content.Children.Add(box);
                }
                if (type is "HEADER" or "BODY" or "FOOTER")
                {
                    var text = Templates.Fill((string?)c["text"] ?? "", values, $"{scope}.{type.ToLowerInvariant()}.");
                    if (type == "BODY" && ((string?)template["category"])?.ToUpperInvariant() == "AUTHENTICATION") text = text.Length > 0 ? text.Replace("{{1}}", values.GetValueOrDefault("otp", "{{1}}"), StringComparison.Ordinal) : string.Format(UiStrings.Get("VerificationMessage"), values.GetValueOrDefault("otp", "{{1}}"));
                    if (text.Length > 0)
                    {
                        var rendered = MessageBubble.CreateMessageText(text); rendered.Margin = new Thickness(12, type == "HEADER" ? 8 : 2, 12, 4);
                        if (type == "HEADER") rendered.FontWeight = FontWeights.SemiBold;
                        if (type == "FOOTER") { rendered.FontSize = 12; rendered.Foreground = WebBrush.Get(this, "SubBrush"); }
                        content.Children.Add(rendered);
                    }
                }
                if (type == "LIMITED_TIME_OFFER") content.Children.Add(new TextBlock { Text = (string?)c["limited_time_offer"]?["text"] ?? "", Margin = new Thickness(12, 8, 12, 8), TextWrapping = TextWrapping.Wrap });
                if (c["buttons"] is JArray buttons)
                    foreach (var b in buttons) content.Children.Add(new Border { BorderThickness = new Thickness(0, 1, 0, 0), BorderBrush = WebBrush.Get(this, "LineBrush"), Padding = new Thickness(12, 8, 12, 8), Child = new TextBlock { Text = (string?)b["text"] ?? Templates.Type(b), TextAlignment = TextAlignment.Center, Foreground = WebBrush.Get(this, "ChatAccentBrush"), FontSize = 14 } });
            }
            Children.Add(bubble);
        }
    }

    private void RenderFramed()
    {
        var v = sendValues ?? Templates.ExampleSendValues(template);
        var comps = template["components"] as JArray ?? [];
        var carousel = comps.OfType<JObject>().FirstOrDefault(c => Templates.Type(c) == "CAROUSEL");
        var cards = carousel?["cards"] as JArray ?? [];

        var outerStack = new StackPanel { Spacing = 8 };
        var rootBubble = BuildBubble(comps, v, true, null);
        rootBubble.MaxWidth = 384;
        rootBubble.HorizontalAlignment = HorizontalAlignment.Center;
        outerStack.Children.Add(rootBubble);

        if (cards.Count > 0)
        {
            var cardRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Padding = new Thickness(0, 4, 0, 4) };
            for (var idx = 0; idx < cards.Count; idx++)
            {
                var cardComps = cards[idx]["components"] as JArray ?? [];
                var cardBubble = BuildBubble(cardComps, v, false, idx);
                cardBubble.Width = 240;
                cardRow.Children.Add(cardBubble);
            }
            var railScroll = new ScrollViewer
            {
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
                HorizontalScrollMode = ScrollMode.Enabled,
                VerticalScrollMode = ScrollMode.Disabled,
                Content = cardRow
            };

            var railContainer = new Grid();
            railContainer.Children.Add(railScroll);

            if (cards.Count > 1)
            {
                var prevBtn = new Button
                {
                    Width = 28, Height = 28, Padding = new Thickness(0), CornerRadius = new CornerRadius(14),
                    Background = WebBrush.Get(this, "PanelBrush"), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1),
                    HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(4, 0, 0, 0),
                    Content = new LucideIcon { Kind = "chevron-left", Size = 14 }
                };
                prevBtn.Click += (_, _) => railScroll.ChangeView(Math.Max(0, railScroll.HorizontalOffset - 248), null, null);
                var nextBtn = new Button
                {
                    Width = 28, Height = 28, Padding = new Thickness(0), CornerRadius = new CornerRadius(14),
                    Background = WebBrush.Get(this, "PanelBrush"), BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(1),
                    HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 4, 0),
                    Content = new LucideIcon { Kind = "chevron-right", Size = 14 }
                };
                nextBtn.Click += (_, _) => railScroll.ChangeView(railScroll.HorizontalOffset + 248, null, null);
                railContainer.Children.Add(prevBtn);
                railContainer.Children.Add(nextBtn);
            }
            outerStack.Children.Add(railContainer);
            outerStack.Children.Add(new TextBlock
            {
                Text = Templates.Text("templatePreview", "CardsSwipe", ("count", cards.Count)),
                FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush"), HorizontalAlignment = HorizontalAlignment.Center
            });
        }

        var wallpaper = new Border
        {
            Background = WebBrush.Get(this, "ChatBrush"),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(12),
            Child = outerStack
        };

        var framePanel = new StackPanel { Spacing = 12 };
        framePanel.Children.Add(new TextBlock
        {
            Text = Templates.Text("templatePreview", "whatsappPreviewIllustrative"),
            FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "SubBrush")
        });
        framePanel.Children.Add(wallpaper);

        Children.Add(new Border
        {
            Background = WebBrush.Get(this, "PanelBrush"),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(12),
            Child = framePanel
        });
    }

    private Border BuildBubble(JArray comps, TemplateSendValues v, bool isRoot, int? cardIndex)
    {
        var header = comps.OfType<JObject>().FirstOrDefault(c => Templates.Type(c) == "HEADER");
        var body = comps.OfType<JObject>().FirstOrDefault(c => Templates.Type(c) == "BODY");
        var footer = comps.OfType<JObject>().FirstOrDefault(c => Templates.Type(c) == "FOOTER");
        var offer = comps.OfType<JObject>().FirstOrDefault(c => Templates.Type(c) == "LIMITED_TIME_OFFER");
        var callPerm = comps.OfType<JObject>().FirstOrDefault(c => Templates.Type(c) == "CALL_PERMISSION_REQUEST");
        var buttons = comps.OfType<JObject>().FirstOrDefault(c => Templates.Type(c) == "BUTTONS")?["buttons"] as JArray ?? [];

        var headerVars = isRoot ? v.HeaderVars : new Dictionary<string, string>();
        var bodyVars = isRoot ? v.BodyVars : (cardIndex is { } ci && v.CardBodyVars.TryGetValue(ci, out var cbv) ? cbv : new Dictionary<string, string>());
        var mediaUrl = isRoot ? v.HeaderMediaUrl : (cardIndex is { } mci && v.CardMediaUrls.TryGetValue(mci, out var cmu) ? cmu : null);
        var productId = isRoot
            ? (v.ProductRetailerId ?? v.MpmThumbnailProductId)
            : (cardIndex is { } pci && v.CardProductIds.TryGetValue(pci, out var cpi) ? cpi : null);

        var isAuth = isRoot && ((string?)template["category"] ?? "").Equals("AUTHENTICATION", StringComparison.OrdinalIgnoreCase);
        var code = !string.IsNullOrWhiteSpace(v.AuthCode) ? v.AuthCode! : "123456";
        var bodyText = isAuth
            ? Templates.Text("templatePreview", "CodeIsYourVerificationCode", ("code", code))
              + ((bool?)body?["add_security_recommendation"] == true ? "\n\n" + Templates.Text("templatePreview", "forYourSecurityDoNotShareThis") : "")
            : Templates.FillVariables((string?)body?["text"] ?? "", bodyVars);

        var footerText = isAuth && footer?["code_expiration_minutes"] != null && string.IsNullOrEmpty((string?)footer?["text"])
            ? Templates.Text("templatePreview", "ThisCodeExpiresInMinutesMinutes", ("minutes", footer!["code_expiration_minutes"]!.ToString()))
            : (string?)footer?["text"] ?? "";

        var visibleButtons = isRoot && buttons.Count > 3 && !showAllButtons ? buttons.Take(2).ToArray() : buttons.ToArray();

        var bubbleStack = new StackPanel();
        var hFormat = ((string?)header?["format"] ?? "").ToUpperInvariant();
        if (header != null && hFormat == "TEXT" && !string.IsNullOrWhiteSpace((string?)header["text"]))
        {
            bubbleStack.Children.Add(new TextBlock
            {
                Text = Templates.FillVariables((string?)header["text"] ?? "", headerVars),
                FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush"),
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(12, 10, 12, 0)
            });
        }
        else if ((header != null && hFormat != "TEXT" && !string.IsNullOrEmpty(hFormat)) || (isRoot && Templates.InferKind(template) == "catalog"))
        {
            var effectiveFormat = hFormat is { Length: > 0 } ? hFormat : "PRODUCT";
            bubbleStack.Children.Add(BuildMediaBox(effectiveFormat, mediaUrl, v.HeaderMediaFilename, productId, v.LocationName, v.LocationAddress));
        }

        var bodyStack = new StackPanel { Spacing = 6, Padding = new Thickness(12, 8, 12, 6) };
        if (!string.IsNullOrWhiteSpace(bodyText))
        {
            var rendered = MessageBubble.CreateMessageText(bodyText);
            rendered.FontSize = 14;
            rendered.Foreground = WebBrush.Get(this, "HeadingBrush");
            bodyStack.Children.Add(rendered);
        }
        else if (!(!isRoot && hFormat == "PRODUCT"))
        {
            bodyStack.Children.Add(new TextBlock
            {
                Text = Templates.Text("templatePreview", "EmptyBody"),
                FontSize = 14, FontStyle = global::Windows.UI.Text.FontStyle.Italic, Foreground = WebBrush.Get(this, "SubBrush"),
                TextWrapping = TextWrapping.Wrap
            });
        }

        if (offer?["limited_time_offer"] is JObject lto)
        {
            var offerInner = new StackPanel { Spacing = 2 };
            offerInner.Children.Add(new TextBlock
            {
                Text = !string.IsNullOrWhiteSpace((string?)lto["text"]) ? (string)lto["text"]! : Templates.Text("templatePreview", "offerText"),
                FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = WebBrush.Get(this, "HeadingBrush"), TextWrapping = TextWrapping.Wrap
            });
            if ((bool?)lto["has_expiration"] == true)
            {
                var expRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
                var clockIcon = new LucideIcon { Kind = "clock", Size = 11 };
                clockIcon.SetStroke(WebBrush.Get(this, "SubBrush"));
                expRow.Children.Add(clockIcon);
                expRow.Children.Add(new TextBlock
                {
                    Text = Templates.Text("templatePreview", "offerExpiresSoon"),
                    FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush")
                });
                offerInner.Children.Add(expRow);
            }
            bodyStack.Children.Add(new Border
            {
                Background = WebBrush.Get(this, "PanelBrush"), BorderBrush = WebBrush.Get(this, "LineBrush"),
                BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 6, 8, 6),
                Child = offerInner
            });
        }

        if (!string.IsNullOrWhiteSpace(footerText))
        {
            bodyStack.Children.Add(new TextBlock
            {
                Text = footerText, FontSize = 12, Foreground = WebBrush.Get(this, "SubBrush"), TextWrapping = TextWrapping.Wrap
            });
        }

        bodyStack.Children.Add(new TextBlock
        {
            Text = "12:00 ✓✓", FontSize = 10, Foreground = WebBrush.Get(this, "SubBrush"), HorizontalAlignment = HorizontalAlignment.Right
        });
        bubbleStack.Children.Add(bodyStack);

        if (buttons.Count > 0)
        {
            var btnStack = new StackPanel();
            for (var idx = 0; idx < visibleButtons.Length; idx++)
            {
                var b = visibleButtons[idx];
                var bt = Templates.Type(b);
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
                var iconKind = bt switch
                {
                    "COPY_CODE" or "OTP" => "copy",
                    "VOICE_CALL" or "PHONE_NUMBER" => "phone",
                    "SPM" or "MPM" or "CATALOG" => "shopping-bag",
                    "URL" => "external-link",
                    _ => null
                };
                if (iconKind != null)
                {
                    var ic = new LucideIcon { Kind = iconKind, Size = 14 };
                    ic.SetStroke(WebBrush.Get(this, "ChatAccentBrush"));
                    row.Children.Add(ic);
                }
                row.Children.Add(new TextBlock
                {
                    Text = ButtonPreviewLabel(b, idx, v), FontSize = 13, FontWeight = FontWeights.Medium,
                    Foreground = WebBrush.Get(this, "ChatAccentBrush"), TextTrimming = TextTrimming.CharacterEllipsis
                });
                btnStack.Children.Add(new Border
                {
                    BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0),
                    Padding = new Thickness(12, 8, 12, 8), Child = row
                });
            }
            if (isRoot && buttons.Count > 3 && !showAllButtons)
            {
                var moreBtn = new Button
                {
                    HorizontalAlignment = HorizontalAlignment.Stretch, Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(0, 0, 0, 0)),
                    BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0), CornerRadius = new CornerRadius(0),
                    Padding = new Thickness(12, 8, 12, 8),
                    Content = new TextBlock
                    {
                        Text = $"{Templates.Text("templatePreview", "viewAllOptions")} ({buttons.Count})",
                        FontSize = 13, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "ChatAccentBrush"), HorizontalAlignment = HorizontalAlignment.Center
                    }
                };
                moreBtn.Click += (_, _) => { showAllButtons = true; Render(); };
                btnStack.Children.Add(moreBtn);
            }
            bubbleStack.Children.Add(btnStack);
        }

        if (callPerm != null)
        {
            var cpStack = new StackPanel { Spacing = 2 };
            var cpTitle = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            var phoneIc = new LucideIcon { Kind = "phone", Size = 13 };
            phoneIc.SetStroke(WebBrush.Get(this, "ChatAccentBrush"));
            cpTitle.Children.Add(phoneIc);
            cpTitle.Children.Add(new TextBlock
            {
                Text = Templates.Text("templatePreview", "allowCallsFromThisBusiness"),
                FontSize = 12, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush"), TextWrapping = TextWrapping.Wrap
            });
            cpStack.Children.Add(cpTitle);
            cpStack.Children.Add(new TextBlock
            {
                Text = Templates.Text("templatePreview", "allowDecline"),
                FontSize = 11, Foreground = WebBrush.Get(this, "SubBrush")
            });
            bubbleStack.Children.Add(new Border
            {
                BorderBrush = WebBrush.Get(this, "LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0),
                Padding = new Thickness(12, 8, 12, 8), Child = cpStack
            });
        }

        return new Border
        {
            Background = WebBrush.Get(this, "SentBubbleBrush"),
            BorderBrush = WebBrush.Get(this, "LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Child = bubbleStack
        };
    }

    private Border BuildMediaBox(string format, string? url, string? filename, string? productId, string? locationName, string? locationAddress)
    {
        var isVisualUrl = !string.IsNullOrWhiteSpace(url) && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" or "file";
        if (format == "IMAGE" && isVisualUrl && Uri.TryCreate(url, UriKind.Absolute, out var imgUri))
        {
            return new Border
            {
                Height = 144, Background = WebBrush.Get(this, "PanelBrush"), CornerRadius = new CornerRadius(7, 7, 0, 0),
                Child = new Image { Source = new BitmapImage(imgUri), Stretch = Stretch.UniformToFill }
            };
        }

        var iconKind = format switch
        {
            "PRODUCT" => "shopping-bag",
            "VIDEO" => "video",
            "DOCUMENT" => "document",
            "LOCATION" => "map-pin",
            _ => "images"
        };
        var icon = new LucideIcon { Kind = iconKind, Size = 24 };
        icon.SetStroke(WebBrush.Get(this, "SubBrush"));

        var stack = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(icon);
        var label = format switch
        {
            "PRODUCT" => !string.IsNullOrWhiteSpace(productId) ? $"SKU: {productId}" : Templates.Text("templatePreview", "productFromCatalog"),
            "DOCUMENT" => !string.IsNullOrWhiteSpace(filename) ? filename! : Templates.Text("templatePreview", "sampleDocumentPdf"),
            "LOCATION" => !string.IsNullOrWhiteSpace(locationName) ? locationName! : Templates.Text("templatePreview", "sampleLocation"),
            _ => !string.IsNullOrWhiteSpace(url) ? url! : Templates.Text("templatePreview", "sampleMedia")
        };
        stack.Children.Add(new TextBlock
        {
            Text = label, FontSize = 11, FontWeight = FontWeights.Medium, Foreground = WebBrush.Get(this, "SubBrush"),
            TextAlignment = TextAlignment.Center, MaxWidth = 220, TextTrimming = TextTrimming.CharacterEllipsis
        });
        if (format == "LOCATION" && !string.IsNullOrWhiteSpace(locationAddress))
        {
            stack.Children.Add(new TextBlock
            {
                Text = locationAddress, FontSize = 10, Foreground = WebBrush.Get(this, "SubBrush"),
                TextAlignment = TextAlignment.Center, MaxWidth = 220, TextTrimming = TextTrimming.CharacterEllipsis
            });
        }
        return new Border
        {
            MinHeight = 112, Background = WebBrush.Get(this, "PanelBrush"), CornerRadius = new CornerRadius(7, 7, 0, 0),
            Padding = new Thickness(12), Child = stack
        };
    }

    private static string ButtonPreviewLabel(JToken b, int idx, TemplateSendValues v)
    {
        var bt = Templates.Type(b);
        if (bt == "COPY_CODE")
        {
            var ex = b["example"] is JArray arr ? (string?)arr.FirstOrDefault() : (string?)b["example"];
            var code = v.ButtonCouponCodes.TryGetValue(idx, out var c) && !string.IsNullOrWhiteSpace(c) ? c : ex;
            var label = !string.IsNullOrWhiteSpace((string?)b["text"]) ? (string)b["text"]! : Templates.Text("templatePreview", "copyCode");
            return !string.IsNullOrWhiteSpace(code) ? $"{label} · {code}" : label;
        }
        if (bt == "OTP") return !string.IsNullOrWhiteSpace((string?)b["text"]) ? (string)b["text"]! : Templates.Text("templatePreview", "copyCode");
        if (bt == "CATALOG") return !string.IsNullOrWhiteSpace((string?)b["text"]) ? (string)b["text"]! : Templates.Text("templatePreview", "viewCatalog");
        if (bt == "MPM") return !string.IsNullOrWhiteSpace((string?)b["text"]) ? (string)b["text"]! : Templates.Text("templatePreview", "viewItems");
        if (bt == "SPM") return !string.IsNullOrWhiteSpace((string?)b["text"]) ? (string)b["text"]! : Templates.Text("templatePreview", "viewProduct");
        return !string.IsNullOrWhiteSpace((string?)b["text"]) ? (string)b["text"]! : Templates.Text("templatePreview", "button");
    }
}
