// What a reply laid out goes away with it (Story Block 2.6.1): a loot take (`inventory.lootTake`) is a guarded block
// (docs/v2/REPLAY.md, predicate `loot.take`, inventory.js lootTakeGuard) that applies, with its claim `loot:<sid>`,
// only while the offering reply's offer still lays out what was taken. Deleting the offering reply, or editing it and
// Re-reading so the offer no longer holds a taken thing, turns the take off (items, coin and claim; a Problem says why);
// an unchanged Re-read, or one that still offers what was taken, keeps it. Live, rebuild and reload agree, for a take
// made on the offering reply and on a later one. A chat saved by 2.6.0 loads as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';
import { lootTakeGuard } from '../../src/v2/domains/inventory.js';
import { hashJson } from '../../src/v2/replay.js';
import { readRecord } from '../../src/v2/persist.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const headSid = host => host.store.carrierSid(host.store.headIndex());
const take = (host, sid, pick) => host.sdk.command('inventory.lootTake', { sid, pick });
const at = (host, start) => host.ctx.chat.findIndex(message => !message.is_user && message.mes.startsWith(start));
const claimed = (host, sid) => Object.hasOwn(host.head().meta.claims, `loot:${sid}`);
const offPs = host => host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE');
const riverside = () => {
    const sample = JSON.parse(readFileSync(new URL('../../examples/packs/riverside-starter/pack.json', import.meta.url), 'utf8'));
    sample.start.inventory = { items: [], money: 0 };
    return sample;
};
const packEntry = (sample, enabled) => ({ id: sample.id, version: sample.version, enabled, source: 'file', origin: 'test', pack: sample });

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

// The state live, after a rebuild and after a reload of the chat as saved, are the same.
async function agrees(t, host, label) {
    const live = structuredClone(host.head());
    const problems = host.store.problems().map(problem => [problem.code, problem.why]);
    host.store.rebuild();
    assert.deepEqual(host.head(), live, `${label}: a rebuild equals live`);
    assert.deepEqual(host.store.problems().map(problem => [problem.code, problem.why]), problems, `${label}: the same Problems after a rebuild`);
    const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head(), live, `${label}: a reload equals live`);
    return live;
}

// A crate (Torch x2, Rope, 5 gold) and a later reply; `later` takes on that later reply, else on the crate's own.
async function crate(t, { later }) {
    const host = await fresh(t);
    await host.send('Search the crate.', reply('A crate.', ['? loot Torch x2, Rope, 5 gold — in the crate']));
    const sid = headSid(host);
    if (later) await host.send('Walk on.', reply('The road goes on.', ['+ item Apple']));
    const taken = await take(host, sid, [0, 2]);
    assert.equal(taken.ok, true, taken.message);
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [2, 5, true]);
    assert.equal(taken.receipt.data.v2.guard.predicate.kind, 'loot.take');
    return { host, sid };
}

