// A won board fight pays its XP once even when the same reply's story opens a new foe group or clears the Down ones (the finished-fight grammar allows both),
// and a win that leaves the Foes block as it was pays exactly as before. Swipe, Re-read and rebuild keep the pay once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { fightHook, fightGuard, fightXp, groupsOf, memberXp } from '../../../../src/v2/lean-rpg/fight.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, levelFoeBlock, recordOf, sheetDomain } from '../helpers.js';

async function world() {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set(CORE_FEATURE.leanRpg, true);
    host.features.set(CORE_FEATURE.fightBoard, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 1, str: 20, agi: 20, vit: 20, health: 5 } })).ok, true);
    await host.send('Rats.', 'Rats.\n<Changes>\n+ dm foes — rats | kind: set-slot-1 | name: Tunnel Rat | count: 1 | level: 1\n</Changes>');
    return host;
}
const hero = host => host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
const fights = host => recordOf(host, host.store.headIndex()).receipts.filter(receipt => receipt.type === 'rpg.fight');
// stage attacks until the fight is won (another seed by discarding), then send them with the reply
async function winWith(host, story) {
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex()), rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
    for (let attempt = 0; attempt < 100; attempt += 1) {
        assert.equal(openBoard(meta, host.head(), { sid, rules }).error, undefined);
        let preview;
        for (let n = 0; n < 12; n += 1) {
            const target = readSheet(preview?.state ?? host.head()).foes.find(foe => foe.filled && foe.hurt > 0)?.slot;
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target }]);
            if (staged.error) break;
            preview = staged.preview;
            if (preview.result.stop !== 'open') break;
        }
        if (preview?.result.stop === 'won') return host.send('I strike.', story);
        discardBoard(meta);
    }
    throw new Error('no win found');
}
const NEW = 'Done.\n<Changes>\n+ dm foes — mother | kind: set-slot-2 | name: Grey-Tooth Nest-Mother | count: 1 | level: 11\n</Changes>';
const CLEAR = 'Done.\n<Changes>\n+ dm foes — gone | kind: clear-1\n</Changes>';

for (const [name, story] of [['a new group the narrator opens', NEW], ['the Down group the narrator clears', CLEAR]]) {
    test(`a board win still pays XP once when the same reply has ${name}`, async () => {
        const restore = seedCrypto(33), host = await world();
        try {
            const want = memberXp([{ count: 1, level: 1 }], 1);
            await winWith(host, story);
            assert.equal(hero(host).xp, want);
            assert.equal(fights(host).length, 1);
            const index = host.store.headIndex();
            await host.swipe('Another telling.\n' + story.split('\n').slice(1).join('\n'));
            assert.equal(hero(host).xp, want, 'a swipe keeps the pay once');
            assert.equal((await host.turn.reread(index)).ok, true);
            assert.equal(hero(host).xp, want, 'a Re-read keeps the pay once');
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
            assert.deepEqual(host.store.problems(), []);
        } finally { host.close(); restore(); }
    });
}

test('a board win that leaves the block as it was carries no groups (the record is what it was)', async () => {
    const restore = seedCrypto(34), host = await world();
    try {
        await winWith(host, 'Done.');
        assert.equal(hero(host).xp, memberXp([{ count: 1, level: 1 }], 1));
        const step = fights(host)[0];
        assert.equal(step.replan.payload.groups, undefined);
        assert.deepEqual(Object.keys(step.replan.payload), ['was']);
    } finally { host.close(); restore(); }
});

// fightHook on its own: the groups come from the sheet the reply began with, or from the roll's opened foes
const wonReceipt = (groups, opened) => ({ type: 'rpg.resolve', data: { v2: { result: { stop: 'won', board: { groups }, ...(opened ? { opened } : {}) } } } });
const viewOf = (now, before) => ({ feature: () => true, state: { domains: { dataModules: sheetDomain(now) } }, before: () => ({ domains: { dataModules: sheetDomain(before) } }), settings: () => ({}) });
const party = { hero: { role: 'character', fields: character('Astra', { level: 1 }) } };

test('fightHook: groups of a won board fight come from the sheet before the reply, or from the roll\'s opened foes', () => {
    const rats = levelFoeBlock([['Rats', 3, 5, 5]]), mother = levelFoeBlock([['Nest-Mother', 1, 5, 11]]);
    const standing = { ...party, foes: { role: 'foes', fields: rats } };
    // the narrator replaced slot 1 with a standing group: the fight's group is read from the sheet before the reply
    const replaced = { ...party, foes: { role: 'foes', fields: mother } };
    const out = fightHook(viewOf(replaced, standing), { type: 'normal', receipts: [wonReceipt([1])] });
    assert.deepEqual(out.commands[0].payload.groups, [{ slot: 1, name: 'Rats', count: 3, level: 5 }]);
    // a fight opened and won in this reply, then replaced: the roll's opened foes name it
    const none = { ...party, foes: { role: 'foes', fields: levelFoeBlock([]) } };
    const opened = fightHook(viewOf(replaced, none), { type: 'normal', receipts: [wonReceipt([1], [{ slot: 1, name: 'Wolves', count: 2, level: 3 }])] });
    assert.deepEqual(opened.commands[0].payload.groups, [{ slot: 1, name: 'Wolves', count: 2, level: 3 }]);
    // a lost or fled board fight pays nothing, and a win with no groups to name pays nothing
    assert.equal(fightHook(viewOf(replaced, standing), { type: 'normal', receipts: [{ type: 'rpg.resolve', data: { v2: { result: { stop: 'fled', board: { groups: [1] } } } } }] }), undefined);
    assert.equal(fightHook(viewOf(replaced, none), { type: 'normal', receipts: [wonReceipt([1])] }), undefined);
});

test('rpg.fight with groups: pays from them, refuses damaged ones, and the guard reads them', () => {
    const groups = [{ slot: 1, name: 'Rats', count: 3, level: 5 }];
    assert.deepEqual(groupsOf(groups, [1]), groups);
    for (const bad of [[], [{ ...groups[0], slot: 2 }], [{ ...groups[0], count: 0 }], [{ ...groups[0], level: 100 }], [groups[0], groups[0]], 'x']) assert.equal(groupsOf(bad, [1]), null);
    const domain = sheetDomain({ ...party, foes: { role: 'foes', fields: levelFoeBlock([['Nest-Mother', 1, 5, 11]]) } });
    domain.pins.h0.definition.state = { xp: { max: 100 } };
    const ctx = { cause: 'system', caller: null, source: {}, epoch: 1, module: 'm', read: () => domain, draft: () => domain, hash: value => JSON.stringify(value), replayGuard: () => {}, fail: (code, message) => { throw new Error(`${code} ${message}`); } };
    const result = fightXp(ctx, { was: [1], groups });
    assert.equal(domain.instances['pack.chat/hero'].chat.fields.xp, memberXp(groups, 1));
    assert.deepEqual(result.data.v2.result.fight.groups, groups);
    assert.throws(() => fightXp(ctx, { was: [1], groups: [{ ...groups[0], count: 0 }] }), /INVALID/);
    const state = { domains: { dataModules: domain } };
    const guard = { version: 2, rulesHash: null, predicate: { kind: 'rpg.fight' }, inputHash: null };
    assert.equal(fightGuard({ state, hash: ctx.hash }, { guard, source: {}, recorded: { was: [1], groups: [{ ...groups[0], count: 0 }] } }).ok, false);
});
