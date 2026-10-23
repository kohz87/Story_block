// Story Block UI fixes (SB-polish): navigation order with Home first, the scroll cue on navigation that
// does not fit, the story clock on its calendar, no cards under the greeting or a reply without a v2
// record, the dialog keeping the focus, a readable radar label, Home marking offers, and the CSS guards
// (the hud items, the opaque game view, the docked side sheet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME_ID, REST_ORDER, byNavOrder, createScreens, screenOrder, validateScreen } from '../../../src/v2/view/screens.js';
import { hiddenSides, overflowAxis, scrollCue } from '../../../src/v2/view/scroll-cue.js';
import { calendarFrom, clockText, dateOf, formatStoryTime, storyCalendar, timeFormatter } from '../../../src/v2/view/clock.js';
import { hasReplyRecord } from '../../../src/v2/ui-host.js';
import { writeRecord } from '../../../src/v2/persist.js';
import { createDialogMount, focusablesIn } from '../../../src/v2/view/mounts/dialog.js';
import { createScreenMount } from '../../../src/v2/view/mounts/screen.js';
import { LABEL_MIN_PX, labelUnits } from '../../../src/v2/view/widgets/radar.js';
import { homeScreen } from '../../../src/v2/screens/home.js';
import { screen, screensWith, setupDom } from '../view/mounts/helpers.js';

const read = path => readFileSync(new URL(`../../../src/v2/${path}`, import.meta.url), 'utf8');

// ---- navigation order -----------------------------------------------------------------------------

test('screenOrder: Home first whatever it says; then the suite\'s default order; the Director, then Dossiers, last', () => {
    assert.equal(screenOrder(HOME_ID), 0);
    assert.equal(screenOrder(HOME_ID, 99), 0, 'a pack or reader version of Home cannot move it down');
    const suite = ['rpg-battle/party', 'story-block/inventory', 'story-director/quests', 'story-director/world', 'story-director/map',
        'rpg-battle/fight', 'rpg-battle/crafting', 'rpg-battle/trade', 'story-block/scene',
        'story-director/chronicle', 'story-director/director', 'npc-state-delta/cast'];
    assert.deepEqual(suite.map(id => screenOrder(id)), [10, 20, 30, 40, 50, 60, 70, 80, 100, 110, 200, 210]);
    assert.equal(screenOrder('npc-state-delta/cast', 35), 210, 'the suite\'s own keep their default place whatever order they say (Dossiers, once Cast at 35, last)');
    assert.equal(screenOrder('a/b'), REST_ORDER);
    assert.ok(REST_ORDER > screenOrder('story-director/chronicle') && REST_ORDER < screenOrder('story-director/director'), 'others go before the Director');
    assert.equal(screenOrder('mypack/party'), 10, 'another screen takes the default place of its last part');
    assert.equal(screenOrder('a/b', 5), 5, 'another screen\'s own order wins over the defaults');
    assert.equal(screenOrder('a/b', -10), 1, 'nothing goes before Home');
    assert.equal(screenOrder('a/b', 0), 1);
    assert.equal(screenOrder('a/b', Number.NaN), REST_ORDER);
});

test('the registry lists screens in navigation order; ties keep id order; order is checked', () => {
    const screens = createScreens();
    const s = (id, extra = {}) => ({ id, title: id, mounts: ['screen', 'tab'], template: '<p></p>', ...extra });
    screens.addModule('rpg-battle', [s('rpg-battle/fight'), s('rpg-battle/party'), s('rpg-battle/items')]);
    screens.addModule('story-director', [s('story-director/quests'), s('story-director/map'), s('story-director/director')]);
    screens.addModule('x', [s('x/zeta', { order: 5 }), s('x/pushy', { order: -3 })]);
    screens.addModule('story-block', [s('story-block/home', { order: 1000 }), s('story-block/scene'), s('story-block/inventory')]);
    assert.deepEqual(screens.list('screen').map(entry => entry.id), [
        'story-block/home', 'x/pushy', 'x/zeta', 'rpg-battle/party', 'story-block/inventory', 'story-director/quests',
        'story-director/map', 'rpg-battle/fight', 'story-block/scene', 'rpg-battle/items', 'story-director/director',
    ]);
    assert.match(validateScreen(s('a/b', { order: 'first' })).join(' '), /order must be a number/);
    assert.deepEqual(validateScreen(s('a/b', { order: 2.5 })), []);
});

