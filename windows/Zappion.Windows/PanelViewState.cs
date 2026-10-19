// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Runtime.CompilerServices;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Preserve view state when a kept page replaces its data controls after a background fetch.
internal static class PanelViewState
{
    private static readonly ConditionalWeakTable<TextBox, string> initialText = new();

    public static void TrackInput(TextBox input) => initialText.Add(input, input.Text);

    private static IEnumerable<DependencyObject> Descendants(DependencyObject root)
    {
        yield return root;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
            foreach (var child in Descendants(VisualTreeHelper.GetChild(root, i))) yield return child;
    }

    public static Action<FrameworkElement> Capture(FrameworkElement root, bool preserveInputs = false)
    {
        var nodes = Descendants(root).ToArray();
        var offsets = nodes.OfType<ScrollViewer>().Select(s => (s.HorizontalOffset, s.VerticalOffset)).ToArray();
        var inputs = preserveInputs ? nodes.OfType<TextBox>()
            .Where(t => AutomationProperties.GetName(t).Length > 0 && t.Text != (initialText.TryGetValue(t, out var initial) ? initial : ""))
            .GroupBy(AutomationProperties.GetName).ToDictionary(g => g.Key, g => g.First().Text) : [];
        var filters = preserveInputs ? nodes.OfType<ComboBox>()
            .Where(c => c.SelectedValue != null && AutomationProperties.GetName(c) == SettingsRules.Text("settingsPanel", "filterInstancesByStatus"))
            .GroupBy(AutomationProperties.GetName).ToDictionary(g => g.Key, g => g.First().SelectedValue) : [];
        return target =>
        {
            // New template trees are attached by Render before the layout pass.
            void Restore()
            {
                var updated = Descendants(target).ToArray();
                foreach (var input in updated.OfType<TextBox>())
                    if (inputs.TryGetValue(AutomationProperties.GetName(input), out var text)) input.Text = text;
                foreach (var combo in updated.OfType<ComboBox>())
                    if (filters.TryGetValue(AutomationProperties.GetName(combo), out var value)) combo.SelectedValue = value;
                foreach (var (viewer, offset) in updated.OfType<ScrollViewer>().Zip(offsets))
                    viewer.ChangeView(offset.HorizontalOffset, offset.VerticalOffset, null, true);
            }
            target.UpdateLayout();
            Restore();
        };
    }
}
