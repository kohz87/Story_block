// The reply offer, tab alert and held-fight controls use the mounted production UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { boardSession, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';

async function world(t) {
    const app = await page(t, { formula: 'standard' });
    const { host } = app;
    host.features.set(CORE_FEATURE.fightBoard, false);
    await begin(host);
    await makeBlocks(host, { character: { agi: 20, str: 20 } });
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    await host.send('A rat appears.', 'A rat appears.\n<Changes>\n+ dm foes — a fight starts | kind: set-slot-1 | name: Rat | count: 1 | level: 1\n</Changes>');
    host.features.set(CORE_FEATURE.fightBoard, true);
    app.draw();
    host.events.emit('head', { index: host.store.headIndex() });
    await settle();
    return app;
}

test('the reply offer and Fight tab dot follow Keep narrating, reload and the feature switch', async t => {
    const { doc, host, ui, draw } = await world(t);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const reply = doc.querySelector(`.mes[mesid="${host.store.headIndex()}"]`);
    const alert = () => doc.querySelectorAll('[data-id="story-block/fight"]').some(node => Boolean(node.querySelector('.ss-screenbar-alert')));
    assert.match(reply.querySelector('.rpg-fight-offer').textContent, /A fight started: Rat/);
    assert.equal(alert(), true);
    reply.querySelector('.rpg-fight-offer-narrate').click();
    await settle();
    assert.equal(reply.querySelector('.rpg-fight-offer'), null);
    assert.equal(alert(), false);
    await host.st.loadChat(structuredClone(host.ctx.chat), 'offer-reload');
    draw();
    host.events.emit('head', { index: host.store.headIndex() });
    assert.equal(Boolean(doc.querySelector('.rpg-fight-offer')), false, 'the choice survives reload');
    await host.swipe('A snake appears.\n<Changes>\n+ dm foes — a new fight | kind: set-slot-1 | name: Snake | count: 1 | level: 1\n</Changes>');
    draw();
    host.events.emit('head', { index: host.store.headIndex() });
    assert.match(doc.querySelector('.rpg-fight-offer').textContent, /Snake/, 'another swipe has its own offer');
    host.features.set(CORE_FEATURE.fightBoard, false);
    await settle();
    assert.equal(doc.querySelector('.rpg-fight-offer'), null);
});

test('Send opens a pause, board choice opens the board, and its end card sends the waiting reply', async t => {
    const { doc, host } = await world(t);
    const blocked = await host.send('I attack the rat.', 'Not yet.');
    assert.equal(blocked.aborted, true);
    await settle();
    let fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.ok(fight?.querySelector('.rpg-fight-pause-board'));
    const secondSend = { target: { closest: selector => selector === '#send_but' ? {} : null }, prevented: false,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, stopPropagation() {} };
    for (const entry of doc.listeners.filter(item => item.type === 'click' && item.capture)) entry.fn(secondSend);
    assert.equal(secondSend.prevented, true, 'a second user message cannot replace the waiting one');
    fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    fight.querySelector('.rpg-fight-pause-board').click();
    await settle();
    fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.ok(fight.querySelector('.rpg-board-choice'));
    assert.equal((await host.st.generate('regenerate', { reply: 'Too early.' })).aborted, true);
    const meta = host.ctx.chatMetadata;
    let result;
    for (let i = 0; i < 20; i += 1) {
        result = stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 1 }]);
        assert.equal(result.error, undefined);
        if (result.preview.result.stop !== 'open') break;
    }
    assert.notEqual(result.preview.result.stop, 'open');
    host.ctx.generate = type => host.st.generate(type, { reply: 'The fight is told.' });
    host.events.emit('head', { index: host.store.headIndex() });
    await settle();
    fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.ok(fight.querySelector('.rpg-board-send'));
    fight.querySelector('.rpg-board-send').click();
    await settle();
    assert.equal(host.ctx.chat.at(-1).mes, 'The fight is told.');
    assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
    assert.ok(!boardSession(meta) || boardSession(meta).anchor === host.store.carrierSid(host.store.headIndex()));
});

test('a planner opening shows the working screen and then the rolled approach', async t => {
    let finish;
    const callModel = () => new Promise(resolve => { finish = resolve; });
    const { doc, host } = await page(t, { formula: 'standard', callModel });
    await begin(host);
    await makeBlocks(host, { character: { agi: 20 }, skills: { skill1: 'Sneak', stat1: 'agi', about1: 'hide before a fight' } });
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    const sending = host.send('I sneak up and attack the rats.', 'Not yet.');
    await settle();
    assert.equal(typeof finish, 'function');
    assert.match(doc.querySelector('.rpg-fight-pause').textContent, /Working out the fight/);
    finish('foe Rats | new | count: 1 | level: 2\ncheck Wessel | skill: Sneak | type: check | difficulty: normal | ambush\nact Wessel | target: Rats | type: physical');
    assert.equal((await sending).aborted, true);
    await settle();
    const pause = doc.querySelector('.rpg-fight-pause');
    assert.match(pause.textContent, /Rats/);
    assert.match(pause.textContent, /Approach checks/);
    assert.match(pause.textContent, /Sneak/);
    pause.querySelector('.rpg-fight-pause-board').click();
    await settle();
    assert.ok(doc.querySelector('.rpg-board-choice'));
    assert.equal(boardSession(host.ctx.chatMetadata).setup.approach.length, 1);
});
