# AIgility Plugin Manager - Software Specification

**Spec version:** 0.1.0 - **Date:** 2026-10-01 - **Session:** 01a0f6b6-f3c0-7882-9361-4badf10965d1

## 1. Introduction & Context

### 1.1 Needs (4)
- [ ] N-1 - Need.unsatisfied - Una sola superficie para community y core plugins.
- [ ] N-2 - Need.unsatisfied - Perfiles completos por equipo basados en tags con asociación local.
- [ ] N-3 - Need.unsatisfied - Deferred loading y recuperación sin activaciones involuntarias.
- [ ] N-4 - Need.unsatisfied - Betas y debugging reversible con evidencia.

### 1.2 Scope
El plan aprobado en chat es el alcance. Fork de BPM, funciones vigentes de Companion (workspaces, backups, perfiles de pruebas y guards) y Advanced Debug Mode bajo demanda. No borrar fuentes ajenas ni backups históricos. Primero Sandbox, después ENSO.

### 1.3 Success metrics
Build y tests con exit code 0; importación sin pérdida; UI real; 723+ plugins sin historiales completos retenidos; diferidos fuera del arranque nativo; cambios limitados al conjunto autorizado.

## 2. Functional Requirements

### 2.1 Features & capabilities (13)
- [ ] FR-1 - Requirement.open - N-1: Lista compacta, filtros nombre/ID/tag/grupo/core-community, menú secundario, sidebar filtrable y Opciones.
- [ ] FR-2 - Requirement.open - N-2: Siete perfiles, tags múltiples, CRUD, Apply at start true, binding local por appId.
- [ ] FR-3 - Requirement.open - N-2: Perfil completo activa miembros compatibles y desactiva otros; gestor protegido; protecciones editables; preview/undo.
- [ ] FR-4 - Requirement.open - N-1: Core plugins con mismas tags, APIs y readback.
- [ ] FR-5 - Requirement.open - N-3: Diferidos fuera del arranque nativo, enablePlugin no-save, timers cancelables/escalonados, parked off.
- [ ] FR-6 - Requirement.open - N-3: Restricted mode, late load, operación interrumpida y debugging suspenden toda automatización; diferidos siguen excluidos.
- [ ] FR-7 - Requirement.open - N-3: Migración idempotente, templates/core actual, Omnisearch efectivo, estado para agentes, conflicto de escrituras.
- [ ] FR-8 - Requirement.open - N-4: GitHub releases/prereleases, pin, updates ligeros, validación, backup/rollback sin perder data.json.
- [ ] FR-9 - Requirement.open - N-4: Debug individual/pareja, historial/complemento/undo, persistencia, restore respeta cambios manuales, export.
- [ ] FR-10 - Requirement.open - N-4: Advanced Debug integrado bajo demanda con consola, trazas, timeouts, emulación/abort y restauración por plataforma.
- [ ] FR-11 - Requirement.open - N-2: Fixtures con IDs originales, edición/backups/apply parcial y workspace por perfil.
- [ ] FR-12 - Requirement.open - N-3: Guards de Companion reversibles/versionados; eliminar bridges/no-op y migrar referencias.
- [ ] FR-13 - Requirement.open - N-1/N-3: Gestionar descargados mediante archivo completo en .obsidian/plugins/_archive, conservando configuración y archivos propios; sólo community plugins apagados y no protegidos; restauración manual o por perfil compatible en cola común, índice local y detección de conflictos/Sync.

### 2.2 Flows
Load tardío no aplica perfiles. Los siete perfiles tienen applyAtStart true y requieren binding local explícito. Templates Desktop a macbook/zenbook, Mobile a iphone/s24, Tablet a ipad/lenovo tab/boox tab mini c. Omnisearch deferred activo se incluye en templates compatibles. Core inicial deriva estado vivo por ausencia en snapshots. Editar tags no aplica en caliente. Debugging nunca reescribe config de terceros.

### 2.3 Recovery fixes (3)

Observaciones reproducidas el 2026-10-05 por Codex sobre 0.1.3; estos casos amplían FR-6/FR-7, sin cambiar preferencias de dispositivo.

