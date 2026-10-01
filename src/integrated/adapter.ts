import { Platform, apiVersion } from 'obsidian';
import type { ObservedPlugin, PluginRef } from './types';

type HostAdapter = ReturnType<typeof createHostAdapter>;

export interface SetEnabledOptions {
    /**
     * loadNow performs a nonpersistent activation: the instance must exist
     * afterwards while the host native autostart set stays untouched. This is
     * the only activation shape a deferred plugin may use.
     */
    loadNow?: boolean;
    origin?: string;
}

export interface ExcludeDeferredOptions {
    /**
     * unload additionally unloads an already loaded instance. Exclusion alone
     * never unloads a legitimately delayed instance, because deferred loads are
     * loaded on purpose without native autostart.
     */
    unload?: boolean;
    origin?: string;
}

export type HostMutationListener = (ref: PluginRef, origin?: string) => void;

function keyOf(ref: PluginRef): string {
    return `${ref.kind}:${ref.id}`;
}

function entries(value: any): Array<[string, any]> {
    if (value instanceof Map) return [...value.entries()];
    if (value && typeof value === 'object') return Object.entries(value);
    return [];
}

function compareVersions(a: string, b: string): number {
    const left = String(a).split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
    const right = String(b).split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
    for (let index = 0; index < 3; index++) {
        if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0) ? 1 : -1;
    }
    return 0;
}

function isMobileHost(): boolean {
    if (Platform?.isMobile === true) return true;
    if (Platform?.isDesktopApp === true) return false;
    return Platform?.isDesktop === true ? false : true;
}

/**
 * Obsidian exports apiVersion to the plugin require realm. app.version,
 * app.appVersion and vault.config.appVersion are absent in live hosts, so they
 * are never used as a compatibility authority.
 */
function hostApiVersion(): string | undefined {
    return typeof apiVersion === 'string' && apiVersion.length > 0 ? apiVersion : undefined;
}

function manifestCompatible(manifest: any, app: any): boolean {
    if (manifest?.compatible === false || manifest?.metadata?.compatible === false) return false;
    if (manifest?.isDesktopOnly === true && isMobileHost()) return false;
    const minimum = typeof manifest?.minAppVersion === 'string' && manifest.minAppVersion ? manifest.minAppVersion : undefined;
    if (!minimum) return true;
    const current = hostApiVersion();
    // No public version authority means no proof of compatibility.
    if (!current) return false;
    if (typeof app?.plugins?.isDeprecated === 'function') {
        try {
            if (app.plugins.isDeprecated(manifest)) return false;
        } catch {
            // A throwing deprecation probe is advisory, never a compatibility verdict.
        }
    }
    return compareVersions(current, minimum) >= 0;
}

function instanceLoaded(instance: any): boolean {
    return Boolean(instance) && instance._loaded !== false;
}

