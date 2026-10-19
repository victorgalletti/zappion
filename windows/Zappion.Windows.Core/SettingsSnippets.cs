// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

// Mirrors snippets in web/components/integrations-settings.tsx.
public static class SettingsSnippets
{
    public static string Mcp(string client, string url, string key = "<API_KEY>") => client switch
    {
        "Claude Code" => $"claude mcp add --transport http zappion {url} --header \"api-key: {key}\"",
        "Claude Desktop" => JObject.FromObject(new { mcpServers = new { zappion = new { command = "npx", args = new[] { "-y", "mcp-remote", url, "--header", "api-key:${ZAPPION_API_KEY}" }, env = new { ZAPPION_API_KEY = key } } } }).ToString(Formatting.Indented),
        "Cursor" => JObject.FromObject(new { mcpServers = new { zappion = new { url, headers = new Dictionary<string, string> { ["api-key"] = key } } } }).ToString(Formatting.Indented),
        "OpenAI API" => JObject.FromObject(new { type = "mcp", server_label = "zappion", server_url = url, headers = new Dictionary<string, string> { ["api-key"] = key }, require_approval = "never" }).ToString(Formatting.Indented),
        _ => throw new ArgumentException(nameof(client))
    };
}
