// Beta-candidate break (a1, B-a1-1..3, 9..12, 14): change lines written in the story are taken narrowly,
// and one rule decides for the live capture and for Re-read. strayLines lists the change-line-shaped
// lines it leaves in the story in the hidden comment (<Changes-story>), so a Re-read leaves them too,
// whatever the live read knew that the text does not say (the reader stopped it, a Continue's distance,
// a tag that shared the line). An open block's unfinished last line is never applied; it is kept in the
// comment (<Changes-cut>) for the Continue that finishes it. The comment's "--" is kept reversibly.
// Pure: capture.js alone (the host tests are tests/v2/break/a1-*).
import test from 'node:test';
import assert from 'node:assert/strict';
import { continuation, extractBlock, grammarHeads, hideBlock, markOff, parseChanges, strayLines, stripBlock } from '../../src/v2/capture.js';
import { prng } from './qa/helpers/seeded.js';

const HEADS = grammarHeads([
    { kind: 'coin', grammar: '+ coin 30 | from: who (- coin 5 | to: who when paid)' },
    { kind: 'item', grammar: '+ item Name | qty: 1, - item Name, ~ item Name | note: text' },
    { kind: 'present', grammar: '+ present Name when someone arrives, - present Name when they leave' },
]);
const HIDDEN = /<!--\s*STORY_SUITE_V2[\s\S]*?-->/g;
const shown = mes => String(mes).replace(HIDDEN, '');
const lines = body => (body === null ? [] : parseChanges(body).lines.map(line => line.raw));
const taken = mes => strayLines(mes, HEADS).taken.map(line => line.line);
const told = (mes, options) => strayLines(mes, HEADS, options).problems.map(item => item.line);

// The live capture of a reply (turn.js onMessageReceived): what it reads and the text it leaves.
function live(mes, { at = null, stopped = false } = {}) {
    const body = extractBlock(mes, 'Changes', at, { stopped, heads: HEADS });
    return { read: lines(body), text: hideBlock(mes, 'Changes', { ...(at ?? {}), stopped, heads: HEADS }) };
}
// Re-read of the saved text (turn.js reread).
const reread = mes => lines(extractBlock(mes, 'Changes', null, { heads: HEADS }));

test('dialogue, quotes and prose that start like a change line stay story; a clean line on its own is taken', () => {
    assert.deepEqual([taken('A.\n\n"+ coin 5," he said'), told('A.\n\n"+ coin 5," he said')], [[], []], 'a quoted line is a mention');
    for (const said of ['+ coin 5, she said, and not one more.', '+ coin 5, she said', '+ coin 5.', '+ item Rope — "the good one"', '+ coin 5. Then she left']) {
        const mes = `Fenna laughed.\n\n${said}`;
        assert.deepEqual(taken(mes), [], said);
        assert.deepEqual(told(mes), [said], `told: ${said}`);
    }
    // In a story paragraph, any op (not only "-") stays story, told.
    assert.deepEqual(taken('Fenna laughed.\n+ coin 5'), []);
    assert.deepEqual(told('Fenna laughed.\n+ coin 5'), ['+ coin 5']);
    // Inside a quotation left open above it (speech over several paragraphs).
    assert.deepEqual(taken('“Take this, all of it.\n\n+ coin 5\n\nAnd go.”'), []);
    assert.deepEqual(taken('“Take this.”\n\n+ coin 5'), ['+ coin 5'], 'a closed quotation above it is not one');
    // Its own paragraph, or a run of change lines: taken.
    assert.deepEqual(taken('The hall.\n\n+ coin 5\n- present Kael'), ['+ coin 5', '- present Kael']);
});

test('code, quotes and HTML blocks are something shown: their lines are never taken', () => {
    for (const wrapped of ['```\n+ coin 40\n```', '~~~\n+ coin 40\n~~~', '```\n+ coin 40', '    + coin 40', '\t+ coin 40', '> + coin 40',
        '<details>\n<summary>Ledger</summary>\n+ coin 40\n</details>', '<style>\n+ coin 40\n</style>', '<!-- a note\n+ coin 40\n-->', '<pre>\n+ coin 40\n</pre>']) {
        const mes = `The ledger:\n\n${wrapped}\n\n<Changes>\n~ place Weir\n</Changes>`;
        assert.deepEqual(taken(mes), [], wrapped);
        assert.ok(shown(hideBlock(mes, 'Changes', { heads: HEADS })).includes('+ coin 40'), `stays shown: ${wrapped}`);
    }
    // An indented line inside a story paragraph is not code, but it is part of the paragraph either way.
    assert.deepEqual(taken('Story.\n    + coin 40'), []);
});

test('near misses (dash and plus look-alikes, a plural kind, the block tag in the line) are told, never taken', () => {
    for (const near of ['– coin 5', '— coin 5', '− coin 5', '＋ coin 5', '+ coins 5', '- items Rope', '+ item Rope </Changes>']) {
        const mes = `The hall.\n\n${near}\n\n<Changes>\n~ place Weir\n</Changes>`;
        assert.deepEqual(taken(mes), [], near);
        assert.deepEqual(told(mes), [near], near);
    }
});

