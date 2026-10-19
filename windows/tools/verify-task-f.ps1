# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
$taskFWindows = Split-Path $PSScriptRoot -Parent
$taskFDirectory = Join-Path $taskFWindows '.verification/task-f-live'
$taskFProcess = $null
$taskFOldDirectory = $env:ZAPPION_VERIFICATION_DIRECTORY
$taskFOldVerify = $env:ZAPPION_TASK_F_VERIFY
try {
    dotnet build (Join-Path $taskFWindows 'Zappion.Windows.sln') -p:Platform=x64 -m:1
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; verification was not launched.' }
    python (Join-Path $PSScriptRoot 'prepare-task-f-session.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare isolated seed session.' }
    $taskFResultFile = Join-Path $taskFDirectory 'result.txt'
    if (Test-Path -LiteralPath $taskFResultFile) { Remove-Item -LiteralPath $taskFResultFile }
    $logPath = Join-Path $env:LOCALAPPDATA ("Zappion\logs\zappion-{0:yyyy-MM-dd}.log" -f (Get-Date))
    $logStartLength = if (Test-Path -LiteralPath $logPath) { (Get-Item -LiteralPath $logPath).Length } else { 0 }
    $startTime = (Get-Date).AddSeconds(-1)
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskFDirectory
    $env:ZAPPION_TASK_F_VERIFY = '1'
    $taskFExe = Join-Path $taskFWindows 'Zappion.Windows/bin/x64/Debug/net8.0-windows10.0.19041.0/win-x64/Zappion.Windows.exe'
    $taskFProcess = Start-Process -FilePath $taskFExe -WindowStyle Hidden -PassThru
    $taskFDeadline = (Get-Date).AddSeconds(45)
    while (!(Test-Path -LiteralPath $taskFResultFile)) {
        if ($taskFProcess.HasExited -or (Get-Date) -gt $taskFDeadline) { throw 'Native verification did not complete; inspect isolated logs.' }
        Start-Sleep -Milliseconds 200
    }
    $taskFProcess.WaitForExit(10000) | Out-Null
    $taskFResult = Get-Content -LiteralPath $taskFResultFile
    $taskFResult | Write-Output
    if ($taskFResult[0] -ne 'PASS') { throw 'Native verification failed.' }
    if (Test-Path 'HKCU:\Software\Classes\AppUserModelId\Zappion.Windows.Verification') {
        throw 'Stale HKCU AppUserModelId registration remained after exit.'
    }
    Write-Output 'Verified HKCU\Software\Classes\AppUserModelId\Zappion.Windows.Verification was cleaned up on exit.'
    if (Test-Path -LiteralPath $logPath) {
        $stream = [System.IO.File]::Open($logPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $stream.Position = $logStartLength
            $reader = New-Object System.IO.StreamReader($stream)
            $newLog = $reader.ReadToEnd()
        }
        finally { $stream.Dispose() }
        if ($newLog -match '\[ERROR\] DesktopNotifications') {
            throw "DesktopNotifications error logged: $newLog"
        }
        Write-Output 'Verified no DesktopNotifications error was written to the application log.'
    }
    $pushEvents = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-PushNotification-Platform/Operational'; StartTime = $startTime } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'Zappion\.Windows\.Verification' }
    foreach ($evt in $pushEvents) {
        Write-Output ("WinEvent [{0}] Id={1} Level={2}: {3}" -f $evt.TimeCreated.ToString('O'), $evt.Id, $evt.LevelDisplayName, ($evt.Message -replace '\r?\n', ' '))
    }
}
finally {
    if ($taskFProcess -and !$taskFProcess.HasExited) { Stop-Process -Id $taskFProcess.Id }
    python (Join-Path $PSScriptRoot 'prepare-task-f-session.py') --logout
    $env:ZAPPION_VERIFICATION_DIRECTORY = $taskFOldDirectory
    $env:ZAPPION_TASK_F_VERIFY = $taskFOldVerify
}
