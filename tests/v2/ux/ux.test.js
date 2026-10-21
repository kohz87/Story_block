// Story Block's UX pieces (MODULES §F40, §F41, §F53, §F54, §F57) on the real runtime (the testkit host)
// and the fake DOM: the note under a reply that came without change lines and its Re-read, the edited
// note, the refused lines in the changes card, Alt+G for the game view, the status strip's switch, and
// the reduced-motion rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';
import { makeMessage } from '../../ui-fake-dom.js';
import { setupDom } from '../view/mounts/helpers.js';
import { hudOn, isGameViewKey, mountUi } from '../../../src/v2/ui-host.js';
import { problemReason, refusedFrom } from '../../../src/v2/reply-notes.js';
import { CHANGES_CARD_SCREEN_ID } from '../../../src/v2/screens/index.js';
import { STRINGS } from '../../../src/v2/strings.js';

const WITH_LINES = 'You find a rope.\n<Changes>\n+ item Rope | qty: 1\n- item Lantern | qty: 1\n</Changes>';
const HUD_MODULE = {
    id: 'hud-test', name: 'HUD test', version: '0.0.1',
    screens: [{ id: 'hud-test/strip', title: 'Strip', mounts: ['hud'], template: '<b class="where">{{ state.scene.place.name }}</b>' }],
};

/** A host, a page with a message box, and the UI; `reread` (optional) becomes sdk.reread; false: none at all. */
async function page({ reread = null, modules = [], settings = null } = {}) {
    const doc = setupDom();
    const form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const drawerHost = doc.createElement('div');
    drawerHost.id = 'extensions_settings';
    doc.body.appendChild(drawerHost);
    const host = await createHost({ modules, ...(settings ? { settings } : {}) });
    const calls = [];
    const sdk = reread === false ? { ...host.sdk, reread: undefined }
        : reread ? { ...host.sdk, reread: async index => { calls.push(index); return reread(index, host); } } : host.sdk;
    const turn = reread === false ? { ...host.turn, reread: undefined } : host.turn;
    const runtime = { registry: host.registry, store: host.store, sdk, settings: host.settings, events: host.events, turn };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    /** SillyTavern drawing every message of the chat. */
    const draw = () => {
        for (const old of doc.querySelectorAll('.mes')) old.remove();
        host.ctx.chat.forEach((message, index) => makeMessage(doc, index));
        ui.notes.refreshAll();
    };
    const noteAt = index => doc.querySelector(`.mes[mesid="${index}"] .story-suite-reply-note`);
    return { doc, host, ui, draw, noteAt, calls };
}

// ---------------------------------------------------------------------------------------------------
// §F40: a reply without change lines

test('a reply without change lines gets the warning; the greeting, the reader and a reply with lines do not', async () => {
    const { host, draw, noteAt } = await page({ reread: false });
    await host.send('hi', WITH_LINES);
    await host.send('and now?', 'Nothing much happens.');
    draw();
    assert.equal(noteAt(0), null, 'the greeting');
    assert.equal(noteAt(1), null, 'the reader');
    assert.equal(noteAt(2), null, 'a reply with its block');
    const note = noteAt(4);
    assert.ok(note);
    assert.equal(note.getAttribute('data-kind'), 'missing');
    assert.equal(note.getAttribute('role'), 'note');
    assert.equal(note.querySelector('.story-suite-reply-note-text').textContent, STRINGS.notes.missing);
    assert.equal(note.querySelector('.story-suite-reply-note-reread'), null, 'no Re-read without the runtime\'s');
    // Under the reply's text.
    const text = note.parentNode.querySelector('.mes_text');
    assert.equal(text.nextElementSibling, note);
});

test('with the after-reply extractor on, no warning', async () => {
    const { host, draw, noteAt } = await page({ settings: { modules: { 'story-block': { assistExtractor: true } } } });
    await host.send('and now?', 'Nothing much happens.');
    draw();
    assert.equal(host.sdk.settings('story-block').assistExtractor, true);
    assert.equal(noteAt(2), null);
});

