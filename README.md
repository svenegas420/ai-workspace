# AI Workspace: oficina para tus agentes de IA

Trabaja con **varios agentes de código a la vez** (Claude Code, Codex, Gemini CLI o el que uses) sin que se pisen:

- **`ai`** abre un panel de terminal por agente, todos en la misma carpeta.
- **La oficina** (`http://localhost:4777`) muestra a cada agente en pixel art, uno al lado del otro. Ves qué hace, en qué proyecto está y con qué lenguajes trabaja.
- **Reglas de reparto** listas para pegar en `AGENTS.md`, con un tablero `PLAN.md` por proyecto.

> *English: a Windows/PowerShell launcher and local agent office with persistent projects, Obsidian notes, a pixel-art knowledge graph and integrated Claude/Codex chat. Runtime uses Node.js built-ins only.*

## Portal integrado

Abre `http://localhost:4777` y utiliza el navbar:

- **Proyectos → Importar desde htdocs**: descubre las carpetas de `C:\xampp\htdocs`. Marca las que quieras importar y elige **Personal** o **Trabajo** para cada una. Las carpetas de XAMPP y posibles respaldos están señalados. No se cambia el código ni se clasifica automáticamente ningún proyecto.
- **Configuración**: agentes, proveedores, roles, instrucciones, modelos predeterminados y reglas por tipo de tarea. Investigación usa inicialmente Claude/Haiku. Cada tarea admite sus propias excepciones.
- **Documentación**: lee y busca las notas Markdown de la bóveda desde el portal. Los enlaces `[[nota]]` permiten navegar entre ellas.
- **Red neuronal**: grafo pixel art de las notas y sus enlaces de Obsidian. Puedes filtrar por proyecto o categoría y seleccionar un nodo para leerlo. Las conexiones representan enlaces reales entre notas, no una red neuronal de aprendizaje automático. Se dibujan hasta 350 nodos; el lector admite hasta 1500 notas.
- **Chat**: conversaciones con aspecto de Messenger, mensajes y actividad en vivo, historial, borradores y botón Detener. Selecciona proyecto, tarea, agente y modelo. **Retomar** desde un proyecto o tarea abre su conversación o prepara una nueva dentro del portal.

### Conversar desde un personaje

Cada tarjeta de personaje incluye **Abrir conversación** y una lista desplegable de **Proyectos disponibles**. Los agentes configurados siguen visibles aunque no tengan sesiones abiertas en la terminal. Todos los proyectos se trabajan con **Claude y Codex combinados**. Puedes entrar desde cualquiera de los personajes a la misma conversación del proyecto. Al crear una conversación, el personaje elegido será el responsable y el otro agente hará la revisión cruzada.

El chat reproduce la apariencia clásica de **Windows Live Messenger 2009**: marco celeste, contactos con estados, proyectos en la lista lateral, avatares con borde verde, registro blanco con «Nombre dice:» y barra de herramientas. Puedes buscar contactos y proyectos, insertar emoticonos o texto destacado y consultar el detalle del proyecto. Los controles de la ventana permiten minimizar a una pestaña inferior, restaurar, maximizar o cerrar la vista. Estas acciones conservan el historial y los borradores; para interrumpir una ejecución utiliza **Detener**.

### Claude y Codex trabajan juntos

Cada solicitud tiene dos etapas, dentro de la misma conversación:

1. **Responsable**: responde o realiza los cambios de la tarea con su modelo configurado. Es el único que puede escribir si habilitaste la edición del proyecto.
2. **Revisión cruzada**: el otro proveedor recibe la solicitud, el contexto y el resultado del responsable; aporta su revisión en modo de solo lectura.

Ambas respuestas identifican al autor y se guardan en Obsidian. La actividad muestra qué etapa está en curso; el proyecto queda ocupado hasta que termina la revisión. El revisor usa su modelo de agente o la regla de revisión que le corresponda, sin heredar un modelo del otro proveedor. Investigación puede usar Claude/Haiku y después revisión de Codex.

Este flujo también se aplica a las conversaciones antiguas al enviar el siguiente mensaje. Si falta uno de los agentes activos, el portal pide activarlo en Configuración; no ejecuta silenciosamente una solicitud individual. Si una etapa falla, se muestra el error y se conserva el resultado anterior. Detener interrumpe la etapa en curso y evita iniciar la siguiente. Cada mensaje consume uso de ambas cuentas.

