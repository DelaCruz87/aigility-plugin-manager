import { Platform } from 'obsidian';
import { collectObserved, createHostAdapter, isManifestCompatible } from './adapter';
import { DeferredScheduler } from './deferred';
import { StateConflictError, RuntimeStore } from './store';
import { key, parseKey } from './types';
import type { Change, DeferredPolicy, EffectivePlugin, LocalState, ObservedPlugin, PluginRef, State } from './types';

const MANAGER_ID = 'aigility-plugin-manager';
const MANAGER_PROTECTED_KEY = `community:${MANAGER_ID}`;

interface ProfileUndoEntry {
    ref: PluginRef;
    before: boolean;
    after: boolean;
    expectedPostimage: boolean;
    desiredBefore: boolean;
    generation: number;
}

interface ProfileUndo {
    entries: ProfileUndoEntry[];
}

export interface RuntimeTransaction {
    save(): Promise<void>;
    setEnabled(ref: PluginRef, enabled: boolean, options?: { loadNow?: boolean; origin?: string }): Promise<void>;
    refresh(): Promise<State>;
    writeEffectiveState(): Promise<void>;
    /**
     * Optional runtime-side native reconciliation for a deferred policy edit,
     * executed inside the queue the caller already owns: no re-enqueue and no
     * nested save. It only ever removes native autostart, never loads anything,
     * and leaves desired and profile membership untouched, so a paused or
     * recovering runtime stays inert while the policy claims deferment.
     */
    reconcileDeferred?(ref: PluginRef, options?: { origin?: string }): Promise<void>;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isDebugging(state: State): boolean {
    const debug = state.debug as any;
    return debug?.active === true || debug?.session?.active === true || debug?.status === 'active';
}

// Every label a live diagnosis may attach to a host mutation. `debug` is the
// active step, `debug-restore` replays a captured snapshot, and `debugging` is
// the original single-label spelling kept for callers that already emit it.
function isDiagnosticOrigin(origin?: string): boolean {
    if (typeof origin !== 'string') return false;
    return origin === 'debug' || origin === 'debug-restore' || origin === 'debugging';
}

// A pause only opens the diagnostic path when the pause itself is a diagnosis
// ('debugging', 'Debug session is active.', ...). Recovery pauses raised for
// their own reasons - an interrupted operation, a skipped startup, a failed
// guard install - are latches to acknowledge, not diagnoses to work inside.
function isDiagnosticPause(reason?: string): boolean {
    if (typeof reason !== 'string') return false;
    return /debug|diagnos/i.test(reason);
}

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ManagerRuntime {
    archive?: { list(): Array<{ id: string; name: string; version: string; minAppVersion?: string; isDesktopOnly?: boolean }>; fingerprint(): string; restoreInTransaction(id: string): Promise<void> };
    state: State;
    local: LocalState;
    readonly localKey: string;
    private store: RuntimeStore;
    private host: ReturnType<typeof createHostAdapter>;
    private scheduler: DeferredScheduler;
    private queue: Promise<unknown> = Promise.resolve();
    private generations = new Map<string, number>();
    private pauseGeneration = 0;
    private activePauseBaseline?: number;
    private profileUndo?: ProfileUndo;
    private removePauseGuard?: () => void;
    private removeMutationTracking?: () => void;
    private started = false;
    private startupVerified = false;
    private layoutReadySeen = false;
    private disposed = false;
    private startupPromise?: Promise<void>;
    private previewSnapshots = new WeakMap<Change[], { id: string; fingerprint: string }>();

    constructor(private app: any, private plugin: any, state: State) {
        this.state = state;
        this.localKey = this.makeLocalKey();
        this.local = this.readLocal();
        this.store = new RuntimeStore(app, plugin, state, () => {
            if (this.disposed) throw new Error('Manager runtime is disposed.');
        });
        this.scheduler = new DeferredScheduler(app);
        this.host = createHostAdapter(app, plugin, (reason) => this.pause(reason), (ref: PluginRef) => this.bumpGeneration(ref));
        this.profileUndo = this.readPersistedUndo();
        for (const entry of this.profileUndo?.entries ?? []) this.generations.set(key(entry.ref), entry.generation);
        if (!this.state.protected.includes(MANAGER_PROTECTED_KEY)) this.state.protected.push(MANAGER_PROTECTED_KEY);
    }

    list(): EffectivePlugin[] {
        const observed = this.host.observe();
        const byKey = new Map(observed.map((item) => [key(item.ref), item]));
        for (const archived of this.archive?.list() ?? []) {
            const ref: PluginRef = { kind: 'community', id: archived.id };
            const archivedKey = key(ref);
            if (byKey.has(archivedKey)) continue;
            byKey.set(archivedKey, {
                ref, name: archived.name, version: archived.version, installed: false,
                compatible: isManifestCompatible(archived, this.app), nativeAutostart: false,
                loaded: false, archived: true,
            } as ObservedPlugin & { archived: boolean });
        }
        for (const record of Object.values(this.state.records ?? {})) {
            const id = key(record.ref);
            if (!byKey.has(id)) {
                byKey.set(id, {
                    ref: record.ref,
                    name: record.name,
                    version: record.version,
                    installed: false,
                    compatible: record.metadata?.compatible !== false,
                    nativeAutostart: false,
                    loaded: false,
                    archived: false,
                });
            }
        }
        return [...byKey.values()].map((item) => {
            const record = this.state.records[key(item.ref)];
            const deferred = this.state.deferred.find((policy) => policy.id === item.ref.id);
            const scheduled = Boolean(deferred && this.scheduler.has(item.ref.id));
            const protectedPlugin = this.isProtected(item.ref);
            const compatible = item.compatible && record?.metadata?.compatible !== false;
            let reason: string | undefined;
            if (protectedPlugin) reason = 'protected';
            else if (!compatible) reason = 'incompatible';
            else if (deferred?.parked) reason = 'parked-deferred';
            else if (scheduled) reason = 'deferred-scheduled';
            else if (this.local.recoveryReason || this.local.operationPending) reason = 'recovery-paused';
            else if (isDebugging(this.state)) reason = 'debug-paused';
            return {
                ...item,
                archived: Boolean((item as ObservedPlugin & { archived?: boolean }).archived),
                compatible,
                desired: record?.desired ?? item.nativeAutostart,
                tags: [...(record?.tags ?? [])],
                group: record?.group ?? '',
                scheduled,
                ...(reason ? { reason } : {}),
            };
        });
    }

    enqueue<T>(label: string, operation: (tx: RuntimeTransaction) => Promise<T>): Promise<T> {
        if (this.disposed) return Promise.reject(new Error('Manager runtime is disposed.'));
        const assertActive = () => {
            if (this.disposed) throw new Error('Manager runtime is disposed.');
        };
        const tx: RuntimeTransaction = {
            save: () => {
                assertActive();
                return this.saveInternal();
            },
            setEnabled: (ref, enabled, options) => {
                assertActive();
                return this.setEnabledInternal(ref, enabled, options);
            },
            refresh: () => {
                assertActive();
                return this.refreshInternal();
            },
            writeEffectiveState: () => {
                assertActive();
                return this.writeEffectiveStateInternal();
            },
            // Direct helper on purpose: reconcileDeferredInternal must not
            // re-enqueue, it already runs inside the caller's transaction.
            reconcileDeferred: (ref, options) => {
                assertActive();
                return this.reconcileDeferredInternal(ref, options);
            },
        };
        const execute = () => {
            if (this.disposed) {
                return Promise.reject(new Error('Manager runtime is disposed.'));
            }
            return operation(tx);
        };
        const run = this.queue.then(execute, execute);
        this.queue = run.catch((error) => {
            this.log('error', `Queued operation failed: ${label}`, error);
        });
        return run;
    }

    save(): Promise<void> {
        return this.enqueue('save-state', (tx) => tx.save());
    }

    refresh(): Promise<State> {
        return this.enqueue('refresh-state', (tx) => tx.refresh());
    }

    previewProfile(id: string): Promise<Change[]> {
        return this.enqueue('preview-profile', async () => {
            const changes = this.computeProfile(id);
            this.previewSnapshots.set(changes, { id, fingerprint: this.profileFingerprint(id) });
            return changes;
        });
    }

    applyProfile(id: string, expectedPreview?: Change[]): Promise<void> {
        return this.enqueue(`apply-profile:${id}`, async () => {
            if (expectedPreview) {
                await this.store.assertFresh();
                const snapshot = this.previewSnapshots.get(expectedPreview);
                if (!snapshot || snapshot.id !== id || snapshot.fingerprint !== this.profileFingerprint(id) || JSON.stringify(expectedPreview) !== JSON.stringify(this.computeProfile(id))) {
                    throw new Error('La vista previa del perfil ya no está vigente o no corresponde a este perfil. Genera una nueva vista previa antes de aplicar.');
                }
            }
            await this.applyProfileInternal(id, expectedPreview);
            const profile = this.state.deviceProfiles.find((candidate) => candidate.id === id);
            if (profile?.workspaceId && this.startupVerified && !this.isAutomationPaused()) {
                await this.withPending(`workspace:${profile.workspaceId}`, async () => {
                    this.assertNoConcurrentPause();
                    await this.host.loadWorkspace(profile.workspaceId!);
                });
            }
            if (this.startupVerified && !this.isAutomationPaused()) await this.scheduleDeferredPlugins();
            await this.writeEffectiveStateInternal();
        });
    }

    applyFixture(id: string): Promise<void> {
        return this.enqueue(`apply-fixture:${id}`, async () => {
            const fixture = this.state.fixtureProfiles.find((candidate) => candidate.id === id);
            if (!fixture) throw new Error(`Fixture profile ${id} does not exist.`);
            const declared = Object.entries(fixture.members ?? {});
            // A malformed key is a malformed definition, so it is rejected in a
            // pre-pass: nothing observable has been touched at that point.
            for (const [rawKey] of declared) {
                if (!parseKey(rawKey)) throw new Error(`Fixture ${id} contains invalid plugin key ${rawKey}.`);
            }
            const changes: Change[] = [];
            for (const [rawKey, enabled] of declared) {
                const ref = parseKey(rawKey)!;
                const item = this.list().find((candidate) => key(candidate.ref) === rawKey);
                // Protection outranks every declared state, the manager included:
                // its current actual state is what stands, so nothing is pushed to
                // desired, native or loaded. The declaration stays in the profile.
                if (this.isProtected(ref)) {
                    this.log('warn', `Fixture member ${rawKey} is protected and was skipped; its declared state is retained for review.`);
                    continue;
                }
                // An absent member, or one the host cannot enable, is skipped
                // visibly instead of aborting every other declared member: the
                // actionable filter of the legacy applyPluginStateMap.
                if (!item?.installed && !item?.archived) {
                    this.log('warn', `Fixture member ${rawKey} is not installed and was skipped; its declared state is retained for review.`);
                    continue;
                }
                if (enabled && !this.isCompatible(ref, item)) {
                    this.log('warn', `Fixture member ${rawKey} is incompatible and was skipped; its declared state is retained for review.`);
                    continue;
                }
                const before = this.host.isEnabled(ref);
                const desiredBefore = this.state.records[rawKey]?.desired;
                if (before !== enabled || desiredBefore !== enabled) {
                    changes.push({ ref, before, after: enabled, reason: `fixture:${id}` });
                }
            }
            if (!changes.length) return;
            await this.withPending(`fixture:${id}`, async () => {
                await this.store.assertFresh();
                const applied: ProfileUndoEntry[] = [];
                for (const change of changes) {
                    this.assertNoConcurrentPause();
                    const desiredBefore = this.state.records[key(change.ref)]?.desired ?? change.before;
                    const observed = this.list().find((item) => key(item.ref) === key(change.ref));
                    if (change.after && observed?.archived) {
                        this.assertNoConcurrentPause();
                        await this.archive!.restoreInTransaction(change.ref.id);
                        this.assertNoConcurrentPause();
                    }
                    // Turning an archived member off records desired state only;
                    // its archived files and deferred policy remain untouched.
                    if (!change.after && observed?.archived) {
                        // No host or deferred mutation is needed.
                    } else {
                        const policy = change.ref.kind === 'community'
                            ? this.state.deferred.find((item) => item.id === change.ref.id && item.enabled)
                            : undefined;
                        if (policy) await this.host.excludeDeferred(change.ref, { unload: true });
                        else if (this.host.isEnabled(change.ref) !== change.after) {
                            await this.applyHostChange(change.ref, change.after);
                        }
                    }
                    if (!change.after && change.ref.kind === 'community') this.scheduler.cancel(change.ref.id);
                    this.bumpGeneration(change.ref);
                    this.setDesired(change.ref, change.after);
                    applied.push({ ...change, expectedPostimage: this.host.isEnabled(change.ref), desiredBefore, generation: this.generation(change.ref) });
                }
                this.profileUndo = { entries: applied };
                this.state.undo = { kind: 'profile', entries: clone(applied), createdAt: new Date().toISOString(), fixtureId: id };
                await this.store.save(this.state);
            });
            if (this.startupVerified && !this.isAutomationPaused()) await this.scheduleDeferredPlugins();
            await this.writeEffectiveStateInternal();
        });
    }

    undoProfile(): Promise<void> {
        return this.enqueue('undo-profile', async () => {
            const undo = this.profileUndo ?? this.readPersistedUndo();
            if (!undo) throw new Error('No profile application is available to undo.');
            await this.withPending('undo-profile', async () => {
                await this.store.assertFresh();
                for (const entry of [...undo.entries].reverse()) {
                    this.scheduler.cancel(entry.ref.id);
                    if (this.generation(entry.ref) !== entry.generation || this.host.isEnabled(entry.ref) !== entry.expectedPostimage) continue;
                    if (this.host.isEnabled(entry.ref) !== entry.before) await this.applyHostChange(entry.ref, entry.before);
                    this.bumpGeneration(entry.ref);
                    this.setDesired(entry.ref, entry.desiredBefore);
                }
                this.profileUndo = undefined;
                this.state.undo = undefined;
                await this.store.save(this.state);
            });
            await this.writeEffectiveStateInternal();
        });
    }

    setEnabled(ref: PluginRef, enabled: boolean): Promise<void> {
        return this.enqueue(`set-enabled:${key(ref)}`, (tx) => tx.setEnabled(ref, enabled));
    }

    getMutationGeneration(ref: PluginRef): number {
        return this.generation(ref);
    }

    private async saveInternal(): Promise<void> {
        if (this.disposed) throw new Error('Manager runtime is disposed.');
        await this.withPending('save-state', async () => this.store.save(this.state));
    }

    /**
     * Deferred policy edit, executed inside the caller's queue and never inside
     * a new one, and never saving by itself: the caller owns tx.save() so a
     * rejected edit leaves nothing persisted.
     *
     * Contract with the caller:
     * - A scheduled load for this ref is cancelled, so no stale timer can fire
     *   after the policy changed (the UI also pauses the runtime for that).
     * - While the policy is enabled, native autostart is excluded regardless of
     *   desired or profile membership: the policy is a host-level claim, and a
     *   record that disagrees must not keep the plugin on the native path.
     * - Protection outranks the policy, and so does the absence of a
     *   nonpersistent path. An enabled policy for a protected ref, or for a core
     *   ref whose exclusion would persist a native disable, is rejected before
     *   the timer is cancelled and before the host is touched, so a contradictory
     *   configuration can never be half-applied. The rejection leaves the imported
     *   policy and the user record untouched for the operator to resolve.
     * - Nothing is ever loaded here. A deferred instance that is loaded anyway
     *   is unloaded nonpersistently, so recovery leaves it off without touching
     *   desired or membership records.
     * - A policy turned off keeps native autostart off. Turning it back on is
     *   an explicit manual profile or start reapplied later, never a side
     *   effect of editing the policy.
     * - The host's own readback in excludeDeferred is the gate; a failure
     *   propagates so the caller can abort the save instead of claiming a
     *   deferment that is not enforced.
     */
    private async reconcileDeferredInternal(ref: PluginRef, options?: { origin?: string }): Promise<void> {
        if (this.disposed || this.host.isRestricted()) throw new Error('Operation cannot mutate the host while plugin loading is paused or the manager is unloading.');
        const policy = this.state.deferred.find((item) => item.id === ref.id);
        if (!policy?.enabled) {
            this.scheduler.cancel(ref.id);
            return;
        }
        if (this.isProtected(ref)) throw new Error(`Deferred policy for protected plugin ${key(ref)} conflicts with its protection and cannot be reconciled.`);
        // A core wrapper has no nonpersistent activation path: excluding it turns
        // its native flag off for real, so honouring the policy would be a
        // persistent disable wearing a policy's clothes. Rejecting here keeps the
        // core native flag untouched instead of faking a deferment.
        if (ref.kind === 'core') throw new Error(`Core plugin ${key(ref)} cannot be deferred: core exclusion changes the persistent native flag and no nonpersistent deferred load exists for it.`);
        this.scheduler.cancel(ref.id);
        const observed = this.host.observe().find((item) => key(item.ref) === key(ref) && item.installed);
        if (!observed) throw new Error(`Plugin ${key(ref)} is not installed, deferred exclusion cannot be reconciled.`);
        await this.host.excludeDeferred(ref, { unload: observed.loaded, origin: options?.origin });
        if (this.host.isEnabled(ref)) throw new Error(`Deferred reconciliation left ${key(ref)} loaded.`);
        this.bumpGeneration(ref);
    }

    private async setEnabledInternal(ref: PluginRef, enabled: boolean, options?: { loadNow?: boolean; origin?: string }): Promise<void> {
        const diagnostic = isDiagnosticOrigin(options?.origin) && this.hasDiagnosticContext();
        // Obsidian's loading gate outranks every transaction: a live diagnosis may
        // mutate enabled/disabled while automation stays paused, but nothing may
        // reach the host while Obsidian itself refuses to load plugins, and an
        // unrelated origin keeps respecting the recovery gate.
        if (this.disposed || this.host.isRestricted()) throw new Error('Operation cannot mutate the host while plugin loading is paused or the manager is unloading.');
        if (this.isAutomationPaused() && !diagnostic) throw new Error('Plugin automation is paused; resume or use the debugging transaction mode.');
        if (!this.host.observe().some((item) => key(item.ref) === key(ref) && item.installed)) throw new Error(`Plugin ${key(ref)} is not installed.`);
        if (enabled && !this.isCompatible(ref)) throw new Error(`Incompatible plugin ${key(ref)} cannot be enabled.`);
        if (!enabled && key(ref) === MANAGER_PROTECTED_KEY) throw new Error('The manager plugin is always protected and cannot be disabled.');
        if (!enabled && this.isProtected(ref)) throw new Error(`Protected plugin ${key(ref)} cannot be disabled.`);
        const policy = ref.kind === 'community' ? this.state.deferred.find((item) => item.id === ref.id && item.enabled) : undefined;
        if (enabled && policy && !diagnostic) throw new Error(`Plugin ${ref.id} is deferred. Disable its policy or wait for its scheduled load.`);
        this.scheduler.cancel(ref.id);
        const before = this.host.isEnabled(ref);
        if (diagnostic) {
            // The session owns its postimage: the host is mutated without touching
            // desired, native autostart or the deferred policy, so the snapshot the
            // diagnosis captured stays restorable. loadNow only decides whether the
            // host change is persisted, and this stays inside the queue the caller
            // already owns, so no re-enqueue and no nested save is introduced.
            if (before !== enabled) {
                // Only a community plugin has a nonpersistent activation path.
                // A core wrapper has no such path: wrapper.enable(false) loads the
                // instance and inherently leaves native autostart on, so the
                // adapter can only be asked to persist that same state. Passing
                // loadNow for a core ref would demand native=false right after a
                // call that can never keep it off, and the readback would fail.
                const nonpersistent = ref.kind === 'community' && options?.loadNow === true;
                const persistence = nonpersistent ? { loadNow: true, origin: options?.origin } : { origin: options?.origin };
                await this.host.setEnabled(ref, enabled, persistence);
                if (this.host.isEnabled(ref) !== enabled) throw new Error(`Host loaded-state readback failed for debugging mutation ${key(ref)}.`);
                this.bumpGeneration(ref);
            }
            return;
        }
        await this.withPending(`plugin:${key(ref)}`, async () => {
            await this.store.assertFresh();
            this.assertNoConcurrentPause();
            if (before !== enabled) await this.applyHostChange(ref, enabled, true);
            this.setDesired(ref, enabled);
            this.bumpGeneration(ref);
            await this.store.save(this.state);
        });
        await this.writeEffectiveStateInternal();
    }

    setTags(ref: PluginRef, tags: string[]): Promise<void> {
        return this.enqueue(`set-tags:${key(ref)}`, async () => {
            await this.withPending(`tags:${key(ref)}`, async () => {
                await this.store.assertFresh();
                this.ensureRecord(ref).tags = [...new Set(tags.filter((tag) => this.state.tags.some((item) => item.id === tag)))];
                this.bumpGeneration(ref);
                await this.store.save(this.state);
            });
        });
    }

    setGroup(ref: PluginRef, group: string): Promise<void> {
        return this.enqueue(`set-group:${key(ref)}`, async () => {
            await this.withPending(`group:${key(ref)}`, async () => {
                await this.store.assertFresh();
                if (group && !this.state.groups.some((item) => item.id === group)) throw new Error(`Group ${group} does not exist.`);
                this.ensureRecord(ref).group = group;
                this.bumpGeneration(ref);
                await this.store.save(this.state);
            });
        });
    }

    bindProfile(id: string): Promise<void> {
        return this.enqueue('bind-profile', async () => {
            if (this.disposed) throw new Error('Manager runtime is disposed.');
            if (id && !this.state.deviceProfiles.some((profile) => profile.id === id)) throw new Error(`Device profile ${id} does not exist.`);
            const previous = this.local.deviceProfileId;
            if (id) this.local.deviceProfileId = id;
            else delete this.local.deviceProfileId;
            try {
                this.persistLocal();
            } catch (error) {
                if (previous) this.local.deviceProfileId = previous;
                else delete this.local.deviceProfileId;
                throw error;
            }
        });
    }

    resume(): Promise<void> {
        const pauseGen = this.pauseGeneration;
        return this.enqueue('resume-runtime', async () => {
            if (this.disposed) throw new Error('Manager runtime is disposed.');
            if (this.pauseGeneration !== pauseGen) throw new Error('Plugin automation resume was cancelled because a new pause arrived.');
            if (this.host.isRestricted() || isDebugging(this.state)) throw new Error('Plugin automation cannot resume while Obsidian plugin loading is disabled or a debug session is active.');
            const pending = this.local.operationPending;
            const refreshed = await this.refreshInternal();
            if (this.disposed) throw new Error('Manager runtime is disposed.');
            if (this.pauseGeneration !== pauseGen) {
                throw new Error('Plugin automation resume was cancelled because a new pause arrived.');
            }
            if (this.host.isRestricted() || isDebugging(refreshed)) throw new Error('Plugin automation cannot resume while Obsidian plugin loading is disabled or a debug session is active.');
            const candidate: LocalState = clone(this.local);
            if (pending) {
                const history = Array.isArray((candidate as any).abandonedOperations) ? [...(candidate as any).abandonedOperations] : [];
                history.push({
                    operation: pending,
                    abandonedAt: new Date().toISOString(),
                    observedHost: this.host.observe().map((item) => ({
                        kind: item.ref.kind,
                        id: item.ref.id,
                        nativeAutostart: item.nativeAutostart,
                        loaded: item.loaded,
                    })),
                });
                (candidate as any).abandonedOperations = history.slice(-50);
            }
            delete candidate.operationPending;
            delete candidate.recoveryReason;
            this.persistLocal(candidate);

            for (const key of Object.keys(this.local)) {
                if (!(key in candidate)) {
                    delete (this.local as any)[key];
                }
            }
            Object.assign(this.local, candidate);

            this.state = refreshed;
            this.profileUndo = this.readPersistedUndo();
            for (const entry of this.profileUndo?.entries ?? []) {
                if (!this.generations.has(key(entry.ref))) this.generations.set(key(entry.ref), entry.generation);
            }
            if (!this.state.protected.includes(MANAGER_PROTECTED_KEY)) this.state.protected.push(MANAGER_PROTECTED_KEY);
            if (this.layoutReadySeen) {
                this.startupVerified = true;
                await this.resumeAutomation();
            }
        });
    }

    pause(reason: string): void {
        if (this.disposed) return;
        const normalized = String(reason || 'Runtime paused').slice(0, 500);
        this.pauseGeneration++;
        this.local.recoveryReason = normalized;
        this.scheduler.cancelAll();
        try {
            this.persistLocal();
        } catch (error) {
            this.log('error', 'Could not persist the runtime recovery latch.', error);
        }
        this.log('warn', `Plugin automation paused: ${normalized}`);
    }

    start(wasLayoutReady: boolean): Promise<void> {
        if (this.startupPromise) return this.startupPromise;
        this.startupPromise = this.enqueue('start-runtime', async () => {
            if (this.started) return;
            this.started = true;
            try {
                this.removePauseGuard = this.host.installGlobalPauseGuard();
                this.removeMutationTracking = this.host.installMutationTracking();
            } catch (error) {
                this.pause('Could not install the global plugin-disable recovery guard.');
                this.log('error', 'Global plugin-disable guard installation failed.', error);
                throw error;
            }
            if (this.local.operationPending) this.pause(`Interrupted operation: ${this.local.operationPending}`);
            if (this.host.isRestricted()) this.pause('Obsidian plugin loading is disabled.');
            if (isDebugging(this.state)) this.pause('Debug session is active.');
            if (wasLayoutReady) {
                this.layoutReadySeen = true;
                this.pause('Manager loaded after layout readiness; startup automation was skipped.');
            }

            // Native exclusions run before every recovery check, including late load,
            // restricted mode, pending operations, and parked policies.
            await this.excludeDeferredPlugins();
            const workspace = this.app?.workspace;
            if (!workspace || typeof workspace.onLayoutReady !== 'function') {
                this.pause('Obsidian workspace.onLayoutReady is unavailable.');
                return;
            }
            workspace.onLayoutReady(() => {
                void this.enqueue('layout-ready-automation', async () => {
                    this.layoutReadySeen = true;
                    if (this.disposed || this.isAutomationPaused()) return;
                    this.startupVerified = true;
                    await this.resumeAutomation();
                }).catch((error) => this.log('error', 'Startup automation failed.', error));
            });
        });
        return this.startupPromise;
    }

    dispose(): void {
        this.disposed = true;
        this.scheduler.cancelAll();
        this.removePauseGuard?.();
        this.removePauseGuard = undefined;
        this.removeMutationTracking?.();
        this.removeMutationTracking = undefined;
        this.host.dispose();
    }

    log(level: string, message: string, details?: unknown): void {
        const logger = this.plugin?.logger?.[level];
        if (typeof logger === 'function') {
            try { logger.call(this.plugin.logger, message, details); return; } catch { /* console remains the visible fallback */ }
        }
        const method = (console as any)[level] ?? console.log;
        if (details === undefined) method.call(console, `[AIgility Plugin Manager] ${message}`);
        else method.call(console, `[AIgility Plugin Manager] ${message}`, details);
    }

    writeEffectiveState(): Promise<void> {
        return this.enqueue('write-effective-state', () => this.writeEffectiveStateInternal());
    }

    private async writeEffectiveStateInternal(): Promise<void> {
        if (this.disposed) throw new Error('Manager runtime is disposed.');
        const boundProfileId = this.local.deviceProfileId;
        const appliedProfileId = (this.local as any).appliedProfileId;
        const report = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            installation: { appId: this.app?.appId ?? null, vaultName: this.app?.vault?.getName?.() ?? null, platform: typeof Platform.isMobile === 'boolean' ? (Platform.isMobile ? 'mobile' : 'desktop') : null },
            profile: { boundProfileId, appliedProfileId },
            recovery: { reason: this.local.recoveryReason, operationPending: this.local.operationPending },
            plugins: this.list().map((item) => ({
                kind: item.ref.kind,
                id: item.ref.id,
                installed: item.installed,
                archived: Boolean((item as ObservedPlugin & { archived?: boolean }).archived),
                desired: item.desired,
                nativeAutostart: item.nativeAutostart,
                loaded: item.loaded,
                scheduled: item.scheduled,
                membership: this.profileMembership(item.ref, appliedProfileId),
                delayMs: this.state.deferred.find((policy) => policy.id === item.ref.id)?.delayMs,
                recoveryReason: this.local.recoveryReason,
                operationPending: this.local.operationPending,
                reason: item.reason,
                version: item.version,
            })),
        };
        await this.store.writeJson(`${this.plugin.manifest.dir}/effective-state.json`, report);
    }

