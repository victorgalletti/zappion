// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Microsoft.UI.Xaml.Markup;
using Zappion.Windows.Core;
using System.Text.RegularExpressions;

namespace Zappion.Windows;

internal static class WebBrush
{
    public static Brush Get(FrameworkElement element, string key) => (Brush)((ResourceDictionary)Application.Current.Resources.ThemeDictionaries[element.ActualTheme == ElementTheme.Dark ? "Dark" : "Light"])[key];
    public static SolidColorBrush Color(string hex)
    {
        var offset = hex.Length == 9 ? 3 : 1;
        return new(global::Windows.UI.Color.FromArgb(hex.Length == 9 ? Convert.ToByte(hex.Substring(1, 2), 16) : (byte)255,
            Convert.ToByte(hex.Substring(offset, 2), 16), Convert.ToByte(hex.Substring(offset + 2, 2), 16), Convert.ToByte(hex.Substring(offset + 4, 2), 16)));
    }
}

// Lucide's 24-unit paths, matching the web components (ISC license).
public sealed class LucideIcon : UserControl
{
    private string kind = "chat";
    private Brush? strokeOverride;
    public string Kind { get => kind; set { kind = value; Draw(); } }
    public double Size { get => Width; set { Width = Height = value; } }
    public LucideIcon() { Size = 20; ActualThemeChanged += (_, _) => Draw(); Draw(); }
    private void Draw()
    {
        var data = Kind switch
        {
            "building" => "M3 21 H21 M5 21 V7 H19 V21 M9 7 V3 H15 V7 M9 11 H10 M14 11 H15 M9 15 H10 M14 15 H15",
            "users" => "M16 21 V19 A4 4 0 0 0 12 15 H6 A4 4 0 0 0 2 19 V21 M13 7 A4 4 0 1 1 5 7 A4 4 0 1 1 13 7 M22 21 V19 A4 4 0 0 0 19 15 M17 3 A4 4 0 0 1 17 11",
            "smartphone" => "M7 2 H17 A2 2 0 0 1 19 4 V20 A2 2 0 0 1 17 22 H7 A2 2 0 0 1 5 20 V4 A2 2 0 0 1 7 2 Z M12 18 H12.01",
            "plug" => "M12 22 V17 M8 3 V8 M16 3 V8 M6 8 H18 V11 A6 6 0 0 1 6 11 Z",
            "sun" => "M12 3 V1 M12 23 V21 M3 12 H1 M23 12 H21 M4.2 4.2 2.8 2.8 M21.2 21.2 19.8 19.8 M4.2 19.8 2.8 21.2 M21.2 2.8 19.8 4.2 M17 12 A5 5 0 1 1 7 12 A5 5 0 1 1 17 12",
            "moon" => "M20.9 13 A9 9 0 0 1 11 3.1 A9 9 0 1 0 20.9 13 Z",
            "monitor" => "M2 3 H22 V17 H2 Z M8 21 H16 M12 17 V21",
            "sliders" => "M4 21 V14 M4 10 V3 M12 21 V12 M12 8 V3 M20 21 V16 M20 12 V3 M1 10 H7 M9 12 H15 M17 16 H23",
            "back" => "M19 12 H5 M12 19 5 12 12 5",
            "archive" => "M3 3 H21 V7 H3 Z M5 7 V21 H19 V7 M10 11 H14",
            "layout-template" => "M3 3 H21 V10 H3 Z M3 14 H9 V21 H3 Z M13 14 H21 V21 H13 Z",
            "images" => "M3 3 V17 A2 2 0 0 0 5 19 H19 M8 3 H21 V16 H8 Z M8 13 12 9 16 13 18 11 21 14 M13 6 H13.01",
            "search" => "M21 21 16.65 16.65 M19 11 A8 8 0 1 1 3 11 A8 8 0 1 1 19 11",
            "close" => "M18 6 6 18 M6 6 18 18",
            "music" => "M9 18 V5 L21 3 V16 M9 8 21 6 M9 18 A3 3 0 1 1 3 18 A3 3 0 1 1 9 18 M21 16 A3 3 0 1 1 15 16 A3 3 0 1 1 21 16",
            "send" => "M22 2 15 22 11 13 2 9 Z M22 2 11 13",
            "template" => "M4 3 H20 A1 1 0 0 1 21 4 V9 A1 1 0 0 1 20 10 H4 A1 1 0 0 1 3 9 V4 A1 1 0 0 1 4 3 Z M4 14 H11 A1 1 0 0 1 12 15 V20 A1 1 0 0 1 11 21 H4 A1 1 0 0 1 3 20 V15 A1 1 0 0 1 4 14 Z M17 14 H20 A1 1 0 0 1 21 15 V20 A1 1 0 0 1 20 21 H17 A1 1 0 0 1 16 20 V15 A1 1 0 0 1 17 14 Z",
            "plus" => "M12 5 V19 M5 12 H19",
            "mic" => "M9 5 A3 3 0 0 1 15 5 V11 A3 3 0 0 1 9 11 Z M5 10 V11 A7 7 0 0 0 19 11 V10 M12 18 V22 M8 22 H16",
            "play" => "M6 3 20 12 6 21 Z",
            "pause" => "M6 4 H10 V20 H6 Z M14 4 H18 V20 H14 Z",
            "document" => "M14 2 H6 A2 2 0 0 0 4 4 V20 A2 2 0 0 0 6 22 H18 A2 2 0 0 0 20 20 V8 Z M14 2 V8 H20 M8 13 H16 M8 17 H14",
            "arrow" => "M5 12 H19 M12 5 19 12 12 19",
            "message" => "M21 11.5 A8.38 8.38 0 0 1 20.1 15.3 A8.5 8.5 0 0 1 12.5 20 A8.38 8.38 0 0 1 8.7 19.1 L3 21 4.9 15.3 A8.38 8.38 0 0 1 4 11.5 A8.5 8.5 0 0 1 8.7 3.9 A8.38 8.38 0 0 1 12.5 3 H13 A8.48 8.48 0 0 1 21 11 V11.5 Z",
            "up" => "M6 15 12 9 18 15",
            "down" => "M6 9 12 15 18 9",
            "lock" => "M5 11 H19 V21 H5 Z M8 11 V7 A4 4 0 0 1 16 7 V11",
            "user" => "M20 21 V19 A4 4 0 0 0 16 15 H8 A4 4 0 0 0 4 19 V21 M16 7 A4 4 0 1 1 8 7 A4 4 0 1 1 16 7",
            "check" => "M20 6 9 17 4 12",
            "checks" => "M18 6 7 17 2 12 M22 6 11 17 10 16",
            "hourglass" => "M5 22 H19 M5 2 H19 M17 22 V17.828 A2 2 0 0 0 16.414 16.414 L12 12 7.586 16.414 A2 2 0 0 0 7 17.828 V22 M7 2 V6.172 A2 2 0 0 0 7.586 7.586 L12 12 16.414 7.586 A2 2 0 0 0 17 6.172 V2",
            "clock" => "M22 12 A10 10 0 1 1 2 12 A10 10 0 1 1 22 12 M12 6 V12 L16 14",
            "alert" => "M22 12 A10 10 0 1 1 2 12 A10 10 0 1 1 22 12 M12 8 V12 M12 16 V16.01",
            "settings" => "M9.7 4.2 10.2 2 H13.8 L14.3 4.2 16.3 5.4 18.5 4.8 20.3 8 18.6 9.6 V12.4 L20.3 14 18.5 17.2 16.3 16.6 14.3 17.8 13.8 20 H10.2 L9.7 17.8 7.7 16.6 5.5 17.2 3.7 14 5.4 12.4 V9.6 L3.7 8 5.5 4.8 7.7 5.4 Z M15 11 A3 3 0 1 1 9 11 A3 3 0 1 1 15 11",
            "upload" => "M21 15 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V15 M17 8 12 3 7 8 M12 3 V15",
            "download" => "M21 15 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V15 M7 10 12 15 17 10 M12 15 V3",
            "forward" => "M15 17 20 12 15 7 M4 18 V16 A4 4 0 0 1 8 12 H20",
            "link" => "M10 13 A5 5 0 0 0 17.54 13.54 L20.54 10.54 A5 5 0 0 0 13.47 3.46 L11.75 5.17 M14 11 A5 5 0 0 0 6.46 10.46 L3.46 13.46 A5 5 0 0 0 10.53 20.53 L12.24 18.82",
            "trash" => "M3 6 H21 M19 6 V20 A2 2 0 0 1 17 22 H7 A2 2 0 0 1 5 20 V6 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M10 11 V17 M14 11 V17",
            "refresh" => "M3 12 A9 9 0 0 1 12 3 A9.75 9.75 0 0 1 18.74 5.74 L21 8 M21 3 V8 H16 M21 12 A9 9 0 0 1 12 21 A9.75 9.75 0 0 1 5.26 18.26 L3 16 M8 16 H3 V21",
            "key" => "M2.586 17.414 A2 2 0 0 0 2 18.828 V21 A1 1 0 0 0 3 22 H6 A1 1 0 0 0 7 21 V20 A1 1 0 0 1 8 19 H9 A1 1 0 0 0 10 18 V17 A1 1 0 0 1 11 16 H11.172 A2 2 0 0 0 12.586 15.414 L13.4 14.6 A6.5 6.5 0 1 0 9.4 10.6 Z M16.5 8.5 A1 1 0 1 1 14.5 8.5 A1 1 0 1 1 16.5 8.5",
            "copy" => "M10 8 H20 A2 2 0 0 1 22 10 V20 A2 2 0 0 1 20 22 H10 A2 2 0 0 1 8 20 V10 A2 2 0 0 1 10 8 Z M4 16 A2 2 0 0 1 2 14 V4 A2 2 0 0 1 4 2 H14 A2 2 0 0 1 16 4",
            "shield" => "M12 22 C12 22 20 18 20 12 V5 L12 2 L4 5 V12 C4 18 12 22 12 22 Z M9 12 L11 14 L15 10",
            "chevron-left" => "M15 18 9 12 15 6",
            "chevron-right" => "M9 18 15 12 9 6",
            "shopping-bag" => "M6 2 3 6 V20 A2 2 0 0 0 5 22 H19 A2 2 0 0 0 21 20 V6 L18 2 Z M3 6 H21 M16 10 A4 4 0 0 1 8 10",
            "video" => "M22 8 16 12 22 16 V8 Z M4 6 H14 A2 2 0 0 1 16 8 V16 A2 2 0 0 1 14 18 H4 A2 2 0 0 1 2 16 V8 A2 2 0 0 1 4 6 Z",
            "map-pin" => "M20 10 C20 16 12 22 12 22 C12 22 4 16 4 10 A8 8 0 0 1 20 10 Z M15 10 A3 3 0 1 1 9 10 A3 3 0 1 1 15 10",
            "phone" => "M22 16.92 V19.92 A2 2 0 0 1 19.82 21.92 A19.79 19.79 0 0 1 11.19 18.85 A19.5 19.5 0 0 1 5.19 12.85 A19.79 19.79 0 0 1 2.12 4.18 A2 2 0 0 1 4.11 2 H7.11 A2 2 0 0 1 9.11 3.72 L10.3 8.22 A2 2 0 0 1 9.85 10.33 L8.58 11.6 A16 16 0 0 0 14.58 17.6 L15.85 16.33 A2 2 0 0 1 17.96 15.88 L22 16.92 Z",
            "external-link" => "M18 13 V19 A2 2 0 0 1 16 21 H5 A2 2 0 0 1 3 19 V8 A2 2 0 0 1 5 6 H11 M15 3 H21 V9 M10 14 21 3",
            _ => "M21 15 A2 2 0 0 1 19 17 H7 L3 21 V5 A2 2 0 0 1 5 3 H19 A2 2 0 0 1 21 5 Z"
        };
        var geometry = (Geometry)XamlBindingHelper.ConvertValue(typeof(Geometry), data);
        Content = new Viewbox { Child = new Canvas { Width = 24, Height = 24, Children = { new Microsoft.UI.Xaml.Shapes.Path { Data = geometry, Stroke = strokeOverride ?? WebBrush.Get(this, "IconBrush"), StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round } } } };
    }
    public void SetStroke(Brush brush)
    {
        strokeOverride = brush;
        if (Content is Viewbox { Child: Canvas canvas } && canvas.Children[0] is Microsoft.UI.Xaml.Shapes.Path path) path.Stroke = brush;
    }
}

