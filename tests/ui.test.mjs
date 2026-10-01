import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// ---------------------------------------------------------------------------
// 1. Lightweight DOM Stub for Node Headless Execution
// ---------------------------------------------------------------------------

class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(...names) {
        for (const n of names) this.classes.add(n);
    }
    remove(...names) {
        for (const n of names) this.classes.delete(n);
    }
    contains(name) {
        return this.classes.has(name);
    }
    toggle(name, force) {
        if (force === undefined) {
            if (this.classes.has(name)) {
                this.classes.delete(name);
                return false;
            } else {
                this.classes.add(name);
                return true;
            }
        }
        if (force) this.classes.add(name);
        else this.classes.delete(name);
        return force;
    }
}

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.classList = new MockClassList();
        this.style = {};
        this._textContent = '';
        this._innerHTML = '';
        this.value = '';
        this.checked = false;
        this.type = '';
        this.placeholder = '';
        this.title = '';
        this.onclick = null;
        this.onchange = null;
        this.oninput = null;
        this.colSpan = 1;
        this.disabled = false;
    }

    get textContent() {
        if (this._textContent) return this._textContent;
        return this.children.map((c) => c.textContent).join('');
    }

    set textContent(val) {
        this._textContent = String(val);
        this.children = [];
    }

    get innerHTML() {
        return this._innerHTML || this.textContent;
    }

    set innerHTML(val) {
        this._innerHTML = String(val);
        this.children = [];
    }

    get className() {
        return Array.from(this.classList.classes).join(' ');
    }

    set className(val) {
        this.classList.classes.clear();
        if (val) {
            for (const c of val.split(/\s+/)) {
                if (c) this.classList.classes.add(c);
            }
        }
    }

    get firstChild() {
        return this.children[0] || null;
    }

    appendChild(child) {
        if (child.parentElement) {
            child.parentElement.removeChild(child);
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentElement = null;
        }
        return child;
    }

    insertBefore(newChild, refChild) {
        if (newChild.parentElement) {
            newChild.parentElement.removeChild(newChild);
        }
        newChild.parentElement = this;
        const idx = this.children.indexOf(refChild);
        if (idx === -1) {
            this.children.push(newChild);
        } else {
            this.children.splice(idx, 0, newChild);
        }
        return newChild;
    }

    querySelector(selector) {
        for (const child of this.children) {
            if (matchesSelector(child, selector)) return child;
            const found = child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }

    querySelectorAll(selector) {
        const results = [];
        for (const child of this.children) {
            if (matchesSelector(child, selector)) results.push(child);
            results.push(...child.querySelectorAll(selector));
        }
        return results;
    }

    empty() {
        this.children = [];
        this._textContent = '';
        this._innerHTML = '';
    }

    createEl(tag, attrs = {}) {
        const el = new MockElement(tag);
        if (attrs.cls) el.className = attrs.cls;
        if (attrs.text) el.textContent = attrs.text;
        this.appendChild(el);
        return el;
    }

    createDiv(attrs = {}) {
        return this.createEl('div', attrs);
    }

    createSpan(attrs = {}) {
        return this.createEl('span', attrs);
    }

    setText(text) {
        this.textContent = text;
    }

    setAttribute(name, value) {
        this[name] = String(value);
    }
}

function matchesSelector(el, selector) {
    if (selector.startsWith('.')) {
        return el.classList.contains(selector.slice(1));
    }
    if (selector.startsWith('#')) {
        return el.id === selector.slice(1);
    }
    return el.tagName.toLowerCase() === selector.toLowerCase();
}

// Global Document stub
globalThis.document = {
    createElement(tag) {
        return new MockElement(tag);
    },
    querySelector(selector) {
        return null;
    }
};

// ---------------------------------------------------------------------------
// 2. Obsidian Native Component Stubs
// ---------------------------------------------------------------------------

class MockApp {
    constructor() {
        this.setting = {
            settingTabs: [],
            pluginTabs: [],
            activeTab: null,
            communityPluginTabContainer: new MockElement('div'),
            open: function () {},
            openTabById: function () {}
        };
    }
}

class MockModal {
    constructor(app) {
        this.app = app;
        this.contentEl = new MockElement('div');
        this.titleEl = new MockElement('div');
        this.isOpen = false;
    }
    open() {
        this.isOpen = true;
        if (typeof this.onOpen === 'function') {
            this.onOpen();
        }
    }
    close() {
        this.isOpen = false;
        if (typeof this.onClose === 'function') {
            this.onClose();
        }
    }
}

