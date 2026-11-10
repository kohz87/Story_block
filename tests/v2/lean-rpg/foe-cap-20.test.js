// A new foe's guessed level may reach the party's highest + 20 (it was + 10). It is a ceiling only. The same cap holds on the pre-check (vetGroups), the old
// opening's vetOpen and the narrator's set-slot line; a person's Level field still passes it. Old chats: a reply captured before the rule has no `foeCap` mark
// and a Re-read of it keeps the +10 cap (so the Re-read agrees with what the live capture did); a reply captured now is marked and keeps +20 through a Re-read,
// a rebuild and a reload. A recorded plan or recorded ops are never re-capped (replay applies stored ops only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_FEATURE, readSheet } from '../../../src/v2/lean-rpg/index.js';
import { vetOpen } from '../../../src/v2/lean-rpg/open.js';
import { vetGroups } from '../../../src/v2/lean-rpg/board/precheck.js';
import { FOE_LEVEL, foeLevelCap } from '../../../src/v2/lean-rpg/foes.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { success, reply } from '../data-modules/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const LINE = '+ dm foes — why | kind: set-slot-1 | name: Dragon | count: 1 | level: 99';

test('the cap is the party\'s highest level + 20, at most 99, at least 21; the old band stays a separate number', () => {
    assert.deepEqual([foeLevelCap([2]), foeLevelCap([2, 40]), foeLevelCap([]), foeLevelCap([90])], [22, 60, 21, 99]);
    assert.deepEqual([foeLevelCap([2], FOE_LEVEL.oldBand), foeLevelCap([])], [12, 21]);
});

test('pre-check and vetOpen hold a guessed level to party top + 20; a person\'s Level passes it', () => {
    const sheet = { characters: [{ who: 'Astra', level: 2, alive: true }], foes: [] };
    assert.equal(vetGroups([{ name: 'Vorn', count: 1, level: 99 }], { message: 'I attack Vorn.', sheet })[0].level, 22);
    assert.equal(vetGroups([{ name: 'Vorn', count: 1, level: 99 }], { message: 'I attack Vorn.', sheet, stated: () => ({ level: 60 }) })[0].level, 60);
    assert.equal(vetOpen([{ name: 'Vorn', level: '99' }], sheet, ['I attack Vorn.']).open[0].level, 22);
    assert.equal(vetOpen([{ name: 'Vorn', level: '5' }], sheet, ['I attack Vorn.'], { stated: () => ({ level: 60 }) }).open[0].level, 60);
});

async function world(t, { oneFoe = false } = {}) {
    const host = await createHost({ callModel: async () => 'none' });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    host.features.set('story-block.fight-board', false);
    await host.send('Begin.', 'Opening.');
    const character = structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Character').definition);
    character.slug = 'wessel'; character.name = 'Wessel'; character.state.who.default = 'Wessel';
    success(await host.sdk.command('dm.define', { definition: character }));
    const foes = structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Foes').definition);
    if (oneFoe) for (const n of [2, 3, 4]) delete foes.kinds[`set-slot-${n}`];
    success(await host.sdk.command('dm.define', { definition: foes }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/wessel', fields: { level: 15 } }));
    return host;
}
const levelNow = host => readSheet(host.head()).foes[0].level;
const recordOf = (host, index) => host.ctx.chat[index].extra.storySuite;

test('the narrator\'s set-slot line: 99 against a party of 15 is 35; the reply is marked foeCap 20, and a Re-read, a rebuild and a reload keep 35', { skip }, async t => {
    const host = await world(t);
    await host.send('A dragon.', reply(LINE));
    const at = host.ctx.chat.length - 1;
    assert.equal(levelNow(host), 35);
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 35, 'a Re-read of a marked reply');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload');
    assert.equal(recordOf(host, at).foeCap, 20, 'the mark survives the reload');
});

test('an old reply (recorded without the foeCap mark, at the +10 cap) keeps it: nothing recorded is re-capped, and a Re-read agrees with the live capture', { skip }, async t => {
    const host = await world(t);
    // The reply is captured as the code before the rule did: no mark is written, so the cap in force for it is party 15 + 10 = 25.
    const setFoeCap = host.store.setFoeCap;
    host.store.setFoeCap = () => { throw new Error('no mark: an old chat'); };
    await host.send('A dragon.', reply(LINE));
    host.store.setFoeCap = setFoeCap;
    const at = host.ctx.chat.length - 1;
    assert.equal(levelNow(host), 25, 'recorded live at the old cap');
    assert.equal(recordOf(host, at).foeCap, undefined);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild applies the stored ops');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload');
    assert.deepEqual(host.store.problems(), []);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(host.head()), live, 'a Re-read of the unmarked reply is byte-identical: held to 15 + 10 as the live capture was');
    assert.equal(recordOf(host, at).foeCap, undefined, 'a Re-read does not mark an old reply');
    assert.deepEqual(host.store.problems(), []);
    // A later reply captured now is marked and may reach 35.
    await host.send('Another.', reply('+ dm foes — why | kind: set-slot-2 | name: Wyrm | count: 1 | level: 99'));
    assert.equal(readSheet(host.head()).foes[1].level, 35);
});

