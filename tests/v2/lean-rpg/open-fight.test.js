// A fight that starts and is rolled in the same reply (stage 47): the pre-call may list foes that are not on the Foes block (`foe <name> |
// new | count | class`); code checks them, fills a slot through the block's own set-slot kind as part of the reply's roll, and the dice go
// on as for any fight. Swipe, Re-read, delete, rebuild and reload agree; the narrator's own slot line for the same foes does not double them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_FEATURE, OPEN_FIGHT_LINE, NO_ROLLS_LINE, readSheet, validatePlan, leanRpgGuard, RESOLVE } from '../../../src/v2/lean-rpg/index.js';
import { legacyPlanner, openLinesOf } from './legacy-planner.js';
import { openFoes, vetOpen, isNamedIn } from '../../../src/v2/lean-rpg/open.js';
import { readResolve } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { hashJson as hashOf } from '../../../src/v2/replay.js';
import { createFakeModel } from '../../../testkit/model.js';
import { reply, success } from '../data-modules/helpers.js';
import { cueOf, PARTY, foeBlock, rollReceipt, setup, sheetDomain, tailOf } from './helpers.js';

// The RPG library is cached for the whole process, so the test-only legacy planner reads the world of the test now running.
const live = { host: null, model: null };
const planned = async () => {
    const lib = await import('../../../src/v2/lean-rpg/index.js');
    return { ...lib, createLeanRpgPart(deps) { const part = lib.createLeanRpgPart(deps); part.hooks.beforeGenerate = legacyPlanner(part, { callModel: (...args) => live.model(...args), chat: () => live.host.ctx.chat, metadata: () => live.host.ctx.chatMetadata ?? null }); return part; } };
};
const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MESSAGE = 'Mud-scale crawlers boil out of the silt. I ambush them with Iron Breath.';
const OPEN = [
    'pace: normal',
    'foe Mud-Scale Crawlers | new | count: 6 | class: I',
    'act Wessel | skill: Iron Breath | target: Mud-Scale Crawlers | edge: +2 ambush',
    'foe Mud-Scale Crawlers | target: Wessel | defend: AGI',
].join('\n');
const empty = () => { const blocks = PARTY(); blocks.foes.fields = { ...foeBlock([]), count1: 0, count2: 0, count3: 0, count4: 0, class1: 1, class2: 1, class3: 1, class4: 1, hurt1: 5, hurt2: 5, hurt3: 5, hurt4: 5 }; return blocks; };
const fieldsOf = (host, slug = 'foes') => host.head().domains.dataModules.instances[`pack.chat/${slug}`].chat.fields;
const rolled = host => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === RESOLVE);

