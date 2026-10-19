// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Newtonsoft.Json.Linq;
using Windows.Storage;
using Windows.Storage.Pickers;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Mirrors web/components/template-picker.tsx, with native file selection for media headers.
internal sealed class TemplatePicker : ContentControl
{
    private readonly IReadOnlyList<JObject> templates;
    private readonly Func<StorageFile, string, Task<string>> upload;
    private readonly Func<JObject, Task> send;
    private readonly Action close;
    private readonly StackPanel root = new() { Spacing = 12, Padding = new Thickness(16) };
    private readonly Dictionary<string, string> values = new();
    private readonly Dictionary<string, (StorageFile File, string Mime)> media = new();
    private readonly ContentControl preview = new();
    private readonly TextBlock error = new() { TextWrapping = TextWrapping.Wrap };
    private JObject? selected;
    private bool sending;
    public TemplatePicker(IReadOnlyList<JObject> templates, Func<StorageFile, string, Task<string>> upload, Func<JObject, Task> send, Action close)
    {
        this.templates = templates; this.upload = upload; this.send = send; this.close = close;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
        ShowList();
    }
    private void ShowList()
    {
        selected = null; values.Clear(); media.Clear(); root.Children.Clear();
        var header = new Grid { ColumnSpacing = 8 }; header.ColumnDefinitions.Add(new ColumnDefinition()); header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var search = new TextBox { Style = (Style)Application.Current.Resources["SearchTextBox"], PlaceholderText = UiStrings.Get("SearchTemplates") };
        var exit = ChatMedia.Button(UiStrings.Get("Close"), (_, _) => close()); Grid.SetColumn(exit, 1); header.Children.Add(search); header.Children.Add(exit); root.Children.Add(header);
        var list = new StackPanel(); root.Children.Add(list);
        void Filter()
        {
            list.Children.Clear();
            foreach (var t in templates.Where(t => string.Join(" ", t["name"], t["language"], t["category"]).Contains(search.Text, StringComparison.CurrentCultureIgnoreCase)))
            {
                var button = ChatMedia.Button((string?)t["name"] ?? "", (_, _) => ShowTemplate(t));
                button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Stretch; button.Padding = new Thickness(16, 12, 16, 12);
                button.Content = new StackPanel { Spacing = 4, Children = { new TextBlock { Text = (string?)t["name"] ?? "", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 14 }, new TextBlock { Text = $"{t["language"]} · {t["category"]}", FontSize = 12 }, new TextBlock { Text = (string?)(t["components"] as JArray)?.FirstOrDefault(c => Templates.Type(c) == "BODY")?["text"] ?? "", MaxLines = 2, TextWrapping = TextWrapping.Wrap, FontSize = 12 } } };
                list.Children.Add(button);
            }
            if (list.Children.Count == 0) list.Children.Add(new TextBlock { Text = UiStrings.Get("NoTemplates") });
        }
        search.TextChanged += (_, _) => Filter(); Filter();
    }
    private void RefreshPreview()
    {
        if (selected is null) return;
        var displayed = new Dictionary<string, string>(values);
        foreach (var (key, file) in media) displayed[key] = new Uri(file.File.Path).AbsoluteUri;
        preview.Content = new TemplatePreview(selected, displayed);
    }
    internal void ShowTemplate(JObject template)
    {
        selected = template; root.Children.Clear(); values.Clear(); media.Clear(); error.Text = "";
        var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        heading.Children.Add(ChatMedia.Button(UiStrings.Get("Back"), (_, _) => ShowList())); heading.Children.Add(new TextBlock { Text = (string?)template["name"] ?? "", VerticalAlignment = VerticalAlignment.Center });
        heading.Children.Add(ChatMedia.Button(UiStrings.Get("Close"), (_, _) => close())); root.Children.Add(heading);
        root.Children.Add(new TextBlock { Text = UiStrings.Get("TemplatePreview"), FontSize = 12 }); root.Children.Add(preview); RefreshPreview();
        foreach (var field in Templates.Fields(template))
        {
            if (field.Key.EndsWith(".media", StringComparison.Ordinal))
            {
                var fileName = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap };
                var choose = ChatMedia.Button(UiStrings.Get("ChooseMedia") + " · " + field.Label, async (_, _) =>
                {
                    try
                    {
                        var picker = new FileOpenPicker();
                        foreach (var extension in field.Label == "IMAGE" ? new[] { ".jpg", ".jpeg", ".png" } : field.Label == "VIDEO" ? new[] { ".mp4", ".3gp" } : new[] { ".pdf" }) picker.FileTypeFilter.Add(extension);
                        ChatMedia.InitializePicker(picker);
                        try
                        {
                            if (await picker.PickSingleFileAsync() is not { } file) return;
                            var mime = file.ContentType; MediaContent.Validate(mime, (long)(await file.GetBasicPropertiesAsync()).Size);
                            if (field.Label == "IMAGE" && mime is not "image/jpeg" and not "image/png" || field.Label == "VIDEO" && !mime.StartsWith("video/", StringComparison.Ordinal) || field.Label == "DOCUMENT" && mime != "application/pdf") throw new InvalidOperationException(UiStrings.Get("InvalidHeaderMedia"));
                            media[field.Key] = (file, mime); fileName.Text = file.Name; values[field.Key] = "internal://media/pending"; RefreshPreview();
                        }
                        catch (Exception ex) { AppLog.Error("TemplatePicker operation failed", ex); error.Text = ex is InvalidOperationException ? ex.Message : UiStrings.Get("MediaUnavailable"); }

                    }
                    catch (Exception callbackError) { AppLog.Error("UI callback failed in TemplatePicker", callbackError); }
                }); root.Children.Add(choose); root.Children.Add(fileName); continue;
            }
            root.Children.Add(new TextBlock { Text = field.Label + (field.Required ? " *" : ""), FontSize = 12 });
            var input = new TextBox { MaxLength = field.MaxLength ?? 0, AcceptsReturn = field.Key.EndsWith(".sections", StringComparison.Ordinal) || field.Key.EndsWith(".data", StringComparison.Ordinal) };
            input.TextChanged += (_, _) => { values[field.Key] = input.Text; RefreshPreview(); }; root.Children.Add(input);
        }
        root.Children.Add(error);
        var submit = ChatMedia.Button(UiStrings.Get("SendTemplate"), async (_, _) =>
        {
            try
            {
                if (sending) return;
                var issues = Templates.Validate(template, values); if (issues.Count > 0) { error.Text = string.Join("\n", issues); return; }
                sending = true; IsEnabled = false;
                try
                {
                    foreach (var (key, file) in media.ToArray()) { values[key] = await upload(file.File, file.Mime); media.Remove(key); }
                    await send(Templates.Build(template, values)); close();
                }
                catch (Exception ex) { AppLog.Error("TemplatePicker operation failed", ex); error.Text = ex is FunctionError or InvalidOperationException ? ex.Message : UiStrings.Get("SendError"); }
                finally { sending = false; IsEnabled = true; }

            }
            catch (Exception callbackError) { AppLog.Error("UI callback failed in TemplatePicker", callbackError); }
        }); submit.HorizontalAlignment = HorizontalAlignment.Stretch; submit.CornerRadius = new CornerRadius(22); submit.Background = WebBrush.Get(this, "ChatAccentBrush"); root.Children.Add(submit);
    }
}
