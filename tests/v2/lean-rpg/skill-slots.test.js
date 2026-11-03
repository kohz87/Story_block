// The Skills block never overwrites a slot (USER, 3 Nov): a `learn-N` line of a name some slot holds updates that slot, a new name goes to
// slot N if it is empty else the first free one, none free is refused (one Problems line); a `practice-N` whose reason names one of the
// character's skills is credited to that skill's slot. Receipts name the skill. live = swipe = Re-read = rebuild = reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES, STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply, success, view, rebuilt, reload } from '../data-modules/helpers.js';

const IAI = ' | name: Iaijutsu | about: Drawing cuts. | stat: dex | uses: stamina';
const SHADOW = ' | name: Shadow Cut | about: A cut from the dark. | stat: agi | uses: mana';
const learn = (n, extra, why = 'learned') => `~ dm skills — ${why} | kind: learn-${n}${extra}`;
const practice = (n, why, amount = 10) => `+ dm skills — ${why} | kind: practice-${n} | amount: ${amount}`;
const sheet = host => view(host, 'pack.chat/skills').chat;
async function story(t, templates = STANDARD_TEMPLATES) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    success(await host.sdk.command('dm.define', { definition: structuredClone(templates.find(entry => entry.name === 'Skills').definition) }));
    await host.send('Learn.', reply(learn(1, IAI)));
    return host;
}
const told = host => host.turn.problems().map(problem => problem.message);

for (const [label, templates] of [['Standard', STANDARD_TEMPLATES], ['Classic', LEAN_RPG_TEMPLATES]]) {
    test(`${label}: the USER's sequence: learn-1 of a new name goes to slot 2; practice-1 naming it goes to slot 2; learn-1 of the old name updates slot 1`, async t => {
        const host = await story(t, templates);
        await host.send('Learn.', reply(learn(1, SHADOW)));
        let s = sheet(host);
        assert.deepEqual([s.skill1, s.about1, s.stat1, s.uses1], ['Iaijutsu', 'Drawing cuts.', 'dex', 'stamina'], 'slot 1 is untouched');
        assert.deepEqual([s.skill2, s.about2, s.stat2, s.uses2], ['Shadow Cut', 'A cut from the dark.', 'agi', 'mana']);
        await host.send('Train.', reply(practice(1, 'Practiced Shadow Cut')));
        s = sheet(host);
        assert.deepEqual([s.practice1, s.practice2], [0, 10], 'credited to the slot of the skill named');
        await host.send('Train.', reply(practice(2, 'Practiced Iaijutsu in the yard', 7)));
        assert.deepEqual([sheet(host).practice1, sheet(host).practice2], [7, 10], 'and the other way round');
        await host.send('Train.', reply(practice(2, 'a long afternoon', 3)));
        assert.deepEqual([sheet(host).practice1, sheet(host).practice2], [7, 13], 'no skill named: slot N as written');
        await host.send('Again.', reply(learn(1, ' | name: iaijutsu | about: Sharper. | stat: str | uses: mana')));
        s = sheet(host);
        assert.deepEqual([s.skill1, s.about1, s.stat1, s.uses1, s.practice1], ['Iaijutsu', 'Sharper.', 'str', 'mana', 7], 'updated in place, practice kept, no swap');
        assert.deepEqual([s.skill2, s.about2], ['Shadow Cut', 'A cut from the dark.']);
        await host.send('Again.', reply(learn(3, ' | name: SHADOW  cut | about: Sharper still. | stat: agi | uses: mana')));
        assert.deepEqual([sheet(host).skill3, sheet(host).about2], ['', 'Sharper still.'], 'the name, ignoring case and spaces, finds its slot whatever N says');
        rebuilt(host);
        await reload(host);
    });
}

