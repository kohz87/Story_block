// The Packs settings section over a fake DOM: list, import from a file and a lorebook,
// switch on and off, remove, and pack text always shown as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { renderPacksPanel, countsLine } from '../../../src/v2/packs/panel.js';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { LIMITS } from '../../../src/v2/packs/limits.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack, sampleText } from './helpers/fixtures.js';

const doc = installFakeDom();
const tick = () => new Promise(resolve => setImmediate(resolve));

function mount({ entries = [], problem = '', character = 'Mara' } = {}) {
    const settings = fakeSettings();
    const packs = createInstalled({ settings });
    const root = doc.createElement('div');
    const notes = [];
    const panel = renderPacksPanel(root, { packs, readLorebook: async () => ({ character, entries, problem }), notify: text => notes.push(text), doc });
    return { settings, packs, root, notes, panel };
}
const fakeFile = (name, text, size = text.length) => ({ name, size, text: async () => text });

test('counts read as plain words', () => {
    assert.equal(countsLine({ items: 4, creatures: 1, shops: 1, recipes: 0, events: 2, quests: 0 }, true), '4 items, 1 creature, 1 shop, 2 events, start state');
    assert.equal(countsLine({}, false), 'no content');
});

test('an empty list, then a pack imported from a file', async () => {
    const { root, notes } = mount();
    assert.deepEqual(texts(root, '.ss-packs-empty'), ['No packs installed.']);
    const input = root.querySelector('.ss-packs-file');
    assert.equal(input.type, 'file');
    let clicked = false;
    input.click = () => { clicked = true; };
    root.querySelector('.ss-packs-import').click();
    assert.equal(clicked, true, 'the button opens the file picker');
    input.files = [fakeFile('riverside.json', sampleText)];
    input.dispatch('change');
    await tick();
    assert.deepEqual(notes, ['Installed Riverside Starter.']);
    assert.deepEqual(texts(root, '.ss-packs-message'), ['Installed Riverside Starter.']);
    assert.deepEqual(texts(root, '.ss-packs-name'), ['Riverside Starter 1.0.0']);
    assert.deepEqual(texts(root, '.ss-packs-facts'), ['4 items, 1 creature, 1 shop, 1 recipe, 2 events, 1 race, 1 talent, start state, a money word, a theme · by Story Suite examples · riverside.json']);
    const again = root.querySelector('.ss-packs-file');
    again.files = [fakeFile('riverside.json', sampleText)];
    again.dispatch('change');
    await tick();
    assert.equal(notes.at(-1), 'Riverside Starter is already installed.');
});

test('a refused file shows why, and saves nothing', async () => {
    const { root, settings } = mount();
    const input = root.querySelector('.ss-packs-file');
    input.files = [fakeFile('evil.json', JSON.stringify(pack({ name: '<script>alert(1)</script>' })))];
    input.dispatch('change');
    await tick();
    assert.deepEqual(texts(root, '.ss-packs-message'), ['evil.json was not imported.']);
    assert.match(texts(root, '.ss-packs-errors li')[0], /HTML tag/);
    assert.equal(settings.saves, 0);
    const big = root.querySelector('.ss-packs-file');
    let read = false;
    big.files = [{ name: 'big.json', size: LIMITS.packBytes + 1, text: async () => { read = true; return ''; } }];
    big.dispatch('change');
    await tick();
    assert.equal(read, false, 'a file over the limit is not even read');
    assert.match(texts(root, '.ss-packs-errors li')[0], /larger than/);
    const broken = root.querySelector('.ss-packs-file');
    broken.files = [{ name: 'gone.json', size: 3, text: async () => { throw new Error('gone'); } }];
    broken.dispatch('change');
    await tick();
    assert.deepEqual(texts(root, '.ss-packs-message'), ['gone.json could not be read.']);
    const none = root.querySelector('.ss-packs-file');
    none.files = [];
    none.dispatch('change');
    await tick();
    assert.deepEqual(texts(root, '.ss-packs-message'), ['gone.json could not be read.'], 'no file picked, nothing happens');
});

test('reading the character lorebook', async () => {
    const entries = [
        { book: 'Mara lore', uid: 1, title: 'Riverside [storysuite:pack]', content: sampleText },
        { book: 'Mara lore', uid: 2, title: 'Broken [storysuite:pack]', content: '{' },
    ];
    const { root } = mount({ entries });
    root.querySelector('.ss-packs-lorebook').click();
    await tick();
    assert.deepEqual(texts(root, '.ss-packs-message'), ['Read 1 pack from the lorebook: Riverside Starter. 1 entry was not imported.']);
    assert.match(texts(root, '.ss-packs-errors li')[0], /^Broken: The pack is not valid JSON/);
    assert.deepEqual(texts(root, '.ss-packs-facts')[0].split(' · ').at(-1), 'from a lorebook');

    const untagged = mount({ entries: [{ book: 'b', uid: 0, title: 'Mill', content: 'x' }] });
    untagged.root.querySelector('.ss-packs-lorebook').click();
    await tick();
    assert.deepEqual(texts(untagged.root, '.ss-packs-message'), ['No lorebook entry of Mara is tagged [storysuite:pack].']);

    const none = mount({ problem: 'Open a chat with a character first.' });
    none.root.querySelector('.ss-packs-lorebook').click();
    await tick();
    assert.deepEqual(texts(none.root, '.ss-packs-message'), ['Open a chat with a character first.']);
});

