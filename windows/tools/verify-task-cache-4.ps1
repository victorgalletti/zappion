# SPDX-License-Identifier: AGPL-3.0-only
param([string]$Email = 'goat@craft.com', [string]$Password = 'goat')
$ErrorActionPreference = 'Stop'
$cacheWindows = Split-Path $PSScriptRoot -Parent
$cacheDirectory = Join-Path $cacheWindows '.verification/cache-4'
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
var isolated = Path.Combine(directory, ".verification", "cache-4");
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
    var conversation = conversations.FirstOrDefault() ?? throw new InvalidOperationException("Seed conversation missing.");
    var original = conversation.Primary;
    // Apply an actual fetched payload without changing any server data.
    if (!client.ApplyConversation(original)) throw new InvalidOperationException("Known row was rejected.");
    var rebuilt = client.ConversationViews();
    if (rebuilt.Count != conversations.Count || !rebuilt.Any(view => view.MemberIds.Contains(original.Id)))
        throw new InvalidOperationException("Conversation views lost a member.");
    if (client.ApplyConversation(null) || client.ApplyConversation(new ConversationRow
        { Id = Guid.NewGuid().ToString(), OrganizationId = workspace.OrganizationId, Service = "whatsapp" }))
        throw new InvalidOperationException("Missing/unknown payload did not require refresh.");
    foreach (var chat in conversations.Take(2))
        client.Messages.Store(chat.MemberIds, await client.GetMessagesAsync(chat.MemberIds));
    await client.StartRealtimeAsync(workspace.OrganizationId);
    if (!client.IsRealtimeConnected) throw new InvalidOperationException("Realtime subscription did not become ready.");
    client.StopRealtime();
    foreach (var chat in conversations.Take(2))
        if (client.Messages.Get(chat.MemberIds) is not { IsStale: true }) throw new InvalidOperationException("Disconnect did not invalidate history.");
    await client.StartRealtimeAsync(workspace.OrganizationId);
    client.Messages.Store(conversation.MemberIds, await client.GetMessagesAsync(conversation.MemberIds));
    if (client.Messages.Get(conversation.MemberIds) is not { IsStale: false }) throw new InvalidOperationException("Open history reload stayed stale.");
    var other = conversations.Skip(1).FirstOrDefault(chat => !chat.MemberIds.Intersect(conversation.MemberIds).Any());
    if (other is not null && client.Messages.Get(other.MemberIds) is not { IsStale: true })
        throw new InvalidOperationException("Other history became fresh without a reload.");
    Console.WriteLine("PASS: local inbox payload upsert, view rebuild, missing/unknown fallback, realtime subscription/rejoin, open history reload and other histories stale. No server rows changed or marked read.");
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
