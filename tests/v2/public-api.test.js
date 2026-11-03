// The public API v1 (src/v2/public-api.js, docs/v2/PUBLIC-API.md): the frozen surface, each path family, hidden values, the events
// (with replay: a swipe, a Re-read, a delete, a reload), a listener that throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { API_EVENTS, API_VERSION, createPublicApi, diffLeaves, plainText } from '../../src/v2/public-api.js';
import { createEvents } from '../../src/v2/sdk.js';
import { VERSION } from '../../src/v2/runtime.js';
import { sheetDomain } from './lean-rpg/helpers.js';
import { character } from './lean-rpg/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
// The next time `name` fires on the api, as a promise.
const next = (api, name) => new Promise(resolve => { const off = api.on(name, payload => { off(); resolve(payload); }); });
const record = (api, names = API_EVENTS) => {
    const seen = [];
    for (const name of names) api.on(name, payload => seen.push([name, payload]));
    return seen;
};

// A test module with a data-module domain whose definitions carry state schemas (hidden fields, shown nowhere).
function blocksModule(blocks, { feature = false } = {}) {
    const domain = sheetDomain(Object.fromEntries(Object.entries(blocks).map(([slug, block]) => [slug, { role: block.definition?.role, fields: block.fields }])));
    Object.entries(blocks).forEach(([slug, block], n) => {
        const definition = domain.pins[`h${n}`].definition;
        if (definition.role === undefined) delete definition.role;
        Object.assign(definition, block.definition ?? {}, { id: `pack.chat/${slug}`, slug, name: block.definition?.name ?? slug });
        if (block.subjects) {
            domain.active[`pack.chat/${slug}`].subjects = block.subjects;
            domain.instances[`pack.chat/${slug}`] = { characters: block.characters };
        }
    });
    return {
        id: 'story-block', name: 'Test', version: '0.0.1',
        features: feature ? [{ id: 'story-block.rpg', label: 'RPG', describe: 'Test.', default: false }] : [],
        domains: { dataModules: { initial: () => domain } },
    };
}

// ---- the surface ---------------------------------------------------------------------------------------------------------------------------

test('the surface is frozen: names, arity, version, host, ready, events', { skip }, async t => {
    const host = await createHost();
    t.after(() => host.close());
    const { api } = host;
    assert.ok(Object.isFrozen(api));
    assert.deepEqual(Object.keys(api), ['version', 'host', 'ready', 'get', 'paths', 'on']);
    assert.equal(api.version, 1);
    assert.equal(API_VERSION, 1);
    assert.equal(api.host, VERSION);
    assert.equal(typeof api.get, 'function');
    assert.equal(api.get.length, 1);
    assert.equal(api.paths.length, 0);
    assert.equal(api.on.length, 2);
    assert.ok(api.ready instanceof Promise);
    assert.equal(await api.ready, api);
    assert.deepEqual([...API_EVENTS], ['story:changed', 'story:reply', 'story:rebuilt', 'story:chat']);
    assert.throws(() => { api.get = () => 1; }, TypeError);
    assert.throws(() => { api.extra = 1; }, TypeError);
    assert.throws(() => api.on('story:nothing', () => {}), /no "story:nothing" event/);
    assert.throws(() => api.on('story:chat', 'x'), /needs a function/);
    const off = api.on('story:chat', () => {});
    assert.equal(typeof off, 'function');
    assert.equal(off.length, 0);
    off();
    assert.ok(Object.isFrozen(api.paths()));
});

test('before a chat has any state every path is undefined and paths() is empty', { skip }, async t => {
    const events = createEvents();
    const api = createPublicApi({ version: '9.9.9', state: () => null, ask: () => null, events });
    assert.equal(api.get('scene.place'), undefined);
    assert.equal(api.get('money'), undefined);
    assert.deepEqual([...api.paths()], []);
    assert.equal(api.host, '9.9.9');
    events.emit('head', { index: 0, reason: 'chat' });
    assert.equal(await api.ready, api);
    t.mock.method(console, 'warn', () => {});
});

// ---- paths ---------------------------------------------------------------------------------------------------------------------------------

