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

### 2.1 Features & capabilities (12)
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

### 2.2 Flows
Load tardío no aplica perfiles. Los siete perfiles tienen applyAtStart true y requieren binding local explícito. Templates Desktop a macbook/zenbook, Mobile a iphone/s24, Tablet a ipad/lenovo tab/boox tab mini c. Omnisearch deferred activo se incluye en templates compatibles. Core inicial deriva estado vivo por ausencia en snapshots. Editar tags no aplica en caliente. Debugging nunca reescribe config de terceros.

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

### 5.2 Acceptance (10)
- [x] AC-1 - npm test/build return 0; evidence/tests.txt/build.txt. Snapshot 2026-10-01 15:48 Madrid: 228 pruebas aprobadas y build exit0. Revalidar después de cambios posteriores.
- [ ] AC-2 - Migración tags/templates/core/deferred/fixtures; tests y receipt.
- [ ] AC-3 - UI/sidebar en Sandbox; evidence/sandbox.json y screenshot.
- [ ] AC-4 - Full/core/protected/incompatible/fixture/undo; tests + Sandbox.
- [ ] AC-5 - Deferred native exclusion, single load, parked, cancel; tests + Sandbox.
- [ ] AC-6 - Restricted/late/interrupted/debug recovery; tests + Sandbox.
- [ ] AC-7 - Persist conflict y manual edits; fault tests.
- [ ] AC-8 - Beta/pin/update/rollback/assets/rate-limit; fake transport y live check.
- [ ] AC-9 - Debug individual/pair/complement/undo/restore/export/AMD unload; tests + Sandbox.
- [ ] AC-10 - ENSO installed/enabled/loaded/UI/restart; evidence/enso.json + device runbook.

### 5.3 Decisions (5)
- [x] TD-1 - accepted - Nuevo ID aigility-plugin-manager; usuario aprobó plan 2026-10-01. Reabrir por incompatibilidad de migración.
- [x] TD-2 - accepted - Deferred de Companion, sin takeover global; usuario y código inspeccionado. Revalidar si cambia API host.
- [x] TD-3 - accepted - Funciones vigentes Companion y Advanced Debug bajo demanda; usuario. Reabrir por nueva instrucción.
- [x] TD-4 - accepted - Templates con auto-start/core tags; usuario. Core inicial snapshot vivo.
- [x] TD-5 - accepted - app.plugins.isEnabled y late load; código host 1.14.3. Revalidar en nueva versión.

### 5.4 QA
Adapters falsos DOM-free; CLI con nombre de vault comprobado; screenshots; comparación before/after. No pruebas destructivas en ENSO.

### 5.5 Checkpoint
2026-10-01 15:48 Madrid, Codex: módulos y comandos integrados implementados; 228 pruebas/build aprobados. Sandbox instalado/habilitado/cargado, migración7perfiles/42fixtures preservada. La aceptación nativa funcional todavía está en ejecución; no sustituir gestores ENSO hasta esa aceptación. Research de septiembre es histórico, no configuración actual.

## 6. Delivery & Acceptance Runbook
Verificar build marker y binding. Probar filtros/perfiles/core/deferred/recovery/debug/beta rollback. Matriz macbook, zenbook, iphone, ipad, s24, lenovo tab, boox tab mini c: distinguir pruebas físicas, emuladas y pendientes por acceso. Referencias de vault en documentos usan wikilinks sin alias; hidden/external files usan links navegables. No editar AGENTS/REMEMBER ni index.md.