- [ ] FIX-14 - Fix.checked - Una operación aceptada en la cola antes de dispose ejecuta su callback y escribe State después del unload. La cola comprueba disposed sólo al aceptar, no al ejecutar. Debe rechazar el callback pendiente antes de cualquier efecto y bloquear escrituras todavía no enviadas de una transacción ya activa, incluso tras el await de freshness. Evidencia: tests/recovery-lifecycle.test.mjs, tres casos unload; evidence/recovery-lifecycle-before.txt y evidence/recovery-lifecycle-store-before.txt. El primer fixture adicional bloqueó también el readback: intento interrumpido localmente, conservado en recovery-lifecycle-active-before.txt; el fixture corregido sólo bloquea la primera lectura y reproduce los dos fallos nuevos.
- [ ] FIX-15 - Fix.checked - Resume elimina recoveryReason/operationPending en memoria antes de persistir; si localStorage falla, la recuperación deja de estar activa en memoria. El reconocimiento debe conservar ambos estados anteriores cuando falla la persistencia, incluida la lista de operaciones abandonadas. Evidencia: tests/recovery-lifecycle.test.mjs, caso local persistence; evidence/recovery-lifecycle-before.txt.
- [ ] FIX-16 - Fix.checked - Pause durante el await de refresh dentro de resume queda borrado por ese resume. Debe capturarse la generación al solicitar resume, comprobarla al tomar cola y después del await, y rechazar conservando el motivo nuevo. Evidencia: tests/recovery-lifecycle.test.mjs, caso pause during refresh; evidence/recovery-lifecycle-before.txt.

La asociación de ENSO permanece sin modificar. Companion legado seleccionaba desktop por plataforma, sin binding físico por appId; macbook/zenbook comparten su origen. La comparación de configuración observada detecta VoiceInk Companion activo fuera del membership macbook. El preview debe preservar su activación recientemente autorizada y separar la vinculación local de las transiciones de plugins. Aplicar ese preview requiere autorización posterior; esta iteración no deduce preferencias nuevas.

## 3. Architecture & Data Model

### 3.1 Stack
TypeScript, Obsidian API, esbuild y Node tests. Fuente BPM conservada en fork; entrada integrada; Advanced Debug con atribución MIT.

### 3.2 Canonical contract
State schemaVersion=1: tags, groups, records community:id/core:id, deviceProfiles, fixtureProfiles, deferred, protected, profileBackups, githubSources, settings, debug, undo, migration, legacyBpm. DeviceProfile id/name/tagIds/applyAtStart/workspaceId. PluginRef kind community|core + id. LocalState en localStorage por appId: deviceProfileId/recoveryReason/operationPending. effective-state.json registra installed/desired/nativeAutostart/loaded/scheduled/reason/version sin secretos. Metadata original se conserva. Cola única; preimage comprobado antes de writes; conflicto relee disco, no sobrescribe.

### 3.3 Rendering & interfaces
Community plugins mejorado y Opciones en sidebar; desmontaje restaura DOM/listeners/wrappers. ManagerAPI conecta UI; ModuleHost conecta GitHub/Debug. Commands manager-<id> y manager-profile-<id>-apply migran referencias.

### 3.4 Recovery
Snapshot de campos tocados; operationPending antes de mutaciones; APIs verificadas; undo respeta ediciones posteriores; generación cancela timers. Restricted host no ejecuta gestor: cubrir transición observable y reactivación tardía sin prometer detección retrospectiva.

## 4. Non-Functional Requirements (5)
- [ ] NFR-1 - SecretStorage para token; sin secretos en informes/State/Git.
- [ ] NFR-2 - Node/Electron sólo desktop; vault API mobile.
- [ ] NFR-3 - Concurrencia preservada; commits pathspec exacto.
- [ ] NFR-4 - Requests acotadas, catálogo completo, releases on demand.
- [ ] NFR-5 - UI nativa, touch 48px, errores visibles y lifecycle reversible.

## 5. Milestones & Quality Assurance

### 5.1 Deployment
Spec/contrato; módulos; unit/build; Sandbox real; migración ENSO backup/readback; restart; matriz física según acceso.

