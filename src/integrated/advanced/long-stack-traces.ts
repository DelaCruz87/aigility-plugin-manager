type Frame = { title: string; stack: string };
type Cleanup = () => void;
type Listener = EventListenerOrEventListenerObject;

const MAX_STACK_FRAMES = 32;
const MAX_ASYNC_CONTEXTS = 4096;
const asyncFrames = new Map<number, Frame[]>();

function capture(title: string): Frame {
  return { title, stack: new Error().stack?.split('\n').slice(2).join('\n') ?? '' };
}

function appendErrorStack(error: unknown, frames: Frame[]): void {
  if (!(error instanceof Error) || frames.length === 0) return;
  const marker = '\n--- async call stack ---';
  const stack = error.stack ?? `${error.name}: ${error.message}`;
  if (stack.includes(marker)) return;
  const extra = frames.slice(-MAX_STACK_FRAMES).reverse().map((frame) => `\n--- ${frame.title} ---\n${frame.stack}`).join('');
  try { error.stack = `${stack}${marker}${extra}`; } catch { /* Some host Error objects expose a readonly stack. */ }
}

function wrap<F extends (...args: any[]) => any>(fn: F, frame: Frame, active: () => boolean, parents: () => Frame[], enter: (frame: Frame) => void, leave: () => void): F {
  return function (this: unknown, ...args: unknown[]) {
    if (!active()) return fn.apply(this, args);
    const inherited = parents();
    enter(frame);
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.catch((error: unknown) => {
          appendErrorStack(error, [...inherited, frame]);
          throw error;
        });
      }
      return result;
    } catch (error) {
      appendErrorStack(error, [...inherited, frame]);
      throw error;
    } finally {
      leave();
    }
  } as F;
}

function wrapCallback(value: unknown, frame: Frame, active: () => boolean, parents: () => Frame[], enter: (frame: Frame) => void, leave: () => void): unknown {
  return typeof value === 'function' ? wrap(value as (...args: any[]) => any, frame, active, parents, enter, leave) : value;
}

