// The "Send pending" state machine (ui-host/send-pending.js) on a fake clock: every transition, one re-send per round,
// never a double send, never a send of changed or empty text, cancel and typing leave the text alone. No DOM, no SillyTavern.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendPending } from '../../src/v2/ui-host/send-pending.js';

// A tiny fake clock: timers fire in due order when advance() moves time forward.
function fakeClock() {
    let now = 0, nextId = 1;
    const timers = new Map();
    return {
        timers: {
            setTimeout(fn, ms) { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
            clearTimeout(id) { timers.delete(id); },
        },
        advance(ms) {
            const end = now + ms;
            for (;;) {
                let due = null;
                for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due.at || (t.at === due.at && id < due.id))) due = { id, at: t.at, fn: t.fn };
                if (!due) break;
                now = due.at; timers.delete(due.id); due.fn();
            }
            now = end;
        },
        pending: () => timers.size,
    };
}

// Builds the machine around a fake page: `box` is the typed text, `busy` and `held` are switches the test flips.
function rig(opts = {}) {
    const clock = fakeClock();
    const page = { box: 'I knock on the cabin door and wait.', busy: false, held: false, sends: [], boardOpens: 0, changes: [] };
    const sp = createSendPending({
        readText: () => page.box,
        clickSend: () => page.sends.push(page.box),
        isBusy: () => page.busy,
        fightHeld: () => page.held,
        openBoard: () => { page.boardOpens++; return true; },
        onChange: (s) => page.changes.push(s.state),
        timers: clock.timers,
        ...opts,
    });
    return { sp, clock, page };
}

test('free and not held: a press goes straight through once and stays idle', () => {
    const { sp, page } = rig();
    assert.equal(sp.press(), 'passed');
    assert.deepEqual(page.sends, ['I knock on the cabin door and wait.']);
    assert.equal(sp.state().state, 'idle');
});

test('an empty box never sends', () => {
    const { sp, page, clock } = rig();
    page.box = '   ';
    assert.equal(sp.press(), 'empty');
    page.busy = true; page.box = '';
    assert.equal(sp.press(), 'empty');
    page.busy = false; clock.advance(5000);
    assert.deepEqual(page.sends, []);
    assert.equal(sp.state().state, 'idle');
});

test('click while busy -> pending; no send while busy', () => {
    const { sp, page, clock } = rig();
    page.busy = true;
    assert.equal(sp.press(), 'pending');
    assert.equal(sp.state().state, 'pending');
    clock.advance(3000);
    assert.deepEqual(page.sends, []);
    assert.equal(sp.state().state, 'pending');
});

test('pending -> free: exactly ONE re-send, then sent for 2 s, then idle', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    clock.advance(1000);
    page.busy = false;
    clock.advance(250);
    assert.deepEqual(page.sends, ['I knock on the cabin door and wait.']);
    assert.equal(sp.state().state, 'sent');
    clock.advance(1999);
    assert.equal(sp.state().state, 'sent');
    clock.advance(1);
    assert.equal(sp.state().state, 'idle');
    clock.advance(10000);
    assert.equal(page.sends.length, 1, 'no second re-send after sent');
});

test('the re-send happens on the first free poll, not on a timer after the story was free long ago', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    page.busy = false;
    clock.advance(240);
    assert.equal(page.sends.length, 0, 'no re-send before the next poll');
    clock.advance(10);
    assert.equal(page.sends.length, 1);
});

test('still busy after 6 s -> stalled; nothing is sent later on its own', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    clock.advance(5999);
    assert.equal(sp.state().state, 'pending');
    clock.advance(1);
    assert.equal(sp.state().state, 'stalled');
    page.busy = false;
    clock.advance(60000);
    assert.deepEqual(page.sends, [], 'a stalled round does not send by itself');
    assert.equal(sp.state().state, 'stalled');
    assert.equal(clock.pending(), 0, 'no timers left running once stalled');
});

test('stalled + Send again = one more pending round; it re-sends once the story is free', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    clock.advance(6000);
    assert.equal(sp.state().state, 'stalled');
    assert.equal(sp.press(), 'pending');
    clock.advance(500);
    page.busy = false;
    clock.advance(250);
    assert.deepEqual(page.sends, ['I knock on the cabin door and wait.']);
    assert.equal(sp.state().state, 'sent');
});

