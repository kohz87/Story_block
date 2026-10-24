// A restore and the replay of E1 and E5: swipes, deletes and Re-reads after a restore, the host's check of a guard's epoch
// and rules hash, and the proof that a restore is absolute (docs/v2/TIMELINE.md, docs/v2/REPLAY.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { apply, rebaseOps } from '../../src/v2/ops.js';
import { director, T1 } from './helpers/evidence.js';
import { BATCH, DEATH, clone, nativeModule, restore, rulesModule, slice } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const cmd = async (host, type, payload = {}) => {
    const result = await host.sdk.command(type, payload);
    assert.equal(result.ok, true, `${type}: ${result.message}`);
    return result;
};
const codes = host => host.store.problems().map(problem => problem.code);

// Replies A, B (a save on it), C (the dead timeline, the restore on it) and D (after the return).
async function world(t, { modules = [], after = true } = {}) {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def, director(), ...modules] });
    t.after(() => host.close());
    await host.send('Go.', reply('A.', ['+ coin 10']));
    const a = host.ctx.chat.length - 1;
    await cmd(host, 'tl.xp', { amount: 10 });
    await cmd(host, 'tl.hurt', { amount: 4 });
    await host.send('Go.', reply('B.', ['+ coin 20']));
    const b = host.ctx.chat.length - 1;
    await cmd(host, 'sd.accept', { thread: T1, selection: 'Yes' });
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'On B' })).snapshot;
    const atSave = slice(host.head());
    await host.send('Go.', reply('C.', ['+ coin 100']));
    const c = host.ctx.chat.length - 1;
    await cmd(host, 'tl.xp', { amount: 90 });
    await cmd(host, 'tl.hurt', { amount: 12 });
    const dead = slice(host.head());
    const done = await restore(host, saved.id);
    assert.equal(done.activated?.status, 'complete', done.prepared?.message);
    const restoredState = slice(host.head());
    let d = -1;
    if (after) {
        await host.send('Go.', reply('D.', ['+ coin 1']));
        d = host.ctx.chat.length - 1;
        await cmd(host, 'tl.hurt', { amount: 3 });
    }
    return { host, native, saved, atSave, dead, restoredState, a, b, c, d, done };
}

test('a restore stays when a later reply is deleted or swiped; the epoch and the return are as they were', async t => {
    const { host, saved, atSave, done, d } = await world(t);
    assert.equal(host.head().domains.party.pools.hp, 13, 'the hit after the return counts from the restored pool (16 - 3)');
    const epoch = host.head().domains.savepoints.epoch;
    await host.st.deleteMessage(d);
    assert.deepEqual(slice(host.head()), atSave);
    assert.equal(host.head().domains.savepoints.epoch, epoch);
    assert.equal(host.head().domains.savepoints.returns[done.prepared.return].status, 'complete');
    assert.deepEqual(host.store.problems(), []);
    // The reader goes on from the restored story: a new reply, swiped, deleted: the return stays.
    await host.send('Again.', reply('D2.', ['+ coin 2']));
    assert.equal(host.head().domains.savepoints.epoch, epoch);
    await host.swipe(reply('D2 again.', ['+ coin 3']));
    assert.equal(host.head().domains.savepoints.epoch, epoch);
    assert.equal(host.head().domains.inventory.wallets.party.coin, 33);
    assert.deepEqual(host.sdk.query('savepoint.list', {}).map(point => point.id), [saved.id]);
    assert.deepEqual(host.store.problems(), []);
});

test('swiping or deleting the reply the restore is on takes the restore back, with its epoch: the story is the one before it', async t => {
    const { host, saved, dead, c, native } = await world(t, { after: false });
    // The reply is the last one: swiped, the new swipe holds nothing of it.
    await host.swipe(reply('C again.'));
    assert.equal(host.head().domains.savepoints.returns && Object.keys(host.head().domains.savepoints.returns).length, 0);
    assert.equal(host.head().domains.savepoints.epoch, 'ep_00000000');
    assert.equal(host.head().domains.progress.xp, 10, 'C\'s own commands went with the swipe: the story is the one through B');
    assert.deepEqual(host.sdk.query('savepoint.list', {}).map(point => point.id), [saved.id], 'the save on B is still eligible');
    assert.deepEqual(host.store.problems(), []);
    // The first swipe shown again brings the dead timeline and its restore back, as a swipe back does for everything.
    await host.st.swipeTo(c, 0);
    assert.equal(host.head().domains.progress.xp, 10, 'with the restore: the saved xp');
    assert.equal(Object.keys(host.head().domains.savepoints.returns).length, 1);
    assert.notEqual(host.head().domains.savepoints.epoch, 'ep_00000000');
    void dead; void native;
});

