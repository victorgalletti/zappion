// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;

namespace Zappion.Windows.Core;

// Mirrors the query sharing and cached-data behavior of useTemplates in web/hooks/use-chat.ts.
internal sealed class TemplateCache(Func<DateTimeOffset>? clock = null)
{
    internal sealed record Lists(IReadOnlyList<JObject> All, IReadOnlyList<JObject> Approved);
    private sealed class Entry
    {
        public Lists? Value;
        public DateTimeOffset At;
    }

    private readonly object gate = new();
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private readonly Dictionary<(string Org, string Address), Entry> entries = new();
    private readonly Dictionary<(string Org, string Address), Task<Lists>> flights = new();
    private long epoch;
    public event Action<string, string>? Changed;

    public Task<Lists> GetAsync(string organizationId, string address, Func<bool, Task<Lists>> fetch, bool forceRefresh = false)
    {
        var key = (organizationId, address);
        lock (gate)
        {
            if (!entries.TryGetValue(key, out var entry)) entries[key] = entry = new();
            var cached = entry.Value;
            if (!forceRefresh && cached != null)
            {
                if (now() - entry.At > TimeSpan.FromMinutes(10) && !flights.ContainsKey(key))
                    Start(key, entry, fetch, true);
                return Task.FromResult(cached);
            }
            if (flights.TryGetValue(key, out var flight))
                return AwaitCurrentAsync(key, entry, flight, fetch, epoch);
            return Start(key, entry, fetch, false);
        }
    }

    private async Task<Lists> AwaitCurrentAsync((string Org, string Address) key, Entry entry, Task<Lists> flight, Func<bool, Task<Lists>> fetch, long expectedEpoch)
    {
        var value = await flight.ConfigureAwait(false);
        Task<Lists> next;
        lock (gate)
        {
            // Waiters from a signed-out session must not start another request.
            if (epoch != expectedEpoch || entry.Value != null) return value;
            // An invalidation during the previous fetch requires a new request.
            next = GetAsync(key.Org, key.Address, fetch, true);
        }
        return await next.ConfigureAwait(false);
    }

    private Task<Lists> Start((string Org, string Address) key, Entry entry, Func<bool, Task<Lists>> fetch, bool background)
    {
        var completion = new TaskCompletionSource<Lists>(TaskCreationOptions.RunContinuationsAsynchronously);
        flights[key] = completion.Task;
        if (background) _ = ObserveAsync(completion.Task);
        _ = RefreshAsync();
        return completion.Task;

        async Task RefreshAsync()
        {
            try
            {
                var value = await fetch(background).ConfigureAwait(false);
                lock (gate)
                {
                    flights.Remove(key);
                    if (entries.TryGetValue(key, out var current) && ReferenceEquals(entry, current))
                    {
                        entry.Value = value;
                        entry.At = now();
                        try { Changed?.Invoke(key.Org, key.Address); }
                        catch (Exception ex) { AppLog.Error("Templates changed callback failed", ex); }
                    }
                }
                completion.TrySetResult(value);
            }
            catch (Exception ex)
            {
                lock (gate) flights.Remove(key);
                completion.TrySetException(ex);
            }
        }
    }

    private static async Task ObserveAsync(Task<Lists> refresh)
    {
        try { await refresh.ConfigureAwait(false); }
        catch (Exception ex) { AppLog.Error("Background templates refresh failed", ex); }
    }

    public void Invalidate(string organizationId, string address)
    {
        lock (gate) entries.Remove((organizationId, address));
    }

    public void Clear()
    {
        lock (gate)
        {
            epoch++;
            entries.Clear();
        }
    }
}
