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
    // Only called with an explicitly isolated local seed session. Mutations touch one new key.
    private async Task VerifyTaskCAsync()
    {
        var directory = VerificationStorage.DirectoryPath ?? throw new InvalidOperationException("Isolated storage required.");
        var report = new List<string>(); string? fixtureKey = null;
        void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); report.Add(message); }
        async Task Capture(string name)
        {
            await Task.Delay(250); Shell.UpdateLayout();
            var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(Shell);
            var pixels = await bitmap.GetPixelsAsync(); using var reader = DataReader.FromBuffer(pixels); var bytes = new byte[pixels.Length]; reader.ReadBytes(bytes);
            var folder = await StorageFolder.GetFolderFromPathAsync(directory); var file = await folder.CreateFileAsync(name + ".png", CreationCollisionOption.ReplaceExisting);
            using var stream = await file.OpenAsync(FileAccessMode.ReadWrite); var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, bytes); await encoder.FlushAsync();
        }
        try
        {
            var config = AppConfiguration.Load(AppContext.BaseDirectory);
            Check(new Uri(config.SupabaseUrl).IsLoopback, "Supabase endpoint is local.");
            Check(client != null && workspace != null, "Isolated seed session and workspace loaded.");
            reconnectTimer.Stop(); active = false;
            var w = workspace!; var c = client!;
            Check((await c.GetMembersAsync(w.OrganizationId)).Count > 0, "Read member list using the web projection and filters.");
            await c.GetInvitationsAsync(w.OrganizationId); report.Add("Read pending organization invitations.");
            await c.GetInvitationsAsync(); report.Add("Read invitation inbox.");
            foreach (var number in w.Numbers) await c.GetInstanceCountAsync(w, number.Address); report.Add("Read per-instance conversation counts.");
            var before = await c.GetApiKeysAsync(w); var existingIds = before.Select(k => (string)k["id"]!).ToHashSet();
            var created = await c.CreateApiKeyAsync(w, "Windows Task C fixture " + Guid.NewGuid().ToString("N"), "read", DateTimeOffset.UtcNow.AddHours(1).ToString("O"), null, 1, 0);
            fixtureKey = (string)created["id"]!; created.Remove("key");
            Check(!existingIds.Contains(fixtureKey), "Created a new fixture key using zappion_create_api_key; full key discarded.");
            await c.RevokeApiKeyAsync(w, fixtureKey); var revoked = (await c.GetApiKeysAsync(w)).OfType<Newtonsoft.Json.Linq.JObject>().Single(k => (string?)k["id"] == fixtureKey);
            Check(SettingsRules.KeyState(revoked, DateTimeOffset.UtcNow) == "revoked", "Revoked only the new fixture key using zappion_revoke_api_key.");
            await c.DeleteApiKeyAsync(w, fixtureKey); fixtureKey = null;
            var after = await c.GetApiKeysAsync(w);
            Check(after.Select(k => (string)k["id"]!).ToHashSet().SetEquals(existingIds), "Fixture key removed; all pre-existing keys retained.");
            await c.GetMcpCallsAsync(w); report.Add("Read the last 50 MCP calls.");
            try { await c.GetMetaAppAsync(w); report.Add("Read Meta App status from the local edge function."); }
            catch (Exception ex) { report.Add("Meta App endpoint limitation: " + (ex is FunctionError f ? $"HTTP {f.Status}" : ex.GetType().Name)); }
            foreach (var theme in new[] { ElementTheme.Dark, ElementTheme.Light })
            {
                Shell.RequestedTheme = theme;
                OnNewChat(this, new RoutedEventArgs()); NewChatNumber.Text = "5561999999999"; NewChatNumber.Focus(FocusState.Programmatic); await Capture("new-chat-" + theme.ToString().ToLowerInvariant()); CloseNewChat();
                OnWebSettings(this, new RoutedEventArgs()); await Task.Delay(150);
                Check(nativeSettings != null && InboxGrid.Visibility == Visibility.Collapsed, "Gear opens native settings in " + theme + ".");
                foreach (var section in new[] { "organization", "members", "instances", "meta-app", "integrations" })
                {
                    await nativeSettings!.NavigateForVerificationAsync(section);
                    await Capture(section + "-" + theme.ToString().ToLowerInvariant());
                    if (nativeSettings.VerificationFeedback.Length > 0) report.Add(section + " rendering feedback: " + nativeSettings.VerificationFeedback);
                }
                foreach (var tab in new[] { "mcp", "activity" }) { await nativeSettings!.NavigateForVerificationAsync("integrations", tab); await Capture(tab + "-" + theme.ToString().ToLowerInvariant()); }
                OnChats(this, new RoutedEventArgs()); Check(nativeSettings?.Visibility != Visibility.Visible && InboxGrid.Visibility == Visibility.Visible, "Chats returns from native settings.");
            }
            report.Add("No organization name/logo, Meta credentials, existing keys, members or invitations were changed. No WhatsApp or Meta operations were invoked.");
            File.WriteAllLines(Path.Combine(directory, "result.txt"), new[] { "PASS" }.Concat(report));
        }
        catch (Exception ex) { File.WriteAllLines(Path.Combine(directory, "result.txt"), new[] { "FAIL", ex.GetType().Name, ex.Message }.Concat(report)); }
        finally
        {
            if (fixtureKey != null && client != null && workspace != null) { try { await client.DeleteApiKeyAsync(workspace, fixtureKey); } catch { File.AppendAllText(Path.Combine(directory, "result.txt"), "\nFixture cleanup failed: " + fixtureKey); } }
            Close();
        }
    }
}
#endif