for (const later of [false, true]) {
    const where = later ? 'a later reply' : 'the offering reply';

    test(`a take on ${where}: deleting the offering reply takes the take back (items, coin, claim); rebuild and reload agree`, async t => {
        const { host, sid } = await crate(t, { later });
        await host.send('On.', reply('Further on.', ['+ item Lamp']));
        const index = at(host, 'A crate.');
        await host.st.deleteMessage(index);
        await host.st.deleteMessage(index - 1);
        assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid), qty(host, 'Lamp')], [0, 0, false, 1]);
        if (later) assert.equal(qty(host, 'Apple'), 1, 'the later reply\'s own change stays');
        // A take on a later reply stays stored there, off, and says why; one on the offering reply went with it.
        assert.deepEqual(offPs(host).map(problem => problem.why), later ? ['its guard no longer holds: the loot it took is no longer on offer'] : []);
        await agrees(t, host, 'after the delete');
    });

    test(`a take on ${where}: an edit and Re-read that drops a taken thing takes the take back; rebuild and reload agree`, async t => {
        const { host, sid } = await crate(t, { later });
        const index = at(host, 'A crate.');
        await host.st.editMessage(index, reply('A crate, mostly empty.', ['? loot Rope, 5 gold — in the crate']));
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [0, 0, false]);
        assert.deepEqual(Object.values(host.head().domains.inventory.loot[sid].items).map(item => item.name), ['Rope', '5 gold'], 'the offer as it reads now');
        assert.deepEqual(offPs(host).map(problem => problem.why), ['its guard no longer holds: the loot on offer no longer holds Torch ×2 it took']);
        await agrees(t, host, 'after the Re-read');
        // The claim is free again: the reader may take from the offer as it is now, once.
        const again = await take(host, sid, [0]);
        assert.equal(again.ok, true, again.message);
        assert.deepEqual([qty(host, 'Rope'), qty(host, 'Torch'), claimed(host, sid)], [1, 0, true]);
        assert.equal((await take(host, sid, [1])).code, 'REFUSED', 'still once per reply');
        await agrees(t, host, 'after the second take');
    });

    test(`a take on ${where}: an edit and Re-read that offers fewer than were taken takes it back, and less money too`, async t => {
        const { host } = await crate(t, { later });
        const index = at(host, 'A crate.');
        await host.st.editMessage(index, reply('A crate.', ['? loot Torch, Rope, 5 gold — in the crate']));
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.deepEqual([qty(host, 'Torch'), coin(host)], [0, 0]);
        await host.st.editMessage(index, reply('A crate.', ['? loot Torch x2, Rope, 3 gold — in the crate']));
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.deepEqual([qty(host, 'Torch'), coin(host)], [0, 0]);
        assert.deepEqual(offPs(host).map(problem => problem.why), ['its guard no longer holds: the loot on offer no longer holds the money it took']);
        await agrees(t, host, 'after the Re-reads');
    });

    test(`a take on ${where}: an unchanged Re-read, or an edit that still offers what was taken, keeps the take`, async t => {
        const { host, sid } = await crate(t, { later });
        const index = at(host, 'A crate.');
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [2, 5, true]);
        // A Re-read of the reply that holds a later take keeps it too.
        if (later) {
            assert.equal((await host.turn.reread(at(host, 'The road goes on.'))).ok, true);
            assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid), qty(host, 'Apple')], [2, 5, true, 1]);
        }
        // More of it, a thing added before it, another place, another way of writing the name: it still lays out what was taken.
        await host.st.editMessage(index, reply('A crate, now with a lamp.', ['? loot Lamp, torch x3, Rope, 9 gold — at the back of the crate']));
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid), qty(host, 'Lamp')], [2, 5, true, 0]);
        assert.deepEqual(host.store.problems(), []);
        await agrees(t, host, 'after the compatible Re-read');
        // An earlier reply deleted that the offer does not depend on leaves the take as it is.
        await host.send('More.', reply('Even more road.', ['+ coin 1']));
        await host.st.deleteMessage(at(host, 'The road.'));
        assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [2, 6, true]);
        assert.deepEqual(host.store.problems(), []);
        await agrees(t, host, 'after an unrelated delete');
    });

    test(`a take on ${where}: putting the offer back brings the take back, once`, async t => {
        const { host, sid } = await crate(t, { later });
        const index = at(host, 'A crate.');
        await host.st.editMessage(index, reply('A crate.', ['? loot Rope — in the crate']));
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.equal(qty(host, 'Torch'), 0);
        await host.st.editMessage(index, reply('A crate.', ['? loot Torch x2, Rope, 5 gold — in the crate']));
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [2, 5, true]);
        assert.deepEqual(host.store.problems(), []);
        await agrees(t, host, 'after the offer came back');
    });
}

test('a swipe of the offering reply takes the take back; swiping back brings it again; rebuild and reload agree', async t => {
    const { host, sid } = await crate(t, { later: false });
    await host.swipe(reply('An empty crate.', ['+ coin 1']));
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [0, 1, false]);
    assert.deepEqual(host.store.problems(), []);
    await agrees(t, host, 'on the other swipe');
    const index = host.ctx.chat.length - 1;
    await host.st.swipeTo(index, 0);
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [2, 5, true]);
    await agrees(t, host, 'back on the first swipe');
});

