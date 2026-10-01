# Better Manager Companion guard provenance

## Source observation

- Source file: `/Users/eme/Obsidian/ENSO/.obsidian/plugins/better-plugins-manager-companion/main.js`
- Plugin manifest observed: `better-plugins-manager-companion` version `0.5.0`
- SHA-256 of the inspected source file: `f11a0924f60c62ff4823871279f282ca821b313566efa0db4ee86b0bac1ad979`
- Ported function range: source lines 298-519, covering `installStartupCacheGuard`, `installLinkResolverScheduleGuard`, and `installRelatedLinkBatchGuard`.
- SHA-256 of the integrated adaptation after the 2026-10-01 logging fix: `341ac3775e620e928874466f13beb2e162aa0b13d779b9a1fbf038c444a8806b` (`src/integrated/guards.ts`). Previous reviewed hash: `2583262f8d71c505e0d4ee7ebbdbdaad6c08f5117bd15984aef53736e45d58c6`.
- Follow-up change, 2026-10-01: the ported diagnostics were reported through a non-existent `plugin.managerRuntime` field, so every guard message was dropped. Logging now uses `plugin.runtime`, and the desktop batch guard reports an explicit "metadata cache is absent" reason instead of returning silently. The three ported algorithms and their compatibility gates are unchanged by this fix.
- Source manifest did not declare a license and no adjacent LICENSE file was found during this inspection. This record does not assign a license or claim upstream permission beyond the task-specific instruction to integrate these guards into the AIgility plugin.

## Local adaptation

The integrated implementation is in `src/integrated/guards.ts`. It preserves the three algorithms' compatibility checks and native fallback behavior, reports active/inactive guard diagnostics, and returns a synchronous teardown that restores only wrappers still owned by AIgility. Desktop queue guards remain gated by `Platform.isDesktopApp`. The startup cache guard is gated by the original method signatures and initialization state.

Ad-hoc comments adjacent to the copied functions retain the date, host assumptions and revalidation requirements from the source. This is a local override based on Obsidian 1.14.1 observations. A host update can make the signatures, event order, queue shape or restoration behavior stale. Before reuse or update, revalidate all signature gates and both success and failure teardown against the installed Obsidian host.

## Attribution identity

The source hash identifies the exact installed Companion file inspected for this port. The adaptation hash identifies the integrated guard file reviewed for this change. Any later edit changes the adaptation hash and should update this attribution record.
