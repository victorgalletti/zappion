// SPDX-License-Identifier: AGPL-3.0-only
using System.Runtime.InteropServices;

namespace Zappion.Windows;

// ITaskbarList3 works for unpackaged windows; shell badges require package identity.
internal static class TaskbarOverlay
{
    public static void Set(nint window, int count)
    {
        var taskbar = (ITaskbarList3)new TaskbarList();
        nint icon = 0;
        try
        {
            taskbar.HrInit();
            if (count > 0) icon = CreateBadge(count > 99 ? "99+" : count.ToString(System.Globalization.CultureInfo.InvariantCulture));
            taskbar.SetOverlayIcon(window, icon, count > 0 ? count.ToString() : "");
        }
        finally
        {
            if (icon != 0) DestroyIcon(icon);
            Marshal.FinalReleaseComObject(taskbar);
        }
    }

    private static nint CreateBadge(string text)
    {
        const int size = 32;
        var dc = CreateCompatibleDC(0);
        var info = new BitmapInfo { Size = 40, Width = size, Height = -size, Planes = 1, BitCount = 32 };
        var bitmap = CreateDIBSection(dc, ref info, 0, out var bits, 0, 0);
        var mask = CreateBitmap(size, size, 1, 1, new byte[size * size / 8]);
        var brush = CreateSolidBrush(0x0066d325); // web/app/globals.css --wa-badge-unread: #25d366.
        var font = CreateFont(- (text.Length == 3 ? 16 : 21), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 4, 0, "Segoe UI");
        var oldBitmap = SelectObject(dc, bitmap);
        var oldBrush = SelectObject(dc, brush);
        var oldPen = SelectObject(dc, GetStockObject(8)); // NULL_PEN
        var oldFont = SelectObject(dc, font);
        try
        {
            if (bitmap == 0 || mask == 0 || bits == 0) throw new InvalidOperationException("Cannot allocate taskbar icon.");
            Ellipse(dc, 0, 0, size, size);
            SetBkMode(dc, 1); SetTextColor(dc, 0);
            var rect = new Rect { Right = size, Bottom = size };
            DrawText(dc, text, text.Length, ref rect, 0x25); // Center, vertical center, single line.
            GdiFlush();
            var pixels = new int[size * size]; Marshal.Copy(bits, pixels, 0, pixels.Length);
            for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                    pixels[y * size + x] = Math.Pow(x - 15.5, 2) + Math.Pow(y - 15.5, 2) <= 15.5 * 15.5
                        ? pixels[y * size + x] | unchecked((int)0xff000000) : 0;
            Marshal.Copy(pixels, 0, bits, pixels.Length);
            var data = new IconInfo { Icon = true, Color = bitmap, Mask = mask };
            var icon = CreateIconIndirect(ref data);
            return icon != 0 ? icon : throw new InvalidOperationException("Cannot create taskbar icon.");
        }
        finally
        {
            SelectObject(dc, oldFont); SelectObject(dc, oldPen); SelectObject(dc, oldBrush); SelectObject(dc, oldBitmap);
            DeleteObject(font); DeleteObject(brush); DeleteObject(mask); DeleteObject(bitmap); DeleteDC(dc);
        }
    }

    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] private class TaskbarList { }
    [ComImport, Guid("EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        void HrInit(); void AddTab(nint hwnd); void DeleteTab(nint hwnd); void ActivateTab(nint hwnd); void SetActiveAlt(nint hwnd);
        void MarkFullscreenWindow(nint hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullScreen);
        void SetProgressValue(nint hwnd, ulong completed, ulong total); void SetProgressState(nint hwnd, uint state);
        void RegisterTab(nint tab, nint mdi); void UnregisterTab(nint tab); void SetTabOrder(nint tab, nint before); void SetTabActive(nint tab, nint mdi, uint flags);
        void ThumbBarAddButtons(nint hwnd, uint count, nint buttons); void ThumbBarUpdateButtons(nint hwnd, uint count, nint buttons); void ThumbBarSetImageList(nint hwnd, nint images);
        void SetOverlayIcon(nint hwnd, nint icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
    }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapInfo { public uint Size; public int Width, Height; public ushort Planes, BitCount; public uint Compression, ImageSize; public int XPels, YPels; public uint Used, Important; }
    [StructLayout(LayoutKind.Sequential)] private struct IconInfo { [MarshalAs(UnmanagedType.Bool)] public bool Icon; public uint X, Y; public nint Mask, Color; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("gdi32.dll")] private static extern bool GdiFlush();
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(nint dc);
    [DllImport("gdi32.dll")] private static extern nint CreateDIBSection(nint dc, ref BitmapInfo info, uint usage, out nint bits, nint section, uint offset);
    [DllImport("gdi32.dll")] private static extern nint CreateBitmap(int width, int height, uint planes, uint bits, byte[] data);
    [DllImport("gdi32.dll")] private static extern nint CreateSolidBrush(uint color);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] private static extern nint CreateFont(int height, int width, int escapement, int orientation, int weight, uint italic, uint underline, uint strikeout, uint charset, uint precision, uint clip, uint quality, uint pitch, string face);
    [DllImport("gdi32.dll")] private static extern nint SelectObject(nint dc, nint value);
    [DllImport("gdi32.dll")] private static extern nint GetStockObject(int index);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(nint value);
    [DllImport("gdi32.dll")] private static extern bool Ellipse(nint dc, int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] private static extern int SetBkMode(nint dc, int mode);
    [DllImport("gdi32.dll")] private static extern uint SetTextColor(nint dc, uint color);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int DrawText(nint dc, string text, int count, ref Rect rect, uint format);
    [DllImport("user32.dll")] private static extern nint CreateIconIndirect(ref IconInfo info);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(nint icon);
}
