// SPDX-License-Identifier: AGPL-3.0-only
using Zappion.Windows.Core;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

namespace Zappion.Windows;

public partial class App : Application
{
    private MainWindow? window;
    private AppInstance? instance;
    private string? pendingConversation;
    public App()
    {
        // Install before XAML construction in every build. Unknown UI failures remain fatal.
        UnhandledException += (_, e) => AppLog.Error("Unhandled XAML exception", e.Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            AppLog.Error("Unobserved task exception", e.Exception);
            e.SetObserved();
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            AppLog.Error($"Unhandled domain exception (terminating: {e.IsTerminating})",
                e.ExceptionObject as Exception ?? new Exception("Non-Exception failure"));
        InitializeComponent();
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
#if DEBUG
            if ((Environment.GetEnvironmentVariable("ZAPPION_TASK_A_VERIFY") == "1" ||
                 Environment.GetEnvironmentVariable("ZAPPION_TASK_B_VERIFY") == "1" ||
                 Environment.GetEnvironmentVariable("ZAPPION_TASK_D_VERIFY") == "1" ||
                 Environment.GetEnvironmentVariable("ZAPPION_TASK_F_VERIFY") == "1") && VerificationStorage.DirectoryPath is null)
                throw new InvalidOperationException("Verification requires isolated storage before launch.");
#endif
            var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
#if DEBUG
            var review = Environment.GetEnvironmentVariable("ZAPPION_LAYOUT_REVIEW") is { Length: > 0 };
            instance = AppInstance.FindOrRegisterForKey(review ? "Zappion.Windows.LayoutReview" :
                VerificationStorage.DirectoryPath is not null ? "Zappion.Windows.Verification" : "Zappion.Windows");
#else
            instance = AppInstance.FindOrRegisterForKey(VerificationStorage.DirectoryPath is not null ? "Zappion.Windows.Verification" : "Zappion.Windows");
#endif
            if (!instance.IsCurrent)
            {
                await instance.RedirectActivationToAsync(activation);
                Exit();
                return;
            }
            if (MessageNotifications.TryParseConversation(args.Arguments, out var launchConversation) ||
                MessageNotifications.TryParseConversation(Environment.GetCommandLineArgs().Skip(1), out launchConversation))
                pendingConversation = launchConversation;
            var dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
            // Register before window creation so cold toast COM activation is captured into pendingConversation.
            var notifications = new DesktopNotifications(id => dispatcher.TryEnqueue(async () =>
            {
                try
                {
                    if (window is null) pendingConversation = id;
                    else await window.OpenNotificationAsync(id);

                }
                catch (Exception callbackError) { AppLog.Error("UI callback failed in App.xaml", callbackError); }
            }));
            instance.Activated += (_, e) => HandleActivation(e);
            window = new MainWindow(notifications);
            window.Activate();
            HandleActivation(activation);
            if (pendingConversation is { } pending) await window.OpenNotificationAsync(pending);

        }
        catch (Exception callbackError)
        {
            AppLog.Error("UI callback OnLaunched failed", callbackError);
            Exit();
        }
    }

    private void HandleActivation(AppActivationArguments activation)
    {
        window?.DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                if (window is null) return;
                if (TryGetActivatedConversation(activation, out var id))
                    await window.OpenNotificationAsync(id);
                else window.Activate();

            }
            catch (Exception callbackError) { AppLog.Error("UI callback failed in App.xaml", callbackError); }
        });
    }

    private static bool TryGetActivatedConversation(AppActivationArguments activation, out string id)
    {
        id = "";
        return (activation.Data is global::Windows.ApplicationModel.Activation.IToastNotificationActivatedEventArgs toast &&
                MessageNotifications.TryParseConversation(toast.Argument, out id)) ||
               (activation.Data is global::Windows.ApplicationModel.Activation.ILaunchActivatedEventArgs launch &&
                MessageNotifications.TryParseConversation(launch.Arguments, out id)) ||
               (activation.Data is global::Windows.ApplicationModel.Activation.IProtocolActivatedEventArgs protocol &&
                MessageNotifications.TryParseConversation(protocol.Uri.Query.TrimStart('?'), out id));
    }
}

