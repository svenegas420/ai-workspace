# AI Workspace: oficina para tus agentes de IA

Trabaja con **varios agentes de código a la vez** (Claude Code, Codex, Gemini CLI o el que uses) sin que se pisen:

- **`ai`** abre un panel de terminal por agente, todos en la misma carpeta.
- **La oficina** (`http://localhost:4777`) muestra a cada agente en pixel art, uno al lado del otro. Ves qué hace, en qué proyecto está y con qué lenguajes trabaja.
- **Reglas de reparto** listas para pegar en `AGENTS.md`, con un tablero `PLAN.md` por proyecto.

> *English: a Windows/PowerShell launcher plus a local read-only dashboard for running several AI coding agents side by side. Configure your team in `agents.json`, run `ai`, and watch them work. No dependencies besides Node.js.*

## Instalación (2 minutos)

Necesitas Windows, PowerShell, [Node.js](https://nodejs.org) y al menos un agente instalado (`claude`, `codex`...).

```powershell
git clone https://github.com/svenegas420/ai-workspace.git $HOME\ai-workspace
powershell -ExecutionPolicy Bypass -File $HOME\ai-workspace\install.ps1
```

Abre una terminal nueva y escribe `ai`.

## Configura tu equipo

```powershell
ai-config     # crea y abre ~\.ai-workspace\agents.json
```

Cada agente es una entrada; activa los que tengas con `"enabled": true`:

```json
{
  "id": "codex",               // etiqueta en PLAN.md: [codex]
  "name": "Codex",
  "command": "codex",          // lo que se ejecuta en su panel
  "role": "executor",          // lead | executor | reviewer
  "color": "#39c494",
  "logs": "codex",             // claude | codex | null (null = sin oficina)
  "dir": "~/.codex/sessions",  // opcional: dónde están sus logs
  "env": { "VAR": "valor" }    // opcional: variables para ese panel
}
```

Ejemplos que ya vienen en `agents.json` (desactivados):

- **Dos cuentas de Claude**: `claude-work`, con `CLAUDE_CONFIG_DIR=~/.claude-work`. Cada cuenta aparece por separado en la oficina, con su uso.
- **Gemini CLI**: se abre en su panel y aparece en el reparto. La oficina todavía no lee sus logs (se aceptan PRs, ver más abajo).

La oficina recarga la configuración sola, sin reiniciar.

## Comandos

| Comando | Qué hace |
|---------|----------|
| `ai` | Menú de carpetas: abre un panel por agente y la oficina |
| `ai C:\ruta` | Lo mismo, sin menú |
| `ai -Only codex` · `ai -Agents claude,gemini` | Solo algunos agentes |
| `ai-init` | Crea o actualiza `AGENTS.md` (con las reglas de reparto y tu equipo), `CLAUDE.md` y `GEMINI.md` |
| `ai-config` | Edita tu equipo |
| `office` / `office-stop` | Abre o detiene la oficina |
| `ai-usage-setup` | Statusline de Claude que guarda su % de plan para mostrarlo en la oficina |

## Reglas de reparto

Están en [`REPARTO.md`](REPARTO.md). `ai-init` las inserta en el `AGENTS.md` del proyecto con la tabla de tu equipo; si ya estaban, las actualiza y deja un respaldo en `AGENTS.md.bak`. En resumen:

- **Un líder** (planifica en `PLAN.md`, decide e integra), **ejecutores** (tareas acotadas) y **revisores** (revisan sin editar código ajeno).
- Una tarea, un dueño. Un archivo, un dueño a la vez. Sin tarea en `PLAN.md` no hay cambios.
- Tareas: `- [ ] 3. [codex] Tests del parser (archivos: src/parser.test.ts)`, con los estados `[ ]` `[~]` `[x]` `[!]`.
- Revisión cruzada antes del commit y commits solo cuando el usuario los pide.

La oficina muestra cada `PLAN.md` como un tablero con una columna por agente.

## La oficina

`office/server.js` solo **lee** los logs locales de los agentes. No envía nada fuera de tu PC y escucha solo en `127.0.0.1`.

- Todos los agentes aparecen **uno al lado del otro**, sin importar su estado o proyecto. Cada uno conserva su puesto.
- El **cartel de madera** muestra el proyecto. El color del cuadradito identifica el proyecto entre tarjetas.
- La escena cambia según **lo que esté haciendo**, deducido de sus últimas herramientas y archivos:
  💻 programando · 🧪 probando · 🎬 editando video · ✍️ escribiendo · 🎨 diseñando · 🌐 investigando · 📊 analizando datos · 🧠 pensando
- Cuando programa, aparecen los **logos de los lenguajes** que está usando ([devicon](https://devicon.dev)).
- Estados: 🟢 trabajando · 🟡 esperándote (probablemente pide permiso) · 🔵 en pausa · ⚫ durmiendo.
- Arriba se muestra el uso de cada agente: % del plan y hora de reinicio, tiempo activo y tokens de hoy.

Y hay **10 secretos** escondidos de cultura pop y videojuegos 🎮. El trofeo de arriba lleva la cuenta y da pistas.

Variables opcionales: `AI_OFFICE_PORT` (4777) y `AI_OFFICE_HOURS` (8 h de historial). También se pueden poner como `port` y `hours` en `agents.json`.

## Contribuir

- **Lector de logs para otro agente**: agrega una función en `office/server.js` como `claudeAgents` o `codexAgents` que devuelva el mismo formato, y un valor nuevo para `logs`.
- **Detección de actividad o lenguajes**: está en `office/activity.js`.

## Licencia

MIT
