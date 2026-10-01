# Review Findings

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