### 5.2 Acceptance (11)
- [x] AC-1 - npm test/build return 0; evidence/tests.txt/build.txt. Snapshot 2026-10-01 21:50 Madrid: 299 pruebas aprobadas, sin skips; producto0.1.3/_archive mantiene build exit0. Incluye checks de despliegue y harness; no equivalen a ejecución nativa. Revalidar después de cambios posteriores. La compilación no acredita aceptación nativa.
- [ ] AC-2 - Migración tags/templates/core/deferred/fixtures; tests y receipt.
- [ ] AC-3 - UI/sidebar en Sandbox; evidence/sandbox.json y screenshot.
- [ ] AC-4 - Full/core/protected/incompatible/fixture/undo; tests + Sandbox.
- [ ] AC-5 - Deferred native exclusion, single load, parked, cancel; tests + Sandbox.
- [ ] AC-6 - Restricted/late/interrupted/debug recovery; tests + Sandbox.
- [ ] AC-7 - Persist conflict y manual edits; fault tests.
- [ ] AC-8 - Beta/pin/update/rollback/assets/rate-limit; fake transport y live check.
- [ ] AC-9 - Debug individual/pair/complement/undo/restore/export/AMD unload; tests + Sandbox.
- [ ] AC-10 - ENSO installed/enabled/loaded/UI/restart; evidence/enso.json + device runbook.
- [ ] AC-11 - Archive exact .obsidian/plugins/_archive; carpeta completa y configuración conservadas; doble traslado/conflicto/protección/recovery/Sync probados; restauración sin reinstalar; lista Descargados y catálogo723; native roundtrip sólo en entorno donde Sync permita mover sin propagar retirada. Las pruebas offline y el guard visible no acreditan mejora física en iPad.

### 5.3 Decisions (5)
- [x] TD-1 - accepted - Nuevo ID aigility-plugin-manager; usuario aprobó plan 2026-10-01. Reabrir por incompatibilidad de migración.
- [x] TD-2 - accepted - Deferred de Companion, sin takeover global; usuario y código inspeccionado. Revalidar si cambia API host.
- [x] TD-3 - accepted - Funciones vigentes Companion y Advanced Debug bajo demanda; usuario. Reabrir por nueva instrucción.
- [x] TD-4 - accepted - Templates con auto-start/core tags; usuario. Core inicial snapshot vivo.
- [x] TD-5 - accepted - app.plugins.isEnabled y late load; código host 1.14.3. Revalidar en nueva versión.

### 5.4 QA
Adapters falsos DOM-free; CLI con nombre de vault comprobado; screenshots; comparación before/after. No pruebas destructivas en ENSO.

### 5.5 Checkpoint
2026-10-01 18:32 Madrid, Codex: módulos, comandos y archivo de descargados implementados; 263 pruebas/build aprobados. El Sandbox conserva instalado/habilitado/cargado el build inicial, anterior a esta ampliación; migración7perfiles/42fixtures preservada. Aceptación nativa funcional y siguiente arranque pendientes. No sustituir gestores ENSO hasta esa aceptación. Research de septiembre es histórico, no configuración actual.

## Historical identity redaction recovery checkpoint

2026-10-01 20:55 Madrid, Codex. Eme autorizó continuar el desarrollo y deploy con plugins/_archive. La observación propia de Sandbox20:45 confirma instalado/cargado0.1.0, target enso-secret-placeholders nativo y cargado, binding local sin asignar y debugging inactivo. Se comprobó un fallo del gestor: la detección de nombres de campos secretos confundía IDs de plugins con propiedades de credenciales. Se conservaron4archivos byteexactos antes de cambios; el inventario identifica46campos afectados:1record,21fixturemembers,2backupstates y22mapaslegacy. No afecta a notas ni se presenta como incidente de integridad del vault.

Fuente0.1.2 publicada enb7f6472. Redacción distingue claves canónicas y mapas de IDs planos pluginStates/githubSources, recorriendo sus valores para seguir ocultando credenciales reales. La regresión se ejecuta por onload, cola/save, refresh y list; cubre IDs que contienen secret/token/password, fixtures, snapshots, backups, fuentes GitHub y rawlegacy. Suite287PASS, buildexit0. La primera unidadLuna falló el checker tras ampliarse el caso con nuevos datos observados; la siguiente unidad acotada pasó92.5s. Son resultados de fuente, no deploy.

- [x] Corregir la causa y conservar pruebas que reproducen el fallo anterior.
- [x] Preparar reparación selectiva46campos desde los backups originales, manifest previo a migración y activación histórica contrastada con el host actual; no inventar booleanos ni restaurar State completo.
- [x] Comprobar que la propuesta sólo cambia campos dañados; valores válidos y propiedades ajenas permanecen iguales.
- [x] Corregir verificador: token distinto por fase, deadline host antes de cada mutación posterior a await, incluyendo rollback, y no reload con artifacts iguales.
- [x] Ejecutar reparación/deploy0.1.2 en Sandbox - PASS nativo19:20:08Z,46campos reparados selectivamente,7perfiles/42fixtures y49community/30core preservados. Receipt sandbox-build.json. READY consumida, no repetir reparación.
- [ ] Aceptación funcional/visual y siguiente arranque. ENSO conserva sus gestores hasta completar esa evidencia.

