[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageFile = Get-Item -LiteralPath $PackagePath
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $packageFile.FullName.StartsWith((Join-Path $sourceRoot 'outputs') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw '本地安装包必须先保存在维护目录的 outputs 中。'
}
if (-not $outputRoot.StartsWith((Join-Path $sourceRoot 'outputs') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw '安装记录必须保存在维护目录的 outputs 中。'
}
$expectedVersion = (Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($expectedVersion -ne '0.20.1') { throw '维护目录版本应为 0.20.1。' }
$cliPath = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) { throw '未找到桌面端内置 DSH 安装命令。' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$profileRoot = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$backupRoot = Join-Path $outputRoot 'profile-before-install'
if (Test-Path -LiteralPath $backupRoot) { throw '安装备份已存在，请使用新的输出目录，避免覆盖回滚材料。' }
New-Item -ItemType Directory -Path $backupRoot | Out-Null
foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml')) {
    $file = Join-Path $profileRoot $name
    if (Test-Path -LiteralPath $file -PathType Leaf) { Copy-Item -LiteralPath $file -Destination (Join-Path $backupRoot $name) }
}
$spec = 'file:' + $packageFile.FullName.Replace('\', '/')
& $cliPath plugin --profile desktop add $spec --ignore-scripts 2>&1 | Tee-Object -FilePath (Join-Path $outputRoot 'install.log')
if ($LASTEXITCODE -ne 0) { throw "桌面插件安装失败，退出码 $LASTEXITCODE；回滚材料已保留。" }
$manifest = Join-Path $profileRoot 'node_modules\@dpskk2\dsh-chatsync\package.json'
$installed = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
if ($installed.version -ne $expectedVersion) { throw "安装版本不符：$($installed.version)。" }
@{
    at = [DateTimeOffset]::UtcNow.ToString('o')
    version = $installed.version
    packagePath = $packageFile.FullName
    packageSha256 = (Get-FileHash -LiteralPath $packageFile.FullName -Algorithm SHA256).Hash
    profile = $profileRoot
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'installation.json') -Encoding utf8
Write-Output "桌面端已安装 $($installed.version)，请重新打开 DSH 后验收。"
