// Descargados / Downloaded Plugin Archive UI component (<=200 lines)
export interface ArchiveRecord {
  id: string;
  name: string;
  version?: string;
  isArchived: boolean;
  statusText: string;
  canArchive: boolean;
  canRestore: boolean;
  tags: string[];
  groups: string[];
  reason?: string;
}
export interface ArchiveFilterCriteria {
  query?: string;
  tag?: string;
  group?: string;
  /** @deprecated Legacy combined tag/group filter. */
  tagOrGroup?: string;
  view?: 'all' | 'active' | 'archived';
}
export interface ArchivePageResult {
  items: ArchiveRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const unique = (values: string[]): string[] => [...new Set(values)];
const normalizedId = (item: any): string => String(item?.ref?.id ?? item?.id ?? '');
const normalizedKind = (item: any): string => String(item?.ref?.kind ?? (item?.core ? 'core' : 'community'));
const recordKey = (id: string): string => `community:${id}`;

export function selectArchivePage(
  activeList: any[] = [], archivedList: any[] = [], criteria: ArchiveFilterCriteria = {},
  page: number = 1, pageSize: number = 50, runtimeState: any = {},
): ArchivePageResult {
  const query = (criteria.query || '').trim().toLowerCase();
  const legacyFilter = (criteria.tagOrGroup || '').trim().toLowerCase();
  const tag = (criteria.tag || '').trim().toLowerCase();
  const group = (criteria.group || '').trim().toLowerCase();
  const view = criteria.view || 'all';
  const protectedIds = runtimeState?.protected;
  const isProtected = (id: string): boolean => {
    if (protectedIds instanceof Set) return protectedIds.has(recordKey(id)) || protectedIds.has(id);
    return Array.isArray(protectedIds) && (protectedIds.includes(recordKey(id)) || protectedIds.includes(id));
  };
  const records: ArchiveRecord[] = [];

  for (const item of activeList) {
    const id = normalizedId(item);
    if (!id || normalizedKind(item) !== 'community' || item.installed === false) continue;
    const legacyState = item.state || {};
    const desired = item.desired ?? legacyState.desired;
    const native = item.nativeAutostart ?? legacyState.nativeAutostart ?? legacyState.native;
    const loaded = item.loaded ?? legacyState.loaded;
    const scheduled = item.scheduled ?? legacyState.scheduled;
    const oldShape = !item.ref;
    const off = desired === false && native === false && loaded === false && (scheduled === false || (oldShape && scheduled === undefined));
    const protectedItem = item.reason === 'protected' || item.isProtected === true || item.protected === true || isProtected(id);
    const self = id === 'aigility-plugin-manager';
    const core = normalizedKind(item) === 'core';
    const reason = protectedItem || self || core
      ? 'Plugin protegido o del sistema'
      : !off ? 'Debe estar apagado (desired/nativeAutostart/loaded/scheduled inactivos)' : undefined;
    const stored = runtimeState?.records?.[recordKey(id)];
    const tags = unique([...asStrings(item.tags ?? item.metadata?.tags), ...asStrings(stored?.tags), ...asStrings(stored?.metadata?.tags)]);
    const groups = unique([
      ...asStrings(item.groups ?? item.metadata?.groups),
      ...asStrings(item.group ? [item.group] : []),
      ...asStrings(stored?.groups),
      ...asStrings(stored?.group ? [stored.group] : []),
      ...asStrings(stored?.metadata?.groups),
    ]);
    records.push({
      id, name: item.name || item.manifest?.name || id, version: item.version || item.manifest?.version,
      isArchived: false, statusText: off && !reason ? 'Listo para archivar' : loaded ? 'Activo' : 'Inactivo',
      canArchive: off && !reason, canRestore: false, tags, groups, reason,
    });
  }

  for (const item of archivedList) {
    const id = normalizedId(item);
    if (!id) continue;
    const stored = runtimeState?.records?.[recordKey(id)];
    records.push({
      id, name: item.name || stored?.name || id, version: item.version || stored?.version,
      isArchived: true, statusText: 'Archivado', canArchive: false, canRestore: true,
      tags: unique([...asStrings(item.tags), ...asStrings(stored?.tags), ...asStrings(stored?.metadata?.tags)]),
      groups: unique([...asStrings(item.groups), ...asStrings(item.group ? [item.group] : []), ...asStrings(stored?.groups), ...asStrings(stored?.group ? [stored.group] : []), ...asStrings(stored?.metadata?.groups)]),
    });
  }

  const filtered = records.filter((record) => {
    if (view === 'active' && record.isArchived) return false;
    if (view === 'archived' && !record.isArchived) return false;
    if (query && !record.id.toLowerCase().includes(query) && !record.name.toLowerCase().includes(query)) return false;
    if (tag && !record.tags.some((value) => value.toLowerCase() === tag)) return false;
    if (group && !record.groups.some((value) => value.toLowerCase() === group)) return false;
    if (!tag && !group && legacyFilter && !record.tags.some((value) => value.toLowerCase() === legacyFilter) && !record.groups.some((value) => value.toLowerCase() === legacyFilter)) return false;
    return true;
  });
  const total = filtered.length;
  const safePageSize = pageSize > 0 ? pageSize : 50;
  const totalPages = Math.ceil(total / safePageSize) || 1;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * safePageSize;
  return { items: filtered.slice(start, start + safePageSize), total, page: safePage, pageSize: safePageSize, totalPages };
}

export function renderArchiveSection(ui: any, container: HTMLElement): void {
  const section = container.createDiv({ cls: 'archive-manager-section' });
  section.createEl('h3', { text: 'Descargados' });
  section.createEl('p', { cls: 'setting-item-description', text: 'Archivar plugins descargados los traslada fuera del catálogo nativo para conservar datos y configuración.' });
  const archiveManager = ui?.plugin?.archive;
  let criteria: ArchiveFilterCriteria = { view: 'all', query: '', tag: '', group: '' };
  let currentPage = 1;
  const countsDiv = section.createDiv({ cls: 'archive-counts setting-item-description' });
  const warning = section.createDiv({ cls: 'archive-safety-warning mod-warning' });
  const recoverButton = section.createEl('button', { cls: 'mod-touch archive-recover-btn', text: 'Recuperar operación' });
  recoverButton.hidden = true;
  const controls = section.createDiv({ cls: 'archive-controls' });
  const searchInput = controls.createEl('input', { type: 'search', placeholder: 'Buscar nombre o ID...', cls: 'archive-search-input' });
  searchInput.setAttribute?.('aria-label', 'Buscar plugins por nombre o ID');
  const viewSelect = controls.createEl('select', { cls: 'archive-view-select dropdown' });
  viewSelect.setAttribute?.('aria-label', 'Filtrar plugins por estado');
  [{ v: 'all', l: 'Todos' }, { v: 'active', l: 'Instalados' }, { v: 'archived', l: 'Archivados' }].forEach((option) => viewSelect.createEl('option', { value: option.v, text: option.l }));
  const tagSelect = controls.createEl('select', { cls: 'archive-tag-select dropdown' });
  const groupSelect = controls.createEl('select', { cls: 'archive-group-select dropdown' });
  const listContainer = section.createDiv({ cls: 'archive-items-list' });
  const pagination = section.createDiv({ cls: 'archive-pagination' });
  const prevBtn = pagination.createEl('button', { text: 'Anterior', cls: 'mod-touch archive-page-prev' });
  const pageLabel = pagination.createEl('span', { cls: 'archive-page-label' });
  const nextBtn = pagination.createEl('button', { text: 'Siguiente', cls: 'mod-touch archive-page-next' });

  function readData() {
    const available = Boolean(archiveManager?.safety && archiveManager?.list && archiveManager?.archive && archiveManager?.restore && ui?.runtime?.list);
    const safety = available ? archiveManager.safety() : { allowed: false, reason: 'Servicio de archivo no disponible' };
    const archived = archiveManager?.list ? archiveManager.list() : [];
    const runtimeItems = ui?.runtime?.list ? ui.runtime.list() : [];
    const active = runtimeItems.filter((item: any) => normalizedKind(item) === 'community' && item.installed === true);
    const runtimeState = ui?.runtime?.state || {};
    countsDiv.setText(`Instalados: ${active.length} | Archivados: ${archived.length}`);
    warning.empty();
    warning.setText(!available ? 'Servicio de archivo no disponible. Las acciones están deshabilitadas.' : !safety.allowed ? `Aviso de seguridad: ${safety.reason || 'operación deshabilitada'}` : '');
    warning.hidden = available && safety.allowed;
    const needsRecovery = archiveManager?.needsRecovery?.() === true;
    recoverButton.hidden = !needsRecovery;
    recoverButton.disabled = !available || !needsRecovery;
    if (needsRecovery) warning.hidden = false;
    if (/sync/i.test(String(safety.reason || ''))) {
      warning.setText(`${warning.textContent ? `${warning.textContent} ` : ''}Desactiva Installed community plugin list en Sync de este equipo para archivar localmente. Este ajuste también afecta data.json del gestor; el gestor no cambia Sync automáticamente.`);
    }
    const tags = new Set<string>();
    const groups = new Set<string>();
    for (const item of [...active, ...archived]) {
      const id = normalizedId(item);
      const stored = runtimeState.records?.[recordKey(id)];
      [...asStrings(item.tags), ...asStrings(stored?.tags), ...asStrings(stored?.metadata?.tags)].forEach((value) => tags.add(value));
      [...asStrings(item.groups), ...asStrings(item.group ? [item.group] : []), ...asStrings(stored?.groups), ...asStrings(stored?.group ? [stored.group] : []), ...asStrings(stored?.metadata?.groups)].forEach((value) => groups.add(value));
    }
    tagSelect.empty(); tagSelect.createEl('option', { value: '', text: 'Todas las etiquetas' });
    [...tags].sort().forEach((value) => tagSelect.createEl('option', { value, text: value }));
    groupSelect.empty(); groupSelect.createEl('option', { value: '', text: 'Todos los grupos' });
    [...groups].sort().forEach((value) => groupSelect.createEl('option', { value, text: value }));
    tagSelect.value = criteria.tag || ''; groupSelect.value = criteria.group || '';
    return { available, safety, archived, active, runtimeState };
  }
  function renderList() {
    const { available, safety, archived, active, runtimeState } = readData();
    listContainer.empty();
    const result = selectArchivePage(active, archived, criteria, currentPage, 50, runtimeState);
    pageLabel.setText(`Página ${result.page} de ${result.totalPages} (${result.total} items)`);
    prevBtn.disabled = result.page <= 1; nextBtn.disabled = result.page >= result.totalPages;
    result.items.forEach((item) => {
      const row = listContainer.createDiv({ cls: 'archive-item-row setting-item' });
      const info = row.createDiv({ cls: 'setting-item-info' });
      info.createDiv({ cls: 'setting-item-name', text: item.name });
      info.createDiv({ cls: 'setting-item-description', text: `ID: ${item.id}${item.version ? ' v' + item.version : ''} | ${item.statusText}${item.reason ? ' (' + item.reason + ')' : ''}` });
      const control = row.createDiv({ cls: 'setting-item-control' });
      if (item.canArchive || item.canRestore) {
        const actionBtn = control.createEl('button', { cls: 'mod-cta archive-action-btn', text: item.canArchive ? 'Archivar' : 'Restaurar' });
        actionBtn.disabled = !available || !safety.allowed;
        if (actionBtn.disabled) actionBtn.title = safety.reason || (!available ? 'Servicio de archivo no disponible' : 'Deshabilitado por seguridad');
        actionBtn.addEventListener('click', async () => {
          actionBtn.disabled = true;
          try {
            if (item.canArchive) await archiveManager.archive(item.id);
            else await archiveManager.restore(item.id);
            ui?.showNotice?.(item.canArchive ? `Plugin ${item.id} archivado.` : `Plugin ${item.id} restaurado (inactivo).`);
            currentPage = 1;
            await ui?.refreshManagerView?.();
            renderList();
          } catch (err: any) {
            ui?.showNotice?.(`Error: ${err?.message || err}`);
            renderList();
          }
        });
      }
    });
  }
  searchInput.addEventListener('input', () => { criteria.query = searchInput.value; currentPage = 1; renderList(); });
  viewSelect.addEventListener('change', () => { criteria.view = viewSelect.value as any; currentPage = 1; renderList(); });
  tagSelect.addEventListener('change', () => { criteria.tag = tagSelect.value; currentPage = 1; renderList(); });
  groupSelect.addEventListener('change', () => { criteria.group = groupSelect.value; currentPage = 1; renderList(); });
  prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderList(); } });
  nextBtn.addEventListener('click', () => { currentPage++; renderList(); });
  recoverButton.addEventListener('click', async () => {
    recoverButton.disabled = true;
    try {
      await archiveManager.recover();
      ui?.showNotice?.('Operación de archivo recuperada.');
      await ui?.refreshManagerView?.();
      renderList();
    } catch (err: any) {
      ui?.showNotice?.(`Error: ${err?.message || err}`);
      renderList();
    }
  });
  renderList();
}
