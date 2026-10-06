import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import os from 'node:os';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Offline contract check. Existing real image bytes are encoding samples only;
// neither the current Recent files JPEG nor the historical PNG accepts UI.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperUrl = pathToFileURL(path.join(root, 'checks/settings-aux-cua-20261006.mjs')).href;
// Only this driver's CLI transport is replaced. The actual prepared flow and
// filesystem receipts execute against an owned temporary directory below.
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'node:child_process' && context.parentURL?.startsWith(helperUrl)) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export const execFileSync=(...args)=>globalThis.__captureContractNative(...args);') };
    return nextResolve(specifier, context);
} });
const helper = await import(pathToFileURL(path.join(root, 'checks/settings-aux-cua-20261006.mjs')).href);
assert.equal(typeof helper.captureFormat, 'function', 'Driver must export captureFormat for independent contract verification');
assert.equal(typeof helper.captureArtifact, 'function', 'Driver must export captureArtifact for absent-capture verification');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'evidence/settings-capture-format-20261006.json')));
const jpeg = fs.readFileSync(meta.rawPath);
assert.equal(sha(jpeg), meta.rawSha, 'Observed JPEG sample changed');
assert.deepEqual(helper.captureFormat(jpeg), { mime: 'image/jpeg', extension: '.jpg' }, 'Actual CUA JPEG must retain its true encoding');
const foreignView = vm.runInNewContext('new Uint8Array(input)', { input: Array.from(jpeg.subarray(0, 32)) });
assert.equal(foreignView instanceof Uint8Array, false, 'Cross-realm fixture lost its purpose');
assert.deepEqual(helper.captureFormat(foreignView), { mime: 'image/jpeg', extension: '.jpg' }, 'Cross-realm byte views must not be rejected by instanceof');
const historicalPng = fs.readFileSync(path.join(root, 'evidence/native-ui-v013/PM-SANDBOX-SIDEBAR-FOCAL-CAPTURE-R4-ROOT-20261002-0043/community.png'));
assert.deepEqual(helper.captureFormat(historicalPng), { mime: 'image/png', extension: '.png' }, 'Existing PNG byte sample must retain its encoding');
assert.throws(() => helper.captureFormat(Buffer.from('not image bytes')), /format|capture|image|signature/i, 'Unknown data must fail before image publication');
const absent = path.join(root, 'evidence/settings-aux-inspection-20261006-R2-panel.png');
assert.equal(fs.existsSync(absent), false, 'Known FAIL sample unexpectedly exists; do not overwrite it');
assert.equal(helper.captureArtifact(absent), null, 'Cleanup receipt must handle the actual missing R2 image without ENOENT');
assert.deepEqual(helper.captureArtifact(meta.rawPath), { path: meta.rawPath, sha256: meta.rawSha, mime: 'image/jpeg' }, 'Existing capture metadata must describe actual bytes');
const source = fs.readFileSync(path.join(root, 'checks/settings-aux-cua-20261006.mjs'), 'utf8');
for (const captureFails of [true, false]) {
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-capture-contract-'));
try {
    const native = { ...JSON.parse(fs.readFileSync(path.join(root, 'evidence/settings-aux-inspection-20261006-R2-result.json'))).native, vault: 'Sandbox', appId: 'd137282e82167d84', root: '/Users/eme/Obsidian/Sandbox', dev: 16777230, ino: 237131121, window: 3, wc: 3, document: 'app://obsidian.md/index.html', crashed: false };
    const initialWindows = structuredClone(native.windows);
    const keys = [];
    globalThis.__captureContractNative = (file, args) => {
        assert.equal(file, 'obsidian'); assert.equal(args[0], 'vault=Sandbox'); assert.equal(args[1], 'eval');
        assert.ok(args[2].startsWith('code='));
        if (args[2].includes("app.setting.lastTabId=''")) { native.lastTab = ''; return '=> ' + JSON.stringify({ restored: true }); }
        if (args[2].includes('executeJavaScript')) return '=> ' + JSON.stringify({ document: 'about:blank', rows: [], toolbars: [] });
        return '=> ' + JSON.stringify(native);
    };
    const target = {
        async pressKey(key) {
            keys.push(key);
            if (key === 'super+comma') { native.settingsOpen = true; native.windows.push({ id: 5, wc: 5, title: 'Settings - Sandbox - Obsidian 1.14.4', url: 'about:blank', crashed: false }); }
            else if (key === 'super+w') { native.settingsOpen = false; native.windows = structuredClone(initialWindows); }
            else assert.fail('Unexpected simulated key');
        },
        async click(index) { assert.equal(index, 9); native.tab = 'aigility-plugin-manager'; native.lastTab = 'aigility-plugin-manager'; },
        async getAXState() { return 'Window: Settings - Sandbox - Obsidian 1.14.4\n9 text AIgility Plugin Manager'; },
        async getScreenshot() {
            if (captureFails) throw Error('Known capture failure before any image artifact');
            return vm.runInNewContext('new Uint8Array(input)', { input: Array.from(jpeg) });
        }
    };
    const params = { job: 'offline-missing-capture', token: 'fixture-token', startBy: new Date(Date.now() + 15000).toISOString(), actionBy: new Date(Date.now() + 60000).toISOString(), totalBy: new Date(Date.now() + 90000).toISOString(), helperSha: sha(source), innerPath: path.join(root, 'checks/settings-aux-read-20261006.js') };
    params.innerSha = sha(fs.readFileSync(params.innerPath));
    for (const [key, name] of Object.entries({ controlPath: 'control.json', leasePath: 'lease.json', baselinePath: 'baseline.json', firstActionPath: 'first.json', imagePath: 'missing.jpg', pngPath: 'legacy-missing.png', domPath: 'missing-dom.json', resultPath: 'result.json' })) params[key] = path.join(temp, name);
    fs.writeFileSync(params.controlPath, JSON.stringify(params)); params.controlSha = sha(fs.readFileSync(params.controlPath));
    fs.writeFileSync(params.leasePath, JSON.stringify({ token: params.token })); params.leaseSha = sha(fs.readFileSync(params.leasePath));
    fs.writeFileSync(params.baselinePath, JSON.stringify({ root: temp, files: {} }));
    let emitted = 0;
    const flow = helper.createFlow({ async getApp() { return target; } }, { async emitImage(bytes) {
        assert.equal(captureFails, false, 'No image may be emitted after capture failure');
        assert.equal(sha(bytes), meta.rawSha, 'Emitted image must preserve original bytes'); emitted++;
    } });
    await flow.open(params);
    if (captureFails) await assert.rejects(() => flow.manager(), /Known capture failure/);
    else {
        const inspected = await flow.manager();
        assert.deepEqual(inspected.capture, { path: params.imagePath, sha256: meta.rawSha, mime: 'image/jpeg' });
        assert.equal(sha(fs.readFileSync(params.imagePath)), meta.rawSha, 'Saved JPEG must preserve exact original bytes');
    }
    await flow.close();
    assert.deepEqual(keys, ['super+comma', 'super+w'], 'Offline cleanup must close exactly the owned simulated window');
    assert.equal(native.settingsOpen, false); assert.equal(native.lastTab, '');
    const receipt = JSON.parse(fs.readFileSync(params.resultPath));
    assert.equal(receipt.pending, false);
    if (captureFails) {
        assert.equal(receipt.capture, null, 'Cleanup receipt must not invent an absent capture');
        assert.equal(receipt.domPath, null);
        assert.ok(/fail/i.test(receipt.status), 'Missing image cleanup must retain an honest failed outcome');
    } else {
        assert.equal(receipt.status, 'SETTLED');
        assert.deepEqual(receipt.capture, { path: params.imagePath, sha256: meta.rawSha, mime: 'image/jpeg' });
        assert.equal(receipt.domPath, params.domPath);
    }
    assert.equal(emitted, captureFails ? 0 : 1);
} finally { delete globalThis.__captureContractNative; fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[2]) {
    const report = JSON.parse(fs.readFileSync(process.argv[2]));
    assert.equal(report.helperSha, sha(source), 'Fix report names different driver bytes');
    assert.equal(report.uiActionsExecuted, 0, 'Worker must not operate GUI during this fix');
    assert.equal(report.sourceProductChanged, false, 'Worker must not change product source');
    assert.ok(typeof report.explanation === 'string' && report.explanation.length > 60, 'Fix report lacks evidence and limits');
}
console.log(JSON.stringify({ actualJpeg: true, historicalPngEncodingOnly: true, crossRealmView: true, unknownBytesRejected: true, missingR2Image: true, optionalExistingMetadata: true, actualFlowFailureCleanup: true, actualFlowJpegSaveAndCleanup: true, uiActionsExecuted: 0, nativeOrPixelAcceptance: false, helperSha: sha(source) }));
