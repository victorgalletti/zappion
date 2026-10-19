// SPDX-License-Identifier: AGPL-3.0-only
using Zappion.Windows.Core;
namespace Zappion.Windows.Tests;

internal static class IsolatedClient
{
    public static string DirectoryPath()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root.Name != "windows" && root.Parent != null) root = root.Parent;
        if (root.Name != "windows") throw new InvalidOperationException("Cannot locate verification directory.");
        var path = Path.Combine(root.FullName, ".verification", "tests", Guid.NewGuid().ToString());
        return path;
    }
    public static ZappionClient Create(AppConfiguration config)
    {
        var path = DirectoryPath();
        return new ZappionClient(config, new FileSessionPersistence(Path.Combine(path, "session.json")), new LastReadStore(Path.Combine(path, "last-read.json")));
    }
}
