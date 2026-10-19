// SPDX-License-Identifier: AGPL-3.0-only
#if DEBUG
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.Storage.Streams;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    // In-process integration test of the real UI paths. Requires a separately prepared seed session.
    // It never signs out, sends messages, edits contacts, or opens the owner's session file.
    private async Task VerifyTaskAAsync()
    {
        var directory = VerificationStorage.DirectoryPath ?? throw new InvalidOperationException("Isolated storage required.");
        var report = new List<string>();
        void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
            report.Add(message);
        }
        try
        {
            Check(client?.Session?.User is not null && workspace is not null, "Isolated seed session and workspace loaded.");
            Check(allConversations.Count > 0, "Local Supabase conversations loaded.");
            var chats = allConversations.ToArray();
            var updates = 0;
            await EnsureRealtimeAsync();
            var deadline = DateTimeOffset.UtcNow.AddSeconds(15);
            while (!client!.IsRealtimeConnected && DateTimeOffset.UtcNow < deadline) await Task.Delay(100);
            Check(client.IsRealtimeConnected, "Isolated local Supabase realtime subscription joined.");
            client.MessageChanged += (_, _) => Interlocked.Increment(ref updates);
            File.WriteAllText(Path.Combine(directory, "ready.txt"), "Ready for no-op realtime updates.");
            for (var i = 0; i < 40; i++)
            {
                archivedView = chats[i % chats.Length].Archived;
                UpdateNavigation();
                Conversations.SelectedItem = VisibleConversation(chats[i % chats.Length].Primary.Id);
                // Same method as F5, with older message requests still in flight.
                _ = RefreshAsync("verification");
                AppWindow.Resize(new global::Windows.Graphics.SizeInt32(i % 2 == 0 ? 900 : 1280, i % 2 == 0 ? 600 : 800));
                await Task.Delay(200);
            }
            while (busy) await Task.Delay(50);
            await RefreshAsync("verification");
            await LoadChatAsync();
            Check(updates > 0, $"Observed {updates} local Supabase realtime message updates during stress.");
            Check(!ChatError.IsOpen, "40 chat selections, refresh requests and resizes completed without a chat error.");
            Check(selected is not null && messages.All(m => m.ConversationId is null || selected.MemberIds.Contains(m.ConversationId)), "Latest chat owns every rendered message.");
            Check(timeline.Items.Count == timeline.Items.Select(i => i.Id).Distinct().Count(), "Native timeline IDs remain unique.");
            // Pick the longest available seed history before exercising scrolling.
            ConversationView? longest = null;
            var count = -1;
            foreach (var chat in chats)
            {
                var history = await client.GetMessagesAsync(chat.MemberIds);
                if (history.Count > count) { count = history.Count; longest = chat; }
            }
            if (longest is not null)
            {
                archivedView = longest.Archived; UpdateNavigation();
                Conversations.SelectedItem = VisibleConversation(longest.Primary.Id);
                await LoadChatAsync();
            }
            AppWindow.Resize(new global::Windows.Graphics.SizeInt32(900, 600));
            await Task.Delay(400);
            OnMessagesLoaded(MessageList, new RoutedEventArgs());
            var scroll = messageScroll ?? throw new InvalidOperationException("Message ScrollViewer was not realized.");
            var scrollTrace = new List<string>();
            scroll.ViewChanged += (_, e) => scrollTrace.Add($"height={scroll.ScrollableHeight:F1}, offset={scroll.VerticalOffset:F1}, intermediate={e.IsIntermediate}, app={bottomAnchor.Programmatic}, follow={bottomAnchor.Following}");
            void CheckBottom()
            {
                var reached = bottomAnchor.Following && BottomAnchor.IsAtBottom(scroll.ScrollableHeight, scroll.VerticalOffset);
                if (!reached) report.Add("Scroll trace: " + string.Join("; ", scrollTrace.TakeLast(12)));
                Check(reached, "New-messages action resumes bottom following.");
            }
            ScrollToBottom(); await Task.Delay(500);
            Check(bottomAnchor.Following, "Opening a chat follows its bottom.");
            if (scroll.ScrollableHeight > 80)
            {
                // Deliberately unmarked native view change: same event path as manipulation/thumb input.
                bottomAnchor.UserInput(); scroll.ChangeView(null, Math.Max(0, scroll.VerticalOffset - 200), null, true);
                await Task.Delay(300);
                Check(!bottomAnchor.Following, "Unmarked upward native view change releases bottom following.");
                var offset = scroll.VerticalOffset;
                for (var i = 0; i < 10; i++) { RenderMessages(); await Task.Delay(50); }
                Check(Math.Abs(scroll.VerticalOffset - offset) < 1, "Repeated rendering preserves the reader's offset.");
                OnNewMessages(this, new RoutedEventArgs()); await Task.Delay(500);
                CheckBottom();
            }
            else
            {
                // No server writes: extend the in-memory history only, preserving its message shapes.
                var copies = Enumerable.Range(0, 80).Select(i => new MessageRow
                {
                    Id = "verification:" + i, ConversationId = selected!.Primary.Id,
                    Timestamp = DateTimeOffset.Now.AddMinutes(i - 80).ToString("O"),
                    Content = new Newtonsoft.Json.Linq.JObject { ["type"] = "text", ["text"] = "Scroll verification row " + i },
                    SenderAddress = "verification"
                });
                messages = messages.Concat(copies).ToArray(); RenderMessages(forceBottom: true);
                await Task.Delay(500);
                Check(scroll.ScrollableHeight > 80, "UI-only fixture history provides a scrollable extent.");
                bottomAnchor.UserInput(); scroll.ChangeView(null, Math.Max(0, scroll.VerticalOffset - 200), null, true);
                await Task.Delay(300);
                Check(!bottomAnchor.Following, "Unmarked upward native view change releases bottom following.");
                var offset = scroll.VerticalOffset;
                for (var i = 0; i < 10; i++) { RenderMessages(); await Task.Delay(50); }
                Check(Math.Abs(scroll.VerticalOffset - offset) < 1, "Repeated rendering preserves the reader's offset.");
                OnNewMessages(this, new RoutedEventArgs()); await Task.Delay(500);
                CheckBottom();
            }
            await LoadChatAsync();
            AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1280, 800));
            await OpenNotificationAsync("00000000-0000-0000-0000-000000000000");
            Check(pendingConversation is null, "Missing notification conversation does not remain pending or recurse.");
            foreach (var theme in new[] { ElementTheme.Dark, ElementTheme.Light })
            {
                Shell.RequestedTheme = theme; await Task.Delay(200);
                archivedView = false; UpdateNavigation(); Search.Focus(FocusState.Programmatic);
                await CaptureTaskAAsync(directory, theme + "-search-focused");
                ChatName.Focus(FocusState.Programmatic);
                await CaptureTaskAAsync(directory, theme + "-search-unfocused");
                archivedView = true; UpdateNavigation(); Search.Focus(FocusState.Programmatic);
                await CaptureTaskAAsync(directory, theme + "-archived-focused");
                archivedView = false; UpdateNavigation();
                var incoming = lastIncoming;
                lastIncoming = new MessageRow { Timestamp = DateTimeOffset.UtcNow.ToString("O"), Status = new Newtonsoft.Json.Linq.JObject { ["read"] = "fixture" } };
                UpdateServiceWindow();
                Composer.Focus(FocusState.Programmatic);
                await CaptureTaskAAsync(directory, theme + "-composer-focused");
                lastIncoming = incoming; UpdateServiceWindow();
                searchBar!.Visibility = Visibility.Visible; chatSearch!.Focus(FocusState.Programmatic);
                await CaptureTaskAAsync(directory, theme + "-chat-search-focused"); CloseSearch();
                ShowProfile(false); await Task.Delay(200);
                FindTextBox(profilePanel!)?.Focus(FocusState.Programmatic);
                await CaptureTaskAAsync(directory, theme + "-profile-name-focused"); CloseProfile();
            }
            report.Add("Focused/unfocused search, Archived, composer, chat search and profile name rendered in both themes.");
            report.Add("Physical touchpad, scrollbar-thumb drag, and browser launch require interactive verification.");
            File.WriteAllLines(Path.Combine(directory, "result.txt"), report.Prepend("PASS"));
        }
        catch (Exception exception)
        {
            AppLog.Error("Task A native integration verification failed", exception);
            File.WriteAllLines(Path.Combine(directory, "result.txt"), report.Prepend("FAIL: " + exception));
        }
        finally { Close(); }
    }

    private static TextBox? FindTextBox(DependencyObject parent)
    {
        if (parent is TextBox input) return input;
        for (var i = 0; i < Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChildrenCount(parent); i++)
            if (FindTextBox(Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChild(parent, i)) is { } found) return found;
        return null;
    }

    private async Task CaptureTaskAAsync(string directory, string name)
    {
        await Task.Delay(200);
        Shell.UpdateLayout();
        var bitmap = new RenderTargetBitmap();
        await bitmap.RenderAsync(Shell);
        var pixels = await bitmap.GetPixelsAsync();
        var bytes = new byte[pixels.Length];
        using (var reader = DataReader.FromBuffer(pixels)) reader.ReadBytes(bytes);
        var file = await StorageFile.GetFileFromPathAsync(CreateFile(Path.Combine(directory, name + ".png")));
        using var stream = await file.OpenAsync(FileAccessMode.ReadWrite);
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, bytes);
        await encoder.FlushAsync();
    }
}
#endif
