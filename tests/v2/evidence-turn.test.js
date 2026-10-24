// Proof over a whole turn on the testkit's host (docs/v2/EVIDENCE.md): the reader's words reach a story line only
// through what the host saw, a swipe gives fresh ids, an edit and a Re-read change the payload hash and what was
// built on the old proof, and a reload shows the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { director, fighter, hostModule, T1, T2 } from './helpers/evidence.js';

const text = (narration, lines) => `${narration}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function open(t) {
    const link = hostModule();
    const host = await createHost({ modules: [link.def, director(), fighter()], core: false });
    t.after(() => host.close());
    link.link(host.store);
    const turns = [];
    host.events.on('turn', turn => turns.push(turn));
    const ask = args => host.sdk.query('story.evidence', args);
    return { host, turns, ask };
}

test('a story acceptance proves the reader\'s words: said by the reader it is kept, said only by the narration it is refused', async t => {
    const { host, turns, ask } = await open(t);
    await host.send('Sure, I accept the job.', text('The innkeeper nods.', [`! accept ${T1} | words: I accept the job`]));
    const [proof] = ask({});
    assert.equal(proof.kind, 'acceptance');
    assert.deepEqual(proof.payload, { thread: T1, words: 'I accept the job' });
    assert.deepEqual(host.head().domains.sdt.accepted, { [proof.id]: { thread: T1 } });
    assert.deepEqual(turns.at(-1).problems, []);
    // The next reply: the reader only says "maybe", the narration says the rest. Refused, as a problem, with nothing kept.
    await host.send('Hmm, maybe.', text('You shake hands. "I accept the job," you say, and it is done.', [`! accept ${T2} | words: I accept the job`, `! accept ${T2} | words: you shake hands`]));
    assert.equal(ask({}).length, 1, 'no proof of the forged ones');
    assert.deepEqual(Object.keys(host.head().domains.sdt.accepted), [proof.id], 'and no change of theirs');
    assert.equal(turns.at(-1).problems.length, 2);
    for (const problem of turns.at(-1).problems) assert.match(String(problem.message ?? problem), /narration cannot accept for the reader/);
    assert.deepEqual(host.store.problems(), []);
});

test('a new swipe gives fresh evidence ids; the first swipe\'s proof is not the second\'s', async t => {
    const { host, ask } = await open(t);
    await host.send('Sure, I accept the job.', text('The innkeeper nods.', [`! accept ${T1} | words: I accept the job`]));
    const first = ask({})[0];
    await host.swipe(text('The innkeeper grins.', [`! accept ${T1} | words: I accept the job`]));
    const second = ask({});
    assert.equal(second.length, 1, 'only the shown swipe\'s proof');
    assert.notEqual(second[0].id, first.id, 'fresh id');
    assert.notEqual(second[0].source.swipeKey, first.source.swipeKey);
    assert.notEqual(second[0].source.evidence, first.source.evidence);
    assert.equal(second[0].source.sid, first.source.sid, 'the same logical reply');
    assert.equal(second[0].payloadHash, first.payloadHash, 'the same words hash the same');
});

test('an edit alone leaves the proof; a Re-read gives it again from the new text, with another payload hash, and what was built on the old one is hidden', async t => {
    const { host, turns, ask } = await open(t);
    await host.send('Sure, I accept the job, thanks.', text('The innkeeper nods.', [`! accept ${T1} | words: I accept the job`]));
    const at = host.ctx.chat.length - 1;
    const [old] = ask({});
    // The reader clicks something that builds on the proof.
    const built = await host.bus.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' }, parents: [old.id] }] }, { cause: 'ui' });
    assert.equal(built.ok, true, built.message);
    assert.deepEqual(ask({}).map(proof => proof.kind), ['acceptance', 'kill']);
    const boundary = host.ctx.chat[at].extra.storySuite.spans.find(span => span.evidence?.length).boundaries[0].payloadHash;
    // The reply is edited: its text, and so its payload hash, change. The proof is still the one given.
    host.ctx.chat[at].mes = text('The innkeeper nods slowly.', [`! accept ${T1} | words: Sure, I accept`]);
    host.ctx.chat[at].swipes[0] = host.ctx.chat[at].mes;
    assert.notEqual(host.store.payloadHashAt(at), boundary, 'the evidence text changed');
    assert.deepEqual(ask({}).map(proof => proof.id), [old.id, ask({})[1].id], 'an edit alone changes no proof');
    // A Re-read reads the changed line: the proof is given again with the other words.
    const result = await host.turn.reread(at);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(turns.at(-1).problems, []);
    const now = ask({});
    const fresh = now.find(proof => proof.kind === 'acceptance');
    assert.deepEqual(fresh.payload, { thread: T1, words: 'Sure, I accept' });
    assert.notEqual(fresh.payloadHash, old.payloadHash, 'edit and Re-read change the payload hash');
    assert.equal(fresh.source.sid, old.source.sid, 'the same logical reply');
    assert.equal(fresh.source.swipeKey, old.source.swipeKey, 'the same swipe');
    assert.equal(fresh.source.evidence, old.source.evidence);
    assert.notEqual(fresh.id, old.id, 'a block planned again has an ordinal of its own');
    assert.equal(ask({ ids: [old.id] }).length, 0, 'the old proof is gone');
    assert.deepEqual(now.map(proof => proof.kind), ['acceptance'], 'and the kill built on it is hidden, though its own changes stay');
    assert.deepEqual(host.head().domains.rpgt.log, [1]);
    assert.deepEqual(Object.keys(host.head().meta.proofs).length, 2, 'the new acceptance and the hidden kill; the old acceptance\'s pin left with its block');
    // A Re-read that finds the same words gives the same payload hash, in a block of its own again.
    const again = await host.turn.reread(at);
    assert.equal(again.ok, true, again.message);
    const same = ask({}).find(proof => proof.kind === 'acceptance');
    assert.equal(same.payloadHash, fresh.payloadHash);
    assert.notEqual(same.id, fresh.id);
    assert.deepEqual(host.store.problems(), []);
});

test('a reload shows the same proof, and a chat with proof loads without a problem', async t => {
    const { host, ask } = await open(t);
    await host.send('Sure, I accept the job.', text('The innkeeper nods.', [`! accept ${T1} | words: I accept the job`]));
    const [proof] = ask({});
    await host.bus.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' }, parents: [proof.id] }] }, { cause: 'ui' });
    await host.send('On.', 'Further.');
    const before = JSON.stringify(ask({}));
    const state = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(ask({})), before);
    assert.equal(JSON.stringify(host.head()), state);
    assert.deepEqual(host.store.problems(), []);
});

test('a line may build on the proof an earlier line of the same reply gave, live and in a Re-read', async t => {
    const { host, turns, ask } = await open(t);
    const lines = [`! accept ${T1} | words: I accept the job`, '! kill Wolf | after: th_thread01'];
    await host.send('Sure, I accept the job.', text('The innkeeper nods.', lines));
    const at = host.ctx.chat.length - 1;
    const shown = () => ask({}).map(proof => [proof.kind, proof.parents.length]);
    assert.deepEqual(shown(), [['acceptance', 0], ['kill', 1]]);
    assert.equal(ask({})[1].parents[0], ask({})[0].id);
    assert.deepEqual(turns.at(-1).problems, []);
    // A Re-read plans both lines again (nothing stored until they all are): the second still finds the first's proof.
    const old = ask({}).map(proof => proof.id);
    const result = await host.turn.reread(at);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(turns.at(-1).problems, []);
    assert.deepEqual(shown(), [['acceptance', 0], ['kill', 1]]);
    assert.equal(ask({})[1].parents[0], ask({})[0].id);
    assert.equal(ask({}).some(proof => old.includes(proof.id)), false, 'fresh blocks, fresh ids');
    assert.deepEqual(host.store.problems(), []);
    // The kill without the acceptance before it is refused (nothing to build on).
    await host.send('Hm.', text('A wolf.', ['! kill Bear | after: th_thread02']));
    assert.equal(turns.at(-1).problems.length, 1);
    assert.equal(ask({}).length, 2);
});
