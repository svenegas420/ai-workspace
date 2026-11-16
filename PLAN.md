# Implementación: oficina configurable y proyectos persistentes

Codex actúa como líder de esta implementación por autorización de Sebastian.

- [x] 1. [codex] Configuración, proyectos, tareas y documentación Obsidian con API local validada (archivos: office/workspace.js, office/workspace.test.js, office/server.js).
  - Persistencia y notas conservadas, reglas por tipo y excepciones. Siete pruebas del workspace pasan.
- [x] 2. [codex] Módulos de configuración y proyectos en navbar (archivos: office/index.html, office/workspace-ui.js, office/workspace.css).
  - Formularios y navegación verificados con jsdom. La validación visual en navegador nativo no se pudo completar en la primera sesión por bloqueo del control de URL.
- [x] 3. [codex] Lanzamiento de tareas con agente, modelo y contexto guardado (archivos: office/launch-task.ps1).
  - Lanzador de terminal conservado como API alternativa; sintaxis PowerShell verificada. Retomar desde la UI ahora usa el chat integrado. No se abrió una terminal real de prueba.
- [x] 4. [codex] Configurar bóveda, verificar interfaz y documentar uso (archivos: README.md, PLAN.md; datos locales: ~/.ai-workspace/workspace.json y ~/Documents/Oficina).
  - Obsidian instalado con winget; bóveda creada. Las notas ya se pueden leer desde el portal; instrucciones actualizadas en README.

No se realizarán commits ni push. Las claves y archivos .env quedan fuera del alcance.

## Ampliación: portal integrado (solicitud de Sebastian)

- [x] 5. [codex] Descubrir htdocs e importar solo proyectos clasificados por el usuario; lector de notas y relaciones de la bóveda (archivos: office/portal.js, office/portal.test.js, office/server.js, office/workspace.js).
  - API real descubre 56 carpetas; ninguna importada sin categoría elegida por Sebastian. Cuatro pruebas de importación, notas, relaciones y origen HTTP pasan.
- [x] 6. [codex] Chat persistente con Claude y Codex desde el portal, con respuestas en vivo, detención y modelo por tarea (archivos: office/chat.js, office/chat.test.js).
  - CLI con stdin y shell:false, SSE, historial en JSON y Markdown; seis pruebas con agentes simulados pasan. Claude Haiku y Codex reales respondieron OFICINA_CHAT_OK en consultas aisladas, sin leer proyectos ni hacer cambios.
- [x] 7. [codex] Importador, documentación y grafo pixel art; interfaz de chat tipo Messenger (archivos: office/portal-ui.js, office/portal.css, office/workspace-ui.js, office/index.html).
  - Cuatro pruebas de integración del DOM: importación con categoría, lectura segura de notas y dibujo del grafo, envío/streaming/borradores del chat y Retomar con Haiku. Verificación visual nativa pendiente.
- [x] 8. [codex] Pruebas, activación local y guía de uso (archivos: README.md, AGENTS.md, PLAN.md, package.json, package-lock.json, office/portal-ui.test.js).
  - npm test: 21/21 pruebas; comprobaciones de sintaxis JS y git diff --check correctas. Servidor actualizado y endpoints locales comprobados; no se hicieron commits ni push.

## Personajes y Windows Live Messenger

- [x] 9. [codex] Acceso al chat y proyectos desde las tarjetas de personajes, también sin sesiones de terminal (archivos: office/index.html, office/workspace-ui.js, office/portal-ui.js, office/portal.css).
  - Nombre del personaje y botón Abrir conversación enlazan al chat; proyectos desplegables y personajes disponibles sin CLI. Las pruebas verifican que se conservan agente y proyecto y que no se reutiliza el chat de otro agente.
- [x] 10. [codex] Rediseño Windows Live Messenger clásico: ventana, contactos, estados, avatares, conversación y controles funcionales (archivos: office/portal-ui.js, office/portal.css).
  - Referencia visual Windows Live Messenger 2009: marco celeste, registro blanco «Nombre dice:», avatares, contactos, proyectos, emoticonos y herramientas. Minimizar/restaurar/maximizar/cerrar conservan borradores; diseño adaptable a móvil. Verificación visual nativa pendiente por falta de conexión al navegador en las sesiones anteriores.
- [x] 11. [codex] Pruebas de navegación por personaje, proyecto, conversación y controles de ventana; documentación y activación (archivos: office/portal-ui.test.js, README.md, PLAN.md).
  - npm test: 25/25 pruebas; sintaxis y git diff --check correctos. HTTP local confirma que se sirve el acceso desde personajes, la ventana y el tema nuevos. No requiere reiniciar el backend: los cambios son archivos estáticos. Sin commits ni push.

## Trabajo combinado por proyecto

- [x] 12. [codex] Orquestar siempre Claude y Codex en cada solicitud de proyecto, con un responsable y revisión cruzada sin escrituras simultáneas; adaptar conversaciones existentes (archivos: office/chat.js, office/chat.test.js).
  - Dos etapas secuenciales por solicitud; un escritor y revisión de solo lectura. Conversaciones antiguas se adaptan al siguiente mensaje. Se comprueban cancelación, bloqueo durante ambas etapas, modelos por proveedor y desactivación del revisor antes de su etapa.
