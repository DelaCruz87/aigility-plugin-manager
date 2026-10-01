import {
    App,
    Modal,
    Menu,
    Notice,
    Setting,
    setIcon
} from 'obsidian';
import { renderArchiveSection } from './archive-ui';
import type {
    Change,
    DeferredPolicy,
    DeviceProfile,
    EffectivePlugin,
    FixtureProfile,
    GithubSource,
    Group,
    LocalState,
    ObservedPlugin,
    PluginRecord,
    PluginRef,
    Release,
    State,
    Tag,
    UpdateResult
} from './types';

export type {
    Change,
    DeferredPolicy,
    DeviceProfile,
    EffectivePlugin,
    FixtureProfile,
    GithubSource,
    Group,
    LocalState,
    ObservedPlugin,
    PluginRecord,
    PluginRef,
    Release,
    State,
    Tag,
    UpdateResult
} from './types';

// Integration Contract Types
export function pluginRefKey(ref: PluginRef): string {
    return `${ref.kind}:${ref.id}`;
}

/**
 * Canonical `kind:id` parser. Selector values always carry the kind so that a
 * community plugin and a core plugin sharing the same id never collide.
 */
export function parsePluginRefKey(value: string): PluginRef | null {
    const separator = value.indexOf(':');
    if (separator < 1 || separator === value.length - 1) return null;
    const kind = value.slice(0, separator);
    if (kind !== 'community' && kind !== 'core') return null;
    return { kind, id: value.slice(separator + 1) };
}

/**
 * Raised when a modal's working copy no longer matches the refreshed state:
 * the queued save aborts instead of overwriting an externally changed field.
 */
export class UiStateConflictError extends Error {
    constructor(message = 'El estado cambió fuera de este diálogo mientras editabas. Reabre la sección para recargar los datos; no se sobreescribió nada.') {
        super(message);
        this.name = 'UiStateConflictError';
    }
}

/** Snapshot created by this manager: definitions only, never live enablement. */
export interface ManagerProfileBackup {
    id: string;
    timestamp: string;
    profiles: DeviceProfile[];
    fixtures: FixtureProfile[];
    tagMembership: { [pluginKey: string]: { tags: string[]; group: string } };
}

/** One device variant inside an imported Companion backup payload. */
export interface CompanionBackupVariant {
    name?: string;
    savedAt?: string;
    pluginStates?: { [pluginId: string]: unknown };
}

/**
 * Imported Companion backup, preserved verbatim by the migration as
 * { source, migratedAt, backups: { desktop/mobile/tablet: { name, savedAt,
 * pluginStates } } }. The original object is never rewritten by the UI.
 */
export interface CompanionBackupEntry {
    source: string;
    migratedAt?: string;
    backups: { [variant: string]: CompanionBackupVariant };
}

/** Stable identity used to resolve a backup entry inside refreshed state. */
export type BackupIdentity =
    | { kind: 'manager'; id: string }
    | { kind: 'companion'; source: string; migratedAt: string };

/** Fixture definition produced from an imported Companion backup variant. */
export interface CompanionRestoreFixture {
    id: string;
    name: string;
    members: { [pluginKey: string]: boolean };
    metadata: { [key: string]: unknown };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Guards an imported Companion backup entry without mutating it. */
export function companionBackupEntryOf(entry: unknown): CompanionBackupEntry | null {
    if (!isObjectRecord(entry) || typeof entry.source !== 'string' || !isObjectRecord(entry.backups)) return null;
    return entry as unknown as CompanionBackupEntry;
}

export function backupIdentityOf(entry: unknown): BackupIdentity | null {
    if (!isObjectRecord(entry)) return null;
    if (typeof entry.id === 'string' && entry.id) return { kind: 'manager', id: entry.id };
    if (typeof entry.source === 'string' && entry.source) {
        return { kind: 'companion', source: entry.source, migratedAt: typeof entry.migratedAt === 'string' ? entry.migratedAt : '' };
    }
    return null;
}

function sameBackupIdentity(entry: unknown, identity: BackupIdentity): boolean {
    const other = backupIdentityOf(entry);
    if (!other || other.kind !== identity.kind) return false;
    if (identity.kind === 'manager' && other.kind === 'manager') return other.id === identity.id;
    if (identity.kind === 'companion' && other.kind === 'companion') {
        return other.source === identity.source && other.migratedAt === identity.migratedAt;
    }
    return false;
}

/** Deterministic fixture id per device variant: restoring twice never duplicates. */
export function fixtureIdForCompanionVariant(variant: string): string {
    const slug = variant.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return `companion-restore-${slug || 'variant'}`;
}

/**
 * Light owner/repo normalization for pre-filling the release picker. This is
 * display-default only: the GithubManager re-validates the repository string
 * authoritatively before any network call.
 */
export function normalizeGithubRepoInput(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    let path = trimmed;
    const urlMatch = path.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/?#\s]+)/i);
    if (urlMatch) path = `${urlMatch[1]}/${urlMatch[2]}`;
    if (path.includes('://')) return null;
    const segments = path.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[0];
    let repo = segments[1];
    if (repo.endsWith('.git')) repo = repo.slice(0, -4);
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
}

/**
 * Pure plan for restoring an imported Companion backup: one partial fixture per
 * device variant built from its pluginStates, with canonical `kind:id` member
 * keys (raw legacy ids map to community, like the migration does). Returns null
 * when the payload holds no usable pluginStates. Never touches the entry.
 */
export function companionRestorePlan(entry: unknown): CompanionRestoreFixture[] | null {
    const parsed = companionBackupEntryOf(entry);
    if (!parsed) return null;
    const plans: CompanionRestoreFixture[] = [];
    for (const [variant, rawVariant] of Object.entries(parsed.backups)) {
        if (!isObjectRecord(rawVariant) || !isObjectRecord(rawVariant.pluginStates)) continue;
        const members: { [pluginKey: string]: boolean } = {};
        for (const [pluginId, state] of Object.entries(rawVariant.pluginStates)) {
            if (!pluginId) continue;
            const canonical = parsePluginRefKey(pluginId);
            members[canonical ? pluginRefKey(canonical) : `community:${pluginId}`] = state === true;
        }
        if (Object.keys(members).length === 0) continue;
        const name = typeof rawVariant.name === 'string' && rawVariant.name.trim() ? rawVariant.name.trim() : `Companion ${variant}`;
        plans.push({
            id: fixtureIdForCompanionVariant(variant),
            name,
            members,
            metadata: {
                restoredFrom: 'companion-backup',
                source: parsed.source,
                ...(typeof parsed.migratedAt === 'string' ? { migratedAt: parsed.migratedAt } : {}),
                ...(typeof rawVariant.savedAt === 'string' ? { savedAt: rawVariant.savedAt } : {}),
            },
        });
    }
    return plans.length > 0 ? plans : null;
}

export interface FilterCriteria {
    search?: string;
    kind?: 'all' | 'community' | 'core';
    tag?: string;
    group?: string;
}

/**
 * Transactional handle delivered with every queued operation. Transactions are
 * the ONLY sanctioned write path: tx.refresh() pulls the freshest persisted
 * state, entities are resolved by stable id inside the callback, and tx.save()
 * plus tx.writeEffectiveState() persist in the same queue slot. Calling public
 * save()/enqueue() from inside a transaction would deadlock the serial queue.
 */
export interface RuntimeTransaction {
    save(): Promise<void>;
    refresh(): Promise<State>;
    writeEffectiveState(): Promise<void>;
    setEnabled(ref: PluginRef, enabled: boolean, options?: { loadNow?: boolean; origin?: string }): Promise<void>;
    /**
     * Optional runtime-side native exclusion for deferred policies. It is
     * provided by the runtime when available; the UI never fakes it. When it is
     * missing and a plugin still owns native autostart, configuring the policy
     * must fail visibly instead of claiming a deferred configuration it cannot
     * enforce.
     */
    reconcileDeferred?(ref: PluginRef): Promise<void>;
}

export interface ManagerRuntime {
    state: State;
    local: LocalState;
    list(): EffectivePlugin[];
    enqueue<T>(label: string, operation: (tx: RuntimeTransaction) => Promise<T>): Promise<T>;
    save(): Promise<void>;
    previewProfile(id: string): Promise<Change[]>;
    applyProfile(id: string, expectedPreview?: Change[]): Promise<void>;
    undoProfile(): Promise<void>;
    setEnabled(ref: PluginRef, enabled: boolean): Promise<void>;
    setTags(ref: PluginRef, tags: string[]): Promise<void>;
    setGroup(ref: PluginRef, group: string): Promise<void>;
    bindProfile(id: string): Promise<void>;
    resume(): Promise<void>;
    pause(reason: string): void;
    start(wasLayoutReady: boolean): Promise<void>;
    dispose(): void;
    log(level: string, message: string, details?: unknown): void;
    writeEffectiveState(): Promise<void>;
}

export interface GithubManager {
    releases(repo: string): Promise<Release[]>;
    install(repo: string, tag: string): Promise<string>;
    rollback(id: string): Promise<void>;
    checkAll(): Promise<UpdateResult[]>;
    setPin(id: string, version?: string): Promise<void>;
}

export interface AdvancedCapability {
    id: string;
    supported: boolean;
    reason?: string;
}

export interface DebugManager {
    session?: any;
    start(refs?: PluginRef[]): Promise<void>;
    testHalf(complement?: boolean): Promise<void>;
    previous(): Promise<void>;
    testPair(a: PluginRef, b: PluginRef): Promise<void>;
    observe(note: string, result: 'fails' | 'passes' | 'unknown'): Promise<void>;
    finish(): Promise<void>;
    exportReports(): Promise<{ markdown: string; json: string }>;
    advanced(enable: boolean): Promise<void>;
    configureAdvanced?(option: string, value: unknown): Promise<void>;
    cancelRunningTask?(): Promise<void>;
    resume?(): Promise<void>;
    advancedCapabilities?(): AdvancedCapability[];
    dispose(): void;
}

/**
 * Pure filter function for EffectivePlugin list.
 * Evaluates kind, tag membership, group assignment, and substring search on name/ID.
 */
export function filterPlugins(
    plugins: EffectivePlugin[],
    criteria: FilterCriteria
): EffectivePlugin[] {
    const search = criteria.search ? criteria.search.trim().toLowerCase() : '';
    const kind = criteria.kind || 'all';
    const tag = criteria.tag || 'all';
    const group = criteria.group || 'all';

    return plugins.filter((plugin) => {
        // Kind filter
        if (kind !== 'all' && plugin.ref.kind !== kind) {
            return false;
        }

        // Tag filter
        if (tag !== 'all') {
            if (!plugin.tags || !plugin.tags.includes(tag)) {
                return false;
            }
        }

        // Group filter
        if (group !== 'all') {
            if (plugin.group !== group) {
                return false;
            }
        }

        // Search filter (matches name or ID case-insensitively)
        if (search) {
            const matchesName = plugin.name ? plugin.name.toLowerCase().includes(search) : false;
            const matchesId = plugin.ref.id ? plugin.ref.id.toLowerCase().includes(search) : false;
            if (!matchesName && !matchesId) {
                return false;
            }
        }

        return true;
    });
}

/**
 * AIgility Plugin Manager UI Class.
 * Adheres strictly to CONTRACT.md and SPEC.md.
 */
export class ManagerUI {
    public plugin: any;
    public runtime: ManagerRuntime;
    public github: GithubManager;
    public debug: DebugManager;

    private originalCommunityDisplay: ((...args: any[]) => any) | null = null;
    private wrappedCommunityDisplay: ((...args: any[]) => any) | null = null;
    private originalSettingOpen: ((...args: any[]) => any) | null = null;
    private wrappedSettingOpen: ((...args: any[]) => any) | null = null;
    private communityTab: any = null;
    private installedContainerEl: HTMLElement | null = null;
    private installedDiagnosticEl: HTMLElement | null = null;
    private sidebarControlsEl: HTMLElement | null = null;
    private hiddenNativeElements: Array<{
        el: HTMLElement;
        display: string;
        priority: string;
    }> = [];
    private sidebarTabSnapshots: Array<{
        el: HTMLElement;
        display: string;
        priority: string;
    }> = [];
    private isInstalled: boolean = false;

    // Daily compact list filter criteria
    public filterCriteria: FilterCriteria = {
        search: '',
        kind: 'all',
        tag: 'all',
        group: 'all'
    };

    // Sidebar plugin setting filter criteria
    public sidebarFilterCriteria: FilterCriteria = {
        search: '',
        tag: 'all',
        group: 'all'
    };

    constructor(
        plugin: any,
        runtime: ManagerRuntime,
        github: GithubManager,
        debug: DebugManager
    ) {
        this.plugin = plugin;
        this.runtime = runtime;
        this.github = github;
        this.debug = debug;
    }

    /**
     * Installs UI hooks:
     * - Hooks Obsidian Settings open
     * - Wraps Community Plugins display to replace installed list area
     * - Injects Opciones button and search/tag/group filter in sidebar
     */
    public install(): void {
        if (this.isInstalled) return;
        this.isInstalled = true;

        try {
            const setting = this.plugin?.app?.setting;
            if (setting) {
                // Hook app.setting.open if not already hooked
                if (!this.originalSettingOpen && typeof setting.open === 'function') {
                    const originalOpen = setting.open;
                    this.originalSettingOpen = originalOpen;
                    this.wrappedSettingOpen = (...args: any[]) => {
                        const result = originalOpen.apply(setting, args);
                        if (this.isInstalled) this.reconcileSettingsUI();
                        return result;
                    };
                    setting.open = this.wrappedSettingOpen;
                }

                // Wrap Community Plugins tab display
                this.wrapCommunityTab(setting);

                // Reconcile sidebar if settings dialog is currently open
                this.reconcileSettingsUI();
            }
        } catch (error) {
            console.error('[AIgility UI] Error during install:', error);
            this.showNotice('Error al inicializar la interfaz de AIgility: ' + (error as Error).message);
        }
    }

    /**
     * Unloads UI hooks and restores original DOM and display methods.
     */
    public dispose(): void {
        if (!this.isInstalled) return;
        this.isInstalled = false;

        try {
            // Restore Community tab display
            if (
                this.communityTab &&
                this.originalCommunityDisplay &&
                this.communityTab.display === this.wrappedCommunityDisplay
            ) {
                this.communityTab.display = this.originalCommunityDisplay;
            }
            this.originalCommunityDisplay = null;
            this.wrappedCommunityDisplay = null;

            // Restore hidden native elements in community tab
            this.restoreHiddenNativeElements();

            // Remove custom installed list container
            this.removeInstalledContainer();
            this.removeInstalledDiagnostic();

            // Remove sidebar controls
            if (this.sidebarControlsEl && this.sidebarControlsEl.parentElement) {
                this.sidebarControlsEl.parentElement.removeChild(this.sidebarControlsEl);
                this.sidebarControlsEl = null;
            }

            // Restore app.setting.open
            const setting = this.plugin?.app?.setting;
            if (setting && this.originalSettingOpen && setting.open === this.wrappedSettingOpen) {
                setting.open = this.originalSettingOpen;
            }
            this.originalSettingOpen = null;
            this.wrappedSettingOpen = null;

            // Restore visibility of any filtered plugin tabs in sidebar
            this.restoreSidebarTabs(setting);
        } catch (error) {
            console.error('[AIgility UI] Error during dispose:', error);
        }
    }

    /**
     * Wraps the community-plugins tab display function.
     */
    private wrapCommunityTab(setting: any): void {
        if (!setting || !Array.isArray(setting.settingTabs)) return;

        const tab = setting.settingTabs.find((t: any) => t && t.id === 'community-plugins');
        if (!tab) return;

        this.communityTab = tab;
        if (!this.originalCommunityDisplay && typeof tab.display === 'function') {
            const originalDisplay = tab.display;
            this.originalCommunityDisplay = originalDisplay;
            this.wrappedCommunityDisplay = (...args: any[]) => {
                if (!this.isInstalled) return originalDisplay.apply(tab, args);
                this.restoreHiddenNativeElements();
                this.removeInstalledContainer();
                // Call native display first to ensure restricted mode and browse buttons are rendered
                originalDisplay.apply(tab, args);
                // Replace installed list section only
                this.patchCommunityInstalledArea(tab.containerEl, tab);
            };
            tab.display = this.wrappedCommunityDisplay;
        }
    }

