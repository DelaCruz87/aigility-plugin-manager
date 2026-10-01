# Device Validation

Date: 2026-10-01. Author: Codex. This is an execution ledger for the user-approved plan, not evidence that every installation has been validated. Source tests, emulation and a physical device run are separate observations.

## Matrix

| Profile | Tag | Template | Source definition | Physical validation | Local binding |
| --- | --- | --- | --- | --- | --- |
| macbook | macbook | Desktop | Created; Apply at start true | Initial Sandbox installation loaded on Mac; functional acceptance and next startup pending | Sandbox unset intentionally; ENSO migration pending |
| zenbook | zenbook | Desktop | Created; Apply at start true | No accessible device session verified | Pending explicit assignment on that installation |
| iphone | iphone | Mobile | Created; Apply at start true | No connected iPhone verified | Pending explicit assignment on that installation |
| ipad | ipad | Tablet | Created; Apply at start true | Physical iPad connected; Obsidian closed and unlock pending in Filetree session; this manager not deployed there | Pending explicit assignment on that installation |
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

All human-review documents, source repositories, research and receipts live in the ENSO project. Sandbox contains only installed runtime files, technical migration backups and disposable agent test fixtures. This project has not created Tasks/ or review labs in Sandbox. If note fixtures become necessary, create them under Agent Testing/AIgility Plugin Manager/ with owner and README instructions, then move any review material into the ENSO project through Obsidian.

Global restricted mode, core toggles and vault reload require a fresh coordinated window from the active Sandbox owners. The manager-only build update and three own fixture plugins preserve every foreign plugin's native and loaded state. Temporary all-plugin protections used in Sandbox must never be copied into production ENSO.
