import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const execFile = promisify(execFileCallback);

export const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const obsidianStub = path.join(projectRoot, 'tests', 'obsidian-stub.mjs');

export async function bundleModule(entryPoint) {
  const entry = path.isAbsolute(entryPoint)
    ? entryPoint
    : path.resolve(projectRoot, entryPoint);
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    alias: { obsidian: obsidianStub },
  });
  return result.outputFiles[0].text;
}

export async function importModule(entryPoint) {
  const bundled = await bundleModule(entryPoint);
  const tempRoot = await mkdtemp(path.join(projectRoot, 'tests', '.bundle-import-'));
  const bundlePath = path.join(tempRoot, 'bundle.mjs');
  try {
    await writeFile(bundlePath, bundled, 'utf8');
    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function typecheck(source, { fileName = 'contract-fixture.ts' } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aigility-typecheck-'));
  const fixturePath = path.join(tempRoot, fileName);
  const configPath = path.join(tempRoot, 'tsconfig.json');
  try {
    await writeFile(fixturePath, source, 'utf8');
    await writeFile(configPath, JSON.stringify({
      extends: path.join(projectRoot, 'tsconfig.json'),
      files: [fixturePath],
      include: [],
    }), 'utf8');
    try {
      await execFile(path.join(projectRoot, 'node_modules', '.bin', 'tsc'), ['--project', configPath], {
        cwd: projectRoot,
      });
      return [];
    } catch (error) {
      return [{
        code: error.code ?? 1,
        message: [error.stdout, error.stderr].filter(Boolean).join('\n').trim(),
      }];
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
