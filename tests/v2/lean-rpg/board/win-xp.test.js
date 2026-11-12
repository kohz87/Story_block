// A won board fight pays its XP once even when the same reply's story opens a new foe group or clears the Down ones (the finished-fight grammar allows both),
// and a win that leaves the Foes block as it was pays exactly as before. Swipe, Re-read and rebuild keep the pay once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../../src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { fightHook, fightGuard, fightXp, groupsOf, memberXp, openedSlots } from '../../../../src/v2/lean-rpg/fight.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, levelFoeBlock, recordOf, sheetDomain } from '../helpers.js';

async function world({ old = false, level = 1, health = 5, foeLevel = level } = {}) {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set(CORE_FEATURE.leanRpg, true);
    host.features.set(CORE_FEATURE.fightBoard, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(old && definition.role === 'character' ? characterV1For() : definition) })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level, str: 20, agi: 20, vit: 20, health } })).ok, true);
    await host.send('Rats.', `Rats.\n<Changes>\n+ dm foes — rats | kind: set-slot-1 | name: Tunnel Rat | count: 1 | level: ${foeLevel}\n</Changes>`);
    return host;
}
const hero = host => host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
const fights = host => recordOf(host, host.store.headIndex()).receipts.filter(receipt => receipt.type === 'rpg.fight');
// stage attacks until the fight is won (another seed by discarding), then send them with the reply
async function winWith(host, story, { marked = false, how = 'won' } = {}) {
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex()), rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const opened = openBoard(meta, host.head(), { sid, rules });
        assert.equal(opened.error, undefined);
        if (!marked) delete opened.session.setup.foesClear;   // (these tests are about a fight that leaves its block as it was: a chat from before the foe-clear mark)
        let preview;
        for (let n = 0; n < 12; n += 1) {
            const target = readSheet(preview?.state ?? host.head()).foes.find(foe => foe.filled && foe.hurt > 0)?.slot;
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', ...(how === 'fled' ? { kind: 'flee' } : { kind: 'attack', target }) }]);
            if (staged.error) break;
            preview = staged.preview;
            if (preview.result.stop !== 'open') break;
        }
        if (preview?.result.stop === how) return host.send('I strike.', story);
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
            const want = memberXp([{ count: 1, level: 1 }], 1, true, true);
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
        assert.equal(hero(host).xp, memberXp([{ count: 1, level: 1 }], 1, true, true));
        const step = fights(host)[0];
        assert.equal(step.replan.payload.groups, undefined);
        assert.deepEqual(Object.keys(step.replan.payload), ['was', 'bars', 'xp'], 'a marked fight records its marks beside the slots');
    } finally { host.close(); restore(); }
});

test('a board win on a Character made before the mark holds back the narrator\'s own XP line in that reply (one payment, the old sum)', async () => {
    const restore = seedCrypto(35), host = await world({ old: true });
    try {
        const want = memberXp([{ count: 1, level: 1 }], 1);
        await winWith(host, NEW.replace('</Changes>', '+ dm character — big | kind: add-xp | amount: 50\n</Changes>'));
        assert.equal(fights(host).length, 1);
        assert.equal(hero(host).xp, want, 'the code\'s XP only; the narrator\'s 50 is not used');
    } finally { host.close(); restore(); }
});

