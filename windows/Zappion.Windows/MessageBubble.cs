// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Automation;
using Windows.UI.Text;
using Zappion.Windows.Core;

using System.ComponentModel;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows;

public sealed class MessageBubble : ContentControl
{
    private MessageItem? item;
    private MessageRow? renderedMessage;
    private StackPanel? receipt;
    public MessageBubble()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        DataContextChanged += (_, _) => Attach();
        Loaded += (_, _) => Attach();
        Unloaded += (_, _) => { if (item is not null) item.PropertyChanged -= OnChanged; item = null; };
        ActualThemeChanged += (_, _) => Render();
    }

    private void Attach()
    {
        if (item is not null) item.PropertyChanged -= OnChanged;
        item = DataContext as MessageItem;
        if (item is not null) item.PropertyChanged += OnChanged;
        Render();
    }
    private void OnChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MessageItem.Tail) or "Presentation") { Render(); return; }
        if (e.PropertyName != nameof(MessageItem.Message)) return;
        var row = item?.Message;
        if (row is not null && receipt is not null && renderedMessage?.Id == row.Id &&
            renderedMessage.Timestamp == row.Timestamp && renderedMessage.SenderAddress == row.SenderAddress && renderedMessage.ExternalId == row.ExternalId &&
            MessageApprovals.IsAwaitingApproval(renderedMessage) == MessageApprovals.IsAwaitingApproval(row) &&
            JToken.DeepEquals(renderedMessage.Content, row.Content))
        {
            UpdateReceipt(row);
            renderedMessage = row;
            AutomationProperties.SetName(this, item!.AccessibilityName);
        }
        else Render();
    }
    private Brush Resource(string key)
    {
        var theme = ActualTheme == ElementTheme.Dark ? "Dark" : "Light";
        return (Brush)((ResourceDictionary)Application.Current.Resources.ThemeDictionaries[theme])[key];
    }
    private void Render()
    {
        receipt = null;
        renderedMessage = item?.Message;
        if (item is null) { Content = null; return; }
        if (item.Message is not { } message)
        {
            Content = new Border { Background = Resource("DateBrush"), CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 6, 10, 6), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 10, 0, 10), Child = new TextBlock { Text = item.DateLabel?.ToUpper(System.Globalization.CultureInfo.CurrentCulture), FontSize = 12, Foreground = Resource("DateTextBrush") } };
            AutomationProperties.SetName(this, item.DateLabel ?? UiStrings.Get("Date"));
            return;
        }
        var presentation = item;
        var validTime = DateTimeOffset.TryParse(message.Timestamp, out var timestamp);
        var local = timestamp.ToLocalTime();
        Foreground = Resource("BubbleTextBrush");
        var outgoing = string.IsNullOrEmpty(message.SenderAddress);
        var body = new Grid { ColumnSpacing = 8 };
        if (item.SearchMatch) body.Background = WebBrush.Color("#668e8b20");
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var preview = MessageHelpers.Preview(message);
        ChatMediaCard? mediaCard = null;
        if ((string?)message.Content?["type"] == "text")
        {
            var richText = CreateMessageText(preview.Text);
            richText.Foreground = Resource("BubbleTextBrush");
            body.Children.Add(richText);
        }
        else if ((string?)message.Content?["kind"] == "template")
        {
            var template = new StackPanel { Spacing = 4, MaxWidth = 384 };
            template.Children.Add(new TextBlock { Text = (string?)message.Content?["data"]?["name"] ?? UiStrings.Get("Templates"), FontSize = 12, Foreground = Resource("SubBrush") });
            if (presentation.Template is { } definition) template.Children.Add(new TemplatePreview(definition, Templates.ResolvedValues(message.Content)));
            body.Children.Add(template);
        }
        else if (MediaContent.FileOf(message.Content) is not null)
        {
            var media = new StackPanel { Spacing = 4 };
            mediaCard = new ChatMediaCard(message.Content!);
            media.Children.Add(mediaCard);
            if ((string?)message.Content?["text"] is { Length: > 0 } caption)
                media.Children.Add(CreateMessageText(MessageHelpers.MarkdownToWhatsApp(caption)));
            body.Children.Add(media);
            // Framed media has 3 px padding; the receipt sits below the content.
            body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }
        else if ((string?)message.Content?["kind"] is "location" or "contacts")
        {
            var card = new StackPanel { Spacing = 4, MaxWidth = 330 };
            var data = message.Content?["data"];
            if ((string?)message.Content?["kind"] == "location")
            {
                var coordinates = $"{data?["latitude"]}, {data?["longitude"]}";
                card.Children.Add(new TextBlock { Text = string.Join("\n", new[] { (string?)data?["name"], (string?)data?["address"], coordinates }.Where(s => !string.IsNullOrWhiteSpace(s))), TextWrapping = TextWrapping.Wrap });
                card.Children.Add(new HyperlinkButton { Content = UiStrings.Get("OpenMaps"), NavigateUri = new Uri("https://maps.google.com/?q=" + Uri.EscapeDataString(coordinates)), Padding = new Thickness(0) });
            }
            else if (data is JArray contacts)
                foreach (var contact in contacts)
                {
                    card.Children.Add(new TextBlock { Text = (string?)contact["name"]?["formatted_name"] ?? UiStrings.Get("Contact"), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
                    if (contact["phones"] is JArray phones)
                        foreach (var phone in phones) card.Children.Add(new TextBlock { Text = (string?)phone["phone"] ?? (string?)phone["wa_id"] ?? "", TextWrapping = TextWrapping.Wrap });
                }
            body.Children.Add(card);
        }
        else
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            row.Children.Add(new FontIcon
            {
                FontSize = 16,
                Glyph = preview.Icon switch
                {
                    "voice" => "\uE720",
                    "image" or "sticker" => "\uEB9F",
                    "video" => "\uE714",
                    "location" => "\uE707",
                    "contact" => "\uE77B",
                    "template" => "\uE8A5",
                    _ => "\uE8A5"
                }
            });
            row.Children.Add(new TextBlock { Foreground = Resource("BubbleTextBrush"), Text = preview.Text, TextWrapping = TextWrapping.Wrap, MaxWidth = 400 });
            body.Children.Add(row);
        }
        var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 2, 0, -2) };
        Grid.SetColumn(footer, 1);
        if (MediaContent.FileOf(message.Content) is not null) { Grid.SetRow(footer, 1); Grid.SetColumn(footer, 0); Grid.SetColumnSpan(footer, 2); }
        footer.Children.Add(new TextBlock { Foreground = Resource("SubBrush"), Text = validTime ? local.ToString("t") : "", FontSize = 11 });
        if (outgoing)
        {
            receipt = new StackPanel { Orientation = Orientation.Horizontal };
            UpdateReceipt(message);
            footer.Children.Add(receipt);
        }
        body.Children.Add(footer);
        var contents = new StackPanel { Spacing = 4 };
        if (presentation.Quoted is { } quoted)
        {
            var quote = new Button { HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(8, 4, 8, 4), CornerRadius = new CornerRadius(6), BorderThickness = new Thickness(4, 0, 0, 0), BorderBrush = Resource("ChatAccentBrush"), Background = WebBrush.Color(ActualTheme == ElementTheme.Dark ? "#0dffffff" : "#0d000000"), Content = new TextBlock { Text = (string.IsNullOrEmpty(quoted.SenderAddress) ? UiStrings.Get("You") : presentation.ContactName) + "\n" + MessageHelpers.Preview(quoted).Text, FontSize = 12, TextWrapping = TextWrapping.Wrap, MaxLines = 3 } };
            AutomationProperties.SetName(quote, ((TextBlock)quote.Content).Text);
            quote.Click += (_, _) => presentation.Jump?.Invoke(quoted.ExternalId!);
            contents.Children.Add(quote);
        }
        contents.Children.Add(body);
        var awaiting = MessageApprovals.IsAwaitingApproval(message);
        var framed = MediaContent.FileOf(message.Content) is not null && (string?)message.Content?["kind"] is not "audio" and not "sticker";
        if (awaiting) contents.Children.Add(CreateApprovalBar(message, presentation, framed));
        var bubble = new Border
        {
            Child = contents,
            Padding = new Thickness(9, 6, 9, 4),
            CornerRadius = presentation.Tail ? (outgoing ? new CornerRadius(7.5, 0, 7.5, 7.5) : new CornerRadius(0, 7.5, 7.5, 7.5)) : new CornerRadius(7.5),
            MaxWidth = 500,
            HorizontalAlignment = outgoing ? HorizontalAlignment.Right : HorizontalAlignment.Left
        };
        bubble.Background = Resource(outgoing ? "SentBubbleBrush" : "ReceivedBubbleBrush");
        if (framed) bubble.Padding = new Thickness(3);
        AutomationProperties.SetName(this, presentation.AccessibilityName);
        var wrapper = new Grid { HorizontalAlignment = outgoing ? HorizontalAlignment.Right : HorizontalAlignment.Left, Margin = new Thickness(0, presentation.Tail ? 8 : 0, 0, 2) };
        var stack = new StackPanel();
        if (awaiting)
        {
            // Not sent yet: a dashed outline sets it apart from delivered messages.
            var outlined = new Grid { HorizontalAlignment = bubble.HorizontalAlignment };
            outlined.Children.Add(bubble);
            outlined.Children.Add(new Microsoft.UI.Xaml.Shapes.Rectangle { RadiusX = 7.5, RadiusY = 7.5, Stroke = Resource("IconBrush"), Opacity = .6, StrokeThickness = 1, StrokeDashArray = new DoubleCollection { 3, 2 }, IsHitTestVisible = false });
            stack.Children.Add(outlined);
        }
        else stack.Children.Add(bubble);
        if (presentation.Reactions.Count > 0)
        {
            var reactions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = outgoing ? HorizontalAlignment.Right : HorizontalAlignment.Left };
            foreach (var group in presentation.Reactions.Values.GroupBy(x => x))
            {
                var react = new Button { Content = group.Key + (group.Count() > 1 ? " " + group.Count() : ""), FontSize = 12, Padding = new Thickness(6, 2, 6, 2), CornerRadius = new CornerRadius(12), Background = Resource("SurfaceBrush"), IsEnabled = presentation.Interactive && !string.IsNullOrEmpty(message.ExternalId) };
                ToolTipService.SetToolTip(react, string.Join(", ", presentation.Reactions.Where(x => x.Value == group.Key).Select(x => x.Key == "me" ? UiStrings.Get("You") : presentation.ContactName)));
                AutomationProperties.SetName(react, (string)react.Content);
                react.Click += (_, _) => presentation.React?.Invoke(message, group.Key);
                reactions.Children.Add(react);
            }
            stack.Children.Add(reactions);
        }
        wrapper.Children.Add(stack);
        MenuFlyout CreateMenu()
        {
            var menu = new MenuFlyout();
            var reply = new MenuFlyoutItem { Text = UiStrings.Get("Reply"), IsEnabled = presentation.Interactive && !string.IsNullOrEmpty(message.ExternalId) };
            AutomationProperties.SetName(reply, reply.Text);
            reply.Click += (_, _) => presentation.Reply?.Invoke(message); menu.Items.Add(reply);
            var reactionMenu = new MenuFlyoutSubItem { Text = UiStrings.Get("React"), IsEnabled = reply.IsEnabled };
            AutomationProperties.SetName(reactionMenu, reactionMenu.Text);
            foreach (var emoji in MessageInteractions.QuickReactions)
            {
                var choice = new MenuFlyoutItem { Text = emoji };
                AutomationProperties.SetName(choice, choice.Text);
                choice.Click += (_, _) => presentation.React?.Invoke(message, emoji); reactionMenu.Items.Add(choice);
            }
            menu.Items.Add(reactionMenu);
            var copy = new MenuFlyoutItem { Text = UiStrings.Get("CopyText") };
            AutomationProperties.SetName(copy, copy.Text);
            copy.Click += (_, _) => { var data = new global::Windows.ApplicationModel.DataTransfer.DataPackage(); data.SetText(preview.Text); global::Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(data); }; menu.Items.Add(copy);
            var info = new MenuFlyoutItem { Text = UiStrings.Get("MessageInfo") };
            AutomationProperties.SetName(info, info.Text);
            info.Click += async (_, _) =>
            {
                try
                {
                    var infoMessage = presentation.Message ?? message;
                    var infoValid = DateTimeOffset.TryParse(infoMessage.Timestamp, out var infoTime);
                    var lines = new List<string> { UiStrings.Get("Date") + ": " + (infoValid ? infoTime.ToLocalTime().ToString("G") : infoMessage.Timestamp) };
                    foreach (var state in new[] { "awaiting_approval", "approved", "rejected", "pending", "accepted", "sent", "delivered", "read", "failed" })
                        if (infoMessage.Status?[state] is { Type: not JTokenType.Null } value) lines.Add(UiStrings.Get(state == "pending" ? "sending" : state) + ": " + (DateTimeOffset.TryParse(value.ToString(), out var at) ? at.ToLocalTime().ToString("G") : value.ToString()));
                    await new ContentDialog { Title = UiStrings.Get("MessageInfo"), Content = new TextBlock { Text = string.Join("\n", lines), IsTextSelectionEnabled = true, TextWrapping = TextWrapping.Wrap }, CloseButtonText = UiStrings.Get("Close"), XamlRoot = XamlRoot, RequestedTheme = ActualTheme }.ShowAsync();

                }
                catch (Exception callbackError) { AppLog.Error("UI callback failed in MessageBubble", callbackError); }
            }; menu.Items.Add(info);
            return menu;
        }
        ContextFlyout = CreateMenu();
        if (mediaCard is not null) mediaCard.MessageMenu = CreateMenu;
        if (presentation.Tail)
        {
            var tail = new Microsoft.UI.Xaml.Shapes.Polygon { Fill = bubble.Background, Points = outgoing ? new PointCollection { new(0, 0), new(12, 0), new(0, 12) } : new PointCollection { new(0, 0), new(12, 0), new(12, 12) }, Width = 12, Height = 12, HorizontalAlignment = outgoing ? HorizontalAlignment.Right : HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = outgoing ? new Thickness(0, 0, -8, 0) : new Thickness(-8, 0, 0, 0) };
            wrapper.Children.Add(tail);
        }
        void ResizeBubble()
        {
            var room = Parent as FrameworkElement;
            var width = room?.ActualWidth ?? 0;
            if (width > 0) bubble.MaxWidth = width * (width + 464 >= 1280 ? .65 : width + 464 >= 1024 ? .75 : .95);
        }
        wrapper.SizeChanged += (_, _) => ResizeBubble();
        Content = wrapper;
    }

    // Mirrors ApprovalBar in web/components/message-bubble.tsx.
    private StackPanel CreateApprovalBar(MessageRow message, MessageItem presentation, bool framed)
    {
        var approval = presentation.Approval;
        var label = MessageApprovals.WaitingLabel(approval?.KeyName);
        var bar = new StackPanel { Spacing = 6, Margin = framed ? new Thickness(6, 6, 6, 4) : new Thickness(0, 6, 0, 0) };
        AutomationProperties.SetName(bar, label);
        bar.Children.Add(new Microsoft.UI.Xaml.Shapes.Line { X1 = 0, X2 = 1, Stretch = Stretch.Fill, Stroke = Resource("SubBrush"), Opacity = .4, StrokeThickness = 1, StrokeDashArray = new DoubleCollection { 3, 2 } });
        bar.Children.Add(new TextBlock { Text = label, FontSize = 12, Foreground = Resource("SubBrush"), TextWrapping = TextWrapping.Wrap });
        if (approval is not null)
        {
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            Button Choice(string text, bool approve)
            {
                var button = new Button { Content = text, FontSize = 12, Padding = new Thickness(12, 4, 12, 4), CornerRadius = new CornerRadius(14), IsEnabled = !approval.Busy };
                if (approve) { button.Background = Resource("ChatAccentBrush"); button.Foreground = new SolidColorBrush(Microsoft.UI.Colors.White); button.BorderThickness = new Thickness(0); }
                else { button.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent); button.BorderBrush = Resource("LineBrush"); button.Foreground = Resource("HeadingBrush"); }
                AutomationProperties.SetName(button, text);
                button.Click += (_, _) => presentation.Decide?.Invoke(message, approve);
                return button;
            }
            buttons.Children.Add(Choice(UiStrings.Get("Approve"), true));
            buttons.Children.Add(Choice(UiStrings.Get("Reject"), false));
            bar.Children.Add(buttons);
        }
        if (approval?.Error is { Length: > 0 } error)
        {
            var alert = new TextBlock { Text = error, FontSize = 12, Foreground = Resource("DangerBrush"), TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true };
            AutomationProperties.SetLiveSetting(alert, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Assertive);
            bar.Children.Add(alert);
        }
        return bar;
    }

    private void UpdateReceipt(MessageRow message)
    {
        var state = ChatHelpers.DeliveryState(message.Status);
        if (receipt is null) return;
        receipt.Children.Clear();
        receipt.Children.Add(DeliveryIcon.Create(message, this));
        AutomationProperties.SetName(receipt, UiStrings.Get(state));
    }

    internal static RichTextBlock CreateMessageText(string text)
    {
        var block = new RichTextBlock { FontSize = MainWindow.CurrentPreferences.MessageFontSize, LineHeight = MainWindow.CurrentPreferences.MessageFontSize * 1.38, IsTextSelectionEnabled = true, TextWrapping = TextWrapping.Wrap };
        var paragraph = new Paragraph();
        foreach (var segment in MessageText.Parse(text))
        {
            var run = new Run
            {
                Text = segment.Text,
                FontWeight = segment.Bold ? Microsoft.UI.Text.FontWeights.Bold : Microsoft.UI.Text.FontWeights.Normal,
                FontStyle = segment.Italic ? FontStyle.Italic : FontStyle.Normal,
                TextDecorations = segment.Strike ? TextDecorations.Strikethrough : TextDecorations.None
            };
            if (segment.Mono) run.FontFamily = new FontFamily("Consolas");
            if (segment.Href is { } href && Uri.TryCreate(href, UriKind.Absolute, out var target) && target.Scheme is "https" or "http")
            {
                var link = new Hyperlink { NavigateUri = target };
                link.Inlines.Add(run);
                paragraph.Inlines.Add(link);
            }
            else paragraph.Inlines.Add(run);
        }
        block.Blocks.Add(paragraph);
        return block;
    }

}