test('a swipe of the reply that holds a later take takes it back; the offer stays to take again', async t => {
    const { host, sid } = await crate(t, { later: true });
    await host.swipe(reply('The road goes on, quietly.', ['+ item Apple']));
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [0, 0, false]);
    assert.ok(host.head().domains.inventory.loot[sid]);
    assert.deepEqual(host.store.problems(), []);
    assert.equal((await take(host, sid, [1])).ok, true);
    assert.deepEqual([qty(host, 'Rope'), qty(host, 'Torch')], [1, 0]);
    await agrees(t, host, 'after taking again on the new swipe');
});

// The review's repro: an offer of 51 Willow Rods read while the rod still stacked, the pack enabled after, another reply,
// then the older offer taken (50, the rest left); its reply then deleted, or edited and Re-read.
async function rods(t) {
    const sample = riverside();
    const host = await fresh(t, { settings: { packs: [packEntry(sample, false)] } });
    await host.send('Look.', reply('A rack of rods.', ['? loot Willow Rod x51 — on the rack']));
    const sid = headSid(host);
    assert.equal(await host.packs.packs.setEnabled(sample.id, true), true);
    await host.send('On.', reply('The road.', ['+ coin 1']));
    const taken = await take(host, sid, [0]);
    assert.equal(taken.ok, true, taken.message);
    assert.deepEqual(taken.receipt.data.left, [{ name: 'Willow Rod', qty: 1 }]);
    assert.match(taken.receipt.summary, /^The party takes Willow Rod ×50 \(on the rack\)\. Willow Rod is left where it lay: a thing that does not stack is given at most 50 at once\.$/);
    assert.equal(qty(host, 'Willow Rod'), 50);
    return { host, sid };
}

test('50 of 51 Willow Rods taken on a later reply: deleting the offering reply takes all 50 and the claim back', async t => {
    const { host, sid } = await rods(t);
    await host.st.deleteMessage(at(host, 'A rack of rods.'));
    assert.deepEqual([qty(host, 'Willow Rod'), claimed(host, sid)], [0, false]);
    assert.equal(offPs(host).length, 1);
    await agrees(t, host, 'after the delete');
});

test('50 of 51 Willow Rods taken on a later reply: replacing the offer\'s text and Re-reading takes them back', async t => {
    const { host, sid } = await rods(t);
    const index = at(host, 'A rack of rods.');
    await host.st.editMessage(index, 'An empty rack.');
    assert.equal((await host.turn.reread(index)).ok, true);
    assert.deepEqual([qty(host, 'Willow Rod'), claimed(host, sid)], [0, false]);
    assert.equal(offPs(host).length, 1);
    await agrees(t, host, 'after the Re-read');
});

test('50 of 51 Willow Rods taken on a later reply: an unchanged Re-read (now offering 50) keeps the 50', async t => {
    const { host, sid } = await rods(t);
    const index = at(host, 'A rack of rods.');
    assert.equal((await host.turn.reread(index)).ok, true);
    assert.equal(host.head().domains.inventory.loot[sid].items[0].qty, 50, 'read again under the pack, the offer holds 50');
    assert.deepEqual([qty(host, 'Willow Rod'), claimed(host, sid)], [50, true]);
    assert.deepEqual(host.store.problems(), []);
    await agrees(t, host, 'after the Re-read');
});

test('the offer saved by f74bab2: a take on its own reply goes with an edit and Re-read of that reply', async t => {
    t.mock.method(console, 'warn', () => {});
    const sample = riverside();
    const saved = JSON.parse(readFileSync(new URL('./domains/fixtures/loot-2.6.0-f74bab2-chat.json', import.meta.url), 'utf8'));
    const host = await createHost({ st: { chat: saved.chat }, settings: { packs: [packEntry(sample, true)] } });
    t.after(() => host.close());
    const sid = headSid(host);
    assert.equal((await take(host, sid, [0])).ok, true);
    assert.equal(qty(host, 'Willow Rod'), 50);
    const index = at(host, 'A rack of rods.');
    await host.st.editMessage(index, reply('A bare rack.', ['+ coin 2']));
    assert.equal((await host.turn.reread(index)).ok, true);
    assert.deepEqual([qty(host, 'Willow Rod'), claimed(host, sid), coin(host)], [0, false, 2]);
    await agrees(t, host, 'after the Re-read');
});

