// SPDX-License-Identifier: AGPL-3.0-only
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;
using Zappion.Windows.Core;

namespace Zappion.Windows;

// Windows App SDK AppNotificationManager and AppNotificationBuilder invoke WindowsAppRuntimeInsights
// telemetry in self-contained unpackaged mode, which fails because Microsoft.WindowsAppRuntime.Insights.Resource.dll
// is not shipped in the NuGet package. Classic Windows.UI.Notifications.ToastNotificationManager with an
// explicit AppUserModelID under HKCU\Software\Classes\AppUserModelId\<AUMID>, process AUMID, and COM/toast
// activation avoids Microsoft.WindowsAppRuntime.dll entirely.
internal sealed class DesktopNotifications : IDisposable
{
    private bool registered;
    private uint classCookie;
    private ToastNotifier? notifier;
    private NotificationActivator? activator;
    private readonly Action<string> openConversation;
    private readonly Dictionary<string, ToastNotification> activeToasts = new();
    private string? lastActivatedId;
    private DateTimeOffset lastActivatedAt;

    internal string Aumid { get; } = VerificationStorage.DirectoryPath is not null
        ? "Zappion.Windows.Verification"
        : "Zappion.Windows";

    internal Guid ActivatorClsid { get; } = VerificationStorage.DirectoryPath is not null
        ? new("7A415050-494F-4E54-4F41-535430303032")
        : new("7A415050-494F-4E54-4F41-535430303031");

    internal string RegistrySubKey => @"Software\Classes\AppUserModelId\" + Aumid;
    internal bool IsRegistered => registered;
    internal NotificationSetting Setting => notifier?.Setting ?? NotificationSetting.DisabledForApplication;
    internal int TrackedToastCount { get { lock (activeToasts) return activeToasts.Count; } }

    public DesktopNotifications(Action<string> openConversation)
    {
        this.openConversation = openConversation;
#if DEBUG
        if (Environment.GetEnvironmentVariable("ZAPPION_LAYOUT_REVIEW") is { Length: > 0 }) return;
#endif
        try
        {
            _ = SetCurrentProcessExplicitAppUserModelID(Aumid);
            using (var key = Registry.CurrentUser.CreateSubKey(RegistrySubKey, writable: true))
            {
                key.SetValue("DisplayName", "Zappion", RegistryValueKind.String);
                key.SetValue("IconUri", Path.Combine(AppContext.BaseDirectory, "Assets", "Logo.png"), RegistryValueKind.String);
                key.SetValue("CustomActivator", ActivatorClsid.ToString("B"), RegistryValueKind.String);
            }
            activator = new NotificationActivator(ActivateArguments);
            var clsid = ActivatorClsid;
            var hr = CoRegisterClassObject(ref clsid, activator, 4, 1, out classCookie);
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
            notifier = ToastNotificationManager.CreateToastNotifier(Aumid);
            registered = true;
        }
        catch (Exception ex) { AppLog.Error("DesktopNotifications operation failed", ex); /* Windows may disable notification registration by policy. */ }
    }

    internal void ActivateArguments(string? arguments)
    {
        if (!MessageNotifications.TryParseConversation(arguments, out var id)) return;
        var now = DateTimeOffset.UtcNow;
        lock (activeToasts)
        {
            if (lastActivatedId == id && now - lastActivatedAt < TimeSpan.FromMilliseconds(250)) return;
            lastActivatedId = id;
            lastActivatedAt = now;
        }
        openConversation(id);
    }

    public bool CanNotify
    {
        get { try { return registered && notifier?.Setting == NotificationSetting.Enabled; } catch (Exception ex) { AppLog.Error("DesktopNotifications operation failed", ex); return false; } }
    }

    public void Show(string conversationId, string title, string body)
    {
        if (!registered || notifier is null || string.IsNullOrWhiteSpace(conversationId)) return;
        try
        {
            var xml = new XmlDocument();
            xml.LoadXml(MessageNotifications.BuildToastXml(conversationId, title, body));
            var toast = new ToastNotification(xml)
            {
                Tag = MessageNotifications.ToastTag(conversationId),
                Group = MessageNotifications.ToastGroup
            };
            TrackToast(conversationId, toast);
            notifier.Show(toast);
        }
        catch (Exception ex) { AppLog.Error("DesktopNotifications operation failed", ex); /* A blocked toast must not interrupt message delivery. */ }
    }

    private void TrackToast(string conversationId, ToastNotification toast)
    {
        lock (activeToasts)
        {
            if (activeToasts.Remove(conversationId, out var previous)) DetachToast(previous);
            toast.Activated += OnToastActivated;
            toast.Dismissed += OnToastDismissed;
            toast.Failed += OnToastFailed;
            activeToasts[conversationId] = toast;
        }
    }

    private void OnToastActivated(ToastNotification sender, object args)
    {
        RemoveToast(sender);
        var launch = (args as ToastActivatedEventArgs)?.Arguments;
        if (string.IsNullOrWhiteSpace(launch))
            launch = sender.Content?.DocumentElement?.GetAttribute("launch");
        ActivateArguments(launch);
    }

    private void OnToastDismissed(ToastNotification sender, ToastDismissedEventArgs args) => RemoveToast(sender);
    private void OnToastFailed(ToastNotification sender, ToastFailedEventArgs args) => RemoveToast(sender);