class MockMenu {
    constructor() {
        this.items = [];
    }
    addItem(cb) {
        const item = {
            title: '',
            onClickCb: null,
            setTitle(t) {
                this.title = t;
                return this;
            },
            onClick(fn) {
                this.onClickCb = fn;
                return this;
            }
        };
        cb(item);
        this.items.push(item);
        return this;
    }
    showAtMouseEvent(e) {}
}

class MockNotice {
    constructor(msg, duration) {
        this.message = msg;
        this.duration = duration;
    }
}

class MockSetting {
    constructor(containerEl) {
        this.containerEl = containerEl;
        this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
        this.nameEl = this.settingEl.createDiv({ cls: 'setting-item-name' });
        this.descEl = this.settingEl.createDiv({ cls: 'setting-item-description' });
        this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    }
    setName(text) {
        this.nameEl.textContent = text;
        return this;
    }
    setDesc(text) {
        this.descEl.textContent = text;
        return this;
    }
    addToggle(cb) {
        const toggle = {
            val: false,
            changeCb: null,
            setValue(v) {
                this.val = v;
                return this;
            },
            onChange(fn) {
                this.changeCb = fn;
                return this;
            },
            setTooltip() {
                return this;
            }
        };
        cb(toggle);
        return this;
    }
    addDropdown(cb) {
        const dropdown = {
            options: {},
            val: '',
            changeCb: null,
            addOption(k, v) {
                this.options[k] = v;
                return this;
            },
            setValue(v) {
                this.val = v;
                return this;
            },
            getValue() {
                return this.val;
            },
            onChange(fn) {
                this.changeCb = fn;
                return this;
            }
        };
        cb(dropdown);
        return this;
    }
    addText(cb) {
        const text = {
            val: '',
            changeCb: null,
            setValue(v) {
                this.val = v;
                return this;
            },
            setPlaceholder() {
                return this;
            },
            onChange(fn) {
                this.changeCb = fn;
                return this;
            }
        };
        cb(text);
        return this;
    }
    addSlider(cb) {
        const slider = {
            val: 0,
            setLimits() {
                return this;
            },
            setValue(v) {
                this.val = v;
                return this;
            },
            setDynamicTooltip() {
                return this;
            },
            onChange(fn) {
                return this;
            }
        };
        cb(slider);
        return this;
    }
    addButton(cb) {
        const btn = {
            text: '',
            clickCb: null,
            disabled: false,
            setButtonText(t) {
                this.text = t;
                return this;
            },
            setCta() {
                return this;
            },
            setWarning() {
                return this;
            },
            setDisabled(d) {
                this.disabled = d;
                return this;
            },
            onClick(fn) {
                this.clickCb = fn;
                return this;
            }
        };
        cb(btn);
        return this;
    }
    addExtraButton(cb) {
        const extra = {
            setIcon() {
                return this;
            },
            setTooltip() {
                return this;
            },
            onClick() {
                return this;
            }
        };
        cb(extra);
        return this;
    }
}

function mockSetIcon(el, name) {
    if (el) el.dataset = { ...(el.dataset || {}), icon: name };
}

