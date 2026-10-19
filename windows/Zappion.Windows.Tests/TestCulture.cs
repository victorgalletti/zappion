// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using System.Runtime.CompilerServices;
namespace Zappion.Windows.Tests;
internal static class TestCulture
{
    [ModuleInitializer]
    internal static void Initialize()
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.GetCultureInfo("en-US");
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.GetCultureInfo("en-US");
    }
}
