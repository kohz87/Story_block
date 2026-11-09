// A person's Level field on their NPC State Delta dossier sets their foe level and passes the party + 20 cap; guessed levels stay capped.
// Pure parsing, each path that vets a level (pre-check vetGroups, the old planner's vetOpen), the narrator's foe line (stays capped: it re-runs on replay),
// and the replay rules: the stated level is read BEFORE the opening is recorded, so rebuild, Re-read, reload and swipe agree even after the field changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, setup, skillBlock } from '../helpers.js';
import { parseStatedLevel, statedLevel } from '../../../../src/v2/lean-rpg/board/stated-level.js';
import { vetGroups } from '../../../../src/v2/lean-rpg/board/precheck.js';
import { runPrecheck } from '../../../../src/v2/lean-rpg/board/precheck-run.js';
import { vetOpen } from '../../../../src/v2/lean-rpg/open.js';
import { boardSession, markSend, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { pendingStart } from '../../../../src/v2/turn/fight-start.js';

const RANKS = [{ name: 'F', from: 1, to: 9 }, { name: 'E', from: 10, to: 19 }, { name: 'D', from: 20, to: 29 }, { name: 'C', from: 30, to: 49 }, { name: 'S', from: 90, to: 94 }, { name: 'SS', from: 95, to: 99 }];
const rankAt = level => RANKS.find(rank => level >= rank.from && level <= rank.to) ?? null;
const party = { characters: [{ who: 'Astra', level: 2, alive: true }], foes: [] };

const world = ({ dossiers, ranks = RANKS } = {}) => (name, args) => {
    if (name === 'packs.content') return ranks ? [{ slug: 'ranks', ranks }] : [];
    if (name === 'rpg.rank') return ranks ? ranks.find(rank => args.level >= rank.from && args.level <= rank.to) ?? null : null;
    if (name === 'npc.known') return dossiers.map(entry => entry.name);
    if (name === 'npc.dossier') return dossiers.find(entry => entry.name === args.name) ?? null;
    return null;
};
const vorn = (level, extra = {}) => ({ name: 'Vorn', aliases: ['Branch Master'], customFields: level === undefined ? {} : { Level: level }, ...extra });
const vet = (query, name, level, message = `I attack ${name}.`) => vetGroups([{ name, count: 1, ...(level === undefined ? {} : { level }) }],
    { message, sheet: party, stated: found => statedLevel(query, found) });

test('the field forms: a number, Lv, level, a rank, two ranks; whole words only', () => {
    for (const [text, level] of [['30', 30], [' 7 ', 7], ['Lv 30', 30], ['lv. 30', 30], ['level 30', 30], ['Level 99', 99], ['1', 1]]) assert.deepEqual(parseStatedLevel(text, rankAt), { level }, text);
    assert.deepEqual(parseStatedLevel('C', rankAt), { rank: 'C', from: 30, to: 49 });
    assert.deepEqual(parseStatedLevel('rank c', rankAt), { rank: 'c', from: 30, to: 49 });
    assert.deepEqual(parseStatedLevel('C-D', rankAt), { rank: 'C', from: 20, to: 49 }, 'the whole span of two ranks, in either order');
    assert.deepEqual(parseStatedLevel('D or C', rankAt), { rank: 'D', from: 20, to: 49 });
    assert.deepEqual(parseStatedLevel('rank E to D', rankAt), { rank: 'E', from: 10, to: 29 });
    assert.deepEqual(parseStatedLevel('S', rankAt), { rank: 'S', from: 90, to: 94 }, 'S is a rank name');
    assert.deepEqual(parseStatedLevel('SS', rankAt), { rank: 'SS', from: 95, to: 99 }, 'SS is another');
    assert.deepEqual(parseStatedLevel('S or SS', rankAt), { rank: 'S', from: 90, to: 99 });
    for (const text of ['', '   ', 'high', 'Sage', 'strong C', 'C+', 'Z', 'C or Z', '0', '100', '-5', '3.5', 'level', 'rank', 'C-D-E', undefined, null, 30])
        if (text !== 30) assert.equal(parseStatedLevel(text, rankAt), null, String(text));
    assert.equal(parseStatedLevel('C', null), null, 'no ranks in the story: a rank is ignored');
    assert.equal(parseStatedLevel('C', () => { throw new Error('x'); }), null);
    assert.deepEqual(parseStatedLevel('30', null), { level: 30 }, 'a number needs no ranks');
});

test('field 30 at party level 2: 30 on the pre-check path, it beats the narrator\'s lower level and passes the cap', () => {
    const query = world({ dossiers: [vorn('30')] });
    assert.deepEqual(vet(query, 'Vorn', undefined), [{ name: 'Vorn', count: 1, level: 30 }]);
    assert.deepEqual(vet(query, 'Vorn', 5), [{ name: 'Vorn', count: 1, level: 30 }], 'wins over a lower level');
    assert.deepEqual(vet(query, 'Vorn', 99), [{ name: 'Vorn', count: 1, level: 30 }], 'and over a higher one');
    assert.deepEqual(vet(world({ dossiers: [vorn('level 30')] }), 'Vorn', 3), [{ name: 'Vorn', count: 1, level: 30 }]);
});

test('no field, an unmatched name, junk or no NSD: today\'s rules, capped at party + 20', () => {
    for (const query of [world({ dossiers: [vorn()] }), world({ dossiers: [vorn('high')] }), world({ dossiers: [vorn('')] }), world({ dossiers: [vorn('C'), ] , ranks: null }),
        world({ dossiers: [{ name: 'Vorn', customFields: { Rank: '30' } }] }), () => null, null, () => { throw new Error('boom'); }]) {
        assert.equal(vet(query, 'Vorn', 25)[0].level, 22, 'level 25 gives 22');
        assert.equal(vet(query, 'Vorn', 5)[0].level, 5);
        assert.equal(vet(query, 'Vorn', undefined)[0].level, 2);
    }
    assert.equal(vet(world({ dossiers: [vorn('30')] }), 'Dott', 25, 'I attack Dott.')[0].level, 22, 'a name that matches no dossier');
    assert.equal(vet(world({ dossiers: [vorn('30')] }), 'Vornic', 25, 'I attack Vornic.')[0].level, 22, 'whole words only');
});

test('a dossier matches by alias, and the field name is any case', () => {
    const query = world({ dossiers: [vorn(undefined, { customFields: { lEvEl: 'Lv 30' } })] });
    assert.equal(vet(query, 'Branch Master', 4, 'I attack the Branch Master.')[0].level, 30);
    assert.equal(vet(query, 'Branch Master Vorn and his men', 4, 'I attack Branch Master Vorn and his men.')[0].level, 30, 'a group whose name holds the person\'s name');
});

test('a rank field records the rank band; the draw is the resolver\'s seeded one', () => {
    const [group] = vet(world({ dossiers: [vorn('C')] }), 'Vorn', 3);
    assert.deepEqual(group, { name: 'Vorn', count: 1, rank: 'C', from: 30, to: 49 });
    assert.deepEqual(vet(world({ dossiers: [vorn('C-D')] }), 'Vorn', 3)[0], { name: 'Vorn', count: 1, rank: 'C', from: 20, to: 49 });
    assert.deepEqual(vet(world({ dossiers: [vorn('C')], ranks: null }), 'Vorn', 25)[0], { name: 'Vorn', count: 1, level: 22 }, 'a pack with no ranks: ignored');
});

test('the old planner\'s vetOpen honours it the same way, and keeps its cap otherwise', () => {
    const query = world({ dossiers: [vorn('30')] });
    const sheet = { characters: [{ who: 'Astra', level: 2 }], foes: [] };
    const run = (requested, options) => vetOpen(requested, sheet, ['I attack Vorn.'], options).open;
    assert.deepEqual(run([{ name: 'Vorn', level: '5' }], { rankAt, stated: name => statedLevel(query, name) }), [{ name: 'Vorn', count: 1, level: 30 }]);
    assert.deepEqual(run([{ name: 'Vorn', level: '25' }], { rankAt }), [{ name: 'Vorn', count: 1, level: 22 }]);
    assert.deepEqual(run([{ name: 'Vorn', level: '25' }], { rankAt, stated: () => null }), [{ name: 'Vorn', count: 1, level: 22 }]);
});

test('runPrecheck reads the field before anything is recorded; without a field the groups are byte-identical to the old ones', async () => {
    const answer = async () => '{"groups":[{"name":"Vorn","count":1,"level":25}]}';
    const withField = await runPrecheck({ message: 'I attack Vorn.', sheet: party, query: world({ dossiers: [vorn('30')] }), callModel: answer });
    assert.deepEqual(withField, [{ name: 'Vorn', count: 1, level: 30 }]);
    for (const query of [world({ dossiers: [vorn()] }), null]) {
        const plain = await runPrecheck({ message: 'I attack Vorn.', sheet: party, query, callModel: answer });
        assert.equal(JSON.stringify(plain), '[{"name":"Vorn","count":1,"level":22}]');
    }
});

// ---- replay: the whole chain on a host -----------------------------------------------------------------------------------------------------------------------
const lvlFoes = () => ({ ...foeBlock([], 'level'), count1: 0, count2: 0, count3: 0, count4: 0 });
const blocks = () => ({
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 5, level: 2 }) },
    skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'cut one foe']]) },
    foes: { role: 'foes', fields: lvlFoes() },
});
const GROUPS = JSON.stringify({ groups: [{ name: 'Vorn', count: 1, level: 4 }] });
const foesOf = host => host.head().domains.dataModules.instances['pack.chat/foes']?.chat.fields;