    /**
     * Reconciles Settings UI whenever settings opens or tab changes.
     */
    public reconcileSettingsUI(): void {
        const setting = this.plugin?.app?.setting;
        if (!setting) return;

        this.wrapCommunityTab(setting);

        // If community-plugins tab is currently active, patch installed area
        if (setting.activeTab && setting.activeTab.id === 'community-plugins' && setting.activeTab.containerEl) {
            this.patchCommunityInstalledArea(setting.activeTab.containerEl, setting.activeTab);
        }

        // Patch sidebar headers and filter controls
        this.patchSidebar(setting);
    }

    /**
     * Patches the Community Plugins tab container:
     * Keeps Restricted mode and Browse button intact; hides native installed list and mounts ManagerUI.
     */
    private patchCommunityInstalledArea(containerEl: HTMLElement, tab: any): void {
        if (!containerEl) return;

        this.restoreHiddenNativeElements();
        this.removeInstalledContainer();
        this.removeInstalledDiagnostic();

        const installedGroup = Array.isArray(tab?.renderedItems)
            ? tab.renderedItems.find((item: any) =>
                item?.type === 'list' &&
                ['Installed plugins', 'Plugins instalados'].includes(item?.def?.heading)
            )
            : null;
        const groupEl = installedGroup?.groupEl;

        if (!groupEl || typeof groupEl !== 'object' || !groupEl.style) {
            this.showInstalledAreaDiagnostic(containerEl);
            return;
        }

        const style = groupEl.style as CSSStyleDeclaration;
        this.hiddenNativeElements.push({
            el: groupEl,
            display: typeof style.getPropertyValue === 'function'
                ? style.getPropertyValue('display')
                : (style.display || ''),
            priority: typeof style.getPropertyPriority === 'function'
                ? style.getPropertyPriority('display')
                : ''
        });
        style.display = 'none';

        // Create our mounted container
        this.installedContainerEl = document.createElement('div');
        this.installedContainerEl.className = 'aigility-manager-installed-container';
        containerEl.appendChild(this.installedContainerEl);

        // Render ManagerUI in this container
        this.display(this.installedContainerEl);
    }

    private removeInstalledContainer(): void {
        if (this.installedContainerEl?.parentElement) {
            this.installedContainerEl.parentElement.removeChild(this.installedContainerEl);
        }
        this.installedContainerEl = null;
    }

    private restoreHiddenNativeElements(): void {
        for (const snapshot of this.hiddenNativeElements) {
            const style = snapshot.el?.style as CSSStyleDeclaration | undefined;
            if (
                !style ||
                style.display !== 'none' ||
                (typeof style.getPropertyPriority === 'function' && style.getPropertyPriority('display') !== '')
            ) continue;
            if (typeof style.setProperty === 'function') {
                if (snapshot.display) style.setProperty('display', snapshot.display, snapshot.priority);
                else style.removeProperty('display');
            } else {
                style.display = snapshot.display;
            }
        }
        this.hiddenNativeElements = [];
    }

    private showInstalledAreaDiagnostic(containerEl: HTMLElement): void {
        const diagnostic = document.createElement('div');
        diagnostic.className = 'aigility-ui-diagnostic';
        diagnostic.setAttribute('role', 'status');
        diagnostic.textContent = 'AIgility no pudo identificar el grupo nativo de plugins instalados. Se conserva la lista de Obsidian.';
        containerEl.appendChild(diagnostic);
        this.installedDiagnosticEl = diagnostic;
    }

    private removeInstalledDiagnostic(): void {
        if (this.installedDiagnosticEl?.parentElement) {
            this.installedDiagnosticEl.parentElement.removeChild(this.installedDiagnosticEl);
        }
        this.installedDiagnosticEl = null;
    }

    /**
     * Injects Opciones button and search/tag/group filter fields into the sidebar
     * communityPluginTabContainer header.
     */
    private patchSidebar(setting: any): void {
        if (!setting) return;

        // Locate sidebar container for community plugin tabs
        // Obsidian setting has communityPluginTabContainer or tabHeadersEl
        const container =
            setting.communityPluginTabContainer ||
            setting.tabHeadersEl?.querySelector('.vertical-tab-header-group:last-child') ||
            setting.tabHeadersEl;

        if (!container) return;

        // Ensure we don't inject multiple times
        if (this.sidebarControlsEl && this.sidebarControlsEl.parentElement === container) {
            return;
        }

        if (this.sidebarControlsEl && this.sidebarControlsEl.parentElement) {
            this.sidebarControlsEl.parentElement.removeChild(this.sidebarControlsEl);
        }

        this.sidebarControlsEl = document.createElement('div');
        this.sidebarControlsEl.className = 'aigility-sidebar-header-controls';

        // Opciones button
        const topRow = document.createElement('div');
        topRow.className = 'aigility-sidebar-top-row';

        const optionsBtn = document.createElement('button');
        optionsBtn.className = 'mod-cta aigility-options-btn';
        optionsBtn.textContent = '⚙️ Opciones Gestor';
        optionsBtn.title = 'Abrir configuración de perfiles, diferidos, fixtures y GitHub';
        optionsBtn.onclick = (e) => {
            e.preventDefault();
            this.openOptionsModal();
        };
        topRow.appendChild(optionsBtn);
        this.sidebarControlsEl.appendChild(topRow);

        // Sidebar filters row
        const filterRow = document.createElement('div');
        filterRow.className = 'aigility-sidebar-filters';

        // Search input
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'aigility-sidebar-search';
        searchInput.placeholder = 'Filtrar plugins...';
        searchInput.value = this.sidebarFilterCriteria.search || '';
        searchInput.oninput = () => {
            this.sidebarFilterCriteria.search = searchInput.value;
            this.applySidebarFilter(setting);
        };
        filterRow.appendChild(searchInput);

        // Tag dropdown
        const tagSelect = document.createElement('select');
        tagSelect.className = 'dropdown aigility-sidebar-tag-select';
        const defaultTagOpt = document.createElement('option');
        defaultTagOpt.value = 'all';
        defaultTagOpt.textContent = 'Tag: Todas';
        tagSelect.appendChild(defaultTagOpt);

        const tags = this.runtime.state?.tags || [];
        for (const tag of tags) {
            const opt = document.createElement('option');
            opt.value = tag.id;
            opt.textContent = tag.name;
            tagSelect.appendChild(opt);
        }
        tagSelect.value = this.sidebarFilterCriteria.tag || 'all';
        tagSelect.onchange = () => {
            this.sidebarFilterCriteria.tag = tagSelect.value;
            this.applySidebarFilter(setting);
        };
        filterRow.appendChild(tagSelect);

        // Group dropdown
        const groupSelect = document.createElement('select');
        groupSelect.className = 'dropdown aigility-sidebar-group-select';
        const defaultGroupOpt = document.createElement('option');
        defaultGroupOpt.value = 'all';
        defaultGroupOpt.textContent = 'Grupo: Todos';
        groupSelect.appendChild(defaultGroupOpt);

        const groups = this.runtime.state?.groups || [];
        for (const group of groups) {
            const opt = document.createElement('option');
            opt.value = group.id;
            opt.textContent = group.name;
            groupSelect.appendChild(opt);
        }
        groupSelect.value = this.sidebarFilterCriteria.group || 'all';
        groupSelect.onchange = () => {
            this.sidebarFilterCriteria.group = groupSelect.value;
            this.applySidebarFilter(setting);
        };
        filterRow.appendChild(groupSelect);

        this.sidebarControlsEl.appendChild(filterRow);

        // Insert at beginning of container
        if (container.firstChild) {
            container.insertBefore(this.sidebarControlsEl, container.firstChild);
        } else {
            container.appendChild(this.sidebarControlsEl);
        }

        // Initial filter application
        this.applySidebarFilter(setting);
    }

    /**
     * Resolves the canonical PluginRef kind of a settings tab found in
     * setting.pluginTabs (host 1.14.3 includes CORE and community tabs there).
     * Canonical records decide first; the app.internalPlugins.plugins registry
     * identifies core tabs that have no local record yet.
     */
    private resolveSidebarTabKind(tab: any): 'community' | 'core' {
        const pluginId = String(tab?.id || tab?.plugin?.manifest?.id || '');
        const records = this.runtime.state?.records;
        if (records && Object.prototype.hasOwnProperty.call(records, `core:${pluginId}`)) {
            return 'core';
        }
        if (records && Object.prototype.hasOwnProperty.call(records, `community:${pluginId}`)) {
            return 'community';
        }
        const internalPlugins = this.plugin?.app?.internalPlugins?.plugins;
        if (internalPlugins && Object.prototype.hasOwnProperty.call(internalPlugins, pluginId)) {
            return 'core';
        }
        return 'community';
    }

    private sidebarTabRecord(tab: any, kind: 'community' | 'core'): PluginRecord | undefined {
        const pluginId = String(tab?.id || tab?.plugin?.manifest?.id || '');
        return this.runtime.state?.records?.[`${kind}:${pluginId}`];
    }

    /**
     * Filters plugin tabs of BOTH kinds by name/ID/tag/group. Only each tab's
     * nav element visibility is touched; the nine general categories in
     * setting.settingTabs stay accessible.
     */
    public applySidebarFilter(setting: any): void {
        if (!setting || !Array.isArray(setting.pluginTabs)) return;

        const { search, tag, group } = this.sidebarFilterCriteria;
        const normalizedSearch = search ? search.trim().toLowerCase() : '';

        for (const tab of setting.pluginTabs) {
            const kind = this.resolveSidebarTabKind(tab);
            const pluginId = String(tab?.id || tab?.plugin?.manifest?.id || '');
            const record = this.sidebarTabRecord(tab, kind);
            const pluginName = String(tab?.name || tab?.plugin?.manifest?.name || record?.name || pluginId).toLowerCase();

            let matches = true;

            // Search filter (name or ID)
            if (normalizedSearch) {
                if (!pluginName.includes(normalizedSearch) && !pluginId.toLowerCase().includes(normalizedSearch)) {
                    matches = false;
                }
            }

            // Tag filter (both kinds)
            if (matches && tag && tag !== 'all') {
                if (!record || !Array.isArray(record.tags) || !record.tags.includes(tag)) {
                    matches = false;
                }
            }

            // Group filter (both kinds)
            if (matches && group && group !== 'all') {
                if (!record || record.group !== group) {
                    matches = false;
                }
            }

            this.applySidebarTabVisibility(tab, matches);
        }
    }

    /**
     * Applies one tab's visibility through an owned snapshot. Hiding records
     * the previous inline display and stores our postimage; showing or
     * restoring only reverts the element while it still carries our postimage
     * (`display: none`), so later manual DOM changes always win.
     */
    private applySidebarTabVisibility(tab: any, matches: boolean): void {
        const navEl = tab?.navEl;
        if (!navEl || !navEl.style) return;

        const style = navEl.style as CSSStyleDeclaration;
        const snapshotIndex = this.sidebarTabSnapshots.findIndex((s) => s.el === navEl);

        if (matches) {
            if (snapshotIndex !== -1) {
                const snapshot = this.sidebarTabSnapshots[snapshotIndex];
                if (style.display === 'none') {
                    if (typeof style.setProperty === 'function') {
                        if (snapshot.display) style.setProperty('display', snapshot.display, snapshot.priority);
                        else style.removeProperty('display');
                    } else {
                        style.display = snapshot.display;
                    }
                }
                this.sidebarTabSnapshots.splice(snapshotIndex, 1);
            } else if (style.display !== 'none') {
                style.display = '';
            }
            return;
        }

        if (snapshotIndex !== -1) return; // already hidden by us
        if (style.display === 'none') return; // hidden by someone else; we do not own it
        this.sidebarTabSnapshots.push({
            el: navEl,
            display: typeof style.getPropertyValue === 'function'
                ? style.getPropertyValue('display')
                : (style.display || ''),
            priority: typeof style.getPropertyPriority === 'function'
                ? style.getPropertyPriority('display')
                : ''
        });
        style.display = 'none';
    }

    /**
     * Restores visibility of only the tabs this UI hid, and only while they
     * still carry our owned postimage.
     */
    private restoreSidebarTabs(setting: any): void {
        for (const snapshot of this.sidebarTabSnapshots) {
            const style = snapshot.el?.style as CSSStyleDeclaration | undefined;
            if (!style || style.display !== 'none') continue;
            if (typeof style.setProperty === 'function') {
                if (snapshot.display) style.setProperty('display', snapshot.display, snapshot.priority);
                else style.removeProperty('display');
            } else {
                style.display = snapshot.display;
            }
        }
        this.sidebarTabSnapshots = [];
    }

    /**
     * Displays the primary compact list view in containerEl.
     */
    public display(containerEl: HTMLElement): void {
        if (!containerEl) return;
        containerEl.empty?.();
        while (containerEl.firstChild) {
            containerEl.removeChild(containerEl.firstChild);
        }

        const root = document.createElement('div');
        root.className = 'aigility-manager-root';

        // 1. Recovery / Conflict persistent banner
        this.renderRecoveryBanner(root);

        // 2. Compact daily toolbar (Kind selector, search, tag/group dropdowns, options & undo)
        this.renderDailyToolbar(root);

        // 3. Plugin list container
        const listContainer = document.createElement('div');
        listContainer.className = 'aigility-plugin-list';
        root.appendChild(listContainer);

        this.renderPluginRows(listContainer);

        containerEl.appendChild(root);
    }

    /**
     * Renders persistent banner if recoveryReason or operationPending is active.
     */
    private renderRecoveryBanner(containerEl: HTMLElement): void {
        const local = this.runtime.local;
        if (!local || (!local.recoveryReason && !local.operationPending)) {
            return;
        }

        const banner = document.createElement('div');
        banner.className = 'aigility-recovery-banner mod-warning';

        const textSpan = document.createElement('span');
        const reason = local.recoveryReason || local.operationPending || 'Operación en curso';
        textSpan.textContent = `⚠️ Automatizaciones pausadas: ${reason}`;
        banner.appendChild(textSpan);

        const actions = document.createElement('div');
        actions.className = 'aigility-banner-actions';

        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'mod-cta';
        resumeBtn.textContent = 'Reanudar';
        resumeBtn.onclick = async () => {
            try {
                await this.runtime.resume();
                this.showNotice('Automatizaciones reanudadas');
                this.display(this.installedContainerEl || containerEl);
            } catch (err) {
                this.showNotice('Error al reanudar: ' + (err as Error).message);
            }
        };
        actions.appendChild(resumeBtn);

        banner.appendChild(actions);
        containerEl.appendChild(banner);
    }

