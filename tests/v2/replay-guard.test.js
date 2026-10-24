// Guarded blocks (docs/v2/REPLAY.md, contract §6 and §10 E, row 1): ctx.replayGuard, hooks.replayGuard,
// per-block span metadata, claims applied with their block or not at all, and legacy blocks left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { ensureModules } from '../../src/v2/sdk.js';
import { RECORD_ID } from '../../src/v2/check.js';
import { claimKeys, hashJson, isMetaSpan, spanProblem } from '../../src/v2/replay.js';
import { EPOCH, OWNER, Q1, Q2, Q5, Q9, claimKey, guarded, harness, outer } from './helpers/guarded.js';

// Three replies: the quest is offered (1), proved (2), and settled for 7 coin (3).
function settled(options = {}) {
    const mode = { value: 'normal' };
    const asked = [];
    const h = harness([guarded({ mode, asked }), outer()], options);
    const offer = h.send();
    assert.equal(h.command('gt.offer', { id: Q1, instance: 1 }).ok, true);
    const prove = h.send();
    assert.equal(h.command('gt.prove', { id: Q1 }).ok, true);
    const settle = h.send();
    return { h, mode, asked, offer, prove, settle };
}

test('a guarded command stores its block with the metadata of contract §6, claims listed and receipt data.v2 stamped', () => {
    const { h, settle } = settled();
    const result = h.command('gt.settle', { id: Q1, instance: 1, reward: 7 });
    assert.equal(result.ok, true, result.message);
    const span = h.spans(settle).at(-1);
    assert.equal(spanProblem(span), '');
    assert.match(span.id, /^bl_[0-9a-z]{8}$/);
    assert.equal(span.module, OWNER);
    assert.deepEqual(span.claims, [claimKey(Q1, 1)]);
    assert.deepEqual(span.evidence, []);
    assert.equal(span.guard.owner, OWNER);
    assert.equal(span.guard.version, 2);
    assert.equal(span.guard.epoch, EPOCH);
    assert.deepEqual(span.operation, { type: 'gt.settle', payload: { id: Q1, instance: 1, reward: 7 } });
    assert.deepEqual(span.recorded, { reward: 7 });
    assert.deepEqual(span.result, { id: Q1, instance: 1, paid: 7 });
    assert.equal(span.replan, null);
    // The Source is the canonical pair of the reply, never a numeric index.
    const record = h.record(settle);
    assert.deepEqual(span.source, { sid: record.source.logical, swipeKey: record.source.swipeKey, evidence: record.source.evidence, ordinal: 0 });
    assert.match(span.source.sid, /^sr_[0-9a-z]{8}$/);
    assert.match(span.source.swipeKey, /^sw_[0-9a-z]{8}$/);
    assert.match(span.source.evidence, /^ev_[0-9a-z]{8}$/);
    assert.equal(record.source.next, 1);
    const [boundary] = span.boundaries;
    assert.deepEqual(boundary.cursor, { sid: span.source.sid, swipeKey: span.source.swipeKey, block: span.id, op: 0, rev: record.receipts[0].rev - 1 });
    assert.match(boundary.prefixHash, /^[0-9a-f]{64}$/);
    assert.equal(boundary.payloadHash, h.store.payloadHashAt(settle));
    // The receipt carries the host's source and guard next to the owner's own fields.
    const receipt = record.receipts.at(-1);
    assert.deepEqual(receipt.data.v2.source, span.source);
    assert.deepEqual(receipt.data.v2.guard, span.guard);
    assert.equal(receipt.data.v2.schema, 2);
    assert.equal(receipt.data.v2.key, `settle:${Q1}:1`);
    assert.deepEqual(receipt.data.v2.result, { id: Q1, instance: 1, paid: 7 });
    assert.equal(h.gt().coin, 7);
    assert.deepEqual(h.problems(), []);
});