test('scene.*: place, kind, region, weather, present; a path that was never written is undefined', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { features: { 'story-block.weather': true } } });
    t.after(() => host.close());
    const { api } = host;
    assert.equal(api.get('scene.place'), undefined);
    assert.deepEqual(api.get('scene.present'), []);
    await host.send('Go.', reply('~ place Vell Harbour | kind: settlement | region: the Reach', '+ present Ren', '+ present Mara', '~ weather sea fog'));
    assert.equal(api.get('scene.place'), 'Vell Harbour');
    assert.equal(api.get('scene.place.kind'), 'settlement');
    assert.equal(api.get('scene.place.region'), 'the Reach');
    assert.equal(api.get('scene.weather'), 'sea fog');
    assert.deepEqual(api.get('scene.present'), ['Ren', 'Mara']);
    assert.ok(Object.isFrozen(api.get('scene.present')));
    assert.equal(api.get('scene.time'), undefined, 'no clock without Story Director');
    assert.equal(api.get('scene.date'), undefined);
    assert.equal(api.get('SCENE.Place'), 'Vell Harbour', 'paths are not case-sensitive');
    assert.equal(api.get('scene'), undefined, 'only the listed paths');
    assert.equal(api.get('scene.nothing'), undefined);
    assert.equal(api.get(42), undefined);
    assert.equal(api.get(), undefined);
});

test('scene.weather: undefined once the weather feature is off', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Go.', reply('~ place Quay', '~ weather rain'));
    assert.equal(host.api.get('scene.weather'), 'rain');
    host.features.set('story-block.weather', false);
    assert.equal(host.api.get('scene.place'), 'Quay');
    assert.equal(host.api.get('scene.weather'), undefined);
    assert.ok(!host.api.paths().includes('scene.weather'));
});

test('scene.time and scene.date: from the clock Story Director answers (director.time)', { skip }, async t => {
    const clocks = [
        [{ minutes: 100, text: 'Goldwane 12, 611, 06:40 am', parts: { year: 611, month: 3, day: 12, minutes: 400 } }, '06:40 am', 'Goldwane 12, 611'],
        [{ minutes: 100, text: '06:40, 12 March', parts: { minutes: 400 } }, '06:40', '12 March'],
        [{ minutes: 1500, text: 'Day 2', parts: { minutes: 60 } }, '01:00', 'Day 2'],
        [{ minutes: null, text: '', parts: null }, undefined, undefined],
    ];
    for (const [answer, time, date] of clocks) {
        const host = await createHost({ modules: [{ id: 'story-director', name: 'Director', version: '1', domains: {}, queries: { 'director.time': () => answer } }] });
        await host.send('Go.', 'Opening.');
        assert.equal(host.api.get('scene.time'), time, JSON.stringify(answer));
        assert.equal(host.api.get('scene.date'), date, JSON.stringify(answer));
        host.close();
    }
});

test('money and money.text: in the smallest coin and as the chat writes it', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { modules: { 'story-block': { coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }], currency: 'copper' } } } });
    t.after(() => host.close());
    assert.equal(host.api.get('money'), 0);
    await host.send('Go.', reply('+ coin 65'));
    assert.equal(host.api.get('money'), 65);
    assert.equal(host.api.get('money.text'), '6 silver 5 copper');
    assert.equal(host.api.get('money.gold'), undefined);
});

