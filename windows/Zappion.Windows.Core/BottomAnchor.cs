// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Mirrors bottom following in web/components/chat-room.tsx. Input device does not matter.
public sealed class BottomAnchor
{
    private double offset;
    private double extent;
    public bool Following { get; private set; } = true;
    public bool Programmatic { get; private set; }
    // While a chat opens, layout passes (virtualized heights, media loading) move the offset without
    // any reader gesture. Only real input ends this phase, so the chat lands on its newest message.
    public bool Opening { get; private set; }
    public static bool IsAtBottom(double height, double offset) =>
        double.IsFinite(height) && double.IsFinite(offset) && height >= 0 && offset >= 0 && height - offset < 40;
    public static double? ValidOffset(double value) => double.IsFinite(value) && value >= 0 ? value : null;
    public void Open() { Following = true; Opening = true; Programmatic = false; offset = extent = 0; }
    public void UserInput() => Opening = false;
    public void Resume() => Following = true;
    public void ScrollUp() { Following = false; Opening = false; }
    public void BeginProgrammaticScroll() => Programmatic = true;
    public void EndProgrammaticScroll() => Programmatic = false;
    public void UserViewChanged(double height, double position) => Following = IsAtBottom(height, position);

    // Extent growth alone must not look like an upward gesture. A final app view completes its marker.
    public bool ViewChanged(double height, double position, bool intermediate)
    {
        if (ValidOffset(height) is null || ValidOffset(position) is null) return false;
        var grew = Math.Abs(height - extent) > .5;
        if (!Programmatic)
        {
            if (IsAtBottom(height, position)) Following = true;
            else if (position < offset - .5 && !Opening) Following = false;
        }
        if (!intermediate) Programmatic = false;
        offset = position;
        extent = height;
        return grew && Following;
    }
}
