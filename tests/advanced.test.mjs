import assert from 'node:assert/strict';
import test from 'node:test';
import { importModule } from '../test.config.mjs';

globalThis.self ??= globalThis;

test('long stack traces attach named callback registration frames and preserve Error subclass identity', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const restore = await installLongStackTraces({}, false);
  class DomainError extends TypeError { static marker = 'kept'; }
  function namedPromiseParent() {
    return Promise.resolve().then(() => { throw new DomainError('callback failed'); });
  }
  try {
    await assert.rejects(namedPromiseParent(), (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.constructor.marker, 'kept');
      assert.match(error.stack, /namedPromiseParent/);
      assert.match(error.stack, /Promise\.then/);
      return true;
    });
  } finally {
    restore();
  }
  assert.equal(Promise.prototype.then.name, 'then');
});

test('async_hooks add promise creation frames and are removed with the callback wrappers', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const originalThen = Promise.prototype.then;
  const restore = await installLongStackTraces({}, true);
  async function namedAsyncParent() {
    await Promise.resolve();
    throw new Error('async failed');
  }
  try {
    await assert.rejects(namedAsyncParent().catch((error) => { throw error; }), (error) => {
      assert.match(error.stack, /namedAsyncParent/);
      assert.match(error.stack, /async_hooks\.PROMISE/);
      return true;
    });
  } finally {
    restore();
  }
  assert.equal(Promise.prototype.then, originalThen);
});

test('EventTarget removal resolves the original listener identity after wrapping', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const restore = await installLongStackTraces({}, false);
  const target = new EventTarget();
  let calls = 0;
  const listener = () => { calls++; };
  try {
    target.addEventListener('probe', listener);
    target.removeEventListener('probe', listener);
    target.dispatchEvent(new Event('probe'));
    assert.equal(calls, 0);
    target.addEventListener('probe', listener);
    target.dispatchEvent(new Event('probe'));
    assert.equal(calls, 1);
  } finally {
    target.removeEventListener('probe', listener);
    restore();
  }
});

