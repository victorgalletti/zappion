# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
$taskCWindows = Split-Path $PSScriptRoot -Parent
$taskCDirectory = Join-Path $taskCWindows '.verification/task-c-live'
$taskCProcess = $null
$taskCOldDirectory = $env:ZAPPION_VERIFICATION_DIRECTORY
$taskCOldVerify = $env:ZAPPION_TASK_C_VERIFY
try {
    dotnet build (Join-Path $taskCWindows 'Zappion.Windows.sln') -p:Platform=x64 -m:1
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; verification was not launched.' }
    python (Join-Path $PSScriptRoot 'prepare-task-c-session.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare isolated seed session.' }
    $taskCResultFile = Join-Path $taskCDirectory 'result.txt'
    if (Test-Path -LiteralPath $taskCResultFile) { Remove-Item -LiteralPath $taskCResultFile }
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskCDirectory
    $env:ZAPPION_TASK_C_VERIFY = '1'
    $taskCExe = Join-Path $taskCWindows 'Zappion.Windows/bin/x64/Debug/net8.0-windows10.0.19041.0/win-x64/Zappion.Windows.exe'
    $taskCProcess = Start-Process -FilePath $taskCExe -WindowStyle Hidden -PassThru
    $taskCDeadline = (Get-Date).AddSeconds(45)
    while (!(Test-Path -LiteralPath $taskCResultFile)) {
        if ($taskCProcess.HasExited -or (Get-Date) -gt $taskCDeadline) { throw 'Native verification did not complete; inspect isolated logs.' }
        Start-Sleep -Milliseconds 200
    }
    $taskCResult = Get-Content -LiteralPath $taskCResultFile
    $taskCResult | Write-Output
    if ($taskCResult[0] -ne 'PASS') { throw 'Native verification failed.' }
}
finally {
    if ($taskCProcess -and !$taskCProcess.HasExited) { Stop-Process -Id $taskCProcess.Id }
    python (Join-Path $PSScriptRoot 'prepare-task-c-session.py') --logout
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskCOldDirectory
    $env:ZAPPION_TASK_C_VERIFY = $taskCOldVerify
}