test('byNavOrder sorts the Story panel\'s tabs (module tabs and tab screens together)', () => {
    const tabs = [{ id: 'trade' }, { id: 'rpg-battle/party' }, { id: 'items', order: 45 }, { id: 'story-block/scene' }, { id: 'story-block/inventory' }];
    assert.deepEqual(byNavOrder(tabs).map(tab => tab.id), ['rpg-battle/party', 'story-block/inventory', 'items', 'trade', 'story-block/scene']);
});

// ---- the scroll cue --------------------------------------------------------------------------------

function scroller({ scrollWidth = 100, clientWidth = 100, scrollHeight = 40, clientHeight = 40, scrollLeft = 0, scrollTop = 0 } = {}) {
    const attrs = {};
    const listeners = {};
    return {
        scrollWidth, clientWidth, scrollHeight, clientHeight, scrollLeft, scrollTop,
        getAttribute: name => attrs[name] ?? null,
        setAttribute: (name, value) => { attrs[name] = String(value); },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        removeEventListener: type => { delete listeners[type]; },
        fire: type => listeners[type]?.(),
        listeners,
    };
}

test('hiddenSides and overflowAxis', () => {
    assert.equal(hiddenSides({ scrollStart: 0, scrollSize: 100, clientSize: 100 }), 'none');
    assert.equal(hiddenSides({ scrollStart: 0, scrollSize: 300, clientSize: 100 }), 'end');
    assert.equal(hiddenSides({ scrollStart: 80, scrollSize: 300, clientSize: 100 }), 'both');
    assert.equal(hiddenSides({ scrollStart: 200, scrollSize: 300, clientSize: 100 }), 'start');
    assert.equal(hiddenSides({ scrollStart: 199.5, scrollSize: 300, clientSize: 100 }), 'start', 'a sub-pixel short of the end counts as the end');
    assert.equal(overflowAxis(scroller({ scrollWidth: 400, clientWidth: 390 })), 'x');
    assert.equal(overflowAxis(scroller({ scrollHeight: 900, clientHeight: 600 })), 'y');
    assert.equal(overflowAxis(scroller()), 'x');
});

test('scrollCue marks the hidden side, follows scrolling, and lets go on destroy', () => {
    const observed = [];
    class FakeResize { constructor(fn) { this.fn = fn; } observe(el) { observed.push([this, el]); } disconnect() { observed.length = 0; } }
    const bar = scroller({ scrollWidth: 640, clientWidth: 390 });
    const cue = scrollCue(bar, { win: { ResizeObserver: FakeResize } });
    assert.equal(bar.getAttribute('data-ss-axis'), 'x');
    assert.equal(bar.getAttribute('data-ss-more'), 'end');
    bar.scrollLeft = 120;
    bar.fire('scroll');
    assert.equal(bar.getAttribute('data-ss-more'), 'both');
    bar.scrollLeft = 250;
    bar.fire('scroll');
    assert.equal(bar.getAttribute('data-ss-more'), 'start');
    // Wider window: it all fits.
    bar.clientWidth = 640;
    bar.scrollLeft = 0;
    observed[0][0].fn();
    assert.equal(bar.getAttribute('data-ss-more'), 'none');
    // The desktop side bar scrolls up and down.
    const side = scroller({ scrollHeight: 900, clientHeight: 600 });
    scrollCue(side, { win: {} });
    assert.deepEqual([side.getAttribute('data-ss-axis'), side.getAttribute('data-ss-more')], ['y', 'end']);
    cue.destroy();
    assert.equal(bar.listeners.scroll, undefined);
    assert.equal(observed.length, 0);
});

