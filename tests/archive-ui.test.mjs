import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';

const { selectArchivePage, renderArchiveSection } = await importModule('src/integrated/archive-ui.ts');

test('selectArchivePage: correct merging and default pagination with size 50', () => {
  const active = [];
  for (let i = 1; i <= 60; i++) {
    active.push({
      id: `plugin-${i}`,
      name: `Plugin Name ${i}`,
      state: { desired: false, native: false, loaded: false, scheduled: false },
      tags: i % 2 === 0 ? ['even'] : ['odd'],
      groups: ['core-group'],
    });
  }

  const archived = [
    { id: 'archived-1', name: 'Archived Plugin 1', tags: ['archived'] },
    { id: 'archived-2', name: 'Archived Plugin 2', groups: ['legacy'] },
  ];

  // Test page 1
  const res1 = selectArchivePage(active, archived, {}, 1, 50);
  assert.equal(res1.total, 62);
  assert.equal(res1.items.length, 50);
  assert.equal(res1.page, 1);
  assert.equal(res1.totalPages, 2);
  assert.equal(res1.items[0].id, 'plugin-1');
  assert.equal(res1.items[0].canArchive, true);

  // Test page 2
  const res2 = selectArchivePage(active, archived, {}, 2, 50);
  assert.equal(res2.items.length, 12);
  assert.equal(res2.page, 2);
  // Last items should be the archived ones
  const lastArchived = res2.items.find((i) => i.id === 'archived-1');
  assert.ok(lastArchived);
  assert.equal(lastArchived.isArchived, true);
  assert.equal(lastArchived.canRestore, true);
  assert.equal(lastArchived.canArchive, false);
});

test('selectArchivePage: 4-off status & protection/self/core rules for archiving', () => {
  const active = [
    {
      id: 'fully-off',
      name: 'Off Plugin',
      state: { desired: false, native: false, loaded: false, scheduled: false },
    },
    {
      id: 'desired-on',
      name: 'Desired Active',
      state: { desired: true, native: false, loaded: false, scheduled: false },
    },
    {
      id: 'loaded-on',
      name: 'Loaded Active',
      state: { desired: false, native: false, loaded: true, scheduled: false },
    },
    {
      id: 'protected-plugin',
      name: 'Protected Plugin',
      isProtected: true,
      state: { desired: false, native: false, loaded: false, scheduled: false },
    },
    {
      id: 'aigility-plugin-manager',
      name: 'AIgility Manager',
      state: { desired: false, native: false, loaded: false, scheduled: false },
    },
  ];

  const res = selectArchivePage(active, [], {}, 1, 50);
  const items = res.items;

  const off = items.find((i) => i.id === 'fully-off');
  assert.equal(off.canArchive, true);

  const desiredOn = items.find((i) => i.id === 'desired-on');
  assert.equal(desiredOn.canArchive, false);

  const loadedOn = items.find((i) => i.id === 'loaded-on');
  assert.equal(loadedOn.canArchive, false);

  const prot = items.find((i) => i.id === 'protected-plugin');
  assert.equal(prot.canArchive, false);

  const self = items.find((i) => i.id === 'aigility-plugin-manager');
  assert.equal(self.canArchive, false);
});

test('selectArchivePage: filtering by query, tags/groups, and view state', () => {
  const active = [
    {
      id: 'alpha-plugin',
      name: 'Alpha Tool',
      state: { desired: false, native: false, loaded: false, scheduled: false },
      tags: ['productivity'],
      groups: ['tools'],
    },
    {
      id: 'beta-plugin',
      name: 'Beta Editor',
      state: { desired: false, native: false, loaded: false, scheduled: false },
      tags: ['editor'],
      groups: ['core-group'],
    },
  ];

  const archived = [
    {
      id: 'gamma-archived',
      name: 'Gamma Old',
      tags: ['productivity'],
      groups: ['legacy'],
    },
  ];

  // Filter by query
  const qRes = selectArchivePage(active, archived, { query: 'Beta' });
  assert.equal(qRes.total, 1);
  assert.equal(qRes.items[0].id, 'beta-plugin');

  // Filter by tag
  const tagRes = selectArchivePage(active, archived, { tagOrGroup: 'productivity' });
  assert.equal(tagRes.total, 2);

  // Filter by view
  const activeView = selectArchivePage(active, archived, { view: 'active' });
  assert.equal(activeView.total, 2);
  assert.ok(activeView.items.every((i) => !i.isArchived));

  const archivedView = selectArchivePage(active, archived, { view: 'archived' });
  assert.equal(archivedView.total, 1);
  assert.equal(archivedView.items[0].id, 'gamma-archived');
});

