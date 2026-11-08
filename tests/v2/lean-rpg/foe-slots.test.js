// FIGHT-FIX 1: a Down group no longer holds its foe slot. A new group of the same name replaces a Down one, else the first empty or Down slot takes it;
// the roll's opened slots count as arrived for the fight's XP; a stale Down group is never paid again; Down-only slots are not an open fight for the quiet reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createFakeModel } from '../../../testkit/model.js';
import { FIGHT, LEAN_RPG_FEATURE, RESOLVE, readSheet } from '../../../src/v2/lean-rpg/index.js';
import { fightIsOpen } from '../../../src/v2/lean-rpg/quiet.js';
import { openFoes, vetOpen } from '../../../src/v2/lean-rpg/open.js';
import { openedSlots, fightHook } from '../../../src/v2/lean-rpg/fight.js';
import { legacyPlanner } from './legacy-planner.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { PARTY, foeBlock, sheetDomain } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message ?? JSON.stringify(result.errors)}`); return result; };

// A strong Astra against small groups, so every fight is won inside one reply.
async function world(t) {
    const model = createFakeModel([]);
    // (the real host with the test-only legacy planner behind the RPG part's hook: the planner itself is gone)
    const rpgLoad = async () => {
        const lib = await import('../../../src/v2/lean-rpg/index.js');
        return { ...lib, createLeanRpgPart(deps) { const part = lib.createLeanRpgPart(deps); part.hooks.beforeGenerate = legacyPlanner(part, { callModel: model, chat: () => host.ctx.chat, metadata: () => host.ctx.chatMetadata ?? null }); return part; } };
    };
    const host = await createHost({ callModel: model, lazyRpg: true, rpgLoad });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    host.features.set('story-block.fight-board', false);
    await host.send('Begin.', 'Opening.');
    // (the Character made before the marked one: a fight the story settles pays XP only there)
    for (const entry of STANDARD_TEMPLATES) ok(await host.sdk.command('dm.define', { definition: entry.name === 'Character' ? characterV1For() : structuredClone(entry.definition) }));
    ok(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 30, str: 20, agi: 20, dex: 20, vit: 20, int: 20, luk: 20 } }));
    ok(await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Astra' } }));
    await host.send('I remember my training.', 'Forms.\n<Changes>\n~ dm skills — learns | kind: learn-1 | name: Iaijutsu | about: a draw | stat: agi | uses: stamina\n</Changes>');
    return { host, model };
}
const fields = (host, slug) => host.head().domains.dataModules.instances[`pack.chat/${slug}`].chat.fields;
const receiptsOf = (host, index) => host.ctx.chat[index].extra.storySuite.receipts;
const fightOf = host => { const index = host.ctx.chat.length - 1; return { index, roll: receiptsOf(host, index).find(r => r.type === RESOLVE), paid: receiptsOf(host, index).find(r => r.type === FIGHT) }; };
async function fight(host, model, name, message = `I strike at the ${name}.`) {
    model.push(`pace: all\nfoe ${name} | new | count: 4 | level: 29\nact Astra | skill: Iaijutsu | type: physical | target: ${name}`);
    await host.send(message, 'The fight is told.\n[battle]\n');
    return fightOf(host);
}
const agree = host => { const live = JSON.stringify(host.head()); host.store.rebuild(); assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story'); };

test('open.js: a Down group is replaced by a new group of the same name, else the first empty or Down slot takes the new one; a standing group is left alone', () => {
    const blocks = foeBlock([['Rats', 4, 2, 0], ['Wolves', 3, 2, 3]]);
    const domain = sheetDomain({ ...PARTY(), foes: { role: 'foes', fields: blocks } });
    const placed = openFoes(domain, [{ name: 'rats', count: 6, level: 3 }, { name: 'Wolves', count: 9, level: 1 }, { name: 'Boars', count: 2, level: 1 }]);
    assert.deepEqual(placed.map(entry => [entry.slot, entry.name, entry.count]), [[1, 'rats', 6], [3, 'Boars', 2]], 'the Down rats are replaced in slot 1; the standing Wolves stay; the new Boars take the first empty slot');
    const sheet = readSheet({ domains: { dataModules: domain } });
    assert.deepEqual(sheet.foes.map(foe => [foe.name, foe.count, foe.hurt]).slice(0, 3), [['rats', 6, 5], ['Wolves', 3, 3], ['Boars', 2, 5]]);
    // with every slot filled, a Down one is taken
    const full = sheetDomain({ ...PARTY(), foes: { role: 'foes', fields: foeBlock([['A', 1, 1, 3], ['B', 1, 1, 0], ['C', 1, 1, 2], ['D', 1, 1, 4]]) } });
    assert.deepEqual(openFoes(full, [{ name: 'New', count: 2, level: 1 }]).map(entry => entry.slot), [2]);
});

test('a roll made before `fix: 2` opens foes as it did (replay safety): a filled group of the name stops the entry, only an empty slot is free, nothing is cleared; resolve records and hashes the mark', { skip }, async t => {
    const stale = () => sheetDomain({ ...PARTY(), foes: { role: 'foes', fields: foeBlock([['Rats', 4, 2, 0], ['Wolves', 3, 2, 0]]) } });
    const old = stale();
    assert.deepEqual(openFoes(old, [{ name: 'rats', count: 6, level: 3 }], { fix: 1 }), [], 'a Down group of the name still stops the entry');
    assert.deepEqual(openFoes(old, [{ name: 'Boars', count: 2, level: 1 }], { fix: 1 }).map(entry => entry.slot), [3], 'only an empty slot is free');
    assert.deepEqual(readSheet({ domains: { dataModules: old } }).foes.map(foe => [foe.name, foe.hurt]).slice(0, 2), [['Rats', 0], ['Wolves', 0]], 'the Down groups are not cleared');
    const fresh = stale();
    assert.deepEqual(openFoes(fresh, [{ name: 'Boars', count: 2, level: 1 }]).map(entry => entry.slot), [1], 'the current rule takes the first Down slot');
    const { host, model } = await world(t);
    const { roll } = await fight(host, model, 'rats');
    assert.equal(roll.data.v2.result.fix, 3, 'the roll asks for the current rules mark (3 includes the foe-slot rule of 2)');
});

test('a Down group of the name is not "already there" for the planner: vetOpen lets a new group of that name through, a standing one is still passed over', () => {
    const sheet = readSheet({ domains: { dataModules: sheetDomain({ ...PARTY(), foes: { role: 'foes', fields: foeBlock([['Rats', 4, 2, 0], ['Wolves', 3, 2, 3]]) } }) } });
    const vetted = vetOpen([{ name: 'rats', count: '5', level: '2' }, { name: 'Wolves', count: '2' }], sheet, ['The rats again, and the wolves.', ''] );
    assert.deepEqual(vetted.open.map(entry => entry.name), ['rats']);
});

test('a block of Down groups alone is no open fight for the quiet reply', () => {
    assert.equal(fightIsOpen({ domains: { dataModules: sheetDomain({ ...PARTY(), foes: { role: 'foes', fields: foeBlock([['Rats', 4, 2, 0]]) } }) } }), false);
    assert.equal(fightIsOpen({ domains: { dataModules: sheetDomain({ ...PARTY(), foes: { role: 'foes', fields: foeBlock([['Rats', 4, 2, 0], ['Wolves', 2, 2, 3]]) } }) } }), true);
    assert.deepEqual(openedSlots([{ type: RESOLVE, data: { v2: { result: { opened: [{ slot: 2 }, { slot: 5 }, { slot: 'x' }] } } } }]), [2, 5]);
    assert.deepEqual(openedSlots([]), []);
});

test('rats twice: the second group takes the Down rats\' slot, is rolled and pays XP; the winning reply leaves its groups Down; Re-read, rebuild and reload agree', { skip }, async t => {
    const { host, model } = await world(t);
    const first = await fight(host, model, 'rats');
    assert.ok(first.roll && first.paid, 'rolled and paid');
    assert.deepEqual([fields(host, 'foes').foe1, fields(host, 'foes').count1, fields(host, 'foes').hurt1], ['rats', 4, 0], 'the winning reply leaves its group Down');
    const second = await fight(host, model, 'rats', 'Another nest of rats: I strike.');
    assert.ok(second.roll?.data.v2.result.rounds.length >= 1, 'the second group rolls');
    assert.deepEqual(second.roll.data.v2.result.opened.map(entry => [entry.slot, entry.name]), [[1, 'rats']], 'in the Down rats\' slot');
    assert.ok(second.paid, 'and pays XP');
    assert.ok(second.paid.data.v2.result.fight.awards.some(award => award.who === 'Astra' && award.xp > 0));
    assert.equal(fields(host, 'foes').hurt1, 0);
    agree(host);
    const before = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(second.index)).ok, true);
    assert.equal(JSON.stringify(host.head()), before, 'a Re-read gives the same story');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), before, 'a reload gives the same story');
});

