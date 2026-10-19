// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class MediaPageRetentionTests
{
    private static MessageRow Row(string id, string timestamp, string text = "") =>
        new() { Id = id, Timestamp = timestamp, Content = new JObject { ["text"] = text } };

    [Fact]
    public void RefreshKeepsOlderPagesAndUpsertsOverlappingRows()
    {
        var oldest = Row("old", "2026-10-01T00:00:00Z");
        var original = Row("existing", "2026-10-15T00:00:00Z", "before");
        var updated = Row("existing", original.Timestamp, "after");
        var newest = Row("new", "2026-10-16T00:00:00Z");

        var merged = MediaLibrary.MergeRows([original, oldest], [newest, updated, updated]);

        Assert.Equal(["new", "existing", "old"], merged.Select(r => r.Id));
        Assert.Same(updated, merged[1]);
        Assert.Same(oldest, merged[2]);
        Assert.Equal("before", (string?)original.Content?["text"]);
    }

    [Fact]
    public void MergeUsesTimestampAndDescendingIdLikeThePageCursor()
    {
        var merged = MediaLibrary.MergeRows([], [Row("a", "2026-10-16T00:00:00Z"),
            Row("z", "2026-10-15T21:00:00-03:00"), Row("b", "2026-10-16T00:00:00Z")]);

        Assert.Equal(["z", "b", "a"], merged.Select(r => r.Id));
        Assert.Empty(MediaLibrary.MergeRows([], []));
    }
}
