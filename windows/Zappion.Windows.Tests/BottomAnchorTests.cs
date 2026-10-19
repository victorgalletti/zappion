// SPDX-License-Identifier: AGPL-3.0-only
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class BottomAnchorTests
{
    [Fact]
    public void OpeningFollowsThroughRepeatedGrowthAndRefetch()
    {
        var anchor = new BottomAnchor();
        Assert.True(anchor.Following);
        // Layout changes alone never release the anchor, even far from the new bottom.
        Assert.False(BottomAnchor.IsAtBottom(2000, 200));
        Assert.True(anchor.Following);
        anchor.ScrollUp();
        anchor.Open();
        Assert.True(anchor.Following);
    }

    [Fact]
    public void ReadingHistoryStaysPutUntilUserReturnsToBottom()
    {
        var anchor = new BottomAnchor();
        anchor.ScrollUp();
        anchor.UserViewChanged(1000, 600);
        Assert.False(anchor.Following);
        anchor.UserViewChanged(1400, 600);
        Assert.False(anchor.Following);
        anchor.UserViewChanged(1400, 1380);
        Assert.True(anchor.Following);
    }

    [Theory]
    [InlineData(0, 0, 200)]
    [InlineData(1000, 500, 165)]
    [InlineData(500, 1000, 320)]
    [InlineData(-1, 100, 200)]
    public void PreviewBoxUsesDimensionsOrWebFallback(double width, double height, double expected)
    {
        var file = new Newtonsoft.Json.Linq.JObject { ["width"] = width, ["height"] = height };
        Assert.Equal(expected, MediaContent.PreviewHeight(file, 330));
    }
}
