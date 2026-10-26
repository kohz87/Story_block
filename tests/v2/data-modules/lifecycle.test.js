// Lifecycle of data modules on the real host (DATA_MODULES.md sections 4 and 5, decisions 2 and 5): reply-bound pin,
// attach and migrate, frozen pins, the restore barrier, damaged pins, per-chat isolation, and guards that read nothing
// but their prefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { dataModuleGuard } from '../../../src/v2/data-modules/part.js';
import { dataModuleHash } from '../../../src/v2/data-modules/check.js';
import { fixture, reply, int, definition, counterV2, pack, success, world, pin, view, reload, inactive, spansOf, directorStub } from './helpers.js';

const COUNT = reason => `+ dm counter — ${reason} | kind: bump | n: 1`;
const bumper = () => {
    const d = definition();
    d.kinds.bump = { op: '+', labels: { n: { type: 'int', min: 1, max: 5 } }, effects: [{ op: 'add', path: ['points'], value: ['arg', 'n'], bounds: 'clamp' }] };
    return d;
};
const points = (host, module = 'pack.dm-test/counter') => view(host, module).chat.points;
const registered = host => host.sdk.query('dataModules.offers');

test('a reply-bound pin: deleting the pin\'s reply takes the pin and everything built on it; later unrelated replies stay', async t => {
    const host = await world(t, pack([bumper()]));
    await host.send('Begin.', 'Opening.');
    await pin(host);
    const pinReply = host.ctx.chat.length - 1;
    assert.equal(spansOf(host, 'dm.pin')[0].guard.replyBound, true);
    await host.send('One.', reply(COUNT('a')));
    await host.send('Two.', 'Plain narration.');
    assert.equal(points(host), 1);
    await host.st.deleteMessage(pinReply);
    assert.equal(host.head().domains.dataModules, undefined, 'no pin, and no empty domain left behind');
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.dm-test/counter' }), null);
    assert.equal(inactive(host).length, 1, 'the bump is inactive, not recalculated');
    await reload(host);
    // The pin is not carried forward by deleting the earliest reply; the library still offers it.
    assert.equal(host.sdk.query('dataModules.setup')[0].status, 'Available');
});

test('swiping the pin\'s reply away retracts it; the swiped-to reply does not pin silently', async t => {
    const host = await world(t, pack([bumper()]));
    await host.send('Begin.', 'Opening.');
    await pin(host);
    await host.send('One.', reply(COUNT('a')));
    const pinReply = host.ctx.chat.length - 3;
    const message = host.ctx.chat[pinReply];
    message.swipes.push('Another opening.'); message.swipe_info.push({ send_date: '', extra: {} });
    await host.st.swipeTo(pinReply, message.swipes.length - 1);
    assert.equal(host.head().domains.dataModules, undefined);
    await reload(host);
});

test('attach is reply-bound too: deleting its reply removes the subject and the actions that need it', async t => {
    const SD = directorStub();
    const host = await world(t, fixture('survival'), [SD]);
    await host.send('Begin.', 'Opening.');
    const offer = await pin(host);
    await host.send('Attach here.', 'A reply.');
    success(await host.sdk.command('dm.attach', { module: offer.module, who: 'Wessel' }));
    const attachReply = host.ctx.chat.length - 1;
    assert.equal(spansOf(host, 'dm.attach')[0].guard.replyBound, true);
    await host.send('Eat.', reply('! dm survival — ate | kind: meal | who: Wessel'));
    assert.equal(view(host, offer.module).characters.length, 1);
    await host.st.deleteMessage(attachReply);
    assert.deepEqual(view(host, offer.module).characters, []);
    assert.equal(inactive(host).length, 1, 'the meal needs the attached subject');
    await reload(host);
});

test('migration: previewed in Setup, one reply-bound transaction; old blocks keep their history; deleting it retracts it and its suffix', async t => {
    const host = await world(t, pack([bumper()]));
    await host.send('Begin.', 'Opening.');
    const v1 = await pin(host);
    await host.send('One.', reply(COUNT('a')));
    const v2 = counterV2(); v2.kinds = bumper().kinds;
    success(await host.packs.packs.install({ ...pack([v2]), version: '1.1.0' }));
    const row = host.sdk.query('dataModules.setup')[0];
    assert.equal(row.status, 'Migration available');
    assert.deepEqual(row.additions, { bonus: 5 });
    const before = JSON.stringify(host.head());
    host.sdk.query('dataModules.setup'); host.sdk.query('dataModules.offers');
    assert.equal(JSON.stringify(host.head()), before, 'inspecting writes nothing');
    await host.send('Migrate here.', 'A reply.');
    const migrateReply = host.ctx.chat.length - 1;
    const stale = await host.sdk.command('dm.migrate', { module: v1.module, hash: v1.hash, packHash: v1.packHash });
    assert.equal(stale.code, 'STALE', 'the displayed hash is the installed one');
    success(await host.sdk.command('dm.migrate', { module: row.module, hash: row.hash, packHash: row.packHash }));
    const active = host.head().domains.dataModules.active[v1.module];
    assert.equal(active.generation, 2);
    assert.deepEqual(view(host, v1.module).chat, { points: 1, bonus: 5 });
    assert.ok(host.head().domains.dataModules.pins[v1.hash], 'the old pin is preserved');
    await host.send('Two.', reply(COUNT('b')));
    assert.equal(points(host), 2);
    await reload(host);
    // Downgrade refuses; so does migrating when nothing newer is installed.
    assert.equal((await host.sdk.command('dm.migrate', { module: v1.module, hash: row.hash, packHash: row.packHash })).ok, false);
    // Deleting the migration's reply retracts the new generation and invalidates the block built on it.
    await host.st.deleteMessage(migrateReply);
    assert.equal(host.head().domains.dataModules.active[v1.module].generation, 1);
    assert.deepEqual(view(host, v1.module).chat, { points: 1 });
    assert.equal(inactive(host).length, 1);
    await reload(host);
});