// Mirrors web/components/avatar.tsx; never substitutes the product logo for a person.
public sealed class WebAvatar : Grid
{
    private double size = 48;
    public double AvatarSize { get => size; set { size = value; Render(); } }
    public string NameText { get; private set; } = "";
    public string Seed { get; private set; } = "";
    public WebAvatar() { Render(); }
    public void Set(string name, string seed) { NameText = name; Seed = seed; Render(); }
    public void SetPhoto(string? url)
    {
        if (Children.FirstOrDefault() is Border border && Uri.TryCreate(url, UriKind.Absolute, out var uri))
        { border.Child = null; border.Background = new ImageBrush { ImageSource = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(uri), Stretch = Stretch.UniformToFill }; }
    }
    private void Render()
    {
        Children.Clear();
        var hasName = NameText.Length > 0 && !Regex.IsMatch(NameText, @"^\+?[\d\s-]+$");
        var border = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(size / 2), Background = WebBrush.Color(hasName ? WebPresentation.AvatarColor(Seed) : "#dfe5e7"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        if (hasName) border.Child = new TextBlock { Text = WebPresentation.Initials(NameText), FontSize = size * .36, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        else { var icon = new LucideIcon { Kind = "user", Size = size * .6 }; icon.SetStroke(new SolidColorBrush(Microsoft.UI.Colors.White)); border.Child = icon; }
        Children.Add(border);
    }
}

public sealed class ConversationTile : UserControl
{
    public event EventHandler<ConversationView>? ArchiveRequested;
    private ListViewItem? container;
    private long selectionCallback;
    public ConversationTile()
    {
        DataContextChanged += (_, _) => Render(); ActualThemeChanged += (_, _) => Render();
        Loaded += (_, _) =>
        {
            DependencyObject? parent = this;
            while (parent is not null && parent is not ListViewItem) parent = VisualTreeHelper.GetParent(parent);
            container = parent as ListViewItem;
            if (container is not null) selectionCallback = container.RegisterPropertyChangedCallback(ListViewItem.IsSelectedProperty, (_, _) => Render());
            Render();
        };
        Unloaded += (_, _) => { container?.UnregisterPropertyChangedCallback(ListViewItem.IsSelectedProperty, selectionCallback); container = null; };
    }
    private void Render()
    {
        if (DataContext is not ConversationView c) return;
        var unread = c.Unread > 0 && container?.IsSelected != true;
        var grid = new Grid { Height = 76, Padding = new Thickness(12, 0, 32, 0), ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var avatar = new WebAvatar { AvatarSize = 48 }; avatar.Set(c.DisplayName, c.Primary.Address); grid.Children.Add(avatar);
        var lines = new Grid { VerticalAlignment = VerticalAlignment.Center, RowSpacing = 2 };
        Grid.SetColumn(lines, 1); grid.Children.Add(lines);
        lines.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        lines.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        lines.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); lines.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        lines.Children.Add(new TextBlock { Text = c.DisplayName, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = WebBrush.Get(this, "HeadingBrush"), TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 0, 8, 0) });
        var time = new TextBlock { Text = c.TimeText, FontSize = 12, Foreground = WebBrush.Get(this, unread ? "UnreadBadgeBrush" : "SubBrush"), VerticalAlignment = VerticalAlignment.Center }; Grid.SetColumn(time, 1); lines.Children.Add(time);
        if (c.InstanceLabel is { } label)
        {
            lines.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var number = new TextBlock { Text = label, FontSize = 10, Foreground = WebBrush.Get(this, "SubBrush") };
            Grid.SetRow(number, 1); lines.Children.Add(number);
        }
        var preview = new Grid { ColumnSpacing = 4 }; preview.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); preview.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); Grid.SetRow(preview, c.InstanceLabel == null ? 1 : 2); lines.Children.Add(preview);
        if (c.LastMessage is { SenderAddress: null or "" } last) preview.Children.Add(DeliveryIcon.Create(last, this));
        var text = new TextBlock { Text = c.PreviewText, MaxLines = 1, FontSize = 14, Foreground = WebBrush.Get(this, "SubBrush"), TextTrimming = TextTrimming.CharacterEllipsis }; Grid.SetColumn(text, 1); preview.Children.Add(text);
        // The approval marker (web/components/conversation-item.tsx) sits before the unread badge.
        var trailing = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(trailing, 1); Grid.SetRow(trailing, 1); lines.Children.Add(trailing);
        if (c.AwaitingApproval)
        {
            var marker = new Border { CornerRadius = new CornerRadius(9), Padding = new Thickness(6, 1, 6, 1), Background = WebBrush.Color("#26f97316"), VerticalAlignment = VerticalAlignment.Center, Child = new TextBlock { Text = UiStrings.Get("ApprovalMarker"), FontSize = 10, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = WebBrush.Color(ActualTheme == ElementTheme.Dark ? "#fb923c" : "#ea580c") } };
            ToolTipService.SetToolTip(marker, UiStrings.Get("ApprovalMarkerTitle"));
            trailing.Children.Add(marker);
        }
        if (unread)
        {
            var badge = new Border { MinWidth = 20, Height = 20, CornerRadius = new CornerRadius(10), Padding = new Thickness(6, 0, 6, 0), Background = WebBrush.Get(this, "UnreadBadgeBrush"), Child = new TextBlock { Text = c.Unread.ToString(), FontSize = 12, Foreground = new SolidColorBrush(Microsoft.UI.Colors.Black), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } }; trailing.Children.Add(badge);
        }
        var menu = new MenuFlyout();
        var archive = new MenuFlyoutItem { Text = UiStrings.Get(c.Archived ? "Unarchive" : "Archive") };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(archive, archive.Text);
        archive.Click += (_, _) => ArchiveRequested?.Invoke(this, c); menu.Items.Add(archive);
        ContextFlyout = menu;
        var options = new Button { Content = new LucideIcon { Kind = "down", Size = 16 }, Width = 28, Height = 28, Padding = new Thickness(4), Style = (Style)Application.Current.Resources["PlainButton"], HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, -28, 0), Flyout = menu };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(options, UiStrings.Get("ChatOptions"));
        Grid.SetColumn(options, 1); grid.Children.Add(options);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, c.AccessibilityName);
        if (container is not null) Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(container, c.AccessibilityName);
        Content = grid;
    }
}

