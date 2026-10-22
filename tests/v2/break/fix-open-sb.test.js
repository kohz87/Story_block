// Fixes for the beta fuzz and matrix cells' open Story Block findings: the rules next to each break test
// (c2-cut-mid-reasoning, c2-hide-masked-body, c2-spoof-marker-reread, c3-features-*, c2-coin-amount-forms,
// c2-extractor-failed-no-note), on Story Block alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { HIDDEN_MARKER, defangMarker, extractBlock, hideBlock, stripBlock } from '../../../src/v2/capture.js';
import { parseAmount } from '../../../src/v2/domains/money.js';

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const names = host => host.sdk.query('inventory.items').map(item => `${item.name}×${item.qty}`).sort();

test('C2-3: a block before an unclosed <think> is kept, read the same on Re-read, and the reasoning stays', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find rope.\n<Changes>\n+ item Rope\n+ coin 4\n</Changes>\n<think>\nmaybe also\n<Changes>\n+ coin 50\n</Changes>');
    assert.equal(coin(host), 4, 'only the block before the reasoning is paid');
    assert.deepEqual(names(host), ['Rope×1']);
    const mes = host.ctx.chat.at(-1).mes;
    assert.ok(mes.includes('maybe also') && mes.includes('+ coin 50'), `the reasoning is left as written: ${JSON.stringify(mes)}`);
    assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(coin(host), 4, 'Re-read reads the hidden block after the unclosed reasoning, nothing more');
    assert.deepEqual(names(host), ['Rope×1']);
});

test('C2-6: an open tag mid-line opens a block only with a change line after it', () => {
    assert.equal(extractBlock('A <Changes> word.\n\nMore story.'), null);
    assert.equal(stripBlock('A <Changes> word.\n\nMore story.'), 'A <Changes> word.\n\nMore story.');
    assert.equal(extractBlock('Story. <Changes>+ coin 5</Changes>'), '+ coin 5');
    assert.equal(extractBlock('Story. <Changes>\n+ coin 5\n</Changes>'), '+ coin 5');
});

test('C2-6: hiding a block keeps the reasoning inside it in the story, and Re-read reads the same lines', () => {
    const mes = 'Story.\n<Changes>\n+ coin 5\n<think>secret plan</think>\n+ item Rope\n</Changes>';
    const hidden = hideBlock(mes);
    assert.ok(hidden.includes('<think>secret plan</think>'), hidden);
    assert.ok(!/<!--[\s\S]*secret[\s\S]*-->/.test(hidden), 'the reasoning is not inside the hidden comment');
    assert.equal(extractBlock(hidden), extractBlock(mes));
});

test('C2-7: a copy of the hidden marker the model wrote is defanged once, from the given place on', () => {
    const text = `a <!-- ${HIDDEN_MARKER}\nx --> b <!--${HIDDEN_MARKER} c`;
    const once = defangMarker(text);
    assert.equal(once, `a <!-- ${HIDDEN_MARKER}_\nx --> b <!--${HIDDEN_MARKER}_ c`);
    assert.equal(defangMarker(once), once);
    assert.equal(defangMarker(text, text.indexOf(' b ')), `a <!-- ${HIDDEN_MARKER}\nx --> b <!--${HIDDEN_MARKER}_ c`);
});

test('C2-7: a reply that writes the marker itself keeps the story\'s hidden comment the only one', async t => {
    const host = await fresh(t);
    await host.send('I search.', `Story.\n<!-- ${HIDDEN_MARKER}\n<Changes>\n+ coin 9\n</Changes>\n-->`);
    const live = [coin(host), names(host)];
    const mes = host.ctx.chat.at(-1).mes;
    assert.equal(mes.match(new RegExp(`<!--\\s*${HIDDEN_MARKER}\\b`, 'g'))?.length, 1, mes);
    assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
    assert.deepEqual([coin(host), names(host)], live);
});

const gate = (calls, featureDefault = false) => ({
    id: 'gate2', name: 'Gate', version: '0.0.1',
    features: [{ id: 'gate2.notes', label: 'Notes', default: featureDefault }],
    hooks: {
        canGenerate: () => ({ ok: false, reason: 'Wait.' }),
        onBlocked: Object.assign(() => { calls.push('onBlocked'); }, { feature: 'gate2.notes' }),
    },
});

