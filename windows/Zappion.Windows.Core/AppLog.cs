// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;

namespace Zappion.Windows.Core;

public sealed class FileLogger
{
    private readonly object gate = new();
    private readonly string directory;
    public FileLogger(string? directory = null) => this.directory = directory ?? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zappion", "logs");

    // Logging must never replace the exception we are trying to diagnose.
    public void Write(string level, string message, Exception? exception = null)
    {
        try
        {
            lock (gate)
            {
                Directory.CreateDirectory(directory);
                var now = DateTimeOffset.Now;
                foreach (var file in Directory.EnumerateFiles(directory, "zappion-*.log"))
                    if (DateOnly.TryParseExact(Path.GetFileNameWithoutExtension(file)[8..], "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out var date) && date < DateOnly.FromDateTime(now.Date).AddDays(-6))
                    {
                        try { File.Delete(file); }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* Keep writing today's log. */ }
                    }
                File.AppendAllText(Path.Combine(directory, $"zappion-{now:yyyy-MM-dd}.log"),
                    $"{now:O} [{level}] {message}{Environment.NewLine}" +
                    (exception is null ? "" : exception + Environment.NewLine));
            }
        }
        catch (Exception) { /* Logging is best effort, including when the disk is full. */ }
    }
}

public static class AppLog
{
    private static readonly FileLogger Logger = new();
    public static void Error(string message, Exception exception) => Logger.Write("ERROR", message, exception);
    public static void Info(string message) => Logger.Write("INFO", message);
}
