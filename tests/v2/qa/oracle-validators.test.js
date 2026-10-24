// QA (fix-fuzz150): the oracle checks a replayed block with the validator of every domain it touches,
// as the host does (SPEC §2.2 "Replayed blocks are checked"; runtime.js passes every module's validator
// to the store). It used to run the inventory's alone, so at 150 fuzz steps (seeds 1, 7, 15, 25, 35, 36
// on e44039b) it kept a block the store rightly skips: `+ present Fenna`, `- present Fenna`,
// `+ present Fenna`, then the middle reply deleted. The last reply's append (`add /present/-`, rule b)
// lands on a list that holds Fenna already; the scene's validator refuses a name listed twice, so the
// store skips that one block (and only it), and Fenna is there once. The old oracle listed her twice.
// It also lacked two replay rules the store has (SPEC §2.2): a counted remove of a stack that now holds
// more takes `was` from it (seeds 7, 25, 36 there, 16 on ff96802), and rule (c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { probeModule } from './helpers/probe-module.js';
import { carriers, checkInvariants, rebuildAt, strictApply } from './helpers/oracle.js';
import { initialScene } from '../../../src/v2/domains/scene.js';

const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a middle delete that would list someone present twice: that block alone is skipped, live equals a rebuild', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [probeModule()] });
    t.after(() => h.close());
    await h.send('Hello.', reply('Fenna comes in.', ['+ present Fenna']));
    await h.send('Bye.', reply('Fenna leaves.', ['- present Fenna']));
    await h.send('Back?', reply('Fenna is back with a rope.', ['+ present Fenna', '+ item Rope | qty: 2']));
    assert.deepEqual(h.head().domains.scene.present, ['Fenna']);
    checkInvariants(h, 'before the delete');

    await h.st.deleteMessage(4);   // the reply where Fenna left
    const head = h.head();
    assert.deepEqual(head.domains.scene.present, ['Fenna'], 'Fenna is present once, not twice');
    assert.equal(Object.values(head.domains.inventory.stacks).reduce((sum, stack) => sum + stack.qty, 0), 2, 'the same reply\'s other block (the rope) still applies');
    const problems = h.store.problems();
    assert.equal(problems.length, 1, 'one block skipped');
    assert.match(problems[0].why, /Fenna is listed as present twice/);
    const last = carriers(h.ctx.chat).at(-1);
    assert.deepEqual(rebuildAt(h.ctx.chat, last).skipped.map(entry => entry.index), [last], 'the oracle skips that same block');
    checkInvariants(h, 'after the middle delete');
});

test('the oracle refuses a block that brings a problem to any domain it touches, not only the inventory', () => {
    const state = { v: 2, meta: { rev: 1 }, domains: { scene: { ...initialScene(), present: ['Fenna'] }, probe: { n: 0, seen: [] } } };
    assert.throws(() => strictApply(state, [{ op: 'add', path: '/domains/scene/present/-', value: 'Fenna' }]), /break a domain/, 'scene: a name listed twice');
    assert.throws(() => strictApply(state, [{ op: 'replace', path: '/domains/probe/n', value: -1 }]), /break a domain/, 'the probe domain\'s own validator');
    assert.deepEqual(strictApply(state, [{ op: 'add', path: '/domains/scene/present/-', value: 'Kael' }]).domains.scene.present, ['Fenna', 'Kael']);
    // A problem the state had before the block is not the block's: it still applies.
    const broken = { ...state, domains: { ...state.domains, scene: { ...state.domains.scene, present: ['Fenna', 'Fenna'] } } };
    assert.deepEqual(strictApply(broken, [{ op: 'replace', path: '/domains/scene/place/name', value: 'The Weir' }]).domains.scene.place.name, 'The Weir');
});

test('a middle delete before a reply that used up a stack: the later take takes its count, the rest stays (counted remove)', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [probeModule()] });
    t.after(() => h.close());
    const torches = () => Object.values(h.head().domains.inventory.stacks).reduce((sum, stack) => sum + stack.qty, 0);
    await h.send('Supplies?', reply('Three torches.', ['+ item Torch | qty: 3']));
    await h.send('Light one.', reply('One burns out.', ['- item Torch']));
    await h.send('Another.', reply('Another burns out.', ['- item Torch']));
    await h.send('The last.', reply('The last burns out.', ['- item Torch']));
    assert.equal(torches(), 0);
    const last = h.store.opsAt(h.store.headIndex()).find(op => op.op === 'remove' && op.path.startsWith('/domains/inventory/stacks/'));
    assert.deepEqual([last.was, last.count], [1, '/qty'], 'the last reply stored a counted remove of the stack');
    await h.st.deleteMessage(4);   // the reply where the first torch burnt out
    assert.equal(torches(), 1, 'two of three are used: one torch is left');
    assert.deepEqual(h.store.problems(), []);
    checkInvariants(h, 'after the middle delete');
});

test('the oracle has rule (c): a replace of a key only a deleted reply had added is an add when its parent is there', () => {
    const state = { v: 2, meta: { rev: 1 }, domains: { plot: { hooks: { x: { name: 'X' } } } } };
    assert.deepEqual(strictApply(state, [{ op: 'replace', path: '/domains/plot/hooks/x/now', value: 'b' }]).domains.plot.hooks.x, { name: 'X', now: 'b' });
    assert.throws(() => strictApply(state, [{ op: 'replace', path: '/domains/plot/hooks/y/now', value: 'c' }]), /no /, 'no parent object: it does not fit');
    assert.throws(() => strictApply(state, [{ op: 'replace', path: '/meta/other', value: 1 }]), /no /, 'outside the domains: as written');
});
