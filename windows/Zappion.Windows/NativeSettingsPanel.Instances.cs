// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Newtonsoft.Json.Linq;
using Zappion.Windows.Core;

namespace Zappion.Windows;

internal sealed partial class NativeSettingsPanel
{
    // Mirrors settings-panel.tsx InstanceSettings and connect-number.tsx.
    private async Task Instances(int current, StackPanel content)
    {
        var intro = new Grid { ColumnSpacing = 16 };
        intro.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        intro.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var introText = Text(P("instancesIntro"));
        introText.MaxWidth = 448;
        introText.HorizontalAlignment = HorizontalAlignment.Left;
        introText.VerticalAlignment = VerticalAlignment.Center;
        intro.Children.Add(introText);
        var introActions = Row(8); introActions.VerticalAlignment = VerticalAlignment.Center;
        var refreshBtn = Button(P("refreshInstances"), Saved);
        refreshBtn.Content = new LucideIcon { Kind = "refresh", Size = 16, Foreground = Brush("SubBrush") };
        refreshBtn.Width = 40; refreshBtn.Height = 40; refreshBtn.Padding = new Thickness(0);
        introActions.Children.Add(refreshBtn);
        if (Editable) introActions.Children.Add(IconButton("plus", S("connectNumber", "connectNumber"), ConnectNumber, true));
        Grid.SetColumn(introActions, 1); intro.Children.Add(introActions);
        content.Children.Add(intro);

        var filters = new Grid { ColumnSpacing = 12 };
        filters.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        filters.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        filters.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        // SearchTextBox draws its own pill and search icon.
        var search = new TextBox { PlaceholderText = P("searchPlaceholder"), Style = (Style)Application.Current.Resources["SearchTextBox"] };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(search, P("searchInstances"));
        filters.Children.Add(search);
        var status = Select(P("filterInstancesByStatus"), new[] { ("all", P("allStatuses")) }.Concat(new[] { "connected", "disconnected" }.Concat(workspace.Numbers.Select(n => n.Status)).Distinct().Select(s => (s, s is "connected" or "disconnected" ? P(s) : s))), "all");
        status.CornerRadius = new CornerRadius(18); status.MinWidth = 140; status.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(status, 1); filters.Children.Add(status);
        var counts = Text("", 12); counts.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(counts, 2); filters.Children.Add(counts);
        content.Children.Add(filters);

        var list = Stack(0); content.Children.Add(list);
        var chatCounts = new Dictionary<string, int>();
        void Render()
        {
            list.Children.Clear();
            var filtered = workspace.Numbers.Where(n => SettingsRules.MatchesInstance(n, search.Text, (string?)status.SelectedValue ?? "all")).ToArray();
            counts.Text = SettingsRules.InstancesCount(filtered.Length, filtered.Count(n => n.Status == "connected"));
            if (filtered.Length == 0) { list.Children.Add(Card(Text(P(workspace.Numbers.Count == 0 ? "noInstancesConnected" : "noInstancesMatchThisSearchAndStatus")))); return; }
            var rows = Stack(0);
            for (var i = 0; i < filtered.Length; i++)
            {
                var number = filtered[i];
                var row = new Grid { ColumnSpacing = 12 };
                row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
                var name = SettingsRules.InstanceName(number);
                var initial = name.Trim().Length > 0 ? name.Trim()[..1].ToUpperInvariant() : "#";
                var avatar = new Border { Width = 40, Height = 40, CornerRadius = new CornerRadius(12), Background = Brush("PanelBrush"), VerticalAlignment = VerticalAlignment.Center, Child = new TextBlock { Text = initial, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Brush("HeadingBrush"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
                var lines = Stack(2); lines.VerticalAlignment = VerticalAlignment.Center;
                lines.Children.Add(Heading(name));
                lines.Children.Add(Text(MessageHelpers.FormatPhone((string?)number.Extra?["phone_number"] ?? number.Address), 12));
                var left = Row(12); left.Children.Add(avatar); left.Children.Add(lines);
                var details = Button(name, () => InstanceDetails(number, chatCounts.GetValueOrDefault(number.Address)));
                details.Content = left; details.BorderThickness = new Thickness(0); details.Padding = new Thickness(0);
                details.HorizontalAlignment = HorizontalAlignment.Stretch; details.HorizontalContentAlignment = HorizontalAlignment.Left;
                row.Children.Add(details);
                var pill = Badge(number.Status is "connected" or "disconnected" ? P(number.Status) : number.Status, number.Status == "connected");
                Grid.SetColumn(pill, 1); row.Children.Add(pill);
                var chatRow = Row(6); chatRow.VerticalAlignment = VerticalAlignment.Center; chatRow.Margin = new Thickness(8, 0, 8, 0);
                chatRow.Children.Add(new LucideIcon { Kind = "chat", Size = 14, Foreground = Brush("SubBrush") });
                chatRow.Children.Add(Text(chatCounts.TryGetValue(number.Address, out var count) ? count.ToString() : "\u2014", 12));
                Grid.SetColumn(chatRow, 2); row.Children.Add(chatRow);
                var menu = new MenuFlyout();
                void Item(string key, Func<Task> action, bool enabled = true) { var item = new MenuFlyoutItem { Text = P(key), IsEnabled = enabled }; item.Click += async (_, _) => await Run(action); menu.Items.Add(item); }
                Item("instanceDetails", () => InstanceDetails(number, chatCounts.GetValueOrDefault(number.Address)));
                Item("renameInstance", async () => { var form = Stack(); var label = Field(form, P("instanceName"), (string?)number.Extra?["label"] ?? "", 100, P("leaveBlankToUseTheVerifiedName")); await Form(P("renameInstance"), form, S("profileSettings", "saveName"), () => Mutate(() => client.RenameInstanceAsync(workspace, number.Address, label.Text))); }, Editable);
                Item("copyPhoneNumberId", () => Copy(number.Address)); Item("copyWabaId", () => Copy((string?)number.Extra?["waba_id"] ?? ""), !string.IsNullOrEmpty((string?)number.Extra?["waba_id"]));
                var more = MoreButton(P("instanceActions") + ": " + name, menu);
                Grid.SetColumn(more, 3); row.Children.Add(more);
                rows.Children.Add(new Border { Padding = new Thickness(20, 16, 20, 16), BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, i > 0 ? 1 : 0, 0, 0), Child = row });
            }
            list.Children.Add(Card(rows, padding: 0));
        }
        search.TextChanged += (_, _) => Render(); status.SelectionChanged += (_, _) => Render(); Render();
        try { foreach (var number in workspace.Numbers) chatCounts[number.Address] = await client.GetInstanceCountAsync(workspace, number.Address); if (current == version) Render(); }
        catch { if (current == version) feedback.Text = P("couldNotLoadChatCounts"); }
    }
    private static Task Copy(string value) { var data = new global::Windows.ApplicationModel.DataTransfer.DataPackage(); data.SetText(value); global::Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(data); return Task.CompletedTask; }
    private async Task InstanceDetails(OrganizationAddressRow number, int count)
    {
        var form = Stack(); form.Children.Add(Text(MessageHelpers.FormatPhone((string?)number.Extra?["phone_number"] ?? number.Address) + " \u00b7 " + number.Status)); form.Children.Add(Text(P("verifiedName") + ": " + ((string?)number.Extra?["verified_name"] ?? P("notProvided")))); form.Children.Add(Text(UiStrings.Get("Chats") + ": " + count)); CopyValue(form, P("phoneNumberId"), number.Address); CopyValue(form, P("wabaId"), (string?)number.Extra?["waba_id"] ?? P("notProvided"));
        await new ContentDialog { XamlRoot = XamlRoot, Title = SettingsRules.InstanceName(number), Content = form, CloseButtonText = S("integrations", "close"), RequestedTheme = ActualTheme }.ShowAsync();
    }
    private async Task ConnectNumber()
    {
        var options = Stack(); var embedded = Stack(8); embedded.Children.Add(Heading(S("connectNumber", "embeddedSignupRecommended"))); embedded.Children.Add(Text(S("connectNumber", "newNumberConnectANumberToUseWithThe"))); embedded.Children.Add(Text(S("connectNumber", "coexistenceConnectANumberAlreadyUsedInTheWhatsApp")));
        embedded.Children.Add(Button(S("connectNumber", "openConnectionPage"), async () => { awaitingSignup = true; var config = AppConfiguration.Load(AppContext.BaseDirectory); await global::Windows.System.Launcher.LaunchUriAsync(new Uri(config.SignupUrl)); })); embedded.Children.Add(Text(S("connectNumber", "theListWillRefreshWhenYouReturnFromThe"), 12)); options.Children.Add(Card(embedded, true)); options.Children.Add(Text(S("connectNumber", "forANumberCreatedDirectlyInMetaSWhatsApp")));
        var dialog = new ContentDialog { XamlRoot = XamlRoot, Title = S("connectNumber", "howWouldYouLikeToConnectTheNumber"), Content = options, PrimaryButtonText = S("connectNumber", "useCredentials"), CloseButtonText = S("connectNumber", "cancel"), RequestedTheme = ActualTheme };
        ContentDialogResult choice; try { dialogDepth++; choice = await dialog.ShowAsync(); } finally { dialogDepth--; }
        if (choice != ContentDialogResult.Primary) return;
        var app = await client.GetMetaAppAsync(workspace); var hasToken = (bool?)app?["has_system_token"] == true;
        var form = Stack();
        var label = Field(form, S("connectNumber", "instanceNameOptional"), max: 100, hint: S("connectNumber", "chooseANameToIdentifyTheNumberInThis"));
        var phone = Field(form, S("connectNumber", "phoneNumberId"), hint: S("connectNumber", "whatsAppManagerPhoneNumbersSelectTheNumberAndCopy"));
        var waba = Field(form, S("connectNumber", "wabaId"), hint: S("connectNumber", "businessManagerBusinessSettingsAccountsWhatsAppAccountsCopyThe"));
        var token = Secret(form, S("connectNumber", "permanentAccessToken"), S(hasToken ? "metaApp" : "connectNumber", hasToken ? "tokenHint" : "businessManagerUsersSystemUsersGenerateAPermanentToken"));
        var register = new CheckBox { Content = S("connectNumber", "registerTheNumberWithTheCloudAPI") }; form.Children.Add(register); form.Children.Add(Text(S("connectNumber", "selectThisForNewNumbersThatStillNeedTo"), 12));
        var pin = Secret(form, S("connectNumber", "twoStepVerificationPIN"), S("connectNumber", "whatsAppManagerPhoneNumbersTwoStepVerificationUseThe")); pin.MaxLength = 6; var pinGroup = (FrameworkElement)pin.Parent; pinGroup.Visibility = Visibility.Collapsed;
        register.Checked += (_, _) => pinGroup.Visibility = Visibility.Visible; register.Unchecked += (_, _) => { pin.Password = ""; pinGroup.Visibility = Visibility.Collapsed; };
        var advanced = Stack(); advanced.Children.Add(Text(S("connectNumber", "fillTheseInOnlyToOverrideTheDefaultWebhook"), 12)); var callback = Field(advanced, S("connectNumber", "callbackURL"), hint: S("connectNumber", "metaAppSettingsWhatsAppConfigurationWebhookYourReceiverS")); var verify = Secret(advanced, S("connectNumber", "verifyToken"), S("connectNumber", "useTheVerificationTokenConfiguredInYourReceiverAnd")); form.Children.Add(new Expander { Header = S("connectNumber", "advancedFieldsOptional"), Content = advanced, HorizontalAlignment = HorizontalAlignment.Stretch });
        var manualResult = await Form(S("connectNumber", "manualCredentials"), form, S("connectNumber", "connectWithCredentials"), async () => {
            var fields = new ManualConnectFields(label.Text, phone.Text, waba.Text, token.Password, register.IsChecked == true, pin.Password, callback.Text, verify.Password);
            if (SettingsRules.ValidateManualConnect(fields, hasToken) is { } validation) throw new ArgumentException(validation);
            token.Password = pin.Password = verify.Password = "";
            await client.ConnectNumberAsync(workspace, fields, hasToken); await Saved();
        }, () => token.Password = pin.Password = verify.Password = "", S("connectNumber", "backToConnectionMethods"));
        if (manualResult == ContentDialogResult.Secondary) await ConnectNumber();
    }
    // Mirrors web/components/meta-app-settings.tsx.
    private async Task MetaApp(int current, StackPanel content)
    {
        var app = await client.GetMetaAppAsync(workspace); if (current != version) return;
        var status = Stack(16);
        var top = new Grid { ColumnSpacing = 16 };
        top.ColumnDefinitions.Add(new() { Width = new GridLength(44) });
        top.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        top.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        top.Children.Add(new Border { Width = 44, Height = 44, CornerRadius = new CornerRadius(12), Background = Brush("InputBrush"), BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(1), VerticalAlignment = VerticalAlignment.Top, Child = new LucideIcon { Kind = "plug", Size = 20, Foreground = Brush(app == null ? "SubBrush" : "ChatAccentBrush"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } });
        var info = Stack(4); info.VerticalAlignment = VerticalAlignment.Center;
        var heading = Row(8);
        heading.Children.Add(Heading(S("metaApp", app == null ? "emptyTitle" : "title"), 16));
        heading.Children.Add(Badge(S("metaApp", app == null ? "notConnected" : "connected"), app != null));
        info.Children.Add(heading);
        var topActions = Row(8); topActions.VerticalAlignment = VerticalAlignment.Top;
        if (app == null)
        {
            info.Children.Add(Text(S("metaApp", "emptyDescription")));
            topActions.Children.Add(Button(S("metaApp", "setup"), () => EditMetaApp(null), true));
        }
        else
        {
            var idLine = new TextBlock { FontSize = 14, Foreground = Brush("SubBrush") };
            idLine.Inlines.Add(new Run { Text = S("metaApp", "appId") + ": " });
            idLine.Inlines.Add(new Run { Text = (string?)app["app_id"] ?? "", FontFamily = new FontFamily("Consolas"), Foreground = Brush("HeadingBrush") });
            info.Children.Add(idLine);
            topActions.Children.Add(Button(S("metaApp", "test"), async () => { var result = await client.TestMetaAppAsync(workspace); ShowMetaResults(result); }, true));
            var menu = new MenuFlyout();
            var disconnect = new MenuFlyoutItem { Text = S("metaApp", "disconnect"), Foreground = Brush("DangerBrush") };
            disconnect.Click += async (_, _) => await Run(async () => { if (await Confirm(S("metaApp", "disconnect"), S("metaApp", "confirmDisconnect"))) { await client.DisconnectMetaAppAsync(workspace); await Saved(); } });
            menu.Items.Add(disconnect);
            topActions.Children.Add(MoreButton(S("metaApp", "actions"), menu));
        }
        Grid.SetColumn(info, 1); top.Children.Add(info);
        Grid.SetColumn(topActions, 2); top.Children.Add(topActions);
        status.Children.Add(top);
        if (app != null)
        {
            var hasSecret = (bool?)app["has_app_secret"] == true;
            var hasToken = (bool?)app["has_system_token"] == true;
            var pills = Row(8);
            pills.Children.Add(Badge($"{S("metaApp", "appSecret")}: {S("metaApp", hasSecret ? "set" : "missing")}", hasSecret));
            pills.Children.Add(Badge($"{S("metaApp", "systemToken")}: {S("metaApp", hasToken ? "set" : "notSet")}", hasToken));
            pills.Children.Add(Badge($"{S("metaApp", "webhookResult")}: {S("metaApp", "notChecked")}", false));
            status.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 16, 0, 0), Child = pills });
        }
        content.Children.Add(Card(status, true));

        var method = Stack(8);
        method.Children.Add(Text(S("metaApp", "connectionMethod").ToUpperInvariant(), 12));
        var methods = Row(8);
        methods.Children.Add(new Border { Background = WebBrush.Color(ActualTheme == ElementTheme.Dark ? "#2610b981" : "#1f10b981"), BorderBrush = Brush("ChatAccentBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(14, 9, 14, 9), Child = new TextBlock { Text = "\u2713 " + S("metaApp", "ownApp"), FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = Brush("HeadingBrush") } });
        var bspRow = Row(8);
        bspRow.Children.Add(new TextBlock { Text = S("metaApp", "bsp"), FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = Brush("SubBrush"), VerticalAlignment = VerticalAlignment.Center });
        bspRow.Children.Add(Badge(S("metaApp", "comingSoon")));
        methods.Children.Add(new Border { BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(14, 7, 14, 7), Opacity = 0.6, Child = bspRow });
        method.Children.Add(methods);
        var hintRow = Row(4);
        hintRow.Children.Add(new TextBlock { Text = S("metaApp", "existing") + "?", FontSize = 12, Foreground = Brush("SubBrush"), VerticalAlignment = VerticalAlignment.Center });
        var instLink = LinkButton(S("metaApp", "instances") + " \u2192", async () => { section = "instances"; await LoadSection(); });
        instLink.FontSize = 12; hintRow.Children.Add(instLink);
        method.Children.Add(hintRow);
        content.Children.Add(method);
        if (app == null) return;

        var credentials = Stack(0);
        var credHeader = Row(8);
        credHeader.Children.Add(new LucideIcon { Kind = "key", Size = 16, Foreground = Brush("SubBrush") });
        credHeader.Children.Add(Heading(S("metaApp", "credentials")));
        credentials.Children.Add(new Border { Background = Brush("PanelBrush"), BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1), CornerRadius = new CornerRadius(16, 16, 0, 0), Padding = new Thickness(20, 14, 20, 14), Child = credHeader });
        var items = new[] {
            ("appId", (string?)app["app_id"] ?? ""),
            ("appSecret", (bool?)app["has_app_secret"] == true ? "\u2022\u2022\u2022\u2022 " + S("metaApp", "set") : S("metaApp", "missing")),
            ("systemToken", (bool?)app["has_system_token"] == true ? "\u2022\u2022\u2022\u2022 " + S("metaApp", "set") : S("metaApp", "notSet"))
        };
        for (var i = 0; i < items.Length; i++)
        {
            var item = items[i];
            var row = new Grid { ColumnSpacing = 16 };
            row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
            var value = Stack(4); value.Children.Add(Text(S("metaApp", item.Item1), 12)); value.Children.Add(Mono(item.Item2));
            row.Children.Add(value);
            var actions = Row(12); actions.VerticalAlignment = VerticalAlignment.Center;
            actions.Children.Add(LinkButton(S("metaApp", item.Item1 == "appId" ? "edit" : "replace"), () => EditMetaApp(app)));
            if (item.Item1 == "systemToken" && (bool?)app["has_system_token"] == true)
                actions.Children.Add(LinkButton(S("metaApp", "removeToken"), async () => { await client.SaveMetaAppAsync(workspace, (string)app["app_id"]!, token: ""); await Saved(); }, danger: true));
            Grid.SetColumn(actions, 1); row.Children.Add(actions);
            credentials.Children.Add(new Border { Padding = new Thickness(20, 16, 20, 16), BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, i > 0 ? 1 : 0, 0, 0), Child = row });
        }
        content.Children.Add(Card(credentials, padding: 0));

        var webhook = Stack(0);
        var webhookHeader = Row(8);
        webhookHeader.Children.Add(new LucideIcon { Kind = "shield", Size = 16, Foreground = Brush("SubBrush") });
        webhookHeader.Children.Add(Heading(S("metaApp", "webhookResult")));
        webhook.Children.Add(new Border { Background = Brush("PanelBrush"), BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(0, 0, 0, 1), CornerRadius = new CornerRadius(16, 16, 0, 0), Padding = new Thickness(20, 14, 20, 14), Child = webhookHeader });
        var webhookBody = Stack(16); webhookBody.Padding = new Thickness(20);
        var autoRow = new Grid { ColumnSpacing = 16 };
        autoRow.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        autoRow.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var autoText = Stack(4); autoText.Children.Add(Heading(S("metaApp", "automatic"))); autoText.Children.Add(Text(S("metaApp", "automaticHint"), 12));
        autoRow.Children.Add(autoText);
        var configure = Button(S("metaApp", "configureWebhook"), async () => { var result = await client.ConfigureWebhookAsync(workspace); webhookBody.Children.Add(Text(S("metaApp", "webhookConfigured"))); RenderWebhook(webhookBody, result); });
        configure.IsEnabled = app["callback_url"]?.Type == JTokenType.String;
        configure.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(configure, 1); autoRow.Children.Add(configure);
        webhookBody.Children.Add(autoRow);
        if (!configure.IsEnabled) webhookBody.Children.Add(Text(S("metaApp", "no_public_url"), 12));
        var manual = Stack(12); manual.Children.Add(Text(S("metaApp", "manualWebhook"), 12));
        var config = AppConfiguration.Load(AppContext.BaseDirectory);
        CopyValue(manual, S("metaApp", "callback"), (string?)app["callback_url"] ?? config.SupabaseUrl.TrimEnd('/') + "/functions/v1/whatsapp-webhook?app_id=" + Uri.EscapeDataString((string)app["app_id"]!));
        CopyValue(manual, S("metaApp", "verifyToken"), (string?)app["verify_token"] ?? "", true);
        manual.Children.Add(Text(S("metaApp", "fields") + ": " + string.Join(", ", app["webhook_fields"]?.Values<string>() ?? [])));
        webhookBody.Children.Add(new Expander { Header = S("metaApp", "configureManually"), Content = manual, HorizontalAlignment = HorizontalAlignment.Stretch });
        webhook.Children.Add(webhookBody);
        content.Children.Add(Card(webhook, padding: 0));
    }
    private async Task EditMetaApp(JObject? app)
    {
        var form = Stack(); var id = Field(form, S("metaApp", "appId"), (string?)app?["app_id"] ?? "", hint: S("metaApp", "appIdHint")); var secret = Secret(form, S("metaApp", "appSecret"), S("metaApp", "appSecretHint")); var token = Secret(form, S("metaApp", "systemToken"), S("metaApp", "systemTokenHint"));
        if (app != null) { secret.PlaceholderText = token.PlaceholderText = S("metaApp", "keepSecret"); }
        await Form(S("metaApp", "credentials"), form, S("metaApp", "save"), async () => {
            if (!System.Text.RegularExpressions.Regex.IsMatch(id.Text.Trim(), "^[0-9]+$")) throw new ArgumentException(S("metaApp", "appIdHint"));
            if (string.IsNullOrWhiteSpace(secret.Password) && ((bool?)app?["has_app_secret"] != true || id.Text.Trim() != (string?)app?["app_id"])) throw new ArgumentException(S("metaApp", "appSecretHint"));
            var newSecret = secret.Password.Trim(); var newToken = token.Password.Trim(); secret.Password = token.Password = "";
            await client.SaveMetaAppAsync(workspace, id.Text, newSecret.Length > 0 ? newSecret : null, newToken.Length > 0 ? newToken : null); await Saved();
        }, () => secret.Password = token.Password = "");
    }
    private void RenderWebhook(StackPanel parent, JToken? result)
    {
        if (result is not JObject webhook) { parent.Children.Add(Text(S("metaApp", "webhookNotConfigured"))); return; }
        if (webhook["ok"] != null) { parent.Children.Add(Text(MetaResultError(webhook))); return; }
        parent.Children.Add(Text(webhook["callback_url"]?.Type != JTokenType.String ? S("metaApp", "webhookNotConfigured") : (bool?)webhook["matches"] != true ? S("metaApp", "webhookOtherAddress") + " " + webhook["callback_url"] : S("metaApp", (bool?)webhook["active"] == true ? "configured" : "webhookInactive")));
        if (webhook["missing_fields"] is JArray { Count: > 0 } missing) parent.Children.Add(Text(S("metaApp", "missingWebhookFields") + " " + string.Join(", ", missing.Values<string>())));
    }
    private static string MetaResultError(JToken result) => (string?)result["reason"] is { } reason && UiStrings.Keys.Contains("Settings_metaApp_" + reason) ? S("metaApp", reason) : (string?)result["message"] ?? "";
    private void ShowMetaResults(JObject result)
    {
        var stack = Stack(); stack.Children.Add(Heading(S("metaApp", "testResults"), 16)); stack.Children.Add(Text(S("metaApp", "lastTested") + " " + Date(new JValue(DateTimeOffset.Now)), 12));
        foreach (var key in new[] { "app", "token" }) { var value = result[key]; stack.Children.Add(Text(S("metaApp", key) + ": " + (value is not JObject ? S("metaApp", "notSet") : (bool?)value["ok"] != true ? MetaResultError(value) : key == "app" ? (string?)value["name"] : S("metaApp", "ok") + " \u00b7 " + S("metaApp", "expires") + ": " + ((long?)value["expires_at"] is { } seconds ? Date(new JValue(DateTimeOffset.FromUnixTimeSeconds(seconds))) : S("metaApp", "never")) + " \u00b7 " + string.Join(", ", value["scopes"]?.Values<string>() ?? [])))); }
        RenderWebhook(stack, result["webhook"]); content.Children.Add(Card(stack));
    }
}