    private async resumeAutomation(): Promise<void> {
        if (this.isAutomationPaused() || this.host.isRestricted()) return;
        await this.withPending('legacy-workspace-clone', async () => {
            this.assertNoConcurrentPause();
            const cloned = await this.host.ensureLegacyWorkspaceClones();
            if (cloned.length) this.log('info', `Cloned legacy desktop workspace into missing variants: ${cloned.join(', ')}.`);
        });
        if (this.isAutomationPaused()) return;
        const bound = this.local.deviceProfileId
            ? this.state.deviceProfiles.find((profile) => profile.id === this.local.deviceProfileId)
            : undefined;
        if (bound?.applyAtStart) await this.applyProfileInternal(bound.id);
        if (this.isAutomationPaused()) return;
        await this.scheduleDeferredPlugins();
        if (bound?.workspaceId) {
            await this.withPending(`workspace:${bound.workspaceId}`, async () => {
                this.assertNoConcurrentPause();
                await this.host.loadWorkspace(bound.workspaceId!);
            });
        }
        await this.writeEffectiveStateInternal();
    }

    private async refreshInternal(): Promise<State> {
        if (this.disposed) throw new Error('Manager runtime is disposed.');
        const refreshed = await this.store.refresh();
        if (this.disposed) throw new Error('Manager runtime is disposed.');
        this.state = refreshed;
        // Read the host in the same transaction as disk so recovery diagnostics
        // distinguish persisted intent from native and loaded state.
        this.host.observe();
        return refreshed;
    }