test('stalled + Send again while the story is free sends once at once', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    clock.advance(6000);
    page.busy = false;
    sp.press();
    assert.equal(page.sends.length, 1);
    assert.equal(sp.state().state, 'sent');
    clock.advance(5000);
    assert.equal(page.sends.length, 1);
});

test('a second press while pending is ignored (never double-sends)', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    assert.equal(sp.press(), 'waiting');
    assert.equal(sp.press(), 'waiting');
    page.busy = false;
    clock.advance(1000);
    assert.equal(page.sends.length, 1);
});

test('a press while sent (free) goes through once and does not re-send the round', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    page.busy = false; clock.advance(250);
    assert.equal(sp.state().state, 'sent');
    page.box = 'Next line.';
    assert.equal(sp.press(), 'passed');
    assert.deepEqual(page.sends, ['I knock on the cabin door and wait.', 'Next line.']);
    assert.equal(sp.state().state, 'idle');
    clock.advance(5000);
    assert.equal(page.sends.length, 2);
});

test('cancel -> idle with the text untouched and nothing sent', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    assert.equal(sp.cancel(), true);
    assert.equal(sp.state().state, 'idle');
    assert.equal(page.box, 'I knock on the cabin door and wait.');
    page.busy = false; clock.advance(10000);
    assert.deepEqual(page.sends, []);
    assert.equal(clock.pending(), 0);
});

test('cancel while stalled or held -> idle; cancel while idle reports nothing to do', () => {
    const { sp, page, clock } = rig();
    assert.equal(sp.cancel(), false);
    page.busy = true; sp.press(); clock.advance(6000);
    assert.equal(sp.cancel(), true);
    assert.equal(sp.state().state, 'idle');
    page.busy = false; page.held = true; sp.press();
    assert.equal(sp.cancel(), true);
    assert.equal(sp.state().state, 'idle');
    page.held = false; clock.advance(1000);
    assert.deepEqual(page.sends, []);
});

test('typing in the box clears the note (stalled) and drops a live round without sending', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press(); clock.advance(6000);
    assert.equal(sp.typed(), true);
    assert.equal(sp.state().state, 'idle');
    assert.equal(sp.typed(), false);

    const second = rig();
    second.page.busy = true; second.sp.press();
    second.page.box = 'Changed my mind.';
    second.page.busy = false;
    second.clock.advance(1000);
    assert.deepEqual(second.page.sends, [], 'changed text is never sent');
    assert.equal(second.sp.state().state, 'idle');
});

test('text changed without a typed() call still stops the round (poll check)', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    page.box = 'Something else entirely';
    page.busy = false;
    clock.advance(1000);
    assert.deepEqual(page.sends, []);
    assert.equal(sp.state().state, 'idle');
});

test('text emptied during a round never sends', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    page.box = '';
    page.busy = false;
    clock.advance(1000);
    assert.deepEqual(page.sends, []);
    assert.equal(sp.state().state, 'idle');
});

test('a fight start holding the Send -> fightHeld, with an open-board action', () => {
    const { sp, page, clock } = rig();
    page.held = true;
    assert.equal(sp.press(), 'fightHeld');
    assert.equal(sp.state().state, 'fightHeld');
    assert.equal(sp.openBoard(), true);
    assert.equal(page.boardOpens, 1);
    clock.advance(10000);
    assert.deepEqual(page.sends, [], 'never sends while the fight holds it');
    assert.equal(sp.state().state, 'fightHeld');
});

test('fightHeld while busy: still held, no send; the hold can clear to idle without a send', () => {
    const { sp, page, clock } = rig();
    page.busy = true; page.held = true;
    assert.equal(sp.press(), 'fightHeld');
    page.busy = false;
    clock.advance(1000);
    assert.deepEqual(page.sends, []);
    page.held = false;
    clock.advance(300);
    assert.equal(sp.state().state, 'idle');
    assert.deepEqual(page.sends, [], 'the fight path owns the message; no send from this note');
    assert.equal(clock.pending(), 0);
});

