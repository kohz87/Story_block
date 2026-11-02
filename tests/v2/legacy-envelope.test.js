// Story Block v1's envelope (`<!-- STORY_BLOCKS_V1 … -->`, capture.js adoptLegacy): never sent to the model (chat history, the
// greeting, a Continue, text completion), never shown; a reply that wrote its changes only there has them read once, through
// the capture (so a rebuild, a reload, a Re-read and a swipe agree), with one Problems line; a reply with its own <Changes>
// block has the envelope taken out unread and never warned about line by line; a Re-read of an older reply that the released
// code left unread applies its lines. A story line that repeats a line of the reply's block is never told as not used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { LEGACY_PROBLEM, adoptLegacy, extractBlock, grammarHeads, hasLegacy, hideBlock, legacyRead, parseChanges, stripBlock, stripLegacy } from '../../src/v2/capture.js';

const V1 = /STORY_BLOCKS_V1|INVENTORY_BLOCK_V05/;
const sentText = request => (request.chat ? request.chat.map(message => message.content).join('\n') : request.prompt);
const lines = body => (body === null ? [] : parseChanges(body).lines.map(line => line.raw));
const quiet = t => { t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'info', () => {}); };
const bag = host => Object.values(host.head().domains.inventory.stacks).map(stack => `${host.head().domains.inventory.defs[stack.def].name} ×${stack.qty}`).sort();
const told = (host, index) => host.turn.problems().filter(item => item.index === index);

// The reply the USER's model wrote: the story, a v1 envelope, then the <Changes> block with the same lines and more.
const BOTH = [
    'Nelje brought the stamp down twice.', '',
    '<!-- STORY_BLOCKS_V1', '+ item Rope | qty: 2', '~ place Lower Brine Cellars | kind: dungeon', '-->', '',
    '<Changes>', '+ item Rope | qty: 2', '~ place Lower Brine Cellars | kind: dungeon', '+ item Lantern', '</Changes>',
].join('\n');
// Its next reply: the envelope alone.
const ONLY = [
    'The cellar went still.', '',
    '<!-- STORY_BLOCKS_V1', '+ item Bog-rat Tail | qty: 8 | note: bounty proof', '+ item Burlap Sack', '~ place Low Weir | kind: wild', '-->',
].join('\n');
// What the released code (2.16.3) kept of ONLY: the envelope left as it was, its lines listed as left in the story.
const ONLY_AS_STORED = `${ONLY}\n\n<!-- STORY_SUITE_V2\n<Changes-story>\n+ item Bog-rat Tail | qty: 8 | note: bounty proof\n+ item Burlap Sack\n~ place Low Weir | kind: wild\n</Changes-story>\n-->`;

test('adoptLegacy: with no block of its own the envelope\'s change lines are the block, once each; with one it is taken out unread', () => {
    assert.deepEqual(adoptLegacy('Just story.\n\n<Changes>\n+ item Rope\n</Changes>'), { text: 'Just story.\n\n<Changes>\n+ item Rope\n</Changes>', legacy: null });
    const read = adoptLegacy(ONLY);
    assert.equal(read.legacy, 'read');
    assert.equal(read.text, 'The cellar went still.\n\n<Changes>\n+ item Bog-rat Tail | qty: 8 | note: bounty proof\n+ item Burlap Sack\n~ place Low Weir | kind: wild\n</Changes>');
    const ignored = adoptLegacy(BOTH);
    assert.equal(ignored.legacy, 'ignored');
    assert.ok(!V1.test(ignored.text));
    assert.deepEqual(lines(extractBlock(ignored.text)), ['+ item Rope | qty: 2', '~ place Lower Brine Cellars | kind: dungeon', '+ item Lantern']);
    // Two envelopes (and the cut and Inventory Block forms): one block, each line once, in the place of the first.
    const two = adoptLegacy('A.\n<!-- STORY_BLOCKS_V1\n+ item Rope\n-->\nB.\n<!-- INVENTORY_BLOCK_V05\n+ item Rope\n- item Torch\n-->\n<!-- STORY_BLOCKS_V1_CUT\n+ item Lamp\n-->');
    assert.equal(two.text, 'A.\n\n<Changes>\n+ item Rope\n- item Torch\n+ item Lamp\n</Changes>\nB.');
    // A v1 body that holds no change line (its own block format) is taken out, nothing read.
    assert.deepEqual(adoptLegacy('A.\n\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Inventory>\nRope | 1\n</Inventory>\n</Blocks>\n-->'), { text: 'A.', legacy: 'ignored' });
    assert.deepEqual(adoptLegacy('A greeting.\n\n<!-- STORY_BLOCKS_V1\n\n-->'), { text: 'A greeting.', legacy: 'ignored' });
    // One left open (the reply was cut off in it): its whole lines are read, the last one (maybe cut) is not.
    assert.equal(adoptLegacy('A.\n\n<!-- STORY_BLOCKS_V1\n+ item Rope\n+ item Lan').text, 'A.\n\n<Changes>\n+ item Rope\n</Changes>');
    // A Continue: only its own text is looked at.
    const base = 'A.\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ item Rope\n</Changes>\n-->';
    const more = `${base} More.\n\n<!-- STORY_BLOCKS_V1\n+ item Lamp\n-->`;
    assert.equal(adoptLegacy(more, { at: { from: base.length, skip: 0 } }).text, `${base} More.\n\n<Changes>\n+ item Lamp\n</Changes>`);
    // STORY_BLOCKS_V1_CONTEXT_* (v1's prompt markers) is no envelope.
    assert.equal(adoptLegacy('A. <!-- STORY_BLOCKS_V1_CONTEXT_BEGIN x -->').legacy, null);
});

