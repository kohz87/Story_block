// Inline game-icons.net SVG set (`gi-*`, UI stage step 7): path hygiene, `svgIcon` DOM construction,
// `iconNode` and `icon` fallback behaviour, the default game-view tab map, CSS rule and CC BY 3.0 credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_SET } from '../../../src/v2/view/icons/set.js';
import * as iconsModule from '../../../src/v2/view/icons/index.js';
import { TAB_ICONS, hasIcon, svgIcon, tabIcon } from '../../../src/v2/view/icons/index.js';
import { SVG_NS, iconNode } from '../../../src/v2/view/widgets/dom.js';
import { icon } from '../../../src/v2/view/mounts/common.js';
import { createScreenMount } from '../../../src/v2/view/mounts/screen.js';
import { createTabMount } from '../../../src/v2/view/mounts/tab.js';
import { DEFAULT_ORDER, HOME_ID, SUITE_NAV, createScreens } from '../../../src/v2/view/screens.js';
import { DIAGNOSTICS_TEXT } from '../../../src/v2/host-ui.js';
import { installDom } from './widgets/fake-dom.js';
import { setupDom, stateWith } from './mounts/helpers.js';

const readRepo = rel => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

const EXPECTED_IDS = [
    // game view tabs
    'gi-home', 'gi-party', 'gi-inventory', 'gi-quests', 'gi-world', 'gi-map',
    'gi-fight', 'gi-crafting', 'gi-trade', 'gi-chronicle', 'gi-director', 'gi-dossiers',
    // items
    'gi-weapon', 'gi-armor', 'gi-shield', 'gi-helmet', 'gi-accessory', 'gi-consumable',
    'gi-food', 'gi-material', 'gi-tool', 'gi-key', 'gi-quest-item', 'gi-gold', 'gi-gem',
    // stats and status
    'gi-health', 'gi-mana', 'gi-stamina', 'gi-strength', 'gi-agility',
    'gi-intellect', 'gi-defense', 'gi-luck', 'gi-level-up', 'gi-experience',
    // skills
    'gi-skill', 'gi-locked', 'gi-learned', 'gi-closed',
    // misc
    'gi-settings', 'gi-save', 'gi-dice', 'gi-weather', 'gi-time', 'gi-place',
];

