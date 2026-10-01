// Integrated migration: legacy Better Plugins Manager (BPM) + Companion data
// into the canonical AIgility State (CONTRACT.md, schemaVersion 1).
//
// Pure and IO-free: reads plain data, returns plain data, never touches the
// host, the vault or the legacy inputs (inputs are cloned, never mutated).
// Secrets found in legacy data are redacted before they enter State (NFR-1);
// everything else is preserved opaquely under `legacyBpm`.

import type {
    DeferredPolicy,
    DeviceProfile,
    FixtureProfile,
    GithubSource,
    Group,
    ObservedPlugin,
    PluginRef,
    PluginRecord,
    State,
    Tag,
} from './types';

export const MIGRATION_SCHEMA_VERSION = 1;

export const MANAGER_PLUGIN_ID = 'aigility-plugin-manager';
export const LEGACY_BPM_PLUGIN_ID = 'better-plugins-manager';
export const LEGACY_COMPANION_PLUGIN_ID = 'better-plugins-manager-companion';
export const LEGACY_ADVANCED_DEBUG_PLUGIN_ID = 'advanced-debug-mode';

// Source managers keep their historical records but never become members of a
// new device profile: the integrated manager replaces them and the
// independent Advanced Debug Mode must not be auto-enabled while the
// integrated debug module exists.
const EXCLUDED_FROM_DEVICE_MEMBERSHIP: ReadonlySet<string> = new Set([
    LEGACY_BPM_PLUGIN_ID,
    LEGACY_COMPANION_PLUGIN_ID,
    LEGACY_ADVANCED_DEBUG_PLUGIN_ID,
]);

const PROTECTED_BASELINE: readonly string[] = [
    'enso-sync-manager',
    'note-toolbar',
    'obsidian-git',
    'tasknotes',
    MANAGER_PLUGIN_ID,
];

const DEFAULT_SETTINGS = Object.freeze({
    staggerMs: 250,
    automaticUpdates: false,
});

type DeviceTemplateName = 'macbook' | 'zenbook' | 'iphone' | 'ipad' | 's24' | 'lenovo tab' | 'boox tab mini c';
type CompanionTemplate = 'desktop' | 'tablet' | 'mobile';

// Seven physical devices approved for the migration. `template` maps each one
// to the Companion profile that fed its membership; `workspaceId` is resolved
// from the Companion saved workspaces at migration time.
export const DEVICE_TEMPLATES: ReadonlyArray<{
    id: DeviceTemplateName;
    template: CompanionTemplate;
    color: string;
}> = Object.freeze([
    { id: 'macbook', template: 'desktop', color: '#3498db' },
    { id: 'zenbook', template: 'desktop', color: '#2f80c2' },
    { id: 'iphone', template: 'mobile', color: '#2ecc71' },
    { id: 'ipad', template: 'tablet', color: '#9b59b6' },
    { id: 's24', template: 'mobile', color: '#27ae60' },
    { id: 'lenovo tab', template: 'tablet', color: '#8e6bc1' },
    { id: 'boox tab mini c', template: 'tablet', color: '#7d55a8' },
]);

const TEMPLATE_MEMBERSHIP: Readonly<Record<CompanionTemplate, readonly DeviceTemplateName[]>> = Object.freeze({
    desktop: ['macbook', 'zenbook'],
    mobile: ['iphone', 's24'],
    tablet: ['ipad', 'lenovo tab', 'boox tab mini c'],
});

const EQUIPMENT_TAG_IDS: readonly string[] = DEVICE_TEMPLATES.map((template) => template.id);

const SECRET_KEY_PATTERN = /token|secret|password|api[-_]?key|credential|authorization/i;
const REDACTED = '[redacted]';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneDeep<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // fall through to JSON cloning for non-cloneable values
        }
    }
    return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function cloneIfPossible<T>(value: unknown): T | undefined {
    return isPlainObject(value) || Array.isArray(value) ? cloneDeep(value) as T : undefined;
}

