import { Notice, Plugin, PluginSettingTab } from 'obsidian';
import { ManagerRuntime } from './src/integrated/runtime';
import { GithubManager } from './src/integrated/github';
import { DebugManager } from './src/integrated/debug';
import { ManagerUI } from './src/integrated/ui';
import { installStartupGuards } from './src/integrated/guards';
import { migrateLegacy } from './src/integrated/migration';
import { collectObserved } from './src/integrated/adapter';
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
    github!: GithubManager;
    debug!: DebugManager;
    managerUI!: ManagerUI;
    private removeGuards?: () => void;
    private disposed = false;

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
        if (loaded?.schemaVersion === 1) {
            state = loaded as State;
            this.managerRuntimePreimage = existingRaw;
        } else {
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

        // Persist a baseline before runtime.start can apply profiles or schedule deferred plugins.
        await this.runtime.save();
        if (this.disposed) return;
        await this.runtime.start(wasLayoutReady);
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
        // Restore host wrappers before disposing services that may still own diagnostics.
        this.managerUI?.dispose();
        this.debug?.dispose();
        this.removeGuards?.();
        this.removeGuards = undefined;
        this.runtime?.dispose();
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
            id: 'manager-apply-profile', name: 'Apply bound manager profile',
            callback: () => {
                const id = this.runtime.local.deviceProfileId;
                if (!id) { new Notice('No manager profile is bound to this Obsidian app.'); return; }
                void this.runtime.applyProfile(id).catch((error) => this.showError(error));
            },
        });
        this.addCommand({ id: 'manager-undo', name: 'Undo last manager profile', callback: () => void this.runtime.undoProfile().catch((error) => this.showError(error)) });
        this.addCommand({ id: 'manager-resume', name: 'Resume manager recovery', callback: () => void this.runtime.resume().catch((error) => this.showError(error)) });
        for (const profile of this.runtime.state.deviceProfiles) {
            this.addCommand({
                id: `manager-profile-${profile.id}-apply`, name: `Apply manager profile: ${profile.name}`,
                callback: () => void this.runtime.applyProfile(profile.id).catch((error) => this.showError(error)),
            });
        }
        for (const fixture of this.runtime.state.fixtureProfiles) {
            this.addCommand({
                id: `manager-profile-${fixture.id}-apply`, name: `Apply manager fixture: ${fixture.name}`,
                callback: () => void this.runtime.applyFixture(fixture.id).catch((error) => this.showError(error)),
            });
        }
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

    private openOptions(): void {
        const setting = (this.app as any).setting;
        const tab = setting?.settingTabs?.find((item: any) => item.id === this.manifest.id);
        if (tab) setting.openTabById?.(this.manifest.id);
        else new Notice('Open Settings and select AIgility Plugin Manager.');
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
