// A Continue's block left bare (SB-fix3 live runs, SB-fix4): SillyTavern writes a continued reply again
// from its copy of the old text plus the added text, cleaned up as a whole, so the old text can come
// back shorter (spaces at line ends dropped, trimmed). The place where the added text started was
// counted in the old text; it then landed inside the added text, the block there was not read, and it
// stayed bare for the reader to see. capture.js continuation() finds that place instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { continuation, cutLine, extractBlock, hideBlock, parseChanges } from '../../src/v2/capture.js';
import { createHost } from '../../testkit/index.js';

const HIDDEN = /<!--\s*STORY_SUITE_V2[\s\S]*?-->/g;
const bare = mes => /<Changes>/i.test(String(mes).replace(HIDDEN, ''));
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const names = text => parseChanges(text ?? '').lines.map(line => line.name);

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Search.', 'You find gold.\n\n<Changes>\n+ coin 5 | from: a chest\n</Changes>');
    return host;
}

test('a Continue after an edit left spaces at line ends: its block is read once and hidden', async t => {
    const host = await fresh(t);
    const last = host.ctx.chat.length - 1;
    // The reader edits the story text (not the block) and leaves spaces at the ends of lines.
    const edited = host.ctx.chat[last].mes.replace('You find gold.', 'You find gold.          \nA second line.          \nA third.          ');
    await host.st.editMessage(last, edited);
    await host.cont(' More.\n<Changes>\n+ coin 7 | from: Kael\n</Changes>');
    const mes = host.ctx.chat[last].mes;
    assert.equal(bare(mes), false, `nothing of a change block is left bare: ${JSON.stringify(mes)}`);
    assert.equal(coin(host), 12);
    assert.deepEqual(names(extractBlock(mes)), ['5', '7'], 'both blocks are kept hidden for Re-read');
    assert.equal(host.turn.problems().length, 0, JSON.stringify(host.turn.problems()));
});

test('a Continue of a reply that starts with blank lines, written again trimmed: its block is read', async t => {
    const host = await fresh(t);
    const last = host.ctx.chat.length - 1;
    await host.st.editMessage(last, `\n\n\n      ${host.ctx.chat[last].mes}`);
    await host.cont('\n<Changes>\n+ coin 7 | from: Kael\n</Changes>');
    assert.equal(bare(host.ctx.chat[last].mes), false, host.ctx.chat[last].mes);
    assert.equal(coin(host), 12);
});

test('two Continues in a row on a cleaned-up reply each read only their own block', async t => {
    const host = await fresh(t);
    const last = host.ctx.chat.length - 1;
    await host.st.editMessage(last, host.ctx.chat[last].mes.replace('You find gold.', 'You find gold.            '));
    await host.cont(' More.\n<Changes>\n+ coin 7\n</Changes>');
    await host.cont(' Again.   \n<Changes>\n+ coin 2\n</Changes>');
    assert.equal(bare(host.ctx.chat[last].mes), false, host.ctx.chat[last].mes);
    assert.equal(coin(host), 14);
});

test('a block edited in by hand before the Continue is left for Re-read, not read by the Continue', async t => {
    const host = await fresh(t);
    const last = host.ctx.chat.length - 1;
    await host.st.editMessage(last, `${host.ctx.chat[last].mes}   \n<Changes>\n+ coin 500\n</Changes>   `);
    await host.cont(' More.\n<Changes>\n+ coin 7\n</Changes>');
    assert.equal(coin(host), 12, 'only the continuation\'s 7 gold');
    const shown = host.ctx.chat[last].mes.replace(HIDDEN, '');
    assert.match(shown, /\+ coin 500/, 'the hand-edited block stays where the reader put it');
    assert.doesNotMatch(shown, /\+ coin 7/, 'the continuation\'s block is hidden');
});

test('continuation(): the added text found past whitespace the clean-up dropped; bare blocks only', () => {
    const base = 'Rain.   \nMore.  \n\n<!-- STORY_SUITE_V2\n<Changes>\n+ coin 5\n</Changes>\n-->';
    const mes = 'Rain.\nMore.\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ coin 5\n</Changes>\n--> And.\n<Changes>\n+ coin 7\n</Changes>';
    const at = continuation(base, mes);
    assert.equal(at.skip, 0);
    assert.equal(mes.slice(at.from), ' And.\n<Changes>\n+ coin 7\n</Changes>');
    assert.equal(extractBlock(mes, 'Changes', at), '+ coin 7');
    assert.equal(cutLine(mes, 'Changes', at), null);
    const hidden = hideBlock(mes, 'Changes', at);
    assert.equal(bare(hidden), false, hidden);
    assert.deepEqual(names(extractBlock(hidden)), ['5', '7']);
    // Unchanged old text: the place is its length.
    assert.deepEqual(continuation('Rain.', 'Rain. And.'), { from: 5, skip: 0 });
});

test('continuation(): when the old text came back changed elsewhere, a hidden block is never read again', () => {
    // A regex script (say) rewrote a word of the old text: the place found stops there, early.
    const base = 'You meet {{char}}.\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ coin 5\n</Changes>\n-->\n<Changes>\n+ coin 500\n</Changes>';
    const mes = 'You meet Ann.\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ coin 5\n</Changes>\n-->\n<Changes>\n+ coin 500\n</Changes> And.\n<Changes>\n+ coin 7\n</Changes>';
    const at = continuation(base, mes);
    assert.ok(at.from < mes.indexOf('<!--'), `stopped early at ${at.from}`);
    assert.equal(at.skip, 1, 'the bare block the old text already had');
    assert.equal(extractBlock(mes, 'Changes', at), '+ coin 7', 'neither the hidden 5 nor the old bare 500');
    const hidden = hideBlock(mes, 'Changes', at);
    assert.match(hidden.replace(HIDDEN, ''), /\+ coin 500/);
    assert.doesNotMatch(hidden.replace(HIDDEN, ''), /\+ coin 7/);
});

test('continuation(): a cut-off line in the added block is still told', () => {
    const base = 'Rain.  \nOn.';
    const mes = 'Rain.\nOn. And.\n<Changes>\n+ coin 7\n+ coin 2';
    const at = continuation(base, mes);
    assert.equal(extractBlock(mes, 'Changes', at), '+ coin 7');
    assert.equal(cutLine(mes, 'Changes', at), '+ coin 2');
});
