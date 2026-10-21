import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSdk } from './helpers/fake-sdk.js';
import { fishingModule, validate, initial, LOG_SIZE, SESSION_KEEP, cast } from '../src/module.js';
import { landedLine, catchNote } from '../src/rules.js';

const LAKE = { name: 'Moonfall Lake', kind: 'lake' };

function setup(options = {}) {
    const fake = createFakeSdk(options);
    fake.sdk.registerModule(fishingModule(fake.sdk));
    return fake;
}
const count = (fake, type) => fake.calls.filter(c => c.type === type).length;
const fishing = fake => fake.head().domains.fishing;
const stacks = fake => Object.values(fake.head().domains.inventory.stacks);

async function castAndReel(fake, hooked = true, spot = LAKE) {
    const cast = await fake.sdk.command('fishing.cast', { spot });
    assert.equal(cast.ok, true, cast.message);
    const reel = await fake.sdk.command('fishing.reel', { session: cast.receipt.data.session, hooked });
    assert.equal(reel.ok, true, reel.message);
    return { cast, reel };
}

test('a cast opens a line with its bite decided, and grants nothing yet', async () => {
    const fake = setup();
    const result = await fake.sdk.command('fishing.cast', { spot: LAKE });
    assert.equal(result.ok, true);
    const { receipt } = result;
    assert.equal(receipt.type, 'fishing.cast');
    assert.equal(receipt.module, 'fishing-activity');
    assert.equal(receipt.narrate, false);
    assert.equal(receipt.summary, 'The party casts a line at Moonfall Lake.');
    assert.match(receipt.data.session, /^fs_[0-9a-z]{8}$/);
    assert.deepEqual(receipt.data.spot, LAKE);
    const session = fishing(fake).sessions[receipt.data.session];
    assert.equal(session.status, 'waiting');
    assert.equal(session.bait, null);
    assert.equal(receipt.data.bite, session.bite.bite);
    assert.equal(receipt.data.window, session.bite.window);
    assert.equal(receipt.data.catch, undefined, 'the cast receipt does not show the fish before it is landed');
    assert.equal(count(fake, 'inventory.grant'), 0);
    assert.deepEqual(stacks(fake), []);
    assert.deepEqual(fake.sdk.query('fishing.session'), { id: session.id, spot: LAKE, bait: null, bite: session.bite.bite, window: session.bite.window });
    assert.equal(session.startedRev, 0, 'startedRev is meta.rev when the line went out');
});

test('the same seed lands the same catch, whatever the reel seed', async () => {
    const outcomes = [];
    for (const reelSeed of [1, 2]) {
        const fake = setup({ seeds: [777, reelSeed] });
        const { cast, reel } = await castAndReel(fake);
        const def = Object.values(fake.head().domains.inventory.defs)[0];
        outcomes.push({ bite: [cast.receipt.data.bite, cast.receipt.data.window], summary: reel.receipt.summary, def, catch: reel.receipt.data.catch });
    }
    assert.deepEqual(outcomes[0], outcomes[1]);
    const other = setup({ seeds: [778, 1] });
    const { reel } = await castAndReel(other);
    // A different seed may land the same species, but not the same everything.
    assert.notDeepEqual({ ...reel.receipt.data.catch, id: 0, session: 0 }, { ...outcomes[0].catch, id: 0, session: 0 });
});

test('a hooked reel grants the fish through inventory.grant with the SPEC payload and narrates it', async () => {
    const fake = setup({ extraQueries: { 'party.pc': () => ({ id: 'ac_aaaaaaaa', name: 'Astra' }) } });
    const { cast, reel } = await castAndReel(fake);
    const session = fishing(fake).sessions[cast.receipt.data.session];
    const fish = session.catch;
    const grants = fake.calls.filter(c => c.type === 'inventory.grant');
    assert.equal(grants.length, 1);
    assert.deepEqual(grants[0].payload, {
        def: { name: fish.name, kind: 'goods', rarity: fish.rarity, value: fish.value, note: catchNote(fish, 'Moonfall Lake') },
        qty: 1,
        owner: 'party',
    });
    assert.equal(session.status, 'landed');
    assert.equal(reel.receipt.narrate, true);
    assert.equal(reel.receipt.summary, landedLine('Astra', fish, 'Moonfall Lake'));
    assert.match(reel.receipt.summary, /^Astra lands an? .+ at Moonfall Lake\.$/);
    const entry = reel.receipt.data.catch;
    assert.match(entry.id, /^fc_[0-9a-z]{8}$/);
    assert.equal(entry.name, fish.name);
    assert.equal(entry.grams, fish.grams);
    assert.equal(entry.value, fish.value);
    assert.equal(entry.released, false);
    const [stack] = stacks(fake);
    assert.equal(stack.qty, 1);
    assert.equal(stack.owner, 'party');
    assert.equal(entry.stack, stack.id);
    assert.equal(entry.def, stack.def);
    assert.deepEqual(fishing(fake).log, [entry]);
    assert.deepEqual(fake.sdk.query('fishing.log'), [entry]);
    assert.equal(fake.sdk.query('fishing.session'), null);
});

