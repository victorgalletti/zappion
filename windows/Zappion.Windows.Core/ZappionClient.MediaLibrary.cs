// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Net.Http.Headers;
using Newtonsoft.Json;

namespace Zappion.Windows.Core;

// Mirrors web/hooks/use-media-library.ts and the forward check in web/components/media-library.tsx.
public sealed partial class ZappionClient
{
    private string RestUrl(string pathAndQuery) => functionsUrl.Replace("/functions/v1/", "/rest/v1/") + pathAndQuery;

    private async Task<(string Body, int? Count)> RestGetAsync(string pathAndQuery, bool count = false, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, RestUrl(pathAndQuery));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Session?.AccessToken ?? "");
        request.Headers.Add("apikey", settingsPublicKey);
        if (count) request.Headers.Add("Prefer", "count=exact");
        using var response = await http.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            string? message = null;
            try { message = (string?)Newtonsoft.Json.Linq.JObject.Parse(body)["message"]; } catch (JsonException) { }
            throw new InvalidOperationException(message ?? $"HTTP {(int)response.StatusCode}");
        }
        int? total = null;
        var range = response.Content.Headers.TryGetValues("Content-Range", out var values) || response.Headers.TryGetValues("Content-Range", out values) ? values.FirstOrDefault() : null;
        if (range is not null && int.TryParse(range.Split('/').Last(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)) total = parsed;
        return (body, total);
    }

    private static List<T> ReadRows<T>(string body) =>
        JsonConvert.DeserializeObject<List<T>>(body, Supabase.Postgrest.Client.SerializerSettings(new Supabase.Postgrest.ClientOptions())) ?? [];

    public async Task<MediaPage> GetMediaPageAsync(string organizationId, MediaFilters filters, MediaCursor? cursor, CancellationToken cancellationToken = default)
    {
        var (body, count) = await RestGetAsync("messages?" + MediaLibrary.Query(organizationId, filters, cursor), true, cancellationToken);
        var rows = ReadRows<MessageRow>(body);
        var next = rows.Count == MediaLibrary.PageSize ? new MediaCursor(rows[^1].Timestamp, rows[^1].Id) : null;
        return new MediaPage(rows, count ?? rows.Count, next);
    }

    /// <summary>Metadata is paged too, so selectors do not silently stop at the API row limit.</summary>
    private async Task<List<T>> ReadAllAsync<T>(string table, string columns, string organizationId, string order, bool whatsapp)
    {
        var rows = new List<T>();
        for (var offset = 0; ; offset += 500)
        {
            var query = $"{table}?select={columns}&organization_id=eq.{Uri.EscapeDataString(organizationId)}&order={order}" +
                (table == "contacts_addresses" ? ",organization_address" : "") + (whatsapp ? "&service=eq.whatsapp" : "") +
                $"&offset={offset}&limit=500";
            var page = ReadRows<T>((await RestGetAsync(query)).Body);
            rows.AddRange(page);
            if (page.Count < 500) return rows;
        }
    }

    public async Task<MediaPeople> GetMediaPeopleAsync(string organizationId)
    {
        var agents = ReadAllAsync<AgentRow>("agents", "id,name,picture", organizationId, "id", false);
        var contacts = ReadAllAsync<ContactAddressRow>("contacts_addresses", "address,organization_address,extra", organizationId, "address", true);
        var conversations = ReadAllAsync<ConversationRow>("conversations", "*", organizationId, "id", true);
        await Task.WhenAll(agents, contacts, conversations);
        return new MediaPeople(await agents, await contacts, await conversations);
    }

    /// <summary>Timestamp of the conversation's last incoming message, or null.</summary>
    public async Task<DateTimeOffset?> GetLastIncomingAtAsync(string organizationId, string conversationId)
    {
        var (body, _) = await RestGetAsync($"messages?select=timestamp&organization_id=eq.{Uri.EscapeDataString(organizationId)}" +
            $"&conversation_id=eq.{Uri.EscapeDataString(conversationId)}&sender_address=not.is.null&order=timestamp.desc&limit=1");
        var stamp = (string?)Newtonsoft.Json.Linq.JArray.Parse(body).FirstOrDefault()?["timestamp"];
        return stamp is not null && DateTimeOffset.TryParse(stamp, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at) ? at : null;
    }
}