test('items, items.<name>.qty: the party\'s bag; names with dots and any case work; the stacks of a name add up', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    assert.deepEqual(host.api.get('items'), []);
    await host.send('Go.', reply('+ item Healing Draught | qty: 2 | note: bitter', "+ item Mr. Fox's Pie | note: still warm", '+ item Lamp'));
    const list = host.api.get('items');
    assert.deepEqual(list.map(item => item.name).sort(), ['Healing Draught', 'Lamp', "Mr. Fox's Pie"]);
    assert.deepEqual(Object.keys(list[0]), ['name', 'qty', 'kind', 'note']);
    assert.equal(host.api.get('items.Healing Draught.qty'), 2);
    assert.equal(host.api.get('items.healing draught.qty'), 2);
    assert.equal(host.api.get("items.Mr. Fox's Pie.qty"), 1);
    assert.equal(host.api.get("items.Mr. Fox's Pie.note"), 'still warm');
    assert.equal(host.api.get('items.Healing Draught.kind'), 'goods');
    assert.equal(host.api.get('items.Lamp.note'), undefined);
    assert.equal(host.api.get('items.Nothing.qty'), undefined);
    assert.deepEqual(host.api.get('items.Lamp'), { name: 'Lamp', qty: 1, kind: 'goods', note: '' });
    await host.send('More.', reply('+ item Healing Draught | qty: 3'));
    assert.equal(host.api.get('items.Healing Draught.qty'), 5);
    assert.throws(() => { host.api.get('items').push(1); }, TypeError);
    assert.throws(() => { host.api.get('items')[0].qty = 9; }, TypeError);
    assert.ok(host.api.paths().includes('items.Healing Draught.qty'));
    assert.ok(host.api.paths().includes("items.Mr. Fox's Pie.note"));
});

const PARTY = () => ({
    wessel: { definition: { role: 'character' }, fields: character('Wessel', { level: 4, xp: 30 }) },
    ren: { definition: { role: 'character' }, fields: character('Ren', { str: 8, int: 16, level: 2, xp: 10, health: 3 }) },
});

test('party and party.<name>.<field>, party.me.<field>: the Characters while the RPG is on', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ core: false, modules: [blocksModule(PARTY(), { feature: true })], st: { user: 'Ren' } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    await host.send('Go.', 'Opening.');
    const { api } = host;
    assert.deepEqual(api.get('party').map(member => member.name), ['Ren', 'Wessel'], 'in block-id order');
    assert.deepEqual(api.get('party.Wessel'), { name: 'Wessel', level: 4, xp: 30, health: 'Unhurt', mana: 'Fresh', stamina: 'Fresh', stats: { str: 14, vit: 12, agi: 12, dex: 10, int: 8, luk: 9, cha: 10 } });
    assert.equal(api.get('party.wessel.level'), 4);
    assert.equal(api.get('party.Ren.health'), 'Hurt');
    assert.equal(api.get('party.Ren.stats.int'), 16);
    assert.deepEqual(api.get('party.Ren.stats').int, 16);
    assert.equal(api.get('party.me.name'), 'Ren');
    assert.equal(api.get('party.me.level'), 2);
    assert.equal(api.get('party.me.xp'), 10);
    assert.equal(api.get('party.me.health'), 'Hurt');
    assert.equal(api.get('party.me.stats.str'), 8);
    assert.equal(api.get('party.Nobody.level'), undefined);
    assert.ok(api.paths().includes('party.me.mana'));
    assert.ok(api.paths().includes('party.Wessel.stamina'));
    // The reader is nobody in particular: party.me reads nothing (the first block is not guessed).
    host.ctx.name1 = 'Somebody Else';
    assert.equal(api.get('party.me.level'), undefined);
    assert.equal(api.get('party.me'), undefined);
    assert.equal(api.get('party.Ren.level'), 2);
    // A stage the pack names reads as its name.
    const named = blocksModule({ ren: { definition: { role: 'character', state: { health: { type: 'int', min: 0, max: 5, default: 5, names: { 5: 'Hale', 3: 'Bruised' } } } }, fields: character('Ren', { health: 3 }) } }, { feature: true });
    const second = await createHost({ core: false, modules: [named], st: { user: 'Ren' } });
    t.after(() => second.close());
    second.features.set('story-block.rpg', true);
    await second.send('Go.', 'Opening.');
    assert.equal(second.api.get('party.me.health'), 'Bruised');
});

test('party: undefined while the RPG is off, whatever the chat holds', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ core: false, modules: [blocksModule(PARTY(), { feature: true })], st: { user: 'Ren' } });
    t.after(() => host.close());
    await host.send('Go.', 'Opening.');
    assert.equal(host.api.get('party'), undefined);
    assert.equal(host.api.get('party.me.level'), undefined);
    assert.equal(host.api.get('blocks.pack.chat/wessel.who'), undefined, 'a role block is part of the RPG');
    assert.deepEqual(host.api.paths().filter(path => path.startsWith('party') || path.startsWith('blocks.')), []);
    host.features.set('story-block.rpg', true);
    assert.equal(host.api.get('party.me.level'), 2);
    host.features.set('story-block.rpg', false);
    assert.equal(host.api.get('party.me.level'), undefined);
});