// ---------------------------------------------------------------------------
// 3. Register Hooks for Intercepting 'obsidian'
// ---------------------------------------------------------------------------

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'obsidian') {
            const obsidianStubCode = `
                export class App {
                    constructor() {
                        this.setting = globalThis.__mockSetting || {};
                    }
                }
                export class Modal {
                    constructor(app) {
                        this.app = app;
                        this.contentEl = globalThis.document.createElement('div');
                        this.titleEl = globalThis.document.createElement('div');
                    }
                    open() {
                        if (typeof this.onOpen === 'function') this.onOpen();
                    }
                    close() {
                        if (typeof this.onClose === 'function') this.onClose();
                    }
                }
                export class Menu {
                    constructor() {
                        this.items = [];
                    }
                    addItem(cb) {
                        const item = {
                            title: '',
                            onClickCb: null,
                            setTitle(t) { this.title = t; return this; },
                            onClick(fn) { this.onClickCb = fn; return this; }
                        };
                        cb(item);
                        this.items.push(item);
                        return this;
                    }
                    showAtMouseEvent(e) {}
                }
                export class Notice {
                    constructor(msg, duration) {
                        this.message = msg;
                        this.duration = duration;
                    }
                }
                export class Setting {
                    constructor(containerEl) {
                        this.containerEl = containerEl;
                        this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
                        this.nameEl = this.settingEl.createDiv({ cls: 'setting-item-name' });
                        this.descEl = this.settingEl.createDiv({ cls: 'setting-item-description' });
                        this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
                    }
                    setName(text) { this.nameEl.textContent = text; return this; }
                    setDesc(text) { this.descEl.textContent = text; return this; }
                    addToggle(cb) {
                        const toggle = {
                            val: false,
                            setValue(v) { this.val = v; return this; },
                            onChange(fn) { this.changeCb = fn; return this; },
                            setTooltip() { return this; }
                        };
                        cb(toggle);
                        return this;
                    }
                    addDropdown(cb) {
                        const dropdown = {
                            options: {},
                            val: '',
                            addOption(k, v) { this.options[k] = v; return this; },
                            setValue(v) { this.val = v; return this; },
                            getValue() { return this.val; },
                            onChange(fn) { this.changeCb = fn; return this; }
                        };
                        cb(dropdown);
                        return this;
                    }
                    addText(cb) {
                        const text = {
                            val: '',
                            setValue(v) { this.val = v; return this; },
                            setPlaceholder() { return this; },
                            onChange(fn) { this.changeCb = fn; return this; }
                        };
                        cb(text);
                        return this;
                    }
                    addSlider(cb) {
                        const slider = {
                            val: 0,
                            setLimits() { return this; },
                            setValue(v) { this.val = v; return this; },
                            setDynamicTooltip() { return this; },
                            onChange(fn) { this.changeCb = fn; return this; }
                        };
                        cb(slider);
                        return this;
                    }
                    addButton(cb) {
                        const btn = {
                            text: '',
                            disabled: false,
                            setButtonText(t) { this.text = t; return this; },
                            setCta() { return this; },
                            setWarning() { return this; },
                            setDisabled(d) { this.disabled = d; return this; },
                            onClick(fn) { this.clickCb = fn; return this; }
                        };
                        cb(btn);
                        return this;
                    }
                    addExtraButton(cb) {
                        const extra = {
                            setIcon() { return this; },
                            setTooltip() { return this; },
                            onClick() { return this; }
                        };
                        cb(extra);
                        return this;
                    }
                }
                export function setIcon(el, name) {
                    if (el) el.dataset = { ...(el.dataset || {}), icon: name };
                }
            `;
            return {
                shortCircuit: true,
                url: 'data:text/javascript,' + encodeURIComponent(obsidianStubCode)
            };
        }
        return nextResolve(specifier, context);
    }
});

// Import module under test
const {
    filterPlugins,
    pluginRefKey,
    ManagerUI,
    ProfileComparisonModal,
    TagMembershipModal,
    DeferredConfigModal,
    ManagerOptionsModal
} = await import('../src/integrated/ui.ts');

// ---------------------------------------------------------------------------
// 4. Test Suite Implementation
// ---------------------------------------------------------------------------

