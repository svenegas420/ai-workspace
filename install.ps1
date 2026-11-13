# Installs AI Workspace: loads ai.ps1 from your PowerShell profile and adds an
# "AI Workspace" profile to Windows Terminal. Safe to run more than once.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$aiScript = Join-Path $root 'ai.ps1'

# 0) Requirements
if (Get-Command node -ErrorAction SilentlyContinue) { Write-Host "[ok] Node.js $(node --version)" }
else { Write-Host '[!] Falta Node.js (https://nodejs.org). La oficina lo necesita.' -ForegroundColor Yellow }

# 1) PowerShell profile (with backup)
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Force $PROFILE | Out-Null }
$profileText = Get-Content $PROFILE -Raw
if ($profileText -notmatch [regex]::Escape($aiScript)) {
    Copy-Item $PROFILE "$PROFILE.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Add-Content $PROFILE "`n# >>> ai-workspace >>>`n. '$aiScript'`n# <<< ai-workspace <<<" -Encoding UTF8
    Write-Host "[ok] Perfil actualizado: $PROFILE (respaldo creado)"
} else { Write-Host '[ok] El perfil ya carga ai-workspace' }

# 2) Windows Terminal profile via fragment (does not edit settings.json)
$fragDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\AI Workspace'
New-Item -ItemType Directory -Force $fragDir | Out-Null
@'
{
  "profiles": [
    {
      "guid": "{7a1e2c3d-4b5f-4a6e-9c8d-1f2e3a4b5c6d}",
      "name": "AI Workspace",
      "commandline": "powershell.exe -NoExit -Command ai",
      "startingDirectory": "%USERPROFILE%",
      "icon": "✨",
      "tabTitle": "AI Workspace"
    }
  ]
}
'@ | Set-Content (Join-Path $fragDir 'ai-workspace.json') -Encoding UTF8
Write-Host "[ok] Perfil 'AI Workspace' agregado a Windows Terminal"

# 3) Team summary
. $aiScript
Write-Host ''
Write-Host 'Tu equipo (edítalo con: ai-config):'
foreach ($a in Get-AiTeam) {
    $ok = [bool](Get-Command (([string]$a.command) -split ' ')[0] -ErrorAction SilentlyContinue)
    Write-Host ("  {0} {1,-18} rol: {2,-9} comando: {3}" -f $(if ($ok) { '[ok]' } else { '[--]' }), $a.name, $a.role, $a.command) -ForegroundColor $(if ($ok) { 'Gray' } else { 'Yellow' })
}

Write-Host ''
Write-Host 'Listo. Abre una terminal nueva y escribe:  ai'
Write-Host 'Para que se abra solo: Windows Terminal > Configuracion > Inicio > Perfil predeterminado = "AI Workspace"'
