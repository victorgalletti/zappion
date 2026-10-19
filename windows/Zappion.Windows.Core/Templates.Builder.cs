// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

public sealed record SupportedApp(string PackageName, string SignatureHash);

public sealed class HeaderDraft
{
    public string Format { get; set; } = "NONE";
    public string Text { get; set; } = "";
    public Dictionary<string, string> Examples { get; set; } = new();
    public string SampleHandle { get; set; } = "";
    public string? SampleFilename { get; set; }
    public HeaderDraft Clone() => new() { Format = Format, Text = Text, Examples = new Dictionary<string, string>(Examples), SampleHandle = SampleHandle, SampleFilename = SampleFilename };
}

public sealed class TextDraft
{
    public string Text { get; set; } = "";
    public Dictionary<string, string> Examples { get; set; } = new();
    public TextDraft Clone() => new() { Text = Text, Examples = new Dictionary<string, string>(Examples) };
}

public sealed class ButtonDraft
{
    public string Type { get; set; } = "QUICK_REPLY";
    public string Text { get; set; } = "";
    public string? Url { get; set; }
    public string? UrlExample { get; set; }
    public string? PhoneNumber { get; set; }
    public string? Example { get; set; }
    public string? FlowId { get; set; }
    public string? FlowAction { get; set; }
    public string? NavigateScreen { get; set; }
    public string? OtpType { get; set; }
    public string? AutofillText { get; set; }
    public bool? ZeroTapTermsAccepted { get; set; }
    public List<SupportedApp>? SupportedApps { get; set; }
    public ButtonDraft Clone() => new()
    {
        Type = Type, Text = Text, Url = Url, UrlExample = UrlExample, PhoneNumber = PhoneNumber, Example = Example,
        FlowId = FlowId, FlowAction = FlowAction, NavigateScreen = NavigateScreen, OtpType = OtpType, AutofillText = AutofillText,
        ZeroTapTermsAccepted = ZeroTapTermsAccepted, SupportedApps = SupportedApps?.ToList()
    };
}

public sealed class CardDraft
{
    public string HeaderFormat { get; set; } = "IMAGE";
    public string SampleHandle { get; set; } = "";
    public string? SampleFilename { get; set; }
    public string Body { get; set; } = "";
    public Dictionary<string, string> BodyExamples { get; set; } = new();
    public List<ButtonDraft> Buttons { get; set; } = [];
    public CardDraft Clone() => new()
    {
        HeaderFormat = HeaderFormat, SampleHandle = SampleHandle, SampleFilename = SampleFilename,
        Body = Body, BodyExamples = new Dictionary<string, string>(BodyExamples), Buttons = Buttons.Select(b => b.Clone()).ToList()
    };
}

public sealed class TemplateDraft
{
    public string Name { get; set; } = "";
    public string Language { get; set; } = "pt_BR";
    public string Category { get; set; } = "MARKETING";
    public string Kind { get; set; } = "standard";
    public HeaderDraft Header { get; set; } = new();
    public TextDraft Body { get; set; } = new();
    public string Footer { get; set; } = "";
    public List<ButtonDraft> Buttons { get; set; } = [];
    public List<CardDraft> Cards { get; set; } = [];
    public string OfferText { get; set; } = "";
    public bool OfferHasExpiration { get; set; } = true;
    public bool AddSecurityRecommendation { get; set; } = true;
    public string CodeExpirationMinutes { get; set; } = "10";
    public ButtonDraft AuthButton { get; set; } = new() { Type = "OTP", OtpType = "COPY_CODE", Text = "", AutofillText = "", SupportedApps = [new SupportedApp("", "")], ZeroTapTermsAccepted = true };
    public bool CallPermission { get; set; }
    public TemplateDraft Clone() => new()
    {
        Name = Name, Language = Language, Category = Category, Kind = Kind,
        Header = Header.Clone(), Body = Body.Clone(), Footer = Footer,
        Buttons = Buttons.Select(b => b.Clone()).ToList(), Cards = Cards.Select(c => c.Clone()).ToList(),
        OfferText = OfferText, OfferHasExpiration = OfferHasExpiration, AddSecurityRecommendation = AddSecurityRecommendation,
        CodeExpirationMinutes = CodeExpirationMinutes, AuthButton = AuthButton.Clone(), CallPermission = CallPermission
    };
}

public sealed record ValidationIssue(string Field, string Message);

public sealed record TemplateFilters(string Query = "", string Status = "ALL", string Category = "ALL", string Kind = "ALL", string Language = "ALL");

public sealed record TemplateKindMeta(string Label, string Description, string[] Categories);

public sealed record TemplateCategoryMeta(string Label, string Description);

public sealed record TemplateStatusMeta(string Label, string Tone);

public sealed record TemplateMediaLimit(string Accept, string[] MimeTypes, long MaxBytes, string Label);

public sealed class TemplateSendValues
{
    public Dictionary<string, string> HeaderVars { get; set; } = new();
    public Dictionary<string, string> BodyVars { get; set; } = new();
    public string? HeaderMediaUrl { get; set; }
    public string? HeaderMediaFilename { get; set; }
    public string? LocationCoords { get; set; }
    public string? LocationName { get; set; }
    public string? LocationAddress { get; set; }
    public string? ProductRetailerId { get; set; }
    public Dictionary<int, string> ButtonUrlVars { get; set; } = new();
    public Dictionary<int, string> ButtonCouponCodes { get; set; } = new();
    public Dictionary<int, string> CardMediaUrls { get; set; } = new();
    public Dictionary<int, string> CardProductIds { get; set; } = new();
    public Dictionary<int, Dictionary<string, string>> CardBodyVars { get; set; } = new();
    public Dictionary<int, Dictionary<int, string>> CardButtonUrlVars { get; set; } = new();
    public string? MpmThumbnailProductId { get; set; }
    public string? MpmSectionsText { get; set; }
    public string? AuthCode { get; set; }
}

// Mirrors web/lib/templates/types.ts, languages.ts, catalog.ts, display.ts, payload.ts, validation.ts, upload.ts, and send.ts.
public static partial class Templates
{
    public static string Text(string section, string key)
    {
        var fullKey = $"Templates_{section}_{key}";
        var val = UiStrings.Get(fullKey);
        if (val != fullKey) return val;
        var settingsKey = $"Settings_{section}_{key}";
        val = UiStrings.Get(settingsKey);
        return val != settingsKey ? val : key;
    }

    public static string Text(string section, string key, params (string Key, object? Value)[] values)
    {
        var result = Text(section, key);
        foreach (var (k, v) in values)
            result = result.Replace("{" + k + "}", Convert.ToString(v, CultureInfo.InvariantCulture) ?? "", StringComparison.Ordinal);
        return result;
    }

    public static readonly string[] LanguageCodes =
    [
        "af", "sq", "ar", "az", "bn", "bg", "ca", "zh_CN", "zh_HK", "zh_TW", "hr", "cs", "da", "nl",
        "en", "en_GB", "en_US", "et", "fil", "fi", "fr", "ka", "de", "el", "gu", "ha", "he", "hi",
        "hu", "id", "ga", "it", "ja", "kn", "kk", "rw_RW", "ko", "ky_KG", "lo", "lv", "lt", "mk",
        "ms", "ml", "mr", "nb", "fa", "pl", "pt_BR", "pt_PT", "pa", "ro", "ru", "sr", "sk", "sl",
        "es", "es_AR", "es_ES", "es_MX", "sw", "sv", "ta", "te", "th", "tr", "uk", "ur", "uz", "vi", "zu"
    ];