test('a marked board win pays the marked sum and records the mark; the narrator\'s XP line is refused, not held; replay == live', async () => {
    const restore = seedCrypto(35), host = await world();
    try {
        await winWith(host, NEW.replace('</Changes>', '+ dm character — big | kind: add-xp | amount: 50\n</Changes>'));
        assert.equal(fights(host).length, 1);
        assert.equal(hero(host).xp, 15, 'one level 1 foe at level 1: 15, and the narrator\'s 50 is not used');
        assert.equal(fights(host)[0].replan.payload.bars, 2);
        assert.equal(fights(host)[0].data.v2.result.fight.bars, 2);
        const problems = host.turn.problems().map(problem => problem.message);
        assert.ok(problems.some(message => message.includes('XP comes from fights only')), 'the refusal note');
        assert.equal(problems.some(message => message.includes('given by code')), false, 'no hold note: nothing is left to hold');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.equal(hero(host).xp, 15);
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

// the owner's reply: the foe pre-check receipt opens the group, the board receipt wins with groups [1] and no opened, the narrator clears the slot
const openingReceipt = opened => ({ type: 'rpg.resolve', data: { v2: { result: { opened } } } });
const bogBoars = [{ slot: 1, name: 'bog-boars', count: 2, level: 3 }];

test('fightHook: a foe opening in an earlier roll of the reply names the group a later board win cleared', () => {
    const none = { ...party, foes: { role: 'foes', fields: levelFoeBlock([]) } };
    const view = viewOf(none, none);
    const out = fightHook(view, { type: 'normal', receipts: [openingReceipt(bogBoars), wonReceipt([1])] });
    assert.deepEqual(out.commands[0].payload.groups, bogBoars);
    assert.equal(memberXp(out.commands[0].payload.groups, 1), memberXp([{ count: 2, level: 3 }], 1));
    assert.deepEqual(openedSlots([openingReceipt(bogBoars), wonReceipt([1])]), [1]);
    // a later receipt's entry for the same slot wins
    const later = [openingReceipt(bogBoars), wonReceipt([1], [{ slot: 1, name: 'Wolves', count: 1, level: 2 }])];
    assert.deepEqual(fightHook(view, { type: 'normal', receipts: later }).commands[0].payload.groups, [{ slot: 1, name: 'Wolves', count: 1, level: 2 }]);
    // the same shape lost pays nothing
    const lost = { type: 'rpg.resolve', data: { v2: { result: { stop: 'lost', board: { groups: [1] } } } } };
    assert.equal(fightHook(view, { type: 'normal', receipts: [openingReceipt(bogBoars), lost] }), undefined);
});

// A fight paid before 11 Nov has a step without `xp` ({was, bars: 2}); the hook is made to write one for the test, then put back.
const asOld = host => {
    const original = host.registry.hookEntries;
    host.registry.hookEntries = name => original(name).map(entry => ({ ...entry, fn: (view, info) => {
        const out = entry.fn(view, info);
        for (const command of out?.commands ?? []) if (command.type === 'rpg.fight') delete command.payload.xp;
        return out;
    } }));
    return () => { host.registry.hookEntries = original; };
};
const fightPayload = host => fights(host).map(receipt => receipt.replan.payload);

test('an old marked fight ({was, bars: 2}, no xp) keeps its old sum through rebuild, reload, middle delete and Re-read; a Re-read of a new one keeps the flat sum', async () => {
    const restore = seedCrypto(36);
    try {
        // a level 11 foe against a level 11 member: the old sum has the band of ten levels (30), the flat one 15
        const oldSum = memberXp([{ count: 1, level: 11 }], 11, true), flatSum = memberXp([{ count: 1, level: 11 }], 11, true, true);
        assert.deepEqual([oldSum, flatSum], [30, 15]);
        const old = await world({ level: 11, health: 10 });
        try {
            const back = asOld(old);
            await old.send('Quiet.', 'Quiet.');
            await winWith(old, 'Done.');
            back();
            const won = old.store.headIndex();
            assert.equal(hero(old).xp, oldSum);
            assert.deepEqual(fightPayload(old), [{ was: [1], bars: 2 }]);
            const live = JSON.stringify(old.head());
            old.store.rebuild();
            assert.equal(JSON.stringify(old.head()), live, 'rebuild');
            await old.st.loadChat(JSON.parse(JSON.stringify(old.ctx.chat)));
            assert.equal(JSON.stringify(old.head()), live, 'reload');
            assert.equal(hero(old).xp, oldSum);
            await old.st.deleteMessage(won - 2);
            await old.st.deleteMessage(won - 3);
            assert.equal(hero(old).xp, oldSum, 'a middle delete');
            assert.deepEqual(fightPayload(old), [{ was: [1], bars: 2 }]);
            assert.equal((await old.turn.reread(old.store.headIndex())).ok, true);
            assert.equal(hero(old).xp, oldSum, 'a Re-read keeps the old sum');
            assert.deepEqual(fightPayload(old), [{ was: [1], bars: 2 }], 'and the old step');
            assert.deepEqual(old.store.problems(), []);
        } finally { old.close(); }
        const fresh = await world({ level: 11, health: 10 });
        try {
            await winWith(fresh, 'Done.');
            assert.equal(hero(fresh).xp, flatSum);
            assert.equal((await fresh.turn.reread(fresh.store.headIndex())).ok, true);
            assert.equal(hero(fresh).xp, flatSum, 'a Re-read of a new fight keeps the flat sum');
            assert.deepEqual(fightPayload(fresh), [{ was: [1], bars: 2, xp: 2 }]);
        } finally { fresh.close(); }
    } finally { restore(); }
});

// The foe-clear mark (a new chat): the won fight leaves the Foes block, and the XP step names its own board resolve.
const promptOf = sent => (sent?.request?.chat ?? []).map(message => message.content).join('\n');
const SAME = 'Done.\n<Changes>\n+ dm foes — raider | kind: set-slot-1 | name: Tunnel Rat | count: 1 | level: 1\n</Changes>';

test('a marked board win with the stock hero pays, clears the block, names its resolve, and replay == live == Re-read', async () => {
    const restore = seedCrypto(33), host = await world();
    try {
        const sent = await winWith(host, 'Done.', { marked: true });
        assert.equal(hero(host).xp, 15, 'the stock hero (made by define and set) is paid');
        assert.equal(readSheet(host.head()).foes.filter(foe => foe.filled).length, 0, 'the won fight left the block');
        const payload = fights(host)[0].replan.payload;
        assert.equal(payload.gone, 1);
        assert.match(payload.claim, /^rpg:resolve:b:/u);
        assert.deepEqual(host.turn.problems(), []);
        const prompt = promptOf(sent);
        assert.ok(prompt.includes('[COMBAT SYSTEM]'), 'the reply that tells the end keeps the combat rules');
        assert.ok(prompt.includes('If a new group arrives after this fight'));
        assert.equal(prompt.includes('tell no blows yourself'), false);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.equal(hero(host).xp, 15);
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); restore(); }
});

test('a marked board win still pays when the same reply sets a group with the same name in the cleared slot', async () => {
    const restore = seedCrypto(33), host = await world();
    try {
        await winWith(host, SAME, { marked: true });
        assert.equal(hero(host).xp, 15, 'a real win is paid, whatever the narrator sets after it');
        assert.equal(host.turn.problems().some(problem => problem.message.includes('standing again')), false);
        assert.equal(readSheet(host.head()).foes.filter(foe => foe.filled).length, 1, 'the new group stands');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); restore(); }
});

test('deleting the reply that set the foes takes a marked win\'s XP back, and rebuild agrees', async () => {
    const restore = seedCrypto(33), host = await world();
    try {
        await winWith(host, 'Done.', { marked: true });
        assert.equal(hero(host).xp, 15);
        await host.st.deleteMessage(4);
        assert.equal(hero(host).xp, 0, 'the fight was taken back, so its XP is');
        const after = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), after);
    } finally { host.close(); restore(); }
});

for (const how of ['lost', 'fled']) {
    test(`the reply that tells a ${how} marked board fight keeps its fight tail (rules, the new-group line, no no-fight line)`, async () => {
        const restore = seedCrypto(33), host = await world({ foeLevel: 40, health: 1 });
        try {
            const prompt = promptOf(await winWith(host, 'Done.', { marked: true, how }));
            assert.ok(prompt.includes('[COMBAT SYSTEM]'));
            assert.ok(prompt.includes('If a new group arrives after this fight'));
            assert.equal(prompt.includes('tell no blows yourself'), false);
            assert.equal(readSheet(host.head()).foes.filter(foe => foe.filled).length, 0);
        } finally { host.close(); restore(); }
    });
}