// tests/v2/domains/fixtures/loot-take-2.6.0-chat.json was saved by Story Block 2.6.0 (74ff72d): Torch ×2 taken on the crate
// reply that offered it, the Lantern of the shelf reply taken on the reply after it. Its takes are blocks of the old kind
// (no guard), which the host replays as they were stored: the chat opens as 2.6.0 left it, with no Problem, and a new take
// made on it is guarded.
test('a chat saved by 2.6.0 with loot taken opens as it was; its takes replay as stored; a new take is guarded', async t => {
    t.mock.method(console, 'warn', () => {});
    const saved = JSON.parse(readFileSync(new URL('./domains/fixtures/loot-take-2.6.0-chat.json', import.meta.url), 'utf8'));
    const host = await createHost({ st: { chat: structuredClone(saved.chat) } });
    t.after(() => host.close());
    assert.deepEqual(host.head().domains.inventory, saved.inventory);
    assert.deepEqual(host.head().meta.claims, saved.claims);
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual([qty(host, 'Torch'), qty(host, 'Lantern')], [2, 1]);
    await agrees(t, host, 'opened');
    // An unchanged Re-read of either offering reply keeps everything.
    for (const start of ['A crate.', 'A shelf.']) assert.equal((await host.turn.reread(at(host, start))).ok, true);
    assert.deepEqual(host.head().domains.inventory, saved.inventory);
    assert.deepEqual(host.store.problems(), []);
    // A new offer and take on the opened chat is a guarded one, and goes with its offer.
    await host.send('Look under the bench.', reply('A bench.', ['? loot Hammer — under the bench']));
    const sid = headSid(host);
    await host.send('Walk.', reply('The road again.', ['+ coin 1']));
    const taken = await take(host, sid, [0]);
    assert.equal(taken.ok, true, taken.message);
    assert.equal(taken.receipt.data.v2.guard.predicate.kind, 'loot.take');
    assert.equal(qty(host, 'Hammer'), 1);
    await host.st.deleteMessage(at(host, 'A bench.'));
    assert.deepEqual([qty(host, 'Hammer'), qty(host, 'Torch'), qty(host, 'Lantern')], [0, 2, 1]);
    await agrees(t, host, 'after the new take\'s offer went');
});

// The earliest replies deleted (B-b2-timeline-3): the first reply left starts from the state they ended with, but what a
// deleted reply laid out goes with it, and a take of it does not stand, on the deleted reply or on a later one; the rest
// of what the deleted replies did is carried as before.
async function firstOffer(t, { later, checkpointEvery = null }) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(checkpointEvery ? { storeOptions: { checkpointEvery } } : {});
    t.after(() => host.close());
    await host.send('Search the crate.', reply('A crate.', ['+ item Rope', '? loot Torch x2, 5 gold — in the crate']));
    const sid = headSid(host);
    if (later) await host.send('Walk on.', reply('The road goes on.', ['+ item Apple']));
    const taken = await take(host, sid, [0, 1]);
    assert.equal(taken.ok, true, taken.message);
    await host.send('More.', reply('Further on.', ['+ item Lamp']));
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid), qty(host, 'Rope')], [2, 5, true, 1]);
    return { host, sid };
}
// `rope`: the Rope the offering reply gave by its own line, carried when that reply was the first one left (1), gone with
// it when it was deleted from the middle (0).
function goneWithIt(host, sid, later, label, rope = 1) {
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [0, 0, false], `${label}: the take went with its offer`);
    assert.equal(Object.hasOwn(host.head().domains.inventory.loot ?? {}, sid), false, `${label}: the offer went with its reply`);
    assert.deepEqual([qty(host, 'Rope'), qty(host, 'Lamp'), qty(host, 'Apple')], [rope, 1, later ? 1 : 0], `${label}: the rest is kept`);
}