    private static readonly Dictionary<string, Dictionary<string, string>> LanguageOverrides = new()
    {
        ["pt-BR"] = new()
        {
            ["pt_BR"] = "Português (Brasil)", ["pt_PT"] = "Português (Portugal)", ["en"] = "Inglês",
            ["en_US"] = "Inglês (EUA)", ["en_GB"] = "Inglês (Reino Unido)", ["es"] = "Espanhol",
            ["es_ES"] = "Espanhol (Espanha)", ["es_MX"] = "Espanhol (México)", ["es_AR"] = "Espanhol (Argentina)",
            ["zh_CN"] = "Chinês simplificado", ["zh_TW"] = "Chinês tradicional (Taiwan)",
            ["zh_HK"] = "Chinês tradicional (Hong Kong)", ["rw_RW"] = "Quiniaruanda", ["ky_KG"] = "Quirguiz"
        },
        ["en"] = new()
        {
            ["pt_BR"] = "Portuguese (Brazil)", ["pt_PT"] = "Portuguese (Portugal)", ["en"] = "English",
            ["en_US"] = "English (US)", ["en_GB"] = "English (UK)", ["es"] = "Spanish",
            ["es_ES"] = "Spanish (Spain)", ["es_MX"] = "Spanish (Mexico)", ["es_AR"] = "Spanish (Argentina)",
            ["zh_CN"] = "Chinese (Simplified)", ["zh_TW"] = "Chinese (Traditional, Taiwan)",
            ["zh_HK"] = "Chinese (Traditional, Hong Kong)", ["rw_RW"] = "Kinyarwanda", ["ky_KG"] = "Kyrgyz"
        }
    };

    public static IReadOnlyList<(string Code, string Label)> GetTemplateLanguages(string? locale = null)
    {
        var loc = (locale ?? CultureInfo.CurrentUICulture.Name).StartsWith("pt", StringComparison.OrdinalIgnoreCase) ? "pt-BR" : "en";
        var overrides = LanguageOverrides[loc];
        return LanguageCodes.Select(code =>
        {
            var name = overrides.GetValueOrDefault(code);
            if (string.IsNullOrEmpty(name))
            {
                try
                {
                    var ci = CultureInfo.GetCultureInfo(code.Replace('_', '-'));
                    name = loc == "pt-BR" ? ci.NativeName : ci.EnglishName;
                }
                catch { name = code; }
            }
            var capitalized = name.Length > 0 ? char.ToUpper(name[0], CultureInfo.InvariantCulture) + name[1..] : code;
            return (code, $"{capitalized} ({code})");
        }).ToArray();
    }

    public static string LanguageLabel(string code, string? locale = null) =>
        GetTemplateLanguages(locale).FirstOrDefault(l => l.Code == code).Label is { Length: > 0 } label ? label : code;

    public static readonly string[] KindOrder =
    [
        "standard", "media", "carousel", "productCarousel", "catalog", "mpm",
        "product", "offer", "coupon", "authentication", "flow", "callPermission"
    ];

    public static readonly string[] CategoryOrder = ["MARKETING", "UTILITY", "AUTHENTICATION"];

    public static readonly string[] StatusOrder =
    [
        "APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED",
        "IN_APPEAL", "DELETED", "PENDING_DELETION", "LIMIT_EXCEEDED"
    ];

    public static IReadOnlyDictionary<string, TemplateKindMeta> GetKindLabels() => new Dictionary<string, TemplateKindMeta>
    {
        ["standard"] = new(Text("templatesCatalog", "standard"), Text("templatesCatalog", "richTextBodyWithOptionalHeaderFooter"), ["MARKETING", "UTILITY"]),
        ["media"] = new(Text("templatesCatalog", "mediaLocation"), Text("templatesCatalog", "imageVideoDocumentOrLocationAboveThe"), ["MARKETING", "UTILITY"]),
        ["carousel"] = new(Text("templatesCatalog", "mediaCarousel"), Text("templatesCatalog", "2To10ScrollableCardsWithImage"), ["MARKETING"]),
        ["productCarousel"] = new(Text("templatesCatalog", "productCarousel"), Text("templatesCatalog", "scrollableCatalogProductCards"), ["MARKETING"]),
        ["catalog"] = new(Text("templatesCatalog", "catalog"), Text("templatesCatalog", "opensYourConnectedWhatsappProductCatalog"), ["MARKETING"]),
        ["mpm"] = new(Text("templatesCatalog", "multipleProductsMpm"), Text("templatesCatalog", "curatedProductSectionsFromYourCatalog"), ["MARKETING"]),
        ["product"] = new(Text("templatesCatalog", "productSpm"), Text("templatesCatalog", "highlightsOneProductFromYourCatalog"), ["MARKETING", "UTILITY"]),
        ["offer"] = new(Text("templatesCatalog", "limitedTimeOffer"), Text("templatesCatalog", "countdownBannerWithOptionalCouponAndUrl"), ["MARKETING"]),
        ["coupon"] = new(Text("templatesCatalog", "coupon"), Text("templatesCatalog", "promotionalBodyWithAOneTapCopy"), ["MARKETING"]),
        ["authentication"] = new(Text("templatesCatalog", "authenticationOtp"), Text("templatesCatalog", "oneTimePasscodeWithCopyCodeOne"), ["AUTHENTICATION"]),
        ["flow"] = new(Text("templatesCatalog", "flow"), Text("templatesCatalog", "launchesAnInteractiveWhatsappFlowForm"), ["MARKETING", "UTILITY"]),
        ["callPermission"] = new(Text("templatesCatalog", "callPermission"), Text("templatesCatalog", "asksCustomerPermissionBeforeBusinessInitiatedCalls"), ["MARKETING", "UTILITY"])
    };

    public static IReadOnlyDictionary<string, TemplateCategoryMeta> GetCategoryLabels() => new Dictionary<string, TemplateCategoryMeta>
    {
        ["MARKETING"] = new(Text("templatesCatalog", "marketing"), Text("templatesCatalog", "promotionsOffersProductAnnouncementsAndReEngagement")),
        ["UTILITY"] = new(Text("templatesCatalog", "utility"), Text("templatesCatalog", "orderUpdatesAccountAlertsAndTransactionConfirmations")),
        ["AUTHENTICATION"] = new(Text("templatesCatalog", "authentication"), Text("templatesCatalog", "oneTimePasscodesAndAccountVerification"))
    };

    public static IReadOnlyDictionary<string, string> GetButtonLabels() => new Dictionary<string, string>
    {
        ["QUICK_REPLY"] = Text("templatesCatalog", "quickReply"),
        ["URL"] = Text("templatesCatalog", "urlWebsite"),
        ["PHONE_NUMBER"] = Text("templatesCatalog", "phoneNumber"),
        ["COPY_CODE"] = Text("templatesCatalog", "copyCode"),
        ["FLOW"] = Text("templatesCatalog", "whatsappFlow"),
        ["VOICE_CALL"] = Text("templatesCatalog", "voiceCall"),
        ["CATALOG"] = Text("templatesCatalog", "catalog"),
        ["MPM"] = Text("templatesCatalog", "multiProduct"),
        ["SPM"] = Text("templatesCatalog", "singleProduct"),
        ["OTP"] = Text("templatesCatalog", "otpCopyOneTap")
    };

    public static ButtonDraft NewButton(string type) => type switch
    {
        "QUICK_REPLY" => new() { Type = "QUICK_REPLY", Text = "" },
        "URL" => new() { Type = "URL", Text = "", Url = "https://", UrlExample = "" },
        "PHONE_NUMBER" => new() { Type = "PHONE_NUMBER", Text = "", PhoneNumber = "+" },
        "COPY_CODE" => new() { Type = "COPY_CODE", Text = Text("templatesCatalog", "copyCode"), Example = "PROMO10" },
        "FLOW" => new() { Type = "FLOW", Text = "", FlowId = "", FlowAction = "navigate", NavigateScreen = "" },
        "VOICE_CALL" => new() { Type = "VOICE_CALL", Text = "" },
        "CATALOG" => new() { Type = "CATALOG", Text = Text("templatePreview", "viewCatalog") },
        "MPM" => new() { Type = "MPM", Text = Text("templatePreview", "viewItems") },
        "SPM" => new() { Type = "SPM", Text = Text("templatePreview", "viewProduct") },
        "OTP" => new() { Type = "OTP", OtpType = "COPY_CODE", Text = Text("templatesCatalog", "copyCode"), AutofillText = "", SupportedApps = [new SupportedApp("", "")], ZeroTapTermsAccepted = true },
        _ => new() { Type = type, Text = "" }
    };

