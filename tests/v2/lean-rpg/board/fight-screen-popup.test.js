// The Fight screen opens only for a ready pause: the pre-check's wait ("Setting up the fight…") opens nothing, a wait that ends with no
// fight leaves no screen open, a ready hold opens it, and a screen the reader opened is never closed by the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearStart, holdStart } from '../../../../src/v2/turn/fight-start.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';

async function ready(t) {
    const app = await page(t, { formula: 'standard' });
    const { host, doc } = app;
    await begin(host);
    await makeBlocks(host, { character: { agi: 20 }, skills: { skill1: 'Obscure', stat1: 'agi', about1: 'hide' } });
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    host.ctx.chat.push({ is_user: true, mes: 'I attack the rats.' });
    const meta = host.ctx.chatMetadata;
    const emit = reason => { host.events.emit('head', { index: host.store.headIndex(), reason }); return settle(); };
    const opened = () => Boolean(doc.querySelector('[data-ss-screen="story-block/fight"]'));
    return { app, host, meta, emit, opened };
}

test('a working pre-check opens no screen, and one that finds no fight leaves none open', async t => {
    const { host, meta, emit, opened } = await ready(t);
    assert.ok(holdStart(meta, host.ctx.chat, { mode: 'working' }));
    await emit('fight-start');
    assert.equal(opened(), false, 'the wait opens nothing');
    clearStart(meta);
    await emit('fight-start-done');
    assert.equal(opened(), false);
    assert.equal(host.ctx.chat.at(-1).is_user, true);
});

test('a ready hold opens the Fight screen once; the pause ending with no fight closes what the code opened', async t => {
    const { host, meta, emit, opened, app } = await ready(t);
    assert.ok(holdStart(meta, host.ctx.chat, { mode: 'working' }));
    await emit('fight-start');
    assert.equal(opened(), false);
    holdStart(meta, host.ctx.chat, { mode: 'new' });
    await emit('fight-start');
    assert.equal(opened(), true, 'ready: the screen opens');
    assert.equal(app.ui.mounts.screen.current(), 'story-block/fight');
    clearStart(meta);
    await emit('fight-start-done');
    assert.equal(opened(), false, 'no fight after all: closed again');
});

test('a Fight screen the reader opened is not closed by the code when the pause ends', async t => {
    const { host, meta, emit, app } = await ready(t);
    holdStart(meta, host.ctx.chat, { mode: 'new' });
    assert.equal(app.ui.mounts.screen.open('story-block/fight'), true);
    await settle();
    const real = app.ui.mounts.screen.close;
    let closes = 0;
    app.ui.mounts.screen.close = (...args) => { closes += 1; return real.apply(app.ui.mounts.screen, args); };
    await emit('fight-start');
    clearStart(meta);
    await emit('fight-start-done');
    assert.equal(closes, 0, 'the code never closed the reader\'s screen');
});
