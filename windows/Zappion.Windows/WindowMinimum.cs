// SPDX-License-Identifier: AGPL-3.0-only
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;

namespace Zappion.Windows;

// Enforce a minimum tracking size without replacing WinUI's window procedure.
internal sealed class WindowMinimum : IDisposable
{
    private readonly nint hwnd;
    private readonly SubclassProc callback;
    private readonly int width;
    private readonly int height;

    public WindowMinimum(Window window, int width, int height)
    {
        hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);
        this.width = width;
        this.height = height;
        callback = HandleMessage;
        SetWindowSubclass(hwnd, callback, 1, 0);
    }

    private nint HandleMessage(nint window, uint message, nuint wParam, nint lParam, nuint id, nuint data)
    {
        if (message == 0x0024) // WM_GETMINMAXINFO
        {
            var result = DefSubclassProc(window, message, wParam, lParam);
            var info = Marshal.PtrToStructure<MinMaxInfo>(lParam);
            var scale = GetDpiForWindow(window) / 96d;
            info.MinTrackSize = new Point { X = (int)(width * scale), Y = (int)(height * scale) };
            Marshal.StructureToPtr(info, lParam, false);
            return result;
        }
        return DefSubclassProc(window, message, wParam, lParam);
    }

    public void Dispose() => RemoveWindowSubclass(hwnd, callback, 1);
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo
    {
        public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize;
    }
    private delegate nint SubclassProc(nint hwnd, uint message, nuint wParam, nint lParam, nuint id, nuint data);
    [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowSubclass(nint hwnd, SubclassProc callback, nuint id, nuint data);
    [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RemoveWindowSubclass(nint hwnd, SubclassProc callback, nuint id);
    [DllImport("comctl32.dll")] private static extern nint DefSubclassProc(nint hwnd, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hwnd);
}
