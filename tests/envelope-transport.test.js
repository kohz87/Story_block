// Transport: normalizeTransport, rejoinContinuation, stripBlocks, bareBlockTexts, upsertBlock.
// Ports the cut-off, Continue, idempotency and "-->" cases of Inventory Block's
// v0.6.3–v0.6.6 audits to the multi-block envelope. Rows-shaped bodies use a rows
// definition only where the line-shape heuristics matter, never its parse result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlock } from '../src/schema.js';
import {
    CUT_MARKER,
    ENVELOPE_MARKER,
    bareBlockTexts,
    extractBlocks,
    latestBlockInText,
    normalizeTransport,
    rejoinContinuation,
    stripBlocks,
    upsertBlock,
} from '../src/envelope.js';

const notes = normalizeBlock({ id: 'notes', name: 'Notes', tag: 'Notes', kind: 'stateful', format: 'text' });
const mood = normalizeBlock({ id: 'mood', name: 'Mood', tag: 'Mood', kind: 'turn', format: 'text' });
const inventory = normalizeBlock({ id: 'inventory', name: 'Inventory', tag: 'Inventory', kind: 'stateful', format: 'rows' });
const sheet = normalizeBlock({ id: 'sheet', name: 'Sheet', tag: 'Sheet', kind: 'stateful', format: 'fields', fields: [{ label: 'HP', type: 'meter' }] });
const defs = [inventory, notes, mood, sheet];