    private profileMembership(ref: PluginRef, profileId?: string): boolean {
        if (!profileId) return false;
        const profile = this.state.deviceProfiles.find((candidate) => candidate.id === profileId);
        const record = this.state.records[key(ref)];
        if (!profile || !record || !this.isCompatible(ref)) return false;
        const tags = new Set(profile.tagIds ?? []);
        return Boolean(record.tags?.some((tag) => tags.has(tag)));
    }

    private async applyProfileInternal(id: string, expectedPreview?: Change[]): Promise<void> {
        const changes = this.computeProfile(id);
        this.scheduler.cancelAll();
        (this.local as any).appliedProfileId = id;
        if (changes.length === 0) {
            this.persistLocal();
            return;
        }
        if (expectedPreview && JSON.stringify(changes) !== JSON.stringify(expectedPreview)) throw new Error('La vista previa del perfil cambió. Genera una nueva vista previa antes de aplicar.');
        await this.withPending(`profile:${id}`, async () => {
            if (!expectedPreview) await this.store.assertFresh();
            const applied: ProfileUndoEntry[] = [];
            for (const change of this.profileOrder(changes)) {
                this.assertNoConcurrentPause();
                const initial = this.list().find((item) => key(item.ref) === key(change.ref));
                if (change.after && initial?.archived) {
                    this.assertNoConcurrentPause();
                    await this.archive!.restoreInTransaction(change.ref.id);
                    this.assertNoConcurrentPause();
                }
                const current = this.host.isEnabled(change.ref);
                const record = this.state.records[key(change.ref)];
                const desiredBefore = record?.desired ?? current;
                const deferred = change.ref.kind === 'community'
                    ? this.state.deferred.find((policy) => policy.id === change.ref.id)
                    : undefined;
                if (deferred) {
                    await this.host.excludeDeferred(change.ref, { unload: true });
                }
                else if (current !== change.after) await this.applyHostChange(change.ref, change.after);
                if (!change.after && change.ref.kind === 'community') this.scheduler.cancel(change.ref.id);
                this.bumpGeneration(change.ref);
                this.setDesired(change.ref, change.after);
                applied.push({
                    ...change,
                    expectedPostimage: this.host.isEnabled(change.ref),
                    desiredBefore,
                    generation: this.generation(change.ref),
                });
            }
            this.profileUndo = { entries: applied };
            this.state.undo = { kind: 'profile', entries: clone(applied), createdAt: new Date().toISOString() };
            this.state.profileBackups.push({ profileId: id, createdAt: new Date().toISOString(), entries: clone(applied) });
            await this.store.save(this.state);
        });
        this.persistLocal();
    }

