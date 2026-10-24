// Home's layout (the CSS is the screen's own, src/v2/screens/home.js). The lead's hero card is the game view's header now
// (UI stage 5a, view/game-header.js), so Home has no hero rule. A quest's status tag wraps and never leaves its card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { homeScreen } from '../../../src/v2/screens/home.js';
import { core, queries, recordingWidgets, renderSkip, show, stocked, text } from './helpers.js';

const css = homeScreen.css;
const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} has a rule`);
    return css.slice(at, css.indexOf('}', at));
};

test('Home has no hero card: the game view header draws the lead on every screen', () => {
    assert.doesNotMatch(homeScreen.template, /class="panel hero"/);
    assert.doesNotMatch(homeScreen.template, /ss\.portrait/);
    assert.doesNotMatch(css, /\.hero\b/);
});

test('the section headings are the section label (a label and a hairline)', () => {
    assert.match(homeScreen.template, /<h4 class="ss-section-label">/);
    assert.equal((homeScreen.template.match(/<h4>/g) ?? []).length, 0, 'no plain heading left');
});

test('a quest\'s status tag wraps and never overflows its card', () => {
    assert.match(rule('.chip.status'), /max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
    assert.match(rule('.quest'), /min-width: 0;[^}]*overflow-wrap: anywhere;/);
});

test('a quest is a stacked block: the title, the status pill on its line, the goal under it with no dash', () => {
    assert.match(rule('.quest-head'), /display: flex;[^}]*flex-wrap: wrap;/);
    assert.match(rule('.quest-head > .status'), /flex-shrink: 0;[^}]*white-space: nowrap;/);
    assert.match(rule('.quest + .quest'), /margin-top: 8px;[^}]*border-top: 1px solid/);
    assert.match(rule('.quests ul'), /gap: 0;/);
    assert.match(rule('.quest-title'), /min-width: 0;[^}]*overflow-wrap: anywhere;/);
});

test('a quest draws its title, status and goal as separate lines; a long title wraps; no goal, no goal line', { skip: renderSkip }, () => {
    const module = core();
    const state = stocked(module);
    const long = 'The Long Road to the Granary of the Drowned Village Beyond the Western Marsh Gate';
    assert.ok(long.length >= 70);
    const board = {
        active: [{ id: 'th_aaaaaaaa', key: long, status: { state: 'notyet', text: 'Not yet: 1/3' }, goal: 'Bring the rats to Fenna', meter: false }],
        offers: [{ id: 'th_bbbbbbbb', key: 'Ferry Work', status: { state: 'offered', text: 'Offered' }, goal: '' }],
    };
    const { el, view } = show(homeScreen, { state, query: queries(module, state, { 'quest.board': () => board }), widgets: recordingWidgets().widgets });
    assert.deepEqual(view.warnings, []);
    const [first, second] = el.querySelectorAll('.quest');
    assert.equal(text(first.querySelector('.quest-title')), long);
    assert.equal(text(first.querySelector('.quest-head .status')), 'Not yet: 1/3');
    assert.equal(first.querySelector('.quest-head').querySelectorAll('.status').length, 1, 'the pill is in the head, not the goal');
    assert.equal(text(first.querySelector('.quest-goal')), 'Bring the rats to Fenna', 'no leading dash');
    assert.equal(second.className, 'quest offer');
    assert.equal(second.querySelector('.quest-goal'), null, 'no goal, no line');
});