test('"--" in the hidden comment reads back exactly; a word joiner the model wrote too; an old "- -" comment as before', () => {
    const body = '+ item Rope -- frayed\n+ item Lantern | note: tied --- twice -->\n+ item Bell⁠-⁠- odd';
    const hidden = hideBlock(`Story.\n\n<Changes>\n${body}\n</Changes>`);
    assert.doesNotMatch(hidden.slice(hidden.indexOf('<!--') + 4, hidden.lastIndexOf('-->')), /--/, 'nothing ends the comment early');
    assert.equal(extractBlock(hidden), body);
    assert.equal(extractBlock(hideBlock(hidden)), body, 'hidden again: unchanged');
    // Written before this (the old escape): read as it always was.
    assert.equal(extractBlock('Story.\n\n<!-- STORY_SUITE_V2\n<Changes>\n+ item Rope - - frayed\n</Changes>\n-->'), '+ item Rope - - frayed');
});

test('a stopped reply and a Continue: Re-read leaves what the live read left (the comment lists it)', () => {
    const stopped = live('A purse.\n\n+ coin 12', { stopped: true });
    assert.deepEqual(stopped.read, []);
    assert.deepEqual(reread(stopped.text), [], 'the cut story line stays unread');
    assert.ok(shown(stopped.text).includes('+ coin 12'));
    const first = live('The hall.\n\n<Changes>\n~ place Weir\n</Changes>');
    const mes = `${first.text}\n\n+ coin 7\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\n<Changes>\n+ coin 1\n</Changes>`;
    const cont = live(mes, { at: continuation(first.text, mes) });
    assert.deepEqual(cont.read, ['+ coin 1']);
    assert.deepEqual(reread(cont.text), ['~ place Weir', '+ coin 1']);
    // A tag that opened a block at the end of a story line: the line is left, live and on Re-read.
    const tagged = live('The hall.\n\n+ item Rope <Changes>');
    assert.deepEqual([tagged.read, reread(tagged.text)], [[], []]);
    // The prompt history and the shown story lose the comment, also one that only lists left lines.
    assert.equal(stripBlock(stopped.text), 'A purse.\n\n+ coin 12');
});

test('an open block\'s unfinished last line is never applied; the Continue that finishes it reads it once, whole', () => {
    for (const stopped of [false, true]) {
        const first = live('You find things.\n\n<Changes>\n+ coin 5\n+ item Ro', { stopped });
        assert.deepEqual(first.read, ['+ coin 5']);
        const mes = `${first.text}pe | qty: 2\n+ coin 3\n</Changes>`;
        const at = continuation(first.text, mes);
        assert.equal(at.cut, '+ item Ro');
        const cont = live(mes, { at });
        assert.deepEqual(cont.read, ['+ item Rope | qty: 2', '+ coin 3']);
        assert.deepEqual(reread(cont.text), ['+ coin 5', '+ item Rope | qty: 2', '+ coin 3']);
    }
    // A Continue that starts on a new line ends the cut line as it was.
    const first = live('Story.\n\n<Changes>\n+ coin 5');
    const mes = `${first.text}\n+ coin 3\n</Changes>`;
    assert.deepEqual(live(mes, { at: continuation(first.text, mes) }).read, ['+ coin 5', '+ coin 3']);
});

test('markOff: display lines read while their feature was off are left out of what is shown, until marked anew', () => {
    const hidden = hideBlock('Story.\n\n<Changes>\n? choice Run\n+ coin 2\n</Changes>');
    const marked = markOff(hidden, ['choice']);
    assert.match(marked, /STORY_SUITE_V2 off:choice\n/);
    assert.deepEqual(lines(extractBlock(marked, 'Changes', null, { display: true })), ['+ coin 2']);
    assert.deepEqual(lines(extractBlock(marked)), ['? choice Run', '+ coin 2'], 'a capture and Re-read still read it');
    assert.equal(markOff(marked, []), hidden, 'marked anew with nothing off');
});

test('C-1: a story line the block also lists is one change: hidden, read once, live and on Re-read', () => {
    const mes = 'Fenna hands it over.\n\n**+ item Moonveil Trout | qty: 1**\n\n<Changes>\n+ item Moonveil  Trout | qty: 1\n+ coin 2\n</Changes>';
    const first = live(mes);
    assert.deepEqual(first.read, ['+ item Moonveil  Trout | qty: 1', '+ coin 2']);
    assert.doesNotMatch(shown(first.text), /Trout/, 'the echo is taken out of the story');
    assert.deepEqual(reread(first.text), first.read);
    // Two different lines stay two changes.
    assert.deepEqual(live('Story.\n\n+ item Rope | qty: 2\n\n<Changes>\n+ item Rope\n</Changes>').read, ['+ item Rope', '+ item Rope | qty: 2']);
});