test('an invalid guard removes the payout, the closure and the claim together', () => {
    const { h } = settled();
    // Ordinary: nothing but the ops decides; the control settles and so does the guarded twin.
    assert.equal(h.command('gt.settle', { id: Q1, instance: 1, reward: 7 }).ok, true);
    assert.equal(h.gt().coin, 7);
    assert.equal(h.gt().quests[Q1].state, 'done');
    assert.ok(h.store.head().meta.claims[claimKey(Q1, 1)]);
    // The proof's reply is deleted: the settling ops still apply to the quest, only the owner's guard knows.
    const proof = h.chat.findIndex(message => message.extra?.storySuite?.ops.some(op => op.path.startsWith('/domains/gt/proofs')));
    h.chat.splice(proof - 1, 2);
    h.store.rebuild();
    assert.equal(h.gt().coin, 0, 'no payout');
    assert.equal(h.gt().quests[Q1].state, 'open', 'no closure');
    assert.equal(h.store.head().meta.claims[claimKey(Q1, 1)], undefined, 'no claim');
    const problems = h.problems();
    assert.equal(problems.length, 1);
    assert.equal(problems[0].code, 'REPLAY_PREREQUISITE');
    assert.match(problems[0].why, /nothing proves th_questone/);
    // It stays stored, inactive: the block is still on the reply.
    const stored = h.chat.at(-1).extra.storySuite;
    assert.equal(stored.spans.at(-1).guard.owner, OWNER);
    assert.ok(stored.ops.some(op => op.path === `/meta/claims/${claimKey(Q1, 1)}`));
    assert.equal(h.chat.at(-1).extra.storySuite.ops.length > 0, true);
});

test('the same settling without a guard still applies when the proof is gone (the control)', () => {
    const { h } = settled();
    assert.equal(h.command('gt.settleLoose', { id: Q1, instance: 1, reward: 7 }).ok, true);
    const proof = h.chat.findIndex(message => message.extra?.storySuite?.ops.some(op => op.path.startsWith('/domains/gt/proofs')));
    h.chat.splice(proof - 1, 2);
    h.store.rebuild();
    assert.equal(h.gt().coin, 7);
    assert.equal(h.gt().quests[Q1].state, 'done');
    assert.ok(h.store.head().meta.claims[claimKey(Q1, 1)]);
    assert.deepEqual(h.problems(), []);
    assert.deepEqual(h.spans(h.chat.length - 1).at(-1), { n: h.spans(h.chat.length - 1).at(-1).n, story: false }, 'a legacy block: no metadata at all');
});

test('two quests at instance 1 do not collide, and a retry of the same one pays nothing more', () => {
    const { h } = settled();
    h.command('gt.offer', { id: Q2, instance: 1 });
    h.command('gt.prove', { id: Q2 });
    assert.equal(h.command('gt.settle', { id: Q1, instance: 1, reward: 7 }).ok, true);
    assert.equal(h.command('gt.settle', { id: Q2, instance: 1, reward: 9 }).ok, true);
    assert.equal(h.gt().coin, 16);
    assert.notEqual(claimKey(Q1, 1), claimKey(Q2, 1));
    assert.ok(h.store.head().meta.claims[claimKey(Q1, 1)] && h.store.head().meta.claims[claimKey(Q2, 1)]);
    const again = h.command('gt.settle', { id: Q1, instance: 1, reward: 7 });
    assert.equal(again.ok, false);
    assert.equal(h.gt().coin, 16);
    // A cold rebuild applies both blocks, each with its own claim.
    h.store.rebuild();
    assert.equal(h.gt().coin, 16);
    assert.deepEqual(h.problems(), []);
    const claims = h.spans(h.chat.length - 1).flatMap(span => span.claims ?? []);
    assert.deepEqual(claims.sort(), [claimKey(Q1, 1), claimKey(Q2, 1)].sort());
});

