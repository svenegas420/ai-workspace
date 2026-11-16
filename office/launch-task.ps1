param(
    [Parameter(Mandatory = $true)][string]$PayloadFile,
    [switch]$Run,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $PayloadFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($payload.provider -notin @('claude', 'codex', 'gemini')) { throw 'Proveedor no compatible.' }
if (-not (Test-Path -LiteralPath $payload.cwd -PathType Container)) { throw 'La carpeta del proyecto no existe.' }
if (-not (Get-Command $payload.provider -ErrorAction SilentlyContinue)) { throw "No está instalado el comando $($payload.provider)." }
if ($CheckOnly) { Write-Output 'Launch configuration valid'; exit 0 }
if (-not $Run) {
    # Only the known script and a generated path enter the command line; user text stays in JSON.
    $scriptPath = $PSCommandPath.Replace("'", "''")
    $dataPath = $PayloadFile.Replace("'", "''")
    $code = "& '$scriptPath' -PayloadFile '$dataPath' -Run"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    # This window is the interactive terminal requested by Retomar.
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -WorkingDirectory $payload.cwd
    exit 0
}
Set-Location -LiteralPath $payload.cwd
$host.UI.RawUI.WindowTitle = "Oficina - $($payload.agentId) - $(Split-Path $payload.cwd -Leaf)"
# Preserve existing secondary-account environment settings without exposing them in the UI.
$userConfig = Join-Path $HOME '.ai-workspace\agents.json'
$baseFile = if (Test-Path -LiteralPath $userConfig) { $userConfig } else { Join-Path $PSScriptRoot '..\agents.json' }
$baseConfig = Get-Content -LiteralPath $baseFile -Raw -Encoding UTF8 | ConvertFrom-Json
$baseAgent = $baseConfig.agents | Where-Object { $_.id -eq $payload.agentId } | Select-Object -First 1
if ($baseAgent.env) {
    foreach ($item in $baseAgent.env.PSObject.Properties) {
        if ($item.Name -match '^[A-Za-z_][A-Za-z0-9_]*$') {
            $value = [string]$item.Value
            if ($value -match '^~(?=$|[\\/])') { $value = $HOME + $value.Substring(1) }
            [Environment]::SetEnvironmentVariable($item.Name, $value, 'Process')
        }
    }
}
Write-Host "Agente: $($payload.agentId) | Modelo: $(if ($payload.model) { $payload.model } else { 'predeterminado' })" -ForegroundColor Cyan
$cliArgs = @()
if ($payload.model) { $cliArgs += @('--model', [string]$payload.model) }
$contextFile = [IO.Path]::ChangeExtension($PayloadFile, '.md')
[IO.File]::WriteAllText($contextFile, [string]$payload.prompt, (New-Object Text.UTF8Encoding $false))
# Passing a file reference also supports context larger than Windows' command-line limit.
$promptText = "Lee el archivo $contextFile y sigue sus instrucciones para retomar el proyecto."
if ($payload.provider -in @('claude', 'codex')) {
    $cliArgs += @('--add-dir', (Split-Path $contextFile -Parent), '--add-dir', [string]$payload.documentationPath)
}
if ($payload.provider -eq 'gemini') { $cliArgs += @('--prompt-interactive', $promptText) }
else { $cliArgs += $promptText }
try { & $payload.provider @cliArgs }
finally {
    Remove-Item -LiteralPath $PayloadFile -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $contextFile -ErrorAction SilentlyContinue
}