test('a hold that arrives during a pending round moves it to fightHeld and it never sends', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    page.held = true;
    clock.advance(500);
    assert.equal(sp.state().state, 'fightHeld');
    page.busy = false; page.held = true;
    clock.advance(10000);
    assert.deepEqual(page.sends, []);
});

test('openBoard does nothing outside fightHeld', () => {
    const { sp, page } = rig();
    assert.equal(sp.openBoard(), false);
    assert.equal(page.boardOpens, 0);
});

test('dispose clears every timer and sends nothing', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    sp.dispose();
    assert.equal(clock.pending(), 0);
    page.busy = false; clock.advance(10000);
    assert.deepEqual(page.sends, []);
    assert.equal(sp.state().state, 'idle');
});

test('onChange reports each state change once, in order', () => {
    const { sp, page, clock, } = rig();
    page.busy = true; sp.press(); clock.advance(6000); sp.cancel();
    assert.deepEqual(page.changes, ['pending', 'stalled', 'idle']);
});

test('never double-sends across a full round with the story freeing mid-poll', () => {
    const { sp, page, clock } = rig();
    page.busy = true; sp.press();
    for (let i = 0; i < 10; i++) { clock.advance(100); sp.press(); }
    page.busy = false;
    clock.advance(5000);
    assert.equal(page.sends.length, 1);
});

// ---- the page side (ui-host/send-note.js) on the widget tests' fake DOM -------------------------------------------------------
import { readFileSync } from 'node:fs';
import { installDom } from './view/widgets/fake-dom.js';
import { createSendNote, SEND_NOTE_TEXT } from '../../src/v2/ui-host/send-note.js';

function pageRig(opts = {}) {
    const doc = installDom();
    const proto = Object.getPrototypeOf(doc.createElement('div'));
    proto.closest = function (sel) { const id = sel.replace('#', ''); for (let n = this; n; n = n.parentNode) if (n.id === id) return n; return null; };
    if (!Object.getOwnPropertyDescriptor(proto, 'nextElementSibling')) Object.defineProperty(proto, 'nextElementSibling', { get() { const l = this.parentNode?.children ?? []; return l[l.indexOf(this) + 1] ?? null; }, configurable: true });
    doc.getElementById = id => doc.body.querySelector(`#${id}`);
    doc.defaultView = { addEventListener: (t, f, o) => doc.addEventListener(t, f, o), removeEventListener: (t, f, o) => doc.removeEventListener(t, f, o) };
    const form = doc.createElement('div'); form.setAttribute('id', 'send_form');
    const box = doc.createElement('textarea'); box.setAttribute('id', 'send_textarea'); box.value = 'I knock on the cabin door and wait.';
    const send = doc.createElement('button'); send.setAttribute('id', 'send_but');
    const stop = doc.createElement('div'); stop.setAttribute('id', 'mes_stop'); stop.style = { display: 'none' };
    form.append(box, send); doc.body.append(form, stop);
    const page = { clicks: 0, busy: false, held: false, boards: 0, on: true, handlers: [], ignore: true };
    // SillyTavern's Send: takes the text (clears the box and says "input") unless told to ignore it.
    // A programmatic click travels the document's listeners like a real one (the note's own re-send must not count as a new press).
    send.click = () => { doc.fire('click', {}, send); };
    send.addEventListener('click', () => { page.clicks++; if (!page.ignore) { box.value = ''; doc.fire('input', {}, box); } });
    const clock = fakeClock();
    const ctx = { eventTypes: { GENERATION_STARTED: 'gs', GENERATION_AFTER_COMMANDS: 'gac' }, eventSource: { on: (n, f) => page.handlers.push(f), removeListener: () => {} } };
    const note = createSendNote({ doc, ctx, enabled: () => page.on, busy: () => page.busy, held: () => page.held, openBoard: () => { page.boards++; return true; }, timers: clock.timers, ...opts });
    const press = () => doc.fire('click', {}, send);
    const pill = () => doc.body.querySelector('.ss-send-note-pill');
    return { doc, page, note, clock, press, pill, box, form, send, stop };
}

