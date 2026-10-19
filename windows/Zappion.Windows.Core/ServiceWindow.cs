// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

public sealed record ServiceWindowState(bool Open, string Text, DateTimeOffset? Next, DateTimeOffset? ClosesAt)
{
    public string Title => ClosesAt is { } at ? string.Format(UiStrings.Get("WindowClosesAt"), at.ToLocalTime().ToString("G")) : UiStrings.Get("WindowNoMessages");
}

// Mirrors web/hooks/use-service-window.ts, including the millisecond past each bucket boundary.
public static class ServiceWindow
{
    public static ServiceWindowState FromIncoming(string? timestamp, DateTimeOffset now) =>
        Evaluate(DateTimeOffset.TryParse(timestamp, out var at) ? at.AddHours(24) : null, now);

    public static ServiceWindowState Evaluate(DateTimeOffset? closesAt, DateTimeOffset now)
    {
        var remaining = closesAt - now;
        if (remaining is null || remaining <= TimeSpan.Zero)
            return new(false, UiStrings.Get("WindowClosed"), null, closesAt);
        if (remaining.Value.TotalHours >= 1)
        {
            var hours = (int)Math.Floor(remaining.Value.TotalHours);
            return new(true, string.Format(UiStrings.Get("WindowHours"), hours), closesAt!.Value.AddHours(-hours).AddMilliseconds(1), closesAt);
        }
        var minutes = (int)Math.Floor(remaining.Value.TotalMinutes / 5) * 5;
        return new(true, string.Format(UiStrings.Get("WindowMinutes"), minutes), minutes > 0 ? closesAt!.Value.AddMinutes(-minutes).AddMilliseconds(1) : closesAt, closesAt);
    }
}
