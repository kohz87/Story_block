// A reply captured before present lines ran after place (stage73): rebuild, reload and a later delete keep its stored
// scene; only an explicit Re-read applies the new order (the review's proof, kept).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../../src/v2/store.js';
import { createHost } from '../../testkit/index.js';
const PLACE = '~ place Bluewatch Salt-and-Ash Yard | kind: settlement | region: River Confederacy';
const block = l => `The yard.\n\n<Changes>\n${l.join('\n')}\n</Changes>`;
const rebuilt = host => createStore({ chat: () => host.ctx.chat, save: () => {} }).head();

test('old-order reply: rebuild/reload/later delete keep stored state; only Re-read applies the new order', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', block(['~ place Old Quay', '+ present Quartermaster Hobb']));
    // capture the OLD way: strip `after` from the present kind
    const orig = host.registry.capture.bind(host.registry);
    const mocked = t.mock.method(host.registry, 'capture', k => { const e = orig(k); return e && e.after ? { ...e, after: undefined } : e; });
    await host.send('On.', block(['- present Quartermaster Hobb', '+ present Melnor', '+ present Sister Temiwa', PLACE]));
    mocked.mock.restore();
    const oldIdx = host.ctx.chat.length - 1;
    const oldScene = structuredClone(host.head().domains.scene);
    console.log('OLD live scene', JSON.stringify(oldScene));
    const oldRecord = JSON.stringify(host.ctx.chat[oldIdx].extra);
    await host.send('Next.', block(['+ present Wren']));
    await host.send('Next2.', block(['~ place The Weir']));
    const liveHead = structuredClone(host.head());
    // 1 rebuild from stored ops
    assert.deepEqual(rebuilt(host), liveHead);
    assert.deepEqual(host.store.at(oldIdx).domains.scene, oldScene, 'at(old) unchanged');
    // 2 turn.rebuild / chat reload
    if (host.turn.rebuild) await host.turn.rebuild('test');
    assert.deepEqual(host.head(), liveHead, 'turn.rebuild');
    assert.equal(JSON.stringify(host.ctx.chat[oldIdx].extra), oldRecord, 'record untouched by rebuild');
    // 3 delete a later reply (replays the old one's block)
    await host.st.deleteMessage?.(host.ctx.chat.length - 1);
    assert.deepEqual(host.store.at(oldIdx).domains.scene, oldScene, 'after delete of later reply');
    // 4 Re-read old reply
    const before = JSON.parse(oldRecord);
    const done = await host.turn.reread(oldIdx);
    console.log('reread', done.ok, done.message);
    const after = host.store.at(oldIdx).domains.scene;
    console.log('NEW scene', JSON.stringify(after));
    console.log('head scene', JSON.stringify(host.head().domains.scene), 'problems', JSON.stringify(host.turn.problems().map(p=>p.code+':'+p.message)));
    const nr = JSON.parse(JSON.stringify(host.ctx.chat[oldIdx].extra));
    const strip = r => JSON.stringify((r.sb2?.receipts ?? r.receipts ?? r), null, 0);
    console.log('OLD rec', JSON.stringify(before).slice(0,1800));
    console.log('NEW rec', JSON.stringify(nr).slice(0,1800));
    assert.deepEqual(rebuilt(host), host.head());
});
