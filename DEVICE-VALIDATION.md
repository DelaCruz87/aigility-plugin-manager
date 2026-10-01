# Device Validation

Date: 2026-10-01. Author: Codex. This is an execution ledger for the user-approved plan, not evidence that every installation has been validated. Source tests, emulation and a physical device run are separate observations.

## Matrix

| Profile | Tag | Template | Source definition | Physical validation | Local binding |
| --- | --- | --- | --- | --- | --- |
| macbook | macbook | Desktop | Created; Apply at start true | Initial Sandbox installation loaded on Mac; functional acceptance and next startup pending | Sandbox unset intentionally; ENSO migration pending |
| zenbook | zenbook | Desktop | Created; Apply at start true | No accessible device session verified | Pending explicit assignment on that installation |
| iphone | iphone | Mobile | Created; Apply at start true | No connected iPhone verified | Pending explicit assignment on that installation |
| ipad | ipad | Tablet | Created; Apply at start true | Initial connection observed; later vault-integrity incident under supervision; no recovery or current vault state verified by this project; manager not deployed there | Pending explicit assignment on that installation |
| s24 | s24 | Mobile | Created; Apply at start true | adb reported no connected Android devices | Pending explicit assignment on that installation |
| lenovo tab | lenovo tab | Tablet | Created; Apply at start true | No connected tablet verified | Pending explicit assignment on that installation |
| boox tab mini c | boox tab mini c | Tablet | Created; Apply at start true | No connected tablet verified | Pending explicit assignment on that installation |

## Per-device acceptance

- [ ] Read the current vault name, installation identity, host version and platform.
- [ ] Back up current managers, community autostart and core settings locally. Keep credentials out of Git.
- [ ] Install the current compiled manager and compare its three file hashes with the reviewed build.
- [ ] Confirm native enablement and actual instance._loaded independently.
- [ ] Assign the profile deliberately; do not infer the device from the operating system.
- [ ] Check name/ID, tag, group and Community/Core/All filters plus the left Options entry.
- [ ] Preview a full profile, verify compatible members and protected exceptions, apply and undo.
- [ ] Verify native deferred exclusion, one load after delay, parked exclusion and cancellation.
- [ ] Test late load and interrupted application recovery before enabling automatic startup.
- [ ] Verify a diagnostic session restores only its own changes and exports Markdown/JSON.
- [ ] Restart the target vault and read back identity, selected/applied profile, desired/native/loaded/scheduled states.

## Shared Sandbox scope

Snapshot histórico2026-10-01 20:55 Madrid, sustituido por el checkpoint siguiente:287source/checksPASS/build0.1.2exit0, Sandbox sigue0.1.0loaded; ninguna escritura nativa nueva. Se detectó y respaldó corrupción de46campos de identidad causada por el propio redactor del gestor, sin pérdida de notas. Sourcefix publicado y propuesta selectiva desde backups originales; el target sigue native/loadedtrue en lectura propia20:45. READY revisada debe recibir START para reparación/build, luego aceptación visual/funcional y siguiente arranque. Estado anterior de cuotas/CLI/WDA en párrafos previos es histórico y no configura una prohibición vigente.

Según instrucción humana actual, las pruebas UI en Sandbox iPad pueden continuar cuando sus archivos hayan llegado realmente por Sync y el supervisor asigne la ventana. WDA18100 fue acreditado por su owner a las20:04; este proyecto no ha iniciado otro bridge ni ha escrito archivos móviles. La recuperación ENSO iPad sigue aplazada y no se infiere permiso para preparar fixtures allí directamente.

2026-10-01 18:15 Madrid, Codex: corrección humana transmitida por el supervisor de integridad. Este proyecto no realiza copy/write/rename/move/delete directamente en el iPad, incluidos vaults, .obsidian y fixtures, sin petición explícita de Eme para esa operación. El estado de Obsidian Sync no convierte una escritura directa en autorización. Los cambios ordinarios llegan por Sync. Una prueba de la opción de archivo en iPad requiere una operación explícitamente solicitada allí y evidencia física; no usar AFC o devicectl para preparar carpetas por inferencia. Este proyecto no ha escrito archivos del iPad.

All human-review documents, source repositories, research and receipts live in the ENSO project. Sandbox contains only installed runtime files, technical migration backups and disposable agent test fixtures. This project has not created Tasks/ or review labs in Sandbox. If note fixtures become necessary, create them under Agent Testing/AIgility Plugin Manager/ with owner and README instructions, then move any review material into the ENSO project through Obsidian.

Global restricted mode, core toggles and vault reload require a fresh coordinated window from the active Sandbox owners. The manager-only build update and three own fixture plugins preserve every foreign plugin's native and loaded state. Temporary all-plugin protections used in Sandbox must never be copied into production ENSO.

Snapshot 2026-10-01 18:32 Madrid: la fuente con archivo de descargados compila y la suite integrada aprueba263 pruebas; no se ha actualizado el build inicial instalado de Sandbox con esa función. La evaluación sincrónica del host volvió a responder, pero la lectura de data.json por su adapter no devolvió una respuesta verificable. La prueba nativa debe acreditar primero esa lectura antes de modificar archivos. Ante la incidencia móvil coordinada se mantienen en pausa los despliegues globales y cualquier intervención directa en iPad.

## Current Mac Sandbox observation

2026-10-01 21:50 Madrid, Codex.0.1.3 instalado, habilitado nativamente y cargado realmente en Mac Sandbox. El deploy comprueba hashes de3artifacts y preserva configuración,7perfiles/42fixtures,49community ajenos/30core y pausa de recuperación previa. No hay binding inferido ni reanudación automática. Aceptación UI preparada en un procedimiento independiente; aceptación funcional y siguiente arranque permanecen pendientes. Ninguna instalación o escritura iPad efectuada por este proyecto; los demás seis dispositivos no tienen prueba física acreditada.