function same(host, label = 'a rebuild') {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${label} gives the live story`);
}
async function reloads(host) {
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live story');
    assert.deepEqual(host.store.problems(), []);
}

test('an empty Foes block and a reader message naming crawlers: the slot is filled, the dice are rolled, the battle record and panel model are there', { skip }, async () => {
    const { host, callModel, problems } = await setup({ blocks: empty(), answers: [OPEN] });
    const { request } = await host.send(MESSAGE, 'The silt churns.');
    assert.deepEqual(problems, []);
    const fields = fieldsOf(host);
    assert.deepEqual([fields.foe1, fields.count1, fields.level1], ['Mud-Scale Crawlers', 6, 5]);
    // (the dice are random per run: this reply's hits may have hurt the group, so its health is only held to the block's 0..5)
    assert.ok(fields.hurt1 >= 0 && fields.hurt1 <= 5);
    const receipt = rollReceipt(host, 2);
    assert.ok(receipt, 'rolled');
    assert.equal(receipt.beforeGenerate, true);
    const result = receipt.data.v2.result;
    assert.deepEqual(result.opened, [{ slot: 1, module: 'pack.chat/foes', name: 'Mud-Scale Crawlers', count: 6, level: 5 }]);
    assert.ok(result.rounds.length >= 1 && result.rounds[0].lines.some(line => line.kind === 'act' && line.foe.name === 'Mud-Scale Crawlers'));
    // (PRACTICE-FIX 4: the answer's "+2 ambush" has no ambush check behind it, so no edge)
    assert.equal(result.rounds[0].lines.some(line => line.pc.edge === 2), false, 'no ambush edge without an ambush check');
    const model = readResolve(result);
    assert.ok(model && model.rounds.length >= 1, 'the [battle] panel model');
    assert.ok(tailOf(request).includes(`[Happened]\n${cueOf(receipt)}`));
    assert.ok(!tailOf(request).includes(OPEN_FIGHT_LINE) && !tailOf(request).includes(NO_ROLLS_LINE));
    assert.equal(rolled(host).length, 1);
    assert.equal(host.head().meta.claims[`rpg:resolve:${result.key}`], true);
    same(host);
    await reloads(host);
    host.close();
});

test('the shown text of the reply before also counts as naming a foe, and a foe neither names is refused', () => {
    const sheet = readSheet({ domains: { dataModules: sheetDomain(empty()) } });
    const crawlers = [{ name: 'Mud-Scale Crawlers', count: '6', class: 'I' }];
    assert.equal(vetOpen(crawlers, sheet, ['I advance.', 'Crawlers stir in the silt below.']).open.length, 1);
    assert.equal(vetOpen(crawlers, sheet, ['I advance.', 'Nothing stirs.']).open.length, 0);
});

test('the checks: whole words, plurals, small words, count 1-12, the level as written (an old class stands for its level), a name already on the sheet is not new', () => {
    assert.equal(isNamedIn('the Crawlers', ['A crawler bites.']), true, 'plural ignored, "the" does not count');
    assert.equal(isNamedIn('the Crawlers', ['The end of the road.']), false, '"the" alone is not a name');
    assert.equal(isNamedIn('Rats', ['pirates and crates']), false, 'whole words only');
    assert.equal(isNamedIn('Mud-Scale Crawlers', ['mud everywhere']), true, 'one distinctive word is enough');
    const sheet = readSheet({ domains: { dataModules: sheetDomain(PARTY()) } });
    const text = ['goblins and rats and wolves and ogres'];
    const vetted = vetOpen([
        { name: 'Goblins', count: '40', level: '120' }, { name: 'Wolves', count: '0', class: '' }, { name: 'Ogres', count: 'many', class: 'II' },
        { name: 'Sluice Rats', count: '3', class: 'I' }, { name: 'Dragons', count: '1', class: 'I' },
    ], sheet, text);
    assert.deepEqual(vetted.open, [{ name: 'Goblins', count: 12, level: 25 }, { name: 'Wolves', count: 1 }, { name: 'Ogres', count: 1, level: 15 }], 'level held to the party\'s highest (15) + 10, none left to be drawn, class II is level 15; Sluice Rats is on the sheet already');
    assert.deepEqual(vetted.refused.map(entry => entry.name), ['Dragons']);
    assert.deepEqual(openLinesOf('pace: normal\nfoe Goblins | new | count: 3 | class: II\nfoe Rats | target: Wessel'), [{ name: 'Goblins', count: '3', class: 'II' }]);
    assert.deepEqual(openLinesOf('foe Goblins | new | count: 3 | level: 14 | rank: E'), [{ name: 'Goblins', count: '3', level: '14', rank: 'E' }]);
    assert.equal(validatePlan({ pace: 'normal', open: [{ name: 'A', count: 1000, class: 1 }] }).ok, false);
    assert.equal(validatePlan({ pace: 'normal', open: [{ name: 'A', count: 2, class: 1 }] }).ok, true);
});

test('count and level are held when the plan is rolled', { skip }, async () => {
    const answer = ['foe Mud-Scale Crawlers | new | count: 40 | level: 150', 'act Wessel | skill: Iron Breath | target: Mud-Scale Crawlers'].join('\n');
    const { host } = await setup({ blocks: empty(), answers: [answer] });
    await host.send(MESSAGE, 'The silt churns.');
    const fields = fieldsOf(host);
    assert.deepEqual([fields.count1, fields.level1], [12, 25], 'at most 12, and level 25: the party\'s highest is 15, plus 10');
    host.close();
});

test('with no free slot the new foe is refused and the plan is judged as today', { skip }, async () => {
    const blocks = PARTY();
    blocks.foes.fields = foeBlock([['A', 1], ['B', 1], ['C', 1], ['D', 1]]);
    const { host } = await setup({ blocks, answers: [OPEN] });
    await host.send(MESSAGE, 'The silt churns.');
    const [receipt] = rolled(host);
    assert.equal(receipt?.data.v2.result.opened, undefined);
    host.close();
});

test('swipe plans again, Re-read keeps the dice and the slot, delete takes the foes back, rebuild = live = reload', { skip }, async () => {
    const second = OPEN.replace('count: 6', 'count: 3');
    const { host, callModel } = await setup({ blocks: empty(), answers: [OPEN, second] });
    await host.send(MESSAGE, 'The silt churns.');
    const first = rollReceipt(host, 2);
    const before = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(callModel.calls.length, 1);
    assert.deepEqual(rollReceipt(host, 2).data.v2.result, first.data.v2.result, 'same dice and same opening');
    assert.equal(rollReceipt(host, 2).seed, first.seed);
    assert.equal(JSON.stringify(host.head()), before);
    await host.swipe('A second telling.');
    assert.equal(callModel.calls.length, 2, 'a swipe plans anew');
    assert.deepEqual([fieldsOf(host).foe1, fieldsOf(host).count1, fieldsOf(host).foe2], ['Mud-Scale Crawlers', 3, ''], 'one group of 3: the swiped-away opening is gone');
    assert.equal(rolled(host).length, 1);
    same(host);
    await reloads(host);
    await host.st.deleteMessage(2);
    assert.deepEqual([fieldsOf(host).foe1, fieldsOf(host).count1], ['', 0], 'deleted with the reply');
    assert.equal(host.head().meta.claims?.[`rpg:resolve:${first.data.v2.result.key}`], undefined);
    same(host, 'a rebuild after the delete');
    await reloads(host);
    host.close();
});

test('a middle delete: removing the reply that opened the fight takes the foes with it and the later roll is planned again on what is left', { skip }, async () => {
    const next = ['act Wessel | skill: Iron Breath | target: Mud-Scale Crawlers', 'foe Mud-Scale Crawlers | target: Wessel | defend: AGI'].join('\n');
    const { host } = await setup({ blocks: empty(), answers: [OPEN, next] });
    await host.send(MESSAGE, 'The silt churns.');
    await host.send('I strike the crawlers again.', 'They fall back.');
    assert.equal(rolled(host).length, 2);
    same(host);
    await host.st.deleteMessage(2);
    assert.deepEqual(host.store.problems(), [], 'nothing is left inactive');
    same(host, 'a rebuild after the middle delete');
    await reloads(host);
    assert.equal(fieldsOf(host).count1, 0, 'the crawlers went with the reply that brought them');
    host.close();
});

test('no foe filled and no rolls (the planner says none): the narrator is told to set the Foes line and stop at the first clash; with foes filled, or the RPG off, it is not', { skip }, async () => {
    const quiet = await setup({ blocks: empty(), answers: ['none'] });
    const sent = await quiet.host.send('I thank the guard.', 'He nods.');
    assert.ok(tailOf(sent.request).includes(OPEN_FIGHT_LINE));
    assert.deepEqual(rolled(quiet.host), []);
    quiet.host.close();
    const filled = await setup({ answers: ['none'] });
    const fight = await filled.host.send('I thank the guard.', 'He nods.');
    assert.ok(!tailOf(fight.request).includes(OPEN_FIGHT_LINE));
    filled.host.close();
    const off = await setup({ blocks: empty(), answers: ['none'], feature: false });
    const none = await off.host.send('I thank the guard.', 'He nods.');
    assert.ok(!tailOf(none.request).includes(OPEN_FIGHT_LINE));
    assert.equal(off.callModel.calls.length, 0);
    off.host.close();
});

test('the replay guard asks the opened sheet: it holds on the same sheet and says so when the free slot is gone', { skip }, async () => {
    const { host } = await setup({ blocks: empty(), answers: [OPEN] });
    await host.send(MESSAGE, 'The silt churns.');
    const span = host.ctx.chat[2].extra.storySuite.spans.find(entry => entry.guard?.predicate?.kind === RESOLVE);
    const before = host.store.before(2);
    const ask = state => leanRpgGuard({ state, hash: hashOf }, { guard: span.guard, source: span.source, recorded: span.recorded });
    assert.deepEqual(ask(before), { ok: true });
    const taken = structuredClone(before);
    Object.assign(taken.domains.dataModules.instances['pack.chat/foes'].chat.fields, { foe1: 'A', count1: 1, foe2: 'B', count2: 1, foe3: 'C', count3: 1, foe4: 'D', count4: 1 });
    assert.equal(ask(taken).ok, false);
    host.close();
});

// ---- the narrator writes its own slot line for the same foes, on the real block engine --------------------------------

async function realWorld(t, answers, templates = STANDARD_TEMPLATES) {
    const model = createFakeModel(answers);
    // (the real host with the test-only legacy planner behind the RPG part's hook: the planner itself is gone)
    live.model = model;
    const host = await createHost({ callModel: model, lazyRpg: true, rpgLoad: planned });
    live.host = host;
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    host.features.set('story-block.fight-board', false);
    await host.send('Begin.', 'Opening.');
    for (const entry of templates.slice(0, 3)) success(await host.sdk.command('dm.define', { definition: structuredClone(entry.definition) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Wessel', level: 15 } }));
    return { host, model };
}

test('the narrator\'s own set-slot line for the same foes updates the opened group: one group, never two', { skip }, async t => {
    const { host, model } = await realWorld(t, [OPEN]);
    const slot = reply('+ dm foes — why | kind: set-slot-2 | name: Mud-Scale Crawlers | count: 5 | level: 5');
    await host.send(MESSAGE, slot);
    assert.equal(model.calls.length, 1);
    const fields = host.head().domains.dataModules.instances['pack.chat/foes'].chat.fields;
    assert.deepEqual([fields.foe1, fields.count1, fields.foe2, fields.count2], ['Mud-Scale Crawlers', 5, '', 0], 'slot 1 updated to 5, no second slot');
    assert.deepEqual(readSheet(host.head()).foes.filter(foe => foe.filled).map(foe => foe.name), ['Mud-Scale Crawlers']);
    assert.ok(rolled(host).length === 1);
    assert.deepEqual(host.store.problems(), []);
    same(host);
    await reloads(host);
});

test('the narrator\'s line for the same slot number is the same group too (not refused as taken)', { skip }, async t => {
    const { host } = await realWorld(t, [OPEN]);
    await host.send(MESSAGE, reply('+ dm foes — why | kind: set-slot-1 | name: mud-scale crawlers | count: 4 | level: 5'));
    const fields = host.head().domains.dataModules.instances['pack.chat/foes'].chat.fields;
    assert.deepEqual([fields.count1, fields.count2], [4, 0]);
    same(host);
});

test('a different name in the narrator\'s line is a second group as before', { skip }, async t => {
    const { host } = await realWorld(t, [OPEN]);
    await host.send(MESSAGE, reply('+ dm foes — why | kind: set-slot-2 | name: Silt Hound | count: 1 | level: 15'));
    const fields = host.head().domains.dataModules.instances['pack.chat/foes'].chat.fields;
    assert.deepEqual([fields.foe1, fields.foe2], ['Mud-Scale Crawlers', 'Silt Hound']);
});

test('the Standard formula: the opened group arrives through the Standard Foes block\'s own kind (health follows its level) and is rolled', { skip }, async t => {
    const answer = ['foe Mud-Scale Crawlers | new | count: 6 | level: 15', 'act Wessel | type: physical | target: Mud-Scale Crawlers', 'foe Mud-Scale Crawlers | target: Wessel'].join('\n');
    const { host } = await realWorld(t, [answer], STANDARD_TEMPLATES);
    await host.send(MESSAGE, 'The silt churns.');
    const fields = host.head().domains.dataModules.instances['pack.chat/foes'].chat.fields;
    assert.deepEqual([fields.foe1, fields.count1, fields.level1], ['Mud-Scale Crawlers', 6, 15]);
    assert.ok(fields.hurt1 <= 4, 'the told hits may have hurt it');
    // The slot as the block's kind fills it, before any dice: 4 + floor(level/30) blocks.
    const domain = structuredClone(host.head().domains.dataModules);
    Object.assign(domain.instances['pack.chat/foes'].chat.fields, { foe1: '', count1: 0, hurt1: 4 });
    assert.equal(openFoes(domain, [{ name: 'Wolves', count: 2, level: 65 }]).length, 1);
    assert.equal(domain.instances['pack.chat/foes'].chat.fields.hurt1, 6, '4 + floor(65/30)');
    assert.equal(rolled(host).length, 1);
    assert.deepEqual(rolled(host)[0].data.v2.result.opened.map(entry => entry.slot), [1]);
    same(host);
    await reloads(host);
});