test('the game view\'s navigation and the tab bar carry the cue; mounts.css fades the edge', () => {
    const doc = setupDom();
    const deps = {
        screens: screensWith([screen('story-block/home', ['screen']), screen('rpg-battle/party', ['screen']), screen('x/fight', ['screen'])]),
        render: () => {}, query: () => null, stateAt: () => ({ v: 2, meta: { rev: 1 }, domains: {} }), headIndex: () => 0, document: doc,
    };
    const view = createScreenMount(deps);
    view.open('x/fight');
    const nav = doc.body.querySelector('.ss-gameview-nav');
    assert.deepEqual(nav.querySelectorAll('.ss-gameview-navitem').map(item => item.getAttribute('data-ss-target')), ['story-block/home', 'rpg-battle/party', 'x/fight']);
    assert.ok(nav.getAttribute('data-ss-more'), 'the cue is set on the navigation');
    view.close();
    const css = read('view/mounts.css');
    assert.match(css, /:is\(\.ss-gameview-nav, \.ss-tabs-list\)\[data-ss-axis="x"\]\[data-ss-more="end"\][^}]*mask-image/);
    assert.match(css, /\[data-ss-axis="y"\]\[data-ss-more="both"\][^}]*mask-image/);
});

// ---- the story clock -------------------------------------------------------------------------------

