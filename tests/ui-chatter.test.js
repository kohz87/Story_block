// Chatter display: whisper thread, pull quote, plain fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const chatter = await import('../src/ui/displays/chatter.js');
const { speakerHue } = await import('../src/chatter.js');

// Not the template (the lead owns it): only what a display reads from a definition.
const def = { id: 'npc-inner-chatter', name: 'Inner Chatter', tag: 'NPC_Inner_Chatter', kind: 'turn', format: 'text', display: 'chatter' };
const THREAD = '**Astra:** She keeps watching the ford.\nAstra: Like she expects someone.\nOld Brenn (whispering to Astra): *spits* Don\'t look at me, girl.\nAstra: **Fine.**';

function show(options, pane = null) {
    const target = pane ?? doc.createElement('div');
    if (!pane) doc.body.appendChild(target);
    chatter.render(target, { def, ...options });
    return target;
}

test('chatter display: a thread of bubbles, one name per run, hue classes', () => {
    const pane = show({ state: { text: THREAD } });
    assert.ok(pane.classList.contains('story-block-display-chatter'));
    assert.equal(pane.querySelector('.story-block-title').textContent, 'Inner Chatter');
    assert.equal(pane.querySelector('.story-block-summary').textContent, '2 speakers');
    const body = pane.querySelector('.story-block-chatter');
    assert.ok(body.classList.contains('is-thread'));
    const thread = body.querySelector('ol.story-block-chatter-thread');
    assert.equal(thread.getAttribute('aria-label'), 'Inner Chatter');

    const runs = thread.querySelectorAll('li.story-block-chatter-run');
    assert.equal(runs.length, 3, 'consecutive Astra lines share a bubble');
    assert.deepEqual(texts(pane, '.story-block-chatter-name'), ['Astra', 'Old Brenn', 'Astra']);
    assert.equal(runs[0].querySelectorAll('.story-block-chatter-line').length, 2);
    assert.ok(runs[0].classList.contains(`is-hue-${speakerHue('Astra')}`));
    assert.ok(runs[1].classList.contains(`is-hue-${speakerHue('Old Brenn')}`));
    assert.ok(runs[2].classList.contains(`is-hue-${speakerHue('Astra')}`), 'same speaker, same colour');

    const avatar = runs[1].querySelector('.story-block-chatter-avatar');
    assert.equal(avatar.textContent, 'O');
    assert.equal(avatar.getAttribute('aria-hidden'), 'true');
    assert.equal(runs[1].querySelector('.story-block-chatter-note').textContent, 'whispering to Astra');
    assert.equal(runs[1].querySelector('.story-block-chatter-text').textContent, 'spits Don\'t look at me, girl.');
    assert.equal(pane.querySelector('.story-block-chatter-aside').textContent, 'Not heard by you');
});

test('chatter display: inline markup is built from elements', () => {
    const pane = show({ state: { text: THREAD } });
    const runs = pane.querySelectorAll('.story-block-chatter-run');
    assert.equal(runs[1].querySelector('em').textContent, 'spits');
    assert.equal(runs[2].querySelector('strong').textContent, 'Fine.');
    // Model text is never parsed as HTML.
    const hostile = show({ state: { text: 'Astra: <img src=x onerror=alert(1)>\nBrenn: &amp; <b>hi</b>' } });
    assert.deepEqual(texts(hostile, '.story-block-chatter-text'), ['<img src=x onerror=alert(1)>', '&amp; <b>hi</b>']);
    assert.equal(hostile.querySelector('img'), null);
    assert.equal(hostile.querySelector('b'), null);
});

