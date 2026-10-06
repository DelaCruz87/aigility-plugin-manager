import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hash = b => crypto.createHash('sha256').update(b).digest('hex');
export function captureFormat(bytes) {
    if (!ArrayBuffer.isView(bytes)) throw Error('Capture must contain an image byte view');
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { mime: 'image/png', extension: '.png' };
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', extension: '.jpg' };
    throw Error('Unknown capture image signature');
}
export function captureArtifact(filePath) {
    if (!filePath) return null;
    let bytes;
    try { bytes = fs.readFileSync(filePath); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    return { path: filePath, sha256: hash(bytes), mime: captureFormat(bytes).mime };
}
const nativeCode = `(()=>{const fs=require('fs'),e=require('electron').remote,w=e.getCurrentWindow(),p=app.plugins.plugins['aigility-plugin-manager'],root=app.vault.adapter.getBasePath(),s=fs.statSync(root),h=x=>require('crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');return JSON.stringify({vault:app.vault.getName(),appId:app.appId,root:fs.realpathSync(root),dev:s.dev,ino:s.ino,window:w.id,wc:w.webContents.id,document:document.URL,crashed:w.webContents.isCrashed(),settingsOpen:app.setting.isOpen,tab:app.setting.activeTab?.id,lastTab:app.setting.lastTabId,leaf:app.workspace.activeLeaf.id,focus:document.activeElement?.tagName,focusedOS:e.BrowserWindow.getFocusedWindow()?.getTitle(),state:h(p.runtime.state),local:h(p.runtime.local),windows:e.BrowserWindow.getAllWindows().map(x=>({id:x.id,wc:x.webContents.id,title:x.getTitle(),url:x.webContents.getURL(),crashed:x.webContents.isCrashed()}))});})()`;
new vm.Script(nativeCode);
const parseCli = code => {
    const raw = execFileSync('obsidian', ['vault=Sandbox', 'eval', 'code=' + code], { encoding: 'utf8', timeout: 10000 }).trim();
    if (!raw.startsWith('=> ')) throw Error('CLI did not return a semantic result: ' + raw);
    return JSON.parse(raw.slice(3));
};
function durable(file, value) {
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, typeof value === 'string' ? value : Buffer.isBuffer(value) || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
}

export function createFlow(cua, nodeRepl) {
    let c, target, aux, cleanup = false, opened = false;
    function gate() {
        if (!c || hash(fs.readFileSync(c.controlPath)) !== c.controlSha || hash(fs.readFileSync(c.leasePath)) !== c.leaseSha || !fs.readFileSync(c.leasePath, 'utf8').includes(c.token) || Date.now() >= Date.parse(cleanup ? c.totalBy : c.actionBy)) throw Error('Control/lease/deadline guard');
        if (hash(fs.readFileSync(fileURLToPath(import.meta.url))) !== c.helperSha || hash(fs.readFileSync(c.innerPath)) !== c.innerSha) throw Error('Prepared helper drift');
        const base = JSON.parse(fs.readFileSync(c.baselinePath));
        for (const [name, expected] of Object.entries(base.files)) if (hash(fs.readFileSync(base.root + '/' + name)) !== expected.sha256) throw Error('Baseline drift: ' + name);
        const n = parseCli(nativeCode);
        if (n.vault !== 'Sandbox' || n.appId !== 'd137282e82167d84' || n.root !== '/Users/eme/Obsidian/Sandbox' || n.dev !== 16777230 || n.ino !== 237131121 || n.window !== 3 || n.wc !== 3 || n.document !== 'app://obsidian.md/index.html' || n.crashed || n.leaf !== '45f0859ed1d9c012' || n.state !== '31e5b0b9ae6a31d4374411883352ae10210c2459682b8dacb8d7fb5e285013c4' || n.local !== '967db62c4213832e1bb5968b8af3c92ec11a2cff9279d4da6860a83f5089835b') throw Error('Native identity/state guard');
        if (![1, 2, 3].every(id => n.windows.some(w => w.id === id && !w.crashed))) throw Error('Foreign window drift');
        const extra = n.windows.filter(w => ![1, 2, 3].includes(w.id));
        if (extra.length > 1 || extra.some(w => w.title !== 'Settings - Sandbox - Obsidian 1.14.4' || w.url !== 'about:blank' || w.crashed)) throw Error('Unexpected auxiliary window');
        if (!['Recent files - Sandbox - Obsidian 1.14.4', ...(extra.length ? ['Settings - Sandbox - Obsidian 1.14.4'] : [])].includes(n.focusedOS)) throw Error('Focus drift');
        if (aux && extra.length && (extra[0].id !== aux.id || extra[0].wc !== aux.wc)) throw Error('Auxiliary identity drift');
        return { ...n, extra };
    }
    async function step(action) { gate(); const result = await action(); gate(); return result; }
    return {
        async open(parameters) {
            c = parameters; cleanup = false; opened = false; aux = undefined;
            const before = gate();
            if (before.settingsOpen || before.extra.length || before.lastTab !== '') throw Error('NO_START Settings baseline');
            target = await step(() => cua.getApp('Obsidian'));
            if (Date.now() >= Date.parse(c.startBy)) throw Error('NO_START expired');
            durable(c.firstActionPath, { job: c.job, token: c.token, firstActionAt: new Date().toISOString() });
            await step(() => target.pressKey('super+comma'));
            const after = gate();
            if (!after.settingsOpen || after.extra.length !== 1) throw Error('Settings did not open');
            aux = after.extra[0]; opened = true;
            await step(() => target.getAXState());
            return aux;
        },
        async manager() {
            if (!opened || !aux) throw Error('No owned auxiliary window');
            const ax = await step(() => target.getAXState({ emit: false, disableDiffing: true }));
            const matches = [...ax.matchAll(/^\s*(\d+) text AIgility Plugin Manager$/gm)];
            if (matches.length !== 1) throw Error('Manager tab is ambiguous or absent');
            await step(() => target.click(Number(matches[0][1])));
            await step(() => target.getAXState());
            if (gate().tab !== 'aigility-plugin-manager') throw Error('Manager tab did not become active');
            const pixels = await step(() => target.getScreenshot({ emit: false }));
            const format = captureFormat(pixels);
            if (typeof c.imagePath !== 'string' || !c.imagePath.endsWith(format.extension)) throw Error('Capture path does not match actual image format');
            const bytes = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
            gate(); durable(c.imagePath, bytes); gate();
            await step(() => nodeRepl.emitImage(bytes));
            const inner = fs.readFileSync(c.innerPath, 'utf8'); new vm.Script(inner);
            const outer = `(async()=>{const e=require('electron').remote,fs=require('fs'),h=b=>require('crypto').createHash('sha256').update(b).digest('hex'),w=e.BrowserWindow.fromId(${aux.id});const g=()=>{if(app.appId!=='d137282e82167d84'||e.getCurrentWindow().id!==3||h(fs.readFileSync(${JSON.stringify(c.leasePath)}))!==${JSON.stringify(c.leaseSha)}||h(fs.readFileSync(${JSON.stringify(c.controlPath)}))!==${JSON.stringify(c.controlSha)}||Date.now()>=Date.parse(${JSON.stringify(c.actionBy)})||!w||e.BrowserWindow.fromId(${aux.id})!==w||w.webContents.id!==${aux.wc}||w.webContents.isCrashed()||w.webContents.getURL()!=='about:blank'||w.getTitle()!=='Settings - Sandbox - Obsidian 1.14.4')throw Error('aux await guard');};g();const value=await w.webContents.executeJavaScript(${JSON.stringify(inner)});g();return value;})()`;
            new vm.Script(outer); gate(); const dom = parseCli(outer); gate();
            if (dom.document !== 'about:blank') throw Error('Incorrect auxiliary document');
            durable(c.domPath, { aux, ...dom }); gate();
            return { aux, capture: captureArtifact(c.imagePath), domPath: c.domPath, rows: dom.rows, toolbars: dom.toolbars };
        },
        async close() {
            cleanup = true;
            if (!opened || !aux || !gate().extra.some(w => w.id === aux.id)) throw Error('No owned Settings to close');
            await step(() => target.pressKey('super+w'));
            await step(() => target.getAXState());
            const n = gate();
            if (n.settingsOpen || n.extra.length) throw Error('Owned Settings did not close');
            const restore = `(()=>{if(app.appId!=='d137282e82167d84'||app.setting.isOpen||app.setting.lastTabId!=='aigility-plugin-manager'||app.workspace.activeLeaf.id!=='45f0859ed1d9c012')throw Error('ephemeral restore guard');app.setting.lastTabId='';return JSON.stringify({restored:true});})()`;
            new vm.Script(restore); gate(); parseCli(restore); const after = gate();
            const capture = captureArtifact(c.imagePath);
            const domPresent = fs.existsSync(c.domPath);
            durable(c.resultPath, { job: c.job, token: c.token, at: new Date().toISOString(), status: capture && domPresent ? 'SETTLED' : 'CAPTURE_FAILED_CLEANUP_SETTLED', pending: false, native: after, capture, domPath: domPresent ? c.domPath : null });
            return after;
        }
    };
}
