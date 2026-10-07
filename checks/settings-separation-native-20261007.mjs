// Prepared native body. No host action occurs by importing this module.
// Invoke only under a fresh root grant with exact identity, pins and deadlines.
export function runNative(r) {
    const fs = require('fs'), crypto = require('crypto'), remote = require('electron').remote;
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    const sha = path => fs.existsSync(path) ? hash(fs.readFileSync(path)) : null;
    const J = JSON.stringify, ID = 'aigility-plugin-manager', F = 'aigility-manager-toggle-fixture';
    const host = app, doc = document, pm = app.plugins, win = remote.getCurrentWindow();
    const requestSave = pm.requestSaveConfig, requestRun = requestSave?.run;
    if (typeof requestSave !== 'function' || typeof requestRun !== 'function') throw Error('Native persistence flush capability required');
    const requestSaveHash = hash(requestSave.toString()), requestRunHash = hash(requestRun.toString());
    const target = r.root + '/.obsidian/plugins/' + ID, fixture = r.root + '/.obsidian/plugins/' + F;
    let manager = pm.plugins[ID], transition = false, cleanup = false, q;
    const gate = () => {
        const st = fs.statSync(app.vault.adapter.getBasePath());
        if (app !== host || document !== doc || pm !== app.plugins || app.appId !== r.native.appId || app.vault.getName() !== r.native.vault || app.vault.adapter.getBasePath() !== r.root || win.id !== r.native.window || win.webContents.id !== r.native.wc || win.webContents.isCrashed() || document.URL !== r.native.document || fs.realpathSync(app.vault.adapter.getBasePath()) !== r.native.physicalRoot || st.dev !== r.native.dev || st.ino !== r.native.ino) throw Error('Native identity changed');
        if (pm.requestSaveConfig !== requestSave || requestSave.run !== requestRun || hash(requestSave.toString()) !== requestSaveHash || hash(requestRun.toString()) !== requestRunHash) throw Error('Native persistence hook changed');
        if (Date.now() >= Date.parse(cleanup ? r.totalBy : r.actionBy) || Date.now() >= Date.parse(r.rootHardBy)) throw Error('Native deadline');
        for (const [path, expected] of [[r.controlPath, r.controlSha], [r.leasePath, r.leaseSha], [r.helperPath, r.helperSha], [r.baselinePath, r.baselineSha]]) if (sha(path) !== expected) throw Error('Pinned file changed: ' + path);
        if (!fs.readFileSync(r.leasePath, 'utf8').includes(r.token)) throw Error('Lease token changed');
        if (!transition && (pm.plugins[ID] ?? null) !== manager) throw Error('Manager instance changed outside owned transition');
        if (q && window.__managerSettings016Jobs?.get(r.token) !== q) throw Error('Native job ownership changed');
    };
    gate();
    if (!manager?._loaded || !pm.enabledPlugins.has(ID) || !manager.runtime.local.recoveryReason || manager.runtime.local.operationPending || manager.debug.session?.active || app.setting.isOpen || fs.existsSync(fixture) || pm.manifests[F] || pm.plugins[F] || pm.enabledPlugins.has(F) || window.__managerToggleFixtureLoads !== undefined) throw Error('NO_START: paused loaded Manager / closed Settings / absent own fixture required');
    if (J(manager.runtime.state).includes(F)) throw Error('NO_START: reserved fixture identity already referenced in State');
    const jobs = window.__managerSettings016Jobs ??= new Map();
    if (jobs.has(r.token)) throw Error('Duplicate job; poll the same token');
    const durable = (path, bytes) => { const fd = fs.openSync(path, 'wx'); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
    const syncDir = path => { const fd = fs.openSync(path, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
    const foreign = Object.entries(pm.plugins).filter(([id]) => id !== ID);
    const foreignNative = () => J([...pm.enabledPlugins].filter(id => id !== ID && id !== F).sort());
    const nativeBefore = foreignNative(), nativeOrderBefore = [...pm.enabledPlugins], stateBefore = J(manager.runtime.state), localBefore = localStorage.getItem(manager.runtime.localKey), localKey = manager.runtime.localKey;
    const settings = app.setting, lastTab = settings.lastTabId, settingsDoc = settings.doc, settingsModal = settings.modalEl, leaf = app.workspace.activeLeaf, layout = J(app.workspace.getLayout()), focus = document.activeElement;
    const buffers = () => { const values = []; app.workspace.iterateAllLeaves(l => values.push([l.id, l.view?.getViewType?.(), l.view?.editor?.getValue ? hash(l.view.editor.getValue()) : null])); return J(values); };
    const bufferBefore = buffers(), windows = remote.BrowserWindow.getAllWindows();
    const crashBefore = windows.map(w => w.webContents.isCrashed());
    const cores = Object.entries(app.internalPlugins.plugins).map(([id, item]) => [id, item.enabled, item.instance]);
    const surfaceSnapshot = () => ({ at: new Date().toISOString(), settingsOpen: settings.isOpen, lastTab: settings.lastTabId, settingsDoc: settings.doc?.URL ?? null, modalDoc: settings.modalEl?.ownerDocument?.URL ?? null, activeLeaf: app.workspace.activeLeaf?.id ?? null, layoutHash: hash(J(app.workspace.getLayout())), buffersHash: hash(buffers()), windows: remote.BrowserWindow.getAllWindows().map(w => ({ id: w.id, wc: w.webContents.id, crashed: w.webContents.isCrashed() })) });
    const surfaceBefore = surfaceSnapshot();
    const unchanged = () => {
        gate();
        if (foreignNative() !== nativeBefore || foreign.some(([id, plugin]) => pm.plugins[id] !== plugin) || Object.keys(pm.plugins).filter(id => id !== ID && id !== F).length !== foreign.length || cores.some(([id, on, instance]) => app.internalPlugins.plugins[id].enabled !== on || app.internalPlugins.plugins[id].instance !== instance)) throw Error('Foreign plugin/core changed');
        const failed = [];
        if (app.setting !== settings) failed.push('settings-instance');
        if (settings.isOpen) failed.push('settings-open');
        if (settings.lastTabId !== lastTab) failed.push('settings-last-tab');
        if (settings.doc !== settingsDoc) failed.push('settings-document');
        if (settings.modalEl !== settingsModal) failed.push('settings-modal');
        if (app.workspace.activeLeaf !== leaf) failed.push('active-leaf');
        if (J(app.workspace.getLayout()) !== layout) failed.push('layout');
        if (buffers() !== bufferBefore) failed.push('buffers');
        if (remote.BrowserWindow.getAllWindows().length !== windows.length || windows.some((w,i) => !remote.BrowserWindow.getAllWindows().includes(w) || w.webContents.isCrashed() !== crashBefore[i])) failed.push('windows');
        if (failed.length) {
            if (q) q.firstGuardFailure ??= { phase: q.phase, failed, before: surfaceBefore, current: surfaceSnapshot() };
            throw Error('Native surface changed: ' + failed.join(', '));
        }
    };
    const stateWithoutFixture = () => { const state = JSON.parse(J(manager.runtime.state)); delete state.records['community:' + F]; return J(state); };
    let stepNumber = 0;
    const communityPath = r.root + '/.obsidian/community-plugins.json', effectivePath = target + '/effective-state.json';
    const communityBeforeBytes = fs.readFileSync(communityPath), stateBeforeBytes = fs.readFileSync(target + '/data.json');
    let expectedCommunityPost = sha(communityPath), expectedEffectivePost = sha(effectivePath);
    const step = async (phase, action) => {
        unchanged(); stableFiles(true); q.phase = phase;
        if (sha(communityPath) !== expectedCommunityPost || sha(effectivePath) !== expectedEffectivePost) throw Error('Own output preimage changed before ' + phase);
        if (fs.existsSync(r.backup)) { durable(r.backup + '/step-' + (++stepNumber) + '.json', J({ token: r.token, phase, intentAt: new Date().toISOString(), native: [...pm.enabledPlugins], managerLoaded: Boolean(pm.plugins[ID]?._loaded), fixtureLoaded: Boolean(pm.plugins[F]?._loaded) })); syncDir(r.backup); }
        const result = await action(); unchanged(); stableFiles(true);
        const nativeWrite = phase === 'fixture-native-enable' || phase.startsWith('actual-ui-toggle-') || phase === 'actual-ui-self-disable' || phase === 'native-reenable-manager' || phase === 'restore-own-native-order';
        const effectiveWrite = phase === 'load-candidate' || phase.startsWith('actual-ui-toggle-') || phase === 'native-reenable-manager' || phase === 'cleanup-own-record' || phase === 'refresh-effective-summary';
        if (nativeWrite) {
            // Obsidian's *AndSave schedules requestSaveConfig without awaiting
            // persistence. Complete that exact pending save before readback.
            await requestRun.call(requestSave); unchanged(); stableFiles(true);
            await pm.saveConfig(); unchanged(); stableFiles(true);
            if (J(JSON.parse(fs.readFileSync(communityPath))) !== J([...pm.enabledPlugins])) throw Error('Own native write readback failed');
            expectedCommunityPost = sha(communityPath);
        } else if (sha(communityPath) !== expectedCommunityPost) throw Error('Unexpected native output write during ' + phase);
        if (effectiveWrite) expectedEffectivePost = sha(effectivePath);
        else if (sha(effectivePath) !== expectedEffectivePost) throw Error('Unexpected effective output write during ' + phase);
        durable(r.backup + '/post-' + stepNumber + '.json', J({ phase, ownedCommunityPost: expectedCommunityPost, ownedEffectivePost: expectedEffectivePost })); syncDir(r.backup);
        return result;
    };
    const wait = async predicate => { while (!predicate()) { gate(); await new Promise(resolve => setTimeout(resolve, 10)); } gate(); };
    const baseline = JSON.parse(fs.readFileSync(r.baselinePath));
    const stableFiles = (allowOwnConfig = false) => { for (const [relative, entry] of Object.entries(baseline.files)) { if (relative.startsWith('.obsidian/plugins/' + ID + '/') || (allowOwnConfig && relative === '.obsidian/community-plugins.json')) continue; if (sha(baseline.root + '/' + relative) !== entry.sha256) throw Error('Baseline file changed: ' + relative); } };
    q = { token: r.token, job: r.job, status: 'running', pending: true, phase: 'preflight', startedAt: new Date().toISOString() }; jobs.set(r.token, q);
    q.task = (async () => {
        let fixtureCreated = false, nativeFns, nativeNode, ownStatePost, ownLocalPost;
        const results = [];
        try {
            unchanged(); stableFiles();
            for (const [name, expected] of Object.entries(r.preimages)) if (sha(target + '/' + name) !== expected) throw Error('Manager artifact preimage changed');
            const candidateBuffers = {}, fixtureBuffers = {};
            for (const [name, expected] of Object.entries(r.artifacts)) { const bytes = fs.readFileSync(r.source + '/' + name); if (hash(bytes) !== expected) throw Error('Manager candidate changed'); candidateBuffers[name] = bytes; }
            for (const [name, expected] of Object.entries(r.fixtureArtifacts)) { const bytes = fs.readFileSync(r.fixtureSource + '/' + name); if (hash(bytes) !== expected) throw Error('Fixture candidate changed'); fixtureBuffers[name] = bytes; }
            if (J(JSON.parse(fs.readFileSync(target + '/data.json'))) !== stateBefore) throw Error('Runtime/disk State mismatch');
            if (manager.runtime.state.deferred.some(p => p.enabled && !manager.runtime.state.protected.includes('community:' + p.id) && !manager.runtime.state.protected.includes(p.id) && (pm.enabledPlugins.has(p.id) || pm.plugins[p.id]?._loaded))) throw Error('A foreign deferred transition would be required');
            fs.mkdirSync(r.backup); for (const name of ['main.js', 'manifest.json', 'styles.css', 'data.json', 'effective-state.json']) if (fs.existsSync(target + '/' + name)) durable(r.backup + '/' + name, fs.readFileSync(target + '/' + name));
            durable(r.backup + '/community-plugins.json', communityBeforeBytes);
            durable(r.backup + '/local.json', J({ localKey, localRaw: localBefore, state: stateBefore, filter: manager.managerUI.filterCriteria })); syncDir(r.backup); syncDir(require('path').dirname(r.backup));
            await step('drain', () => manager.runtime.enqueue('native016-drain', async () => {}));
            if (r.mode !== 'functional-current') await step('unload-old', async () => { transition = true; await pm.disablePlugin(ID); manager = null; transition = false; });
            nativeFns = [settings.open, ...settings.settingTabs.filter(t => t.id === 'community-plugins').flatMap(t => [t.display, t.renderTab, t.update])];
            nativeNode = settings.settingTabs.find(t => t.id === 'community-plugins')?.containerEl?.firstChild;
            for (const [name, expected] of Object.entries(r.artifacts)) {
                unchanged(); if (sha(target + '/' + name) !== r.preimages[name]) throw Error('Copy CAS changed');
                if (hash(candidateBuffers[name]) !== expected) throw Error('Pinned candidate buffer changed before copy');
                if (r.mode === 'functional-current') { if (sha(target + '/' + name) !== expected) throw Error('Current functional candidate differs'); continue; }
                const fd = fs.openSync(target + '/' + name, 'w'); try { fs.writeFileSync(fd, candidateBuffers[name]); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
                if (sha(target + '/' + name) !== expected) throw Error('Copied candidate differs');
            }
            if (r.mode !== 'functional-current') {
                await step('manifest', () => pm.loadManifest(app.vault.configDir + '/plugins/' + ID));
                await step('load-candidate', async () => { transition = true; await pm.enablePlugin(ID); manager = pm.plugins[ID]; transition = false; });
            }
            if (!manager?._loaded || manager.manifest.version !== '0.1.6' || manager.managerBuild !== 'aigility-plugin-manager/0.1.6' || J(manager.runtime.state) !== stateBefore || localStorage.getItem(localKey) !== localBefore) throw Error('Loaded candidate or State/Local mismatch');
            fs.mkdirSync(fixture); fixtureCreated = true;
            for (const [name, expected] of Object.entries(r.fixtureArtifacts)) { if (hash(fixtureBuffers[name]) !== expected) throw Error('Pinned fixture buffer changed'); durable(fixture + '/' + name, fixtureBuffers[name]); } syncDir(fixture); syncDir(require('path').dirname(fixture));
            await step('fixture-manifest', () => pm.loadManifest(app.vault.configDir + '/plugins/' + F));
            await step('fixture-native-enable', () => pm.enablePluginAndSave(F));
            const filter = manager.managerUI.filterCriteria;
            manager.managerUI.filterCriteria = { search: F, kind: 'all', tag: 'all', group: 'all' };
            manager.managerUI.openManagerModal();
            const checkbox = () => manager.managerUI.managerModal?.contentEl.querySelector('input[type="checkbox"]');
            for (const enabled of [false, true, false]) {
                await step('actual-ui-toggle-' + enabled, async () => {
                    const input = checkbox(); if (!input || input.checked === enabled || input.disabled) throw Error('Own fixture toggle is absent or inconsistent');
                    input.click(); await manager.runtime.enqueue('native016-ui-drain', async () => {});
                    await wait(() => checkbox()?.disabled === false);
                    const item = manager.runtime.list().find(p => p.ref.id === F);
                    if (!item || item.loaded !== enabled || item.nativeAutostart !== enabled || item.desired !== enabled || stateWithoutFixture() !== stateBefore || localStorage.getItem(localKey) !== localBefore) throw Error('Actual UI toggle readback/preservation failed');
                    results.push({ action: 'toggle', loaded: item.loaded, native: item.nativeAutostart, desired: item.desired });
                });
            }
            const inspectSurface = async (modal, name) => {
                await wait(() => modal.modalEl.getBoundingClientRect().width > 0);
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); unchanged();
                const rect = modal.modalEl.getBoundingClientRect(), clip = { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
                return { surface: name, rect: clip, pixelsVerified: false };
            };
            manager.managerUI.filterCriteria = { search: '', kind: 'all', tag: 'all', group: 'all' }; manager.managerUI.refreshManagerView();
            q.managerSurface = await inspectSurface(manager.managerUI.managerModal, 'manager'); manager.managerUI.managerModal.close();
            manager.managerUI.openOptionsModal(); const options = [...manager.managerUI.ownedModals][0];
            if (!options.contentEl.querySelector('.aigility-manager-settings') || options.contentEl.querySelector('.aigility-plugin-row')) throw Error('Own Settings surface wrong');
            q.settingsSurface = await inspectSurface(options, 'settings'); options.close();
            manager.managerUI.filterCriteria = { search: ID, kind: 'all', tag: 'all', group: 'all' }; manager.managerUI.openManagerModal();
            const beforeSelf = { data: sha(target + '/data.json'), effective: sha(target + '/effective-state.json'), local: localStorage.getItem(localKey) }, oldRuntime = manager.runtime;
            await step('actual-ui-self-disable', async () => { transition = true; const input = checkbox(); if (!input?.checked) throw Error('Self toggle absent'); input.click(); await wait(() => !pm.plugins[ID]?._loaded && !pm.enabledPlugins.has(ID)); manager = null; transition = false; });
            if (!oldRuntime.disposed || sha(target + '/data.json') !== beforeSelf.data || sha(target + '/effective-state.json') !== beforeSelf.effective || localStorage.getItem(localKey) !== beforeSelf.local || doc.querySelector('.aigility-manager-root')) throw Error('Self unload lifecycle/readback failed');
            results.push({ action: 'self-disable', loaded: false, native: false, writesAfterUnload: false });
            await step('native-reenable-manager', async () => { transition = true; await pm.enablePluginAndSave(ID); manager = pm.plugins[ID]; transition = false; });
            if (!manager?._loaded || manager.runtime === oldRuntime || manager.manifest.version !== '0.1.6') throw Error('Fresh native Manager re-enable failed');
            manager.managerUI.filterCriteria = filter;
            ownStatePost = J(manager.runtime.state); ownLocalPost = localStorage.getItem(localKey);
            cleanup = true;
            await step('cleanup-own-record', () => manager.runtime.enqueue('native016-cleanup-record', async tx => {
                await tx.refresh(); if (J(manager.runtime.state) !== ownStatePost || stateWithoutFixture() !== stateBefore || localStorage.getItem(localKey) !== ownLocalPost) throw Error('Cleanup State/Local CAS changed');
                delete manager.runtime.state.records['community:' + F]; await tx.save(); await tx.writeEffectiveState();
            }));
            if (pm.enabledPlugins.has(F) || pm.plugins[F]?._loaded) throw Error('Fixture has unexpected enabled postimage');
            for (const [name, expected] of Object.entries(r.fixtureArtifacts)) { gate(); if (sha(fixture + '/' + name) !== expected) throw Error('Fixture cleanup file CAS changed'); fs.unlinkSync(fixture + '/' + name); }
            fs.rmdirSync(fixture); fixtureCreated = false; delete pm.manifests[F];
            if (window.__managerToggleFixtureLoads !== 2) throw Error('Fixture counter postimage differs');
            delete window.__managerToggleFixtureLoads;
            if (J([...pm.enabledPlugins]) !== J(nativeOrderBefore)) {
                await step('restore-own-native-order', async () => {
                    if (J([...pm.enabledPlugins].filter(id => id !== ID)) !== J(nativeOrderBefore.filter(id => id !== ID))) throw Error('Native order CAS changed outside Manager');
                    // Synchronous ordering-only restoration; no foreign plugin
                    // activation/deactivation API is called.
                    pm.enabledPlugins.clear(); for (const id of nativeOrderBefore) pm.enabledPlugins.add(id);
                    await pm.saveConfig();
                });
            }
            if (J(JSON.parse(fs.readFileSync(communityPath))) !== J(nativeOrderBefore)) throw Error('Native config cleanup postimage differs');
            gate();
            if (sha(communityPath) !== expectedCommunityPost) throw Error('Native config cleanup CAS changed');
            fs.writeFileSync(communityPath, communityBeforeBytes);
            expectedCommunityPost = hash(communityBeforeBytes);
            const communityFd = fs.openSync(communityPath, 'r'); try { fs.fsyncSync(communityFd); } finally { fs.closeSync(communityFd); }
            // Keep the current generated report after the owned fixture has
            // disappeared. Never overwrite a concurrent report with a backup.
            await step('refresh-effective-summary', () => manager.runtime.writeEffectiveState());
            if (fs.readFileSync(effectivePath, 'utf8').includes(F)) throw Error('Final generated report still references fixture');
            const currentFns = [settings.open, ...settings.settingTabs.filter(t => t.id === 'community-plugins').flatMap(t => [t.display, t.renderTab, t.update])];
            if (currentFns.some((fn, i) => fn !== nativeFns[i]) || settings.settingTabs.find(t => t.id === 'community-plugins')?.containerEl?.firstChild !== nativeNode || J(manager.runtime.state) !== stateBefore || localStorage.getItem(localKey) !== localBefore || sha(target + '/data.json') !== hash(stateBeforeBytes) || pm.manifests[F] || fs.existsSync(fixture)) throw Error('Final native Settings/State/Local/fixture preservation failed');
            if (document.activeElement !== focus) focus?.focus?.(); unchanged(); stableFiles();
            if (sha(effectivePath) !== expectedEffectivePost) throw Error('Final own report postimage changed');
            q.result = { version: manager.manifest.version, build: manager.managerBuild, loaded: manager._loaded, native: pm.enabledPlugins.has(ID), results, nativeSettingsPreserved: true, foreignPluginsPreserved: true, stateLocalPreserved: true, buffersPreserved: true, fixtureRemoved: true, generatedEffectiveSha: expectedEffectivePost, surfaces: [q.managerSurface, q.settingsSurface], pixelsVerified: false };
        } catch (error) { q.error = String(error); }
        finally {
            const receipt = { job: r.job, token: r.token, status: q.error ? 'FAILED_PRESERVED' : 'SETTLED', pending: Boolean(q.error), phase: q.phase, fixtureCreated, startedAt: q.startedAt, completedAt: new Date().toISOString(), result: q.result ?? null, error: q.error ?? null, firstGuardFailure: q.firstGuardFailure ?? null };
            try { durable(r.resultPath, J(receipt, null, 2)); syncDir(require('path').dirname(r.resultPath)); q.receipt = receipt; } catch (error) { q.receipt = { ...receipt, pending: true, receiptError: String(error) }; }
            q.status = q.receipt.status; q.pending = q.receipt.pending;
        }
    })();
    return J({ job: r.job, token: r.token, status: q.status, pending: q.pending });
}