test('stripLegacy and stripBlock take the envelope out (shown text and history); a text without one comes back as it was', () => {
    assert.equal(stripLegacy('Hello.\n\n<!-- STORY_BLOCKS_V1\n\n-->'), 'Hello.');
    assert.equal(stripBlock(BOTH), 'Nelje brought the stamp down twice.');
    assert.equal(stripBlock(ONLY), 'The cellar went still.');
    for (const text of ['Plain story.', 'A <!-- note --> in it.\n\n', 'A.\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ item Rope\n</Changes>\n-->']) assert.equal(stripLegacy(text), text);
    assert.equal(hasLegacy(ONLY), true);
    assert.equal(hasLegacy('A <!-- note -->'), false);
    // hideBlock's `legacy` says so in the comment, for a Re-read.
    const heads = grammarHeads([{ kind: 'item', grammar: '+ item Name' }]);
    assert.equal(legacyRead(hideBlock(adoptLegacy(ONLY).text, 'Changes', { heads, legacy: true })), true);
    assert.equal(legacyRead(hideBlock(adoptLegacy(ONLY).text, 'Changes', { heads })), false);
});

test('a greeting with an empty v1 envelope: never in the prompt, chat completion or text completion, nor in a Continue', async t => {
    quiet(t);
    for (const mainApi of ['openai', 'textgen']) {
        const host = await createHost({ st: { greeting: 'The quay.\n\n<!-- STORY_BLOCKS_V1\n\n-->', mainApi } });
        try {
            const first = await host.send('Hello.', 'Rain.\n<Changes>\n+ item Rope\n</Changes>');
            assert.ok(!V1.test(sentText(first.request)), `${mainApi}: the greeting's envelope is not sent`);
            assert.match(sentText(first.request), /The quay\./);
            const cont = await host.cont(' More rain.');
            assert.ok(!V1.test(sentText(cont.request)), `${mainApi}: nor in a Continue`);
            assert.equal(host.ctx.chat[0].mes, 'The quay.\n\n<!-- STORY_BLOCKS_V1\n\n-->', 'the greeting itself is not rewritten');
        } finally { host.close(); }
    }
});

