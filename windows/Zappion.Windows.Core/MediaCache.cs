// SPDX-License-Identifier: AGPL-3.0-only
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Zappion.Windows.Core;

// Signed URL lifetime mirrors useMediaUrl in web/hooks/use-chat.ts.
public sealed class MediaCache
{
    private readonly string directory;
    private readonly long capacity;
    private readonly Func<string, Task<string>> sign;
    private readonly HttpClient http;
    private readonly Func<DateTimeOffset> now;
    private readonly ConcurrentDictionary<string, (string Url, DateTimeOffset Expires)> urls = new();
    private readonly SemaphoreSlim gate = new(1);
    public MediaCache(Func<string, Task<string>> sign, string? directory = null, long capacity = 500L * 1024 * 1024, HttpClient? http = null, Func<DateTimeOffset>? now = null)
    {
        this.sign = sign;
        this.directory = directory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zappion", "cache", "media");
        this.capacity = capacity;
        this.http = http ?? SharedHttp;
        this.now = now ?? (() => DateTimeOffset.UtcNow);
    }
    private static readonly HttpClient SharedHttp = new() { Timeout = TimeSpan.FromMinutes(5) };
    public async Task<string> GetUrlAsync(string path)
    {
        if (urls.TryGetValue(path, out var saved) && saved.Expires > now()) return saved.Url;
        var url = await sign(path);
        urls[path] = (url, now().AddMinutes(50));
        return url;
    }
    public async Task<string> GetFileAsync(string uri, string? name, CancellationToken cancellationToken = default)
    {
        // Like the web, external URIs and Meta IDs wait for the preprocessor.
        var path = MediaContent.StoragePath(uri) ?? throw new InvalidOperationException(UiStrings.Get("MediaUnavailable"));
        var extension = Path.GetExtension(Path.GetFileName(name ?? ""));
        if (extension.Length > 12 || extension.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '.')) extension = "";
        var target = Path.Combine(directory, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path))) + extension);
        await gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(directory);
            if (File.Exists(target)) { File.SetLastWriteTimeUtc(target, DateTime.UtcNow); return target; }
            var temporary = target + ".part";
            try
            {
                using var response = await http.GetAsync(await GetUrlAsync(path), HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                response.EnsureSuccessStatusCode();
                await using (var output = File.Create(temporary))
                await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
                {
                    var buffer = new byte[81920];
                    long total = 0;
                    int read;
                    while ((read = await input.ReadAsync(buffer, cancellationToken)) > 0)
                    {
                        total += read;
                        if (total > capacity) throw new IOException(UiStrings.Get("FileTooLargeCache"));
                        await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    }
                }
                File.Move(temporary, target, true);
                var files = new DirectoryInfo(directory).GetFiles().Where(f => f.Extension != ".part").OrderBy(f => f.LastWriteTimeUtc).ToList();
                var size = files.Sum(f => f.Length);
                foreach (var file in files)
                {
                    if (size <= capacity) break;
                    if (file.FullName == target) continue;
                    try { var length = file.Length; file.Delete(); size -= length; } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
                if (size > capacity)
                {
                    File.Delete(target);
                    throw new IOException(UiStrings.Get("FileTooLargeCache"));
                }
                return target;
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        finally { gate.Release(); }
    }
}
