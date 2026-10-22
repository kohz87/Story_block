// The Diagnostics section (src/v2/view/settings/diagnostics-page.js, UI stage step 3g): the report card (Copy, Save, Refresh, the UI sample),
// what modules place here (Story Block's Events as a fold card, a module whose settings are placed here), the fold ids, and what the
// report never holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { packsFor } from '../../../src/v2/runtime.js';
import { DIAGNOSTICS_FOLD, DIAGNOSTICS_TEXT, EVENTS_FOLD } from '../../../src/v2/host-ui.js';
import { EVENTS_NOTE } from '../../../src/v2/events/index.js';
import { REMOVED, buildReport } from '../../../src/v2/diagnostics.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
// A module whose settings are placed in Diagnostics (debug information), with a panel and a field.
const probe = () => ({ id: 'probe', name: 'Probe', version: '1.0.0', settings: { place: 'diagnostics', section: 'Probe log', defaults: { n: 1 }, schema: { n: { type: 'int', label: 'Lines', min: 1, max: 9 } }, render(el) { el.textContent = 'raw'; } } });

async function open(source = null, options = {}) {
    const doc = options.doc ?? setupDom();
    const host = await createHost({ modules: options.modules ?? [], ...(options.host ?? {}) });
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, diagnostics: source, openState: options.openState ?? new Map(), ...(options.window ?? {}) });
    win.select('diagnostics');
    const page = win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'diagnostics');
    return { doc, host, win, root: win.root, page };
}
const search = (root, text) => {
    const input = root.querySelector('.ss-search-input');
    input.value = text;
    input.dispatch('input');
};

test('the report card: built when the page is first shown (not before), shown as it will be shared; Copy uses the clipboard, else selects the text; Save downloads a .txt', async () => {
    const doc = setupDom();
    const copied = [];
    const links = [];
    const selected = [];
    doc.defaultView = {
        navigator: { clipboard: { writeText: async text => { copied.push(text); } } },
        Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
        URL: { createObjectURL: blob => { links.push(blob); return 'blob:1'; }, revokeObjectURL: () => {} },
        getSelection: () => ({ removeAllRanges: () => {}, addRange: range => selected.push(range) }),
    };
    doc.createRange = () => ({ selectNodeContents: node => { selected.push(node); } });
    try {
        let builds = 0;
        const source = { report: async () => { builds += 1; return `REPORT ${builds}`; }, fileName: () => 'story-suite-diagnostics-x.txt' };
        const host = await createHost({ modules: [] });
        const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, diagnostics: source, openState: new Map() });
        assert.equal(builds, 0, 'nothing built while another page is shown');
        win.select('diagnostics');
        await tick();
        const page = win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'diagnostics');
        const card = page.querySelector('.ss-diagnostics-card');
        assert.equal(card.dataset.fold, DIAGNOSTICS_FOLD);
        assert.deepEqual([...card.querySelectorAll('.ss-section-title, .ss-section-hint')].map(node => node.textContent), [DIAGNOSTICS_TEXT.title, DIAGNOSTICS_TEXT.hint]);
        assert.equal(builds, 1, 'built the first time the page is shown');
        assert.equal(card.querySelector('.story-suite-diagnostics-report').textContent, 'REPORT 1');
        assert.equal(card.querySelector('.story-suite-diagnostics-report').getAttribute('aria-label'), DIAGNOSTICS_TEXT.reportLabel);
        win.select('look');
        win.select('diagnostics');
        assert.equal(builds, 1, 'not again when shown again');
        card.querySelector('.story-suite-diagnostics-refresh').click();
        await tick();
        assert.equal(card.querySelector('.story-suite-diagnostics-report').textContent, 'REPORT 2');
        card.querySelector('.story-suite-diagnostics-copy').click();
        await tick();
        assert.deepEqual(copied, ['REPORT 3']);
        assert.equal(card.querySelector('.story-suite-diagnostics-status').textContent, DIAGNOSTICS_TEXT.copied);
        card.querySelector('.story-suite-diagnostics-save').click();
        await tick();
        assert.deepEqual(links.map(blob => [blob.parts[0], blob.type]), [['REPORT 4', 'text/plain;charset=utf-8']]);
        assert.equal(card.querySelector('.story-suite-diagnostics-status').textContent, 'Saved the report as story-suite-diagnostics-x.txt.');
        // No clipboard here: the report is selected for copying by hand.
        doc.defaultView.navigator = {};
        card.querySelector('.story-suite-diagnostics-copy').click();
        await tick();
        assert.equal(card.querySelector('.story-suite-diagnostics-status').textContent, DIAGNOSTICS_TEXT.copyFailed);
        assert.equal(selected[0], card.querySelector('.story-suite-diagnostics-report'));
        // A failing report is said in its place.
        const broken = await open({ report: async () => { throw new Error('no report'); } }, { doc });
        await tick();
        assert.equal(broken.page.querySelector('.story-suite-diagnostics-report').textContent, 'The report could not be built: no report');
        broken.host.close();
        host.close();
    } finally {
        delete doc.defaultView;
        delete doc.createRange;
    }
});