    /**
     * Renders top daily toolbar with controls:
     * - Selector: All / Community / Core
     * - Search by name / ID
     * - Tag dropdown
     * - Group dropdown
     * - Opciones button
     * - Deshacer perfil button
     */
    private renderDailyToolbar(containerEl: HTMLElement): void {
        const toolbar = document.createElement('div');
        toolbar.className = 'aigility-toolbar';

        // Kind selector
        const kindSelect = document.createElement('select');
        kindSelect.className = 'dropdown aigility-kind-select';
        kindSelect.innerHTML = `
            <option value="all">Todos los tipos</option>
            <option value="community">Community</option>
            <option value="core">Core</option>
        `;
        kindSelect.value = this.filterCriteria.kind || 'all';
        kindSelect.onchange = () => {
            this.filterCriteria.kind = kindSelect.value as 'all' | 'community' | 'core';
            this.refreshList();
        };
        toolbar.appendChild(kindSelect);

        // Search input
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'aigility-search-input';
        searchInput.placeholder = 'Buscar por nombre o ID...';
        searchInput.value = this.filterCriteria.search || '';
        searchInput.oninput = () => {
            this.filterCriteria.search = searchInput.value;
            this.refreshList();
        };
        toolbar.appendChild(searchInput);

        // Tag select
        const tagSelect = document.createElement('select');
        tagSelect.className = 'dropdown aigility-tag-select';
        const defaultTagOpt = document.createElement('option');
        defaultTagOpt.value = 'all';
        defaultTagOpt.textContent = 'Todas las tags';
        tagSelect.appendChild(defaultTagOpt);

        const tags = this.runtime.state?.tags || [];
        for (const tag of tags) {
            const opt = document.createElement('option');
            opt.value = tag.id;
            opt.textContent = tag.name;
            tagSelect.appendChild(opt);
        }
        tagSelect.value = this.filterCriteria.tag || 'all';
        tagSelect.onchange = () => {
            this.filterCriteria.tag = tagSelect.value;
            this.refreshList();
        };
        toolbar.appendChild(tagSelect);

        // Group select
        const groupSelect = document.createElement('select');
        groupSelect.className = 'dropdown aigility-group-select';
        const defaultGroupOpt = document.createElement('option');
        defaultGroupOpt.value = 'all';
        defaultGroupOpt.textContent = 'Todos los grupos';
        groupSelect.appendChild(defaultGroupOpt);

        const groups = this.runtime.state?.groups || [];
        for (const group of groups) {
            const opt = document.createElement('option');
            opt.value = group.id;
            opt.textContent = group.name;
            groupSelect.appendChild(opt);
        }
        groupSelect.value = this.filterCriteria.group || 'all';
        groupSelect.onchange = () => {
            this.filterCriteria.group = groupSelect.value;
            this.refreshList();
        };
        toolbar.appendChild(groupSelect);

        // Options Button
        const optionsBtn = document.createElement('button');
        optionsBtn.className = 'mod-cta aigility-toolbar-options-btn';
        optionsBtn.textContent = 'Opciones';
        optionsBtn.onclick = () => this.openOptionsModal();
        toolbar.appendChild(optionsBtn);

        // Undo Profile Button
        if (this.runtime.state?.undo) {
            const undoBtn = document.createElement('button');
            undoBtn.className = 'aigility-undo-btn';
            undoBtn.textContent = 'Deshacer perfil';
            undoBtn.onclick = async () => {
                try {
                    await this.runtime.undoProfile();
                    this.showNotice('Perfil deshecho con éxito');
                    this.refreshList();
                } catch (err) {
                    this.showNotice('Error al deshacer: ' + (err as Error).message);
                }
            };
            toolbar.appendChild(undoBtn);
        }

        containerEl.appendChild(toolbar);
    }

    /**
     * Refreshes the list container while preserving search focus.
     */
    private refreshList(): void {
        const root = this.installedContainerEl?.querySelector('.aigility-manager-root');
        if (!root) return;
        const listContainer = root.querySelector('.aigility-plugin-list') as HTMLElement;
        if (listContainer) {
            this.renderPluginRows(listContainer);
        }
    }

    /**
     * Renders rows for the filtered plugins.
     */
    private renderPluginRows(listContainer: HTMLElement): void {
        listContainer.innerHTML = '';

        let allPlugins: EffectivePlugin[] = [];
        try {
            allPlugins = this.runtime.list();
        } catch (err) {
            console.error('[AIgility UI] runtime.list() failed:', err);
            const errDiv = document.createElement('div');
            errDiv.className = 'aigility-error-text';
            errDiv.textContent = 'Error al obtener la lista de plugins: ' + (err as Error).message;
            listContainer.appendChild(errDiv);
            return;
        }

        const filtered = filterPlugins(allPlugins.filter((plugin) => plugin.installed && !plugin.archived), this.filterCriteria);

        // Summary count
        const countRow = document.createElement('div');
        countRow.className = 'aigility-count-row';
        countRow.textContent = `Mostrando ${filtered.length} de ${allPlugins.length} plugins`;
        listContainer.appendChild(countRow);

        if (filtered.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'aigility-empty-state';
            emptyEl.textContent = 'No se encontraron plugins con los filtros seleccionados.';
            listContainer.appendChild(emptyEl);
            return;
        }

        for (const plugin of filtered) {
            const row = this.createPluginRow(plugin);
            listContainer.appendChild(row);
        }
    }

    /**
     * Creates a compact plugin row with distinction icons, badges, toggle switch,
     * settings shortcut, and context menu.
     */
    private createPluginRow(plugin: EffectivePlugin): HTMLElement {
        const row = document.createElement('div');
        row.className = `aigility-plugin-row kind-${plugin.ref.kind}`;

        // Left info container
        const leftEl = document.createElement('div');
        leftEl.className = 'aigility-plugin-info';

        // Title and version
        const titleRow = document.createElement('div');
        titleRow.className = 'aigility-plugin-title-row';

        const nameEl = document.createElement('span');
        nameEl.className = 'aigility-plugin-name';
        nameEl.textContent = plugin.name || plugin.ref.id;
        titleRow.appendChild(nameEl);

        const versionEl = document.createElement('span');
        versionEl.className = 'aigility-plugin-version';
        versionEl.textContent = plugin.version ? `v${plugin.version}` : '';
        titleRow.appendChild(versionEl);

        // Kind badge
        const kindBadge = document.createElement('span');
        kindBadge.className = `aigility-badge aigility-badge-${plugin.ref.kind}`;
        kindBadge.textContent = plugin.ref.kind.toUpperCase();
        titleRow.appendChild(kindBadge);

        leftEl.appendChild(titleRow);

        // Badges: tags, group, scheduled
        const badgesRow = document.createElement('div');
        badgesRow.className = 'aigility-plugin-badges';

        if (plugin.group) {
            const groupBadge = document.createElement('span');
            groupBadge.className = 'aigility-group-badge';
            groupBadge.textContent = `📁 ${plugin.group}`;
            badgesRow.appendChild(groupBadge);
        }

        if (Array.isArray(plugin.tags) && plugin.tags.length > 0) {
            for (const tagId of plugin.tags) {
                const tagObj = this.runtime.state?.tags?.find((t) => t.id === tagId);
                const tagBadge = document.createElement('span');
                tagBadge.className = 'aigility-tag-badge';
                tagBadge.textContent = `#${tagObj ? tagObj.name : tagId}`;
                if (tagObj?.color) {
                    tagBadge.style.borderColor = tagObj.color;
                    tagBadge.style.color = tagObj.color;
                }
                badgesRow.appendChild(tagBadge);
            }
        }

        if (plugin.scheduled) {
            const schedBadge = document.createElement('span');
            schedBadge.className = 'aigility-badge aigility-badge-scheduled';
            schedBadge.textContent = '⏳ Diferido';
            schedBadge.title = 'Programado para carga diferida';
            badgesRow.appendChild(schedBadge);
        }

        leftEl.appendChild(badgesRow);
        row.appendChild(leftEl);

        // Middle: Distinction Icons (Wanted / Native / Loaded)
        const iconsEl = document.createElement('div');
        iconsEl.className = 'aigility-distinction-icons';

        // 1. Wanted / Desired status
        const wantedIcon = document.createElement('span');
        wantedIcon.className = `aigility-icon-indicator ${plugin.desired ? 'is-active' : 'is-inactive'}`;
        wantedIcon.textContent = plugin.desired ? '🎯' : '⭕';
        wantedIcon.title = plugin.desired
            ? 'Deseado: Activo en configuración del gestor'
            : 'No deseado: Inactivo en configuración del gestor';
        iconsEl.appendChild(wantedIcon);

        // 2. Native autostart status
        const nativeIcon = document.createElement('span');
        nativeIcon.className = `aigility-icon-indicator ${plugin.nativeAutostart ? 'is-active' : 'is-inactive'}`;
        nativeIcon.textContent = plugin.nativeAutostart ? '⚡' : '💤';
        nativeIcon.title = plugin.nativeAutostart
            ? 'Autostart nativo: Habilitado en el inicio de Obsidian'
            : 'Autostart nativo: Deshabilitado en el inicio de Obsidian';
        iconsEl.appendChild(nativeIcon);

        // 3. Loaded in memory status
        const loadedIcon = document.createElement('span');
        loadedIcon.className = `aigility-icon-indicator ${plugin.loaded ? 'is-active' : 'is-inactive'}`;
        loadedIcon.textContent = plugin.loaded ? '🟢' : '⚪';
        loadedIcon.title = plugin.loaded
            ? 'Cargado: Activo en memoria'
            : 'No cargado: Inactivo en memoria';
        iconsEl.appendChild(loadedIcon);

        row.appendChild(iconsEl);

        // Right side: Toggle Switch + Action buttons
        const actionsEl = document.createElement('div');
        actionsEl.className = 'aigility-plugin-actions';

        // Switch
        const switchLabel = document.createElement('label');
        switchLabel.className = 'checkbox-container aigility-switch';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(plugin.loaded);
        checkbox.onchange = async () => {
            const newWanted = checkbox.checked;
            try {
                await this.runtime.setEnabled(plugin.ref, newWanted);
                this.refreshList();
            } catch (err) {
                checkbox.checked = !newWanted;
                this.showNotice('Error al cambiar estado: ' + (err as Error).message);
            }
        };
        switchLabel.appendChild(checkbox);
        actionsEl.appendChild(switchLabel);

        // Settings gear button (if community and has setting tab)
        if (plugin.ref.kind === 'community') {
            const settingTab = this.plugin?.app?.setting?.pluginTabs?.find(
                (t: any) =>
                    (t.id === plugin.ref.id || t.plugin?.manifest?.id === plugin.ref.id) &&
                    this.resolveSidebarTabKind(t) === 'community'
            );
            if (settingTab) {
                const gearBtn = document.createElement('button');
                gearBtn.className = 'clickable-icon aigility-gear-btn';
                gearBtn.innerHTML = '⚙️';
                gearBtn.title = 'Abrir ajustes del plugin';
                gearBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.plugin.app.setting.openTabById(settingTab.id || plugin.ref.id);
                };
                actionsEl.appendChild(gearBtn);
            }
        }

        // Context Menu button (vertical dots)
        const menuBtn = document.createElement('button');
        menuBtn.className = 'clickable-icon aigility-more-btn';
        menuBtn.innerHTML = '⋮';
        menuBtn.title = 'Más acciones';
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            this.openPluginMenu(e, plugin);
        };
        actionsEl.appendChild(menuBtn);

        row.appendChild(actionsEl);