La copia de configuración y la propuesta detallada están en local-backups ignorados por Git; las receipts publicadas sólo contienen hashes, rutas de campos, tipos y resultados. Si el preimage cambia o el target ya no está activo, la unidad rechaza la reparación y requiere releer el estado. Rollback revierte únicamente postimages propios coincidentes antes de recargar el binario anterior; conserva ediciones manuales conflictivas. No cambia Sync, perfiles ajenos ni archivos iPad.

## 6. Delivery & Acceptance Runbook
Verificar build marker y binding. Probar filtros/perfiles/core/deferred/recovery/debug/beta rollback. Matriz macbook, zenbook, iphone, ipad, s24, lenovo tab, boox tab mini c: distinguir pruebas físicas, emuladas y pendientes por acceso. Referencias de vault en documentos usan wikilinks sin alias; hidden/external files usan links navegables. No editar AGENTS/REMEMBER ni index.md.

## 7. Downloaded Plugin Archive

2026-10-01, Codex. Ampliación solicitada directamente por Eme en chat: conservar plugins descargados y su configuración sin mantener todos sus manifests en el catálogo nativo.

- [x] FR-13 - Requirement.implemented - Archivar/restaurar carpetas community completas mediante vault.adapter.rename, con índice local, identidad comprobada y sin reinstalación. Sólo archivar plugins apagados en estado deseado, nativo, real y programado; conservar tags, grupos, versiones, fuentes y pins. Excluir core, gestor y protecciones.
- [x] FR-14 - Requirement.implemented - Opciones incluye Descargados, búsqueda y páginas de 50; distingue disponible en archivo de instalado en catálogo. Restaurar manualmente deja el plugin apagado; aplicar un perfil restaura sus miembros archivados compatibles dentro de la misma cola antes de activarlos.
- [x] FR-15 - Requirement.implemented - Comprobar Sync antes de mover: la exclusión del archivo del catálogo no impide que el borrado de la ubicación activa se propague. Con Installed community plugin list sincronizada, exigir su desactivación local para archivo por equipo. Estado de Sync desconocido requiere diagnóstico, nunca una garantía inventada.
- [ ] AC-11 - Archivar reduce manifests de carpetas directamente dentro de plugins; restaurar conserva exactamente main/manifest/styles/data y archivos adicionales. Pruebas de conflictos, operaciones interrumpidas, perfil, betas, Sync y catálogo sintético >=723; prueba nativa sólo con fixtures propios.

Contrato, fuente del host, backend/UI por Ringer, integración y tests/build completados en fuente. Pendientes prueba reversible en Sandbox con archivos propios y medición física iPad bajo las restricciones de DEVICE-VALIDATION.md. AC-11 permanece abierto hasta observar el traslado real y su restauración. No archivar automáticamente el catálogo real durante el desarrollo.

## Current native deployment checkpoint

2026-10-01 21:50 Madrid, Codex. La unidad0.1.2 reparó los46campos y verificó carga real sin cambios ajenos. La revisión posterior del código de Obsidian1.14.3 identificó que Community plugins se renderiza por renderTab, mientras la integración sólo interceptaba display. La fuente0.1.3 añade hooks de renderTab/update, reserva display para hosts anteriores, monta una vez durante refrescos anidados y conserva retornos, errores, estilos e identidades de métodos. Source c28913a,63UI/299suite y build0.

Deploy0.1.3 pasó en Sandbox19:47:29.006Z. Sólo se escribieron main.js y manifest.json propios; styles.css ya coincidía. Version/build/native/_loaded y3SHA verificados. State completo,7perfiles de equipo/42de pruebas,49community ajenos/30core, protecciones y configuración local permanecieron iguales. Sin reparación repetida, traslados, cambios Sync/iPad ni sustitución en ENSO. Receipt sandbox-build-v013.json.