test('deleting an earlier reply retracts the save point and the restore that stood on that story; nothing is half applied', async t => {
    const { host, saved, a } = await world(t, { after: false });
    // A held +10 coin, +10 xp, -4 hp. Deleting it changes the story the save and the restore were made on.
    await host.st.deleteMessage(a);
    const problems = host.store.problems();
    assert.equal(problems.length >= 2, true, JSON.stringify(problems.map(problem => problem.message)));
    assert.equal(problems.every(problem => problem.code === 'REPLAY_PREREQUISITE'), true);
    assert.match(problems.map(problem => problem.why).join(' '), /story before it is not the story it was made on/);
    // The save point and the restore are off together; the story is the dead timeline without A, with its numbers right.
    assert.equal(host.sdk.query('savepoint.list', {}).length, 0, 'the point does not stand on the story any more');
    assert.equal(host.head().domains.progress.xp, 90, '90 from C alone: A\'s 10 is gone, and the restore is not applied');
    assert.equal(host.head().domains.party.pools.hp, 20 - 12, 'A\'s hit is gone too');
    assert.equal(host.head().domains.inventory.wallets.party.coin, 120);
    assert.equal(host.head().domains.savepoints, undefined, 'no savepoints domain at all: its blocks were off');
    // The numbers are those of an independent rebuild of what is left.
    const fresh = await createHost({ modules: [rulesModule(), nativeModule().def, director()], st: { chat: clone(host.ctx.chat) } });
    t.after(() => fresh.close());
    assert.deepEqual(clone(fresh.head()), clone(host.head()));
    void saved;
});

test('a Re-read of the reply the restore is on: the same text keeps the return, other change lines retract it', async t => {
    const { host, saved, atSave, c, done } = await world(t, { after: false });
    // The same text: the same lines, the same ops, the same story before the restore: nothing changes.
    const before = clone(host.head());
    const same = await host.sdk.reread(c);
    assert.equal(same.ok, true, same.message);
    assert.deepEqual(clone(host.head()), before);
    assert.deepEqual(slice(host.head()), atSave);
    assert.equal(host.head().domains.savepoints.returns[done.prepared.return].status, 'complete');
    assert.deepEqual(host.store.problems(), []);
    // A different line (the model's text was edited): the story the restore stood on is another one now.
    await host.st.editMessage(c, reply('C, edited.', ['+ coin 7']));
    const changed = await host.sdk.reread(c);
    assert.equal(changed.ok, true, changed.message);
    assert.equal(host.head().domains.savepoints.returns && Object.keys(host.head().domains.savepoints.returns).length, 0, 'the return is retracted');
    assert.equal(host.head().domains.inventory.wallets.party.coin, 37, '30 through B and the 7 of the edited line; the restore is not applied');
    assert.equal(codes(host).includes('REPLAY_PREREQUISITE'), true);
    // Edited back and read again, the restore comes back: its block was never lost, only turned off.
    await host.st.editMessage(c, reply('C.', ['+ coin 100']));
    assert.equal((await host.sdk.reread(c)).ok, true);
    assert.deepEqual(slice(host.head()), atSave);
    assert.equal(Object.keys(host.head().domains.savepoints.returns).length, 1);
    assert.deepEqual(host.store.problems(), []);
    void saved;
});

test('a Re-read of a reply after the restore keeps the return and its epoch', async t => {
    const { host, d, done } = await world(t);
    const epoch = host.head().domains.savepoints.epoch;
    await host.st.editMessage(d, reply('D, edited.', ['+ coin 9']));
    assert.equal((await host.sdk.reread(d)).ok, true);
    assert.equal(host.head().domains.savepoints.epoch, epoch);
    assert.equal(host.head().domains.savepoints.returns[done.prepared.return].status, 'complete');
    assert.equal(host.head().domains.inventory.wallets.party.coin, 39);
    assert.deepEqual(host.store.problems(), []);
});

