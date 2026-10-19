// SPDX-License-Identifier: AGPL-3.0-only
#if DEBUG
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.Storage.Streams;
using Newtonsoft.Json.Linq;
using Zappion.Windows.Core;
using System.Net;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    // Development-only render review. No authentication, network, notifications or backend changes.
    private async Task CaptureLayoutReviewAsync(string folder)
    {
        try
        {
            Directory.CreateDirectory(folder);
            AppWindow.Show();
            await Task.Delay(100);
            Activate();
            AppWindow.Show();
            Shell.Width = 1280; Shell.Height = 800;
            var scale = Shell.XamlRoot.RasterizationScale;
            AppWindow.Resize(new global::Windows.Graphics.SizeInt32((int)(1280 * scale), (int)(800 * scale)));
            Progress.Visibility = Visibility.Collapsed;
            OrganizationAvatar.Set("Zappion Demo", "Zappion Demo"); MemberAvatar.Set("Victor", "member");
            OrganizationName.Text = "Zappion Demo"; AgentName.Text = "Victor";
            var conversation = new ConversationView(new ConversationRow { Id = "review", Address = "551199887766", OrganizationAddress = "test-number" }, ["review"], "Ana Souza", new MessageRow { Timestamp = DateTimeOffset.Now.ToString("O"), Content = JObject.Parse("{type:'text',text:'oi'}"), Status = JObject.Parse("{read:'now'}") }, 5);
            workspace = new Workspace(new AgentRow { Id = "review-agent", Name = "dev", OrganizationId = "review-org" }, "Zappion Demo",
                [new OrganizationAddressRow { Address = "test-number", Extra = JObject.Parse("{label:'Support'}") }, new OrganizationAddressRow { Address = "second-number", Extra = JObject.Parse("{label:'Sales'}") }]);
            preferences = preferences with { Language = "en" }; Relocalize();
            ConfigureNumbers();
            allConversations = [conversation];
            var samples = new[] { "Hello! Can you help me?", "Of course. How can I help?", "[MCP v2] image saved to storage", "[MCP v2] document", "[MCP v2] video", "A longer message wraps naturally to show the time and delivery ticks inside the bubble." };
            messages = samples.Select((text, i) => new MessageRow { Id = i.ToString(), ConversationId = "review", Timestamp = DateTimeOffset.Now.AddMinutes(-10 + i).ToString("O"), SenderAddress = i == 0 ? "contact" : null, Content = new JObject { ["type"] = "text", ["text"] = text }, Status = JObject.Parse("{read:'now'}") }).ToArray();
            foreach (var theme in new[] { ElementTheme.Light, ElementTheme.Dark })
            {
                Shell.RequestedTheme = theme;
                await Task.Delay(100);
                timeline.Items.Clear();
                SignInPanel.Visibility = Visibility.Collapsed; WorkspacePanel.Visibility = Visibility.Visible;
                ChatPanel.Visibility = Visibility.Collapsed; SelectChat.Visibility = Visibility.Visible;
                selected = null; ApplyFilters();
                await Capture("empty");
                OnArchived(this, new RoutedEventArgs()); await Capture("archived"); OnChats(this, new RoutedEventArgs());
                ShowProfile(false); await Capture("profile");
                ShowProfile(true); await Capture("preferences");
                FindScrollViewer(profilePanel!)?.ChangeView(null, 800, null, true); await Capture("preferences-bottom"); CloseProfile(); UpdateNavigation();
                var previousLanguage = preferences.Language;
                preferences = preferences with { Language = "pt-BR" }; Relocalize();
                ShowProfile(true); await Capture("preferences-pt"); CloseProfile();
                preferences = preferences with { Language = previousLanguage }; Relocalize(); UpdateNavigation();
                selected = conversation; Conversations.SelectedItem = conversation;
                ChatName.Text = conversation.DisplayName; UpdateChatHeader(conversation);
                ChatPhone.Text = MessageHelpers.FormatPhone(conversation.Primary.Address) + " · Test Number";
                ChatPanel.Visibility = Visibility.Visible; SelectChat.Visibility = Visibility.Collapsed;
                lastIncoming = messages.First(); UpdateServiceWindow();
                RenderMessages(); ScrollToBottom();
                await Capture("chat");
                searchBar!.Visibility = Visibility.Visible; chatSearch!.Text = "help"; await Capture("search"); CloseSearch();
                Shell.Width = 900; Shell.Height = 600;
                AppWindow.Resize(new global::Windows.Graphics.SizeInt32((int)(900 * scale), (int)(600 * scale)));
                await Capture("chat-minimum");
                Shell.Width = double.NaN; Shell.Height = double.NaN;
                if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter presenter) presenter.Maximize();
                await Capture("chat-maximized");
                if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter restored) restored.Restore();
                Shell.Width = 1280; Shell.Height = 800;
                AppWindow.Resize(new global::Windows.Graphics.SizeInt32((int)(1280 * scale), (int)(800 * scale)));
                var savedMessages = messages;
                var template = JObject.Parse("{name:'appointment_reminder',language:'en_US',category:'UTILITY',status:'APPROVED',components:[{type:'HEADER',format:'TEXT',text:'Appointment for {{name}}'},{type:'BODY',text:'Hello {{1}}! Your appointment is scheduled for {{2}}.'},{type:'FOOTER',text:'Thank you for choosing us'},{type:'BUTTONS',buttons:[{type:'QUICK_REPLY',text:'Confirm'},{type:'URL',text:'View details',url:'https://example.com'}]}]}");
                templates = [template];
                var original = new MessageRow { Id = "original", ExternalId = "wamid.original", SenderAddress = "contact", Timestamp = DateTimeOffset.Now.AddMinutes(-3).ToString("O"), Content = JObject.Parse("{type:'text',kind:'text',text:'Can you confirm my appointment?'}") };
                var answer = new MessageRow { Id = "answer", ExternalId = "wamid.answer", Timestamp = DateTimeOffset.Now.AddMinutes(-2).ToString("O"), Content = JObject.Parse("{type:'text',kind:'text',text:'Of course! Here are your appointment details.',re_message_id:'wamid.original'}"), Status = JObject.Parse("{read:'now'}") };
                var templateMessage = new MessageRow { Id = "template", Timestamp = DateTimeOffset.Now.AddMinutes(-1).ToString("O"), Content = Templates.Build(template, new Dictionary<string,string> { ["root.header.name"]="Victor", ["root.body.1"]="Victor", ["root.body.2"]="Friday at 15:00" }), Status = JObject.Parse("{delivered:'now'}") };
                messages = [original, answer, templateMessage, new MessageRow { Id="reaction", Timestamp=DateTimeOffset.Now.ToString("O"), Content=MessageInteractions.Reaction([], "wamid.answer", MessageInteractions.QuickReactions[0]) }];
                RenderMessages(forceBottom:true); BeginReply(original); await Capture("interactions"); ClearReply();
                lastIncoming = null; UpdateServiceWindow(); RenderMessages(); await Capture("closed-window");
                TemplatePickerHost.Visibility = Visibility.Visible;
                var picker = new TemplatePicker(templates, (_, _) => throw new InvalidOperationException(), _ => throw new InvalidOperationException(), CloseTemplatePicker);
                TemplatePickerHost.Child = picker; await Capture("template-list");
                picker.ShowTemplate(template); await Capture("template-preview"); CloseTemplatePicker();
                messages = savedMessages; templates = []; lastIncoming=messages.First(); UpdateServiceWindow(); RenderMessages(forceBottom:true);
                if (Environment.GetEnvironmentVariable("ZAPPION_MEDIA_REVIEW_FILE") is { Length: > 0 } manifest)
                {
                    var fixtures = JArray.Parse(File.ReadAllText(manifest));
                    using var http = new HttpClient(new ReviewMediaHandler(fixtures));
                    ChatMedia.Cache = new MediaCache(p => Task.FromResult("https://review.invalid/" + p), Path.Combine(folder, "cache"), http: http);
                    var textMessages = messages;
                    messages = fixtures.Select((fixture, i) => fixture["message"]?.ToObject<MessageRow>() ?? new MessageRow
                    {
                        Id = "media-" + i, ConversationId = "review", Timestamp = DateTimeOffset.Now.AddMinutes(-5 + i).ToString("O"),
                        Content = (JObject)fixture["content"]!, Status = JObject.Parse("{read:'now'}")
                    }).ToArray();
                    bottomAnchor.Open();
                    timeline.Items.Clear();
                    RenderMessages();
                    await Task.Delay(2500);
                    await Capture("media");
                    // Reapply the same history as a reconnect/refetch would, without another forced scroll.
                    RenderMessages();
                    await Task.Delay(500);
                    await Capture("media-refetch");
                    var newest = timeline.Items.LastOrDefault();
                    var container = newest is null ? null : MessageList.ContainerFromItem(newest) as FrameworkElement;
                    var bounds = container?.TransformToVisual(MessageList).TransformBounds(new global::Windows.Foundation.Rect(0, 0, container.ActualWidth, container.ActualHeight));
                    File.AppendAllText(Path.Combine(folder, "bottom-check.txt"), $"{theme}: newest={newest?.Message?.Content?["text"]}; visible={bounds is { } rect && rect.Top >= 0 && rect.Bottom <= MessageList.ActualHeight}; bottomGap={messageScroll?.ScrollableHeight - messageScroll?.VerticalOffset:F1}\n");
                    messages = textMessages;
                }
                WorkspacePanel.Visibility = Visibility.Collapsed; SignInPanel.Visibility = Visibility.Visible;
                await Capture("signin");
                async Task Capture(string screen)
                {
                    await Task.Delay(400);
                    Shell.UpdateLayout();
                    var bitmap = new RenderTargetBitmap();
                    await bitmap.RenderAsync(Shell, (int)Shell.ActualWidth, (int)Shell.ActualHeight);
                    var pixels = await bitmap.GetPixelsAsync();
                    var bytes = new byte[pixels.Length];
                    using (var reader = DataReader.FromBuffer(pixels)) reader.ReadBytes(bytes);
                    var path = Path.Combine(folder, $"{theme.ToString().ToLowerInvariant()}-{screen}.png");
                    var file = await StorageFile.GetFileFromPathAsync(CreateFile(path));
                    using var stream = await file.OpenAsync(FileAccessMode.ReadWrite);
                    var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
                    encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, bytes);
                    await encoder.FlushAsync();
                    if (Environment.GetEnvironmentVariable("ZAPPION_LAYOUT_HOLD") == $"{theme.ToString().ToLowerInvariant()}-{screen}")
                    {
                        var resume = Path.Combine(folder, "resume.txt");
                        while (!File.Exists(resume))
                        {
                            // UIA requests an app-only render, independent of foreground windows.
                            var requestFile = Path.Combine(folder, "capture-request.txt");
                            if (File.Exists(requestFile))
                            {
                                var request = File.ReadAllText(requestFile).Trim();
                                File.Delete(requestFile);
                                if (request.StartsWith("invoked-", StringComparison.Ordinal) && request.All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))
                                    await Capture(request);
                            }
                            await Task.Delay(100);
                        }
                    }
                }
            }
            File.WriteAllText(Path.Combine(folder, "result.txt"), "Native WinUI content captures completed in both themes at restored (1280 x 800), minimum (900 x 600) and maximized sizes. Windows-owned caption buttons are excluded. No authentication or backend writes.");
        }
        catch (Exception ex) { AppLog.Error("LayoutReview operation failed", ex); File.WriteAllText(Path.Combine(folder, "result.txt"), ex.GetType().Name + "\n" + ex.Message + "\n" + ex.StackTrace); }
        Close();
    }
    private static string CreateFile(string path) { using var stream = File.Create(path); return path; }
    private sealed class ReviewMediaHandler(JArray fixtures) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var fixture = fixtures.First(f => MediaContent.StoragePath((string?)f["content"]?["file"]?["uri"] ?? "") == Uri.UnescapeDataString(request.RequestUri!.AbsolutePath.TrimStart('/')));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(File.ReadAllBytes((string)fixture["path"]!)) });
        }
    }
}
#endif