const TRACKER = {
    definition: {
        state: {
            hope: { type: 'int', min: 0, max: 9, default: 3 },
            dread: { type: 'int', min: 0, max: 9, default: 1, prompt: false },
            title: { type: 'text', max: 40, default: '' },
            marks: { type: 'map', keys: ['a', 'b'], values: { type: 'int', min: 0, max: 5 } },
        },
    },
    fields: { hope: 4, dread: 7, title: 'The Lamp-lighter', marks: { a: 2, b: 0 } },
};

test('blocks.<blockId>.<field>: any pinned block, the id with its dots and slash; a map reads by key', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ core: false, modules: [blocksModule({ tracker: TRACKER })] });
    t.after(() => host.close());
    await host.send('Go.', 'Opening.');
    const { api } = host;
    assert.deepEqual(api.get('blocks'), ['pack.chat/tracker']);
    assert.equal(api.get('blocks.pack.chat/tracker.hope'), 4);
    assert.equal(api.get('blocks.pack.chat/tracker.title'), 'The Lamp-lighter');
    assert.deepEqual(api.get('blocks.pack.chat/tracker.marks'), { a: 2, b: 0 });
    assert.equal(api.get('blocks.pack.chat/tracker.marks.a'), 2);
    assert.equal(api.get('blocks.PACK.chat/Tracker.hope'), 4);
    assert.deepEqual(api.get('blocks.pack.chat/tracker'), { hope: 4, title: 'The Lamp-lighter', marks: { a: 2, b: 0 } });
    assert.equal(api.get('blocks.pack.chat/tracker.nothing'), undefined);
    assert.equal(api.get('blocks.pack.chat/other.hope'), undefined);
    assert.ok(api.paths().includes('blocks.pack.chat/tracker.hope'));
    assert.ok(Object.isFrozen(api.get('blocks.pack.chat/tracker.marks')));
});

test('a character block reads by who: blocks.<blockId>.<who>.<field>', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const block = { definition: { scope: 'character', state: { trust: { type: 'int', min: 0, max: 9, default: 0 } } }, subjects: ['ca_aaaaaaaa'], characters: { ca_aaaaaaaa: { fields: { trust: 6 } } } };
    const host = await createHost({ core: false, modules: [blocksModule({ bond: block })] });
    t.after(() => host.close());
    await host.send('Go.', 'Opening.');
    assert.equal(host.api.get('blocks.pack.chat/bond.ca_aaaaaaaa.trust'), 6);
    assert.deepEqual(host.api.get('blocks.pack.chat/bond.ca_aaaaaaaa'), { trust: 6 });
});

// ---- hidden values -------------------------------------------------------------------------------------------------------------------------

test('hidden: a field the pack hides from the story (prompt: false) reads as undefined, as its path is not listed; a block shown nowhere is not there', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const secret = { definition: { show: { tab: false, card: false }, state: { plan: { type: 'int', min: 0, max: 9, default: 0 } } }, fields: { plan: 5 } };
    const shown = { definition: { show: { tab: true, card: false }, state: { plan: { type: 'int', min: 0, max: 9, default: 0 } } }, fields: { plan: 6 } };
    const host = await createHost({ core: false, modules: [blocksModule({ tracker: TRACKER, secret, shown })] });
    t.after(() => host.close());
    await host.send('Go.', 'Opening.');
    const { api } = host;
    assert.equal(api.get('blocks.pack.chat/tracker.dread'), undefined);
    assert.equal(api.get('blocks.pack.chat/tracker.hope'), 4);
    assert.ok(!('dread' in api.get('blocks.pack.chat/tracker')));
    assert.equal(api.get('blocks.pack.chat/secret.plan'), undefined);
    assert.equal(api.get('blocks.pack.chat/secret'), undefined);
    assert.equal(api.get('blocks.pack.chat/shown.plan'), 6);
    assert.deepEqual(api.get('blocks'), ['pack.chat/shown', 'pack.chat/tracker']);
    const listed = JSON.stringify(api.paths());
    assert.ok(!listed.includes('dread') && !listed.includes('secret'), listed);
    // Nothing of a hidden value is in the leaves the events compare either.
    assert.ok(![...api.paths()].some(path => /dread|secret/.test(path)));
});

