// NPC Inner Chatter parser: speaker lines into a thread or a single thought.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HUE_COUNT, parseChatter, speakerHue } from '../src/chatter.js';

const THREAD = 'Astra: She keeps watching the ford like she expects someone.\nOld Brenn: Don\'t look at me, girl. I only pole the raft.';

test('chatter: two speakers make a thread, in order', () => {
    assert.deepEqual(parseChatter(THREAD), {
        mode: 'thread',
        lines: [
            { speaker: 'Astra', note: '', text: 'She keeps watching the ford like she expects someone.' },
            { speaker: 'Old Brenn', note: '', text: 'Don\'t look at me, girl. I only pole the raft.' },
        ],
    });
    assert.equal(parseChatter('Astra: one\r\n\r\nBrenn: two\r\nAstra: three').lines.length, 3);
});

test('chatter: one speaker is a thought, even over several turns', () => {
    assert.deepEqual(parseChatter('Astra: He lies badly.'), {
        mode: 'thought',
        lines: [{ speaker: 'Astra', note: '', text: 'He lies badly.' }],
    });
    const twice = parseChatter('Astra: He lies badly.\nASTRA: And I let him.');
    assert.equal(twice.mode, 'thought', 'speakers match case-insensitively');
    assert.deepEqual(twice.lines.map(line => line.speaker), ['Astra', 'Astra'], 'shown as first spelled');
});

test('chatter: a multi-line thought stays under one speaker', () => {
    const parsed = parseChatter('Astra (thinking): He lies badly.\nAnd he knows I know.\n\nStill, the coin is real.');
    assert.equal(parsed.mode, 'thought');
    assert.equal(parsed.lines.length, 1, 'no second, nameless speaker');
    assert.deepEqual(parsed.lines[0], { speaker: 'Astra', note: 'thinking', text: 'He lies badly.\nAnd he knows I know.\nStill, the coin is real.' });
    // A name alone on its line, the words below it.
    assert.deepEqual(parseChatter('Astra:\nToo quiet.').lines, [{ speaker: 'Astra', note: '', text: 'Too quiet.' }]);
});

test('chatter: markdown names, bullets and emoji are normalized', () => {
    const parsed = parseChatter('**Astra:** *glances at the ford* She is late.\n**Old Brenn**: Hush.\n- *Astra:* Fine.\n🗣 __Merrit__: Pay first.');
    assert.equal(parsed.mode, 'thread');
    assert.deepEqual(parsed.lines.map(line => line.speaker), ['Astra', 'Old Brenn', 'Astra', 'Merrit']);
    assert.equal(parsed.lines[0].text, '*glances at the ford* She is late.', 'actions are kept for the display');
    assert.equal(parsed.lines[1].text, 'Hush.');
    assert.equal(parsed.lines[2].text, 'Fine.');
});

test('chatter: stage notes after the name or at the start of the words', () => {
    const parsed = parseChatter('Old Brenn (whispering to Astra): Not here.\n**Astra (thinking):** Then where?\n**Merrit** *(muttering)*: Fools.\nAstra: (thinking) Too quiet.');
    assert.deepEqual(parsed.lines.map(({ speaker, note }) => [speaker, note]), [
        ['Old Brenn', 'whispering to Astra'],
        ['Astra', 'thinking'],
        ['Merrit', 'muttering'],
        ['Astra', 'thinking'],
    ]);
    assert.deepEqual(parsed.lines.map(line => line.text), ['Not here.', 'Then where?', 'Fools.', 'Too quiet.']);
});

test('chatter: quotes round a whole line come off, inner quotes stay', () => {
    const parsed = parseChatter('Astra: "She keeps watching."\n"Brenn": “Hush.”\nAstra: "Fine," she says, "go."');
    assert.deepEqual(parsed.lines.map(line => line.speaker), ['Astra', 'Brenn', 'Astra']);
    assert.deepEqual(parsed.lines.map(line => line.text), ['She keeps watching.', 'Hush.', '"Fine," she says, "go."']);
});

test('chatter: an exchange written as one paragraph is split at sentence ends', () => {
    const parsed = parseChatter('Astra: I saw it. Twice: once at dawn. Brenn: Don\'t tell him. **Astra:** Too late.');
    assert.deepEqual(parsed.lines.map(({ speaker, text }) => [speaker, text]), [
        ['Astra', 'I saw it. Twice: once at dawn.'],
        ['Brenn', 'Don\'t tell him.'],
        ['Astra', 'Too late.'],
    ]);
    // A known speaker picked up from a continuation line too.
    assert.deepEqual(parseChatter('Astra: hm\nBrenn: Well.\nShe sighs. Astra: Fine.').lines.map(line => line.text), ['hm', 'Well.\nShe sighs.', 'Fine.']);
});

test('chatter: prose is not chatter', () => {
    assert.equal(parseChatter('The wind howled. Nobody spoke.\nAstra: Hush.'), null, 'first line names nobody');
    assert.equal(parseChatter('She watched the river for a long time: nothing came.'), null, 'more than four words');
    assert.equal(parseChatter('Strange, she thought: no boats today.'), null);
    assert.equal(parseChatter('Then he said: run.'), null, 'a sentence opener, not a name');
    assert.equal(parseChatter('Night fell: cold and grey.'), null, 'a casual two-word head needs speech after it');
    assert.equal(parseChatter('"Go home: now," she said.'), null, 'a colon inside a quote');
    assert.equal(parseChatter('Note: the NPCs whisper here.'), null);
    assert.equal(parseChatter('See https://example.com'), null);
    assert.equal(parseChatter(''), null);
    assert.equal(parseChatter(null), null);
    // Continuation lines that only look like speakers stay with the speaker above.
    const kept = parseChatter('Astra: He left.\nBrenn told her twice: stay.\nThe raft creaked.');
    assert.equal(kept.mode, 'thought');
    assert.equal(kept.lines[0].text, 'He left.\nBrenn told her twice: stay.\nThe raft creaked.');
    // A casual description still reads when speech follows it.
    assert.equal(parseChatter('Old woman: Don\'t.\nAstra: Hush.').mode, 'thread');
});

test('chatter: unfilled placeholders and empty turns', () => {
    assert.equal(parseChatter('[Write what the NPCs say or think where {{user}} cannot hear]'), null);
    assert.equal(parseChatter('Astra: [her unspoken thought]'), null);
    assert.equal(parseChatter('[NPC Name]: [thought]'), null);
    assert.equal(parseChatter('Astra:\nBrenn:'), null, 'names with no words');
    // An echoed block title is skipped, an empty turn dropped.
    assert.deepEqual(parseChatter('NPC Inner Chatter:\nAstra: Hush.\nBrenn:\n---').lines, [{ speaker: 'Astra', note: '', text: 'Hush.' }]);
});

test('chatter: speakerHue is stable, normalized and in range', () => {
    assert.equal(speakerHue('Astra'), speakerHue('Astra'));
    assert.equal(speakerHue('Astra'), speakerHue('**ASTRA:**'));
    assert.equal(speakerHue(' Old  Brenn '), speakerHue('old brenn'));
    const names = ['Astra', 'Old Brenn', 'Merrit', 'Captain Ivo', 'Sera', 'Maelis', 'Kael', 'Tobin', 'Wren', 'Iska', 'Doran', 'Lysa'];
    const hues = names.map(speakerHue);
    assert.ok(hues.every(hue => Number.isInteger(hue) && hue >= 0 && hue < HUE_COUNT));
    assert.ok(new Set(hues).size >= 4, 'names spread over the palette');
    assert.equal(HUE_COUNT, 8);
});
