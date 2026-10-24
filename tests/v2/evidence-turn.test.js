// Proof over a whole turn on the testkit's host (docs/v2/EVIDENCE.md): the reader's words reach a story line only
// through what the host saw, a swipe gives fresh ids, an edit and a Re-read change the payload hash and what was
// built on the old proof, and a reload shows the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { director, fighter, hostModule, T1, T2 } from './helpers/evidence.js';

const text = (narration, lines) => `${narration}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function open(t, options = {}) {
    const link = hostModule();
    const host = await createHost({ modules: [link.def, director(options), fighter()], core: false });
    t.after(() => host.close());
    link.link(host.store);
    const turns = [];
    host.events.on('turn', turn => turns.push(turn));
    const ask = args => host.sdk.query('story.evidence', args);
    return { host, turns, ask };
}

test('a story acceptance proves the reader\'s words: said by the reader it is kept, said only by the narration it is refused', async t => {
    const { host, turns, ask } = await open(t);
    await host.send('Sure, I accept the job. Thanks a lot!', text('The innkeeper nods.', [`! accept ${T1} | words: Sure, I accept the job`]));
    const [proof] = ask({});
    assert.equal(proof.kind, 'acceptance');
    assert.deepEqual(proof.payload, { thread: T1, words: 'Sure, I accept the job' });
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
    await host.send('Sure, I accept the job. Thanks a lot!', text('The innkeeper nods.', [`! accept ${T1} | words: Sure, I accept the job`]));
    const first = ask({})[0];
    await host.swipe(text('The innkeeper grins.', [`! accept ${T1} | words: Sure, I accept the job`]));
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
    await host.send('Sure, I accept the job. Thanks a lot!', text('The innkeeper nods.', [`! accept ${T1} | words: Sure, I accept the job`]));
    const at = host.ctx.chat.length - 1;
    const [old] = ask({});
    // The reader clicks something that builds on the proof.
    const built = await host.bus.command('rb.many', { specs: [{ kind: 'kill', payload: { foe: 'wolf' }, parents: [old.id] }] }, { cause: 'ui' });
    assert.equal(built.ok, true, built.message);
    assert.deepEqual(ask({}).map(proof => proof.kind), ['acceptance', 'kill']);
    const boundary = host.ctx.chat[at].extra.storySuite.spans.find(span => span.evidence?.length).boundaries[0].payloadHash;
    // The reply is edited: its text, and so its payload hash, change. The proof is still the one given.
    host.ctx.chat[at].mes = text('The innkeeper nods slowly.', [`! accept ${T1} | words: Thanks a lot`]);
    host.ctx.chat[at].swipes[0] = host.ctx.chat[at].mes;
    assert.notEqual(host.store.payloadHashAt(at), boundary, 'the evidence text changed');
    assert.deepEqual(ask({}).map(proof => proof.id), [old.id, ask({})[1].id], 'an edit alone changes no proof');
    // A Re-read reads the changed line: the proof is given again with the other words.
    const result = await host.turn.reread(at);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(turns.at(-1).problems, []);
    const now = ask({});
    const fresh = now.find(proof => proof.kind === 'acceptance');
    assert.deepEqual(fresh.payload, { thread: T1, words: 'Thanks a lot' });
    assert.notEqual(fresh.payloadHash, old.payloadHash, 'edit and Re-read change the payload hash');
    assert.equal(fresh.source.sid, old.source.sid, 'the same logical reply');
    assert.equal(fresh.source.swipeKey, old.source.swipeKey, 'the same swipe');
    assert.equal(fresh.source.evidence, old.source.evidence);
    assert.notEqual(fresh.id, old.id, 'another line (its text changed), another id: the proof is named by what its block is, and a line is its text');
    assert.notEqual(fresh.source.ordinal, old.source.ordinal, 'in a block planned again');
    assert.deepEqual(ask({ ids: [old.id] }), [], 'the old id shows nothing');
    assert.deepEqual(now.map(proof => proof.kind), ['acceptance'], 'and the kill built on it is hidden, though its own changes stay');
    assert.deepEqual(host.head().domains.rpgt.log, [1]);
    assert.deepEqual(Object.keys(host.head().meta.proofs).length, 2, 'the new acceptance and the hidden kill; the old acceptance\'s pin left with its block');
    assert.deepEqual(host.store.boundaryProblems(), [], 'every block\'s recorded boundary is what the chat gives, proof included');
    // A Re-read that finds the same words gives the same proof again.
    const again = await host.turn.reread(at);
    assert.equal(again.ok, true, again.message);
    const same = ask({}).find(proof => proof.kind === 'acceptance');
    assert.equal(same.payloadHash, fresh.payloadHash);
    assert.equal(same.id, fresh.id);
    assert.deepEqual(host.store.problems(), []);
    // The words are put back and read again: the first line's id is the line's again, and what was built on it shows again.
    host.ctx.chat[at].mes = text('The innkeeper nods.', [`! accept ${T1} | words: Sure, I accept the job`]);
    host.ctx.chat[at].swipes[0] = host.ctx.chat[at].mes;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(ask({}).map(proof => proof.id), [old.id, built.receipt.data.proofs[0].id]);
});

test('a reload shows the same proof, and a chat with proof loads without a problem', async t => {
    const { host, ask } = await open(t);
    await host.send('Sure, I accept the job. Thanks a lot!', text('The innkeeper nods.', [`! accept ${T1} | words: Sure, I accept the job`]));
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
    const lines = [`! accept ${T1} | words: Sure, I accept the job`, '! kill Wolf | after: th_thread01'];
    await host.send('Sure, I accept the job. Thanks a lot!', text('The innkeeper nods.', lines));
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
    assert.deepEqual(ask({}).map(proof => proof.id), old, 'lines that read as they did keep their ids');
    assert.deepEqual(host.store.problems(), []);
    // The kill without the acceptance before it is refused (nothing to build on).
    await host.send('Hm.', text('A wolf.', ['! kill Bear | after: th_thread02']));
    assert.equal(turns.at(-1).problems.length, 1);
    assert.equal(ask({}).length, 2);
});

test('a reader\'s refusal is not an acceptance: pieces of it, one word and a short "I" are refused over a real turn, live and on a Continue', async t => {
    const { host, turns, ask } = await open(t);
    const refusal = 'No. I refuse the job, and I will not take it.';
    await host.send(refusal, text('The innkeeper sighs.', [`! accept ${T1} | words: I`, `! accept ${T2} | words: take it`, `! accept ${T1} | words: No`]));
    assert.deepEqual(ask({}), []);
    assert.equal(turns.at(-1).problems.length, 3);
    // A Continue adds a line, and the reader's message is still the one before the reply.
    await host.send(refusal, text('The innkeeper sighs again.', [`! accept ${T1} | words: ${'I refuse the job, and I will not take it'}`]));
    assert.equal(ask({}).length, 1, 'the whole sentence is a quote the host lets through; whether it accepts is the owner\'s to judge');
    await host.cont(text(' More.', [`! accept ${T2} | words: accept the job`]));
    assert.equal(ask({}).length, 1, 'a Continue\'s partial words are refused too');
    assert.match(String(turns.at(-1).problems.at(-1).message), /not a whole sentence/);
});

test('a reply that follows another reply has no message of the reader\'s to quote', async t => {
    const { host, turns, ask } = await open(t);
    await host.send('I accept the job.', text('The innkeeper frowns: "What job?"', []));
    assert.equal(ask({}).length, 0);
    // A second reply with no new message from the reader between (the chat reads A U A A).
    await host.st.generate('normal', { reply: text('Later...', [`! accept ${T1} | words: I accept the job`]) });
    assert.equal(host.ctx.chat.map(message => (message.is_user ? 'U' : 'A')).join(''), 'AUAA');
    assert.deepEqual(ask({}), []);
    assert.match(String(turns.at(-1).problems.at(-1).message), /no message from the reader/);
});

test('afterCapture steps of a Re-read see the proof of the lines it planned: a step may build on the acceptance a line gave', async t => {
    const { host, turns, ask } = await open(t, { after: true });
    await host.send('Sure, I accept the job. Thanks a lot!', text('Nods.', [`! accept ${T1} | words: Sure, I accept the job`]));
    const shown = () => ask({}).map(proof => [proof.kind, proof.parents.length]);
    assert.deepEqual(shown(), [['acceptance', 0], ['visit', 1]]);
    assert.deepEqual(turns.at(-1).problems, []);
    const result = await host.turn.reread(host.ctx.chat.length - 1);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(turns.at(-1).problems, []);
    assert.deepEqual(shown(), [['acceptance', 0], ['visit', 1]]);
    assert.equal(ask({})[1].parents[0], ask({})[0].id);
    assert.deepEqual(host.store.problems(), []);
});

test('a guarded click built on a proof survives a Re-read of text that did not change, and goes when the line\'s payload changes', async t => {
    const { host, turns, ask } = await open(t);
    await host.send('Sure, I accept the job. Thanks a lot!', text('Nods.', [`! accept ${T1} | words: Sure, I accept the job`]));
    const at = host.ctx.chat.length - 1;
    const [accepted] = ask({});
    // The reader's click builds on it, under a guard that needs it shown (a turn-in).
    const click = host.bus.command('sd.needs', { thread: T2, selection: 'Turn in', parent: accepted.id }, { cause: 'ui' });
    assert.equal(click.ok, true, click.message);
    const shown = () => ask({}).map(proof => `${proof.kind}:${proof.payload.thread ?? ''}`);
    assert.deepEqual(shown(), [`acceptance:${T1}`, `acceptance:${T2}`]);
    // Nothing changed: the line gives the proof it gave, with the id it had, and the click stays.
    const again = await host.turn.reread(at);
    assert.equal(again.ok, true, again.message);
    assert.deepEqual(turns.at(-1).problems, []);
    assert.deepEqual(ask({}).map(proof => proof.id).slice(0, 1), [accepted.id], 'the same id after a Re-read');
    assert.deepEqual(shown(), [`acceptance:${T1}`, `acceptance:${T2}`], 'and what was built on it');
    assert.deepEqual(Object.values(host.head().domains.sdt.accepted).map(entry => entry.thread), [T1, T2]);
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual(host.store.boundaryProblems(), [], 'a Re-read of an unchanged line');
    // The line now quotes something else: the proof has other bytes, so what was built on the old ones is hidden.
    host.ctx.chat[at].mes = text('Nods.', [`! accept ${T1} | words: Thanks a lot`]);
    host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id] = host.ctx.chat[at].mes;
    const changed = await host.turn.reread(at);
    assert.equal(changed.ok, true, changed.message);
    assert.deepEqual(shown(), [`acceptance:${T1}`]);
    assert.notEqual(ask({})[0].id, accepted.id, 'another line, another id');
    assert.notEqual(ask({})[0].payloadHash, accepted.payloadHash);
});

test('a step planned again after a Re-read sees the proof the Re-read gave, not the stored bytes it replaces', async t => {
    const { host, turns, ask } = await open(t, { after: 'check' });
    const check = dc => text('The die falls.', [`! check ck_check001 | dc: ${dc}`]);
    await host.send('Go on then.', check(10));
    const first = host.ctx.chat.length - 1;
    await host.send('And again.', text('The die falls again.', ['! check ck_check002 | dc: 5']));
    const steps = () => ask({}).filter(proof => proof.kind === 'visit');
    const event = () => ask({}).find(proof => proof.kind === 'event' && proof.payload.check === 'ck_check001');
    assert.equal(event().payload.dc, 10);
    assert.equal(steps().length, 2, 'a step on each reply, both on the first check');
    assert.ok(steps().every(step => step.parents[0] === event().id));
    const was = event().id;
    // The first reply is changed and read again: its check has another DC, which is another line, so another id. The step on the
    // same reply is asked for again by the hook and builds on the new proof; the step on the second reply was recorded on the old
    // id, which is gone, so it is off (its guard needs its parent shown) until the line is put back.
    host.ctx.chat[first].mes = check(20);
    host.ctx.chat[first].swipes[host.ctx.chat[first].swipe_id] = host.ctx.chat[first].mes;
    const result = await host.turn.reread(first);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(turns.at(-1).problems.filter(problem => problem.code !== 'REPLANNED'), []);
    assert.equal(event().payload.dc, 20);
    assert.notEqual(event().id, was, 'another line, another id');
    assert.deepEqual(ask({ ids: [was] }), []);
    assert.equal(steps().length, 1, 'the step on the first reply is asked for again on the new proof');
    assert.equal(steps()[0].parents[0], event().id);
    assert.equal(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE' && /guard/.test(problem.why)).length, 1, 'the step on the second reply is off');
    // The line is put back: it is the first line again, with its id, and the step on the second reply is back.
    host.ctx.chat[first].mes = check(10);
    host.ctx.chat[first].swipes[host.ctx.chat[first].swipe_id] = host.ctx.chat[first].mes;
    assert.equal((await host.turn.reread(first)).ok, true);
    assert.equal(event().id, was);
    assert.equal(steps().length, 2);
    assert.ok(steps().every(step => step.parents[0] === was));
    assert.deepEqual(host.store.problems(), []);
    // A step planned again keeps a boundary that matches the chat, proof included. (The story line kept on the second reply is a
    // guarded block that is not planned again, and its recorded prefix goes stale when an earlier reply is read again: that is
    // the replay core's, with or without proof, and is not looked at here.)
    const stale = host.store.boundaryProblems().filter(each => host.ctx.chat[each.index].extra.storySuite.spans.find(span => span.id === each.block).replan);
    assert.deepEqual(stale, []);
});