    private static CardDraft NewCarouselCard(string headerFormat = "IMAGE") => new()
    {
        HeaderFormat = headerFormat, SampleHandle = "", Body = "", BodyExamples = new(),
        Buttons = [NewButton("QUICK_REPLY")]
    };

    public static TemplateDraft NewDraft(string kind = "standard")
    {
        var draft = new TemplateDraft { Kind = kind };
        switch (kind)
        {
            case "media":
                draft.Header.Format = "IMAGE";
                break;
            case "carousel":
                draft.Cards = [NewCarouselCard("IMAGE"), NewCarouselCard("IMAGE")];
                break;
            case "productCarousel":
                draft.Cards = [
                    new CardDraft { HeaderFormat = "PRODUCT", SampleHandle = "", Body = "", BodyExamples = new(), Buttons = [NewButton("SPM")] },
                    new CardDraft { HeaderFormat = "PRODUCT", SampleHandle = "", Body = "", BodyExamples = new(), Buttons = [NewButton("SPM")] }
                ];
                break;
            case "catalog":
                draft.Buttons = [NewButton("CATALOG")];
                break;
            case "mpm":
                draft.Header = new HeaderDraft { Format = "TEXT", Text = "", Examples = new(), SampleHandle = "" };
                draft.Buttons = [NewButton("MPM")];
                break;
            case "product":
                draft.Header.Format = "PRODUCT";
                draft.Buttons = [NewButton("SPM")];
                break;
            case "offer":
                draft.Header.Format = "IMAGE";
                draft.OfferText = "";
                draft.OfferHasExpiration = true;
                draft.Buttons = [NewButton("COPY_CODE"), NewButton("URL")];
                break;
            case "coupon":
                draft.Buttons = [NewButton("COPY_CODE")];
                break;
            case "authentication":
                draft.Category = "AUTHENTICATION";
                break;
            case "flow":
                draft.Category = "UTILITY";
                draft.Buttons = [NewButton("FLOW")];
                break;
            case "callPermission":
                draft.Category = "UTILITY";
                draft.CallPermission = true;
                break;
        }
        return draft;
    }

    public static string InferKind(JObject t)
    {
        var comps = t["components"] as JArray ?? [];
        if (((string?)t["category"] ?? "").Equals("AUTHENTICATION", StringComparison.OrdinalIgnoreCase)) return "authentication";
        var carousel = comps.FirstOrDefault(c => Type(c) == "CAROUSEL") as JObject;
        if (carousel != null)
        {
            var firstCardComps = (carousel["cards"] as JArray)?.FirstOrDefault()?["components"] as JArray ?? [];
            var firstHeader = firstCardComps.FirstOrDefault(c => Type(c) == "HEADER");
            return ((string?)firstHeader?["format"] ?? "").Equals("PRODUCT", StringComparison.OrdinalIgnoreCase) ? "productCarousel" : "carousel";
        }
        if (comps.Any(c => Type(c) == "LIMITED_TIME_OFFER")) return "offer";
        if (comps.Any(c => Type(c) == "CALL_PERMISSION_REQUEST")) return "callPermission";
        var header = comps.FirstOrDefault(c => Type(c) == "HEADER");
        var buttons = comps.FirstOrDefault(c => Type(c) == "BUTTONS")?["buttons"] as JArray ?? [];
        if (buttons.Any(b => Type(b) == "MPM")) return "mpm";
        if (buttons.Any(b => Type(b) == "CATALOG")) return "catalog";
        if (((string?)header?["format"] ?? "").Equals("PRODUCT", StringComparison.OrdinalIgnoreCase) || buttons.Any(b => Type(b) == "SPM")) return "product";
        if (buttons.Any(b => Type(b) == "FLOW")) return "flow";
        if (buttons.Any(b => Type(b) == "COPY_CODE")) return "coupon";
        var hFormat = ((string?)header?["format"] ?? "").ToUpperInvariant();
        if (hFormat is "IMAGE" or "VIDEO" or "DOCUMENT" or "LOCATION") return "media";
        return "standard";
    }

    public static string FillVariables(string text, IReadOnlyDictionary<string, string>? values = null) =>
        Regex.Replace(text ?? "", @"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", m =>
        {
            var key = m.Groups[1].Value;
            return values != null && values.TryGetValue(key, out var val) && !string.IsNullOrWhiteSpace(val) ? val : $"{{{{{key}}}}}";
        });

    private static Dictionary<string, string> PositionalOrNamedExamples(JToken? comp, string posKey, string namedKey, string? text)
    {
        var outMap = new Dictionary<string, string>();
        var example = comp?["example"];
        if (example == null) return outMap;
        if (example[namedKey] is JArray named)
        {
            foreach (var p in named)
                if ((string?)p["param_name"] is { Length: > 0 } k && (string?)p["example"] is { } v) outMap[k] = v;
        }
        var raw = example[posKey];
        var arr = raw is JArray rArr && rArr.Count > 0 && rArr[0] is JArray inner ? inner : raw as JArray;
        if (arr != null && !string.IsNullOrEmpty(text))
        {
            var vars = Variables(text);
            for (var i = 0; i < vars.Length; i++)
                if (i < arr.Count && arr[i]?.ToString() is { } val) outMap[vars[i]] = val;
        }
        return outMap;
    }

    public static JObject? GetComponent(JObject t, string type) =>
        (t["components"] as JArray)?.OfType<JObject>().FirstOrDefault(c => Type(c) == type.ToUpperInvariant());

    public static Dictionary<string, string> GetHeaderExamples(JObject? header) =>
        PositionalOrNamedExamples(header, "header_text", "header_text_named_params", (string?)header?["text"]);

    public static Dictionary<string, string> GetBodyExamples(JObject? body) =>
        PositionalOrNamedExamples(body, "body_text", "body_text_named_params", (string?)body?["text"]);

    private static ButtonDraft ParseButtonDraft(JToken b)
    {
        var type = Type(b);
        if (string.IsNullOrEmpty(type)) type = "QUICK_REPLY";
        var ex = b["example"];
        var exStr = ex is JArray arr ? (string?)arr.FirstOrDefault() ?? "" : ex?.Type == JTokenType.String ? (string?)ex ?? "" : "";
        return new ButtonDraft
        {
            Type = type,
            Text = (string?)b["text"] ?? "",
            Url = (string?)b["url"] ?? "",
            UrlExample = type == "URL" ? exStr : "",
            PhoneNumber = (string?)b["phone_number"] ?? "",
            Example = type == "COPY_CODE" ? exStr : "",
            FlowId = b["flow_id"] != null ? b["flow_id"]!.ToString() : "",
            FlowAction = ((string?)b["flow_action"]) == "data_exchange" ? "data_exchange" : "navigate",
            NavigateScreen = (string?)b["navigate_screen"] ?? "",
            OtpType = (string?)b["otp_type"] ?? "COPY_CODE",
            AutofillText = (string?)b["autofill_text"] ?? "",
            ZeroTapTermsAccepted = (bool?)b["zero_tap_terms_accepted"] ?? true,
            SupportedApps = b["supported_apps"] is JArray apps && apps.Count > 0
                ? apps.Select(a => new SupportedApp((string?)a["package_name"] ?? "", (string?)a["signature_hash"] ?? "")).ToList()
                : [new SupportedApp("", "")]
        };
    }