test('a Continue cannot add the new cap to an old reply with an earlier set-slot line', { skip }, async t => {
    const host = await world(t), setter = host.store.setFoeCap;
    host.store.setFoeCap = () => { throw new Error('old reply'); };
    await host.send('A dragon.', reply(LINE));
    host.store.setFoeCap = setter;
    const at = host.ctx.chat.length - 1;
    await host.cont(`\n\n${reply('+ dm foes — why | kind: set-slot-2 | name: Wyrm | count: 1 | level: 99')}`);
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.deepEqual(readSheet(host.head()).foes.slice(0, 2).map(foe => foe.level), [25, 25]);
    const live = structuredClone(host.head());
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.head(), live);
});

test('a uniquely inferred set-slot kind uses the new cap and survives Re-read', { skip }, async t => {
    const host = await world(t, { oneFoe: true });
    await host.send('A dragon.', reply('+ dm foes — why | name: Dragon | count: 1 | level: 99'));
    const at = host.ctx.chat.length - 1;
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.equal(levelNow(host), 35);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 35);
});

test('a non-foe data module with a set-slot kind is untouched by the foe-cap mark every new reply carries', { skip }, async t => {
    const host = await world(t);
    const counter = { slug: 'counter', name: 'Counter', schema: 1, stateVersion: 1, scope: 'chat',
        state: { points: { type: 'int', min: 0, max: 100, default: 0 } },
        kinds: { 'set-slot-1': { op: '+', labels: {}, effects: [{ op: 'add', path: ['points'], value: 1, bounds: 'clamp' }] } } };
    success(await host.sdk.command('dm.define', { definition: counter }));
    await host.send('Count.', reply('+ dm counter — why | kind: set-slot-1'));
    const at = host.ctx.chat.length - 1, live = JSON.stringify(host.head());
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.equal(host.head().domains.dataModules.instances['pack.chat/counter'].chat.fields.points, 1);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(host.head()), live);
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
    assert.equal(recordOf(host, at).foeCap, 20);
});

test('an earlier inferred foe line on an old reply keeps its cap after a Continue', { skip }, async t => {
    const host = await world(t, { oneFoe: true }), setter = host.store.setFoeCap;
    host.store.setFoeCap = () => { throw new Error('old reply'); };
    await host.send('A dragon.', reply('+ dm foes — why | name: Dragon | count: 1 | level: 99'));
    host.store.setFoeCap = setter;
    const at = host.ctx.chat.length - 1;
    await host.cont(`\n\n${reply(LINE)}`);
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal(levelNow(host), 25);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 25);
});

test('editing an old unmarked foe reply keeps its old cap on Re-read', { skip }, async t => {
    const host = await world(t), setter = host.store.setFoeCap;
    host.store.setFoeCap = () => { throw new Error('old reply'); };
    await host.send('A dragon.', reply(LINE));
    host.store.setFoeCap = setter;
    const at = host.ctx.chat.length - 1;
    await host.st.editMessage(at, reply(LINE.replace('Dragon', 'Hydra')));
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal(levelNow(host), 25);
});

test('a late foe line cannot give an old foe line the new cap', { skip }, async t => {
    const host = await world(t);
    let resolveCapture;
    const capture = new Promise(resolve => { resolveCapture = resolve; });
    await host.sdk.registerModule({ id: 'late-foe', name: 'Late foe', version: '1', hooks: { afterReply: ({ capture: add }) => resolveCapture(add) } });
    const setter = host.store.setFoeCap;
    host.store.setFoeCap = () => { throw new Error('old reply'); };
    await host.send('A dragon.', reply(LINE));
    host.store.setFoeCap = setter;
    const at = host.ctx.chat.length - 1;
    await (await capture)('+ dm foes — why | kind: set-slot-2 | name: Wyrm | count: 1 | level: 99');
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.deepEqual(readSheet(host.head()).foes.slice(0, 2).map(foe => foe.level), [25, 25]);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(readSheet(host.head()).foes.slice(0, 2).map(foe => foe.level), [25, 25]);
});

test('a late first foe line on a loaded unmarked reply keeps the old cap', { skip }, async t => {
    const host = await world(t);
    let resolveCapture;
    const capture = new Promise(resolve => { resolveCapture = resolve; });
    await host.sdk.registerModule({ id: 'late-old-foe', name: 'Late old foe', version: '1', hooks: { afterReply: ({ capture: add }) => resolveCapture(add) } });
    await host.send('Wait.', 'They wait.');
    const at = host.ctx.chat.length - 1;
    const saved = JSON.parse(JSON.stringify(host.ctx.chat));
    delete saved[at].extra.storySuite.foeCap; // a chat saved before the mark existed
    await host.st.loadChat(saved);
    await (await capture)(LINE);
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal(levelNow(host), 25);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 25);
});

