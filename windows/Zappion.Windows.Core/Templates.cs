// SPDX-License-Identifier: AGPL-3.0-only
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

public sealed record TemplateField(string Key, string Label, bool Required = true, int? MaxLength = null);

// Mirrors web/lib/templates/catalog.ts and send.ts; component scopes prevent variable collisions.
public static partial class Templates
{
    public static string Type(JToken c) => ((string?)c["type"] ?? "").ToUpperInvariant();
    public static string[] Variables(string text) => Regex.Matches(text, @"\{\{([^{}]+)\}\}")
        .Select(m => m.Groups[1].Value).Distinct().ToArray();
    public static string Fill(string text, IReadOnlyDictionary<string, string> values, string prefix) =>
        Regex.Replace(text, @"\{\{([^{}]+)\}\}", m => values.GetValueOrDefault(prefix + m.Groups[1].Value) is { Length: > 0 } value ? value : m.Value);
    // JavaScript encodeURIComponent leaves these five characters unescaped.
    public static string EncodeComponent(string value) => Uri.EscapeDataString(value)
        .Replace("%21", "!", StringComparison.Ordinal).Replace("%27", "'", StringComparison.Ordinal)
        .Replace("%28", "(", StringComparison.Ordinal).Replace("%29", ")", StringComparison.Ordinal).Replace("%2A", "*", StringComparison.Ordinal);
    public static IEnumerable<(JArray Components, string Scope)> Scopes(JObject template)
    {
        var components = template["components"] as JArray ?? new JArray();
        yield return (components, "root");
        var cards = components.FirstOrDefault(c => Type(c) == "CAROUSEL")?["cards"] as JArray;
        if (cards is not null)
            for (var i = 0; i < cards.Count; i++) yield return ((JArray?)cards[i]["components"] ?? new JArray(), $"card.{i}");
    }
    // Mirrors duplicateTemplate's parameterFormat in web/lib/templates/catalog.ts.
    public static bool UsesNamedFormat(JObject template) =>
        ((string?)template["parameter_format"])?.ToLowerInvariant() is { } format
            ? format == "named"
            : (template["components"] as JArray ?? new JArray()).Any(c => Variables((string?)c["text"] ?? "").Any(v => !v.All(char.IsAsciiDigit)));

    // Mirrors exampleSendValues in web/lib/templates/send.ts: the examples Meta stored, keyed like Fields.
    public static IReadOnlyDictionary<string, string> ExampleFieldValues(JObject template)
    {
        var values = new Dictionary<string, string>();
        foreach (var (components, scope) in Scopes(template))
        foreach (var c in components)
        {
            var type = Type(c).ToLowerInvariant();
            var names = Variables((string?)c["text"] ?? "");
            var format = ((string?)c["format"])?.ToUpperInvariant();
            if (type == "header" && format is "IMAGE" or "VIDEO" or "DOCUMENT")
                values[$"{scope}.media"] = (string?)c["example"]?["header_handle"]?.FirstOrDefault() ?? "";
            var named = c["example"]?[type == "header" ? "header_text_named_params" : "body_text_named_params"] as JArray;
            var positional = type == "header" ? c["example"]?["header_text"] as JArray : c["example"]?["body_text"]?.FirstOrDefault() as JArray;
            for (var i = 0; i < names.Length; i++)
            {
                var n = names[i];
                values[$"{scope}.{type}.{n}"] = (string?)named?.FirstOrDefault(x => (string?)x["param_name"] == n)?["example"]
                    ?? (positional is not null && i < positional.Count ? (string?)positional[i] : null) ?? "";
            }
            if (c["buttons"] is JArray buttons)
                for (var i = 0; i < buttons.Count; i++)
                    values[$"{scope}.button.{i}"] = buttons[i]["example"] switch
                    {
                        JValue v when v.Type == JTokenType.String => (string?)v ?? "",
                        JArray a => (string?)a.FirstOrDefault() ?? "",
                        _ => ""
                    };
        }
        values["otp"] = "123456";
        return values;
    }

