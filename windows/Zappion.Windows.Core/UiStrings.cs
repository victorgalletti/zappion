// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Xml.Linq;

namespace Zappion.Windows.Core;

// Wording mirrors web/lib/i18n/en.ts and pt-BR.ts. Shared with previews and notifications.
public static class UiStrings
{
    private static readonly Dictionary<string, Dictionary<string, string>> resources = new();
    public static IReadOnlyList<string> Keys
    {
        get {
            using var stream = typeof(UiStrings).Assembly.GetManifestResourceStream("Strings/en-US/Resources.resw")!;
            return XDocument.Load(stream).Root!.Elements("data").Select(e => (string)e.Attribute("name")!).ToArray();
        }
    }
    public static string Get(string key)
    {
        var language = CultureInfo.CurrentUICulture.Name.StartsWith("pt", StringComparison.OrdinalIgnoreCase) ? "pt-BR" : "en-US";
        lock (resources)
        {
            if (!resources.TryGetValue(language, out var values))
            {
                using var stream = typeof(UiStrings).Assembly.GetManifestResourceStream($"Strings/{language}/Resources.resw")!;
                values = XDocument.Load(stream).Root!.Elements("data").ToDictionary(e => (string)e.Attribute("name")!, e => e.Element("value")!.Value);
                resources[language] = values;
            }
            return values.GetValueOrDefault(key, key);
        }
    }
}
