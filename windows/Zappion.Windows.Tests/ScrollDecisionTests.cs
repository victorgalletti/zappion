// SPDX-License-Identifier: AGPL-3.0-only
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ScrollDecisionTests
{
    [Fact]
    public void TouchpadOrThumbUpwardChangesStopFollowingThroughExtentGrowth()
    {
        var anchor = new BottomAnchor();
        anchor.ViewChanged(1000, 1000, false);
        anchor.ViewChanged(1000, 900, true);
        Assert.False(anchor.Following);
        Assert.False(anchor.ViewChanged(1400, 850, false));
        Assert.False(anchor.Following);
        anchor.ViewChanged(1400, 1000, false);
        Assert.False(anchor.Following);
        anchor.ViewChanged(1400, 1380, false);
        Assert.True(anchor.Following);
    }

    [Fact]
    public void ProgrammaticViewsKeepTheirMarkerUntilFinalViewAndExtentGrowthRequestsScroll()
    {
        var anchor = new BottomAnchor();
        anchor.ViewChanged(1000, 1000, false);
        anchor.BeginProgrammaticScroll();
        anchor.ViewChanged(1000, 800, true);
        Assert.True(anchor.Programmatic); Assert.True(anchor.Following);
        anchor.ViewChanged(1000, 1000, false);
        Assert.False(anchor.Programmatic);
        Assert.True(anchor.ViewChanged(1400, 1000, false));
        Assert.True(anchor.Following);
        anchor.ViewChanged(1400, 900, true);
        Assert.False(anchor.Following);
        anchor.Open(); Assert.True(anchor.Following);
    }

    [Fact]
    public void NoOpBottomRequestDoesNotForgetThePreviousOffset()
    {
        var anchor = new BottomAnchor();
        anchor.ViewChanged(1000, 1000, false);
        anchor.Resume();
        anchor.BeginProgrammaticScroll();
        anchor.EndProgrammaticScroll(); // ChangeView returned false: already there.
        anchor.ViewChanged(1000, 850, false); // A thumb drag can produce only one final event.
        Assert.False(anchor.Following);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(-1)]
    public void InvalidNativeOffsetsAreRejected(double value)
    {
        Assert.Null(BottomAnchor.ValidOffset(value));
        Assert.False(BottomAnchor.IsAtBottom(value, 0));
        var anchor = new BottomAnchor();
        Assert.False(anchor.ViewChanged(value, value, false));
        Assert.True(anchor.Following);
    }

    [Fact]
    public void OpeningChatKeepsFollowingUntilTheReaderActs()
    {
        var anchor = new BottomAnchor();
        anchor.Open();
        anchor.ViewChanged(3000, 3000, false);
        // Virtualization or a loading image moves the offset up with no gesture.
        Assert.True(anchor.ViewChanged(3400, 2600, false));
        Assert.True(anchor.Following);
        anchor.UserInput();
        anchor.ViewChanged(3400, 3400, false);
        anchor.ViewChanged(3400, 3000, false);
        Assert.False(anchor.Following);
    }

    [Fact]
    public void JumpingToAMessageEndsTheOpeningPhase()
    {
        var anchor = new BottomAnchor();
        anchor.Open();
        anchor.ScrollUp();
        Assert.False(anchor.Opening);
        Assert.False(anchor.Following);
    }
}
