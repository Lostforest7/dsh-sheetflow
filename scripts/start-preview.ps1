$ErrorActionPreference = 'Stop'
$sheetflowProject = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $sheetflowProject
$sheetflowBundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$sheetflowNode = if ($env:SHEETFLOW_NODE) { $env:SHEETFLOW_NODE } elseif (Test-Path -LiteralPath $sheetflowBundledNode) { $sheetflowBundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$sheetflowVersion = [Version](& $sheetflowNode -p 'process.versions.node')
if (!($sheetflowVersion.Major -ge 24 -or ($sheetflowVersion.Major -eq 22 -and $sheetflowVersion -ge [Version]'22.19.0'))) {
    throw 'SheetFlow requires Node 24+, or Node 22.19+ in the 22.x line. Set SHEETFLOW_NODE to its node.exe path.'
}
$env:PATH = (Split-Path -Parent $sheetflowNode) + [IO.Path]::PathSeparator + $env:PATH
if (!(Test-Path -LiteralPath 'node_modules/tsx')) {
    $sheetflowNpmCommand = (Get-Command npm -ErrorAction Stop).Source
    $sheetflowNpmCli = Join-Path (Split-Path -Parent $sheetflowNpmCommand) 'node_modules/npm/bin/npm-cli.js'
    if (!(Test-Path -LiteralPath $sheetflowNpmCli)) { throw 'npm-cli.js not found. Run npm ci --cache .cache/npm manually first.' }
    & $sheetflowNode $sheetflowNpmCli ci --cache .cache/npm
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& $sheetflowNode scripts/build.mjs
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
if (!$env:SHEETFLOW_WORKSPACE) {
    $sheetflowDemo = Join-Path $sheetflowProject 'work/demo'
    New-Item -ItemType Directory -Path $sheetflowDemo -Force | Out-Null
    foreach ($sheetflowInput in @('orders.xlsx','settlements.xlsx','template.xlsx','recipe.json')) {
        $sheetflowTarget = Join-Path $sheetflowDemo $sheetflowInput
        if (!(Test-Path -LiteralPath $sheetflowTarget)) { Copy-Item -LiteralPath (Join-Path $sheetflowProject "examples/month-end/$sheetflowInput") -Destination $sheetflowTarget }
    }
    $env:SHEETFLOW_WORKSPACE = $sheetflowDemo
}
Write-Host 'SheetFlow local preview. Open the printed URL; keep this window open. Ctrl+C stops it.'
& $sheetflowNode --import tsx scripts/dev-server.ts