    public static TemplateDraft DuplicateTemplate(JObject t)
    {
        var kind = InferKind(t);
        var draft = NewDraft(kind);
        draft.Name = $"{(string?)t["name"] ?? "template"}_copy";
        draft.Language = (string?)t["language"] ?? "pt_BR";
        var cat = ((string?)t["category"] ?? "MARKETING").ToUpperInvariant();
        draft.Category = cat is "MARKETING" or "UTILITY" or "AUTHENTICATION" ? cat : "MARKETING";

        var comps = t["components"] as JArray ?? [];
        foreach (var comp in comps.OfType<JObject>())
        {
            var type = Type(comp);
            if (type == "HEADER")
            {
                var fmt = ((string?)comp["format"] ?? "TEXT").ToUpperInvariant();
                draft.Header = new HeaderDraft
                {
                    Format = fmt,
                    Text = (string?)comp["text"] ?? "",
                    Examples = GetHeaderExamples(comp),
                    SampleHandle = (string?)(comp["example"]?["header_handle"] as JArray)?.FirstOrDefault() ?? ""
                };
            }
            else if (type == "BODY")
            {
                draft.Body = new TextDraft { Text = (string?)comp["text"] ?? "", Examples = GetBodyExamples(comp) };
                if (comp["add_security_recommendation"] != null)
                    draft.AddSecurityRecommendation = (bool)comp["add_security_recommendation"]!;
            }
            else if (type == "FOOTER")
            {
                draft.Footer = (string?)comp["text"] ?? "";
                if (comp["code_expiration_minutes"] != null)
                    draft.CodeExpirationMinutes = comp["code_expiration_minutes"]!.ToString();
            }
            else if (type == "LIMITED_TIME_OFFER" && comp["limited_time_offer"] is JObject lto)
            {
                draft.OfferText = (string?)lto["text"] ?? "";
                draft.OfferHasExpiration = (bool?)lto["has_expiration"] ?? true;
            }
            else if (type == "CALL_PERMISSION_REQUEST")
            {
                draft.CallPermission = true;
            }
            else if (type == "BUTTONS" && comp["buttons"] is JArray btns)
            {
                var parsed = btns.Select(ParseButtonDraft).ToList();
                if (kind == "authentication" && parsed.FirstOrDefault(b => b.Type == "OTP") is { } otp)
                    draft.AuthButton = otp;
                else
                    draft.Buttons = parsed;
            }
            else if (type == "CAROUSEL" && comp["cards"] is JArray cards)
            {
                draft.Cards = cards.Select(card =>
                {
                    var cardComps = card["components"] as JArray ?? [];
                    var ch = cardComps.OfType<JObject>().FirstOrDefault(c => Type(c) == "HEADER");
                    var cb = cardComps.OfType<JObject>().FirstOrDefault(c => Type(c) == "BODY");
                    var cbtns = cardComps.OfType<JObject>().FirstOrDefault(c => Type(c) == "BUTTONS");
                    var fmt = ((string?)ch?["format"] ?? "IMAGE").ToUpperInvariant();
                    return new CardDraft
                    {
                        HeaderFormat = fmt is "VIDEO" or "PRODUCT" ? fmt : "IMAGE",
                        SampleHandle = (string?)(ch?["example"]?["header_handle"] as JArray)?.FirstOrDefault() ?? "",
                        Body = (string?)cb?["text"] ?? "",
                        BodyExamples = GetBodyExamples(cb),
                        Buttons = (cbtns?["buttons"] as JArray ?? []).Select(ParseButtonDraft).ToList()
                    };
                }).ToList();
            }
        }
        return draft;
    }

    public static IReadOnlyDictionary<string, TemplateStatusMeta> GetTemplateStatuses() => new Dictionary<string, TemplateStatusMeta>
    {
        ["APPROVED"] = new(Text("templatesDisplay", "approved"), "emerald"),
        ["PENDING"] = new(Text("templatesDisplay", "pending"), "amber"),
        ["REJECTED"] = new(Text("templatesDisplay", "rejected"), "red"),
        ["PAUSED"] = new(Text("templatesDisplay", "paused"), "sub"),
        ["DISABLED"] = new(Text("templatesDisplay", "disabled"), "red"),
        ["IN_APPEAL"] = new(Text("templatesDisplay", "inAppeal"), "amber"),
        ["DELETED"] = new(Text("templatesDisplay", "deleted"), "sub"),
        ["PENDING_DELETION"] = new(Text("templatesDisplay", "pendingDeletion"), "amber"),
        ["LIMIT_EXCEEDED"] = new(Text("templatesDisplay", "limitExceeded"), "red")
    };

    public static (string Label, string Tone) TemplateQuality(JObject t)
    {
        // Mirrors templateQuality in web/lib/templates/display.ts.
        var score = ((string?)t["quality_score"]?["score"])?.ToUpperInvariant();
        if (string.IsNullOrEmpty(score)) return (Text("templatesDisplay", "notProvidedByTheApi"), "sub");
        return score switch
        {
            "GREEN" => (Text("templatesDisplay", "high"), "emerald"),
            "YELLOW" => (Text("templatesDisplay", "medium"), "amber"),
            "RED" => (Text("templatesDisplay", "low"), "red"),
            "UNKNOWN" => (Text("templatesDisplay", "notYetRated"), "sub"),
            _ => (score, "sub")
        };
    }

    public static TemplateFilters EmptyTemplateFilters() => new();

    public static IReadOnlyList<JObject> FilterTemplates(IEnumerable<JObject> templates, TemplateFilters filters)
    {
        var q = (filters.Query ?? "").Trim().ToLowerInvariant();
        return templates.Where(t =>
        {
            if (filters.Status != "ALL" && ((string?)t["status"] ?? "").ToUpperInvariant() != filters.Status) return false;
            if (filters.Category != "ALL" && ((string?)t["category"] ?? "").ToUpperInvariant() != filters.Category) return false;
            if (filters.Kind != "ALL" && InferKind(t) != filters.Kind) return false;
            if (filters.Language != "ALL" && ((string?)t["language"] ?? "") != filters.Language) return false;
            if (string.IsNullOrEmpty(q)) return true;
            var body = (string?)GetComponent(t, "BODY")?["text"] ?? "";
            var name = (string?)t["name"] ?? "";
            var lang = (string?)t["language"] ?? "";
            var cat = (string?)t["category"] ?? "";
            return name.Contains(q, StringComparison.OrdinalIgnoreCase)
                || lang.Contains(q, StringComparison.OrdinalIgnoreCase)
                || cat.Contains(q, StringComparison.OrdinalIgnoreCase)
                || InferKind(t).Contains(q, StringComparison.OrdinalIgnoreCase)
                || body.Contains(q, StringComparison.OrdinalIgnoreCase);
        }).ToArray();
    }

    private static bool IsNamedVars(string[] vars) => vars.Length > 0 && vars.Any(v => !Regex.IsMatch(v, @"^\d+$"));

    private static bool UsesNamedParams(TemplateDraft draft)
    {
        if (draft.Kind == "authentication") return false;
        var all = Variables(draft.Header.Text).Concat(Variables(draft.Body.Text)).ToArray();
        return IsNamedVars(all);
    }

    private static JObject? BodyExampleToken(string text, IReadOnlyDictionary<string, string> examples)
    {
        var vars = Variables(text);
        if (vars.Length == 0) return null;
        if (IsNamedVars(vars))
        {
            return new JObject
            {
                ["body_text_named_params"] = new JArray(vars.Select(v => new JObject
                {
                    ["param_name"] = v,
                    ["example"] = (examples.GetValueOrDefault(v) ?? "").Trim() is { Length: > 0 } ex ? ex : "example"
                }))
            };
        }
        return new JObject
        {
            ["body_text"] = new JArray { new JArray(vars.Select(v =>
                (object)((examples.GetValueOrDefault(v) ?? "").Trim() is { Length: > 0 } ex ? ex : "example"))) }
        };
    }