test('a reply from before v2 (no record) gets no warning', async () => {
    const { host, draw, noteAt } = await page();
    await host.send('and now?', 'Nothing much happens.');
    delete host.ctx.chat[2].extra.storySuite;
    draw();
    assert.equal(noteAt(2), null);
});

test('Re-read: the button runs sdk.reread(index), shows it is busy, and the note goes once the reply has lines', async () => {
    let release;
    const { host, draw, noteAt, calls } = await page({
        reread: (index, h) => new Promise(resolve => { release = () => { h.ctx.chat[index].mes = WITH_LINES; resolve({ ok: true, problems: [] }); }; }),
    });
    await host.send('and now?', 'Nothing much happens.');
    draw();
    const button = noteAt(2).querySelector('.story-suite-reply-note-reread');
    assert.equal(button.textContent, STRINGS.notes.reread);
    assert.equal(button.getAttribute('title'), STRINGS.notes.rereadTitle);
    button.click();
    assert.deepEqual(calls, [2]);
    assert.equal(button.textContent, STRINGS.notes.rereading);
    assert.equal(button.disabled, true);
    button.click();
    assert.deepEqual(calls, [2], 'one Re-read at a time');
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(noteAt(2), null);
});

test('Re-read that fails says why and keeps the note', async () => {
    const { host, draw, noteAt } = await page({ reread: () => ({ ok: false, code: 'FAILED', message: 'The reply is gone.' }) });
    await host.send('and now?', 'Nothing much happens.');
    draw();
    noteAt(2).querySelector('.story-suite-reply-note-reread').click();
    await new Promise(resolve => setImmediate(resolve));
    const error = noteAt(2).querySelector('.story-suite-reply-note-error');
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, 'Re-read did not work: The reply is gone.');
    assert.equal(error.getAttribute('role'), 'alert');
});

test('an edited reply gets the edited note with Re-read (only when Re-read exists); Re-read clears it', async () => {
    const plain = await page({ reread: false });
    await plain.host.send('hi', WITH_LINES);
    plain.draw();
    await plain.host.st.editMessage(2, `${WITH_LINES}\nedited`);
    assert.equal(plain.noteAt(2), null);

    const { host, draw, noteAt, calls } = await page({ reread: () => ({ ok: true }) });
    await host.send('hi', WITH_LINES);
    draw();
    await host.st.editMessage(2, `${host.ctx.chat[2].mes}\nAnd a knife.`);
    const note = noteAt(2);
    assert.equal(note.getAttribute('data-kind'), 'edited');
    assert.equal(note.querySelector('.story-suite-reply-note-text').textContent, STRINGS.notes.edited);
    note.querySelector('.story-suite-reply-note-reread').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [2]);
    assert.equal(noteAt(2), null);
});

test('a delete or a new chat forgets what was kept by index', async () => {
    const { host, ui, draw, noteAt } = await page({ reread: () => ({ ok: true }) });
    await host.send('hi', WITH_LINES);
    draw();
    await host.st.editMessage(2, `${host.ctx.chat[2].mes}\nmore`);
    assert.equal(noteAt(2).getAttribute('data-kind'), 'edited');
    assert.equal(ui.notes.refusedAt(2).length, 1);
    await host.st.deleteMessage(3);
    assert.equal(ui.notes.refusedAt(2).length, 0);
    assert.equal(noteAt(2), null);
});

// ---------------------------------------------------------------------------------------------------
// §F41: refused lines