test('a restore is absolute: its changes carry no `was`, and on any other numbers they leave the saved ones, never a difference', async t => {
    const { host, saved, atSave } = await world(t, { after: false });
    const carrier = host.ctx.chat.at(-1).extra.storySuite;
    const span = carrier.spans.find(each => each.operation?.type === 'savepoint.restore');
    const offset = carrier.spans.slice(0, carrier.spans.indexOf(span)).reduce((sum, each) => sum + each.n, 0);
    const ops = carrier.ops.slice(offset, offset + span.n);
    assert.equal(ops.some(op => Object.hasOwn(op, 'was') || Object.hasOwn(op, 'count')), false);
    assert.equal(ops.filter(op => op.path.startsWith('/domains/')).every(op => op.path.split('/').length === 3), true, 'each domain is set whole');
    // The state before the block, with every number off by something (as after a reply before it was deleted), then the ops replayed.
    const odd = clone(host.store.before(host.ctx.chat.length - 1) ?? host.head());
    odd.domains.progress.xp = 7;
    odd.domains.party.pools.hp = 3;
    odd.domains.director.time.minutes = 5;
    odd.domains.inventory.wallets.party.coin = 1;
    odd.domains.training.paid = 1000;
    odd.domains.npc.meters.tavi = -50;
    const { ops: moved } = rebaseOps(odd, ops, { replayed: true });
    const after = apply(odd, moved);
    for (const name of ['progress', 'party', 'director', 'inventory', 'training', 'npc']) assert.deepEqual(clone(after.domains[name]), atSave.domains[name], `${name}: the saved numbers, not a difference`);
    void saved;
});

test('the host\'s epoch check: a guarded block under the epoch the timeline is in is stored; under another it is not, live or on replay', async t => {
    const { host, done } = await world(t, { after: false });
    const head = await host.sdk.timeline.head();
    const epoch = head.epoch;
    assert.equal(epoch, host.head().domains.savepoints.epoch);
    const xp = host.head().domains.progress.xp;
    assert.equal((await host.sdk.command('tl.guarded', { epoch })).ok, true, 'the current epoch');
    assert.equal(host.head().domains.progress.xp, xp + 1);
    // Another epoch (the one before the return, or a made up one) is refused when it is committed.
    for (const other of ['ep_00000000', 'ep_00000001', 'ep_zzzzzzzz']) {
        const refused = await host.sdk.command('tl.guarded', { epoch: other });
        assert.equal(refused.ok, false, other);
        assert.match(refused.message, new RegExp(`epoch ${other}.*epoch ${epoch}`));
    }
    assert.equal(host.head().domains.progress.xp, xp + 1, 'nothing was stored');
    assert.deepEqual(host.store.problems(), []);
    void done;
});

test('a guarded block made under the restore\'s epoch stays off when the restore is gone, and comes back with it', async t => {
    const { host, c, d } = await world(t, { after: false });
    void c;
    await host.send('After.', reply('E.'));
    const e = host.ctx.chat.length - 1;
    const epoch = (await host.sdk.timeline.head()).epoch;
    await cmd(host, 'tl.guarded', { epoch });
    const xp = host.head().domains.progress.xp;
    assert.equal(xp, 11, 'the restored 10 and the guarded 1');
    // The restore's reply is deleted: E's guard names an epoch this timeline is not in any more.
    await host.st.deleteMessage(host.ctx.chat.findLastIndex((message, at) => at < e && !message.is_user));
    const problems = host.store.problems();
    assert.equal(problems.some(problem => problem.code === 'REPLAY_PREREQUISITE' && /epoch/.test(problem.why)), true, JSON.stringify(problems.map(problem => problem.why)));
    assert.equal(host.head().domains.progress.xp, 10, 'the guarded +1 is off with the epoch it leaned on');
    void d;
});