test('a failed reel grants nothing', async () => {
    const fake = setup();
    const { cast, reel } = await castAndReel(fake, false);
    assert.equal(count(fake, 'inventory.grant'), 0);
    assert.deepEqual(stacks(fake), []);
    assert.deepEqual(fishing(fake).log, []);
    assert.equal(fishing(fake).sessions[cast.receipt.data.session].status, 'lost');
    assert.equal(reel.receipt.summary, 'Something takes the bait at Moonfall Lake and gets away from The party.');
    assert.equal(reel.receipt.data.landed, false);
    assert.equal(reel.receipt.data.catch, undefined);
});

test('the spot comes from the scene when the cast names none', async () => {
    const fake = setup();
    fake.setPlace({ name: 'Saltmarsh Harbour', kind: 'settlement' });
    const result = await fake.sdk.command('fishing.cast', {});
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.receipt.data.spot, { name: 'Saltmarsh Harbour', kind: 'sea' });
    const named = setup();
    const byName = await named.sdk.command('fishing.cast', { spot: 'the Old Weir', bait: 'worms' });
    assert.deepEqual(byName.receipt.data.spot, { name: 'the Old Weir', kind: 'river' });
    assert.equal(fishing(named).sessions[byName.receipt.data.session].bait, 'worms');
});

async function rejects(fake, type, payload, code, message) {
    const before = fake.head();
    const result = await fake.sdk.command(type, payload);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    if (message) assert.match(result.message, message);
    assert.deepEqual(fake.head(), before, 'nothing is saved on a rejection');
}

test('every rejection leaves the state as it was', async () => {
    const fake = setup();
    fake.setPlace({ name: 'Bluewatch Village', kind: 'settlement' });
    await rejects(fake, 'fishing.cast', {}, 'INVALID', /river, a lake or the sea/);
    await rejects(fake, 'fishing.cast', { spot: { name: 'Somewhere', kind: 'puddle' } }, 'INVALID');
    const open = await fake.sdk.command('fishing.cast', { spot: LAKE });
    await rejects(fake, 'fishing.cast', { spot: LAKE }, 'INVALID', /already a line in the water at Moonfall Lake/);
    await rejects(fake, 'fishing.reel', { session: open.receipt.data.session }, 'INVALID', /hooked/);
    await rejects(fake, 'fishing.reel', { session: open.receipt.data.session, hooked: 'yes' }, 'INVALID');
    await rejects(fake, 'fishing.reel', { session: 'fs_zzzzzzzz', hooked: true }, 'NOT_FOUND');
    const reel = await fake.sdk.command('fishing.reel', { session: open.receipt.data.session, hooked: true });
    assert.equal(reel.ok, true);
    await rejects(fake, 'fishing.reel', { session: open.receipt.data.session, hooked: true }, 'CLAIMED');
    await rejects(fake, 'fishing.release', { catch: 'fc_zzzzzzzz' }, 'NOT_FOUND');
    const caught = reel.receipt.data.catch;
    assert.equal((await fake.sdk.command('fishing.release', { catch: caught.id })).ok, true);
    await rejects(fake, 'fishing.release', { catch: caught.id }, 'CLAIMED', /already back in the water/);
    assert.equal(count(fake, 'inventory.grant'), 1, 'one cast, one fish');
});

