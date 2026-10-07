# Manager 0.1.6 ENSO Delivery Plan

2026-10-07, Codex. Preparación posterior a la aceptación Sandbox. ROOT mantiene HOLD mientras reparte tres Sandbox y coordina la migración Tasks. Este plan no constituye una ejecución ni permite reutilizar el grant Sandbox cerrado.

## Scope

Copiar únicamente main.js, manifest.json y styles.css del candidato 0.1.6 a la instalación existente de Manager en ENSO. Preservar data.json, informes, configuración nativa, estado de otros plugins y el perfil desactivado observado. La copia no acredita carga ni aceptación runtime de ENSO.

Se elige entrega de archivos con perfil OFF porque no necesita abrir ni recuperar una ventana ENSO. Se descarta reutilizar el helper nativo de 0.1.5: sus identidades y preimages son históricos, y activa Manager. Una aceptación runtime ENSO es una unidad adicional que necesita contexto nativo actual y autorización específica si implica recuperación.

## Procedure

1. ROOT asigna una ventana de filesystem exclusiva para estos tres targets, sin writer Tasks concurrente sobre la configuración protegida. Usar un token nuevo, ACK durable y deadlines actuales. No ejecutar bajo el HOLD.
2. Resolver los paths físicos del vault y del plugin y guardar dev/ino. Leer una baseline actual de los tres targets, data.json, effective-state.json, community-plugins.json y demás archivos de configuración que ROOT indique proteger. Comprobar que Manager sigue OFF; un cambio desde la observación anterior exige reconciliación antes de copiar.
3. Leer los tres buffers fuente una sola vez y verificar los SHA del candidato aprobado. Comprobar manifest id aigility-plugin-manager y versión 0.1.6. No ejecutar build ni regenerar los bytes.
4. Crear backups privados fuera del vault. Guardar los tres preimages y la baseline protegida; sincronizar archivos, directorio y parent antes de cualquier write del target.
5. Antes de cada write, comprobar token/deadline, identidad física y todos los preimages o postimages ya conocidos. La comparación exacta antes de escribir evita sobrescribir cambios de otra sesión. Copiar desde los buffers congelados, sincronizar el archivo y leer su hash; actualizar únicamente el postimage propio esperado. Ante conflicto, detener y conservar lo ya ocurrido, sin restaurar backups automáticamente.
6. Sincronizar el directorio de Manager y comprobar los tres hashes, versión 0.1.6, perfil OFF y todos los archivos protegidos byteexactos. Escribir receipt fuera del vault, con campos que distingan installed de loaded. No llamar a Obsidian, enable/disable, reload, Sync ni APIs de dispositivos.
7. ROOT verifica el resultado y cierra la ventana de ejecución. Copiar al repositorio sólo el receipt sin contenidos sensibles y actualizar Acceptance016. No restaurar un data.json histórico si Tasks u otra sesión lo cambió entre unidades.

## Frozen Artifacts

| File | SHA-256 |
| --- | --- |
| main.js | bf1d245660349e4f1f4578a38a4563eee15bd5a5833c12639468d75aff201223 |
| manifest.json | 1d08012e04dfbd2edeaf5833813af8101afdb7438c9d220019ec39b97f7567c4 |
| styles.css | c5b8a3d5fd8250e3fd1156325164aaab83db70d0a68ff31cbc126be691cbf95a |

## Checklist

- [x] Candidato construido y aceptación Sandbox independiente publicada.
- [x] Procedimiento acotado a tres archivos y conservación de perfil/datos.
- [x] Baseline filesystem actual y paquete privado READY: Manager 0.1.5 OFF, 387 archivos protegidos.
- [ ] Ventana ROOT: HOLD explícito mientras termina Open Brain, Tasks y TTL; sin START.
- [ ] Ejecución, readback y cierre independiente: no ejecutados.

## Ready Snapshot

2026-10-07, Codex. Paquete privado manager016-enso-files-ezw0l8g6, loadedSHA 6b50bcbc570bbe509eda8b25473861e8219d1aec5e74f8b96594f7dc86a6369e, runnerSHA 4408de66406b2f6d1c2a1bff2f9db91e5351944f0220046c7918ad36e65b672e. Script checks/manager016-enso-files.py: copia filesystem sin llamadas Obsidian, ACK durable, primer write antes de ACK+15s, acciones hasta ACK+60s con hard deadline, exact lease/control guard, backup privado durable, reemplazo atómico y readback. Conserva todos los root JSON, data.json de plugins y archivos propios fuera de los tres runtime targets. Tres casos causales en filesystem temporal PASS: entrega completa más Begin duplicado rechazado, grant caducado sin control ni writes, y carrera de configuración después del primer copy con FAILED_PRESERVED sin rollback. No se ejecutó build ni suite de producto. ROOT confirmó HOLD explícito; nada se ha instalado todavía. Si cambia la baseline durante las otras operaciones, necesita refresh y nuevo grant; nunca restaura configuraciones previas.