    private static JObject SerializeButton(ButtonDraft b)
    {
        switch (b.Type)
        {
            case "QUICK_REPLY":
                return new JObject { ["type"] = "QUICK_REPLY", ["text"] = b.Text.Trim() };
            case "URL":
            {
                var btn = new JObject { ["type"] = "URL", ["text"] = b.Text.Trim(), ["url"] = (b.Url ?? "").Trim() };
                if (Variables(b.Url ?? "").Length > 0 && !string.IsNullOrWhiteSpace(b.UrlExample))
                    btn["example"] = new JArray(b.UrlExample!.Trim());
                return btn;
            }
            case "PHONE_NUMBER":
                return new JObject { ["type"] = "PHONE_NUMBER", ["text"] = b.Text.Trim(), ["phone_number"] = (b.PhoneNumber ?? "").Trim() };
            case "COPY_CODE":
                return new JObject { ["type"] = "COPY_CODE", ["example"] = (b.Example ?? "").Trim() };
            case "FLOW":
            {
                var btn = new JObject
                {
                    ["type"] = "FLOW",
                    ["text"] = b.Text.Trim(),
                    ["flow_id"] = (b.FlowId ?? "").Trim(),
                    ["flow_action"] = string.IsNullOrEmpty(b.FlowAction) ? "navigate" : b.FlowAction
                };
                if (!string.IsNullOrWhiteSpace(b.NavigateScreen))
                    btn["navigate_screen"] = b.NavigateScreen!.Trim();
                return btn;
            }
            case "VOICE_CALL":
            case "CATALOG":
            case "MPM":
            case "SPM":
                return new JObject { ["type"] = b.Type, ["text"] = b.Text.Trim() };
            case "OTP":
            {
                var btn = new JObject { ["type"] = "OTP", ["otp_type"] = string.IsNullOrEmpty(b.OtpType) ? "COPY_CODE" : b.OtpType };
                if (!string.IsNullOrWhiteSpace(b.Text)) btn["text"] = b.Text.Trim();
                return btn;
            }
            default:
                return new JObject { ["type"] = b.Type, ["text"] = b.Text.Trim() };
        }
    }

    public static JArray DraftComponents(TemplateDraft draft)
    {
        var components = new JArray();

        if (draft.Kind == "authentication")
        {
            var body = new JObject { ["type"] = "BODY" };
            if (draft.AddSecurityRecommendation) body["add_security_recommendation"] = true;
            components.Add(body);

            if (int.TryParse(draft.CodeExpirationMinutes, NumberStyles.Integer, CultureInfo.InvariantCulture, out var mins) && mins > 0)
                components.Add(new JObject { ["type"] = "FOOTER", ["code_expiration_minutes"] = mins });

            var btn = draft.AuthButton;
            var otpType = string.IsNullOrEmpty(btn.OtpType) ? "COPY_CODE" : btn.OtpType!;
            var otp = new JObject { ["type"] = "OTP", ["otp_type"] = otpType };
            if (!string.IsNullOrWhiteSpace(btn.Text)) otp["text"] = btn.Text.Trim();
            if (otpType is "ONE_TAP" or "ZERO_TAP")
            {
                if (!string.IsNullOrWhiteSpace(btn.AutofillText)) otp["autofill_text"] = btn.AutofillText!.Trim();
                if (otpType == "ZERO_TAP") otp["zero_tap_terms_accepted"] = btn.ZeroTapTermsAccepted ?? true;
                var apps = (btn.SupportedApps ?? []).Where(a => !string.IsNullOrWhiteSpace(a.PackageName) && !string.IsNullOrWhiteSpace(a.SignatureHash))
                    .Select(a => new JObject { ["package_name"] = a.PackageName.Trim(), ["signature_hash"] = a.SignatureHash.Trim() }).ToArray();
                if (apps.Length > 0) otp["supported_apps"] = new JArray(apps);
            }
            components.Add(new JObject { ["type"] = "BUTTONS", ["buttons"] = new JArray(otp) });
            return components;
        }

        if (draft.Kind is not ("carousel" or "productCarousel" or "catalog"))
        {
            var h = draft.Header;
            if (h.Format == "TEXT")
            {
                var vars = Variables(h.Text);
                var headerComp = new JObject { ["type"] = "HEADER", ["format"] = "TEXT", ["text"] = h.Text.Trim() };
                if (vars.Length > 0)
                {
                    headerComp["example"] = IsNamedVars(vars)
                        ? new JObject
                        {
                            ["header_text_named_params"] = new JArray(vars.Select(v => new JObject
                            {
                                ["param_name"] = v,
                                ["example"] = (h.Examples.GetValueOrDefault(v) ?? "").Trim() is { Length: > 0 } ex ? ex : "example"
                            }))
                        }
                        : new JObject
                        {
                            ["header_text"] = new JArray(vars.Select(v =>
                                (object)((h.Examples.GetValueOrDefault(v) ?? "").Trim() is { Length: > 0 } ex ? ex : "example")))
                        };
                }
                components.Add(headerComp);
            }
            else if (h.Format is "IMAGE" or "VIDEO" or "DOCUMENT")
            {
                var headerComp = new JObject { ["type"] = "HEADER", ["format"] = h.Format };
                if (!string.IsNullOrWhiteSpace(h.SampleHandle))
                    headerComp["example"] = new JObject { ["header_handle"] = new JArray(h.SampleHandle.Trim()) };
                components.Add(headerComp);
            }
            else if (h.Format is "LOCATION" or "PRODUCT")
            {
                components.Add(new JObject { ["type"] = "HEADER", ["format"] = h.Format });
            }
        }

        if (draft.Kind == "offer")
        {
            components.Add(new JObject
            {
                ["type"] = "LIMITED_TIME_OFFER",
                ["limited_time_offer"] = new JObject { ["text"] = draft.OfferText.Trim(), ["has_expiration"] = draft.OfferHasExpiration }
            });
        }

        var bodyComp = new JObject { ["type"] = "BODY", ["text"] = draft.Body.Text.Trim() };
        if (BodyExampleToken(draft.Body.Text, draft.Body.Examples) is { } bodyEx)
            bodyComp["example"] = bodyEx;
        components.Add(bodyComp);

        if (!string.IsNullOrWhiteSpace(draft.Footer) && draft.Kind != "offer")
            components.Add(new JObject { ["type"] = "FOOTER", ["text"] = draft.Footer.Trim() });

        if (draft.Kind == "callPermission" || draft.CallPermission)
            components.Add(new JObject { ["type"] = "CALL_PERMISSION_REQUEST" });

        if (draft.Buttons.Count > 0)
            components.Add(new JObject { ["type"] = "BUTTONS", ["buttons"] = new JArray(draft.Buttons.Select(SerializeButton)) });

        if (draft.Kind is "carousel" or "productCarousel")
        {
            components.Add(new JObject
            {
                ["type"] = "CAROUSEL",
                ["cards"] = new JArray(draft.Cards.Select(card =>
                {
                    var cardHeader = new JObject { ["type"] = "HEADER", ["format"] = card.HeaderFormat };
                    if (card.HeaderFormat != "PRODUCT" && !string.IsNullOrWhiteSpace(card.SampleHandle))
                        cardHeader["example"] = new JObject { ["header_handle"] = new JArray(card.SampleHandle.Trim()) };
                    var cardComps = new JArray(cardHeader);
                    if (card.HeaderFormat != "PRODUCT")
                    {
                        var cb = new JObject { ["type"] = "BODY", ["text"] = card.Body.Trim() };
                        if (BodyExampleToken(card.Body, card.BodyExamples) is { } cbEx) cb["example"] = cbEx;
                        cardComps.Add(cb);
                    }
                    if (card.Buttons.Count > 0)
                        cardComps.Add(new JObject { ["type"] = "BUTTONS", ["buttons"] = new JArray(card.Buttons.Select(SerializeButton)) });
                    return new JObject { ["components"] = cardComps };
                }))
            });
        }

        return components;
    }

    public static JObject BuildCreatePayload(TemplateDraft draft, string organizationId, string organizationAddress)
    {
        var payload = new JObject
        {
            ["organization_id"] = organizationId,
            ["organization_address"] = organizationAddress,
            ["name"] = draft.Name.Trim(),
            ["language"] = draft.Language.Trim(),
            ["category"] = draft.Category
        };
        if (UsesNamedParams(draft)) payload["parameter_format"] = "NAMED";
        payload["components"] = DraftComponents(draft);
        return payload;
    }

