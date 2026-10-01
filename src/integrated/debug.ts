import { AdvancedDebugIntegration, type AdvancedOption } from './advanced/index';
import { key, type EffectivePlugin, type PluginRef } from './types';
import { Platform } from 'obsidian';

type Result = 'fails' | 'passes' | 'unknown';
type PluginImage = { desired: boolean; nativeAutostart: boolean; loaded: boolean };
type Mutation = { ref: PluginRef; before: PluginImage; after: PluginImage; generationBefore?: unknown; generationAfter?: unknown; stepId: string };
type DebugStep = { id: string; at: string; mode: 'half' | 'complement' | 'pair' | 'single'; testRefs: string[]; pair?: string[]; status: 'prepared' | 'applied' | 'observed' | 'reverted' | 'error'; mutations: Mutation[]; observation?: Result; error?: string };
type DebugSession = {
  id: string; startedAt: string; active: boolean; interrupted: boolean; pausedReasonPrevious?: string;
  candidates: string[]; suspects: string[]; originals: Record<string, boolean>; owned: Record<string, Mutation>;
  experimentUniverse: string[];
  actualOnResume?: Record<string, PluginImage>;
  snapshot: { plugins: Record<string, { version: string; installed: boolean; compatible: boolean; nativeAutostart: boolean; loaded: boolean; desired: boolean; tags: string[]; group: string }>; profileId?: string; deferred: Array<{ id: string; delayMs: number; enabled: boolean; parked?: boolean }> };
  steps: DebugStep[]; observations: Array<{ at: string; note: string; result: Result; stepId?: string }>;
  interactions: Array<{ at: string; refs: string[]; note?: string; result?: Result }>;
  conflicts: Array<{ at: string; ref: string; expected: boolean; actual: boolean; reason: string }>;
  currentStep?: DebugStep; advanced: { active: boolean; settings: Record<string, unknown>; restore: Record<string, unknown> };
};

const ADVANCED_ID = 'mnaoumov/obsidian-advanced-debug-mode@1.11.1';

export class DebugManager {
  runtime: any;
  app: any;
  plugin: any;
  session: DebugSession | null = null;
  private advancedIntegration: AdvancedDebugIntegration | null = null;

  constructor(runtime: any, app: any, plugin: any) {
    this.runtime = runtime;
    this.app = app;
    this.plugin = plugin;
    const previous = runtime.state?.debug as DebugSession | undefined;
    if (previous?.active) {
      this.session = { ...previous, interrupted: true };
      this.ensureAdvanced();
      runtime.pause?.('debugging');
      const id = previous.id;
      void runtime.enqueue('debug-interrupted-recovery', async (tx: any) => {
        await tx.refresh();
        const latest = runtime.state?.debug as DebugSession | undefined;
        if (!latest?.active || latest.id !== id) return;
        latest.interrupted = true;
        this.session = latest;
        await tx.save();
        await tx.writeEffectiveState();
      }).catch((error: unknown) => runtime.log?.('error', 'No se pudo persistir la interrupción del diagnóstico.', error));
    }
  }

