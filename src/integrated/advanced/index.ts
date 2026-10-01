import { Platform } from 'obsidian';
import { installLongStackTraces } from './long-stack-traces';

export type AdvancedOption =
  | 'debugMode'
  | 'namespaces'
  | 'longStackTraces'
  | 'asyncLongStackTraces'
  | 'stackTraceLimit'
  | 'timeouts'
  | 'mobileConsole'
  | 'mobileEmulation';

type Restore = () => void | Promise<void>;
type Namespaces = { get(): string[]; set(value: string | string[]): void; enable(value: string | string[]): void; disable(value?: string | string[]): void };
type State = { active: boolean; settings: Record<string, unknown>; restore: Record<string, unknown> };

const ADVANCED_ID = 'advanced-debug-mode';
const DEFAULT_DEBUG_KEY = 'DebugMode';
const TIMEOUT_MS = 60_000;

/**
 * Source-aligned operations used by Advanced Debug Mode 1.11.1. Long stack
 * patching and async-context patching are integrated on Desktop through
 * installLongStackTraces(), which owns the EventTarget, timer and Promise
 * patches for the lifetime of the session and restores the captured natives
 * (reviving live listeners under their original identity) on teardown.
 */
export class AdvancedDebugIntegration {
  private app: any;
  private plugin: any;
  private platform: any;
  private eruda: any;
  private state: State;
  private teardowns: Restore[] = [];
  private owned: Map<string, { before: unknown; after: unknown }> = new Map();
  private consoleContainer: HTMLElement | null = null;
  private consoleOpen = false;
  private longStackTracesRestore: (() => void) | undefined;
  private ownedSharedAbort?: { bag: Record<string, unknown>; wrapper: { value: ResettableAbortControllerLike } };

  constructor(app: any, plugin: any, state: State) {
    this.app = app;
    this.plugin = plugin;
    this.state = state;
    this.platform = Platform;
    this.eruda = this.app?.debugHost?.eruda;
    for (const [name, value] of Object.entries(state.restore ?? {})) {
      if (name === 'timeouts' || name === 'independentPlugin' || !value || typeof value !== 'object') continue;
      const entry = value as { before: unknown; after: unknown };
      this.owned.set(name, { before: entry.before, after: entry.after === '[infinity]' ? Number.POSITIVE_INFINITY : entry.after });
    }
  }

  async enable(): Promise<void> {
    if (this.state.active) return;
    this.state.active = true;
    this.state.restore = {};
    try { await this.suspendIndependentPlugin(); }
    catch (error) { this.state.active = false; throw error; }
  }

  async configure(option: AdvancedOption, value: unknown): Promise<void> {
    if (!this.state.active) throw new Error('Advanced Debug Mode requiere una sesión activa.');
    if (option === 'debugMode') return this.setDebugMode(Boolean(value));
    if (option === 'namespaces') return this.setNamespaces(value);
    if (option === 'mobileConsole') return this.setMobileConsole(Boolean(value));
    if (option === 'mobileEmulation') return this.setMobileEmulation(Boolean(value));
    if (option === 'timeouts') return this.setTimeouts(Boolean(value));
    if (option === 'stackTraceLimit') return this.setStackTraceLimit(value);
    if (option === 'longStackTraces') return this.setLongStackTraces(Boolean(value));
    if (option === 'asyncLongStackTraces') return this.setAsyncLongStackTraces(Boolean(value));
    throw new TypeError(`Opción Advanced Debug desconocida: ${option}`);
  }

  async cancelRunningTask(): Promise<void> {
    const controller = this.getSharedAbortController();
    controller.abort(new Error('Aborted by Advanced Debug Mode.'));
  }

