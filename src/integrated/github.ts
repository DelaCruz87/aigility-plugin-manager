import * as Obsidian from 'obsidian';
import { Platform, requestUrl } from 'obsidian';
import type { GithubSource, Release, State, UpdateResult } from './types';

const API = 'https://api.github.com';
const REGISTRY = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
const REQUIRED_FILES = ['manifest.json', 'main.js'] as const;
const MAX_RELEASES = 100;
const CHECK_RELEASE_PAGE_SIZE = 3;
const RELEASE_PICKER_PAGE_SIZE = 50;
const MAX_CONCURRENCY = 3;
const MANAGER_ID = 'aigility-plugin-manager';
const ASSET_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com']);

type JsonObject = Record<string, unknown>;
type Adapter = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename?(oldPath: string, newPath: string): Promise<void>;
};
type GithubRuntime = {
  state: State;
  local?: { recoveryReason?: string; operationPending?: string };
  localKey?: string;
  enqueue<T>(label: string, operation: (transaction?: GithubTransaction) => Promise<T>): Promise<T>;
  getMutationGeneration(id: string): number;
  list?(): Array<{ ref: { kind: string; id: string }; installed?: boolean; compatible?: boolean; version?: string }>;
};
type GithubTransaction = {
  save(): Promise<void>;
  setEnabled(ref: { kind: 'community'; id: string }, enabled: boolean): Promise<void>;
  refresh(): Promise<void>;
  writeEffectiveState(): Promise<void>;
};
type ApiResponse = { status: number; json?: unknown; text?: string; headers?: Record<string, string> };
type ApiError = Error & { status?: number; reset?: string };
type ReleaseJson = {
  tag_name?: string;
  name?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};
type PluginManifest = { id?: string; version?: string; minAppVersion?: string; name?: string };
type SnapshotFile = { existed: boolean; backup?: string };
type BackupManifest = { id: string; repo: string; tag: string; previousVersion?: string; previousSource?: GithubSource; createdAt: string; files: Record<string, SnapshotFile>; wasEnabled: boolean; wasLoaded: boolean };

function parseRepository(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new TypeError('Invalid GitHub repository');
  let path = input.trim();
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try { url = new URL(path); } catch { throw new TypeError('Invalid GitHub repository URL'); }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
      throw new TypeError('Invalid GitHub repository URL');
    }
    path = url.pathname.replace(/^\/+|\/+$/g, '');
  } else if (path.includes('://') || path.includes('?') || path.includes('#') || path.startsWith('/') || path.endsWith('/')) {
    throw new TypeError('Invalid GitHub repository');
  }
  const segments = path.split('/');
  if (segments.length !== 2) throw new TypeError('Expected owner/repo');
  let [owner, repo] = segments;
  try { owner = decodeURIComponent(owner); repo = decodeURIComponent(repo); } catch { throw new TypeError('Invalid GitHub repository encoding'); }
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);
  const valid = (part: string) => part.length > 0 && part !== '.' && part !== '..' && /^[A-Za-z0-9_.-]+$/.test(part) && !part.includes('..');
  if (!valid(owner) || !valid(repo)) throw new TypeError('Invalid GitHub repository path');
  return `${owner}/${repo}`;
}

function validPluginId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(id) && id !== '.' && id !== '..' && !id.includes('..');
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const clean = value.trim().replace(/^v/i, '');
    const [base, prerelease = ''] = clean.split('-', 2);
    if (!/^[0-9]+(?:\.[0-9]+)*$/.test(base)) return null;
    return { nums: base.split('.').map(Number), pre: prerelease.split('.').filter(Boolean) };
  };
  const left = parse(a); const right = parse(b);
  if (!left || !right) return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  for (let i = 0; i < Math.max(left.nums.length, right.nums.length); i++) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i]; const y = right.pre[i];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y);
    if (xn && yn) return Math.sign(Number(x) - Number(y));
    if (xn !== yn) return xn ? -1 : 1;
    return x.localeCompare(y);
  }
  return 0;
}

function normalizedTag(tag: string): string { return tag.replace(/^v(?=\d)/i, ''); }
function header(headers: Record<string, string> | undefined, key: string): string | undefined {
  return Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
}

export class GithubManager {
  private runtime: GithubRuntime;
  private app: any;
  private plugin: any;
  private adapter: Adapter;