test('a new name goes to slot N when it is empty; a practice reason naming two skills, or none, is slot N as written', async t => {
    const host = await story(t);
    await host.send('Learn.', reply(learn(4, SHADOW)));
    assert.deepEqual([sheet(host).skill2, sheet(host).skill4], ['', 'Shadow Cut']);
    await host.send('Learn.', reply(learn(2, ' | name: Cut | about: A plain cut. | stat: str | uses: stamina')));
    assert.equal(sheet(host).skill2, 'Cut');
    await host.send('Train.', reply(practice(1, 'Practiced Shadow Cut and Iaijutsu')));
    assert.deepEqual([sheet(host).practice1, sheet(host).practice2, sheet(host).practice4], [10, 0, 0], 'two skills named: slot N');
    await host.send('Train.', reply(practice(1, 'Practiced Shadow Cut')));
    assert.deepEqual([sheet(host).practice4, sheet(host).practice2], [10, 0], 'Shadow Cut, not its part Cut');
    await host.send('Train.', reply(practice(3, 'nothing to name')));
    assert.equal(sheet(host).practice3, 0, 'slot 3 is empty: refused as before');
    rebuilt(host);
});

test('no free slot: refused with one Problems line, nothing is overwritten', async t => {
    const host = await story(t);
    for (const [n, name] of [[2, 'Two'], [3, 'Three'], [4, 'Four'], [5, 'Five']]) await host.send('Learn.', reply(learn(n, ` | name: ${name} | about: x. | stat: str | uses: stamina`)));
    assert.deepEqual([1, 2, 3, 4, 5].map(n => sheet(host)[`skill${n}`]), ['Iaijutsu', 'Two', 'Three', 'Four', 'Five']);
    await host.send('Learn.', reply(learn(1, SHADOW)));
    assert.deepEqual([1, 2, 3, 4, 5].map(n => sheet(host)[`skill${n}`]), ['Iaijutsu', 'Two', 'Three', 'Four', 'Five']);
    assert.equal(told(host).filter(text => text.includes('No free skill slot for Shadow Cut')).length, 1);
    await host.send('Learn.', reply(learn(5, ' | name: five | about: Updated. | stat: str | uses: stamina')));
    assert.equal(sheet(host).about5, 'Updated.', 'a known name still updates when the block is full');
});

test('receipts say which skill was learned or practised; a swipe, a Re-read and a delete replay the same', async t => {
    const host = await story(t);
    await host.send('Learn.', reply(learn(1, SHADOW)));
    const at = host.ctx.chat.length - 1;
    const receipt = () => host.ctx.chat[at].extra.storySuite.receipts.map(entry => entry.summary ?? entry.receipt?.summary ?? JSON.stringify(entry)).join(' ');
    assert.match(receipt(), /learn-2 \(Shadow Cut\)/);
    await host.send('Train.', reply(practice(1, 'Practiced Shadow Cut')));
    assert.match(host.ctx.chat.at(-1).extra.storySuite.receipts.map(entry => JSON.stringify(entry)).join(' '), /practice-2 \(Shadow Cut\)/);
    const after = JSON.stringify(sheet(host));
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(JSON.stringify(sheet(host)), after, 'Re-read');
    await host.swipe(reply(practice(2, 'Practiced Iaijutsu', 5)));
    assert.deepEqual([sheet(host).practice1, sheet(host).practice2], [5, 0], 'a swipe takes the first reply\'s credit back and applies its own');
    rebuilt(host);
    await reload(host);
    await host.st.deleteMessage(host.ctx.chat.length - 2);
    rebuilt(host);
});

test('the Standard Skills template guards learn-N itself (a filled slot refuses); Classic\'s definition is unchanged', () => {
    const standard = STANDARD_TEMPLATES.find(entry => entry.name === 'Skills').definition;
    const classic = LEAN_RPG_TEMPLATES.find(entry => entry.name === 'Skills').definition;
    for (const n of [1, 2, 3, 4, 5]) {
        assert.deepEqual(standard.kinds[`learn-${n}`].when, ['eq', ['get', [`skill${n}`]], '']);
        assert.equal(classic.kinds[`learn-${n}`].when, undefined);
        assert.deepEqual(standard.kinds[`practice-${n}`], classic.kinds[`practice-${n}`]);
    }
});