test('selectArchivePage: handles 723 items regression cleanly', () => {
  const active723 = [];
  for (let i = 1; i <= 723; i++) {
    active723.push({
      ref: { kind: 'community', id: `p-${i}` },
      installed: true,
      name: `Plugin ${i}`,
      desired: false,
      nativeAutostart: false,
      loaded: false,
      scheduled: false,
      tags: [`tag-${i % 10}`],
      group: `group-${i % 5}`,
    });
  }

  const res = selectArchivePage(active723, [], {}, 1, 50);
  assert.equal(res.total, 723);
  assert.equal(res.items.length, 50);
  assert.equal(res.totalPages, 15);

  const resLastPage = selectArchivePage(active723, [], {}, 15, 50);
  assert.equal(resLastPage.items.length, 23);
  assert.equal(resLastPage.page, 15);
});

test('real 723-plugin catalog keeps every page bounded and filters archived records independently', () => {
  const active = Array.from({ length: 723 }, (_, index) => ({
    ref: { kind: 'community', id: 'real-' + index }, name: 'Real ' + index,
    installed: true, desired: false, nativeAutostart: false, loaded: false,
    scheduled: false, tags: ['tag-' + index % 7], group: 'group-' + index % 3,
  }));
  const first = selectArchivePage(active, [], {}, 1);
  const last = selectArchivePage(active, [], {}, 15);
  assert.equal(first.total, 723); assert.equal(first.items.length, 50);
  assert.equal(last.items.length, 23); assert(first.items.every(item => item.canArchive));
  assert.equal(selectArchivePage(active, [], { tag: 'tag-2', group: 'group-1' }).total,
    active.filter(item => item.tags.includes('tag-2') && item.group === 'group-1').length);
});

test('real runtime shape excludes core and missing plugins, protects canonical ids, and merges archived metadata', () => {
  const runtime = [
    { ref: { kind: 'community', id: 'off' }, installed: true, desired: false, nativeAutostart: false, loaded: false, scheduled: false, tags: [], group: '' },
    { ref: { kind: 'community', id: 'desired-on' }, installed: true, desired: true, nativeAutostart: false, loaded: false, scheduled: false, tags: [], group: '' },
    { ref: { kind: 'community', id: 'native-on' }, installed: true, desired: false, nativeAutostart: true, loaded: false, scheduled: false, tags: [], group: '' },
    { ref: { kind: 'community', id: 'loaded-on' }, installed: true, desired: false, nativeAutostart: false, loaded: true, scheduled: false, tags: [], group: '' },
    { ref: { kind: 'community', id: 'scheduled' }, installed: true, desired: false, nativeAutostart: false, loaded: false, scheduled: true, tags: [], group: '' },
    { ref: { kind: 'community', id: 'self' }, installed: true, desired: false, nativeAutostart: false, loaded: false, scheduled: false, tags: [], group: '' },
    { ref: { kind: 'core', id: 'core-plugin' }, installed: true, desired: false, nativeAutostart: false, loaded: false, scheduled: false },
    { ref: { kind: 'community', id: 'missing' }, installed: false, desired: false, nativeAutostart: false, loaded: false, scheduled: false },
    { ref: { kind: 'community', id: 'reason-protected' }, installed: true, desired: false, nativeAutostart: false, loaded: false, scheduled: false, reason: 'protected' },
    { ref: { kind: 'community', id: 'state-protected' }, installed: true, desired: false, nativeAutostart: false, loaded: false, scheduled: false },
  ];
  runtime[5].ref.id = 'aigility-plugin-manager';
  const archived = [{ id: 'archived', name: 'Archived', tags: [], groups: [] }];
  const result = selectArchivePage(runtime, archived, {}, 1, 50, {
    protected: ['community:state-protected'],
    records: { 'community:archived': { tags: ['archive-tag'], group: 'archive-group' } },
  });
  assert.equal(result.total, 9, 'eight installed community plugins plus one archived plugin');
  const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));
  assert.equal(byId.off.canArchive, true);
  for (const id of ['desired-on', 'native-on', 'loaded-on', 'scheduled', 'aigility-plugin-manager', 'reason-protected', 'state-protected']) assert.equal(byId[id].canArchive, false, id);
  assert.equal(byId.archived.canRestore, true);
  assert.deepEqual(byId.archived.tags, ['archive-tag']);
  assert.deepEqual(byId.archived.groups, ['archive-group']);
  assert.equal(selectArchivePage(runtime, archived, { tag: 'archive-tag' }, 1, 50, { records: { 'community:archived': { tags: ['archive-tag'], group: 'archive-group' } } }).total, 1);
  assert.equal(selectArchivePage(runtime, archived, { group: 'archive-group' }, 1, 50, { records: { 'community:archived': { tags: ['archive-tag'], group: 'archive-group' } } }).total, 1);
  assert.equal(selectArchivePage(runtime, archived, { tag: 'archive-tag', group: 'archive-group' }, 1, 50, { records: { 'community:archived': { tags: ['archive-tag'], group: 'archive-group' } } }).total, 1);
});

