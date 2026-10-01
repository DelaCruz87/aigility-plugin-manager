# Community Manager Research

Date: 2026-10-01. Author: Codex. Context: implementation of the user-approved AIgility Plugin Manager plan. These observations describe the sources inspected on this date; future upstream changes require revalidation. The approved requirements remain in SPEC.md.

## Findings and choices

| Source | Observed capability | Integrated choice and alternative |
| --- | --- | --- |
| [Lazy Plugins source](https://github.com/alangrainger/obsidian-lazy-plugins/blob/main/src/main.ts) | Excludes delayed IDs through disablePluginAndSave, later loads with enablePlugin, and adds a small delay between plugins. Its README describes limits in observing manual native changes. | Reuse the nonpersistent loading pattern and simple staggering. Add generation tracking, profile membership and recovery cancellation rather than adopting its separate desktop/mobile state owner. Preserve normal native startup for ordinary plugins. |
| [BRAT developer guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md) | Release assets supply manifest/main/styles, exact frozen tags are supported, and latest selection can include prereleases. The guide describes semver comparison and release/manifest identity handling. | Use release assets, an explicit version picker and pinning. Validate identity and compatibility before mutation, preserve data.json and keep rollback files. Catalog checks remain bounded rather than retaining the full release history for every installed plugin. Beta tracking must permit a newer stable release too; the independent channel test rejects ignoring that transition. |
| [Bulk Plugins Manager README](https://github.com/kemus/obsidian-bulk-plugins-manager/blob/master/README.md) | Bisection, undo and complementary halves narrow a fault. Restoration respects plugins manually disabled since the original capture. The fork retains historical Divide & Conquer documentation. | Keep half/complement/previous actions, add individual and pair experiments, persist reproducible steps, and restore only matching session postimages and mutation generations. A full unconditional restoration was rejected because it could reactivate a plugin disabled manually. |
| [Advanced Debug Mode README](https://github.com/mnaoumov/obsidian-advanced-debug-mode/blob/master/README.md) | Debug mode, callback traces, desktop async traces, timeout controls, mobile DevTools and shared abort. Async tracing has a documented desktop restriction and changes console autocompletion while active. | Integrate the pinned upstream implementation on demand inside diagnosis, retain platform limits and teardown, and suspend the independent plugin while these patches are active. Always-on patching was rejected because it would alter normal operation and permit duplicate hooks. |

## Local host evidence

The Obsidian 1.14.3 implementation was inspected alongside live Sandbox observations. app.plugins.isEnabled() is a global loading gate without a plugin ID argument. Core wrapper enable(false)/disable(false) changes native state as well as instance._loaded. Community enablePlugin/disablePlugin preserves the native ID set. Workspaces are owned by the core Workspaces instance.

Independent checks execute these distinctions and the integrated runtime/diagnosis path. Unit tests alone do not establish a rendered interface, a real next startup, or physical-device acceptance. The Sandbox receipt must show executed assertions, including foreign-state preservation.

## Provenance and cleanup

The fork preserves BPM Git history and its license. Companion runtime sources are recorded in licenses/companion-provenance.md; no separate license is invented. Advanced Debug and its dependencies retain their source attribution and license records. Research-inspired behavior does not imply copied source from every compared project.

Previous upstream README translations and screenshots are historical source material. Their global takeover recommendations do not govern the integrated runtime. Project cleanup applies to this fork and its delivered runtime, without deleting unrelated vault notes or rewriting their history.