    private async excludeDeferredPlugins(): Promise<void> {
        const observed = this.host.observe();
        for (const policy of this.state.deferred ?? []) {
            if (!policy.enabled) continue;
            const community = observed.find((item) => item.ref.kind === 'community' && item.ref.id === policy.id && item.installed);
            const core = observed.find((item) => item.ref.kind === 'core' && item.ref.id === policy.id && item.installed);
            const ref = community?.ref ?? core?.ref;
            if (!ref) {
                this.log('warn', `Deferred plugin ${policy.id} is not installed; no native entry was found to exclude.`);
                continue;
            }
            // Protection is decided before any host mutation. An enabled policy
            // that names a protected ref is a contradictory imported
            // configuration, not an instruction: native autostart and the loaded
            // instance stay exactly as observed, the policy is left in place for
            // the operator to resolve instead of being silently dropped, the
            // conflict becomes a visible recovery reason, and startup keeps going
            // so a foreign policy never kills the manager's own onload.
            if (this.isProtected(ref)) {
                this.pause(`Deferred policy for protected plugin ${key(ref)} conflicts with its protection: native autostart and loaded state were left unchanged.`);
                this.log('warn', `Deferred exclusion skipped for protected plugin ${key(ref)}; the imported policy is retained for review.`);
                continue;
            }
            // The same rule that rejects a core policy edit applies here: a core
            // wrapper has no nonpersistent activation path, so excluding it would
            // persist a native disable and present it as a deferment. Startup
            // refuses it the same way instead of faking the policy's promise, and
            // the deferred load below already skips core refs it cannot honour.
            if (ref.kind === 'core') {
                this.pause(`Deferred policy for core plugin ${key(ref)} cannot be honoured: a core wrapper has no nonpersistent deferred load, so its native state was left unchanged.`);
                this.log('warn', `Deferred exclusion skipped for core plugin ${key(ref)}; the imported policy is retained for review.`);
                continue;
            }
            try {
                await this.host.excludeDeferred(ref, { unload: true });
            } catch (error) {
                this.pause(`Could not exclude deferred plugin ${policy.id} from native autostart.`);
                this.log('error', `Deferred exclusion failed for ${policy.id}.`, error);
                throw error;
            }
        }
    }