    public static IReadOnlyList<TemplateField> Fields(JObject template)
    {
        if (((string?)template["category"])?.ToUpperInvariant() == "AUTHENTICATION") return [new("otp", UiStrings.Get("VerificationCode"), true, 15)];
        var fields = new List<TemplateField>();
        foreach (var (components, scope) in Scopes(template))
        foreach (var c in components)
        {
            var type = Type(c);
            if (type == "BODY" || type == "HEADER" && ((string?)c["format"])?.ToUpperInvariant() == "TEXT")
                fields.AddRange(Variables((string?)c["text"] ?? "").Select(v => new TemplateField($"{scope}.{type.ToLowerInvariant()}.{v}", string.Format(UiStrings.Get("TemplateVariable"), UiStrings.Get(type == "HEADER" ? "TemplateHeader" : "TemplateBody"), v))));
            if (type == "HEADER")
            {
                var format = ((string?)c["format"])?.ToUpperInvariant();
                if (format is "IMAGE" or "VIDEO" or "DOCUMENT") fields.Add(new($"{scope}.media", format));
                if (format == "LOCATION") foreach (var key in new[] { "latitude", "longitude", "locationName", "address" }) fields.Add(new($"{scope}.{key}", UiStrings.Get("Template_" + key)));
                if (format == "PRODUCT") foreach (var key in new[] { "catalogId", "productId" }) fields.Add(new($"{scope}.{key}", UiStrings.Get("Template_" + key)));
            }
            if (type == "LIMITED_TIME_OFFER" && (bool?)c["limited_time_offer"]?["has_expiration"] == true) fields.Add(new("expiration", UiStrings.Get("OfferExpiration")));
            if (type != "BUTTONS" || c["buttons"] is not JArray buttons) continue;
            for (var i = 0; i < buttons.Count; i++)
            {
                var b = buttons[i]; var p = $"{scope}.button.{i}"; var bt = Type(b);
                var label = (string?)b["text"] ?? bt;
                if (bt == "URL" && Variables((string?)b["url"] ?? "").Length > 0) fields.Add(new(p, label));
                if (bt == "COPY_CODE") fields.Add(new(p, label, true, components.Any(x => Type(x) == "LIMITED_TIME_OFFER") ? 15 : 20));
                if (bt == "QUICK_REPLY") fields.Add(new(p, label, false, 128));
                if (bt == "FLOW") { fields.Add(new(p + ".token", label + " · token", false)); fields.Add(new(p + ".data", label + " · JSON", false)); }
                if (bt is "CATALOG" or "MPM") fields.Add(new(p + ".thumbnail", label + " · SKU", bt == "MPM"));
                if (bt == "MPM") fields.Add(new(p + ".sections", UiStrings.Get("ProductSections")));
                if (bt == "VOICE_CALL") { fields.Add(new(p + ".ttl", label + " · TTL", false)); fields.Add(new(p + ".payload", label + " · ID", false, 512)); }
            }
        }
        return fields;
    }
    public static IReadOnlyList<string> Validate(JObject template, IReadOnlyDictionary<string, string> values, DateTimeOffset? now = null)
    {
        var errors = new List<string>();
        void Fail(string label) => errors.Add(string.Format(UiStrings.Get("InvalidTemplateField"), label));
        if ((string?)template["status"] != "APPROVED") Fail(UiStrings.Get("Templates"));
        foreach (var (components, _) in Scopes(template))
        foreach (var c in components)
        {
            if (!new[] { "HEADER", "BODY", "FOOTER", "BUTTONS", "CAROUSEL", "LIMITED_TIME_OFFER", "CALL_PERMISSION_REQUEST" }.Contains(Type(c))) Fail(Type(c));
            if (c["format"] is { } format && !new[] { "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION", "PRODUCT" }.Contains(format.ToString().ToUpperInvariant())) Fail(format.ToString());
            if (c["buttons"] is JArray buttons && buttons.Any(b => !new[] { "QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE", "OTP", "FLOW", "CATALOG", "MPM", "SPM", "VOICE_CALL" }.Contains(Type(b)))) Fail("BUTTONS");
        }
        foreach (var f in Fields(template))
        {
            var value = values.GetValueOrDefault(f.Key, "");
            if (f.Required && string.IsNullOrWhiteSpace(value) || f.MaxLength is { } max && value.EnumerateRunes().Count() > max) Fail(f.Label);
            if (value.Length == 0) continue;
            if (f.Key.EndsWith(".media", StringComparison.Ordinal) && !Regex.IsMatch(value, @"^\d+$") && !value.StartsWith("internal://media/", StringComparison.Ordinal) &&
                !(Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && uri.UserInfo.Length == 0)) Fail(f.Label);
            if (f.Key.EndsWith(".latitude", StringComparison.Ordinal) || f.Key.EndsWith(".longitude", StringComparison.Ordinal))
                if (!double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var coordinate) || !double.IsFinite(coordinate) || Math.Abs(coordinate) > (f.Key.EndsWith("latitude", StringComparison.Ordinal) ? 90 : 180)) Fail(f.Label);
            if (f.Key.EndsWith(".catalogId", StringComparison.Ordinal) && !Regex.IsMatch(value, @"^\d+$")) Fail(f.Label);
            if (f.Key.EndsWith(".ttl", StringComparison.Ordinal) && (!int.TryParse(value, out var ttl) || ttl < 1 || ttl > 43200)) Fail(f.Label);
            if (f.Key.EndsWith(".data", StringComparison.Ordinal)) try { JObject.Parse(value); } catch { Fail(f.Label); }
            if (f.Key.EndsWith(".sections", StringComparison.Ordinal)) try { Sections(value); } catch { Fail(f.Label); }
        }
        if (values.TryGetValue("expiration", out var expiration) && (!DateTimeOffset.TryParse(expiration, out var at) || at <= (now ?? DateTimeOffset.UtcNow))) Fail(UiStrings.Get("OfferExpiration"));
        if (values.TryGetValue("otp", out var otp) && Regex.IsMatch(otp, @"[\s{}*_~`]|\p{So}")) Fail(UiStrings.Get("VerificationCode"));
        foreach (var (components, scope) in Scopes(template))
        foreach (var c in components.Where(c => Type(c) is "BODY" or "HEADER"))
            if (Fill((string?)c["text"] ?? "", values, $"{scope}.{Type(c).ToLowerInvariant()}.").EnumerateRunes().Count() > (Type(c) == "HEADER" ? 60 : scope != "root" ? 160 : components.Any(x => Type(x) == "LIMITED_TIME_OFFER") ? 600 : 1024)) Fail(Type(c));
        return errors;
    }
    private static JArray Sections(string value)
    {
        var sections = new JArray();
        foreach (var line in value.Split('\n').Where(x => !string.IsNullOrWhiteSpace(x)))
        {
            var parts = line.Split('|');
            if (parts.Length != 2 || parts[0].Trim().Length is < 1 or > 24) throw new FormatException();
            sections.Add(new JObject { ["title"] = parts[0].Trim(), ["product_items"] = new JArray(parts[1].Split(',').Select(x => x.Trim()).Where(x => x.Length > 0).Select(x => new JObject { ["product_retailer_id"] = x })) });
        }
        if (sections.Count is < 1 or > 10 || sections.Sum(s => ((JArray)s["product_items"]!).Count) is < 1 or > 30) throw new FormatException();
        return sections;
    }
    public static JObject Build(JObject template, IReadOnlyDictionary<string, string> values)
    {
        var errors = Validate(template, values);
        if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors));
        string V(string key) => values.GetValueOrDefault(key, "");
        JObject Parameter(string name, string text) { var p = new JObject { ["type"] = "text", ["text"] = text }; if (!Regex.IsMatch(name, @"^\d+$")) p["parameter_name"] = name; return p; }
        JArray Compose(JArray components, string scope)
        {
            var result = new JArray();
            foreach (var c in components)
            {
                var type = Type(c); var lower = type.ToLowerInvariant();
                if (type == "BODY" || type == "HEADER" && ((string?)c["format"])?.ToUpperInvariant() == "TEXT")
                {
                    var names = Variables((string?)c["text"] ?? "");
                    if (names.Length > 0) result.Add(new JObject { ["type"] = lower, ["parameters"] = new JArray(names.Select(n => Parameter(n, V($"{scope}.{lower}.{n}")))) });
                }
                var format = ((string?)c["format"])?.ToLowerInvariant();
                if (type == "HEADER" && format is "image" or "video" or "document")
                {
                    var media = V(scope + ".media");
                    result.Add(new JObject { ["type"] = "header", ["parameters"] = new JArray(new JObject { ["type"] = format, [format] = new JObject { [Regex.IsMatch(media, @"^\d+$") ? "id" : "link"] = media } }) });
                }
                if (type == "HEADER" && format is "location" or "product")
                {
                    var data = format == "location" ? new JObject { ["latitude"] = V(scope + ".latitude"), ["longitude"] = V(scope + ".longitude"), ["name"] = V(scope + ".locationName"), ["address"] = V(scope + ".address") } : new JObject { ["catalog_id"] = V(scope + ".catalogId"), ["product_retailer_id"] = V(scope + ".productId") };
                    result.Add(new JObject { ["type"] = "header", ["parameters"] = new JArray(new JObject { ["type"] = format, [format] = data }) });
                }
                if (type == "LIMITED_TIME_OFFER" && (bool?)c["limited_time_offer"]?["has_expiration"] == true)
                    result.Add(new JObject { ["type"] = "limited_time_offer", ["parameters"] = new JArray(new JObject { ["type"] = "limited_time_offer", ["limited_time_offer"] = new JObject { ["expiration_time_ms"] = DateTimeOffset.Parse(V("expiration")).ToUnixTimeMilliseconds() } }) });
                if (type != "BUTTONS" || c["buttons"] is not JArray buttons) continue;
                for (var i = 0; i < buttons.Count; i++)
                {
                    var b = buttons[i]; var bt = Type(b); var p = $"{scope}.button.{i}"; var v = V(p); var parameters = new JArray();
                    if (bt == "URL" && Variables((string?)b["url"] ?? "") is { Length: > 0 } names) parameters.Add(Parameter(names[0], EncodeComponent(v)));
                    if (bt == "COPY_CODE") parameters.Add(new JObject { ["type"] = "coupon_code", ["coupon_code"] = v });
                    if (bt == "QUICK_REPLY" && v.Length > 0) parameters.Add(new JObject { ["type"] = "payload", ["payload"] = v });
                    var action = new JObject();
                    if (bt == "FLOW") { if (V(p + ".token").Length > 0) action["flow_token"] = V(p + ".token"); if (V(p + ".data").Length > 0) action["flow_action_data"] = JObject.Parse(V(p + ".data")); }
                    if (bt is "CATALOG" or "MPM" && V(p + ".thumbnail").Length > 0) action["thumbnail_product_retailer_id"] = V(p + ".thumbnail");
                    if (bt == "MPM") action["sections"] = Sections(V(p + ".sections"));
                    if (action.Count > 0) parameters.Add(new JObject { ["type"] = "action", ["action"] = action });
                    if (bt == "VOICE_CALL") { if (V(p + ".ttl").Length > 0) parameters.Add(new JObject { ["type"] = "ttl_minutes", ["ttl_minutes"] = int.Parse(V(p + ".ttl")) }); if (V(p + ".payload").Length > 0) parameters.Add(new JObject { ["type"] = "payload", ["payload"] = V(p + ".payload") }); }
                    if (parameters.Count > 0) result.Add(new JObject { ["type"] = "button", ["sub_type"] = bt.ToLowerInvariant(), ["index"] = i.ToString(System.Globalization.CultureInfo.InvariantCulture), ["parameters"] = parameters });
                }
            }
            return result;
        }
        var scopes = Scopes(template).ToArray();
        var output = Compose(scopes[0].Components, "root");
        if (scopes.Length > 1) output.Add(new JObject { ["type"] = "carousel", ["cards"] = new JArray(scopes.Skip(1).Select((s, i) => new JObject { ["card_index"] = i, ["components"] = Compose(s.Components, s.Scope) })) });
        if (((string?)template["category"])?.ToUpperInvariant() == "AUTHENTICATION") output = new JArray(
            new JObject { ["type"] = "body", ["parameters"] = new JArray(new JObject { ["type"] = "text", ["text"] = V("otp") }) },
            new JObject { ["type"] = "button", ["sub_type"] = "url", ["index"] = "0", ["parameters"] = new JArray(new JObject { ["type"] = "text", ["text"] = V("otp") }) });
        var payload = new JObject { ["name"] = template["name"], ["language"] = new JObject { ["code"] = template["language"] } };
        if (output.Count > 0) payload["components"] = output;
        return new JObject { ["version"] = "1", ["type"] = "data", ["kind"] = "template", ["data"] = payload };
    }
    public static IReadOnlyDictionary<string, string> ResolvedValues(JObject? content)
    {
        var values = new Dictionary<string, string>();
        if (content?["data"]?["components"] is not JArray components) return values;
        void Read(JArray cs, string scope)
        {
            foreach (var c in cs)
            {
                var type = ((string?)c["type"] ?? "").ToLowerInvariant();
                if (c["parameters"] is JArray ps) for (var i = 0; i < ps.Count; i++)
                    if ((string?)ps[i]["type"] == "text") values[$"{scope}.{type}.{(string?)ps[i]["parameter_name"] ?? (i + 1).ToString(System.Globalization.CultureInfo.InvariantCulture)}"] = (string?)ps[i]["text"] ?? "";
                if (type == "header" && c["parameters"] is JArray mediaParameters)
                    foreach (var parameter in mediaParameters)
                        if ((string?)parameter["type"] is "image" or "video" or "document") values[scope + ".media"] = (string?)parameter[parameter["type"]!.ToString()]?["link"] ?? (string?)parameter[parameter["type"]!.ToString()]?["id"] ?? "";
                if (type == "body" && scope == "root" && c["parameters"]?[0]?["text"] is { } otp) values["otp"] = otp.ToString();
                if (c["cards"] is JArray cards) for (var i = 0; i < cards.Count; i++) Read((JArray?)cards[i]["components"] ?? new JArray(), $"card.{i}");
            }
        }
        Read(components, "root"); return values;
    }
}
