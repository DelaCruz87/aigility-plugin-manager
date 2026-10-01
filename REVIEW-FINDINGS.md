# Review Findings

## Resolution ledger - 2026-10-01 15:14 Madrid

Codex: las secciones posteriores conservan hallazgos históricos de esta sesión, no el estado vigente ni órdenes para recuperar código anterior. Los contratos 1-9 y 11-22 ahora tienen reparaciones y pruebas ejecutadas; el core diagnóstico usa el camino persistente real, las escrituras pasan por la cola y los diferidos no entran en arranque nativo. UI añade validación de políticas nuevas antes de reconciliar y selección activa de debugging; 58 pruebas UI aprobadas. Debugging y sus contratos integrados: 29 aprobadas, incluido desired=true sin carga ni programación.

Pendiente: aceptación nativa de filtros/Opciones, perfiles/diferidos/debugging/betas, modo restringido y siguiente arranque, comandos actualizados y despliegue ENSO. El primer harness funcional y su reemplazo escrito en scratch fueron rechazados, aunque Ringer marcó PASS: los archivos entregados no acreditaban ejecución real segura. El instalador posterior sí instaló en Sandbox, con comprobación independiente instalada/habilitada/cargada; su checker repetido rechazó sobrescritura y marcó FAIL. Se mantienen ambas evidencias sin convertir stage en aceptación.

## Additional host gates - 2026-10-01

- Core diagnostics: the independent integrated-contract check models wrapper.enable(false) updating both enabled and instance._loaded. The current runtime forwards loadNow=true and fails native readback. Keep this check unchanged; the runtime must use the real persisted core path and the session must restore its postimage.
- Deferred policy editing: UI needs a real direct transaction reconcileDeferred(ref). The native exclusion must occur even for a newly created policy and the loaded instance must remain off during recovery. UI writes must call this at a point consistent with the runtime contract.
- Interrupted main startup: unconditional baseline save previously rejected a pending marker and unloaded the only recovery UI. The eight integration tests now pass with baseline establishment skipping the pending write and preserving explicit resume.
- Sandbox harness: the first implementation staged the manager without functional acceptance and restored files after replacing its expected hash with the live hash. Both are rejected. The replacement must execute real host cases and preserve foreign changes through recorded postimage checks.

2026-10-01, Codex. Active review while modules are being implemented. Findings below are reproduced against actual host contracts; fix before any deployment. They are not evidence of a finished module.

## Runtime adapter - confirmed by executed tests

Command: node --test tests/host-contract.check.mjs. Result: 4 failed/4 on initial adapter implementation.

1. isRestricted() reads fabricated isRestrictedMode/restrictedMode fields. Host1.14.3 authoritative app.plugins.isEnabled() is global zero-argument boolean.
2. loadDeferred -> setCommunity noSave adds ID to enabledPlugins and calls saveConfig, violating nonpersistent activation and native exclusion.
3. loadWorkspace assumes app.workspace.loadWorkspace. Actual core Workspaces instance from app.internalPlugins.getPluginById('workspaces').instance owns loadWorkspace/saveData/workspaces.
4. Enabling only checks native saved flag. Native flag true with no loaded instance is not successful load; separate real load readback and report/recover on failure.
5. Runtime tests fake isEnabled(pluginId) per ID, unlike actual host global isEnabled(). Rework fake to actual global semantics so tests cannot bless invalid APIs. Ordinary isEnabled(ref) must read native desired/autostart separately from actual loaded. Core uses wrapper enable(false)/disable(false) and internalPlugins.saveConfig().

## GitHub - confirmed source/host observations

6. checkAll queries 50-release history for every installed plugin. Plan requires current-version checks without release history; official stable use latest release or current manifest, beta latest prerelease bounded one/few statuses, detailed100-history only explicit releases() picker.
7. All app.version/app.appVersion/app.vault.config.appVersion fields are absent in live Sandbox. Obsidian exports apiVersion to plugin require realm; import apiVersion from obsidian (public package .d.ts) or verified equivalent. CLI renderer require('obsidian') is not plugin loader require, so don't use renderer require failure to conclude export unavailable. Validate minimum app version with actual public export and test it when fake app version fields absent.
8. Plugin compatibility must check manifest.isDesktopOnly against Platform.isDesktopApp/mobile and actual app API version, not treat missing version as always compatible.

## Verification quality

