// After a finished board fight the reply may open a new foe group (set-slot + a start line); an open fight keeps clears only.
// Reinforcements (a group's count rising, a slot refilled) make the offer under the reply that did it; an unchanged group does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { boardReplyGrammar } from '../../../../src/v2/lean-rpg/index.js';
import { readSheet } from '../../../../src/v2/lean-rpg/index.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { boardSession, openBoard } from '../../../../src/v2/lean-rpg/board/session.js';
import { createFightOffers } from '../../../../src/v2/lean-rpg/board/offers.js';

async function world() {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set(CORE_FEATURE.leanRpg, true);
    host.features.set(CORE_FEATURE.fightBoard, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 5 } })).ok, true);
    return host;
}
const line = text => `Story.\n<Changes>\n+ dm foes — ${text}\n</Changes>`;
const offerIndex = host => createFightOffers({ ctx: host.ctx, store: host.store, meta: () => host.ctx.chatMetadata, on: () => true }).find()?.index ?? null;

test('a finished fight allows set-slot for a new group and the start line; an open fight and a quiet reply do not', async () => {
    const host = await world();
    try {
        const state = host.store.head();
        const open = boardReplyGrammar(state, { fight: true }).join('\n');
        assert.doesNotMatch(open, /kind: set-slot-N/);
        assert.doesNotMatch(open, /new group arrives after this fight/);
        for (const stop of ['won', 'fled', 'lost']) {
            const text = boardReplyGrammar(state, { fight: true, ended: true }).join('\n');
            assert.match(text, /kind: set-slot-N/, stop);
            assert.match(text, /kind: clear-N/);
            assert.doesNotMatch(text, /kind: hurt-N/, 'code still moves the health');
            assert.match(text, /If a new group arrives after this fight, set a foe slot; a new fight starts on the board, so tell no blows\./);
        }
        assert.match(boardReplyGrammar(state, { fight: true, ended: true, manual: true }).join('\n'), /kind: hurt-N/);
    } finally { host.close(); }
});

test('a group whose count rises or a slot set again shows the offer under the reply that did it; an unchanged group does not', async () => {
    const host = await world();
    try {
        await host.send('Rats.', line('rats | kind: set-slot-1 | name: Rat | count: 2 | level: 1'));
        const first = host.store.headIndex();
        assert.equal(offerIndex(host), first);
        await host.send('Wait.', 'Nothing changes.');
        assert.equal(offerIndex(host), first, 'an unchanged group keeps its first offer');
        await host.send('More.', line('more rats | kind: set-slot-1 | name: Rat | count: 5 | level: 1'));
        const grown = host.store.headIndex();
        assert.equal(offerIndex(host), grown, 'a rising count is a new arrival');
        await host.send('Wait.', 'Still there.');
        assert.equal(offerIndex(host), grown);
        await host.send('Again.', `Story.\n<Changes>\n+ dm foes — gone | kind: clear-1\n+ dm foes — again | kind: set-slot-1 | name: Rat | count: 5 | level: 1\n</Changes>`);
        assert.equal(offerIndex(host), host.store.headIndex(), 'a slot cleared and set again, same name, is a new arrival');
    } finally { host.close(); }
});

test('a foe healing (same count, Health back up) is not a new arrival and moves no offer', async () => {
    const host = await world();
    try {
        await host.send('Rats.', line('rats | kind: set-slot-1 | name: Rat | count: 2 | level: 1'));
        const first = host.store.headIndex();
        const health = () => readSheet(host.store.head()).foes[0].hurt;
        const mod = Object.keys(host.store.head().domains.dataModules.active).find(id => /foes/.test(id));
        assert.equal((await host.sdk.command('dm.set', { module: mod, fields: { hurt1: 1 } })).ok, true);
        const low = health();
        assert.equal(offerIndex(host), first);
        await host.send('Heal.', 'Story.');
        assert.equal((await host.sdk.command('dm.set', { module: mod, fields: { hurt1: 5 } })).ok, true);
        assert.ok(health() > low, 'the foe really healed');
        assert.equal(offerIndex(host), first, 'Health rising with the count unchanged keeps the first offer');
    } finally { host.close(); }
});