  constructor(runtime: any, app: any, plugin: any) {
    this.runtime = runtime;
    this.app = app;
    this.plugin = plugin;
    this.adapter = app.vault.adapter as Adapter;
  }

  private async token(): Promise<string | undefined> {
    const storage = this.app?.secretStorage;
    if (typeof storage?.getSecret !== 'function') return undefined;
    try { return (await storage.getSecret('aigility-plugin-manager.github-token'))?.trim() || undefined; }
    catch { return undefined; }
  }

  private async request(url: string, text = false): Promise<ApiResponse> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('GitHub requests require HTTPS');
    const isApi = parsed.hostname === 'api.github.com';
    if (!isApi && !ASSET_HOSTS.has(parsed.hostname)) throw new Error('Release asset host is not trusted');
    const token = isApi ? await this.token() : undefined;
    const request = this.plugin?.githubRequest ?? requestUrl;
    const response = await request({
      url,
      throw: false,
      headers: { Accept: text ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'aigility-plugin-manager', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }) as ApiResponse;
    if (response.status >= 400) {
      const error = new Error(response.status === 403 && header(response.headers, 'x-ratelimit-remaining') === '0'
        ? 'GitHub API rate limit reached'
        : `GitHub request failed (${response.status})`) as ApiError;
      error.status = response.status;
      error.reset = header(response.headers, 'x-ratelimit-reset');
      throw error;
    }
    return response;
  }

  private async json<T>(url: string): Promise<T> { return (await this.request(url)).json as T; }
  private async text(url: string): Promise<string> { return (await this.request(url, true)).text ?? ''; }
  private blocked(): string | undefined {
    if (this.runtime.local?.recoveryReason || this.runtime.local?.operationPending) return 'Manager recovery is active';
    const debug = this.runtime.state.debug as { active?: boolean; status?: string; session?: { active?: boolean } } | undefined;
    if (debug?.active || debug?.session?.active || debug?.status === 'active') return 'Debug session is active';
    return undefined;
  }

  private beginPending(label: string): void {
    const local = this.runtime.local;
    const storage = (globalThis as any).localStorage;
    if (!local || !this.runtime.localKey || typeof storage?.setItem !== 'function') throw new Error('Persistent runtime local state is required for GitHub recovery safety');
    if (local.operationPending || local.recoveryReason) throw new Error('Manager recovery is active');
    local.operationPending = label;
    try { storage.setItem(this.runtime.localKey, JSON.stringify(local)); }
    catch (error) { delete local.operationPending; throw error; }
  }

  private clearPending(label: string): void {
    const local = this.runtime.local;
    const storage = (globalThis as any).localStorage;
    if (!local || !this.runtime.localKey || typeof storage?.setItem !== 'function') throw new Error('Persistent runtime local state is unavailable while clearing GitHub recovery state');
    if (local.operationPending !== label) throw new Error('GitHub operation recovery marker changed unexpectedly');
    delete local.operationPending;
    try { storage.setItem(this.runtime.localKey, JSON.stringify(local)); }
    catch (error) { local.operationPending = label; throw error; }
  }