const envelope = (...blocks) => `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const note = text => `<Notes>\n${text}\n</Notes>`;
const visible = text => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, '');
const squash = text => text.replace(/\s+/g, ' ').trim();
const normalize = text => normalizeTransport(text, defs);
const notesText = text => latestBlockInText(text, notes)?.state.text;
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test('a well-formed envelope is left byte for byte', () => {
    const text = `Story.\n${envelope(note('n'), '<Mood>\ncalm\n</Mood>')}\nMore prose after it.`;
    assert.deepEqual(normalize(text), { text, changed: false });
    assert.deepEqual(normalize(''), { text: '', changed: false });
    assert.deepEqual(normalize(undefined), { text: '', changed: false });
});

test('a bare <Blocks> holding known blocks becomes the hidden envelope in place', () => {
    const raw = 'Story.\n<Blocks>\n<Notes>\nThe guards are on alert.\n</Notes>\n<Mood>\ntense\n</Mood>\n</Blocks>\nAfter.';
    const once = normalize(raw);
    assert.equal(once.changed, true);
    assert.equal(once.text, `Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nThe guards are on alert.\n</Notes>\n<Mood>\ntense\n</Mood>\n</Blocks>\n-->\nAfter.`);
    assert.equal(normalize(once.text).changed, false, 'idempotent');
    assert.equal(notesText(once.text), 'The guards are on alert.');
});

test('a bare <Blocks> keeps foreign tags (other extensions read them) and one without known blocks is not ours', () => {
    const mixed = 'Story.\n<Blocks>\n<World_State>\nx --> y\n</World_State>\n<Notes>\nn\n</Notes>\n</Blocks>';
    const once = normalize(mixed).text;
    assert.match(once, /<World_State>\nx --\\> y\n<\/World_State>/);
    assert.equal(squash(visible(once)), 'Story.');
    const foreign = 'Story.\n<Blocks>\n<World_State>\nx\n</World_State>\n</Blocks>';
    assert.equal(normalize(foreign).changed, false);
    assert.equal(stripBlocks(foreign, defs), 'Story.\n', 'but prompts still lose it');
});

test('a stray "-->" after a bare </Blocks> (mangled opener) is taken with the blocks', () => {
    const once = normalize('Story.\n<Blocks>\n<Notes>\nn\n</Notes>\n</Blocks>\n-->\nAfter.').text;
    assert.equal(squash(visible(once)), 'Story. After.');
    assert.equal(count(once, /-->/g), 1);
});

test('bare known tags become one envelope where they were written', () => {
    const raw = 'Story.\n<Notes>\nThe guards.\n</Notes>\n\n<Mood>\ntense\n</Mood>';
    const once = normalize(raw).text;
    assert.equal(once, `Story.\n${envelope(note('The guards.'), '<Mood>\ntense\n</Mood>')}`);
    assert.equal(normalize(once).changed, false);
    // Blocks separated by prose stay where they are, each hidden.
    const scattered = normalize('A <Notes>x</Notes> middle prose. <Mood>\ncalm\n</Mood> end.').text;
    assert.equal(squash(visible(scattered)), 'A middle prose. end.');
    assert.equal(count(scattered, /STORY_BLOCKS_V1\n/g), 2);
});

test('a bare block next to the envelope joins it: one hidden section per reply', () => {
    const after = normalize(`Story.\n\n${envelope(note('n'))}\n\n<Mood>\ncalm\n</Mood>`).text;
    assert.equal(after, `Story.\n\n${envelope(note('n'), '<Mood>\ncalm\n</Mood>')}`);
    assert.equal(normalize(after).changed, false);
    const before = normalize(`Story.\n<Mood>\ncalm\n</Mood>\n${envelope(note('n'))}`).text;
    assert.equal(before, `Story.\n${envelope('<Mood>\ncalm\n</Mood>', note('n'))}`);
    // Two envelopes already in a reply (older versions) merge on the next pass, in order.
    const doubled = normalize(`Story.\n${envelope(note('a'))} ${envelope('<Mood>\ncalm\n</Mood>')}`);
    assert.equal(doubled.text, `Story.\n${envelope(note('a'), '<Mood>\ncalm\n</Mood>')}`);
    // Prose between them keeps them apart.
    const apart = `Story.\n${envelope(note('a'))}\nMore story.\n${envelope('<Mood>\ncalm\n</Mood>')}`;
    assert.equal(normalize(apart).changed, false);
    // A later write (a plugin knows only its own tag) lands in the one envelope.
    const written = upsertBlock(`Story.\n${envelope(note('a'))}\n\n${envelope('<Mood>\ncalm\n</Mood>')}`, sheet, 'HP: 3/5');
    assert.equal(count(written, /STORY_BLOCKS_V1\n/g), 1);
    assert.equal(squash(visible(written)), 'Story.');
    assert.deepEqual(extractBlocks(written, defs).map(entry => entry.def.tag), ['Notes', 'Mood', 'Sheet']);
});

test('H2: prose mentioning a block tag is never treated as a block', () => {
    const card = 'You are Mira.\nKeep an <inventory> of what the party owns.\nMira never gives discounts.';
    assert.equal(normalize(card).changed, false);
    assert.equal(stripBlocks(card, defs), card);
    const narration = 'She pats her bag.\n<inventory> is a word she hates.\nThen she walks on.';
    assert.equal(normalize(narration).changed, false);
    assert.equal(normalize('He said <Notes> twice.').changed, false);
    assert.equal(normalize('Write it like "the <Blocks> tag" please.').changed, false);
});

test('H2: real cut-off blocks are hidden and stripped', () => {
    const cut = 'Story\n<Inventory>\nCoin | 1 | 10 Gold\nRope | 1 | 5';
    const once = normalize(cut).text;
    assert.equal(once, `Story\n<!-- ${CUT_MARKER}\n<Inventory>\nCoin | 1 | 10 Gold\nRope | 1 | 5\n-->`);
    assert.equal(stripBlocks(cut, defs), 'Story\n');
    const env = `Story\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Inventory>\nCoin | 1 |`;
    assert.equal(normalize(env).text, `Story\n<!-- ${CUT_MARKER}\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Inventory>\nCoin | 1 |\n-->`);
    assert.equal(stripBlocks(env, defs), 'Story\n');
});

test('L2: finished prose after an unclosed bare block is not hidden; a cut-off row is', () => {
    const prose = 'Story.\n<Inventory>\nA | 1 |\nB | 2 |\nShe smiled.';
    assert.equal(normalize(prose).changed, false);
    assert.match(normalize('Story.\n<Inventory>\nA | 1 |\nB | 2 |\nCoi').text, /Coi\n-->$/);
    for (const last of ['Coin Po', 'Rope (50 ft)', 'A very long partial item name that runs well past forty characters']) {
        assert.match(normalize(`Story.\n<Inventory>\nA | 1 |\n${last}`).text, new RegExp(`${CUT_MARKER}[\\s\\S]*-->$`), last);
    }
    for (const last of ['She smiled.', '(She smiled.)', '"Done," she said.', '*She left.*']) {
        assert.equal(normalize(`Story.\n<Inventory>\nA | 1 |\n${last}`).changed, false, last);
    }
});

test('line shapes follow the format: fields lines are "Label: value"', () => {
    assert.match(normalize('Story.\n<Sheet>\nHP: 80/100\nStatus: tir').text, new RegExp(`${CUT_MARKER}[\\s\\S]*tir\\n-->$`));
    assert.equal(normalize('Story.\n<Sheet>\nHP: 80/100\nShe smiled at him.').changed, false);
});

test('H3: "-->" inside a body cannot break the hidden envelope', () => {
    const modelRaw = `Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nOakhaven --> Veyl\n</Notes>\n</Blocks>\n-->`;
    const once = normalize(modelRaw);
    assert.equal(once.changed, true);
    assert.equal(once.text, `Story.\n${envelope(note('Oakhaven --\\> Veyl'))}`);
    assert.equal(normalize(once.text).changed, false, 'repair is idempotent');
    assert.equal(notesText(once.text), 'Oakhaven --> Veyl');
    assert.equal(stripBlocks(modelRaw, defs), 'Story.\n');
    // Without the <Blocks> wrapper the envelope ends at the first "-->" outside a body.
    const unwrapped = `Story.\n<!-- ${ENVELOPE_MARKER}\n<Notes>\nA --> B\n</Notes>\n-->\nAfter.`;
    assert.equal(normalize(unwrapped).text, `Story.\n<!-- ${ENVELOPE_MARKER}\n<Notes>\nA --\\> B\n</Notes>\n-->\nAfter.`);
    assert.equal(notesText(unwrapped), 'A --> B');
    assert.equal(stripBlocks(unwrapped, defs), 'Story.\n\nAfter.');
    // Bare bodies are escaped as they move into the comment.
    const bare = normalize('Story.\n<Notes>\nA --> B, then </Blocks> and <Blocks>\n</Notes>').text;
    assert.equal(count(visible(bare), /\S/g), count('Story.', /\S/g));
    assert.equal(notesText(bare), 'A --> B, then </Blocks> and <Blocks>');
});

test('an envelope whose "-->" was forgotten after </Blocks> is closed there; prose after it stays', () => {
    const once = normalize(`Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${note('n')}\n</Blocks>\nShe smiled.`).text;
    assert.equal(once, `Story.\n${envelope(note('n'))}\nShe smiled.`);
    const forgotBlocks = normalize(`Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${note('n')}\n\nShe smiled and left.`).text;
    assert.equal(squash(visible(forgotBlocks)), 'Story. She smiled and left.');
    assert.equal(notesText(forgotBlocks), 'n');
    assert.equal(normalize(forgotBlocks).changed, false);
});

test('legacy INVENTORY_BLOCK_V05 comments are left alone and stripped from prompts', () => {
    const legacy = 'Hi.\n<!-- INVENTORY_BLOCK_V05\n<Inventory>\nCoin Pouch | 1 | 42 Gold\n</Inventory>\n-->';
    assert.equal(normalize(legacy).changed, false);
    const closedCut = 'Hi.\n<!-- INVENTORY_BLOCK_V05\n<Inventory>\nCoin Pouch | 1 | 4\n-->\nThen she slept.';
    assert.equal(normalize(closedCut).changed, false);
    assert.equal(stripBlocks(legacy, defs), 'Hi.\n');
    assert.equal(stripBlocks(closedCut, defs), 'Hi.\n\nThen she slept.');
    assert.equal(stripBlocks(legacy, defs, { bare: false }), 'Hi.\n');
});

// Every possible cut position of a reply, followed by Continue writing the rest exactly.
function sweep(full, check) {
    for (let i = 1; i < full.length; i++) {
        const received = normalize(full.slice(0, i)).text;
        check(i, received, `${received}${full.slice(i)}`);
    }
}

const fullReply = `She paid.\n${envelope('<Mood>\ncalm\n</Mood>', note('The guards are on alert.\nGold left: 90'))}`;

test('L2: Continue that picks up exactly at the cut recovers the blocks wherever the cut fell', () => {
    sweep(fullReply, (i, received, continued) => {
        const at = JSON.stringify(fullReply.slice(Math.max(0, i - 12), i));
        const normalized = normalize(continued);
        assert.equal(notesText(normalized.text), 'The guards are on alert.\nGold left: 90', at);
        assert.equal(visible(normalized.text), 'She paid.\n', `${at}: no fragments left in narration`);
        assert.equal(normalize(normalized.text).changed, false, `${at}: idempotent`);
        assert.equal(stripBlocks(continued, defs), 'She paid.\n', `${at}: prompt keeps only the prose`);
        assert.equal(count(normalized.text, /STORY_BLOCKS_V1/g), 1, `${at}: one envelope`);
        // The reader never sees part of the envelope while the reply sits cut off.
        if (i > 'She paid.\n<!'.length) assert.equal(visible(received), 'She paid.\n', `${at}: hidden on receive`);
    });
});

test('Continue completes a cut-off bare <Blocks> and bare tags too', () => {
    for (const full of [
        'She paid.\n<Blocks>\n<Notes>\nThe guards are on alert.\n</Notes>\n<Mood>\ntense\n</Mood>\n</Blocks>',
        'She paid.\n<Notes>\nThe guards are on alert.\n</Notes>\n<Mood>\ntense\n</Mood>',
    ]) {
        sweep(full, (i, _received, continued) => {
            const at = JSON.stringify(full.slice(0, i));
            const normalized = normalize(continued);
            assert.equal(notesText(normalized.text), 'The guards are on alert.', at);
            assert.equal(squash(visible(normalized.text)), 'She paid.', at);
            assert.equal(normalize(normalized.text).changed, false, at);
            assert.equal(squash(stripBlocks(continued, defs)), 'She paid.', at);
        });
    }
});

test('a cut inside a body with a raw "-->" stays hidden and keeps the arrow', () => {
    const full = `She paid.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nA --> B\n</Notes>\n</Blocks>\n-->`;
    sweep(full, (i, _received, continued) => {
        const normalized = normalize(continued).text;
        assert.equal(notesText(normalized), 'A --> B', JSON.stringify(full.slice(0, i)));
        assert.equal(visible(normalized), 'She paid.\n', JSON.stringify(full.slice(0, i)));
    });
});

test('H1: Continue after a cut that writes new prose and a new envelope keeps both', () => {
    const cut = normalize(`She paid the innkeeper.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nThe guards are on al`).text;
    const next = envelope(note('Upstairs now.'));
    const continued = `${cut}\nThen she climbed the stairs and slept.\n${next}`;
    assert.equal(rejoinContinuation(continued), continued, 'finished prose is not a continuation of the cut');
    const normalized = normalize(continued);
    assert.equal(normalized.changed, false, 'already well-formed: nothing to repair');
    assert.match(visible(normalized.text), /climbed the stairs/);
    assert.equal(notesText(continued), 'Upstairs now.');
    assert.equal(stripBlocks(continued, defs), 'She paid the innkeeper.\n\nThen she climbed the stairs and slept.\n');
    // Prose only, no new envelope: still visible, the cut stays hidden.
    const proseOnly = `${cut}\nThen she slept.`;
    assert.equal(normalize(proseOnly).changed, false);
    assert.equal(squash(visible(proseOnly)), 'She paid the innkeeper. Then she slept.');
    // A new block written straight after the cut is a new block, not the cut's rest.
    const newBlock = `${cut}\n<Notes>\nFresh.\n</Notes>`;
    assert.equal(rejoinContinuation(newBlock), newBlock);
    assert.equal(notesText(normalize(newBlock).text), 'Fresh.');
});

test('H1: a cut row finished by Continue and then followed by prose keeps the prose visible', () => {
    const cut = normalize(`She paid.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Inventory>\nCoin Pouch | 1 | 90 Go`).text;
    const normalized = normalize(`${cut}ld\nThen she slept.\n${envelope(note('n'))}`);
    assert.equal(squash(visible(normalized.text)), 'She paid. Then she slept.');
    assert.equal(normalize(normalized.text).changed, false);
    assert.deepEqual(extractBlocks(normalized.text, defs).map(entry => [entry.def.tag, entry.body, entry.truncated]), [
        ['Inventory', 'Coin Pouch | 1 | 90 Gold', true],
        ['Notes', 'n', false],
    ]);
});

test('H1: an unclosed envelope or bare block followed by more text is closed before the prose', () => {
    const next = envelope(note('n'));
    const raw = `She paid.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Inventory>\nCoin Pouch | 1 | 90 Go\nThen she slept.\n${next}`;
    const once = normalize(raw);
    assert.equal(squash(visible(once.text)), 'She paid. Then she slept.');
    assert.equal(normalize(once.text).changed, false, 'idempotent');
    assert.equal(notesText(once.text), 'n');

    const bare = 'She paid.\n<Inventory>\nCoin Pouch | 1 | 90 Go\nThen she slept.\n<Inventory>\nCoin Pouch | 1 | 90 Gold\n</Inventory>';
    const hidden = normalize(bare).text;
    assert.equal(squash(visible(hidden)), 'She paid. Then she slept.');
    assert.equal(normalize(hidden).changed, false);
    const entries = extractBlocks(hidden, defs);
    assert.deepEqual(entries.map(entry => entry.truncated), [true, false], 'the cut copy stays cut, never valid');

    // Free text has no line shape: a blank line ends the cut block.
    const text = normalize('She paid.\n<Notes>\nThe guards are\n\nThen she slept.\n<Notes>\nNew.\n</Notes>').text;
    assert.equal(squash(visible(text)), 'She paid. Then she slept.');
});

test('rejoinContinuation: closers of finished envelopes and cuts followed by finished prose are left alone', () => {
    const finished = `${fullReply}\nThen she slept.`;
    assert.equal(rejoinContinuation(finished), finished);
    const cut = normalize('She paid.\n<Notes>\nThe guards are').text;
    assert.equal(rejoinContinuation(cut), cut, 'nothing follows');
    assert.equal(rejoinContinuation(`${cut}\n\n`), `${cut}\n\n`, 'only whitespace follows');
    assert.equal(rejoinContinuation(`${cut} on alert.\n</Notes>`), 'She paid.\n<Notes>\nThe guards are on alert.\n</Notes>');
    assert.equal(rejoinContinuation(`${cut}\nstill writing`), 'She paid.\n<Notes>\nThe guards are\nstill writing', 'an unfinished line continues the cut');
    assert.equal(rejoinContinuation(undefined), '');
});

test('rejoinContinuation then normalizeTransport is stable across repeated Continue cuts', () => {
    let message = normalize('Story.\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Notes>\nOne').text;
    message = normalize(`${message} two`).text;
    assert.match(message, new RegExp(`${CUT_MARKER}[\\s\\S]*One two\\n-->$`));
    message = normalize(`${message} three.\n</Notes>\n</Blocks>\n-->`).text;
    assert.equal(message, `Story.\n${envelope(note('One two three.'))}`);
});

test('a reply cut inside the envelope opener is hidden and completed by Continue', () => {
    for (const cut of ['<!', '<!-', '<!--', '<!-- ', '<!-- STORY_BL', '<!-- STORY_BLOCKS_V1']) {
        const received = normalize(`She paid.\n${cut}`).text;
        assert.equal(visible(received), 'She paid.\n', cut);
        assert.equal(stripBlocks(`She paid.\n${cut}`, defs), 'She paid.\n', cut);
    }
    assert.equal(normalize('Wow <!-- a comment of mine').changed, false, 'other comments are not ours');
});

test('stripBlocks removes complete and cut envelopes, bare <Blocks> and bare tags; surrounding prose intact', () => {
    const text = [
        'Intro.',
        envelope(note('one')),
        'Middle.',
        '<Blocks>\n<Mood>\ncalm\n</Mood>\n</Blocks>',
        'Then <Notes>inline</Notes> prose.',
        'End.',
        `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nhal`,
    ].join('\n');
    const stripped = stripBlocks(text, defs);
    assert.equal(squash(stripped), 'Intro. Middle. Then prose. End.');
    assert.doesNotMatch(stripped, /Notes|Mood|Blocks|-->|<!--/);
    assert.equal(stripBlocks('plain prose', defs), 'plain prose');
    assert.equal(stripBlocks(undefined, defs), '');
});

test('L6: bare: false removes only hidden envelopes; knownBlocks also drops copies of history blocks', () => {
    const example = '<Notes>\nExample format\n</Notes>';
    const history = '<Notes>\nThe guards are on alert.\n</Notes>';
    const text = `Example:\n${example}\nHistory:\n${envelope(note('hidden'))}\nPasted:\n${history}\n<Blocks>\n<Mood>\ncalm\n</Mood>\n</Blocks>`;
    assert.equal(stripBlocks(text, defs, { bare: false }), `Example:\n${example}\nHistory:\n\nPasted:\n${history}\n<Blocks>\n<Mood>\ncalm\n</Mood>\n</Blocks>`);
    const known = new Set(bareBlockTexts(`Reply\n${history}\n<Blocks>\n<Mood>\ncalm\n</Mood>\n</Blocks>\n${envelope(note('hidden'))}`, defs));
    assert.deepEqual([...known], ['<Blocks>\n<Mood>\ncalm\n</Mood>\n</Blocks>', history]);
    assert.equal(stripBlocks(text, defs, { bare: false, knownBlocks: known }), `Example:\n${example}\nHistory:\n\nPasted:\n\n`);
    // The pasted copies sit side by side, so they are hidden as one envelope and go together.
    assert.equal(stripBlocks(text, defs), 'Example:\n\nHistory:\n\nPasted:\n');
    // A cut envelope in user content goes too.
    assert.equal(stripBlocks(`Quote: <!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nhal`, defs, { bare: false }), 'Quote: ');
});

test('upsertBlock replaces the copy inside the envelope and keeps the other blocks', () => {
    const text = `Story.\n${envelope('<Mood>\nsad\n</Mood>', note('old'))}\nAfter.`;
    const updated = upsertBlock(text, notes, 'Edited');
    assert.equal(updated, `Story.\n${envelope('<Mood>\nsad\n</Mood>', note('Edited'))}\nAfter.`);
    assert.equal(normalize(updated).changed, false);
    // The newest copy is the one replaced, so it is the one read back.
    const two = `${envelope(note('first'))}\nmore\n${envelope(note('second'))}`;
    assert.equal(notesText(upsertBlock(two, notes, 'Edited')), 'Edited');
    assert.match(upsertBlock(two, notes, 'Edited'), /first/);
});

test('upsertBlock adds the block to an envelope without it, or appends a new envelope', () => {
    const text = `Story.\n${envelope('<Mood>\nsad\n</Mood>')}`;
    assert.equal(upsertBlock(text, notes, 'New'), `Story.\n${envelope('<Mood>\nsad\n</Mood>', note('New'))}`);
    assert.equal(upsertBlock('Story only.  \n', notes, 'New'), `Story only.\n\n${envelope(note('New'))}`);
    assert.equal(upsertBlock('', notes, 'New'), envelope(note('New')));
    assert.equal(upsertBlock('Story.', notes, ''), `Story.\n\n${envelope('<Notes>\n</Notes>')}`);
    const unwrapped = `Story.\n<!-- ${ENVELOPE_MARKER}\n<Mood>\nsad\n</Mood>\n-->`;
    assert.equal(upsertBlock(unwrapped, notes, 'New'), `Story.\n<!-- ${ENVELOPE_MARKER}\n<Mood>\nsad\n</Mood>\n${note('New')}\n-->`);
});

test('upsertBlock: a bare copy is hidden first; a legacy snapshot is left and a new envelope added', () => {
    assert.equal(upsertBlock('Story.\n<Notes>\nold\n</Notes>', notes, 'Edited'), `Story.\n${envelope(note('Edited'))}`);
    const legacy = 'Hi.\n<!-- INVENTORY_BLOCK_V05\n<Inventory>\nA | 1 |\n</Inventory>\n-->';
    assert.equal(upsertBlock(legacy, notes, 'Edited'), `${legacy}\n\n${envelope(note('Edited'))}`);
});

test('upsertBlock repairs a cut-off envelope: complete blocks stay, the cut copy is replaced', () => {
    const cut = normalize(`Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Mood>\nsad\n</Mood>\n<Notes>\nThe guards are`).text;
    const updated = upsertBlock(cut, notes, 'Edited');
    assert.equal(updated, `Story.\n${envelope('<Mood>\nsad\n</Mood>', note('Edited'))}`);
    // Cut before the block began: the block is added to the repaired envelope.
    const early = normalize(`Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nThe guards are`).text;
    assert.equal(upsertBlock(early, mood, 'calm'), `Story.\n${envelope('<Notes>\nThe guards are', '<Mood>\ncalm\n</Mood>')}`);
    assert.equal(notesText(upsertBlock(early, mood, 'calm')), undefined, 'the cut copy stays cut');
});

test('upsertBlock keeps the body escaped and the envelope intact', () => {
    const updated = upsertBlock('Story.', notes, 'A --> B </Notes> <Blocks>');
    assert.equal(count(updated, /-->/g), 1);
    assert.equal(extractBlocks(updated, defs).length, 1);
    assert.equal(notesText(updated), 'A --> B </Notes> <Blocks>');
    // An already escaped body (what serialize returns) passes through unchanged.
    assert.match(upsertBlock('Story.', notes, 'A --\\> B'), /\nA --\\> B\n/);
});

test('upsertBlock on a reply cut inside the opener drops the fragment', () => {
    const cut = normalize('Story.\n<!-- STORY_BL').text;
    assert.equal(upsertBlock(cut, notes, 'New'), `Story.\n\n${envelope(note('New'))}`);
});