test('"Show the UI sample" only when the page offers it; a failure is said in the status line', async () => {
    const opened = [];
    const { page, host } = await open({ report: async () => 'R', sample: () => { opened.push(1); } });
    const button = page.querySelector('.story-suite-diagnostics-sample');
    assert.ok(button);
    assert.equal(button.querySelector('span').textContent, DIAGNOSTICS_TEXT.sample);
    assert.equal(button.title, DIAGNOSTICS_TEXT.sampleTitle);
    button.click();
    assert.deepEqual(opened, [1]);
    host.close();
    const none = await open({ report: async () => 'R' });
    assert.equal(none.page.querySelector('.story-suite-diagnostics-sample'), null);
    none.host.close();
    const failing = await open({ report: async () => 'R', sample: () => { throw new Error('no sample'); } });
    failing.page.querySelector('.story-suite-diagnostics-sample').click();
    assert.equal(failing.page.querySelector('.story-suite-diagnostics-status').textContent, 'The UI sample could not be shown: no sample');
    failing.host.close();
});

test('Events: a fold card on the page, below the report, folded, with its note; not in Story Block\'s Modules card', async () => {
    const { page, root, win, host } = await open({ report: async () => 'REPORT' });
    const cards = page.querySelectorAll('.ss-diagnostics > .ss-section');
    assert.deepEqual(cards.map(node => node.dataset.fold), [DIAGNOSTICS_FOLD, EVENTS_FOLD], 'the report, then Events');
    const events = page.querySelector('.ss-diagnostics-fold');
    assert.equal(events.tagName, 'DETAILS');
    assert.equal(events.open, false, 'folded by default: it can spoil the story');
    assert.deepEqual([...events.querySelectorAll('summary .ss-section-title, summary .ss-section-hint')].map(node => node.textContent), ['Events', 'every pack event']);
    const note = events.querySelector('.ss-events-note');
    assert.equal(note.textContent, EVENTS_NOTE);
    assert.equal(note.textContent, 'For checking packs. It shows upcoming events and their conditions, so it can spoil the story.');
    assert.ok(events.querySelector('.ss-events-summary'), 'the events panel itself');
    win.select('modules');
    assert.equal(root.querySelector('.ss-module-card[data-module="story-block"] .ss-events'), null, 'not in the Modules page');
    assert.equal(host.registry.settingsDefs().find(def => def.moduleId === 'story-block').folds.find(item => item.id === 'events').place, 'diagnostics');
    host.close();
});

test('Events: its open state is remembered in the window\'s state; the fold id opens the page and the card with its summary focused; without a report there is still Events', async () => {
    const state = new Map();
    const { page, doc, host } = await open({ report: async () => 'REPORT' }, { openState: state });
    const events = () => page.querySelector('.ss-diagnostics-fold');
    events().open = true;
    events().dispatch('toggle');
    assert.equal(state.get(EVENTS_FOLD), true, 'a toggle is remembered');
    assert.ok(events().classList.contains('ss-section-fold-open'));
    host.close();
    const again = await open({ report: async () => 'REPORT' }, { openState: state, doc });
    assert.equal(again.page.querySelector('.ss-diagnostics-fold').open, true, 'another window with the same state');
    again.host.close();
    const atEvents = await open({ report: async () => 'REPORT' }, { window: { fold: EVENTS_FOLD } });
    assert.equal(atEvents.win.section(), 'diagnostics');
    const card = atEvents.page.querySelector('.ss-diagnostics-fold');
    assert.equal(card.open, true);
    assert.ok(atEvents.doc.activeElement === card.querySelector('summary'));
    atEvents.host.close();
    const atReport = await open({ report: async () => 'REPORT' }, { window: { fold: DIAGNOSTICS_FOLD } });
    assert.equal(atReport.win.section(), 'diagnostics');
    assert.ok(atReport.doc.activeElement === atReport.page.querySelector('.ss-diagnostics-card .ss-section-title'));
    atReport.host.close();
    const bare = await open(null);
    assert.equal(bare.page.querySelector('.ss-diagnostics-card'), null, 'no report to build');
    assert.ok(bare.page.querySelector('.ss-diagnostics-fold'), 'Events is still there');
    bare.host.close();
});