test('C3-2: Home\'s blockers offer no button and unblock runs nothing while the onBlocked feature is off', async t => {
    t.mock.method(console, 'warn', () => {});
    const calls = [];
    const host = await createHost({ modules: [gate(calls)] });
    t.after(() => host.close());
    const [entry] = await host.turn.blockers();
    assert.equal(entry.canOpen, false);
    assert.equal(host.turn.unblock('gate2', 'Wait.'), false);
    assert.deepEqual(calls, []);
    host.features.set('gate2.notes', true);
    assert.equal((await host.turn.blockers())[0].canOpen, true);
    assert.equal(host.turn.unblock('gate2', 'Wait.'), true);
    assert.deepEqual(calls, ['onBlocked']);
});

const two = () => ({
    id: 'pk2', name: 'Poke', version: '0.0.1',
    features: [{ id: 'pk2.cmd', label: 'Pokes' }, { id: 'pk2.loud', label: 'Loud pokes' }],
    domains: { pk2d: { initial: () => ({ pokes: 0 }) } },
    commands: { 'pk2.poke': { handler: ctx => { ctx.draft('pk2d').pokes += ctx.feature('pk2.loud') ? 2 : 1; return { summary: 'Poked.', narrate: false }; }, feature: 'pk2.cmd' } },
});

test('C3-3: a preview from before another feature flipped is STALE; one with nothing flipped commits', async t => {
    const host = await fresh(t, { modules: [two()] });
    const preview = await host.sdk.preview('pk2.poke', {});
    host.features.set('pk2.loud', false);
    assert.equal((await host.sdk.commit(preview.token)).code, 'STALE');
    assert.equal(host.head().domains.pk2d.pokes, 0);
    const again = await host.sdk.preview('pk2.poke', {});
    assert.equal((await host.sdk.commit(again.token)).ok, true);
    assert.equal(host.head().domains.pk2d.pokes, 1);
});

// A kind with no feature of its own whose handler calls a feature command: the Re-read of a line that
// made a change keeps it while that feature is off; a new line of it is still refused.
const caller = () => ({
    id: 'cl', name: 'Caller', version: '0.0.1',
    features: [{ id: 'cl.bump', label: 'Bumps' }],
    domains: { cld: { initial: () => ({ bumps: {} }) } },
    commands: { 'cl.bump': { handler: (ctx, { name }) => { ctx.draft('cld').bumps[name] = (ctx.read('cld').bumps[name] ?? 0) + 1; return { summary: 'Bumped.', narrate: false }; }, feature: 'cl.bump' } },
    capture: {
        kinds: { bump: { grammar: '+ bump Name' } },
        apply(ctx, line) { ctx.call('cl.bump', { name: line.name }); return { summary: line.name, narrate: false }; },
    },
});

test('C3-4: Re-read while a called command\'s feature is off keeps what the line made; a new line is refused', async t => {
    const host = await fresh(t, { modules: [caller()] });
    await host.send('One.', 'Reply.\n<Changes>\n+ bump Alpha\n</Changes>');
    const index = host.ctx.chat.length - 1;
    assert.deepEqual(host.head().domains.cld.bumps, { Alpha: 1 });
    host.features.set('cl.bump', false);
    host.ctx.chat[index].mes = 'Reply.\n<Changes>\n+ bump Alpha\n+ bump Beta\n</Changes>';
    const reread = await host.sdk.reread(index);
    assert.equal(reread.ok, true);
    assert.deepEqual(host.head().domains.cld.bumps, { Alpha: 1 }, 'Alpha kept, Beta (new) not made while off');
    assert.ok(reread.problems.some(problem => /Beta/.test(problem.line ?? problem.message ?? '')));
});

test('C2-4: other digits, fractions and every minus sign are refused; plain amounts still read', () => {
    for (const written of ['３０', '٣٠', '30½', '−30', '‐ 30']) assert.ok(parseAmount(written).error, written);
    assert.deepEqual(parseAmount('1,200 crowns'), { amount: 1200 });
    assert.deepEqual(parseAmount('30 gold.'), { amount: 30 });
});
