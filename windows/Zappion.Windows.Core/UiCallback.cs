// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

public static class UiCallback
{
    public static async Task RunAsync(Func<Task> callback, string context, FileLogger? logger = null)
    {
        try { await callback(); }
        catch (Exception exception)
        {
            if (logger is null) AppLog.Error(context, exception);
            else logger.Write("ERROR", context, exception);
        }
    }
}