  async disable(): Promise<void> {
    if (!this.state.active && this.teardowns.length === 0 && !this.state.restore?.independentPlugin) return;
    const errors: string[] = [];
    this.restoreLongStackTraces();
    for (const teardown of this.teardowns.splice(0).reverse()) {
      try { await teardown(); } catch (error) { errors.push((error as Error).message); }
    }
    for (const [name, change] of this.owned) {
      try {
        const current = this.readOwnedValue(name);
        if (sameValue(current, change.after)) await this.writeOwnedValue(name, change.before);
      } catch (error) { errors.push(`${name}: ${(error as Error).message}`); }
    }
    try { await this.restoreIndependentPlugin(); } catch (error) { errors.push(`independentPlugin: ${(error as Error).message}`); }
    this.releaseOwnedSharedAbortController();
    this.owned.clear();
    this.state.active = false;
    if (errors.length) throw new Error(`Teardown Advanced Debug Mode incompleto: ${errors.join('; ')}`);
  }

  dispose(): void {
    this.restoreLongStackTraces();
    // Teardown restores only values still equal to the session-owned postimage.
    this.teardowns.splice(0).reverse().forEach((teardown) => { void Promise.resolve(teardown()).catch(() => undefined); });
    for (const [name, change] of this.owned) {
      try {
        if (sameValue(this.readOwnedValue(name), change.after)) void this.writeOwnedValue(name, change.before);
      } catch { /* Keep host unload best-effort; explicit finish records restore failures. */ }
    }
    void this.restoreIndependentPlugin().catch(() => undefined);
    this.releaseOwnedSharedAbortController();
    this.owned.clear();
    this.state.active = false;
    this.state.settings = {};
    this.state.restore = {};
  }

  private async setDebugMode(enabled: boolean): Promise<void> {
    if (typeof this.app?.debugMode !== 'function' || typeof this.app?.loadLocalStorage !== 'function') {
      this.requireUnsupported('debugMode', 'Este host no expone app.debugMode() y app.loadLocalStorage().');
    }
    const before = this.app.loadLocalStorage(DEFAULT_DEBUG_KEY) === '1';
    this.own('debugMode', before, enabled);
    if (before !== enabled) this.app.debugMode(enabled);
  }

  private async setNamespaces(value: unknown): Promise<void> {
    const controller = this.namespaceController();
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new TypeError('namespaces requiere una lista de strings.');
    const before = controller.get();
    this.own('namespaces', before, value);
    if (!sameValue(before, value)) controller.set(value as string[]);
  }

  private namespaceController(): Namespaces {
    const controller = this.app?.debugNamespaceController ?? (globalThis as any).DEBUG;
    if (!controller || !['get', 'set', 'enable', 'disable'].every((method) => typeof controller[method] === 'function')) {
      this.requireUnsupported('namespaces', 'Falta el controlador upstream get/set/enable/disable; no se escribirá localStorage a ciegas.');
    }
    return controller;
  }

  private async setMobileConsole(enabled: boolean): Promise<void> {
    if (enabled) {
      if (this.consoleOpen) return;
      const injectedConsole = this.app?.showMobileConsole;
      if (typeof injectedConsole === 'function') {
        const cleanup = injectedConsole();
        if (typeof cleanup !== 'function') this.requireUnsupported('mobileConsole', 'El adaptador del host abrió la consola sin devolver una función de teardown.');
        this.teardowns.push(cleanup);
      } else {
        const parent = (globalThis as any).document?.body;
        if (!parent?.createDiv) this.requireUnsupported('mobileConsole', 'El DOM de Obsidian no está disponible para montar Eruda.');
        this.consoleContainer = parent.createDiv({ cls: 'aigility-advanced-console' });
        this.eruda ??= (await import('./eruda-3.4.3.js')).default;
        this.eruda.init({ container: this.consoleContainer, useShadowDom: true });
        this.eruda.show();
      }
      this.consoleOpen = true;
      this.teardowns.push(() => this.destroyConsole());
      return;
    }
    await this.destroyConsole();
  }

  private async destroyConsole(): Promise<void> {
    if (!this.consoleOpen) return;
    if (typeof this.app?.showMobileConsole === 'function') {
      // The adapter's matching teardown is registered when the console opens.
    } else if (this.eruda) {
      this.eruda.hide();
      this.eruda.destroy();
    }
    this.consoleContainer?.remove();
    this.consoleContainer = null;
    this.consoleOpen = false;
  }