  async releases(repoInput: string): Promise<Release[]> {
    const repo = parseRepository(repoInput);
    const result: Release[] = [];
    for (let page = 1; result.length < MAX_RELEASES && page <= Math.ceil(MAX_RELEASES / RELEASE_PICKER_PAGE_SIZE); page++) {
      const batch = await this.json<ReleaseJson[]>(`${API}/repos/${repo}/releases?per_page=${RELEASE_PICKER_PAGE_SIZE}&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid release list');
      for (const item of batch) {
        if (item.draft || !item.tag_name) continue;
        result.push({ tag: item.tag_name, name: item.name || item.tag_name, prerelease: Boolean(item.prerelease), assets: (item.assets ?? []).map((asset) => asset.name).filter((name): name is string => typeof name === 'string') });
        if (result.length >= MAX_RELEASES) break;
      }
      if (batch.length < RELEASE_PICKER_PAGE_SIZE) break;
    }
    return result;
  }

  private transaction(value: GithubTransaction | undefined): GithubTransaction {
    if (!value || typeof value.save !== 'function' || typeof value.setEnabled !== 'function' || typeof value.refresh !== 'function' || typeof value.writeEffectiveState !== 'function') {
      throw new Error('GitHub integration requires the transaction-aware runtime queue');
    }
    return value;
  }

  private apiVersion(): string {
    const version = (Obsidian as unknown as { apiVersion?: unknown }).apiVersion;
    if (typeof version !== 'string' || !version.trim()) throw new Error('Obsidian apiVersion export is unavailable');
    return version;
  }

  private mutationGeneration(id: string): number {
    const generation = this.runtime.getMutationGeneration(id);
    if (!Number.isSafeInteger(generation)) throw new Error('Runtime mutation generation is unavailable');
    return generation;
  }

  private backupRoot(id: string): string { return `${this.app.vault.configDir}/plugins/${MANAGER_ID}/backups/${id}`; }
  private pluginRoot(id: string): string { return `${this.app.vault.configDir}/plugins/${id}`; }

  private async ensureDir(path: string): Promise<void> {
    const parts = path.split('/'); let current = '';
    for (const part of parts) { current = current ? `${current}/${part}` : part; if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current); }
  }

  private async backup(id: string, repo: string, tag: string, wasEnabled: boolean, wasLoaded: boolean, previousSource?: GithubSource): Promise<{ directory: string; manifest: BackupManifest }> {
    const directory = `${this.backupRoot(id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.ensureDir(directory);
    const files: BackupManifest['files'] = {};
    let previousVersion: string | undefined;
    for (const filename of [...REQUIRED_FILES, 'styles.css']) {
      const target = `${this.pluginRoot(id)}/${filename}`;
      const existed = await this.adapter.exists(target);
      if (existed) {
        const backupFile = `${directory}/${filename}`;
        const content = await this.adapter.read(target);
        await this.adapter.write(backupFile, content);
        if (filename === 'manifest.json') {
          try { previousVersion = (JSON.parse(content) as PluginManifest).version; } catch { /* Preserve exact prior bytes; malformed prior manifests remain rollbackable. */ }
        }
        files[filename] = { existed, backup: backupFile };
      } else files[filename] = { existed: false };
    }
    const manifest: BackupManifest = { id, repo, tag, previousVersion, previousSource, createdAt: new Date().toISOString(), files, wasEnabled, wasLoaded };
    await this.adapter.write(`${directory}/metadata.json`, JSON.stringify(manifest));
    await this.adapter.write(`${this.backupRoot(id)}/latest.json`, JSON.stringify({ directory }));
    return { directory, manifest };
  }

  private async readLatestBackup(id: string): Promise<{ directory: string; manifest: BackupManifest }> {
    const pointer = JSON.parse(await this.adapter.read(`${this.backupRoot(id)}/latest.json`)) as { directory?: unknown };
    if (typeof pointer.directory !== 'string' || !pointer.directory.startsWith(`${this.backupRoot(id)}/`) || pointer.directory.split('/').includes('..')) throw new Error('Invalid backup pointer');
    const manifest = JSON.parse(await this.adapter.read(`${pointer.directory}/metadata.json`)) as BackupManifest;
    if (manifest.id !== id) throw new Error('Backup plugin identity mismatch');
    return { directory: pointer.directory, manifest };
  }

  private async atomicWrite(target: string, value: string | null, nonce: string): Promise<void> {
    if (value === null) { if (await this.adapter.exists(target)) await this.adapter.remove(target); return; }
    const staged = `${target}.aigility-${nonce}.tmp`;
    await this.adapter.write(staged, value);
    if (this.adapter.rename) {
      if (await this.adapter.exists(target)) await this.adapter.remove(target);
      await this.adapter.rename(staged, target);
    } else await this.adapter.write(target, value);
    if (await this.adapter.exists(staged)) await this.adapter.remove(staged);
  }

  private async restoreSnapshot(id: string, manifest: BackupManifest): Promise<void> {
    const nonce = `rollback-${Date.now()}`;
    for (const filename of [...REQUIRED_FILES, 'styles.css']) {
      const item = manifest.files[filename];
      if (!item) throw new Error('Backup metadata is incomplete');
      await this.atomicWrite(`${this.pluginRoot(id)}/${filename}`, item.existed ? await this.adapter.read(item.backup!) : null, nonce);
    }
    await this.verifySnapshot(id, manifest);
  }

  private async verifySnapshot(id: string, manifest: BackupManifest): Promise<void> {
    for (const filename of [...REQUIRED_FILES, 'styles.css']) {
      const target = `${this.pluginRoot(id)}/${filename}`; const item = manifest.files[filename];
      if (Boolean(await this.adapter.exists(target)) !== item.existed) throw new Error(`Rollback readback failed for ${filename}`);
      if (item.existed && await this.adapter.read(target) !== await this.adapter.read(item.backup!)) throw new Error(`Rollback readback failed for ${filename}`);
    }
  }

  private async syncPluginAfterWrite(id: string, wasLoaded: boolean): Promise<void> {
    await this.app.plugins?.loadManifests?.();
    const manifest = this.app.plugins?.manifests?.[id] as PluginManifest | undefined;
    if (!manifest || manifest.id !== id) throw new Error('Installed manifest could not be read back');
    const disk = JSON.parse(await this.adapter.read(`${this.pluginRoot(id)}/manifest.json`)) as PluginManifest;
    if (disk.id !== id || disk.version !== manifest.version) throw new Error('Installed manifest readback mismatch');
    if (wasLoaded && this.isEnabled(id)) {
      if (typeof this.app.plugins?.loadPlugin !== 'function') throw new Error('Obsidian plugin loader is unavailable for restoring the loaded state');
      await this.app.plugins.loadPlugin(id);
      if (!this.app.plugins?.plugins?.[id]) throw new Error('Plugin did not return to the loaded state');
    }
  }

  private isEnabled(id: string): boolean {
    const enabled = this.app.plugins?.enabledPlugins;
    return enabled?.has ? enabled.has(id) : Boolean(enabled?.[id]);
  }

  async install(repoInput: string, tagInput: string): Promise<string> {
    const repo = parseRepository(repoInput);
    if (typeof tagInput !== 'string' || !tagInput.trim() || tagInput.includes('/') || tagInput.includes('..')) throw new TypeError('Invalid release tag');
    const tag = tagInput.trim();
    const paused = this.blocked(); if (paused) throw new Error(paused);
    return this.runtime.enqueue(`github-install:${repo}`, async (rawTransaction) => {
      const transaction = this.transaction(rawTransaction);
      const queuedPause = this.blocked(); if (queuedPause) throw new Error(queuedPause);
      const sourceEntry = Object.entries(this.runtime.state.githubSources).find(([, source]) => {
        try { return parseRepository(source.repo) === repo; } catch { return false; }
      });
      const sourceKey = sourceEntry?.[0];
      const sourceBefore = sourceKey ? structuredClone(this.runtime.state.githubSources[sourceKey]) : undefined;
      const expectedId = sourceKey?.startsWith('community:') ? sourceKey.slice('community:'.length) : undefined;
      const preNetworkFiles = new Map<string, string | null>();
      const preNetworkGeneration = expectedId ? this.mutationGeneration(expectedId) : undefined;
      const preNetworkEnabled = expectedId ? this.isEnabled(expectedId) : undefined;
      const preNetworkLoaded = expectedId ? Boolean(this.app.plugins?.plugins?.[expectedId]) : undefined;
      if (expectedId) for (const filename of [...REQUIRED_FILES, 'styles.css']) {
        const path = `${this.pluginRoot(expectedId)}/${filename}`;
        preNetworkFiles.set(filename, await this.adapter.exists(path) ? await this.adapter.read(path) : null);
      }
      const release = await this.json<ReleaseJson>(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
      if (release.draft || !release.tag_name || release.tag_name !== tag) throw new Error('Requested release is unavailable');
      const assets = new Map<string, string | undefined>();
      for (const asset of release.assets ?? []) if (typeof asset.name === 'string') assets.set(asset.name, asset.browser_download_url);
      for (const name of REQUIRED_FILES) if (!assets.get(name)) throw new Error(`Release is missing required asset: ${name}`);
      const manifestText = await this.text(assets.get('manifest.json')!);
      let manifest: PluginManifest;
      try { manifest = JSON.parse(manifestText) as PluginManifest; } catch { throw new Error('Release manifest is invalid JSON'); }
      if (!validPluginId(manifest.id) || !manifest.version) throw new Error('Release manifest is missing a valid id or version');
      if (expectedId && manifest.id !== expectedId) throw new Error('Release manifest plugin id does not match the configured source');
      if (normalizedTag(release.tag_name) !== normalizedTag(manifest.version)) throw new Error('Release tag and manifest version do not match');
      const recordKey = `community:${manifest.id}`;
      if (manifest.id === MANAGER_ID || this.runtime.state.protected.includes(recordKey)) throw new Error('Protected plugin cannot be replaced');
      const hostApiVersion = this.apiVersion();
      if (manifest.minAppVersion && compareVersions(hostApiVersion, manifest.minAppVersion) < 0) throw new Error(`Incompatible Obsidian version: requires ${manifest.minAppVersion}`);
      if ((manifest as JsonObject).isDesktopOnly === true && (this.app?.isMobile === true || Platform.isMobile || !Platform.isDesktopApp)) throw new Error('Plugin is desktop-only');

      const root = this.pluginRoot(manifest.id);
      const generation = preNetworkGeneration ?? this.mutationGeneration(manifest.id);
      const wasEnabled = preNetworkEnabled ?? this.isEnabled(manifest.id);
      const wasLoaded = preNetworkLoaded ?? Boolean(this.app.plugins?.plugins?.[manifest.id]);
      const original = preNetworkFiles.size ? preNetworkFiles : new Map<string, string | null>();
      for (const filename of [...REQUIRED_FILES, 'styles.css']) if (!original.has(filename)) {
        const path = `${root}/${filename}`;
        original.set(filename, await this.adapter.exists(path) ? await this.adapter.read(path) : null);
      }
      const mainJs = await this.text(assets.get('main.js')!);
      const stylesUrl = assets.get('styles.css');
      const styles = stylesUrl ? await this.text(stylesUrl) : null;
      if (this.mutationGeneration(manifest.id) !== generation || this.isEnabled(manifest.id) !== wasEnabled || Boolean(this.app.plugins?.plugins?.[manifest.id]) !== wasLoaded) throw new Error('Plugin enablement or mutation generation changed during release validation');
      if (sourceKey && JSON.stringify(this.runtime.state.githubSources[sourceKey]) !== JSON.stringify(sourceBefore)) throw new Error('GitHub source configuration changed during release validation');
      for (const filename of [...REQUIRED_FILES, 'styles.css']) {
        const path = `${root}/${filename}`;
        const current = await this.adapter.exists(path) ? await this.adapter.read(path) : null;
        if (current !== original.get(filename)) throw new Error(`Plugin files changed during release validation: ${filename}`);
      }

      const operationLabel = `github-install:${manifest.id}`;
      this.beginPending(operationLabel);
      let savedBackup: { directory: string; manifest: BackupManifest } | undefined;
      const oldSource = this.runtime.state.githubSources[recordKey];
      const nonce = `install-${Date.now()}`;
      let saveAttempted = false;
      try {
        await this.ensureDir(root);
        savedBackup = await this.backup(manifest.id, repo, release.tag_name, wasEnabled, wasLoaded, oldSource);
        for (const filename of [...REQUIRED_FILES, 'styles.css']) {
          const path = `${root}/${filename}`;
          const current = await this.adapter.exists(path) ? await this.adapter.read(path) : null;
          if (current !== original.get(filename)) throw new Error(`Plugin files changed before install: ${filename}`);
        }
        if (wasLoaded) await this.app.plugins?.unloadPlugin?.(manifest.id);
        await this.atomicWrite(`${root}/manifest.json`, manifestText, nonce);
        await this.atomicWrite(`${root}/main.js`, mainJs, nonce);
        await this.atomicWrite(`${root}/styles.css`, styles, nonce);
        for (const filename of [...REQUIRED_FILES, 'styles.css']) {
          const expected = filename === 'manifest.json' ? manifestText : filename === 'main.js' ? mainJs : styles;
          const path = `${root}/${filename}`;
          if (expected === null ? await this.adapter.exists(path) : await this.adapter.read(path) !== expected) throw new Error(`Installed file readback mismatch: ${filename}`);
        }
        await this.syncPluginAfterWrite(manifest.id, wasLoaded && this.isEnabled(manifest.id) && this.mutationGeneration(manifest.id) === generation);
        const source = this.runtime.state.githubSources[recordKey] ?? { repo, trackPrereleases: false };
        this.runtime.state.githubSources[recordKey] = { ...source, repo, version: manifest.version };
        saveAttempted = true;
        await transaction.save();
        await transaction.refresh();
        await transaction.writeEffectiveState();
        this.clearPending(operationLabel);
        return manifest.id;
      } catch (error) {
        if (oldSource) this.runtime.state.githubSources[recordKey] = oldSource;
        else delete this.runtime.state.githubSources[recordKey];
        if (savedBackup) {
          try {
            if (this.app.plugins?.plugins?.[manifest.id]) await this.app.plugins?.unloadPlugin?.(manifest.id);
            for (const filename of [...REQUIRED_FILES, 'styles.css']) await this.atomicWrite(`${root}/${filename}`, original.get(filename) ?? null, `${nonce}-restore`);
            await this.syncPluginAfterWrite(manifest.id, wasLoaded && this.isEnabled(manifest.id) && this.mutationGeneration(manifest.id) === generation);
            if (saveAttempted) {
              await transaction.save();
              await transaction.refresh();
              await transaction.writeEffectiveState();
            }
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Installation failed and rollback was incomplete');
          }
        }
        this.clearPending(operationLabel);
        throw error;
      }
    });
  }

  async rollback(id: string): Promise<void> {
    if (!validPluginId(id)) throw new TypeError('Invalid plugin id');
    const paused = this.blocked(); if (paused) throw new Error(paused);
    const priorSource = this.runtime.state.githubSources[`community:${id}`];
    if (id === MANAGER_ID) throw new Error('The manager cannot roll back its own running files');
    await this.runtime.enqueue(`github-rollback:${id}`, async (rawTransaction) => {
      const transaction = this.transaction(rawTransaction);
      const queuedPause = this.blocked(); if (queuedPause) throw new Error(queuedPause);
      const { manifest } = await this.readLatestBackup(id);
      const operationLabel = `github-rollback:${id}`;
      this.beginPending(operationLabel);
      const wasLoaded = Boolean(this.app.plugins?.plugins?.[id]);
      const stillEnabled = this.isEnabled(id);
      const sourceKey = `community:${id}`;
      const currentFiles = new Map<string, string | null>();
      for (const filename of [...REQUIRED_FILES, 'styles.css']) {
        const path = `${this.pluginRoot(id)}/${filename}`;
        currentFiles.set(filename, await this.adapter.exists(path) ? await this.adapter.read(path) : null);
      }
      let saveAttempted = false;
      try {
        if (wasLoaded) await this.app.plugins?.unloadPlugin?.(id);
        await this.restoreSnapshot(id, manifest);
        if (manifest.files['manifest.json']?.existed) await this.syncPluginAfterWrite(id, wasLoaded && stillEnabled);
        else {
          await this.app.plugins?.loadManifests?.();
          if (this.app.plugins?.manifests?.[id]) throw new Error('Rollback readback found an unexpected installed manifest');
        }
        if (manifest.previousSource) this.runtime.state.githubSources[sourceKey] = { ...manifest.previousSource, ...(manifest.previousVersion ? { version: manifest.previousVersion } : {}) };
        else delete this.runtime.state.githubSources[sourceKey];
        saveAttempted = true;
        await transaction.save();
        await transaction.refresh();
        await transaction.writeEffectiveState();
        this.clearPending(operationLabel);
      } catch (error) {
        if (priorSource) this.runtime.state.githubSources[sourceKey] = priorSource;
        else delete this.runtime.state.githubSources[sourceKey];
        try {
          for (const filename of [...REQUIRED_FILES, 'styles.css']) await this.atomicWrite(`${this.pluginRoot(id)}/${filename}`, currentFiles.get(filename) ?? null, `rollback-failed-${Date.now()}`);
          if (wasLoaded && stillEnabled) await this.syncPluginAfterWrite(id, true);
          if (saveAttempted) {
            await transaction.save();
            await transaction.refresh();
            await transaction.writeEffectiveState();
          }
          this.clearPending(operationLabel);
        } catch (restoreError) {
          throw new AggregateError([error, restoreError], 'Rollback failed and the prior installed state could not be restored');
        }
        throw error;
      }
    });
  }

  async checkAll(): Promise<UpdateResult[]> {
    if (this.blocked()) return [];
    const records = this.runtime.list?.() ?? Object.values(this.runtime.state.records).map((record) => ({ ref: record.ref, installed: true, compatible: true, version: record.version }));
    const installed = records.filter((record) => record.ref.kind === 'community' && record.installed !== false);
    let registry: Array<{ id?: unknown; repo?: unknown }> = [];
    try { registry = await this.json<Array<{ id?: unknown; repo?: unknown }>>(REGISTRY); }
    catch { /* Configured source mappings still support checks while the registry is offline. */ }
    const repos = new Map<string, string>();
    if (Array.isArray(registry)) for (const item of registry) {
      if (typeof item?.id === 'string' && typeof item.repo === 'string') {
        try { repos.set(item.id, parseRepository(item.repo)); } catch { /* Ignore malformed upstream mappings. */ }
      }
    }
    const jobs = installed.map((record) => ({ id: record.ref.id, current: record.version ?? '', compatible: record.compatible !== false, source: this.runtime.state.githubSources[`community:${record.ref.id}`], repo: this.runtime.state.githubSources[`community:${record.ref.id}`]?.repo ?? repos.get(record.ref.id) }));
    const results: UpdateResult[] = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        if (!job.compatible) { results[index] = { id: job.id, current: job.current, error: 'Installed plugin is marked incompatible' }; continue; }
        if (!job.repo) { results[index] = { id: job.id, current: job.current, error: 'Repository mapping unavailable' }; continue; }
        try {
          const repo = parseRepository(job.repo);
          const pinned = job.source?.pinned;
          const candidates = pinned
            ? [await this.json<ReleaseJson>(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(pinned)}`)]
            : job.source?.trackPrereleases
              ? await this.json<ReleaseJson[]>(`${API}/repos/${repo}/releases?per_page=${CHECK_RELEASE_PAGE_SIZE}&page=1`)
              : [await this.json<ReleaseJson>(`${API}/repos/${repo}/releases/latest`)];
          const selected = candidates.find((release) => !release.draft && release.tag_name && (pinned || job.source?.trackPrereleases ? Boolean(release.prerelease || pinned) : !release.prerelease));
          if (!selected?.tag_name) { results[index] = { id: job.id, current: job.current, repo, error: 'No compatible release found' }; continue; }
          const manifestAsset = selected.assets?.find((asset) => asset.name === 'manifest.json')?.browser_download_url;
          if (!manifestAsset) { results[index] = { id: job.id, current: job.current, repo, proposed: selected.tag_name, error: 'Release is missing manifest.json' }; continue; }
          const manifest = JSON.parse(await this.text(manifestAsset)) as PluginManifest;
          if (manifest.id !== job.id || !manifest.version || normalizedTag(manifest.version) !== normalizedTag(selected.tag_name)) throw new Error('Release manifest identity/version mismatch');
          const hostApiVersion = this.apiVersion();
          if (manifest.minAppVersion && compareVersions(hostApiVersion, manifest.minAppVersion) < 0) throw new Error(`Incompatible Obsidian version: requires ${manifest.minAppVersion}`);
          if ((manifest as JsonObject).isDesktopOnly === true && (this.app?.isMobile === true || Platform.isMobile || !Platform.isDesktopApp)) throw new Error('Plugin is desktop-only on this device');
          results[index] = compareVersions(manifest.version, job.current) > 0
            ? { id: job.id, current: job.current, proposed: manifest.version, repo }
            : { id: job.id, current: job.current, repo };
        } catch (error) { results[index] = { id: job.id, current: job.current, repo: job.repo, error: error instanceof Error ? error.message : 'GitHub update check failed' }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, jobs.length) }, worker));
    return results;
  }

  async setPin(id: string, version?: string): Promise<void> {
    if (!validPluginId(id)) throw new TypeError('Invalid plugin id');
    const paused = this.blocked(); if (paused) throw new Error(paused);
    await this.runtime.enqueue(`github-pin:${id}`, async (rawTransaction) => {
      const transaction = this.transaction(rawTransaction);
      const queuedPause = this.blocked(); if (queuedPause) throw new Error(queuedPause);
      const key = `community:${id}`; const source = this.runtime.state.githubSources[key];
      if (!source) throw new Error(`No GitHub source is configured for ${id}`);
      const pinned = version?.trim();
      if (pinned && (pinned.includes('/') || pinned.includes('..'))) throw new TypeError('Invalid pinned version');
      const operationLabel = `github-pin:${id}`;
      this.beginPending(operationLabel);
      const nextSource = { ...source, pinned: pinned || undefined };
      this.runtime.state.githubSources[key] = nextSource;
      let saveAttempted = false;
      try {
        saveAttempted = true;
        await transaction.save();
        await transaction.writeEffectiveState();
        this.clearPending(operationLabel);
      } catch (error) {
        if (this.runtime.state.githubSources[key] === nextSource) this.runtime.state.githubSources[key] = source;
        if (saveAttempted) {
          await transaction.save();
          await transaction.writeEffectiveState();
        }
        this.clearPending(operationLabel);
        throw error;
      }
    });
  }
}

export { compareVersions as compareGithubVersions, parseRepository as parseGithubRepository };
