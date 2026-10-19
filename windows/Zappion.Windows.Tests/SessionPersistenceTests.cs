// SPDX-License-Identifier: AGPL-3.0-only
using Supabase.Gotrue;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class SessionPersistenceTests
{
    [Fact]
    public void SavesReloadsUpdatesAndDestroysSession()
    {
        var directory = IsolatedClient.DirectoryPath();
        var path = Path.Combine(directory, "session.json");
        var persistence = new FileSessionPersistence(path);
        try
        {
            Assert.Null(persistence.LoadSession());
            persistence.SaveSession(new Session { AccessToken = "test-access", RefreshToken = "test-refresh" });
            Assert.Equal("test-refresh", new FileSessionPersistence(path).LoadSession()?.RefreshToken);
            persistence.SaveSession(new Session { AccessToken = "refreshed-access", RefreshToken = "refreshed-token" });
            Assert.Equal("refreshed-token", persistence.LoadSession()?.RefreshToken);
            persistence.DestroySession();
            Assert.Null(persistence.LoadSession());
            persistence.DestroySession();
            File.WriteAllText(path, "invalid JSON");
            Assert.Null(persistence.LoadSession());
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