    private async scheduleDeferredPlugins(): Promise<void> {
        const observed = this.host.observe();
        let index = 0;
        for (const policy of this.state.deferred ?? []) {
            const item = observed.find((candidate) => candidate.ref.kind === 'community' && candidate.ref.id === policy.id)
                ?? observed.find((candidate) => candidate.ref.kind === 'core' && candidate.ref.id === policy.id);
            if (!item?.installed || !item.compatible || this.isProtected(item.ref) || !policy.enabled || policy.parked) continue;
            const record = this.state.records[key(item.ref)];
            const appliedProfileId = (this.local as any).appliedProfileId;
            if (!appliedProfileId || !this.profileMembership(item.ref, appliedProfileId) || record?.desired !== true) continue;
            if (this.host.isEnabled(item.ref)) continue;
            const ref = item.ref;
            const delay = Math.max(0, policy.delayMs) + index * Math.max(0, this.state.settings?.staggerMs ?? 0);
            index++;
            this.scheduler.schedule(policy, ref, delay, async () => {
                try {
                    await this.enqueue(`deferred-load:${key(ref)}`, async () => {
                        if (this.isAutomationPaused() || this.host.isRestricted()) return;
                        const currentPolicy = this.state.deferred.find((item) => item.id === ref.id);
                        const currentAppliedId = (this.local as any).appliedProfileId;
                        if (this.isProtected(ref) || !currentPolicy?.enabled || currentPolicy.parked || !currentAppliedId || !this.profileMembership(ref, currentAppliedId) || this.state.records[key(ref)]?.desired !== true || this.host.isEnabled(ref)) return;
                        await this.withPending(`deferred:${key(ref)}`, async () => {
                            await this.store.assertFresh();
                            this.assertNoConcurrentPause();
                            await this.host.loadDeferred(ref);
                            this.setDesired(ref, true);
                            this.bumpGeneration(ref);
                            this.syncUndoPostimage(ref, true);
                            await this.store.save(this.state);
                        });
                        await this.writeEffectiveStateInternal();
                    });
                } catch (error) {
                    this.log('error', `Deferred load failed for ${key(ref)}.`, error);
                }
            });
        }
    }

