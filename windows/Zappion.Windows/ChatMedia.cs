// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Newtonsoft.Json.Linq;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.FileProperties;
using Zappion.Windows.Core;

namespace Zappion.Windows;

internal static class ChatMedia
{
    internal static MediaCache? Cache { get; set; }
    internal static Window Owner { get; set; } = null!;
    private static MediaPlayer? playing;
    internal static void Play(MediaPlayer player)
    {
        if (playing != player) playing?.Pause();
        playing = player;
        player.Play();
    }
    internal static void Release(MediaPlayer player)
    {
        if (playing == player) playing = null;
        player.Dispose();
    }
    internal static void InitializePicker(object picker) => WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(Owner));
    internal static async Task SaveAsync(string path, string name)
    {
        var picker = new FileSavePicker { SuggestedFileName = Path.GetFileName(name) };
        var extension = Path.GetExtension(name);
        picker.FileTypeChoices.Add(UiStrings.Get("Document"), new[] { string.IsNullOrEmpty(extension) ? ".bin" : extension });
        InitializePicker(picker);
        if (await picker.PickSaveFileAsync() is { } destination)
            await (await StorageFile.GetFileFromPathAsync(path)).CopyAndReplaceAsync(destination);
    }
    internal static async Task OpenAsync(string path) => await global::Windows.System.Launcher.LaunchFileAsync(await StorageFile.GetFileFromPathAsync(path));
    internal static Button Button(string label, RoutedEventHandler handler)
    {
        var button = new Button { Content = label };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, label);
        button.Click += handler;
        return button;
    }
    internal static string Time(double seconds) => $"{(int)Math.Max(0, seconds) / 60}:{(int)Math.Max(0, seconds) % 60:00}";
}