test('send note: busy at the press shows a role=status pill right above #send_form, then re-sends once and says Sent for 2 s', () => {
    const r = pageRig();
    r.page.busy = true;
    r.press();
    assert.equal(r.pill().getAttribute('role'), 'status');
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.pending);
    assert.equal(r.pill().parentNode.nextElementSibling, r.form);
    assert.equal(r.page.clicks, 1, 'only the reader\'s own click so far');
    r.clock.advance(1000);
    assert.equal(r.page.clicks, 1);
    r.page.busy = false;
    r.page.ignore = false;
    r.clock.advance(250);
    assert.equal(r.page.clicks, 1, 'not at once: the story must stay free for a few polls (SillyTavern is still closing the last reply)');
    r.clock.advance(750);
    assert.equal(r.page.clicks, 2, 'one re-send');
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.sent, 'the box clearing does not end Sent');
    r.clock.advance(2000);
    assert.equal(r.pill(), null);
    r.clock.advance(10000);
    assert.equal(r.page.clicks, 2);
});

test('send note: a free press that SillyTavern ignored is sent again once; one it took leaves no note', () => {
    const r = pageRig();
    r.press();
    assert.equal(r.pill(), null);
    r.clock.advance(1500);
    r.clock.advance(1000);
    assert.equal(r.page.clicks, 2);
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.sent);
    const t = pageRig();
    t.page.ignore = false;
    t.press();
    t.clock.advance(5000);
    assert.equal(t.page.clicks, 1);
    assert.equal(t.pill(), null);
    const g = pageRig();
    g.press();
    g.page.handlers.forEach(fn => fn('normal', {}, false));
    g.clock.advance(5000);
    assert.equal(g.page.clicks, 1, 'Generate was entered (a hold or interceptor may have kept the text): not ignored');
    assert.equal(g.page.handlers.length, 2, 'both events are listened to');
});

test('send note: a press another handler swallowed (a hold, a fight pause) is never re-sent', () => {
    const r = pageRig();
    r.doc.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    r.press();
    r.clock.advance(10000);
    assert.equal(r.page.clicks, 0);
    assert.equal(r.pill(), null);
    // Another click on the page (the hold's own buttons) between the press and the check must not count as the press arriving.
    const o = pageRig();
    o.doc.addEventListener('click', event => { if (event.target === o.send) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    o.press();
    const other = o.doc.createElement('button'); o.doc.body.append(other);
    o.doc.fire('click', {}, other);
    o.clock.advance(10000);
    assert.equal(o.page.clicks, 0, 'an unrelated click is not the press');
    const k = pageRig();
    k.doc.addEventListener('click', event => event.preventDefault(), true);
    k.press();
    k.clock.advance(10000);
    assert.equal(k.page.clicks, 1, 'a cancelled press is not re-sent either (only the reader\'s own press)');
});

test('send note: a dry run or a quiet call is not a Send being taken', () => {
    const r = pageRig();
    r.press();
    r.page.handlers.forEach(fn => { fn('normal', {}, true); fn('quiet', {}, false); });
    r.clock.advance(1500);
    r.clock.advance(1000);
    assert.equal(r.page.clicks, 2, 'ignored press re-sent once');
});

test('send note: a re-send SillyTavern also ignored is tried again twice at most, never called "Sent" while the text is still there, then says Not sent yet', () => {
    const r = pageRig();
    r.page.busy = true;
    r.press();
    r.page.busy = false;
    r.clock.advance(1000);
    assert.equal(r.page.clicks, 2, 'the first re-send');
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.sent);
    r.clock.advance(60000);
    assert.equal(r.page.clicks, 4, 'two more tries and no more');
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.stalled);
    assert.equal(r.box.value, 'I knock on the cabin door and wait.');
    r.page.ignore = false;
    r.pill().querySelectorAll('.ss-send-note-btn')[0].click();
    r.clock.advance(1000);
    assert.equal(r.page.clicks, 5, 'Send again goes once more');
});

test('send note: a retry that SillyTavern takes ends the round (the box empties, no further click)', () => {
    const r = pageRig();
    r.page.busy = true;
    r.press();
    r.page.busy = false;
    r.clock.advance(1000);
    r.page.ignore = false;
    r.clock.advance(1500);
    assert.equal(r.page.clicks, 3, 'the retry');
    r.clock.advance(60000);
    assert.equal(r.page.clicks, 3);
    assert.equal(r.pill(), null);
});

