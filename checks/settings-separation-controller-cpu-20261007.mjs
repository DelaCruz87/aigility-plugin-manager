import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createController } from './settings-separation-controller-20261007.mjs';
import { runNative } from './settings-separation-native-20261007.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'manager016-controller-cpu-'));
try {
  const file = name => path.join(temp, name);
  const pin = (name, bytes) => { fs.writeFileSync(file(name), bytes); return hash(bytes); };
  const token = 'cpu-only-owned-token', nowStart = 1791367200000;
  let now = nowStart, calls = 0;
  const config = {
    temp, job: 'cpu-wiring-manager016', vault: 'Sandbox', root: temp, source: temp,
    native: { appId: 'cpu-app', window: 3, wc: 3, vault: 'Sandbox', document: 'app://obsidian.md/index.html' },
    fixtureSource: file('fixture'), fixtureArtifacts: { 'main.js': 'cpu-fixture-hash' },
    leasePath: file('lease.json'), helperPath: file('helper.mjs'), baselinePath: file('baseline.json'),
    controllerPath: file('controller.mjs'), loadedPath: file('loaded.json'),
    preimages: { 'main.js': 'old' }, artifacts: { 'main.js': 'new' }, emittedSource: runNative.toString(),
  };
  const leaseSha = pin('lease.json', JSON.stringify({ token }));
  config.helperSha = pin('helper.mjs', config.emittedSource);
  config.baselineSha = pin('baseline.json', '{}');
  config.controllerSha = pin('controller.mjs', 'frozen controller module');
  config.loadedSha = pin('loaded.json', '{}');
  const controller = createController(config, {
    fs, crypto, vm, now: () => now,
    execFileSync(binary, args) {
      calls++;
      assert.equal(binary, 'obsidian'); assert.equal(args[0], 'vault=Sandbox');
      assert.ok(fs.existsSync(file('control.json')), 'ACK/control durable before dispatch');
      assert.ok(fs.existsSync(file('first-action.json')), 'first-action durable before native call');
      new vm.Script(args[2].slice('code='.length));
      const control = JSON.parse(fs.readFileSync(file('control.json')));
      assert.equal(control.native.appId, config.native.appId);
      assert.deepEqual(control.fixtureArtifacts, config.fixtureArtifacts);
      return '=> ' + JSON.stringify({ token, status: calls === 1 ? 'running' : 'SETTLED', pending: calls === 1 });
    },
  });
  const result = controller.begin({ token, leaseSha, rootHardBy: new Date(nowStart + 240000).toISOString() });
  assert.equal(result.returned.token, token);
  assert.equal(result.parameters.native.appId, config.native.appId);
  assert.equal(controller.parameters(), result.parameters, 'Begin/Guard/Poll share one closure');
  assert.equal(controller.poll().status, 'SETTLED');
  assert.throws(() => controller.begin({ token, leaseSha, rootHardBy: result.parameters.rootHardBy }), /already/);
  now = Date.parse(result.parameters.actionBy);
  assert.equal(controller.poll().status, 'SETTLED', 'read-only poll stays available through cleanup budget');
  now = Date.parse(result.parameters.totalBy);
  assert.throws(() => controller.poll(), /deadline/);
  assert.equal(calls, 3, 'expired/duplicate actions do not dispatch');
  now = nowStart;
  fs.writeFileSync(config.leasePath, 'foreign lease');
  assert.throws(() => controller.poll(), /pin drift/);
  assert.equal(calls, 3);
  const source = '(' + runNative.toString() + ')({root:' + JSON.stringify(temp) + ',native:{appId:"wrong"}})';
  const app = { appId: 'cpu-app', plugins: { plugins: {} }, vault: { adapter: { getBasePath: () => temp } } };
  let nativeWrites = 0;
  const fakeFs = { ...fs, writeFileSync() { nativeWrites++; }, mkdirSync() { nativeWrites++; } };
  assert.throws(() => vm.runInNewContext(source, { app, document: {}, require: name => name === 'fs' ? fakeFs : name === 'crypto' ? crypto : { remote: { getCurrentWindow: () => ({}) } } }), /Native identity/);
  assert.equal(nativeWrites, 0, 'wrong identity exits before native mutation or backup');
  console.log('PASS: actual emitted body/outer compile, shared Begin/Guard/Poll, durable ACK/first-action, fresh native/fixture forwarding, duplicate/deadline/pin/identity refusal; zero native IO');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
