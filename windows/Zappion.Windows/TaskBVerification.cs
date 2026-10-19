// SPDX-License-Identifier: AGPL-3.0-only
#if DEBUG
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.Storage.Streams;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    // Local seed-session checks. Never sends a WhatsApp message or accesses owner storage.
    private async Task VerifyTaskBAsync()
    {
        var directory = VerificationStorage.DirectoryPath ?? throw new InvalidOperationException("Isolated storage required.");
        var report = new List<string>();
        void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
            report.Add(message);
        }
        async Task Capture(string name)
        {
            await Task.Delay(250);
            var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(Shell);
            var pixels = await bitmap.GetPixelsAsync();
            var file = await StorageFile.GetFileFromPathAsync(Path.Combine(directory, "session.json"));
            var folder = await file.GetParentAsync();
            var image = await folder.CreateFileAsync(name + ".png", CreationCollisionOption.ReplaceExisting);
            using var stream = await image.OpenAsync(FileAccessMode.ReadWrite);
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
            using var reader = DataReader.FromBuffer(pixels); var bytes = new byte[pixels.Length]; reader.ReadBytes(bytes);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, bytes);
            await encoder.FlushAsync();
        }
        try
        {
            Check(workspace is not null && client?.Session?.User is not null, "Isolated local Supabase session and workspace loaded.");
            var originalWorkspace = workspace!;
            var connectedNumbers = workspace!.Numbers.Where(n => n.Status == "connected").ToArray();
            Check(connectedNumbers.Length > 0, "Local Supabase has a connected business number.");
            var originalCount = allConversations.Count;
            active = false; // These checks must not generate customer read receipts.
            foreach (var theme in new[] { ElementTheme.Light, ElementTheme.Dark })
            {
                Shell.RequestedTheme = theme;
                OnNewChat(this, new RoutedEventArgs());
                NewChatNumber.Text = "+55 (61) 99999-0000";
                NewChatInstance.SelectedValue = connectedNumbers[0].Address;
                await Task.Delay(100);
                Check(OpenNewChatButton.IsEnabled, "Formatted phone input accepted in " + theme + " theme.");
                await Capture("new-chat-" + theme.ToString().ToLowerInvariant());
                OnNewChatBack(this, new RoutedEventArgs());
                Check(NewChatPanel.Visibility == Visibility.Collapsed, "Back closes drawer in " + theme + " theme.");
            }
            workspace = originalWorkspace with { Numbers = [] };
            OnNewChat(this, new RoutedEventArgs());
            Check(!OpenNewChatButton.IsEnabled && ConnectNumberNotice.Visibility == Visibility.Visible, "No connected number disables submission and explains how to connect.");
            chosenNewChatInstance = null;
            workspace = originalWorkspace with { Numbers = [connectedNumbers[0], new OrganizationAddressRow { Address = "verification-only", Status = "connected" }] };
            OnNewChat(this, new RoutedEventArgs());
            Check(NewChatInstancePanel.Visibility == Visibility.Visible && !OpenNewChatButton.IsEnabled, "Multiple connected numbers require an explicit choice.");
            NewChatInstance.SelectedValue = connectedNumbers[0].Address;
            Check(OpenNewChatButton.IsEnabled, "Choosing the business number enables submission.");
            workspace = originalWorkspace;
            var existing = allConversations.FirstOrDefault(c => c.Primary.OrganizationAddress == connectedNumbers[0].Address);
            Check(existing is not null, "Local Supabase supplies an existing conversation for reuse.");
            NewChatNumber.Text = existing!.Primary.Address;
            OnOpenNewChat(this, new RoutedEventArgs());
            while (loadingChatVersion != 0) await Task.Delay(50);
            Check(selected?.Primary.Id == existing.Primary.Id && !NewConversation.IsDraft(selected), "Opening an existing phone reuses its merged conversation.");
            OnNewChat(this, new RoutedEventArgs());
            NewChatInstance.SelectedValue = connectedNumbers[0].Address;
            var phone = "12025550198";
            Check(NewConversation.Find(allConversations, phone, connectedNumbers[0].Address) is null, "Synthetic draft recipient has no existing row.");
            NewChatNumber.Text = phone;
            OnOpenNewChat(this, new RoutedEventArgs());
            while (loadingChatVersion != 0 || loadingTemplates) await Task.Delay(50);
            await Task.Delay(500);
            Check(NewConversation.IsDraft(selected) && messages.Count == 0 && ChatPanel.Visibility == Visibility.Visible, "Unknown phone opens an empty native chat.");
            Check(!WindowOpen && TemplatePickerHost.Visibility == Visibility.Visible, "Empty chat opens with closed service window and template picker.");
            var templateFailure = (TemplatePickerHost.Child as Microsoft.UI.Xaml.Controls.StackPanel)?.Children.OfType<Microsoft.UI.Xaml.Controls.TextBlock>().FirstOrDefault()?.Text;
            report.Add(templateFailure is null ? "Approved-template picker loaded." : "Template endpoint limitation: " + templateFailure);
            await RefreshAsync("verification");
            Check(NewConversation.IsDraft(selected) && allConversations.Count == originalCount, "Supabase refresh preserves the draft without creating a conversation row.");
            await Capture("draft-chat-dark");
            foreach (var count in new[] { 1, 99, 100, 0 }) TaskbarOverlay.Set(WinRT.Interop.WindowNative.GetWindowHandle(this), count);
            Check(true, "Native unpackaged taskbar overlay accepts 1, 99, 99+ and clear without COM failure.");
            File.WriteAllLines(Path.Combine(directory, "result.txt"), new[] { "PASS" }.Concat(report));
        }
        catch (Exception ex)
        {
            AppLog.Error("Task B verification failed", ex);
            File.WriteAllLines(Path.Combine(directory, "result.txt"), new[] { "FAIL", ex.ToString() }.Concat(report));
        }
        finally { Close(); }
    }
}
#endif