function patchEventListeners(proto: EventTarget, active: () => boolean, parents: () => Frame[], enter: (frame: Frame) => void, leave: () => void): Cleanup {
  const originalAdd = proto.addEventListener;
  const originalRemove = proto.removeEventListener;
  type Registration = { wrapped: EventListener; fired: boolean; entry?: Entry; cleanup: () => void };
  type Entry = {
    type: string;
    capture: boolean;
    signal: AbortSignal | undefined;
    nativeOptions: boolean | AddEventListenerOptions;
    targetRef: WeakRef<EventTarget>;
    listenerRef: WeakRef<EventListenerOrEventListenerObject>;
    registrationRef: WeakRef<Registration>;
  };
  const handlers = new WeakMap<EventTarget, Map<string, Map<EventListenerOrEventListenerObject, Map<boolean, Registration>>>>();
  // Iterable teardown index: WeakRefs only, so a target that is garbage collected never keeps a live entry alive.
  const registry = new Set<Entry>();
  let registrationCount = 0;
  const getRegistration = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean) => handlers.get(target)?.get(type)?.get(listener)?.get(capture);
  const forget = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean, registration: Registration) => {
    const byType = handlers.get(target);
    const byListener = byType?.get(type)?.get(listener);
    if (byListener?.get(capture) !== registration) return;
    registration.cleanup();
    byListener.delete(capture);
    registrationCount--;
    if (byListener.size === 0) byType?.get(type)?.delete(listener);
    if (byType?.get(type)?.size === 0) byType.delete(type);
    const entry = registration.entry;
    if (entry) { registry.delete(entry); registration.entry = undefined; }
    if (!active() && registrationCount === 0 && proto.removeEventListener === patchedRemove) proto.removeEventListener = originalRemove;
  };
  const patchedAdd: typeof proto.addEventListener = function (this: EventTarget, type, listener, options): void {
    if (!active() || listener == null) return originalAdd.call(this, type, listener, options);
    const key = listener as EventListenerOrEventListenerObject;
    const asOptions = typeof options === 'object' && options ? options : undefined;
    const captureOption = typeof options === 'boolean' ? options : Boolean(asOptions?.capture);
    const once = Boolean(asOptions?.once);
    const signal = asOptions?.signal;
    if (signal?.aborted) return originalAdd.call(this, type, listener, options);
    const existing = getRegistration(this, type, key, captureOption);
    if (existing) return originalAdd.call(this, type, existing.wrapped, options);
    const byType = handlers.get(this) ?? new Map<string, Map<EventListenerOrEventListenerObject, Map<boolean, Registration>>>();
    const byListener = byType.get(type) ?? new Map<EventListenerOrEventListenerObject, Map<boolean, Registration>>();
    const byCapture = byListener.get(key) ?? new Map<boolean, Registration>();
    let registration: Registration;
    let registrationRef: WeakRef<Registration>;
    const targetRef = new WeakRef(this);
    const listenerRef = new WeakRef(key);
    // Exact native shape captured at register time so teardown re-adds the same registration semantics.
    const nativeOptions: boolean | AddEventListenerOptions = asOptions
      ? { capture: captureOption, once, passive: asOptions.passive, signal }
      : (options ?? false);
    const frame = capture('EventTarget.addEventListener');
    const callback: EventListener = typeof listener === 'function'
      ? wrapCallback(listener as EventListener, frame, active, parents, enter, leave) as EventListener
      : wrap(function (this: EventListenerObject, event: Event) { return listener.handleEvent.call(listener, event); }, frame, active, parents, enter, leave);
    const abortHandler = () => {
      const target = targetRef.deref();
      const originalListener = listenerRef.deref();
      const liveRegistration = registrationRef.deref();
      if (target && originalListener && liveRegistration) forget(target, type, originalListener, captureOption, liveRegistration);
    };
    registration = {
      wrapped: function (this: EventTarget, event: Event) {
        if (once) registration.fired = true;
        try { return callback.call(this, event); }
        finally { if (once) forget(this, type, key, captureOption, registration); }
      },
      fired: false,
      cleanup: () => { if (signal) originalRemove.call(signal, 'abort', abortHandler); },
    };
    registrationRef = new WeakRef(registration);
    const entry: Entry = { type, capture: captureOption, signal, nativeOptions, targetRef, listenerRef, registrationRef };
    registration.entry = entry;
    registry.add(entry);
    // The abort hook is instrumentation bookkeeping: it bypasses the patch so teardown never revives it.
    if (signal) originalAdd.call(signal, 'abort', abortHandler, { once: true });
    byCapture.set(captureOption, registration);
    byListener.set(key, byCapture);
    byType.set(type, byListener);
    handlers.set(this, byType);
    registrationCount++;
    originalAdd.call(this, type, registration.wrapped, options);
  };
  const patchedRemove: typeof proto.removeEventListener = function (this: EventTarget, type, listener, options): void {
    if (!listener) return originalRemove.call(this, type, listener, options);
    const captureOption = typeof options === 'boolean' ? options : Boolean((typeof options === 'object' && options ? options : undefined)?.capture);
    const registration = getRegistration(this, type, listener, captureOption);
    originalRemove.call(this, type, registration?.wrapped ?? listener, options);
    if (registration) forget(this, type, listener, captureOption, registration);
  };
  proto.addEventListener = patchedAdd;
  proto.removeEventListener = patchedRemove;
  return () => {
    // Unwind through the captured natives so no patched method is consulted mid-teardown.
    if (proto.addEventListener === patchedAdd) proto.addEventListener = originalAdd;
    if (proto.removeEventListener === patchedRemove) proto.removeEventListener = originalRemove;
    for (const entry of [...registry]) {
      const target = entry.targetRef.deref();
      const listener = entry.listenerRef.deref();
      const registration = entry.registrationRef.deref();
      if (!target || !listener || !registration) continue;
      forget(target, entry.type, listener, entry.capture, registration);
      // `once` already fired or the signal aborted: the native listener is gone, reviving it would duplicate delivery.
      if (registration.fired || entry.signal?.aborted) continue;
      originalRemove.call(target, entry.type, registration.wrapped, entry.nativeOptions);
      originalAdd.call(target, entry.type, listener, entry.nativeOptions);
    }
    registry.clear();
  };
}