test('a reply that wrote its changes only in a v1 envelope: read once, one Problems line, kept as a block; the next prompt has no v1 text', async t => {
    quiet(t);
    const host = await createHost({ st: { greeting: 'The quay.' } });
    try {
        await host.send('Hello.', 'Rain.\n<Changes>\n~ place Weir\n</Changes>');
        const { index } = await host.send('I cut through them.', ONLY);
        assert.deepEqual(bag(host), ['Bog-rat Tail ×8', 'Burlap Sack ×1']);
        assert.equal(host.head().domains.scene.place.name, 'Low Weir');
        assert.deepEqual(told(host, index).map(item => [item.code, item.message]), [['LEGACY_FORMAT', LEGACY_PROBLEM]], 'one plain line, no line by line warnings');
        const mes = host.ctx.chat[index].mes;
        assert.ok(!V1.test(mes), 'the envelope became the hidden block');
        assert.match(mes, /<!-- STORY_SUITE_V2 legacy\n<Changes>\n\+ item Bog-rat Tail/);
        const next = await host.send('On.', 'Mist.');
        assert.ok(!V1.test(sentText(next.request)));
        // Replay: a rebuild and a reload give the live story; a Re-read keeps it and tells the line again.
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify(host.head()), live);
        host.turn.clearProblems();
        const again = await host.turn.reread(index);
        assert.equal(again.ok, true);
        assert.deepEqual(bag(host), ['Bog-rat Tail ×8', 'Burlap Sack ×1']);
        assert.deepEqual(again.problems.map(item => item.code), ['LEGACY_FORMAT']);
    } finally { host.close(); }
});

test('a reply with both formats: its block is read once, the envelope is taken out, and no line is warned about', async t => {
    quiet(t);
    const host = await createHost({ st: { greeting: 'The quay.' } });
    try {
        const { index } = await host.send('We take the warrants.', BOTH);
        assert.deepEqual(bag(host), ['Lantern ×1', 'Rope ×2']);
        assert.deepEqual(told(host, index), [], 'no Problems at all');
        assert.ok(!V1.test(host.ctx.chat[index].mes));
        assert.ok(!/Changes-story/.test(host.ctx.chat[index].mes), 'nothing listed as left in the story');
        const swiped = await host.swipe(BOTH);
        assert.deepEqual(bag(host), ['Lantern ×1', 'Rope ×2'], 'a swipe reads it the same, once');
        assert.ok(!V1.test(sentText(swiped.request)));
    } finally { host.close(); }
});

test('a Re-read of an older reply the released code left unread applies its envelope\'s lines', async t => {
    quiet(t);
    const host = await createHost({ st: { greeting: 'The quay.' } });
    try {
        const { index } = await host.send('I cut through them.', 'The cellar went still.');
        const message = host.ctx.chat[index];
        message.mes = ONLY_AS_STORED;
        message.swipes[message.swipe_id] = ONLY_AS_STORED;
        assert.deepEqual(bag(host), []);
        const result = await host.turn.reread(index);
        assert.equal(result.ok, true);
        assert.deepEqual(bag(host), ['Bog-rat Tail ×8', 'Burlap Sack ×1']);
        assert.equal(host.head().domains.scene.place.name, 'Low Weir');
        assert.deepEqual(result.problems.map(item => item.code), ['LEGACY_FORMAT'], 'the lines once listed as left in the story are not warned about');
        assert.ok(!V1.test(message.mes));
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the Re-read story');
    } finally { host.close(); }
});

test('a story line that repeats a line of the reply\'s block is not told as not used; a different one still is', async t => {
    quiet(t);
    const host = await createHost({ st: { greeting: 'The quay.' } });
    try {
        const reply = 'Rain.\n\n```\n+ item Rope | qty: 2\n+ item Torch\n```\n\n<Changes>\n+ item Rope | qty: 2\n</Changes>';
        const { index } = await host.send('Hello.', reply);
        assert.deepEqual(bag(host), ['Rope ×2']);
        assert.deepEqual(told(host, index).map(item => item.line), ['+ item Torch']);
        host.turn.clearProblems();
        const again = await host.turn.reread(index);
        assert.deepEqual(again.problems.map(item => item.line), ['+ item Torch'], 'Re-read tells the same');
    } finally { host.close(); }
});

test('a chat with no v1 envelope sends the same bytes: each reply\'s history is its text without its block, as before', async t => {
    quiet(t);
    const host = await createHost({ st: { greeting: 'The quay. <!-- an author note -->' } });
    try {
        await host.send('Hello.', 'Rain.\n<Changes>\n+ item Rope\n</Changes>');
        await host.send('On.', 'Mist on the weir.');
        const { request } = await host.send('Again.', 'Quiet.');
        const assistant = request.chat.filter(message => message.role === 'assistant').map(message => message.content);
        assert.deepEqual(assistant, ['The quay. <!-- an author note -->', 'Rain.', 'Mist on the weir.']);
    } finally { host.close(); }
});