test('a module placed here with `settings.place: \'diagnostics\'` has its settings and panel on this page as a fold card, and none in Modules; an unknown place stays where it was', async () => {
    const odd = { id: 'odd', name: 'Odd', settings: { place: 'sidebar', schema: { on: 'bool' } } };
    const { page, win, root, doc, host } = await open({ report: async () => 'R' }, { modules: [probe(), odd] });
    const card = page.querySelector('.ss-module-card[data-module="probe"]');
    assert.ok(card);
    assert.equal(card.tagName, 'DETAILS');
    assert.equal(card.open, false, 'folded by default');
    assert.equal(card.querySelector('.story-suite-section').textContent, 'raw');
    assert.deepEqual(card.querySelectorAll('.ss-field').map(node => node.dataset.field), ['n']);
    // Its settings are written through the same store.
    const box = card.querySelector('.ss-field[data-field="n"] input');
    box.value = '4';
    box.dispatch('change');
    assert.equal(host.settings('probe').n, 4);
    win.select('modules');
    const mod = root.querySelector('.ss-modules .ss-module-card[data-module="probe"]');
    assert.ok(mod, 'its card in Modules says what it is');
    assert.equal(mod.querySelectorAll('.ss-field').length, 0, 'but none of its settings');
    assert.ok(root.querySelector('.ss-modules .ss-module-card[data-module="odd"] .ss-field[data-field="on"]'), 'an unknown place stays in Modules');
    // The fold id of the module opens this page and the card.
    const at = await open({ report: async () => 'R' }, { modules: [probe()], window: { fold: 'probe' }, doc });
    assert.equal(at.win.section(), 'diagnostics');
    const open1 = at.page.querySelector('.ss-module-card[data-module="probe"]');
    assert.equal(open1.open, true);
    assert.ok(doc.activeElement === open1.querySelector('summary'));
    at.host.close();
    host.close();
});

test('search finds the report card by its buttons and the placed cards by their names', async () => {
    const { page, root, host } = await open({ report: async () => 'REPORT', sample: () => {} }, { modules: [probe()] });
    search(root, 'copy report');
    assert.equal(page.hidden, false);
    assert.equal(page.querySelector('.ss-diagnostics-card').hidden, false);
    assert.equal(page.querySelector('.ss-diagnostics-fold').hidden, true);
    search(root, 'events');
    assert.equal(page.querySelector('.ss-diagnostics-fold').hidden, false);
    assert.equal(page.querySelector('.ss-diagnostics-card').hidden, true);
    search(root, 'probe');
    assert.equal(page.querySelector('.ss-module-card[data-module="probe"]').hidden, false);
    assert.equal(page.querySelector('.ss-module-card[data-module="probe"]').open, true, 'a match opens the fold');
    search(root, '');
    assert.equal(page.querySelector('.ss-module-card[data-module="probe"]').open, false, 'and the reader\'s choice comes back');
    host.close();
});

test('the report the page shows and copies never holds a key, an address or chat text', async () => {
    const SECRET = 'sk-FAKE0123456789abcdef';
    const URL_TEXT = 'https://example.invalid/v1/chat?token=abc';
    const STORY = 'Mira whispered the password of the cellar to Ren at midnight';
    const doc = setupDom();
    const copied = [];
    doc.defaultView = { navigator: { clipboard: { writeText: async text => { copied.push(text); } } } };
    try {
        const registry = createRegistry();
        registry.register(createCoreModule({ packs: packsFor({ extensionSettings: {} }) }));
        registry.register({ id: 'leaky', name: 'Leaky', version: '1.0.0', settings: { defaults: { apiKey: SECRET, endpointUrl: URL_TEXT, note: SECRET, title: 'Fine' }, schema: { apiKey: 'text', endpointUrl: 'text', note: 'text', title: 'text' } } });
        const es = {};
        const settings = createSettings({ root: () => es, registry, save: () => {} });
        const source = {
            report: () => buildReport({
                stVersion: '1.0', hostVersion: '2.0.0', modules: () => registry.modules().map(def => ({ id: def.id, name: def.name ?? def.id, version: def.version ?? '' })),
                hostSettings: () => settings(), settingsOf: id => settings(id),
                chat: () => [{ is_user: true, mes: STORY }, { is_user: false, mes: `${STORY} ${SECRET}` }], chatOpen: () => true,
                problems: () => [{ code: 'BAD_LINE', module: 'leaky', index: 1, message: `the story said "${STORY}"` }],
            }),
        };
        const win = openSettingsWindow({ registry, settings, doc, diagnostics: source, openState: new Map() });
        win.select('diagnostics');
        await tick();
        await tick();
        const page = win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'diagnostics');
        const shown = page.querySelector('.story-suite-diagnostics-report').textContent;
        page.querySelector('.story-suite-diagnostics-copy').click();
        await tick();
        await tick();
        assert.equal(copied.length, 1);
        for (const text of [shown, copied[0]]) {
            assert.ok(text.length > 200, 'a real report');
            assert.ok(!text.includes(SECRET), 'no key');
            assert.ok(!text.includes('example.invalid') && !text.includes('token=abc'), 'no address');
            assert.ok(!text.includes('cellar') && !text.includes('midnight') && !text.includes('Whispered'.toLowerCase()), 'no chat text');
            assert.ok(text.includes('Fine'), 'plain settings stay');
        }
        assert.ok(shown.includes(REMOVED) || /left out|removed/i.test(shown), 'what was taken out is said');
        // Copy builds it again (the time it was made is the only line that differs).
        const body = text => text.split('\n').filter(line => !line.startsWith('Made ')).join('\n').trim();
        assert.equal(body(shown), body(copied[0]), 'what is shown is what is copied');
        win.close();
    } finally {
        delete doc.defaultView;
    }
});
