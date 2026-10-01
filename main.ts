import { Notice, Plugin, PluginSettingTab } from 'obsidian';
import { ManagerRuntime } from './src/integrated/runtime';
import { GithubManager } from './src/integrated/github';
import { DebugManager } from './src/integrated/debug';
import { ManagerUI, ProfileComparisonModal } from './src/integrated/ui';
import { installStartupGuards } from './src/integrated/guards';
import { migrateLegacy } from './src/integrated/migration';
import { collectObserved } from './src/integrated/adapter';
import { ArchiveManager } from './src/integrated/archive';
import type { State } from './src/integrated/types';

const LEGACY_BPM_ID = 'better-plugins-manager';
const LEGACY_COMPANION_ID = 'better-plugins-manager-companion';
const SECRET_KEY = /token|secret|password|api[-_]?key|credential|authorization/i;

function redactDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactDeep);
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = SECRET_KEY.test(key) ? '[redacted]' : redactDeep(item);
    return result;
}

function attachRedactingSerialization(state: State): State {
    Object.defineProperty(state, 'toJSON', {
        configurable: true,
        enumerable: false,
        value: () => redactDeep(Object.fromEntries(Object.entries(state))),
    });
    return state;
}

function parseObject(raw: string | null): Record<string, any> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
}

export default class AIgilityPluginManager extends Plugin {
    managerRuntimePreimage: string | null = null;
    logger: Console = console;
    managerBuild = `aigility-plugin-manager/${this.manifest.version}`;
    runtime!: ManagerRuntime;
    archive!: ArchiveManager;
    github!: GithubManager;
    debug!: DebugManager;
    managerUI!: ManagerUI;
    private removeGuards?: () => void;
    private disposed = false;
    private dynamicCommands = new Map<string, { descriptor: { name: string; type: string; id: string }; command: any }>();
    private restoreEnqueue?: () => void;

    async onload(): Promise<void> {
        // Capture this before the first await: late plugin loads must never run startup automation.
        const wasLayoutReady = this.app.workspace.layoutReady === true;
        this.disposed = false;
        this.logger = console;
        this.addSettingTab(new ManagerSettingsTab(this.app, this));

        const managerPath = `${this.manifest.dir}/data.json`.replace(/^\/+/, '');
        const existingRaw = await this.readOptional(managerPath);
        const loaded = await this.loadData();
        let state: State;
        let migratedFromLegacy = false;
        if (loaded?.schemaVersion === 1) {
            state = loaded as State;
            this.managerRuntimePreimage = existingRaw;
        } else {
            migratedFromLegacy = true;
            const [bpmRaw, companionRaw, communityRaw, coreRaw] = await Promise.all([
                this.readOptional(`.obsidian/plugins/${LEGACY_BPM_ID}/data.json`),
                this.readOptional(`.obsidian/plugins/${LEGACY_COMPANION_ID}/data.json`),
                this.readOptional('.obsidian/community-plugins.json'),
                this.readOptional('.obsidian/core-plugins.json'),
            ]);
            const app: any = this.app;
            const legacyBpmPlugin = app.plugins?.plugins?.[LEGACY_BPM_ID];
            const legacyCompanionPlugin = app.plugins?.plugins?.[LEGACY_COMPANION_ID];
            const bpm = bpmRaw === null ? await legacyBpmPlugin?.loadData?.() ?? {} : parseObject(bpmRaw);
            const companion = companionRaw === null ? await legacyCompanionPlugin?.loadData?.() ?? {} : parseObject(companionRaw);
            const backupPath = await this.writeMigrationBackup({
                createdAt: new Date().toISOString(),
                reason: 'schemaVersion is absent or unsupported',
                legacyBpm: bpmRaw ?? JSON.stringify(bpm),
                legacyCompanion: companionRaw ?? JSON.stringify(companion),
                communityPlugins: communityRaw,
                corePlugins: coreRaw,
            });
            state = migrateLegacy(bpm, companion, collectObserved(this.app));
            state.migration = { ...(state.migration ?? {}), backupPath, migratedAt: new Date().toISOString() };
            // Keep the preimage at the exact disk state; RuntimeStore owns the first canonical write.
            this.managerRuntimePreimage = existingRaw;
        }

        attachRedactingSerialization(state);
        this.runtime = new ManagerRuntime(this.app, this, state);
        this.archive = new ArchiveManager(this.runtime, this.app, this);
        this.runtime.archive = this.archive;
        await this.archive.initialize();
        this.github = new GithubManager(this.runtime, this.app, this);
        this.debug = new DebugManager(this.runtime, this.app, this);
        this.managerUI = new ManagerUI(this, this.runtime, this.github, this.debug);
        this.managerUI.install();
        this.registerCommands();
        this.removeGuards = installStartupGuards(this);
        this.register(() => this.disposeSynchronously());

        const oldCompanionLoaded = Boolean((this.app as any).plugins?.plugins?.[LEGACY_COMPANION_ID]?._loaded);
        if (oldCompanionLoaded) {
            this.runtime.pause('legacy-companion-loaded');
            new Notice('AIgility Plugin Manager: Better Manager Companion sigue cargado. La automatización está en pausa; el gestor no desactivará los gestores anteriores.');
        }

        // Persist a baseline before runtime.start can apply profiles or schedule
        // deferred plugins. An interrupted operation is never resolved here:
        // runtime.save() throws while a pending marker exists, and that rejection
        // would make the host unload the manager together with its recovery UI.
        await this.establishBaseline(migratedFromLegacy);
        if (this.disposed) return;
        await this.runtime.start(wasLayoutReady);
        this.installDynamicCommandSync();
        this.syncDynamicCommands();
        if (this.debug.session?.interrupted) {
            new Notice('AIgility Plugin Manager: sesión de debugging interrumpida; la recuperación requiere acción manual.');
        }
        this.logCommandMappings();
    }

