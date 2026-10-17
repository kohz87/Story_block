// Choices: the strict list parser and filling SillyTavern's message box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillInput, isSlashCommand, parseChoices, stripEmphasis } from '../src/choices.js';

// ---- parseChoices ----------------------------------------------------------------------

test('parse: numbered with "." and ")"', () => {
    assert.deepEqual(parseChoices('1. Ask Astra what she saw\n2. Take first watch\n3. Check the wagon\n4. Follow the light'), [
        'Ask Astra what she saw', 'Take first watch', 'Check the wagon', 'Follow the light',
    ]);
    assert.deepEqual(parseChoices('1) Run\n2) Hide'), ['Run', 'Hide']);
    assert.deepEqual(parseChoices('  1. Run  \r\n\r\n  2) Hide\r\n'), ['Run', 'Hide'], 'blank lines, CRLF, padding');
});

test('parse: bullets', () => {
    assert.deepEqual(parseChoices('- Run\n- Hide'), ['Run', 'Hide']);
    assert.deepEqual(parseChoices('* Run\n* Hide\n* Fight'), ['Run', 'Hide', 'Fight']);
    assert.deepEqual(parseChoices('• Run\n• Hide'), ['Run', 'Hide']);
});

test('parse: markdown emphasis is stripped', () => {
    assert.deepEqual(parseChoices('1. **Confront him** — say it to his face\n2. *Slip away* quietly'), [
        'Confront him — say it to his face', 'Slip away quietly',
    ]);
    assert.deepEqual(parseChoices('**1.** Go north\n**2.** Go south'), ['Go north', 'Go south'], 'bold markers');
    assert.deepEqual(parseChoices('**1. Go north**\n**2. Go south**'), ['Go north', 'Go south'], 'whole line bold');
    assert.deepEqual(parseChoices('- ***Both*** at once\n- __under__ and _lean_ and ~~gone~~'), ['Both at once', 'under and lean and gone']);
    assert.deepEqual(parseChoices('- Read the snake_case_note\n- Count 2 * 3 * 4 coins'), ['Read the snake_case_note', 'Count 2 * 3 * 4 coins'], 'not emphasis');
    assert.equal(stripEmphasis('**a *b* c**'), 'a b c');
});

test('parse: unfilled [placeholder] options give null', () => {
    assert.equal(parseChoices('1. [Short suggestion]\n2. [Short suggestion]\n3. [Short suggestion]\n4. [Short suggestion]'), null);
    assert.equal(parseChoices('1. Run\n2. [Short suggestion]'), null, 'one left unfilled');
    assert.deepEqual(parseChoices('1. Read the [sealed] letter\n2. Burn it'), ['Read the [sealed] letter', 'Burn it'], 'brackets inside text are fine');
});

test('parse: prose and mixed bodies give null', () => {
    assert.equal(parseChoices('You could ask Astra, or take the first watch.'), null);
    assert.equal(parseChoices('What do you do?\n1. Run\n2. Hide'), null, 'intro line');
    assert.equal(parseChoices('1. Run\n2. Hide\nOr something else entirely.'), null, 'trailing line');
    assert.equal(parseChoices('1. Run\n- Hide'), null, 'mixed markers');
    assert.equal(parseChoices('1. Run\n3. Hide'), null, 'skipped number');
    assert.equal(parseChoices('2. Run\n3. Hide'), null, 'not from 1');
    assert.equal(parseChoices('1.5 gold\n2.5 silver'), null, 'decimals are not markers');
    assert.equal(parseChoices('*Run*\n*Hide*'), null, 'emphasis is not a bullet');
    assert.equal(parseChoices('1. **\n2. Hide'), null, 'empty option');
    assert.equal(parseChoices(`1. ${'word '.repeat(60)}\n2. Hide`), null, 'a paragraph, not a choice');
    assert.equal(parseChoices(''), null);
    assert.equal(parseChoices(null), null);
    assert.equal(parseChoices({ text: '1. a\n2. b' }), null);
});

test('parse: two to eight options', () => {
    const list = count => Array.from({ length: count }, (_, index) => `${index + 1}. Option ${index + 1}`).join('\n');
    assert.equal(parseChoices(list(1)), null);
    assert.equal(parseChoices(list(2)).length, 2);
    assert.equal(parseChoices(list(8)).length, 8);
    assert.equal(parseChoices(list(9)), null);
});

test('isSlashCommand', () => {
    assert.equal(isSlashCommand('/sys hi'), true);
    assert.equal(isSlashCommand('  /gen'), true);
    assert.equal(isSlashCommand('Open the door / window'), false);
});

// ---- fillInput -------------------------------------------------------------------------

class FakeEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.bubbles = Boolean(init.bubbles);
    }
}

