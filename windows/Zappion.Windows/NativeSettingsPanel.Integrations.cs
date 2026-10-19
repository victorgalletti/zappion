// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Newtonsoft.Json.Linq;
using Zappion.Windows.Core;

namespace Zappion.Windows;

internal sealed partial class NativeSettingsPanel
{
    private string integrationTab = "keys";
    private bool showRevoked;
    private string activityKey = "all";
    private string activityStatus = "all";
    private string mcpClient = "Claude Code";
    // Mirrors web/components/integrations-settings.tsx.
    private async Task Integrations(int current, StackPanel content)
    {
        var tabs = Row(24);
        foreach (var tab in new[] { "keys", "mcp", "activity" })
        {
            var isCurrent = integrationTab == tab;
            var button = Button(S("integrations", tab), async () => { integrationTab = tab; await LoadSection(); });
            button.Padding = new Thickness(0, 0, 0, 12);
            button.BorderThickness = new Thickness(0, 0, 0, isCurrent ? 2 : 0);
            button.BorderBrush = Brush("ChatAccentBrush");
            button.CornerRadius = new CornerRadius(0);
            button.Background = null;
            button.Foreground = Brush(isCurrent ? "HeadingBrush" : "SubBrush");
            tabs.Children.Add(button);
        }
        content.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1), Child = tabs });
        if (integrationTab == "mcp") { Mcp(content); return; }
        var keys = await client.GetApiKeysAsync(workspace); if (current != version) return;
        if (integrationTab == "activity") { await Activity(keys, current, content); return; }
        var intro = new Grid { ColumnSpacing = 16 };
        intro.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        intro.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var introText = Text(S("integrations", "apiIntro"));
        introText.MaxWidth = 576;
        introText.HorizontalAlignment = HorizontalAlignment.Left;
        introText.VerticalAlignment = VerticalAlignment.Center;
        intro.Children.Add(introText);
        var createBtn = IconButton("plus", S("integrations", "createKey"), () => CreateKey(false), true);
        createBtn.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(createBtn, 1); intro.Children.Add(createBtn);
        content.Children.Add(intro);

        var inactive = keys.OfType<JObject>().Count(k => SettingsRules.KeyState(k, DateTimeOffset.UtcNow) != "active");
        var active = keys.Count - inactive;
        if (active > 0 && inactive > 0)
        {
            var toggle = LinkButton(string.Format(S("integrations", showRevoked ? "hideRevoked" : "showRevoked"), inactive), async () => { showRevoked = !showRevoked; await LoadSection(); });
            toggle.Foreground = Brush("SubBrush"); toggle.FontSize = 12;
            content.Children.Add(toggle);
        }
        if (keys.Count == 0) { var empty = Stack(8); empty.Children.Add(Heading(S("integrations", "noKeys"), 16)); empty.Children.Add(Text(S("integrations", "emptyKeysHint"))); content.Children.Add(Card(empty)); }
        else
        {
            var weights = new[] { 1.6, 0.9, 0.8, 1.0, 1.0, 1.0, 0.8 };
            var table = Stack(0);
            table.Children.Add(TableHeader(new[] { "name", "keyName", "scope", "created", "lastUsed", "expires", "status" }.Select(k => S("integrations", k)).ToArray(), weights, true));
            var visibleKeys = keys.OfType<JObject>().OrderBy(k => SettingsRules.KeyState(k, DateTimeOffset.UtcNow) != "active").Where(k => active == 0 || showRevoked || SettingsRules.KeyState(k, DateTimeOffset.UtcNow) == "active").ToArray();
            for (var i = 0; i < visibleKeys.Length; i++)
            {
                var key = visibleKeys[i];
                var state = SettingsRules.KeyState(key, DateTimeOffset.UtcNow);
                var allowed = key["allowed_addresses"] is JArray addresses ? string.Join(", ", addresses.Values<string>().Select(a => NumberLabel(a!))) : S("integrations", "allNumbers");
                var nameCell = Stack(2); nameCell.VerticalAlignment = VerticalAlignment.Center;
                nameCell.Children.Add(Heading((string)key["name"]!));
                nameCell.Children.Add(Text(allowed, 12));
                var prefixCell = Mono(key["key_prefix"] + "\u2026", 12, "SubBrush"); prefixCell.VerticalAlignment = VerticalAlignment.Center;
                var scopeCell = Badge(S("integrations", (string)key["scope"]!)); scopeCell.HorizontalAlignment = HorizontalAlignment.Left;
                var createdCell = Text(Date(key["created_at"]), 12); createdCell.VerticalAlignment = VerticalAlignment.Center;
                var lastUsedCell = Text(Date(key["last_used_at"]), 12); lastUsedCell.VerticalAlignment = VerticalAlignment.Center;
                var expiresCell = Text(Date(key["expires_at"]), 12); expiresCell.VerticalAlignment = VerticalAlignment.Center;
                var statusCell = Badge(S("integrations", state), state == "active"); statusCell.HorizontalAlignment = HorizontalAlignment.Left;
                var menu = new MenuFlyout();
                if (state == "active")
                {
                    var revoke = new MenuFlyoutItem { Text = S("integrations", "revoke") };
                    revoke.Click += async (_, _) => await Run(async () => { if (await Confirm(S("integrations", "revoke") + ": " + key["name"], S("integrations", "revokeDescription"))) { await client.RevokeApiKeyAsync(workspace, (string)key["id"]!); await Saved(); } }); menu.Items.Add(revoke);
                }
                var delete = new MenuFlyoutItem { Text = S("integrations", "delete"), Foreground = Brush("DangerBrush") };
                delete.Click += async (_, _) => await Run(async () => { if (await Confirm(S("integrations", "delete") + ": " + key["name"], S("integrations", "deleteDescription"))) { await client.DeleteApiKeyAsync(workspace, (string)key["id"]!); await Saved(); } }); menu.Items.Add(delete);
                var more = MoreButton(S("integrations", "actions") + ": " + key["name"], menu);
                var row = TableCells([nameCell, prefixCell, scopeCell, createdCell, lastUsedCell, expiresCell, statusCell], weights, more);
                row.Opacity = state == "active" ? 1 : .6;
                table.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0), Child = row });
            }
            content.Children.Add(Card(table, padding: 0));
        }
        var example = Stack(12); example.Children.Add(Heading(S("integrations", "usingApi"))); example.Children.Add(Text(S("integrations", "apiHint"), 12)); var config = AppConfiguration.Load(AppContext.BaseDirectory); var baseUrl = config.SupabaseUrl.TrimEnd('/');
        CopyValue(example, S("integrations", "baseUrl"), baseUrl + "/rest/v1");
        // The shipped example uses a placeholder; no configuration key is rendered or logged.
        CopyValue(example, S("integrations", "apiExample"), "curl '" + baseUrl + "/rest/v1/contacts?select=*&limit=1' \\\n  -H 'apikey: <PUBLIC_KEY>' \\\n  -H 'api-key: <API_KEY>'"); example.Children.Add(Text(S("integrations", "limitsNote"), 12)); content.Children.Add(Card(example, true, 20, false));
    }
    private Border TableHeader(string[] headers, double[] weights, bool actionCol)
    {
        var row = new Grid { Padding = new Thickness(16, 12, 16, 12), ColumnSpacing = 12, Background = Brush("PanelBrush"), CornerRadius = new CornerRadius(16, 16, 0, 0) };
        for (var i = 0; i < headers.Length; i++)
        {
            row.ColumnDefinitions.Add(new() { Width = new GridLength(weights[i], GridUnitType.Star) });
            var cell = new TextBlock { Text = headers[i], FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = Brush("SubBrush"), VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(cell, i); row.Children.Add(cell);
        }
        if (actionCol) row.ColumnDefinitions.Add(new() { Width = new GridLength(36) });
        return new Border { Child = row };
    }
    private Grid TableCells(FrameworkElement[] cells, double[] weights, FrameworkElement? action = null)
    {
        var row = new Grid { Padding = new Thickness(16, 14, 16, 14), ColumnSpacing = 12 };
        for (var i = 0; i < cells.Length; i++)
        {
            row.ColumnDefinitions.Add(new() { Width = new GridLength(weights[i], GridUnitType.Star) });
            Grid.SetColumn(cells[i], i); row.Children.Add(cells[i]);
        }
        if (action != null)
        {
            row.ColumnDefinitions.Add(new() { Width = new GridLength(36) });
            Grid.SetColumn(action, cells.Length); row.Children.Add(action);
        }
        return row;
    }
    private string NumberLabel(string address)
    {
        var number = workspace.Numbers.FirstOrDefault(n => n.Service == "whatsapp" && n.Address == address); var name = (string?)number?.Extra?["label"] ?? (string?)number?.Extra?["verified_name"]; var phone = (string?)number?.Extra?["phone_number"] ?? address;
        return string.IsNullOrEmpty(name) ? phone : name + " \u00b7 " + phone;
    }
    private void Mcp(StackPanel content)
    {
        content.Children.Add(Text(S("integrations", "intro"))); var config = AppConfiguration.Load(AppContext.BaseDirectory); var url = config.SupabaseUrl.TrimEnd('/') + "/functions/v1/mcp";
        CopyValue(content, S("integrations", "serverUrl"), url);
        var setup = Stack(20); setup.Children.Add(Heading(S("integrations", "stepCreate"))); setup.Children.Add(IconButton("plus", S("integrations", "createKey"), () => CreateKey(true))); setup.Children.Add(Heading(S("integrations", "stepPaste"))); setup.Children.Add(Text(S("integrations", "pasteHint"), 12)); McpSnippet(setup, url, "<API_KEY>"); content.Children.Add(Card(setup));
        var oauth = Stack(8); oauth.Children.Add(Heading(S("integrations", "oauthTitle"))); oauth.Children.Add(Text(S("integrations", "chatgptHint"), 12)); content.Children.Add(Card(oauth, true, 16, false));
    }
    private void McpSnippet(StackPanel parent, string url, string key)
    {
        var selector = Select(S("integrations", "connectClient"), new[] { "Claude Code", "Claude Desktop", "Cursor", "OpenAI API" }.Select(c => (c, c)), mcpClient); parent.Children.Add(selector);
        var snippet = Stack(8); parent.Children.Add(snippet);
        void Render()
        {
            snippet.Children.Clear(); mcpClient = (string?)selector.SelectedValue ?? "Claude Code";
            if (mcpClient == "Claude Desktop") snippet.Children.Add(Text("claude_desktop_config.json \u00b7 " + S("integrations", "nodeHint"), 12));
            if (mcpClient == "Cursor") snippet.Children.Add(Text(".cursor/mcp.json", 12));
            CopyValue(snippet, S("integrations", "snippet"), SettingsSnippets.Mcp(mcpClient, url, key));
        }
        selector.SelectionChanged += (_, _) => Render(); Render();
    }
    private async Task Activity(JArray keys, int current, StackPanel content)
    {
        var calls = await client.GetMcpCallsAsync(workspace); if (current != version) return;
        content.Children.Add(Text(S("integrations", "activityIntro")));
        var filters = Row(12); var keyFilter = Select(S("integrations", "keyName"), new[] { ("all", S("integrations", "allKeys")), ("user", S("integrations", "signedInUser")), ("deleted", S("integrations", "deletedKey")) }.Concat(keys.Select(k => ((string)k["id"]!, (string)k["name"]!))).Concat(calls.Where(c => c["user_id"]?.Type != JTokenType.String && c["api_key_id"]?.Type == JTokenType.String && !keys.Any(k => (string?)k["id"] == (string?)c["api_key_id"])).Select(c => (Id: (string)c["api_key_id"]!, Label: S("integrations", "unknownKey") + " (" + c["api_key_id"] + ")")).Distinct()), activityKey);
        var statusFilter = Select(S("integrations", "status"), new[] { ("all", S("integrations", "allStatuses")) }.Concat(new[] { "ok", "error", "denied", "rate_limited", "pending" }.Select(s => (s, S("integrations", s == "error" ? "callError" : s)))), activityStatus); filters.Children.Add(keyFilter); filters.Children.Add(statusFilter); content.Children.Add(filters);
        var table = Stack(0); content.Children.Add(Card(table, padding: 0));
        void Render()
        {
            activityKey = (string?)keyFilter.SelectedValue ?? "all"; activityStatus = (string?)statusFilter.SelectedValue ?? "all"; table.Children.Clear();
            var filtered = calls.Where(c => (activityStatus == "all" || (string?)c["status"] == activityStatus) && (activityKey == "all" || (activityKey == "user" ? c["user_id"]?.Type == JTokenType.String : c["user_id"]?.Type != JTokenType.String && (activityKey == "deleted" ? c["api_key_id"]?.Type != JTokenType.String : (string?)c["api_key_id"] == activityKey)))).ToArray();
            if (filtered.Length == 0) { var empty = Text(S("integrations", calls.Count == 0 ? "noCalls" : "noFilteredCalls")); empty.Margin = new Thickness(20); table.Children.Add(empty); return; }
            var weights = new[] { 0.8, 1.4, 1.0, 1.0, 1.0 };
            table.Children.Add(TableHeader(new[] { "status", "tool", "keyName", "contact", "time" }.Select(k => S("integrations", k)).ToArray(), weights, false));
            foreach (var call in filtered)
            {
                var name = call["user_id"]?.Type == JTokenType.String ? S("integrations", "signedInUser") : call["api_key_id"]?.Type != JTokenType.String ? S("integrations", "deletedKey") : (string?)keys.FirstOrDefault(k => (string?)k["id"] == (string?)call["api_key_id"])?["name"] ?? S("integrations", "unknownKey");
                var statusText = S("integrations", (string?)call["status"] == "error" ? "callError" : (string)call["status"]!);
                var statusCell = Badge(statusText, (string?)call["status"] == "ok"); statusCell.HorizontalAlignment = HorizontalAlignment.Left;
                var toolCell = Stack(2); toolCell.VerticalAlignment = VerticalAlignment.Center;
                toolCell.Children.Add(Mono((string?)call["tool"] ?? "", 12));
                if (call["error"]?.Type == JTokenType.String) toolCell.Children.Add(Text((string)call["error"]!, 12));
                var keyCell = Text(name, 12); keyCell.VerticalAlignment = VerticalAlignment.Center;
                var contactCell = Text((string?)call["contact_phone"] ?? "\u2014", 12); contactCell.VerticalAlignment = VerticalAlignment.Center;
                var timeCell = Text(Date(call["created_at"]), 12); timeCell.VerticalAlignment = VerticalAlignment.Center;
                var row = TableCells([statusCell, toolCell, keyCell, contactCell, timeCell], weights);
                table.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0), Child = row });
            }
        }
        keyFilter.SelectionChanged += (_, _) => Render(); statusFilter.SelectionChanged += (_, _) => Render(); Render();
    }
    private async Task CreateKey(bool fromMcp)
    {
        string useCase = "mcp";
        if (!fromMcp)
        {
            var choices = Stack(); choices.Children.Add(Text("1 / 3", 12)); choices.Children.Add(Text(S("integrations", "useCaseIntro")));
            var select = Select(S("integrations", "chooseUseCase"), new[] { "read", "send", "mcp", "admin", "custom" }.Select(c => (c, S("integrations", c + "UseCase") + " \u00b7 " + S("integrations", c + "UseCaseHint"))), "read"); choices.Children.Add(select);
            var dialog = new ContentDialog { XamlRoot = XamlRoot, Title = S("integrations", "chooseUseCase"), Content = choices, PrimaryButtonText = S("integrations", "useUseCase"), CloseButtonText = S("integrations", "cancel"), RequestedTheme = ActualTheme };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return; useCase = (string)select.SelectedValue;
        }
        var form = Stack(); form.Children.Add(Text("2 / 3", 12)); var name = Field(form, S("integrations", "name"), S("integrations", useCase == "custom" ? "customName" : useCase + "UseCase"));
        form.Children.Add(Heading(S("integrations", "numbers"))); var mode = Select(S("integrations", "numbers"), new[] { ("all", S("integrations", "allNumbers")), ("selected", S("integrations", "selectedNumbers")) }, "all"); form.Children.Add(mode);
        var numbers = Stack(8); numbers.Visibility = Visibility.Collapsed; var selected = new Dictionary<string, CheckBox>();
        foreach (var number in workspace.Numbers.Where(n => n.Service == "whatsapp" && n.Status == "connected")) { var check = new CheckBox { Content = NumberLabel(number.Address) }; selected[number.Address] = check; numbers.Children.Add(check); }
        if (selected.Count == 0) numbers.Children.Add(Text(S("integrations", "noConnectedNumbers"))); form.Children.Add(numbers); mode.SelectionChanged += (_, _) => numbers.Visibility = (string?)mode.SelectedValue == "selected" ? Visibility.Visible : Visibility.Collapsed;
        form.Children.Add(Heading(S("integrations", "permissions"))); form.Children.Add(Text(S("integrations", "includes"), 12)); var scope = Select(S("integrations", "scope"), new[] { "read", "send", "admin" }.Select(s => (s, S("integrations", s))), useCase == "mcp" ? "send" : useCase == "custom" ? "read" : useCase); form.Children.Add(scope);
        var description = Text(S("integrations", (string)scope.SelectedValue + "Description"), 12); form.Children.Add(description); scope.SelectionChanged += (_, _) => description.Text = S("integrations", (string)scope.SelectedValue + "Description");
        form.Children.Add(Heading(S("integrations", "expiry"))); var expiry = Select(S("integrations", "expiry"), new[] { ("never", S("integrations", "never")), ("30", S("integrations", "days30")), ("90", S("integrations", "days90")), ("365", S("integrations", "year")) }, "90"); form.Children.Add(expiry);
        var messages = Field(form, S("integrations", "messagesPerHour"), useCase == "mcp" ? "30" : "60"); var templates = Field(form, S("integrations", "templatesPerHour"), useCase == "mcp" ? "0" : "10", hint: S("integrations", "templateHint"));
        JObject? result = null;
        var formResult = await Form(S("integrations", "configure"), form, S("integrations", "createKey"), async () => {
            if (!int.TryParse(messages.Text, out var messageLimit) || messageLimit < 1 || !int.TryParse(templates.Text, out var templateLimit) || templateLimit < 0 || string.IsNullOrWhiteSpace(name.Text)) throw new ArgumentException(S("integrations", "permissions"));
            var addresses = (string?)mode.SelectedValue == "all" ? null : selected.Where(s => s.Value.IsChecked == true).Select(s => s.Key).ToArray();
            var expires = (string)expiry.SelectedValue;
            result = await client.CreateApiKeyAsync(workspace, name.Text, (string)scope.SelectedValue, expires == "never" ? null : DateTimeOffset.UtcNow.AddDays(int.Parse(expires)).ToString("O"), addresses, messageLimit, templateLimit);
        }, back: S("integrations", "back"));
        if (formResult == ContentDialogResult.Secondary) { await CreateKey(false); return; }
        if (result == null) return;
        var success = Stack(); success.Children.Add(Text("3 / 3", 12)); success.Children.Add(Text(S("integrations", "keyWarning"))); CopyValue(success, S("integrations", "fullKey"), (string)result["key"]!);
        if (fromMcp) { success.Children.Add(Heading(S("integrations", "stepPaste"))); McpSnippet(success, AppConfiguration.Load(AppContext.BaseDirectory).SupabaseUrl.TrimEnd('/') + "/functions/v1/mcp", (string)result["key"]!); }
        try { dialogDepth++; await new ContentDialog { XamlRoot = XamlRoot, Title = S("integrations", "keyReady"), Content = new ScrollViewer { Content = success, MaxHeight = 500 }, CloseButtonText = S("integrations", "done"), RequestedTheme = ActualTheme }.ShowAsync(); }
        finally { dialogDepth--; result.Remove("key"); success.Children.Clear(); }
        await Saved();
    }
}
