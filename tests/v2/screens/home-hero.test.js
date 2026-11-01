// Home under the game view's header (screens/home.js): the header has the place, the time, the weather and the people, so Home's
// Where card is left out while the header is up (`settings._heroShown`, set by the game view) and kept where there is none. The
// cards size to their content, three to a row on a wide screen and one on a phone, and the save points are one slim row at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { homeScreen } from '../../../src/v2/screens/home.js';
import { createScreenMount } from '../../../src/v2/view/mounts/screen.js';
import { createScreens } from '../../../src/v2/view/screens.js';
import { fakeRenderer, setupDom, stateWith } from '../view/mounts/helpers.js';
import { core, queries, recordingWidgets, renderSkip, sceneState, show, text } from './helpers.js';

const classes = el => el.querySelectorAll('section').map(section => section.className);

test('under the header, Home has no Where card (and no place, weather or people pencils of its own); the rest stays', { skip: renderSkip }, () => {
    const module = core();
    const state = sceneState(module);
    const { drawn, widgets } = recordingWidgets();
    const { el, view } = show(homeScreen, { state, query: queries(module, state), widgets, settings: { _heroShown: true } });
    assert.deepEqual(view.warnings, []);
    assert.deepEqual(classes(el), ['panel purse']);
    assert.equal(el.querySelector('.place'), null);
    assert.equal(el.querySelector('.here'), null);
    assert.equal(el.querySelector('.time'), null);
    assert.equal(text(el.querySelector('.wallet')), '125 gold · 6 things carried');
    assert.ok(drawn['story-block.savepoints'], 'the host widgets still have their slots');
});

test('where there is no header above Home (no chat yet, or a host without one) the Where card stays', { skip: renderSkip }, () => {
    const module = core();
    const state = sceneState(module);
    for (const settings of [{}, { _heroShown: false }]) {
        const { el } = show(homeScreen, { state, query: queries(module, state), widgets: recordingWidgets().widgets, settings });
        assert.deepEqual(classes(el), ['panel scene', 'panel purse'], JSON.stringify(settings));
        assert.equal(text(el.querySelector('.place')), 'Bluewatch Village · Lakeshore');
        assert.equal(text(el.querySelector('.here')), 'Here: Fenna, Old Tam');
    }
});

test('the game view tells Home whether its header is up: before the first draw, on every redraw, and when it goes', () => {
    const doc = setupDom();
    const screens = createScreens({ reader: () => ({}), saveReader: () => {} });
    screens.addModule('test', [{ id: 'test/one', title: 'One', icon: 'fa-star', mounts: ['screen'], template: '<p>One</p>' }]);
    const render = fakeRenderer();
    let header = { name: 'Ren', bars: [], statuses: [] };
    const mount = createScreenMount({ screens: { ...screens, list: m => screens.list(m) }, render, head: () => stateWith(1), query: () => null, api: {},
        settings: () => ({ own: 1 }), heroOf: () => header, document: doc, container: () => doc.body });
    assert.equal(mount.open('test/one'), true);
    assert.equal(render.last().scope.settings._heroShown, true, 'the header is drawn before the screen, which knows it is there');
    assert.equal(render.last().scope.settings.own, 1, 'the module\'s own settings are kept');
    header = null;
    mount.update();
    assert.equal(render.last().scope.settings._heroShown, false, 'no header now: the card may come back');
    header = { name: 'Ren', bars: [], statuses: [] };
    mount.update();
    assert.equal(render.last().scope.settings._heroShown, true);
    mount.close();
});

test('a game view with no heroOf draws Home with the Where card', () => {
    const doc = setupDom();
    const screens = createScreens({ reader: () => ({}), saveReader: () => {} });
    screens.addModule('test', [{ id: 'test/one', title: 'One', icon: 'fa-star', mounts: ['screen'], template: '<p>One</p>' }]);
    const render = fakeRenderer();
    const mount = createScreenMount({ screens: { ...screens, list: m => screens.list(m) }, render, head: () => stateWith(1), query: () => null, api: {}, document: doc, container: () => doc.body });
    mount.open('test/one');
    assert.equal(render.last().scope.settings._heroShown, false);
    mount.close();
});

test('Home is a game view screen only: the Story panel and the dialogs never show it, so no other host shows it without the header', () => {
    assert.deepEqual([...homeScreen.mounts], ['screen']);
});

const css = homeScreen.css;
const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} has a rule`);
    return css.slice(at, css.indexOf('}', at));
};

test('the cards size to their content: one column, three from 760px, none stretched', () => {
    assert.match(rule('.home'), /grid-template-columns: minmax\(0, 1fr\);/, 'a phone: one column');
    assert.match(rule('.home'), /align-items: start;/);
    assert.doesNotMatch(css, /repeat\(auto-fit, minmax\(240px/, 'no more auto-fit columns that made five equal ones');
    assert.match(css, /@media \(min-width: 760px\) \{ \.home \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \} \}/);
});

test('the save points are one slim full-width row at the end: the slot is last, spans the row, and the card is a wrapping row', () => {
    const slots = [...homeScreen.template.matchAll(/class="([a-z-]+-slot)"/g)].map(match => match[1]);
    assert.equal(slots.at(-1), 'saves-slot', 'last in the page');
    assert.match(rule('.saves-slot, .blocks-slot'), /grid-column: 1 \/ -1;/);
    assert.match(rule('.saves'), /display: flex;[^}]*flex-direction: row;[^}]*flex-wrap: wrap;[^}]*align-items: center;/);
    assert.match(rule('.saves'), /padding-top: 10px;[^}]*padding-bottom: 10px;/, 'slim');
    assert.match(rule('.saves > .sb-save-form, .saves > .sb-save-list, .saves > .sb-save-status'), /flex: 1 1 100%;/, 'a list or the form takes the line under the title and the button');
});
