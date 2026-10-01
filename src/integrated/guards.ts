import { Notice, Platform } from 'obsidian';

declare const require: (id: string) => any;

type Diagnostic = { id: string; active: boolean; restored: boolean; stats?: Record<string, unknown>; reason?: string };

/** Compatibility-gated port of the three active Companion guards. */
export function installStartupGuards(plugin: any): () => void {
    const diagnostics: Record<string, Diagnostic> = {
        startupCache: { id: 'startupCache', active: false, restored: false },
        linkResolverSchedule: { id: 'linkResolverSchedule', active: false, restored: false },
        relatedLinkBatch: { id: 'relatedLinkBatch', active: false, restored: false },
    };
    const removers: Array<() => void> = [];
    let disposed = false;
    plugin.guardDiagnostics = diagnostics;
    const report = (id: string, reason?: string) => {
        const diagnostic = diagnostics[id];
        if (reason) diagnostic.reason = reason;
        const detail = reason ? `${id}: ${reason}` : `${id}: active`;
        // The manager runtime is published as plugin.runtime; managerRuntime never
        // existed, so every guard diagnostic used to be dropped silently.
        plugin.runtime?.log?.(reason ? 'warn' : 'info', `Runtime guard ${detail}`);
        if (reason) new Notice(`AIgility Plugin Manager: ${detail}`);
    };

    // Ad-hoc local override, 2026-09-11: Obsidian 1.14.1 profiles show quadratic
    // stale-path cleanup. initialize already queues every surviving cached file.
    // Revalidate these invariants after an Obsidian update; unknown implementations
    // keep native behavior. No vault content or normal post-start deletion is changed.
    const cache = plugin.app?.metadataCache;
    if (cache && !cache.initialized) {
        const initialize = String(cache.initialize);
        const remove = cache.deletePath;
        const update = cache.updateRelatedLinks;
        if (typeof remove === 'function' && typeof update === 'function' &&
            initialize.includes('this.queueFileForLinkResolution(s)') &&
            initialize.includes('this.computeFileMetadataAsync(s)') &&
            initialize.includes('this.deletePath(c)') && String(remove).includes('this.updateRelatedLinks(')) {
            let deleting = 0;
            const stats = { skippedRescans: 0, restored: false };
            diagnostics.startupCache.stats = stats;
            function guardedUpdate(this: any, ...args: any[]) {
                if (deleting > 0 && !this.initialized) { stats.skippedRescans++; return; }
                return update.apply(this, args);
            }
            function guardedDelete(this: any, ...args: any[]) {
                deleting++;
                try { return remove.apply(this, args); } finally { deleting--; }
            }
            const restore = () => {
                if (cache.deletePath === guardedDelete) cache.deletePath = remove;
                if (cache.updateRelatedLinks === guardedUpdate) cache.updateRelatedLinks = update;
                stats.restored = true;
                diagnostics.startupCache.active = false;
                diagnostics.startupCache.restored = true;
            };
            cache.deletePath = guardedDelete;
            cache.updateRelatedLinks = guardedUpdate;
            diagnostics.startupCache.active = true;
            report('startupCache');
            removers.push(restore);
            if (cache.on) {
                const event = cache.on('finished', restore);
                if (event) removers.push(() => cache.offref?.(event));
            }
            if (plugin.app?.workspace?.onLayoutReady) plugin.app.workspace.onLayoutReady(() => { if (!disposed) restore(); });
        } else report('startupCache', 'host signatures differ; native behavior retained');
    } else report('startupCache', 'cache is absent or already initialized; native behavior retained');

    const installDesktopGuards = () => {
        if (disposed) return;
        if (!Platform.isDesktopApp) {
            report('linkResolverSchedule', 'desktop-only guard; native behavior retained');
            report('relatedLinkBatch', 'desktop-only guard; native behavior retained');
            return;
        }
        installLinkResolverScheduleGuard(plugin, diagnostics.linkResolverSchedule, report, removers);
        installRelatedLinkBatchGuard(plugin, diagnostics.relatedLinkBatch, report, removers);
    };
    if (plugin.app?.workspace?.onLayoutReady) plugin.app.workspace.onLayoutReady(installDesktopGuards);
    else report('linkResolverSchedule', 'layout-ready API unavailable; native behavior retained');

    return () => {
        if (disposed) return;
        disposed = true;
        for (const remove of [...removers].reverse()) {
            try { remove(); } catch (error) { plugin.runtime?.log?.('error', 'Runtime guard teardown failed.', error); }
        }
        for (const diagnostic of Object.values(diagnostics)) {
            if (diagnostic.active) diagnostic.restored = false;
            diagnostic.active = false;
        }
    };
}

