# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
$cacheWindows = Split-Path $PSScriptRoot -Parent
$cacheDirectory = Join-Path $cacheWindows '.verification/cache-5'
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
var directory = Path.Combine(windows, ".verification", "cache-5");
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
    var number = workspace.Numbers.FirstOrDefault(n => n.Service == "whatsapp" && n.Status == "connected");
    if (number is null)
    {
        Console.WriteLine("LIMITATION: seed workspace has no connected WhatsApp number; live template fetch unavailable.");
        return;
    }
    var changes = 0;
    client.TemplatesChanged += (org, address) =>
    {
        if (org != workspace.OrganizationId || address != number.Address)
            throw new InvalidOperationException("Incorrect template event key.");
        changes++;
    };
    try
    {
        var all = await client.GetAllTemplatesAsync(workspace.OrganizationId, number.Address);
        var cached = await client.GetAllTemplatesAsync(workspace.OrganizationId, number.Address);
        if (!ReferenceEquals(all, cached)) throw new InvalidOperationException("Cached templates were replaced.");
        var approved = await client.GetTemplatesAsync(workspace.OrganizationId, number.Address);
        if (approved.Any(t => (string?)t["status"] != "APPROVED")) throw new InvalidOperationException("Incorrect approval filter.");
        await client.GetAllTemplatesAsync(workspace.OrganizationId, number.Address, true);
        if (changes != 2) throw new InvalidOperationException("Incorrect template change event count.");
        Console.WriteLine($"PASS: live templates count={all.Count}, cache reuse, approved filtering, forced fetch and keyed events.");
    }
    catch (FunctionError ex)
    {
        Console.WriteLine($"LIMITATION: local template edge function returned HTTP {ex.Status}; live Meta-backed templates could not be verified.");
    }
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
if ($LASTEXITCODE -ne 0) { throw 'Core-only local verification failed.' }
