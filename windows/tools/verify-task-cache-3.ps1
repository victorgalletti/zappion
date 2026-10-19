# SPDX-License-Identifier: AGPL-3.0-only
param([string]$Email = 'goat@craft.com', [string]$Password = 'goat')
$ErrorActionPreference = 'Stop'
$cacheWindows = Split-Path $PSScriptRoot -Parent
$cacheDirectory = Join-Path $cacheWindows '.verification/cache-3'
New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
$cacheProject = @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><NuGetAudit>false</NuGetAudit></PropertyGroup>
  <ItemGroup><ProjectReference Include="../../Zappion.Windows.Core/Zappion.Windows.Core.csproj" /></ItemGroup>
</Project>
'@
# The generated runner never launches the UI or uses the owner's session or last-read files.
$cacheProgram = @'
using Zappion.Windows.Core;

var directory = AppContext.BaseDirectory;
while (new DirectoryInfo(directory).Name != "windows")
    directory = Directory.GetParent(directory)?.FullName ?? throw new InvalidOperationException("Missing windows directory.");
var isolated = Path.Combine(directory, ".verification", "cache-3");
var config = AppConfiguration.Load(Path.Combine(directory, "Zappion.Windows"));
var uri = new Uri(config.SupabaseUrl);
if (!uri.IsLoopback) throw new InvalidOperationException("Local Supabase only.");
var persistence = new FileSessionPersistence(Path.Combine(isolated, "session.json"));
using var client = new ZappionClient(config, persistence, new LastReadStore(Path.Combine(isolated, "last-read.json")));
try
{
    await client.InitializeAsync();
    await client.SignInAsync(Environment.GetEnvironmentVariable("ZAPPION_CACHE_VERIFY_EMAIL")!, Environment.GetEnvironmentVariable("ZAPPION_CACHE_VERIFY_PASSWORD")!);
    var workspace = await client.GetWorkspaceAsync() ?? throw new InvalidOperationException("Seed workspace missing.");
    var conversations = await client.GetConversationsAsync(workspace.OrganizationId);
    var checkedChats = 0;
    foreach (var conversation in conversations.Take(5))
    {
        var history = await client.GetMessagesAsync(conversation.MemberIds);
        if (history.Count == 0) continue;
        client.Messages.Store(conversation.MemberIds, history);
        var snapshot = client.Messages.Get(conversation.MemberIds)!;
        if (snapshot.IsStale || snapshot.Rows.Count != history.Count) throw new InvalidOperationException("Cache seed failed.");
        // Fetch inclusively at a known boundary and verify server filtering, not just an empty delta.
        var boundary = history[history.Count / 2].Timestamp;
        var delta = await client.GetMessagesSinceAsync(conversation.MemberIds, boundary);
        if (!delta.Any(row => row.Timestamp == boundary) || delta.Any(row => !conversation.MemberIds.Contains(row.ConversationId!) || DateTimeOffset.Parse(row.Timestamp) < DateTimeOffset.Parse(boundary)))
            throw new InvalidOperationException("Incremental query boundary/member filter failed.");
        var tail = await client.GetMessagesSinceAsync(conversation.MemberIds, snapshot.Rows[^1].Timestamp);
        if (!tail.Any(row => row.Id == snapshot.Rows[^1].Id)) throw new InvalidOperationException("Newest boundary was excluded.");
        var merged = ChatHistory.Merge(snapshot.Rows, tail);
        if (merged.Count != history.Count || merged.Select(row => row.Id).Distinct().Count() != merged.Count)
            throw new InvalidOperationException("Incremental merge lost or duplicated rows.");
        var latest = await client.GetLastIncomingAsync(conversation.MemberIds);
        if (latest is not null && (!conversation.MemberIds.Contains(latest.ConversationId!) || string.IsNullOrEmpty(latest.SenderAddress)))
            throw new InvalidOperationException("Last incoming filter failed.");
        client.Messages.MarkAllStale();
        if (!client.Messages.Get(conversation.MemberIds)!.IsStale) throw new InvalidOperationException("Reconnect invalidation failed.");
        var reloaded = await client.GetMessagesAsync(conversation.MemberIds);
        client.Messages.Store(conversation.MemberIds, reloaded);
        if (client.Messages.Get(conversation.MemberIds)!.IsStale) throw new InvalidOperationException("Full reload stayed stale.");
        checkedChats++;
    }
    if (checkedChats == 0) throw new InvalidOperationException("No seeded chat history to verify.");
    Console.WriteLine($"PASS: {checkedChats} local chats; full load, cache, inclusive delta/member filter, merge, last incoming and stale reload. No messages sent or marked read.");
}
catch (Exception ex)
{
    // Suppress transport details that might contain credentials or tokens.
    Console.Error.WriteLine($"Verification failed ({ex.GetType().Name}).");
    Environment.ExitCode = 1;
}
finally
{
    try
    {
        if (client.Session is not null) await client.SignOutAsync(); // scope local, isolated session only
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Isolated local sign-out failed ({ex.GetType().Name}).");
        Environment.ExitCode = 1;
    }
    finally { persistence.DestroySession(); }
}
'@
Set-Content -LiteralPath (Join-Path $cacheDirectory 'Verify.csproj') -Value $cacheProject
Set-Content -LiteralPath (Join-Path $cacheDirectory 'Program.cs') -Value $cacheProgram
$cachePreviousEmail = $env:ZAPPION_CACHE_VERIFY_EMAIL
$cachePreviousPassword = $env:ZAPPION_CACHE_VERIFY_PASSWORD
try {
    $env:ZAPPION_CACHE_VERIFY_EMAIL = $Email
    $env:ZAPPION_CACHE_VERIFY_PASSWORD = $Password
    dotnet run --project (Join-Path $cacheDirectory 'Verify.csproj')
    if ($LASTEXITCODE -ne 0) { throw 'Cache verification failed.' }
}
finally {
    $env:ZAPPION_CACHE_VERIFY_EMAIL = $cachePreviousEmail
    $env:ZAPPION_CACHE_VERIFY_PASSWORD = $cachePreviousPassword
}