- [x] 13. [codex] Mostrar ambos participantes, sus modelos, etapas y respuestas en Messenger y en las entradas de proyecto (archivos: office/portal-ui.js, office/portal.css, office/index.html, office/portal-ui.test.js).
  - Ambos personajes acceden al mismo chat combinado y ven todos los proyectos. Autor, modelo y revisión se identifican sin rediseñar la ventana MSN.
- [x] 14. [codex] Validar fallos, cancelación y persistencia de ambos agentes; documentar y activar (archivos: README.md, AGENTS.md, PLAN.md, office/storage.js, office/chat.test.js, office/workspace.js).
  - Pruebas de combinación, fallos parciales, migración y notas Markdown correctas. Se corrigió un bloqueo transitorio de renombrado de archivos en Windows con reemplazo atómico y reintentos acotados; prueba de regresión incluida. Sin llamadas pagadas en pruebas.

## Navegación Windows 98 (MSN conserva su diseño)

- [x] 15. [codex] Tema y navegación general Windows 98: escritorio, barra de título, pestañas, ventanas, botones y barra de tareas; excluir el diseño MSN (archivos: office/windows98.css, office/index.html, office/workspace-ui.js, office/workspace.css, office/portal.css, office/portal-ui.test.js).
  - Causa raíz: el <style> inline de index.html pisaba windows98.css; ahora se carga al final. App envuelta en .win98-window con título dinámico e icono, botones _ □ × funcionales (doble clic en el título maximiza; la barra de tareas restaura), iconos pixel-art SVG, bandera en Inicio, scrollbars 98, tarjetas de agente como ventanas y medidores como cuadros de grupo. Reglas `body > main` de workspace.css/portal.css pasan a descendiente por el nuevo contenedor. npm test 34/34 (prueba nueva de controles de ventana) y git diff --check correctos. Verificado en Chrome: Oficina, Proyectos, Red neuronal, Chat (MSN intacto), Inicio, maximizar/minimizar/restaurar. Vista móvil no verificada en navegador (la ventana no se pudo redimensionar). Sin commit ni push.
  - Escritorio verde azulado, ventanas grises con relieve, pestañas, Inicio funcional, accesos a módulos, reloj y barra de tareas. La ventana MSN conserva su estilo celeste original; su maximización respeta el espacio de la barra de tareas.
- [x] 16. [codex] Verificar integración de navegación clásica con proyectos, notas, grafo, configuración y chat (archivos: office/portal-ui.test.js, README.md, PLAN.md, office/server.js).
  - 33/33 pruebas correctas, incluidas navegación y estilos calculados que verifican el aislamiento de MSN. HTTP confirma página y windows98.css activos. Comprobaciones de sintaxis y diff correctas. Verificación visual nativa limitada por la conexión de navegador no disponible en las sesiones anteriores. Sin commit ni push.

## Fidelidad Windows 98 (solicitud de Sebastian)

- [x] 17. [claude] Llevar el cromo general a un Windows 98 fiel (fuente bitmap, ventanas con biselado de 2 px, barra de título con botones _ □ ×, pestañas, barra de tareas e Inicio, iconos de escritorio) verificado en navegador; la ventana MSN no cambia (archivos: office/windows98.css, office/index.html, office/workspace-ui.js, office/workspace.css, office/portal.css, office/portal-ui.test.js).
  - Causa raíz: el <style> inline de index.html pisaba windows98.css; ahora se carga al final. App envuelta en .win98-window con título dinámico e icono, botones _ □ × funcionales (doble clic en el título maximiza; la barra de tareas restaura), iconos pixel-art SVG, bandera en Inicio, scrollbars 98, tarjetas de agente como ventanas y medidores como cuadros de grupo. Reglas `body > main` de workspace.css/portal.css pasan a descendiente por el nuevo contenedor. npm test 34/34 (prueba nueva de controles de ventana) y git diff --check correctos. Verificado en Chrome: Oficina, Proyectos, Red neuronal, Chat (MSN intacto), Inicio, maximizar/minimizar/restaurar. Vista móvil no verificada en navegador (la ventana no se pudo redimensionar). Sin commit ni push.

- [x] 18. [claude] Legibilidad y orden: escala de texto y controles más grande, distribución más clara, y rediseño de la Red neuronal (archivos: office/windows98.css, office/portal-ui.js, office/portal.css, office/portal-ui.test.js, office/workspace-ui.js).
  - Texto base 14 px (antes 11) con títulos de 15 a 22 px; barra de título, pestañas, botones, barra de tareas, menú Inicio y tarjetas agrandados en proporción. Red neuronal rehecha: lienzo nítido a la resolución real, distribución por fuerzas estable, etiquetas legibles que no se solapan, notas con el mismo título se distinguen por proyecto, zoom y arrastre, tooltip, resaltado de vecinos y panel lateral con conexiones y vista previa sin redibujar toda la vista. Salir de Configuración ya no pregunta si no hay cambios (antes lo hacía siempre con un confirm nativo). El fixture de jsdom ahora expone structuredClone; antes Configuración fallaba en silencio en las pruebas. npm test 35/35 y git diff --check correctos. Verificado en Chrome: Oficina, Red neuronal (selección, tooltip, vecinos), Configuración → Chat sin diálogo, Messenger intacto. Chrome tenía el zoom de la página al 75 %.