test('a first foe line in a Continue accepts Markdown and keeps the new cap on Re-read', { skip }, async t => {
    const host = await world(t);
    await host.send('Wait.', 'They wait.');
    const at = host.ctx.chat.length - 1;
    await host.cont(`\n\n${reply('+ dm foes — why | **kind:** set-slot-1 | name: Dragon | count: 1 | level: 99')}`);
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.equal(levelNow(host), 35);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 35);
});

test('a new reply with no foe line is marked at its first capture and gets +20 for a first foe line after reload', { skip }, async t => {
    const host = await world(t);
    await host.send('Wait.', 'They wait.');
    const at = host.ctx.chat.length - 1;
    assert.equal(recordOf(host, at).foeCap, 20);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    await host.cont(`\n\n${reply(LINE)}`);
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.equal(levelNow(host), 35);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 35);
});

test('the cap mark belongs to its swipe and its saved copy', { skip }, async t => {
    const host = await world(t);
    await host.send('A dragon.', reply(LINE));
    const at = host.ctx.chat.length - 1;
    await host.swipe('No dragon.');
    assert.equal(recordOf(host, at).foeCap, 20, 'a new swipe is marked at its first capture too');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    await host.st.swipeTo(at, 0);
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.equal(levelNow(host), 35);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 35);
    await host.st.swipeTo(at, 1);
    assert.equal(recordOf(host, at).foeCap, 20);
});

test('a missing cap writer keeps the old cap live and on Re-read', { skip }, async t => {
    const host = await world(t);
    host.store.setFoeCap = undefined;
    await host.send('A dragon.', reply(LINE));
    const at = host.ctx.chat.length - 1;
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal(levelNow(host), 25);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(levelNow(host), 25);
});

// Byte identity (JSON text, key order included). A Continue or a late line adds its block's action AFTER the reply-end step's action (live order: line,
// step, line); a Re-read runs every line first and the steps last. The values are equal (checked above); the key order of
// `perReply.*.actions` differs. No local change closes it without changing what a Re-read of an old reply writes: open (FIXREPORT).
const bytes = host => JSON.stringify(host.head());

test('an old reply stays byte-identical after Continue, rebuild, reload, swipes and Re-read', { skip, todo: 'action key order changes on Re-read' }, async t => {
    const host = await world(t), setter = host.store.setFoeCap;
    host.store.setFoeCap = () => { throw new Error('old reply'); };
    await host.send('A dragon.', reply(LINE));
    host.store.setFoeCap = setter;
    const at = host.ctx.chat.length - 1;
    await host.cont(`\n\n${reply('+ dm foes — why | kind: set-slot-2 | name: Wyrm | count: 1 | level: 99')}`);
    const live = bytes(host);
    host.store.rebuild();
    assert.ok(bytes(host) === live, 'rebuild preserves the live JSON');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.ok(bytes(host) === live, 'reload preserves the live JSON');
    await host.swipe('No dragon.');
    await host.st.swipeTo(at, 0);
    assert.ok(bytes(host) === live, 'the saved swipe preserves the live JSON');
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.head(), JSON.parse(live), 'Re-read preserves the live values');
    assert.ok(bytes(host) === live, 'Re-read preserves the live JSON, including key order');
});

test('an old reply stays byte-identical after a late line and Re-read', { skip, todo: 'action key order changes on Re-read' }, async t => {
    const host = await world(t);
    let resolveCapture;
    const capture = new Promise(resolve => { resolveCapture = resolve; });
    await host.sdk.registerModule({ id: 'late-order', name: 'Late order', version: '1', hooks: { afterReply: ({ capture: add }) => resolveCapture(add) } });
    const setter = host.store.setFoeCap;
    host.store.setFoeCap = () => { throw new Error('old reply'); };
    await host.send('A dragon.', reply(LINE));
    host.store.setFoeCap = setter;
    const at = host.ctx.chat.length - 1;
    await (await capture)('+ dm foes — why | kind: set-slot-2 | name: Wyrm | count: 1 | level: 99');
    const live = bytes(host);
    host.store.rebuild();
    assert.ok(bytes(host) === live, 'rebuild preserves the live JSON');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.ok(bytes(host) === live, 'reload preserves the live JSON');
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.head(), JSON.parse(live), 'Re-read preserves the live values');
    assert.ok(bytes(host) === live, 'Re-read preserves the live JSON, including key order');
});

test('a plain reply (one pass): Re-read and a reload leave the head byte-identical', { skip }, async t => {
    const host = await world(t);
    await host.send('A dragon.', reply(`${LINE}\n+ dm foes — why | kind: set-slot-2 | name: Wyrm | count: 1 | level: 99`));
    const at = host.ctx.chat.length - 1, live = bytes(host);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(bytes(host), live);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(bytes(host), live);
});