    private void RemoveToast(ToastNotification toast)
    {
        lock (activeToasts)
        {
            DetachToast(toast);
            foreach (var pair in activeToasts.Where(p => ReferenceEquals(p.Value, toast)).ToArray())
                activeToasts.Remove(pair.Key);
        }
    }

    private void DetachToast(ToastNotification toast)
    {
        toast.Activated -= OnToastActivated;
        toast.Dismissed -= OnToastDismissed;
        toast.Failed -= OnToastFailed;
    }

    private static nint windowHandle;
    private static bool badgeFailureLogged;
    public static void AttachWindow(nint handle) => windowHandle = handle;

    public static void SetBadge(int count)
    {
        if (windowHandle == 0) return;
        try { TaskbarOverlay.Set(windowHandle, count); }
        catch (Exception ex)
        {
            if (badgeFailureLogged) return;
            badgeFailureLogged = true;
            AppLog.Error("Taskbar overlay unavailable", ex);
        }
    }

    // Same tone as the web app. SND_ASYNC reads the buffer after the call returns, so it stays pinned for the process lifetime.
    private static readonly Lazy<nint> Tone = new(() => GCHandle.Alloc(NotificationTone.CreateWave(), GCHandleType.Pinned).AddrOfPinnedObject());

    public static void PlaySound()
    {
        // SND_MEMORY | SND_ASYNC | SND_NODEFAULT
        try { if (!PlaySoundW(Tone.Value, 0, 0x4 | 0x1 | 0x2)) MessageBeep(0x40); }
        catch (Exception ex) { AppLog.Error("Notification sound failed", ex); }
    }

    /// <summary>Flashes the taskbar button until the window comes to the foreground.</summary>
    public static void FlashTaskbar()
    {
        if (windowHandle == 0) return;
        // FLASHW_TRAY | FLASHW_TIMERNOFG: tray button only, until the window is activated.
        var info = new FlashInfo { Size = (uint)Marshal.SizeOf<FlashInfo>(), Window = windowHandle, Flags = 0x2 | 0xC };
        FlashWindowEx(ref info);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FlashInfo { public uint Size; public nint Window; public uint Flags; public uint Count; public uint Timeout; }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlashWindowEx(ref FlashInfo info);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MessageBeep(uint type);

    [DllImport("winmm.dll", EntryPoint = "PlaySoundW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PlaySoundW(nint sound, nint module, uint flags);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    [DllImport("ole32.dll")]
    private static extern int CoRegisterClassObject(
        ref Guid rclsid,
        [MarshalAs(UnmanagedType.IUnknown)] object pUnk,
        uint dwClsContext,
        uint flags,
        out uint lpdwRegister);

    [DllImport("ole32.dll")]
    private static extern int CoRevokeClassObject(uint dwRegister);

    [ComImport, Guid("00000001-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IClassFactory
    {
        [PreserveSig]
        int CreateInstance(nint pUnkOuter, ref Guid riid, out nint ppvObject);
        [PreserveSig]
        int LockServer([MarshalAs(UnmanagedType.Bool)] bool fLock);
    }

    [ComImport, Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface INotificationActivationCallback
    {
        void Activate(
            [In, MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [In, MarshalAs(UnmanagedType.LPWStr)] string invokedArgs,
            nint data,
            uint dataCount);
    }

    [ComVisible(true)]
    private sealed class NotificationActivator(Action<string?> activate) : IClassFactory, INotificationActivationCallback
    {
        private static readonly Guid IUnknownGuid = new("00000000-0000-0000-C000-000000000046");
        private static readonly Guid CallbackGuid = typeof(INotificationActivationCallback).GUID;

        public int CreateInstance(nint pUnkOuter, ref Guid riid, out nint ppvObject)
        {
            ppvObject = 0;
            if (pUnkOuter != 0) return unchecked((int)0x80040110);
            if (riid != CallbackGuid && riid != IUnknownGuid) return unchecked((int)0x80004002);
            ppvObject = Marshal.GetComInterfaceForObject<NotificationActivator, INotificationActivationCallback>(this);
            return 0;
        }

        public int LockServer(bool fLock) => 0;

        public void Activate(string appUserModelId, string invokedArgs, nint data, uint dataCount) =>
            activate(invokedArgs);
    }

    public void Dispose()
    {
        // Notification access can be denied by Windows policy; shutdown must still complete.
        try
        {
            lock (activeToasts)
            {
                foreach (var toast in activeToasts.Values) DetachToast(toast);
                activeToasts.Clear();
            }
            if (classCookie != 0)
            {
                _ = CoRevokeClassObject(classCookie);
                classCookie = 0;
            }
            if (registered)
            {
                try { ToastNotificationManager.History.Clear(Aumid); }
                catch (Exception) { /* Clearing history is best effort when notifications are disabled. */ }
                Registry.CurrentUser.DeleteSubKeyTree(RegistrySubKey, throwOnMissingSubKey: false);
            }
        }
        catch (Exception ex) { AppLog.Error("DesktopNotifications operation failed", ex); /* Match the guarded registration path when notifications are unavailable. */ }
        activator = null;
        notifier = null;
        registered = false;
    }
}

