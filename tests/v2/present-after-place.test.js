// The reader's reply (5 Nov): `- present Hobb`, `+ present Melnor`, `+ present Sister Temiwa`, then `~ place Bluewatch Salt-and-Ash Yard`. The place line came
// last, its move cleared the two adds, and nobody was present. The core `present` kind now declares `after: ['place']`, so a reply's present lines run
// behind its place line whatever order they were written in (registry captureEntry, capture-flow linesInOrder). Live, Re-read and the rebuild agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/v2/store.js';
import { createHost } from '../../testkit/index.js';

const PLACE = '~ place Bluewatch Salt-and-Ash Yard | kind: settlement | region: River Confederacy';
const block = lines => `The yard.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const rebuilt = host => createStore({ chat: () => host.ctx.chat, save: () => {} }).head();
const scene = host => host.head().domains.scene;

async function start(t, before) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', block(before));
    return host;
}

// Sends `lines`, then checks Re-read and the rebuild give the same scene as the live capture.
async function replyAndCheck(host, lines) {
    await host.send('On.', block(lines));
    const live = structuredClone(host.head());
    assert.deepEqual(rebuilt(host), live, 'the rebuild equals the live state');
    const last = host.ctx.chat.length - 1;
    const done = await host.turn.reread(last);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(host.head(), live, 'Re-read equals the live state');
    return scene(host);
}

const BEFORE = ['~ place Old Quay', '+ present Quartermaster Hobb'];

test('the reader\'s block: the place line last, yet Melnor and Temiwa are present at the yard and Hobb is gone', async t => {
    const host = await start(t, BEFORE);
    const now = await replyAndCheck(host, ['- present Quartermaster Hobb', '+ present Melnor', '+ present Sister Temiwa', PLACE]);
    assert.equal(now.place.name, 'Bluewatch Salt-and-Ash Yard');
    assert.deepEqual(now.present, ['Melnor', 'Sister Temiwa']);
});

test('place first, then present: unchanged', async t => {
    const host = await start(t, BEFORE);
    const now = await replyAndCheck(host, [PLACE, '- present Quartermaster Hobb', '+ present Melnor', '+ present Sister Temiwa']);
    assert.deepEqual(now.present, ['Melnor', 'Sister Temiwa']);
});

test('present lines with no place line in the reply: unchanged', async t => {
    const host = await start(t, BEFORE);
    const now = await replyAndCheck(host, ['+ present Melnor', '- present Quartermaster Hobb']);
    assert.equal(now.place.name, 'Old Quay');
    assert.deepEqual(now.present, ['Melnor']);
});

test('`- present` of someone the move already left is harmless (told as missing, nothing else changes), in either order', async t => {
    for (const lines of [[PLACE, '- present Quartermaster Hobb', '+ present Melnor'], ['- present Quartermaster Hobb', '+ present Melnor', PLACE]]) {
        const host = await start(t, BEFORE);
        const now = await replyAndCheck(host, lines);
        assert.deepEqual(now.present, ['Melnor'], lines.join(' / '));
        assert.deepEqual(host.turn.problems().filter(item => item.code !== 'STRAY' && /Hobb/.test(item.message ?? '')), [], 'no Problem for the one who was gone');
    }
});

test('`with` on the place line brings people along; present lines before it still add to them', async t => {
    const host = await start(t, BEFORE);
    const now = await replyAndCheck(host, ['+ present Melnor', '~ place Bluewatch Salt-and-Ash Yard | with: Quartermaster Hobb', '+ present Sister Temiwa']);
    assert.deepEqual(now.present, ['Quartermaster Hobb', 'Melnor', 'Sister Temiwa']);
});

test('several place lines: the present lines run behind the last one', async t => {
    const host = await start(t, BEFORE);
    const now = await replyAndCheck(host, ['+ present Melnor', '~ place The Weir', '~ place Bluewatch Salt-and-Ash Yard']);
    assert.equal(now.place.name, 'Bluewatch Salt-and-Ash Yard');
    assert.deepEqual(now.present, ['Melnor']);
});

test('a reply saved in the old order and read again keeps the people the story added', async t => {
    const host = await start(t, BEFORE);
    await host.send('On.', 'The yard.');
    const last = host.ctx.chat.length - 1;
    await host.st.editMessage(last, block(['+ present Melnor', '+ present Sister Temiwa', PLACE]));
    const done = await host.turn.reread(last);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(scene(host).present, ['Melnor', 'Sister Temiwa']);
});
