// SPDX-License-Identifier: AGPL-3.0-only
using System.Text;
using System.Text.Json;

namespace Zappion.Windows.Core;

// Mirrors useLastRead/markConversationRead in web/hooks/use-chat.ts.
public sealed class LastReadStore
{
    private readonly string path;
    private readonly object gate = new();
    private readonly Dictionary<string, string> marks;

    public LastReadStore(string? path = null)
    {
        this.path = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Zappion", "last-read.json");
        try { marks = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(this.path)) ?? new(); }
        catch (Exception ex) when (ex is IOException or JsonException) { marks = new(); }
    }

    public IReadOnlyDictionary<string, string> Snapshot()
    {
        lock (gate) return new Dictionary<string, string>(marks);
    }

    public bool Mark(string conversationId, string timestamp)
    {
        if (!DateTimeOffset.TryParse(timestamp, out _)) return false;
        lock (gate)
        {
            if (marks.TryGetValue(conversationId, out var current) && string.CompareOrdinal(current, timestamp) >= 0) return false;
            var next = new Dictionary<string, string>(marks) { [conversationId] = timestamp };
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(next), new UTF8Encoding(false));
            File.Move(temporary, path, true);
            marks[conversationId] = timestamp;
            return true;
        }
    }
}
