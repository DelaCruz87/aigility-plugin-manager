# Downloaded Plugin Archive

Date: 2026-10-01. Author: Codex. Context: ampliación del plan aprobada directamente por Eme en chat. Evidencia del host verificada en Obsidian 1.14.3; revalidar interfaces internas al actualizar Obsidian.

## Decision and evidence

El archivo vive dentro de la carpeta de configuración efectiva, en plugins/.aigility-archive. Esa carpeta contenedora no tiene manifest.json. Cada plugin mantiene su nombre original debajo de ella. El catálogo nativo de Obsidian 1.14.3 lista únicamente las carpetas directamente dentro de plugins y lee su manifest.json; no recorre sus descendientes.

Se descarta añadir un punto a cada carpeta activa: el loader no contiene un filtro de nombres ocultos, y cambiar el nombre mientras el ID sigue igual puede romper onExternalSettingsChange. La [documentación del manifest](https://docs.obsidian.md/Reference/Manifest) exige correspondencia entre ID y carpeta para ese comportamiento. Archivar no libera espacio de almacenamiento ni reduce el trabajo de plugins que siguen activos; reduce los manifests disponibles para el catálogo y su interfaz.

La [documentación de Sync](https://obsidian.md/help/sync/settings) distingue la lista activa y la instalación/configuración de community plugins. El filtro local inspeccionado excluye segmentos con punto, incluso dentro de la carpeta de configuración. El traslado de archivos originales puede transmitir borrados cuando Installed community plugin list está activada. Para mantener el archivo específico de un equipo, desactivar esa opción en Sync de ese equipo; el gestor no cambia Sync automáticamente.

## Module contract

Exportar ArchiveManager desde src/integrated/archive.ts. Constructor(runtime, app, plugin). API:

- initialize(): Promise<void> lee un único índice local; si tiene una operación pendiente, pausa el runtime y muestra el conflicto, sin mover ni cargar automáticamente.
- list(): ArchiveEntry[] devuelve metadatos acotados en memoria, sin leer main.js ni data.json.
- has(id): boolean, get(id): ArchiveEntry | undefined.
- safety(): { allowed: boolean; reason?: string } consulta Sync y Restricted mode actuales; un Sync core habilitado con estado no verificable deniega el traslado. La instancia core de Sync es el cliente: wrapper.instance.filter.allowSpecialFiles y wrapper.instance.vaultId, verificados en la clase Qie del host 1.14.3. No asumir un nivel instance.sync.
- archive(id): Promise<void> y restore(id): Promise<void> usan runtime.enqueue, tx.refresh/save/writeEffectiveState. La restauración manual deja desired/native/loaded false.
- restoreInTransaction(id): Promise<void> restaura los archivos y refresca manifests sin entrar otra vez en la cola ni cambiar desired. Sólo para aplicación explícita de perfil, ya protegida por operationPending del runtime.
- fingerprint(): string permite incluir el índice en el contrato de la vista previa.

ArchiveEntry: id, name, version, minAppVersion?, isDesktopOnly?, archivedAt. Índice {schemaVersion:1, installationId:app.appId, entries:ArchiveEntry[], pending?:{id,operation,phase}} en plugins/.aigility-archive/index.json. No manifiesto en el contenedor. Nunca guardar tokens ni copiar configuración al índice. Usar vault.configDir efectivo y rechazar IDs con slash, backslash, punto inicial, segmentos .. o identidad manifest distinta.

## Mutation contract

Releer el índice antes de escribir y comparar su texto exacto con la última lectura. Conservar ambas carpetas y rechazar si existen ubicación activa y archivada simultáneamente. Antes de archivar, verificar protección, desired/native/loaded/scheduled apagados, ausencia de debug/pending global, estado de Sync y manifest.id. Registrar pending antes de rename; comprobar de nuevo la activación y generación después de awaits y justo antes del traslado. Nunca vaciar community-plugins.json. Refrescar manifests y verificar que sólo desapareció el ID archivado.

El traslado conserva la carpeta completa y archivos desconocidos. Si rename o actualización de índice falla, conservar el journal y pausar para recuperación explícita. No sobrescribir carpetas creadas después ni restaurar una copia antigua de State. Un índice de otra instalación copiado por una herramienta externa requiere diagnóstico visible, no adopción silenciosa.

La integración muestra archived=true e installed=false en el informe. El perfil sólo restaura miembros compatibles que va a activar; nunca restaura otros equipos en recuperación. GitHub rechaza instalar/actualizar el mismo ID mientras siga archivado, antes de escribir archivos.

## Validation checklist

- [x] Fuente del loader y Sync inspeccionada; documentación oficial contrastada.
- [ ] Backend: carpeta completa, apagado/protección, ID, conflictos, journal, Sync, índice externo y catálogo723.
- [ ] UI: Descargados, búsqueda, páginas50, acciones simples y errores visibles.
- [ ] Integración: perfil preview sin mutación, restore y activación en cola; GitHub sin sobrescritura.
- [ ] Sandbox: fixture propia, hashes de configuración y archivos adicionales, manifiestos antes/después, restauración apagada.
- [ ] iPad: medición física pendiente del desbloqueo y acceso ya solicitado por la sesión propietaria.