    onunload(): void {
        this.disposeSynchronously();
    }

    private disposeSynchronously(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.restoreEnqueue?.();
        this.restoreEnqueue = undefined;
        this.removeOwnedDynamicCommands();
        // Restore host wrappers before disposing services that may still own diagnostics.
        this.managerUI?.dispose();
        this.debug?.dispose();
        this.removeGuards?.();
        this.removeGuards = undefined;
        this.runtime?.dispose();
    }

    /**
     * Writes the startup baseline only when the write can be proven safe.
     *
     * Interrupted operation: the pending marker is the evidence that a previous
     * mutation never reached its postimage, so nothing is written and nothing is
     * cleared. The disk file keeps its exact preimage and the loaded state is not
     * presented as saved; recovery happens only through the explicit Resume
     * action, which re-reads disk instead of trusting memory. A first-run
     * migration interrupted before its baseline write therefore still loads a
     * recoverable UI, and Resume resolves it through the store's initialState
     * because no canonical disk state exists yet.
     *
     * Baseline write conflict: the UI, its persistent recovery banner and the
     * Resume action stay alive, the pending marker written before the failed
     * operation keeps automation paused, and Resume performs the disk readback.
     */
    private async establishBaseline(migrated: boolean): Promise<void> {
        const pending = this.runtime.local.operationPending;
        if (pending) {
            this.runtime.log('warn', 'Startup baseline skipped: an interrupted operation is pending recovery.', {
                operationPending: pending,
                migrated,
                canonicalState: migrated ? 'absent' : 'on-disk',
            });
            new Notice(`AIgility Plugin Manager: la operación interrumpida "${pending}" mantiene la automatización en pausa. Revisa el estado y usa "Resume manager recovery" (Reanudar) para releer el disco.`);
            return;
        }
        try {
            await this.runtime.save();
        } catch (error) {
            this.runtime.log('error', 'Startup baseline write failed; the manager stays loaded in recovery and the loaded state is not presented as saved.', error);
            new Notice(`AIgility Plugin Manager: no se pudo escribir la línea base (${String((error as any)?.message ?? error)}). Las automatizaciones siguen en pausa; "Resume manager recovery" relee el disco.`);
        }
    }

    private async readOptional(path: string): Promise<string | null> {
        const adapter = this.app.vault.adapter;
        try { return await adapter.exists(path) ? await adapter.read(path) : null; }
        catch (error) { this.runtime?.log('warn', `Could not read ${path} for migration.`, error); throw error; }
    }