for (const later of [false, true]) {
    const where = later ? 'a later reply' : 'the offering reply';
    for (const checkpointEvery of [null, 1]) {
        const with_ = checkpointEvery ? ' (a checkpoint on every reply)' : '';
        test(`a take on ${where}: the greeting deleted, then the offering reply: offer, take and claim go; the rest is carried${with_}`, async t => {
            const { host, sid } = await firstOffer(t, { later, checkpointEvery });
            await host.st.deleteMessage(0);
            assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [2, 5, true], 'the greeting alone changes nothing');
            await host.st.deleteMessage(at(host, 'A crate.'));
            goneWithIt(host, sid, later, 'after the delete');
            if (checkpointEvery) assert.ok(readRecord(host.ctx.chat.find(message => !message.is_user && message.extra?.storySuite))?.checkpoint, 'the first reply left starts from a checkpoint');
            await agrees(t, host, 'after the delete');
        });
    }

    test(`a take on ${where}: the offering reply deleted, then the greeting (the other order)`, async t => {
        const { host, sid } = await firstOffer(t, { later });
        await host.st.deleteMessage(at(host, 'A crate.'));
        await host.st.deleteMessage(0);
        goneWithIt(host, sid, later, 'after the deletes', 0);
        await agrees(t, host, 'after the deletes');
    });

    test(`a take on ${where}: the greeting, the reader's message and then the offering reply deleted`, async t => {
        const { host, sid } = await firstOffer(t, { later });
        await host.st.deleteMessage(0);
        await host.st.deleteMessage(0);
        await host.st.deleteMessage(at(host, 'A crate.'));
        goneWithIt(host, sid, later, 'after the deletes');
        await agrees(t, host, 'after the deletes');
    });
}

test('the greeting deleted, the offering reply first and last: a swipe of it takes the offer and the take away', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Search the crate.', reply('A crate.', ['+ item Rope', '? loot Torch x2, 5 gold — in the crate']));
    const sid = headSid(host);
    assert.equal((await take(host, sid, [0, 1])).ok, true);
    await host.st.deleteMessage(0);
    await host.swipe(reply('An empty crate.', ['+ coin 1']));
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid), qty(host, 'Rope')], [0, 1, false, 0]);
    await agrees(t, host, 'on the other swipe');
    await host.st.swipeTo(host.ctx.chat.length - 1, 0);
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid), qty(host, 'Rope')], [2, 5, true, 1]);
    await agrees(t, host, 'back on the first swipe');
});

// The offer's names are matched as the inventory looks a name up (names.js resolveDef): a Re-read that writes the taken
// thing another way still offers it; another thing, or a name that could mean two, does not.
for (const [first, again, keeps] of [
    ['Torch x2', 'Torches x2', true],
    ['Torches x2', 'Torch x2', true],
    ['Torch x2', 'TORCH   x2', true],
    ['Torch x2', 'a handful of Torches x2', true],
    ['Lantern Oil x2', 'Oil of Lantern x2', true],
    ['Torch x2', 'Torch Stand x2', false],
    ['Torch x2', 'Torches', false],
]) {
    test(`a take of "${first}" on a later reply, the offer Re-read as "${again}": ${keeps ? 'kept' : 'off'}`, async t => {
        const host = await fresh(t);
        await host.send('Search.', reply('A crate.', [`? loot ${first}, Rope — in the crate`]));
        const sid = headSid(host);
        await host.send('Walk on.', reply('The road goes on.', ['+ item Apple']));
        const taken = await take(host, sid, [0]);
        assert.equal(taken.ok, true, taken.message);
        const name = host.sdk.query('inventory.items').find(item => item.qty === 2)?.name;
        assert.ok(name);
        const index = at(host, 'A crate.');
        await host.st.editMessage(index, reply('A crate.', [`? loot ${again}, Rope — in the crate`]));
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.deepEqual([qty(host, name), claimed(host, sid)], keeps ? [2, true] : [0, false]);
        assert.equal(offPs(host).length, keeps ? 0 : 1);
        await agrees(t, host, 'after the Re-read');
    });
}

