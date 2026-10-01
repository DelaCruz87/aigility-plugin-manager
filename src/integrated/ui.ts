import {
    App,
    Modal,
    Menu,
    Notice,
    Setting,
    setIcon
} from 'obsidian';
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

export interface FilterCriteria {
    search?: string;
    kind?: 'all' | 'community' | 'core';
    tag?: string;
    group?: string;
}

export interface ManagerRuntime {
    state: State;
    local: LocalState;
    list(): EffectivePlugin[];
    enqueue<T>(label: string, operation: () => Promise<T>): Promise<T>;
    save(): Promise<void>;
    previewProfile(id: string): Promise<Change[]>;
    applyProfile(id: string): Promise<void>;
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
     * Filters ONLY plugin-specific settings rows mapped by tab.id/plugin.id or records.
     * Core and general settings tabs remain completely untouched!
     */
    public applySidebarFilter(setting: any): void {
        if (!setting || !Array.isArray(setting.pluginTabs)) return;

        const { search, tag, group } = this.sidebarFilterCriteria;
        const normalizedSearch = search ? search.trim().toLowerCase() : '';

        // pluginTabs contains ONLY community plugin tabs
        for (const tab of setting.pluginTabs) {
            const pluginId = tab.id || tab.plugin?.manifest?.id || '';
            const record = this.runtime.state?.records?.[`community:${pluginId}`];
            const pluginName = (tab.name || tab.plugin?.manifest?.name || record?.name || pluginId).toLowerCase();

            let matches = true;

            // Search filter
            if (normalizedSearch) {
                if (!pluginName.includes(normalizedSearch) && !pluginId.toLowerCase().includes(normalizedSearch)) {
                    matches = false;
                }
            }

            // Tag filter
            if (matches && tag && tag !== 'all') {
                if (!record || !record.tags || !record.tags.includes(tag)) {
                    matches = false;
                }
            }

            // Group filter
            if (matches && group && group !== 'all') {
                if (!record || record.group !== group) {
                    matches = false;
                }
            }

            // Hide or show the tab's nav element
            const navEl = tab.navEl;
            if (navEl && navEl.style) {
                navEl.style.display = matches ? '' : 'none';
            }
        }
    }

