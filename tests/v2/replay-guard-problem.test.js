import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { clone, reload } from './helpers/timeline.js';

function owner() {
    return { id: 'guard-diagnostic', name: 'Guard diagnostic fixture', version: '1.0.0',
        domains: { audit: { initial: () => ({ refuse: false, paid: 0 }) } },
        queries: { 'audit.refused': () => true }, replayQueries: [],
        commands: {
            'audit.pay'(ctx, { refuse = false, step = false } = {}) {
                const state = ctx.draft('audit');
                const broken = refuse || (step && state.refuse);
                ctx.replayGuard({ owner: ctx.module, version: 2, epoch: ctx.epoch, rulesHash: null,
                    inputHash: ctx.hash({}), predicate: { kind: broken ? 'promotion' : 'payment' } });
                state.paid += broken ? 100 : 1;
                ctx.claim('audit-paid');
                return { summary: 'Paid.', ...(step ? {replan: true} : {}) };
            },
        },
        capture: { kinds: { refuse: { grammar: '~ refuse yes|no' } }, apply(ctx, line) {
            ctx.draft('audit').refuse = line.name === 'yes';
            return { summary: 'Set refusal.' };
        } },
        hooks: { replayGuard({state, query}, {guard}) {
            if (guard.predicate.kind === 'promotion' || state.domains.audit.refuse) query('audit.refused', {});
            return {ok: true};
        } },
    };
}
function problem(host, kind) {
    const found = host.store.problems().filter(p => p.code === 'REPLAY_PREREQUISITE');
    assert.equal(found.length, 1);
    assert.match(found[0].message, /guard-diagnostic/);
    assert.match(found[0].message, new RegExp(kind));
    assert.match(found[0].message, /audit\.refused/);
    return found[0];
}

test('an undeclared query in a newly planned guard fails closed and leaves a store Problem naming owner, kind and query', async t => {
    const host = await createHost({modules: [owner()]});
    t.after(() => host.close());
    await host.send('Go.', 'Here.');
    const before = JSON.stringify([host.ctx.chat, host.ctx.chatMetadata, host.head()]);
    const result = await host.sdk.command('audit.pay', {refuse: true});
    assert.equal(result.ok, false);
    assert.equal(host.head().domains.audit.paid, 0);
    assert.equal(host.head().meta.claims['audit-paid'], undefined);
    assert.equal(JSON.stringify([host.ctx.chat, host.ctx.chatMetadata, host.head()]), before, 'only an in-memory diagnostic is added');
    problem(host, 'promotion');
    host.store.rebuild();
    problem(host, 'promotion');
    host.ctx.chatMetadata = {};
    host.store.rebuild();
    assert.deepEqual(host.store.problems(), [], 'a diagnostic belongs to its original chat');
});

test('a guard that throws during replay after a Re-read remains inactive with one named Problem, also on reload', async t => {
    const host = await createHost({modules: [owner()]});
    t.after(() => host.close());
    await host.send('Flag.', 'Allowed.\n<Changes>\n~ refuse no\n</Changes>');
    const earlier = host.ctx.chat.length - 1;
    await host.send('Pay.', 'Payment.');
    assert.equal((await host.sdk.command('audit.pay', {})).ok, true);
    await host.st.editMessage(earlier, 'Refused.\n<Changes>\n~ refuse yes\n</Changes>');
    assert.equal((await host.sdk.reread(earlier)).ok, true);
    assert.equal(host.head().domains.audit.paid, 0);
    assert.equal(host.head().meta.claims['audit-paid'], undefined);
    problem(host, 'payment');
    host.store.rebuild();
    problem(host, 'payment');
    const fresh = await reload(createHost, {chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata)}, [owner()]);
    t.after(() => fresh.close());
    problem(fresh, 'payment');
});

test('a thrown replacement guard is reported even when the valid old block is kept by reconciliation', async t => {
    const def = owner();
    def.hooks.replayGuard = ({query}, {guard}) => {
        if (guard.predicate.kind === 'promotion') query('audit.refused', {});
        return {ok: true};
    };
    const host = await createHost({modules: [def]});
    t.after(() => host.close());
    await host.send('Flag.', 'Allowed.\n<Changes>\n~ refuse no\n</Changes>');
    const earlier = host.ctx.chat.length - 1;
    await host.send('Step.', 'Step.');
    assert.equal(host.bus.command('audit.pay', {step: true}, {cause: 'system'}).ok, true);
    await host.st.editMessage(earlier, 'Changed.\n<Changes>\n~ refuse yes\n</Changes>');
    assert.equal((await host.sdk.reread(earlier)).ok, true);
    assert.equal(host.head().domains.audit.paid, 1, 'the rejected replacement never pays its 100');
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.spans.at(-1).guard.predicate.kind, 'payment');
    problem(host, 'promotion');
    host.store.rebuild();
    problem(host, 'promotion');
});

test('thrown guard diagnostics have one formatting and recording site', async () => {
    const {readFile} = await import('node:fs/promises');
    const store = await readFile(new URL('../../src/v2/store.js', import.meta.url), 'utf8');
    const commands = await readFile(new URL('../../src/v2/commands.js', import.meta.url), 'utf8');
    assert.equal((store.match(/function thrownGuard\(/g) ?? []).length, 1);
    assert.equal((store.match(/return thrownGuard\(/g) ?? []).length, 1);
    assert.equal(commands.includes('replayGuard failed ('), false);
});
