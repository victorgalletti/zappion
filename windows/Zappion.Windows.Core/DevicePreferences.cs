// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Text.Json;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

// Mirrors web/lib/preferences.ts and web/lib/signature.ts; theme and instance are device settings too.
public sealed record DevicePreferences
{
    private static readonly string SystemLanguage = CultureInfo.CurrentUICulture.Name.StartsWith("pt", StringComparison.OrdinalIgnoreCase) ? "pt-BR" : "en";
    public string Language { get; init; } = SystemLanguage;
    public string Theme { get; init; } = "system";
    public string FontSize { get; init; } = "default";
    public string ChatBackground { get; init; } = "default";
    public bool ChatWallpaper { get; init; } = true;
    public bool EnterToSend { get; init; } = true;
    public bool SignatureEnabled { get; init; }
    public string SignatureName { get; init; } = "";
    public bool NotificationSound { get; init; } = true;
    public bool DesktopNotifications { get; init; }
    // Windows only: flash the taskbar button on incoming messages (the badge shows either way).
    public bool FlashTaskbar { get; init; } = true;
    public double AudioRate { get; init; } = 1;
    public string Instance { get; init; } = "";
    [System.Text.Json.Serialization.JsonIgnore]
    public double MessageFontSize => FontSize == "small" ? 14.25 : FontSize == "large" ? 17.1 : 15.2;
    public DevicePreferences Validated() => this with {
        Language = Language is "en" or "pt-BR" ? Language : new DevicePreferences().Language,
        Theme = Theme is "light" or "dark" or "system" ? Theme : "system",
        FontSize = FontSize is "small" or "default" or "large" ? FontSize : "default",
        ChatBackground = Backgrounds.Contains(ChatBackground) ? ChatBackground : "default",
        SignatureName = SignatureName is { Length: <= 40 } ? SignatureName : "",
        Instance = Instance ?? "", AudioRate = AudioRate is 1 or 1.5 or 2 ? AudioRate : 1 };
    public static readonly string[] Backgrounds = ["default", "green", "blue", "lavender", "rose", "sand", "slate"];
    public string BackgroundColor(bool dark) => (dark
        ? new[] { "#141414", "#111d16", "#111a24", "#1b1625", "#24151a", "#211b12", "#151b1f" }
        : new[] { "#e4dcd4", "#dce8d5", "#d8e4ed", "#e4dcef", "#efdce0", "#eee2cd", "#dce1e5" })[Math.Max(0, Array.IndexOf(Backgrounds, ChatBackground))];
    public JObject Sign(JObject content, string agentName)
    {
        var type = (string?)content["type"]; var kind = (string?)content["kind"];
        if (!SignatureEnabled || content["text"]?.Type != JTokenType.String || (string?)content["text"] is not { Length: > 0 } text ||
            !(type == "text" && kind == "text" || type == "file" && kind is "image" or "video" or "document")) return content;
        var prefix = "**" + (string.IsNullOrWhiteSpace(SignatureName) ? agentName.Trim() : SignatureName.Trim()) + ":**\n";
        if (text.StartsWith(prefix, StringComparison.Ordinal)) return content;
        var copy = (JObject)content.DeepClone(); copy["text"] = prefix + text; return copy;
    }
}

public sealed class PreferencesStore
{
    private readonly string path;
    public PreferencesStore(string? path = null) => this.path = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zappion", "preferences.json");
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    public DevicePreferences Load()
    {
        try {
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            if (document.RootElement.ValueKind != JsonValueKind.Object) return new();
            var valid = new Dictionary<string, JsonElement>();
            foreach (var property in document.RootElement.EnumerateObject()) {
                var type = typeof(DevicePreferences).GetProperties().FirstOrDefault(p => p.Name.Equals(property.Name, StringComparison.OrdinalIgnoreCase))?.PropertyType;
                if (type == typeof(string) && property.Value.ValueKind == JsonValueKind.String || type == typeof(bool) && property.Value.ValueKind is JsonValueKind.True or JsonValueKind.False || type == typeof(double) && property.Value.ValueKind == JsonValueKind.Number)
                    valid[property.Name] = property.Value.Clone();
            }
            return (JsonSerializer.Deserialize<DevicePreferences>(JsonSerializer.Serialize(valid), JsonOptions) ?? new()).Validated();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { return new(); }
    }
    public void Save(DevicePreferences preferences)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(preferences.Validated(), JsonOptions));
        File.Move(path + ".tmp", path, true);
    }
}
