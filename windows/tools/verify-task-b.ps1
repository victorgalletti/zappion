# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
$taskBWindows = Split-Path $PSScriptRoot -Parent
$taskBDirectory = Join-Path $taskBWindows '.verification/task-b-live'
$taskBProcess = $null
$taskBOldDirectory = $env:ZAPPION_VERIFICATION_DIRECTORY
$taskBOldVerify = $env:ZAPPION_TASK_B_VERIFY
try {
    dotnet build (Join-Path $taskBWindows 'Zappion.Windows.sln') -p:Platform=x64 -m:1
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; verification was not launched.' }
    python (Join-Path $PSScriptRoot 'prepare-task-b-session.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare isolated seed session.' }
    $taskBResultFile = Join-Path $taskBDirectory 'result.txt'
    if (Test-Path -LiteralPath $taskBResultFile) { Remove-Item -LiteralPath $taskBResultFile }
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskBDirectory
    $env:ZAPPION_TASK_B_VERIFY = '1'
    $taskBExe = Join-Path $taskBWindows 'Zappion.Windows/bin/x64/Debug/net8.0-windows10.0.19041.0/win-x64/Zappion.Windows.exe'
    $taskBProcess = Start-Process -FilePath $taskBExe -WindowStyle Hidden -PassThru
    $taskBDeadline = (Get-Date).AddSeconds(45)
    while (!(Test-Path -LiteralPath $taskBResultFile)) {
        if ($taskBProcess.HasExited -or (Get-Date) -gt $taskBDeadline) { throw 'Native verification did not complete; inspect isolated logs.' }
        Start-Sleep -Milliseconds 200
    }
    $taskBResult = Get-Content -LiteralPath $taskBResultFile
    $taskBResult | Write-Output
    if ($taskBResult[0] -ne 'PASS') { throw 'Native verification failed.' }
}
finally {
    if ($taskBProcess -and !$taskBProcess.HasExited) { Stop-Process -Id $taskBProcess.Id }
    python (Join-Path $PSScriptRoot 'prepare-task-b-session.py') --logout
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskBOldDirectory
    $env:ZAPPION_TASK_B_VERIFY = $taskBOldVerify
}