test('the host\'s rules check: a guard that names the frozen rules hash meets it, another does not; a story with no rules marker has none to meet', async t => {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def] });
    t.after(() => host.close());
    await host.send('Go.', reply('A.'));
    const epoch = 'ep_00000009';
    const frozen = 'a'.repeat(64);
    assert.equal(host.head().domains.rules.rulesHash, frozen);
    assert.equal((await host.sdk.command('tl.guarded', { epoch, rulesHash: frozen })).ok, true, 'the same rules');
    assert.equal((await host.sdk.command('tl.guarded', { epoch, rulesHash: null })).ok, true, 'a guard that names no rules');
    const other = await host.sdk.command('tl.guarded', { epoch, rulesHash: 'c'.repeat(64) });
    assert.equal(other.ok, false);
    assert.match(other.message, /other rules/);
    // On replay too: the rules are frozen by one reply and a guard leans on them in the next; delete the first.
    await host.send('Go.', reply('B.'));
    const rulesReply = host.ctx.chat.length - 1;
    await host.sdk.command('tl.rules', { hash: 'd'.repeat(64) });
    await host.send('Go.', reply('C.'));
    assert.equal((await host.sdk.command('tl.guarded', { epoch, rulesHash: 'd'.repeat(64) })).ok, true, 'under the rules as they are now');
    assert.equal(host.head().domains.progress.xp, 3);
    await host.st.deleteMessage(rulesReply);
    assert.equal(host.store.problems().some(problem => /other rules/.test(problem.why)), true, 'the guard under the later rules does not meet the earlier');
    assert.equal(host.head().domains.progress.xp, 2, 'its +1 is off');
    // Without a rules marker nothing is compared (the story of a host without a ruleset behaves as it did).
    const plain = await createHost({ modules: [{ ...rulesModule(), domains: { ...rulesModule().domains, rules: undefined } }].map(def => { delete def.domains.rules; return def; }) });
    t.after(() => plain.close());
    await plain.send('Go.', reply('A.'));
    assert.equal(plain.head().domains.rules, undefined);
    assert.equal((await plain.sdk.command('tl.guarded', { epoch, rulesHash: 'e'.repeat(64) })).ok, true);
    plain.store.rebuild();
    assert.deepEqual(plain.store.problems(), []);
});

test('proof given before the save stays active after the restore and a Re-read of the reply that gave it keeps its id', async t => {
    const { host, b } = await world(t, { after: false });
    const shown = host.sdk.query('story.evidence', {});
    assert.equal(shown.length, 1);
    const id = shown[0].id;
    assert.equal(host.store.sourceAt(b).sid, shown[0].source.sid);
    assert.equal((await host.sdk.reread(b)).ok, true);
    assert.deepEqual(host.sdk.query('story.evidence', {}).map(proof => proof.id), [id]);
});

test('a save point and a restore across the checkpoints of a long chat replay the same from the chat file', async t => {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def] });
    t.after(() => host.close());
    await host.send('Go.', reply('Start.', ['+ coin 1']));
    await cmd(host, 'tl.xp', { amount: 3 });
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Early' })).snapshot;
    const atSave = slice(host.head());
    for (let n = 0; n < 130; n += 1) {
        await host.send('Go.', reply(`Reply ${n}.`, [`+ coin 1`]));
        if (n % 10 === 0) await cmd(host, 'tl.xp', { amount: 1 });
    }
    const checkpoints = host.ctx.chat.filter(message => message.extra?.storySuite?.checkpoint).length;
    assert.equal(checkpoints >= 2, true, 'the chat has checkpoints between the save and the restore');
    const done = await restore(host, saved.id);
    assert.equal(done.activated.status, 'complete', done.prepared.message);
    assert.deepEqual(slice(host.head()), atSave);
    for (let n = 0; n < 105; n += 1) await host.send('Go.', reply(`After ${n}.`, ['+ coin 2']));
    assert.equal(host.head().domains.inventory.wallets.party.coin, 1 + 210);
    const live = clone(host.head());
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), live);
    const fresh = await createHost({ modules: [rulesModule(), nativeModule().def], st: { chat: clone(host.ctx.chat) } });
    t.after(() => fresh.close());
    assert.deepEqual(clone(fresh.head()), live, 'a new store over the chat file, from its checkpoints');
    assert.deepEqual(fresh.store.problems(), []);
    assert.deepEqual(host.store.problems(), []);
});