test('hidden: a member\'s hidden level, xp, bar and stat are left out; a hidden Who is the block\'s name', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const hidden = {
        definition: { role: 'character', name: 'Stranger', state: {
            who: { type: 'text', max: 40, default: '', prompt: false }, level: { type: 'int', min: 1, max: 99, default: 1, prompt: false }, xp: { type: 'int', min: 0, max: 100, default: 0, prompt: false },
            mana: { type: 'int', min: 0, max: 4, default: 4, prompt: false }, luk: { type: 'int', min: 1, max: 20, default: 9, prompt: false },
        } },
        fields: character('Ysolde', { level: 9, xp: 55, mana: 1, luk: 17 }),
    };
    const host = await createHost({ core: false, modules: [blocksModule({ ysolde: hidden }, { feature: true })], st: { user: 'Stranger' } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    await host.send('Go.', 'Opening.');
    const member = host.api.get('party.Stranger');
    assert.equal(member.name, 'Stranger', 'the hidden name is not given');
    assert.equal(member.level, undefined);
    assert.equal(member.xp, undefined);
    assert.equal(member.mana, undefined);
    assert.equal(member.stats.luk, undefined);
    assert.equal(member.health, 'Unhurt');
    assert.equal(member.stats.str, 14);
    assert.equal(host.api.get('party.me.level'), undefined);
    assert.equal(host.api.get('party.Ysolde.level'), undefined);
    assert.ok(!JSON.stringify(host.api.paths()).includes('Ysolde'));
    assert.ok(!JSON.stringify(host.api.get('party')).includes('Ysolde'));
});

// ---- the events ----------------------------------------------------------------------------------------------------------------------------

test('story:changed and story:reply after a live reply: the public paths before and after, in order, once saved', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    const seen = record(host.api);
    const saved = [];
    host.api.on('story:reply', () => saved.push(host.store.dirty()));
    await host.send('Go.', reply('~ place Cellar', '+ coin 5', '+ item Lamp'));
    await settle();
    assert.deepEqual(seen.map(([name]) => name), ['story:changed', 'story:reply']);
    const [[, changed], [, said]] = seen;
    assert.equal(changed.index, host.store.headIndex());
    assert.deepEqual(Object.keys(changed), ['index', 'changes']);
    assert.deepEqual(changed.changes.map(change => change.path), ['items.Lamp.kind', 'items.Lamp.qty', 'money', 'money.text', 'scene.place']);
    assert.deepEqual(changed.changes.find(change => change.path === 'money'), { path: 'money', from: 0, to: 5 });
    assert.deepEqual(changed.changes.find(change => change.path === 'scene.place'), { path: 'scene.place', from: null, to: 'Cellar' });
    assert.deepEqual(Object.keys(said), ['index', 'summary']);
    assert.match(said.summary, /money: 5/);
    assert.match(said.summary, /scene\.place: Cellar/);
    assert.ok(Object.isFrozen(changed) && Object.isFrozen(changed.changes) && Object.isFrozen(changed.changes[0]));
    assert.deepEqual(saved, [false], 'the reply is written before its listeners hear of it');
    // A reply that changes nothing public: a reply event, no changed event.
    seen.length = 0;
    await host.send('Again.', 'Nothing happens.');
    await settle();
    assert.deepEqual(seen.map(([name]) => name), ['story:reply']);
    assert.equal(seen[0][1].summary, '');
    // A second reply: the change is from the first reply's state.
    seen.length = 0;
    await host.send('More.', reply('+ coin 2'));
    await settle();
    assert.deepEqual(seen[0][1].changes.find(change => change.path === 'money'), { path: 'money', from: 5, to: 7 });
});

test('no listener, no work: a reply is saved when its own idle save comes', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    let before = 0;
    host.store.saveSoon = () => { before += 1; return Promise.resolve(true); };
    await host.send('Go.', reply('+ coin 5'));
    await settle();
    assert.equal(before, 0, 'with no listener the api asks the store for nothing');
});

