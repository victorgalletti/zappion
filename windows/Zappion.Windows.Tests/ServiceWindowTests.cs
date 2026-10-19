// SPDX-License-Identifier: AGPL-3.0-only
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ServiceWindowTests
{
    private static readonly DateTimeOffset Close = DateTimeOffset.Parse("2026-10-17T12:00:00Z");
    [Theory]
    [InlineData(1440, "24h left", 0)]
    [InlineData(1439, "23h left", 59)]
    [InlineData(60, "1h left", 0)]
    [InlineData(59, "55 min left", 4)]
    [InlineData(5, "5 min left", 0)]
    [InlineData(4, "0 min left", 4)]
    public void UpdatesOnlyWhenBucketChanges(int remaining, string text, int nextMinutes)
    {
        var now = Close.AddMinutes(-remaining);
        var state = ServiceWindow.Evaluate(Close, now);
        Assert.True(state.Open); Assert.Equal(text, state.Text);
        Assert.Equal(now.AddMinutes(nextMinutes).AddMilliseconds(remaining < 5 ? 0 : 1), state.Next);
        Assert.Equal(text, ServiceWindow.Evaluate(Close, state.Next!.Value.AddMilliseconds(-1)).Text);
        Assert.NotEqual(text, ServiceWindow.Evaluate(Close, state.Next.Value).Text);
    }
    [Fact]
    public void ClosesExactly24HoursAfterIncomingAndMissingTimestampIsClosed()
    {
        Assert.True(ServiceWindow.FromIncoming(Close.AddHours(-24).ToString("O"), Close.AddMilliseconds(-1)).Open);
        Assert.False(ServiceWindow.FromIncoming(Close.AddHours(-24).ToString("O"), Close).Open);
        Assert.False(ServiceWindow.FromIncoming(null, Close).Open);
        Assert.Null(ServiceWindow.FromIncoming("invalid", Close).Next);
        Assert.Equal(Close, ServiceWindow.FromIncoming(Close.AddHours(-24).ToString("O"), Close).ClosesAt);
    }
}