test('a guarded block that a domain validator refuses on replay takes its claim with it', () => {
    const { h, settle } = settled();
    assert.equal(h.command('gt.settle', { id: Q1, instance: 1, reward: 7 }).ok, true);
    h.send();
    assert.equal(h.command('gt.spend', { amount: 5, key: 'rope' }).ok, true);
    assert.equal(h.gt().coin, 2);
    assert.ok(h.store.head().meta.claims['gt:' + EPOCH + ':spend:rope']);
    // The settling reply is deleted: the guard of the spending still holds, but 0 - 5 is below zero.
    h.chat.splice(settle - 1, 2);
    h.store.rebuild();
    assert.equal(h.gt().coin, 0, 'not -5, and not a part of it');
    assert.equal(h.store.head().meta.claims['gt:' + EPOCH + ':spend:rope'], undefined, 'no claim without its spending');
    const [problem] = h.problems();
    assert.equal(problem.code, 'REPLAY_PREREQUISITE');
    assert.match(problem.why, /coin below zero/);
});

test('the claims a block makes are read from its ops: added keys, escaped keys, one record of keys; removals are not claims', () => {
    assert.deepEqual(claimKeys([
        { op: 'add', path: '/meta/claims/a:b', value: true },
        { op: 'replace', path: '/meta/claims/c~1d~0e', value: true },
        { op: 'add', path: '/meta/rev', value: 3 },
        { op: 'remove', path: '/meta/claims/gone' },
        { op: 'add', path: '/domains/x/claims/not-this', value: true },
    ]), ['a:b', 'c/d~e']);
    assert.deepEqual(claimKeys([{ op: 'add', path: '/meta/claims', value: { k1: true, k2: true } }, { op: 'add', path: '/meta/claims/k1', value: true }]), ['k1', 'k2']);
    assert.deepEqual(claimKeys(null), []);
});

test('a nested cross-owner call shares the root block; a failure after it rolls everything back', () => {
    const { h, settle } = settled();
    const before = JSON.stringify(h.store.head());
    const records = JSON.stringify(h.record(settle));
    const failed = h.command('outer.settle', { id: Q1, instance: 1, reward: 7, after: 'fail' });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'REFUSED');
    assert.equal(JSON.stringify(h.store.head()), before, 'no payout, no closure, no claim, no log line');
    assert.equal(JSON.stringify(h.record(settle)), records, 'no block stored');
    const done = h.command('outer.settle', { id: Q1, instance: 1, reward: 7 });
    assert.equal(done.ok, true, done.message);
    const span = h.spans(settle).at(-1);
    assert.equal(span.module, 'zz-outer', 'the root command\'s module');
    assert.equal(span.guard.owner, OWNER, 'the nested owner\'s guard');
    assert.equal(span.operation.type, 'outer.settle', 'the root operation');
    assert.deepEqual(span.claims, [claimKey(Q1, 1)]);
    assert.equal(h.store.head().domains.outer.log.length, 1);
    assert.equal(h.gt().coin, 7);
    // One root block holds the outer log line, the payout, the closure and the claim: it replays whole.
    const stored = h.record(settle);
    assert.equal(stored.spans.filter(each => each.id).length, 1);
    h.store.rebuild();
    assert.equal(h.gt().coin, 7);
    assert.equal(h.store.head().domains.outer.log.length, 1);
    assert.deepEqual(h.problems(), []);
});

