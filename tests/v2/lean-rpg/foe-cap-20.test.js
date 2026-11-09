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

async function world(t) {
    const host = await createHost({ callModel: async () => 'none' });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    host.features.set('story-block.fight-board', false);
    await host.send('Begin.', 'Opening.');
    const character = structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Character').definition);
    character.slug = 'wessel'; character.name = 'Wessel'; character.state.who.default = 'Wessel';
    success(await host.sdk.command('dm.define', { definition: character }));
    success(await host.sdk.command('dm.define', { definition: structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Foes').definition) }));
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