    private computeProfile(id: string): Change[] {
        const profile = this.state.deviceProfiles.find((candidate) => candidate.id === id);
        if (!profile) throw new Error(`Device profile ${id} does not exist.`);
        const tags = new Set(profile.tagIds ?? []);
        const changes: Change[] = [];
        for (const item of this.list()) {
            if (!item.installed && !item.archived) continue;
            const ref = item.ref;
            if (this.isProtected(ref)) continue;
            const compatible = this.isCompatible(ref, item);
            const record = this.state.records[key(ref)];
            const after = compatible && Boolean(record?.tags?.some((tag) => tags.has(tag)));
            const before = this.host.isEnabled(ref);
            if (before !== after || record?.desired !== after) {
                changes.push({ ref, before, after, reason: before === after ? `desired-only:profile:${id}` : compatible ? `profile:${id}` : 'incompatible' });
            }
        }
        return changes;
    }

    private profileFingerprint(id: string): string {
        const profile = this.state.deviceProfiles.find((candidate) => candidate.id === id);
        if (!profile) throw new Error(`Device profile ${id} does not exist.`);
        return JSON.stringify({ profile, records: this.state.records, tags: this.state.tags, archive: this.archive?.fingerprint(), observed: this.list().map((item) => ({ ref: item.ref, installed: item.installed, archived: item.archived, compatible: item.compatible, nativeAutostart: item.nativeAutostart, loaded: item.loaded, enabled: this.host.isEnabled(item.ref) })) });
    }