internal static class DeliveryIcon
{
    public static FrameworkElement Create(MessageRow row, FrameworkElement owner)
    {
        var state = ChatHelpers.DeliveryState(row.Status);
        // Held messages never reached WhatsApp, so they get no ticks.
        if (state == "rejected") return new TextBlock { Text = UiStrings.Get(state), FontSize = 11, Foreground = WebBrush.Get(owner, "DangerBrush"), VerticalAlignment = VerticalAlignment.Center };
        var icon = new LucideIcon { Kind = state switch { "sending" => "clock", "awaiting_approval" => "hourglass", "failed" => "alert", "sent" => "check", _ => "checks" }, Size = state is "sending" or "awaiting_approval" ? 13 : 15 };
        icon.SetStroke(WebBrush.Get(owner, state == "read" ? "ReadTickBrush" : "SubBrush"));
        ToolTipService.SetToolTip(icon, state == "failed" ? ChatHelpers.FailureReason(row.Status) ?? UiStrings.Get(state) : UiStrings.Get(state));
        return icon;
    }
}

// Mirrors globals.css .chat-wallpaper: 400px tiles (the PNG is 2x), theme opacity.
public sealed class ChatWallpaper : Canvas
{
    private readonly Microsoft.UI.Xaml.Media.Imaging.BitmapImage bitmap = new(new Uri("ms-appx:///Assets/Wallpaper.png"));
    public ChatWallpaper()
    {
        SizeChanged += (_, _) => Render(); ActualThemeChanged += (_, _) => Render(); bitmap.ImageOpened += (_, _) => Render();
    }
    private void Render()
    {
        Children.Clear();

        Clip = new RectangleGeometry { Rect = new global::Windows.Foundation.Rect(0, 0, ActualWidth, ActualHeight) };
        Opacity = ActualTheme == ElementTheme.Dark ? .08 : .4;
        for (var y = 0; y < ActualHeight; y += 400)
            for (var x = 0; x < ActualWidth; x += 400)
            {
                var image = new Image { Source = bitmap, Width = 400, Height = 400, Stretch = Stretch.Fill };
                SetLeft(image, x); SetTop(image, y); Children.Add(image);
            }
    }
}

public sealed class EmptyTextVisibilityConverter : Microsoft.UI.Xaml.Data.IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language) =>
        string.IsNullOrEmpty(value as string) ? Visibility.Visible : Visibility.Collapsed;
    public object ConvertBack(object value, Type targetType, object parameter, string language) => throw new NotSupportedException();
}