test('chatter display: one speaker is a pull quote with the name', () => {
    const pane = show({ state: { text: 'Astra (thinking): He lies badly.\nAnd *he* knows I know.\nAstra: Still, the coin is real.' } });
    assert.equal(pane.querySelector('.story-block-summary').textContent, '1 speaker');
    const body = pane.querySelector('.story-block-chatter');
    assert.ok(body.classList.contains('is-thought'));
    assert.equal(body.querySelector('.story-block-chatter-thread'), null);
    assert.equal(body.querySelector('.story-block-chatter-aside'), null);
    const figure = body.querySelector('figure.story-block-chatter-thought');
    assert.ok(figure.classList.contains(`is-hue-${speakerHue('Astra')}`));
    const paragraphs = figure.querySelectorAll('blockquote.story-block-chatter-quote > p.story-block-chatter-line');
    assert.equal(paragraphs.length, 2);
    assert.equal(paragraphs[0].querySelector('.story-block-chatter-note').textContent, 'thinking');
    // The continuation line stays in the same paragraph, after a line break.
    const first = paragraphs[0].querySelector('.story-block-chatter-text');
    assert.equal(first.querySelectorAll('br').length, 1);
    assert.equal(first.textContent, 'He lies badly.And he knows I know.');
    assert.equal(first.querySelector('em').textContent, 'he');
    assert.equal(figure.querySelector('figcaption.story-block-chatter-who').textContent, 'Astra');
});

test('chatter display: text that is not chatter falls back to plain', () => {
    const pane = show({ state: { text: 'The wind howled. Nobody spoke.\n**Astra** watched the ford.' } });
    assert.ok(pane.classList.contains('story-block-display-plain'));
    assert.ok(!pane.classList.contains('story-block-display-chatter'));
    assert.equal(pane.querySelector('.story-block-chatter'), null);
    assert.equal(pane.querySelector('.story-block-plain-text strong').textContent, 'Astra');

    // Re-rendering the same pane as chatter swaps the display class back.
    show({ state: { text: THREAD } }, pane);
    assert.ok(pane.classList.contains('story-block-display-chatter'));
    assert.ok(!pane.classList.contains('story-block-display-plain'));
    assert.ok(pane.querySelector('.story-block-chatter'));

    const placeholder = show({ state: { text: '[What the NPCs say where {{user}} cannot hear]' } });
    assert.ok(placeholder.classList.contains('story-block-display-plain'));
    const rows = show({ state: { categories: [{ name: 'Pack', items: [{ name: 'Rope', quantity: '1', remark: '' }] }] } });
    assert.ok(rows.classList.contains('story-block-display-plain'), 'a non-text state reads as plain');
});

test('chatter display: empty states', () => {
    assert.equal(show({ state: null }).querySelector('.story-block-empty').textContent, 'No Inner Chatter in the latest reply.');
    const pane = show({ state: { text: '  ' } });
    assert.ok(pane.classList.contains('story-block-display-chatter'));
    assert.equal(pane.querySelector('.story-block-empty').textContent, 'Inner Chatter is empty. It fills in as the story goes.');
    assert.equal(pane.querySelector('.story-block-summary'), null);
});

test('chatter display: error, truncated and edit', () => {
    let edits = 0;
    const pane = show({ state: { text: THREAD }, error: 'Unclosed tag.', truncated: true, onEdit: () => { edits += 1; } });
    const notices = pane.querySelectorAll('.story-block-notice');
    assert.equal(notices.length, 2);
    assert.match(notices[0].textContent, /couldn't be read: Unclosed tag\./);
    assert.ok(notices[1].classList.contains('is-truncated'));
    // A cut-off turn block still shows what arrived.
    assert.equal(pane.querySelectorAll('.story-block-chatter-run').length, 3);
    const edit = pane.querySelector('.story-block-edit');
    assert.equal(edit.getAttribute('aria-label'), 'Edit Inner Chatter');
    const event = edit.click();
    assert.equal(edits, 1);
    assert.equal(event.stopped, true);

    const cut = show({ state: { text: 'Astra: She keeps' }, truncated: true });
    assert.match(cut.querySelector('.story-block-notice.is-truncated').textContent, /may be incomplete/);
    assert.equal(cut.querySelector('.story-block-chatter-text').textContent, 'She keeps');

    const fallback = show({ state: { text: 'Plain prose.' }, error: 'Bad.', onEdit: () => {} });
    assert.equal(fallback.querySelectorAll('.story-block-notice.is-error').length, 1, 'the fallback keeps the notices');
    assert.ok(fallback.querySelector('.story-block-edit'));
    assert.equal(show({ state: { text: THREAD } }).querySelector('.story-block-edit'), null, 'no Edit without onEdit');
});