    private profileOrder(changes: Change[]): Change[] {
        return [...changes].sort((a, b) => {
            const aEarly = a.ref.kind === 'community' && a.ref.id === 'advanced-exclude' ? 0 : 1;
            const bEarly = b.ref.kind === 'community' && b.ref.id === 'advanced-exclude' ? 0 : 1;
            return aEarly - bEarly;
        });
    }

    private async applyHostChange(ref: PluginRef, enabled: boolean, explicit = false): Promise<void> {
        if (enabled && ref.kind === 'community' && this.archive?.list().some((item) => item.id === ref.id)) throw new Error(`Archived plugin ${key(ref)} must be restored explicitly before manual activation.`);
        if (enabled && !this.isCompatible(ref)) throw new Error(`Incompatible plugin ${key(ref)} cannot be enabled.`);
        if (enabled && !explicit && this.isProtected(ref) && key(ref) !== MANAGER_PROTECTED_KEY) throw new Error(`Protected plugin ${key(ref)} cannot be changed by a profile.`);
        await this.host.setEnabled(ref, enabled);
        if (this.host.isEnabled(ref) !== enabled) throw new Error(`Host readback failed for ${key(ref)}.`);
        if (!enabled && ref.kind === 'community') this.scheduler.cancel(ref.id);
    }

    private async withPending<T>(label: string, operation: () => Promise<T>): Promise<T> {
        if (this.disposed) throw new Error('Manager runtime is disposed.');
        if (this.local.operationPending) throw new Error(`Operation ${this.local.operationPending} is pending recovery.`);
        this.local.operationPending = label;
        this.activePauseBaseline = this.pauseGeneration;
        try {
            this.persistLocal();
            const result = await operation();
            if (this.disposed) throw new Error('Manager runtime is disposed.');
            delete this.local.operationPending;
            this.persistLocal();
            return result;
        } catch (error) {
            if (!this.disposed) {
                this.pause(`Operation interrupted: ${label}`);
            }
            this.log('error', `Operation ${label} failed.`, error);
            throw error;
        } finally {
            this.activePauseBaseline = undefined;
        }
    }

