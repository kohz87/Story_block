// A chat block without `show` stays on the Blocks page of Settings; a pack kind that needs labels is not offered as a bare button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { STRINGS, fill } from '../../../src/v2/strings.js';
import { setupDom } from '../view/mounts/helpers.js';
import { definition, pack, reload, success } from '../data-modules/helpers.js';

const S = STRINGS.blocks;
const P = S.page;
const settle = () => new Promise(resolve => setImmediate(resolve));
const button = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text);
const input = (root, label) => root.querySelector(`[aria-label="${label}"]`);

async function mounted(t) {
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    return { doc, host, ui };
}

test('a chat block defined without show is listed after a reload and can be removed', async t => {
    const { doc, host, ui } = await mounted(t);
    await host.send('Begin.', 'Opening.');
    success(await host.sdk.command('dm.define', { definition: definition() }));
    await reload(host);
    const win = ui.openSettings();
    win.select('blocks');
    const page = () => win.root.querySelector('[data-ss-section="blocks"]');
    assert.match(page().textContent, /Counter/);
    assert.equal(page().querySelector('select').value, 'hidden', 'with no `show` it has no tab and no card');
    input(page(), fill(P.menuFor, { name: 'Counter' })).click();
    button(page(), S.removeBlock).click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.setup').some(row => row.module === 'pack.chat/counter' && row.pinned), false);
    await reload(host);
    assert.equal(page().querySelector('.ss-blockrow'), null);
});

test('a pack kind that needs labels is not drawn as a bare button; a label-free kind still works', async t => {
    const { doc, host, ui } = await mounted(t);
    const counter = definition();
    counter.show = { tab: true, card: true, tabName: 'Counter', icon: 'ph-star' };
    counter.kinds.boost = { op: '+', ui: true, title: 'Add points', labels: { by: { type: 'int', min: 1, max: 5 } },
        effects: [{ op: 'add', path: ['points'], value: ['arg', 'by'], bounds: 'clamp' }] };
    counter.kinds.gain.title = 'Tick';
    success(await host.packs.packs.install(pack([counter])));
    await host.send('Begin.', 'Opening.');
    const offer = host.sdk.query('dataModules.offers').find(row => row.module === 'pack.dm-test/counter');
    success(await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash }));
    const screenId = 'story-block/block/dm-test/counter';
    assert.equal(ui.mounts.screen.open(screenId), true);
    const tab = () => doc.querySelector(`.ss-gameview [data-ss-screen="${screenId}"]`);
    assert.equal(button(tab(), 'Add points'), undefined);
    button(tab(), 'Tick').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: offer.module }).chat.points, 1);
    ui.mounts.screen.open('story-block/home');
    const home = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/home"]');
    assert.equal(button(home(), 'Add points'), undefined);
    assert.ok(button(home(), 'Tick'));
    // The kind itself still works through its pack's own screens (dm.act with its labels).
    success(await host.sdk.command('dm.act', { module: offer.module, kind: 'boost', labels: { by: 2 } }));
    assert.equal(host.sdk.query('dataModules.view', { module: offer.module }).chat.points, 3);
});
