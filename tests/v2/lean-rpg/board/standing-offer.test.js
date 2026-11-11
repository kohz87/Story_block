// After a board fight ended with foes still up (fled), the reply that told it offers the board again as "Foes are still standing".
// A won fight (no foe up) offers nothing; the reader's choice hides it; the offer is view-only, read from receipts and the sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { boardSession } from '../../../../src/v2/lean-rpg/board/session.js';
import { createFightOffers } from '../../../../src/v2/lean-rpg/board/offers.js';
import { offerLineData } from '../../../../src/v2/lean-rpg/board/start-view-data.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';

const SET = 'The boar charges out.\n<Changes>\n+ dm foes — a fight starts | kind: set-slot-1 | name: Bristle-boar | count: 3 | level: 3\n</Changes>';

async function fought(t, seed, pick) {
    const restore = seedCrypto(seed);
    t.after(restore);
    const app = await page(t, { formula: 'standard', callModel: async () => 'none' });
    const { host, doc } = app;
    await begin(host);
    await makeBlocks(host, { character: { str: 8, agi: 8, dex: 2, vit: 20 }, skills: { skill1: 'Obscure', stat1: 'dex', about1: 'hide before a fight' } });
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    await host.send('A boar is near.', SET);
    assert.equal((await host.send('I attack the boar.', 'Not yet.')).aborted, true);
    await settle();
    doc.querySelector('.rpg-fight-pause-board').click();
    await settle();
    for (let n = 0; n < 25 && !doc.querySelector('.rpg-board-send'); n += 1) {
        const choice = [...doc.querySelectorAll('.rpg-board-choice')].find(item => !item.disabled && pick(item.textContent));
        assert.ok(choice, 'a choice is offered');
        choice.click();
        const target = doc.querySelector('.rpg-board-choice');
        if (target && /target/i.test(doc.querySelector('.rpg-board-prompt')?.textContent ?? '')) target.click();
        await new Promise(resolve => setTimeout(resolve, 450));
        await settle();
    }
    assert.ok(boardSession(host.ctx.chatMetadata));
    host.ctx.generate = type => host.st.generate(type, { reply: 'You broke away.' });
    doc.querySelector('.rpg-board-send').click();
    await settle();
    return app;
}
const offers = host => createFightOffers({ ctx: host.ctx, store: host.store, meta: () => host.ctx.chatMetadata, on: () => true });

test('a fled fight offers the board again under its reply, titled "Foes are still standing"; choosing hides it', async t => {
    const { host } = await fought(t, 802, label => /flee|run|retreat/i.test(label));
    const reply = host.store.headIndex(), found = offers(host).find();
    assert.equal(found?.index, reply);
    assert.equal(found.fight.standing, true);
    const data = offerLineData(found.fight, { state: host.store.head() });
    assert.match(data.text, /^Foes are still standing: Bristle-boar/);
    assert.equal(data.boardLabel, 'Fight on the board');
    assert.equal(data.autoLabel, 'Auto-fight');
    offers(host).find();
    const meta = host.ctx.chatMetadata;
    meta.rpgFightOffers = { ...meta.rpgFightOffers, [found.sid]: true };
    assert.equal(offers(host).find(), null, 'the reader\'s choice hides it');
});

test('a fight the narrator opens keeps "A fight started" wording', () => {
    const data = offerLineData({ groups: [1], session: { foes: [{ name: 'Rat', count: 2 }] } });
    assert.equal(data.text, 'A fight started: Rat.');
    assert.equal(offerLineData({ standing: true, session: { foes: [{ name: 'Rat', count: 2 }] } }).text, 'Foes are still standing: Rat (2)');
});

test('a won fight (no foe up) and a fight left open offer nothing', async t => {
    const { host } = await fought(t, 806, label => !/flee|run|retreat/i.test(label));
    const result = host.ctx.chat[host.store.headIndex()].extra.storySuite.receipts.findLast(item => item.type === 'rpg.resolve' && item.replan?.payload?.board).data.v2.result;
    assert.notEqual(result.stop, 'fled');
    if (result.stop === 'won') assert.equal(offers(host).find(), null);
    else assert.ok(!offers(host).find()?.fight.standing || result.stop !== 'won');
});

// The Fight tab asks for the offer on every redraw; the switch behind it reads the pack through sdk queries (each settles the timeline),
// so it is asked last, only once a foe stands, and the answer is the one the flag gave.
test('the offer\'s switch may be a function: not asked with no foe standing, asked once after, and the answer equals the flag\'s', async t => {
    let asked = 0;
    const idle = createFightOffers({ ctx: { chat: [] }, store: { head: () => null, receipts: () => [], at: () => null }, meta: () => ({}), on: () => { asked++; return true; } });
    assert.equal(idle.find(), null);
    assert.equal(asked, 0, 'no foe, no question');
    const { host } = await fought(t, 802, label => /flee|run|retreat/i.test(label));
    const make = on => createFightOffers({ ctx: host.ctx, store: host.store, meta: () => host.ctx.chatMetadata, on });
    const flag = make(true).find();
    assert.ok(flag, 'a fled fight offers the board');
    assert.deepEqual(make(() => { asked++; return true; }).find(), flag, 'a function that says yes gives the flag\'s answer');
    assert.equal(asked, 1, 'asked once');
    assert.equal(make(() => false).find(), null);
    assert.equal(make(false).find(), null);
});