// Removes secret material in place on a CLONE; only the redaction marker ever
// reaches State, reports or git.
function redactSecrets(node: unknown): void {
    if (Array.isArray(node)) {
        for (const item of node) redactSecrets(item);
        return;
    }
    if (!isPlainObject(node)) return;
    for (const key of Object.keys(node)) {
        if (SECRET_KEY_PATTERN.test(key)) {
            node[key] = REDACTED;
        } else {
            redactSecrets(node[key]);
        }
    }
}

function recordKey(kind: PluginRef['kind'], id: string): string {
    return `${kind}:${id}`;
}

function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function observedKey(observed: ObservedPlugin): string | null {
    const ref = (observed as { ref?: unknown }).ref;
    if (!isPlainObject(ref)) return null;
    const kind = ref.kind;
    const id = ref.id;
    if ((kind !== 'community' && kind !== 'core') || typeof id !== 'string' || id === '') return null;
    return recordKey(kind, id);
}

function isObservedEntry(value: unknown): value is ObservedPlugin {
    return isPlainObject(value) && observedKey(value as ObservedPlugin) !== null;
}

function isActive(observed: ObservedPlugin | undefined): boolean {
    if (!observed) return false;
    return observed.loaded === true || observed.nativeAutostart === true;
}

function pushUnique(list: string[], value: string): void {
    if (!list.includes(value)) list.push(value);
}

// An already-migrated State supplied as migration input is returned as-is
// (cloned): re-running migrateLegacy must never re-derive, duplicate tags,
// profiles or backups. Full idempotence by schemaVersion stays the host's
// responsibility, this guard keeps it safe if the host hands us State back.
function looksLikeMigratedState(value: unknown): value is State {
    if (!isPlainObject(value)) return false;
    return value.schemaVersion === MIGRATION_SCHEMA_VERSION
        && isPlainObject(value.records)
        && Array.isArray(value.deviceProfiles)
        && isPlainObject(value.legacyBpm);
}

interface CompanionBooleans {
    desktop: boolean;
    tablet: boolean;
    mobile: boolean;
}

interface DeferredSnapshot {
    delayMs: number;
    enabled: boolean;
}

function readCompanionBooleans(companion: Record<string, unknown>, id: string): CompanionBooleans {
    const profiles = isPlainObject(companion.profiles) ? companion.profiles : {};
    const read = (template: CompanionTemplate): boolean => {
        const profile = profiles[template];
        if (!isPlainObject(profile)) return false;
        return profile[id] === true;
    };
    return { desktop: read('desktop'), tablet: read('tablet'), mobile: read('mobile') };
}

function readDeferredPolicies(companion: Record<string, unknown>, issues: string[]): DeferredPolicy[] {
    const raw = companion.deferred;
    const entries: unknown[] = Array.isArray(raw)
        ? raw
        : isPlainObject(raw)
            ? Object.values(raw)
            : [];
    if (raw !== undefined && !Array.isArray(raw) && !isPlainObject(raw)) {
        issues.push('deferred: ignored unsupported legacy shape');
    }
    const policies: DeferredPolicy[] = [];
    for (const entry of entries) {
        if (!isPlainObject(entry)) {
            issues.push('deferred: skipped non-object policy entry');
            continue;
        }
        const id = asString(entry.id);
        if (id === '') {
            issues.push('deferred: skipped policy without id');
            continue;
        }
        const enabled = entry.enabled === true;
        let delayMs = 0;
        if (typeof entry.delayMs === 'number' && Number.isFinite(entry.delayMs)) {
            delayMs = entry.delayMs;
        } else if (typeof entry.delayMs === 'string' && entry.delayMs.trim() !== '' && Number.isFinite(Number(entry.delayMs))) {
            delayMs = Number(entry.delayMs);
        } else {
            issues.push(`deferred: policy ${id} had no usable delayMs, kept parked with 0`);
        }
        // Parked = deliberately off. Disabled policies stay in the list with
        // their original delay preserved so re-enabling keeps the cadence.
        policies.push({ id, delayMs, enabled, parked: !enabled });
    }
    return policies;
}

