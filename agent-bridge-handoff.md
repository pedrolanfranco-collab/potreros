# Handoff: reparar Agent Bridge (Claude Code ↔ Codex)

Fecha: 2026-11-02. Estado: **diagnóstico hecho (Fases A y B), nada modificado todavía.**

## Contexto
- Servidor local: `http://127.0.0.1:43821`
- Proyecto: `C:\Users\Pedro\Documents\Codex\2026-10-29\referenced-chatgpt-conversation-this-is-an\agent-bridge`
- Proyectos reales en la base: `agent-bridge` y `potreros` (ambos activos).
- Credenciales: `claude-potreros`, `codex-potreros` (proyecto `potreros`); `claude-local`, `codex-local` (proyecto `agent-bridge`). `claude-local` es la de Claude Desktop: no mezclar ni tocar.

## Restricciones (del pedido original)
No mostrar tokens ni abrir `.dpapi`; no regenerar credenciales; no borrar sesiones/proyectos/base; no dar permisos globales ni tocar otros proyectos; no cambiar la config de Claude Desktop; no desactivar controles de seguridad. Antes de modificar la base: copia de seguridad verificable y aprobación de Pedro.

## Permisos actuales (verificados en una copia de la base)
Las 4 credenciales tienen discover=1, send=1, read=1 solo sobre su propio proyecto. La tabla `permissions` de las sesiones abiertas coincide con `credential_permissions`. No hay inconsistencias.

## Causa raíz del error
El rechazo "La sesión no tiene permiso para esta operación" **no viene de la base ni del código**. La sesión de Claude Code que probó se registró como `8017301d-…`, que pertenece a **`claude-local`** (solo `agent-bridge`). Por eso `list_sessions("potreros")` se rechaza (hay 2 rechazos en `audit_log` de esa sesión).
El `.mcp.json` de `C:\Users\Pedro\repos\potreros` ya usa `claude-potreros` y `.claude/settings.local.json` lo habilita (`enabledMcpjsonServers: ["agent-bridge"]`), pero el proceso MCP arrancó con `claude-local`. Hipótesis: otra definición de `agent-bridge` (configuración de usuario o de Desktop) lo pisa, o el proceso se inició antes de aprobar el `.mcp.json`. **No confirmado**: la lectura de `~/.claude.json` fue bloqueada por el clasificador de permisos y no se esquivó.

## Falla de código encontrada (`src/messaging.ts`, `sendMessage`)
- Exige `can_send` sobre el `projectId` que elige el remitente, pero del proyecto real del destinatario solo exige `can_discover`, y no compara ambos proyectos.
- El hilo y el mensaje se guardan con el `projectId` del remitente.
- Una sesión con `can_send` en A y solo `can_discover` en B podría enviar a B etiquetando el mensaje como A. Hoy ninguna credencial está en esa situación, pero el hueco existe.
- `checkInbox`, `replyMessage` y `getThread` respetan permisos y participación (ok).
- Higiene: hay 19 sesiones abiertas de `claude-potreros` que nunca se cerraron (ensucian `list_sessions`).

## Plan propuesto (pendiente de aprobación de Pedro)
1. **Conexión (sin tocar código ni base):** reiniciar Claude Code en `C:\Users\Pedro\repos\potreros`, aprobar el servidor `agent-bridge` del `.mcp.json` y verificar que `register_session` devuelva una sesión de `claude-potreros`. Si sigue saliendo `claude-local`, buscar y quitar la definición global que lo pisa (necesita que Pedro autorice leer `~/.claude.json` o pegue su sección `mcpServers`).
2. **`sendMessage`:** rechazar si `recipient.projectId !== projectId`; exigir `can_send` sobre el proyecto del destinatario; agregar pruebas en `tests/messaging.test.ts` (cruce de proyectos y responder mensajes ajenos). Único archivo de código a tocar.
3. **Opcional:** cerrar las sesiones obsoletas de `claude-potreros`, previa copia verificable de la base y aprobación.

## Pruebas pendientes (Fase D, con intercambio real)
1. Claude Code registra/recupera su sesión en `potreros`. 2. Descubre la sesión de Codex. 3. Codex descubre la de Claude. 4. Claude envía mensaje a Codex. 5. Codex lo recibe y responde. 6. Claude recibe la respuesta. 7. Ambos leen el hilo. 8. Un agente sin permisos no accede a otro proyecto. 9. Un agente no responde mensajes ajenos.
No declarar resuelto solo porque compila.

## Informe final a entregar
Causa raíz, archivos modificados, cambios, permisos finales por credencial, pruebas y resultados, pendientes, e instrucciones exactas para reiniciar servicios y probar.

## Datos útiles
- Copia de solo lectura de la base usada para el diagnóstico: `C:\Users\Pedro\AppData\Local\Temp\claude\C--Users-Pedro-repos-potreros\10f97fb1-58d9-4746-af16-f64ff77663bd\scratchpad\snap\` (no es el respaldo oficial previo a una modificación).
- Config de Codex para potreros: `C:\Users\Pedro\repos\potreros\.codex\config.toml` (usa `codex-potreros`).
