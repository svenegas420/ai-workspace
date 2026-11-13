<!-- ai-workspace:reparto:start -->
## Reparto de trabajo entre agentes

En este proyecto trabajan varios agentes de IA a la vez. Estas reglas evitan que se pisen.

{{TEAM}}

### Roles
- **Líder** (solo uno): habla con el usuario, escribe y mantiene `PLAN.md`, decide la arquitectura y reparte las tareas. Se queda con lo transversal: cambios en varios archivos, refactors, UI verificada en el navegador, documentación. Integra el trabajo de los demás y resuelve conflictos.
- **Ejecutor**: toma tareas acotadas de `PLAN.md`: un bug localizado, tests, scripts, cambios mecánicos (renombres, migraciones, dependencias). No cambia el plan. Si una tarea resulta más grande de lo previsto, lo anota bajo la tarea y se la devuelve al líder.
- **Revisor**: revisa los cambios de otro agente antes del commit (`/review`, `/code-review`). No edita código ajeno: deja sus hallazgos bajo la tarea en `PLAN.md`.

### Reglas
1. **Un dueño por tarea y un dueño por archivo a la vez.**
2. **Sin tarea no hay cambios.** Antes de editar, la tarea tiene que existir en `PLAN.md` con dueño y archivos. Si no existe, pídesela al líder (o al usuario).
3. **Formato de tarea**: `- [ ] 3. [codex] Tests del parser (archivos: src/parser.test.ts)`.
   Estados: `[ ]` pendiente · `[~]` en curso · `[x]` hecha · `[!]` bloqueada (explica el motivo debajo).
4. **Marca solo tus propias tareas**: `[~]` al empezar y `[x]` al terminar.
5. **No toques archivos de una tarea `[~]` de otro agente.** Si los necesitas, márcate `[!]` y espera.
6. **Zonas cercanas, ramas separadas**: si dos tareas en curso tocan código vecino, el ejecutor trabaja en un `git worktree` con la rama `<agente>/tarea-N` y el líder integra.
7. **Al terminar**, deja una línea bajo la tarea: qué cambió y cómo se probó. Si no se pudo probar, dilo.
8. **Revisión cruzada**: un cambio de más de ~50 líneas, o que toque varios archivos, lo revisa un agente distinto al autor antes del commit.
9. **Commits y push solo cuando el usuario lo pida.** Cada agente commitea solo sus archivos y menciona el número de tarea.
10. **Las dudas de producto van al usuario**, no a otro agente. Los desacuerdos técnicos los decide el líder; si siguen, decide el usuario.
11. **El contexto compartido va en `AGENTS.md`** (stack, comandos, convenciones), que leen todos. No lo dupliques en archivos de cada agente.
12. **Pedido fuera de tu rol**: dilo, sugiere a quién le corresponde y deja que el usuario decida.
<!-- ai-workspace:reparto:end -->
