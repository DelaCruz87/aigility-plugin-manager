export type PluginKind = 'community' | 'core';

export interface PluginRef {
  kind: PluginKind;
  id: string;
}

export interface Record {
  ref: PluginRef;
  name: string;
  version: string;
  tags: string[];
  group: string;
  desired: boolean;
  metadata: { [key: string]: unknown };
}

export type PluginRecord = Record;

export interface DeviceProfile {
  id: string;
  name: string;
  tagIds: string[];
  applyAtStart: boolean;
  workspaceId?: string;
  template?: string;
}

export interface FixtureProfile {
  id: string;
  name: string;
  members: { [key: string]: boolean };
  metadata?: { [key: string]: unknown };
}

export interface DeferredPolicy {
  id: string;
  delayMs: number;
  enabled: boolean;
  parked?: boolean;
}

export interface GithubSource {
  repo: string;
  version?: string;
  pinned?: string;
  trackPrereleases: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

export interface Group {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface State {
  schemaVersion: 1;
  records: { [key: string]: PluginRecord };
  tags: Tag[];
  groups: Group[];
  deviceProfiles: DeviceProfile[];
  fixtureProfiles: FixtureProfile[];
  deferred: DeferredPolicy[];
  protected: string[];
  profileBackups: unknown[];
  githubSources: { [key: string]: GithubSource };
  settings: {
    staggerMs: number;
    automaticUpdates: boolean;
  };
  migration?: { [key: string]: unknown };
  legacyBpm: { [key: string]: unknown };
  debug?: unknown;
  undo?: unknown;
}

export interface LocalState {
  deviceProfileId?: string;
  recoveryReason?: string;
  operationPending?: string;
}

export interface ObservedPlugin {
  ref: PluginRef;
  name: string;
  version: string;
  installed: boolean;
  compatible: boolean;
  nativeAutostart: boolean;
  loaded: boolean;
}

export interface EffectivePlugin extends ObservedPlugin {
  desired: boolean;
  tags: string[];
  group: string;
  scheduled: boolean;
  reason?: string;
}

export interface Change {
  ref: PluginRef;
  before: boolean;
  after: boolean;
  reason?: string;
}

export interface Release {
  tag: string;
  name: string;
  prerelease: boolean;
  assets: string[];
}

export interface UpdateResult {
  id: string;
  current: string;
  proposed?: string;
  repo?: string;
  error?: string;
}

/** Return the canonical State.records key for a plugin reference. */
export function key(ref: PluginRef): string {
  if (!isPluginKind(ref?.kind) || !isValidId(ref.id)) {
    throw new TypeError('Invalid plugin reference');
  }
  return `${ref.kind}:${ref.id}`;
}

/** Parse a canonical plugin key, returning null when it is malformed. */
export function parseKey(value: unknown): PluginRef | null {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf(':');
  if (separator <= 0 || separator !== value.lastIndexOf(':')) return null;

  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!isPluginKind(kind) || !isValidId(id)) return null;
  return { kind, id };
}

function isPluginKind(value: unknown): value is PluginKind {
  return value === 'community' || value === 'core';
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes(':') && value.trim() === value;
}
