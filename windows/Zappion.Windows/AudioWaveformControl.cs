// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Shapes;
using Windows.Storage;
using Windows.Media.MediaProperties;
using Windows.Media.Transcoding;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Mirrors web/components/audio-scrubber.tsx: 3 px rounded bars, 2 px gaps and 36 px height.
internal sealed class AudioWaveformControl : Slider
{
    private static readonly Dictionary<string, double[]> cache = new();
    private static readonly SemaphoreSlim decodeQueue = new(1);
    private double[] peaks = [];
    private double progress;
    private Canvas? drawing;
    private bool updating;
    public bool IsFile { get; init; }
    public event Action<double>? Seek;
    public double Progress { set { updating = true; Value = Math.Clamp(value, 0, 1); updating = false; progress = Value; Draw(); } }
    public AudioWaveformControl()
    {
        Minimum = 0; Maximum = 1; StepFrequency = .05; SmallChange = .05; MinHeight = 0;
        UseSystemFocusVisuals = true;
        Template = (ControlTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load("<ControlTemplate xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" TargetType=\"Slider\"><Canvas x:Name=\"Drawing\" Background=\"Transparent\"/></ControlTemplate>");
        ValueChanged += (_, _) => { progress = Value; Draw(); if (!updating) Seek?.Invoke(Value); };
        IsTabStop = true;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, UiStrings.Get("SeekAudio"));
        SizeChanged += (_, _) => Draw(); ActualThemeChanged += (_, _) => Draw();
        PointerPressed += (_, e) => { CapturePointer(e.Pointer); SetPosition(e); };
        PointerMoved += (_, e) => { if (e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) SetPosition(e); };
        PointerReleased += (_, e) => ReleasePointerCapture(e.Pointer);
    }
    protected override void OnApplyTemplate()
    {
        base.OnApplyTemplate(); drawing = GetTemplateChild("Drawing") as Canvas; Draw();
    }
    private void SetPosition(PointerRoutedEventArgs e) => Value = Math.Clamp(e.GetCurrentPoint(this).Position.X / Math.Max(1, ActualWidth), 0, 1);

    private void Draw()
    {
        if (drawing is null) return;
        drawing.Children.Clear();
        if (IsFile)
        {
            var track = new Rectangle { Width = ActualWidth, Height = 4, RadiusX = 2, RadiusY = 2, Fill = WebBrush.Color(ActualTheme == ElementTheme.Dark ? "#33ffffff" : "#26000000") };
            Canvas.SetTop(track, (ActualHeight - 4) / 2); drawing.Children.Add(track);
            var filled = new Rectangle { Width = ActualWidth * progress, Height = 4, RadiusX = 2, RadiusY = 2, Fill = WebBrush.Get(this, "ChatAccentBrush") };
            Canvas.SetTop(filled, (ActualHeight - 4) / 2); drawing.Children.Add(filled);
        }
        else
        {
            var bars = AudioWaveform.Resample(peaks, Math.Max(1, (int)((ActualWidth + 2) / 5)));
            for (var i = 0; i < bars.Length; i++)
            {
                var height = Math.Clamp(bars[i] * 36, 3, 36);
                var bar = new Rectangle { Width = 3, Height = height, RadiusX = 1.5, RadiusY = 1.5, Fill = WebBrush.Get(this, i / (double)bars.Length < progress ? "ChatAccentBrush" : "SubBrush"), Opacity = i / (double)bars.Length < progress ? 1 : .5 };
                Canvas.SetLeft(bar, i * 5); Canvas.SetTop(bar, (36 - height) / 2); drawing.Children.Add(bar);
            }
        }
        var thumb = new Ellipse { Width = 12, Height = 12, Fill = WebBrush.Get(this, "ChatAccentBrush") };
        Canvas.SetLeft(thumb, Math.Clamp(progress * ActualWidth - 6, 0, Math.Max(0, ActualWidth - 12))); Canvas.SetTop(thumb, (ActualHeight - 12) / 2); drawing.Children.Add(thumb);
    }
    public async Task LoadAsync(string path, CancellationToken token)
    {
        StorageFile? output = null;
        try
        {
            await decodeQueue.WaitAsync(token);
            try
            {
                if (!cache.TryGetValue(path, out var found))
                {
                    if (System.IO.Path.GetExtension(path).Equals(".ogg", StringComparison.OrdinalIgnoreCase))
                    {
                        found = await Task.Run(() => { using var input = File.OpenRead(path); return AudioWaveform.PeaksOpusOgg(input, token); }, token);
                        cache[path] = found;
                        if (!token.IsCancellationRequested) { peaks = found; Draw(); }
                        return;
                    }
                    var source = await StorageFile.GetFileFromPathAsync(path);
                    var folder = await StorageFolder.GetFolderFromPathAsync(System.IO.Path.GetDirectoryName(path)!);
                    output = await folder.CreateFileAsync(Guid.NewGuid() + ".waveform.wav", CreationCollisionOption.FailIfExists);
                    var profile = MediaEncodingProfile.CreateWav(AudioEncodingQuality.Low);
                    profile.Audio = AudioEncodingProperties.CreatePcm(16000, 1, 16);
                    var prepared = await new MediaTranscoder().PrepareFileTranscodeAsync(source, output, profile);
                    if (!prepared.CanTranscode) return;
                    await prepared.TranscodeAsync().AsTask(token);
                    using var stream = File.OpenRead(output.Path);
                    found = AudioWaveform.Peaks16BitWave(stream);
                    cache[path] = found;
                }
                if (!token.IsCancellationRequested) { peaks = found; Draw(); }
            }
            finally { decodeQueue.Release(); }
        }
        catch (Exception ex) { AppLog.Error("AudioWaveformControl operation failed", ex); /* The web also keeps a flat seekable waveform when decoding fails. */ }
        finally { if (output is not null) try { await output.DeleteAsync(); } catch (Exception ex) { AppLog.Error("AudioWaveformControl operation failed", ex); } }
    }
}
