import type { State } from './types';

export class StateConflictError extends Error {
    constructor(message = 'State conflict detected. Refresh the manager state before retrying this change.') {
        super(message);
        this.name = 'StateConflictError';
    }
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function statePath(plugin: any): string {
    const dir = String(plugin?.manifest?.dir ?? '').replace(/^\/+|\/+$/g, '');
    if (!dir || dir.split('/').includes('..')) {
        throw new Error('Cannot locate the manager data file from plugin.manifest.dir.');
    }
    return `${dir}/data.json`;
}

/** Disk-backed state store. Every write checks the exact last-read preimage. */
export class RuntimeStore {
    readonly path: string;
    private expected: string | null;
    private initialState: State;
    private initialized = false;
    private assertActive: () => void;

    constructor(private app: any, private plugin: any, initial: State, assertActive: () => void = () => {}) {
        this.assertActive = assertActive;
        this.path = statePath(plugin);
        this.initialState = clone(initial);
        const supplied = plugin?.managerRuntimePreimage;
        this.expected = typeof supplied === 'string' ? supplied : supplied === null ? null : JSON.stringify(clone(initial));
        this.initialized = supplied !== undefined;
    }

    async assertFresh(): Promise<void> {
        const adapter = this.app?.vault?.adapter;
        if (!adapter || typeof adapter.exists !== 'function' || typeof adapter.read !== 'function') {
            throw new Error('Vault adapter read/exists methods are required for conflict-safe state writes.');
        }
        const exists = await adapter.exists(this.path);
        const actual = exists ? await adapter.read(this.path) : null;
        if (!this.initialized) {
            // The caller supplies data returned from Obsidian loadData. On the first
            // save, exact equality is the only safe evidence that it is still current.
            this.initialized = true;
            if (actual !== this.expected) throw new StateConflictError();
            return;
        }
        if (actual !== this.expected) throw new StateConflictError();
    }

    async save(state: State): Promise<void> {
        this.assertActive();
        await this.assertFresh();
        this.assertActive();
        const adapter = this.app?.vault?.adapter;
        if (!adapter || typeof adapter.write !== 'function') {
            throw new Error('Vault adapter write method is required for manager state persistence.');
        }
        const next = JSON.stringify(state);
        await adapter.write(this.path, next);
        const readback = await adapter.read(this.path);
        if (readback !== next) {
            throw new Error('Manager state write readback failed; the disk content differs from the requested state.');
        }
        this.expected = next;
    }

    async refresh(): Promise<State> {
        const adapter = this.app?.vault?.adapter;
        if (!adapter || typeof adapter.exists !== 'function' || typeof adapter.read !== 'function') {
            throw new Error('Vault adapter read/exists methods are required to refresh manager state.');
        }
        if (!await adapter.exists(this.path)) {
            if (this.expected === null) {
                this.initialized = true;
                return clone(this.initialState);
            }
            throw new StateConflictError('Manager state file disappeared. Refresh the manager state from its source before resuming.');
        }
        const actual = await adapter.read(this.path);
        let parsed: unknown;
        try { parsed = JSON.parse(actual); } catch {
            throw new StateConflictError('Manager state is no longer valid JSON. Restore or refresh it before resuming.');
        }
        if (!parsed || typeof parsed !== 'object' || (parsed as any).schemaVersion !== 1) {
            throw new StateConflictError('Manager state schema changed. Refresh or migrate it before resuming.');
        }
        this.expected = actual;
        this.initialized = true;
        return parsed as State;
    }

    async writeJson(path: string, value: unknown): Promise<void> {
        this.assertActive();
        const adapter = this.app?.vault?.adapter;
        if (!adapter || typeof adapter.write !== 'function' || typeof adapter.read !== 'function') {
            throw new Error('Vault adapter read/write methods are required for effective-state reporting.');
        }
        const next = JSON.stringify(value, null, 2);
        await adapter.write(path, next);
        const readback = await adapter.read(path);
        if (readback !== next) throw new Error(`Readback failed for ${path}.`);
    }
}
