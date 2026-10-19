// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

// Mirrors web/lib/manual-connect.ts, web/lib/instances.ts and settings-panel.tsx.
public sealed record ManualConnectFields(string Label = "", string PhoneNumberId = "", string WabaId = "",
    string AccessToken = "", bool Register = false, string Pin = "", string CallbackUrl = "", string VerifyToken = "");

public static class SettingsRules
{
    public static string Text(string section, string key) => UiStrings.Get($"Settings_{section}_{key}");
    public static bool CanEdit(string role) => role is "owner" or "admin";
    public static bool CanManageMembers(string role) => role == "owner";
    public static bool CanChangeMember(string role, string memberRole, int ownerCount) => CanManageMembers(role) && (memberRole != "owner" || ownerCount > 1);
    public static string? LogoExtension(string type, long length) => length <= 2 * 1024 * 1024 && length >= 0 ? type switch { "image/png" => "png", "image/jpeg" => "jpg", "image/webp" => "webp", _ => null } : null;
    public static string? ValidateManualConnect(ManualConnectFields f, bool hasSystemToken = false)
    {
        string Error(string key) => Text("manualConnect", key);
        if (!Regex.IsMatch(f.PhoneNumberId.Trim(), @"^[0-9]+$")) return Error("enterAValidPhoneNumberIdUsingOnly");
        if (!Regex.IsMatch(f.WabaId.Trim(), @"^[0-9]+$")) return Error("enterAValidWabaIdUsingOnlyDigits");
        if (!hasSystemToken && string.IsNullOrWhiteSpace(f.AccessToken)) return Error("enterThePermanentAccessToken");
        if (f.Register && !Regex.IsMatch(f.Pin, @"^[0-9]{6}$")) return Error("enterThe6DigitTwoStepVerificationPin");
        if (f.Label.Trim().Length > 100) return Error("theInstanceNameMustBe100CharactersOr");
        if (f.CallbackUrl.Trim().Length > 0 && (!Uri.TryCreate(f.CallbackUrl.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.UserInfo.Length > 0)) return Error("enterAValidHttpsCallbackUrlWithoutCredentials");
        return null;
    }
    public static JObject ManualPayload(string organizationId, ManualConnectFields f)
    {
        var payload = new JObject { ["organization_id"] = organizationId, ["phone_number_id"] = f.PhoneNumberId.Trim(), ["waba_id"] = f.WabaId.Trim(), ["register"] = f.Register };
        foreach (var (key, value) in new[] { ("access_token", f.AccessToken.Trim()), ("label", f.Label.Trim()), ("callback_url", f.CallbackUrl.Trim()), ("verify_token", f.VerifyToken.Trim()) }) if (value.Length > 0) payload[key] = value;
        if (f.Register) payload["pin"] = f.Pin;
        return payload;
    }
    public static string ManualError(string message, params string[] secrets)
    {
        foreach (var secret in secrets.Where(s => s.Length > 0).OrderByDescending(s => s.Length)) message = message.Replace(secret, Text("manualConnect", "hidden"), StringComparison.Ordinal);
        var patterns = new[] {
            (@"access.?token|oauth|session.*expired|HTTP 401", "invalidOrExpiredTokenCheckThePermanentSystem"),
            (@"pin|two.step|verification.*code|133005", "incorrectPinCheckTheNumberS6Digit"),
            (@"does not belong|not.*belong|n\u00e3o pertence|outside.*waba|fora.*waba", "theNumberDoesNotBelongToTheSpecified"),
            (@"forbidden|permission|admin|owner|HTTP 403", "youMustBeAnAdministratorOrOwnerAnd"),
            (@"fetch|network|HTTP 5\d\d", "couldNotConnectRightNowCheckYourConnection") };
        foreach (var (pattern, key) in patterns) if (Regex.IsMatch(message, pattern, RegexOptions.IgnoreCase)) return Text("manualConnect", key);
        return message.Length == 0 ? Text("manualConnect", "connectionFailed") : string.Format(Text("manualConnect", "couldNotConnectTheNumber"), message);
    }
    public static string ActionError(string message)
    {
        var key = Regex.IsMatch(message, @"last.*owner|\u00faltimo.*(owner|propriet)|at least one owner", RegexOptions.IgnoreCase) ? "theOrganizationMustHaveAtLeastOneOwner"
            : Regex.IsMatch(message, "duplicate|unique", RegexOptions.IgnoreCase) ? "aRecordWithTheseDetailsAlreadyExistsCheck"
            : Regex.IsMatch(message, "policy|permission|forbidden", RegexOptions.IgnoreCase) ? "youDoNotHavePermissionForThisAction"
            : message.Contains("no pending invitation", StringComparison.OrdinalIgnoreCase) ? "thisInvitationIsNoLongerPendingOrBelongs" : "couldNotCompleteTheActionRefreshThePage";
        return Text("useSettings", key);
    }
    public static string InstanceName(OrganizationAddressRow n) => (string?)n.Extra?["label"] is { Length: > 0 } label ? label : (string?)n.Extra?["verified_name"] is { Length: > 0 } name ? name : MessageHelpers.FormatPhone((string?)n.Extra?["phone_number"] ?? n.Address);
    public static string InstancesCount(int total, int connected) =>
        $"{total} {Text("settingsPanel", total == 1 ? "instanceOne" : "instanceMany")} \u00b7 {connected} {Text("settingsPanel", connected == 1 ? "connectedOne" : "connectedMany")}";
    public static bool MatchesInstance(OrganizationAddressRow n, string search, string status)
    {
        static string Normalize(string value) => new(value.Normalize(NormalizationForm.FormD).Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).Select(char.ToLowerInvariant).ToArray());
        var term = Normalize(search.Trim());
        var digits = Regex.IsMatch(term, @"^[+\d\s().-]+$") ? Regex.Replace(term, @"\D", "") : "";
        var values = new[] { InstanceName(n), (string?)n.Extra?["label"], (string?)n.Extra?["verified_name"], (string?)n.Extra?["phone_number"], MessageHelpers.FormatPhone((string?)n.Extra?["phone_number"] ?? n.Address), (string?)n.Extra?["waba_id"], n.Address };
        return (status == "all" || status == n.Status) && values.Any(v => v != null && (Normalize(v).Contains(term) || digits.Length > 0 && Regex.Replace(v, @"\D", "").Contains(digits)));
    }
    public static bool TryParseDate(JToken? token, out DateTimeOffset date)
    {
        switch (token)
        {
            case JValue { Value: DateTimeOffset dto }:
                date = dto;
                return true;
            case JValue { Value: DateTime dt }:
                date = dt.Kind == DateTimeKind.Unspecified ? new DateTimeOffset(dt, TimeSpan.Zero) : new DateTimeOffset(dt);
                return true;
            case { Type: JTokenType.Date }:
                date = token.ToObject<DateTimeOffset>();
                return true;
            case { Type: JTokenType.String }:
                return DateTimeOffset.TryParse((string?)token, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out date)
                    || DateTimeOffset.TryParse((string?)token, CultureInfo.CurrentCulture, DateTimeStyles.AssumeLocal, out date);
            default:
                date = default;
                return false;
        }
    }
    public static string FormatDate(JToken? token, CultureInfo? culture = null, string? emptyText = null)
    {
        if (!TryParseDate(token, out var parsed)) return emptyText ?? Text("integrations", "never");
        var local = parsed.ToLocalTime();
        var c = culture ?? CultureInfo.CurrentUICulture;
        if (c.Name.StartsWith("pt", StringComparison.OrdinalIgnoreCase))
        {
            var pt = CultureInfo.GetCultureInfo("pt-BR");
            var month = local.ToString("MMM", pt).TrimEnd('.').ToLower(pt);
            return $"{local.Day} de {month}., {local.ToString("HH:mm", CultureInfo.InvariantCulture)}";
        }
        var en = CultureInfo.GetCultureInfo("en-US");
        return local.ToString("MMM d, HH:mm", en);
    }
    public static string KeyState(JObject key, DateTimeOffset now)
    {
        if (key["revoked_at"] is { Type: not JTokenType.Null }) return "revoked";
        var expires = TryParseDate(key["expires_at"], out var parsed) ? parsed : DateTimeOffset.MaxValue;
        return expires <= now ? "expired" : "active";
    }
    public static bool ValidKey(string name, string scope, int messages, int templates, string[]? addresses, IEnumerable<string> connected) => name.Trim().Length > 0 && scope is "read" or "send" or "admin" && messages >= 1 && templates >= 0 && (addresses == null || addresses.Length > 0 && addresses.All(connected.Contains));
}

