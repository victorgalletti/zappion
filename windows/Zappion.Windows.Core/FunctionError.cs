// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

// Mirrors error extraction in web/lib/supabase.ts.
public sealed class FunctionError(string message, int status, string? reason) : Exception(message)
{
    public int Status { get; } = status;
    public string? Reason { get; } = reason;
    public static FunctionError FromResponse(int status, JObject json)
    {
        var cause = json["cause"] as JObject;
        var error = cause?["error"] as JObject;
        return new((string?)error?["error_user_msg"] ?? (string?)error?["message"] ??
            (string?)json["message"] ?? string.Format(UiStrings.Get("HttpError"), status), status,
            cause?["reason"]?.Type == JTokenType.String ? (string?)cause["reason"] : null);
    }
}
