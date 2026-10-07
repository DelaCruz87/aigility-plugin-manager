// A single Begin/Poll controller lifetime. Execute only after ROOT grants this
// owner the exact frozen job; all control/receipt files remain outside the vault.
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createController } from './settings-separation-controller-20261007.mjs';
import { runNative } from './settings-separation-native-20261007.mjs';

export async function dispatch(temp) {
  const owner = '01a10c7c-6e4a-7ad0-8e52-5e0c9bb51484';
  const read = file => fs.readFileSync(file);
  const sha = file => crypto.createHash('sha256').update(read(file)).digest('hex');
  const json = file => JSON.parse(read(file));
  const save = (file, value) => {
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  };
  const loadedPath = path.join(temp, 'loaded.json'), loaded = json(loadedPath);
  const lease = json(loaded.leasePath), leaseSha = sha(loaded.leasePath);
  if (lease.status !== 'GRANTED' || (lease.owner !== owner && lease.executor !== owner) || lease.job !== loaded.job || lease.loadedSHA !== sha(loadedPath) || Date.now() >= Date.parse(lease.ackBy)) throw Error('No exact ROOT grant for this owner/job/snapshot');
  for (const [file, expected] of [[loaded.helperPath, loaded.helperSha], [loaded.controllerPath, loaded.controllerSha], [loaded.dispatchPath, loaded.dispatchSha], [loaded.baselinePath, loaded.baselineSha], [loaded.compileProofPath, loaded.compileProofSha]]) if (sha(file) !== expected) throw Error('Frozen dispatch pin changed: ' + file);
  if (loaded.vault !== 'Sandbox' || loaded.root !== '/Users/eme/Obsidian/Sandbox') throw Error('Dispatch Sandbox scope mismatch');
  const proof = json(loaded.compileProofPath);
  if (!proof.innerCompiled || !proof.outerCompiled || proof.nativeIO !== false) throw Error('Missing emitted compilation proof');
  const emittedSource = runNative.toString(); new vm.Script('(' + emittedSource + ')({})');
  if (crypto.createHash('sha256').update(emittedSource).digest('hex') !== proof.innerSha) throw Error('Emitted helper differs from reviewed compilation');
  const controller = createController({ ...loaded, temp, loadedPath, loadedSha: sha(loadedPath), emittedSource }, { fs, crypto, vm, execFileSync });
  let receipt = null, error = null;
  try {
    const begin = controller.begin({ token: lease.token, leaseSha, rootHardBy: lease.absoluteHardDeadline });
    save(path.join(temp, 'begin-return.json'), begin.returned);
    for (;;) {
      const current = controller.poll();
      if (current.status === 'UNKNOWN') throw Error('UNKNOWN preserved; no new job or automatic retry');
      if (!current.pending) { receipt = current; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  } catch (caught) {
    error = String(caught);
    save(path.join(temp, 'dispatch-error.json'), { error, acknowledged: Boolean(controller.parameters()), firstAction: fs.existsSync(path.join(temp, 'first-action.json')), noRetry: true, preserve: true });
  }
  const report = { token: lease.token, job: loaded.job, receiptStatus: receipt?.status ?? 'UNKNOWN_PRESERVED', pending: receipt?.pending ?? true, error, at: new Date().toISOString(), receiptPath: path.join(temp, 'result.json'), requiresRootClosure: true };
  save(path.join(temp, 'dispatch-return.json'), report);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error('Frozen outside-vault package directory required');
  console.log(JSON.stringify(await dispatch(process.argv[2])));
}
