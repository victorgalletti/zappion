// SPDX-License-Identifier: AGPL-3.0-only
#if DEBUG
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;
using Windows.UI.Notifications;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    // In-process verification of unpackaged toast registration, delivery, replacement, and COM activation.
    // Uses an isolated seed session and synthetic in-memory incoming rows; never sends a WhatsApp message.
    private async Task VerifyTaskFAsync()
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
            var config = AppConfiguration.Load(AppContext.BaseDirectory);
            Check(new Uri(config.SupabaseUrl).IsLoopback, "Supabase endpoint is local.");
            Check(client?.Session?.User is not null && workspace is not null, "Isolated seed session and workspace loaded.");
            Check(allConversations.Count > 0, "Local Supabase conversations loaded.");
            reconnectTimer.Stop();

            Check(notifications.IsRegistered, "DesktopNotifications registered with ToastNotificationManager.");
            Check(GetCurrentProcessExplicitAppUserModelID(out var processAumid) == 0 && processAumid == notifications.Aumid,
                $"Process explicit AppUserModelID is '{notifications.Aumid}'.");

            using (var key = Registry.CurrentUser.OpenSubKey(notifications.RegistrySubKey, writable: false))
            {
                Check(key is not null, $"HKCU\\{notifications.RegistrySubKey} is registered.");
                var displayName = key!.GetValue("DisplayName") as string;
                var iconUri = key.GetValue("IconUri") as string;
                var customActivator = key.GetValue("CustomActivator") as string;
                Check(displayName == "Zappion", "HKCU AUMID DisplayName is 'Zappion'.");
                Check(!string.IsNullOrWhiteSpace(iconUri) && File.Exists(iconUri), "HKCU AUMID IconUri points to an existing asset file.");
                Check(string.Equals(customActivator, notifications.ActivatorClsid.ToString("B"), StringComparison.OrdinalIgnoreCase),
                    "HKCU AUMID CustomActivator matches the registered COM activator CLSID.");
            }

            var target = allConversations[0];
            selected = null;
            Conversations.SelectedItem = null;
            ChatPanel.Visibility = Microsoft.UI.Xaml.Visibility.Collapsed;
            SelectChat.Visibility = Microsoft.UI.Xaml.Visibility.Visible;
            active = false;
            preferences = preferences with { DesktopNotifications = true, NotificationSound = false };

            var firstIncoming = new MessageRow
            {
                Id = "task-f-verify-1:" + Guid.NewGuid().ToString("N"),
                ConversationId = target.Primary.Id,
                ConversationAddress = target.Primary.Address,
                OrganizationId = workspace!.OrganizationId,
                OrganizationAddress = target.Primary.OrganizationAddress,
                SenderAddress = target.Primary.Address,
                Service = "whatsapp",
                Timestamp = DateTimeOffset.UtcNow.AddSeconds(1).ToString("O"),
                Content = new JObject { ["type"] = "text", ["text"] = "First verification preview" }
            };
            var secondIncoming = new MessageRow
            {
                Id = "task-f-verify-2:" + Guid.NewGuid().ToString("N"),
                ConversationId = target.Primary.Id,
                ConversationAddress = target.Primary.Address,
                OrganizationId = workspace.OrganizationId,
                OrganizationAddress = target.Primary.OrganizationAddress,
                SenderAddress = target.Primary.Address,
                Service = "whatsapp",
                Timestamp = DateTimeOffset.UtcNow.AddSeconds(2).ToString("O"),
                Content = new JObject { ["type"] = "text", ["text"] = "Replaced verification preview" }
            };

            await ApplyRealtimeAsync(firstIncoming, insert: true);
            await ApplyRealtimeAsync(secondIncoming, insert: true);
            await Task.Delay(300);

            var setting = notifications.Setting;
            var history = ToastNotificationManager.History.GetHistory(notifications.Aumid);
            var matchingHistory = history.Where(h => h.Tag == MessageNotifications.ToastTag(target.Primary.Id) &&
                                                     h.Group == MessageNotifications.ToastGroup).ToArray();
            report.Add($"ToastNotifier.Setting={setting}; ToastNotificationManager.History count={history.Count} (matching Tag/Group={matchingHistory.Length}).");
            if (setting == NotificationSetting.Enabled)
                Check(matchingHistory.Length == 1, "Delivered toast replaces previous toast for the same conversation in Action Center history.");

            // Verify COM toast click activation opens the conversation in the window.
            var clsid = notifications.ActivatorClsid;
            var iid = typeof(DesktopNotifications.INotificationActivationCallback).GUID;
            var hr = CoCreateInstance(ref clsid, 0, 4, ref iid, out var callbackObj);
            Check(hr == 0 && callbackObj is DesktopNotifications.INotificationActivationCallback,
                "COM CoCreateInstance resolved INotificationActivationCallback on CLSCTX_LOCAL_SERVER.");
            ((DesktopNotifications.INotificationActivationCallback)callbackObj!).Activate(
                notifications.Aumid, "conversation=" + Uri.EscapeDataString(target.Primary.Id), 0, 0);
            if (Marshal.IsComObject(callbackObj)) Marshal.ReleaseComObject(callbackObj);

            var deadline = DateTimeOffset.UtcNow.AddSeconds(5);
            while (selected?.Primary.Id != target.Primary.Id && DateTimeOffset.UtcNow < deadline)
                await Task.Delay(50);
            Check(selected?.Primary.Id == target.Primary.Id && ChatPanel.Visibility == Microsoft.UI.Xaml.Visibility.Visible,
                "Toast activation callback activated the window and opened the target conversation.");

            File.WriteAllLines(Path.Combine(directory, "result.txt"), report.Prepend("PASS"));
        }
        catch (Exception ex)
        {
            AppLog.Error("Task F verification failed", ex);
            File.WriteAllLines(Path.Combine(directory, "result.txt"), new[] { "FAIL", ex.ToString() }.Concat(report));
        }
        finally { Close(); }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] out string appID);

    [DllImport("ole32.dll")]
    private static extern int CoCreateInstance(
        ref Guid rclsid,
        nint pUnkOuter,
        uint dwClsContext,
        ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out object? ppv);
}
#endif