test('the guard: the exact name wins; a name two things could mean, or two taken names meaning one thing, do not hold', () => {
    const guardOf = items => {
        const predicate = { kind: 'loot.take', sid: 'sw_000000000001', claim: 'loot:sw_000000000001', items, coin: 0 };
        return { owner: 'story-block', version: 2, epoch: 'ep_00000000', rulesHash: null, inputHash: hashJson(predicate), predicate };
    };
    const ask = (names, items) => {
        const offered = Object.fromEntries(names.map((name, n) => [String(n), { name, qty: 2 }]));
        const state = { v: 2, meta: { rev: 1, claims: {} }, domains: { inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {},
            loot: { sw_000000000001: { sid: 'sw_000000000001', n: 1, where: '', claim: 'loot:sw_000000000001', items: offered } } } } };
        return lootTakeGuard({ state, hash: hashJson }, { guard: guardOf(items) });
    };
    assert.deepEqual(ask(['Torches', 'Torch'], [{ name: 'Torch', qty: 2 }]), { ok: true }, 'the exact name first');
    assert.deepEqual(ask(['Oil Lantern', 'Lanterns Oil'], [{ name: 'Lantern Oil', qty: 2 }]),
        { ok: false, reason: 'the loot on offer no longer holds Lantern Oil ×2 it took' }, 'two things the name could mean');
    assert.deepEqual(ask(['Oil Lantern'], [{ name: 'Lantern Oil', qty: 2 }]), { ok: true }, 'one thing it means');
    assert.equal(ask(['Torch'], [{ name: 'Torch', qty: 1 }, { name: 'Torches', qty: 1 }]).ok, false, 'one thing does not stand for two taken');
    assert.equal(ask(['Torch Stand'], [{ name: 'Torch', qty: 2 }]).ok, false, 'another thing');
    assert.equal(ask(['Torch'], [{ name: 'Torch', qty: 3 }]).ok, false, 'fewer than were taken');
    const bad = guardOf([{ name: 'Torch', qty: 2 }]);
    assert.deepEqual(lootTakeGuard({ state: {}, hash: hashJson }, { guard: { ...bad, inputHash: '0'.repeat(64) } }), { ok: false, reason: 'its loot guard is damaged' });
});

// Several leading replies removed in one update (SillyTavern's "delete messages" of a range), with a checkpoint among them: the
// first reply left starts from what they did, replayed whole from the first one's checkpoint, so the offer (reply-bound) and
// any take of it go even where a later checkpoint held them. What the deleted replies did otherwise is carried.
async function removeLeading(host, keep) {
    host.ctx.chat.splice(0, host.ctx.chat.length - keep);
    await host.st.eventSource.emit(host.st.ctx.eventTypes.MESSAGE_DELETED, host.ctx.chat.length);
}
async function bulk(t, { later, replies, checkpointEvery = null }) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(checkpointEvery ? { storeOptions: { checkpointEvery } } : {});
    t.after(() => host.close());
    await host.send('Search the crate.', reply('A crate.', ['+ item Rope', '? loot Torch x2, 5 gold — in the crate']));
    const sid = headSid(host);
    if (!later) assert.equal((await take(host, sid, [0, 1])).ok, true);
    for (let n = 0; n < replies; n += 1) await host.send(`Step ${n}.`, reply(`Step ${n} goes on.`, ['+ coin 1']));
    if (later) assert.equal((await take(host, sid, [0, 1])).ok, true);
    await host.send('Last.', reply('The last reply.', ['+ item Lamp']));
    const marks = host.ctx.chat.filter(message => !message.is_user && readRecord(message)?.checkpoint).length;
    assert.ok(marks >= 2, `a checkpoint after the first one (${marks})`);
    assert.deepEqual([qty(host, 'Torch'), coin(host), claimed(host, sid)], [2, 5 + replies, true]);
    return { host, sid };
}
for (const later of [false, true]) {
    const where = later ? 'a later reply that is left' : 'the offering reply';
    test(`a take on ${where}: the leading replies removed in one update past a checkpoint: offer, take and claim go`, async t => {
        const { host, sid } = await bulk(t, { later, replies: 6, checkpointEvery: 2 });
        // Keep the reply that holds a later take (and its reader's message), and the last one; else the last two replies.
        await removeLeading(host, 4);
        assert.deepEqual([qty(host, 'Torch'), claimed(host, sid)], [0, false]);
        assert.equal(Object.hasOwn(host.head().domains.inventory.loot ?? {}, sid), false, 'the offer went with its reply');
        assert.equal(qty(host, 'Rope'), 1, 'the deleted offering reply\'s own item is carried');
        assert.equal(qty(host, 'Lamp'), 1);
        assert.equal(coin(host), 6, 'the deleted replies\' coin is carried; the loot\'s 5 is not');
        assert.equal(offPs(host).length, later ? 1 : 0);
        await agrees(t, host, 'after the removal');
    });
}

