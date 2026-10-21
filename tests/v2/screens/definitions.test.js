// Story Block's default screens as data (SPEC §13.1–13.3): they validate, sit in the registry, read
// only queries that exist (or are documented for a module, and then answer null without it), and their
// CSS is scoped, small and follows SillyTavern's theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreens, resolveData, validateScreen, CSS_LIMIT } from '../../../src/v2/view/screens.js';
import {
    screens, inventoryScreen, sceneScreen, changesCardScreen, homeScreen,
    INVENTORY_SCREEN_ID, SCENE_SCREEN_ID, CHANGES_CARD_SCREEN_ID, HOME_SCREEN_ID,
} from '../../../src/v2/screens/index.js';
import { core, css, cssSkip, queries, sceneState } from './helpers.js';

// Queries of other modules the screens may read (MODULES.md §B–D, §F11).
const MODULE_QUERIES = new Set(['party.pc', 'combat.session', 'combat.offers', 'director.threads', 'quest.progress', 'npc.known']);

test('four default screens with the agreed ids and mounts', () => {
    assert.deepEqual(screens.map(screen => screen.id), [HOME_SCREEN_ID, INVENTORY_SCREEN_ID, SCENE_SCREEN_ID, CHANGES_CARD_SCREEN_ID]);
    assert.deepEqual(screens, [homeScreen, inventoryScreen, sceneScreen, changesCardScreen]);
    assert.deepEqual(inventoryScreen.mounts, ['tab', 'screen']);
    assert.deepEqual(sceneScreen.mounts, ['tab', 'screen']);
    assert.deepEqual(changesCardScreen.mounts, ['card']);
    assert.deepEqual(homeScreen.mounts, ['screen']);
    for (const screen of screens) {
        assert.match(screen.id, /^story-block\//);
        assert.equal(typeof screen.title, 'string');
        assert.match(screen.icon, /^fa-/);
        assert.equal(typeof screen.template, 'string');
        assert.equal(screen.layout, undefined);
        assert.ok(Object.isFrozen(screen), `${screen.id} is frozen`);
    }
});

test('every screen passes validateScreen', () => {
    for (const screen of screens) assert.deepEqual(validateScreen(screen, { id: screen.id }), [], screen.id);
});

test('the registry takes them as the core module\'s defaults', () => {
    let reader = {};
    const registry = createScreens({ reader: () => reader, saveReader: next => { reader = next; } });
    registry.addModule('story-block', screens);
    assert.deepEqual(registry.problems(), []);
    assert.deepEqual(registry.list('screen').map(entry => entry.id), [HOME_SCREEN_ID, INVENTORY_SCREEN_ID, SCENE_SCREEN_ID]);
    assert.deepEqual(registry.list('tab').map(entry => entry.id), [INVENTORY_SCREEN_ID, SCENE_SCREEN_ID]);
    assert.deepEqual(registry.list('card').map(entry => entry.id), [CHANGES_CARD_SCREEN_ID]);
    assert.deepEqual(registry.list('hud'), []);
    // A pack can override one by id; the reader can reset it to this default.
    registry.setPack('fancy', [{ ...inventoryScreen, title: 'Satchel' }]);
    assert.equal(registry.resolve(INVENTORY_SCREEN_ID).screen.title, 'Satchel');
    registry.reset(INVENTORY_SCREEN_ID);
    assert.equal(registry.resolve(INVENTORY_SCREEN_ID).screen, inventoryScreen);
});

test('data reads only Story Block\'s queries or documented module queries', () => {
    const module = core();
    for (const screen of screens) {
        for (const [alias, binding] of Object.entries(screen.data ?? {})) {
            const known = Object.hasOwn(module.queries, binding.query) || MODULE_QUERIES.has(binding.query);
            assert.ok(known, `${screen.id} data "${alias}" reads an unknown query "${binding.query}"`);
        }
    }
});

test('with Story Block alone, its queries answer and the modules\' come out null', () => {
    const module = core();
    const state = sceneState(module);
    const query = queries(module, state);
    const home = resolveData(homeScreen.data, query);
    assert.equal(home.ok, true);
    assert.equal(home.q.place.name, 'Bluewatch Village');
    assert.deepEqual(home.q.present, ['Fenna', 'Old Tam']);
    assert.deepEqual(home.q.wallet, { coin: 125 });
    assert.deepEqual(home.q.currency, { name: 'gold', short: 'g' });
    assert.equal(home.q.items.length, 6);
    for (const alias of ['pc', 'fight', 'offers', 'quests', 'progress']) assert.equal(home.q[alias], null, alias);
    assert.equal(home.problems.length, 5);
    const scene = resolveData(sceneScreen.data, query);
    assert.equal(scene.q.cast, null);
    // Quest progress follows the first quest's id ($quests.0.id).
    const asked = [];
    const withDirector = queries(module, state, {
        'director.threads': () => [{ id: 'th_aaaaaaaa', key: 'Granary Rats' }],
        'quest.progress': (s, args) => { asked.push(args); return { have: 1, need: 3, met: false }; },
    });
    assert.deepEqual(resolveData(homeScreen.data, withDirector).q.progress, { have: 1, need: 3, met: false });
    assert.deepEqual(asked, [{ id: 'th_aaaaaaaa' }]);
});

test('css is under 64 KB, follows SillyTavern\'s theme and has nothing the scoper drops', () => {
    for (const screen of screens) {
        const bytes = new TextEncoder().encode(screen.css).length;
        assert.ok(bytes < CSS_LIMIT, `${screen.id}: ${bytes} bytes`);
        assert.ok(screen.css.includes('var(--SmartThemeBodyColor'), `${screen.id} uses the theme's text colour`);
        assert.doesNotMatch(screen.css, /@import|position:\s*fixed|url\(|expression\(/i, screen.id);
        for (const [key, value] of Object.entries(screen.theme ?? {})) {
            assert.match(key, /^--[a-z0-9-]+$/);
            assert.equal(typeof value, 'string');
        }
    }
});

test('css scopes to the screen root without warnings', { skip: cssSkip }, () => {
    for (const screen of screens) {
        const scoped = css.scopeCss(screen.css, screen.id);
        assert.deepEqual(scoped.warnings, [], screen.id);
        const root = `[data-ss-screen="${screen.id}"]`;
        for (const rule of scoped.css.split('\n').filter(line => /\{/.test(line) && !/^\s*@/.test(line))) {
            assert.ok(rule.trimStart().startsWith(root), `${screen.id}: ${rule}`);
        }
        assert.ok(scoped.css.includes(`${root} {`), `${screen.id}: :root became the screen root`);
        if (screen.theme) assert.deepEqual(css.themeVars(screen.theme).warnings, [], screen.id);
    }
});