const ERSVEIL = { era: 'CY', months: ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane', 'Emberwane', 'Nightfall', 'Frostfall', 'Snowmoot', 'Deepwinter', 'Thaw'].map(name => ({ name, days: 30 })) };

test('formatStoryTime writes the minutes on the calendar, as Story Director does', () => {
    // 220091 days and 19:40 into the clock: what showed as "Day 220092, 19:40".
    const minutes = 220091 * 1440 + 19 * 60 + 40;
    assert.equal(formatStoryTime(minutes, ERSVEIL), 'CY 611, Goldwane 12, 7:40 pm');
    assert.equal(formatStoryTime(minutes, { ...ERSVEIL, era: '' }), 'Goldwane 12, 611, 7:40 pm', 'no era: the year goes after the day');
    assert.equal(formatStoryTime(0, ERSVEIL), 'CY 0, Dawnwane 1, 12:00 am');
    assert.equal(formatStoryTime(30 * 1440 + 12 * 60 + 5, ERSVEIL), 'CY 0, Rainmoot 1, 12:05 pm');
    // Gregorian (the default): leap years counted from year 0, as the Director counts them.
    const leapDay = (366 + 365 * 3 + 31 + 28) * 1440 + 9 * 60;   // year 4, February 29
    assert.equal(formatStoryTime(leapDay), 'February 29, 4, 9:00 am');
    assert.deepEqual(dateOf(leapDay + 1440, calendarFrom({ preset: 'gregorian', months: storyCalendar(null).months })), { year: 4, month: 2, day: 1, minutes: 540 });
    for (const bad of [null, -1, 1.5, '600', Number.NaN]) assert.equal(formatStoryTime(bad, ERSVEIL), '', String(bad));
    assert.deepEqual([clockText(0), clockText(59), clockText(12 * 60), clockText(23 * 60 + 9)], ['12:00 am', '12:59 am', '12:00 pm', '11:09 pm']);
});

test('storyCalendar: Story Director\'s calendar, else the pack\'s, else Gregorian', () => {
    const director = { preset: 'custom', era: 'AR', months: [{ name: 'One', days: 10 }], leapYears: false };
    const asked = [];
    const both = (name, args) => { asked.push([name, args]); return name === 'director.calendar' ? director : ERSVEIL; };
    assert.deepEqual(storyCalendar(both), { era: 'AR', months: [{ name: 'One', days: 10 }], leapYears: false });
    assert.deepEqual(asked, [['director.calendar', {}]]);
    const packOnly = name => (name === 'packs.calendar' ? { pack: 'ersveil', ...ERSVEIL, start: null } : null);
    assert.equal(storyCalendar(packOnly).era, 'CY');
    const throwing = () => { throw new Error('no such query'); };
    assert.equal(storyCalendar(throwing).months[1].name, 'February');
    assert.equal(storyCalendar(name => (name === 'packs.calendar' ? { months: [] } : null)).months.length, 12, 'a calendar with no months is no calendar');
    assert.equal(timeFormatter(packOnly)(220091 * 1440 + 19 * 60 + 40), 'CY 611, Goldwane 12, 7:40 pm');
    // Months written the settings' way ('Name | days') read too.
    assert.deepEqual(calendarFrom({ months: ['Ice | 20', 'Mud'] }).months, [{ name: 'Ice', days: 20 }, { name: 'Mud', days: 30 }]);
});

test('the host gives templates the calendar fmt.time; Home and Scene use it', () => {
    const host = read('ui-host.js');
    assert.match(host, /time: minutes => formatStoryTime\(minutes, calendar\)/);
    assert.match(homeScreen.template, /fmt\.time\(state\.director\.time\.minutes\)/);
    assert.match(read('screens/scene.js'), /fmt\.time\(state\.director\.time\.minutes\)/);
});

// ---- cards ----------------------------------------------------------------------------------------

test('hasReplyRecord: no cards under the greeting or a reply without a v2 record', () => {
    const record = { v: 2, sid: 'sw_1', ops: [{ op: 'replace', path: '/meta/rev', value: 2 }], receipts: [], narrated: [], spans: [] };
    const greeting = { name: 'Narrator', is_user: false, mes: 'Hello.', extra: {} };
    writeRecord(greeting, { ...record, checkpoint: {} });
    const user = { name: 'You', is_user: true, mes: 'Hi.' };
    const reply = { name: 'Narrator', is_user: false, mes: 'A reply.', extra: {} };
    writeRecord(reply, record);
    const bare = { name: 'Narrator', is_user: false, mes: 'No record.', extra: {} };
    const chat = [greeting, user, reply, bare];
    assert.deepEqual(chat.map((_, index) => hasReplyRecord(chat, index)), [false, false, true, false]);
    assert.equal(hasReplyRecord([greeting], 0), false, 'a chat with only the greeting has no cards');
    assert.equal(hasReplyRecord(chat, 9), false);
    // Swiped to a swipe without a record: no card.
    reply.swipe_id = 1;
    reply.swipe_info = [{ extra: { storySuite: reply.extra.storySuite } }, { extra: {} }];
    assert.equal(hasReplyRecord(chat, 2), false);
});

// ---- the dialog ------------------------------------------------------------------------------------

test('a dialog keeps Tab inside itself and pulls stray focus back; mounts.css dims and blurs', () => {
    const doc = setupDom();
    const screens = screensWith([screen('m/wizard', ['dialog'], { title: 'Wizard' })]);
    const render = (el, _screen, _scope) => {
        const name = doc.createElement('input');
        name.className = 'name';
        el.replaceChildren(name);
    };
    const dialogs = createDialogMount({ screens, render, query: () => null, stateAt: () => ({ v: 2, meta: { rev: 1 }, domains: {} }), headIndex: () => 0, document: doc, api: {} });
    const outside = doc.createElement('button');
    doc.body.appendChild(outside);
    const handle = dialogs.open('m/wizard', { submit: 'm.go' });
    const nodes = focusablesIn(handle.root);
    assert.ok(nodes.length >= 2);
    assert.ok(nodes.every(node => !node.hidden), 'hidden footer buttons are not Tab stops');
    const tab = shiftKey => {
        const event = { type: 'keydown', key: 'Tab', shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
        for (const entry of [...doc.listeners]) if (entry.type === 'keydown') entry.fn(event);
        return event;
    };
    nodes.at(-1).focus();
    assert.equal(tab(false).defaultPrevented, true);
    assert.equal(doc.activeElement, nodes[0], 'past the last control: back to the first');
    assert.equal(tab(true).defaultPrevented, true);
    assert.equal(doc.activeElement, nodes.at(-1), 'before the first: the last');
    nodes[0].focus();
    assert.equal(tab(false).defaultPrevented, false, 'in between, the browser moves the focus');
    // Focus that lands on the page behind comes back in.
    outside.focus();
    for (const entry of doc.listeners) if (entry.type === 'focusin') entry.fn({ target: outside });
    assert.equal(doc.activeElement, nodes[0]);
    handle.close();
    assert.equal(doc.listeners.length, 0, 'no listeners left behind');
    const css = read('view/mounts.css');
    assert.match(css, /\.ss-dialog-backdrop \{[^}]*background: rgba\(0, 0, 0, 0\.55\);[^}]*backdrop-filter: blur\(3px\)/);
});

// ---- widgets, Home, CSS guards ----------------------------------------------------------------------

test('radar labels: never under the minimum on screen, growing with a big chart', () => {
    assert.equal(LABEL_MIN_PX, 11);
    for (const width of [120, 150, 220, 320, 640]) {
        const units = labelUnits(width);
        assert.ok(units * (width / 320) >= LABEL_MIN_PX - 0.01, `${width}px wide: ${units} units`);
    }
    assert.equal(labelUnits(150), 23.5);
    assert.equal(labelUnits(640), LABEL_MIN_PX, 'a big chart keeps 11 units, drawn at 22px');
    assert.equal(labelUnits(0), LABEL_MIN_PX);
    assert.match(read('view/widgets/styles.js'), /\.ss-w-radar-label\) \{[^}]*font-size: calc\(var\(--ss-w-radar-label, 11\) \* 1px\)/);
});