    private assertNoConcurrentPause(): void {
        if (this.activePauseBaseline !== undefined && this.activePauseBaseline !== this.pauseGeneration) {
            throw new Error('Operation was cancelled because a runtime pause arrived before the next host mutation.');
        }
        if (this.host.isRestricted() || this.disposed) throw new Error('Operation cannot mutate the host while plugin loading is paused or the manager is unloading.');
    }

    private isProtected(ref: PluginRef): boolean {
        const pluginKey = key(ref);
        return pluginKey === MANAGER_PROTECTED_KEY || this.state.protected?.includes(pluginKey) === true || this.state.protected?.includes(ref.id) === true;
    }

    private isCompatible(ref: PluginRef, observation?: ObservedPlugin): boolean {
        const item = observation ?? this.list().find((candidate) => key(candidate.ref) === key(ref));
        return Boolean(item?.compatible && this.state.records[key(ref)]?.metadata?.compatible !== false);
    }

    private setDesired(ref: PluginRef, desired: boolean): void {
        const record = this.ensureRecord(ref);
        record.desired = desired;
    }

    private ensureRecord(ref: PluginRef): State['records'][string] {
        const recordKey = key(ref);
        let record = this.state.records[recordKey];
        if (record) return record;
        const item = this.host.observe().find((candidate) => key(candidate.ref) === recordKey);
        if (!item) throw new Error(`Cannot create a manager record for missing plugin ${recordKey}.`);
        record = { ref, name: item.name, version: item.version, tags: [], group: '', desired: item.nativeAutostart, metadata: {} };
        this.state.records[recordKey] = record;
        return record;
    }

    private generation(ref: PluginRef): number { return this.generations.get(key(ref)) ?? 0; }
    private bumpGeneration(ref: PluginRef): void { this.generations.set(key(ref), this.generation(ref) + 1); }

    private readPersistedUndo(): typeof this.profileUndo {
        const undo = isObject(this.state.undo) && this.state.undo.kind === 'profile' && Array.isArray(this.state.undo.entries)
            ? this.state.undo.entries
            : undefined;
        if (!undo) return undefined;
        return {
            entries: undo.filter((entry: any) => entry && entry.ref && typeof entry.generation === 'number').map((entry: any) => ({
                ...entry,
                expectedPostimage: typeof entry.expectedPostimage === 'boolean' ? entry.expectedPostimage : entry.after,
                desiredBefore: typeof entry.desiredBefore === 'boolean' ? entry.desiredBefore : entry.before,
            })),
        };
    }

    private syncUndoPostimage(ref: PluginRef, enabled: boolean): void {
        const entry = this.profileUndo?.entries.find((item) => key(item.ref) === key(ref));
        if (!entry) return;
        entry.expectedPostimage = enabled;
        entry.generation = this.generation(ref);
        if (isObject(this.state.undo) && Array.isArray(this.state.undo.entries)) {
            const persisted = this.state.undo.entries.find((item: any) => item && isObject(item.ref) && item.ref.kind === ref.kind && item.ref.id === ref.id);
            if (persisted) {
                persisted.expectedPostimage = enabled;
                persisted.generation = entry.generation;
            }
        }
    }

    private isAutomationPaused(): boolean {
        return Boolean(this.local.recoveryReason || this.local.operationPending || isDebugging(this.state) || this.disposed);
    }

    /**
     * A diagnosis may only mutate the host while a diagnosis is actually
     * running: an active debug session, or an explicit diagnostic pause with
     * no unrelated operation in flight. An interrupted operation derives its
     * pause reason from that operation, so the latch keeps rejecting host
     * mutations even when the caller labels them diagnostic.
     */
    private hasDiagnosticContext(): boolean {
        if (isDebugging(this.state)) return true;
        if (this.local.operationPending) return false;
        return isDiagnosticPause(this.local.recoveryReason);
    }

    private makeLocalKey(): string {
        const appId = String(this.app?.appId ?? 'obsidian');
        let vaultPath: unknown;
        try { vaultPath = this.app?.vault?.adapter?.getBasePath?.(); } catch { /* use the stable vault-name fallback */ }
        if (!vaultPath) vaultPath = this.app?.vault?.getName?.() ?? this.app?.vault?.adapter?.basePath ?? this.app?.vault?.configDir ?? 'vault';
        return `aigility-plugin-manager:local:v1:${encodeURIComponent(appId)}:${encodeURIComponent(String(vaultPath))}`;
    }

    private readLocal(): LocalState {
        try {
            const raw = (globalThis as any).localStorage?.getItem?.(this.localKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!isObject(parsed)) return { recoveryReason: 'Local runtime state is malformed.' };
            return {
                ...parsed,
                ...(typeof parsed.deviceProfileId === 'string' ? { deviceProfileId: parsed.deviceProfileId } : {}),
                ...(typeof parsed.appliedProfileId === 'string' ? { appliedProfileId: parsed.appliedProfileId } : {}),
                ...(typeof parsed.recoveryReason === 'string' ? { recoveryReason: parsed.recoveryReason } : {}),
                ...(typeof parsed.operationPending === 'string' ? { operationPending: parsed.operationPending } : {}),
                ...(Array.isArray(parsed.abandonedOperations) ? { abandonedOperations: parsed.abandonedOperations } : {}),
            };
        } catch (error) {
            this.log('error', 'Could not read local runtime state; automation is paused.', error);
            return { recoveryReason: 'Local runtime state could not be read.' };
        }
    }

    private persistLocal(target: LocalState = this.local): void {
        if (this.disposed) throw new Error('Manager runtime is disposed.');
        const storage = (globalThis as any).localStorage;
        if (!storage || typeof storage.setItem !== 'function') throw new Error('Persistent localStorage is required for recovery-safe runtime state.');
        storage.setItem(this.localKey, JSON.stringify(target));
    }
}

export { collectObserved, StateConflictError };