// Mirrors web/components/message-bubble.tsx and voice-message-player.tsx.
// Loaded/Unloaded follow ListView realization; recycled controls cancel pending downloads.
public sealed class ChatMediaCard : ContentControl
{
    internal Func<MenuFlyout>? MessageMenu { get; set; }
    private readonly JObject content;
    private readonly JObject file;
    private readonly StackPanel panel = new() { Spacing = 4 };
    private readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, FontSize = 13 };
    private CancellationTokenSource? lifetime;
    private MediaPlayer? player;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? timer;
    private string Kind => (string?)content["kind"] ?? "document";
    private string FileName => MediaContent.FileName(file);

    public ChatMediaCard(JObject content)
    {
        this.content = content;
        file = MediaContent.FileOf(content) ?? new JObject();
        Width = Kind == "audio" ? 280 : Kind == "sticker" ? 160 : 330;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        if (Kind is "image" or "video" or "sticker")
        {
            // Reserve the same box through loading, retry and the final thumbnail.
            Height = MediaContent.PreviewHeight(file, Width, Kind == "sticker");
            SizeChanged += (_, _) => Height = MediaContent.PreviewHeight(file, ActualWidth, Kind == "sticker");
        }
        panel.Children.Add(status);
        Content = panel;
        Loaded += async (_, _) => await UiCallback.RunAsync(async () => await LoadAsync(), "ChatMedia callback");
        Unloaded += (_, _) => Stop();
    }
    private void Stop()
    {
        lifetime?.Cancel(); lifetime?.Dispose(); lifetime = null;
        timer?.Stop(); timer = null;
        if (player is not null) { ChatMedia.Release(player); player = null; }
    }
    private async Task LoadAsync()
    {
        Stop();
        var source = lifetime = new CancellationTokenSource();
        var token = source.Token;
        panel.Children.Clear(); panel.Children.Add(status);
        status.Visibility = Visibility.Visible;
        status.Text = UiStrings.Get(Kind == "audio" ? "LoadingAudio" : "LoadingMedia");
        // Documents are downloaded only on click. Other media fetch only on realization.
        if (Kind == "document")
        {
            status.Text = "";
            status.Visibility = Visibility.Collapsed;
            var button = ChatMedia.Button("", async (_, _) => await UiCallback.RunAsync(async () => await ActAsync(false), "ChatMedia callback"));
            var details = new StackPanel { Spacing = 4 };
            var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
            var extension = Path.GetExtension(FileName).TrimStart('.').ToUpperInvariant();
            var color = extension == "PDF" ? "#e53935" : extension is "DOC" or "DOCX" or "TXT" ? "#1e88e5" : extension is "XLS" or "XLSX" or "CSV" ? "#43a047" : "#8696a0";
            heading.Children.Add(new Border { Width = 26, Height = 32, CornerRadius = new CornerRadius(3), Background = WebBrush.Color(color), Child = new TextBlock { Text = extension, FontSize = 7, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } });
            heading.Children.Add(new TextBlock { Text = FileName, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 240, FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
            details.Children.Add(heading);
            details.Children.Add(new TextBlock { Text = MediaContent.FormatSize((long?)file["size"] ?? 0) + " • " + Path.GetExtension(FileName).TrimStart('.').ToLowerInvariant(), FontSize = 12 });
            button.Content = details;
            button.HorizontalAlignment = HorizontalAlignment.Stretch;
            button.HorizontalContentAlignment = HorizontalAlignment.Stretch;
            panel.Children.Insert(0, button);
            AddMenu(button);
            return;
        }
        try
        {
            var cache = ChatMedia.Cache;
            if (cache is null) return;
            var path = await cache.GetFileAsync((string?)file["uri"] ?? "", FileName, token);
            if (token.IsCancellationRequested || lifetime != source) return;
            status.Text = "";
            status.Visibility = Visibility.Collapsed;
            if (Kind == "audio")
            {
                var playable = await Task.Run(() => OpusWave.PlayablePath(path, token), token);
                if (token.IsCancellationRequested || lifetime != source) return;
                AddAudio(path, playable); return;
            }
            var image = new Image { Height = Height, Stretch = Stretch.UniformToFill };
            double? videoDuration = null;
            if (Kind == "video")
            {
                var storage = await StorageFile.GetFileFromPathAsync(path);
                // Mirrors message-bubble.tsx: extract a decoded frame, even without shell thumbnails.
                var clip = await global::Windows.Media.Editing.MediaClip.CreateFromFileAsync(storage);
                videoDuration = clip.OriginalDuration.TotalSeconds;
                var composition = new global::Windows.Media.Editing.MediaComposition();
                composition.Clips.Add(clip);
                using var thumbnail = await composition.GetThumbnailAsync(TimeSpan.Zero, 660, 0, global::Windows.Media.Editing.VideoFramePrecision.NearestFrame);
                var bitmap = new BitmapImage();
                await bitmap.SetSourceAsync(thumbnail);
                if (token.IsCancellationRequested || lifetime != source) return;
                image.Source = bitmap;
            }
            else image.Source = new BitmapImage(new Uri(path)) { DecodePixelWidth = Kind == "sticker" ? 320 : 660 };
            var grid = new Grid { Height = Height };
            grid.SetBinding(HeightProperty, new Microsoft.UI.Xaml.Data.Binding { Source = this, Path = new PropertyPath(nameof(Height)) });
            image.SetBinding(HeightProperty, new Microsoft.UI.Xaml.Data.Binding { Source = this, Path = new PropertyPath(nameof(Height)) });
            grid.Children.Add(image);
            if (Kind == "video") { var icon = new LucideIcon { Kind = "play", Size = 28 }; icon.SetStroke(new SolidColorBrush(Microsoft.UI.Colors.White)); grid.Children.Add(new Border { Width = 56, Height = 56, CornerRadius = new CornerRadius(28), Background = WebBrush.Color("#73000000"), Child = icon, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }); }
            if (Kind == "video") grid.Children.Add(new Border { Background = WebBrush.Color("#66000000"), CornerRadius = new CornerRadius(4), Padding = new Thickness(4, 2, 4, 2), Margin = new Thickness(6), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom, Child = new TextBlock { Text = "\u25a3 " + ChatMedia.Time(videoDuration ?? (double?)file["duration"] ?? 0), FontSize = 11, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White) } });
            var visual = ChatMedia.Button("", (_, _) => ShowViewer(path));
            visual.Content = grid; visual.Padding = new Thickness(0); visual.BorderThickness = new Thickness(0); visual.CornerRadius = new CornerRadius(5);
            visual.HorizontalAlignment = HorizontalAlignment.Stretch;
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(visual, Kind == "video" ? UiStrings.Get("PlayVideo") : FileName);
            panel.Children.Insert(0, visual);
            AddMenu(visual);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { AppLog.Error("ChatMedia operation failed", ex); if (!token.IsCancellationRequested) ShowRetry(); }
    }
    private void ShowRetry()
    {
        status.Visibility = Visibility.Visible;
        status.Text = UiStrings.Get("MediaUnavailable");
        var retry = ChatMedia.Button(UiStrings.Get("Retry"), async (_, _) => await UiCallback.RunAsync(async () => await LoadAsync(), "ChatMedia callback"));
        panel.Children.Add(retry);
    }
    private async Task ActAsync(bool save)
    {
        try
        {
            if (ChatMedia.Cache is null) return;
            var path = await ChatMedia.Cache.GetFileAsync((string?)file["uri"] ?? "", FileName);
            if (save) await ChatMedia.SaveAsync(path, FileName); else await ChatMedia.OpenAsync(path);
        }
        catch (Exception ex) { AppLog.Error("ChatMedia operation failed", ex); status.Visibility = Visibility.Visible; status.Text = UiStrings.Get("MediaUnavailable"); }
    }
    private void AddMenu(FrameworkElement element)
    {
        var menu = MessageMenu?.Invoke() ?? new MenuFlyout();
        var save = new MenuFlyoutItem { Text = UiStrings.Get("SaveAs") };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(save, save.Text);
        save.Click += async (_, _) => await UiCallback.RunAsync(async () => await ActAsync(true), "ChatMedia callback");
        menu.Items.Add(save);
        var open = new MenuFlyoutItem { Text = UiStrings.Get("OpenDefault") };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(open, open.Text);
        open.Click += async (_, _) => await UiCallback.RunAsync(async () => await ActAsync(false), "ChatMedia callback");
        menu.Items.Add(open);
        element.ContextFlyout = menu;
    }
    private void AddAudio(string path, string playable)
    {
        var voice = AudioWaveform.IsVoiceNote((string?)file["mime_type"] ?? "");
        var audio = player = new MediaPlayer { Source = MediaSource.CreateFromUri(new Uri(playable)), AutoPlay = false };
        audio.PlaybackSession.PlaybackRate = MainWindow.CurrentPreferences.AudioRate;
        var grid = new Grid { ColumnSpacing = 8 };
        foreach (var width in new[] { GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto }) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
        var play = ChatMedia.Button("", (_, _) => { if (player != audio) return; if (audio.PlaybackSession.PlaybackState == MediaPlaybackState.Playing) audio.Pause(); else ChatMedia.Play(audio); });
        var playIcon = new LucideIcon { Kind = "play", Size = 16 }; play.Content = playIcon;
        play.Width = play.Height = voice ? 40 : 32; play.Padding = new Thickness(0); play.BorderThickness = new Thickness(0); play.Background = WebBrush.Color(ActualTheme == ElementTheme.Dark ? "#26ffffff" : "#1f000000"); play.CornerRadius = new CornerRadius(20);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(play, UiStrings.Get("PlayAudio"));
        var middle = new StackPanel();
        var seek = new Slider { Minimum = 0, Maximum = Math.Max(1, (double?)file["duration"] ?? 1), MinWidth = 90 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(seek, UiStrings.Get("SeekAudio"));
        var duration = new TextBlock { Text = ChatMedia.Time((double?)file["duration"] ?? 0), FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
        var waveform = new AudioWaveformControl { Width = voice ? 132 : 200, Height = voice ? 36 : 16, IsFile = !voice };
        waveform.Seek += ratio =>
        {
            if (player == audio) audio.PlaybackSession.Position = TimeSpan.FromSeconds(ratio * Math.Max((double?)file["duration"] ?? 0, audio.PlaybackSession.NaturalDuration.TotalSeconds));
        };
        if (voice)
        {
            var voiceRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            voiceRow.Children.Add(waveform); voiceRow.Children.Add(duration); middle.Children.Add(voiceRow);
            _ = waveform.LoadAsync(path, lifetime!.Token);
        }
        else middle.Children.Add(waveform);
        if (!voice) middle.Children.Add(duration);
        var speed = ChatMedia.Button("1×", (_, _) => { if (player != audio) return; audio.PlaybackSession.PlaybackRate = audio.PlaybackSession.PlaybackRate < 1.25 ? 1.5 : audio.PlaybackSession.PlaybackRate < 1.75 ? 2 : 1; if (ChatMedia.Owner is MainWindow owner) owner.SaveAudioRate(audio.PlaybackSession.PlaybackRate); });
        speed.FontSize = 11; speed.Padding = new Thickness(10, 4, 10, 4); speed.MinWidth = 0; speed.MinHeight = 0; speed.CornerRadius = new CornerRadius(14);
        speed.Background = play.Background;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(speed, UiStrings.Get("PlaybackSpeed"));
        Grid.SetColumn(middle, 1); Grid.SetColumn(speed, 2);
        grid.Children.Add(play); grid.Children.Add(middle);
        if (voice) grid.Children.Add(speed);
        else
        {
            var musicIcon = new LucideIcon { Kind = "music", Size = 16 }; musicIcon.SetStroke(new SolidColorBrush(Microsoft.UI.Colors.White));
            var note = new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(16), Background = WebBrush.Color("#f59e0b"), Child = musicIcon };
            Grid.SetColumn(note, 2); grid.Children.Add(note);
        }
        panel.Children.Insert(0, grid); AddMenu(grid);
        var updating = false;
        seek.ValueChanged += (_, _) => { if (!updating && player == audio) audio.PlaybackSession.Position = TimeSpan.FromSeconds(seek.Value); };
        timer = DispatcherQueue.CreateTimer(); timer.Interval = TimeSpan.FromMilliseconds(250);
        timer.Tick += (_, _) =>
        {
            // A stopped dispatcher timer can already have a queued tick after Unloaded disposed audio.
            if (player != audio || lifetime?.IsCancellationRequested != false) return;
            updating = true;
            var session = audio.PlaybackSession;
            var playing = session.PlaybackState == MediaPlaybackState.Playing;
            playIcon.Kind = playing ? "pause" : "play";
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(play, UiStrings.Get(playing ? "PauseAudio" : "PlayAudio"));
            seek.Maximum = Math.Max(1, session.NaturalDuration.TotalSeconds > 0 ? session.NaturalDuration.TotalSeconds : (double?)file["duration"] ?? 0);
            seek.Value = Math.Min(seek.Maximum, session.Position.TotalSeconds);
            waveform.Progress = session.Position.TotalSeconds / seek.Maximum;
            duration.Text = ChatMedia.Time(playing || session.Position > TimeSpan.Zero ? session.Position.TotalSeconds : session.NaturalDuration.TotalSeconds > 0 ? session.NaturalDuration.TotalSeconds : (double?)file["duration"] ?? 0);
            speed.Content = session.PlaybackRate.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + "×";
            updating = false;
        };
        audio.MediaFailed += (_, failure) => DispatcherQueue.TryEnqueue(() =>
        {
            if (player != audio) return;
            AppLog.Error("Audio playback failed", failure.ExtendedErrorCode ?? new InvalidOperationException(failure.ErrorMessage));
            status.Visibility = Visibility.Visible; status.Text = UiStrings.Get("AudioError");
        });
        timer.Start();
    }
    private void ShowViewer(string path)
    {
        var viewer = new Window { Title = FileName };
        var root = new Grid { Background = WebBrush.Get(this, "SurfaceBrush"), RequestedTheme = ActualTheme };
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); root.RowDefinitions.Add(new RowDefinition());
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(12) };
        var error = new TextBlock { TextWrapping = TextWrapping.Wrap };
        toolbar.Children.Add(ChatMedia.Button(UiStrings.Get("SaveAs"), async (_, _) =>
        {
            try
            {
                try { await ChatMedia.SaveAsync(path, FileName); } catch (Exception ex) { AppLog.Error("ChatMedia operation failed", ex); error.Text = UiStrings.Get("MediaUnavailable"); }
            }
            catch (Exception callbackError) { AppLog.Error("UI callback failed in ChatMedia", callbackError); }
        }));
        toolbar.Children.Add(ChatMedia.Button(UiStrings.Get("OpenDefault"), async (_, _) =>
        {
            try
            {
                try { await ChatMedia.OpenAsync(path); } catch (Exception ex) { AppLog.Error("ChatMedia operation failed", ex); error.Text = UiStrings.Get("MediaUnavailable"); }
            }
            catch (Exception callbackError) { AppLog.Error("UI callback failed in ChatMedia", callbackError); }
        }));
        toolbar.Children.Add(error); root.Children.Add(toolbar);
        if (Kind == "video")
        {
            var video = new MediaPlayer { Source = MediaSource.CreateFromUri(new Uri(path)), AutoPlay = false };
            var element = new MediaPlayerElement { AreTransportControlsEnabled = true };
            element.SetMediaPlayer(video); Grid.SetRow(element, 1); root.Children.Add(element);
            video.MediaFailed += (_, failure) => DispatcherQueue.TryEnqueue(() =>
            {
                AppLog.Error("Video playback failed", failure.ExtendedErrorCode ?? new InvalidOperationException(failure.ErrorMessage));
                error.Text = UiStrings.Get("MediaUnavailable");
            });
            viewer.Closed += (_, _) => ChatMedia.Release(video);
            ChatMedia.Play(video);
        }
        else
        {
            var scroll = new ScrollViewer { ZoomMode = ZoomMode.Enabled, MinZoomFactor = .25f, MaxZoomFactor = 8, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = new Image { Source = new BitmapImage(new Uri(path)), Stretch = Stretch.Uniform } };
            toolbar.Children.Add(ChatMedia.Button("−", (_, _) => scroll.ChangeView(null, null, Math.Max(.25f, scroll.ZoomFactor / 1.25f))));
            toolbar.Children.Add(ChatMedia.Button("+", (_, _) => scroll.ChangeView(null, null, Math.Min(8, scroll.ZoomFactor * 1.25f))));
            Grid.SetRow(scroll, 1); root.Children.Add(scroll);
        }
        viewer.Content = root; viewer.AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1000, 760)); viewer.Activate();
    }
}