test('a board carried on from an earlier fight does not hide the offer of a new group; one the reader opened on the reply, or with staged exchanges, does', async () => {
    const host = await world();
    try {
        const arrives = n => `Story.\n<Changes>\n- dm foes — gone | kind: clear-1 | why: gone\n+ dm foes — new | kind: set-slot-1 | name: Bandit ${n} | count: 1 | level: 1\n~ dm foes — blow | kind: hurt-1 | to: Hurt\n</Changes>`;
        await host.send('Scout.', arrives(1));
        const meta = host.ctx.chatMetadata, sid = () => host.store.carrierSid(host.store.headIndex());
        assert.equal(offerIndex(host), host.store.headIndex());
        // The reader opened the board on this reply.
        const opened = openBoard(meta, host.head(), { sid: sid(), rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        assert.equal(opened.error, undefined);
        assert.equal(offerIndex(host), null, 'a board the reader opened on this very reply is the fight in hand');
        await host.send('Scout again.', arrives(2));
        assert.equal(boardSession(meta)?.idle, true, 'the empty session follows the reply without a fight receipt');
        assert.equal(offerIndex(host), host.store.headIndex(), 'the new group arrived after it: it gets its offer');
        boardSession(meta).exchanges.push({ actions: [] });
        assert.equal(offerIndex(host), null, 'staged exchanges are never clobbered by an offer');
    } finally { host.close(); }
});

test('a carried board with no new group does not bring the offer back under the reply that started the fight', async () => {
    const host = await world();
    try {
        const arrives = `Story.\n<Changes>\n- dm foes — gone | kind: clear-1 | why: gone\n+ dm foes — new | kind: set-slot-1 | name: Bandit | count: 1 | level: 1\n~ dm foes — blow | kind: hurt-1 | to: Hurt\n</Changes>`;
        await host.send('Scout.', arrives);
        const meta = host.ctx.chatMetadata;
        assert.equal(openBoard(meta, host.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules: { ...STANDARD_FORMULA, levelDivisor: 5 } }).error, undefined);
        await host.send('Wait.', 'Nothing changes.');
        assert.equal(boardSession(meta)?.idle, true, 'the empty session follows the reply without a fight receipt');
        assert.equal(offerIndex(host), null, 'the fight in hand is not offered again under its first reply');
    } finally { host.close(); }
});

test('six groups: the narrator can set slots five and six, and the fight board opens on all six groups', async () => {
    const host = await world();
    try {
        const arrive = (n, name, count) => `+ dm foes — ${name} | kind: set-slot-${n} | name: ${name} | count: ${count} | level: 1`;
        const text = `Story.\n<Changes>\n${[arrive(1, 'Ant', 1), arrive(2, 'Bee', 2), arrive(3, 'Cat', 1), arrive(4, 'Dog', 6), arrive(5, 'Eel', 7), arrive(6, 'Fox', 2)].join('\n')}\n</Changes>`;
        await host.send('Six.', text);
        const sheet = readSheet(host.head());
        assert.deepEqual(sheet.foes.map(foe => [foe.slot, foe.name, foe.count]), [[1, 'Ant', 1], [2, 'Bee', 2], [3, 'Cat', 1], [4, 'Dog', 6], [5, 'Eel', 7], [6, 'Fox', 2]]);
        const sid = host.store.carrierSid(host.store.headIndex());
        const opened = openBoard(host.ctx.chatMetadata, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        assert.equal(opened.error, undefined, opened.error);
        assert.equal(opened.session.setup.foesSix, 1);
        assert.deepEqual(opened.session.groups, [1, 2, 3, 4, 5, 6]);
        const members = opened.preview.result.members;
        assert.equal(members.filter(member => member.group === 4 && !member.pack).length, 6, 'a group of six is six bars');
        assert.equal(members.filter(member => member.group === 5 && member.pack).length, 1, 'a group of seven is one pack');
    } finally { host.close(); }
});

test('six groups: an older Foes block with four slots is read as before and has no slots five or six', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set(CORE_FEATURE.leanRpg, true);
    host.features.set(CORE_FEATURE.fightBoard, true);
    try {
        await host.send('Begin.', 'Opening.');
        for (const { definition } of STANDARD_TEMPLATES) {
            const copy = structuredClone(definition);
            if (copy.role === 'foes') {
                for (const n of [5, 6]) {
                    for (const key of ['foe', 'count', 'level', 'hurt']) delete copy.state[`${key}${n}`];
                    for (const key of ['set-slot', 'hurt', 'clear']) delete copy.kinds[`${key}-${n}`];
                }
                copy.prompt = copy.prompt.replace('six', 'four');
            }
            assert.equal((await host.sdk.command('dm.define', { definition: copy })).ok, true);
        }
        await host.send('One.', `Story.\n<Changes>\n+ dm foes — Ant | kind: set-slot-1 | name: Ant | count: 1 | level: 1\n</Changes>`);
        const sheet = readSheet(host.head());
        assert.deepEqual(sheet.foes.map(foe => [foe.slot, foe.local]), [[1, undefined], [2, undefined], [3, undefined], [4, undefined]], 'four slots, none invented for five and six, and no new keys on them (the fight witness hashes the sheet)');
        assert.equal(sheet.foes[0].name, 'Ant');
    } finally { host.close(); }
});
