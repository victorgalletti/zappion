// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.ApplicationModel.DataTransfer;
using Windows.Media.Capture;
using Windows.Media.MediaProperties;
using Windows.Storage;
using Windows.Storage.Pickers;
using Zappion.Windows.Core;

namespace Zappion.Windows;

public sealed partial class MainWindow
{
    private sealed record PendingAttachment(StorageFile File, string Mime, long Size, double? Duration = null, bool Temporary = false);
    private readonly List<PendingAttachment> attachments = new();
    private MediaCapture? capture;
    private StorageFile? recordingFile;
    private DateTimeOffset recordingStarted;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? recordingTimer;
    private bool recordingBusy;

    private async void OnAttach(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!WindowOpen || sending || capture is not null || recordingBusy) return;
            try
            {
                var picker = new FileOpenPicker(); picker.FileTypeFilter.Add("*");
                ChatMedia.InitializePicker(picker);
                var target = selected?.Primary.Id;
                var files = await picker.PickMultipleFilesAsync();
                if (selected?.Primary.Id == target) await AddFilesAsync(files);
            }
            catch (Exception ex) { AppLog.Error("MainWindow.Media operation failed", ex); ShowChatError(ex is InvalidOperationException ? ex.Message : UiStrings.Get("MediaUnavailable")); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnAttach failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private async Task AddFilesAsync(IEnumerable<IStorageItem> items)
    {
        if (!WindowOpen || sending || capture is not null || recordingBusy || selected is null) return;
        var target = selected.Primary.Id;
        var pending = new List<PendingAttachment>();
        foreach (var file in items.OfType<StorageFile>())
        {
            var size = (long)(await file.GetBasicPropertiesAsync()).Size;
            var mime = string.IsNullOrEmpty(file.ContentType) ? "application/octet-stream" : file.ContentType;
            MediaContent.Validate(mime, size);
            if (!WindowOpen || selected?.Primary.Id != target) return;
            pending.Add(new PendingAttachment(file, mime, size));
        }
        attachments.AddRange(pending);
        RenderAttachments();
    }
    private void RenderAttachments()
    {
        AttachmentStrip.Children.Clear();
        foreach (var attachment in attachments)
        {
            var panel = new StackPanel { Width = 120, Spacing = 4 };
            if (MediaContent.Kind(attachment.Mime) == "image")
                panel.Children.Add(new Image { Source = new BitmapImage(new Uri(attachment.File.Path)) { DecodePixelWidth = 240 }, Height = 72, Stretch = Microsoft.UI.Xaml.Media.Stretch.Uniform });
            else panel.Children.Add(new FontIcon { Glyph = MediaContent.Kind(attachment.Mime) == "video" ? "\uE714" : "\uE8A5", FontSize = 32, Height = 72 });
            panel.Children.Add(new TextBlock { Text = attachment.File.Name, TextTrimming = TextTrimming.CharacterEllipsis, FontSize = 12 });
            var remove = ChatMedia.Button(UiStrings.Get("Discard"), async (_, _) =>
            {
                try
                {
                    attachments.Remove(attachment);
                    if (attachments.Count == 0) Caption.Text = "";
                    if (attachment.Temporary) await DeleteTemporaryAsync(attachment.File);
                    RenderAttachments();

                }
                catch (Exception callbackError) { AppLog.Error("UI callback failed in MainWindow.Media", callbackError); ReportCallbackError(callbackError); }
            });
            remove.IsEnabled = !sending;
            panel.Children.Add(remove); AttachmentStrip.Children.Add(panel);
        }
        AttachmentPreview.Visibility = attachments.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        OnComposerChanged(Composer, null!);
    }
    private async void OnComposerPaste(object sender, TextControlPasteEventArgs e)
    {
        try
        {
            var data = Clipboard.GetContent();
            if (!data.Contains(StandardDataFormats.Bitmap)) return;
            e.Handled = true;
            if (!WindowOpen || sending || capture is not null || selected is null) return;
            var target = selected.Primary.Id;
            StorageFile? file = null;
            try
            {
                var reference = await data.GetBitmapAsync();
                using var input = await reference.OpenReadAsync();
                var decoder = await global::Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(input);
                file = await CreateTemporaryFileAsync($"image-{Guid.NewGuid()}.png");
                using (var output = await file.OpenAsync(FileAccessMode.ReadWrite))
                {
                    var encoder = await global::Windows.Graphics.Imaging.BitmapEncoder.CreateAsync(global::Windows.Graphics.Imaging.BitmapEncoder.PngEncoderId, output);
                    using var bitmap = await decoder.GetSoftwareBitmapAsync();
                    encoder.SetSoftwareBitmap(bitmap); await encoder.FlushAsync();
                }
                var size = (long)(await file.GetBasicPropertiesAsync()).Size;
                MediaContent.Validate("image/png", size);
                if (!WindowOpen || selected?.Primary.Id != target || sending || capture is not null || recordingBusy) { await DeleteTemporaryAsync(file); return; }
                attachments.Add(new PendingAttachment(file, "image/png", size, Temporary: true));
                RenderAttachments();
            }
            catch (Exception ex)
            {
                AppLog.Error("MainWindow.Media operation failed", ex);
                if (file is not null) await DeleteTemporaryAsync(file);
                ShowChatError(ex is InvalidOperationException ? ex.Message : UiStrings.Get("MediaUnavailable"));
            }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnComposerPaste failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private void OnChatDragOver(object sender, DragEventArgs e)
    {
        e.AcceptedOperation = WindowOpen && !sending && capture is null && e.DataView.Contains(StandardDataFormats.StorageItems) ? DataPackageOperation.Copy : DataPackageOperation.None;
        e.Handled = true;
    }
    private async void OnChatDrop(object sender, DragEventArgs e)
    {
        try
        {
            var deferral = e.GetDeferral();
            try { if (e.DataView.Contains(StandardDataFormats.StorageItems)) await AddFilesAsync(await e.DataView.GetStorageItemsAsync()); }
            catch (Exception ex) { AppLog.Error("MainWindow.Media operation failed", ex); ShowChatError(ex is InvalidOperationException ? ex.Message : UiStrings.Get("MediaUnavailable")); }
            finally { deferral.Complete(); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnChatDrop failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private async Task SendAttachmentsAsync()
    {
        if (!WindowOpen || sending || selected is null || workspace is null || client is null || attachments.Count == 0) return;
        var target = selected;
        sending = true; Conversations.IsEnabled = SignOutButton.IsEnabled = AttachButton.IsEnabled = false;
        Composer.IsReadOnly = true; Caption.IsReadOnly = true;
        RenderAttachments(); ChatError.IsOpen = false;
        try
        {
            // Remove each successful upload from the queue so retry cannot duplicate earlier files.
            while (WindowOpen && attachments.FirstOrDefault() is { } attachment)
            {
                var size = (long)(await attachment.File.GetBasicPropertiesAsync()).Size;
                MediaContent.Validate(attachment.Mime, size);
                var bytes = await File.ReadAllBytesAsync(attachment.File.Path);
                var row = await client.SendFileAsync(workspace, target.Primary, bytes, attachment.File.Name, attachment.Mime, Caption.Text, attachment.Duration, replyTo);
                ClearReply();
                attachments.RemoveAt(0); Caption.Text = "";
                if (attachment.Temporary) await DeleteTemporaryAsync(attachment.File);
                AcceptSentMedia(row);
                RenderAttachments();
            }
            await MarkReadAsync();
        }
        catch (Exception ex) { AppLog.Error("MainWindow.Media operation failed", ex); ShowChatError(ex is InvalidOperationException ? ex.Message : UiStrings.Get("SendError")); }
        finally
        {
            sending = false; Conversations.IsEnabled = SignOutButton.IsEnabled = AttachButton.IsEnabled = true;
            Composer.IsReadOnly = false; Caption.IsReadOnly = false; RenderAttachments(); UpdateServiceWindow();
        }
    }
    private void AcceptSentMedia(MessageRow row)
    {
        if (NewConversation.IsDraft(selected)) refreshPending = true;
        client!.ApplyMessage(row);
        messages = MessageTimeline.Upsert(messages, row);
        if (loadingChatVersion != 0) chatLoads.Track(row);
        RenderMessages(forceBottom: true); ReplaceConversations(client.ConversationViews());
    }
    private async void OnRecord(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!WindowOpen || sending || capture is not null || recordingBusy || attachments.Count > 0) return;
            recordingBusy = true; Conversations.IsEnabled = SignOutButton.IsEnabled = AttachButton.IsEnabled = false;
            Caption.Text = "";
            try
            {
                var recorder = capture = new MediaCapture();
                await recorder.InitializeAsync(new MediaCaptureInitializationSettings { StreamingCaptureMode = StreamingCaptureMode.Audio });
                recordingFile = await CreateTemporaryFileAsync($"voice-{Guid.NewGuid()}.wav");
                var profile = MediaEncodingProfile.CreateWav(AudioEncodingQuality.Low);
                profile.Audio = AudioEncodingProperties.CreatePcm(16000, 1, 16);
                recorder.Failed += (_, failure) => DispatcherQueue.TryEnqueue(async () =>
                {
                    try
                    {
                        if (capture != recorder) return;
                        AppLog.Error("Microphone capture failed", new InvalidOperationException($"MediaCapture {failure.Code}: {failure.Message}"));
                        await CancelRecordingAsync(); ShowChatError(UiStrings.Get("RecordingError"));

                    }
                    catch (Exception callbackError) { AppLog.Error("UI callback failed in MainWindow.Media", callbackError); ReportCallbackError(callbackError); }
                });
                await recorder.StartRecordToStorageFileAsync(profile, recordingFile);
                if (capture != recorder) return;
                recordingStarted = DateTimeOffset.UtcNow;
                RecordingElapsed.Text = "● 0:00";
                RecordingPanel.Visibility = Visibility.Visible;
                Composer.Visibility = TemplatesButton.Visibility = AttachButton.Visibility = MicButton.Visibility = Visibility.Collapsed;
                recordingTimer = DispatcherQueue.CreateTimer(); recordingTimer.Interval = TimeSpan.FromMilliseconds(250);
                recordingTimer.Tick += async (_, _) =>
                {
                    try
                    {
                        var elapsed = DateTimeOffset.UtcNow - recordingStarted;
                        RecordingElapsed.Text = "● " + ChatMedia.Time(elapsed.TotalSeconds);
                        // Bound temporary PCM and encoding memory, well below WhatsApp's 16 MB limit.
                        if (elapsed.TotalMinutes >= 60) { await CancelRecordingAsync(); ShowChatError(UiStrings.Get("RecordingLimit")); }

                    }
                    catch (Exception callbackError) { AppLog.Error("UI callback failed in MainWindow.Media", callbackError); ReportCallbackError(callbackError); }
                };
                recordingTimer.Start();
            }
            catch (Exception ex)
            {
                AppLog.Error("MainWindow.Media operation failed", ex);
                await CancelRecordingAsync();
                ShowChatError(UiStrings.Get(ex is UnauthorizedAccessException ? "MicrophoneDenied" : "RecordingError"));
                if (ex is UnauthorizedAccessException)
                    ChatError.ActionButton = ChatMedia.Button(UiStrings.Get("MicrophoneSettings"), async (_, _) => await UiCallback.RunAsync(async () => await global::Windows.System.Launcher.LaunchUriAsync(new Uri("ms-settings:privacy-microphone")), "MainWindow.Media callback"));
            }
            finally { recordingBusy = false; OnComposerChanged(Composer, null!); }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnRecord failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private async void OnCancelRecording(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!recordingBusy) await CancelRecordingAsync();
        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnCancelRecording failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private async Task CancelRecordingAsync()
    {
        recordingTimer?.Stop(); recordingTimer = null;
        if (capture is { } recorder)
        {
            capture = null;
            try { await recorder.StopRecordAsync(); } catch (Exception ex) { AppLog.Error("MainWindow.Media operation failed", ex); }
            recorder.Dispose();
        }
        if (recordingFile is { } file) { recordingFile = null; await DeleteTemporaryAsync(file); }
        RestoreComposer();
    }
    private void RestoreComposer()
    {
        RecordingPanel.Visibility = Visibility.Collapsed;
        Composer.Visibility = TemplatesButton.Visibility = AttachButton.Visibility = Visibility.Visible;
        Conversations.IsEnabled = SignOutButton.IsEnabled = AttachButton.IsEnabled = true;
        OnComposerChanged(Composer, null!);
    }
    private async void OnSendRecording(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!WindowOpen || recordingBusy || capture is null || recordingFile is null) return;
            recordingBusy = true; RecordingPanel.IsHitTestVisible = false;
            StorageFile? encoded = null;
            try
            {
                recordingTimer?.Stop();
                var duration = Math.Max(1, Math.Round((DateTimeOffset.UtcNow - recordingStarted).TotalSeconds));
                await capture.StopRecordAsync(); capture.Dispose(); capture = null;
                var wavePath = recordingFile.Path;
                var bytes = await Task.Run(() => { using var stream = File.OpenRead(wavePath); return VoiceEncoder.EncodeWave(stream); });
                encoded = await CreateTemporaryFileAsync($"audio-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.ogg");
                await File.WriteAllBytesAsync(encoded.Path, bytes);
                if (!WindowOpen) { await CancelRecordingAsync(); return; }
                attachments.Add(new PendingAttachment(encoded, MediaContent.OpusMime, bytes.Length, duration, Temporary: true));
                encoded = null;
                await CancelRecordingAsync();
                RenderAttachments();
                await SendAttachmentsAsync();
            }
            catch (Exception ex) { AppLog.Error("MainWindow.Media operation failed", ex); await CancelRecordingAsync(); ShowChatError(UiStrings.Get("RecordingError")); }
            finally
            {
                if (encoded is not null) await DeleteTemporaryAsync(encoded);
                recordingBusy = false; RecordingPanel.IsHitTestVisible = true; OnComposerChanged(Composer, null!);
            }

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnSendRecording failed", callbackError);
            ReportCallbackError(callbackError);
        }
    }
    private static async Task<StorageFile> CreateTemporaryFileAsync(string name)
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zappion", "cache", "recordings");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, name);
        await File.WriteAllBytesAsync(path, []);
        return await StorageFile.GetFileFromPathAsync(path);
    }
    private static async Task DeleteTemporaryAsync(StorageFile file) { try { await file.DeleteAsync(); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    private void ClearAttachments()
    {
        foreach (var attachment in attachments.Where(a => a.Temporary)) _ = DeleteTemporaryAsync(attachment.File);
        attachments.Clear(); Caption.Text = ""; RenderAttachments();
    }
}
