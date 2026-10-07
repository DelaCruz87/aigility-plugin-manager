# Diagnosis

Date: 2026-10-07
Author: Codex
Context: Eme explicitly requests separate Manager UI, Companion settings styling, functional toggles and self-disable.
Evidence status: Current source and CPU behavior checks verified. No new native acceptance or deployment yet.

## Findings

- Public manual setEnabled enters the same transaction setter as automation at src/integrated/runtime.ts:338. The pause check at src/integrated/runtime.ts:406 rejects ordinary late-load manual operations. The real bundled runtime fails both manual ON/OFF and deferred manual ON/OFF in manual-baseline.txt. Existing pending/debug/restricted/protected/incompatible/transaction checks pass.
- Self-disable is unconditionally rejected at src/integrated/runtime.ts:409. The real bundled runtime fails self-baseline.txt before reaching the host. Removing that check alone is insufficient: withPending at src/integrated/runtime.ts:864 writes Local, awaits the operation, rejects disposal and would leave an interrupted-operation latch. The explicit action needs a host handoff outside that write transaction, while automated transactions retain self protection.
- ManagerUI.install at src/integrated/ui.ts:404 replaces app.setting.open, wraps Community rendering and injects sidebar/list elements. The behavior check fails the method-identity assertion in ui-baseline.txt. The plugin settings tab at main.ts:372 renders the plugin list rather than configuration. The installed Companion 0.5.0 uses separate Deferred/Profiles/Devices/Settings tabs, header cards and native Setting controls, read from its current local source and styles.

## Decisions

Use an explicit public manual route inside the existing serial queue. Keep the ordinary automation pause and unrelated policies unchanged. Reject pending operations, active diagnostic contexts, Restricted mode, incompatibility and foreign protection. This replaces the option of requiring Resume before every manual toggle, which contradicts the reported behavior.

Use a dedicated self-disable host handoff that creates no Manager write journal and performs no State/Local/effective-state save after unload. Keep automatic profile/fixture/debug self protection. Reject the option of simply removing the protection branch inside withPending, because disposal would invalidate that transaction.

Use an owned Obsidian Modal and Companion-style own settings renderer. Preserve native Settings methods, list nodes and sidebar throughout install/open/refresh/dispose. This replaces the current native takeover. Copy the actual Companion layout under Manager-only CSS classes and preserve all existing capabilities and queue write contracts.

## Worker outcome

The single bounded readonly Ringer job manager-plugin-settings-20261007T093539Z-p37156 timed out after 120 seconds without report.md or deliverables. Source SHA values remained unchanged. It is not a successful independent review. Requested model gpt-6.1-sol, engine codex, effort medium; the observed transport pointed at the local Ollama endpoint, so effective model and billing attribution remain unverified. No retry, fallback, configuration repair or native operation was launched.
