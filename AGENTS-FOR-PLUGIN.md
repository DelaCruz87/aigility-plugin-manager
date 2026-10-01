# Agent guide for AIgility Plugin Manager

## Effective state

[effective-state.json](file:///Users/eme/Obsidian/ENSO/.obsidian/plugins/aigility-plugin-manager/effective-state.json) is generated from the live Obsidian host by AIgility Plugin Manager. It is a read-only observation for agents, not a command input or a substitute for manager State.

The report includes `installation.appId`, `installation.vaultName` and platform provenance. When Sync copies this file between devices, it remains the last writer's observation. Match that identity and `generatedAt` to the current host before interpreting it as local state. The device binding stays in localStorage and is not a synchronized setting.

Each row carries `kind`, `id`, `installed`, `archived`, `desired`, `nativeAutostart`, `loaded`, `scheduled`, optional `reason`, and `version`:

- `installed` reports whether Obsidian has a plugin manifest.
- `archived` reports locally available files excluded from the native manifest catalog.
- `desired` reports the manager's saved target state.
- `nativeAutostart` reports the host's persisted startup setting.
- `loaded` reports whether a plugin instance is active in the current app session.
- `scheduled` reports a manager deferred load currently queued for this session.
- `reason` explains a condition such as protection, incompatibility, recovery pause, deferred scheduling or a parked policy.

Do not collapse these fields into a single enabled/disabled claim. Deferred plugins may be installed and desired while native autostart is false and the plugin is not loaded yet. State persistence recursively redacts credential-shaped keys. Migration backups intentionally preserve original legacy bytes locally and must not be copied into source control or reports.

## Native plugin IDs

For core plugins, accept only IDs present in the live `app.internalPlugins.plugins` registry. Read `wrapper.enabled` for current native enablement and `wrapper.instance?._loaded === true` for loaded state. The existence of an instance alone does not establish that it is loaded. Do not call `internalPlugins.enable(id, enabled)`; Obsidian's `enable()` has no ID parameter and can rehydrate all core plugin settings. Use the supported per-plugin wrapper methods through the manager runtime, then save and read back host state.

The live [core-plugins.json](file:///Users/eme/Obsidian/ENSO/.obsidian/core-plugins.json) was inspected on 2026-10-01. Its currently enabled IDs were:

```json
[
  "file-explorer",
  "global-search",
  "switcher",
  "backlink",
  "canvas",
  "outgoing-link",
  "tag-pane",
  "properties",
  "page-preview",
  "daily-notes",
  "note-composer",
  "command-palette",
  "slash-command",
  "bookmarks",
  "outline",
  "word-count",
  "slides",
  "workspaces",
  "file-recovery",
  "sync",
  "bases",
  "webviewer"
]
```

This list records a one-time live observation, not a timeless allowlist. Obsidian versions can add or remove core plugin IDs; inspect the current registry and linked configuration before using IDs in a test or operational report. Do not invent IDs, add comments to JSON fixtures, or infer core IDs from display names.

## Lifecycle and recovery

[[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/main]] captures `app.workspace.layoutReady` before awaiting any startup work and passes that observation to `runtime.start(wasLayoutReady)`. It writes and verifies the state baseline before startup automation. Restricted Mode, late load, interrupted operations, an active debug session and a loaded legacy Companion suspend automation. Runtime guards are installed only while the manager is loaded and must be disposed synchronously before the runtime is stopped.

If debugging was interrupted, report the stored session and request deliberate recovery. Never reapply its old snapshot automatically. Native exclusion for deferred plugins remains in force while automation is paused.

## Build and verification

The production bundle is built from root [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/main]]. `managerBuild` and the plugin manifest version identify the active build. Do not claim module integration from a green typecheck alone; inspect the bundle entry and run the requested lifecycle tests. A build does not establish Sandbox rendering or physical-device acceptance.

## Manual profile confirmation

A comparison is bound to the runtime snapshot that produced it. If profile membership, tags or host state change before confirmation, the manual apply rejects that comparison and requires a new preview. Startup application does not use an interactive comparison. A rejected comparison must not be bypassed by calling the unguarded startup path.

## Downloaded plugin archive

2026-10-01, Codex. El código incorpora un archivo local reversible mediante la API de archivos del vault. Los manifests archivados quedan debajo de un contenedor sin manifest propio; el loader inspeccionado no recorre esos descendientes. El informe distingue archivos archivados de plugins instalados, habilitados o cargados. No interpretar installed=false como ausencia de los archivos descargados.

Descargados pagina50 elementos y conserva tags/grupos de State. Restaurar manualmente deja el plugin apagado. El perfil completo y los perfiles de pruebas restauran sus miembros compatibles declarados dentro de su propia operación en cola. Deshacer activación conserva los archivos restaurados disponibles; nunca elimina data.json para volver a un estado previo.

Las betas y rollback rechazan escribir sobre un ID archivado, incluso si el índice en memoria quedó desactualizado. Un journal pendiente exige Recuperar operación explícitamente; recuperar el archivo no reanuda perfiles, workspaces ni diferidos.

Sync requiere comprobar Installed community plugin list en el equipo actual. El archivo está fuera del catálogo nativo, pero retirar archivos de su ubicación original puede transmitir borrados si esa opción está habilitada. Desactivarla también afecta la sincronización del data.json del gestor. No modificar Sync por inferencia ni prometer un protocolo nuevo de sincronización de perfiles.

La validación del archivo mediante tests no equivale a validación nativa o física en iPad. Consultar el checklist del proyecto y DEVICE-VALIDATION.md antes de afirmar que sustituye en exclusiva BPM y Companion.
