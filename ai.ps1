# AI Workspace launcher: pick a folder -> one pane per agent (Claude, Codex, ...) + agent office in the browser.
# Loaded from the PowerShell profile. Commands: ai, ai-init, ai-config, ai-usage-setup, office, office-stop

$script:AiWorkspaceRoot = $PSScriptRoot
$script:AiUserDir       = Join-Path $HOME '.ai-workspace'
$script:AiRecentFile    = Join-Path $script:AiUserDir 'recent.txt'
$script:AiUserConfig    = Join-Path $script:AiUserDir 'agents.json'
$script:AiRepartoStart  = '<!-- ai-workspace:reparto:start -->'
$script:AiRepartoEnd    = '<!-- ai-workspace:reparto:end -->'

# ---------- team config ----------
function Get-AiConfig {
    $file = if (Test-Path $script:AiUserConfig) { $script:AiUserConfig } else { Join-Path $script:AiWorkspaceRoot 'agents.json' }
    try { Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { Write-Host "[!] No pude leer $file : $($_.Exception.Message)" -ForegroundColor Red; $null }
}

function Get-AiTeam {
    $cfg = Get-AiConfig
    if (-not $cfg) { return @() }
    @($cfg.agents | Where-Object { $_.enabled -ne $false })
}

function Get-AiPort { $cfg = Get-AiConfig; if ($env:AI_OFFICE_PORT) { [int]$env:AI_OFFICE_PORT } elseif ($cfg -and $cfg.port) { [int]$cfg.port } else { 4777 } }

function ai-config {
    <# Opens your team config (~\.ai-workspace\agents.json), creating it from the default the first time. #>
    if (-not (Test-Path $script:AiUserConfig)) {
        New-Item -ItemType Directory -Force $script:AiUserDir | Out-Null
        Copy-Item (Join-Path $script:AiWorkspaceRoot 'agents.json') $script:AiUserConfig
        Write-Host "[ok] Creado $script:AiUserConfig" -ForegroundColor Green
    }
    Write-Host 'Activa agentes con "enabled": true. Roles: lead | executor | reviewer. La oficina recarga el archivo sola.'
    Start-Process notepad $script:AiUserConfig
}

# ---------- office server ----------
function Test-AiOffice {
    try { Invoke-WebRequest "http://localhost:$(Get-AiPort)/api/config" -UseBasicParsing -TimeoutSec 1 | Out-Null; return $true }
    catch { return $false }
}

function Start-AiOffice {
    param([switch]$Open)
    $started = $false
    if (-not (Test-AiOffice)) {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host '[!] Falta Node.js (https://nodejs.org) para la oficina.' -ForegroundColor Yellow; return }
        $server = Join-Path $script:AiWorkspaceRoot 'office\server.js'
        Start-Process node -ArgumentList "`"$server`"" -WindowStyle Hidden | Out-Null
        $started = $true
        foreach ($i in 1..10) { Start-Sleep -Milliseconds 200; if (Test-AiOffice) { break } }
    }
    if ($Open -or $started) { Start-Process "http://localhost:$(Get-AiPort)" }
}

function office { Start-AiOffice -Open }

function office-stop {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like '*office*server.js*' -and $_.CommandLine -like "*$(Split-Path $script:AiWorkspaceRoot -Leaf)*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Oficina detenida (PID $($_.ProcessId))" }
}

# ---------- AGENTS.md / work-split rules ----------
function Get-AiRepartoText {
    $roles = @{ lead = 'Líder'; executor = 'Ejecutor'; reviewer = 'Revisor' }
    $rows = @('| Agente | Etiqueta en PLAN.md | Rol |', '|--------|---------------------|-----|')
    foreach ($a in Get-AiTeam) {
        $role = if ($roles.ContainsKey([string]$a.role)) { $roles[[string]$a.role] } else { [string]$a.role }
        $rows += "| $($a.name) | ``[$($a.id)]`` | $role |"
    }
    $text = Get-Content (Join-Path $script:AiWorkspaceRoot 'REPARTO.md') -Raw -Encoding UTF8
    $text.Replace('{{TEAM}}', ($rows -join "`n")).TrimEnd()
}

function Update-AiReparto([string]$File) {
    <# Inserts or refreshes the work-split section in an AGENTS.md. Returns a short status. #>
    $new = Get-AiRepartoText
    $old = Get-Content $File -Raw -Encoding UTF8
    $s = $old.IndexOf($script:AiRepartoStart); $e = $old.IndexOf($script:AiRepartoEnd)
    if ($s -ge 0 -and $e -gt $s) {
        $updated = $old.Substring(0, $s) + $new + $old.Substring($e + $script:AiRepartoEnd.Length)
        $msg = 'actualizadas'
    } elseif ($old -match '(?m)^## Reparto de trabajo: Claude \+ Codex') {
        # legacy section (no markers): replace it up to the next level-2 heading
        $m = [regex]::Match($old, '(?ms)^## Reparto de trabajo: Claude \+ Codex.*?(?=^## (?!#)|\z)')
        $updated = $old.Substring(0, $m.Index) + $new + "`n`n" + $old.Substring($m.Index + $m.Length).TrimStart()
        $msg = 'reemplazadas (versión antigua)'
    } else {
        $updated = $old.TrimEnd() + "`n`n" + $new + "`n"
        $msg = 'agregadas'
    }
    if ($updated -ne $old) {
        Copy-Item $File "$File.bak"
        [IO.File]::WriteAllText((Resolve-Path $File), $updated, (New-Object Text.UTF8Encoding $false))
    }
    $msg
}

function ai-init {
    <#
    .SYNOPSIS  Prepares the current folder for your agent team: AGENTS.md (with the work-split rules), CLAUDE.md, git.
               In existing projects it inserts or refreshes only the work-split section (backup in AGENTS.md.bak).
    #>
    if (-not (Test-Path .git)) { git init | Out-Null; Write-Host '[ok] git init' }
    if (-not (Test-Path AGENTS.md)) {
        $body = "# Instrucciones del proyecto`n`n## Stack`n- (completar)`n`n## Comandos`n- Instalar: `n- Probar: `n- Ejecutar: `n`n## Reglas`n- (completar)`n`n" + (Get-AiRepartoText) + "`n"
        [IO.File]::WriteAllText((Join-Path (Get-Location) 'AGENTS.md'), $body, (New-Object Text.UTF8Encoding $false))
        Write-Host '[ok] AGENTS.md creado con las reglas de reparto (lo leen todos los agentes)'
    } else {
        Write-Host "[ok] Reglas de reparto $(Update-AiReparto (Resolve-Path AGENTS.md).Path) en AGENTS.md"
    }
    if ((Get-AiTeam | Where-Object { $_.logs -eq 'claude' -or $_.command -like 'claude*' })) {
        if (-not (Test-Path CLAUDE.md)) {
            Set-Content CLAUDE.md '@AGENTS.md' -Encoding UTF8
            Write-Host '[ok] CLAUDE.md creado (importa AGENTS.md)'
        } elseif ((Get-Content CLAUDE.md -Raw) -notmatch '@AGENTS\.md') {
            Write-Host '[!] CLAUDE.md existe pero no importa AGENTS.md; agrega la línea @AGENTS.md' -ForegroundColor Yellow
        }
    }
    if ((Get-AiTeam | Where-Object { $_.command -like 'gemini*' }) -and -not (Test-Path GEMINI.md)) {
        Set-Content GEMINI.md '@AGENTS.md' -Encoding UTF8
        Write-Host '[ok] GEMINI.md creado (importa AGENTS.md)'
    }
}

function ai-usage-setup {
    <# Adds a Claude Code status line that also saves plan usage (5 h / 7 days) for the office. Backs up settings.json first. #>
    $settings = Join-Path $HOME '.claude\settings.json'
    $script = (Join-Path $script:AiWorkspaceRoot 'office\claude-statusline.js') -replace '\\', '/'
    $json = if (Test-Path $settings) { Get-Content $settings -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if ($json.PSObject.Properties['statusLine'] -and $json.statusLine.command -notlike '*claude-statusline.js*') {
        Write-Host "Ya tienes una statusLine: $($json.statusLine.command)" -ForegroundColor Yellow
        if ((Read-Host '  ¿Reemplazarla? (s/N)') -notmatch '^[sy]') { return }
    }
    if (Test-Path $settings) { Copy-Item $settings "$settings.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }
    $json | Add-Member -NotePropertyName statusLine -NotePropertyValue ([pscustomobject]@{ type = 'command'; command = "node `"$script`"" }) -Force
    $json | ConvertTo-Json -Depth 20 | Set-Content $settings -Encoding UTF8
    Write-Host '[ok] Statusline activada. El % de Claude aparece en la oficina tras el próximo mensaje en Claude Code.' -ForegroundColor Green
}

# ---------- folder picker ----------
function Get-AiRecentFolders {
    $list = @()
    if (Test-Path $script:AiRecentFile) { $list += Get-Content $script:AiRecentFile }
    $projects = Join-Path $HOME '.claude\projects'
    if (Test-Path $projects) {
        Get-ChildItem $projects -Directory | ForEach-Object {
            $f = Get-ChildItem $_.FullName -Filter *.jsonl -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($f) {
                $m = Select-String -Path $f.FullName -Pattern '"cwd":"([^"]+)"' -List
                if ($m) { [pscustomobject]@{ Path = ($m.Matches[0].Groups[1].Value -replace '\\\\', '\'); Time = $f.LastWriteTime } }
            }
        } | Sort-Object Time -Descending | ForEach-Object { $list += $_.Path }
    }
    $list | Where-Object { $_ -and $_ -ne $HOME -and (Test-Path $_) } | Select-Object -Unique -First 12
}

function Add-AiRecentFolder([string]$Path) {
    if (-not (Test-Path $script:AiUserDir)) { New-Item -ItemType Directory -Force $script:AiUserDir | Out-Null }
    $old = if (Test-Path $script:AiRecentFile) { Get-Content $script:AiRecentFile } else { @() }
    @($Path) + ($old | Where-Object { $_ -ne $Path }) | Select-Object -First 30 | Set-Content $script:AiRecentFile -Encoding UTF8
}

function Select-AiFolder {
    $recent = @(Get-AiRecentFolders)
    $names = (Get-AiTeam | ForEach-Object { $_.name }) -join ' + '
    Write-Host ''
    Write-Host "  ╭─ AI Workspace ─ $names" -ForegroundColor DarkYellow
    for ($i = 0; $i -lt $recent.Count; $i++) { Write-Host ('  │ {0,2}  {1}' -f ($i + 1), $recent[$i].Replace($HOME, '~')) }
    Write-Host '  │'
    Write-Host '  │  b  buscar carpeta...      n  nueva carpeta en ~\dev' -ForegroundColor Gray
    Write-Host '  │  .  carpeta actual         q  solo terminal' -ForegroundColor Gray
    Write-Host '  ╰────────────────────────────────────────────────' -ForegroundColor DarkYellow
    $choice = Read-Host '  ¿Dónde trabajamos? (número, letra o ruta)'
    switch -Regex ($choice) {
        '^\s*$|^q$' { return $null }
        '^\d+$' { $n = [int]$choice; if ($n -ge 1 -and $n -le $recent.Count) { return $recent[$n - 1] }; return $null }
        '^\.$' { return (Get-Location).Path }
        '^b$' {
            Add-Type -AssemblyName System.Windows.Forms
            $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
            $dlg.Description = 'Carpeta de trabajo para tus agentes'
            $dlg.SelectedPath = Join-Path $HOME 'dev'
            if ($dlg.ShowDialog() -eq 'OK') { return $dlg.SelectedPath }
            return $null
        }
        '^n$' {
            $name = Read-Host '  Nombre de la nueva carpeta'
            if (-not $name) { return $null }
            $p = Join-Path (Join-Path $HOME 'dev') $name
            New-Item -ItemType Directory -Force $p | Out-Null
            return $p
        }
        default { if (Test-Path $choice -PathType Container) { return (Resolve-Path $choice).Path }; Write-Host '  Ruta no encontrada.' -ForegroundColor Red; return $null }
    }
}

# ---------- launcher ----------
function Get-AiAgentScript($Agent, [string]$Path) {
    # PowerShell snippet that sets the agent's env vars and starts it in $Path
    $lines = @("Set-Location -LiteralPath '$($Path -replace "'", "''")'", "`$host.UI.RawUI.WindowTitle = '$($Agent.name -replace "'", "''") · $(Split-Path $Path -Leaf)'")
    if ($Agent.env) {
        foreach ($p in $Agent.env.PSObject.Properties) {
            $v = ([string]$p.Value) -replace '^~(?=$|[\\/])', $HOME
            $lines += "`$env:$($p.Name) = '$($v -replace "'", "''")'"
        }
    }
    $lines += [string]$Agent.command
    $lines -join '; '
}

function ai {
    <#
    .SYNOPSIS  Abre un panel por agente del equipo (agents.json) en una carpeta, con la oficina de agentes en el navegador.
    .EXAMPLE   ai                      # menú para elegir carpeta
    .EXAMPLE   ai C:\proyecto          # directo
    .EXAMPLE   ai -Only codex          # solo un agente
    .EXAMPLE   ai -Agents claude,gemini
    #>
    param(
        [string]$Path,
        [string]$Only,
        [string[]]$Agents,
        [switch]$NoOffice
    )
    $team = @(Get-AiTeam)
    if ($Only) { $Agents = @($Only) }
    if ($Agents) {
        $all = @((Get-AiConfig).agents)
        $team = @($Agents | ForEach-Object { $id = $_; $all | Where-Object { $_.id -eq $id } })
        if ($team.Count -ne $Agents.Count) { Write-Host "  Agentes disponibles: $(($all | ForEach-Object id) -join ', ')" -ForegroundColor Red; return }
    }
    if (-not $team.Count) { Write-Host '  No hay agentes activos. Ejecuta ai-config.' -ForegroundColor Red; return }
    $missing = $team | Where-Object { -not (Get-Command (([string]$_.command) -split ' ')[0] -ErrorAction SilentlyContinue) }
    foreach ($m in $missing) { Write-Host "  [!] No encuentro el comando '$($m.command)' de $($m.name)." -ForegroundColor Yellow }

    if (-not $Path) { $Path = Select-AiFolder }
    if (-not $Path) { Write-Host '  Ok, terminal normal.' -ForegroundColor Gray; return }
    $Path = (Resolve-Path $Path).Path
    Add-AiRecentFolder $Path
    Set-Location $Path

    $agentsMd = Join-Path $Path 'AGENTS.md'
    if (-not (Test-Path $agentsMd)) {
        if ((Read-Host '  Esta carpeta no tiene AGENTS.md. ¿Ejecutar ai-init? (s/N)') -match '^[sy]') { ai-init }
    } elseif ((Get-Content $agentsMd -Raw) -notmatch [regex]::Escape($script:AiRepartoStart)) {
        if ((Read-Host '  AGENTS.md no tiene las reglas de reparto actuales. ¿Agregarlas/actualizarlas? (s/N)') -match '^[sy]') { ai-init }
    }

    if (-not $NoOffice) { Start-AiOffice }

    # extra agents: Windows Terminal split panes (alternating vertical/horizontal), or new windows
    for ($i = 1; $i -lt $team.Count; $i++) {
        $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-AiAgentScript $team[$i] $Path)))
        if ($env:WT_SESSION) {
            $dir = if ($i % 2) { '-V' } else { '-H' }
            Start-Process wt -ArgumentList "-w 0 split-pane $dir --size 0.5 -d `"$Path`" --title `"$($team[$i].name)`" powershell -NoExit -EncodedCommand $enc"
            Start-Sleep -Milliseconds 300
        } else {
            Start-Process powershell -ArgumentList "-NoExit -EncodedCommand $enc"
        }
    }

    # first agent runs here; env vars are restored when it exits
    $first = $team[0]
    $saved = @{}
    if ($first.env) { foreach ($p in $first.env.PSObject.Properties) { $saved[$p.Name] = [Environment]::GetEnvironmentVariable($p.Name, 'Process') } }
    try { Invoke-Expression (Get-AiAgentScript $first $Path) }
    finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') } }
}
