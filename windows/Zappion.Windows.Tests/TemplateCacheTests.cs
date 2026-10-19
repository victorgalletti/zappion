// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class TemplateCacheTests
{
    private static TemplateCache.Lists Data(string name) => new([new JObject { ["name"] = name }], []);
    private static TaskCompletionSource<TemplateCache.Lists> Pending() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    [Fact]
    public async Task StaleReadsReturnImmediatelyAndShareRefreshWithForcedReads()
    {
        var now = DateTimeOffset.UtcNow;
        var cache = new TemplateCache(() => now);
        var original = Data("old");
        await cache.GetAsync("org", "number", _ => Task.FromResult(original));
        now += TimeSpan.FromMinutes(10);
        Assert.Same(original, await cache.GetAsync("org", "number", _ => throw new Exception("Still fresh")));
        now += TimeSpan.FromTicks(1);
        var pending = Pending();
        var calls = 0;
        Task<TemplateCache.Lists> Fetch(bool background) { Assert.True(background); calls++; return pending.Task; }
        var changed = new TaskCompletionSource<(string, string)>(TaskCreationOptions.RunContinuationsAsynchronously);
        cache.Changed += (org, address) => changed.TrySetResult((org, address));
        Assert.Same(original, await cache.GetAsync("org", "number", Fetch).WaitAsync(TimeSpan.FromSeconds(1)));
        Assert.Same(original, await cache.GetAsync("org", "number", Fetch));
        var forced = cache.GetAsync("org", "number", Fetch, true);
        Assert.False(forced.IsCompleted);
        Assert.Equal(1, calls);
        var updated = Data("new");
        pending.SetResult(updated);
        Assert.Same(updated, await forced.WaitAsync(TimeSpan.FromSeconds(2)));
        Assert.Equal(("org", "number"), await changed.Task.WaitAsync(TimeSpan.FromSeconds(2)));
        Assert.Same(updated, await cache.GetAsync("org", "number", _ => throw new Exception("Fresh")));
    }

    [Fact]
    public async Task ColdAndForcedRequestsWaitAndNumbersAndOrganizationsLoadIndependently()
    {
        var cache = new TemplateCache();
        var pending = Pending();
        var first = cache.GetAsync("org", "one", background => { Assert.False(background); return pending.Task; });
        var duplicate = cache.GetAsync("org", "one", _ => throw new Exception("Duplicate request"));
        Assert.False(first.IsCompleted);
        var other = Data("other");
        Assert.Same(other, await cache.GetAsync("org", "two", _ => Task.FromResult(other)));
        Assert.Same(other, await cache.GetAsync("other-org", "one", _ => Task.FromResult(other)));
        var original = Data("first");
        pending.SetResult(original);
        Assert.Same(original, await first);
        Assert.Same(original, await duplicate);
        var refresh = Pending();
        var forced = cache.GetAsync("org", "one", background => { Assert.False(background); return refresh.Task; }, true);
        Assert.False(forced.IsCompleted);
        refresh.SetResult(other);
        Assert.Same(other, await forced);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InvalidationAndClearDiscardInflightResultsAndEvents(bool clear)
    {
        var cache = new TemplateCache();
        var pending = Pending();
        var events = 0;
        cache.Changed += (_, _) => events++;
        var first = cache.GetAsync("org", "one", _ => pending.Task);
        if (clear) cache.Clear(); else cache.Invalidate("org", "one");
        var calls = 0;
        var updated = Data("new");
        var next = cache.GetAsync("org", "one", _ => { calls++; return Task.FromResult(updated); });
        Assert.Equal(0, calls);
        pending.SetResult(Data("obsolete"));
        await first;
        Assert.Same(updated, await next.WaitAsync(TimeSpan.FromSeconds(2)));
        Assert.Equal(1, calls);
        Assert.Equal(1, events);
    }

    [Fact]
    public async Task ClearDoesNotLetExistingWaitersRestartFetchesAfterSignOut()
    {
        var cache = new TemplateCache();
        var pending = Pending();
        var calls = 0;
        Task<TemplateCache.Lists> Fetch(bool _) { calls++; return pending.Task; }
        var first = cache.GetAsync("org", "one", Fetch);
        var duplicate = cache.GetAsync("org", "one", Fetch);
        var events = 0;
        cache.Changed += (_, _) => events++;
        cache.Clear();
        pending.SetResult(Data("old-session"));
        await Task.WhenAll(first, duplicate).WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(1, calls);
        Assert.Equal(0, events);
        var updated = Data("new-session");
        Assert.Same(updated, await cache.GetAsync("org", "one", _ => Task.FromResult(updated)));
    }

    [Fact]
    public async Task FailedRefreshPreservesCachedDataAndAllowsRetry()
    {
        var now = DateTimeOffset.UtcNow;
        var cache = new TemplateCache(() => now);
        var original = Data("old");
        await cache.GetAsync("org", "one", _ => Task.FromResult(original));
        now += TimeSpan.FromMinutes(11);
        var events = 0;
        cache.Changed += (_, _) => events++;
        Assert.Same(original, await cache.GetAsync("org", "one", _ => Task.FromException<TemplateCache.Lists>(new IOException("offline"))));
        Assert.Equal(0, events);
        await Assert.ThrowsAsync<IOException>(() => cache.GetAsync("org", "one", _ => Task.FromException<TemplateCache.Lists>(new IOException("offline")), true));
        var updated = Data("new");
        Assert.Same(updated, await cache.GetAsync("org", "one", _ => Task.FromResult(updated), true));
        Assert.Equal(1, events);
    }
}