test('refusedFrom and problemReason read the turn\'s problems for one reply', () => {
    const problems = [
        { index: 2, line: '- item Lantern | qty: 1', code: 'NOT_FOUND', message: '"- item Lantern | qty: 1" was not used: There is no Lantern in the inventory.' },
        { index: 2, line: '+ spell Fire', code: 'UNKNOWN_KIND', message: 'No module keeps "spell", so "+ spell Fire" was not used.' },
        { index: 2, code: 'UNREADABLE', message: 'Line 3 is not a change line: "hello".' },
        { index: 4, line: '+ item Rope', code: 'FAILED', message: '"+ item Rope" was not used: no.' },
        { index: 2, code: 'FAILED', message: 'beforeGenerate failed' },
    ];
    assert.deepEqual(refusedFrom(problems, 2), [
        { line: '- item Lantern | qty: 1', reason: 'There is no Lantern in the inventory.' },
        { line: '+ spell Fire', reason: 'no module keeps "spell"' },
        { line: 'Line 3 is not a change line: "hello".', reason: '' },
    ]);
    assert.deepEqual(refusedFrom(null, 2), []);
    assert.equal(problemReason({ line: 'x', message: 'odd text' }), 'odd text');
});

test('the changes card lists the lines the code refused, faintly, and its summary counts them', async () => {
    const { doc, host, ui, draw } = await page();
    await host.send('hi', WITH_LINES);
    draw();
    assert.deepEqual(ui.notes.refusedAt(2), [{ line: '- item Lantern | qty: 1', reason: 'There is no Lantern in the inventory.' }]);
    ui.mounts.card.refresh(2, { force: true });
    const card = doc.querySelector(`.mes[mesid="2"] [data-ss-card="${CHANGES_CARD_SCREEN_ID}"]`);
    assert.ok(card, 'the card is under the reply');
    assert.equal(card.querySelector('.ss-card-summary').textContent, '+1 Rope · 1 line not applied');
    ui.mounts.card.toggle(2, CHANGES_CARD_SCREEN_ID, true);
    const refused = card.querySelector('.refused');
    assert.ok(refused, 'the refused list is drawn');
    const text = refused.textContent.replace(/\s+/g, ' ').trim();
    assert.equal(text, 'not applied: - item Lantern | qty: 1 — There is no Lantern in the inventory.');
    // The greeting's card has none.
    ui.mounts.card.refresh(0, { force: true });
    ui.mounts.card.toggle(0, CHANGES_CARD_SCREEN_ID, true);
    assert.equal(doc.querySelector('.mes[mesid="0"] .refused'), null);
});

test('refused lines belong to the swipe that wrote them', async () => {
    const { host, ui } = await page();
    await host.send('hi', WITH_LINES);
    assert.equal(ui.notes.refusedAt(2).length, 1);
    await host.swipe('A cleaner reply.\n<Changes>\n+ item Rope | qty: 1\n</Changes>');
    assert.equal(host.ctx.chat[2].swipe_id, 1);
    assert.equal(ui.notes.refusedAt(2).length, 0);
    await host.st.swipeTo(2, 0);
    assert.equal(ui.notes.refusedAt(2).length, 1);
});

// ---------------------------------------------------------------------------------------------------
// §F53: Alt+G

test('isGameViewKey: Alt+G only', () => {
    assert.equal(isGameViewKey({ altKey: true, code: 'KeyG', key: '©' }), true);
    assert.equal(isGameViewKey({ altKey: true, key: 'G' }), true);
    assert.equal(isGameViewKey({ altKey: true, ctrlKey: true, code: 'KeyG' }), false);
    assert.equal(isGameViewKey({ altKey: true, shiftKey: true, code: 'KeyG' }), false);
    assert.equal(isGameViewKey({ key: 'g' }), false);
    assert.equal(isGameViewKey({ altKey: true, code: 'KeyH', key: 'h' }), false);
});