test('a take on a later reply, 102 replies after the offer (the default checkpoint among them), the leading ones removed at once', async t => {
    const { host, sid } = await bulk(t, { later: true, replies: 102 });
    await removeLeading(host, 4);
    assert.deepEqual([qty(host, 'Torch'), claimed(host, sid), coin(host), qty(host, 'Rope')], [0, false, 102, 1]);
    assert.equal(offPs(host).length, 1);
    await agrees(t, host, 'after the removal');
});

// Another domain's scratch entry that happens to be keyed by a deleted reply's record ID is carried like any other state:
// only the loot offer is the reply's own (its reply-bound guard), nothing is dropped by key.
test('a scratch entry of another domain keyed by a deleted reply\'s record ID is carried, and a block built on it stays', async t => {
    t.mock.method(console, 'warn', () => {});
    const shared = () => ({
        id: 'zz-shared', name: 'Shared', version: '0.0.1',
        domains: { shared: { initial: () => ({ entries: {}, used: false }), scratch: ['entries'] } },
        commands: {
            'shared.put'(ctx, { key }) {
                ctx.draft('shared').entries[key] = { value: 7 };
                return { summary: 'Put.', narrate: false };
            },
            'shared.use'(ctx, { key }) {
                const draft = ctx.draft('shared');
                if (!draft.entries[key]) ctx.fail('NOT_FOUND', 'Nothing to use.');
                const predicate = { kind: 'use', key };
                ctx.replayGuard({ owner: 'zz-shared', version: 2, epoch: ctx.epoch, rulesHash: null, inputHash: ctx.hash(predicate), predicate });
                draft.used = true;
                return { summary: 'Used.', narrate: false };
            },
        },
        hooks: {
            replayGuard: ({ state }, { guard }) => (state.domains.shared?.entries?.[guard.predicate.key]?.value === 7 ? { ok: true } : { ok: false, reason: 'the entry is gone' }),
        },
    });
    const host = await createHost({ modules: [shared()] });
    t.after(() => host.close());
    const key = headSid(host);
    assert.equal((await host.sdk.command('shared.put', { key })).ok, true, 'stored on the greeting, keyed by its record ID');
    await host.send('Hello.', reply('The road.', ['+ coin 1']));
    assert.equal((await host.sdk.command('shared.use', { key })).ok, true);
    await host.send('On.', reply('Further.', ['+ coin 1']));
    await host.st.deleteMessage(0);
    assert.deepEqual(host.head().domains.shared, { entries: { [key]: { value: 7 } }, used: true });
    assert.deepEqual(host.store.problems(), []);
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live, 'a rebuild equals live');
    const loaded = await createHost({ modules: [shared()], st: { chat: structuredClone(host.ctx.chat) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head(), live, 'a reload equals live');
});
