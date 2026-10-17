// Choices display: numbered buttons wired to SillyTavern's message box, plain fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const choices = await import('../src/ui/displays/choices.js');
const { templateById } = await import('../src/templates.js');

const def = templateById('choices');
const FOUR = '1. Ask Astra what she saw at the gate\n2. **Take first watch** and let her sleep\n3. Check the wagon for the guild seal\n4. Follow the lantern light across the ford';

function show(options) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    choices.render(pane, { def, ...options });
    return pane;
}

// SillyTavern's message box and send button, fresh for each test.
function composer(value = '') {
    for (const node of doc.body.querySelectorAll('#send_textarea, #send_but')) node.remove();
    const box = doc.createElement('textarea');
    box.id = 'send_textarea';
    box.value = value;
    const events = [];
    box.dispatchEvent = event => { events.push(event.type); return true; };
    const send = doc.createElement('div');
    send.id = 'send_but';
    const sent = [];
    send.addEventListener('click', () => sent.push(box.value));
    doc.body.append(box, send);
    return { box, events, sent };
}

test('choices: numbered buttons with accessible names and the hint', () => {
    const pane = show({ state: { text: FOUR } });
    assert.ok(pane.classList.contains('story-block-display-choices'));
    assert.equal(pane.querySelector('.story-block-title').textContent, 'Choices');
    const list = pane.querySelector('.story-block-choices ol.story-block-choices-list');
    assert.equal(list.getAttribute('aria-label'), 'Choices');
    const buttons = pane.querySelectorAll('.story-block-choice-button');
    assert.equal(buttons.length, 4);
    for (const node of buttons) {
        assert.equal(node.tagName, 'BUTTON');
        assert.equal(node.type, 'button');
    }
    assert.deepEqual(texts(pane, '.story-block-choice-number'), ['1', '2', '3', '4']);
    assert.deepEqual(texts(pane, '.story-block-choice-text'), [
        'Ask Astra what she saw at the gate',
        'Take first watch and let her sleep',
        'Check the wagon for the guild seal',
        'Follow the lantern light across the ford',
    ]);
    // The name is the choice text: number and arrow are hidden from assistive tech.
    assert.equal(buttons[0].querySelector('.story-block-choice-number').getAttribute('aria-hidden'), 'true');
    assert.equal(buttons[0].querySelector('.story-block-choice-arrow').getAttribute('aria-hidden'), 'true');
    const hint = pane.querySelector('.story-block-choices-hint');
    assert.match(hint.querySelector('.story-block-choices-hint-pointer').textContent, /^Click fills the message box · Shift-click sends$/);
    assert.match(hint.querySelector('.story-block-choices-hint-touch').textContent, /Send/);
    assert.ok(hint.id);
    assert.ok(buttons.every(node => node.getAttribute('aria-describedby') === hint.id));
    const other = show({ state: { text: FOUR } }).querySelector('.story-block-choices-hint');
    assert.notEqual(other.id, hint.id, 'ids are unique per render');
});

test('choices: click appends to the message box and focuses it', () => {
    const { box, events, sent } = composer('I sigh.');
    const pane = show({ state: { text: FOUR } });
    const event = pane.querySelectorAll('.story-block-choice-button')[1].click();
    assert.equal(box.value, 'I sigh. Take first watch and let her sleep');
    assert.equal(doc.activeElement, box);
    assert.equal(box.selectionStart, box.value.length);
    assert.deepEqual(events, ['input']);
    assert.deepEqual(sent, []);
    assert.equal(event.stopped, true, 'the click does not reach SillyTavern\'s message handlers');
});

test('choices: shift-click and Shift+Enter send', () => {
    const { box, sent } = composer();
    const pane = show({ state: { text: FOUR } });
    const buttons = pane.querySelectorAll('.story-block-choice-button');
    buttons[0].dispatch('click', { shiftKey: true });
    assert.deepEqual(sent, ['Ask Astra what she saw at the gate']);

    box.value = '';
    const key = buttons[2].dispatch('keydown', { key: 'Enter', shiftKey: true });
    assert.equal(key.defaultPrevented, true, 'the synthetic click is cancelled');
    assert.deepEqual(sent, ['Ask Astra what she saw at the gate', 'Check the wagon for the guild seal']);

    box.value = '';
    buttons[2].dispatch('keydown', { key: 'Enter' });
    buttons[2].dispatch('keydown', { key: 'a', shiftKey: true });
    assert.equal(box.value, '', 'plain Enter is left to the button\'s own click');
    assert.equal(sent.length, 2);
});