// Ad-hoc local override based on Better Manager Companion 2026-09-11 guard.
// It assumes the 1.14.1 native queue signatures recorded in companion-provenance.md;
// upstream host changes can invalidate the optimization. Revalidate signatures,
// event ordering and restoration against the installed host before reuse/update.
function installLinkResolverScheduleGuard(plugin: any, diagnostic: Diagnostic, report: (id: string, reason?: string) => void, removers: Array<() => void>): void {
    const cache = plugin.app?.metadataCache;
    const old = cache?.linkResolverQueue;
    const nativeResolver = cache?.linkResolver;
    if (plugin.linkResolverScheduleGuard) return;
    if (!old?.items || !Array.isArray(old.items.queue) || typeof old.cancel !== 'function' || typeof nativeResolver !== 'function' ||
        !String(nativeResolver).includes('this.resolveLinks(r.path)') || !String(old.add).includes('this.items.enqueue(e)') || !String(old.notify).includes('e.resolve()')) {
        report(diagnostic.id, 'host signatures differ; native behavior retained'); return;
    }
    const timers = require('timers');
    const pending = [...new Set(old.items.queue.slice(old.items.offset))];
    const state: any = { processed: 0, removed: 0, errors: [], paused: false, restored: false, timer: null, lastPath: null };
    diagnostic.stats = state;
    const Queue = old.constructor;
    old.cancel(); old.items.clear();
    const queue = new Queue({
        onStop: () => cache.trigger('resolved'),
        onCancel: () => { if (cache.linkResolverQueue === queue) cache.linkResolverQueue = null; },
    });
    cache.linkResolverQueue = queue;
    plugin.linkResolverScheduleGuard = state;
    const notify = queue.notify;
    function schedule() {
        if (state.restored || state.paused || state.timer !== null || cache.linkResolverQueue !== queue) return;
        state.timer = timers.setTimeout(drain, 0);
    }
    function drain() {
        state.timer = null;
        if (state.restored || state.paused || cache.linkResolverQueue !== queue) return;
        const started = Date.now(); let count = 0;
        if (queue.items.length) queue.runnable.start();
        while (queue.items.length && count++ < 50 && Date.now() - started < 5) {
            const item = queue.items.dequeue(); if (!item) continue;
            const file = cache.vault.getFileByPath(item.path);
            if (!file) { state.removed++; continue; }
            state.lastPath = file.path;
            try { cache.resolveLinks(file.path); cache.trigger('resolve', file); state.processed++; }
            catch (error) {
                queue.items.enqueue(file);
                state.errors.push({ path: file.path, message: String((error as any)?.message ?? error) });
                state.paused = true;
                report(diagnostic.id, `paused after ${file.path}; queued file preserved for diagnosis`);
                plugin.runtime?.log?.('error', 'Link resolver guard paused; failed file remains queued.', error);
                return;
            }
        }
        if (queue.items.length) schedule(); else { queue.runnable.stop(); cache.checkCleanCache(); }
    }
    queue.notify = function (this: any) { notify.call(this); schedule(); };
    state.resume = () => { state.paused = false; schedule(); };
    state.restore = () => {
        if (state.restored) return;
        state.restored = true;
        if (state.timer !== null) timers.clearTimeout(state.timer);
        state.timer = null;
        if (cache.linkResolverQueue !== queue) return;
        const remaining = [...new Set(queue.items.queue.slice(queue.items.offset))];
        queue.cancel(); queue.items.clear();
        nativeResolver.call(cache);
        cache.linkResolverQueue?.addList?.(remaining);
        diagnostic.active = false; diagnostic.restored = true;
    };
    diagnostic.active = true; report(diagnostic.id);
    removers.push(state.restore);
    queue.addList(pending);
}