test('archive actions fail closed without backend and refresh list and counts after action', async () => {
  class FakeElement {
    children = []; listeners = {}; value = ''; text = ''; disabled = false; hidden = false;
    createDiv(options = {}) { return this.addChild(options); }
    createEl(tag, options = {}) { return this.addChild({ ...options, tag }); }
    addChild(options) { const child = new FakeElement(); Object.assign(child, options); this.children.push(child); return child; }
    setText(text) { this.text = text; }
    empty() { this.children = []; this.text = ''; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    async click() { await this.listeners.click?.(); }
    find(cls) { if ((this.cls || '').split(' ').includes(cls)) return this; for (const child of this.children) { const found = child.find(cls); if (found) return found; } return undefined; }
  }
  const missingRoot = new FakeElement();
  renderArchiveSection({ runtime: { list: () => [] } }, missingRoot);
  assert.match(missingRoot.find('archive-safety-warning').text, /no disponible/i);

  let active = [{ ref: { kind: 'community', id: 'off' }, installed: true, name: 'Off', desired: false, nativeAutostart: false, loaded: false, scheduled: false }];
  let archived = [];
  let refreshes = 0;
  const root = new FakeElement();
  const ui = {
    refreshManagerView() { refreshes++; },
    runtime: { list: () => active, state: { records: {}, protected: [] } },
    plugin: { archive: {
      safety: () => ({ allowed: true }), list: () => archived,
      async archive(id) { active = []; archived = [{ id, name: 'Off' }]; },
      async restore(id) { archived = []; active = [{ ref: { kind: 'community', id }, installed: true, name: 'Off', desired: false, nativeAutostart: false, loaded: false, scheduled: false }]; },
    } },
  };
  renderArchiveSection(ui, root);
  const firstAction = root.find('archive-action-btn');
  assert.ok(firstAction);
  await firstAction.click();
  assert.match(root.find('archive-counts').text, /Instalados: 0 \| Archivados: 1/);
  assert.equal(refreshes, 1, 'archiving refreshes the daily installed list');
  assert.ok(root.find('archive-action-btn'));
  await root.find('archive-action-btn').click();
  assert.match(root.find('archive-counts').text, /Instalados: 1 \| Archivados: 0/);
  assert.equal(refreshes, 2, 'restoring refreshes the daily installed list');
  let recovered = false, resumed = false;
  ui.plugin.archive.needsRecovery = () => !recovered;
  ui.plugin.archive.recover = async () => { recovered = true; };
  ui.plugin.archive.safety = () => recovered ? { allowed: true } : { allowed: false, reason: 'Archive recovery is required' };
  ui.runtime.resume = () => { resumed = true; };
  const recoveryRoot = new FakeElement();
  renderArchiveSection(ui, recoveryRoot);
  assert.equal(recoveryRoot.find('archive-recover-btn').hidden, false);
  await recoveryRoot.find('archive-recover-btn').click();
  assert.equal(recoveryRoot.find('archive-recover-btn').hidden, true);
  assert.equal(resumed, false, 'recovery must never resume automatic profiles');
  assert.equal(refreshes, 3);
});