test('a nested call cannot attach a second guard; another module\'s guard, or one without a hook, is refused', () => {
    const { h } = settled();
    const second = h.command('outer.settle', { id: Q1, instance: 1, reward: 7, after: 'second' });
    assert.equal(second.ok, false);
    assert.notEqual(second.code, undefined);
    assert.equal(h.gt().coin, 0, 'nothing of the failed root stays');
    const forged = h.command('outer.forge', { id: Q9 });
    assert.equal(forged.ok, false);
    assert.equal(forged.code, 'REFUSED');
    assert.match(forged.message, /cannot attach zz-guarded's guard/);
    const noHook = h.command('outer.noHook', {});
    assert.equal(noHook.ok, false);
    assert.equal(noHook.code, 'REFUSED');
    assert.match(noHook.message, /no replayGuard hook/);
});

test('a malformed guard is INVALID', () => {
    const bad = {
        id: 'zz-bad', name: 'Bad', version: '0.0.1',
        domains: { bad: { initial: () => ({}) } },
        commands: {
            'bad.guard'(ctx, { guard }) {
                ctx.replayGuard(guard);
                return { summary: 'x', narrate: false };
            },
        },
        hooks: { replayGuard: () => ({ ok: true }) },
    };
    const h = harness([guarded(), bad]);
    h.send();
    const good = { owner: 'zz-bad', version: 2, epoch: EPOCH, rulesHash: null, inputHash: 'a'.repeat(64), predicate: { any: 1 } };
    assert.equal(h.command('bad.guard', { guard: good }).ok, true);
    for (const change of [{ version: 1 }, { owner: '' }, { epoch: 'epoch' }, { inputHash: 'xyz' }, { rulesHash: 'abc' }, { predicate: undefined }]) {
        const result = h.command('bad.guard', { guard: { ...good, ...change } });
        assert.equal(result.ok, false, JSON.stringify(change));
        assert.equal(result.code, 'INVALID', JSON.stringify(change));
    }
    assert.equal(h.command('bad.guard', { guard: 'nope' }).code, 'INVALID');
});

test('replay asks the owner\'s hook with the saved operation, recorded inputs and the Source; throws, promises and nonsense fail closed', () => {
    const { h, mode, asked } = settled();
    assert.equal(h.command('gt.settle', { id: Q1, instance: 1, reward: 7 }).ok, true);
    asked.length = 0;
    h.store.rebuild();
    h.store.head();
    assert.equal(asked.length, 1);
    const [seen] = asked;
    assert.equal(seen.operation.type, 'gt.settle');
    assert.deepEqual(seen.recorded, { reward: 7 });
    assert.equal(seen.guard.predicate.kind, 'settle');
    assert.match(seen.block, /^bl_/);
    assert.deepEqual(Object.keys(seen.source).sort(), ['evidence', 'ordinal', 'sid', 'swipeKey']);
    assert.equal(h.gt().coin, 7);
    for (const kind of ['throw', 'promise', 'noreason', 'nonsense', 'missing']) {
        mode.value = kind;
        h.store.rebuild();
        assert.equal(h.gt().coin, 0, `${kind}: fails closed`);
        assert.equal(h.gt().quests[Q1].state, 'open', kind);
        assert.equal(h.store.head().meta.claims[claimKey(Q1, 1)], undefined, kind);
        assert.equal(h.problems().at(-1).code, 'REPLAY_PREREQUISITE', kind);
    }
    mode.value = 'normal';
    h.store.rebuild();
    assert.equal(h.gt().coin, 7, 'asked again, it holds');
    assert.deepEqual(h.problems(), []);
});

test('with no hook to ask (the module is gone) a guarded block stays stored and off', () => {
    const { h } = settled();
    h.command('gt.settle', { id: Q1, instance: 1, reward: 7 });
    h.command('gt.quick', { id: Q5 });
    const stored = JSON.parse(JSON.stringify(h.chat));
    // The same chat, read where the owner is not registered (its domain is still declared by a plain module).
    const bare = harness([{ id: OWNER, name: 'Guarded (no hook)', version: '0.0.1', domains: guarded().domains, commands: guarded().commands }]);
    bare.chat.splice(0, bare.chat.length, ...stored);
    bare.store.rebuild();
    assert.equal(bare.gt().coin, 0);
    assert.equal(bare.problems().length, 2);
    assert.ok(bare.problems().every(problem => problem.code === 'REPLAY_PREREQUISITE' && /no replayGuard hook/.test(problem.why)));
});

test('old blocks are isolated: a legacy span is never asked, never reported as a guard failure, and a guard cannot be faked onto it', () => {
    const mode = { value: 'normal' };
    const asked = [];
    const h = harness([guarded({ mode, asked })]);
    h.send();
    h.command('gt.offer', { id: Q1 });
    h.command('gt.hit', { actor: 'ann', amount: 3 });
    const index = h.chat.length - 1;
    assert.ok(h.spans(index).every(span => Object.keys(span).sort().join() === 'n,story'), 'legacy spans are { n, story } and nothing more');
    mode.value = 'throw';
    h.store.rebuild();
    assert.equal(asked.length, 0, 'nothing to ask for a legacy block');
    assert.equal(h.gt().lost.ann, 3);
    assert.deepEqual(h.problems(), []);
    // A damaged guarded span (claims that are not the ones its ops make) is inactive, not trusted.
    mode.value = 'normal';
    h.send();
    h.command('gt.prove', { id: Q1 });
    h.command('gt.settle', { id: Q1, instance: 1, reward: 4 });
    const record = h.chat.at(-1).extra.storySuite;
    record.spans.at(-1).claims = [];
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    assert.match(h.problems().at(-1).why, /claims it saved are not the claims/);
    // And one recorded for another reply is refused too.
    record.spans.at(-1).claims = [claimKey(Q1, 1)];
    record.spans.at(-1).source = { ...record.spans.at(-1).source, swipeKey: 'sw_00000000' };
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    assert.match(h.problems().at(-1).why, /another reply or swipe/);
});

test('a guarded block replays the same after a reload of the chat (the saved metadata is all it needs)', async t => {
    const mode = { value: 'normal' };
    const host = await createHost({ modules: [guarded({ mode }), outer()], core: false });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.bus.command('gt.offer', { id: Q1, instance: 1 }, { cause: 'ui' });
    await host.send('On.', 'Further.');
    await host.bus.command('gt.prove', { id: Q1 }, { cause: 'ui' });
    await host.send('On.', 'Further still.');
    assert.equal((await host.bus.command('outer.settle', { id: Q1, instance: 1, reward: 7 }, { cause: 'ui' })).ok, true);
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(host.store.problems(), []);
    assert.equal(host.head().domains.gt.coin, 7);
});

test('the Hash is SHA-256 of normalized JSON: sorted keys, array order kept', () => {
    assert.equal(hashJson({ b: 1, a: [2, { d: 1, c: 2 }] }), hashJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    assert.notEqual(hashJson([1, 2]), hashJson([2, 1]));
    assert.equal(hashJson(null), '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b');
    assert.throws(() => hashJson({ a: undefined }), TypeError);
    assert.throws(() => hashJson(NaN), TypeError);
    assert.ok(RECORD_ID.test('bl_k3f9a2qz'));
});

test('guarded story lines are blocks of their own, live and in a Re-read, each with a Source that matches its receipt', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    const text = lines => `Dawn.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    await host.send('Go.', text(['! tick 5', `! quick ${Q1}`, `! quick ${Q2}`]));
    const at = host.ctx.chat.length - 1;
    const sourcesAgree = () => {
        const record = host.ctx.chat[at].extra.storySuite;
        const spans = record.spans.filter(isMetaSpan);
        for (const span of spans) {
            const receipt = record.receipts.find(each => each.data?.v2?.source?.ordinal === span.source.ordinal);
            assert.deepEqual(receipt.data.v2.source, span.source, 'what the owner was told is what the block carries');
        }
        return spans;
    };
    const live = sourcesAgree();
    assert.deepEqual(live.map(span => span.source.ordinal), [0, 1]);
    assert.equal(host.head().domains.gt.coin, 2);
    assert.equal(host.ctx.chat[at].extra.storySuite.spans.length, 3, 'the unguarded line is a block, each guarded line another');
    // A Re-read plans the lines again: the guarded ones are blocks of their own again, with fresh ordinals.
    host.ctx.chat[at].mes = text(['! tick 7', `! quick ${Q1}`, '! tick 9', `! quick ${Q5}`]);
    host.ctx.chat[at].swipes[0] = host.ctx.chat[at].mes;
    const result = await host.turn.reread(at);
    assert.equal(result.ok, true, result.message);
    const again = sourcesAgree();
    assert.deepEqual(again.map(span => span.source.ordinal), [2, 3]);
    assert.deepEqual(again.map(span => span.operation.payload.name), [Q1, Q5]);
    assert.equal(host.head().domains.gt.coin, 2);
    assert.equal(host.head().domains.gt.minutes, 9);
    const record = host.ctx.chat[at].extra.storySuite;
    assert.equal(record.source.next, 4);
    // The boundary of each block is where it stands in the record now.
    let offset = 0;
    for (const span of record.spans) {
        if (isMetaSpan(span)) assert.equal(span.boundaries[0].cursor.op, offset);
        offset += span.n;
    }
    assert.deepEqual(host.store.problems(), []);
    // A reload replays it all the same.
    const stateNow = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), stateNow);
});

test('a rewind keeps the guarded blocks it keeps, with their metadata, and drops the rest', () => {
    const { h, settle } = settled();
    h.command('gt.settle', { id: Q1, instance: 1, reward: 7 });
    h.command('gt.hit', { actor: 'ann', amount: 2 });
    h.command('gt.quick', { id: Q5 });
    const record = h.record(settle);
    const spans = record.spans.map(span => ({ ...span }));
    assert.equal(spans.filter(isMetaSpan).length, 2);
    const rev = record.receipts[1].rev;     // the hit's
    const dry = h.store.truncate(settle, rev, { dryRun: true });
    assert.deepEqual(dry.dropped.length, 2);
    h.store.truncate(settle, rev);
    const kept = h.record(settle);
    assert.equal(kept.spans.length, 1);
    assert.deepEqual(kept.spans[0], { ...spans[0] });
    assert.equal(h.gt().coin, 7);
    assert.equal(h.gt().lost.ann, undefined);
    assert.deepEqual(h.problems(), []);
});

test('a guarded block of a module that is not ready is off, and asked again when the module turns ready: once, never twice', async t => {
    const asked = [];
    const host = await createHost({ modules: [guarded({ asked })], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'The road.');
    assert.equal((await host.bus.command('gt.quick', { id: Q1 }, { cause: 'ui' })).ok, true);
    const gt = () => host.head().domains.gt;
    const claims = () => Object.keys(host.head().meta.claims).filter(key => key === claimKey(Q1, 1));
    assert.deepEqual([gt().coin, claims().length], [1, 1]);
    const heads = [];
    host.sdk.on('head', () => heads.push(1));
    const stored = JSON.stringify(host.ctx.chat[host.ctx.chat.length - 1].extra.storySuite.ops);
    // The module turns dormant (the host switches it off): its guarded block is not asked and stays off.
    host.registry.setEnabled(OWNER, false, 'Turned off for the test.');
    await ensureModules({ store: host.store, bus: host.bus, registry: host.registry, events: host.events });
    assert.equal(gt().coin, 0, 'off while the owner is not ready');
    assert.deepEqual(claims(), [], 'no claim either');
    assert.equal(host.store.problems().at(-1).code, 'REPLAY_PREREQUISITE');
    assert.match(host.store.problems().at(-1).why, /not ready/);
    assert.equal(heads.length >= 1, true, 'the screens are told the head changed');
    asked.length = 0;
    // It turns ready again: the block is asked again and applies, once.
    host.registry.setEnabled(OWNER, true);
    await ensureModules({ store: host.store, bus: host.bus, registry: host.registry, events: host.events });
    assert.equal(asked.length >= 1, true, 'asked again');
    assert.deepEqual([gt().coin, claims().length], [1, 1], 'applied once, not twice');
    assert.deepEqual(host.store.problems(), []);
    assert.equal(JSON.stringify(host.ctx.chat[host.ctx.chat.length - 1].extra.storySuite.ops), stored, 'nothing was written meanwhile');
});