### Navegación Windows 98

El escritorio y las pantallas de oficina, proyectos, documentación, red neuronal y configuración usan el estilo Windows 98: fondo verde azulado, ventanas grises, barra de título azul, pestañas, controles con relieve y campos blancos. El menú **Inicio**, los accesos del escritorio y la barra de tareas permiten cambiar de módulo. El reloj muestra la hora local. La ventana de **MSN conserva su diseño Windows Live Messenger 2009**.

El chat usa las instalaciones y el inicio de sesión existentes de **Claude Code** y **Codex CLI**. No necesita copiar claves al portal. Gemini puede seguir configurado para el lanzador de terminal, pero todavía no tiene adaptador de chat integrado.

Las conversaciones comienzan en **modo consulta**. La casilla **Permitir que el agente edite archivos** habilita el sandbox de escritura de Codex o `acceptEdits` de Claude para esa conversación. Las operaciones que necesiten permisos adicionales pueden ser rechazadas por el CLI: el portal muestra el resultado y no desactiva sus protecciones. El modelo debe estar disponible en tu cuenta. El agente recibe las instrucciones, el contexto actualizado y los últimos 30 mensajes (hasta 64 000 caracteres) al enviar cada solicitud. El historial completo se conserva.

Solo se permite un turno combinado del chat por proyecto y hasta tres proyectos simultáneos. Detener mantiene el proyecto ocupado hasta que termina el proceso. Un turno tiene un límite total de 20 minutos y cada respuesta de agente tiene un máximo de 256 000 caracteres. Cerrar o cambiar la pestaña no borra la conversación: al volver se recupera el estado desde el servidor. Tras un reinicio del servidor, las conversaciones pendientes se muestran interrumpidas y puedes continuar con un mensaje nuevo.

## Obsidian y almacenamiento

La bóveda predeterminada es `~\Documents\Oficina`. Puedes cambiarla en Configuración. Obsidian guarda archivos Markdown locales; también puedes abrir la documentación aunque Obsidian esté cerrado.

```text
Oficina/
  Inicio.md
  Configuracion.md
  Oficina.json                  # copia de configuración y catálogo
  Personales.md
  Trabajo.md
  Personales/<project-id>/       # o Trabajo/<project-id>/
    Proyecto.md                 # generado por la oficina
    Tareas.md                   # generado por la oficina
    Contexto.md                 # editable desde Obsidian o el portal
    Conversaciones/<chat-id>.md # transcripción del chat
```

Los archivos de código permanecen en su carpeta original. La oficina no crea documentación dentro de `htdocs`. Las notas de contexto se leen de la bóveda al enviar mensajes y no se sobrescriben al sincronizar. `Proyecto.md`, `Tareas.md`, los índices, la configuración y las transcripciones son archivos generados; guarda tus notas propias en `Contexto.md` u otros archivos Markdown. Cambiar de bóveda copia la documentación y conserva la bóveda anterior.

El estado de trabajo se guarda en `~\.ai-workspace\workspace.json` y las conversaciones en `~\.ai-workspace\chats`. La configuración original de cuentas y sus variables se mantiene en `agents.json`; el portal no edita credenciales ni archivos `.env`. Las preferencias del portal se aplican a sus sesiones nuevas. El lanzador `ai` de terminal sigue usando su configuración original.

## Desarrollo y pruebas

```powershell
npm ci             # solo dependencias de desarrollo para las pruebas del DOM
npm test           # persistencia, importación, API, chat y formularios
npm start          # servidor local; requiere que el puerto 4777 esté libre
```

El servidor no necesita paquetes npm para ejecutarse. Las pruebas de chat usan procesos simulados y no gastan tokens. El chat real envía las solicitudes al proveedor del agente seleccionado y usa la cuota de esa cuenta.

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

`office/server.js` escucha solo en `127.0.0.1`. El tablero lee los logs locales; los módulos nuevos guardan configuración, documentación y conversaciones. Enviar un mensaje en Chat ejecuta el CLI del proveedor seleccionado. Las escrituras de la API exigen un token de sesión y se rechazan solicitudes de otros orígenes.

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
