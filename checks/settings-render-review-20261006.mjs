import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Reuse the repository's existing DOM and Obsidian stubs. This characterizes
// actual source rendering, not browser CSS, auxiliary windows, or native state.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const uiPath = path.join(root, 'src/integrated/ui.ts');
const ui = fs.readFileSync(uiPath, 'utf8');
assert.equal(sha(ui), 'fa81633e8a70a7f9c3411faa29f7106403ec515506e6e6267c7a9f0e83db287f', 'Frozen UI source changed; refresh review contract');
const helper = fs.readFileSync(path.join(root, 'tests/ui.test.mjs'), 'utf8');
assert.equal(sha(helper), '10990cfaa9ebe54d23ca7d3eec2622349e858e55628983653016f0d3ed5e5ef3', 'Frozen DOM helper changed; refresh review contract');
assert.equal(sha(fs.readFileSync(path.join(root, 'styles.css'))), '9a21d84a6c179986d64b8c0c97406ee4332ce6a605ab87766c7ed1dd6ac8e10e', 'Frozen styles changed; refresh review contract');
const cut = helper.indexOf('// 3.5 Fake Serial Queue Runtime');
assert.ok(cut > 0, 'Existing DOM stub boundary not found');
const prelude = helper.slice(0, cut).replace("await import('../src/integrated/ui.ts')", `await import(${JSON.stringify(pathToFileURL(uiPath).href)})`);
const { MockElement, MockApp, ManagerUI } = await import('data:text/javascript,' + encodeURIComponent(prelude + '\nexport { MockElement, MockApp, ManagerUI };'));
const inputCases = [
    { loaded: true, nativeAutostart: false, desired: false },
    { loaded: false, nativeAutostart: true, desired: true },
    { loaded: true, nativeAutostart: true, desired: true }
];
const cases = inputCases.map((input, index) => {
    const plugin = { ref: { kind: 'community', id: `review-${index}` }, name: `Review ${index}`, installed: true, archived: false, tags: [], ...input };
    const runtime = { state: { tags: [], groups: [] }, local: {}, list: () => [plugin] };
    const renderer = new ManagerUI({ app: new MockApp() }, runtime, {}, {});
    const container = new MockElement('div');
    renderer.display(container);
    const row = container.querySelector('.aigility-plugin-row');
    assert.ok(row, 'Actual renderer did not produce a plugin row');
    const wrapper = row.querySelector('.checkbox-container');
    const checkbox = wrapper.querySelector('input');
    const indicators = row.querySelectorAll('.aigility-icon-indicator');
    const observed = { ...input, checked: checkbox.checked, wrapperEnabled: wrapper.classList.contains('is-enabled'), loadedIndicator: indicators[2].classList.contains('is-active'), nativeIndicator: indicators[1].classList.contains('is-active'), desiredIndicator: indicators[0].classList.contains('is-active'), toolbarCount: container.querySelectorAll('.aigility-toolbar').length };
    assert.equal(observed.checked, input.loaded, 'Checkbox state conflated loaded and native/desired');
    assert.equal(observed.loadedIndicator, input.loaded, 'Loaded indicator disagrees with input');
    assert.equal(observed.nativeIndicator, input.nativeAutostart, 'Native indicator conflated with loaded');
    assert.equal(observed.desiredIndicator, input.desired, 'Desired indicator conflated with loaded');
    assert.equal(observed.toolbarCount, 1, 'Source display does not mount exactly one toolbar');
    return observed;
});
const witness = { uiSha: sha(ui), stylesSha: sha(fs.readFileSync(path.join(root, 'styles.css'))), helperSha: sha(helper), cases, nativeOrPixelAcceptance: false };
if (process.argv[2] !== '--witness') {
    assert.ok(process.argv[2], 'Supply worker report.json or --witness');
    const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    assert.equal(report.uiSha, witness.uiSha, 'Report reviewed different source');
    assert.equal(report.stylesSha, witness.stylesSha, 'Report reviewed different CSS');
    assert.equal(report.helperSha, witness.helperSha, 'Report used different DOM helper');
    assert.deepEqual(report.cases, witness.cases, 'Report contradicts independently executed source rendering');
    assert.equal(report.nativeOrPixelAcceptance, false, 'Offline source rendering is not native/pixel acceptance');
    assert.ok(Array.isArray(report.findings) && report.findings.length, 'Report lacks concrete reviewed findings or unconfirmed candidates');
    for (const finding of report.findings) {
        assert.ok(['source-confirmed', 'unconfirmed', 'not-reproduced'].includes(finding.status), 'Finding status lacks evidence boundary');
        assert.ok(typeof finding.explanation === 'string' && finding.explanation.length > 40, 'Finding lacks substantive explanation');
        if (finding.sourceQuote) assert.ok(ui.includes(finding.sourceQuote), 'Finding cites text absent from actual UI source');
    }
    assert.ok(typeof report.nextNativeEvidence === 'string' && report.nextNativeEvidence.length > 40, 'Report lacks exact auxiliary-document follow-up');
}
console.log(JSON.stringify(witness, null, 2));