  async start(refs?: PluginRef[]): Promise<void> {
    return this.runtime.enqueue('debug-start', async (tx: any) => {
    if (this.session?.active) throw new Error('Ya existe una sesión de debugging activa o interrumpida. Finalízala o reanúdala explícitamente.');
    const list = await this.refreshList(tx);
    if ((this.runtime.state.debug as DebugSession | undefined)?.active) throw new Error('Hay una sesión de debugging persistida; reanúdala o finalízala explícitamente.');
    const protectedIds = new Set<string>([...(this.runtime.state.protected ?? []), `community:${this.plugin?.manifest?.id ?? 'aigility-plugin-manager'}`]);
    // Default set = the SAFE ACTIVE set, matching the UI default selection:
    // installed, compatible and actually active (loaded, native autostart, or
    // scheduled-and-desired). A bare desired=true record that is neither
    // loaded, native nor scheduled is inert state, not a diagnostic subject;
    // opting one in stays possible by passing an explicit refs array.
    const selected = refs ?? list.filter((item) => item.installed && item.compatible && DebugManager.isActuallyActive(item) && !protectedIds.has(key(item.ref)) && !protectedIds.has(item.ref.id)).map((item) => item.ref);
    const valid = new Map(list.map((item) => [key(item.ref), item]));
    const candidates = [...new Set(selected.map((ref) => key(ref)))].filter((id) => {
      const item = valid.get(id);
      return item?.installed && item.compatible && !protectedIds.has(id) && !protectedIds.has(item.ref.id);
    });
    if (!candidates.length) throw new Error('Se requiere al menos un plugin instalado y compatible, fuera de protección.');
    const originals: Record<string, boolean> = {};
    for (const id of candidates) originals[id] = Boolean(valid.get(id)?.desired);
    const session: DebugSession = {
      id: createId(), startedAt: new Date().toISOString(), active: true, interrupted: false,
      pausedReasonPrevious: this.runtime.local?.recoveryReason, candidates, suspects: [...candidates], originals, owned: {},
      experimentUniverse: list.filter((item) => item.installed && !protectedIds.has(key(item.ref)) && !protectedIds.has(item.ref.id)
        && (candidates.includes(key(item.ref)) || DebugManager.isActuallyActive(item))).map((item) => key(item.ref)),
      snapshot: {
        plugins: Object.fromEntries(list.map((item) => {
          const id = key(item.ref);
          return [id, { version: item.version, installed: item.installed, compatible: item.compatible, nativeAutostart: item.nativeAutostart, loaded: item.loaded, desired: Boolean(item.desired), tags: [...(item.tags ?? [])], group: item.group }];
        })),
        profileId: this.runtime.local?.deviceProfileId,
        deferred: (this.runtime.state.deferred ?? []).map((policy: any) => ({ id: policy.id, delayMs: policy.delayMs, enabled: policy.enabled, ...(policy.parked === undefined ? {} : { parked: policy.parked }) })),
      },
      steps: [], observations: [], interactions: [], conflicts: [], advanced: { active: false, settings: {}, restore: {} },
    };
    this.session = session;
    this.runtime.pause('debugging');
    await this.persist(tx);
    });
  }