function buildDeviceProfiles(companion: Record<string, unknown>): DeviceProfile[] {
    const workspaceIds = isPlainObject(companion.workspaceIds) ? companion.workspaceIds : {};
    return DEVICE_TEMPLATES.map((template) => {
        const workspaceId = asString(workspaceIds[template.template]);
        const profile: DeviceProfile = {
            id: template.id,
            name: template.id,
            tagIds: [template.id],
            applyAtStart: true,
            template: template.template.charAt(0).toUpperCase() + template.template.slice(1),
        };
        if (workspaceId !== '') profile.workspaceId = workspaceId;
        return profile;
    });
}

function buildEquipmentTags(): Tag[] {
    return DEVICE_TEMPLATES.map((template) => ({ id: template.id, name: template.id, color: template.color }));
}

function buildFixtureProfiles(bpm: Record<string, unknown>, timestamp: string, issues: string[]): FixtureProfile[] {
    const raw = bpm.COMMAND_PROFILES;
    const entries = Array.isArray(raw) ? raw : [];
    if (raw !== undefined && !Array.isArray(raw)) issues.push('COMMAND_PROFILES: ignored unsupported legacy shape');
    const fixtures: FixtureProfile[] = [];
    for (const entry of entries) {
        if (!isPlainObject(entry)) {
            issues.push('COMMAND_PROFILES: skipped non-object profile entry');
            continue;
        }
        const id = asString(entry.id);
        if (id === '') {
            issues.push('COMMAND_PROFILES: skipped profile without id');
            continue;
        }
        const states = isPlainObject(entry.pluginStates) ? entry.pluginStates : {};
        // Member keys become canonical `community:<id>` keys with explicit
        // booleans; legacy profile booleans are never trusted as truthy blobs.
        const members: Record<string, boolean> = {};
        for (const pluginId of Object.keys(states)) {
            if (pluginId === '') continue;
            members[recordKey('community', pluginId)] = states[pluginId] === true;
        }
        const metadata: Record<string, unknown> = { migratedAt: timestamp };
        if (entry.createdAt !== undefined) metadata.createdAt = cloneDeep(entry.createdAt);
        if (entry.updatedAt !== undefined) metadata.updatedAt = cloneDeep(entry.updatedAt);
        fixtures.push({
            id,
            name: asString(entry.name, id),
            members,
            metadata,
        });
    }
    return fixtures;
}

function buildGithubSources(bpm: Record<string, unknown>, issues: string[]): Record<string, GithubSource> {
    const sources: Record<string, GithubSource> = {};
    const raw = bpm.BETA_SOURCES;
    const entries = Array.isArray(raw) ? raw : [];
    if (raw !== undefined && !Array.isArray(raw)) issues.push('BETA_SOURCES: ignored unsupported legacy shape');
    for (const entry of entries) {
        if (!isPlainObject(entry)) {
            issues.push('BETA_SOURCES: skipped non-object source entry');
            continue;
        }
        const id = asString(entry.id);
        const repo = asString(entry.repo);
        // Format verification only: shape and repo coordinates are checked,
        // opaque credential-like fields are simply never copied.
        if (id === '' || !REPO_PATTERN.test(repo)) {
            issues.push(`BETA_SOURCES: skipped source ${id === '' ? '<no id>' : id} with invalid repo format`);
            continue;
        }
        const source: GithubSource = { repo, trackPrereleases: entry.includePrerelease === true };
        const localVersion = asString(entry.localVersion);
        if (localVersion !== '') source.version = localVersion;
        if (entry.mode === 'frozen') {
            const frozen = asString(entry.frozenVersion);
            if (frozen !== '') source.pinned = frozen;
        }
        sources[recordKey('community', id)] = source;
    }
    return sources;
}

function buildTags(bpm: Record<string, unknown>): Tag[] {
    const raw = bpm.TAGS;
    const entries = Array.isArray(raw) ? raw : [];
    const tags: Tag[] = [];
    for (const entry of entries) {
        if (!isPlainObject(entry)) continue;
        const id = asString(entry.id);
        if (id === '') continue;
        const tag: Tag = { id, name: asString(entry.name, id) };
        const color = asString(entry.color);
        if (color !== '') tag.color = color;
        tags.push(tag);
    }
    for (const equipment of buildEquipmentTags()) {
        if (!tags.some((tag) => tag.id === equipment.id)) tags.push(equipment);
    }
    return tags;
}

