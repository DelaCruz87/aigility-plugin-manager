import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
if (process.argv[2] === '--native') {
    const dom = JSON.parse(fs.readFileSync(process.argv[3]));
    const failures = [];
    if (dom.document !== 'about:blank' || dom.rootCount !== 1 || !dom.rows?.length) failures.push('Manager auxiliary document/root/rows absent');
    for (const row of dom.rows || []) if (row.switchClass.split(/\s+/).includes('is-enabled') !== row.checked) failures.push(row.name + ': visible switch class disagrees with checked');
    if (dom.toolbars?.length !== 1) failures.push('Expected exactly one Manager toolbar');
    for (const toolbar of dom.toolbars || []) {
        const g = toolbar.geometry;
        if (g.display === 'none' || g.visibility !== 'visible' || Number(g.opacity) <= 0 || g.width <= 0 || g.height <= 0 || g.y < 0 || g.x < 0 || g.y + g.height > dom.viewport.height || g.x + g.width > dom.viewport.width) failures.push('Toolbar outside visible viewport: ' + JSON.stringify(g));
        if (dom.rows?.length && g.y + g.height > dom.rows[0].row.y) failures.push('Toolbar no longer precedes the list in normal flow');
    }
    assert.deepEqual(failures, [], 'Actual native Settings render does not satisfy FIX-17/FIX-18');
    console.log(JSON.stringify({ nativeDomRender: true, domSha: hash(fs.readFileSync(process.argv[3])), note: 'DOM only; requires matching original JPEG and independent runtime/config preservation receipt.' }));
} else {
    const uiPath = path.join(root, 'src/integrated/ui.ts');
    const helper = fs.readFileSync(path.join(root, 'tests/ui.test.mjs'), 'utf8');
    assert.equal(hash(helper), '10990cfaa9ebe54d23ca7d3eec2622349e858e55628983653016f0d3ed5e5ef3', 'Read-only DOM helper drift; reconcile before accepting');
    const cut = helper.indexOf('// 3.5 Fake Serial Queue Runtime'); assert.ok(cut > 0);
    const prelude = helper.slice(0, cut).replace("await import('../src/integrated/ui.ts')", `await import(${JSON.stringify(pathToFileURL(uiPath).href)})`);
    const { MockElement, MockApp, ManagerUI } = await import('data:text/javascript,' + encodeURIComponent(prelude + '\nexport { MockElement, MockApp, ManagerUI };'));
    const cases = [];
    for (const initial of [{loaded:true,nativeAutostart:false,desired:false},{loaded:false,nativeAutostart:true,desired:true},{loaded:true,nativeAutostart:true,desired:true}]) {
        const item = {ref:{kind:'community',id:'fix-observed'},name:'Fix observed',installed:true,archived:false,tags:[],...initial};
        const calls = [], notices = [];
        let reject = false;
        const runtime = {state:{tags:[],groups:[]},local:{recoveryReason:'preserved pause'},list:()=>[item],async setEnabled(ref,enabled) {calls.push({ref,enabled});if(reject)throw Error('Known queue rejection');item.loaded=enabled;}};
        const renderer = new ManagerUI({app:new MockApp()},runtime,{},{});
        renderer.showNotice = msg => notices.push(msg);
        const container = new MockElement('div'); renderer.installedContainerEl = container; renderer.display(container);
        const inspect = () => {
            const row=container.querySelector('.aigility-plugin-row');assert.ok(row);
            const wrapper=row.querySelector('.checkbox-container');assert.ok(wrapper);
            const checkbox=wrapper.querySelector('input');assert.ok(checkbox);
            assert.equal(checkbox.checked,item.loaded,'Switch must keep existing loaded semantics');
            assert.equal(wrapper.classList.contains('is-enabled'),checkbox.checked,'Native switch appearance must agree with checked true AND false');
            const marks=row.querySelectorAll('.aigility-icon-indicator');
            assert.deepEqual(marks.map(x=>x.classList.contains('is-active')),[initial.desired,initial.nativeAutostart,item.loaded],'Independent desired/native/loaded indicators changed');
            return {wrapper,checkbox};
        };
        inspect();
        const managerRoot=container.querySelector('.aigility-manager-root');
        const toolbar=managerRoot.children.find(el=>el.children.some(child=>child.type==='search'));
        assert.ok(toolbar,'Daily toolbar missing');
        assert.ok(toolbar.classList.contains('aigility-manager-toolbar'),'Toolbar must have its own Manager namespace');
        assert.equal(toolbar.classList.contains('aigility-toolbar'),false,'Shared Tables absolute-position selector still matches Manager toolbar');
        assert.equal(managerRoot.children.indexOf(toolbar),1,'Preserve banner-toolbar-list order');
        const localBefore=JSON.stringify(runtime.local),stateBefore=JSON.stringify(runtime.state);
        reject=true;let control=inspect();control.checkbox.checked=!initial.loaded;await control.checkbox.onchange();
        inspect();assert.match(notices.at(-1),/Known queue rejection/,'Rejected operation must stay visible');
        reject=false;control=inspect();control.checkbox.checked=!initial.loaded;await control.checkbox.onchange();
        inspect();assert.equal(item.loaded,!initial.loaded,'Successful setEnabled must refresh the rendered state');
        assert.deepEqual(calls.map(x=>x.enabled),[!initial.loaded,!initial.loaded]);assert.ok(calls.every(x=>x.ref===item.ref));
        assert.equal(JSON.stringify(runtime.local),localBefore,'Recovery pause changed');assert.equal(JSON.stringify(runtime.state),stateBefore,'Profile/filter fixture changed');
        cases.push({...initial,failureRollback:true,successRefresh:true});
    }
    const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
    const ownRules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].split(',').some(s=>s.trim().endsWith('.aigility-manager-toolbar')));
    assert.ok(ownRules.length,'Manager namespace lacks its CSS layout');
    assert.ok(ownRules.some(m=>/display\s*:\s*flex/.test(m[2])),'Toolbar lost flex layout');
    assert.ok(ownRules.every(m=>!(/position\s*:\s*absolute|top\s*:\s*100%/.test(m[2]))),'Manager toolbar is not in normal flow');
    const outcome={uiSha:hash(fs.readFileSync(uiPath)),stylesSha:hash(css),cases,toolbarNamespaceIsolation:true,nativeOrPixelAcceptance:false};
    if(process.argv[2]) {
        const report=JSON.parse(fs.readFileSync(process.argv[2]));
        assert.equal(report.uiSha,outcome.uiSha);assert.equal(report.stylesSha,outcome.stylesSha);
        assert.equal(report.uiActionsExecuted,0);assert.equal(report.nativeOrPixelAcceptance,false);
        assert.ok(typeof report.explanation==='string'&&report.explanation.length>60);
    }
    console.log(JSON.stringify(outcome));
}
