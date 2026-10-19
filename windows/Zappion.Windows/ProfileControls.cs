// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Markup;

namespace Zappion.Windows;

// Compact native control templates mirror profile-panel.tsx's radios and 44 x 24 switches.
internal static class ProfileControls
{
    public static ControlTemplate RadioTemplate(bool vertical) => (ControlTemplate)XamlReader.Load(
        "<ControlTemplate xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" TargetType=\"RadioButton\">" +
        "<Border x:Name=\"Root\" Background=\"Transparent\" CornerRadius=\"8\" Padding=\"12," + (vertical ? "12" : "8") + "\"><VisualStateManager.VisualStateGroups><VisualStateGroup x:Name=\"CheckedStates\"><VisualState x:Name=\"Unchecked\"/><VisualState x:Name=\"Checked\"><VisualState.Setters><Setter Target=\"Dot.Visibility\" Value=\"Visible\"/>" +
        (vertical ? "" : "<Setter Target=\"Root.Background\" Value=\"{ThemeResource PanelBrush}\"/>") +
        "</VisualState.Setters></VisualState></VisualStateGroup></VisualStateManager.VisualStateGroups>" +
        (vertical ? "<Grid ColumnSpacing=\"12\"><Grid.ColumnDefinitions><ColumnDefinition Width=\"*\"/><ColumnDefinition Width=\"16\"/></Grid.ColumnDefinitions><ContentPresenter Content=\"{TemplateBinding Content}\" VerticalAlignment=\"Center\"/><Grid Grid.Column=\"1\" Width=\"16\" Height=\"16\">" : "<StackPanel Orientation=\"Horizontal\" Spacing=\"8\" HorizontalAlignment=\"Center\"><Grid Width=\"16\" Height=\"16\">") +
        "<Ellipse Stroke=\"{ThemeResource IconBrush}\" StrokeThickness=\"1\"/><Ellipse x:Name=\"Dot\" Width=\"8\" Height=\"8\" Fill=\"{ThemeResource ChatAccentBrush}\" Visibility=\"Collapsed\"/></Grid>" +
        (vertical ? "</Grid>" : "<ContentPresenter Content=\"{TemplateBinding Content}\" FontSize=\"14\" VerticalAlignment=\"Center\"/></StackPanel>") + "</Border></ControlTemplate>");
    // A ToggleButton, not a re-templated ToggleSwitch: ToggleSwitch only takes pointer input through the
    // parts of its default template, so a bare template left the switches unclickable.
    public static ToggleButton Switch(FrameworkElement owner, bool value, Action<bool> changed)
    {
        var track = new Border { CornerRadius = new CornerRadius(12), Opacity = 0.9 };
        var knob = new Microsoft.UI.Xaml.Shapes.Ellipse { Fill = new SolidColorBrush(Microsoft.UI.Colors.White), Width = 16, Height = 16, Margin = new Thickness(4) };
        var toggle = new ToggleButton
        {
            IsChecked = value, Width = 44, Height = 24, MinWidth = 44, MinHeight = 24, Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Right, Template = ContentOnly(),
            Content = new Grid { Width = 44, Height = 24, Children = { track, knob } }
        };
        void Render()
        {
            var on = toggle.IsChecked == true;
            track.Background = WebBrush.Get(owner, on ? "ChatAccentBrush" : "IconBrush");
            knob.HorizontalAlignment = on ? HorizontalAlignment.Right : HorizontalAlignment.Left;
        }
        Render();
        toggle.Checked += (_, _) => { Render(); changed(true); };
        toggle.Unchecked += (_, _) => { Render(); changed(false); };
        return toggle;
    }

    private static ControlTemplate ContentOnly() => (ControlTemplate)XamlReader.Load("""
        <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="ToggleButton">
          <ContentPresenter Content="{TemplateBinding Content}" Background="Transparent"/>
        </ControlTemplate>
        """);
}