function buildGroups(bpm: Record<string, unknown>): Group[] {
    const raw = bpm.GROUPS;
    const entries = Array.isArray(raw) ? raw : [];
    const groups: Group[] = [];
    for (const entry of entries) {
        if (!isPlainObject(entry)) continue;
        const id = asString(entry.id);
        if (id === '') continue;
        // Opaque group metadata (color, icons, anything else) rides along.
        const clone = cloneIfPossible<Record<string, unknown>>(entry);
        if (clone) groups.push({ ...clone, id, name: asString(entry.name, id) } as Group);
    }
    return groups;
}

function migrationRecord(
    timestamp: string,
    counts: Record<string, number | boolean>,
    issues: string[],
    backupsPreserved: boolean,
): Record<string, unknown> {
    return {
        applied: true,
        migratedAt: timestamp,
        timestamp,
        schemaVersion: MIGRATION_SCHEMA_VERSION,
        coreOrigin: 'observed-at-migration',
        deferredActiveOrigin: 'observed-effective-activation',
        sources: {
            bpm: LEGACY_BPM_PLUGIN_ID,
            companion: LEGACY_COMPANION_PLUGIN_ID,
        },
        equipmentTemplates: EQUIPMENT_TAG_IDS,
        counts,
        issues,
        profileBackupsPreserved: backupsPreserved,
        nativeListTouched: false,
    };
}

function buildCommunityMetadata(
    id: string,
    entry: Record<string, unknown> | undefined,
    observed: ObservedPlugin | undefined,
    booleans: CompanionBooleans,
    deferredSnapshot: DeferredSnapshot | undefined,
    timestamp: string,
    addedFromObservation: boolean,
): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
        migratedAt: timestamp,
        companionProfiles: {
            desktop: booleans.desktop,
            tablet: booleans.tablet,
            mobile: booleans.mobile,
        },
    };
    if (entry !== undefined) {
        // Historical BPM fields (desc, note, delay, enabled and any unknown
        // custom field) ride along opaquely.
        const legacy: Record<string, unknown> = {};
        for (const key of Object.keys(entry)) {
            if (key === 'id' || key === 'name' || key === 'group' || key === 'tags') continue;
            legacy[key] = cloneDeep(entry[key]);
        }
        metadata.legacyBpm = legacy;
    }
    if (addedFromObservation) metadata.addedFromObservation = true;
    if (deferredSnapshot) metadata.deferred = { ...deferredSnapshot };
    if (EXCLUDED_FROM_DEVICE_MEMBERSHIP.has(id)) {
        metadata.excludedFromDeviceMembership = true;
        if (id === LEGACY_BPM_PLUGIN_ID) metadata.legacyManager = 'bpm';
        if (id === LEGACY_COMPANION_PLUGIN_ID) metadata.legacyManager = 'companion';
        if (id === LEGACY_ADVANCED_DEBUG_PLUGIN_ID) metadata.independentAdvancedDebug = true;
    }
    if (observed !== undefined) metadata.observedVersion = observed.version;
    return metadata;
}

/**
 * Converts legacy BPM + Companion data plus the host-collected observation
 * into the canonical State. Pure: no IO, no host access, inputs untouched.
 */