- [x] Corregir y comprobar el lifecycle de la lista Community del host vigente.
- [x] Desplegar0.1.3 en Mac Sandbox y verificar estado efectivo y preservación.
- [ ] Aceptación UI nativa - procedimiento con guardas/capturas preparado; espera su turno coordinado, no acredita todavía la interfaz.
- [ ] Aceptación funcional de perfiles, diferidos, debugging y betas - fixtures acotados pendientes de ejecución.
- [ ] Siguiente arranque y migración ENSO - después de evidencia funcional; los gestores existentes siguen activos.

## Current acceptance procedure checkpoint

2026-10-02 00:18 Madrid, Codex. Producto0.1.3 ya desplegado/cargado en Mac Sandbox el2026-10-01T19:47:29Z, con State completo/protecciones/local/perfiles7-42 y estados ajenos preservados. No hay nuevo build;299PASS/build0 siguen siendo la evidencia de fuente anterior. UI R3 cerrada FAILED por precondición, sin apertura ni capturas; su cleanup sí refrescó filtros existentes. Nuevo UIb08a/37checks exige activeTab efectivo registrado y cero cleanupUI antes de ownership, esperando ventana nueva y reparación por su owner.

Controller de perfiles y runner180/120/60 publicados en f80cdac:40checks offline PASS mediante Ringer p93713, con ManagerRuntime real y APIs nativas simuladas. Once pasos, baseline/intents/postimages durables, sólo dos fixtures propios, limpieza por hashes/generaciones/CAS y readback independiente State/local/foreign/core/workspace/Settings. READY exige nuevo START/ACK; ninguna ejecución nativa ni fixture creado. Source, instalación/carga y aceptación funcional/visual siguen siendo resultados distintos. No hay sustitución ENSO ni traslados físicos a _archive.

## Recovery refinement checkpoint

2026-10-05, Codex: FIX-14/15/16 comprobados offline sobre candidato 0.1.4. Siete regresiones de lifecycle: cinco fallos originales/de escrituras activas y dos huecos detectados en la revisión del primer parche (resume en cola y refresh tras unload). Antes: recovery-lifecycle-before.txt, recovery-lifecycle-store-before.txt y recovery-lifecycle-peer-before.txt; después: recovery-lifecycle-focused-final.txt con 61 PASS. Candidato LocalState se persiste antes de publicar y conserva su referencia. RuntimeStore usa un guard opcional compatible justo antes de writes. La aceptación nativa, la captura visual y el deployment 0.1.4 siguen pendientes de nuevas ventanas; ENSO conserva 0.1.3 y no se ha vinculado ni aplicado macbook. Revisiones críticas independientes de Tasks y UI aprobadas en lectura de source; no equivalen a aceptación nativa. Intento GLM sin resultado por timeout y AGY con source entregado pero FAIL de ruta de notes.md conservados como tales.

## Recovery acceptance checklist

2026-10-05, Codex, candidato 0.1.4. Estado de esta iteración; el checkpoint de 0.1.3 es histórico.

- [x] Siete regresiones antes/después, 61 pruebas focales y build del candidato final.
- [x] Dos revisiones de source independientes, con límites de I/O ya enviado explícitos.
- [x] Adaptador de entrega endurecido y cinco pruebas offline de su código emitido; evidencia recovery-delivery-v014-faults-final.txt. El primer intento de fixture incompleto se conserva como error en recovery-delivery-v014-faults.txt.
- [x] Deploy y readback actuales Sandbox: MANAGER014-SANDBOX-20261005-R1, ACK17:26:51.524Z, native17:26:51.966Z con 24 PASS, readback17:28:07.911Z con 12 PASS. Source/State/local/foreign/core/Settings/leaves/foco preservados; lease RELEASE. Sigue pausado, sin binding ni apply.
- [ ] Flujos lifecycle con fixture propio y captura Community/Options/Downloaded/error: adaptaciones en preparación, sin llamadas nativas.
- [ ] Deploy aceptado y readback ENSO: necesita aceptación Sandbox; no incluye binding, Apply at start ni Resume por inferencia.

2026-10-05T17:28:07.911Z, Codex: candidato 0.1.4 instalado/native/loaded en Sandbox9/9 tras una única recarga propia. State SHA31e5b0b9ae6a31d4374411883352ae10210c2459682b8dacb8d7fb5e285013c4, siete perfiles y 42 fixtures exactos. No hubo Resume ni Apply at start. El inventario previo observó ENSO10 con renderer crashed; ese evento no se atribuye al Manager y la recuperación está a cargo del supervisor. Las comprobaciones lifecycle/UI propuestas no se han ejecutado en host.