test('five fights in a row: every one is rolled and pays XP, the fifth too (no stall on Down groups)', { skip }, async t => {
    const { host, model } = await world(t);
    for (const name of ['rats', 'eels', 'crows', 'toads', 'boars']) {
        const done = await fight(host, model, name);
        assert.ok(done.roll?.data.v2.result.rounds.length >= 1, `${name} rolls`);
        assert.ok(done.paid, `${name} pays`);
    }
    assert.equal(host.turn.problems().length, 0);
    agree(host);
});

test('a stale Down group is never paid again: a later fight pays only the groups it began with', { skip }, async t => {
    const { host, model } = await world(t);
    await fight(host, model, 'rats');
    // the narrator opens a second slot while the Down rats stay on slot 1 (set-slot-2), and a fight against it is won
    model.push('pace: all\nact Astra | skill: Iaijutsu | type: physical | target: wolves');
    await host.send('I strike at the wolves.', 'Wolves are down.\n<Changes>\n+ dm foes — a pack | kind: set-slot-2 | name: wolves | count: 4 | level: 1\n</Changes>\n[battle]');
    const paid = fightOf(host).paid;
    if (paid) assert.deepEqual(paid.data.v2.result.fight.groups.map(group => group.name), ['wolves'], 'the Down rats are not in the fight it paid');
});