        return row;
    }

    /**
     * Context Menu for a plugin:
     * - Edit tags
     * - Assign group
     * - Configure deferred loading
     * - GitHub releases / Pin version / Rollback
     */
    private openPluginMenu(event: MouseEvent, plugin: EffectivePlugin): void {
        const menu = new Menu();

        // 1. Tags
        menu.addItem((item) => {
            item.setTitle('🏷️ Editar etiquetas...')
                .onClick(() => {
                    new TagMembershipModal(this.plugin.app, this, plugin).open();
                });
        });

        // 2. Group
        menu.addItem((item) => {
            item.setTitle('📁 Cambiar grupo...')
                .onClick(() => {
                    this.promptChangeGroup(plugin);
                });
        });

        // 3. Deferred
        menu.addItem((item) => {
            item.setTitle('⏳ Configurar carga diferida...')
                .onClick(() => {
                    new DeferredConfigModal(this.plugin.app, this, plugin).open();
                });
        });

        // 4. GitHub actions (community plugins only)
        if (plugin.ref.kind === 'community') {
            menu.addItem((item) => {
                item.setTitle('🐙 Ver releases de GitHub...')
                    .onClick(() => {
                        new GitHubReleasesModal(this.plugin.app, this, plugin).open();
                    });
            });

            menu.addItem((item) => {
                item.setTitle('📌 Fijar versión (Pin)...')
                    .onClick(() => {
                        this.promptPinVersion(plugin);
                    });
            });

            menu.addItem((item) => {
                item.setTitle('⏪ Revertir versión (Rollback)...')
                    .onClick(async () => {
                        try {
                            await this.github.rollback(plugin.ref.id);
                            this.showNotice(`Rollback ejecutado para ${plugin.name}`);
                            this.refreshList();
                        } catch (err) {
                            this.showNotice('Error en rollback: ' + (err as Error).message);
                        }
                    });
            });
        }

        menu.showAtMouseEvent(event);
    }

    private promptChangeGroup(plugin: EffectivePlugin): void {
        const modal = new Modal(this.plugin.app);
        modal.titleEl.setText(`Asignar grupo a ${plugin.name}`);
        const content = modal.contentEl;

        const groups = this.runtime.state?.groups || [];
        let selected = plugin.group || '';

        new Setting(content)
            .setName('Grupo')
            .setDesc('Selecciona el grupo organizativo para este plugin')
            .addDropdown((dropdown) => {
                dropdown.addOption('', 'Ninguno');
                for (const g of groups) {
                    dropdown.addOption(g.id, g.name);
                }
                dropdown.setValue(selected);
                dropdown.onChange((val) => {
                    selected = val;
                });
            });

        new Setting(content)
            .addButton((btn) => {
                btn.setButtonText('Guardar')
                    .setCta()
                    .onClick(async () => {
                        modal.close();
                        try {
                            await this.runtime.setGroup(plugin.ref, selected);
                            this.showNotice(`Grupo actualizado para ${plugin.name}`);
                            this.refreshList();
                        } catch (err) {
                            this.showNotice('Error al actualizar grupo: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => {
                btn.setButtonText('Cancelar').onClick(() => modal.close());
            });

        modal.open();
    }

    private promptPinVersion(plugin: EffectivePlugin): void {
        const modal = new Modal(this.plugin.app);
        modal.titleEl.setText(`Fijar versión de ${plugin.name}`);
        const content = modal.contentEl;

        let version = plugin.version || '';

        new Setting(content)
            .setName('Versión a fijar')
            .setDesc(`Versión instalada actual: ${plugin.installed && plugin.version ? plugin.version : 'desconocida'}. Introduce la versión a fijar, o déjalo vacío para desfijar.`)
            .addText((text) => {
                text.setValue(version);
                text.onChange((val) => {
                    version = val.trim();
                });
            });

        new Setting(content)
            .addButton((btn) => {
                btn.setButtonText('Guardar')
                    .setCta()
                    .onClick(async () => {
                        modal.close();
                        try {
                            await this.github.setPin(plugin.ref.id, version || undefined);
                            this.showNotice(`Versión fijada para ${plugin.name}`);
                        } catch (err) {
                            this.showNotice('Error al fijar versión: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => {
                btn.setButtonText('Cancelar').onClick(() => modal.close());
            });

        modal.open();
    }

    public openOptionsModal(): void {
        new ManagerOptionsModal(this.plugin.app, this).open();
    }

    public showNotice(msg: string): void {
        new Notice(msg, 5000);
    }

    /** Re-renders the mounted installed list; safe when the settings tab is closed. */
    public refreshManagerView(): void {
        if (this.installedContainerEl) this.display(this.installedContainerEl);
    }

    /**
     * The single write path for manager-state edits. The callback runs inside the
     * runtime serial queue against freshly refreshed state and must resolve its
     * target entity by stable id from THAT state, mutating only the requested
     * fields, so unrelated concurrent edits survive. save + writeEffectiveState
     * happen in the same transaction; public save() is never nested here.
     */
    public enqueueStateWrite(
        label: string,
        write: (state: State, tx: RuntimeTransaction) => void | Promise<void>
    ): Promise<void> {
        return this.runtime.enqueue(label, async (tx) => {
            const state = await tx.refresh();
            await write(state, tx);
            await tx.save();
            await tx.writeEffectiveState();
        });
    }

    /**
     * Deferred policy edits (save, delay, parked, disable, delete) go through the
     * queue and immediately cancel their pending loads by pausing the runtime
     * inside the queued mutation: pause invalidates every scheduled deferred
     * timer and surfaces a visible recovery reason, while native exclusions are
     * retained. Apply/Resume (Reanudar) recalculates scheduling from the edited
     * policy, so no stale timer can fire after the edit. Shared by the deferred
     * section and the per-plugin policy modal.
     */
    public enqueueDeferredPolicyWrite(
        label: string,
        write: (state: State, tx: RuntimeTransaction) => void | Promise<void>
    ): Promise<void> {
        return this.enqueueStateWrite(label, (state, tx) => {
            this.runtime.pause(`Política de carga diferida editada (${label}); cargas programadas canceladas. Pulsa Reanudar para recalcular.`);
            return write(state, tx);
        });
    }

    /**
     * Why an ENABLED deferred policy cannot be honoured for this reference, or
     * null when it can. The runtime enforces both rules (a core wrapper has no
     * nonpersistent activation path, and a protected plugin is never mutated), so
     * the UI refuses them BEFORE any host call instead of letting the request
     * fail half-applied. Disabling an already-invalid policy stays allowed: that
     * is how the user resolves the conflict.
     */
    public deferredEnableRefusal(ref: PluginRef): string | null {
        if (ref.kind === 'core') {
            return `No se puede habilitar la carga diferida de ${ref.id}: los plugins core no tienen una activación no persistente, así que excluir su autoarranque lo desactivaría de forma permanente. Desactiva la política en lugar de habilitarla.`;
        }
        if (this.isSelfRef(ref)) {
            return `No se puede habilitar la carga diferida de ${ref.id}: es el propio gestor y su autoarranque está protegido.`;
        }
        const state = this.runtime.state;
        const protectedList = state?.protected ?? [];
        if (protectedList.includes(pluginRefKey(ref)) || protectedList.includes(ref.id)) {
            return `No se puede habilitar la carga diferida de ${ref.id}: está en la lista de protegidos y su autoarranque no se modifica.`;
        }
        return null;
    }

    /** The manager plugin always protects itself, even if the list is empty. */
    public isSelfRef(ref: PluginRef): boolean {
        const manifestId = typeof this.plugin?.manifest?.id === 'string' ? this.plugin.manifest.id : 'aigility-plugin-manager';
        return ref.id === manifestId || ref.id === 'aigility-plugin-manager';
    }

    /**
     * Applies a deferred-policy edit to ONE plugin inside a single queued slot,
     * in the only order the runtime honours:
     *
     * 1. validate(freshState, fresh) - conflict and refusal checks, before any
     *    mutation and before any host call.
     * 2. mutate(policy) - the requested fields land on the FRESH policy (the
     *    entry is created when absent) BEFORE the exclusion is requested.
     * 3. reconcileDeferred(ref) - only now, and for EVERY enabled policy, even
     *    when native autostart is already off: the exclusion also unloads the
     *    plugin while the runtime is paused, and reconcileDeferred() returns
     *    without touching the host when no enabled policy exists yet, which is
     *    why calling it first saved native=true together with a claimed deferment.
     *
     * A missing or failing helper reverts ONLY the fields this edit touched (or
     * removes the entry this edit created) and then throws: the transaction never
     * reaches tx.save(), so nothing partial is persisted and no success is faked.
     */
    public enqueueDeferredPolicyApply(
        label: string,
        ref: PluginRef,
        validate: (freshState: State, fresh: DeferredPolicy | null) => void,
        mutate: (policy: DeferredPolicy) => void
    ): Promise<void> {
        return this.enqueueDeferredPolicyWrite(label, async (freshState, tx) => {
            if (!Array.isArray(freshState.deferred)) freshState.deferred = [];
            const index = freshState.deferred.findIndex((candidate) => candidate.id === ref.id);
            const existing = index === -1 ? null : freshState.deferred[index];
            validate(freshState, existing);

            const previous = existing
                ? { enabled: existing.enabled, delayMs: existing.delayMs, parked: existing.parked }
                : null;
            const policy = existing ?? { id: ref.id, delayMs: 1000, enabled: false, parked: false };
            if (!existing) freshState.deferred.push(policy);
            mutate(policy);

            if (!policy.enabled) return;
            const revert = (): void => {
                if (previous) {
                    policy.enabled = previous.enabled;
                    policy.delayMs = previous.delayMs;
                    policy.parked = previous.parked;
                    return;
                }
                const created = freshState.deferred.indexOf(policy);
                if (created !== -1) freshState.deferred.splice(created, 1);
            };
            if (typeof tx.reconcileDeferred !== 'function') {
                revert();
                throw new Error(`No se puede configurar la carga diferida de ${ref.id}: el runtime no expone reconcileDeferred() para excluir su autoarranque nativo. La política no se guardó.`);
            }
            try {
                await tx.reconcileDeferred(ref);
            } catch (err) {
                revert();
                throw new Error(`No se pudo excluir el autoarranque nativo de ${ref.id}: ${(err as Error).message} La política no se guardó.`);
            }
        });
    }

    /** Restores a NEW-format backup: definitions only, nothing hot-applied. */
    public restoreManagerBackup(identity: BackupIdentity): Promise<void> {
        return this.enqueueStateWrite(`ui:backup-restore:${JSON.stringify(identity)}`, (state) => {
            const index = state.profileBackups.findIndex((entry) => sameBackupIdentity(entry, identity));
            if (index === -1) throw new Error('La copia de seguridad ya no existe en el estado actual.');
            const snapshot = state.profileBackups[index] as Partial<ManagerProfileBackup>;
            // Device profile definitions. deepClone only runs on verified arrays;
            // a backup without profiles never reaches JSON.parse(undefined).
            if (Array.isArray(snapshot.profiles)) state.deviceProfiles = deepClone(snapshot.profiles);
            if (Array.isArray(snapshot.fixtures)) {
                for (const fixture of deepClone(snapshot.fixtures)) {
                    const existing = state.fixtureProfiles.find((candidate) => candidate.id === fixture.id);
                    if (existing) {
                        existing.name = fixture.name;
                        existing.members = { ...fixture.members };
                    } else {
                        state.fixtureProfiles.push({ id: fixture.id, name: fixture.name, members: { ...fixture.members } });
                    }
                }
            }
            // Tag membership follows the same definitions-only rule: records are
            // updated in place and missing records are never resurrected.
            if (isObjectRecord(snapshot.tagMembership)) {
                for (const [pluginKey, membership] of Object.entries(snapshot.tagMembership)) {
                    const record = state.records[pluginKey];
                    if (!record || !isObjectRecord(membership)) continue;
                    if (Array.isArray(membership.tags)) record.tags = [...membership.tags];
                    if (typeof membership.group === 'string') record.group = membership.group;
                }
            }
        });
    }

    /**
     * Restores an imported Companion backup as explicit partial fixtures built
     * from its pluginStates. The original backup object is preserved exactly, no
     * device profile is replaced and nothing is applied automatically.
     */
    public restoreCompanionBackup(identity: BackupIdentity): Promise<string[]> {
        return this.enqueueStateWrite(`ui:backup-restore-companion:${JSON.stringify(identity)}`, (state) => {
            const entry = state.profileBackups.find((candidate) => sameBackupIdentity(candidate, identity));
            if (!entry) throw new Error('La copia importada ya no existe en el estado actual.');
            const plan = companionRestorePlan(entry);
            if (!plan) throw new Error('La copia importada no contiene estados de plugins utilizables (pluginStates); no se restauró nada.');
            for (const fixture of plan) {
                const existing = state.fixtureProfiles.find((candidate) => candidate.id === fixture.id);
                if (existing) {
                    existing.name = fixture.name;
                    existing.members = { ...fixture.members };
                    existing.metadata = { ...(existing.metadata ?? {}), ...fixture.metadata };
                } else {
                    state.fixtureProfiles.push({
                        id: fixture.id,
                        name: fixture.name,
                        members: { ...fixture.members },
                        metadata: { ...fixture.metadata },
                    });
                }
            }
        }).then(() => {
            const plan = companionRestorePlan(this.findBackupByIdentity(identity));
            return plan ? plan.map((fixture) => fixture.id) : [];
        });
    }

    private findBackupByIdentity(identity: BackupIdentity): unknown {
        return (this.runtime.state?.profileBackups ?? []).find((candidate) => sameBackupIdentity(candidate, identity));
    }
}

/**
 * Modal for Profile comparison (Before vs After) prior to applying a profile.
 * Displays concrete activation and deactivation changes for both Community and Core plugins.
 */
export class ProfileComparisonModal extends Modal {
    private changes: Change[];
    private onConfirm: () => Promise<void>;

    constructor(app: App, changes: Change[], onConfirm: () => Promise<void>) {
        super(app);
        this.changes = changes;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText('Comparación de Perfil (Antes y Después)');

        const desc = contentEl.createDiv({ cls: 'aigility-diff-desc' });
        desc.textContent =
            'Revisa los cambios que se aplicarán en plugins de comunidad y core. Confirma para ejecutar la transición.';

        const tableContainer = contentEl.createDiv({ cls: 'aigility-diff-table-container' });
        const table = tableContainer.createEl('table', { cls: 'aigility-diff-table' });

        const header = table.createEl('thead').createEl('tr');
        header.createEl('th', { text: 'Tipo' });
        header.createEl('th', { text: 'ID del Plugin' });
        header.createEl('th', { text: 'Estado Actual' });
        header.createEl('th', { text: 'Estado Nuevo' });
        header.createEl('th', { text: 'Motivo' });

        const tbody = table.createEl('tbody');

        if (this.changes.length === 0) {
            const tr = tbody.createEl('tr');
            const td = tr.createEl('td', { text: 'No hay cambios requeridos; el estado actual ya coincide con el perfil.' });
            td.colSpan = 5;
        } else {
            for (const change of this.changes) {
                const tr = tbody.createEl('tr', {
                    cls: change.after ? 'diff-row-enable' : 'diff-row-disable'
                });
                tr.createEl('td', { text: change.ref.kind });
                tr.createEl('td', { text: change.ref.id });
                tr.createEl('td', { text: change.before ? 'Activo' : 'Inactivo' });
                tr.createEl('td', { text: change.after ? 'Activo' : 'Inactivo' });
                tr.createEl('td', { text: change.reason || '-' });
            }
        }

        const actions = contentEl.createDiv({ cls: 'aigility-modal-actions' });
        const confirmBtn = actions.createEl('button', {
            cls: 'mod-cta',
            text: 'Confirmar y aplicar perfil'
        });
        confirmBtn.onclick = async () => {
            this.close();
            try {
                await this.onConfirm();
                new Notice('Perfil aplicado correctamente');
            } catch (err) {
                new Notice('Error al aplicar perfil: ' + (err as Error).message);
            }
        };

        const cancelBtn = actions.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();
    }
}

/**
 * Modal for editing plugin tag memberships.
 * Notice: Editing tags never auto-applies!
 */
export class TagMembershipModal extends Modal {
    private ui: ManagerUI;
    private pluginItem: EffectivePlugin;
    private selectedTags: Set<string>;

    constructor(app: App, ui: ManagerUI, pluginItem: EffectivePlugin) {
        super(app);
        this.ui = ui;
        this.pluginItem = pluginItem;
        this.selectedTags = new Set(pluginItem.tags || []);
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(`Etiquetas de ${this.pluginItem.name}`);

        const note = contentEl.createDiv({ cls: 'setting-item-description' });
        note.textContent =
            'La edición de etiquetas es organizativa y no auto-aplica cambios de activación en caliente.';

        const availableTags = this.ui.runtime.state?.tags || [];

        for (const tag of availableTags) {
            new Setting(contentEl)
                .setName(tag.name)
                .addToggle((toggle) => {
                    toggle.setValue(this.selectedTags.has(tag.id));
                    toggle.onChange((checked) => {
                        if (checked) {
                            this.selectedTags.add(tag.id);
                        } else {
                            this.selectedTags.delete(tag.id);
                        }
                    });
                });
        }

        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText('Guardar etiquetas')
                    .setCta()
                    .onClick(async () => {
                        this.close();
                        try {
                            await this.ui.runtime.setTags(
                                this.pluginItem.ref,
                                Array.from(this.selectedTags)
                            );
                            this.ui.showNotice(`Etiquetas actualizadas para ${this.pluginItem.name}`);
                            this.ui.refreshManagerView();
                        } catch (err) {
                            this.ui.showNotice('Error al guardar etiquetas: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => {
                btn.setButtonText('Cancelar').onClick(() => this.close());
            });
    }
}

/**
 * Modal for Deferred policy configuration on a single plugin.
 *
 * The save is a queued transaction: the policy is resolved by stable id from
 * refreshed state, a policy changed externally since open conflicts instead of
 * being overwritten, and a plugin that still owns native autostart requires the
 * runtime's reconcileDeferred() exclusion (or the save fails visibly rather than
 * claiming a deferred configuration that cannot be enforced).
 */
export class DeferredConfigModal extends Modal {
    private ui: ManagerUI;
    private pluginItem: EffectivePlugin;

    constructor(app: App, ui: ManagerUI, pluginItem: EffectivePlugin) {
        super(app);
        this.ui = ui;
        this.pluginItem = pluginItem;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(`Carga diferida: ${this.pluginItem.name}`);

        const deferredList = this.ui.runtime.state?.deferred || [];
        const existing = deferredList.find((p) => p.id === this.pluginItem.ref.id);
        // Snapshot of the target policy at open time for the conflict check.
        const snapshot = existing
            ? { enabled: existing.enabled, delayMs: existing.delayMs, parked: Boolean(existing.parked) }
            : null;

        let enabled = existing ? existing.enabled : false;
        let delayMs = existing ? existing.delayMs : 1000;
        let parked = existing ? Boolean(existing.parked) : false;

        new Setting(contentEl)
            .setName('Habilitar inicio diferido')
            .setDesc('Carga este plugin fuera del ciclo crítico de arranque de Obsidian')
            .addToggle((toggle) => {
                toggle.setValue(enabled);
                toggle.onChange((val) => (enabled = val));
            });

        new Setting(contentEl)
            .setName('Demora de inicio (ms)')
            .setDesc('Retardo tras el arranque antes de cargar el plugin')
            .addSlider((slider) => {
                slider.setLimits(100, 30000, 100);
                slider.setValue(delayMs);
                slider.setDynamicTooltip();
                slider.onChange((val) => (delayMs = val));
            });

        new Setting(contentEl)
            .setName('Modo estacionado (Parked)')
            .setDesc('Excluye el plugin del arranque diferido automático')
            .addToggle((toggle) => {
                toggle.setValue(parked);
                toggle.onChange((val) => (parked = val));
            });

        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText('Guardar política')
                    .setCta()
                    .onClick(async () => {
                        try {
                            await this.ui.enqueueDeferredPolicyApply(
                                `ui:deferred-policy-save:${this.pluginItem.ref.id}`,
                                this.pluginItem.ref,
                                (freshState, fresh) => {
                                    // Conflict: existence or field values changed while the
                                    // modal was open. The stale copy never wins.
                                    const freshSnapshot = fresh
                                        ? { enabled: fresh.enabled, delayMs: fresh.delayMs, parked: Boolean(fresh.parked) }
                                        : null;
                                    if (JSON.stringify(freshSnapshot) !== JSON.stringify(snapshot)) throw new UiStateConflictError();
                                    // Enabling a core or protected plugin is refused BEFORE
                                    // any host call: the runtime cannot honour it. Turning
                                    // the policy OFF stays allowed, which is how the user
                                    // resolves an already-invalid policy.
                                    if (enabled) {
                                        const refusal = this.ui.deferredEnableRefusal(this.pluginItem.ref);
                                        if (refusal) throw new Error(refusal);
                                    }
                                },
                                (policy) => {
                                    policy.enabled = enabled;
                                    policy.delayMs = delayMs;
                                    policy.parked = parked;
                                }
                            );
                            this.close();
                            this.ui.showNotice('Política de carga diferida guardada; las cargas programadas fueron canceladas. Pulsa Reanudar para recalcular.');
                            this.ui.refreshManagerView();
                        } catch (err) {
                            this.ui.showNotice('Error al guardar política: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => {
                btn.setButtonText('Cancelar').onClick(() => this.close());
            });
    }
}

/**
 * Modal for GitHub releases list and installation.
 *
 * The tracked source is looked up by its CANONICAL `community:<id>` key. When no
 * source is configured the repo field starts empty: the repository name is never
 * assumed to equal the plugin id. Installing calls github.install(repo, tag) and
 * the GithubManager persists the source under the manifest id it verified, so
 * even uninstalled sources can be adopted from here.
 */
export class GitHubReleasesModal extends Modal {
    private ui: ManagerUI;
    private pluginItem: EffectivePlugin;
    private initialRepo: string;

    constructor(app: App, ui: ManagerUI, pluginItem: EffectivePlugin, options?: { repo?: string }) {
        super(app);
        this.ui = ui;
        this.pluginItem = pluginItem;
        this.initialRepo = options?.repo ?? '';
    }

    async onOpen(): Promise<void> {
        const { contentEl, titleEl } = this;
        const canonicalKey = this.pluginItem.ref.id ? pluginRefKey(this.pluginItem.ref) : '';
        // Canonical source lookup; an empty id (new source) has no key to look up.
        const source = canonicalKey ? this.ui.runtime.state?.githubSources?.[canonicalKey] : undefined;
        const prefilledRepo = source?.repo || this.initialRepo;

        titleEl.setText(`Releases de GitHub: ${this.pluginItem.name || prefilledRepo || this.pluginItem.ref.id || 'nuevo origen'}`);

        // Actual installed version (host readback via the runtime list) and the
        // pin proposed for this source, labeled apart so they are never confused.
        contentEl.createEl('p', {
            text: `Versión instalada: ${this.pluginItem.installed && this.pluginItem.version ? this.pluginItem.version : 'no instalado'}`
                + ` | Fijada (pin): ${source?.pinned || 'ninguna'}`
                + ` | Prereleases: ${source?.trackPrereleases ? 'Sí' : 'No'}`
        });

        let repoInput = '';
        const releasesContainer = contentEl.createDiv();

        new Setting(contentEl)
            .setName('Repositorio (owner/repo o URL)')
            .setDesc(source?.repo ? 'Origen configurado para este plugin; puedes consultarlo o instalar otra release.' : 'Sin origen configurado: introduce el repositorio; nunca se deduce del ID del plugin.')
            .addText((text) => {
                text.setPlaceholder('owner/repo o URL');
                text.setValue(prefilledRepo);
                text.onChange((val) => (repoInput = val.trim()));
                repoInput = prefilledRepo;
            })
            .addButton((btn) => {
                btn.setButtonText('Ver releases').onClick(async () => {
                    if (!repoInput) {
                        this.ui.showNotice('Introduce un repositorio (owner/repo o URL) antes de buscar releases.');
                        return;
                    }
                    btn.setDisabled(true);
                    try {
                        await this.renderReleases(releasesContainer, repoInput);
                    } finally {
                        btn.setDisabled(false);
                    }
                });
            });

        if (prefilledRepo) {
            await this.renderReleases(releasesContainer, prefilledRepo);
        } else {
            releasesContainer.createEl('p', {
                text: 'Introduce owner/repo y pulsa "Ver releases" para listar las versiones disponibles.'
            });
        }
    }

    private async renderReleases(container: HTMLElement, repo: string): Promise<void> {
        container.empty?.();
        while (container.firstChild) container.removeChild(container.firstChild);

        const loadingEl = container.createEl('p', { text: 'Cargando releases...' });
        let releases: Release[];
        try {
            releases = await this.ui.github.releases(repo);
        } catch (err) {
            loadingEl.setText('Error al obtener releases: ' + (err as Error).message);
            return;
        }
        loadingEl.remove();

        if (!releases || releases.length === 0) {
            container.createEl('p', { text: 'No se encontraron releases disponibles.' });
            return;
        }

        for (const release of releases) {
            const setting = new Setting(container)
                .setName(`${release.name || release.tag} ${release.prerelease ? '(Pre-release)' : ''}`)
                .setDesc(`Tag: ${release.tag}`);

            setting.addButton((btn) => {
                btn.setButtonText('Instalar')
                    .onClick(async () => {
                        btn.setDisabled(true);
                        btn.setButtonText('Instalando...');
                        try {
                            // install() verifies the release manifest and returns the
                            // plugin id it installed; the GithubManager persists the
                            // source under that verified id, never a guessed one.
                            const verifiedId = await this.ui.github.install(repo, release.tag);
                            this.ui.showNotice(`Instalada ${release.tag} desde ${repo}; origen registrado para el ID verificado ${verifiedId}.`);
                            this.close();
                            this.ui.refreshManagerView();
                        } catch (err) {
                            btn.setDisabled(false);
                            btn.setButtonText('Instalar');
                            this.ui.showNotice('Error al instalar release: ' + (err as Error).message);
                        }
                    });
            });
        }
    }
}

/**
 * Extensive Manager Options Modal.
 * Covers all 6 required sections:
 * 1. Profiles CRUD / Tag membership / Backups / Workspace binding / Local Apply at start
 * 2. Fixture editor exact IDs & states partial apply / Protected IDs
 * 3. Deferred sliders enabled / parked / stagger
 * 4. GitHub releases, prereleases, pin, catalog check
 * 5. Debugging session candidates, binary search, pairs, observe, reports, AMD toggle
 * 6. Advanced effective state summary / conflicts & recovery banner
 */
export class ManagerOptionsModal extends Modal {
    private ui: ManagerUI;
    private activeSection: string = 'profiles';

    constructor(app: App, ui: ManagerUI) {
        super(app);
        this.ui = ui;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText('Opciones del Gestor de Plugins');
        contentEl.empty?.();
        while (contentEl.firstChild) {
            contentEl.removeChild(contentEl.firstChild);
        }

        const modalRoot = contentEl.createDiv({ cls: 'aigility-options-modal' });

        // Nav tabs
        const nav = modalRoot.createDiv({ cls: 'aigility-options-nav' });
        const sections = [
            { id: 'profiles', label: 'Perfiles' },
            { id: 'fixtures', label: 'Fixtures y Protecciones' },
            { id: 'deferred', label: 'Carga Diferida' },
            { id: 'github', label: 'GitHub y Betas' },
            ...(this.ui.runtime.list().some((item) => item.ref.kind === 'community' && item.installed) || this.ui.plugin.archive?.list().length ? [{ id: 'downloaded', label: 'Descargados' }] : []),
            { id: 'debug', label: 'Depuración' },
            { id: 'advanced', label: 'Avanzado y Recuperación' }
        ];

        const sectionBody = modalRoot.createDiv({ cls: 'aigility-options-section' });

        for (const sec of sections) {
            const tabBtn = nav.createEl('button', {
                cls: `aigility-nav-tab ${this.activeSection === sec.id ? 'is-active' : ''}`,
                text: sec.label
            });
            tabBtn.onclick = () => {
                this.activeSection = sec.id;
                nav.querySelectorAll('.aigility-nav-tab').forEach((el) => el.classList.remove('is-active'));
                tabBtn.classList.add('is-active');
                this.renderActiveSection(sectionBody);
            };
        }

        this.renderActiveSection(sectionBody);
    }

    private renderActiveSection(container: HTMLElement): void {
        container.empty?.();
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        switch (this.activeSection) {
            case 'profiles':
                this.renderProfilesSection(container);
                break;
            case 'fixtures':
                this.renderFixturesSection(container);
                break;
            case 'deferred':
                this.renderDeferredSection(container);
                break;
            case 'github':
                this.renderGitHubSection(container);
                break;
            case 'downloaded':
                renderArchiveSection(this.ui, container);
                break;
            case 'debug':
                this.renderDebugSection(container);
                break;
            case 'advanced':
                this.renderAdvancedSection(container);
                break;
        }
    }

    /**
     * Section 1: Profile CRUD / tag membership / backups / workspace / dropdown binding local Apply at start
     */
    private renderProfilesSection(container: HTMLElement): void {
        container.createEl('h3', { text: 'Gestión de Perfiles de Dispositivo' });

        const state = this.ui.runtime.state;
        const local = this.ui.runtime.local;

        // Local Device Profile Binding
        new Setting(container)
            .setName('Perfil asociado a este dispositivo')
            .setDesc('Vinculación local en este equipo. Los perfiles marcados con Apply at start se aplican al arrancar.')
            .addDropdown((dropdown) => {
                dropdown.addOption('', 'Sin perfil asignado');
                for (const p of state.deviceProfiles || []) {
                    dropdown.addOption(p.id, p.name);
                }
                dropdown.setValue(local.deviceProfileId || '');
                dropdown.onChange(async (val) => {
                    try {
                        await this.ui.runtime.bindProfile(val);
                        this.ui.showNotice('Perfil vinculado a este dispositivo');
                    } catch (err) {
                        this.ui.showNotice('Error al vincular perfil: ' + (err as Error).message);
                    }
                });
            });

        // Apply profile manually with comparison preview
        new Setting(container)
            .setName('Aplicación manual de perfil')
            .setDesc('Abre la comparativa concreta antes/después incluyendo plugins core antes de ejecutar la transición.')
            .addDropdown((dropdown) => {
                for (const p of state.deviceProfiles || []) {
                    dropdown.addOption(p.id, p.name);
                }
                dropdown.setValue(local.deviceProfileId || (state.deviceProfiles[0]?.id ?? ''));
                dropdown.onChange(() => {});
                (this as any)._selectedProfileForApply = dropdown.getValue();
                dropdown.onChange((val) => {
                    (this as any)._selectedProfileForApply = val;
                });
            })
            .addButton((btn) => {
                btn.setButtonText('Comparar y aplicar...')
                    .setCta()
                    .onClick(async () => {
                        const targetId = (this as any)._selectedProfileForApply || local.deviceProfileId || state.deviceProfiles[0]?.id;
                        if (!targetId) {
                            this.ui.showNotice('Selecciona un perfil primero');
                            return;
                        }
                        try {
                            const changes = await this.ui.runtime.previewProfile(targetId);
                            new ProfileComparisonModal(this.app, changes, async () => {
                                await this.ui.runtime.applyProfile(targetId, changes);
                            }).open();
                        } catch (err) {
                            this.ui.showNotice('Error al generar vista previa: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => {
                btn.setButtonText('Deshacer último perfil').onClick(async () => {
                    try {
                        await this.ui.runtime.undoProfile();
                        this.ui.showNotice('Perfil deshecho con éxito');
                    } catch (err) {
                        this.ui.showNotice('Error al deshacer: ' + (err as Error).message);
                    }
                });
            });

        // Profiles list
        container.createEl('h4', { text: 'Perfiles configurados' });
        for (const profile of state.deviceProfiles || []) {
            const profileBox = container.createDiv({ cls: 'aigility-profile-card' });
            new Setting(profileBox)
                .setName(profile.name)
                .setDesc(`ID: ${profile.id} | Tags: ${profile.tagIds.join(', ') || 'Ninguna'} | Workspace: ${profile.workspaceId || 'Por defecto'}`)
                .addToggle((toggle) => {
                    toggle.setValue(profile.applyAtStart);
                    toggle.setTooltip('Apply at start');
                    toggle.onChange(async (val) => {
                        try {
                            await this.ui.enqueueStateWrite(`ui:profile-apply-at-start:${profile.id}`, (freshState) => {
                                const fresh = freshState.deviceProfiles.find((candidate) => candidate.id === profile.id);
                                if (!fresh) throw new Error(`El perfil ${profile.id} ya no existe; recarga la sección.`);
                                fresh.applyAtStart = val;
                            });
                            this.ui.showNotice(`Apply at start ${val ? 'activado' : 'desactivado'} para ${profile.name}`);
                        } catch (err) {
                            this.ui.showNotice('Error al guardar Apply at start: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Editar tags').onClick(() => {
                        this.openProfileTagEditor(profile);
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Eliminar').setWarning().onClick(async () => {
                        try {
                            // The binding lives in queued runtime state: clear it with the
                            // normal queued bindProfile BEFORE the delete transaction, never
                            // inside it (a queued call inside a transaction deadlocks the
                            // serial queue).
                            if (this.ui.runtime.local?.deviceProfileId === profile.id) {
                                await this.ui.runtime.bindProfile('');
                                this.ui.showNotice(`Vínculo local con ${profile.name} liberado antes de eliminar.`);
                            }
                            await this.ui.enqueueStateWrite(`ui:profile-delete:${profile.id}`, (freshState) => {
                                const index = freshState.deviceProfiles.findIndex((candidate) => candidate.id === profile.id);
                                if (index === -1) throw new Error(`El perfil ${profile.id} ya no existe; recarga la sección.`);
                                freshState.deviceProfiles.splice(index, 1);
                            });
                            this.ui.showNotice(`Perfil ${profile.name} eliminado`);
                            this.renderActiveSection(container);
                        } catch (err) {
                            this.ui.showNotice('Error al eliminar perfil: ' + (err as Error).message);
                        }
                    });
                });
        }

        // Create new profile
        new Setting(container)
            .setName('Crear nuevo perfil')
            .addButton((btn) => {
                btn.setButtonText('+ Nuevo perfil').setCta().onClick(() => {
                    this.openCreateProfileModal(container);
                });
            });

        // Profile Backups: two on-disk formats are rendered with their real
        // timestamp and origin - manager snapshots ({id, timestamp, profiles,
        // fixtures, tagMembership}) and verbatim imported Companion backups
        // ({source, migratedAt, backups: {variant: {name, savedAt, pluginStates}}}).
        container.createEl('h4', { text: 'Copias de respaldo de perfiles (Backups)' });
        const backups = state.profileBackups || [];
        if (backups.length === 0) {
            container.createEl('p', {
                cls: 'setting-item-description',
                text: 'No hay copias de seguridad guardadas.'
            });
        } else {
            for (const backup of backups) {
                const identity = backupIdentityOf(backup);
                const companion = companionBackupEntryOf(backup);
                let setting: Setting;
                if (companion) {
                    const variants = Object.entries(companion.backups)
                        .map(([variant, data]) => {
                            const savedAt = typeof data?.savedAt === 'string' ? ` (${new Date(data.savedAt).toLocaleString()})` : '';
                            return `${variant}${savedAt}`;
                        })
                        .join(', ');
                    setting = new Setting(container)
                        .setName(`Copia importada de ${companion.source}`)
                        .setDesc(`Origen: Companion | Migrada: ${companion.migratedAt ? new Date(companion.migratedAt).toLocaleString() : 'fecha desconocida'} | Variantes: ${variants || 'ninguna'}`);

                    setting.addButton((btn) => {
                        btn.setButtonText('Restaurar como fixture').onClick(async () => {
                            if (!identity) {
                                this.ui.showNotice('La copia importada no tiene una identidad reconocible; no se puede restaurar.');
                                return;
                            }
                            try {
                                const fixtureIds = await this.ui.restoreCompanionBackup(identity);
                                this.ui.showNotice(`Fixtures creados desde la copia de ${companion.source}: ${fixtureIds.join(', ')}. Nada se aplicó automáticamente.`);
                                this.renderActiveSection(container);
                            } catch (err) {
                                this.ui.showNotice('Error al restaurar copia importada: ' + (err as Error).message);
                            }
                        });
                    });
                } else if (isObjectRecord(backup) && Array.isArray(backup.profiles)) {
                    const snapshot = backup as Partial<ManagerProfileBackup>;
                    const membershipCount = isObjectRecord(snapshot.tagMembership) ? Object.keys(snapshot.tagMembership).length : 0;
                    setting = new Setting(container)
                        .setName(`Copia ${typeof snapshot.timestamp === 'string' ? new Date(snapshot.timestamp).toLocaleString() : 'sin fecha'}`)
                        .setDesc(`Origen: Gestor | Perfiles: ${Array.isArray(snapshot.profiles) ? snapshot.profiles.length : 0} | Fixtures: ${Array.isArray(snapshot.fixtures) ? snapshot.fixtures.length : 0} | Membresías: ${membershipCount}`);

                    setting.addButton((btn) => {
                        btn.setButtonText('Restaurar').onClick(async () => {
                            if (!identity) {
                                this.ui.showNotice('La copia no tiene una identidad reconocible; no se puede restaurar.');
                                return;
                            }
                            try {
                                await this.ui.restoreManagerBackup(identity);
                                this.ui.showNotice('Definiciones restauradas desde la copia (perfiles, fixtures y membresías). No se aplicó ningún estado de activación guardado.');
                                this.renderActiveSection(container);
                            } catch (err) {
                                this.ui.showNotice('Error al restaurar: ' + (err as Error).message);
                            }
                        });
                    });
                } else {
                    setting = new Setting(container)
                        .setName('Copia con formato desconocido')
                        .setDesc('Esta entrada no coincide con ningún formato conocido; se conserva intacta.');
                }

                setting.addButton((btn) => {
                    btn.setButtonText('Eliminar').setWarning().onClick(async () => {
                        if (!identity) {
                            this.ui.showNotice('La copia no tiene una identidad reconocible; no se puede eliminar de forma segura.');
                            return;
                        }
                        try {
                            await this.ui.enqueueStateWrite(`ui:backup-delete:${JSON.stringify(identity)}`, (freshState) => {
                                const index = freshState.profileBackups.findIndex((entry) => sameBackupIdentity(entry, identity));
                                if (index === -1) throw new Error('La copia de seguridad ya no existe en el estado actual.');
                                freshState.profileBackups.splice(index, 1);
                            });
                            this.ui.showNotice('Copia de seguridad eliminada');
                            this.renderActiveSection(container);
                        } catch (err) {
                            this.ui.showNotice('Error al eliminar copia: ' + (err as Error).message);
                        }
                    });
                });
            }
        }

        new Setting(container)
            .setName('Crear copia de respaldo')
            .setDesc('Guarda definiciones de perfiles, fixtures y membresías de etiquetas. La activación guardada no se re-aplica al restaurar.')
            .addButton((btn) => {
                btn.setButtonText('Crear respaldo').onClick(async () => {
                    try {
                        await this.ui.enqueueStateWrite('ui:backup-create', (freshState) => {
                            if (!Array.isArray(freshState.profileBackups)) freshState.profileBackups = [];
                            const tagMembership: ManagerProfileBackup['tagMembership'] = {};
                            for (const record of Object.values(freshState.records ?? {})) {
                                tagMembership[pluginRefKey(record.ref)] = { tags: [...(record.tags ?? [])], group: record.group ?? '' };
                            }
                            freshState.profileBackups.push({
                                id: `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                timestamp: new Date().toISOString(),
                                profiles: deepClone(freshState.deviceProfiles ?? []),
                                fixtures: deepClone(freshState.fixtureProfiles ?? []),
                                tagMembership,
                            } satisfies ManagerProfileBackup);
                        });
                        this.ui.showNotice('Copia de respaldo creada con éxito');
                        this.renderActiveSection(container);
                    } catch (err) {
                        this.ui.showNotice('Error al crear respaldo: ' + (err as Error).message);
                    }
                });
            });
    }

    private openProfileTagEditor(profile: DeviceProfile): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(`Editar tags para perfil: ${profile.name}`);
        const content = modal.contentEl;

        const currentTags = new Set(profile.tagIds);
        // Snapshot of the target field at open time: if tagIds changed externally
        // while editing, the save must conflict instead of overwriting.
        const tagIdsSnapshot = JSON.stringify(profile.tagIds ?? []);
        const tags = this.ui.runtime.state?.tags || [];

        for (const tag of tags) {
            new Setting(content)
                .setName(tag.name)
                .addToggle((toggle) => {
                    toggle.setValue(currentTags.has(tag.id));
                    toggle.onChange((checked) => {
                        if (checked) {
                            currentTags.add(tag.id);
                        } else {
                            currentTags.delete(tag.id);
                        }
                    });
                });
        }

        new Setting(content)
            .addButton((btn) => {
                btn.setButtonText('Guardar')
                    .setCta()
                    .onClick(async () => {
                        try {
                            await this.ui.enqueueStateWrite(`ui:profile-tags:${profile.id}`, (freshState) => {
                                const fresh = freshState.deviceProfiles.find((candidate) => candidate.id === profile.id);
                                if (!fresh) throw new Error(`El perfil ${profile.id} ya no existe; recarga la sección.`);
                                if (JSON.stringify(fresh.tagIds ?? []) !== tagIdsSnapshot) throw new UiStateConflictError();
                                fresh.tagIds = Array.from(currentTags);
                            });
                            modal.close();
                            this.ui.showNotice(`Tags actualizadas para ${profile.name}`);
                        } catch (err) {
                            this.ui.showNotice('Error al guardar tags del perfil: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => {
                btn.setButtonText('Cancelar').onClick(() => modal.close());
            });

        modal.open();
    }

    private openCreateProfileModal(parentContainer: HTMLElement): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Crear Perfil de Dispositivo');
        const content = modal.contentEl;

        let name = '';
        let id = '';
        let workspaceId = '';

        new Setting(content)
            .setName('Nombre')
            .addText((text) => text.onChange((val) => {
                name = val;
                id = val.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            }));

        new Setting(content)
            .setName('Workspace ID (opcional)')
            .addText((text) => text.onChange((val) => (workspaceId = val)));

        new Setting(content)
            .addButton((btn) => {
                btn.setButtonText('Crear')
                    .setCta()
                    .onClick(async () => {
                        if (!name || !id) {
                            this.ui.showNotice('El nombre no puede estar vacío');
                            return;
                        }
                        try {
                            await this.ui.enqueueStateWrite(`ui:profile-create:${id}`, (freshState) => {
                                if (freshState.deviceProfiles.some((candidate) => candidate.id === id)) {
                                    throw new Error(`Ya existe un perfil con el ID ${id}.`);
                                }
                                freshState.deviceProfiles.push({
                                    id,
                                    name,
                                    tagIds: [],
                                    applyAtStart: true,
                                    ...(workspaceId ? { workspaceId } : {})
                                });
                            });
                            modal.close();
                            this.ui.showNotice(`Perfil ${name} creado`);
                            this.renderActiveSection(parentContainer);
                        } catch (err) {
                            this.ui.showNotice('Error al crear perfil: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => btn.setButtonText('Cancelar').onClick(() => modal.close()));

        modal.open();
    }

    /**
     * Section 2: Fixture editor exact IDs/states partial apply, protected IDs editable
     */
    private renderFixturesSection(container: HTMLElement): void {
        container.createEl('h3', { text: 'Fixtures y Protecciones' });

        const state = this.ui.runtime.state;

        // Protected IDs list
        container.createEl('h4', { text: 'Plugins Protegidos' });
        container.createEl('p', {
            cls: 'setting-item-description',
            text: 'Los plugins protegidos nunca se desactivarán durante cambios de perfil o depuración. El gestor siempre está protegido.'
        });

        const protectedList = container.createDiv({ cls: 'aigility-protected-list' });
        // The manager protects itself with the canonical `community:<id>` key;
        // both spellings are irremovable here so self-protection never lapses.
        const managerProtectedForms = ['aigility-plugin-manager', 'community:aigility-plugin-manager'];
        for (const id of state.protected || []) {
            const row = protectedList.createDiv({ cls: 'aigility-protected-row' });
            row.createSpan({ text: id });
            if (!managerProtectedForms.includes(id)) {
                const delBtn = row.createEl('button', { text: '✖', cls: 'clickable-icon' });
                delBtn.onclick = async () => {
                    try {
                        await this.ui.enqueueStateWrite(`ui:protected-remove:${id}`, (freshState) => {
                            const index = freshState.protected.indexOf(id);
                            if (index === -1) throw new Error(`La protección ${id} ya no existe; recarga la sección.`);
                            freshState.protected.splice(index, 1);
                        });
                        this.ui.showNotice(`Protección eliminada: ${id}`);
                        this.renderActiveSection(container);
                    } catch (err) {
                        this.ui.showNotice('Error al eliminar protección: ' + (err as Error).message);
                    }
                };
            } else {
                row.createSpan({ cls: 'aigility-badge', text: 'Gestor (Fijo)' });
            }
        }

        new Setting(container)
            .setName('Añadir plugin protegido')
            .addText((text) => {
                (this as any)._newProtectedId = '';
                text.onChange((val) => ((this as any)._newProtectedId = val.trim()));
            })
            .addButton((btn) => {
                btn.setButtonText('Añadir').onClick(async () => {
                    const newId = (this as any)._newProtectedId;
                    if (!newId) return;
                    try {
                        await this.ui.enqueueStateWrite(`ui:protected-add:${newId}`, (freshState) => {
                            const canonical = parsePluginRefKey(newId);
                            const counterpart = canonical
                                ? newId
                                : Object.keys(freshState.records ?? {}).find((recordKey) => recordKey === `community:${newId}` || recordKey === `core:${newId}`);
                            if (freshState.protected.includes(newId) || (counterpart && freshState.protected.includes(counterpart))) {
                                throw new Error(`Ese plugin ya está protegido (${counterpart ?? newId}).`);
                            }
                            freshState.protected.push(newId);
                        });
                        this.ui.showNotice(`Protección añadida: ${newId}`);
                        this.renderActiveSection(container);
                    } catch (err) {
                        this.ui.showNotice('Error al añadir protección: ' + (err as Error).message);
                    }
                });
            });

        // Fixtures
        container.createEl('h4', { text: 'Perfiles Fixture' });
        container.createEl('p', {
            cls: 'setting-item-description',
            text: 'Los fixtures definen estados exactos de plugins para pruebas y permiten aplicación parcial.'
        });

        for (const fixture of state.fixtureProfiles || []) {
            new Setting(container)
                .setName(fixture.name)
                .setDesc(`Miembros: ${Object.keys(fixture.members || {}).length}`)
                .addButton((btn) => {
                    btn.setButtonText('Aplicar parcialmente').onClick(async () => {
                        // Canonical keys only: member entries that do not parse are
                        // reported instead of being guessed as community ids.
                        const targets: Array<{ ref: PluginRef; enabled: boolean }> = [];
                        for (const [pluginKey, desiredState] of Object.entries(fixture.members || {})) {
                            const ref = parsePluginRefKey(pluginKey);
                            if (!ref) {
                                this.ui.showNotice(`El fixture ${fixture.name} contiene una clave no canónica (${pluginKey}); corrígelo antes de aplicar.`);
                                return;
                            }
                            targets.push({ ref, enabled: desiredState === true });
                        }
                        try {
                            // One queue slot for the whole partial apply; tx.setEnabled
                            // applies each member without re-enqueueing.
                            await this.ui.runtime.enqueue(`ui:fixture-apply:${fixture.id}`, async (tx) => {
                                for (const target of targets) {
                                    await tx.setEnabled(target.ref, target.enabled);
                                }
                            });
                            this.ui.showNotice(`Fixture ${fixture.name} aplicado parcialmente`);
                        } catch (err) {
                            this.ui.showNotice('Error al aplicar fixture: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Editar miembros').onClick(() => {
                        new FixtureEditModal(this.app, this.ui, fixture).open();
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Eliminar').setWarning().onClick(async () => {
                        try {
                            await this.ui.enqueueStateWrite(`ui:fixture-delete:${fixture.id}`, (freshState) => {
                                const index = freshState.fixtureProfiles.findIndex((candidate) => candidate.id === fixture.id);
                                if (index === -1) throw new Error(`El fixture ${fixture.id} ya no existe; recarga la sección.`);
                                freshState.fixtureProfiles.splice(index, 1);
                            });
                            this.ui.showNotice(`Fixture ${fixture.name} eliminado`);
                            this.renderActiveSection(container);
                        } catch (err) {
                            this.ui.showNotice('Error al eliminar fixture: ' + (err as Error).message);
                        }
                    });
                });
        }

        new Setting(container)
            .setName('Crear nuevo fixture')
            .setDesc('Crea un perfil fixture para congelar y aplicar estados exactos en pruebas.')
            .addButton((btn) => {
                btn.setButtonText('+ Nuevo fixture').setCta().onClick(() => {
                    this.openCreateFixtureModal(container);
                });
            });
    }

    private openCreateFixtureModal(parentContainer: HTMLElement): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Crear Perfil Fixture');
        const content = modal.contentEl;

        let name = '';
        let id = '';

        new Setting(content)
            .setName('Nombre del fixture')
            .addText((text) => text.onChange((val) => {
                name = val.trim();
                id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            }));

        new Setting(content)
            .addButton((btn) => {
                btn.setButtonText('Crear')
                    .setCta()
                    .onClick(async () => {
                        if (!name || !id) {
                            this.ui.showNotice('El nombre no puede estar vacío');
                            return;
                        }
                        try {
                            await this.ui.enqueueStateWrite(`ui:fixture-create:${id}`, (freshState) => {
                                if (!Array.isArray(freshState.fixtureProfiles)) freshState.fixtureProfiles = [];
                                if (freshState.fixtureProfiles.some((candidate) => candidate.id === id)) {
                                    throw new Error(`Ya existe un fixture con el ID ${id}.`);
                                }
                                freshState.fixtureProfiles.push({ id, name, members: {} });
                            });
                            modal.close();
                            this.ui.showNotice(`Fixture ${name} creado`);
                            this.renderActiveSection(parentContainer);
                        } catch (err) {
                            this.ui.showNotice('Error al crear fixture: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => btn.setButtonText('Cancelar').onClick(() => modal.close()));

        modal.open();
    }

    /**
     * Section 3: Deferred sliders enabled / parked / stagger
     */
    private renderDeferredSection(container: HTMLElement): void {
        container.createEl('h3', { text: 'Carga Diferida (Deferred Loading)' });

        const state = this.ui.runtime.state;

        // Stagger slider
        new Setting(container)
            .setName('Intervalo escalonado (Stagger delay)')
            .setDesc('Tiempo en milisegundos entre la activación de cada plugin diferido para evitar bloqueos del hilo principal.')
            .addSlider((slider) => {
                slider.setLimits(50, 2000, 50);
                slider.setValue(state.settings.staggerMs || 200);
                slider.setDynamicTooltip();
                slider.onChange(async (val) => {
                    try {
                        await this.ui.enqueueStateWrite('ui:deferred-stagger', (freshState) => {
                            freshState.settings.staggerMs = val;
                        });
                        this.ui.showNotice(`Escalonado diferido guardado: ${val}ms`);
                    } catch (err) {
                        this.ui.showNotice('Error al guardar el escalonado: ' + (err as Error).message);
                    }
                });
            });

        container.createEl('h4', { text: 'Políticas configuradas' });
        container.createEl('p', {
            cls: 'setting-item-description',
            text: 'Cada edición de política cancela al instante las cargas diferidas programadas (la automatización queda pausada con un motivo visible). Pulsa Reanudar para recalcular con la política nueva.'
        });

        for (const policy of state.deferred || []) {
            const pluginRecord = state.records[`community:${policy.id}`] || state.records[`core:${policy.id}`];
            const name = pluginRecord ? pluginRecord.name : policy.id;

            new Setting(container)
                .setName(name)
                .setDesc(`Demora: ${policy.delayMs}ms | ${policy.parked ? 'Estacionado (Parked)' : 'Auto-arranque'}`)
                .addToggle((toggle) => {
                    toggle.setValue(policy.enabled);
                    toggle.setTooltip('Habilitar diferido');
                    toggle.onChange(async (val) => {
                        // Enabling resolves the plugin's kind from the record it was
                        // declared for: the reconcile target is that plugin and no
                        // other. Disabling never forces a load, it only lets the
                        // existing pause cancel the scheduled ones.
                        const ref: PluginRef = state.records[`core:${policy.id}`]
                            ? { kind: 'core', id: policy.id }
                            : { kind: 'community', id: policy.id };
                        try {
                            await this.ui.enqueueDeferredPolicyApply(
                                `ui:deferred-policy-enable:${policy.id}`,
                                ref,
                                (freshState, fresh) => {
                                    if (!fresh) throw new Error(`La política de ${policy.id} ya no existe; recarga la sección.`);
                                    if (val) {
                                        const refusal = this.ui.deferredEnableRefusal(ref);
                                        if (refusal) throw new Error(refusal);
                                    }
                                },
                                (fresh) => {
                                    fresh.enabled = val;
                                }
                            );
                            this.ui.showNotice(`Política diferida de ${name} ${val ? 'habilitada' : 'deshabilitada'}`);
                        } catch (err) {
                            this.ui.showNotice('Error al guardar la política diferida: ' + (err as Error).message);
                        }
                    });
                })
                .addToggle((toggle) => {
                    toggle.setValue(Boolean(policy.parked));
                    toggle.setTooltip('Estacionado');
                    toggle.onChange(async (val) => {
                        // Parked only changes WHERE the load happens, never WHETHER
                        // it is deferred, so an already-enabled policy re-reconciles
                        // its own native exclusion instead of leaving it stale.
                        const ref: PluginRef = state.records[`core:${policy.id}`]
                            ? { kind: 'core', id: policy.id }
                            : { kind: 'community', id: policy.id };
                        try {
                            await this.ui.enqueueDeferredPolicyApply(
                                `ui:deferred-policy-parked:${policy.id}`,
                                ref,
                                (freshState, fresh) => {
                                    if (!fresh) throw new Error(`La política de ${policy.id} ya no existe; recarga la sección.`);
                                },
                                (fresh) => {
                                    fresh.parked = val;
                                }
                            );
                            this.ui.showNotice(`Política diferida de ${name} ${val ? 'estacionada' : 'desestacionada'}`);
                        } catch (err) {
                            this.ui.showNotice('Error al guardar la política diferida: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Eliminar').onClick(async () => {
                        try {
                            await this.ui.enqueueDeferredPolicyWrite(`ui:deferred-policy-delete:${policy.id}`, (freshState) => {
                                const index = freshState.deferred.findIndex((candidate) => candidate.id === policy.id);
                                if (index === -1) throw new Error(`La política de ${policy.id} ya no existe; recarga la sección.`);
                                freshState.deferred.splice(index, 1);
                            });
                            this.ui.showNotice(`Política diferida de ${name} eliminada`);
                            this.renderActiveSection(container);
                        } catch (err) {
                            this.ui.showNotice('Error al eliminar la política diferida: ' + (err as Error).message);
                        }
                    });
                });
        }
    }

    /**
     * Section 4: GitHub releases incl prerelease select/pin/catalog-check default automatic off
     */
    private renderGitHubSection(container: HTMLElement): void {
        container.createEl('h3', { text: 'GitHub, Betas y Control de Versiones' });

        const state = this.ui.runtime.state;

        // Automatic updates: the setting stays off and there is deliberately NO
        // toggle here. No update engine is implemented yet, so a control would be
        // an inert no-op; checks are manual until that engine exists.
        new Setting(container)
            .setName('Comprobación automática de actualizaciones')
            .setDesc('Sin motor implementado: permanece desactivada. Revisa actualizaciones de forma manual con "Comprobar ahora"; cuando exista el motor de actualizaciones aparecerá su control aquí.');

        // Catalog check button
        new Setting(container)
            .setName('Comprobar catálogo completo')
            .setDesc('Verifica versiones en GitHub sin retener historiales completos en memoria.')
            .addButton((btn) => {
                btn.setButtonText('Comprobar ahora')
                    .setCta()
                    .onClick(async () => {
                        btn.setDisabled(true);
                        btn.setButtonText('Comprobando...');
                        try {
                            const results = await this.ui.github.checkAll();
                            btn.setDisabled(false);
                            btn.setButtonText('Comprobar ahora');
                            this.showCatalogCheckResults(results);
                        } catch (err) {
                            btn.setDisabled(false);
                            btn.setButtonText('Comprobar ahora');
                            this.ui.showNotice('Error al comprobar catálogo: ' + (err as Error).message);
                        }
                    });
            });

        // Tracked sources. State keys are canonical `community:<id>`; every
        // action (releases picker, rollback, pin toggle) parses that key so raw
        // plugin ids never leak into the GitHub manager API.
        container.createEl('h4', { text: 'Repositorios GitHub configurados' });
        for (const [sourceKey, source] of Object.entries(state.githubSources || {})) {
            const ref = parsePluginRefKey(sourceKey);
            const record = ref ? state.records[pluginRefKey(ref)] : undefined;
            const pinLabel = source.pinned ? source.pinned : 'ninguno';
            const desc = ref
                ? `Repo: ${source.repo} | Instalada: ${record?.version || source.version || 'desconocida'} | Fijada (pin): ${pinLabel} | Prereleases: ${source.trackPrereleases ? 'Sí' : 'No'}`
                : `Repo: ${source.repo} | Clave no canónica: las acciones quedan deshabilitadas para no adivinar el plugin.`;

            const row = new Setting(container)
                .setName(sourceKey)
                .setDesc(desc);

            if (!ref) continue;

            row.addButton((btn) => {
                btn.setButtonText('Releases').onClick(() => {
                    const pluginItem = this.ui.runtime.list().find((p) => pluginRefKey(p.ref) === sourceKey)
                        ?? this.uninstalledSourceItem(sourceKey, source.repo);
                    new GitHubReleasesModal(this.app, this.ui, pluginItem).open();
                });
            });
            row.addButton((btn) => {
                btn.setButtonText('Rollback').onClick(async () => {
                    try {
                        // rollback() takes the RAW plugin id, never the canonical key.
                        await this.ui.github.rollback(ref.id);
                        this.ui.showNotice(`Rollback ejecutado para ${ref.id}`);
                    } catch (err) {
                        this.ui.showNotice('Error en rollback: ' + (err as Error).message);
                    }
                });
            });
            row.addToggle((toggle) => {
                toggle.setValue(source.trackPrereleases);
                toggle.setTooltip('Seguir pre-releases');
                toggle.onChange(async (val) => {
                    try {
                        await this.ui.enqueueStateWrite(`ui:github-prereleases:${sourceKey}`, (freshState) => {
                            const freshSource = freshState.githubSources[sourceKey];
                            if (!freshSource) throw new Error(`El origen ${sourceKey} ya no existe; recarga la sección.`);
                            // Only the requested field changes: a concurrent pin or
                            // repo edit in the same source object is preserved.
                            freshSource.trackPrereleases = val;
                        });
                        this.ui.showNotice(`Pre-releases ${val ? 'activados' : 'desactivados'} para ${sourceKey}`);
                    } catch (err) {
                        this.ui.showNotice('Error al guardar pre-releases: ' + (err as Error).message);
                    }
                });
            });
        }

        // Add a new GitHub source. The UI never invents a plugin id from the repo
        // name and never writes githubSources itself: the release picker accepts
        // owner/repo or URL (even for uninstalled plugins), and after a verified
        // install the GithubManager persists the source under the manifest id it
        // read back from the release.
        let newRepoInput = '';

        new Setting(container)
            .setName('Añadir repositorio de GitHub')
            .setDesc('Introduce owner/repo o URL completa (ej: obsidianmd/obsidian-sample-plugin) y elige una release; el origen se registra con el ID verificado del manifiesto instalado.')
            .addText((text) => {
                text.setPlaceholder('owner/repo o URL');
                text.onChange((val) => (newRepoInput = val.trim()));
            })
            .addButton((btn) => {
                btn.setButtonText('Elegir release...').onClick(() => {
                    if (!newRepoInput) {
                        this.ui.showNotice('Introduce un repositorio válido');
                        return;
                    }
                    const normalized = normalizeGithubRepoInput(newRepoInput);
                    if (!normalized) {
                        this.ui.showNotice('Formato inválido. Usa owner/repo o una URL de GitHub');
                        return;
                    }
                    new GitHubReleasesModal(this.app, this.ui, this.uninstalledSourceItem('', normalized), { repo: normalized }).open();
                });
            });
    }

    /**
     * Synthetic list entry for a tracked source whose plugin is not installed or
     * not observed yet, so the release picker stays usable without assuming any
     * installed state. An empty sourceKey yields an id-less target (new source).
     */
    private uninstalledSourceItem(sourceKey: string, repo: string): EffectivePlugin {
        const ref = parsePluginRefKey(sourceKey);
        return {
            ref: ref ?? { kind: 'community', id: '' },
            name: repo,
            version: '',
            installed: false,
            compatible: true,
            nativeAutostart: false,
            loaded: false,
            desired: false,
            tags: [],
            group: '',
            scheduled: false,
        };
    }

    private showCatalogCheckResults(results: UpdateResult[]): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Resultados de Comprobación de Catálogo');
        const content = modal.contentEl;

        if (results.length === 0) {
            content.createEl('p', { text: 'Todos los plugins están al día.' });
        } else {
            for (const res of results) {
                new Setting(content)
                    .setName(res.id)
                    .setDesc(`Actual: ${res.current} | Propuesta: ${res.proposed || 'N/A'} ${res.error ? `| Error: ${res.error}` : ''}`);
            }
        }
        modal.open();
    }

    /**
     * Section 5: Debugging session candidates / test halves / complement / previous / pair / observe / reports / AMD toggle
     */
    private renderDebugSection(container: HTMLElement): void {
        container.createEl('h3', { text: 'Sesión de Depuración y Diagnóstico' });

        const session = this.ui.debug?.session;
        // A finished session keeps its object for reports; only session.active means active.
        const active = Boolean(session?.active);
        const interrupted = Boolean(active && session.interrupted);

        // Persistent compatibility status: stays in the DOM, never console-only.
        const statusEl = container.createDiv({ cls: 'aigility-debug-status' });
        statusEl.setAttribute('role', 'status');
        const reportError = (message: string): void => {
            statusEl.textContent = `Error de compatibilidad: ${message}`;
            this.ui.showNotice(message);
        };

        if (!active) {
            if (session) {
                container.createEl('p', {
                    cls: 'setting-item-description',
                    text: 'La sesión anterior ya ha finalizado. Sus informes siguen disponibles; inicia una nueva sesión para continuar el diagnóstico.'
                });
            } else {
                container.createEl('p', {
                    text: 'No hay ninguna sesión de depuración activa. Selecciona candidatos para iniciar búsqueda binaria de conflictos.'
                });
            }

            new Setting(container)
                .setName('Iniciar sesión de depuración')
                .setDesc('Desactivará plugins no candidatos respetando las protecciones.')
                .addButton((btn) => {
                    // No refs on purpose: the manager's own default IS the safe
                    // active set. The label named "todos" for a selection that
                    // never was; it now says what actually starts.
                    btn.setButtonText('Iniciar con los activos').setCta().onClick(async () => {
                        try {
                            await this.ui.debug.start();
                            this.ui.showNotice('Sesión de depuración iniciada con los plugins activos');
                            this.renderActiveSection(container);
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Seleccionar candidatos...').onClick(() => {
                        this.openSelectDebugCandidatesModal(container);
                    });
                });
        } else if (interrupted) {
            // Interrupted session: only explicit recover/finish; no step is replayed.
            container.createDiv({ cls: 'aigility-recovery-banner mod-warning' }).createSpan({
                text: '⚠️ Sesión de depuración interrumpida. Las automatizaciones siguen pausadas hasta que elijas una acción explícita. Reanudar registra el estado actual del vault sin repetir los pasos previos.'
            });

            new Setting(container)
                .setName('Sesión interrumpida')
                .setDesc('Reanudar continúa la sesión conservando el estado actual. Finalizar cierra la sesión y restaura los cambios propios de la sesión.')
                .addButton((btn) => {
                    btn.setButtonText('Reanudar sesión').setCta().onClick(async () => {
                        if (typeof this.ui.debug.resume !== 'function') {
                            reportError('Esta sesión no expone reanudación explícita (resume()).');
                            return;
                        }
                        try {
                            await this.ui.debug.resume();
                            this.ui.showNotice('Sesión reanudada sin repetir pasos previos');
                            this.renderActiveSection(container);
                        } catch (err) {
                            // No re-render on failure: the persistent status must survive.
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Finalizar sesión').setWarning().onClick(async () => {
                        try {
                            await this.ui.debug.finish();
                            this.ui.showNotice('Sesión de depuración finalizada');
                            this.renderActiveSection(container);
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Exportar informes').onClick(async () => {
                        try {
                            const reports = await this.ui.debug.exportReports();
                            this.showReportsModal(reports);
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                });
        } else {
            container.createEl('h4', { text: 'Sesión activa en curso' });

            new Setting(container)
                .setName('Búsqueda binaria de conflicto (Halves)')
                .addButton((btn) => {
                    btn.setButtonText('Probar mitad').onClick(async () => {
                        try {
                            await this.ui.debug.testHalf(false);
                            this.ui.showNotice('Probando primera mitad');
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Probar complemento').onClick(async () => {
                        try {
                            await this.ui.debug.testHalf(true);
                            this.ui.showNotice('Probando complemento');
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Paso anterior').onClick(async () => {
                        try {
                            await this.ui.debug.previous();
                            this.ui.showNotice('Vuelto al paso anterior');
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                });

            // Test Pair Controls: canonical kind:id selector values avoid
            // collisions when a community plugin and a core plugin share an id.
            const pairOptions = this.ui.runtime.list().map((p) => ({
                value: pluginRefKey(p.ref),
                label: `${p.name} (${pluginRefKey(p.ref)})`
            }));
            let pairA = pairOptions[0]?.value || '';
            let pairB = pairOptions[1]?.value || '';

            new Setting(container)
                .setName('Probar pareja (Test pair)')
                .setDesc('Aísla la interacción entre dos plugins concretos usando referencias canónicas kind:id.')
                .addDropdown((dropdown) => {
                    for (const opt of pairOptions) dropdown.addOption(opt.value, opt.label);
                    dropdown.setValue(pairA);
                    dropdown.onChange((val) => (pairA = val));
                })
                .addDropdown((dropdown) => {
                    for (const opt of pairOptions) dropdown.addOption(opt.value, opt.label);
                    dropdown.setValue(pairB);
                    dropdown.onChange((val) => (pairB = val));
                })
                .addButton((btn) => {
                    btn.setButtonText('Probar pareja').onClick(async () => {
                        const refA = parsePluginRefKey(pairA);
                        const refB = parsePluginRefKey(pairB);
                        if (!refA || !refB || pluginRefKey(refA) === pluginRefKey(refB)) {
                            this.ui.showNotice('Selecciona dos plugins distintos');
                            return;
                        }
                        try {
                            await this.ui.debug.testPair(refA, refB);
                            this.ui.showNotice(`Probando pareja: ${pairA} y ${pairB}`);
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                });

            // Observe note & result
            let note = '';
            new Setting(container)
                .setName('Registrar observación')
                .addText((text) => text.onChange((val) => (note = val)))
                .addButton((btn) => {
                    btn.setButtonText('Falla').setWarning().onClick(async () => {
                        try {
                            await this.ui.debug.observe(note, 'fails');
                            this.ui.showNotice('Observación registrada (falla)');
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Pasa').setCta().onClick(async () => {
                        try {
                            await this.ui.debug.observe(note, 'passes');
                            this.ui.showNotice('Observación registrada (pasa)');
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Desconocido').onClick(async () => {
                        try {
                            await this.ui.debug.observe(note, 'unknown');
                            this.ui.showNotice('Observación registrada (desconocido)');
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                });

            // Finish and export
            new Setting(container)
                .setName('Finalizar y exportar')
                .addButton((btn) => {
                    btn.setButtonText('Exportar informes').onClick(async () => {
                        try {
                            const reports = await this.ui.debug.exportReports();
                            this.showReportsModal(reports);
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Finalizar sesión').setCta().onClick(async () => {
                        try {
                            await this.ui.debug.finish();
                            this.ui.showNotice('Sesión de depuración finalizada');
                            this.renderActiveSection(container);
                        } catch (err) {
                            reportError((err as Error).message);
                        }
                    });
                });
        }

        this.renderDebugAdvancedControls(container, session, active && !interrupted, reportError);
    }

    /**
     * Compact on-demand Advanced Debug controls. Every control stays disabled
     * until an active diagnostic session exists AND Advanced Debug Mode is
     * enabled; values rehydrate from the live session settings, and each
     * capability reports its compatibility reason visibly when unsupported.
     */
    private renderDebugAdvancedControls(
        container: HTMLElement,
        session: any,
        usableSession: boolean,
        reportError: (message: string) => void
    ): void {
        const advanced = session?.advanced ?? { active: false, settings: {}, restore: {} };
        const advancedActive = Boolean(advanced.active);
        const settings = (advanced.settings ?? {}) as Record<string, unknown>;

        const capabilities = new Map<string, AdvancedCapability>();
        if (typeof this.ui.debug.advancedCapabilities === 'function') {
            for (const cap of this.ui.debug.advancedCapabilities()) {
                capabilities.set(cap.id, cap);
            }
        }
        const isSupported = (id: string): boolean => capabilities.get(id)?.supported !== false;
        const capabilityReason = (id: string): string =>
            capabilities.get(id)?.reason || `Advanced Debug Mode no es compatible con ${id} en este host.`;

        const apply = async (option: string, value: unknown): Promise<void> => {
            if (typeof this.ui.debug.configureAdvanced !== 'function') {
                reportError('La sesión de depuración no expone configureAdvanced().');
                return;
            }
            try {
                await this.ui.debug.configureAdvanced(option, value);
            } catch (err) {
                reportError((err as Error).message);
            }
        };

        const guard = (option: string): boolean => {
            if (!usableSession || !advancedActive) return false;
            if (!isSupported(option)) {
                reportError(capabilityReason(option));
                return false;
            }
            return true;
        };

        const disableComponent = (component: any): void => {
            if (typeof component?.setDisabled === 'function') component.setDisabled(true);
        };

        container.createEl('h4', { text: 'Advanced Debug Mode (controles bajo demanda)' });

        // AMD master toggle: rehydrated from the live session, never hardcoded.
        new Setting(container)
            .setName('Advanced Debug Mode (AMD)')
            .setDesc(usableSession
                ? 'Habilita diagnósticos avanzados para esta sesión sin mantener plugins siempre activos.'
                : 'Requiere una sesión de depuración activa no interrumpida.')
            .addToggle((toggle) => {
                toggle.setValue(advancedActive);
                if (!usableSession) disableComponent(toggle);
                toggle.onChange(async (val) => {
                    if (!usableSession) {
                        toggle.setValue(advancedActive);
                        return;
                    }
                    try {
                        await this.ui.debug.advanced(val);
                        this.ui.showNotice(`Modo AMD ${val ? 'activado' : 'desactivado'}`);
                        this.renderActiveSection(container);
                    } catch (err) {
                        // Snap the toggle back and keep the persistent status visible.
                        toggle.setValue(advancedActive);
                        reportError((err as Error).message);
                    }
                });
            });

        // debugMode: boolean
        new Setting(container)
            .setName('Modo debug (debugMode)')
            .setDesc('Activa el modo debug nativo del host durante la sesión.')
            .addToggle((toggle) => {
                toggle.setValue(Boolean(settings.debugMode));
                if (!usableSession || !advancedActive || !isSupported('debugMode')) {
                    disableComponent(toggle);
                    if (!isSupported('debugMode')) this.attachCapabilityNote(container, 'debugMode', capabilityReason('debugMode'));
                }
                toggle.onChange(async (val) => {
                    if (!guard('debugMode')) return;
                    await apply('debugMode', val);
                });
            });

        // namespaces: list of strings
        new Setting(container)
            .setName('Namespaces de debug')
            .setDesc('Nombres separados por coma o espacio; se envían como lista de strings.')
            .addText((text) => {
                text.setPlaceholder('ej: aigility, app');
                text.setValue(Array.isArray(settings.namespaces)
                    ? (settings.namespaces as unknown[]).filter((n) => typeof n === 'string').join(', ')
                    : (typeof settings.namespaces === 'string' ? settings.namespaces : ''));
                if (!usableSession || !advancedActive || !isSupported('namespaces')) {
                    disableComponent(text);
                    if (!isSupported('namespaces')) this.attachCapabilityNote(container, 'namespaces', capabilityReason('namespaces'));
                }
                text.onChange((raw) => {
                    if (!guard('namespaces')) return;
                    const list = raw.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
                    void apply('namespaces', list);
                });
            });

        // longStackTraces / asyncLongStackTraces: gated by the capability catalog
        // (upstream patch lifecycle not embeddable yet reports them unsupported).
        for (const option of ['longStackTraces', 'asyncLongStackTraces'] as const) {
            new Setting(container)
                .setName(option === 'longStackTraces' ? 'Long stack traces' : 'Async long stack traces')
                .setDesc(isSupported(option) ? 'Trazas de pila extendidas para la sesión.' : capabilityReason(option))
                .addToggle((toggle) => {
                    toggle.setValue(Boolean(settings[option]));
                    if (!usableSession || !advancedActive || !isSupported(option)) {
                        disableComponent(toggle);
                        if (!isSupported(option)) this.attachCapabilityNote(container, option, capabilityReason(option));
                    }
                    toggle.onChange(async (val) => {
                        if (!guard(option)) return;
                        await apply(option, val);
                    });
                });
        }

        // stackTraceLimit: numeric
        new Setting(container)
            .setName('Límite de stack trace')
            .setDesc('Entero mayor o igual a cero para Error.stackTraceLimit.')
            .addText((text) => {
                text.setValue(typeof settings.stackTraceLimit === 'number' ? String(settings.stackTraceLimit) : '');
                if (!usableSession || !advancedActive || !isSupported('stackTraceLimit')) {
                    disableComponent(text);
                    if (!isSupported('stackTraceLimit')) this.attachCapabilityNote(container, 'stackTraceLimit', capabilityReason('stackTraceLimit'));
                }
                text.onChange((raw) => {
                    if (!guard('stackTraceLimit')) return;
                    const parsed = Number(raw.trim());
                    if (!Number.isInteger(parsed) || parsed < 0) {
                        reportError('stackTraceLimit debe ser un entero mayor o igual a cero.');
                        return;
                    }
                    void apply('stackTraceLimit', parsed);
                });
            });

        // timeouts: boolean, Desktop FileSystemAdapter only
        new Setting(container)
            .setName('Desactivar timeouts (60s)')
            .setDesc(isSupported('timeouts') ? 'Desactiva el aviso/timeout de tareas largas del adaptador de escritorio.' : capabilityReason('timeouts'))
            .addToggle((toggle) => {
                toggle.setValue(Boolean(settings.timeouts));
                if (!usableSession || !advancedActive || !isSupported('timeouts')) {
                    disableComponent(toggle);
                    if (!isSupported('timeouts')) this.attachCapabilityNote(container, 'timeouts', capabilityReason('timeouts'));
                }
                toggle.onChange(async (val) => {
                    if (!guard('timeouts')) return;
                    await apply('timeouts', val);
                });
            });

        // mobileConsole: boolean
        new Setting(container)
            .setName('Consola móvil')
            .setDesc(isSupported('mobileConsole') ? 'Abre la consola móvil integrada durante la sesión.' : capabilityReason('mobileConsole'))
            .addToggle((toggle) => {
                toggle.setValue(Boolean(settings.mobileConsole));
                if (!usableSession || !advancedActive || !isSupported('mobileConsole')) {
                    disableComponent(toggle);
                    if (!isSupported('mobileConsole')) this.attachCapabilityNote(container, 'mobileConsole', capabilityReason('mobileConsole'));
                }
                toggle.onChange(async (val) => {
                    if (!guard('mobileConsole')) return;
                    await apply('mobileConsole', val);
                });
            });

        // mobileEmulation: boolean, Desktop only
        new Setting(container)
            .setName('Emulación móvil')
            .setDesc(isSupported('mobileEmulation') ? 'Emula la interfaz móvil; solo disponible en Desktop.' : capabilityReason('mobileEmulation'))
            .addToggle((toggle) => {
                toggle.setValue(Boolean(settings.mobileEmulation));
                if (!usableSession || !advancedActive || !isSupported('mobileEmulation')) {
                    disableComponent(toggle);
                    if (!isSupported('mobileEmulation')) this.attachCapabilityNote(container, 'mobileEmulation', capabilityReason('mobileEmulation'));
                }
                toggle.onChange(async (val) => {
                    if (!guard('mobileEmulation')) return;
                    await apply('mobileEmulation', val);
                });
            });

        // Cancel current operation
        new Setting(container)
            .setName('Cancelar operación en curso')
            .setDesc(isSupported('cancelRunningTask')
                ? 'Aborta la tarea en curso a través del sharedAbortController.'
                : capabilityReason('cancelRunningTask'))
            .addButton((btn) => {
                btn.setButtonText('Cancelar operación actual');
                if (!usableSession || !advancedActive || !isSupported('cancelRunningTask')) {
                    btn.setDisabled(true);
                }
                btn.onClick(async () => {
                    if (!guard('cancelRunningTask')) return;
                    if (typeof this.ui.debug.cancelRunningTask !== 'function') {
                        reportError('La sesión de depuración no expone cancelRunningTask().');
                        return;
                    }
                    try {
                        await this.ui.debug.cancelRunningTask();
                        this.ui.showNotice('Operación en curso cancelada');
                    } catch (err) {
                        reportError((err as Error).message);
                    }
                });
            });
    }

    /** Renders a visible, per-option compatibility note next to the control. */
    private attachCapabilityNote(container: HTMLElement, option: string, reason: string): void {
        const note = container.createDiv({ cls: 'aigility-capability-note' });
        note.setAttribute('role', 'note');
        note.textContent = `${option}: ${reason}`;
    }

    private showReportsModal(reports: { markdown: string; json: string }): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Informes de Depuración');
        const content = modal.contentEl;

        content.createEl('h4', { text: 'Markdown' });
        const mdArea = content.createEl('textarea', { cls: 'aigility-report-textarea' });
        mdArea.value = reports.markdown;

        content.createEl('h4', { text: 'JSON' });
        const jsonArea = content.createEl('textarea', { cls: 'aigility-report-textarea' });
        jsonArea.value = reports.json;

        modal.open();
    }

    /**
     * Opens the candidate picker. Public and modal-returning so hosts and tests
     * can inspect the rendered selection without reaching into detached DOM.
     */
    public openSelectDebugCandidatesModal(parentContainer: HTMLElement): Modal {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Seleccionar Candidatos de Depuración');
        const content = modal.contentEl;

        const plugins = this.ui.runtime.list();
        const protectedSet = new Set(this.ui.runtime.state.protected || []);
        // Protection entries may be canonical `kind:id` keys (the manager's own,
        // for example) or legacy raw ids; both forms mark a plugin protected.
        const isProtectedPlugin = (p: EffectivePlugin): boolean =>
            protectedSet.has(pluginRefKey(p.ref)) || protectedSet.has(p.ref.id) || this.ui.isSelfRef(p.ref);
        const selectedRefs = new Set<string>();

        // Default = the SAFE ACTIVE set, not every installed plugin. Handing
        // debug.start() an explicit array bypasses the DebugManager default,
        // which is what made an inert catalog of hundreds of inactive-but-installed
        // plugins a bulk load to disable. Active means loaded, native-autostart,
        // or scheduled-and-desired; incompatible and uninstalled entries are never
        // preselected. Inactive-but-installed plugins stay listed and SELECTABLE,
        // so an explicit choice is still one click away.
        for (const p of plugins) {
            if (!isProtectedPlugin(p) && p.installed && p.compatible
                && (p.loaded || p.nativeAutostart || (p.scheduled && p.desired))) {
                selectedRefs.add(pluginRefKey(p.ref));
            }
        }

        const note = content.createEl('p', {
            cls: 'setting-item-description',
            text: 'Por defecto se seleccionan solo los plugins activos (cargados, con autoarranque nativo o programados). Los plugins instalados pero inactivos quedan sin marcar: puedes marcarlos si el diagnóstico lo necesita. Los plugins protegidos permanecen intactos durante la sesión. Los plugins fuera del aislamiento (desmarcados) NO permanecen intactos: se desactivan durante el diagnóstico y se restauran al finalizar.'
        });

        const listContainer = content.createDiv({ cls: 'aigility-diff-table-container' });

        for (const p of plugins) {
            const key = pluginRefKey(p.ref);
            const isProtected = isProtectedPlugin(p);

            const row = new Setting(listContainer)
                .setName(`${p.name} (${p.ref.kind})`)
                .setDesc(isProtected ? 'Protegido (No modificable)' : `ID: ${p.ref.id}`);

            if (isProtected) {
                row.addExtraButton((btn) => btn.setIcon('lock').setTooltip('Protegido'));
            } else {
                row.addToggle((toggle) => {
                    toggle.setValue(selectedRefs.has(key));
                    toggle.onChange((val) => {
                        if (val) selectedRefs.add(key);
                        else selectedRefs.delete(key);
                    });
                });
            }
        }

        new Setting(content)
            .addButton((btn) => {
                btn.setButtonText('Iniciar con seleccionados')
                    .setCta()
                    .onClick(async () => {
                        modal.close();
                        const refsToTest: PluginRef[] = [];
                        for (const key of selectedRefs) {
                            const [kind, ...rest] = key.split(':');
                            refsToTest.push({ kind: kind as 'community' | 'core', id: rest.join(':') });
                        }
                        try {
                            await this.ui.debug.start(refsToTest);
                            this.ui.showNotice(`Sesión iniciada con ${refsToTest.length} candidatos`);
                            this.renderActiveSection(parentContainer);
                        } catch (err) {
                            this.ui.showNotice('Error al iniciar: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => btn.setButtonText('Cancelar').onClick(() => modal.close()));

        modal.open();
        return modal;
    }

    /**
     * Section 6: Advanced effective state summary / conflicts / recovery banner manual Apply or Resume
     */
    private renderAdvancedSection(container: HTMLElement): void {
        container.createEl('h3', { text: 'Estado Efectivo, Conflictos y Recuperación' });

        const local = this.ui.runtime.local;

        if (local.recoveryReason || local.operationPending) {
            const banner = container.createDiv({ cls: 'aigility-recovery-banner mod-warning' });
            banner.createSpan({
                text: `Estado de recuperación activo: ${local.recoveryReason || local.operationPending}`
            });
            const resumeBtn = banner.createEl('button', { cls: 'mod-cta', text: 'Reanudar' });
            resumeBtn.onclick = async () => {
                try {
                    await this.ui.runtime.resume();
                    this.ui.showNotice('Reanudado con éxito');
                    this.renderActiveSection(container);
                } catch (err) {
                    this.ui.showNotice('Error: ' + (err as Error).message);
                }
            };
        }

        // State summary
        let plugins: EffectivePlugin[] = [];
        try {
            plugins = this.ui.runtime.list();
        } catch (e) {
            // ignore
        }

        const total = plugins.length;
        const desired = plugins.filter((p) => p.desired).length;
        const native = plugins.filter((p) => p.nativeAutostart).length;
        const loaded = plugins.filter((p) => p.loaded).length;
        const scheduled = plugins.filter((p) => p.scheduled).length;

        new Setting(container)
            .setName('Resumen de estado efectivo')
            .setDesc(`Total: ${total} | Deseados: ${desired} | Autostart nativo: ${native} | Cargados en memoria: ${loaded} | Diferidos: ${scheduled}`);

        // Actions
        new Setting(container)
            .setName('Escribir estado efectivo a disco')
            .setDesc('Genera effective-state.json para auditoría de agentes.')
            .addButton((btn) => {
                btn.setButtonText('Escribir ahora').onClick(async () => {
                    try {
                        await this.ui.runtime.writeEffectiveState();
                        this.ui.showNotice('effective-state.json generado correctamente');
                    } catch (err) {
                        this.ui.showNotice('Error al escribir estado: ' + (err as Error).message);
                    }
                });
            });

        new Setting(container)
            .setName('Guardar configuración')
            .setDesc('Guarda el estado completo detectando posibles escrituras externas concurrentes.')
            .addButton((btn) => {
                btn.setButtonText('Guardar estado').onClick(async () => {
                    try {
                        await this.ui.runtime.save();
                        this.ui.showNotice('Estado guardado con éxito');
                    } catch (err) {
                        this.ui.showNotice('Error al guardar: ' + (err as Error).message);
                    }
                });
            });
    }
}

/**
 * Modal for editing members of a Fixture Profile.
 */
export class FixtureEditModal extends Modal {
    private ui: ManagerUI;
    private fixture: FixtureProfile;
    private membersSnapshot = '';
    private workingMembers: { [pluginKey: string]: boolean } = {};

    constructor(app: App, ui: ManagerUI, fixture: FixtureProfile) {
        super(app);
        this.ui = ui;
        this.fixture = fixture;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(`Editar Fixture: ${this.fixture.name}`);

        if (!this.membersSnapshot) {
            // First open: snapshot the member map for the conflict check and edit
            // a working copy, so the render-time object is never written directly
            // and an external member edit makes the save conflict.
            this.membersSnapshot = JSON.stringify(this.fixture.members ?? {});
            this.workingMembers = { ...(this.fixture.members ?? {}) };
        }
        const plugins = this.ui.runtime.list();

        for (const p of plugins) {
            const key = pluginRefKey(p.ref);
            const isMember = key in this.workingMembers;
            const stateVal = isMember ? this.workingMembers[key] : false;

            new Setting(contentEl)
                .setName(`${p.name} (${key})`)
                .addToggle((toggle) => {
                    toggle.setValue(stateVal);
                    toggle.onChange((val) => {
                        this.workingMembers[key] = val;
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText(isMember ? 'Quitar miembro' : 'Añadir miembro')
                        .onClick(() => {
                            if (isMember) {
                                delete this.workingMembers[key];
                            } else {
                                this.workingMembers[key] = p.desired;
                            }
                            this.onOpen();
                        });
                });
        }

        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText('Guardar fixture')
                    .setCta()
                    .onClick(async () => {
                        try {
                            await this.ui.enqueueStateWrite(`ui:fixture-edit:${this.fixture.id}`, (freshState) => {
                                const fresh = freshState.fixtureProfiles.find((candidate) => candidate.id === this.fixture.id);
                                if (!fresh) throw new Error(`El fixture ${this.fixture.id} ya no existe; recarga la sección.`);
                                if (JSON.stringify(fresh.members ?? {}) !== this.membersSnapshot) throw new UiStateConflictError();
                                fresh.members = { ...this.workingMembers };
                            });
                            this.close();
                            this.ui.showNotice(`Fixture ${this.fixture.name} guardado`);
                            this.ui.refreshManagerView();
                        } catch (err) {
                            this.ui.showNotice('Error al guardar fixture: ' + (err as Error).message);
                        }
                    });
            })
            .addButton((btn) => btn.setButtonText('Cerrar').onClick(() => this.close()));
    }
}