test('release puts a logged catch back into the water', async () => {
    const fake = setup();
    const first = await castAndReel(fake);
    const second = await castAndReel(fake);
    const entry = first.reel.receipt.data.catch;
    const before = stacks(fake).reduce((sum, s) => sum + s.qty, 0);
    assert.equal(before, 2);
    const result = await fake.sdk.command('fishing.release', { catch: entry.id });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.narrate, true);
    assert.match(result.receipt.summary, /^The party lets the .+ go back into Moonfall Lake\.$/);
    const consumes = fake.calls.filter(c => c.type === 'inventory.consume');
    assert.equal(consumes.length, 1);
    assert.deepEqual(consumes[0].payload, { stack: result.receipt.data.stack, qty: 1 });
    assert.equal(stacks(fake).reduce((sum, s) => sum + s.qty, 0), 1);
    const log = fishing(fake).log;
    assert.equal(log.find(e => e.id === entry.id).released, true);
    assert.equal(log.find(e => e.id === second.reel.receipt.data.catch.id).released, false);
});

test('release refuses a fish that is no longer in the pack', async () => {
    const fake = setup();
    const { reel } = await castAndReel(fake);
    const entry = reel.receipt.data.catch;
    // Eaten, sold or dropped through Story Block's own inventory commands.
    assert.equal((await fake.sdk.command('inventory.consume', { stack: entry.stack, qty: 1 })).ok, true);
    await rejects(fake, 'fishing.release', { catch: entry.id }, 'NOT_FOUND', /left in the pack/);
});

test('the log keeps the last 20 catches and old sessions are pruned', async () => {
    const fake = setup();
    const ids = [];
    for (let i = 0; i < LOG_SIZE + 5; i += 1) ids.push((await castAndReel(fake)).reel.receipt.data.catch.id);
    const log = fishing(fake).log;
    assert.equal(log.length, LOG_SIZE);
    assert.deepEqual(log.map(e => e.id), ids.slice(-LOG_SIZE));
    assert.equal(Object.keys(fishing(fake).sessions).length, SESSION_KEEP);
});

test('the validator rejects what the domain may not hold', () => {
    assert.deepEqual(validate(initial()), []);
    assert.deepEqual(validate(null), ['The fishing record is damaged.']);
    const ctx = fakeCtx();
    cast(ctx, { spot: LAKE });
    const slice = ctx.slice;
    assert.deepEqual(validate(slice), []);
    const session = Object.values(slice.sessions)[0];
    assert.equal(session.startedRev, 41, 'startedRev comes from the fishing.rev query');
    session.catch.grams = 4.5;
    assert.ok(validate(slice).some(e => /whole number of grams/.test(e)));
    session.catch.grams = 4500;
    session.status = 'gone';
    assert.ok(validate(slice).some(e => /unknown status/.test(e)));
    session.status = 'waiting';
    slice.sessions.fs_bbbbbbbb = { ...session, id: 'fs_bbbbbbbb', n: 2 };
    assert.ok(validate(slice).some(e => /one fishing line/.test(e)));
});

function fakeCtx() {
    const slice = initial();
    let x = 0.37;
    return {
        slice,
        receiptId: 'rc_aaaaaaaa',
        rng: () => (x = (x * 9301 + 0.49297) % 1),
        draft: () => slice,
        read: () => ({}),
        query: name => (name === 'fishing.rev' ? 41 : null),
        claim: () => true,
        fail: (code, message) => {
            throw Object.assign(new Error(message), { code });
        },
    };
}

test('the module shape follows SPEC §6 and adds nothing to the static prompt', () => {
    const def = fishingModule();
    assert.equal(def.id, 'fishing-activity');
    assert.deepEqual(Object.keys(def.domains), ['fishing']);
    assert.deepEqual(Object.keys(def.commands).sort(), ['fishing.cast', 'fishing.reel', 'fishing.release']);
    assert.equal(def.context.static(), '');
    assert.deepEqual(def.context.tail({ state: { domains: { fishing: initial() } } }), { lines: [], optional: [] });
    assert.equal(def.tabs[0].id, 'fishing');
    assert.equal(def.tabs[0].title, 'Fishing');
});

test('the tail mentions an open line, as an optional line', async () => {
    const fake = setup();
    await fake.sdk.command('fishing.cast', { spot: LAKE });
    const tail = fishingModule().context.tail(fake.view());
    assert.deepEqual(tail, { lines: [], optional: ['Fishing: a line is in the water at Moonfall Lake.'] });
});