test('choices: touch Send button per row', () => {
    const { box, sent } = composer('Carefully,');
    const pane = show({ state: { text: FOUR } });
    const sends = pane.querySelectorAll('.story-block-choice-send');
    assert.equal(sends.length, 4);
    assert.equal(sends[3].tagName, 'BUTTON');
    assert.equal(sends[3].type, 'button');
    assert.equal(sends[3].textContent, 'Send');
    assert.equal(sends[3].getAttribute('aria-label'), 'Send: Follow the lantern light across the ford');
    sends[3].click();
    assert.equal(box.value, 'Carefully, Follow the lantern light across the ford');
    assert.deepEqual(sent, ['Carefully, Follow the lantern light across the ford']);
});

test('choices: a slash-command choice fills but never sends, and has no Send button', () => {
    const { box, sent } = composer();
    const pane = show({ state: { text: '1. /roll 1d20\n2. Walk away' } });
    const rows = pane.querySelectorAll('.story-block-choice');
    assert.equal(rows[0].querySelector('.story-block-choice-send'), null);
    assert.ok(rows[1].querySelector('.story-block-choice-send'));
    const slash = rows[0].querySelector('.story-block-choice-button');
    assert.match(slash.title, /never sent/);
    slash.dispatch('click', { shiftKey: true });
    assert.equal(box.value, '/roll 1d20');
    assert.deepEqual(sent, []);
});

test('choices: no message box is harmless', () => {
    for (const node of doc.body.querySelectorAll('#send_textarea, #send_but')) node.remove();
    const pane = show({ state: { text: FOUR } });
    assert.doesNotThrow(() => pane.querySelector('.story-block-choice-button').click());
    assert.doesNotThrow(() => pane.querySelector('.story-block-choice-send').click());
});

test('choices: anything that is not a clean list falls back to plain text', () => {
    const prose = show({ state: { text: 'What now?\n1. Run\n2. Hide' } });
    assert.equal(prose.querySelector('.story-block-choice-button'), null);
    assert.equal(prose.querySelector('.story-block-plain-text').textContent, 'What now?1. Run2. Hide');
    assert.ok(prose.classList.contains('story-block-display-plain'));

    const template = show({ state: { text: def.layout } });
    assert.equal(template.querySelector('.story-block-choice-button'), null, 'unfilled placeholders');
    assert.match(template.querySelector('.story-block-plain-text').textContent, /\[Short suggestion\]/);

    const markup = show({ state: { text: '<img src=x onerror=alert(1)>' } });
    assert.equal(markup.querySelectorAll('img').length, 0);
    assert.equal(markup.querySelector('.story-block-plain-text').textContent, '<img src=x onerror=alert(1)>');
});

test('choices: markup in a choice stays text', () => {
    const pane = show({ state: { text: '1. <b>Shout</b>\n2. <img src=x>' } });
    assert.deepEqual(texts(pane, '.story-block-choice-text'), ['<b>Shout</b>', '<img src=x>']);
    assert.equal(pane.querySelectorAll('b').length + pane.querySelectorAll('img').length, 0);
});

test('choices: empty and missing states', () => {
    const missing = show({ state: null });
    assert.equal(missing.querySelector('.story-block-empty').textContent, 'No Choices in the latest reply.');
    assert.ok(missing.classList.contains('story-block-display-choices'));
    assert.equal(show({ state: { text: '  \n ' } }).querySelector('.story-block-empty').textContent, 'Choices is empty. It fills in as the story goes.');
});

test('choices: error, truncated and edit', () => {
    let edits = 0;
    const pane = show({ state: { text: FOUR }, error: 'The block is empty', onEdit: () => { edits += 1; } });
    assert.equal(pane.querySelector('.story-block-notice.is-error').textContent, 'This reply\'s Choices couldn\'t be read: The block is empty. Showing the last valid state.');
    assert.equal(pane.querySelectorAll('.story-block-choice-button').length, 4, 'the last valid list stays usable');
    const edit = pane.querySelector('.story-block-edit');
    assert.equal(edit.getAttribute('aria-label'), 'Edit Choices');
    edit.click();
    assert.equal(edits, 1);
    assert.equal(show({ state: { text: FOUR } }).querySelector('.story-block-edit'), null);

    // A cut-off list may end mid-option; it is shown as text, never as buttons to send.
    const cut = show({ state: { text: '1. Run\n2. Hide behind the wa' }, truncated: true, onEdit: () => {} });
    assert.equal(cut.querySelector('.story-block-choice-button'), null);
    assert.match(cut.querySelector('.story-block-notice.is-truncated').textContent, /may be incomplete/);
    assert.match(cut.querySelector('.story-block-plain-text').textContent, /Hide behind the wa/);
    assert.ok(cut.querySelector('.story-block-edit'));
});

test('choices: re-render replaces the previous content', () => {
    const pane = show({ state: { text: FOUR } });
    choices.render(pane, { def, state: { text: '1. Run\n2. Hide' } });
    assert.equal(pane.querySelectorAll('.story-block-choice-button').length, 2);
    assert.equal(pane.querySelectorAll('.story-block-head').length, 1);
});