test('send note: a busy blip resets the calm count (no re-send while the story is still working)', () => {
    const r = pageRig();
    r.page.busy = true;
    r.press();
    r.page.busy = false;
    r.clock.advance(500);
    r.page.busy = true;
    r.clock.advance(250);
    r.page.busy = false;
    r.clock.advance(500);
    assert.equal(r.page.clicks, 1);
    r.clock.advance(500);
    assert.equal(r.page.clicks, 2);
});

test('send note: the Stop button showing counts as busy; Enter in the box is a press too', () => {
    const r = pageRig();
    r.stop.style = { display: 'flex' };
    r.doc.activeElement = r.box;
    r.doc.fire('keydown', { key: 'Enter' }, r.box);
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.pending);
    r.doc.fire('keydown', { key: 'Enter', shiftKey: true }, r.box);
    assert.equal(r.page.clicks, 0);
});

test('send note: ✕ and typing drop the note and leave the text; nothing is sent', () => {
    const r = pageRig();
    r.page.busy = true;
    r.press();
    r.pill().querySelector('.ss-send-note-btn').click();
    assert.equal(r.pill(), null);
    r.press();
    r.box.value = 'something else';
    r.doc.fire('input', {}, r.box);
    assert.equal(r.pill(), null);
    r.page.busy = false;
    r.clock.advance(10000);
    assert.equal(r.page.clicks, 2, 'only the reader\'s two own presses, no re-send');
    assert.equal(r.box.value, 'something else');
});

test('send note: still busy after 6 s says so; Send again tries once more', () => {
    const r = pageRig();
    r.page.busy = true;
    r.press();
    r.clock.advance(6100);
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.stalled);
    r.page.busy = false;
    const again = r.pill().querySelectorAll('.ss-send-note-btn')[0];
    assert.equal(again.textContent, SEND_NOTE_TEXT.again);
    again.click();
    r.clock.advance(1000);
    assert.equal(r.page.clicks, 2);
});

test('send note: a fight hold shows "Open fight board", which opens the board; the hold clearing ends the note with no send', () => {
    const r = pageRig();
    r.page.held = true;
    r.press();
    assert.equal(r.pill().querySelector('.ss-send-note-text').textContent, SEND_NOTE_TEXT.fightHeld);
    r.pill().querySelector('.ss-send-note-btn').click();
    assert.equal(r.page.boards, 1);
    r.page.held = false;
    r.clock.advance(300);
    assert.equal(r.pill(), null);
    assert.equal(r.page.clicks, 1);
});

test('send note: switched off, nothing is drawn or re-sent; destroy leaves no listeners', () => {
    const r = pageRig();
    r.page.on = false;
    r.page.busy = true;
    r.press();
    assert.equal(r.pill(), null);
    r.note.destroy();
    assert.equal(r.doc.docListeners.length, 0);
});

test('send note CSS: container-decided layout, 44 px targets, tokens, motion guard; the setting is on by default', () => {
    const css = readFileSync(new URL('../../src/v2/view/send-note.css', import.meta.url), 'utf8');
    assert.match(css, /@container \(min-width: \d+px\)/);
    assert.doesNotMatch(css, /@media \((min|max)-width/);
    assert.match(css, /min-height: 44px; min-width: 44px/);
    for (const token of ['--ss-accent', '--ss-warn', '--ss-good', '--ss-text']) assert.ok(css.includes(token), token);
    assert.match(css, /prefers-reduced-motion/);
});

test('machine: fail() turns Sent into stalled with the text kept, only from sent', () => {
    const r = rig();
    assert.equal(r.sp.fail(), false);
    r.page.busy = true;
    r.sp.press();
    r.page.busy = false;
    r.clock.advance(300);
    assert.equal(r.sp.state().state, 'sent');
    assert.equal(r.sp.fail(), true);
    assert.equal(r.sp.state().state, 'stalled');
    assert.equal(r.clock.pending(), 0, 'no timers left');
});