    private async writeMigrationBackup(contents: Record<string, unknown>): Promise<string> {
        const adapter = this.app.vault.adapter;
        const dir = `${this.manifest.dir}/migration-backups`.replace(/^\/+/, '');
        if (!await adapter.exists(dir)) await adapter.mkdir(dir);
        const name = `before-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const path = `${dir}/${name}`;
        await adapter.write(path, JSON.stringify(contents, null, 2));
        if (await adapter.read(path) !== JSON.stringify(contents, null, 2)) throw new Error('Migration backup readback failed; migration was stopped before State creation.');
        return path;
    }

    private registerCommands(): void {
        this.addCommand({ id: 'manager-options', name: 'Manager options', callback: () => this.openOptions() });
        this.addCommand({
            id: 'manager-view', name: 'Open community plugins settings',
            callback: () => {
                const setting = (this.app as any).setting;
                if (typeof setting?.open !== 'function' || typeof setting?.openTabById !== 'function') {
                    new Notice('AIgility Plugin Manager: no se puede abrir la pestaña Community plugins en esta versión de Obsidian.');
                    return;
                }
                setting.open();
                setting.openTabById('community-plugins');
            },
        });
        this.addCommand({
            id: 'manager-apply-profile', name: 'Apply bound manager profile',
            callback: () => {
                const id = this.runtime.local.deviceProfileId;
                if (!id) { new Notice('No manager profile is bound to this Obsidian app.'); return; }
                void this.previewManualProfile(id).catch((error) => this.showError(error));
            },
        });
        this.addCommand({ id: 'manager-undo', name: 'Undo last manager profile', callback: () => void this.runtime.undoProfile().catch((error) => this.showError(error)) });
        this.addCommand({ id: 'restore-previous-command-state', name: 'Restore previous command state', callback: () => void this.runtime.undoProfile().catch((error) => this.showError(error)) });
        this.addCommand({ id: 'manager-resume', name: 'Resume manager recovery', callback: () => void this.runtime.resume().catch((error) => this.showError(error)) });
    }

    private installDynamicCommandSync(): void {
        const runtime = this.runtime as any;
        const original = runtime.enqueue;
        if (typeof original !== 'function') return;
        const plugin = this;
        const wrapper = async function(this: unknown, ...args: unknown[]): Promise<unknown> {
            const result = await original.apply(this, args);
            if (!plugin.disposed) {
                try { plugin.syncDynamicCommands(); }
                catch (error) { plugin.showError(error); }
            }
            return result;
        };
        runtime.enqueue = wrapper;
        this.restoreEnqueue = () => {
            if (runtime.enqueue === wrapper) runtime.enqueue = original;
        };
    }

    private syncDynamicCommands(): void {
        if (this.disposed || !this.runtime) return;
        const desired = new Map<string, { descriptor: { name: string; type: string; id: string }; callback: () => void }>();
        for (const profile of this.runtime.state.deviceProfiles ?? []) {
            const id = `manager-profile-${this.safeCommandPart(profile.id)}-apply`;
            desired.set(id, {
                descriptor: { name: `Apply manager profile: ${profile.name}`, type: 'device-profile', id },
                callback: () => void this.previewManualProfile(profile.id).catch((error) => this.showError(error)),
            });
        }
        for (const fixture of this.runtime.state.fixtureProfiles ?? []) {
            const id = `manager-profile-${this.safeCommandPart(fixture.id)}-apply`;
            if (desired.has(id)) continue;
            desired.set(id, {
                descriptor: { name: `Apply manager fixture: ${fixture.name}`, type: 'fixture-profile', id },
                callback: () => void this.runtime.applyFixture(fixture.id).catch((error) => this.showError(error)),
            });
        }

        const protectedKeys = new Set(this.runtime.state.protected ?? []);
        for (const item of this.runtime.list()) {
            const { kind, id: pluginId } = item.ref;
            if (!item.installed || (kind !== 'community' && kind !== 'core') ||
                pluginId === this.manifest.id || pluginId === LEGACY_BPM_ID || pluginId === LEGACY_COMPANION_ID ||
                item.reason === 'protected' || protectedKeys.has(`${kind}:${pluginId}`) || protectedKeys.has(pluginId)) continue;
            const commandId = kind === 'community'
                ? `manager-${this.safeCommandPart(pluginId)}`
                : `manager-core-${this.safeCommandPart(pluginId)}`;
            const id = commandId;
            desired.set(id, {
                descriptor: { name: `Toggle ${item.name || pluginId}`, type: kind, id },
                callback: () => void this.toggleInstalledPlugin(kind, pluginId).catch((error) => this.showError(error)),
            });
        }

        for (const [fullId, owned] of this.dynamicCommands) {
            const next = desired.get(owned.descriptor.id);
            if (next && JSON.stringify(next.descriptor) === JSON.stringify(owned.descriptor)) continue;
            this.removeOwnedCommand(fullId, owned.command);
            this.dynamicCommands.delete(fullId);
        }
        for (const [id, entry] of desired) {
            if ([...this.dynamicCommands.values()].some((owned) => owned.descriptor.id === id)) continue;
            const fullId = `${this.manifest.id}:${id}`;
            const commands = (this.app as any).commands?.commands ?? {};
            if (Object.prototype.hasOwnProperty.call(commands, fullId) || Object.prototype.hasOwnProperty.call(commands, id)) continue;
            const returned = this.addCommand({ id, name: entry.descriptor.name, callback: entry.callback });
            const command = (this.app as any).commands?.commands?.[fullId] ?? returned;
            if (command) this.dynamicCommands.set(fullId, { descriptor: entry.descriptor, command });
        }
    }

    private async toggleInstalledPlugin(kind: 'community' | 'core', id: string): Promise<void> {
        await this.runtime.refresh();
        const current = this.runtime.list().find((item) => item.installed && item.ref.kind === kind && item.ref.id === id);
        if (!current) {
            this.showError(new Error(`Installed ${kind} plugin "${id}" is no longer available.`));
            return;
        }
        await this.runtime.setEnabled(current.ref, !current.desired);
    }

    private removeOwnedCommand(fullId: string, owned: any): void {
        const commands = (this.app as any).commands?.commands;
        if (commands?.[fullId] !== owned) return;
        (this.app as any).commands.removeCommand?.(fullId);
    }

    private removeOwnedDynamicCommands(): void {
        for (const [fullId, entry] of this.dynamicCommands) this.removeOwnedCommand(fullId, entry.command);
        this.dynamicCommands.clear();
    }

    private async previewManualProfile(id: string): Promise<void> {
        const changes = await this.runtime.previewProfile(id);
        new ProfileComparisonModal(this.app, changes, async () => this.runtime.applyProfile(id, changes)).open();
    }

    private safeCommandPart(id: string): string {
        return id.replace(/[^A-Za-z0-9_-]/g, '-');
    }

    private logCommandMappings(): void {
        const commands = (this.app as any).commands?.commands ?? {};
        const legacy = Object.keys(commands).filter((id) => id.startsWith(`${LEGACY_BPM_ID}:`));
        for (const oldId of legacy) {
            const commandId = oldId.slice(LEGACY_BPM_ID.length + 1);
            const mapped = `${this.manifest.id}:${commandId}`;
            if (commands[mapped]) this.runtime.log('info', 'Legacy command mapping available; user hotkeys are unchanged.', { from: oldId, to: mapped });
            else this.runtime.log('warn', 'No matching integrated command is registered for this legacy command ID.', { from: oldId, candidate: mapped });
        }
    }

    /**
     * Host 1.14.3 keeps installed plugin tabs in setting.pluginTabs, not in
     * setting.settingTabs, so searching the general tabs never matched this
     * plugin and the command only produced a false Notice. The manager owns its
     * own modal, so it is opened directly and no host tab lookup is involved.
     */
    private openOptions(): void {
        if (!this.managerUI) {
            new Notice('AIgility Plugin Manager: la interfaz no está disponible todavía.');
            return;
        }
        this.managerUI.openOptionsModal();
    }

    private showError(error: unknown): void {
        this.runtime?.log('error', 'Manager command failed.', error);
        new Notice(`AIgility Plugin Manager: ${String((error as any)?.message ?? error)}`);
    }
}

class ManagerSettingsTab extends PluginSettingTab {
    constructor(app: any, private plugin: AIgilityPluginManager) { super(app, plugin); }
    display(): void { this.containerEl.empty(); this.plugin.managerUI?.display(this.containerEl); }
}
