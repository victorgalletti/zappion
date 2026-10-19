# SPDX-License-Identifier: AGPL-3.0-only
param([string]$Email = 'goat@craft.com', [string]$Password = 'goat')
$ErrorActionPreference = 'Stop'
$cacheWindows = Split-Path $PSScriptRoot -Parent
$cacheDirectory = Join-Path $cacheWindows '.verification/cache-7'
New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
# Core-only runner; never starts WinUI or opens the owner's session file.
@'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><NuGetAudit>false</NuGetAudit></PropertyGroup>
  <ItemGroup><ProjectReference Include="../../Zappion.Windows.Core/Zappion.Windows.Core.csproj" /></ItemGroup>
</Project>
'@ | Set-Content -LiteralPath (Join-Path $cacheDirectory 'Verify.csproj') -Encoding UTF8
@'
using Zappion.Windows.Core;

var windows = new DirectoryInfo(AppContext.BaseDirectory);
while (windows.Name != "windows") windows = windows.Parent ?? throw new InvalidOperationException("Missing windows directory.");
var directory = Path.Combine(windows.FullName, ".verification", "cache-7");
Environment.SetEnvironmentVariable("ZAPPION_VERIFICATION_DIRECTORY", directory);
var configuration = AppConfiguration.Load(Path.Combine(windows.FullName, "Zappion.Windows"));
if (!new Uri(configuration.SupabaseUrl).IsLoopback) throw new InvalidOperationException("Local Supabase only.");
var persistence = new FileSessionPersistence(Path.Combine(directory, "session.json"));
// A fresh seed login only; never initialize from an old verification session.
persistence.DestroySession();
using var client = new ZappionClient(configuration, persistence, new LastReadStore(Path.Combine(directory, "last-read.json")));
ZappionClient? restoredClient = null;
var signedOut = false;
try
{
    await client.SignInAsync(Environment.GetEnvironmentVariable("ZAPPION_CACHE_VERIFY_EMAIL")!, Environment.GetEnvironmentVariable("ZAPPION_CACHE_VERIFY_PASSWORD")!);
    var user = client.Session!.User!.Id!;
    var workspace = await client.GetWorkspaceAsync() ?? throw new InvalidOperationException("Seed workspace missing.");
    var conversations = await client.GetConversationsAsync(workspace.OrganizationId);
    if (conversations.Count == 0) throw new InvalidOperationException("Seed inbox missing.");
    foreach (var conversation in conversations.Take(5))
        client.Messages.Store(conversation.MemberIds, await client.GetMessagesAsync(conversation.MemberIds));
    await Task.Run(client.SaveSnapshot);
    var store = new SnapshotStore(directory);
    var snapshot = store.LoadNewest(user) ?? throw new InvalidOperationException("Snapshot not saved.");
    if (snapshot.Conversations.Count == 0 || snapshot.Histories.Count == 0) throw new InvalidOperationException("Snapshot data missing.");
    // A second client loads ONLY our isolated session and restores before any workspace/inbox query.
    restoredClient = new ZappionClient(configuration, persistence, new LastReadStore(Path.Combine(directory, "last-read.json")));
    await restoredClient.InitializeAsync();
    if (restoredClient.TryRestoreSnapshot(Guid.NewGuid().ToString()) is not null) throw new InvalidOperationException("Cross-user restore allowed.");
    var restored = restoredClient.TryRestoreSnapshot(user) ?? throw new InvalidOperationException("Restore failed.");
    if (restored.OrganizationId != workspace.OrganizationId || restored.OrganizationName != workspace.OrganizationName ||
        !restoredClient.ConversationViews().Select(c => c.Primary.Id).SequenceEqual(conversations.Select(c => c.Primary.Id)))
        throw new InvalidOperationException("Restored inbox/header differs.");
    foreach (var (id, history) in snapshot.Histories)
    {
        var cached = restoredClient.Messages.Get([id]) ?? throw new InvalidOperationException("Missing chat.");
        if (!cached.IsStale || !cached.Rows.Select(m => m.Id).SequenceEqual(history.Select(m => m.Id))) throw new InvalidOperationException("Imported chat is fresh or differs.");
    }
    Console.WriteLine($"PASS: encrypted snapshot restored {conversations.Count} inbox rows and {snapshot.Histories.Count} stale chat histories before workspace queries.");
    var freshWorkspace = await restoredClient.GetWorkspaceAsync() ?? throw new InvalidOperationException("Fresh workspace missing.");
    await restoredClient.GetConversationsAsync(freshWorkspace.OrganizationId);
    Console.WriteLine("PASS: fresh local Supabase workspace/inbox replaces restored data.");
    store.Save(snapshot with { Workspace = snapshot.Workspace with { Agent = new AgentRow { UserId = user, OrganizationId = Guid.NewGuid().ToString() } } });
    await restoredClient.SignOutAsync();
    signedOut = true;
    await Task.Run(restoredClient.SaveSnapshot);
    if (store.LoadNewest(user) is not null) throw new InvalidOperationException("Sign-out left or recreated a snapshot.");
    Console.WriteLine("PASS: local sign-out deleted all organizations for the isolated user; subsequent save cannot recreate them.");
    Console.WriteLine("LIMITATION: WinUI cold-start rendering, close handling and composer gating require interactive review; the app was not launched.");
}
catch (Exception ex)
{
    Console.Error.WriteLine($"Verification failed ({ex.GetType().Name}).");
    Environment.ExitCode = 1;
}
finally
{
    try
    {
        if (!signedOut && client.Session is not null)
        {
            await (restoredClient ?? client).SignOutAsync();
        }
    }
    catch (Exception ex) { Console.Error.WriteLine($"Isolated local sign-out failed ({ex.GetType().Name})."); Environment.ExitCode = 1; }
    finally { restoredClient?.Dispose(); persistence.DestroySession(); }
}
'@ | Set-Content -LiteralPath (Join-Path $cacheDirectory 'Program.cs') -Encoding UTF8
$cachePreviousEmail = $env:ZAPPION_CACHE_VERIFY_EMAIL
$cachePreviousPassword = $env:ZAPPION_CACHE_VERIFY_PASSWORD
try {
    $env:ZAPPION_CACHE_VERIFY_EMAIL = $Email
    $env:ZAPPION_CACHE_VERIFY_PASSWORD = $Password
    dotnet run --project (Join-Path $cacheDirectory 'Verify.csproj') -p:NuGetAudit=false -p:UseSharedCompilation=false
    if ($LASTEXITCODE -ne 0) { throw 'Cache step 7 local verification failed.' }
}
finally {
    $env:ZAPPION_CACHE_VERIFY_EMAIL = $cachePreviousEmail
    $env:ZAPPION_CACHE_VERIFY_PASSWORD = $cachePreviousPassword
}
