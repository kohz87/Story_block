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
import { THIS_REPLY_ID } from '../../../src/v2/reply-cards.js';
import { STRINGS } from '../../../src/v2/strings.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';

const WITH_LINES = 'You find a rope.\n<Changes>\n+ item Rope | qty: 1\n- item Lantern | qty: 1\n</Changes>';
const HUD_MODULE = {
    id: 'hud-test', name: 'HUD test', version: '0.0.1',
    screens: [{ id: 'hud-test/strip', title: 'Strip', mounts: ['hud'], template: '<b class="where">{{ state.scene.place.name }}</b>' }],
};

/** A host, a page with a message box, and the UI; `reread` (optional) becomes sdk.reread; false: none at all. */
async function page({ reread = null, modules = [], settings = null, callModel = null } = {}) {
    const doc = setupDom();
    const form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const drawerHost = doc.createElement('div');
    drawerHost.id = 'extensions_settings';
    doc.body.appendChild(drawerHost);
    const host = await createHost({ modules, ...(settings ? { settings } : {}), ...(callModel ? { callModel } : {}) });
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

// The extractor's call answers (here: nothing to add). One that fails leaves the note (C2-ext,
// break/c2-extractor-failed-no-note); with no model to call, this test's extractor failed before.
test('with the after-reply extractor on, no warning', async () => {
    const { host, draw, noteAt } = await page({ settings: { modules: { 'story-block': { assistExtractor: true } } }, callModel: async () => 'none' });
    await host.send('and now?', 'Nothing much happens.');
    await new Promise(resolve => setTimeout(resolve, 10));
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
    const card = doc.querySelector(`.mes[mesid="2"] [data-ss-card="${THIS_REPLY_ID}"]`);
    assert.ok(card, 'the card is under the reply');
    assert.equal(card.querySelector('.ss-card-summary').textContent, '+1 Rope · 1 line not applied');
    ui.mounts.card.toggle(2, true);
    const refused = card.querySelector('.refused');
    assert.ok(refused, 'the refused list is drawn');
    const text = refused.textContent.replace(/\s+/g, ' ').trim();
    assert.equal(text, 'not applied: - item Lantern | qty: 1 — There is no Lantern in the inventory.');
    // The greeting's card has none.
    ui.mounts.card.refresh(0, { force: true });
    ui.mounts.card.toggle(0, true);
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
    // Alt+G, and the game view's own key tracker (the mount is destroyed with the page now)
    assert.equal(doc.listeners.filter(entry => entry.type === 'keydown').length, before - 2, 'Alt+G and the mount\'s tracker are unhooked');
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

// ---------------------------------------------------------------------------------------------------
// §F125: a module's own lines on the changes card (hooks.replyCard)

const ROLL_MODULE = {
    id: 'roll-test', name: 'Roll test', version: '0.0.1',
    domains: { rolls: { initial: () => ({ log: {} }), validate: () => [] } },
    capture: {
        kinds: { roll: { grammar: '? roll <what> | die: N' } },
        apply(ctx, line) {
            const draft = ctx.draft('rolls');
            const id = `rl_${String(Object.keys(draft.log).length + 1).padStart(8, '0')}`;
            draft.log[id] = { key: id, what: line.name, die: Number(line.labels?.die ?? 0) };
            return { summary: 'rolled', narrate: false };
        },
    },
    hooks: {
        // The reply's own rolls: the log entries its ops touched, read from the reply's state.
        replyCard({ state, changes }) {
            const ids = new Set(changes.map(path => /^\/domains\/rolls\/log\/([^/]+)/.exec(path)?.[1]).filter(Boolean));
            return [...ids].map(id => state.domains.rolls.log[id]).filter(Boolean)
                .map(entry => ({ text: `${entry.what}: d20 ${entry.die}`, summary: `${entry.what} ${entry.die}`, icon: 'fa-dice-d20' }));
        },
    },
};

test('the changes card shows a module\'s lines for that reply (summary and body); a swipe shows the new swipe\'s', async () => {
    const { doc, host, ui, draw } = await page({ modules: [ROLL_MODULE] });
    await host.send('hi', 'You climb.\n<Changes>\n? roll climb | die: 14\n</Changes>');
    await host.send('more', 'You rest.');
    draw();
    const cardAt = index => {
        ui.mounts.card.refresh(index, { force: true });
        return doc.querySelector(`.mes[mesid="${index}"] [data-ss-card="${THIS_REPLY_ID}"]`);
    };
    assert.equal(cardAt(2).querySelector('.ss-card-summary').textContent, 'climb 14');
    ui.mounts.card.toggle(2, true);
    assert.equal(cardAt(2).querySelector('.extra .main').textContent, 'climb: d20 14');
    assert.equal(cardAt(2).querySelector('.none'), null);
    // The later reply rolled nothing: its card says so, with no module line.
    assert.equal(cardAt(4).querySelector('.ss-card-summary').textContent, 'No changes');
    await host.swipe('You rest again.\n<Changes>\n? roll rest | die: 3\n</Changes>');
    draw();
    assert.equal(cardAt(4).querySelector('.ss-card-summary').textContent, 'rest 3');
    assert.equal(cardAt(2).querySelector('.ss-card-summary').textContent, 'climb 14', 'the earlier reply keeps its own');
});

// ---------------------------------------------------------------------------------------------------
// §F123: the safety net's lines on the card (final live check FL-3: the folded card said "No item, coin or
// place changes" while its body held "! time +20m (assist)", so the reader never saw the mark)

test('the changes card\'s folded header counts the lines the safety net applied, and its body lists them marked (assist)', async () => {
    // The live path: a reply with no block, the model's answer in plain lines (no <Changes> tags).
    const { doc, host, ui, draw } = await page({ callModel: async () => '~ weather fog\n+ present Fenna' });
    await host.send('hi', WITH_LINES);
    host.features.set(CORE_FEATURE.extractor, true);
    await host.send('We wait by the weir.', 'Fog rolls in and Fenna comes to wait with you.');
    await new Promise(resolve => setTimeout(resolve, 50));
    draw();
    const cardAt = index => {
        ui.mounts.card.refresh(index, { force: true });
        return doc.querySelector(`.mes[mesid="${index}"] [data-ss-card="${THIS_REPLY_ID}"]`);
    };
    const summary = cardAt(4).querySelector('.ss-card-summary').textContent;
    assert.match(summary, /Fenna arrived/, 'the arrival, as any change');
    assert.match(summary, /2 lines from the safety net \(assist\)$/, summary);
    ui.mounts.card.toggle(4, true);
    const listed = [...cardAt(4).querySelectorAll('.assisted .line')].map(line => line.textContent.replace(/\s+/g, ' ').trim());
    assert.deepEqual(listed, ['~ weather fog (assist)', '+ present Fenna (assist)']);
    // The reply before it (the safety net was off) has no mark in its header.
    assert.doesNotMatch(cardAt(2).querySelector('.ss-card-summary').textContent, /safety net/);
});

// ---------------------------------------------------------------------------------------------------
// One card under a reply: another module's card is a section of "This reply", headed by its own title, with its own part of the line

const STATUS_MODULE = {
    id: 'status-test', name: 'Status test', version: '0.0.1',
    queries: { 'clock.text': () => '1:30 pm' },
    screens: [{
        id: 'status-test/card', title: 'Where things stand', icon: 'fa-compass', mounts: ['card'], defaultOn: true,
        template: '<p class="stat">{{ state.scene.place.name }}</p>',
        data: { clock: { query: 'clock.text' } },
        summary: '{{ q.clock }}, {{ state.scene.place.name }}',
    }],
};

test('"This reply" holds the changes and another module\'s card as sections: one line closed, its own title as the heading open', async () => {
    const { doc, host, ui, draw } = await page({ modules: [STATUS_MODULE] });
    await host.send('hi', 'You reach the village.\n<Changes>\n+ item Rope | qty: 1\n~ place Bluewatch Village\n</Changes>');
    draw();
    ui.mounts.card.refresh(2, { force: true });
    const cards = doc.querySelectorAll('.mes[mesid="2"] [data-ss-card]');
    assert.equal(cards.length, 1, 'one card under the reply');
    const card = cards[0];
    assert.equal(card.getAttribute('data-ss-card'), THIS_REPLY_ID);
    assert.equal(card.querySelector('.ss-card-title').textContent, 'This reply');
    const line = card.querySelector('.ss-card-summary').textContent;
    assert.match(line, /^\+1 Rope · .*Bluewatch Village.* · 1:30 pm, Bluewatch Village$/, line);
    assert.doesNotMatch(line, /edit/, 'no edits part in the closed line');
    assert.equal(card.querySelector('.ss-card-summary').getAttribute('title'), line);
    ui.mounts.card.toggle(2, true);
    assert.deepEqual(card.querySelectorAll('.ss-card-sec').map(node => node.getAttribute('data-ss-section')), ['story-block/changes-card', 'status-test/card']);
    assert.deepEqual(card.querySelectorAll('.ss-card-sec-title').map(node => node.textContent), ['Changed this reply', 'Where things stand']);
    assert.equal(card.querySelector('.stat').textContent, 'Bluewatch Village', 'the card keeps its own layout');
});

test('"This reply": a card\'s own switch takes its section and its words away; "Cards under replies" off takes the card away', async () => {
    const { doc, host, ui, draw } = await page({ modules: [STATUS_MODULE] });
    await host.send('hi', 'You reach the village.\n<Changes>\n~ place Bluewatch Village\n</Changes>');
    draw();
    const cardAt = () => {
        ui.mounts.card.refresh(2, { force: true });
        return doc.querySelector(`.mes[mesid="2"] [data-ss-card="${THIS_REPLY_ID}"]`);
    };
    ui.screens.setCards('status-test/card', false);
    const only = cardAt();
    assert.ok(only, 'still "This reply" with one card on');
    assert.equal(only.querySelectorAll('.ss-card-sec').length, 1);
    assert.doesNotMatch(only.querySelector('.ss-card-summary').textContent, /1:30 pm/);
    ui.screens.setCards('status-test/card', true);
    assert.match(cardAt().querySelector('.ss-card-summary').textContent, /1:30 pm/);
    host.features.set(CORE_FEATURE.cards, false);
    assert.equal(cardAt(), null, 'Cards under replies off hides it all');
    host.features.set(CORE_FEATURE.cards, true);
    assert.ok(cardAt());
});