test('Home shows Story Director\'s own status line for each quest (an offer says Offered), never its own', () => {
    assert.match(homeScreen.template, /<span class="chip status" data-state="\{\{ t\.status\.state \}\}">\{\{ t\.status\.text \}\}<\/span>/);
    assert.doesNotMatch(homeScreen.template, /t\.offer == true|t\.taken/);
    assert.deepEqual(homeScreen.data.board, { query: 'quest.board' });
});

test('CSS: hud items cannot collapse, the game view is opaque unless Glass, the side sheet docks beside the chat', () => {
    const mounts = read('view/mounts.css');
    assert.match(mounts, /\.ss-hud > \.ss-hud-item \{\s*container-type: normal;\s*min-width: 0;/);
    // Opaque unless the theme sets the glass tokens (Panel style Glass): then the page shows through.
    assert.match(mounts, /@supports \(color: rgb\(from red r g b\)\) \{\s*\.ss-gameview \{\s*background-color: var\(--ss-sheet-bg, rgb\(from var\(--ss-surface\) r g b \/ 1\)\);/);
    const host = read('view/host.css');
    assert.match(host, /@media \(min-width: 1000px\) \{\s*body\.story-suite-sheet-open #sheld:not\(\[style\*="left"\]\) \{\s*right: var\(--story-suite-sheet-width\);/);
    assert.match(host, /width: var\(--story-suite-sheet-width\);/);
});

// ---- through a whole host: real turns, real records ----------------------------------------------

test('a real chat: the greeting gets no cards, a reply with change lines does; a move clears who is here', async () => {
    const { createHost } = await import('../../../testkit/index.js');
    const host = await createHost();
    try {
        await host.send('We land.', '<Changes>\n~ place Inspection Quay | kind: dock\n+ present Marrit, Fenna\n</Changes>');
        assert.deepEqual(host.head().domains.scene.present, ['Marrit', 'Fenna']);
        await host.send('Into the village.', 'Marrit waves you on.\n<Changes>\n~ place Bluewatch Village | with: Fenna\n- present Marrit\n+ present Old Tam\n</Changes>');
        const scene = host.head().domains.scene;
        assert.equal(scene.place.name, 'Bluewatch Village');
        assert.deepEqual(scene.present, ['Fenna', 'Old Tam'], 'Marrit stayed at the quay; "- present Marrit" is not refused');
        const chat = host.ctx.chat;
        assert.equal(hasReplyRecord(chat, 0), false, 'the greeting');
        const replies = chat.map((message, index) => (!message.is_user && index > 0 ? index : -1)).filter(index => index >= 0);
        assert.deepEqual(replies.map(index => hasReplyRecord(chat, index)), replies.map(() => true));
    } finally {
        host.close?.();
    }
});