test('timer callbacks retain the named registration frame and teardown preserves a later wrapper', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const previousWindow = globalThis.window;
  let scheduled;
  const originalSetTimeout = (handler) => { scheduled = handler; return 17; };
  globalThis.window = { setTimeout: originalSetTimeout };
  const restore = await installLongStackTraces({}, false);
  let restored = false;
  function namedTimerParent() { return window.setTimeout(() => { throw new Error('timer failed'); }, 0); }
  try {
    assert.equal(namedTimerParent(), 17);
    assert.throws(() => scheduled(), (error) => {
      assert.match(error.stack, /namedTimerParent/);
      assert.match(error.stack, /setTimeout/);
      return true;
    });
    const instrumented = window.setTimeout;
    const laterWrapper = function (...args) { return instrumented.apply(this, args); };
    window.setTimeout = laterWrapper;
    restore();
    restored = true;
    assert.equal(window.setTimeout, laterWrapper);
  } finally {
    if (!restored) restore();
    if (window.setTimeout !== originalSetTimeout) window.setTimeout = originalSetTimeout;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('Advanced Debug Mode option lifecycle restores hooks and keeps a separately loaded plugin nonpersistent', async () => {
  const { AdvancedDebugIntegration } = await importModule('src/integrated/advanced/index.ts');
  const loadedInstance = { id: 'advanced-debug-mode' };
  const enabledPlugins = new Set(['advanced-debug-mode']);
  const generations = new Map([['community:advanced-debug-mode', 7]]);
  const app = {
    plugins: {
      enabledPlugins,
      plugins: { 'advanced-debug-mode': loadedInstance },
      async disablePlugin(id) { delete this.plugins[id]; },
      async enablePlugin(id) { this.plugins[id] = loadedInstance; },
    },
    loadLocalStorage() { return '0'; },
    debugMode() {},
  };
  const plugin = { runtime: { getMutationGeneration(ref) { return generations.get(`${ref.kind}:${ref.id}`); } } };
  const state = { active: false, settings: {}, restore: {} };
  const integration = new AdvancedDebugIntegration(app, plugin, state);
  const originalThen = Promise.prototype.then;
  await integration.enable();
  assert.equal(app.plugins.plugins['advanced-debug-mode'], undefined);
  assert.equal(enabledPlugins.has('advanced-debug-mode'), true);
  await integration.configure('longStackTraces', true);
  await integration.configure('asyncLongStackTraces', true);
  assert.notEqual(Promise.prototype.then, originalThen);
  await integration.configure('asyncLongStackTraces', false);
  assert.notEqual(Promise.prototype.then, originalThen);
  assert.equal(state.settings.longStackTraces, true);
  assert.equal(state.settings.asyncLongStackTraces, false);
  await integration.configure('asyncLongStackTraces', true);
  await integration.disable();
  assert.equal(Promise.prototype.then, originalThen);
  assert.equal(app.plugins.plugins['advanced-debug-mode'], loadedInstance);
  assert.equal(enabledPlugins.has('advanced-debug-mode'), true);
});

test('unload and changed native intent do not re-enable the independent plugin', async () => {
  const { AdvancedDebugIntegration } = await importModule('src/integrated/advanced/index.ts');
  const loadedInstance = { id: 'advanced-debug-mode' };
  const enabledPlugins = new Set(['advanced-debug-mode']);
  const app = { plugins: {
    enabledPlugins,
    plugins: { 'advanced-debug-mode': loadedInstance },
    async disablePlugin(id) { delete this.plugins[id]; },
    async enablePlugin(id) { this.plugins[id] = loadedInstance; },
  } };
  let generation = 4;
  const plugin = { runtime: { getMutationGeneration() { return generation; } } };
  const integration = new AdvancedDebugIntegration(app, plugin, { active: false, settings: {}, restore: {} });
  await integration.enable();
  enabledPlugins.delete('advanced-debug-mode');
  await integration.disable();
  assert.equal(app.plugins.plugins['advanced-debug-mode'], undefined);

  enabledPlugins.add('advanced-debug-mode');
  app.plugins.plugins['advanced-debug-mode'] = loadedInstance;
  const second = new AdvancedDebugIntegration(app, plugin, { active: false, settings: {}, restore: {} });
  await second.enable();
  generation++;
  await second.disable();
  assert.equal(app.plugins.plugins['advanced-debug-mode'], undefined);
});

test('V8 stack trace limit is restored after the integrated session ends', async () => {
  const { AdvancedDebugIntegration } = await importModule('src/integrated/advanced/index.ts');
  const originalLimit = Error.stackTraceLimit;
  const integration = new AdvancedDebugIntegration({}, {}, { active: false, settings: {}, restore: {} });
  await integration.enable();
  await integration.configure('stackTraceLimit', 0);
  assert.equal(Error.stackTraceLimit, Number.POSITIVE_INFINITY);
  await integration.disable();
  assert.equal(Error.stackTraceLimit, originalLimit);
});

test('listener registered during patch remains removable by original identity after disable', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  const restore = await installLongStackTraces({}, false);
  const target = new EventTarget();
  let calls = 0;
  const listener = () => { calls++; };
  target.addEventListener('post-disable', listener, { capture: true });
  restore();
  assert.equal(EventTarget.prototype.addEventListener, originalAdd, 'teardown restores the native registration method immediately');
  assert.equal(EventTarget.prototype.removeEventListener, originalRemove, 'teardown restores the native removal method immediately');
  target.removeEventListener('post-disable', listener, { capture: true });
  target.dispatchEvent(new Event('post-disable'));
  assert.equal(calls, 0);
  target.addEventListener('post-disable', listener, { capture: true });
  target.dispatchEvent(new Event('post-disable'));
  assert.equal(calls, 1, 'the revived capture listener is the original identity');
});

test('teardown never revives a self-fired once listener or an already aborted signal listener', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  const restore = await installLongStackTraces({}, false);
  const onceTarget = new EventTarget();
  const abortedTarget = new EventTarget();
  const pendingTarget = new EventTarget();
  let onceCalls = 0;
  let abortedCalls = 0;
  let pendingCalls = 0;
  const onceListener = () => { onceCalls++; };
  const abortedListener = () => { abortedCalls++; };
  const pendingListener = () => { pendingCalls++; };
  const abortController = new AbortController();
  const pendingController = new AbortController();
  try {
    onceTarget.addEventListener('once', onceListener, { once: true });
    abortedTarget.addEventListener('aborted', abortedListener, { signal: abortController.signal });
    pendingTarget.addEventListener('pending', pendingListener, { signal: pendingController.signal });
    onceTarget.dispatchEvent(new Event('once'));
    abortController.abort();
    restore();
    assert.equal(EventTarget.prototype.addEventListener, originalAdd);
    assert.equal(EventTarget.prototype.removeEventListener, originalRemove);
    onceTarget.dispatchEvent(new Event('once'));
    assert.equal(onceCalls, 1, 'teardown does not revive the already fired once listener');
    onceTarget.addEventListener('once', onceListener, { once: true });
    onceTarget.dispatchEvent(new Event('once'));
    assert.equal(onceCalls, 2, 'only the caller re-registration delivers again, and it fires exactly once');
    abortedTarget.dispatchEvent(new Event('aborted'));
    assert.equal(abortedCalls, 0, 'an aborted signal listener is not revived by teardown');
    pendingTarget.dispatchEvent(new Event('pending'));
    assert.equal(pendingCalls, 1, 'a pending signal listener is re-added with its original identity and signal');
    pendingTarget.removeEventListener('pending', pendingListener);
    pendingTarget.dispatchEvent(new Event('pending'));
    assert.equal(pendingCalls, 1);
    pendingTarget.removeEventListener('pending', pendingListener);
  } finally {
    restore();
  }
});