    public static class Limits
    {
        public const int Name = 512;
        public const int HeaderText = 60;
        public const int Body = 1024;
        public const int CardBody = 160;
        public const int Footer = 60;
        public const int ButtonText = 25;
        public const int Url = 2000;
        public const int Phone = 20;
        public const int CopyCode = 15;
        public const int OfferText = 16;
        public const int MaxButtons = 10;
        public const int MaxUrlButtons = 2;
        public const int MaxPhoneButtons = 1;
        public const int MaxCopyButtons = 1;
        public const int MaxCards = 10;
        public const int MinCards = 2;
        public const int MaxCardButtons = 2;
    }

    public static bool IsWebUrl(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && Uri.TryCreate(value.Trim(), UriKind.Absolute, out var u)
        && (u.Scheme == "http" || u.Scheme == "https")
        && !string.IsNullOrEmpty(u.Host);

    private static void CheckBodyVariables(string text, IReadOnlyDictionary<string, string> examples, string field, List<ValidationIssue> issues)
    {
        var trimmed = text.Trim();
        if (Regex.IsMatch(trimmed, @"^\{\{[a-zA-Z0-9_]+\}\}") || Regex.IsMatch(trimmed, @"\{\{[a-zA-Z0-9_]+\}\}$"))
            issues.Add(new(field, Text("templatesValidation", "variablesCannotBeAtTheVeryStart")));
        if (Regex.IsMatch(text, @"\{\{[a-zA-Z0-9_]+\}\}\s*\{\{[a-zA-Z0-9_]+\}\}"))
            issues.Add(new(field, Text("templatesValidation", "VariablesCannotBeAdjacentAddTextBetween")));

        var allTokens = Regex.Matches(text, @"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}").Select(m => m.Groups[1].Value).ToArray();
        var vars = Variables(text);
        if (vars.Length == 0) return;

        var positional = vars.Where(v => Regex.IsMatch(v, @"^\d+$")).Select(int.Parse).OrderBy(n => n).ToArray();
        var named = vars.Where(v => !Regex.IsMatch(v, @"^\d+$")).ToArray();
        if (positional.Length > 0 && named.Length > 0)
            issues.Add(new(field, Text("templatesValidation", "doNotMixPositional1AndNamed")));
        if (positional.Length > 0)
        {
            for (var i = 0; i < positional.Length; i++)
            {
                if (positional[i] != i + 1)
                {
                    issues.Add(new(field, Text("templatesValidation", "PositionalVariablesMustBeSequentialStartingAt", ("n", i + 1))));
                    break;
                }
            }
        }
        if (named.Length > 0)
        {
            var seen = new HashSet<string>();
            foreach (var token in allTokens)
            {
                if (Regex.IsMatch(token, @"^\d+$")) continue;
                if (!seen.Add(token))
                {
                    issues.Add(new(field, Text("templatesValidation", "DuplicateNamedVariableVInBody", ("v", token))));
                    break;
                }
            }
        }
        if (vars.Any(v => string.IsNullOrWhiteSpace(examples.GetValueOrDefault(v))))
            issues.Add(new(field, Text("templatesValidation", "addAnExampleValueForEachBody")));
    }

    public static IReadOnlyList<ValidationIssue> ValidateDraft(TemplateDraft draft)
    {
        var issues = new List<ValidationIssue>();
        var name = draft.Name.Trim();
        if (string.IsNullOrEmpty(name))
            issues.Add(new("name", Text("templatesValidation", "templateNameIsRequired")));
        else if (!Regex.IsMatch(name, @"^[a-z0-9][a-z0-9_]*$"))
            issues.Add(new("name", Text("templatesValidation", "useLowercaseLettersNumbersAndUnderscoresOnly")));
        else if (name.Length > Limits.Name)
            issues.Add(new("name", Text("templatesValidation", "nameMustBeAtMostMaxCharacters", ("max", Limits.Name))));

        if (string.IsNullOrWhiteSpace(draft.Language))
            issues.Add(new("language", Text("templatesValidation", "languageCodeIsRequired")));

        var kindLabels = GetKindLabels();
        var categoryLabels = GetCategoryLabels();
        var allowedCats = kindLabels[draft.Kind].Categories;
        if (!allowedCats.Contains(draft.Category))
            issues.Add(new("category", Text("templatesValidation", "CategoryMustBeLabelForThisTemplate",
                ("label", string.Join(" / ", allowedCats.Select(c => categoryLabels[c].Label))))));

        if (draft.Kind == "authentication")
        {
            if (!string.IsNullOrWhiteSpace(draft.CodeExpirationMinutes))
            {
                if (!double.TryParse(draft.CodeExpirationMinutes, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
                    || n != Math.Floor(n) || n < 1 || n > 90)
                    issues.Add(new("codeExpirationMinutes", Text("templatesValidation", "codeExpirationMustBeBetween1And")));
            }
            var otp = draft.AuthButton;
            if (otp.OtpType is "ONE_TAP" or "ZERO_TAP")
            {
                var apps = otp.SupportedApps ?? [];
                if (apps.Count == 0)
                    issues.Add(new("authButton", Text("templatesValidation", "oneTapAndZeroTapRequireAt")));
                for (var idx = 0; idx < apps.Count; idx++)
                {
                    var app = apps[idx];
                    if (string.IsNullOrWhiteSpace(app.PackageName) || app.SignatureHash.Trim().Length != 11)
                        issues.Add(new("authButton", Text("templatesValidation", "AppIRequiresAndroidPackageNameAnd", ("i", idx + 1))));
                }
                if (otp.OtpType == "ZERO_TAP" && otp.ZeroTapTermsAccepted != true)
                    issues.Add(new("authButton", Text("templatesValidation", "acceptZeroTapTermsBeforeSubmittingA")));
            }
            return issues;
        }

        if (draft.Kind is not ("carousel" or "productCarousel" or "catalog"))
        {
            var h = draft.Header;
            if (h.Format == "TEXT")
            {
                if (h.Text.Length > Limits.HeaderText)
                    issues.Add(new("header", Text("templatesValidation", "TextHeaderMustBeAtMostMax", ("max", Limits.HeaderText))));
                var vars = Variables(h.Text);
                if (vars.Length > 1)
                    issues.Add(new("header", Text("templatesValidation", "textHeaderSupportsAtMostOneVariable")));
                foreach (var v in vars)
                    if (string.IsNullOrWhiteSpace(h.Examples.GetValueOrDefault(v)))
                        issues.Add(new("header", Text("templatesValidation", "addAnExampleValueForEachHeader")));
            }
            else if (h.Format is "IMAGE" or "VIDEO" or "DOCUMENT")
            {
                if (string.IsNullOrWhiteSpace(h.SampleHandle))
                    issues.Add(new("header", Text("templatesValidation", "uploadASampleFileOrProvideA", ("format", h.Format))));
            }
        }

        var bodyText = draft.Body.Text.Trim();
        if (string.IsNullOrEmpty(bodyText))
            issues.Add(new("body", Text("templatesValidation", "bodyTextIsRequired")));
        else if (draft.Body.Text.Length > Limits.Body)
            issues.Add(new("body", Text("templatesValidation", "BodyMustBeAtMostMaxCharacters", ("max", Limits.Body), ("current", draft.Body.Text.Length))));
        else
            CheckBodyVariables(draft.Body.Text, draft.Body.Examples, "body", issues);

        if (!string.IsNullOrEmpty(draft.Footer))
        {
            if (draft.Kind == "offer")
                issues.Add(new("footer", Text("templatesValidation", "limitedTimeOfferTemplatesCannotIncludeA")));
            if (draft.Footer.Length > Limits.Footer)
                issues.Add(new("footer", Text("templatesValidation", "FooterMustBeAtMostMaxCharacters", ("max", Limits.Footer))));
            if (Variables(draft.Footer).Length > 0)
                issues.Add(new("footer", Text("templatesValidation", "footerCannotContainVariables")));
        }

        if (draft.Kind == "offer")
        {
            if (string.IsNullOrWhiteSpace(draft.OfferText))
                issues.Add(new("offerText", Text("templatesValidation", "limitedTimeOfferTextIsRequired")));
            else if (draft.OfferText.Length > Limits.OfferText)
                issues.Add(new("offerText", Text("templatesValidation", "OfferTextMustBeAtMostMax", ("max", Limits.OfferText))));
            if (!draft.Buttons.Any(b => b.Type is "COPY_CODE" or "URL"))
                issues.Add(new("buttons", Text("templatesValidation", "offerTemplatesRequireACopyCodeOr")));
        }

        if (draft.Kind == "coupon" && !draft.Buttons.Any(b => b.Type == "COPY_CODE"))
            issues.Add(new("buttons", Text("templatesValidation", "couponTemplatesRequireACopyCodeButton")));

        if (draft.Buttons.Count > Limits.MaxButtons)
            issues.Add(new("buttons", Text("templatesValidation", "atMostMaxButtonsAreAllowed", ("max", Limits.MaxButtons))));

        var seenCtaAfterQr = false;
        var seenQr = false;
        var seenCta = false;
        foreach (var b in draft.Buttons)
        {
            var isQr = b.Type == "QUICK_REPLY";
            if (isQr && seenCta && seenQr) seenCtaAfterQr = true;
            if (!isQr && seenQr && seenCta && draft.Buttons[0].Type != "QUICK_REPLY") seenCtaAfterQr = true;
            if (isQr) seenQr = true;
            else seenCta = true;
        }
        var transitions = 0;
        for (var i = 1; i < draft.Buttons.Count; i++)
        {
            var prevQr = draft.Buttons[i - 1].Type == "QUICK_REPLY";
            var curQr = draft.Buttons[i].Type == "QUICK_REPLY";
            if (prevQr != curQr) transitions++;
        }
        if (transitions > 1 || seenCtaAfterQr)
            issues.Add(new("buttons", Text("templatesValidation", "QuickReplyButtonsMustBeGroupedTogether")));

        for (var idx = 0; idx < draft.Buttons.Count; idx++)
        {
            var b = draft.Buttons[idx];
            var i = idx + 1;
            if (b.Type != "COPY_CODE" && b.Type != "OTP")
            {
                if (string.IsNullOrWhiteSpace(b.Text))
                    issues.Add(new("buttons", Text("templatesValidation", "ButtonITextIsRequired", ("i", i))));
                else if (b.Text.Length > Limits.ButtonText)
                    issues.Add(new("buttons", Text("templatesValidation", "ButtonITextMustBeAtMost", ("i", i), ("max", Limits.ButtonText))));
            }
            if (b.Type == "URL")
            {
                if (!IsWebUrl(b.Url))
                    issues.Add(new("buttons", Text("templatesValidation", "UrlButtonIRequiresValidHttpsUrl", ("i", i))));
                var vars = Variables(b.Url ?? "");
                if (vars.Length > 1)
                    issues.Add(new("buttons", Text("templatesValidation", "UrlButtonISupportsAtMostOne", ("i", i))));
                if (vars.Length == 1 && !IsWebUrl(b.UrlExample))
                    issues.Add(new("buttons", Text("templatesValidation", "AddAFullExampleUrlForButton", ("i", i))));
            }
            if (b.Type == "PHONE_NUMBER")
            {
                var p = (b.PhoneNumber ?? "").Trim();
                if (string.IsNullOrEmpty(p) || p.Length > Limits.Phone || !Regex.IsMatch(p, @"^\+?[0-9]{6,20}$"))
                    issues.Add(new("buttons", Text("templatesValidation", "PhoneButtonIRequiresPhoneNumberWith", ("i", i))));
            }
            if (b.Type == "COPY_CODE")
            {
                var ex = (b.Example ?? "").Trim();
                if (string.IsNullOrEmpty(ex))
                    issues.Add(new("buttons", Text("templatesValidation", "CopyCodeButtonIRequiresAnExample", ("i", i))));
                else if (ex.Length > Limits.CopyCode)
                    issues.Add(new("buttons", Text("templatesValidation", "CopyCodeExampleInButtonIMust", ("i", i), ("max", Limits.CopyCode))));
            }
            if (b.Type == "FLOW" && string.IsNullOrWhiteSpace(b.FlowId))
                issues.Add(new("buttons", Text("templatesValidation", "FlowButtonIRequiresAFlowId", ("i", i))));
        }

        if (draft.Kind is "carousel" or "productCarousel")
        {
            if (draft.Cards.Count < Limits.MinCards || draft.Cards.Count > Limits.MaxCards)
                issues.Add(new("cards", Text("templatesValidation", "CarouselRequiresBetweenMinAndMaxCards", ("min", Limits.MinCards), ("max", Limits.MaxCards))));
            var formats = draft.Cards.Select(c => c.HeaderFormat).Distinct().Count();
            if (formats > 1)
                issues.Add(new("cards", Text("templatesValidation", "allCarouselCardsMustUseTheSame")));
            var buttonSigs = draft.Cards.Select(c => string.Join(",", c.Buttons.Select(b => b.Type))).Distinct().Count();
            if (buttonSigs > 1)
                issues.Add(new("cards", Text("templatesValidation", "allCarouselCardsMustUseTheSame2")));

            for (var idx = 0; idx < draft.Cards.Count; idx++)
            {
                var card = draft.Cards[idx];
                var i = idx + 1;
                if (card.HeaderFormat != "PRODUCT")
                {
                    if (string.IsNullOrWhiteSpace(card.SampleHandle))
                        issues.Add(new("cards", Text("templatesValidation", "CardIRequiresAHeaderSampleHandle", ("i", i))));
                    if (string.IsNullOrWhiteSpace(card.Body))
                        issues.Add(new("cards", Text("templatesValidation", "CardIBodyTextIsRequired", ("i", i))));
                    else if (card.Body.Length > Limits.CardBody)
                        issues.Add(new("cards", Text("templatesValidation", "CardIBodyMustBeAtMost", ("i", i), ("max", Limits.CardBody))));
                    var vars = Variables(card.Body);
                    if (vars.Any(v => string.IsNullOrWhiteSpace(card.BodyExamples.GetValueOrDefault(v))))
                        issues.Add(new("cards", Text("templatesValidation", "CardINeedsAnExampleForEvery", ("i", i))));
                }
                if (card.Buttons.Count > Limits.MaxCardButtons)
                    issues.Add(new("cards", Text("templatesValidation", "CardIAllowsAtMostMaxButtons", ("i", i), ("max", Limits.MaxCardButtons))));
                for (var bIdx = 0; bIdx < card.Buttons.Count; bIdx++)
                {
                    var b = card.Buttons[bIdx];
                    var j = bIdx + 1;
                    if (b.Type != "SPM" && string.IsNullOrWhiteSpace(b.Text))
                        issues.Add(new("cards", Text("templatesValidation", "CardIButtonJTextIsRequired", ("i", i), ("j", j))));
                    if (b.Type == "URL" && !IsWebUrl(b.Url))
                        issues.Add(new("cards", Text("templatesValidation", "CardIButtonJRequiresValidHttps", ("i", i), ("j", j))));
                    if (b.Type == "URL" && Variables(b.Url ?? "").Length > 0 && !IsWebUrl(b.UrlExample))
                        issues.Add(new("cards", Text("templatesValidation", "CardIButtonJNeedsAnExample", ("i", i), ("j", j))));
                    if (b.Type == "PHONE_NUMBER" && string.IsNullOrWhiteSpace(b.PhoneNumber))
                        issues.Add(new("cards", Text("templatesValidation", "CardIButtonJRequiresPhoneNumber", ("i", i), ("j", j))));
                }
            }
        }

        return issues;
    }

    public static IReadOnlyDictionary<string, TemplateMediaLimit> GetTemplateMediaLimits() => new Dictionary<string, TemplateMediaLimit>
    {
        ["IMAGE"] = new("image/jpeg,image/png", ["image/jpeg", "image/png"], 5L * 1024 * 1024, Text("mediaLibrary", "image")),
        ["VIDEO"] = new("video/mp4", ["video/mp4"], 16L * 1024 * 1024, Text("messages", "video")),
        ["DOCUMENT"] = new("application/pdf", ["application/pdf"], 100L * 1024 * 1024, "PDF")
    };

    public static string? ValidateTemplateMedia(string? fileName, long fileSize, string? mimeType, string format)
    {
        var limits = GetTemplateMediaLimits();
        if (!limits.TryGetValue(format, out var spec)) return null;
        if (string.IsNullOrEmpty(fileName) && mimeType == null)
            return Text("templatesUpload", "SelectAFileForLabelHeaderWait", ("label", spec.Label));
        if (fileSize <= 0)
            return Text("templatesUpload", "LabelIsEmptyChooseANonEmpty", ("label", spec.Label));
        if (fileSize > spec.MaxBytes)
        {
            var maxMb = Math.Round(spec.MaxBytes / (1024.0 * 1024.0));
            var sizeMb = (fileSize / (1024.0 * 1024.0)).ToString("F1", CultureInfo.InvariantCulture) + " MB";
            return Text("templatesUpload", "LabelIsSizeMaximumForThisHeader", ("label", spec.Label), ("size", sizeMb), ("maxMb", maxMb));
        }
        var type = (mimeType ?? "").ToLowerInvariant();
        if (string.IsNullOrEmpty(type) && !string.IsNullOrEmpty(fileName))
        {
            var ext = Path.GetExtension(fileName).ToLowerInvariant();
            type = ext switch { ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png", ".mp4" => "video/mp4", ".pdf" => "application/pdf", _ => "" };
        }
        if (!spec.MimeTypes.Contains(type))
        {
            var formats = string.Join(", ", spec.MimeTypes.Select(m => m.Split('/').Last().ToUpperInvariant()));
            return Text("templatesUpload", "LabelHasUnsupportedFormatTypeUseFormats",
                ("label", spec.Label), ("type", string.IsNullOrEmpty(type) ? "unknown" : type), ("formats", formats));
        }
        return null;
    }

    public static string? UnsupportedTemplateReason(JObject t)
    {
        var buttons = GetComponent(t, "BUTTONS")?["buttons"] as JArray ?? [];
        if (buttons.Any(b => Type(b) == "FLOW" && b["flow_id"] == null))
            return Text("templatesSend", "flowButtonsWithoutASavedFlowId");
        var kind = InferKind(t);
        if (kind is "catalog" or "mpm" or "product" or "productCarousel")
            return Text("templatesSend", "CatalogAndProductTemplatesRequireCatalogProduct");
        if (kind == "authentication")
            return Text("templatesSend", "AuthenticationTemplatesMustBeSentFromYour");
        return null;
    }

    public static TemplateSendValues ExampleSendValues(JObject t)
    {
        var header = GetComponent(t, "HEADER");
        var body = GetComponent(t, "BODY");
        var buttons = GetComponent(t, "BUTTONS")?["buttons"] as JArray ?? [];
        var carousel = GetComponent(t, "CAROUSEL");
        var headerVars = GetHeaderExamples(header);
        var bodyVars = GetBodyExamples(body);

        if (header != null && ((string?)header["format"])?.ToUpperInvariant() == "TEXT")
            foreach (var v in Variables((string?)header["text"] ?? ""))
                if (!headerVars.ContainsKey(v)) headerVars[v] = $"[{v}]";

        if (body != null && !string.IsNullOrEmpty((string?)body["text"]))
            foreach (var v in Variables((string?)body["text"] ?? ""))
                if (!bodyVars.ContainsKey(v)) bodyVars[v] = v == "1" ? "Maria" : v == "2" ? "#1042" : $"[{v}]";

        var buttonUrlVars = new Dictionary<int, string>();
        var buttonCouponCodes = new Dictionary<int, string>();
        for (var idx = 0; idx < buttons.Count; idx++)
        {
            var b = buttons[idx];
            var bt = Type(b);
            if (bt == "URL" && Variables((string?)b["url"] ?? "").Length > 0)
            {
                var ex = b["example"] is JArray arr ? (string?)arr.FirstOrDefault() : (string?)b["example"];
                buttonUrlVars[idx] = !string.IsNullOrEmpty(ex) ? ex! : Text("templatesSend", "Confirmado");
            }
            if (bt == "COPY_CODE")
            {
                var ex = b["example"] is JArray arr ? (string?)arr.FirstOrDefault() : (string?)b["example"];
                buttonCouponCodes[idx] = !string.IsNullOrEmpty(ex) ? ex! : "PROMO10";
            }
        }

        var cardMediaUrls = new Dictionary<int, string>();
        var cardProductIds = new Dictionary<int, string>();
        var cardBodyVars = new Dictionary<int, Dictionary<string, string>>();
        var cardButtonUrlVars = new Dictionary<int, Dictionary<int, string>>();
        var cards = carousel?["cards"] as JArray ?? [];
        for (var idx = 0; idx < cards.Count; idx++)
        {
            var cardComps = cards[idx]["components"] as JArray ?? [];
            var ch = cardComps.OfType<JObject>().FirstOrDefault(c => Type(c) == "HEADER");
            var cb = cardComps.OfType<JObject>().FirstOrDefault(c => Type(c) == "BODY");
            var cbtns = cardComps.OfType<JObject>().FirstOrDefault(c => Type(c) == "BUTTONS")?["buttons"] as JArray ?? [];
            var hHandle = (string?)(ch?["example"]?["header_handle"] as JArray)?.FirstOrDefault();
            if (!string.IsNullOrEmpty(hHandle)) cardMediaUrls[idx] = hHandle!;
            if (((string?)ch?["format"])?.ToUpperInvariant() == "PRODUCT") cardProductIds[idx] = $"SKU-{idx + 1}";
            var cbExamples = GetBodyExamples(cb);
            if (cb != null && !string.IsNullOrEmpty((string?)cb["text"]))
                foreach (var v in Variables((string?)cb["text"] ?? ""))
                    if (!cbExamples.ContainsKey(v)) cbExamples[v] = $"[{v}]";
            cardBodyVars[idx] = cbExamples;
            var btnMap = new Dictionary<int, string>();
            for (var bIdx = 0; bIdx < cbtns.Count; bIdx++)
            {
                var b = cbtns[bIdx];
                if (Type(b) == "URL" && Variables((string?)b["url"] ?? "").Length > 0)
                {
                    var ex = b["example"] is JArray arr ? (string?)arr.FirstOrDefault() : (string?)b["example"];
                    btnMap[bIdx] = !string.IsNullOrEmpty(ex) ? ex! : Text("templatesSend", "Confirmado");
                }
            }
            cardButtonUrlVars[idx] = btnMap;
        }

        return new TemplateSendValues
        {
            HeaderVars = headerVars,
            BodyVars = bodyVars,
            HeaderMediaUrl = (string?)(header?["example"]?["header_handle"] as JArray)?.FirstOrDefault(),
            LocationCoords = Text("templatesSend", "235505466333"),
            LocationName = Text("templatesSend", "AvPaulista1000"),
            LocationAddress = Text("templatesSend", "S0PauloSp"),
            ProductRetailerId = "SKU-001",
            ButtonUrlVars = buttonUrlVars,
            ButtonCouponCodes = buttonCouponCodes,
            CardMediaUrls = cardMediaUrls,
            CardProductIds = cardProductIds,
            CardBodyVars = cardBodyVars,
            CardButtonUrlVars = cardButtonUrlVars,
            MpmThumbnailProductId = "SKU-001",
            MpmSectionsText = "Destaques | SKU-001, SKU-002",
            AuthCode = Text("templatesSend", "123456")
        };
    }
}