test('switching off, and removing after a question (Remove, then Remove or Cancel, the focus on Cancel)', async () => {
    const { root, packs } = mount();
    await packs.install(pack({ id: 'a', name: 'Pack A' }));
    await packs.install(pack({ id: 'b', name: 'Pack B' }));
    const panel = renderPacksPanel(root, { packs, readLorebook: async () => ({}), doc });
    doc.body.appendChild(root);
    const row = id => root.querySelector(`.ss-packs-row[data-pack-id="${id}"]`);
    // The switch is a role=switch button, in an ss.listcard row.
    assert.ok(row('a').classList.contains('ss-listcard-row'));
    const toggle = row('a').querySelector('.ss-packs-enabled');
    assert.equal(toggle.getAttribute('role'), 'switch');
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    toggle.click();
    await tick();
    assert.equal(packs.list()[0].enabled, false);
    assert.equal(row('a').querySelector('.ss-packs-enabled').getAttribute('aria-checked'), 'false');
    assert.ok(doc.activeElement === row('a').querySelector('.ss-packs-enabled'), 'the focus stays on the switch');
    // Remove asks first: nothing is removed, the question names the pack, the focus is on Cancel.
    row('b').querySelector('.ss-packs-remove').click();
    assert.equal(packs.list().length, 2);
    assert.match(texts(row('b'), '.ss-packs-confirm-text')[0], /^Remove Pack B\? /);
    assert.ok(doc.activeElement === root.querySelector('.ss-packs-confirm-no'));
    // Cancel keeps it and puts the focus back on its Remove button.
    root.querySelector('.ss-packs-confirm-no').click();
    assert.equal(row('b').querySelector('.ss-packs-confirm'), null);
    assert.equal(packs.list().length, 2);
    assert.ok(doc.activeElement === row('b').querySelector('.ss-packs-remove'));
    // Escape in the question cancels the question only (the window around it stays).
    row('b').querySelector('.ss-packs-remove').click();
    let reached = false;
    root.addEventListener('keydown', () => { reached = true; });
    row('b').querySelector('.ss-packs-confirm').dispatch('keydown', { key: 'Escape' });
    assert.equal(row('b').querySelector('.ss-packs-confirm'), null);
    assert.equal(reached, false, 'Escape did not go on to close anything');
    // Remove, then Remove: gone; the focus goes to Import.
    row('b').querySelector('.ss-packs-remove').click();
    root.querySelector('.ss-packs-confirm-yes').click();
    await tick();
    assert.deepEqual(packs.list().map(entry => entry.id), ['a']);
    assert.deepEqual(texts(root, '.ss-packs-message'), ['Removed Pack B.']);
    assert.ok(doc.activeElement === root.querySelector('.ss-packs-import'));
    panel.refresh();
    root.remove();
});

test('pack text is shown as text, problems and missing parts are shown', async () => {
    const settings = fakeSettings({ packs: [
        { id: 'bad', version: '1.0.0', enabled: true, pack: pack({ id: 'bad', name: '<img src=x onerror=alert(1)>' }) },
        { id: 'needs', version: '1.0.0', enabled: true, pack: pack({ id: 'needs', name: 'Tags <b>bold</b>', description: 'Two & three', requires: { storyBlock: '^2', capabilities: ['party'] } }) },
    ] });
    const packs = createInstalled({ settings, capabilities: () => ['inventory'] });
    const root = doc.createElement('div');
    renderPacksPanel(root, { packs, readLorebook: async () => ({}), doc });
    assert.deepEqual(texts(root, '.ss-packs-name'), ['bad 1.0.0', 'Tags <b>bold</b> 1.0.0']);
    assert.equal(root.querySelectorAll('b').length, 0, 'no markup made it into the page');
    const [bad, needs] = texts(root, '.ss-packs-problem');
    assert.match(bad, /^Not usable: .*event attribute/);
    assert.match(needs, /^Needs party/);
    assert.equal(root.querySelector('.ss-packs-row[data-pack-id="bad"] .ss-packs-enabled').disabled, true);
    assert.deepEqual(texts(root, '.ss-packs-description'), ['Two & three']);
});