export function migrateLegacy(
    bpm: Record<string, any>,
    companion: Record<string, any>,
    observed: ObservedPlugin[],
    now?: string,
): State {
    // Idempotence guard: already-migration data supplied -> return it as-is.
    if (looksLikeMigratedState(bpm)) {
        return cloneDeep(bpm) as unknown as State;
    }

    const issues: string[] = [];
    const timestamp = typeof now === 'string' && now !== '' ? now : new Date().toISOString();
    const bpmData: Record<string, unknown> = isPlainObject(bpm) ? bpm : {};
    const companionData: Record<string, unknown> = isPlainObject(companion) ? companion : {};

    const observedList = Array.isArray(observed) ? observed.filter(isObservedEntry) : [];
    const observedIndex = new Map<string, ObservedPlugin>();
    for (const entry of observedList) {
        const key = observedKey(entry);
        if (key !== null) observedIndex.set(key, entry);
    }

    const deferredPolicies = readDeferredPolicies(companionData, issues);
    const deferredEnabledById = new Map<string, DeferredSnapshot>();
    for (const policy of deferredPolicies) {
        if (!deferredEnabledById.has(policy.id) || policy.enabled) {
            deferredEnabledById.set(policy.id, { delayMs: policy.delayMs, enabled: policy.enabled });
        }
    }

    const records: Record<string, PluginRecord> = {};
    const handledCommunity = new Set<string>();
    const rawPlugins = Array.isArray(bpmData.Plugins) ? bpmData.Plugins : [];
    if (bpmData.Plugins !== undefined && !Array.isArray(bpmData.Plugins)) {
        issues.push('Plugins: ignored unsupported legacy shape');
    }

    for (const rawEntry of rawPlugins) {
        if (!isPlainObject(rawEntry)) {
            issues.push('Plugins: skipped non-object entry');
            continue;
        }
        const id = asString(rawEntry.id);
        if (id === '') {
            issues.push('Plugins: skipped entry without id');
            continue;
        }
        if (handledCommunity.has(id)) {
            issues.push(`Plugins: duplicated legacy entry ${id} skipped`);
            continue;
        }
        handledCommunity.add(id);

        const ref: PluginRef = { kind: 'community', id };
        const observedEntry = observedIndex.get(recordKey('community', id));
        // Copy all original tags first, then append equipment tags derived
        // from the Companion saved template booleans.
        const tags: string[] = [];
        const rawTags = Array.isArray(rawEntry.tags) ? rawEntry.tags : [];
        for (const tag of rawTags) {
            if (typeof tag === 'string' && tag !== '') pushUnique(tags, tag);
        }
        const booleans = readCompanionBooleans(companionData, id);
        if (!EXCLUDED_FROM_DEVICE_MEMBERSHIP.has(id)) {
            for (const template of ['desktop', 'tablet', 'mobile'] as const) {
                if (!booleans[template]) continue;
                for (const equipmentId of TEMPLATE_MEMBERSHIP[template]) pushUnique(tags, equipmentId);
            }
            // Effective activation: a deferred policy that is enabled and
            // observed running keeps its membership even where the legacy
            // profile said false (Omnisearch desktop). Desktop-only
            // compatibility stays a runtime host decision; existing metadata
            // (e.g. desktop-only tags) is never erased here.
            const deferredSnapshot = deferredEnabledById.get(id);
            if (
                deferredSnapshot !== undefined
                && deferredSnapshot.enabled
                && observedEntry !== undefined
                && observedEntry.compatible === true
                && isActive(observedEntry)
            ) {
                for (const equipmentId of EQUIPMENT_TAG_IDS) pushUnique(tags, equipmentId);
            }
        }
        const desired = observedEntry !== undefined
            ? isActive(observedEntry)
            : rawEntry.enabled === true;

        records[recordKey('community', id)] = {
            ref,
            name: asString(rawEntry.name, observedEntry ? observedEntry.name : id),
            version: observedEntry !== undefined ? asString(observedEntry.version, '') : '',
            tags,
            group: asString(rawEntry.group),
            desired,
            metadata: buildCommunityMetadata(
                id,
                rawEntry,
                observedEntry,
                booleans,
                deferredEnabledById.get(id),
                timestamp,
                false,
            ),
        };
    }

    // Community plugins observed but absent from the BPM list: recorded so the
    // catalog never silently forgets installed plugins.
    for (const observedEntry of observedList) {
        if (observedEntry.ref.kind !== 'community') continue;
        const id = observedEntry.ref.id;
        if (handledCommunity.has(id)) continue;
        handledCommunity.add(id);
        const tags: string[] = [];
        const booleans = readCompanionBooleans(companionData, id);
        if (!EXCLUDED_FROM_DEVICE_MEMBERSHIP.has(id)) {
            for (const template of ['desktop', 'tablet', 'mobile'] as const) {
                if (!booleans[template]) continue;
                for (const equipmentId of TEMPLATE_MEMBERSHIP[template]) pushUnique(tags, equipmentId);
            }
            const deferredSnapshot = deferredEnabledById.get(id);
            if (
                deferredSnapshot !== undefined
                && deferredSnapshot.enabled
                && observedEntry.compatible === true
                && isActive(observedEntry)
            ) {
                for (const equipmentId of EQUIPMENT_TAG_IDS) pushUnique(tags, equipmentId);
            }
        }
        records[recordKey('community', id)] = {
            ref: { kind: 'community', id },
            name: asString(observedEntry.name, id),
            version: asString(observedEntry.version, ''),
            tags,
            group: '',
            desired: isActive(observedEntry),
            metadata: buildCommunityMetadata(
                id,
                undefined,
                observedEntry,
                booleans,
                deferredEnabledById.get(id),
                timestamp,
                true,
            ),
        };
    }

    // Core plugins: initial native/loaded state comes exclusively from the
    // observation at migration time; enabled core gets all seven equipment
    // tags, provenance is recorded per record.
    let coreRecords = 0;
    for (const observedEntry of observedList) {
        if (observedEntry.ref.kind !== 'core') continue;
        const id = observedEntry.ref.id;
        const key = recordKey('core', id);
        if (records[key] !== undefined) continue;
        const enabledNow = isActive(observedEntry);
        const tags: string[] = [];
        if (enabledNow) {
            for (const equipmentId of EQUIPMENT_TAG_IDS) pushUnique(tags, equipmentId);
        }
        records[key] = {
            ref: { kind: 'core', id },
            name: asString(observedEntry.name, id),
            version: asString(observedEntry.version, ''),
            tags,
            group: '',
            desired: enabledNow,
            metadata: {
                migratedAt: timestamp,
                coreOrigin: 'observed',
                nativeAutostartAtMigration: observedEntry.nativeAutostart === true,
                loadedAtMigration: observedEntry.loaded === true,
            },
        };
        coreRecords += 1;
    }

    const deviceProfiles = buildDeviceProfiles(companionData);
    const fixtureProfiles = buildFixtureProfiles(bpmData, timestamp, issues);
    const tags = buildTags(bpmData);
    const groups = buildGroups(bpmData);
    const githubSources = buildGithubSources(bpmData, issues);
    const protectedList: string[] = [...PROTECTED_BASELINE];

    // Companion profileBackups is an OBJECT (desktop/mobile/tablet -> name,
    // savedAt, pluginStates). Its exact original structure is preserved
    // verbatim inside the backup entry; it is never flattened into an array.
    const rawBackups = companionData.profileBackups;
    let backupsPreserved = false;
    const profileBackups: unknown[] = [];
    if (isPlainObject(rawBackups) || Array.isArray(rawBackups)) {
        profileBackups.push({
            source: LEGACY_COMPANION_PLUGIN_ID,
            migratedAt: timestamp,
            backups: cloneDeep(rawBackups),
        });
        backupsPreserved = true;
    } else if (rawBackups !== undefined) {
        issues.push('profileBackups: ignored unsupported legacy shape');
    }

    // Full legacy BPM data stays in State as opaque metadata, with secret
    // fields redacted (NFR-1: no secrets in State, reports or git).
    const legacyBpm = cloneDeep(bpmData);
    redactSecrets(legacyBpm);

    const communityRecords = Object.keys(records).length - coreRecords;
    const deferredEnabled = deferredPolicies.filter((policy) => policy.enabled).length;

    const state: State = {
        schemaVersion: MIGRATION_SCHEMA_VERSION,
        records,
        tags,
        groups,
        deviceProfiles,
        fixtureProfiles,
        deferred: deferredPolicies,
        protected: protectedList,
        profileBackups,
        githubSources,
        settings: { staggerMs: DEFAULT_SETTINGS.staggerMs, automaticUpdates: DEFAULT_SETTINGS.automaticUpdates },
        migration: migrationRecord(timestamp, {
            communityRecords,
            coreRecords,
            totalRecords: Object.keys(records).length,
            tags: tags.length,
            groups: groups.length,
            deviceTemplates: deviceProfiles.length,
            fixtureProfiles: fixtureProfiles.length,
            deferredPolicies: deferredPolicies.length,
            deferredEnabled,
            githubSources: Object.keys(githubSources).length,
        }, issues, backupsPreserved),
        legacyBpm,
    };
    return state;
}

export default { migrateLegacy };