function fakeDocument({ value = '', sendButton = true, textarea = true, touch = false } = {}) {
    const log = [];
    const doc = { activeElement: null, defaultView: { Event: FakeEvent, matchMedia: query => ({ matches: touch && /coarse|hover: none/.test(query) }) } };
    const box = {
        value,
        selectionStart: 0,
        selectionEnd: 0,
        dispatchEvent(event) { log.push(`event:${event.type}:${event.bubbles}`); return true; },
        focus() { doc.activeElement = box; log.push('focus'); },
        setSelectionRange(start, end) { box.selectionStart = start; box.selectionEnd = end; },
    };
    const send = { click() { log.push(`send:${box.value}`); } };
    const elements = { send_textarea: textarea ? box : null, send_but: sendButton ? send : null };
    doc.getElementById = id => elements[id] ?? null;
    return { doc, box, log };
}

test('fill: an empty box gets the choice, focused, caret at the end, input dispatched', () => {
    const { doc, box, log } = fakeDocument();
    assert.equal(fillInput('Take first watch', { document: doc }), 'filled');
    assert.equal(box.value, 'Take first watch');
    assert.equal(doc.activeElement, box);
    assert.equal(box.selectionStart, box.value.length);
    assert.equal(box.selectionEnd, box.value.length);
    assert.deepEqual(log, ['event:input:true', 'focus'], 'no send without send');
});

test('fill: appends to what is typed, never overwrites', () => {
    const { doc, box } = fakeDocument({ value: 'I sigh.' });
    fillInput('Take first watch', { document: doc });
    assert.equal(box.value, 'I sigh. Take first watch');

    const spaces = fakeDocument({ value: 'I sigh.   ' });
    fillInput('Run', { document: spaces.doc });
    assert.equal(spaces.box.value, 'I sigh. Run', 'one space, however many were there');

    const newline = fakeDocument({ value: 'First line\n' });
    fillInput('Run', { document: newline.doc });
    assert.equal(newline.box.value, 'First line\nRun', 'a trailing newline is kept as the separator');

    const blank = fakeDocument({ value: '  \n ' });
    fillInput('Run', { document: blank.doc });
    assert.equal(blank.box.value, 'Run', 'whitespace only counts as empty');
    assert.equal(blank.box.selectionStart, 3);
});

test('fill: send clicks #send_but after filling', () => {
    const { doc, box, log } = fakeDocument({ value: 'Quietly,' });
    assert.equal(fillInput('follow her out', { send: true, document: doc }), 'sent');
    assert.equal(box.value, 'Quietly, follow her out');
    assert.deepEqual(log, ['event:input:true', 'send:Quietly, follow her out'], 'sending never focuses the box');
});

test('fill: on a touch screen the box is filled but not focused, so no keyboard pops up', () => {
    const { doc, box, log } = fakeDocument({ value: 'I sigh.', touch: true });
    assert.equal(fillInput('Take first watch', { document: doc }), 'filled');
    assert.equal(box.value, 'I sigh. Take first watch');
    assert.equal(doc.activeElement, null);
    assert.deepEqual(log, ['event:input:true']);
});

test('fill: a slash command is filled, never sent', () => {
    const own = fakeDocument();
    assert.equal(fillInput('/sys The end', { send: true, document: own.doc }), 'filled');
    assert.equal(own.box.value, '/sys The end');
    assert.ok(!own.log.some(entry => entry.startsWith('send:')));

    const composed = fakeDocument({ value: '/gen' });
    assert.equal(fillInput('Run', { send: true, document: composed.doc }), 'filled', 'the composed message leads with a slash');
    assert.equal(composed.box.value, '/gen Run');
    assert.ok(!composed.log.some(entry => entry.startsWith('send:')));

    const appended = fakeDocument({ value: 'Then' });
    assert.equal(fillInput('/sys x', { send: true, document: appended.doc }), 'filled', 'the choice itself is a command');
});

test('fill: unavailable without #send_textarea; filled when #send_but is missing', () => {
    const missing = fakeDocument({ textarea: false });
    assert.equal(fillInput('Run', { document: missing.doc }), 'unavailable');
    assert.equal(fillInput('Run', { send: true, document: missing.doc }), 'unavailable');
    assert.equal(fillInput('Run', { document: null }), 'unavailable');

    const noSend = fakeDocument({ sendButton: false });
    assert.equal(fillInput('Run', { send: true, document: noSend.doc }), 'filled');
    assert.equal(noSend.box.value, 'Run');
});

test('fill: works with a querySelector-only document', () => {
    const { box } = fakeDocument();
    const doc = { querySelector: selector => (selector === '#send_textarea' ? box : null) };
    assert.equal(fillInput('Run', { document: doc }), 'filled');
    assert.equal(box.value, 'Run');
});