test('ICON_SET: frozen map of gi-* ids with clean SVG path data and no 512x512 background square', () => {
    assert.ok(Object.isFrozen(ICON_SET));
    const ids = Object.keys(ICON_SET);
    assert.ok(ids.length >= 40, `expected at least 40 icons, got ${ids.length}`);
    for (const id of EXPECTED_IDS) assert.ok(Object.hasOwn(ICON_SET, id), `missing ${id}`);
    for (const [id, entry] of Object.entries(ICON_SET)) {
        assert.match(id, /^gi-[a-z0-9]+(?:-[a-z0-9]+)*$/, id);
        assert.ok(Object.isFrozen(entry), `${id} entry is frozen`);
        assert.equal(typeof entry.path, 'string', `${id} path`);
        assert.ok(entry.path.trim().length > 20, `${id} path is non-empty`);
        assert.ok(!entry.path.includes('<') && !entry.path.includes('>'), `${id} path has no angle brackets`);
        assert.ok(!/['"`]/.test(entry.path), `${id} path has no quotes`);
        assert.match(entry.path, /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/, `${id} path has only SVG path-data characters`);
        assert.doesNotMatch(
            entry.path,
            /(?:^|\s)M\s*0[\s,]+0\s*(?:h\s*512\s*v\s*512\s*H\s*0|v\s*512\s*h\s*512\s*V\s*0|L\s*512[\s,]+0[\s,]+512[\s,]+512[\s,]+0[\s,]+512)\s*[zZ]?/,
            `${id} has no 512 square background path`,
        );
        assert.equal(typeof entry.author, 'string', `${id} author`);
        assert.ok(entry.author.trim().length > 0, `${id} author is non-empty`);
        assert.match(entry.source, /^https:\/\/game-icons\.net\/1x1\/[a-z0-9-]+\/[a-z0-9-]+\.html$/, `${id} source`);
    }
});

test('hasIcon and svgIcon: builds <svg> + one <path> via createElementNS only, never HTML parsing', () => {
    const doc = installDom();
    for (const id of Object.keys(ICON_SET)) assert.equal(hasIcon(id), true, id);
    for (const bad of ['', 'fa-house', 'gi-does-not-exist', 'home', null, undefined, 42]) {
        assert.equal(hasIcon(bad), false, String(bad));
        assert.equal(svgIcon(doc, bad), null, String(bad));
    }

    const node = svgIcon(doc, 'gi-home', 'ss-w-icon');
    assert.ok(node);
    assert.equal(node.tagName, 'svg');
    assert.equal(node.namespaceURI, SVG_NS);
    assert.equal(node.getAttribute('viewBox'), '0 0 512 512');
    assert.equal(node.getAttribute('fill'), 'currentColor');
    assert.equal(node.getAttribute('aria-hidden'), 'true');
    assert.equal(node.getAttribute('focusable'), 'false');
    assert.equal(node.getAttribute('width'), '1em');
    assert.equal(node.getAttribute('height'), '1em');
    assert.equal(node.getAttribute('class'), 'ss-w-icon ss-icon-svg');
    assert.equal(node.children.length, 1);
    const path = node.children[0];
    assert.equal(path.tagName, 'path');
    assert.equal(path.namespaceURI, SVG_NS);
    assert.equal(path.getAttribute('d'), ICON_SET['gi-home'].path);

    const bare = svgIcon(doc, 'gi-dice');
    assert.equal(bare.getAttribute('class'), 'ss-icon-svg');

    for (const file of ['src/v2/view/icons/index.js', 'src/v2/view/icons/set.js']) {
        const src = readRepo(file);
        assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|DOMParser/, file);
    }
    assert.match(readRepo('src/v2/view/icons/index.js'), /createElementNS\(/);
});

test('iconNode and mounts icon: gi-* draws SVG, FA names keep their <i>, unknown gi-* falls back to default FA icon', () => {
    const doc = installDom();

    const gi = iconNode(doc, 'gi-weapon', 'ss-tile-icon');
    assert.equal(gi.tagName, 'svg');
    assert.equal(gi.getAttribute('class'), 'ss-tile-icon ss-icon-svg');
    assert.equal(gi.children[0].getAttribute('d'), ICON_SET['gi-weapon'].path);

    const fa = iconNode(doc, 'fa-bolt', 'ss-tile-icon');
    assert.equal(fa.tagName, 'I');
    assert.equal(fa.getAttribute('class'), 'ss-tile-icon fa-solid fa-bolt');
    assert.equal(fa.getAttribute('aria-hidden'), 'true');

    const faReg = iconNode(doc, 'fa-regular fa-compass');
    assert.equal(faReg.tagName, 'I');
    assert.equal(faReg.getAttribute('class'), 'ss-w-icon fa-regular fa-compass');

    const unknownGi = iconNode(doc, 'gi-not-a-real-icon', 'ss-tile-icon');
    assert.equal(unknownGi.tagName, 'I');
    assert.equal(unknownGi.getAttribute('class'), 'ss-tile-icon fa-solid fa-table-columns');
    assert.equal(unknownGi.getAttribute('aria-hidden'), 'true');

    const mountDoc = setupDom();
    const mountGi = icon(mountDoc, 'gi-quests');
    assert.equal(mountGi.tagName.toLowerCase(), 'svg');
    assert.equal(mountGi.getAttribute('class'), 'ss-icon-svg');
    assert.equal(mountGi.children[0].getAttribute('d'), ICON_SET['gi-quests'].path);

    const mountFa = icon(mountDoc, 'fa-star');
    assert.equal(mountFa.tagName.toLowerCase(), 'i');
    assert.equal(mountFa.className, 'fa-solid fa-star');
    assert.equal(mountFa.getAttribute('aria-hidden'), 'true');

    const mountUnknown = icon(mountDoc, 'gi-missing');
    assert.equal(mountUnknown.tagName.toLowerCase(), 'i');
    assert.equal(mountUnknown.className, 'fa-solid fa-table-columns');
    assert.equal(mountUnknown.getAttribute('aria-hidden'), 'true');
});

test('TAB_ICONS: one exported frozen map in icons/index.js; every tab id resolves and drives the game view when a screen gives no icon', () => {
    const exportedObjects = Object.entries(iconsModule).filter(([, v]) => typeof v === 'object' && v !== null);
    assert.equal(exportedObjects.length, 1, 'one exported frozen object in icons/index.js');
    assert.equal(exportedObjects[0][1], TAB_ICONS);
    assert.ok(Object.isFrozen(TAB_ICONS));

    for (const [tabId, iconId] of Object.entries(TAB_ICONS)) {
        assert.ok(hasIcon(iconId), `${tabId} -> ${iconId} resolves in ICON_SET`);
    }
    for (const id of ['home', 'dossiers', ...Object.keys(DEFAULT_ORDER), HOME_ID, ...SUITE_NAV]) {
        const resolved = tabIcon(id);
        assert.ok(hasIcon(resolved), `${id} -> ${resolved}`);
    }

    // Game view navigation and tab mount use the default gi-* icon when the screen gives none.
    const doc = setupDom();
    const screens = createScreens({ reader: () => ({}), saveReader: () => {} });
    screens.addModule('story-block', [
        { id: 'story-block/home', title: 'Home', mounts: ['screen'], template: '<p>Home</p>' },
        { id: 'story-block/inventory', title: 'Inventory', mounts: ['screen', 'tab'], template: '<p>Bag</p>' },
    ]);
    screens.addModule('rpg-battle', [
        { id: 'rpg-battle/party', title: 'Party', icon: 'fa-users', mounts: ['screen', 'tab'], template: '<p>Party</p>' },
    ]);
    const deps = {
        screens,
        render: () => {},
        head: () => stateWith(1),
        query: () => null,
        document: doc,
        container: () => doc.body,
    };
    const view = createScreenMount(deps);
    assert.equal(view.open('story-block/home'), true);
    const items = doc.body.querySelectorAll('.ss-gameview-navitem');
    assert.equal(items.length, 3);
    assert.equal(items[0].querySelector('svg')?.getAttribute('data-icon'), 'gi-home');
    assert.equal(items[1].querySelector('i')?.className, 'fa-solid fa-users', 'explicit screen icon wins');
    assert.equal(items[2].querySelector('svg')?.getAttribute('data-icon'), 'gi-inventory');
    view.close();

    const added = [];
    const tabs = createTabMount({ ...deps, addTab: tab => added.push(tab) });
    tabs.register();
    assert.deepEqual(added.map(t => [t.id, t.icon]), [
        ['rpg-battle/party', 'fa-users'],
        ['story-block/inventory', 'gi-inventory'],
    ]);
});

test('CSS and credits: .ss-icon-svg in glass.css, every icon credited in ICONS-CREDITS.md, credit line in README and Diagnostics', () => {
    const glass = readRepo('src/v2/view/glass.css');
    assert.match(glass, /:where\([^)]+\) \.ss-icon-svg \{\s*width: 1em;\s*height: 1em;\s*vertical-align: -0\.125em;\s*flex: none;\s*\}/);

    const credits = readRepo('ICONS-CREDITS.md');
    assert.ok(credits.includes('CC BY 3.0 https://creativecommons.org/licenses/by/3.0/'));
    for (const [id, entry] of Object.entries(ICON_SET)) {
        assert.ok(credits.includes(`\`${id}\``), `ICONS-CREDITS.md lists ${id}`);
        assert.ok(credits.includes(entry.author), `ICONS-CREDITS.md lists author for ${id}`);
        assert.ok(credits.includes(entry.source), `ICONS-CREDITS.md lists link for ${id}`);
    }

    const line = 'Icons from game-icons.net by their authors, CC BY 3.0.';
    assert.ok(readRepo('README.md').includes(line), 'README.md includes credit line');
    assert.equal(DIAGNOSTICS_TEXT.credits, line);
    const widgetsDoc = readRepo('docs/v2/WIDGETS.md');
    assert.match(widgetsDoc, /gi-home/);
    assert.match(widgetsDoc, /fa-table-columns/);
    assert.match(widgetsDoc, /ICONS-CREDITS\.md/);
});
