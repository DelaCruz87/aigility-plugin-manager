# Downloaded Plugin Archive

Date: 2026-10-01. Author: Codex. Context: ampliación del plan aprobada directamente por Eme en chat. Evidencia del host verificada en Obsidian 1.14.3; revalidar interfaces internas al actualizar Obsidian.

## Decision and evidence

El archivo vive dentro de la carpeta de configuración efectiva, en plugins/_archive. Esa carpeta contenedora no tiene manifest.json. Cada plugin mantiene su nombre original debajo de ella. El catálogo nativo de Obsidian 1.14.3 lista únicamente las carpetas directamente dentro de plugins y lee su manifest.json; no recorre sus descendientes.

Se descarta añadir un punto a cada carpeta activa: el loader no contiene un filtro de nombres ocultos, y cambiar el nombre mientras el ID sigue igual puede romper onExternalSettingsChange. La [documentación del manifest](https://docs.obsidian.md/Reference/Manifest) exige correspondencia entre ID y carpeta para ese comportamiento. Archivar no libera espacio de almacenamiento ni reduce el trabajo de plugins que siguen activos; reduce los manifests disponibles para el catálogo y su interfaz.

La [documentación de Sync](https://obsidian.md/help/sync/settings) distingue la lista activa y la instalación/configuración de community plugins. La ruta _archive fue elegida expresamente por Eme a las19:00 del2026-10-01. El filtro Sync local inspeccionado sólo acepta archivos de plugin a profundidad plugins/id/archivo; los archivos bajo plugins/_archive/id/archivo quedan a una profundidad distinta. El nombre _archive no es una garantía genérica de carpeta oculta. El traslado de archivos originales puede transmitir borrados cuando Installed community plugin list está activada. Para mantener el archivo específico de un equipo, desactivar esa opción en Sync de ese equipo; el gestor no cambia Sync automáticamente.

Esa opción también afecta data.json del propio gestor. Al desactivarla en un equipo, la sincronización automática de las definiciones por ese archivo deja de estar disponible allí. Los backups/exportaciones de perfiles permiten su transferencia explícita; no se presenta el archivo local como un protocolo nuevo de sincronización de perfiles.

## Module contract

Exportar ArchiveManager desde src/integrated/archive.ts. Constructor(runtime, app, plugin). API:

- initialize(): Promise<void> lee un único índice local; si tiene una operación pendiente, pausa el runtime y muestra el conflicto, sin mover ni cargar automáticamente.
- list(): ArchiveEntry[] devuelve metadatos acotados en memoria, sin leer main.js ni data.json.
- has(id): boolean, get(id): ArchiveEntry | undefined.
- safety(): { allowed: boolean; reason?: string } consulta Sync y Restricted mode actuales; un Sync core habilitado con estado no verificable deniega el traslado. La instancia core de Sync es el cliente: wrapper.instance.filter.allowSpecialFiles y wrapper.instance.vaultId, verificados en la clase Qie del host 1.14.3. No asumir un nivel instance.sync.
- archive(id): Promise<void> y restore(id): Promise<void> usan runtime.enqueue, tx.refresh/save/writeEffectiveState. La restauración manual deja desired/native/loaded false.
- restoreInTransaction(id): Promise<void> restaura los archivos y refresca manifests sin entrar otra vez en la cola ni cambiar desired. Sólo para aplicación explícita de perfil, ya protegida por operationPending del runtime.
- fingerprint(): string permite incluir el índice en el contrato de la vista previa.
- recover(): Promise<void> recupera sólo una operación pendiente explícitamente: verifica carpeta activa y archivada, manifest e identidad; conserva ambas si hay conflicto; finaliza el índice según la ubicación observada, deja el plugin apagado y mantiene la pausa del runtime hasta su reanudación explícita. No hace rename automático ni sobrescribe una carpeta nueva.
- needsRecovery(): boolean consulta el journal ya leído en memoria, sin iniciar lecturas de archivos desde el render de la UI.

ArchiveEntry: id, name, version, minAppVersion?, isDesktopOnly?, archivedAt. Índice {schemaVersion:1, installationId:app.appId, entries:ArchiveEntry[], pending?:{id,operation,phase,entry:ArchiveEntry}} en plugins/_archive/index.json. No manifiesto en el contenedor. Nunca guardar tokens ni copiar configuración al índice. Usar vault.configDir efectivo y rechazar IDs con slash, backslash, punto inicial, segmentos .. o identidad manifest distinta.

## Mutation contract

Releer el índice antes de escribir y comparar su texto exacto con la última lectura. Conservar ambas carpetas y rechazar si existen ubicación activa y archivada simultáneamente. Antes de archivar, verificar protección, desired/native/loaded/scheduled apagados, ausencia de debug/pending global, estado de Sync y manifest.id. Registrar pending antes de rename; comprobar de nuevo la activación y generación después de awaits y justo antes del traslado. Nunca vaciar community-plugins.json. Refrescar manifests y verificar que sólo desapareció el ID archivado.

El traslado conserva la carpeta completa y archivos desconocidos. Si rename o actualización de índice falla, conservar el journal y pausar para recuperación explícita. No sobrescribir carpetas creadas después ni restaurar una copia antigua de State. Un índice de otra instalación copiado por una herramienta externa requiere diagnóstico visible, no adopción silenciosa.

La integración muestra archived=true e installed=false en el informe. El perfil sólo restaura miembros compatibles que va a activar; nunca restaura otros equipos en recuperación. GitHub rechaza instalar/actualizar el mismo ID mientras siga archivado, antes de escribir archivos.

## Validation checklist

- [x] Fuente del loader y Sync inspeccionada; documentación oficial contrastada.
- [x] Backend: 12 pruebas independientes de carpeta completa, apagado/protección, ID, conflictos, journal, Sync, índice externo y runtime real; catálogo723 verificado también en UI.
- [x] UI: 7 pruebas de Descargados, búsqueda/filtros, páginas50, catálogo723, acciones, refresco y recuperación sin reanudar automatismos.
- [x] Integración: runtime real con perfiles completos/parciales, compatibilidad, diferidos y protecciones; 2 pruebas del GitHubManager real verifican instalación y rollback con índice desactualizado.
- [ ] Sandbox: pendiente fixture propia con hashes de configuración y archivos adicionales, manifiestos antes/después y restauración apagada. El build nuevo no está desplegado; la lectura del adapter del host no devolvió respuesta verificable y hay una ventana compartida en curso.
- [ ] iPad: medición física pendiente. Incidencia móvil bajo supervisión; no efectuar operaciones directas sin petición explícita de Eme para esa operación. Este proyecto no ha escrito archivos del iPad.

## Source checkpoint

2026-10-01 18:32 Madrid, Codex: npm test aprueba263 pruebas, sin fallos ni skips; npm run build termina exit0. Código de archivo publicado en39344da. evidence/archive-validation.json identifica los archivos comprobados. Son pruebas de fuente con adapters de prueba; ninguna carpeta real ha sido archivada o restaurada. El Sandbox conserva el build inicial anterior y ENSO conserva los dos gestores. No declarar listo para uso exclusivo.

## Requested path update

Snapshot histórico2026-10-01 20:55 Madrid, sustituido por el checkpoint siguiente: fuente0.1.2 publicada,287pruebas/buildexit0. La ruta sigue plugins/_archive. Se retiró READY0.1.1 por un bug comprobado de redacción de IDs en State; evidence/redaction-checkpoint.md detalla corrección y recuperación selectiva46campos. READY0.1.2 está preparada para una ventana coordinada de reparación/deploy del propio gestor, sin mover carpetas de plugins. La aceptación del archivo y su restauración reales permanece pendiente.

2026-10-01 19:06 Madrid, Codex: cambio explícito a plugins/_archive y versión0.1.1, fuente6fd3c7e. RingerGLM5.3Flash PASS177.6s con263pruebas/build exit0. No existía archivo previo en Sandbox ni se habían trasladado plugins reales; no se migra ninguna carpeta ajena. Readback previo al deploy: Sandbox0.1.0loaded,50community/30core,7profiles/42fixtures, SyncInstalledcommunitypluginlist activada. La prueba del traslado debe comprobar primero el bloqueo por Sync; no modificar Sync ni eludir esa guarda para hacer pasar una prueba.

## Current native archive status

2026-10-01 21:50 Madrid, Codex. Sandbox ya ejecuta0.1.3 y el servicio confirma la ruta exacta .obsidian/plugins/_archive. El deploy no creó el contenedor ni movió carpetas reales. Descargados, paginación y guardas Sync están implementados; la aceptación visual y la observación nativa del bloqueo Sync tienen un procedimiento propio pendiente de ventana. La exclusión de manifests y conservación completa de carpetas se verifican en adapters de prueba; el roundtrip nativo sigue abierto. No se ha medido rendimiento físico en iPad ni se considera listo para sustitución exclusiva en ENSO.
