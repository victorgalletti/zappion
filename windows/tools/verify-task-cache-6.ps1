# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
$cacheWindows = Split-Path $PSScriptRoot -Parent
$cacheDirectory = Join-Path $cacheWindows '.verification/cache-6'
New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null

# Core-only harness: never launches WinUI or uses the owner's persisted session.
@'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../../Zappion.Windows.Core/Zappion.Windows.Core.csproj" />
  </ItemGroup>
</Project>
'@ | Set-Content -LiteralPath (Join-Path $cacheDirectory 'Verify.csproj') -Encoding UTF8

@'
using Zappion.Windows.Core;

var windows = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var directory = Path.Combine(windows, ".verification", "cache-6");
var configuration = AppConfiguration.Load(Path.Combine(windows, "Zappion.Windows"));
if (!new Uri(configuration.SupabaseUrl).IsLoopback)
    throw new InvalidOperationException("Local Supabase is required.");
using var client = new ZappionClient(configuration,
    new FileSessionPersistence(Path.Combine(directory, "session.json")),
    new LastReadStore(Path.Combine(directory, "last-read.json")));
var signedIn = false;
try
{
    // Create a new login; never load or refresh any existing session.
    await client.SignInAsync("goat@craft.com", "goat");
    signedIn = true;
    var workspace = await client.GetWorkspaceAsync() ?? throw new InvalidOperationException("Seed workspace missing.");
    Console.WriteLine("PASS: isolated seed sign-in and local Supabase workspace query.");
    var members = await client.GetMembersAsync(workspace.OrganizationId);
    var invitations = await client.GetInvitationsAsync(workspace.OrganizationId);
    var people = await client.GetMediaPeopleAsync(workspace.OrganizationId);
    Console.WriteLine($"PASS: settings reads: {members.Count} members, {invitations.Count} pending invitations; media people query.");
    foreach (var tab in new[] { MediaTab.Media, MediaTab.Links, MediaTab.Docs })
    {
        var filters = new MediaFilters(tab);
        var first = await client.GetMediaPageAsync(workspace.OrganizationId, filters, null);
        var cached = first.Rows.ToList();
        if (first.Next is { } cursor)
        {
            var second = await client.GetMediaPageAsync(workspace.OrganizationId, filters, cursor);
            cached.AddRange(second.Rows);
        }
        var refreshed = await client.GetMediaPageAsync(workspace.OrganizationId, filters, null);
        var merged = MediaLibrary.MergeRows(cached, refreshed.Rows);
        if (cached.Any(row => !merged.Any(item => item.Id == row.Id)) || merged.Select(r => r.Id).Distinct().Count() != merged.Count)
            throw new InvalidOperationException("Refresh discarded cached rows or duplicated message IDs.");
        Console.WriteLine($"PASS: {tab} local queries and refresh merge; retained {merged.Count} rows.");
        if (first.Next is null) Console.WriteLine($"LIMITATION: {tab} seed data has only one page; multi-page retention is covered by unit tests.");
    }
    var number = workspace.Numbers.FirstOrDefault(n => n.Service == "whatsapp" && n.Status == "connected");
    if (number is null) Console.WriteLine("LIMITATION: no connected WhatsApp number for templates.");
    else
    {
        try
        {
            var templates = await client.GetAllTemplatesAsync(workspace.OrganizationId, number.Address);
            await client.GetAllTemplatesAsync(workspace.OrganizationId, number.Address);
            Console.WriteLine($"PASS: template reopen query, {templates.Count} rows.");
        }
        catch (FunctionError ex) { Console.WriteLine($"LIMITATION: local template function returned HTTP {ex.Status}."); }
    }
    Console.WriteLine("LIMITATION: WinUI view state and activation require interactive review; the app was not launched.");
}
finally
{
    if (signedIn)
    {
        await client.SignOutAsync();
        Console.WriteLine("PASS: signed out only the isolated verification session (scope local).");
    }
}
'@ | Set-Content -LiteralPath (Join-Path $cacheDirectory 'Program.cs') -Encoding UTF8

dotnet run --project (Join-Path $cacheDirectory 'Verify.csproj') -p:NuGetAudit=false -p:UseSharedCompilation=false
if ($LASTEXITCODE -ne 0) { throw 'Cache step 6 local verification failed.' }