    /**
     * Restores visibility of all plugin tabs in sidebar.
     */
    private restoreSidebarTabs(setting: any): void {
        if (!setting || !Array.isArray(setting.pluginTabs)) return;
        for (const tab of setting.pluginTabs) {
            if (tab.navEl && tab.navEl.style) {
                tab.navEl.style.display = '';
            }
        }
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

        const filtered = filterPlugins(allPlugins, this.filterCriteria);

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
                (t: any) => t.id === plugin.ref.id || t.plugin?.manifest?.id === plugin.ref.id
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
            .setDesc('Introduce la versión exacta para evitar actualizaciones automáticas, o déjalo vacío para desfijar.')
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
                            this.ui.display(this.ui['installedContainerEl'] as HTMLElement);
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
                        this.close();
                        try {
                            const state = this.ui.runtime.state;
                            const idx = state.deferred.findIndex((p) => p.id === this.pluginItem.ref.id);
                            if (idx !== -1) {
                                state.deferred[idx] = { id: this.pluginItem.ref.id, delayMs, enabled, parked };
                            } else {
                                state.deferred.push({ id: this.pluginItem.ref.id, delayMs, enabled, parked });
                            }
                            await this.ui.runtime.save();
                            this.ui.showNotice('Política de carga diferida guardada');
                            this.ui.display(this.ui['installedContainerEl'] as HTMLElement);
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
 */
export class GitHubReleasesModal extends Modal {
    private ui: ManagerUI;
    private pluginItem: EffectivePlugin;

    constructor(app: App, ui: ManagerUI, pluginItem: EffectivePlugin) {
        super(app);
        this.ui = ui;
        this.pluginItem = pluginItem;
    }

    async onOpen(): Promise<void> {
        const { contentEl, titleEl } = this;
        titleEl.setText(`Releases de GitHub: ${this.pluginItem.name}`);

        const source = this.ui.runtime.state?.githubSources?.[this.pluginItem.ref.id];
        const repo = source?.repo || this.pluginItem.ref.id;

        contentEl.createEl('p', { text: `Repositorio: ${repo}` });

        const loadingEl = contentEl.createEl('p', { text: 'Cargando releases...' });

        try {
            const releases = await this.ui.github.releases(repo);
            loadingEl.remove();

            if (!releases || releases.length === 0) {
                contentEl.createEl('p', { text: 'No se encontraron releases disponibles.' });
                return;
            }

            for (const release of releases) {
                const setting = new Setting(contentEl)
                    .setName(`${release.name || release.tag} ${release.prerelease ? '(Pre-release)' : ''}`)
                    .setDesc(`Tag: ${release.tag}`);

                setting.addButton((btn) => {
                    btn.setButtonText('Instalar')
                        .onClick(async () => {
                            btn.setDisabled(true);
                            btn.setButtonText('Instalando...');
                            try {
                                await this.ui.github.install(repo, release.tag);
                                this.ui.showNotice(`Instalada versión ${release.tag} de ${this.pluginItem.name}`);
                                this.close();
                                this.ui.display(this.ui['installedContainerEl'] as HTMLElement);
                            } catch (err) {
                                btn.setDisabled(false);
                                btn.setButtonText('Instalar');
                                this.ui.showNotice('Error al instalar release: ' + (err as Error).message);
                            }
                        });
                });
            }
        } catch (err) {
            loadingEl.setText('Error al obtener releases: ' + (err as Error).message);
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
                                await this.ui.runtime.applyProfile(targetId);
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
                        profile.applyAtStart = val;
                        await this.ui.runtime.save();
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Editar tags').onClick(() => {
                        this.openProfileTagEditor(profile);
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Eliminar').setWarning().onClick(async () => {
                        const idx = state.deviceProfiles.indexOf(profile);
                        if (idx !== -1) {
                            state.deviceProfiles.splice(idx, 1);
                            await this.ui.runtime.save();
                            this.renderActiveSection(container);
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

        // Profile Backups
        container.createEl('h4', { text: 'Copias de respaldo de perfiles (Backups)' });
        const backups = (state.profileBackups || []) as Array<{ id: string; timestamp: string; profiles: DeviceProfile[] }>;
        if (backups.length === 0) {
            container.createEl('p', {
                cls: 'setting-item-description',
                text: 'No hay copias de seguridad guardadas.'
            });
        } else {
            for (const backup of backups) {
                const setting = new Setting(container)
                    .setName(`Copia ${new Date(backup.timestamp).toLocaleString()}`)
                    .setDesc(`Perfiles incluidos: ${backup.profiles?.length ?? 0}`);

                setting.addButton((btn) => {
                    btn.setButtonText('Restaurar').onClick(async () => {
                        try {
                            state.deviceProfiles = JSON.parse(JSON.stringify(backup.profiles));
                            await this.ui.runtime.save();
                            this.ui.showNotice('Perfiles restaurados desde la copia de seguridad');
                            this.renderActiveSection(container);
                        } catch (err) {
                            this.ui.showNotice('Error al restaurar: ' + (err as Error).message);
                        }
                    });
                });

                setting.addButton((btn) => {
                    btn.setButtonText('Eliminar').setWarning().onClick(async () => {
                        const idx = state.profileBackups.indexOf(backup);
                        if (idx !== -1) {
                            state.profileBackups.splice(idx, 1);
                            await this.ui.runtime.save();
                            this.renderActiveSection(container);
                        }
                    });
                });
            }
        }

        new Setting(container)
            .setName('Crear copia de respaldo')
            .setDesc('Guarda una instantánea de la configuración de perfiles actual.')
            .addButton((btn) => {
                btn.setButtonText('Crear respaldo').onClick(async () => {
                    try {
                        if (!Array.isArray(state.profileBackups)) {
                            state.profileBackups = [];
                        }
                        state.profileBackups.push({
                            id: Date.now().toString(),
                            timestamp: new Date().toISOString(),
                            profiles: JSON.parse(JSON.stringify(state.deviceProfiles))
                        });
                        await this.ui.runtime.save();
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
                        modal.close();
                        profile.tagIds = Array.from(currentTags);
                        await this.ui.runtime.save();
                        this.ui.showNotice(`Tags actualizadas para ${profile.name}`);
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
                        modal.close();
                        this.ui.runtime.state.deviceProfiles.push({
                            id,
                            name,
                            tagIds: [],
                            applyAtStart: true,
                            workspaceId: workspaceId || undefined
                        });
                        await this.ui.runtime.save();
                        this.renderActiveSection(parentContainer);
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
        for (const id of state.protected || []) {
            const row = protectedList.createDiv({ cls: 'aigility-protected-row' });
            row.createSpan({ text: id });
            if (id !== 'aigility-plugin-manager') {
                const delBtn = row.createEl('button', { text: '✖', cls: 'clickable-icon' });
                delBtn.onclick = async () => {
                    state.protected = state.protected.filter((p) => p !== id);
                    await this.ui.runtime.save();
                    this.renderActiveSection(container);
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
                    if (newId && !state.protected.includes(newId)) {
                        state.protected.push(newId);
                        await this.ui.runtime.save();
                        this.renderActiveSection(container);
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
                        try {
                            for (const [pluginId, desiredState] of Object.entries(fixture.members || {})) {
                                const kind = pluginId.startsWith('core:') ? 'core' : 'community';
                                const cleanId = pluginId.replace(/^(core|community):/, '');
                                await this.ui.runtime.setEnabled({ kind, id: cleanId }, desiredState);
                            }
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
                        const idx = state.fixtureProfiles.indexOf(fixture);
                        if (idx !== -1) {
                            state.fixtureProfiles.splice(idx, 1);
                            await this.ui.runtime.save();
                            this.renderActiveSection(container);
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
                        modal.close();
                        if (!Array.isArray(this.ui.runtime.state.fixtureProfiles)) {
                            this.ui.runtime.state.fixtureProfiles = [];
                        }
                        this.ui.runtime.state.fixtureProfiles.push({
                            id,
                            name,
                            members: {}
                        });
                        await this.ui.runtime.save();
                        this.renderActiveSection(parentContainer);
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
                    state.settings.staggerMs = val;
                    await this.ui.runtime.save();
                });
            });

        container.createEl('h4', { text: 'Políticas configuradas' });

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
                        policy.enabled = val;
                        await this.ui.runtime.save();
                    });
                })
                .addToggle((toggle) => {
                    toggle.setValue(Boolean(policy.parked));
                    toggle.setTooltip('Estacionado');
                    toggle.onChange(async (val) => {
                        policy.parked = val;
                        await this.ui.runtime.save();
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Eliminar').onClick(async () => {
                        state.deferred = state.deferred.filter((p) => p !== policy);
                        await this.ui.runtime.save();
                        this.renderActiveSection(container);
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

        // Automatic updates toggle (default off)
        new Setting(container)
            .setName('Comprobación automática de actualizaciones')
            .setDesc('Desactivada por defecto para máxima estabilidad del vault.')
            .addToggle((toggle) => {
                toggle.setValue(state.settings.automaticUpdates || false);
                toggle.onChange(async (val) => {
                    state.settings.automaticUpdates = val;
                    await this.ui.runtime.save();
                });
            });

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

        // Tracked sources
        container.createEl('h4', { text: 'Repositorios GitHub configurados' });
        for (const [id, source] of Object.entries(state.githubSources || {})) {
            new Setting(container)
                .setName(id)
                .setDesc(`Repo: ${source.repo} | Pin: ${source.pinned || 'Ninguno'} | Prereleases: ${source.trackPrereleases ? 'Sí' : 'No'}`)
                .addButton((btn) => {
                    btn.setButtonText('Releases').onClick(() => {
                        const pluginItem = this.ui.runtime.list().find((p) => p.ref.id === id);
                        if (pluginItem) {
                            new GitHubReleasesModal(this.app, this.ui, pluginItem).open();
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Rollback').onClick(async () => {
                        try {
                            await this.ui.github.rollback(id);
                            this.ui.showNotice(`Rollback ejecutado para ${id}`);
                        } catch (err) {
                            this.ui.showNotice('Error en rollback: ' + (err as Error).message);
                        }
                    });
                })
                .addToggle((toggle) => {
                    toggle.setValue(source.trackPrereleases);
                    toggle.setTooltip('Seguir pre-releases');
                    toggle.onChange(async (val) => {
                        source.trackPrereleases = val;
                        await this.ui.runtime.save();
                    });
                });
        }

        // Add new GitHub source
        let newRepoInput = '';
        let newTrackPrereleases = false;

        new Setting(container)
            .setName('Añadir repositorio de GitHub')
            .setDesc('Introduce owner/repo o URL completa (ej: obsidianmd/obsidian-sample-plugin)')
            .addText((text) => {
                text.setPlaceholder('owner/repo o URL');
                text.onChange((val) => (newRepoInput = val.trim()));
            })
            .addToggle((toggle) => {
                toggle.setTooltip('Seguir pre-releases');
                toggle.onChange((val) => (newTrackPrereleases = val));
            })
            .addButton((btn) => {
                btn.setButtonText('Añadir origen').onClick(async () => {
                    if (!newRepoInput) {
                        this.ui.showNotice('Introduce un repositorio válido');
                        return;
                    }
                    // Normalize URL to owner/repo if full URL given
                    let repo = newRepoInput.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
                    const parts = repo.split('/');
                    if (parts.length < 2) {
                        this.ui.showNotice('Formato inválido. Usa owner/repo');
                        return;
                    }
                    const cleanRepo = `${parts[0]}/${parts[1]}`;
                    const pluginId = parts[1];

                    if (!state.githubSources) {
                        state.githubSources = {};
                    }

                    state.githubSources[pluginId] = {
                        repo: cleanRepo,
                        trackPrereleases: newTrackPrereleases
                    };
                    await this.ui.runtime.save();
                    this.ui.showNotice(`Origen GitHub añadido: ${cleanRepo}`);
                    this.renderActiveSection(container);
                });
            });
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

        const debug = this.ui.debug;
        const isSessionActive = Boolean(debug.session);

        if (!isSessionActive) {
            container.createEl('p', {
                text: 'No hay ninguna sesión de depuración activa. Selecciona candidatos para iniciar búsqueda binaria de conflictos.'
            });

            new Setting(container)
                .setName('Iniciar sesión de depuración')
                .setDesc('Desactivará plugins no candidatos respetando las protecciones.')
                .addButton((btn) => {
                    btn.setButtonText('Iniciar con todos').setCta().onClick(async () => {
                        try {
                            await debug.start();
                            this.ui.showNotice('Sesión de depuración iniciada con todos los plugins');
                            this.renderActiveSection(container);
                        } catch (err) {
                            this.ui.showNotice('Error al iniciar: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Seleccionar candidatos...').onClick(() => {
                        this.openSelectDebugCandidatesModal(container);
                    });
                });
        } else {
            container.createEl('h4', { text: 'Sesión activa en curso' });

            new Setting(container)
                .setName('Búsqueda binaria de conflicto (Halves)')
                .addButton((btn) => {
                    btn.setButtonText('Probar mitad').onClick(async () => {
                        try {
                            await debug.testHalf(false);
                            this.ui.showNotice('Probando primera mitad');
                        } catch (err) {
                            this.ui.showNotice('Error: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Probar complemento').onClick(async () => {
                        try {
                            await debug.testHalf(true);
                            this.ui.showNotice('Probando complemento');
                        } catch (err) {
                            this.ui.showNotice('Error: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Paso anterior').onClick(async () => {
                        try {
                            await debug.previous();
                            this.ui.showNotice('Vuelto al paso anterior');
                        } catch (err) {
                            this.ui.showNotice('Error: ' + (err as Error).message);
                        }
                    });
                });

            // Test Pair Controls
            const pluginsList = this.ui.runtime.list();
            let pairA: string = pluginsList[0]?.ref.id || '';
            let pairB: string = pluginsList[1]?.ref.id || '';

            new Setting(container)
                .setName('Probar pareja (Test pair)')
                .setDesc('Aísla y prueba la interacción entre dos plugins específicos.')
                .addDropdown((dropdown) => {
                    for (const p of pluginsList) {
                        dropdown.addOption(p.ref.id, `${p.name} (${p.ref.kind})`);
                    }
                    dropdown.setValue(pairA);
                    dropdown.onChange((val) => (pairA = val));
                })
                .addDropdown((dropdown) => {
                    for (const p of pluginsList) {
                        dropdown.addOption(p.ref.id, `${p.name} (${p.ref.kind})`);
                    }
                    dropdown.setValue(pairB);
                    dropdown.onChange((val) => (pairB = val));
                })
                .addButton((btn) => {
                    btn.setButtonText('Probar pareja').onClick(async () => {
                        if (!pairA || !pairB || pairA === pairB) {
                            this.ui.showNotice('Selecciona dos plugins distintos');
                            return;
                        }
                        const itemA = pluginsList.find((p) => p.ref.id === pairA);
                        const itemB = pluginsList.find((p) => p.ref.id === pairB);
                        if (!itemA || !itemB) return;
                        try {
                            await debug.testPair(itemA.ref, itemB.ref);
                            this.ui.showNotice(`Probando pareja: ${itemA.name} y ${itemB.name}`);
                        } catch (err) {
                            this.ui.showNotice('Error al probar pareja: ' + (err as Error).message);
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
                            await debug.observe(note, 'fails');
                            this.ui.showNotice('Observación registrada (falla)');
                        } catch (err) {
                            this.ui.showNotice('Error: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Pasa').setCta().onClick(async () => {
                        try {
                            await debug.observe(note, 'passes');
                            this.ui.showNotice('Observación registrada (pasa)');
                        } catch (err) {
                            this.ui.showNotice('Error: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Desconocido').onClick(async () => {
                        try {
                            await debug.observe(note, 'unknown');
                            this.ui.showNotice('Observación registrada (desconocido)');
                        } catch (err) {
                            this.ui.showNotice('Error: ' + (err as Error).message);
                        }
                    });
                });

            // Finish and export
            new Setting(container)
                .setName('Finalizar y exportar')
                .addButton((btn) => {
                    btn.setButtonText('Exportar informes').onClick(async () => {
                        try {
                            const reports = await debug.exportReports();
                            this.showReportsModal(reports);
                        } catch (err) {
                            this.ui.showNotice('Error al exportar: ' + (err as Error).message);
                        }
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText('Finalizar sesión').setCta().onClick(async () => {
                        try {
                            await debug.finish();
                            this.ui.showNotice('Sesión de depuración finalizada');
                            this.renderActiveSection(container);
                        } catch (err) {
                            this.ui.showNotice('Error al finalizar: ' + (err as Error).message);
                        }
                    });
                });
        }

        // Advanced Debug Mode (AMD) Toggle
        new Setting(container)
            .setName('Advanced Debug Mode (AMD)')
            .setDesc('Habilita diagnósticos avanzados bajo demanda sin mantener plugins siempre activos.')
            .addToggle((toggle) => {
                toggle.setValue(false);
                toggle.onChange(async (val) => {
                    try {
                        await debug.advanced(val);
                        this.ui.showNotice(`Modo AMD ${val ? 'activado' : 'desactivado'}`);
                    } catch (err) {
                        this.ui.showNotice('Error en AMD: ' + (err as Error).message);
                    }
                });
            });
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

    private openSelectDebugCandidatesModal(parentContainer: HTMLElement): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Seleccionar Candidatos de Depuración');
        const content = modal.contentEl;

        const plugins = this.ui.runtime.list();
        const protectedSet = new Set(this.ui.runtime.state.protected || []);
        const selectedRefs = new Set<string>();

        // Default: all non-protected plugins selected
        for (const p of plugins) {
            if (!protectedSet.has(p.ref.id)) {
                selectedRefs.add(pluginRefKey(p.ref));
            }
        }

        const note = content.createEl('p', {
            cls: 'setting-item-description',
            text: 'Los plugins desmarcados y los protegidos permanecerán intactos durante la sesión de depuración.'
        });

        const listContainer = content.createDiv({ cls: 'aigility-diff-table-container' });

        for (const p of plugins) {
            const key = pluginRefKey(p.ref);
            const isProtected = protectedSet.has(p.ref.id);

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

    constructor(app: App, ui: ManagerUI, fixture: FixtureProfile) {
        super(app);
        this.ui = ui;
        this.fixture = fixture;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(`Editar Fixture: ${this.fixture.name}`);

        const members = this.fixture.members || {};
        const plugins = this.ui.runtime.list();

        for (const p of plugins) {
            const key = pluginRefKey(p.ref);
            const isMember = key in members;
            const stateVal = isMember ? members[key] : false;

            new Setting(contentEl)
                .setName(`${p.name} (${key})`)
                .addToggle((toggle) => {
                    toggle.setValue(stateVal);
                    toggle.onChange((val) => {
                        this.fixture.members[key] = val;
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText(isMember ? 'Quitar miembro' : 'Añadir miembro')
                        .onClick(() => {
                            if (isMember) {
                                delete this.fixture.members[key];
                            } else {
                                this.fixture.members[key] = p.desired;
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
                        this.close();
                        await this.ui.runtime.save();
                        this.ui.showNotice(`Fixture ${this.fixture.name} guardado`);
                    });
            })
            .addButton((btn) => btn.setButtonText('Cerrar').onClick(() => this.close()));
    }
}