test('story:rebuilt after a swipe, and the state the listener reads is the one a reload reads', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Go.', reply('+ coin 5', '~ place Cellar'));
    await host.swipe(reply('+ coin 9', '~ place Attic'));
    const seen = record(host.api, ['story:rebuilt', 'story:changed']);
    const index = host.store.headIndex();
    const reads = [];
    host.api.on('story:rebuilt', () => reads.push(Object.fromEntries(host.api.paths().map(path => [path, host.api.get(path)]))));
    // The reader goes back to the first swipe.
    await host.st.swipeTo(index, 0);
    await settle();
    assert.deepEqual(seen.map(([name, payload]) => [name, payload.reason]), [['story:rebuilt', 'swipe']]);
    assert.deepEqual(Object.keys(seen[0][1]), ['reason']);
    assert.equal(host.api.get('money'), 5);
    assert.equal(host.api.get('scene.place'), 'Cellar');
    // A page reload: a new host over the same chat file reads the same public state.
    const again = await createHost({ st: { chat: structuredClone(host.ctx.chat), chatMetadata: structuredClone(host.ctx.chatMetadata), chatId: host.ctx.chatId } });
    t.after(() => again.close());
    const fresh = Object.fromEntries(again.api.paths().map(path => [path, again.api.get(path)]));
    assert.deepEqual(reads.at(-1), fresh);
    assert.ok(Object.keys(fresh).length > 3);
});

test('story:rebuilt after Re-read, a delete and a chat change; story:chat with the chat id; a changed chat again is a reload', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Go.', reply('+ coin 5'));
    const seen = record(host.api, ['story:rebuilt', 'story:chat', 'story:changed']);
    const index = host.store.headIndex();
    const done = await host.sdk.reread(index);
    assert.equal(done.ok, true, JSON.stringify(done));
    await settle();
    assert.deepEqual(seen.map(([name, payload]) => [name, payload.reason ?? payload.chatId]), [['story:rebuilt', 'reread']]);
    seen.length = 0;
    await host.send('Next.', reply('+ coin 1'));
    seen.length = 0;
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await settle();
    assert.deepEqual(seen.map(([name, payload]) => [name, payload.reason]), [['story:rebuilt', 'delete']]);
    assert.equal(host.api.get('money'), 5, 'the deleted reply\'s coin is gone');
    seen.length = 0;
    // The same chat read again: story:chat, then a reload.
    await host.st.loadChat(host.ctx.chat, 'chat-1');
    await settle();
    assert.deepEqual(seen.map(([name, payload]) => [name, payload.reason ?? payload.chatId]), [['story:chat', 'chat-1'], ['story:rebuilt', 'reload']]);
    seen.length = 0;
    await host.st.loadChat(host.ctx.chat, 'chat-2');
    await settle();
    assert.deepEqual(seen.map(([name, payload]) => [name, payload.reason ?? payload.chatId]), [['story:chat', 'chat-2']]);
    assert.deepEqual(Object.keys(seen[0][1]), ['chatId']);
    assert.equal(host.api.get('money'), 5);
});

test('a message edit is not announced as a rebuild', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Go.', reply('+ coin 5'));
    const seen = record(host.api);
    await host.st.editMessage(host.store.headIndex(), host.ctx.chat[host.store.headIndex()].mes + ' ');
    await settle();
    assert.deepEqual(seen, []);
});

test('the lines a module adds to a reply afterwards (the safety net\'s way) are told as their own change, not the reply\'s again', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    let late = true;
    const addLate = { id: 'late-lines', name: 'Late', version: '1', domains: {}, hooks: { afterReply: ({ capture }) => (late ? capture('+ coin 3') : undefined) } };
    const host = await createHost({ modules: [addLate] });
    t.after(() => host.close());
    const seen = record(host.api, ['story:changed', 'story:reply']);
    await host.send('Go.', reply('+ coin 5'));
    await settle();
    await settle();
    const names = seen.map(([name]) => name);
    assert.deepEqual(names, ['story:changed', 'story:reply', 'story:changed'], names.join());
    assert.deepEqual(seen[0][1].changes.find(change => change.path === 'money'), { path: 'money', from: 0, to: 5 });
    assert.deepEqual(seen[2][1].changes.map(change => change.path), ['money', 'money.text']);
    assert.deepEqual(seen[2][1].changes.find(change => change.path === 'money'), { path: 'money', from: 5, to: 8 });
    assert.equal(seen[2][1].index, seen[0][1].index);
    late = false;
});