test('Alt+G opens and closes the game view; the bar button stays and names the key', async () => {
    const { doc, ui } = await page();
    const press = init => {
        const event = { type: 'keydown', altKey: true, code: 'KeyG', key: 'g', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...init };
        for (const entry of [...doc.listeners]) if (entry.type === 'keydown') entry.fn(event);
        return event;
    };
    const button = doc.querySelector('.story-suite-bar-game');
    assert.equal(button.hidden, false);
    assert.equal(button.title, 'Open the game view (Alt+G)');
    assert.equal(button.getAttribute('aria-keyshortcuts'), 'Alt+G');
    const first = press();
    assert.equal(first.defaultPrevented, true);
    assert.equal(ui.mounts.screen.isOpen(), true);
    assert.equal(ui.mounts.screen.current(), 'story-block/home');
    press({ repeat: true });
    assert.equal(ui.mounts.screen.isOpen(), true, 'a held key does not flicker it');
    press();
    assert.equal(ui.mounts.screen.isOpen(), false);
    assert.equal(press({ ctrlKey: true }).defaultPrevented, false);
    assert.equal(ui.mounts.screen.isOpen(), false);
    button.click();
    assert.equal(ui.mounts.screen.isOpen(), true);
    ui.mounts.screen.close();
    const before = doc.listeners.filter(entry => entry.type === 'keydown').length;
    ui.destroy();
    assert.equal(doc.listeners.filter(entry => entry.type === 'keydown').length, before - 1, 'Alt+G is unhooked');
    press();
    assert.equal(ui.mounts.screen.isOpen(), false);
});

// ---------------------------------------------------------------------------------------------------
// §F54: the status strip

test('the status strip is on by default; the drawer switch turns it off and keeps the choice', async () => {
    const { doc, host, ui } = await page({ modules: [HUD_MODULE] });
    assert.equal(hudOn({}), true);
    assert.equal(hudOn({ storySuite: { hud: false } }), false);
    assert.equal(ui.hudOn(), true);
    const strip = doc.querySelector('.ss-hud');
    assert.ok(strip, 'drawn above the message box');
    assert.equal(strip.nextElementSibling, doc.querySelector('#send_form'));
    const check = doc.querySelector('.story-suite-hud-toggle input');
    assert.equal(check.checked, true);
    assert.equal(doc.querySelector('.story-suite-hud-toggle span').textContent, STRINGS.drawer.hud);
    check.checked = false;
    check.dispatch('change');
    assert.equal(doc.querySelector('.ss-hud'), null);
    assert.equal(host.ctx.extensionSettings.storySuite.hud, false);
    assert.ok(host.st.settingsSaves > 0);
    ui.refresh();
    assert.equal(doc.querySelector('.ss-hud'), null, 'stays off');
    ui.setHud(true);
    assert.ok(doc.querySelector('.ss-hud'));
    assert.equal(check.checked, true);
});

// ---------------------------------------------------------------------------------------------------
// §F56, §F57

test('the bar and drawer texts come from strings.js', async () => {
    const { doc } = await page();
    assert.equal(doc.querySelector('.story-suite-bar-story .story-suite-label').textContent, STRINGS.bar.story);
    assert.equal(doc.querySelector('.story-suite-bar-game .story-suite-label').textContent, STRINGS.bar.game);
    assert.equal(doc.querySelector('.story-suite-bar-settings .story-suite-label').textContent, STRINGS.bar.suite);
    assert.match(doc.querySelector('.story-suite-drawer .story-suite-muted').textContent, /^Story Block 2\.0\.0-test \(v2\) · /);
});

test('host.css: subtle transitions, and none under prefers-reduced-motion', () => {
    const css = readFileSync(new URL('../../../src/v2/view/host.css', import.meta.url), 'utf8');
    assert.match(css, /@keyframes story-suite-fade-in/);
    assert.match(css, /\.ss-l-meter-fill \{ transition: width/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.ok(reduced.length > 30, 'a reduced-motion block');
    for (const selector of ['.ss-card', '.ss-hud', '.ss-gameview', '[data-ss-screen] *', '.story-suite-reply-note']) assert.ok(reduced.includes(selector), selector);
    assert.match(reduced, /transition: none !important;/);
    assert.match(reduced, /animation: none !important;/);
});