async function fought(dossiers, seed, answers = [GROUPS]) {
    const restore = seedCrypto(seed);
    const { host, callModel } = await setup({ blocks: blocks(), board: true, planner: false, precheck: true, answers,
        queries: { 'npc.known': () => dossiers.map(entry => entry.name), 'npc.dossier': (_state, args) => dossiers.find(entry => entry.name === args.name) ?? null,
            'packs.content': () => [{ slug: 'ranks', ranks: RANKS }], 'rpg.rank': (_state, args) => rankAt(args.level) } });
    assert.equal((await host.send('I draw my blade and attack Vorn.', 'Not sent.')).aborted, true);
    const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat), opening = host.turn.fightStartPreview();
    const { openBoard } = await import('../../../../src/v2/lean-rpg/board/session.js');
    const { STANDARD_FORMULA } = await import('../../../../src/v2/lean-rpg/rules.js');
    const { dropOf } = await import('../../../../src/v2/lean-rpg/ambush.js');
    const open = openBoard(meta, opening.state, { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
    assert.equal(open.error, undefined, open.error);
    Object.assign(open.session.setup, { opening: structuredClone(pending.opening), approach: structuredClone(opening.result.checks ?? []), drop: dropOf(opening.result) });
    pending.choice = 'board';
    assert.equal(stageExchange(meta, opening.state, [{ who: 'Astra', kind: 'attack', target: 1 }]).error, undefined);
    assert.equal(markSend(meta, pending, boardSession(meta)), true);
    const sent = await host.st.generate('regenerate', { reply: 'Vorn staggers.' });
    return { host, callModel, sent, pending, restore };
}

test('field 30 at party level 2 reaches the Foes block as 30; replay == live, also after the field is changed or removed; swipe keeps it', async () => {
    const dossiers = [vorn('30')];
    const { host, callModel, sent, restore } = await fought(dossiers, 811);
    try {
        assert.equal(foesOf(host).level1, 30);
        const opening = () => host.ctx.chat.at(-1).extra.storySuite.receipts.filter(receipt => receipt.type === 'rpg.resolve')[0].replan.payload.plan.open;
        assert.deepEqual(opening(), [{ name: 'Vorn', count: 1, level: 30 }], 'the stated level is recorded in the opening');
        const live = JSON.stringify(host.head());
        dossiers[0] = vorn('8');
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild after the field changed');
        dossiers.length = 0;
        await host.turn.reread(sent.index);
        assert.equal(JSON.stringify(host.head()), live, 'Re-read after the person is gone');
        await host.st.loadChat(structuredClone(host.ctx.chat), 'stated-level');
        assert.equal(JSON.stringify(host.head()), live, 'reload');
        assert.equal(foesOf(host).level1, 30);
        assert.equal((await host.swipe('Another telling.')).aborted, undefined);
        assert.deepEqual(opening(), [{ name: 'Vorn', count: 1, level: 30 }], 'a swipe keeps the recorded opening');
        assert.equal(foesOf(host).level1, 30);
        assert.equal(callModel.calls.length, 1, 'no second model call');
    } finally { host.close(); restore(); }
});

test('a rank field is drawn once from the reply\'s seed, inside the band, and replay keeps the drawn level', async () => {
    const dossiers = [vorn('C-D')];
    const { host, restore, sent } = await fought(dossiers, 812);
    try {
        const level = foesOf(host).level1;
        assert.ok(level >= 20 && level <= 49, `drawn inside C-D: ${level}`);
        const live = JSON.stringify(host.head());
        dossiers.length = 0;
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        await host.turn.reread(sent.index);
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal(foesOf(host).level1, level);
    } finally { host.close(); restore(); }
});

test('no Level field: the fight is as before (level 4 stays, a model\'s 25 becomes 22) and the record has no band', async () => {
    const plain = await fought([vorn()], 813);
    try {
        assert.equal(foesOf(plain.host).level1, 4);
        assert.deepEqual(plain.host.ctx.chat.at(-1).extra.storySuite.receipts.filter(receipt => receipt.type === 'rpg.resolve')[0].replan.payload.plan.open, [{ name: 'Vorn', count: 1, level: 4 }]);
    } finally { plain.host.close(); plain.restore(); }
    const high = await fought([], 814, [JSON.stringify({ groups: [{ name: 'Vorn', count: 1, level: 25 }] })]);
    try { assert.equal(foesOf(high.host).level1, 22); } finally { high.host.close(); high.restore(); }
});

test('a group of several named after the person keeps the normal rules: the Level is one person\'s', () => {
    const stated = () => ({ level: 30 });
    const groups = count => vetGroups([{ name: 'Vorn', count, level: 25 }], { message: 'I attack Vorn.', sheet: { characters: [{ who: 'Astra', level: 2 }], foes: [] }, stated });
    assert.equal(groups(1)[0].level, 30);
    assert.equal(groups(5)[0].level, 22);
});