test('C-3: a close tag inside a line is part of it; at the start of a line, or after a whole change line, it closes', () => {
    const mes = 'Fenna waits.\n\n<Changes>\n+ present Fenna | note: </Changes>\n+ item Torch\n</Changes>';
    assert.deepEqual(lines(extractBlock(mes)), ['+ present Fenna | note: </Changes>', '+ item Torch']);
    assert.equal(stripBlock(mes), 'Fenna waits.');
    assert.equal(stripBlock(hideBlock(mes)), 'Fenna waits.');
    assert.deepEqual(lines(extractBlock(hideBlock(mes))), lines(extractBlock(mes)));
    assert.equal(extractBlock('Story.\n<Changes>\n+ item Rope</Changes>\nThe end.'), '+ item Rope');
    assert.equal(extractBlock('Story.\n<Changes>\n+ coin 5\n</Changes> More.'), '+ coin 5');
    assert.equal(extractBlock('Story.\n<Changes>\n+ item Rope — tied —</Changes>\n+ coin 1\n</Changes>'), '+ item Rope — tied —</Changes>\n+ coin 1');
});

// Random replies: the live capture (with stops and Continues) and a Re-read of the saved text read the
// same lines, and a second Re-read changes nothing.
const STORY = ['The rain did not stop.', 'Fenna laughed at him.', '+ coin 5, she said, and not one more.', '"+ coin 3," he said.',
    '```\n+ coin 40\n```', '> + coin 9', '<details>\n+ coin 11\n</details>', '– coin 5', '+ coins 6', '+ item Rope </Changes>',
    '“Take it all.', 'And go.”', 'Kael nods.\n- present Kael', '+ item Cord -- frayed', 'One.', 'Two.', 'Three.'];
const STRAYS = ['+ coin 4', '- present Mira', '+ item Lamp | qty: 2', '+ present Ivo\n- coin 1'];
const BLOCK = ['+ coin 2', '+ item Rope -- frayed', '~ item Rope | note: tied -- twice', '- present Mira', '+ item Torch'];

// The text ends with a hidden comment for a block left open (a Continue goes on with it).
const endsOpen = text => { const at = text.lastIndexOf(`<!-- STORY_SUITE_V2`); return at >= 0 && text.startsWith('<!-- STORY_SUITE_V2 open', at) && text.endsWith('-->'); };

function randomReply(r, { open = false } = {}) {
    const parts = [];
    for (let n = r.int(1, 6); n > 0; n -= 1) parts.push(r.chance(0.25) ? r.pick(STRAYS) : r.pick(STORY));
    const block = Array.from({ length: r.int(0, 3) }, () => r.pick(BLOCK));
    if (open) return `${parts.join('\n\n')}\n\n<Changes>\n${[...block, r.pick(['+ item Ro', '+ coin 1'])].join('\n')}`;
    if (block.length) parts.push(`<Changes>\n${block.join('\n')}\n</Changes>`);
    if (r.chance(0.3)) parts.push(r.pick(STRAYS));
    return parts.join('\n\n');
}

test('random replies, stops and Continues: Re-read reads what the live capture read', () => {
    const r = prng(123);
    let echoed = 0;
    for (let n = 0; n < 1500; n += 1) {
        const open = r.chance(0.2);
        const stopped = r.chance(0.3);
        const first = live(randomReply(r, { open }), { stopped });
        let text = first.text;
        const read = [...first.read];
        const continued = r.chance(0.5);
        if (continued) {
            const added = open && r.chance(0.6) ? `${r.pick(['pe | qty: 2', '0', ''])}\n${r.pick(BLOCK)}\n</Changes>` : `\n\n${randomReply(r)}`;
            const mes = `${text}${added}`;
            const cont = live(mes, { at: continuation(text, mes), stopped: r.chance(0.3) });
            read.push(...cont.read);
            text = cont.text;
        }
        // FB-1: a Continue whose block lists a line the reply took from the story: that line is read once.
        const strays = continued ? [] : first.read.filter(line => STRAYS.some(stray => stray.split('\n').includes(line)) && !BLOCK.includes(line));
        if (strays.length && r.chance(0.5)) {
            const echo = r.pick(strays);
            const tail = endsOpen(text);
            const mes = `${text}${tail ? '\n' : '\n\n<Changes>\n'}${echo}\n${r.pick(BLOCK)}\n</Changes>`;
            const cont = live(mes, { at: continuation(text, mes) });
            echoed += 1;
            assert.equal(cont.read.filter(line => line === echo).length, 0, `case ${n}: the echo of ${echo} is not read again`);
            read.push(...cont.read);
            text = cont.text;
        }
        const again = reread(text);
        assert.deepEqual(again, read, `case ${n}:\n${text}`);
        assert.deepEqual(reread(hideBlock(text, 'Changes', { heads: HEADS })), read, `case ${n}: Re-read twice`);
    }
    assert.ok(echoed > 50, `cross-Continue echoes tried: ${echoed}`);
});
