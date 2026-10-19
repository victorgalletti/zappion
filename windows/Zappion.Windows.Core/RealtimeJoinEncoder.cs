// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
namespace Zappion.Windows.Core;

// Mirrors realtime-js phx_join: the initial RLS evaluation must already have the user's JWT.
internal static class RealtimeJoinEncoder
{
    public static string Authorize(string json, string? token)
    {
        var envelope = JObject.Parse(json);
        if ((string?)envelope["event"] != "phx_join" || string.IsNullOrEmpty(token)) return json;
        if (envelope["payload"] is JObject payload) payload["access_token"] = token;
        return envelope.ToString(Formatting.None);
    }
}