// Ad-hoc local override based on Better Manager Companion 2026-09-11 guard.
// It assumes the 1.14.1 cache/queue signatures recorded in companion-provenance.md;
// host changes can make batching stale or unsafe. Revalidate link matching,
// queue lifecycle, failure fallback and teardown against the installed host.
function installRelatedLinkBatchGuard(plugin: any, diagnostic: Diagnostic, report: (id: string, reason?: string) => void, removers: Array<() => void>): void {
    const cache = plugin.app?.metadataCache;
    if (plugin.relatedLinkBatchGuard) return;
    if (!cache) { report(diagnostic.id, 'metadata cache is absent; native behavior retained'); return; }
    const update = cache.updateRelatedLinks; const clean = cache.isCacheClean;
    const items = cache.linkResolverQueue?.items;
    if (typeof update !== 'function' || typeof clean !== 'function' || !String(update).includes('this.getCachedFiles()') ||
        !String(update).includes('this.queueFileForLinkResolution(') || !String(clean).includes('this.inProgressTaskCount') ||
        !items || !Array.isArray(items.queue) || typeof items.offset !== 'number' ||
        !['enqueue', 'enqueueArray', 'dequeue', 'clear'].every((key) => typeof items[key] === 'function')) {
        report(diagnostic.id, 'host signatures differ; native behavior retained'); return;
    }
    const timers = require('timers');
    const methods: Record<string, { value: Function; descriptor?: PropertyDescriptor }> = Object.fromEntries(['enqueue', 'enqueueArray', 'dequeue', 'clear'].map((key) => [key, { value: items[key], descriptor: Object.getOwnPropertyDescriptor(items, key) }]));
    const pending = items.queue.slice(items.offset); const seen = new Set(pending);
    const state: any = { calls: 0, flushes: 0, queued: 0, coalesced: pending.length - seen.size, names: new Set<string>(), flushing: false, timer: null, restored: false };
    diagnostic.stats = state; plugin.relatedLinkBatchGuard = state;
    methods.clear.value.call(items); methods.enqueueArray.value.call(items, [...seen]);
    function enqueue(this: any, value: any) {
        if (state.restored) return methods.enqueue.value.call(this, value);
        if (seen.has(value)) { state.coalesced++; return; }
        seen.add(value); return methods.enqueue.value.call(this, value);
    }
    function enqueueArray(this: any, values: any[]) { for (const value of values) enqueue.call(this, value); }
    function dequeue(this: any) { const value = methods.dequeue.value.call(this); seen.delete(value); return value; }
    function clear(this: any) { seen.clear(); return methods.clear.value.call(this); }
    const wrappers: Record<string, Function> = { enqueue, enqueueArray, dequeue, clear };
    Object.assign(items, wrappers);
    const basename = (value: string) => value.slice(value.lastIndexOf('/') + 1).toLowerCase();
    const matches = (names: Set<string>, links: Record<string, unknown> | undefined) => links && Object.keys(links).some((key) => names.has(basename(key)));
    function flush() {
        if (state.timer !== null) { timers.clearTimeout(state.timer); state.timer = null; }
        if (!state.names.size) return;
        state.flushing = true; const resolved = new Set<string>(state.names as Set<string>); const unresolved = new Set<string>(resolved); state.names.clear();
        for (const name of resolved) if (name.endsWith('.md')) unresolved.add(name.slice(0, -3));
        try {
            for (const path of cache.getCachedFiles()) {
                if (!matches(resolved, cache.resolvedLinks[path]) && !matches(unresolved, cache.unresolvedLinks[path])) continue;
                const file = cache.vault.getFileByPath(path); if (file) { cache.queueFileForLinkResolution(file); state.queued++; }
            }
            state.flushes++;
        } catch (error) { for (const name of resolved) state.names.add(name); throw error; }
        finally { state.flushing = false; cache.checkCleanCache(); }
    }
    function batchedUpdate(this: any, names: string[]) {
        if (state.restored) return update.call(this, names);
        state.calls++; for (const name of names) state.names.add(name.toLowerCase());
        if (state.timer === null) state.timer = timers.setTimeout(() => {
            try { flush(); }
            catch (error) {
                plugin.runtime?.log?.('error', 'Related-link batch fallback to native resolver.', error);
                const retry = [...state.names]; state.names.clear(); update.call(cache, retry); cache.checkCleanCache();
            }
        }, 100);
    }
    function guardedClean(this: any) { return (state.restored || (!state.names.size && !state.flushing)) && clean.call(this); }
    cache.updateRelatedLinks = batchedUpdate; cache.isCacheClean = guardedClean;
    diagnostic.active = true; report(diagnostic.id);
    state.restore = () => {
        if (state.restored) return;
        try { flush(); }
        finally {
            if (cache.updateRelatedLinks === batchedUpdate) cache.updateRelatedLinks = update;
            if (cache.isCacheClean === guardedClean) cache.isCacheClean = clean;
            for (const [key, method] of Object.entries(methods)) if (items[key] === wrappers[key]) {
                if (method.descriptor) Object.defineProperty(items, key, method.descriptor); else delete items[key];
            }
            state.restored = true; diagnostic.active = false; diagnostic.restored = true;
            cache.checkCleanCache();
        }
    };
    removers.push(state.restore);
}
