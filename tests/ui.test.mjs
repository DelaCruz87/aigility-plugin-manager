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

    // Standard DOM Element.remove(), present in the real Obsidian renderer.
    remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
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
        // Host 1.14.3 core plugin registry: id -> core plugin info.
        this.internalPlugins = { plugins: {} };
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
        if (specifier === './archive-ui' && context.parentURL?.endsWith('/src/integrated/ui.ts')) {
            return nextResolve('./archive-ui.ts', context);
        }
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
                    showAtMouseEvent(e) { globalThis.__aigilityLastMenu = this; }
                }
                export class Notice {
                    constructor(msg, duration) {
                        this.message = msg;
                        this.duration = duration;
                        (globalThis.__aigilityNotices = globalThis.__aigilityNotices || []).push(msg);
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
                        const el = this.controlEl.createEl('label');
                        el.className = 'mock-toggle';
                        const toggle = {
                            val: false,
                            changeCb: null,
                            setValue(v) { this.val = v; el.checked = Boolean(v); return this; },
                            onChange(fn) { this.changeCb = fn; return this; },
                            setDisabled(d) { el.disabled = Boolean(d); return this; },
                            setTooltip() { return this; }
                        };
                        cb(toggle);
                        el.checked = Boolean(toggle.val);
                        // Click simulation: flips the checkbox and fires the binding.
                        el.onclick = () => {
                            el.checked = !el.checked;
                            toggle.val = el.checked;
                            return toggle.changeCb && toggle.changeCb(el.checked);
                        };
                        return this;
                    }
                    addDropdown(cb) {
                        const el = this.controlEl.createEl('select');
                        el.className = 'mock-dropdown';
                        el.options = {};
                        const dropdown = {
                            options: el.options,
                            val: '',
                            changeCb: null,
                            addOption(k, v) { this.options[k] = v; return this; },
                            setValue(v) { this.val = v; el.value = v; return this; },
                            getValue() { return this.val; },
                            setDisabled(d) { el.disabled = Boolean(d); return this; },
                            onChange(fn) { this.changeCb = fn; return this; }
                        };
                        cb(dropdown);
                        el.value = dropdown.val;
                        el.onchange = () => dropdown.changeCb && dropdown.changeCb(el.value);
                        return this;
                    }
                    addText(cb) {
                        const el = this.controlEl.createEl('input');
                        el.className = 'mock-text';
                        const text = {
                            val: '',
                            changeCb: null,
                            setValue(v) { this.val = v; el.value = v; return this; },
                            setPlaceholder(p) { el.placeholder = p; return this; },
                            setDisabled(d) { el.disabled = Boolean(d); return this; },
                            onChange(fn) { this.changeCb = fn; return this; }
                        };
                        cb(text);
                        el.value = text.val;
                        el.oninput = () => text.changeCb && text.changeCb(el.value);
                        return this;
                    }
                    addSlider(cb) {
                        const el = this.controlEl.createEl('input');
                        el.className = 'mock-slider';
                        const slider = {
                            val: 0,
                            changeCb: null,
                            setLimits() { return this; },
                            setValue(v) { this.val = v; el.value = String(v); return this; },
                            setDynamicTooltip() { return this; },
                            setDisabled(d) { el.disabled = Boolean(d); return this; },
                            onChange(fn) { this.changeCb = fn; return this; }
                        };
                        cb(slider);
                        el.value = String(slider.val);
                        el.oninput = () => slider.changeCb && slider.changeCb(Number(el.value));
                        return this;
                    }
                    addButton(cb) {
                        const el = this.controlEl.createEl('button');
                        el.className = 'mock-button';
                        const btn = {
                            text: '',
                            disabled: false,
                            clickCb: null,
                            setButtonText(t) { this.text = t; el.textContent = t; return this; },
                            setCta() { return this; },
                            setWarning() { return this; },
                            setDisabled(d) { this.disabled = Boolean(d); el.disabled = Boolean(d); return this; },
                            onClick(fn) { this.clickCb = fn; return this; }
                        };
                        cb(btn);
                        el.textContent = btn.text;
                        el.disabled = Boolean(btn.disabled);
                        el.onclick = () => btn.clickCb && btn.clickCb();
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
    parsePluginRefKey,
    ManagerUI,
    ProfileComparisonModal,
    TagMembershipModal,
    DeferredConfigModal,
    GitHubReleasesModal,
    ManagerOptionsModal
} = await import('../src/integrated/ui.ts');

// ---------------------------------------------------------------------------
// 3.5 Fake Serial Queue Runtime (transaction contract)
// ---------------------------------------------------------------------------

function baseManagerState(overrides = {}) {
    return {
        schemaVersion: 1,
        records: {},
        tags: [{ id: 'pkm', name: 'PKM' }],
        groups: [{ id: 'tools', name: 'Tools' }],
        deviceProfiles: [],
        fixtureProfiles: [],
        deferred: [],
        protected: ['aigility-plugin-manager'],
        profileBackups: [],
        githubSources: {},
        settings: { staggerMs: 200, automaticUpdates: false },
        ...overrides
    };
}

/**
 * Fake runtime with the REAL serial-queue semantics: enqueue chains one slot
 * at a time, tx.refresh() returns a fresh clone of the disk copy, tx.save()
 * persists runtime.state back to disk, and any enqueue issued while another
 * slot is active is recorded as a nested-queue violation. UI writes must
 * serialize through this queue, pause through runtime.pause() inside the
 * queued mutation, and never call public save()/enqueue() from a transaction.
 */
function createQueuedRuntime(seed, options = {}) {
    const runtime = {
        state: JSON.parse(JSON.stringify(seed)),
        disk: JSON.parse(JSON.stringify(seed)),
        local: {},
        log: [],
        pauses: [],
        nestedEnqueues: [],
        setEnabledCalls: [],
        reconciled: [],
        _activeLabel: null
    };
    runtime.pause = (reason) => {
        runtime.pauses.push(String(reason));
        runtime.log.push('pause');
    };
    runtime.resume = async () => {
        runtime._resumed = true;
    };
    runtime.bindProfile = async (id) => {
        runtime._lastBind = id;
        if (id) runtime.local.deviceProfileId = id;
        else delete runtime.local.deviceProfileId;
    };
    runtime.setTags = async (ref, tags) => {
        runtime._lastSetTags = { ref, tags };
    };
    runtime.setGroup = async (ref, group) => {
        runtime._lastSetGroup = { ref, group };
    };
    runtime.previewProfile = async () => [];
    runtime.applyProfile = async (id) => {
        runtime._lastAppliedProfile = id;
    };
    runtime.undoProfile = async () => {};
    runtime.list = options.list ?? (() => []);
    runtime.save = () => runtime.enqueue('save-state', (tx) => tx.save());
    runtime.writeEffectiveState = () => runtime.enqueue('write-effective-state', (tx) => tx.writeEffectiveState());

    let queue = Promise.resolve();
    runtime.enqueue = (label, operation) => {
        if (runtime._activeLabel) {
            runtime.nestedEnqueues.push({ inside: runtime._activeLabel, label });
        }
        const run = queue.then(async () => {
            runtime._activeLabel = label;
            runtime.log.push(`begin:${label}`);
            const tx = {
                refresh: async () => {
                    runtime.state = JSON.parse(JSON.stringify(runtime.disk));
                    runtime.log.push(`refresh:${label}`);
                    return runtime.state;
                },
                save: async () => {
                    runtime.log.push(`save:${label}`);
                    runtime.disk = JSON.parse(JSON.stringify(runtime.state));
                },
                writeEffectiveState: async () => {
                    runtime.log.push(`effective:${label}`);
                },
                setEnabled: async (ref, enabled, opts) => {
                    runtime.log.push(`setEnabled:${ref.kind}:${ref.id}:${enabled}`);
                    runtime.setEnabledCalls.push({ ref: { ...ref }, enabled: Boolean(enabled), options: opts ?? null });
                }
            };
            if (options.reconcileImpl) {
                tx.reconcileDeferred = async (ref) => options.reconcileImpl(ref, tx);
            } else if (options.reconcileDeferred !== false) {
                tx.reconcileDeferred = async (ref) => {
                    runtime.log.push(`reconcileDeferred:${ref.kind}:${ref.id}`);
                    runtime.reconciled.push(`${ref.kind}:${ref.id}`);
                };
            }
            try {
                return await operation(tx);
            } finally {
                runtime._activeLabel = null;
                runtime.log.push(`end:${label}`);
            }
        });
        queue = run.then(() => undefined, () => undefined);
        return run;
    };
    return runtime;
}

/**
 * Strong fake for the deferred-reconciliation contract. The default
 * createQueuedRuntime stub only records the call, which cannot tell an ordering
 * bug apart from a correct one: calling reconcileDeferred() BEFORE the policy
 * mutation looks identical in a call log. This one models the REAL runtime
 * semantics (runtime.ts reconcileDeferredInternal):
 *
 * - it reads the policy from the CURRENT state at call time and returns without
 *   touching the host when no ENABLED policy exists yet;
 * - it refuses a protected ref and a core ref;
 * - it excludes native autostart through the host and unloads while loaded.
 *
 * Every call records what it observed (native before/after, unloaded, and the
 * policy as it was AT the call), so a save that claims a deferment it never
 * enforced becomes visible instead of silently passing.
 */
function createStrongDeferredRuntime(seed, host, options = {}) {
    const runtime = createQueuedRuntime(seed, {
        ...options,
        reconcileImpl: async (ref) => {
            if (typeof options.reconcileImpl === 'function') return options.reconcileImpl(ref);
            const k = `${ref.kind}:${ref.id}`;
            runtime.log.push(`reconcileDeferred:${k}`);
            const entry = host.plugins[k];
            const policy = (runtime.state.deferred ?? []).find((item) => item.id === ref.id) ?? null;
            const call = {
                key: k,
                policyAtCall: policy
                    ? { enabled: Boolean(policy.enabled), delayMs: policy.delayMs, parked: Boolean(policy.parked) }
                    : null,
                nativeBefore: entry ? entry.nativeAutostart : null,
                nativeAfter: entry ? entry.nativeAutostart : null,
                loadedBefore: entry ? entry.loaded : null,
                unloaded: false,
                desiredBefore: entry ? entry.desired : null,
                desiredAfter: entry ? entry.desired : null
            };
            runtime.reconcileCalls.push(call);
            // No enabled policy yet: the real runtime cancels the timer only and
            // returns, leaving native autostart exactly as it was.
            if (!policy?.enabled) return;
            if ((runtime.state.protected ?? []).includes(k) || k === 'community:aigility-plugin-manager') {
                throw new Error(`Deferred policy for protected plugin ${k} conflicts with its protection and cannot be reconciled.`);
            }
            if (ref.kind === 'core') {
                throw new Error(`Core plugin ${k} cannot be deferred: core exclusion changes the persistent native flag.`);
            }
            if (!entry || !entry.installed) throw new Error(`Plugin ${k} is not installed, deferred exclusion cannot be reconciled.`);
            entry.nativeAutostart = false;
            call.nativeAfter = false;
            if (entry.loaded) {
                entry.loaded = false;
                call.unloaded = true;
                runtime.unloaded.push(k);
            }
            // desired is never a side effect of a policy edit.
            call.desiredAfter = entry.desired;
        }
    });
    runtime.reconcileCalls = [];
    runtime.unloaded = [];
    return runtime;
}

function buttonsByText(root, text) {
    return [...root.querySelectorAll('.mock-button')].filter((btn) => btn.textContent === text);
}

function settingByName(root, nameText) {
    return [...root.querySelectorAll('.setting-item')].find((setting) => {
        const name = setting.querySelector('.setting-item-name');
        return name && name.textContent === nameText;
    }) ?? null;
}

function settingByDescFragment(root, fragment) {
    return [...root.querySelectorAll('.setting-item')].find((setting) => {
        const desc = setting.querySelector('.setting-item-description');
        return desc && desc.textContent.includes(fragment);
    }) ?? null;
}

function toggleInSetting(root, nameText) {
    const setting = settingByName(root, nameText);
    return setting ? setting.querySelector('.mock-toggle') : null;
}

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

        test('install leaves native Settings and Community methods unchanged', () => {
            const open = mockApp.setting.open;
            const display = communityTab.display;
            ui.install(); ui.install();
            assert.equal(mockApp.setting.open, open);
            assert.equal(communityTab.display, display);
            assert.equal(communityTab.containerEl.querySelector('.aigility-manager-root'), null);
        });
        test('native rendering retains this, return value and exception behavior', () => {
            const expected = new Error('native render failure');
            communityTab.renderTab = function () { assert.equal(this, communityTab); return 42; };
            communityTab.update = function () { throw expected; };
            const render = communityTab.renderTab, update = communityTab.update;
            ui.install();
            assert.equal(communityTab.renderTab(), 42);
            assert.throws(() => communityTab.update(), error => error === expected);
            assert.equal(communityTab.renderTab, render); assert.equal(communityTab.update, update);
        });
        test('native list nodes and styles survive own list open, filter, refresh and dispose', () => {
            const group = communityTab.renderedItems[0].groupEl;
            const children = [...group.children];
            ui.install(); ui.openManagerModal();
            ui.filterCriteria.search = 'dataview'; ui.refreshManagerView(); ui.dispose();
            assert.equal(group.style.display, 'grid');
            assert.deepEqual(group.children, children);
        });
        test('separate manager opens without native Settings navigation', () => {
            let calls = 0;
            mockApp.setting.open = () => { calls++; };
            mockApp.setting.openTabById = () => { calls++; };
            ui.install(); ui.openManagerModal();
            assert.equal(calls, 0);
            assert.ok(ui.managerModal.contentEl.querySelector('.aigility-plugin-list'));
            ui.dispose();
        });
        test('own dialog is reused while open and can reopen after close', () => {
            ui.install(); ui.openManagerModal();
            const first = ui.managerModal;
            ui.openManagerModal(); assert.equal(ui.managerModal, first);
            first.close(); assert.equal(ui.managerModal, undefined);
            ui.openManagerModal(); assert.notEqual(ui.managerModal, first);
            ui.dispose();
        });
        test('closing own dialog releases only its mounted list', () => {
            ui.install(); ui.openManagerModal();
            const modal = ui.managerModal;
            modal.close(); ui.refreshManagerView();
            assert.equal(modal.contentEl.children.length, 0);
            assert.equal(ui.managerContainers.size, 0);
            assert.equal(communityTab.containerEl.querySelector('.aigility-manager-root'), null);
        });
        test('unknown native renderedItems are neither interpreted nor modified', () => {
            communityTab.renderedItems = [{ unknownShape: true }];
            const original = communityTab.containerEl.firstChild;
            ui.install(); ui.openManagerModal(); ui.dispose();
            assert.equal(communityTab.containerEl.firstChild, original);
        });
        test('dispose preserves later foreign replacements of native Settings methods', () => {
            ui.install();
            const external = () => 'foreign';
            mockApp.setting.open = external; communityTab.display = external;
            ui.dispose(); ui.dispose();
            assert.equal(mockApp.setting.open, external);
            assert.equal(communityTab.display, external);
        });
        test('own Settings renders Companion tabs and configuration instead of plugin rows', () => {
            const container = new MockElement('div');
            ui.displaySettings(container);
            const tabs = container.querySelectorAll('.aigility-settings-tab');
            assert.deepEqual(tabs.slice(0, 4).map(el => el.textContent), ['Deferred', 'Profiles', 'Devices', 'Settings']);
            assert.ok(container.querySelector('.aigility-settings-header-card'));
            assert.equal(container.querySelector('.aigility-plugin-row'), null);
        });
        test('own Settings remembers its selected page on redisplay', () => {
            const container = new MockElement('div');
            ui.displaySettings(container);
            const profiles = container.querySelectorAll('.aigility-settings-tab').find(el => el.textContent === 'Profiles');
            profiles.onclick(); ui.displaySettings(container);
            assert.equal(container.querySelectorAll('.aigility-settings-tab').find(el => el.classList.contains('is-active')).textContent, 'Profiles');
        });
        test('dispose prevents subsequent rendering or reopening owned surfaces', () => {
            ui.install(); ui.openManagerModal(); ui.dispose();
            const container = new MockElement('div');
            ui.display(container); ui.displaySettings(container); ui.openManagerModal();
            assert.equal(container.children.length, 0); assert.equal(ui.managerModal, undefined);
        });
        test('gear opens native Settings before selecting the explicit plugin and closes own manager', () => {
            const calls = [];
            mockApp.setting.open = () => calls.push('open');
            mockApp.setting.openTabById = id => calls.push(id);
            ui.install(); ui.openManagerModal();
            const gear = ui.managerModal.contentEl.querySelector('.aigility-gear-btn');
            gear.onclick({ stopPropagation() {} });
            assert.deepEqual(calls, ['open', 'dataview']);
            assert.equal(ui.managerModal, undefined);
        });
        test('dispose closes registered options modals and does not close a foreign modal', () => {
            ui.install(); ui.openOptionsModal();
            const modal = [...ui.ownedModals][0];
            let ownClose = 0, foreignClose = 0;
            const close = modal.close.bind(modal);
            modal.close = () => { ownClose++; close(); };
            const foreign = { close() { foreignClose++; } };
            ui.dispose();
            assert.equal(ownClose, 1); assert.equal(foreignClose, 0);
            assert.equal(ui.ownedModals.size, 0);
            void foreign;
        });
        test('toggle disables repeat input until actual host readback completes', async () => {
            const item = createSamplePlugins()[1];
            let complete, calls = 0;
            mockRuntime.list = () => [item];
            mockRuntime.setEnabled = async () => { calls++; await new Promise(resolve => { complete = resolve; }); item.loaded = true; };
            const row = ui.createPluginRow(item), checkbox = row.querySelector('input');
            checkbox.checked = true;
            const pending = checkbox.onchange();
            assert.equal(checkbox.disabled, true);
            await checkbox.onchange(); assert.equal(calls, 1);
            complete(); await pending;
            assert.equal(checkbox.checked, true); assert.equal(checkbox.disabled, false);
        });
        test('a real secondary tags menu route registers its dialog for disposal', () => {
            ui.install();
            ui.openPluginMenu({}, createSamplePlugins()[0]);
            const tags = globalThis.__aigilityLastMenu.items.find(item => item.title.includes('Editar etiquetas'));
            tags.onClickCb();
            const modal = [...ui.ownedModals][0];
            assert.equal(modal.constructor.name, 'TagMembershipModal');
            let closed = false;
            const close = modal.close.bind(modal); modal.close = () => { closed = true; close(); };
            ui.dispose(); assert.equal(closed, true); assert.equal(ui.ownedModals.size, 0);
        });
        test('failed toggle restores observed host state and exposes the failure', async () => {
            const item = createSamplePlugins()[1];
            mockRuntime.list = () => [item];
            mockRuntime.setEnabled = async () => { throw new Error('readback failed'); };
            const row = ui.createPluginRow(item), checkbox = row.querySelector('input');
            checkbox.checked = true; globalThis.__aigilityNotices = [];
            await checkbox.onchange();
            assert.equal(checkbox.checked, false); assert.equal(checkbox.disabled, false);
            assert.ok(globalThis.__aigilityNotices.some(text => text.includes('readback failed')));
        });
        test('self-disable continuation performs no checkbox mutation or refresh after dispose', async () => {
            const item = { ...createSamplePlugins()[0], ref: { kind: 'community', id: 'aigility-plugin-manager' }, loaded: true };
            const row = ui.createPluginRow(item), checkbox = row.querySelector('input');
            let refresh = 0, afterDispose = false;
            ui.refreshList = () => { if (afterDispose) refresh++; };
            mockRuntime.setEnabled = async () => {
                ui.dispose(); afterDispose = true;
                Object.defineProperty(checkbox, 'checked', { get: () => false, set() { throw new Error('checkbox write after dispose'); } });
                Object.defineProperty(checkbox, 'disabled', { get: () => true, set() { throw new Error('checkbox write after dispose'); } });
            };
            checkbox.checked = false; await checkbox.onchange();
            assert.equal(refresh, 0);
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
            mockRuntime = createQueuedRuntime(baseManagerState({
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
                deferred: [{ id: 'omnisearch', delayMs: 1500, enabled: true, parked: false }]
            }), { list: () => createSamplePlugins() });
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
            assert.equal(navTabs.length, 8);

            const expectedLabels = ['Deferred', 'Profiles', 'Devices', 'Settings', 'Fixtures', 'GitHub', 'Downloaded', 'Debug'];
            const renderedLabels = navTabs.map((t) => t.textContent);
            assert.deepEqual(renderedLabels, expectedLabels);
        });

        test('DeferredConfigModal saves the policy as ONE queued transaction: pause inside, tx save, no nested enqueue', async () => {
            const pluginItem = createSamplePlugins()[1]; // Omnisearch: existing policy, native autostart off
            const modal = new DeferredConfigModal(mockApp, ui, pluginItem);

            modal.onOpen();
            // Verify setting elements created
            const settings = modal.contentEl.querySelectorAll('.setting-item');
            assert.ok(settings.length >= 3);

            globalThis.__aigilityNotices = [];
            const saveBtn = buttonsByText(modal.contentEl, 'Guardar política')[0];
            assert.ok(saveBtn);
            await saveBtn.onclick();

            // One queue slot: no nested public enqueue and no public save inside it.
            assert.deepEqual(mockRuntime.nestedEnqueues, []);
            assert.ok(!mockRuntime.log.includes('begin:save-state'));

            // The policy was resolved by stable id from refreshed state and persisted
            // through tx.save + tx.writeEffectiveState in the same slot.
            const saved = mockRuntime.disk.deferred.find((p) => p.id === 'omnisearch');
            assert.ok(saved);
            assert.equal(saved.enabled, true);
            assert.equal(saved.delayMs, 1500);
            assert.ok(mockRuntime.log.includes('save:ui:deferred-policy-save:omnisearch'));
            assert.ok(mockRuntime.log.includes('effective:ui:deferred-policy-save:omnisearch'));

            // The runtime was paused INSIDE the queued mutation with a visible reason.
            assert.equal(mockRuntime.pauses.length, 1);
            assert.ok(mockRuntime.pauses[0].includes('diferida'));
            const begin = mockRuntime.log.indexOf('begin:ui:deferred-policy-save:omnisearch');
            const pause = mockRuntime.log.indexOf('pause');
            const save = mockRuntime.log.indexOf('save:ui:deferred-policy-save:omnisearch');
            assert.ok(begin !== -1 && pause > begin && pause < save);
        });

        test('Fixture partial apply enqueues ONE transaction and applies exact member states via tx.setEnabled', async () => {
            const optionsModal = new ManagerOptionsModal(mockApp, ui);
            optionsModal['activeSection'] = 'fixtures';
            optionsModal.onOpen();

            const applyBtn = buttonsByText(optionsModal.contentEl, 'Aplicar parcialmente')[0];
            assert.ok(applyBtn);
            await applyBtn.onclick();

            assert.deepEqual(mockRuntime.nestedEnqueues, []);
            assert.ok(mockRuntime.log.includes('begin:ui:fixture-apply:test-fixture'));
            assert.deepEqual(mockRuntime.setEnabledCalls, [
                { ref: { kind: 'community', id: 'dataview' }, enabled: true, options: null },
                { ref: { kind: 'core', id: 'graph' }, enabled: false, options: null }
            ]);
            // Non-member plugins never reach the host.
            assert.equal(mockRuntime.setEnabledCalls.some((c) => c.ref.id === 'omnisearch'), false);
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

    describe('UI Corrections - Sidebar Both Kinds and Debug Controls (Host 1.14.3)', () => {

        function flush() {
            return new Promise((resolve) => setImmediate(resolve));
        }

        function findSettingByName(root, nameText) {
            for (const el of root.querySelectorAll('.setting-item')) {
                const nameEl = el.querySelector('.setting-item-name');
                if (nameEl && nameEl.textContent === nameText) return el;
            }
            return null;
        }

        function findButtonByText(root, text) {
            for (const el of root.querySelectorAll('.mock-button')) {
                if (el.textContent === text) return el;
            }
            return null;
        }

        function buildDebugMock(session, capabilities) {
            const calls = {
                start: [], testHalf: [], testPair: [], observe: [],
                advanced: [], configureAdvanced: [],
                previous: 0, resume: 0, finish: 0, cancelRunningTask: 0
            };
            const mock = {
                calls,
                session,
                start: async (refs) => { calls.start.push(refs); },
                testHalf: async (complement) => { calls.testHalf.push(complement); },
                previous: async () => { calls.previous += 1; },
                testPair: async (a, b) => { calls.testPair.push([a, b]); },
                observe: async (note, result) => { calls.observe.push([note, result]); },
                finish: async () => { calls.finish += 1; },
                exportReports: async () => ({ markdown: '# report', json: '{}' }),
                advanced: async (enable) => { calls.advanced.push(enable); },
                configureAdvanced: async (option, value) => { calls.configureAdvanced.push([option, value]); },
                cancelRunningTask: async () => { calls.cancelRunningTask += 1; },
                resume: async () => { calls.resume += 1; },
                dispose: () => {}
            };
            if (capabilities) mock.advancedCapabilities = () => capabilities;
            return mock;
        }

        const FULL_CAPABILITIES = [
            { id: 'debugMode', supported: true },
            { id: 'namespaces', supported: true },
            { id: 'longStackTraces', supported: false, reason: 'Requires the upstream Error and callback-boundary patch lifecycle.' },
            { id: 'asyncLongStackTraces', supported: false, reason: 'Requires the upstream desktop async-context patch lifecycle.' },
            { id: 'stackTraceLimit', supported: true },
            { id: 'timeouts', supported: true },
            { id: 'mobileConsole', supported: true },
            { id: 'mobileEmulation', supported: true },
            { id: 'cancelRunningTask', supported: true }
        ];

        function openDebugSection(mockApp, ui, session, capabilities) {
            ui.debug = buildDebugMock(session, capabilities);
            const modal = new ManagerOptionsModal(mockApp, ui);
            modal['activeSection'] = 'debug';
            modal.onOpen();
            return modal;
        }

        test('own filters leave all native sidebar visibility unchanged', () => {
            const app = new MockApp();
            const nativeTabs = ['dataview', 'graph', 'file-explorer'].map(id => ({ id, navEl: new MockElement('div') }));
            nativeTabs[1].navEl.style.display = 'none';
            nativeTabs[2].navEl.style.display = 'inline-flex';
            app.setting.pluginTabs = nativeTabs;
            const before = nativeTabs.map(tab => tab.navEl.style.display);
            const runtime = createQueuedRuntime(baseManagerState(), { list: () => createSamplePlugins() });
            const manager = new ManagerUI({ app }, runtime, {}, {});
            manager.install(); manager.openManagerModal();
            manager.filterCriteria.search = 'dataview'; manager.filterCriteria.kind = 'community'; manager.refreshManagerView(); manager.dispose();
            assert.deepEqual(nativeTabs.map(tab => tab.navEl.style.display), before);
        });

        describe('Debug session states and Advanced controls', () => {
            let mockApp;
            let mockRuntime;
            let ui;

            beforeEach(() => {
                globalThis.__aigilityNotices = [];
                mockApp = new MockApp();
                mockRuntime = {
                    state: {
                        schemaVersion: 1,
                        records: {},
                        tags: [{ id: 'pkm', name: 'PKM' }],
                        groups: [{ id: 'tools', name: 'Tools' }],
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
                    setEnabled: async () => {},
                    setTags: async () => {},
                    setGroup: async () => {},
                    bindProfile: async () => {},
                    resume: async () => {},
                    previewProfile: async () => [],
                    applyProfile: async () => {},
                    undoProfile: async () => {},
                    writeEffectiveState: async () => {}
                };
                ui = new ManagerUI({ app: mockApp }, mockRuntime, {}, {});
            });

            test('completed session is not displayed as active merely for a truthy session object', async () => {
                const session = {
                    id: 'finished-session', active: false, interrupted: false,
                    advanced: { active: false, settings: {}, restore: {} }
                };
                const modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);

                const fullText = JSON.stringify(modal.contentEl.textContent);
                assert.ok(fullText.includes('ya ha finalizado'));
                assert.ok(!fullText.includes('Sesión activa en curso'));

                // Start controls return; half/pair controls do not.
                assert.ok(findButtonByText(modal.contentEl, 'Iniciar con los activos'));
                assert.equal(findButtonByText(modal.contentEl, 'Probar mitad'), null);

                // AMD toggle rehydrates the real advanced state and is disabled.
                const amdToggle = findSettingByName(modal.contentEl, 'Advanced Debug Mode (AMD)')
                    .querySelector('.mock-toggle');
                assert.equal(amdToggle.checked, false);
                assert.equal(amdToggle.disabled, true);

                const debugMock = ui.debug;
                await amdToggle.onclick();
                await flush();
                assert.deepEqual(debugMock.calls.advanced, []);
            });

            test('interrupted session offers explicit recover and finish with no replay', async () => {
                const session = {
                    id: 'interrupted-session', active: true, interrupted: true,
                    advanced: { active: false, settings: {}, restore: {} }
                };
                const modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);
                const debugMock = ui.debug;

                const resumeBtn = findButtonByText(modal.contentEl, 'Reanudar sesión');
                const finishBtn = findButtonByText(modal.contentEl, 'Finalizar sesión');
                assert.ok(resumeBtn);
                assert.ok(finishBtn);

                // No step controls while interrupted: nothing can replay.
                assert.equal(findButtonByText(modal.contentEl, 'Probar mitad'), null);
                assert.equal(findButtonByText(modal.contentEl, 'Probar complemento'), null);
                assert.equal(findButtonByText(modal.contentEl, 'Seleccionar candidatos...'), null);

                await resumeBtn.onclick();
                await flush();
                assert.equal(debugMock.calls.resume, 1);
                assert.equal(debugMock.calls.finish, 0);
                assert.deepEqual(debugMock.calls.testHalf, []);
                assert.deepEqual(debugMock.calls.start, []);
            });

            test('interrupted session finish closes explicitly without replaying steps', async () => {
                const session = {
                    id: 'interrupted-session-2', active: true, interrupted: true,
                    advanced: { active: false, settings: {}, restore: {} }
                };
                const modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);
                const debugMock = ui.debug;

                const finishBtn = findButtonByText(modal.contentEl, 'Finalizar sesión');
                await finishBtn.onclick();
                await flush();

                assert.equal(debugMock.calls.finish, 1);
                assert.equal(debugMock.calls.resume, 0);
                assert.deepEqual(debugMock.calls.testHalf, []);
                assert.deepEqual(debugMock.calls.start, []);
            });

            test('active session with advanced enabled rehydrates and binds every advanced control', async () => {
                const session = {
                    id: 'live-session', active: true, interrupted: false,
                    advanced: {
                        active: true,
                        settings: {
                            debugMode: true,
                            namespaces: ['DEBUG'],
                            stackTraceLimit: 50,
                            mobileEmulation: true
                        },
                        restore: {}
                    }
                };
                const modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);
                const debugMock = ui.debug;

                // Rehydrated values, not hardcoded defaults.
                const amdToggle = findSettingByName(modal.contentEl, 'Advanced Debug Mode (AMD)')
                    .querySelector('.mock-toggle');
                assert.equal(amdToggle.checked, true);
                assert.equal(amdToggle.disabled, false);

                const debugModeToggle = findSettingByName(modal.contentEl, 'Modo debug (debugMode)')
                    .querySelector('.mock-toggle');
                assert.equal(debugModeToggle.checked, true);
                assert.equal(debugModeToggle.disabled, false);

                const namespacesInput = findSettingByName(modal.contentEl, 'Namespaces de debug')
                    .querySelector('.mock-text');
                assert.equal(namespacesInput.value, 'DEBUG');
                assert.equal(namespacesInput.disabled, false);

                const stackLimitInput = findSettingByName(modal.contentEl, 'Límite de stack trace')
                    .querySelector('.mock-text');
                assert.equal(stackLimitInput.value, '50');

                // Unsupported capabilities stay disabled with their reason visible.
                const longStackToggle = findSettingByName(modal.contentEl, 'Long stack traces')
                    .querySelector('.mock-toggle');
                assert.equal(longStackToggle.disabled, true);
                const longStackSetting = findSettingByName(modal.contentEl, 'Long stack traces');
                assert.ok(longStackSetting.querySelector('.setting-item-description').textContent.includes('Requires the upstream'));
                const notes = modal.contentEl.querySelectorAll('.aigility-capability-note');
                assert.equal(notes.length, 2);

                // Click bindings reach configureAdvanced with typed values.
                await debugModeToggle.onclick();
                await flush();
                assert.deepEqual(debugMock.calls.configureAdvanced[0], ['debugMode', false]);

                namespacesInput.value = 'app, dev';
                await namespacesInput.oninput();
                assert.deepEqual(debugMock.calls.configureAdvanced[1], ['namespaces', ['app', 'dev']]);

                stackLimitInput.value = '25';
                await stackLimitInput.oninput();
                assert.deepEqual(debugMock.calls.configureAdvanced[2], ['stackTraceLimit', 25]);

                // Invalid numeric input reports visibly and never calls through.
                stackLimitInput.value = 'not-a-number';
                await stackLimitInput.oninput();
                const status = modal.contentEl.querySelector('.aigility-debug-status');
                assert.ok(status.textContent.includes('Error de compatibilidad'));
                assert.equal(debugMock.calls.configureAdvanced.length, 3);

                // Cancel current operation binding.
                const cancelBtn = findButtonByText(modal.contentEl, 'Cancelar operación actual');
                assert.ok(cancelBtn);
                assert.equal(cancelBtn.disabled, false);
                await cancelBtn.onclick();
                await flush();
                assert.equal(debugMock.calls.cancelRunningTask, 1);
            });

            test('advanced controls stay disabled until an active session with advanced enabled exists', async () => {
                // (a) No session at all.
                let modal = openDebugSection(mockApp, ui, null, FULL_CAPABILITIES);
                let amdToggle = findSettingByName(modal.contentEl, 'Advanced Debug Mode (AMD)')
                    .querySelector('.mock-toggle');
                assert.equal(amdToggle.disabled, true);
                let namespacesInput = findSettingByName(modal.contentEl, 'Namespaces de debug')
                    .querySelector('.mock-text');
                assert.equal(namespacesInput.disabled, true);
                let cancelBtn = findButtonByText(modal.contentEl, 'Cancelar operación actual');
                assert.equal(cancelBtn.disabled, true);

                // (b) Active session but Advanced Debug Mode not enabled.
                const session = {
                    id: 'session-no-advanced', active: true, interrupted: false,
                    advanced: { active: false, settings: {}, restore: {} }
                };
                modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);
                const debugMock = ui.debug;
                amdToggle = findSettingByName(modal.contentEl, 'Advanced Debug Mode (AMD)')
                    .querySelector('.mock-toggle');
                assert.equal(amdToggle.disabled, false);
                const debugModeToggle = findSettingByName(modal.contentEl, 'Modo debug (debugMode)')
                    .querySelector('.mock-toggle');
                assert.equal(debugModeToggle.disabled, true);
                cancelBtn = findButtonByText(modal.contentEl, 'Cancelar operación actual');
                assert.equal(cancelBtn.disabled, true);

                await debugModeToggle.onclick();
                await flush();
                assert.deepEqual(debugMock.calls.configureAdvanced, []);

                // The AMD toggle itself still works and calls advanced().
                await amdToggle.onclick();
                await flush();
                assert.deepEqual(debugMock.calls.advanced, [true]);
            });

            test('configureAdvanced compatibility errors surface as Notice and persistent status', async () => {
                const session = {
                    id: 'session-compat', active: true, interrupted: false,
                    advanced: { active: true, settings: {}, restore: {} }
                };
                const modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);
                const debugMock = ui.debug;
                debugMock.configureAdvanced = async (option) => {
                    debugMock.calls.configureAdvanced.push([option]);
                    throw new Error('stackTraceLimit no compatible con este host');
                };

                const debugModeToggle = findSettingByName(modal.contentEl, 'Modo debug (debugMode)')
                    .querySelector('.mock-toggle');
                await debugModeToggle.onclick();
                await flush();

                const status = modal.contentEl.querySelector('.aigility-debug-status');
                assert.ok(status.textContent.includes('Error de compatibilidad: stackTraceLimit no compatible con este host'));
                assert.ok(globalThis.__aigilityNotices.includes('stackTraceLimit no compatible con este host'));
            });

            test('AMD activation failure reports visibly through the persistent status', async () => {
                const session = {
                    id: 'session-amd-fail', active: true, interrupted: false,
                    advanced: { active: false, settings: {}, restore: {} }
                };
                const modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);
                const debugMock = ui.debug;
                debugMock.advanced = async (enable) => {
                    debugMock.calls.advanced.push(enable);
                    throw new Error('Este host no soporta integracion avanzada');
                };

                const amdToggle = findSettingByName(modal.contentEl, 'Advanced Debug Mode (AMD)')
                    .querySelector('.mock-toggle');
                await amdToggle.onclick();
                await flush();

                const status = modal.contentEl.querySelector('.aigility-debug-status');
                assert.ok(status.textContent.includes('Este host no soporta integracion avanzada'));
                assert.deepEqual(debugMock.calls.advanced, [true]);
            });

            test('pair selectors use canonical kind:id values so shared ids never collide', async () => {
                mockRuntime.list = () => [
                    {
                        ref: { kind: 'community', id: 'graph' }, name: 'Community Graph',
                        version: '1.0.0', installed: true, compatible: true,
                        nativeAutostart: true, loaded: true, desired: true,
                        tags: [], group: '', scheduled: false
                    },
                    {
                        ref: { kind: 'core', id: 'graph' }, name: 'Core Graph',
                        version: '1.0.0', installed: true, compatible: true,
                        nativeAutostart: true, loaded: true, desired: true,
                        tags: [], group: '', scheduled: false
                    }
                ];
                const session = {
                    id: 'session-pair', active: true, interrupted: false,
                    advanced: { active: false, settings: {}, restore: {} }
                };
                const modal = openDebugSection(mockApp, ui, session, FULL_CAPABILITIES);
                const debugMock = ui.debug;

                const pairSetting = findSettingByName(modal.contentEl, 'Probar pareja (Test pair)');
                const dropdowns = pairSetting.querySelectorAll('.mock-dropdown');
                assert.equal(dropdowns.length, 2);

                const optionValues = Object.keys(dropdowns[0].options);
                assert.ok(optionValues.includes('community:graph'));
                assert.ok(optionValues.includes('core:graph'));
                assert.ok(!optionValues.includes('graph'));

                dropdowns[0].value = 'community:graph';
                await dropdowns[0].onchange();
                dropdowns[1].value = 'core:graph';
                await dropdowns[1].onchange();

                const pairBtn = findButtonByText(modal.contentEl, 'Probar pareja');
                await pairBtn.onclick();
                await flush();

                assert.deepEqual(debugMock.calls.testPair, [[
                    { kind: 'community', id: 'graph' },
                    { kind: 'core', id: 'graph' }
                ]]);

                // Same canonical key twice is rejected before reaching the manager.
                dropdowns[1].value = 'community:graph';
                await dropdowns[1].onchange();
                await pairBtn.onclick();
                await flush();
                assert.equal(debugMock.calls.testPair.length, 1);
                assert.ok(globalThis.__aigilityNotices.includes('Selecciona dos plugins distintos'));
            });

            test('candidate picker defaults to the SAFE ACTIVE set: 723 inactive installed plugins are never bulk-loaded', async () => {
                const mkPlugin = (id, overrides = {}) => ({
                    ref: { kind: 'community', id },
                    name: id,
                    version: '1.0.0',
                    installed: true,
                    compatible: true,
                    nativeAutostart: false,
                    loaded: false,
                    desired: false,
                    tags: [],
                    group: '',
                    scheduled: false,
                    ...overrides
                });

                // The real catalog shape: a handful of active plugins plus an
                // inert tail of installed-but-inactive ones. Selecting them all
                // would hand debug.start() a bulk disable of hundreds of plugins.
                const activeIds = ['active-loaded', 'active-native', 'active-scheduled', 'active-both', 'active-loaded-desired'];
                const active = [
                    mkPlugin('active-loaded', { loaded: true }),
                    mkPlugin('active-native', { nativeAutostart: true }),
                    mkPlugin('active-scheduled', { scheduled: true, desired: true }),
                    mkPlugin('active-both', { loaded: true, nativeAutostart: true }),
                    mkPlugin('active-loaded-desired', { loaded: true, desired: true })
                ];
                const inactive = Array.from({ length: 723 }, (_, i) => mkPlugin(`inactive-${i}`));
                // Decoys: each is excluded for its own reason, not by accident.
                const scheduledNotDesired = mkPlugin('scheduled-not-desired', { scheduled: true });
                const desiredOnly = mkPlugin('desired-only', { desired: true });
                const incompatible = mkPlugin('incompatible', { loaded: true, nativeAutostart: true, compatible: false });
                const uninstalled = mkPlugin('not-installed', { installed: false, loaded: true, nativeAutostart: true });
                // Protected by the state list, and the manager itself whose
                // canonical entry is deliberately absent from that list.
                const protectedByList = mkPlugin('protected-one', { loaded: true, nativeAutostart: true });
                const selfRef = mkPlugin('aigility-plugin-manager', { loaded: true, nativeAutostart: true });

                mockRuntime.list = () => [
                    ...active, ...inactive, scheduledNotDesired, desiredOnly,
                    incompatible, uninstalled, protectedByList, selfRef
                ];
                // The manager is absent from the list on purpose: canonical self
                // protection must hold even then.
                mockRuntime.state.protected = ['community:protected-one'];

                const modal = openDebugSection(mockApp, ui, null, FULL_CAPABILITIES);
                const debugMock = ui.debug;
                const picker = modal.openSelectDebugCandidatesModal(modal.contentEl);

                // Every plugin is still listed and SELECTABLE; only the default
                // selection is narrowed to the active set.
                const rows = picker.contentEl.querySelectorAll('.setting-item');
                const togglesFor = (id) => {
                    const row = rows.find((r) => {
                        const desc = r.querySelector('.setting-item-description');
                        return desc && desc.textContent === `ID: ${id}`;
                    });
                    return row ? row.querySelector('.mock-toggle') : undefined;
                };
                assert.ok(rows.length >= 728, `all rows rendered (${rows.length})`);

                const checkedDefaults = activeIds.filter((id) => togglesFor(id)?.checked);
                assert.deepEqual(checkedDefaults.sort(), activeIds.slice().sort());

                // Decoys stay unchecked: scheduled without desired, desired alone,
                // incompatible, uninstalled, and both protected refs.
                for (const id of ['scheduled-not-desired', 'desired-only', 'incompatible', 'not-installed']) {
                    assert.equal(togglesFor(id)?.checked, false, `${id} must not be preselected`);
                }
                // The protected rows carry a lock instead of a toggle at all.
                for (const id of ['protected-one', 'aigility-plugin-manager']) {
                    assert.equal(togglesFor(id), undefined, `${id} must not be selectable`);
                }

                // Starting without touching a single toggle passes ONLY the
                // active refs: 0 of the 723 inactive ones become a bulk load.
                await findButtonByText(picker.contentEl, 'Iniciar con seleccionados').onclick();
                await flush();

                assert.equal(debugMock.calls.start.length, 1);
                const started = debugMock.calls.start[0].map((ref) => `${ref.kind}:${ref.id}`).sort();
                assert.deepEqual(started, activeIds.map((id) => `community:${id}`).sort());
                assert.equal(started.filter((k) => k.startsWith('community:inactive-')).length, 0);
                assert.ok(globalThis.__aigilityNotices.some((n) => n.includes(`Sesión iniciada con ${activeIds.length} candidatos`)));
            });

            test('an inactive-but-installed plugin is one click away: it joins the selection explicitly', async () => {
                const mkPlugin = (id, overrides = {}) => ({
                    ref: { kind: 'community', id },
                    name: id,
                    version: '1.0.0',
                    installed: true,
                    compatible: true,
                    nativeAutostart: false,
                    loaded: false,
                    desired: false,
                    tags: [],
                    group: '',
                    scheduled: false,
                    ...overrides
                });
                mockRuntime.list = () => [
                    mkPlugin('only-loaded', { loaded: true }),
                    mkPlugin('sleeper', { desired: true })
                ];
                mockRuntime.state.protected = [];

                const modal = openDebugSection(mockApp, ui, null, FULL_CAPABILITIES);
                const debugMock = ui.debug;
                const picker = modal.openSelectDebugCandidatesModal(modal.contentEl);

                const rowOf = (id) => picker.contentEl.querySelectorAll('.setting-item')
                    .find((r) => r.querySelector('.setting-item-description')?.textContent === `ID: ${id}`);
                const sleeperToggle = rowOf('sleeper').querySelector('.mock-toggle');
                assert.equal(sleeperToggle.checked, false);

                // The user opts in on purpose; the default is what changed, not
                // the ability to select.
                await sleeperToggle.onclick();
                await findButtonByText(picker.contentEl, 'Iniciar con seleccionados').onclick();
                await flush();

                assert.deepEqual(
                    debugMock.calls.start[0].map((ref) => `${ref.kind}:${ref.id}`).sort(),
                    ['community:only-loaded', 'community:sleeper']
                );
            });

            test('parsePluginRefKey round-trips canonical keys and rejects malformed ones', () => {
                assert.deepEqual(parsePluginRefKey('community:dataview'), { kind: 'community', id: 'dataview' });
                assert.deepEqual(parsePluginRefKey('core:file-explorer'), { kind: 'core', id: 'file-explorer' });
                assert.deepEqual(parsePluginRefKey('community:plug:in'), { kind: 'community', id: 'plug:in' });
                assert.equal(parsePluginRefKey('graph'), null);
                assert.equal(parsePluginRefKey('window:graph'), null);
                assert.equal(parsePluginRefKey('community:'), null);
            });
        });
    });

    describe('Queued State Contract - Deferred Policies, GitHub Sources and Companion Backups', () => {
        const flush = () => new Promise((resolve) => setImmediate(resolve));
        const notices = () => globalThis.__aigilityNotices ?? [];

        function setup(seedOverrides = {}, runtimeOptions = {}) {
            const mockApp = new MockApp();
            const runtime = createQueuedRuntime(baseManagerState(seedOverrides), runtimeOptions);
            const github = {
                releasesCalls: [],
                installCalls: [],
                rollbackCalls: [],
                releases: async (repo) => {
                    github.releasesCalls.push(repo);
                    return [{ tag: 'v1.0.0', name: 'Release 1.0.0', prerelease: false, assets: ['main.js', 'manifest.json'] }];
                },
                install: async (repo, tag) => {
                    github.installCalls.push({ repo, tag });
                    // The real GithubManager persists the source under the plugin id
                    // it verified from the release manifest; the UI never guesses it.
                    runtime.state.githubSources['community:verified-one'] = { repo, trackPrereleases: false };
                    runtime.disk.githubSources['community:verified-one'] = { repo, trackPrereleases: false };
                    return 'verified-one';
                },
                rollback: async (id) => {
                    github.rollbackCalls.push(id);
                },
                checkAll: async () => [],
                setPin: async () => {}
            };
            const debug = {
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
            const ui = new ManagerUI({ app: mockApp }, runtime, github, debug);
            return { mockApp, runtime, github, ui };
        }

        // --- Item 4: deferred policy edits through the serial queue -------------

        test('deferred policy edit does not touch state until its queued callback runs', async () => {
            const { mockApp, runtime, ui } = setup({
                deferred: [{ id: 'omnisearch', delayMs: 1500, enabled: true, parked: false }]
            });
            const modal = new DeferredConfigModal(mockApp, ui, createSamplePlugins()[1]);
            modal.onOpen();

            // Flip "Habilitar inicio diferido" off; the write only happens in the queue.
            const enableToggle = toggleInSetting(modal.contentEl, 'Habilitar inicio diferido');
            assert.ok(enableToggle);
            enableToggle.onclick();

            let releaseGate;
            const gate = new Promise((resolve) => { releaseGate = resolve; });
            runtime.enqueue('gate', async () => { await gate; });

            globalThis.__aigilityNotices = [];
            const saveBtn = buttonsByText(modal.contentEl, 'Guardar política')[0];
            assert.ok(saveBtn);
            const saved = saveBtn.onclick();
            await flush();

            // While the gate holds the queue, neither disk nor runtime.state changed.
            assert.equal(runtime.disk.deferred[0].enabled, true);
            assert.equal(runtime.state.deferred[0].enabled, true);
            assert.ok(!runtime.log.includes('begin:ui:deferred-policy-save:omnisearch'));

            releaseGate();
            await saved;

            assert.equal(runtime.disk.deferred[0].enabled, false);
            assert.deepEqual(runtime.nestedEnqueues, []);
            assert.equal(runtime.pauses.length, 1);
        });

        test('external policy change while the modal is open conflicts instead of overwriting', async () => {
            const { mockApp, runtime, ui } = setup({
                deferred: [{ id: 'omnisearch', delayMs: 1500, enabled: true, parked: false }]
            });
            const modal = new DeferredConfigModal(mockApp, ui, createSamplePlugins()[1]);
            modal.onOpen();

            // Another queued writer edits the same policy while the dialog is open.
            await runtime.enqueue('external-edit', async (tx) => {
                const fresh = await tx.refresh();
                fresh.deferred[0].delayMs = 9000;
                await tx.save();
                await tx.writeEffectiveState();
            });

            globalThis.__aigilityNotices = [];
            const saveBtn = buttonsByText(modal.contentEl, 'Guardar política')[0];
            await saveBtn.onclick();

            // The stale modal copy (1500) never overwrote the external edit (9000).
            assert.equal(runtime.disk.deferred[0].delayMs, 9000);
            assert.equal(runtime.state.deferred[0].delayMs, 9000);
            assert.ok(notices().some((n) => n.includes('cambió fuera de este diálogo')));
            // The aborted transaction never reached the persistence step.
            assert.ok(!runtime.log.includes('save:ui:deferred-policy-save:omnisearch'));
            // The fail-safe pause still cancelled pending loads with a visible reason.
            assert.equal(runtime.pauses.length, 1);
        });

        test('enabling a NEW policy on a native-true plugin excludes native via tx.reconcileDeferred before saving', async () => {
            const { mockApp, runtime, ui } = setup({}, {
                list: () => [createSamplePlugins()[0]] // Dataview, nativeAutostart true
            });
            const modal = new DeferredConfigModal(mockApp, ui, createSamplePlugins()[0]);
            modal.onOpen();

            const enableToggle = toggleInSetting(modal.contentEl, 'Habilitar inicio diferido');
            assert.ok(enableToggle);
            enableToggle.onclick();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.ok(runtime.log.includes('reconcileDeferred:community:dataview'));
            const reconcileAt = runtime.log.indexOf('reconcileDeferred:community:dataview');
            const saveAt = runtime.log.indexOf('save:ui:deferred-policy-save:dataview');
            assert.ok(saveAt !== -1 && reconcileAt < saveAt);
            const policy = runtime.disk.deferred.find((p) => p.id === 'dataview');
            assert.ok(policy);
            assert.equal(policy.enabled, true);
            assert.equal(policy.delayMs, 1000); // modal default for a new policy
            assert.deepEqual(runtime.nestedEnqueues, []);
        });

        test('without tx.reconcileDeferred the new policy fails visibly and nothing is written', async () => {
            const { mockApp, runtime, ui } = setup({}, {
                reconcileDeferred: false,
                list: () => [createSamplePlugins()[0]]
            });
            const modal = new DeferredConfigModal(mockApp, ui, createSamplePlugins()[0]);
            modal.onOpen();
            toggleInSetting(modal.contentEl, 'Habilitar inicio diferido').onclick();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.ok(notices().some((n) => n.includes('reconcileDeferred')));
            assert.equal(runtime.disk.deferred.length, 0);
            assert.ok(!runtime.log.includes('save:ui:deferred-policy-save:dataview'));
        });

        // --- Ordering proof against a runtime that behaves like the real one -----
        //
        // The call-log stub cannot separate "reconciled after mutating" from
        // "reconciled before mutating": the real reconcileDeferredInternal()
        // returns without touching the host when no ENABLED policy exists yet,
        // so a call made before the mutation is a no-op that still looks like a
        // successful reconcile in a log. These tests use the strong fake, which
        // records the policy and the host flags AT the helper call.

        function strongSetup(seedOverrides, hostPlugins, runtimeOptions = {}) {
            const mockApp = new MockApp();
            const seed = baseManagerState({
                records: {
                    'community:dataview': {
                        ref: { kind: 'community', id: 'dataview' },
                        name: 'Dataview', version: '0.5.64', tags: ['pkm'], group: 'core-tools',
                        desired: true, metadata: {}
                    },
                    'community:omnisearch': {
                        ref: { kind: 'community', id: 'omnisearch' },
                        name: 'Omnisearch', version: '1.24.1', tags: ['search'], group: 'search-tools',
                        desired: true, metadata: {}
                    }
                },
                ...seedOverrides
            });
            const host = { plugins: hostPlugins };
            const runtime = createStrongDeferredRuntime(seed, host, runtimeOptions);
            const debug = {
                start: async () => {}, testHalf: async () => {}, previous: async () => {},
                testPair: async () => {}, observe: async () => {}, finish: async () => {},
                exportReports: async () => ({ markdown: '', json: '' }), advanced: async () => {},
                dispose: () => {}
            };
            const ui = new ManagerUI({ app: mockApp }, runtime, {}, debug);
            return { mockApp, runtime, host, ui };
        }

        const dataviewPlugin = () => createSamplePlugins()[0];

        test('new policy: the host exclusion happens with the fresh policy already enabled and native ends off', async () => {
            // No policy at all, native autostart on and loaded: the exact case that
            // used to save native=true next to a claimed deferment.
            const { mockApp, runtime, host, ui } = strongSetup({}, {
                'community:dataview': { installed: true, nativeAutostart: true, loaded: true, desired: true }
            });

            const modal = new DeferredConfigModal(mockApp, ui, dataviewPlugin());
            modal.onOpen();
            toggleInSetting(modal.contentEl, 'Habilitar inicio diferido').onclick();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.equal(runtime.reconcileCalls.length, 1, 'exactly one exclusion call');
            const call = runtime.reconcileCalls[0];
            assert.equal(call.key, 'community:dataview');
            // The policy was ALREADY enabled when the helper ran; a call made
            // before the mutation would have observed null and changed nothing.
            assert.ok(call.policyAtCall, 'the helper must observe the freshly mutated policy');
            assert.equal(call.policyAtCall.enabled, true);
            assert.equal(call.nativeBefore, true);
            assert.equal(call.nativeAfter, false, 'native autostart really excluded');
            assert.equal(call.unloaded, true, 'loaded plugin unloaded while paused');
            // The host state agrees with the recorded postimage.
            assert.equal(host.plugins['community:dataview'].nativeAutostart, false);
            assert.equal(host.plugins['community:dataview'].loaded, false);
            // desired is untouched by a policy edit.
            assert.equal(call.desiredBefore, true);
            assert.equal(call.desiredAfter, true);
            // Order: exclusion, then persistence.
            const reconcileAt = runtime.log.indexOf('reconcileDeferred:community:dataview');
            const saveAt = runtime.log.indexOf('save:ui:deferred-policy-save:dataview');
            assert.ok(reconcileAt !== -1 && saveAt !== -1 && reconcileAt < saveAt);
            assert.equal(runtime.disk.deferred[0].enabled, true);
            assert.deepEqual(runtime.nestedEnqueues, []);
            assert.equal(runtime.pauses.length, 1);
        });

        test('already enabled policy with native already off: the unload helper still runs', async () => {
            // Native is off but the plugin is still loaded; the exclusion must
            // still unload it, so the helper cannot be skipped when native=false.
            const { mockApp, runtime, host, ui } = strongSetup(
                { deferred: [{ id: 'dataview', delayMs: 1500, enabled: true, parked: false }] },
                { 'community:dataview': { installed: true, nativeAutostart: false, loaded: true, desired: true } }
            );

            const modal = new DeferredConfigModal(mockApp, ui, dataviewPlugin());
            modal.onOpen();
            // Only the delay changes; the policy stays enabled.
            const slider = [...modal.contentEl.querySelectorAll('.mock-slider')][0];
            slider.value = '4000';
            await slider.oninput();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.equal(runtime.reconcileCalls.length, 1, 'an enabled policy reconciles even with native already off');
            const call = runtime.reconcileCalls[0];
            assert.equal(call.nativeBefore, false);
            assert.equal(call.unloaded, true, 'still loaded: the exclusion must unload it');
            assert.equal(host.plugins['community:dataview'].loaded, false);
            assert.equal(runtime.disk.deferred[0].delayMs, 4000);
            assert.equal(runtime.disk.deferred[0].enabled, true);
            assert.deepEqual(runtime.nestedEnqueues, []);
        });

        test('a failing exclusion reverts only the touched fields and saves nothing', async () => {
            // Host readback fails after the mutation: the policy must not be
            // persisted and the pre-edit values must survive.
            const { mockApp, runtime, ui } = strongSetup(
                { deferred: [{ id: 'dataview', delayMs: 1500, enabled: false, parked: true }] },
                { 'community:dataview': { installed: true, nativeAutostart: true, loaded: false, desired: true } },
                {
                    reconcileImpl: async () => {
                        throw new Error('Host readback failed: native autostart still on.');
                    }
                }
            );

            const modal = new DeferredConfigModal(mockApp, ui, dataviewPlugin());
            modal.onOpen();
            toggleInSetting(modal.contentEl, 'Habilitar inicio diferido').onclick();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.ok(notices().some((n) => n.includes('No se pudo excluir el autoarranque nativo')));
            // Nothing persisted, and the pre-edit policy is intact on disk.
            assert.ok(!runtime.log.includes('save:ui:deferred-policy-save:dataview'));
            assert.equal(runtime.disk.deferred[0].enabled, false);
            assert.equal(runtime.disk.deferred[0].parked, true);
            assert.equal(runtime.disk.deferred[0].delayMs, 1500);
            // The modal stays open on failure instead of closing over a fake success.
            assert.ok(!runtime.nestedEnqueues.some((n) => n.label.includes('deferred-policy-save')));
        });

        test('a newly created entry is removed when the exclusion fails', async () => {
            const { mockApp, runtime, ui } = strongSetup(
                {},
                { 'community:dataview': { installed: true, nativeAutostart: true, loaded: false, desired: true } },
                { reconcileImpl: async () => { throw new Error('Host readback failed.'); } }
            );

            const modal = new DeferredConfigModal(mockApp, ui, dataviewPlugin());
            modal.onOpen();
            toggleInSetting(modal.contentEl, 'Habilitar inicio diferido').onclick();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.ok(notices().some((n) => n.includes('No se pudo excluir el autoarranque nativo')));
            assert.equal(runtime.disk.deferred.length, 0, 'the entry this edit created is gone');
            assert.equal(runtime.state.deferred.length, 0);
            assert.ok(!runtime.log.includes('save:ui:deferred-policy-save:dataview'));
        });

        test('enabling an already-invalid core policy is refused before any host call', async () => {
            // Existing ENABLED policy for a core plugin (left over from before the
            // core restriction existed). Disabling resolves the conflict; enabling
            // it again must never reach the host.
            const { mockApp, runtime, host, ui } = strongSetup(
                { deferred: [{ id: 'graph', delayMs: 1000, enabled: true, parked: false }] },
                { 'core:graph': { installed: true, nativeAutostart: true, loaded: false, desired: true } }
            );

            const corePlugin = {
                ref: { kind: 'core', id: 'graph' },
                name: 'Core Graph', version: '1.0.0', installed: true, compatible: true,
                nativeAutostart: true, loaded: false, desired: true,
                tags: [], group: '', scheduled: false
            };
            const modal = new DeferredConfigModal(mockApp, ui, corePlugin);
            modal.onOpen();
            // It opens enabled; flip it off and back on to demand a re-enable.
            const toggle = toggleInSetting(modal.contentEl, 'Habilitar inicio diferido');
            toggle.onclick();
            toggle.onclick();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.equal(runtime.reconcileCalls.length, 0, 'the refusal happens before any host call');
            assert.equal(host.plugins['core:graph'].nativeAutostart, true, 'native autostart untouched');
            assert.ok(notices().some((n) => n.includes('core no tienen una activación no persistente')));
        });

        test('disabling an existing invalid policy resolves the conflict without a host call', async () => {
            const { mockApp, runtime, host, ui } = strongSetup(
                { deferred: [{ id: 'graph', delayMs: 1000, enabled: true, parked: false }] },
                { 'core:graph': { installed: true, nativeAutostart: true, loaded: false, desired: true } }
            );

            const corePlugin = {
                ref: { kind: 'core', id: 'graph' },
                name: 'Core Graph', version: '1.0.0', installed: true, compatible: true,
                nativeAutostart: true, loaded: false, desired: true,
                tags: [], group: '', scheduled: false
            };
            const modal = new DeferredConfigModal(mockApp, ui, corePlugin);
            modal.onOpen();
            toggleInSetting(modal.contentEl, 'Habilitar inicio diferido').onclick(); // -> false

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.equal(runtime.reconcileCalls.length, 0, 'turning it off never forces a load');
            assert.equal(runtime.disk.deferred[0].enabled, false);
            assert.equal(host.plugins['core:graph'].nativeAutostart, true, 'native off is not forced either');
            assert.ok(notices().some((n) => n.includes('Política de carga diferida guardada')));
        });

        test('the manager itself is refused as a deferred target and stays protected', async () => {
            // state.protected does not even list the manager: the canonical self
            // protection still applies.
            const { mockApp, runtime, host, ui } = strongSetup(
                { protected: [] },
                { 'community:aigility-plugin-manager': { installed: true, nativeAutostart: true, loaded: true, desired: true } }
            );

            const selfPlugin = {
                ref: { kind: 'community', id: 'aigility-plugin-manager' },
                name: 'AIgility Plugin Manager', version: '0.1.0', installed: true, compatible: true,
                nativeAutostart: true, loaded: true, desired: true,
                tags: [], group: '', scheduled: false
            };
            const modal = new DeferredConfigModal(mockApp, ui, selfPlugin);
            modal.onOpen();
            toggleInSetting(modal.contentEl, 'Habilitar inicio diferido').onclick();

            globalThis.__aigilityNotices = [];
            await buttonsByText(modal.contentEl, 'Guardar política')[0].onclick();

            assert.equal(runtime.reconcileCalls.length, 0);
            assert.equal(host.plugins['community:aigility-plugin-manager'].nativeAutostart, true);
            assert.equal(host.plugins['community:aigility-plugin-manager'].loaded, true);
            assert.ok(notices().some((n) => n.includes('es el propio gestor')));
        });

        // --- Item 2: GitHub canonical source keys -------------------------------

        test('ReleasesModal resolves the tracked source by canonical key even when the repo name differs from the plugin id', async () => {
            const { mockApp, ui } = setup({
                records: {
                    'community:omnisearch': {
                        ref: { kind: 'community', id: 'omnisearch' },
                        name: 'Omnisearch', version: '1.24.1', tags: [], group: '', desired: true, metadata: {}
                    }
                },
                githubSources: {
                    'community:omnisearch': { repo: 'thirdparty/omnisearch-fork', version: '1.0.0', pinned: '1.2.3', trackPrereleases: false }
                }
            });

            const modal = new GitHubReleasesModal(mockApp, ui, createSamplePlugins()[1]);
            await modal.onOpen();

            const repoSetting = settingByName(modal.contentEl, 'Repositorio (owner/repo o URL)');
            assert.ok(repoSetting);
            // The source was found through the canonical community:omnisearch key.
            assert.ok(repoSetting.querySelector('.setting-item-description').textContent.includes('Origen configurado'));
            // The prefill comes from the tracked source, never deduced from the id.
            assert.equal(repoSetting.querySelector('.mock-text').value, 'thirdparty/omnisearch-fork');
            // The installed version and the pin are labeled apart and real.
            const info = modal.contentEl.querySelector('p');
            assert.ok(info.textContent.includes('Versión instalada: 1.24.1'));
            assert.ok(info.textContent.includes('Fijada (pin): 1.2.3'));
        });

        test('installing from an uninstalled source calls github.install(repo, tag) and never guesses the state key', async () => {
            const { mockApp, runtime, github, ui } = setup();
            // Same synthetic entry ManagerOptionsModal builds for a source whose
            // plugin is not installed: an id-less community ref and the repo name.
            const source = {
                ref: { kind: 'community', id: '' },
                name: 'owner/brand-new-plugin',
                version: '',
                installed: false,
                compatible: true,
                nativeAutostart: false,
                loaded: false,
                desired: false,
                tags: [],
                group: '',
                scheduled: false
            };
            const modal = new GitHubReleasesModal(mockApp, ui, source, { repo: 'owner/brand-new-plugin' });
            let closed = false;
            modal.close = () => { closed = true; };
            await modal.onOpen();

            globalThis.__aigilityNotices = [];
            const installBtn = buttonsByText(modal.contentEl, 'Instalar')[0];
            assert.ok(installBtn);
            await installBtn.onclick();

            assert.deepEqual(github.installCalls, [{ repo: 'owner/brand-new-plugin', tag: 'v1.0.0' }]);
            // The UI never wrote a source key deduced from the repo name; the only
            // key is the manifest id the GithubManager verified.
            assert.deepEqual(Object.keys(runtime.disk.githubSources), ['community:verified-one']);
            assert.ok(notices().some((n) => n.includes('verified-one')));
            assert.equal(closed, true);
        });

        test('tracked source actions use canonical keys: raw-id rollback, queued toggle preserving concurrent fields', async () => {
            const { mockApp, runtime, github, ui } = setup({
                records: {
                    'community:omnisearch': {
                        ref: { kind: 'community', id: 'omnisearch' },
                        name: 'Omnisearch', version: '1.24.1', tags: [], group: '', desired: true, metadata: {}
                    }
                },
                githubSources: {
                    'community:omnisearch': { repo: 'thirdparty/omnisearch-fork', version: '1.0.0', pinned: '1.2.3', trackPrereleases: false },
                    'legacy-plugin': { repo: 'someone/legacy', trackPrereleases: false }
                }
            }, { list: () => [createSamplePlugins()[1]] });

            const optionsModal = new ManagerOptionsModal(mockApp, ui);
            optionsModal['activeSection'] = 'github';
            optionsModal.onOpen();

            // Actual installed version preferred over the stored source version.
            const row = settingByName(optionsModal.contentEl, 'community:omnisearch');
            assert.ok(row);
            assert.ok(row.querySelector('.setting-item-description').textContent.includes('Instalada: 1.24.1'));
            assert.ok(row.querySelector('.setting-item-description').textContent.includes('Fijada (pin): 1.2.3'));

            // Non-canonical keys keep display-only rows: no actions, no guessing.
            const legacyRow = settingByName(optionsModal.contentEl, 'legacy-plugin');
            assert.ok(legacyRow);
            assert.ok(legacyRow.querySelector('.setting-item-description').textContent.includes('Clave no canónica'));
            assert.equal(legacyRow.querySelector('.mock-toggle'), null);
            assert.equal(legacyRow.querySelector('.mock-button'), null);

            // No automatic-update control exists: the engine is not implemented and
            // an inert toggle would be a no-op.
            const autoSetting = settingByName(optionsModal.contentEl, 'Comprobación automática de actualizaciones');
            assert.ok(autoSetting);
            assert.equal(autoSetting.querySelector('.mock-toggle'), null);
            assert.equal(autoSetting.querySelector('.mock-button'), null);
            assert.ok(autoSetting.querySelector('.setting-item-description').textContent.includes('Sin motor implementado'));

            // Rollback receives the RAW plugin id, never the canonical key.
            globalThis.__aigilityNotices = [];
            await buttonsByText(optionsModal.contentEl, 'Rollback')[0].onclick();
            assert.deepEqual(github.rollbackCalls, ['omnisearch']);

            // A concurrent writer edits pinned while the toggle write is queued.
            await runtime.enqueue('external-pin', async (tx) => {
                const fresh = await tx.refresh();
                fresh.githubSources['community:omnisearch'].pinned = '9.9.9';
                await tx.save();
            });

            const toggle = toggleInSetting(optionsModal.contentEl, 'community:omnisearch');
            assert.ok(toggle);
            await toggle.onclick();

            const source = runtime.disk.githubSources['community:omnisearch'];
            assert.equal(source.trackPrereleases, true);
            assert.equal(source.pinned, '9.9.9'); // fresh unrelated concurrent field preserved
            assert.ok(runtime.log.includes('begin:ui:github-prereleases:community:omnisearch'));
            assert.deepEqual(runtime.nestedEnqueues, []);
        });

        // --- Item 3: imported Companion backups and manager backups -------------

        test('Companion backup renders its real format and restores as partial fixtures without applying anything', async () => {
            const companionEntry = {
                source: 'obsidian-companion',
                migratedAt: '2026-09-01T08:30:00.000Z',
                backups: {
                    desktop: {
                        name: 'Desktop setup',
                        savedAt: '2026-08-30T20:00:00.000Z',
                        pluginStates: { dataview: true, 'legacy-thing': false }
                    }
                }
            };
            const { mockApp, runtime, ui } = setup({ profileBackups: [companionEntry] });

            const optionsModal = new ManagerOptionsModal(mockApp, ui);
            optionsModal['activeSection'] = 'profiles';
            optionsModal.onOpen();

            const row = settingByName(optionsModal.contentEl, 'Copia importada de obsidian-companion');
            assert.ok(row);
            const desc = row.querySelector('.setting-item-description').textContent;
            assert.ok(desc.includes('Origen: Companion'));
            assert.ok(desc.includes('desktop'));
            // Rendering preserves the original payload exactly.
            assert.deepEqual(runtime.state.profileBackups[0], companionEntry);

            globalThis.__aigilityNotices = [];
            const restoreBtn = buttonsByText(optionsModal.contentEl, 'Restaurar como fixture')[0];
            assert.ok(restoreBtn);
            await restoreBtn.onclick();
            await restoreBtn.onclick(); // restoring twice never duplicates the fixture

            const fixtures = runtime.disk.fixtureProfiles;
            assert.equal(fixtures.length, 1);
            assert.equal(fixtures[0].id, 'companion-restore-desktop');
            assert.equal(fixtures[0].name, 'Desktop setup');
            // Raw legacy ids map to canonical community keys.
            assert.deepEqual(fixtures[0].members, { 'community:dataview': true, 'community:legacy-thing': false });
            assert.equal(fixtures[0].metadata.source, 'obsidian-companion');

            // The original backup entry is preserved EXACTLY: no profiles key, no rewrite.
            assert.deepEqual(runtime.disk.profileBackups[0], companionEntry);
            // Nothing was hot-applied: no host mutation and no profile application.
            assert.deepEqual(runtime.setEnabledCalls, []);
            assert.equal(runtime._lastAppliedProfile, undefined);
        });

        test('manager backup restore rebuilds definitions only: profiles replaced, fixtures and membership restored, enablement untouched', async () => {
            const managerBackup = {
                id: 'backup-1',
                timestamp: '2026-09-30T10:00:00.000Z',
                profiles: [{ id: 'p1', name: 'Profile One', tagIds: ['pkm'], applyAtStart: false }],
                fixtures: [{ id: 'fx1', name: 'Fixture One', members: { 'community:dataview': true } }],
                tagMembership: {
                    'community:omnisearch': { tags: ['pkm'], group: 'tools' },
                    'community:ghost': { tags: ['pkm'], group: '' }
                }
            };
            const { mockApp, runtime, ui } = setup({
                records: {
                    'community:omnisearch': {
                        ref: { kind: 'community', id: 'omnisearch' },
                        name: 'Omnisearch', version: '1.0.0', tags: [], group: '', desired: false, metadata: {}
                    }
                },
                fixtureProfiles: [{ id: 'fx1', name: 'Old Fixture', members: { 'core:graph': false } }],
                profileBackups: [managerBackup]
            });

            const optionsModal = new ManagerOptionsModal(mockApp, ui);
            optionsModal['activeSection'] = 'profiles';
            optionsModal.onOpen();

            const row = settingByDescFragment(optionsModal.contentEl, 'Origen: Gestor');
            assert.ok(row);

            globalThis.__aigilityNotices = [];
            await buttonsByText(optionsModal.contentEl, 'Restaurar')[0].onclick();

            // Device profile definitions come back from the snapshot.
            assert.deepEqual(runtime.disk.deviceProfiles, [
                { id: 'p1', name: 'Profile One', tagIds: ['pkm'], applyAtStart: false }
            ]);
            // Fixture members are restored from the snapshot for the same stable id.
            const fixture = runtime.disk.fixtureProfiles.find((f) => f.id === 'fx1');
            assert.equal(fixture.name, 'Fixture One');
            assert.deepEqual(fixture.members, { 'community:dataview': true });
            // Tag membership updates existing records in place; missing records are
            // never resurrected from the membership map.
            assert.deepEqual(runtime.disk.records['community:omnisearch'].tags, ['pkm']);
            assert.deepEqual(runtime.disk.records['community:omnisearch'].group, 'tools');
            assert.equal(runtime.disk.records['community:ghost'], undefined);
            // Definitions only: no saved enablement was hot-applied.
            assert.deepEqual(runtime.setEnabledCalls, []);
            assert.equal(runtime._lastAppliedProfile, undefined);
            // The original backup object is kept exactly.
            assert.deepEqual(runtime.disk.profileBackups[0], managerBackup);
        });

        // --- Item 1: local binding cleared outside the delete transaction -------

        test('deleting the bound profile clears the local binding BEFORE the queued delete', async () => {
            const { mockApp, runtime, ui } = setup({
                deviceProfiles: [{ id: 'desktop', name: 'Desktop', tagIds: [], applyAtStart: false }]
            });
            runtime.local.deviceProfileId = 'desktop';

            const optionsModal = new ManagerOptionsModal(mockApp, ui);
            optionsModal['activeSection'] = 'profiles';
            optionsModal.onOpen();

            globalThis.__aigilityNotices = [];
            await buttonsByText(optionsModal.contentEl, 'Eliminar')[0].onclick();

            assert.deepEqual(runtime._lastBind, '');
            assert.equal(runtime.local.deviceProfileId, undefined);
            assert.equal(runtime.disk.deviceProfiles.length, 0);
            assert.ok(runtime.log.includes('begin:ui:profile-delete:desktop'));
            assert.deepEqual(runtime.nestedEnqueues, []);
        });
    });
});