function communityInstance(plugins: any, id: string): any {
    const direct = plugins?.plugins?.[id];
    if (direct) return direct;
    if (typeof plugins?.getPlugin === 'function') {
        try {
            return plugins.getPlugin(id);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function communityManifests(plugins: any): Array<[string, any]> {
    return entries(plugins?.manifests);
}

function coreWrapper(app: any, id: string): any {
    const host = app?.internalPlugins;
    if (typeof host?.getPluginById === 'function') {
        try {
            const wrapper = host.getPluginById(id);
            if (wrapper) return wrapper;
        } catch {
            // Fall through to the registry below.
        }
    }
    return host?.plugins?.[id];
}

function coreWrappers(app: any): Array<[string, any]> {
    const host = app?.internalPlugins;
    const fromRegistry = entries(host?.plugins);
    if (fromRegistry.length) return fromRegistry;
    if (typeof host?.getPlugins === 'function') {
        try {
            const list = host.getPlugins();
            const collected: Array<[string, any]> = [];
            for (const wrapper of Array.isArray(list) ? list : []) {
                const id = wrapper?.id ?? wrapper?.instance?.manifest?.id ?? wrapper?.manifest?.id;
                if (id) collected.push([String(id), wrapper]);
            }
            return collected;
        } catch {
            return [];
        }
    }
    return [];
}

export function collectObserved(app: any): ObservedPlugin[] {
    const result = new Map<string, ObservedPlugin>();
    const plugins = app?.plugins;
    for (const [id, manifest] of communityManifests(plugins)) {
        if (!id) continue;
        result.set(`community:${id}`, {
            ref: { kind: 'community', id },
            name: String(manifest?.name ?? manifest?.id ?? id),
            version: String(manifest?.version ?? ''),
            installed: true,
            compatible: manifestCompatible(manifest, app),
            nativeAutostart: plugins?.enabledPlugins?.has?.(id) === true,
            loaded: instanceLoaded(communityInstance(plugins, id)),
        });
    }

    for (const [id, wrapper] of coreWrappers(app)) {
        if (!id || !wrapper) continue;
        const instance = wrapper.instance;
        const manifest = instance?.manifest ?? wrapper.manifest ?? {};
        result.set(`core:${id}`, {
            ref: { kind: 'core', id },
            name: String(instance?.name ?? manifest?.name ?? id),
            version: String(manifest?.version ?? ''),
            installed: true,
            compatible: manifestCompatible(manifest, app),
            nativeAutostart: wrapper.enabled === true,
            loaded: instanceLoaded(instance),
        });
    }
    return [...result.values()];
}

function replaceMethod(
    target: any,
    method: string,
    wrap: (original: any) => any,
): { wrapped: any; restore: () => void } | undefined {
    const original = target?.[method];
    if (!target || typeof original !== 'function') return undefined;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, method);
    const wrapped = wrap(original);
    target[method] = wrapped;
    return {
        wrapped,
        restore: () => {
            if (target[method] !== wrapped) return;
            if (hadOwn) target[method] = original;
            else delete target[method];
        },
    };
}

export function createHostAdapter(
    app: any,
    plugin: any,
    onExternalPause: (reason: string) => void,
    onMutation?: HostMutationListener,
): {
    observe(): ObservedPlugin[];
    isEnabled(ref: PluginRef): boolean;
    isNativeEnabled(ref: PluginRef): boolean;
    setEnabled(ref: PluginRef, enabled: boolean, options?: SetEnabledOptions): Promise<void>;
    loadDeferred(ref: PluginRef, options?: { origin?: string }): Promise<void>;
    excludeDeferred(ref: PluginRef, options?: ExcludeDeferredOptions): Promise<void>;
    isRestricted(): boolean;
    isLoadingEnabled(): boolean;
    installGlobalPauseGuard(): () => void;
    installMutationTracking(): () => void;
    isMutationTrackingInstalled(): boolean;
    dispose(): void;
    loadWorkspace(id: string): Promise<void>;
    ensureLegacyWorkspaceClones(): Promise<string[]>;
} {
    const selfCalls = new Map<string, number>();
    let trackingTeardown: (() => void) | undefined;

    function reportManualChange(ref: PluginRef, origin?: string): void {
        if (!onMutation) return;
        if ((selfCalls.get(keyOf(ref)) ?? 0) > 0) return;
        try {
            onMutation(ref, origin);
        } catch {
            // Instrumentation must never break the host call it observes.
        }
    }

    function beginSelfCall(ref: PluginRef): void {
        const id = keyOf(ref);
        selfCalls.set(id, (selfCalls.get(id) ?? 0) + 1);
    }

    function endSelfCall(ref: PluginRef): void {
        const id = keyOf(ref);
        const pending = (selfCalls.get(id) ?? 1) - 1;
        if (pending > 0) selfCalls.set(id, pending);
        else selfCalls.delete(id);
    }

    /**
     * Suppression covers the synchronous host invocation only: the marker is
     * raised before the call and released the moment it returns, so a nested
     * self call issued inside that synchronous window stays silent while any
     * manual call arriving later, while a returned promise is still pending, is
     * a genuine user intent. The promise is awaited by the caller outside this
     * scope, which is what keeps an operation spanning several awaits from
     * suppressing unrelated user intent.
     */
    function selfHostCall<T>(ref: PluginRef, invoke: () => T): T {
        beginSelfCall(ref);
        try {
            return invoke();
        } finally {
            endSelfCall(ref);
        }
    }

    async function selfHostResult<T>(ref: PluginRef, invoke: () => Promise<T>): Promise<T> {
        return await selfHostCall(ref, invoke);
    }

    /**
     * True when Obsidian currently loads community plugins at all. The host
     * signal is the global zero-argument app.plugins.isEnabled(); it carries no
     * plugin id and cannot be answered per plugin.
     */
    function isLoadingEnabled(): boolean {
        const host = app?.plugins;
        if (typeof host?.isEnabled !== 'function') {
            throw new Error('Obsidian app.plugins.isEnabled() is unavailable, plugin loading state cannot be read.');
        }
        return host.isEnabled() === true;
    }

    function isNativeEnabled(ref: PluginRef): boolean {
        if (ref.kind === 'community') return app?.plugins?.enabledPlugins?.has?.(ref.id) === true;
        return coreWrapper(app, ref.id)?.enabled === true;
    }

    function isLoaded(ref: PluginRef): boolean {
        if (ref.kind === 'community') return instanceLoaded(communityInstance(app?.plugins, ref.id));
        return instanceLoaded(coreWrapper(app, ref.id)?.instance);
    }

    /**
     * Effective state of the plugin right now: an actually loaded instance.
     * Native autostart is a separate persisted field read by isNativeEnabled and
     * by observe(), so a plugin persisted as enabled but not loaded never counts
     * as enabled here.
     */
    function isEnabled(ref: PluginRef): boolean {
        return isLoaded(ref);
    }

    async function setCommunity(ref: PluginRef, enabled: boolean, persist: boolean): Promise<void> {
        const id = ref.id;
        const host = app?.plugins;
        if (!host) throw new Error('Obsidian community plugin manager is unavailable.');
        if (enabled) {
            if (persist) {
                if (typeof host.enablePluginAndSave !== 'function') {
                    throw new Error('Obsidian enablePluginAndSave(id) is unavailable, persistent community activation is impossible.');
                }
                const result = await selfHostResult(ref, () => host.enablePluginAndSave(id));
                if (result === false) throw new Error(`Obsidian refused to enable community plugin ${id}.`);
                return;
            }
            if (typeof host.enablePlugin !== 'function') {
                throw new Error('Obsidian enablePlugin(id) is unavailable, nonpersistent activation is impossible.');
            }
            const result = await selfHostResult(ref, () => host.enablePlugin(id));
            if (result === false) throw new Error(`Obsidian refused to enable community plugin ${id}.`);
            return;
        }
        if (persist) {
            if (typeof host.disablePluginAndSave !== 'function') {
                throw new Error('Obsidian disablePluginAndSave(id) is unavailable, persistent community deactivation is impossible.');
            }
            await selfHostResult(ref, () => host.disablePluginAndSave(id));
            return;
        }
        if (typeof host.disablePlugin !== 'function') {
            throw new Error('Obsidian disablePlugin(id) is unavailable, nonpersistent deactivation is impossible.');
        }
        await selfHostResult(ref, () => host.disablePlugin(id));
    }

    async function setCore(ref: PluginRef, enabled: boolean, persist: boolean): Promise<void> {
        const id = ref.id;
        const host = app?.internalPlugins;
        const wrapper = coreWrapper(app, id);
        if (!wrapper) throw new Error(`Core plugin wrapper ${id} is unavailable in app.internalPlugins.`);
        if (enabled) {
            if (typeof wrapper.enable !== 'function') throw new Error(`Core plugin ${id} has no wrapper.enable(user) method.`);
            // wrapper.enable(false) loads the instance and requests a config save
            // without user side effects. internalPlugins.enable() takes no id and
            // must never be used as a toggle.
            await selfHostResult(ref, () => wrapper.enable(false));
        } else {
            if (typeof wrapper.disable !== 'function') throw new Error(`Core plugin ${id} has no wrapper.disable(user) method.`);
            await selfHostResult(ref, () => wrapper.disable(false));
        }
        if (!persist) return;
        if (typeof host?.saveConfig !== 'function') {
            throw new Error('Obsidian internalPlugins.saveConfig() is unavailable, core config cannot be persisted.');
        }
        await selfHostResult(ref, () => host.saveConfig());
    }

    async function verify(ref: PluginRef, enabled: boolean, expectedNative?: boolean, origin?: string): Promise<void> {
        const where = origin ? ` (origin: ${origin})` : '';
        const observed = collectObserved(app).find((item) => keyOf(item.ref) === keyOf(ref));
        if (!observed?.installed) {
            throw new Error(`Host readback failed for ${ref.kind} plugin ${ref.id}${where}: the host no longer reports it as installed.`);
        }
        if (observed.loaded !== enabled) {
            throw new Error(
                `Host readback failed for ${ref.kind} plugin ${ref.id}${where}: expected ${enabled ? 'a loaded instance' : 'no loaded instance'}, loaded=${observed.loaded}.`,
            );
        }
        if (expectedNative !== undefined && observed.nativeAutostart !== expectedNative) {
            throw new Error(
                `Host readback failed for ${ref.kind} plugin ${ref.id}${where}: expected native autostart ${expectedNative}, found ${observed.nativeAutostart}.`,
            );
        }
    }

    async function setEnabled(ref: PluginRef, enabled: boolean, options: SetEnabledOptions = {}): Promise<void> {
        const origin = options.origin;
        if (!collectObserved(app).some((item) => keyOf(item.ref) === keyOf(ref) && item.installed)) {
            throw new Error(`Plugin ${keyOf(ref)} is not installed.`);
        }
        const persist = options.loadNow !== true;
        const nativeBefore = isNativeEnabled(ref);
        const expectedNative = persist ? enabled : nativeBefore;
        if (ref.kind === 'community') await setCommunity(ref, enabled, persist);
        else await setCore(ref, enabled, persist);
        await verify(ref, enabled, expectedNative, origin);    }

    async function loadDeferred(ref: PluginRef, options: { origin?: string } = {}): Promise<void> {
        const origin = options.origin ?? 'deferred';
        // Nonpersistent activation only: the native autostart set must not gain
        // the id, and the instance must really exist afterwards.
        await setEnabled(ref, true, { loadNow: true, origin });
        await verify(ref, true, false, origin);
    }

    async function excludeDeferred(ref: PluginRef, options: ExcludeDeferredOptions = {}): Promise<void> {
        const origin = options.origin ?? 'deferred-exclusion';
        if (ref.kind === 'community') {
            const host = app?.plugins;
            if (!host) throw new Error('Obsidian community plugin manager is unavailable.');
            const listed = host.enabledPlugins?.has?.(ref.id) === true;
            if (listed) {
                if (typeof host.enabledPlugins?.delete !== 'function') {
                    throw new Error('Obsidian enabledPlugins is not a mutable Set, native autostart cannot be excluded.');
                }
                selfHostCall(ref, () => host.enabledPlugins.delete(ref.id));
                if (typeof host.saveConfig !== 'function') {
                    throw new Error('Obsidian community saveConfig() is unavailable, deferred exclusion cannot be persisted.');
                }
                await selfHostResult(ref, () => host.saveConfig());
            }
            if (options.unload && isLoaded(ref)) {
                await selfHostResult(ref, () => {
                    if (typeof host.disablePlugin === 'function') return host.disablePlugin(ref.id);
                    if (typeof host.disablePluginAndSave === 'function') return host.disablePluginAndSave(ref.id);
                    throw new Error('Obsidian offers no community disable API, a loaded deferred instance cannot be unloaded.');
                });
            }
            // Exclusion never unloads a legitimately delayed instance by itself.
            const expectLoaded = options.unload ? false : isLoaded(ref);
            await verify(ref, expectLoaded, false, origin);
            return;
        }

        const wrapper = coreWrapper(app, ref.id);
        if (!wrapper) throw new Error(`Core plugin wrapper ${ref.id} is unavailable in app.internalPlugins.`);
        if (wrapper.enabled === true) await setCore(ref, false, true);
        if (options.unload && isLoaded(ref)) await setCore(ref, false, true);
        await verify(ref, false, false, origin);
    }

    function isRestricted(): boolean {
        return isLoadingEnabled() === false;
    }

    function installGlobalPauseGuard(): () => void {
        const host = app?.plugins;
        if (!host || typeof host.setEnable !== 'function') {
            throw new Error('Obsidian plugins.setEnable(enabled) is required for recovery-safe global disable handling.');
        }
        let active = true;
        const installed = replaceMethod(host, 'setEnable', (original) => function (this: any, enabled: boolean, ...args: any[]) {
            if (active && enabled === false) onExternalPause('Obsidian plugin manager was disabled.');
            return original.call(this, enabled, ...args);
        });
        return () => {
            active = false;
            installed?.restore();
        };
    }

    /**
     * Reversible interception of native community and core toggles. Every
     * intercepted call reports the ref, including calls that leave the value
     * equal, because a user returning a plugin to its previous value is still an
     * intent. Only calls this adapter issues inside a synchronous host
     * invocation are not reported, so a manual call arriving while an adapter
     * call is still pending is never swallowed. Teardown keeps any
     * wrapper installed after ours and only detaches our own report hook.
     */
    function installMutationTracking(): () => void {
        if (trackingTeardown) return trackingTeardown;
        let active = true;
        const restore: Array<() => void> = [];
        const guardedCore = new WeakSet<object>();

        for (const method of ['enablePlugin', 'enablePluginAndSave', 'disablePlugin', 'disablePluginAndSave'] as const) {
            const installed = replaceMethod(app?.plugins, method, (original) => function (this: any, pluginId: string, ...rest: any[]) {
                const result = original.call(this, pluginId, ...rest);
                if (active && pluginId) reportManualChange({ kind: 'community', id: String(pluginId) }, 'host');
                return result;
            });
            if (installed) restore.push(installed.restore);
        }

        const guardCore = (wrapper: any, id: string): void => {
            if (!wrapper || typeof wrapper !== 'object' || !id || guardedCore.has(wrapper)) return;
            guardedCore.add(wrapper);
            for (const method of ['enable', 'disable'] as const) {
                const installed = replaceMethod(wrapper, method, (original) => function (this: any, ...rest: any[]) {
                    const result = original.apply(this, rest);
                    if (active) reportManualChange({ kind: 'core', id }, 'host');
                    return result;
                });
                if (installed) restore.push(installed.restore);
            }
        };

        for (const [id, wrapper] of coreWrappers(app)) guardCore(wrapper, id);

        const internal = app?.internalPlugins;
        if (internal && typeof internal.getPluginById === 'function') {
            const installed = replaceMethod(internal, 'getPluginById', (original) => function (this: any, id: string) {
                const wrapper = original.call(this, id);
                if (wrapper) guardCore(wrapper, String(id ?? ''));
                return wrapper;
            });
            if (installed) restore.push(installed.restore);
        }

        const teardown = () => {
            if (!active) return;
            active = false;
            for (const undo of restore.reverse()) undo();
            restore.length = 0;
            if (trackingTeardown === teardown) trackingTeardown = undefined;
        };
        trackingTeardown = teardown;
        return teardown;
    }

    function isMutationTrackingInstalled(): boolean {
        return trackingTeardown !== undefined;
    }

    function workspacesInstance(): any {
        return coreWrapper(app, 'workspaces')?.instance;
    }

    async function loadWorkspace(id: string): Promise<void> {
        const manager = workspacesInstance();
        if (!manager || typeof manager.loadWorkspace !== 'function') {
            throw new Error('This Obsidian host does not expose loadWorkspace(id) on the core Workspaces instance.');
        }
        const result = await manager.loadWorkspace(id);
        if (result === false) throw new Error(`Obsidian did not load workspace ${id}.`);
        const active = manager.activeWorkspace;
        if (typeof active === 'string' && active !== id) {
            throw new Error(`Workspace readback failed: requested ${id}, active workspace is ${active}.`);
        }
    }

    async function ensureLegacyWorkspaceClones(): Promise<string[]> {
        const manager = workspacesInstance();
        const workspaces = manager?.workspaces;
        if (!workspaces || typeof workspaces !== 'object') return [];
        const has = (id: string) => workspaces instanceof Map
            ? workspaces.has(id)
            : Object.prototype.hasOwnProperty.call(workspaces, id);
        const get = (id: string) => workspaces instanceof Map ? workspaces.get(id) : workspaces[id];
        const source = get('d');
        if (!source || typeof source !== 'object') return [];
        const missing = ['t', 'm'].filter((id) => !has(id));
        if (missing.length === 0) return [];
        if (typeof manager.saveData !== 'function') {
            throw new Error('Saved Workspaces plugin has no saveData() method for legacy workspace cloning.');
        }
        const copies = new Map(missing.map((id) => [id, JSON.parse(JSON.stringify(source))]));
        for (const [id, value] of copies) {
            if (workspaces instanceof Map) workspaces.set(id, value);
            else workspaces[id] = value;
        }
        try {
            await manager.saveData();
            for (const [id, expected] of copies) {
                if (JSON.stringify(get(id)) !== JSON.stringify(expected)) {
                    throw new Error(`Saved Workspaces readback failed for legacy copy ${id}.`);
                }
            }
            return missing;
        } catch (error) {
            for (const id of missing) {
                if (JSON.stringify(get(id)) !== JSON.stringify(copies.get(id))) continue;
                if (workspaces instanceof Map) workspaces.delete(id);
                else delete workspaces[id];
            }
            throw error;
        }
    }

    function dispose(): void {
        trackingTeardown?.();
    }

    return {
        observe: () => collectObserved(app),
        isEnabled,
        isNativeEnabled,
        setEnabled,
        loadDeferred,
        excludeDeferred,
        isRestricted,
        isLoadingEnabled,
        installGlobalPauseGuard,
        installMutationTracking,
        isMutationTrackingInstalled,
        dispose,
        loadWorkspace,
        ensureLegacyWorkspaceClones,
    };
}

export type { HostAdapter };