9. Test helper imports bundled code as data URLs. Failed errors print enormous base64 code in stacks. Prefer temporary .mjs bundle file imports with pathToFileURL and cleanup; this changes only test harness, keeps behavior checks.
10. Report worker quota/cancellations as infrastructure, not code failure. GLM migration18tests and independent migration contract pass. Foundation3tests/build pass. UI initial fake DOM pass does not replace live Settings test.

## Cross-module state and queue review

11. runtime.save() enqueues, while GithubManager calls it inside runtime.enqueue. This deadlocks with the real serial queue; the GitHub fake enqueue executes immediately and misses it. Introduce an explicit transaction context passed by enqueue (save/setEnabled operations that do not re-enqueue), keep ordinary public methods queued; never use a global reentrant flag that admits unrelated concurrent calls.
12. Debug operations mutate multiple plugins through separate queued calls without a whole-step transaction. Atomic session steps and GitHub writes must share the runtime queue. Read actual loaded/native state, not only stored desired, before restore.
13. Runtime generations are private; DebugManager probes getMutationGeneration/readGeneration/getGeneration, all absent. Expose one real method; record native/manual changes even when a user deliberately changes back to the same value. Undo must not overwrite that intent.
14. computeProfile uses nativeAutostart as before and only updates desired on changed host toggles. A deferred desired=true/native=false outsider can retain desired=true when target membership=false and subsequently load. Compute desired for EVERY installed record, including unchanged native flags. Deferred members update desired but never enableAndSave; schedule only bound/applied membership AND policy enabled; manual profile application also cancel/exclude/reschedule correctly.
15. Recovery resume throws when operationPending exists but there is no UI/API to acknowledge it; manual apply withPending also throws. Add explicit recovery acknowledgment/refresh/readback and a usable Resume action, preserving abandoned-operation evidence. Late-load explicit Resume must actually permit scheduling after layoutReady, without retroactively auto-resuming before user action.
16. Sidebar pluginTabs contains BOTH core and community tabs in host1.14.3, verified IDs backlink/canvas/page-preview plus agility-links/etc. Resolve ref by core/community installed registry, filter core plugin-specific settings too; keep ONLY general category tabs untouched. Current community-only key tags hides core incorrectly.
17. effective-state report omits applied profile/local recovery/device binding/delays and membership. Include profile ID, reason/operation, policy delay, membership and four independent state fields with provenance, never secrets.

## Integration review - 13:22 Madrid

18. Independent tests/integrated-contract.check.mjs now executes real ManagerRuntime with real DebugManager. Both fail: runtime rejects loadNow=false deactivation and paused diagnostic mutations. Diagnostic transactions must mutate enabled/disabled while automation stays paused, without re-enqueueing; use one consistent origin='debugging'. Nonpersistent activation/deactivation preserves native flags for deferred plugins. Enabling a deferred test excludes native before load; disabling unloads without losing its policy or parked/desired state. A diagnostic operation may acknowledge its own pending label, never clear an unrelated interrupted operation automatically.
19. Runtime test doubles still contradict host signatures: communityHost.enablePlugin adds enabledIds although actual host no-save enablePlugin never does. Core disabled wrapper retains an instance without _loaded=false, so readback sees it loaded. Fix doubles to actual native/loaded semantics and retain the behavior assertions. Currently runtime suite 19/26; failures include core, delayed scheduling, recovery exclusion, and debug loading. Deferred tests need explicit applied/bound profile membership instead of expecting unbound arbitrary deferred IDs to schedule.
20. main.openOptions searches settingTabs, but installed plugin tabs are in pluginTabs; manager-options therefore reports a Notice instead of opening Opciones. Call managerUI.openOptionsModal directly. Guards logging uses plugin.managerRuntime while the real field is plugin.runtime, so visible diagnostics are lost.
21. integration.test.mjs still mocks global isEnabled(id) as per-plugin, unlike actual isEnabled() loading gate. It passes early-start tests while actually pausing as restricted. Make global true/false independent of enabledPlugins and assert absence of restricted pause on normal startup. Use temporary bundle file URLs instead of giant base64 stacks.
22. GitHub restoration requires native=true, so a loaded deferred native=false plugin is left off after update/rollback. Restore actual loaded postimage nonpersistently while retaining native exclusion and checking newer manual generations.

The independent fifth adapter check failed because self-call suppression spanned an await and swallowed an unrelated manual call. Free-model correction now passes all five checks; review its synchronous invocation scope before deployment. Prior PASS refers only to the earlier four-check contract.