  private async setMobileEmulation(enabled: boolean): Promise<void> {
    if (this.platform?.isMobile || typeof this.app?.emulateMobile !== 'function') {
      this.requireUnsupported('mobileEmulation', 'Obsidian solo permite emular móvil desde Desktop mediante app.emulateMobile().');
    }
    const body = (globalThis as any).document?.body;
    if (!body?.classList) this.requireUnsupported('mobileEmulation', 'No se encontró document.body.classList para leer el estado efectivo.');
    const before = body.classList.contains('emulate-mobile');
    this.own('mobileEmulation', before, enabled);
    if (before !== enabled) this.app.emulateMobile(enabled);
  }

  private async setStackTraceLimit(value: unknown): Promise<void> {
    if (!Number.isInteger(value) || Number(value) < 0) throw new TypeError('stackTraceLimit debe ser un entero mayor o igual a cero.');
    const before = (globalThis as any).Error?.stackTraceLimit;
    if (typeof before !== 'number') this.requireUnsupported('stackTraceLimit', 'Error.stackTraceLimit no está disponible en este host.');
    const postimage = Number(value) || Number.POSITIVE_INFINITY;
    this.own('stackTraceLimit', before, postimage);
    this.state.settings.stackTraceLimit = Number(value);
    (globalThis as any).Error.stackTraceLimit = postimage;
  }

  private async setLongStackTraces(enabled: boolean): Promise<void> {
    if (enabled && this.platform?.isMobile) {
      this.requireUnsupported('longStackTraces', 'Advanced Debug Mode 1.11.1 instala el patch de callbacks solo en Desktop.');
    }
    const asyncEnabled = Boolean(this.state.settings.asyncLongStackTraces);
    if (enabled === Boolean(this.state.settings.longStackTraces) && (enabled ? Boolean(this.longStackTracesRestore) : true)) return;
    this.restoreLongStackTraces();
    if (!enabled) {
      this.state.settings.longStackTraces = false;
      if (asyncEnabled) this.state.settings.asyncLongStackTraces = false;
      delete this.state.restore.longStackTraces;
      return;
    }
    this.longStackTracesRestore = await installLongStackTraces(this.app, asyncEnabled);
    this.state.settings.longStackTraces = true;
    this.state.settings.asyncLongStackTraces = asyncEnabled;
    this.state.restore.longStackTraces = { before: false, after: true };
  }

  private async setAsyncLongStackTraces(enabled: boolean): Promise<void> {
    if (enabled && this.platform?.isMobile) {
      this.requireUnsupported('asyncLongStackTraces', 'async_hooks requiere Node.js/Electron y Advanced Debug Mode 1.11.1 lo limita a Desktop.');
    }
    if (enabled && !this.state.settings.longStackTraces) {
      await this.setLongStackTraces(true);
      this.restoreLongStackTraces();
      this.longStackTracesRestore = await installLongStackTraces(this.app, true);
      this.state.settings.longStackTraces = true;
      this.state.settings.asyncLongStackTraces = true;
      this.state.restore.longStackTraces = { before: false, after: true };
      this.state.restore.asyncLongStackTraces = { before: false, after: true };
      return;
    }
    if (enabled === Boolean(this.state.settings.asyncLongStackTraces)) return;
    if (this.state.settings.longStackTraces) {
      this.restoreLongStackTraces();
      this.longStackTracesRestore = await installLongStackTraces(this.app, enabled);
      this.state.settings.longStackTraces = true;
      this.state.restore.longStackTraces = { before: false, after: true };
    }
    this.state.settings.asyncLongStackTraces = enabled;
    this.state.restore.asyncLongStackTraces = { before: false, after: enabled };
  }

  private restoreLongStackTraces(): void {
    const restore = this.longStackTracesRestore;
    this.longStackTracesRestore = undefined;
    try { restore?.(); } finally {
      this.state.settings.longStackTraces = false;
      this.state.settings.asyncLongStackTraces = false;
      delete this.state.restore.longStackTraces;
      delete this.state.restore.asyncLongStackTraces;
    }
  }

