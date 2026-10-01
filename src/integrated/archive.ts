export type ArchiveEntry = {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  isDesktopOnly?: boolean;
  archivedAt: string;
};

type Pending = { id: string; operation: 'archive' | 'restore'; phase: 'moving'; entry: ArchiveEntry };
type ArchiveIndex = { schemaVersion: 1; installationId: string; entries: ArchiveEntry[]; pending?: Pending };
type Adapter = { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void>; mkdir(path: string): Promise<void>; rename(oldPath: string, newPath: string): Promise<void> };

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(id);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class ArchiveManager {
  private runtime: any;
  private app: any;
  private plugin: any;
  private adapter: Adapter;
  private root: string;
  private indexPath: string;
  private entries: ArchiveEntry[] = [];
  private rawIndex = '';
  private paused = false;
  private recoveryRequired = false;

  constructor(runtime: any, app: any, plugin: any) {
    this.runtime = runtime; this.app = app; this.plugin = plugin;
    this.adapter = app.vault.adapter;
    this.root = `${app.vault.configDir}/plugins/.aigility-archive`;
    this.indexPath = `${this.root}/index.json`;
  }

  async initialize(): Promise<void> {
    try {
      if (!(await this.adapter.exists(this.indexPath))) { this.rawIndex = ''; return; }
      const raw = await this.adapter.read(this.indexPath);
      const index = JSON.parse(raw) as ArchiveIndex;
      if (index?.schemaVersion !== 1 || index.installationId !== this.app.appId || !Array.isArray(index.entries) || index.entries.some(e => !this.validEntry(e))) {
        this.pause('Archive index is malformed or belongs to another installation'); return;
      }
      this.rawIndex = raw; this.entries = clone(index.entries);
      if (index.pending) { this.recoveryRequired = true; this.pause(`Archive recovery required for ${String(index.pending.id)}`); }
    } catch (error) { this.pause(`Archive index could not be read: ${String(error)}`); }
  }

  list(): ArchiveEntry[] { return clone(this.entries); }
  has(id: string): boolean { return this.entries.some(entry => entry.id === id); }
  get(id: string): ArchiveEntry | undefined { const entry = this.entries.find(item => item.id === id); return entry ? clone(entry) : undefined; }
  fingerprint(): string { return JSON.stringify(this.entries); }
  needsRecovery(): boolean { return this.recoveryRequired; }

  safety(): { allowed: boolean; reason?: string } {
    if (this.runtime.disposed === true) return { allowed: false, reason: 'Manager runtime is disposed' };
    if (this.paused) return { allowed: false, reason: 'Archive recovery is required' };
    if (this.runtime.local?.operationPending && !/^(?:profile|fixture):/.test(String(this.runtime.local.operationPending))) return { allowed: false, reason: 'Manager operation is pending' };
    if (this.runtime.state?.debug?.active || this.runtime.state?.debug?.session?.active) return { allowed: false, reason: 'Debug session is active' };
    if (this.app.plugins?.isEnabled?.() === false) return { allowed: false, reason: 'Restricted mode is active' };
    const sync = this.app.internalPlugins?.plugins?.sync;
    if (sync?.enabled) {
      const instance = sync.instance;
      if (!instance || !('vaultId' in instance)) return { allowed: false, reason: 'Sync state cannot be verified' };
      if (instance.vaultId === null) return { allowed: true };
      if (typeof instance.vaultId !== 'string' || !instance.filter || typeof instance.filter.allowSpecialFiles?.has !== 'function') return { allowed: false, reason: 'Sync state cannot be verified' };
      if (instance.filter.allowSpecialFiles.has('community-plugin-data')) return { allowed: false, reason: 'Sync includes community plugin data' };
    }
    return { allowed: true };
  }

  async archive(id: string): Promise<void> {
    this.assertId(id);
    await this.runtime.enqueue(`archive:${id}`, async (tx: any) => {
      const state = await tx.refresh();
      this.assertMutable(id, state);
      const entry = await this.readEntry(id);
      await this.commitMove(id, 'archive', entry, tx);
    });
  }

  async restore(id: string): Promise<void> {
    this.assertId(id);
    await this.runtime.enqueue(`archive-restore:${id}`, async (tx: any) => {
      const state = await tx.refresh();
      if (!this.has(id)) throw new Error('Plugin is not archived');
      this.assertSafety();
      const entry = this.get(id)!;
      await this.commitMove(id, 'restore', entry, tx);
      const record = this.runtime.state?.records?.[`community:${id}`];
      if (record) record.desired = false;
      await tx.save(); await tx.writeEffectiveState();
    });
  }

  async restoreInTransaction(id: string): Promise<void> {
    this.assertId(id);
    const pending = this.runtime.local?.operationPending;
    if (!/^(?:profile|fixture):/.test(String(pending ?? ''))) throw new Error('Profile transaction is not active');
    this.assertSafety();
    if (!this.has(id)) throw new Error('Plugin is not archived');
    await this.commitMove(id, 'restore', this.get(id)!, undefined, true);
  }

  async recover(): Promise<void> {
    await this.runtime.enqueue('archive-recovery', async (tx: any) => {
    const state = await tx.refresh();
    const index = await this.readIndex();
    const pending = index.pending;
    if (!pending || !validId(pending.id) || !this.validEntry(pending.entry) || pending.entry.id !== pending.id) throw new Error('No valid archive recovery journal exists');
    this.assertId(pending.id);
    this.assertRecoverySafety();
    const active = `${this.pluginRoot}/${pending.id}`, archived = `${this.root}/${pending.id}`;
    const [hasActive, hasArchived] = await Promise.all([this.adapter.exists(active), this.adapter.exists(archived)]);
    if (hasActive === hasArchived) throw new Error('Recovery refused: plugin folder is missing or exists in both locations');
    const path = hasActive ? active : archived;
    const manifest = await this.readManifest(path, pending.id);
    if (manifest.id !== pending.id) throw new Error('Recovery refused: manifest identity mismatch');
    const item = this.observed(pending.id);
    if (!item || item.nativeAutostart || item.loaded) throw new Error('Recovery refused: plugin native or loaded state cannot be verified as inactive');
    index.entries = index.entries.filter(e => e.id !== pending.id);
    if (hasArchived) index.entries.push(clone(pending.entry));
    else {
      const record = state.records?.[`community:${pending.id}`];
      if (record) record.desired = false;
    }
    delete index.pending;
    this.assertRecoverySafety();
    await this.writeIndex(index);
    this.entries = clone(index.entries);
    await tx.save();
    await tx.writeEffectiveState();
    this.runtime.pause?.(`Recovered archive journal for ${pending.id}; runtime remains paused`);
    this.paused = false;
    });
  }

  private async commitMove(id: string, operation: 'archive' | 'restore', entry: ArchiveEntry, tx?: any, profile = false): Promise<void> {
    const index = await this.readIndex();
    if (index.pending) throw new Error('Archive journal is pending recovery');
    const from = operation === 'archive' ? `${this.pluginRoot}/${id}` : `${this.root}/${id}`;
    const to = operation === 'archive' ? `${this.root}/${id}` : `${this.pluginRoot}/${id}`;
    if (!(await this.adapter.exists(from)) || await this.adapter.exists(to)) throw new Error('Archive move refused: source missing or destination already exists');
    const manifest = await this.readManifest(from, id);
    if (manifest.id !== id) throw new Error('Manifest identity mismatch');
    const generation = this.runtime.getMutationGeneration?.({ kind: 'community', id });
    index.pending = { id, operation, phase: 'moving', entry: clone(entry) };
    await this.writeIndex(index);
    try {
      if (tx) await tx.refresh();
      this.assertSafety();
      await this.assertMoveGuard(id, operation, from, to, entry, generation);
      if (!(await this.adapter.exists(this.root))) await this.adapter.mkdir(this.root);
      await this.adapter.rename(from, to);
      if (!(await this.adapter.exists(to)) || await this.adapter.exists(from)) throw new Error('Archive move readback failed');
      await this.app.plugins?.loadManifests?.();
      if (operation === 'archive' && this.app.plugins?.manifests?.[id]) throw new Error('Archived plugin remains in the active manifest catalog');
      if (operation === 'restore' && !this.app.plugins?.manifests?.[id]) throw new Error('Restored plugin is absent from the active manifest catalog');
      await this.assertMoveReadback(id, operation, to, from, entry, generation);
      index.entries = index.entries.filter((e: ArchiveEntry) => e.id !== id);
      if (operation === 'archive') index.entries.push(clone(entry));
      delete index.pending;
      await this.writeIndex(index);
      this.entries = clone(index.entries);
      if (operation === 'archive' && tx) {
        try { await tx.writeEffectiveState(); }
        catch (error) { this.runtime.log?.('error', `[Archive] Effective state report could not be updated: ${String(error)}`); }
      }
    } catch (error) { this.pause(`Archive operation requires recovery: ${String(error)}`); this.runtime.log?.('error', `[Archive] Archive operation failed: ${String(error)}`); throw error; }
  }

  private assertMutable(id: string, state: any): void {
    this.assertSafety();
    if (this.has(id)) throw new Error('Plugin is already archived');
    if (id === this.plugin?.manifest?.id || id === 'aigility-plugin-manager') throw new Error('Cannot archive the manager itself');
    if (state?.protected?.includes(`community:${id}`) || state?.protected?.includes(id)) throw new Error('Plugin is protected');
    if (this.runtime.disposed === true) throw new Error('Manager runtime is disposed');
    if (this.runtime.local?.operationPending) throw new Error('Manager operation is pending');
    if (state?.records?.[`community:${id}`]?.desired || this.app.plugins?.enabledPlugins?.has?.(id) || this.observed(id)?.nativeAutostart || this.observed(id)?.loaded) throw new Error('Plugin must be inactive before archiving');
    this.assertInactive(id);
  }
  private assertInactive(id: string): void {
    const item = this.observed(id);
    if (!item || !item.installed || item.ref?.kind !== 'community' || item.ref?.id !== id) throw new Error('Installed community plugin state cannot be verified');
    if (item.desired !== false || item.nativeAutostart !== false || item.loaded !== false || item.scheduled !== false) throw new Error('Plugin must be inactive and unscheduled before archiving');
  }
  private assertSafety(): void { const result = this.safety(); if (!result.allowed) throw new Error(result.reason); }
  private observed(id: string): any { return this.runtime.list?.().find((item: any) => item?.ref?.kind === 'community' && item.ref.id === id); }
  private assertRecoverySafety(): void {
    if (this.runtime.disposed === true) throw new Error('Archive recovery refused because the manager runtime is disposed');
    if (this.runtime.local?.operationPending || this.runtime.state?.debug?.active || this.runtime.state?.debug?.session?.active) throw new Error('Archive recovery refused while a manager operation or debug session is active');
    if (this.app.plugins?.isEnabled?.() === false) throw new Error('Archive recovery refused while restricted mode is active');
    const sync = this.app.internalPlugins?.plugins?.sync;
    if (sync?.enabled) {
      const instance = sync.instance;
      if (!instance || !('vaultId' in instance) || (instance.vaultId !== null && (typeof instance.vaultId !== 'string' || !instance.filter || typeof instance.filter.allowSpecialFiles?.has !== 'function' || instance.filter.allowSpecialFiles.has('community-plugin-data')))) throw new Error('Archive recovery refused because Sync state is unsafe or unverifiable');
    }
  }
  private async assertMoveGuard(id: string, operation: 'archive' | 'restore', from: string, to: string, entry: ArchiveEntry, generation: any): Promise<void> {
    const index = await this.readIndex();
    if (!index.pending || index.pending.id !== id || index.pending.operation !== operation || index.pending.entry.id !== entry.id) throw new Error('Archive journal changed before move');
    if (generation !== this.runtime.getMutationGeneration?.({ kind: 'community', id })) throw new Error('Plugin state changed during archive operation');
    if (!(await this.adapter.exists(from)) || await this.adapter.exists(to)) throw new Error('Archive move refused: source missing or destination already exists');
    const manifest = await this.readManifest(from, id);
    if (manifest.id !== id) throw new Error('Manifest identity mismatch');
    if (operation === 'archive') { this.assertInactive(id); this.assertMutableState(id); }
    else {
      const item = this.observed(id);
      if (!item || item.installed || item.loaded || item.nativeAutostart) throw new Error('Restore destination state cannot be verified as inactive');
      if (await this.adapter.exists(`${this.pluginRoot}/${id}`)) throw new Error('Restore destination already exists');
    }
    this.assertSafety();
    if (generation !== this.runtime.getMutationGeneration?.({ kind: 'community', id })) throw new Error('Plugin state changed during archive operation');
    if (!(await this.adapter.exists(from)) || await this.adapter.exists(to)) throw new Error('Archive move refused: source missing or destination already exists');
    await this.readManifest(from, id);
    if (operation === 'archive') { this.assertInactive(id); this.assertMutableState(id); }
    else {
      const item = this.observed(id);
      if (!item || item.installed || item.loaded || item.nativeAutostart) throw new Error('Restore destination state cannot be verified as inactive');
    }
  }
  private assertMutableState(id: string): void {
    const state = this.runtime.state;
    if (this.runtime.disposed === true) throw new Error('Manager runtime is disposed');
    if (this.runtime.local?.operationPending) throw new Error('Manager operation is pending');
    if (this.has(id)) throw new Error('Plugin is already archived');
    if (id === this.plugin?.manifest?.id || id === 'aigility-plugin-manager') throw new Error('Cannot archive the manager itself');
    if (state?.protected?.includes(`community:${id}`) || state?.protected?.includes(id)) throw new Error('Plugin is protected');
    if ((state?.records?.[`community:${id}`] && state.records[`community:${id}`].desired !== false) || this.app.plugins?.enabledPlugins?.has?.(id) || this.observed(id)?.nativeAutostart !== false || this.observed(id)?.loaded !== false) throw new Error('Plugin must be inactive before archiving');
  }
  private async assertMoveReadback(id: string, operation: 'archive' | 'restore', from: string, to: string, entry: ArchiveEntry, generation: any): Promise<void> {
    if (generation !== this.runtime.getMutationGeneration?.({ kind: 'community', id })) throw new Error('Plugin state changed during archive operation');
    if (!(await this.adapter.exists(from)) || await this.adapter.exists(to)) throw new Error('Archive move readback failed');
    await this.readManifest(from, id);
    if (operation === 'restore') {
      const item = this.observed(id);
      if (!item || item.nativeAutostart || item.loaded) throw new Error('Restored plugin runtime state is not inactive');
    }
  }
  private pause(reason: string): void { this.paused = true; try { this.runtime.pause?.(reason); } catch {} this.plugin?.log?.warn?.(`[Archive] ${reason}`); this.runtime.local && (this.runtime.local.recoveryReason = reason); }
  private get pluginRoot(): string { return `${this.app.vault.configDir}/plugins`; }
  private assertId(id: string): void { if (!validId(id) || id.startsWith('.') || id.includes('..')) throw new TypeError('Invalid plugin ID'); }
  private validEntry(value: any): value is ArchiveEntry { return Boolean(value && validId(value.id) && !value.id.startsWith('.') && typeof value.name === 'string' && typeof value.version === 'string' && typeof value.archivedAt === 'string'); }
  private async readEntry(id: string): Promise<ArchiveEntry> { const manifest = await this.readManifest(`${this.pluginRoot}/${id}`, id); return { id, name: manifest.name ?? id, version: manifest.version ?? '', ...(manifest.minAppVersion ? { minAppVersion: manifest.minAppVersion } : {}), ...(typeof manifest.isDesktopOnly === 'boolean' ? { isDesktopOnly: manifest.isDesktopOnly } : {}), archivedAt: new Date().toISOString() }; }
  private async readManifest(path: string, id: string): Promise<any> { const value = JSON.parse(await this.adapter.read(`${path}/manifest.json`)); if (value.id !== id) throw new Error('Manifest identity mismatch'); return value; }
  private async readIndex(): Promise<ArchiveIndex> {
    const raw = await this.adapter.exists(this.indexPath) ? await this.adapter.read(this.indexPath) : '';
    if (raw !== this.rawIndex) throw new Error('Archive index changed since it was read');
    if (!raw) return { schemaVersion: 1, installationId: this.app.appId, entries: clone(this.entries) };
    const index = JSON.parse(raw) as ArchiveIndex;
    if (index.schemaVersion !== 1 || index.installationId !== this.app.appId || !Array.isArray(index.entries)) throw new Error('Archive index is malformed or belongs to another installation');
    return index;
  }
  private async writeIndex(index: ArchiveIndex): Promise<void> {
    const current = await this.adapter.exists(this.indexPath) ? await this.adapter.read(this.indexPath) : '';
    if (current !== this.rawIndex) throw new Error('Archive index compare-and-swap failed');
    if (!(await this.adapter.exists(this.root))) await this.adapter.mkdir(this.root);
    const raw = JSON.stringify(index, null, 2);
    await this.adapter.write(this.indexPath, raw);
    this.rawIndex = raw;
    this.recoveryRequired = Boolean(index.pending);
  }
}