  async resume(): Promise<void> {
    return this.runtime.enqueue('debug-resume', async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireSession();
    if (!session.active || !session.interrupted) throw new Error('No hay una sesión interrumpida que requiera reanudación manual.');
    const actual = await this.refreshList(tx);
    const currentById = new Map(actual.map((item) => [key(item.ref), item]));
    for (const [id, mutation] of Object.entries(session.owned)) {
      const item = currentById.get(id);
      if (!item) { delete session.owned[id]; continue; }
      const image = this.image(item);
      if (!this.sameImage(image, mutation.after) || !this.sameGeneration(mutation.ref, mutation.generationAfter)) {
        session.conflicts.push({ at: new Date().toISOString(), ref: id, expected: mutation.after.desired, actual: image.desired, reason: 'Cambio externo detectado al reanudar; se conserva el estado actual.' });
        delete session.owned[id];
      }
    }
    session.currentStep = undefined;
    session.actualOnResume = Object.fromEntries(actual.map((item) => [key(item.ref), this.image(item)]));
    session.interrupted = false;
    session.steps.push({ id: createId(), at: new Date().toISOString(), mode: 'half', testRefs: [], status: 'applied', mutations: [], error: 'Reanudación manual; se registra el estado actual sin repetir la selección anterior.' });
    await this.persist(tx);
    });
  }

  async testHalf(complement = false): Promise<void> {
    return this.runtime.enqueue(complement ? 'debug-test-complement' : 'debug-test-half', async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireUsableSession();
    const suspects = [...session.suspects];
    if (suspects.length === 1) return this.applyExperiment('single', suspects, undefined, tx);
    if (!suspects.length) throw new Error('No hay plugins sospechosos que probar.');
    const midpoint = Math.ceil(suspects.length / 2);
    const chosen = complement ? suspects.slice(midpoint) : suspects.slice(0, midpoint);
    if (!chosen.length) throw new Error('La mitad seleccionada está vacía.');
    await this.applyExperiment(complement ? 'complement' : 'half', chosen, undefined, tx);
    });
  }

  async testSingle(ref: PluginRef): Promise<void> {
    return this.runtime.enqueue(`debug-test-single:${key(ref)}`, async (tx: any) => {
      await this.refreshSession(tx);
      const session = this.requireUsableSession();
      const id = key(ref);
      if (!session.candidates.includes(id)) throw new Error('El plugin debe pertenecer a la sesión.');
      await this.applyExperiment('single', [id], undefined, tx);
    });
  }

  async testPair(a: PluginRef, b: PluginRef): Promise<void> {
    return this.runtime.enqueue(`debug-test-pair:${key(a)}:${key(b)}`, async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireUsableSession();
    const pair = [key(a), key(b)];
    if (pair[0] === pair[1]) throw new Error('testPair requiere dos plugins distintos.');
    if (pair.some((ref) => !session.candidates.includes(ref))) throw new Error('Ambos miembros de la pareja deben pertenecer a la sesión.');
    await this.applyExperiment('pair', pair, pair, tx);
    });
  }

  async previous(): Promise<void> {
    return this.runtime.enqueue('debug-previous', async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireUsableSession();
    const step = session.currentStep;
    if (!step || step.status === 'reverted') throw new Error('No hay un paso de prueba aplicado para revertir.');
    const errors = await this.restoreExperiment(step, tx);
    step.status = errors.length ? 'error' : 'reverted';
    if (errors.length) step.error = errors.join('; ');
    session.currentStep = undefined;
    await this.persist(tx);
    if (errors.length) throw new Error(`No se pudo revertir el paso anterior: ${errors.join('; ')}`);
    });
  }

  async observe(note: string, result: Result): Promise<void> {
    return this.runtime.enqueue('debug-observe', async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireUsableSession();
    const step = session.currentStep;
    const observation = { at: new Date().toISOString(), note: scrubText(note), result, ...(step ? { stepId: step.id } : {}) };
    session.observations.push(observation);
    if (step && step.status !== 'reverted') {
      step.observation = result;
      step.status = 'observed';
      if (step.mode === 'pair') {
        session.interactions.push({ at: observation.at, refs: [...(step.pair ?? step.testRefs)], note: observation.note, result });
      } else if (result === 'fails') {
        session.suspects = [...step.testRefs];
      } else if (result === 'passes') {
        const tested = new Set(step.testRefs);
        session.suspects = session.suspects.filter((ref) => !tested.has(ref));
      }
    }
    await this.persist(tx);
    });
  }

  async finish(): Promise<void> {
    return this.runtime.enqueue('debug-finish', async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireSession();
    const errors: string[] = [];
    if (session.currentStep) errors.push(...await this.restoreExperiment(session.currentStep, tx));
    for (const id of [...Object.keys(session.owned)].reverse()) {
      const mutation = session.owned[id];
      if (!mutation) continue;
      const item = await this.findCurrent(mutation.ref, tx);
      const actual = this.image(item);
      if (!this.sameImage(actual, mutation.after) || !this.sameGeneration(mutation.ref, mutation.generationAfter)) {
        session.conflicts.push({ at: new Date().toISOString(), ref: id, expected: mutation.after.desired, actual: actual.desired, reason: 'El valor actual o la generación cambió después del último cambio de la sesión.' });
        continue;
      }
      const original = session.snapshot.plugins[id];
      if (actual.desired !== original.desired || actual.nativeAutostart !== original.nativeAutostart || actual.loaded !== original.loaded) {
        try { await this.setOwned(id, original.desired, undefined, tx); }
        catch (error) { errors.push(`${id}: ${(error as Error).message}`); continue; }
      }
      delete session.owned[id];
    }
    if (session.advanced.active && this.advancedIntegration) {
      try { await this.advancedIntegration.disable(); } catch (error) { errors.push((error as Error).message); }
      session.advanced = { active: false, settings: {}, restore: {} };
    }
    session.active = false;
    session.interrupted = false;
    // Automation remains paused until the user explicitly resumes the runtime.
    await this.persist(tx);
    if (errors.length) throw new Error(`Sesión finalizada con errores de restauración: ${errors.join('; ')}`);
    });
  }

  async exportReports(): Promise<{ markdown: string; json: string }> {
    const session = this.requireSession();
    const sanitized = sanitize(session);
    const json = JSON.stringify({ schemaVersion: 1, plugin: ADVANCED_ID, session: sanitized, settings: reproducibleSettings(sanitized) }, null, 2);
    const lines = [
      '# Debug session report', '',
      `- Session: ${session.id}`,
      `- Started: ${session.startedAt}`,
      `- Status: ${session.active ? session.interrupted ? 'interrupted' : 'active' : 'finished'}`,
      `- Candidates: ${session.candidates.join(', ')}`,
      `- Suspects: ${session.suspects.join(', ')}`, '',
      '## Steps', '',
    ];
    for (const step of session.steps) {
      lines.push(`### ${step.at} - ${step.mode} - ${step.status}`, '', `- Tested: ${step.testRefs.join(', ') || '(none)'}`);
      if (step.observation) lines.push(`- Result: ${step.observation}`);
      if (step.error) lines.push(`- Error: ${scrubText(step.error)}`);
      lines.push('');
    }
    lines.push('## Observations', '');
    for (const item of session.observations) lines.push(`- ${item.at} - ${item.result} - ${item.note}`);
    lines.push('', '## Conflicts', '');
    for (const item of session.conflicts) lines.push(`- ${item.at} - ${item.ref}: expected ${item.expected}, found ${item.actual} (${item.reason})`);
    lines.push('', '## Reproducible settings', '', '```json', JSON.stringify(reproducibleSettings(sanitized), null, 2), '```');
    return { markdown: lines.join('\n'), json };
  }

  async advanced(enable: boolean): Promise<void> {
    return this.runtime.enqueue(`debug-advanced:${enable ? 'enable' : 'disable'}`, async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireUsableSession();
    this.ensureAdvanced();
    if (enable) {
      await this.advancedIntegration!.enable();
      session.advanced = this.advancedIntegrationState();
    } else {
      await this.advancedIntegration!.disable();
      session.advanced = { active: false, settings: {}, restore: {} };
    }
    await this.persist(tx);
    });
  }

  /** Options surface uses this source-backed capability catalog and must render unsupported entries disabled with their reason. */
  advancedCapabilities(): Array<{ id: AdvancedOption | 'cancelRunningTask'; supported: boolean; reason?: string }> {
    const adapter = this.app?.vault?.adapter;
    const desktop = Boolean(Platform.isDesktop);
    const nodeVersion = (globalThis as any).process?.versions?.node;
    const namespaceController = this.app?.debugNamespaceController ?? (globalThis as any).DEBUG;
    const mobileConsoleAvailable = typeof this.app?.showMobileConsole === 'function'
      || typeof (globalThis as any).document?.body?.createDiv === 'function';
    return [
      { id: 'debugMode', supported: typeof this.app?.debugMode === 'function' && typeof this.app?.loadLocalStorage === 'function' },
      { id: 'namespaces', supported: !!namespaceController && ['get', 'set', 'enable', 'disable'].every((method) => typeof namespaceController[method] === 'function') },
      { id: 'longStackTraces', supported: Boolean(Platform.isDesktop && typeof EventTarget !== 'undefined' && typeof Promise !== 'undefined'), reason: 'Long stack traces require the Desktop callback and Promise APIs.' },
      { id: 'asyncLongStackTraces', supported: Boolean(Platform.isDesktop && typeof EventTarget !== 'undefined' && typeof Promise !== 'undefined' && typeof nodeVersion === 'string'), reason: 'Async stack traces require Desktop Node async_hooks.' },
      { id: 'stackTraceLimit', supported: typeof (Error as any).stackTraceLimit === 'number' },
      { id: 'timeouts', supported: desktop && adapter?.constructor?.name === 'FileSystemAdapter' && typeof adapter?.thingsHappening === 'function', reason: 'Upstream timeout control applies only to Desktop FileSystemAdapter.' },
      { id: 'mobileConsole', supported: mobileConsoleAvailable, reason: 'Requires the upstream console adapter or Obsidian DOM createDiv().' },
      { id: 'mobileEmulation', supported: desktop && typeof this.app?.emulateMobile === 'function', reason: 'Upstream mobile emulation is Desktop only.' },
      { id: 'cancelRunningTask', supported: typeof AbortController !== 'undefined', reason: 'Requires the standard AbortController API.' },
    ];
  }

  async configureAdvanced(option: AdvancedOption, value: unknown): Promise<void> {
    return this.runtime.enqueue(`debug-configure-advanced:${option}`, async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireUsableSession();
    if (!session.advanced.active) throw new Error('Activa Advanced Debug Mode primero desde Opciones.');
    const capability = this.advancedCapabilities().find((item) => item.id === option);
    if (capability && !capability.supported) throw new Error(`Capability ${option} incompatible: ${capability.reason ?? 'no disponible en este host.'}`);
    this.ensureAdvanced();
    await this.advancedIntegration!.configure(option, value);
    session.advanced = this.advancedIntegrationState();
    await this.persist(tx);
    });
  }

  async cancelRunningTask(): Promise<void> {
    return this.runtime.enqueue('debug-cancel-running-task', async (tx: any) => {
    await this.refreshSession(tx);
    const session = this.requireUsableSession();
    if (!session.advanced.active) throw new Error('Activa Advanced Debug Mode primero desde Opciones.');
    this.ensureAdvanced();
    await this.advancedIntegration!.cancelRunningTask();
    });
  }

  dispose(): void {
    // Persisted active sessions deliberately remain interrupted until an explicit resume or finish.
    this.advancedIntegration?.dispose();
    // Do not persist a stale in-memory session during teardown.
  }

  private async applyExperiment(mode: DebugStep['mode'], testRefs: string[], pair: string[] | undefined, tx: any): Promise<void> {
    const session = this.requireUsableSession();
    if (session.currentStep) {
      const errors = await this.restoreExperiment(session.currentStep, tx);
      if (errors.length) throw new Error(`No se pudo restaurar el paso anterior: ${errors.join('; ')}`);
      session.currentStep.status = 'reverted';
    }
    const step: DebugStep = { id: createId(), at: new Date().toISOString(), mode, testRefs: [...testRefs], ...(pair ? { pair: [...pair] } : {}), status: 'prepared', mutations: [] };
    session.currentStep = step;
    session.steps.push(step);
    await this.persist(tx);
    try {
      for (const id of session.experimentUniverse) {
        const item = await this.findCurrent(parsePluginKey(id)!, tx);
        const desired = testRefs.includes(id);
        const needsChange = Boolean(item.desired) !== desired
          || (!desired && (item.nativeAutostart || item.loaded))
          || (desired && !item.loaded);
        if (needsChange) await this.setOwned(id, desired, step, tx);
      }
      step.status = 'applied';
      await this.persist(tx);
    } catch (error) {
      step.status = 'error';
      step.error = scrubText((error as Error).message);
      await this.persist(tx);
      throw error;
    }
  }

  private async restoreExperiment(step: DebugStep, tx: any): Promise<string[]> {
    const session = this.requireSession();
    const errors: string[] = [];
    for (const mutation of [...step.mutations].reverse()) {
      const actual = this.image(await this.findCurrent(mutation.ref, tx));
      if (!this.sameImage(actual, mutation.after) || !this.sameGeneration(mutation.ref, mutation.generationAfter)) {
        session.conflicts.push({ at: new Date().toISOString(), ref: key(mutation.ref), expected: mutation.after.desired, actual: actual.desired, reason: 'Cambio externo detectado al restaurar el paso.' });
        continue;
      }
      try {
        const original = session.snapshot.plugins[key(mutation.ref)];
        const originalImage = { desired: original.desired, nativeAutostart: original.nativeAutostart, loaded: original.loaded };
        if (!this.sameImage(actual, originalImage)) await this.restoreSnapshot(key(mutation.ref), original, tx);
        delete session.owned[key(mutation.ref)];
      } catch (error) { errors.push(`${key(mutation.ref)}: ${(error as Error).message}`); }
    }
    return errors;
  }

  private async setOwned(id: string, enabled: boolean, step: DebugStep | undefined, tx: any): Promise<void> {
    const ref = parsePluginKey(id);
    if (!ref) throw new Error(`PluginRef inválido: ${id}`);
    const before = this.image(await this.findCurrent(ref, tx));
    const generationBefore = this.generation(ref);
    const mutation: Mutation = { ref, before, after: { desired: enabled, nativeAutostart: before.nativeAutostart, loaded: before.loaded }, generationBefore, stepId: step?.id ?? 'restore' };
    if (step) step.mutations.push(mutation);
    sessionOwned(this.requireSession(), id, mutation);
    await this.persist(tx);
    try {
      await tx.setEnabled(ref, enabled, { loadNow: true, origin: 'debugging' });
      const after = await this.findCurrent(ref, tx);
      mutation.after = this.image(after);
      mutation.generationAfter = this.generation(ref);
      sessionOwned(this.requireSession(), id, mutation);
      await tx.writeEffectiveState();
      await this.persist(tx);
    } catch (error) {
      const actual = this.image(await this.findCurrent(ref, tx));
      mutation.after = actual;
      mutation.generationAfter = this.generation(ref);
      if (this.sameImage(actual, before)) delete this.requireSession().owned[id];
      else sessionOwned(this.requireSession(), id, mutation);
      await this.persist(tx);
      throw error;
    }
  }

  private async restoreSnapshot(id: string, image: { desired: boolean; nativeAutostart: boolean; loaded: boolean }, tx: any): Promise<void> {
    const ref = parsePluginKey(id)!;
    if (!image.nativeAutostart) {
      const record = this.runtime.state.records?.[id];
      if (record) record.desired = image.desired;
      if (image.loaded && image.desired) await tx.setEnabled(ref, true, { loadNow: true, origin: 'debugging' });
      else if (!image.loaded) await tx.setEnabled(ref, false, { loadNow: true, origin: 'debugging' });
      await tx.save();
      return;
    }
    await tx.setEnabled(ref, image.loaded, { loadNow: true, origin: 'debugging' });
  }

  private async refreshList(tx: any): Promise<EffectivePlugin[]> {
    await tx.refresh();
    return this.runtime.list() as EffectivePlugin[];
  }

  private async findCurrent(ref: PluginRef, tx: any): Promise<EffectivePlugin> {
    const item = (await this.refreshList(tx)).find((candidate) => key(candidate.ref) === key(ref));
    if (!item) throw new Error(`PluginRef no disponible durante la sesión: ${key(ref)}`);
    return item;
  }

  private async refreshSession(tx: any): Promise<void> {
    const previous = this.session;
    if (!previous) throw new Error('No existe una sesión de debugging.');
    await tx.refresh();
    const stored = this.runtime.state.debug as DebugSession | undefined;
    if (!stored?.active || stored.id !== previous.id) throw new Error('La sesión persistida cambió; actualiza su estado antes de continuar.');
    this.session = { ...stored, interrupted: previous.interrupted || stored.interrupted };
    this.ensureAdvanced();
  }

  /**
   * Actually active = loaded, native autostart, or scheduled-and-desired.
   * `desired` on its own is inert state (parked, off, or never scheduled) and
   * never makes a plugin a default diagnostic subject.
   */
  private static isActuallyActive(item: EffectivePlugin): boolean {
    return Boolean(item.loaded || item.nativeAutostart || (item.scheduled && item.desired));
  }

  private image(item: EffectivePlugin): PluginImage {
    return { desired: Boolean(item.desired), nativeAutostart: Boolean(item.nativeAutostart), loaded: Boolean(item.loaded) };
  }

  private sameImage(a: PluginImage, b: PluginImage): boolean {
    return a.desired === b.desired && a.nativeAutostart === b.nativeAutostart && a.loaded === b.loaded;
  }

  private generation(ref: PluginRef): unknown {
    const runtime = this.runtime;
    if (typeof runtime.getMutationGeneration === 'function') return runtime.getMutationGeneration(ref);
    if (typeof runtime.readGeneration === 'function') return runtime.readGeneration(ref);
    if (typeof runtime.getGeneration === 'function') return runtime.getGeneration(ref);
    return undefined;
  }

  private sameGeneration(ref: PluginRef, expected: unknown): boolean {
    return expected === undefined || Object.is(this.generation(ref), expected);
  }

  private async persist(tx: any): Promise<void> {
    if (!this.session) return;
    this.runtime.state.debug = this.session;
    await tx.save();
    await tx.writeEffectiveState();
  }

  private requireSession(): DebugSession {
    if (!this.session) throw new Error('No existe una sesión de debugging.');
    return this.session;
  }

  private requireUsableSession(): DebugSession {
    const session = this.requireSession();
    if (!session.active) throw new Error('La sesión ya ha finalizado.');
    if (session.interrupted) throw new Error('La sesión está interrumpida; ejecuta resume() explícitamente antes de continuar.');
    return session;
  }

  private ensureAdvanced(): void {
    if (!this.session) throw new Error('Advanced Debug Mode necesita una sesión de debugging.');
    this.advancedIntegration ??= new AdvancedDebugIntegration(this.app, this.plugin, this.session.advanced);
  }

  private advancedIntegrationState(): DebugSession['advanced'] {
    return this.session?.advanced ?? { active: false, settings: {}, restore: {} };
  }
}

function sessionOwned(session: DebugSession, id: string, mutation: Mutation): void {
  session.owned[id] = mutation;
}

function parsePluginKey(value: string): PluginRef | null {
  const separator = value.indexOf(':');
  if (separator < 1 || separator === value.length - 1) return null;
  const kind = value.slice(0, separator);
  if (kind !== 'community' && kind !== 'core') return null;
  return { kind, id: value.slice(separator + 1) };
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function scrubText(value: string): string {
  return value.replace(/(token|secret|password|api[_-]?key|auth(?:orization)?)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

function sanitize(value: unknown): any {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? scrubText(value) : value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|password|api[_-]?key|authorization/i.test(key)) continue;
    output[key] = sanitize(entry);
  }
  return output;
}

function reproducibleSettings(session: any): Record<string, unknown> {
  return { candidateRefs: session.candidates, testedSuspects: session.suspects, advanced: session.advanced?.settings ?? {} };
}