  private getSharedAbortController(): ResettableAbortControllerLike {
    const realm = globalThis as typeof globalThis & { __obsidianDevUtils?: Record<string, unknown> };
    const bag = realm.__obsidianDevUtils ?? (realm.__obsidianDevUtils = {});
    const existing = bag.sharedAbortController as { value?: ResettableAbortControllerLike } | undefined;
    if (existing?.value && typeof existing.value.abort === 'function') return existing.value;

    const wrapper = { value: new ResettableAbortController() };
    bag.sharedAbortController = wrapper;
    this.ownedSharedAbort = { bag, wrapper };
    return wrapper.value;
  }

  private releaseOwnedSharedAbortController(): void {
    const owned = this.ownedSharedAbort;
    this.ownedSharedAbort = undefined;
    if (owned && owned.bag.sharedAbortController === owned.wrapper) delete owned.bag.sharedAbortController;
  }

  private async setTimeouts(disabled: boolean): Promise<void> {
    const adapter = this.app?.vault?.adapter;
    if (this.platform?.isMobile || adapter?.constructor?.name !== 'FileSystemAdapter' || typeof adapter.thingsHappening !== 'function') {
      this.requireUnsupported('timeouts', 'El control upstream de timeouts solo parchea FileSystemAdapter en Desktop.');
    }
    const before = adapter.thingsHappening;
    if (!disabled) {
      const owned = this.owned.get('timeouts');
      if (owned && adapter.thingsHappening === owned.after) adapter.thingsHappening = owned.before as (...args: any[]) => unknown;
      this.owned.delete('timeouts');
      return;
    }
    if (this.owned.has('timeouts')) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delayedNotice = (...args: any[]) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => console.warn('Obsidian default behavior to timeout long running tasks after 60 seconds is disabled by Advanced Debug Mode.'), TIMEOUT_MS);
      return undefined;
    };
    adapter.thingsHappening = delayedNotice;
    this.own('timeouts', before, delayedNotice);
    this.teardowns.push(() => {
      if (timer !== undefined) clearTimeout(timer);
      if (adapter.thingsHappening === delayedNotice) adapter.thingsHappening = before;
    });
  }

  private own(name: string, before: unknown, after: unknown): void {
    const existing = this.owned.get(name);
    this.owned.set(name, { before: existing?.before ?? before, after });
    this.state.restore[name] = { before: snapshot(before), after: snapshot(after) };
    this.state.settings[name] = snapshot(after);
  }

  /** Disable the separately registered community plugin while its integrated controls own the session. */
  private async suspendIndependentPlugin(): Promise<void> {
    const manager = this.app?.plugins;
    const id = ADVANCED_ID;
    const loaded = Boolean(manager?.plugins?.[id] ?? manager?.getPlugin?.(id));
    if (!loaded) return;
    const generationBefore = this.pluginGeneration(id);
    const nativeFlagBefore = manager.enabledPlugins instanceof Set ? manager.enabledPlugins.has(id) : undefined;
    if (typeof manager?.disablePlugin !== 'function') {
      this.state.active = false;
      this.requireUnsupported('independentPlugin', 'El host no expone plugins.disablePlugin() para suspender la instancia comunitaria independiente.');
    }
    await manager.disablePlugin(id);
    const stillLoaded = Boolean(manager?.plugins?.[id] ?? manager?.getPlugin?.(id));
    if (stillLoaded) {
      this.state.active = false;
      this.requireUnsupported('independentPlugin', 'plugins.disablePlugin() terminó sin desactivar Advanced Debug Mode.');
    }
    const generationAfter = this.pluginGeneration(id);
    if (!Object.is(generationBefore, generationAfter)) {
      this.state.active = false;
      this.requireUnsupported('independentPlugin', 'La generación de mutación cambió mientras se suspendía la instancia; se conserva la intención manual y no se restaurará automáticamente.');
    }
    const nativeFlagAfter = manager.enabledPlugins instanceof Set ? manager.enabledPlugins.has(id) : undefined;
    if (nativeFlagBefore !== nativeFlagAfter) {
      this.state.active = false;
      this.requireUnsupported('independentPlugin', 'plugins.disablePlugin() cambió enabledPlugins; no se alterará ni repondrá la intención persistente.');
    }
    this.state.restore.independentPlugin = {
      before: true,
      after: false,
      actualLoadedBefore: true,
      actualLoadedAfter: false,
      nativeFlag: nativeFlagBefore,
      generationBefore,
      generationAfter,
    };
    this.state.settings.independentPluginSuspended = true;
  }

  private async restoreIndependentPlugin(): Promise<void> {
    const saved = this.state.restore?.independentPlugin as { before?: boolean; after?: boolean; actualLoadedBefore?: boolean; actualLoadedAfter?: boolean; nativeFlag?: boolean; generationAfter?: unknown } | undefined;
    if (!(saved?.actualLoadedBefore ?? saved?.before) || (saved.actualLoadedAfter ?? saved.after) !== false) return;
    const manager = this.app?.plugins;
    const loaded = Boolean(manager?.plugins?.[ADVANCED_ID] ?? manager?.getPlugin?.(ADVANCED_ID));
    const generation = this.pluginGeneration(ADVANCED_ID);
    const nativeFlag = manager.enabledPlugins instanceof Set ? manager.enabledPlugins.has(ADVANCED_ID) : undefined;
    if (loaded || (saved.generationAfter !== undefined && generation !== saved.generationAfter) || (saved.nativeFlag !== undefined && nativeFlag !== saved.nativeFlag)) return;
    if (typeof manager?.enablePlugin !== 'function') {
      this.requireUnsupported('independentPlugin', 'El host no expone plugins.enablePlugin() para restaurar la instancia que estaba habilitada antes de la sesión.');
    }
    await manager.enablePlugin(ADVANCED_ID);
    const restored = Boolean(manager.plugins?.[ADVANCED_ID] ?? manager.getPlugin?.(ADVANCED_ID));
    if (!restored) this.requireUnsupported('independentPlugin', 'plugins.enablePlugin() terminó sin reactivar Advanced Debug Mode.');
    delete this.state.restore.independentPlugin;
    delete this.state.settings.independentPluginSuspended;
  }

  private pluginGeneration(id: string): unknown {
    const runtime = this.plugin?.runtime;
    if (typeof runtime?.getMutationGeneration !== 'function') {
      this.requireUnsupported('independentPlugin', 'La restauración segura necesita plugin.runtime.getMutationGeneration().');
    }
    return runtime.getMutationGeneration({ kind: 'community', id });
  }

  private readOwnedValue(name: string): unknown {
    if (name === 'debugMode') return this.app.loadLocalStorage(DEFAULT_DEBUG_KEY) === '1';
    if (name === 'namespaces') return this.namespaceController().get();
    if (name === 'mobileEmulation') return (globalThis as any).document?.body?.classList?.contains('emulate-mobile');
    if (name === 'stackTraceLimit') return (globalThis as any).Error?.stackTraceLimit;
    if (name === 'timeouts') return this.app?.vault?.adapter?.thingsHappening;
    return undefined;
  }

  private async writeOwnedValue(name: string, value: unknown): Promise<void> {
    if (name === 'debugMode') this.app.debugMode(Boolean(value));
    else if (name === 'namespaces') this.namespaceController().set(value as string[]);
    else if (name === 'mobileEmulation') this.app.emulateMobile(Boolean(value));
    else if (name === 'stackTraceLimit') (globalThis as any).Error.stackTraceLimit = value;
    else if (name === 'timeouts') this.app.vault.adapter.thingsHappening = value;
  }

  private requireUnsupported(capability: string, reason: string): never {
    throw new Error(`Advanced Debug Mode incompatibility (${capability}): ${reason}`);
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof value === 'function') return '[function]' as T;
  if (typeof value === 'number' && !Number.isFinite(value)) return '[infinity]' as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

function snapshot<T>(value: T): T {
  return clone(value);
}

type ResettableAbortControllerLike = { signal: AbortSignal; abort(reason?: unknown): void };

class ResettableAbortController implements ResettableAbortControllerLike {
  private controller = new AbortController();

  get signal(): AbortSignal { return this.controller.signal; }

  abort(reason?: unknown): void {
    this.controller.abort(reason);
    this.controller = new AbortController();
  }
}