test('duplicate registration keeps one live wrapped listener and teardown restores it exactly once', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  const restore = await installLongStackTraces({}, false);
  const target = new EventTarget();
  let calls = 0;
  const listener = () => { calls++; };
  try {
    target.addEventListener('dedupe', listener);
    target.addEventListener('dedupe', listener);
    target.dispatchEvent(new Event('dedupe'));
    assert.equal(calls, 1, 'native duplicate suppression is preserved while patched');
    restore();
    assert.equal(EventTarget.prototype.addEventListener, originalAdd);
    assert.equal(EventTarget.prototype.removeEventListener, originalRemove);
    target.dispatchEvent(new Event('dedupe'));
    assert.equal(calls, 2, 'the deduplicated listener is re-added once, not twice');
    target.removeEventListener('dedupe', listener);
    target.dispatchEvent(new Event('dedupe'));
    assert.equal(calls, 2, 'the revived listener is removable by original identity');
  } finally {
    restore();
    target.removeEventListener('dedupe', listener);
  }
});

test('queued timer runs without tracing after disable and abort signal cleanup removes only its own shared slot', async () => {
  const { installLongStackTraces } = await importModule('src/integrated/advanced/long-stack-traces.ts');
  const previousWindow = globalThis.window;
  let queued;
  const originalSetTimeout = (handler) => { queued = handler; return 4; };
  globalThis.window = { setTimeout: originalSetTimeout };
  const restore = await installLongStackTraces({}, false);
  function namedQueuedTimer() { return window.setTimeout(() => { throw new Error('timer after disable'); }, 0); }
  try {
    namedQueuedTimer();
    restore();
    assert.throws(() => queued(), (error) => {
      assert.doesNotMatch(error.stack, /namedQueuedTimer/);
      assert.doesNotMatch(error.stack, /setTimeout/);
      return true;
    });
  } finally {
    restore();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  const { AdvancedDebugIntegration } = await importModule('src/integrated/advanced/index.ts');
  delete globalThis.__obsidianDevUtils;
  const NativeAbortController = globalThis.AbortController;
  const madeControllers = [];
  globalThis.AbortController = class extends NativeAbortController {
    constructor() { super(); madeControllers.push(this); }
  };
  const integration = new AdvancedDebugIntegration({}, {}, { active: false, settings: {}, restore: {} });
  try {
    await integration.enable();
    await integration.cancelRunningTask();
    assert.equal(madeControllers[0].signal.aborted, true);
    assert.equal(madeControllers.length, 2, 'abort replaces the consumed signal with a new controller');
    await integration.disable();
    assert.equal(globalThis.__obsidianDevUtils.sharedAbortController, undefined);
  } finally {
    globalThis.AbortController = NativeAbortController;
    delete globalThis.__obsidianDevUtils;
  }
});
