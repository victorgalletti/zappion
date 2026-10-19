// SPDX-License-Identifier: AGPL-3.0-only
using System.Text.Json;

namespace Zappion.Windows.Core;

public sealed record AppConfiguration(string SupabaseUrl, string SupabaseKey, string WebAppUrl = "http://localhost:3100", string SignupUrl = "http://localhost:8787/conectar")
{
    public static AppConfiguration Load(string directory)
    {
        var path = Path.Combine(directory, "appsettings.local.json");
        if (!File.Exists(path))
            throw new InvalidOperationException("Configuration missing. Copy appsettings.example.json to appsettings.local.json next to the executable and set SupabaseUrl and SupabaseKey, then restart Zappion.");
        var config = JsonSerializer.Deserialize<AppConfiguration>(File.ReadAllText(path));
        if (config is null || !Uri.TryCreate(config.SupabaseUrl, UriKind.Absolute, out var url)
            || (url.Scheme != "http" && url.Scheme != "https") || string.IsNullOrWhiteSpace(config.SupabaseKey)
            || config.SupabaseKey == "YOUR_SUPABASE_ANON_KEY")
            throw new InvalidOperationException("Set a valid SupabaseUrl and SupabaseKey in appsettings.local.json, then restart Zappion.");
        return config;
    }
}