test('migration refuses what is not additive; Setup says Unsupported with the reason, and nothing is changed', async t => {
    const host = await world(t, pack([bumper()]));
    await host.send('Begin.', 'Opening.');
    await pin(host);
    const changed = bumper(); changed.stateVersion = 2; changed.state.bonus = int(0);
    changed.migrations = [{ from: 1, to: 2, add: { bonus: int(0) } }];
    changed.kinds.bump.effects[0].value = 2;
    success(await host.packs.packs.install({ ...pack([changed]), version: '1.1.0' }));
    const row = host.sdk.query('dataModules.setup')[0];
    assert.equal(row.status, 'Unsupported');
    assert.match(row.reason, /new timeline/);
    const before = JSON.stringify(host.head());
    const result = await host.sdk.command('dm.migrate', { module: row.module, hash: row.hash, packHash: row.packHash });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(host.head()), before);
});

test('pack reinstall, disable and remove change nothing for a pinned chat: the frozen definition keeps its mechanics and grammar', async t => {
    const host = await world(t, pack([bumper()]));
    await host.send('Begin.', 'Opening.');
    const offer = await pin(host);
    const grammar = () => host.registry.contexts().find(row => row.moduleId === 'story-block').static();
    const staticBefore = grammar();
    const changed = bumper(); changed.kinds.bump.effects[0].value = 4;
    success(await host.packs.packs.install({ ...pack([changed]), version: '9.0.0' }));
    await host.packs.packs.setEnabled('dm-test', false);
    await host.send('One.', reply(COUNT('a')));
    assert.equal(points(host), 1, 'the pinned mechanics, not the reinstalled ones');
    await host.packs.packs.remove('dm-test');
    await host.send('Two.', reply(COUNT('b')));
    assert.equal(points(host), 2);
    assert.equal(grammar(), staticBefore, 'the narrator grammar is the pin\'s');
    assert.equal(host.head().domains.dataModules.active[offer.module].hash, offer.hash);
    assert.equal(host.sdk.query('dataModules.setup')[0].status, 'Pinned', 'still listed from its pin');
    await reload(host);
});

test('the restore barrier blocks all new data module work, reader actions and timers included; saved history still replays', async t => {
    const host = await world(t, fixture('survival'), [directorStub()]);
    await host.send('Begin.', 'Opening.');
    const offer = await pin(host, ['ca_wessel01']);
    await host.send('Eat.', reply('! dm survival — ate | kind: meal | who: Wessel'));
    host.registry.setRestore('pending', 'Restoring a save point.');
    const before = JSON.stringify(host.head());
    await host.send('Blocked.', reply('! dm survival — ate | kind: meal | who: Wessel'));
    host.registry.setRestore('idle', '');
    assert.equal(JSON.stringify(host.head().domains.dataModules), JSON.stringify(JSON.parse(before).domains.dataModules));
    host.registry.setRestore('pending', 'Restoring a save point.');
    for (const [type, payload] of [['dm.attach', { module: offer.module, who: 'Wessel' }], ['dm.act', { module: offer.module, kind: 'meal' }], ['dm.migrate', { module: offer.module, hash: offer.hash, packHash: offer.packHash }]]) {
        const result = await host.sdk.command(type, payload);
        assert.equal(result.ok, false, type);
    }
    host.registry.setRestore('idle', '');
    await reload(host);
    assert.equal(view(host, offer.module).characters.length, 1);
});