test('a listener that throws does not break a reply, and is told once', { skip }, async t => {
    const warned = [];
    t.mock.method(console, 'warn', (...args) => warned.push(args.map(String).join(' ')));
    const host = await createHost();
    t.after(() => host.close());
    let calls = 0;
    host.api.on('story:reply', () => { calls += 1; throw new Error('boom'); });
    host.api.on('story:reply', async () => { throw new Error('async boom'); });
    const heard = [];
    host.api.on('story:changed', payload => heard.push(payload.changes.length));
    const first = await host.send('Go.', reply('+ coin 5'));
    await settle();
    assert.ok(first, 'the reply was taken');
    assert.equal(host.api.get('money'), 5);
    await host.send('More.', reply('+ coin 1'));
    await settle();
    assert.equal(calls, 2, 'the listener keeps being called');
    assert.equal(host.api.get('money'), 6);
    assert.equal(heard.length, 2, 'the others still hear');
    assert.equal(warned.filter(line => /a "story:reply" listener failed/.test(line)).length, 2, 'one line per failing listener, not per reply');
    assert.equal(host.store.dirty(), false);
});

test('off() stops a listener; on() twice with one function is one listener', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    let count = 0;
    const fn = () => { count += 1; };
    const off = host.api.on('story:reply', fn);
    host.api.on('story:reply', fn);
    await host.send('Go.', 'One.');
    await settle();
    assert.equal(count, 1);
    off();
    await host.send('Go.', 'Two.');
    await settle();
    assert.equal(count, 1);
});

test('diffLeaves and plainText', () => {
    const a = new Map([['x', 1], ['y', ['a']], ['z', 'same']]);
    const b = new Map([['x', 2], ['y', ['a']], ['z', 'same'], ['w', 'new']]);
    assert.deepEqual(diffLeaves(a, b), [{ path: 'w', from: null, to: 'new' }, { path: 'x', from: 1, to: 2 }]);
    assert.deepEqual(diffLeaves(new Map([['gone', 1]]), new Map()), [{ path: 'gone', from: 1, to: null }]);
    assert.equal(plainText('a\nb'), 'a b');
    assert.equal(plainText(0), '0');
    assert.equal(plainText(false), 'false');
    assert.equal(plainText(['Ren', 'Mara']), 'Ren, Mara');
    assert.equal(plainText([{ name: 'Lamp', qty: 2 }, { name: 'Rope' }]), 'Lamp x2, Rope');
    assert.equal(plainText([]), null);
    assert.equal(plainText({ a: 1 }), null);
    assert.equal(plainText(undefined), null);
    assert.equal(plainText('   '), null);
    assert.equal(plainText(Infinity), null);
});

test('a change in the party is a public change: xp and level of a member, by name', () => {
    const states = [30, 130].map(xp => ({ domains: { dataModules: sheetDomain({ ren: { role: 'character', fields: character('Ren', { level: xp > 100 ? 3 : 2, xp }) } }) } }));
    const events = createEvents();
    const api = createPublicApi({ version: '1', state: () => states[1], before: () => states[0], ask: () => null, rpgOn: () => true, persona: () => 'Ren', events });
    const seen = [];
    api.on('story:changed', payload => seen.push(payload));
    events.emit('turn', { index: 3, type: 'normal', receipts: [], steps: [], problems: [], told: [] });
    return new Promise(resolve => setTimeout(resolve, 10)).then(() => {
        assert.equal(seen.length, 1);
        assert.deepEqual(seen[0].changes, [{ path: 'party.Ren.level', from: 2, to: 3 }, { path: 'party.Ren.xp', from: 30, to: 130 }]);
        assert.equal(api.get('party.me.xp'), 130);
    });
});
