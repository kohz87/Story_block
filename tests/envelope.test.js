// Extraction and current state: extractBlocks, latestBlockInText, latestBlockState,
// stateForGeneration. Text-format definitions keep these tests independent of the rows and
// fields formats, which are written by other packages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlock } from '../src/schema.js';
import { escapeBody } from '../src/formats/escape.js';
import {
    CUT_MARKER,
    ENVELOPE_MARKER,
    extractBlocks,
    latestBlockInText,
    latestBlockState,
    normalizeTransport,
    replacesLastReply,
    stateForGeneration,
} from '../src/envelope.js';

const notes = normalizeBlock({ id: 'notes', name: 'Notes', tag: 'Notes', kind: 'stateful', format: 'text' });
const mood = normalizeBlock({ id: 'mood', name: 'Mood', tag: 'Mood', kind: 'turn', format: 'text' });
// A text block that answers to Inventory Block's tag, to read legacy snapshots without the rows format.
const legacyText = normalizeBlock({ id: 'inventory', name: 'Inventory', tag: 'Inventory', kind: 'stateful', format: 'text' });
const defs = [notes, mood];

const envelope = (...blocks) => `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const note = text => `<Notes>\n${text}\n</Notes>`;
const assistant = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, is_system: false, mes });
const summary = entries => entries.map(entry => [entry.def.tag, entry.body, entry.truncated, entry.container]);

test('extractBlocks finds every tag in every container, in text order', () => {
    const text = [
        `One.\n${envelope(note('first'), '<Mood>\ncalm\n</Mood>')}`,
        `Two.\n<Blocks>\n<Mood>\ntense\n</Mood>\n</Blocks>`,
        'Three.\n<Notes>\nbare\n</Notes>',
        '<!-- INVENTORY_BLOCK_V05\n<Notes>\nlegacy comment\n</Notes>\n-->',
    ].join('\n');
    assert.deepEqual(summary(extractBlocks(text, defs)), [
        ['Notes', 'first', false, 'envelope'],
        ['Mood', 'calm', false, 'envelope'],
        ['Mood', 'tense', false, 'blocks'],
        ['Notes', 'bare', false, null],
        ['Notes', 'legacy comment', false, 'legacy'],
    ]);
});

test('extractBlocks: offsets cover the tags, bodies are raw and trimmed', () => {
    const text = `Story.\n${envelope('<Notes>\n  A --\\> B, <\\/Notes> stays escaped  \n</Notes>')}`;
    const [entry] = extractBlocks(text, defs);
    assert.equal(entry.body, 'A --\\> B, <\\/Notes> stays escaped');
    assert.ok(text.slice(entry.start, entry.end).startsWith('<Notes>'));
    assert.ok(text.slice(entry.start, entry.end).endsWith('</Notes>'));
});

test('extractBlocks: tag names match case-insensitively, attributes are ignored, look-alikes are not tags', () => {
    assert.deepEqual(summary(extractBlocks('<notes version="2">\nx\n</NOTES>', defs)), [['Notes', 'x', false, null]]);
    assert.deepEqual(extractBlocks('<Notes-extra>\nx\n</Notes>', defs), []);
    assert.deepEqual(extractBlocks('<NotesX>\nx\n</NotesX>', defs), []);
});

test('extractBlocks: escaped tags and arrows written by escapeBody are never real tags', () => {
    const body = escapeBody('Reads </Notes> and <Notes> and <Blocks> --> done', 'Notes');
    const text = envelope(`<Notes>\n${body}\n</Notes>`, '<Mood>\nok\n</Mood>');
    const entries = extractBlocks(text, defs);
    assert.deepEqual(entries.map(entry => entry.def.tag), ['Notes', 'Mood']);
    assert.equal(entries[0].body, body);
    assert.equal(latestBlockInText(text, notes).state.text, 'Reads </Notes> and <Notes> and <Blocks> --> done');
});

test('extractBlocks: a tag opened and never closed gives one truncated entry', () => {
    const entries = extractBlocks(`Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Mood>\ncalm\n</Mood>\n<Notes>\nThe guards are`, defs);
    assert.deepEqual(summary(entries), [['Mood', 'calm', false, 'envelope'], ['Notes', 'The guards are', true, 'envelope']]);
});

test('extractBlocks: a cut-off block never pairs with a later copy\'s closing tag', () => {
    const text = `Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nhalf\n-->\nMore story.\n${envelope(note('whole'))}`;
    assert.deepEqual(summary(extractBlocks(text, defs)), [['Notes', 'half', true, 'envelope'], ['Notes', 'whole', false, 'envelope']]);
    const bare = 'A\n<Notes>\nhalf\nB\n<Notes>\nwhole\n</Notes>';
    assert.deepEqual(summary(extractBlocks(bare, defs)), [['Notes', 'half\nB', true, null], ['Notes', 'whole', false, null]]);
});

test('extractBlocks: an unclosed tag forgotten before the next block ends where that block starts', () => {
    const entries = extractBlocks(envelope('<Notes>\nforgot to close', '<Mood>\ncalm\n</Mood>'), defs);
    assert.deepEqual(summary(entries), [['Notes', 'forgot to close', true, 'envelope'], ['Mood', 'calm', false, 'envelope']]);
});

test('extractBlocks: a known tag written inside another block\'s body belongs to that body', () => {
    const entries = extractBlocks(envelope('<Notes>\nShe wrote <Mood>x</Mood> on the wall.\n</Notes>'), defs);
    assert.deepEqual(summary(entries), [['Notes', 'She wrote <Mood>x</Mood> on the wall.', false, 'envelope']]);
});

test('extractBlocks: an unclosed bare tag in prose is not a block; one on its own line is truncated', () => {
    assert.deepEqual(extractBlocks('He said <Notes> twice.', defs), []);
    assert.deepEqual(extractBlocks('Keep an <notes> of it.\nThe end.', defs), []);
    assert.deepEqual(summary(extractBlocks('Story.\n<Notes>\nhalf a no', defs)), [['Notes', 'half a no', true, null]]);
});

test('extractBlocks: blocks inside a cut-off envelope are read with container "cut"', () => {
    const cut = normalizeTransport(`Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Mood>\ncalm\n</Mood>\n<Notes>\nhal`, defs).text;
    assert.match(cut, new RegExp(CUT_MARKER));
    assert.deepEqual(summary(extractBlocks(cut, defs)), [['Mood', 'calm', false, 'cut'], ['Notes', 'hal', true, 'cut']]);
});

test('extractBlocks: no defs, no text, or unknown tags give nothing', () => {
    assert.deepEqual(extractBlocks('<Notes>\nx\n</Notes>', []), []);
    assert.deepEqual(extractBlocks(undefined, defs), []);
    assert.deepEqual(extractBlocks(envelope('<Other>\nx\n</Other>'), defs), []);
    // A definition with an unusable tag is ignored rather than breaking the pattern.
    assert.deepEqual(extractBlocks('<Notes>\nx\n</Notes>', [{ tag: 'bad tag(' }, null, notes]).length, 1);
});

test('latestBlockInText: the newest valid copy wins; invalid or truncated copies never do', () => {
    const text = `a\n${envelope(note('first'))}\nb\n${envelope(note('second'))}\nc\n${envelope('<Notes>\n\n</Notes>')}\n<Notes>\ncut off`;
    const found = latestBlockInText(text, notes);
    assert.equal(found.state.text, 'second');
    assert.equal(found.body, 'second');
    assert.equal(text.slice(found.start, found.end), note('second'));
    assert.equal(latestBlockInText('no blocks here', notes), null);
    assert.equal(latestBlockInText(envelope(note('x')), null), null);
});

test('latestBlockInText: a cut that Continue finished is read as the whole block', () => {
    const received = normalizeTransport(`Story.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nThe guards are on al`, defs).text;
    assert.equal(latestBlockInText(received, notes), null, 'still cut off');
    const continued = `${received}ert.\n</Notes>\n</Blocks>\n-->`;
    assert.equal(latestBlockInText(continued, notes).state.text, 'The guards are on alert.');
});

test('latestBlockInText: Inventory Block snapshots are read as the block whose tag is Inventory', () => {
    const text = 'Hi.\n<!-- INVENTORY_BLOCK_V05\n<Inventory>\nCoin Pouch | 1 | 42 Gold\n</Inventory>\n-->';
    assert.equal(latestBlockInText(text, legacyText).state.text, 'Coin Pouch | 1 | 42 Gold');
    assert.equal(latestBlockInText(text, notes), null);
});

test('latestBlockState: newest valid copy in assistant messages only', () => {
    const chat = [
        assistant(`start\n${envelope(note('100'))}`),
        user(`I write my own ${note('user copy')}`),
        assistant('story only'),
        { is_user: false, is_system: true, mes: envelope(note('system copy')) },
        assistant(`later\n${envelope(note('90'))}`),
        assistant(`broken\n${envelope('<Notes>\n</Notes>')}`),
    ];
    const found = latestBlockState(chat, notes);
    assert.equal(found.state.text, '90');
    assert.equal(found.messageIndex, 4);
    assert.equal(found.message, chat[4]);
    assert.equal(latestBlockState(chat, notes, { beforeIndex: 4 }).state.text, '100');
    assert.equal(latestBlockState(chat, notes, { beforeIndex: 0 }), null);
    assert.equal(latestBlockState(chat, notes, { beforeIndex: 99 }).state.text, '90');
    assert.equal(latestBlockState(null, notes), null);
});

test('stateForGeneration: Regenerate/Swipe exclude the final message only when it is an assistant reply', () => {
    const chat = [assistant(envelope(note('100'))), user('buy'), assistant(envelope(note('90')))];
    assert.equal(stateForGeneration(chat, notes, 'normal').text, '90');
    assert.equal(stateForGeneration(chat, notes, 'regenerate').text, '100');
    assert.equal(stateForGeneration(chat, notes, 'swipe').text, '100');
    assert.equal(replacesLastReply(chat, 'swipe'), true);
    chat.push(user('reply failed, regenerate'));
    assert.equal(stateForGeneration(chat, notes, 'regenerate').text, '90');
    chat.push({ is_user: false, is_system: true, mes: 'note' });
    assert.equal(stateForGeneration(chat, notes, 'regenerate').text, '90');
    assert.equal(replacesLastReply(chat, 'regenerate'), false);
});

test('stateForGeneration: no valid copy gives the format\'s empty state', () => {
    assert.deepEqual(stateForGeneration([], notes), { text: '' });
    assert.deepEqual(stateForGeneration([assistant('<Notes>\ncut')], notes, 'normal'), { text: '' });
});

test('selected swipe text alone determines the current state', () => {
    const message = assistant(envelope(note('40')));
    message.swipes = [envelope(note('40')), envelope(note('75'))];
    message.swipe_id = 0;
    assert.equal(latestBlockState([message], notes).state.text, '40');
    message.swipe_id = 1;
    message.mes = message.swipes[1];
    assert.equal(latestBlockState([message], notes).state.text, '75');
});

test('destructive timeline churn always resolves to the newest surviving valid copy', () => {
    const chat = [];
    let seed = 0x12345678;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    for (let i = 1; i <= 120; i++) {
        chat.push(user(`u${i}`));
        if (i % 11 === 0) chat.push({ ...assistant(envelope('<Notes>\n</Notes>')), expected: null });
        if (i % 13 === 0) chat.push({ ...assistant(`cut\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Notes>\nhal`), expected: null });
        chat.push({ ...assistant(`story ${i}\n${envelope(note(`v${i}`))}`), expected: `v${i}` });
    }
    for (let step = 0; step < 100 && chat.length > 5; step++) {
        chat.splice(Math.floor(random() * chat.length), 1);
        const expected = [...chat].reverse().find(message => typeof message.expected === 'string');
        const found = latestBlockState(chat, notes);
        if (!expected) assert.equal(found, null);
        else assert.equal(found?.state.text, expected.expected, `step ${step}`);
    }
});