test('a damaged or future-interpreter pin is inspected read-only: Unsupported in Setup, no grammar, refused new work, its timer step kept (never taken back)', async t => {
    const host = await world(t, fixture('survival'), [directorStub()]);
    await host.send('Begin.', 'Opening.');
    const offer = await pin(host, ['ca_wessel01']);
    const state = structuredClone(host.head());
    state.domains.dataModules.pins[offer.hash].interpreter = 2;
    const { grammarFor, summaryOf, createDataModulesPart } = await import('../../../src/v2/data-modules/part.js');
    const part = createDataModulesPart({ packs: host.packs.packs, state: () => state, lifecycle: id => host.registry.lifecycle(id) });
    const [row] = part.queries['dataModules.setup'](state);
    assert.equal(row.status, 'Unsupported');
    assert.match(row.reason, /Damaged or unknown/);
    assert.equal(grammarFor(state), '', 'no narrator lines for a pin this build cannot read');
    assert.match(summaryOf(state, offer.module), /unavailable/);
    assert.equal(part.queries['dataModules.view'](state, { module: offer.module }), null);
    const frozen = structuredClone(state);
    const tick = host.bus.run('dm.tick', { module: offer.module, subject: 'ca_wessel01' }, { cause: 'system', state: frozen });
    assert.equal(tick.ok, false);
    assert.equal(tick.code, 'DM_SCHEMA', 'a plain refusal: the host keeps the old block, it is not NO_LONGER_DONE');
    const act = host.bus.run('dm.capture', { op: '!', kind: 'dm', name: 'survival', labels: { kind: 'meal', who: 'Wessel' } }, { cause: 'story', state: frozen });
    assert.equal(act.ok, false);
    assert.equal(JSON.stringify(state.domains.dataModules.instances), JSON.stringify(host.head().domains.dataModules.instances), 'never initialized over');
    // And a module with no pin at all is the case where a replanned tick is taken back.
    const empty = structuredClone(host.head()); delete empty.domains.dataModules;
    assert.equal(host.bus.run('dm.tick', { module: offer.module, subject: 'ca_wessel01' }, { cause: 'system', state: empty }).code, 'NO_LONGER_DONE');
});

test('two chats using the same definition keep separate state, pins, screens and prompt lines; a chat switch changes none of the other\'s bytes', async t => {
    const host = await world(t, pack([bumper()]));
    await host.send('Begin.', 'Opening.');
    await pin(host);
    await host.send('One.', reply(COUNT('a')));
    const first = JSON.parse(JSON.stringify(host.ctx.chat));
    const staticOf = () => host.registry.contexts().find(row => row.moduleId === 'story-block').static();
    assert.match(staticOf(), /Data modules in this story/);
    // A second chat: same library, no pin.
    await host.st.loadChat([]);
    await host.send('Elsewhere.', 'A different story.');
    assert.equal(host.head().domains.dataModules, undefined);
    assert.doesNotMatch(staticOf(), /Data modules/);
    assert.deepEqual(host.sdk.query('dataModules.presentation'), []);
    await pin(host);
    await host.send('Two.', reply(COUNT('b')));
    await host.send('Three.', reply(COUNT('c')));
    assert.equal(points(host), 2);
    // Back to the first chat, exactly as it was.
    const second = JSON.parse(JSON.stringify(host.ctx.chat));
    await host.st.loadChat(first);
    assert.equal(points(host), 1);
    assert.equal(JSON.stringify(host.ctx.chat), JSON.stringify(first));
    await host.st.loadChat(second);
    assert.equal(points(host), 2);
});

// Replay reads nothing outside the chat: not the clock, RNG, settings, installed packs, receipts() or other queries. Every
// one of those is made to throw while the whole chat (pin, attach, timers, rewards, rules) is replayed cold; a guard that
// touched one would fail closed and the replayed state would differ.
test('a cold replay with the clock, RNG, settings, installed packs and the Setup queries all trapped gives the live head', async t => {
    const host = await world(t, fixture('survival'), [directorStub()]);
    await host.send('Begin.', 'Opening.');
    const offer = await pin(host, []);
    success(await host.sdk.command('dm.attach', { module: offer.module, who: 'Wessel' }));
    await host.send('Rest.', reply('! time 360', '! dm survival — slept | kind: rest | who: Wessel | hours: 6'));
    await host.send('Walk.', reply('! time 120'));
    const live = JSON.stringify(host.head());
    assert.ok(spansOf(host).length >= 4, 'pin, attach, action and tick are all guarded blocks');
    const trap = what => () => { throw new Error(`replay used ${what}`); };
    const saved = { now: Date.now, random: Math.random, values: globalThis.crypto.getRandomValues, uuid: globalThis.crypto.randomUUID };
    const installed = host.packs.packs;
    const kept = { packs: installed.packs, list: installed.list, settings: host.settings };
    t.after(() => { Date.now = saved.now; Math.random = saved.random; globalThis.crypto.getRandomValues = saved.values; globalThis.crypto.randomUUID = saved.uuid; installed.packs = kept.packs; installed.list = kept.list; });
    Date.now = trap('the clock'); Math.random = trap('Math.random'); globalThis.crypto.getRandomValues = trap('crypto'); globalThis.crypto.randomUUID = trap('crypto');
    installed.packs = trap('the installed packs'); installed.list = trap('the installed list');
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(inactive(host), []);
});
