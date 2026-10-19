# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
$taskAWindows = Split-Path $PSScriptRoot -Parent
$taskADirectory = Join-Path $taskAWindows '.verification/task-a-live'
$taskAProcess = $null
$taskAOldDirectory = $env:ZAPPION_VERIFICATION_DIRECTORY
$taskAOldVerify = $env:ZAPPION_TASK_A_VERIFY
try {
    dotnet build (Join-Path $taskAWindows 'Zappion.Windows.sln') -p:Platform=x64
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; verification was not launched.' }
    python (Join-Path $PSScriptRoot 'prepare-task-a-session.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare isolated seed session.' }
    foreach ($taskAName in @('ready.txt', 'result.txt')) {
        $taskAFile = Join-Path $taskADirectory $taskAName
        if (Test-Path -LiteralPath $taskAFile) { Remove-Item -LiteralPath $taskAFile }
    }
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskADirectory
    $env:ZAPPION_TASK_A_VERIFY = '1'
    $taskAExe = Join-Path $taskAWindows 'Zappion.Windows/bin/x64/Debug/net8.0-windows10.0.19041.0/win-x64/Zappion.Windows.exe'
    # Interactive native application; its in-process test captures its own content.
    $taskAProcess = Start-Process -FilePath $taskAExe -PassThru
    $taskADeadline = (Get-Date).AddSeconds(45)
    while (!(Test-Path (Join-Path $taskADirectory 'ready.txt'))) {
        if ($taskAProcess.HasExited -or (Get-Date) -gt $taskADeadline) { throw 'Native verification did not become ready.' }
        Start-Sleep -Milliseconds 200
    }
    for ($taskAIndex = 0; $taskAIndex -lt 30; $taskAIndex++) {
        # Only no-op updates: no message insertion, send, or content edit.
        'update public.messages set status = status where id in (select id from public.messages where service = ''whatsapp'' and organization_id in (select organization_id from public.agents where user_id = ''185f2f83-d63a-4c9b-b4a0-7e4a885799e2'') order by timestamp desc limit 5);' |
            docker exec -i supabase_db_zappion psql -U postgres -d postgres -q -v ON_ERROR_STOP=1
        if ($LASTEXITCODE -ne 0) { throw 'No-op realtime update failed.' }
        Start-Sleep -Milliseconds 200
    }
    $taskADeadline = (Get-Date).AddSeconds(60)
    while (!(Test-Path (Join-Path $taskADirectory 'result.txt'))) {
        if ((Get-Date) -gt $taskADeadline) { throw 'Native verification timed out.' }
        Start-Sleep -Milliseconds 200
    }
    $taskAResult = Get-Content (Join-Path $taskADirectory 'result.txt')
    $taskAResult | Write-Output
    if ($taskAResult[0] -ne 'PASS') { throw 'Native verification failed; inspect result.txt and application logs.' }
}
finally {
    if ($taskAProcess -and !$taskAProcess.HasExited) { Stop-Process -Id $taskAProcess.Id }
    # The helper exclusively reads windows/.verification/task-a-live/session.json.
    python (Join-Path $PSScriptRoot 'prepare-task-a-session.py') --logout
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskAOldDirectory
    $env:ZAPPION_TASK_A_VERIFY = $taskAOldVerify
}
