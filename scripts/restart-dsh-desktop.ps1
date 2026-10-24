# Runs outside the Electron process tree through Task Scheduler.
# HostPid must be the Desktop Host that requested the restart.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]$HostPid,
    [switch]$AllowForce,
    [string]$SyncHome,
    [string]$SyncCli,
    [string]$SyncConfig,
    [string]$SyncHostEntry,
    [string]$TaskName,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$logDir = Join-Path $env:USERPROFILE '.dsh\logs'
$logFile = Join-Path $logDir 'restart-dsh-desktop.log'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-Log([string]$message) {
    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
}

function Wait-Exited([int]$processId, [int]$seconds) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (-not (Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Seconds 1
    }
    return -not [bool](Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue)
}

try {
    $hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$HostPid"
    if (-not $hostProcess -or $hostProcess.Name -ne 'DeepSeek Harness.exe' -or
        $hostProcess.CommandLine -notmatch 'dsh-desktop-host[\\/]lib[\\/]index\.js') {
        throw "PID $HostPid is not the DSH Desktop Host"
    }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($hostProcess.ParentProcessId)"
    if (-not $parent -or $parent.Name -ne 'DeepSeek Harness.exe' -or
        $parent.CommandLine -match '--type=|--expose-internals' -or
        -not $parent.ExecutablePath -or -not (Test-Path -LiteralPath $parent.ExecutablePath -PathType Leaf)) {
        throw 'Desktop main process could not be verified'
    }
    $mainPid = [int]$parent.ProcessId
    $exe = [System.IO.Path]::GetFullPath($parent.ExecutablePath)
    if ([System.IO.Path]::GetFileName($exe) -ne 'DeepSeek Harness.exe') {
        throw 'Unexpected Desktop executable path'
    }
    Write-Log "Verified Desktop main PID $mainPid and Host PID $HostPid"
    if ($DryRun) {
        Write-Output "Verified Desktop main PID $mainPid; executable $exe"
        exit 0
    }

    # Let the HTTP response reach the button before its host disappears.
    Start-Sleep -Seconds 2
    $mainProcess = Get-Process -Id $mainPid -ErrorAction SilentlyContinue
    if ($mainProcess) {
        $closeSent = $mainProcess.CloseMainWindow()
        Write-Log "Graceful window close sent: $closeSent"
        if ($closeSent) { $null = Wait-Exited $mainPid 12 }
    }
    if (Get-CimInstance Win32_Process -Filter "ProcessId=$mainPid" -ErrorAction SilentlyContinue) {
        if (-not $AllowForce) { throw 'Desktop did not exit; relaunch was cancelled' }
        Write-Log 'Desktop did not exit after 12 seconds; ending its verified process tree'
        & taskkill.exe /PID $mainPid /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "taskkill failed with exit code $LASTEXITCODE" }
        $null = Wait-Exited $mainPid 15
    }
    if (Get-CimInstance Win32_Process -Filter "ProcessId=$mainPid" -ErrorAction SilentlyContinue) {
        throw 'Desktop is still running; relaunch was cancelled'
    }

    # Offline sync starts only after the verified host tree is gone.
    if ($SyncCli) {
        if (-not $SyncHome -or -not (Test-Path -LiteralPath $SyncCli -PathType Leaf)) { throw 'Missing offline sync source' }
        if (-not (Wait-Exited $HostPid 30)) { throw 'Desktop Host is still alive; offline sync cancelled' }
        $env:ELECTRON_RUN_AS_NODE = '1'
        $env:DSH_HOME = $SyncHome
        if ($SyncConfig) { $env:DSH_SYNC_OVERRIDES_FILE = $SyncConfig }
        if ($SyncHostEntry) { $env:DSH_SYNC_HOST_ENTRY = $SyncHostEntry }
        $syncStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        # Electron is a Windows GUI executable: a bare invocation may return
        # before its CLI finishes. Do not relaunch a host until it has exited.
        $syncProcess = Start-Process -FilePath $exe -ArgumentList @(('"' + $SyncCli + '"'), '--startup-offline') -WindowStyle Hidden -Wait -PassThru
        $syncExit = $syncProcess.ExitCode
        if ($syncExit -ne 0) {
            $statusFile = Join-Path $SyncHome '.dsh-sync-status.json'
            $lastStatus = $null
            try { $lastStatus = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json } catch { }
            if (-not $lastStatus -or $lastStatus.at -lt $syncStartedAt) {
                @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); source = 'startup-offline';
                   result = @{ error = "关闭后同步未完成（退出码 $syncExit），请重试并检查日志。" } } |
                    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusFile -Encoding UTF8
            }
        }
        Remove-Item Env:ELECTRON_RUN_AS_NODE
        Remove-Item Env:DSH_SYNC_OVERRIDES_FILE -ErrorAction SilentlyContinue
        Remove-Item Env:DSH_SYNC_HOST_ENTRY -ErrorAction SilentlyContinue
        Write-Log "Offline startup sync exit code: $syncExit"
    }
    $started = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Hidden -PassThru
    Write-Log "Started Desktop main PID $($started.Id)"
    $ready = $false
    for ($i = 0; $i -lt 45; $i++) {
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($started.Id)" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match 'dsh-desktop-host[\\/]lib[\\/]index\.js' } |
            Select-Object -First 1
        if ($child) { $ready = $true; break }
        if (-not (Get-Process -Id $started.Id -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Desktop started, but its Host did not appear within 45 seconds' }
    Write-Log "Desktop Host restarted as PID $($child.ProcessId)"
    exit 0
} catch {
    if ($SyncHome) {
        $statusFile = Join-Path $SyncHome '.dsh-sync-status.json'
        @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); source = 'startup-offline';
           result = @{ error = "关闭后同步失败：$($_.Exception.Message)" } } |
            ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusFile -Encoding UTF8
    }
    Write-Log "Restart failed: $($_.Exception.Message)"
    Write-Error $_
    exit 1
} finally {
    if ($SyncConfig -and [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($SyncConfig)) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and
        [IO.Path]::GetFileName($SyncConfig) -match '^dsh-startup-config-\d+-\d+\.json$') {
        Remove-Item -LiteralPath $SyncConfig -Force -ErrorAction SilentlyContinue
    }
    if ($TaskName -and $TaskName -match '^DSH-Sync-Startup-\d+-\d+$') {
        & schtasks.exe /delete /tn $TaskName /f | Out-Null
    }
}
