// The reply offer, tab alert and held-fight controls use the mounted production UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { boardSession, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';

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

test('choosing narration during planning resumes the same send without a second planner call', async t => {
    let finish, calls = 0;
    const callModel = () => { calls += 1; return new Promise(resolve => { finish = resolve; }); };
    const { doc, host } = await page(t, { formula: 'standard', callModel });
    await begin(host);
    await makeBlocks(host, { character: { agi: 20 }, skills: { skill1: 'Sneak', stat1: 'agi', about1: 'hide before a fight' } });
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    const sending = host.send('I sneak up and attack the rats.', 'The fight is narrated.');
    await settle();
    const button = doc.querySelector('.rpg-fight-pause-narrate');
    assert.ok(button);
    button.click();
    finish('foe Rats | new | count: 1 | level: 2\ncheck Wessel | skill: Sneak | type: check | difficulty: normal | ambush\nact Wessel | target: Rats | type: physical');
    const sent = await sending;
    assert.equal(sent.aborted, undefined);
    assert.equal(calls, 1);
    assert.equal(host.ctx.chat.at(-1).mes, 'The fight is narrated.');
    assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
});

for (const outcome of ['won', 'fled']) test(`one reply tells the approach, ${outcome} fight and outcome-aware aftermath`, async t => {
    const restore = seedCrypto(outcome === 'won' ? 730 : 731);
    t.after(restore);
    let calls = 0;
    const callModel = async () => {
        calls += 1;
        return 'foe Rats | new | count: 1 | level: 1\ncheck Wessel | skill: Obscure | type: check | difficulty: normal | ambush\nact Wessel | target: Rats | type: physical\nfoe Rats | target: Wessel';
    };
    const { doc, host } = await page(t, { formula: 'standard', callModel });
    await begin(host);
    await makeBlocks(host, { character: { str: 20, agi: 20, dex: 20, vit: 20 },
        skills: { skill1: 'Obscure', stat1: 'dex', about1: 'hide before a fight' } });
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    const before = host.ctx.chat.filter(message => !message.is_user).length;
    const original = 'I hide with Obscure, ambush the rats, then loot the nest and walk back to Surna.';
    assert.equal((await host.send(original, 'Not yet.')).aborted, true);
    await settle();
    assert.match(doc.querySelector('.rpg-fight-pause').textContent, /Obscure/);
    assert.ok(doc.querySelector('.rpg-fight-pause-narrate'));
    const opening = host.turn.fightStartPreview();
    doc.querySelector('.rpg-fight-pause-board').click();
    await settle();
    assert.ok(doc.querySelector('.rpg-board-choice'));
    const meta = host.ctx.chatMetadata;
    let staged;
    for (let n = 0; n < 30; n += 1) {
        staged = stageExchange(meta, opening.state, outcome === 'won'
            ? [{ who: 'Wessel', kind: 'attack', target: 1 }] : [{ who: 'Wessel', kind: 'flee' }]);
        assert.equal(staged.error, undefined);
        if (staged.preview.result.stop !== 'open') break;
    }
    assert.equal(staged.preview.result.stop, outcome);
    let generation;
    host.ctx.generate = type => { generation = host.st.generate(type, { reply: 'The approach, fight and aftermath.' }); return generation; };
    host.events.emit('head', { index: host.store.headIndex() });
    await settle();
    const button = doc.querySelector('.rpg-board-send');
    assert.ok(button);
    assert.equal(button.textContent, 'Send with this fight');
    button.click();
    const sent = await generation;
    assert.equal(sent.aborted, undefined);
    assert.equal(host.ctx.chat.filter(message => !message.is_user).length, before + 1);
    assert.equal(host.ctx.chat.filter(message => message.is_user && message.mes === original).length, 1);
    assert.equal(calls, 1);
    const prompt = sent.request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
    assert.match(prompt, /Wessel — Obscure \(DEX\), normal: (?:SUCCESS|SUCCESS AT A COST|FAIL) \(\d+ vs \d+\)/);
    assert.match(prompt, /Tell the approach, then the settled fight results in order/);
    assert.match(prompt, /Exchange 1/);
    assert.match(prompt, /write \[battle\] on its own line where the fight is told/i);
    assert.match(prompt, /Code has already moved the bars for these results; never set those yourself/);
    assert.match(prompt, outcome === 'won' ? /fight is won/ : /party fled/);
    assert.match(prompt, /aftermath.+outcome permits/);
    if (outcome === 'fled') assert.match(prompt, /do not assume the foes or their possessions are accessible/);
});
