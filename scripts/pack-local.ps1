[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $outputRoot.StartsWith((Join-Path $sourceRoot 'outputs') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw '安装包与打包材料必须保存在维护目录的 outputs 内。'
}
$stage = Join-Path $outputRoot 'pack-source'
if (Test-Path -LiteralPath $stage) { throw '打包目录已存在，请使用新的输出目录，避免覆盖旧材料。' }
$listing = & git -c core.quotepath=false -C $sourceRoot ls-files --cached --others --exclude-standard -z
if ($LASTEXITCODE -ne 0) { throw '无法读取已登记的源码文件。' }
$names = ($listing -join "`n").Split([char]0) | Where-Object {
    $_ -and $_ -notmatch '(?i)(work-laptop|MOLE-LAPTOP)' -and $_ -notmatch '^(outputs|node_modules|\.git)/'
} | Sort-Object -Unique
foreach ($required in @('lib/config-file.js', 'lib/data-health.js', 'lib/data-repair-worker.mjs', 'lib/branch-history.js', 'lib/workspace-target.js')) {
    if ($required -notin $names) { throw "本轮必需源码未纳入打包：$required" }
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($name in $names) {
    $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $name))
    if (-not $source.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '源码路径越界。' }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "登记的源码不存在：$name" }
    $destination = Join-Path $stage $name
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}
Push-Location $stage
try {
    & npm pack --pack-destination $outputRoot --json | Tee-Object -FilePath (Join-Path $outputRoot 'pack.json')
    if ($LASTEXITCODE -ne 0) { throw '本地打包失败。' }
} finally { Pop-Location }
