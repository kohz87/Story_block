// Replay rule (c) (SPEC §2.2, from Story Director's round-2 fix): on replay only, a `replace` of an object
// key that is not there, because only a deleted reply had added it, is applied as an `add` when its parent
// object is there. Counted ops (`was`) keep the counter rules; live commands stay strict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { createStore } from '../../../src/v2/store.js';
import { rebaseOps } from '../../../src/v2/ops.js';

// Story Director's hooks, cut down: `+ hook X` opens one, `~ hook X | now: …` says where it stands.
const plot = {
    id: 'zz-plot', name: 'Plot',
    domains: { plot: { initial: () => ({ hooks: {} }) } },
    capture: {
        kinds: { hook: { grammar: '+ hook Name / ~ hook Name | now: text' } },
        apply(ctx, line) {
            const hooks = ctx.draft('plot').hooks;
            const key = String(line.name).trim().toLowerCase();
            if (line.op === '+') hooks[key] = { name: String(line.name).trim() };
            else if (!hooks[key]) ctx.fail('NOT_FOUND', `There is no hook ${line.name}.`);
            else hooks[key].now = String(line.labels.now ?? '');
            return { summary: `Hook ${line.name}.` };
        },
    },
};
const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('rule (c): a later "~ hook X | now: …" survives deleting the reply that first set now, and rebuild equals a fresh replay', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [plot] });
    t.after(() => h.close());
    await h.send('a', reply('A rumour.', ['+ hook Lost Ring']));
    await h.send('b', reply('A clue.', ['~ hook Lost Ring | now: a clue at the mill']));
    await h.send('c', reply('The ring.', ['~ hook Lost Ring | now: found in the well']));
    const ops = h.store.opsAt(6);
    assert.ok(ops.some(op => op.op === 'replace' && op.path === '/domains/plot/hooks/lost ring/now'), 'the third reply stored a replace of now');
    // The reader deletes the second exchange (the reply that added `now`).
    h.ctx.chat.splice(3, 2);
    await h.st.eventSource.emit('message_deleted', h.ctx.chat.length);
    assert.deepEqual(h.head().domains.plot.hooks['lost ring'], { name: 'Lost Ring', now: 'found in the well' }, 'the later reply\'s change is kept');
    assert.deepEqual(h.store.problems(), [], 'no block was skipped');
    const fresh = createStore({ chat: () => structuredClone(h.ctx.chat), save: async () => {} });
    assert.deepEqual(fresh.head(), h.head(), 'rebuild from the chat as stored equals the live head');
});

test('rule (c) is for replay only, needs the parent object, and leaves counted ops to the counter rules', () => {
    const state = { v: 2, meta: { rev: 0 }, domains: { plot: { hooks: { x: { name: 'X' } }, list: [1] }, inventory: { wallets: {} } } };
    const ops = [
        { op: 'replace', path: '/domains/plot/hooks/x/now', value: 'b' },
        { op: 'replace', path: '/domains/plot/hooks/y/now', value: 'c' },
        { op: 'replace', path: '/domains/plot/list/3', value: 2 },
        { op: 'replace', path: '/domains/inventory/wallets/party', value: 5, was: 3 },
    ];
    const live = rebaseOps(state, ops).ops;
    assert.equal(live[0].op, 'replace', 'a live command stays strict');
    const replayed = rebaseOps(state, ops, { replayed: true }).ops;
    assert.deepEqual(replayed[0], { op: 'add', path: '/domains/plot/hooks/x/now', value: 'b' });
    assert.equal(replayed[1].op, 'replace', 'no parent object: as written (its block fails)');
    assert.equal(replayed[2].op, 'replace', 'a list position: as written');
    assert.deepEqual(replayed[3], { op: 'add', path: '/domains/inventory/wallets/party', value: 2 }, 'a counted op follows the counter rules (from 0: its change alone), not rule (c)');
    const above = rebaseOps(state, [{ op: 'add', path: '/domains/plot/hooks/z', value: {} }, { op: 'replace', path: '/domains/plot/hooks/z/now', value: 'd' }], { replayed: true }).ops;
    assert.equal(above[1].op, 'replace', 'under something an earlier op in the block put there, as written');
});

test('rule (c) never makes a domain or a /meta field of its own', () => {
    const state = { v: 2, meta: { rev: 0 }, domains: { plot: {} } };
    const out = rebaseOps(state, [{ op: 'replace', path: '/domains/missing', value: 1 }, { op: 'replace', path: '/meta/other', value: 1 }], { replayed: true }).ops;
    assert.deepEqual(out.map(op => op.op), ['replace', 'replace']);
});