describe('AIgility Plugin Manager - UI & Filter Test Suite', () => {

    // Helper to generate effective plugins
    function createSamplePlugins() {
        return [
            {
                ref: { kind: 'community', id: 'dataview' },
                name: 'Dataview',
                version: '0.5.64',
                installed: true,
                compatible: true,
                nativeAutostart: true,
                loaded: true,
                desired: true,
                tags: ['pkm', 'query'],
                group: 'core-tools',
                scheduled: false
            },
            {
                ref: { kind: 'community', id: 'omnisearch' },
                name: 'Omnisearch',
                version: '1.24.1',
                installed: true,
                compatible: true,
                nativeAutostart: false,
                loaded: false,
                desired: true,
                tags: ['search', 'pkm'],
                group: 'search-tools',
                scheduled: true
            },
            {
                ref: { kind: 'core', id: 'file-explorer' },
                name: 'File Explorer',
                version: '1.8.0',
                installed: true,
                compatible: true,
                nativeAutostart: true,
                loaded: true,
                desired: true,
                tags: ['navigation'],
                group: 'core-system',
                scheduled: false
            },
            {
                ref: { kind: 'core', id: 'graph' },
                name: 'Graph View',
                version: '1.8.0',
                installed: true,
                compatible: true,
                nativeAutostart: false,
                loaded: false,
                desired: false,
                tags: ['visualization'],
                group: 'core-system',
                scheduled: false
            }
        ];
    }

    describe('Pure Filter Function (filterPlugins)', () => {
        const plugins = createSamplePlugins();

        test('Filters by kind: community', () => {
            const results = filterPlugins(plugins, { kind: 'community' });
            assert.equal(results.length, 2);
            assert.ok(results.every((p) => p.ref.kind === 'community'));
        });

        test('Filters by kind: core', () => {
            const results = filterPlugins(plugins, { kind: 'core' });
            assert.equal(results.length, 2);
            assert.ok(results.every((p) => p.ref.kind === 'core'));
        });

        test('Filters by kind: all', () => {
            const results = filterPlugins(plugins, { kind: 'all' });
            assert.equal(results.length, 4);
        });

        test('Filters by tag membership', () => {
            const pkmResults = filterPlugins(plugins, { tag: 'pkm' });
            assert.equal(pkmResults.length, 2);
            assert.deepEqual(pkmResults.map((p) => p.ref.id), ['dataview', 'omnisearch']);

            const navResults = filterPlugins(plugins, { tag: 'navigation' });
            assert.equal(navResults.length, 1);
            assert.equal(navResults[0].ref.id, 'file-explorer');

            const emptyResults = filterPlugins(plugins, { tag: 'non-existent' });
            assert.equal(emptyResults.length, 0);
        });

        test('Filters by group assignment', () => {
            const coreSystem = filterPlugins(plugins, { group: 'core-system' });
            assert.equal(coreSystem.length, 2);
            assert.deepEqual(coreSystem.map((p) => p.ref.id), ['file-explorer', 'graph']);

            const searchGroup = filterPlugins(plugins, { group: 'search-tools' });
            assert.equal(searchGroup.length, 1);
            assert.equal(searchGroup[0].ref.id, 'omnisearch');
        });

        test('Filters by search substring (name case-insensitive)', () => {
            const results = filterPlugins(plugins, { search: 'DATA' });
            assert.equal(results.length, 1);
            assert.equal(results[0].ref.id, 'dataview');

            const graphResults = filterPlugins(plugins, { search: 'view' });
            // 'Dataview' and 'Graph View' both match 'view'
            assert.equal(graphResults.length, 2);
        });

        test('Filters by search substring (ID case-insensitive)', () => {
            const results = filterPlugins(plugins, { search: 'omni' });
            assert.equal(results.length, 1);
            assert.equal(results[0].ref.id, 'omnisearch');
        });

        test('Filters with combined criteria (kind + tag + group + search)', () => {
            const combined = filterPlugins(plugins, {
                kind: 'community',
                tag: 'pkm',
                group: 'core-tools',
                search: 'data'
            });
            assert.equal(combined.length, 1);
            assert.equal(combined[0].ref.id, 'dataview');

            // Non-matching tag combination
            const nonMatch = filterPlugins(plugins, {
                kind: 'community',
                tag: 'navigation'
            });
            assert.equal(nonMatch.length, 0);
        });

        test('Large catalog memory and performance test (800+ plugins)', () => {
            // Per CONTRACT.md: "Include at least 723 installed IDs for catalog memory test."
            const largeCatalog = [];
            for (let i = 1; i <= 800; i++) {
                largeCatalog.push({
                    ref: {
                        kind: i % 10 === 0 ? 'core' : 'community',
                        id: `plugin-${i}`
                    },
                    name: `Plugin Number ${i}`,
                    version: `1.${i % 50}.0`,
                    installed: true,
                    compatible: true,
                    nativeAutostart: i % 2 === 0,
                    loaded: i % 3 === 0,
                    desired: i % 2 === 0,
                    tags: [`tag-${i % 10}`, `category-${i % 5}`],
                    group: `group-${i % 8}`,
                    scheduled: i % 7 === 0
                });
            }

            const startTime = performance.now();
            const filtered = filterPlugins(largeCatalog, {
                kind: 'community',
                tag: 'tag-3',
                group: 'group-3',
                search: 'plugin number 3'
            });
            const durationMs = performance.now() - startTime;

            assert.ok(filtered.length > 0);
            assert.ok(durationMs < 50, `Filtering took ${durationMs}ms, expected < 50ms`);
            assert.ok(filtered.every((p) => p.ref.kind === 'community'));
            assert.ok(filtered.every((p) => p.tags.includes('tag-3')));
        });
    });

    describe('ManagerUI Lifecycle and DOM Wrapping', () => {
        let mockApp;
        let mockRuntime;
        let mockGithub;
        let mockDebug;
        let ui;
        let communityTab;

        beforeEach(() => {
            mockApp = new MockApp();

            // Set up community-plugins setting tab
            const containerEl = new MockElement('div');
            // Add native setting items
            const restrictedItem = containerEl.createDiv({ cls: 'setting-item' });
            restrictedItem.createDiv({ cls: 'setting-item-name' }).textContent = 'Restricted mode';
            const browseItem = containerEl.createDiv({ cls: 'setting-item' });
            browseItem.createDiv({ cls: 'setting-item-name' }).textContent = 'Browse community plugins';
            const installedGroup = containerEl.createDiv({ cls: 'setting-group' });
            installedGroup.style.display = 'grid';
            const installedHeader = installedGroup.createDiv({ cls: 'setting-group-heading' });
            installedHeader.textContent = 'Installed plugins';
            const installedList = installedGroup.createDiv({ cls: 'setting-group-list' });
            const nativePluginA = installedList.createDiv({ cls: 'setting-item' });
            nativePluginA.createDiv({ cls: 'setting-item-name' }).textContent = 'Sample Plugin Native Item';

            communityTab = {
                id: 'community-plugins',
                containerEl,
                renderedItems: [{
                    type: 'list',
                    def: { heading: 'Installed plugins' },
                    groupEl: installedGroup,
                    settingGroup: { listEl: installedList },
                    children: [nativePluginA]
                }],
                display: function () {
                    this._displayed = true;
                }
            };

            const editorTab = {
                id: 'editor',
                name: 'Editor',
                containerEl: new MockElement('div')
            };

            mockApp.setting.settingTabs = [communityTab, editorTab];

            // Plugin setting tabs in sidebar
            const pluginTabDataview = {
                id: 'dataview',
                name: 'Dataview',
                navEl: new MockElement('div')
            };
            const pluginTabOmnisearch = {
                id: 'omnisearch',
                name: 'Omnisearch',
                navEl: new MockElement('div')
            };
            mockApp.setting.pluginTabs = [pluginTabDataview, pluginTabOmnisearch];

            mockRuntime = {
                state: {
                    schemaVersion: 1,
                    records: {
                        'community:dataview': {
                            ref: { kind: 'community', id: 'dataview' },
                            name: 'Dataview',
                            version: '0.5.64',
                            tags: ['pkm'],
                            group: 'tools',
                            desired: true,
                            metadata: {}
                        },
                        'community:omnisearch': {
                            ref: { kind: 'community', id: 'omnisearch' },
                            name: 'Omnisearch',
                            version: '1.24.1',
                            tags: ['search'],
                            group: 'search',
                            desired: false,
                            metadata: {}
                        }
                    },
                    tags: [
                        { id: 'pkm', name: 'PKM' },
                        { id: 'search', name: 'Search' }
                    ],
                    groups: [
                        { id: 'tools', name: 'Tools' },
                        { id: 'search', name: 'Search' }
                    ],
                    deviceProfiles: [],
                    fixtureProfiles: [],
                    deferred: [],
                    protected: ['aigility-plugin-manager'],
                    profileBackups: [],
                    githubSources: {},
                    settings: { staggerMs: 200, automaticUpdates: false }
                },
                local: {},
                list: () => createSamplePlugins(),
                save: async () => {},
                setEnabled: async (ref, enabled) => {},
                setTags: async (ref, tags) => {},
                setGroup: async (ref, group) => {},
                bindProfile: async (id) => {},
                resume: async () => {},
                previewProfile: async (id) => [],
                applyProfile: async (id) => {},
                undoProfile: async () => {},
                writeEffectiveState: async () => {}
            };

            mockGithub = {
                releases: async () => [],
                install: async () => '1.0.0',
                rollback: async () => {},
                checkAll: async () => [],
                setPin: async () => {}
            };

            mockDebug = {
                start: async () => {},
                testHalf: async () => {},
                previous: async () => {},
                testPair: async () => {},
                observe: async () => {},
                finish: async () => {},
                exportReports: async () => ({ markdown: '', json: '' }),
                advanced: async () => {},
                dispose: () => {}
            };

            const mockPlugin = { app: mockApp };
            ui = new ManagerUI(mockPlugin, mockRuntime, mockGithub, mockDebug);
        });

        test('ui.install() wraps community tab display and patches setting.open', () => {
            const originalSettingOpen = mockApp.setting.open;
            ui.install();

            // Check that setting.open was wrapped
            assert.notEqual(mockApp.setting.open, originalSettingOpen);

            // Execute wrapped tab display
            communityTab.display();

            // Native installed section should be hidden, but restricted and browse remain
            const items = communityTab.containerEl.querySelectorAll('.setting-item');
            assert.equal(items[0].style.display, undefined); // Restricted mode preserved
            assert.equal(items[1].style.display, undefined); // Browse preserved
            assert.equal(items.length, 3); // Installed heading is not a setting-item
            assert.equal(communityTab.renderedItems[0].groupEl.style.display, 'none');
            assert.equal(items[2].style.display, undefined); // Hidden with its containing native group
            assert.ok(items[2].querySelector('.setting-item-name').textContent.includes('Sample Plugin Native Item'));

            // Manager container should be mounted
            const installedContainer = communityTab.containerEl.querySelector(
                '.aigility-manager-installed-container'
            );
            assert.ok(installedContainer !== null);
            assert.ok(installedContainer.querySelector('.aigility-manager-root') !== null);
        });

        test('unknown native renderedItems shape keeps the native list and reports visibly', () => {
            communityTab.renderedItems = [{
                type: 'section',
                def: { heading: 'Installed plugins' },
                groupEl: communityTab.renderedItems[0].groupEl
            }];

            ui.install();
            communityTab.display();

            assert.equal(communityTab.renderedItems[0].groupEl.style.display, 'grid');
            assert.ok(communityTab.containerEl.querySelector('.setting-item-name').textContent.includes('Restricted mode'));
            assert.equal(communityTab.containerEl.querySelector('.aigility-manager-installed-container'), null);
            const diagnostic = communityTab.containerEl.querySelector('.aigility-ui-diagnostic');
            assert.ok(diagnostic);
            assert.ok(diagnostic.textContent.includes('Se conserva la lista de Obsidian'));
        });

        test('repeated display and dispose restore exact native styles and method identities', () => {
            const originalDisplay = communityTab.display;
            const originalOpen = mockApp.setting.open;

            ui.install();
            communityTab.display();
            communityTab.display();

            assert.equal(communityTab.containerEl.querySelectorAll('.aigility-manager-installed-container').length, 1);
            assert.equal(communityTab.renderedItems[0].groupEl.style.display, 'none');

            ui.dispose();

            assert.equal(communityTab.display, originalDisplay);
            assert.equal(mockApp.setting.open, originalOpen);
            assert.equal(communityTab.renderedItems[0].groupEl.style.display, 'grid');
            assert.equal(communityTab.containerEl.querySelector('.aigility-manager-installed-container'), null);
            assert.equal(communityTab.containerEl.querySelector('.aigility-ui-diagnostic'), null);
        });

        test('dispose preserves a wrapper installed later by another plugin', () => {
            ui.install();
            const aigilityDisplay = communityTab.display;
            const aigilityOpen = mockApp.setting.open;
            const otherDisplay = function (...args) {
                return aigilityDisplay.apply(communityTab, args);
            };
            const otherOpen = function (...args) {
                return aigilityOpen.apply(mockApp.setting, args);
            };
            communityTab.display = otherDisplay;
            mockApp.setting.open = otherOpen;

            ui.dispose();

            assert.equal(communityTab.display, otherDisplay);
            assert.equal(mockApp.setting.open, otherOpen);
            communityTab.display();
            mockApp.setting.open();
            assert.equal(communityTab.containerEl.querySelector('.aigility-manager-installed-container'), null);
            assert.equal(communityTab.renderedItems[0].groupEl.style.display, 'grid');
        });

        test('dispose preserves a native display change made while the group is hidden', () => {
            ui.install();
            communityTab.display();
            const groupEl = communityTab.renderedItems[0].groupEl;
            groupEl.style.display = 'inline-grid';

            ui.dispose();

            assert.equal(groupEl.style.display, 'inline-grid');
        });

        test('ui.patchSidebar injects Opciones button and search/tag/group filters', () => {
            ui.install();

            const headerContainer = mockApp.setting.communityPluginTabContainer;
            const controls = headerContainer.querySelector('.aigility-sidebar-header-controls');
            assert.ok(controls !== null);

            const optionsBtn = controls.querySelector('.aigility-options-btn');
            assert.ok(optionsBtn !== null);
            assert.ok(optionsBtn.textContent.includes('Opciones'));

            const searchInput = controls.querySelector('.aigility-sidebar-search');
            assert.ok(searchInput !== null);

            const tagSelect = controls.querySelector('.aigility-sidebar-tag-select');
            assert.ok(tagSelect !== null);

            const groupSelect = controls.querySelector('.aigility-sidebar-group-select');
            assert.ok(groupSelect !== null);
        });

        test('applySidebarFilter filters ONLY plugin tabs without touching core/general tabs', () => {
            ui.install();

            // Set sidebar search filter to 'dataview'
            ui.sidebarFilterCriteria.search = 'dataview';
            ui.applySidebarFilter(mockApp.setting);

            const [dataviewTab, omnisearchTab] = mockApp.setting.pluginTabs;
            assert.equal(dataviewTab.navEl.style.display, '');
            assert.equal(omnisearchTab.navEl.style.display, 'none');

            // General setting tabs (e.g. 'editor') have NO navEl hidden!
            const editorTab = mockApp.setting.settingTabs.find((t) => t.id === 'editor');
            assert.equal(editorTab.containerEl.style.display, undefined);
        });

        test('ui.dispose() cleanly unwraps display and restores DOM and sidebar tabs', () => {
            ui.install();
            communityTab.display();

            // Hide omnisearch tab via filter
            ui.sidebarFilterCriteria.search = 'dataview';
            ui.applySidebarFilter(mockApp.setting);

            // Now dispose
            ui.dispose();

            // Native installed group and its original display value are restored
            const items = communityTab.containerEl.querySelectorAll('.setting-item');
            assert.equal(items[2].style.display, undefined);
            assert.equal(communityTab.renderedItems[0].groupEl.style.display, 'grid');

            // Installed container removed
            assert.equal(
                communityTab.containerEl.querySelector('.aigility-manager-installed-container'),
                null
            );

            // Sidebar tabs restored
            const [dataviewTab, omnisearchTab] = mockApp.setting.pluginTabs;
            assert.equal(dataviewTab.navEl.style.display, '');
            assert.equal(omnisearchTab.navEl.style.display, '');

            // Sidebar header controls removed
            assert.equal(
                mockApp.setting.communityPluginTabContainer.querySelector(
                    '.aigility-sidebar-header-controls'
                ),
                null
            );
        });
    });

    describe('Modals & Action Contracts', () => {
        let mockApp;
        let mockRuntime;
        let mockGithub;
        let mockDebug;
        let ui;

        beforeEach(() => {
            mockApp = new MockApp();
            mockRuntime = {
                state: {
                    schemaVersion: 1,
                    records: {},
                    tags: [{ id: 'pkm', name: 'PKM' }],
                    groups: [{ id: 'tools', name: 'Tools' }],
                    deviceProfiles: [
                        { id: 'desktop', name: 'Desktop', tagIds: ['pkm'], applyAtStart: true }
                    ],
                    fixtureProfiles: [
                        {
                            id: 'test-fixture',
                            name: 'Test Fixture',
                            members: { 'community:dataview': true, 'core:graph': false }
                        }
                    ],
                    deferred: [{ id: 'omnisearch', delayMs: 1500, enabled: true, parked: false }],
                    protected: ['aigility-plugin-manager'],
                    profileBackups: [],
                    githubSources: {},
                    settings: { staggerMs: 250, automaticUpdates: false }
                },
                local: {},
                list: () => createSamplePlugins(),
                save: async () => {
                    mockRuntime._saved = true;
                },
                setEnabled: async (ref, enabled) => {
                    mockRuntime._lastSetEnabled = { ref, enabled };
                },
                setTags: async (ref, tags) => {
                    mockRuntime._lastSetTags = { ref, tags };
                },
                setGroup: async () => {},
                bindProfile: async () => {},
                resume: async () => {
                    mockRuntime._resumed = true;
                },
                previewProfile: async () => [],
                applyProfile: async (id) => {
                    mockRuntime._lastAppliedProfile = id;
                },
                undoProfile: async () => {},
                writeEffectiveState: async () => {}
            };
            mockGithub = {
                releases: async () => [],
                install: async () => '',
                rollback: async () => {},
                checkAll: async () => [],
                setPin: async () => {}
            };
            mockDebug = {
                start: async () => {},
                testHalf: async () => {},
                previous: async () => {},
                testPair: async () => {},
                observe: async () => {},
                finish: async () => {},
                exportReports: async () => ({ markdown: '', json: '' }),
                advanced: async () => {},
                dispose: () => {}
            };
            ui = new ManagerUI({ app: mockApp }, mockRuntime, mockGithub, mockDebug);
        });

        test('Tag editing updates tags via runtime.setTags and NEVER auto-applies profile', async () => {
            const pluginItem = createSamplePlugins()[0]; // Dataview
            const modal = new TagMembershipModal(mockApp, ui, pluginItem);

            assert.equal(typeof modal.onOpen, 'function');
            // Simulate saving new tags
            await mockRuntime.setTags(pluginItem.ref, ['pkm', 'custom']);

            assert.deepEqual(mockRuntime._lastSetTags, {
                ref: { kind: 'community', id: 'dataview' },
                tags: ['pkm', 'custom']
            });
            // Profile should NOT have been applied
            assert.equal(mockRuntime._lastAppliedProfile, undefined);
        });

        test('ProfileComparisonModal executes apply callback on confirm', async () => {
            const changes = [
                { ref: { kind: 'community', id: 'omnisearch' }, before: false, after: true },
                { ref: { kind: 'core', id: 'graph' }, before: true, after: false }
            ];

            let confirmed = false;
            const modal = new ProfileComparisonModal(mockApp, changes, async () => {
                confirmed = true;
            });

            modal.onOpen();
            const table = modal.contentEl.querySelector('table');
            assert.ok(table !== null);

            // Simulate clicking confirm button
            const confirmBtn = modal.contentEl.querySelector('.mod-cta');
            assert.ok(confirmBtn !== null);
            await confirmBtn.onclick();

            assert.equal(confirmed, true);
        });

        test('Recovery banner renders when recoveryReason exists and reanudar calls runtime.resume()', async () => {
            mockRuntime.local.recoveryReason = 'Interrupted migration';

            const container = new MockElement('div');
            ui.display(container);

            const banner = container.querySelector('.aigility-recovery-banner');
            assert.ok(banner !== null);
            assert.ok(banner.textContent.includes('Interrupted migration'));

            const resumeBtn = banner.querySelector('button');
            assert.ok(resumeBtn !== null);
            await resumeBtn.onclick();

            assert.equal(mockRuntime._resumed, true);
        });

        test('Options modal sections render correctly without error', () => {
            const optionsModal = new ManagerOptionsModal(mockApp, ui);
            optionsModal.onOpen();

            const navTabs = optionsModal.contentEl.querySelectorAll('.aigility-nav-tab');
            assert.equal(navTabs.length, 6);

            const expectedLabels = [
                'Perfiles',
                'Fixtures y Protecciones',
                'Carga Diferida',
                'GitHub y Betas',
                'Depuración',
                'Avanzado y Recuperación'
            ];
            const renderedLabels = navTabs.map((t) => t.textContent);
            assert.deepEqual(renderedLabels, expectedLabels);
        });

        test('DeferredConfigModal updates runtime.state.deferred and saves', async () => {
            const pluginItem = createSamplePlugins()[0]; // Dataview
            const modal = new DeferredConfigModal(mockApp, ui, pluginItem);

            modal.onOpen();
            // Verify setting elements created
            const settings = modal.contentEl.querySelectorAll('.setting-item');
            assert.ok(settings.length >= 3);

            // Simulate saving deferred policy
            const state = mockRuntime.state;
            state.deferred.push({ id: 'dataview', delayMs: 2000, enabled: true, parked: false });
            await mockRuntime.save();

            assert.equal(mockRuntime._saved, true);
            const found = state.deferred.find((p) => p.id === 'dataview');
            assert.ok(found !== undefined);
            assert.equal(found.delayMs, 2000);
            assert.equal(found.enabled, true);
        });

        test('Fixture partial apply updates exact desired states without touching others', async () => {
            const fixture = mockRuntime.state.fixtureProfiles[0];
            assert.ok(fixture !== undefined);

            const appliedStates = {};
            mockRuntime.setEnabled = async (ref, desired) => {
                appliedStates[`${ref.kind}:${ref.id}`] = desired;
            };

            // Partial apply implementation per CONTRACT
            for (const [pluginId, desiredState] of Object.entries(fixture.members || {})) {
                const kind = pluginId.startsWith('core:') ? 'core' : 'community';
                const cleanId = pluginId.replace(/^(core|community):/, '');
                await mockRuntime.setEnabled({ kind, id: cleanId }, desiredState);
            }

            assert.equal(appliedStates['community:dataview'], true);
            assert.equal(appliedStates['core:graph'], false);
            // Non-member plugins are not in appliedStates
            assert.equal(appliedStates['community:omnisearch'], undefined);
        });

        test('DebugManager testPair and candidate selection modal behavior', async () => {
            let startedWithRefs = null;
            let pairTested = null;

            mockDebug.start = async (refs) => {
                startedWithRefs = refs;
            };
            mockDebug.testPair = async (a, b) => {
                pairTested = { a, b };
            };

            const optionsModal = new ManagerOptionsModal(mockApp, ui);
            optionsModal['activeSection'] = 'debug';

            // Test pair execution
            const refA = { kind: 'community', id: 'dataview' };
            const refB = { kind: 'community', id: 'omnisearch' };
            await mockDebug.testPair(refA, refB);

            assert.deepEqual(pairTested, { a: refA, b: refB });

            // Start debug session with candidate subset
            const candidates = [{ kind: 'community', id: 'dataview' }];
            await mockDebug.start(candidates);
            assert.deepEqual(startedWithRefs, candidates);
        });
    });
});