test('the quiet reply after a won fight drops the combat text again (Down groups alone are no open fight)', { skip }, async t => {
    const { host, model } = await world(t);
    await fight(host, model, 'rats');
    const { request } = await host.send('I rest and walk on.', 'The road is quiet.');
    const text = request.chat[0].content;
    assert.doesNotMatch(text, /\[COMBAT SYSTEM\]/u);
    assert.doesNotMatch(text, /kind: hurt-N|kind: clear-N/u);
});

const foeNames = fieldsObject => [1, 2, 3, 4].map(n => fieldsObject[`foe${n}`]).filter(Boolean);

test('a new fight clears the Down groups of earlier replies: after the gnashers the rats fight leaves only rats on the block, in the log\'s Status and in the prompt, and the gnashers\' XP is not paid again', { skip }, async t => {
    const { host, model } = await world(t);
    const gnashers = await fight(host, model, 'gnashers');
    assert.deepEqual(foeNames(fields(host, 'foes')), ['gnashers'], 'the winning reply leaves its group Down on the block');
    const xpAfterFirst = fields(host, 'character').xp + 100 * fields(host, 'character').level;
    model.push('pace: all\nfoe rats | new | count: 4 | level: 29\nact Astra | skill: Iaijutsu | type: physical | target: rats');
    const { request } = await host.send('I go down to the rats and strike.', 'Rats.\n[battle]\n');
    const rats = fightOf(host);
    assert.deepEqual(foeNames(fields(host, 'foes')), ['rats'], 'the Foes block holds only this fight\'s foes');
    assert.ok(rats.paid, 'the rats pay');
    assert.deepEqual(rats.paid.data.v2.result.fight.groups.map(group => group.name), ['rats'], 'the gnashers are not paid again');
    const prompt = request.chat.map(message => message.content).join('\n');
    // (the chat's own earlier messages still say what was told; what Story Block adds does not: no Foes line, cue or planner list names the old group)
    assert.doesNotMatch(prompt, /Foes:[^\n]*gnashers|gnashers ×\d+/u, 'the prompt no longer lists the earlier group');
    assert.match(prompt, /Foes: rats ×4/u);
    assert.ok(xpAfterFirst > 0);
    // the log's Status: only the groups that rolled in this reply
    const { buildPanel, panelModel, readResolve } = await import('../../../src/v2/lean-rpg/view/battle-log.js');
    const { setupDom } = await import('../view/mounts/helpers.js');
    const model2 = panelModel({ resolve: readResolve(rats.roll.data.v2.result), state: host.store.at(rats.index), before: host.store.at(rats.index - 1), roleOf: definition => definition.role ?? null });
    assert.deepEqual(model2.foes.map(foe => foe.text.split(' ')[0]), ['rats']);
    // the gnasher reply keeps its own fight: its state still has the gnashers, and a Re-read, a rebuild and a reload agree
    assert.deepEqual(foeNames(host.store.at(gnashers.index).domains.dataModules.instances['pack.chat/foes'].chat.fields), ['gnashers']);
    agree(host);
    const live = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(gnashers.index)).ok, true);
    assert.equal(JSON.stringify(host.head()), live, 'Re-read of the gnasher reply leaves the story as it was');
    assert.deepEqual(foeNames(host.store.at(gnashers.index).domains.dataModules.instances['pack.chat/foes'].chat.fields), ['gnashers'], 'and the reply still shows its own fight');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload agrees');
    void buildPanel; void setupDom;
});

test('a swipe of the gnasher reply shows the gnashers as its own fight again, and the Down group stays on the block until the next fight opens', { skip }, async t => {
    const { host, model } = await world(t);
    await fight(host, model, 'gnashers');
    model.push('pace: all\nfoe gnashers | new | count: 4 | level: 29\nact Astra | skill: Iaijutsu | type: physical | target: gnashers');
    await host.swipe('The fight is told again.\n[battle]\n');
    const again = fightOf(host);
    assert.ok(again.roll && again.paid);
    assert.deepEqual(foeNames(fields(host, 'foes')), ['gnashers']);
    assert.equal(fields(host, 'foes').hurt1, 0, 'still Down on the block: it stays until the next fight opens');
    agree(host);
});