function installCallbackPatches(app: any, getExecutionAsyncId: () => (() => number) | undefined): Cleanup {
  let enabled = true;
  const active = () => enabled;
  const currentFrames: Frame[] = [];
  const parents = () => [...currentFrames, ...(getExecutionAsyncId() ? getAsyncFrames(getExecutionAsyncId()) : [])];
  const enter = (frame: Frame) => { currentFrames.push(frame); };
  const leave = () => { currentFrames.pop(); };
  const restores: Cleanup[] = [];
  const windows = new Set<any>();
  if (typeof window !== 'undefined') windows.add(window);
  const appWindow = app?.workspace?.containerEl?.ownerDocument?.defaultView;
  if (appWindow) windows.add(appWindow);

  for (const win of windows) {
    for (const method of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'setImmediate']) {
      const original = win?.[method];
      if (typeof original !== 'function') continue;
      const patched = function (this: unknown, handler: unknown, ...args: unknown[]) {
        if (!active() || typeof handler !== 'function') return original.call(this, handler, ...args);
        return original.call(this, wrapCallback(handler, capture(method), active, parents, enter, leave), ...args);
      };
      win[method] = patched;
      restores.push(() => { if (win[method] === patched) win[method] = original; });
    }
  }
  const eventPrototypes = new Set<any>();
  if (globalThis.EventTarget?.prototype) eventPrototypes.add(globalThis.EventTarget.prototype);
  for (const win of windows) if (win?.EventTarget?.prototype) eventPrototypes.add(win.EventTarget.prototype);
  for (const eventProto of eventPrototypes) restores.push(patchEventListeners(eventProto, active, parents, enter, leave));
  const promisePrototypes = new Set<any>();
  if (globalThis.Promise?.prototype) promisePrototypes.add(globalThis.Promise.prototype);
  for (const win of windows) if (win?.Promise?.prototype) promisePrototypes.add(win.Promise.prototype);
  for (const promiseProto of promisePrototypes) {
    for (const method of ['then', 'catch', 'finally']) {
      const original = promiseProto[method];
      if (typeof original !== 'function') continue;
      const patched = function (this: Promise<unknown>, ...args: unknown[]) {
        if (!active()) return original.apply(this, args);
        const frame = capture(`Promise.${method}`);
        return original.apply(this, args.map((handler) => wrapCallback(handler, frame, active, parents, enter, leave)));
      };
      promiseProto[method] = patched;
      restores.push(() => { if (promiseProto[method] === patched) promiseProto[method] = original; });
    }
  }
  return () => {
    enabled = false;
    for (const restore of restores.reverse()) restore();
  };
}

export async function installLongStackTraces(app: any, withAsyncHooks: boolean): Promise<Cleanup> {
  let executionAsyncId: (() => number) | undefined;
  const restoreCallbacks = installCallbackPatches(app, () => executionAsyncId);
  let hook: { enable(): void; disable(): void } | undefined;
  const asyncContext = new Map<number, Frame[]>();
  if (withAsyncHooks) {
    try {
      // @ts-expect-error Node's built-in types are intentionally not a package dependency; runtime support is Desktop-gated.
      const asyncHooks = await import('node:async_hooks');
      executionAsyncId = asyncHooks.executionAsyncId;
      hook = asyncHooks.createHook({
        init(asyncId: number, type: string, triggerAsyncId: number) {
          if (type !== 'PROMISE') return;
          const frames = [...(asyncContext.get(triggerAsyncId) ?? []), capture('async_hooks.PROMISE')].slice(-MAX_STACK_FRAMES);
          asyncContext.set(asyncId, frames);
          asyncFrames.set(asyncId, frames);
          if (asyncContext.size > MAX_ASYNC_CONTEXTS) {
            const oldest = asyncContext.keys().next().value;
            if (oldest !== undefined) { asyncContext.delete(oldest); asyncFrames.delete(oldest); }
          }
        },
        destroy(asyncId: number) { asyncContext.delete(asyncId); asyncFrames.delete(asyncId); }
      }) as { enable(): void; disable(): void };
      hook.enable();
    } catch (error) {
      restoreCallbacks();
      throw new Error(`No se pudieron habilitar async_hooks en Desktop: ${(error as Error).message}`);
    }
  }
  return () => {
    hook?.disable();
    for (const id of asyncContext.keys()) asyncFrames.delete(id);
    asyncContext.clear();
    executionAsyncId = undefined;
    restoreCallbacks();
  };
}

function getAsyncFrames(executionAsyncId?: () => number): Frame[] {
  return executionAsyncId ? asyncFrames.get(executionAsyncId()) ?? [] : [];
}
