// The blocks built from the building blocks (UI stage 1b): ss.hero, ss.tiers, ss.listcard, ss.tabs, ss.navbar and
// ss.dialog (view/widgets/hero.js, tiers.js, listcard.js, nav.js, dialog.js): what each draws (the glass.css
// classes), how it updates, what it says to a screen reader, its keys, and the one command each may run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hero, heroBars, heroLevel, heroLine, heroPicture } from '../../../../src/v2/view/widgets/hero.js';
import { tiers, tierList } from '../../../../src/v2/view/widgets/tiers.js';
import { listcard, listRows } from '../../../../src/v2/view/widgets/listcard.js';
import { navItems, navbar, revealItem, tabs } from '../../../../src/v2/view/widgets/nav.js';
import { dialog, dialogActions, dialogParagraphs } from '../../../../src/v2/view/widgets/dialog.js';
import { standardWidgets } from '../../../../src/v2/view/widgets/index.js';
import { fakeApi, host, installDom } from './fake-dom.js';

function mount(widget, props, api = fakeApi()) {
    const doc = installDom();
    const el = host(doc);
    const handle = widget.render(el, props, api);
    return { doc, el, api, handle, root: el.children[0] };
}
const classes = node => (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const key = (node, name, init = {}) => node.dispatch('keydown', { key: name, ...init });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('the six are standard widgets by their ss. names', () => {
    for (const [name, widget] of [['ss.hero', hero], ['ss.tiers', tiers], ['ss.listcard', listcard], ['ss.tabs', tabs], ['ss.navbar', navbar], ['ss.dialog', dialog]]) assert.equal(standardWidgets[name], widget, name);
});

// ---- hero --------------------------------------------------------------------------------------------

const HERO = {
    name: 'Astra', portrait: PNG, className: 'Soul Class II', level: '12', title: 'Wayfarer', place: 'North Cut', time: '07:20', weather: 'Drizzle',
    bars: [{ kind: 'hp', label: 'HP', value: 50, max: 82 }, { kind: 'mp', label: 'MP', value: 32, max: 40 }, { kind: 'sp', label: 'SP', value: 30, max: 34 }, { kind: 'exp', label: 'Soul growth', value: 640, max: 1000 }],
    statuses: [{ id: 'bleed', label: 'Bleeding', icon: 'fa-droplet', left: 40, unit: 'minutes', tone: 'bad' }, { label: 'Blessed', left: null }],
};

test('hero: name, the class · title line, the level badge, HP/MP/SP bars and the experience word, corner, badges', () => {
    const m = mount(hero, HERO);
    assert.ok(classes(m.root).includes('ss-hero') && classes(m.root).includes('ss-glass'));
    assert.equal(m.root.getAttribute('aria-label'), 'Character: Astra');
    assert.equal(m.el.querySelector('.ss-hero-name').textContent, 'Astra');
    assert.equal(m.el.querySelector('.ss-hero-pill').textContent, 'Soul Class II · Wayfarer');
    assert.ok(!classes(m.el.querySelector('.ss-hero-pill')).includes('ss-pill'), 'the line is plain text, not a pill');
    const badge = m.el.querySelector('.ss-hero-level');
    assert.ok(classes(badge.parentNode).includes('ss-hero-face'), 'the badge lives in the portrait\'s cell');
    assert.ok(classes(m.el.querySelector('.ss-hero-portrait').parentNode).includes('ss-hero-face'));
    assert.equal(badge.hidden, false);
    assert.equal(badge.querySelector('.ss-hero-level-number').textContent, '12');
    assert.equal(badge.querySelector('.ss-hero-level-number').getAttribute('aria-hidden'), 'true');
    assert.equal(badge.querySelector('.ss-visually-hidden').textContent, 'Lv 12');
    assert.equal(badge.querySelector('svg').getAttribute('data-icon'), 'ph-star');
    assert.equal(badge.querySelector('svg').getAttribute('data-weight'), 'fill');
    const pools = m.el.querySelector('.ss-hero-pools');
    assert.deepEqual(pools.querySelectorAll('.ss-bar').map(node => classes(node).find(c => /^ss-bar-/.test(c))), ['ss-bar-hp', 'ss-bar-mp', 'ss-bar-sp']);
    const exp = m.el.querySelector('.ss-hero-exp');
    assert.equal(exp.querySelector('.ss-bar-label').textContent, 'Soul growth', 'the Terms word, as given');
    assert.ok(classes(exp.querySelector('.ss-bar')).includes('ss-bar-exp'));
    assert.equal(exp.querySelector('.ss-bar').getAttribute('aria-valuetext'), '640 / 1000');
    assert.deepEqual(m.el.querySelectorAll('.ss-hero-corner-item').map(node => node.getAttribute('data-kind')), ['time', 'place', 'weather']);
    assert.deepEqual(m.el.querySelectorAll('.ss-hero-corner-text').map(node => node.textContent), ['07:20', 'North Cut', 'Drizzle']);
    assert.equal(m.el.querySelectorAll('.ss-status').length, 2);
    assert.equal(m.el.querySelector('.ss-status').getAttribute('aria-label'), 'Bleeding: 40 story minutes left');
    assert.ok(!classes(m.root).includes('ss-hero-compact'));
    // Compact: the same card in a one-row variant; no api command is ever run (read-only).
    m.handle.update({ ...HERO, compact: true });
    assert.ok(classes(m.root).includes('ss-hero-compact'));
    assert.equal(m.el.children.length, 1);
    assert.equal(m.api.commands.length, 0);
    // Nothing given: no pill, no corner, no bars; the root says "Character".
    m.handle.update({});
    assert.equal(m.root.getAttribute('aria-label'), 'Character');
    assert.ok(m.el.querySelector('.ss-hero-pill').hidden && m.el.querySelector('.ss-hero-corner').hidden && m.el.querySelector('.ss-hero-vitals').hidden && m.el.querySelector('.ss-hero-statuses').hidden);
    assert.equal(m.el.querySelectorAll('.ss-bar').length, 0);
});

test('heroLine, heroLevel and heroBars: the line under the name, the badge, at most six bars', () => {
    assert.equal(heroLine({ line: 'Wayfarer of the Lowmere' }), 'Wayfarer of the Lowmere');
    assert.equal(heroLine({ className: 'Mage', level: '3' }), 'Mage', 'the level is the badge, not the line');
    assert.equal(heroLine({ className: 'Mage', title: 'Wayfarer' }), 'Mage · Wayfarer');
    assert.deepEqual(heroLevel({ level: 'Lv 7' }), { number: '7', label: 'Lv 7' });
    assert.deepEqual(heroLevel({ level: '3' }), { number: '3', label: 'Lv 3' });
    assert.deepEqual(heroLevel({ level: 'Rank 12' }), { number: '12', label: 'Rank 12' });
    assert.deepEqual(heroLevel({ level: 'Elder' }), { number: 'Elder', label: 'Elder' });
    assert.deepEqual(heroLevel({}), { number: '', label: '' });
    const ancients = heroLevel({ level: 'Level of the Ancients 73' });
    assert.deepEqual(ancients, { number: '73', label: 'Level of the Ancients 73' }, 'a long level keeps its number and its whole label');
    const nines = heroLevel({ level: '9'.repeat(70) });
    assert.ok(nines.number.length <= 8, 'the badge text is short');
    assert.ok(nines.label.length > 40 && nines.label.startsWith('Lv 999'), 'the label keeps the level, not a 12-character cut');
    assert.equal(heroLine({ title: 'Wayfarer' }), 'Wayfarer');
    assert.equal(heroLine({}), '');
    assert.equal(heroBars(Array.from({ length: 9 }, () => ({ kind: 'hp', label: 'x' }))).length, 6);
    assert.deepEqual(heroBars([null, 3, { label: 'a', value: 1, max: 2 }]).map(b => b.label), ['a']);
});

test('hero portrait: a safe picture, else the initial; a picture that fails to load goes back to the initial', () => {
    const m = mount(hero, { name: 'Ren Avel', portrait: 'https://example.com/ren.png' });
    const img = m.el.querySelector('.ss-hero-img');
    const initial = m.el.querySelector('.ss-hero-initial');
    assert.equal(img.getAttribute('src'), 'https://example.com/ren.png');
    assert.ok(!img.hidden && initial.hidden);
    assert.equal(initial.textContent, 'RA');
    assert.equal(m.el.querySelector('.ss-hero-portrait').getAttribute('aria-label'), 'Portrait of Ren Avel');
    img.dispatch('error');
    assert.ok(img.hidden && !initial.hidden);
    assert.ok(classes(m.el.querySelector('.ss-hero-portrait')).includes('ss-hero-fallback'));
    m.handle.update({ name: 'Ren Avel', portrait: 'https://example.com/ren.png' });
    assert.ok(img.hidden, 'the URL that failed is not tried again');
    m.handle.update({ name: 'Ren Avel', portrait: 'javascript:alert(1)' });
    assert.ok(img.hidden && !img.getAttribute('src'));
    m.handle.update({ name: 'Ren Avel', portrait: '/User Avatars/ren.png' });
    assert.equal(img.getAttribute('src'), '/User Avatars/ren.png');
    assert.ok(!img.hidden && initial.hidden);
});

test('hero portrait from a query (Delta\'s npc.portrait): asked first, checked like any URL, the card\'s picture after it', () => {
    const calls = [];
    const api = { ...fakeApi(), query: (name, args) => { calls.push([name, args]); return 'https://example.com/mira.png'; } };
    const m = mount(hero, { name: 'Mira', portrait: PNG, portraitQuery: 'npc.portrait', portraitArgs: { name: 'Mira' } }, api);
    assert.deepEqual(calls, [['npc.portrait', { name: 'Mira' }]]);
    assert.equal(m.el.querySelector('.ss-hero-img').getAttribute('src'), 'https://example.com/mira.png');
    // An answer that is not a safe picture (or null): the card's own picture, then the initial.
    assert.equal(heroPicture({ portrait: PNG, portraitQuery: 'npc.portrait' }, { query: () => 'javascript:alert(1)' }), PNG);
    assert.equal(heroPicture({ portrait: '', portraitQuery: 'npc.portrait' }, { query: () => null }), '');
    assert.equal(heroPicture({ portrait: PNG, portraitQuery: 'npc.portrait' }, { query: () => { throw new Error('no'); } }), PNG, 'a query that throws is not the reader\'s problem');
    assert.equal(heroPicture({ portraitQuery: 'npc.portrait' }, { query: () => ({ url: PNG }) }), PNG, 'an answer { url }');
    // A name that does not look like a query is never asked; no query function: the picture.
    let asked = 0;
    for (const bad of ['<img src=x onerror=1>', 'a b', '../x', '', 'x'.repeat(300), 'Npc.portrait', 'npc..portrait']) {
        assert.equal(heroPicture({ portrait: PNG, portraitQuery: bad }, { query: () => { asked += 1; return 'https://example.com/x.png'; } }), PNG, bad);
    }
    assert.equal(asked, 0);
    assert.equal(heroPicture({ portrait: PNG, portraitQuery: 'npc.portrait' }, {}), PNG);
});

// ---- tiers -------------------------------------------------------------------------------------------

const TIERS = {
    tiers: [
        { title: 'Basic', tiles: [{ id: 'moon', label: 'Moonlight Slash', icon: 'fa-wand-sparkles', count: '3', hint: 'Lv 3' }, { id: 'blade', label: 'Blade Soul', count: '2' }] },
        { title: 'Advanced', tiles: [{ id: 'frost', label: 'Frost Hex', state: 'ready' }, { id: 'death', label: 'Death Soul', state: 'locked' }] },
        { title: 'Finisher', tiles: [{ id: 'phantom', label: 'Phantom Flash' }] },
    ],
};

test('tiers: a label and a glass grid of tiles per tier, a connector between tiers, the columns set on the grid', () => {
    const m = mount(tiers, { ...TIERS, columns: 2, label: 'Skills' });
    assert.ok(classes(m.root).includes('ss-tiers'));
    assert.equal(m.root.getAttribute('aria-label'), 'Skills');
    assert.deepEqual(m.el.querySelectorAll('.ss-tiers-label').map(node => node.textContent), ['Basic', 'Advanced', 'Finisher']);
    assert.equal(m.el.querySelectorAll('.ss-tiers-link').length, 2, 'one fewer than the tiers');
    assert.equal(m.el.querySelectorAll('.ss-tiers-dot').length, 2);
    assert.equal(m.el.querySelectorAll('.ss-tiers-line').length, 2);
    const grids = m.el.querySelectorAll('.ss-tiers-grid');
    assert.equal(grids.length, 3);
    assert.ok(classes(grids[0]).includes('ss-glass'));
    assert.equal(grids[0].style.getPropertyValue('--ss-cols'), '2');
    assert.equal(m.el.querySelectorAll('.ss-tile').length, 5);
    assert.equal(m.el.querySelectorAll('.ss-tiers-tier')[1].getAttribute('aria-label'), 'Advanced');
    // Columns are 1–6; anything else falls back or is clamped.
    m.handle.update({ ...TIERS, columns: 99 });
    assert.equal(m.el.querySelector('.ss-tiers-grid').style.getPropertyValue('--ss-cols'), '6');
    m.handle.update({ ...TIERS, columns: 'x' });
    assert.equal(m.el.querySelector('.ss-tiers-grid').style.getPropertyValue('--ss-cols'), '3');
    // Without onSelect the tiles are not buttons.
    assert.equal(m.el.querySelectorAll('button').length, 0);
});

test('tiers with onSelect: a tile is a button running { tiers: id }, shown chosen at once; a locked one is not a button; the screen\'s `selected` wins', () => {
    const m = mount(tiers, { ...TIERS, selected: 'frost', onSelect: 'party.pickSkill' });
    const buttons = m.el.querySelectorAll('button');
    assert.equal(buttons.length, 4, 'the locked tile is a group');
    const pressed = () => m.el.querySelectorAll('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.getAttribute('aria-label'));
    assert.deepEqual(pressed(), ['Frost Hex, ready']);
    const first = buttons[0];
    first.click();
    assert.deepEqual(m.api.commands, [{ type: 'party.pickSkill', payload: { tiers: 'moon' } }]);
    assert.deepEqual(pressed(), ['Moonlight Slash, Lv 3']);
    assert.equal(m.el.querySelectorAll('button')[0], first, 'updated in place: the same button, so the focus stays');
    // A redraw with the same selection keeps the reader's choice; another selection wins.
    m.handle.update({ ...TIERS, selected: 'frost', onSelect: 'party.pickSkill' });
    assert.deepEqual(pressed(), ['Moonlight Slash, Lv 3']);
    m.handle.update({ ...TIERS, selected: 'phantom', onSelect: 'party.pickSkill' });
    assert.deepEqual(pressed(), ['Phantom Flash']);
    // Another shape: drawn again, with no doubled root.
    m.handle.update({ tiers: [{ title: 'Only', tiles: [{ id: 'a', label: 'A' }] }], onSelect: 'party.pickSkill' });
    assert.equal(m.el.children.length, 1);
    assert.equal(m.el.querySelectorAll('.ss-tile').length, 1);
    assert.equal(m.el.querySelectorAll('.ss-tiers-link').length, 0);
    // Without an api the choice still shows and nothing throws.
    const bare = mount(tiers, { ...TIERS, onSelect: 'x.y' }, undefined);
    bare.el.querySelectorAll('button')[1].click();
});

test('tierList: caps and junk', () => {
    assert.equal(tierList(Array.from({ length: 20 }, () => ({ title: 't', tiles: [] }))).length, 12);
    assert.equal(tierList([{ tiles: Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, label: 'x' })) }])[0].tiles.length, 24);
    assert.deepEqual(tierList([null, 5, { title: 'a', tiles: [null, {}, { label: 'ok' }] }]).map(t => t.tiles.map(x => x.id)), [['ok']]);
    assert.deepEqual(tierList('nope'), []);
});

// ---- listcard ----------------------------------------------------------------------------------------

const ROWS = {
    title: 'Ready to turn in',
    rows: [{ id: 'wolf', title: 'The North Cut Wolf', sub: 'to Elula · here', value: '4 silver' }, { id: 'kroll', title: 'Master Kroll', tag: 'new', tone: 'good', icon: 'fa-user' }, {}, { id: 'x' }],
};

test('listcard: a glass card of rows with title, sub, a value or a tag in a tone; empty rows left out', () => {
    const m = mount(listcard, ROWS);
    assert.ok(classes(m.root).includes('ss-listcard') && classes(m.root).includes('ss-glass'));
    assert.equal(m.root.tagName, 'SECTION');
    assert.equal(m.root.getAttribute('aria-label'), 'Ready to turn in');
    assert.equal(m.el.querySelector('.ss-listcard-head').textContent, 'Ready to turn in');
    assert.equal(m.el.querySelectorAll('.ss-listcard-row').length, 2);
    assert.deepEqual(m.el.querySelectorAll('.ss-listcard-title').map(node => node.textContent), ['The North Cut Wolf', 'Master Kroll']);
    assert.equal(m.el.querySelector('.ss-listcard-sub').textContent, 'to Elula · here');
    assert.equal(m.el.querySelector('.ss-listcard-value').textContent, '4 silver');
    const tag = m.el.querySelector('.ss-listcard-tag');
    assert.equal(tag.textContent, 'new');
    assert.ok(classes(tag).includes('ss-tone-good'));
    assert.ok(m.el.querySelector('i.fa-user'));
    assert.equal(m.el.querySelectorAll('button').length, 0, 'no onSelect: no buttons');
    m.handle.update({ rows: [{ title: 'a', tag: 'x', tone: 'neon' }] });
    assert.ok(!classes(m.el.querySelector('.ss-listcard-tag')).some(c => c.startsWith('ss-tone-')), 'an unknown tone: none');
    assert.ok(m.el.querySelector('.ss-listcard-head').hidden);
    assert.equal(m.root.getAttribute('aria-label'), null);
    m.handle.update({ rows: [], empty: 'Nothing is ready.' });
    assert.equal(m.el.querySelector('.ss-listcard-empty').textContent, 'Nothing is ready.');
    assert.ok(m.el.querySelector('.ss-listcard-rows').hidden && !m.el.querySelector('.ss-listcard-empty').hidden);
});

test('listcard with onSelect: each row a button running { listcard: id }; the chosen row is aria-current; the screen\'s `selected` wins', () => {
    const m = mount(listcard, { ...ROWS, selected: 'kroll', onSelect: 'quests.open' });
    const buttons = () => m.el.querySelectorAll('button');
    assert.equal(buttons().length, 2);
    assert.deepEqual(buttons().map(b => b.getAttribute('aria-current')), [null, 'true']);
    buttons()[0].click();
    assert.deepEqual(m.api.commands, [{ type: 'quests.open', payload: { listcard: 'wolf' } }]);
    assert.deepEqual(buttons().map(b => b.getAttribute('aria-current')), ['true', null]);
    // Focus stays on the row through a redraw.
    buttons()[0].focus();
    m.handle.update({ ...ROWS, selected: 'kroll', onSelect: 'quests.open' });
    assert.equal(m.doc.activeElement, buttons()[0]);
    assert.deepEqual(buttons().map(b => b.getAttribute('aria-current')), ['true', null], 'the same selection prop: the reader\'s choice stays');
    m.handle.update({ ...ROWS, selected: 'wolf', onSelect: 'quests.open' });
    m.handle.update({ ...ROWS, selected: 'kroll', onSelect: 'quests.open' });
    assert.deepEqual(buttons().map(b => b.getAttribute('aria-current')), [null, 'true']);
    assert.deepEqual(listRows(Array.from({ length: 150 }, (_, i) => ({ title: `r${i}` }))).length, 100);
    assert.equal(listRows([{ title: 'a'.repeat(300) }])[0].title.length, 80);
});

// ---- tabs and navbar ---------------------------------------------------------------------------------

const ITEMS = { items: [{ id: 'world', label: 'World' }, { id: 'quests', label: 'Quests', count: '3' }, { id: 'party', label: 'Party', disabled: true }, { id: 'bag', label: 'Bag' }], current: 'quests', onSelect: 'ui.go', label: 'Panel sections' };

for (const [kind, widget] of [['tabs', tabs], ['navbar', navbar]]) {
    test(`${kind}: a nav of buttons, the current one aria-current, a roving tabindex, a count chip, disabled ones skipped`, () => {
        const m = mount(widget, ITEMS);
        assert.equal(m.root.tagName, 'NAV');
        assert.ok(classes(m.root).includes(`ss-${kind}`));
        assert.equal(m.root.getAttribute('aria-label'), 'Panel sections');
        const buttons = m.el.querySelectorAll(`.ss-${kind}-item`);
        assert.deepEqual(buttons.map(b => b.querySelector(`.ss-${kind}-label`).textContent), ['World', 'Quests', 'Party', 'Bag']);
        assert.deepEqual(buttons.map(b => b.getAttribute('aria-current')), [null, 'page', null, null]);
        assert.deepEqual(buttons.map(b => b.getAttribute('tabindex')), ['-1', '0', '-1', '-1'], 'one Tab stop: the current item');
        assert.ok(buttons.every(b => b.getAttribute('type') === 'button'));
        assert.equal(buttons[1].getAttribute('aria-label'), 'Quests, 3');
        assert.equal(buttons[1].querySelector(`.ss-${kind}-count`).textContent, '3');
        assert.ok(buttons[2].disabled && buttons[2].getAttribute('aria-disabled') === 'true');
        // No current: the first enabled item is the stop.
        m.handle.update({ ...ITEMS, current: '' });
        assert.deepEqual(m.el.querySelectorAll(`.ss-${kind}-item`).map(b => b.getAttribute('tabindex')), ['0', '-1', '-1', '-1']);
        assert.ok(m.el.querySelectorAll(`.ss-${kind}-item`).every(b => b.getAttribute('aria-current') === null));
    });

    test(`${kind}: a choice runs { ${kind}: id } and shows at once; the screen's new \`current\` wins; a disabled item does nothing`, () => {
        const m = mount(widget, ITEMS);
        const buttons = () => m.el.querySelectorAll(`.ss-${kind}-item`);
        buttons()[3].click();
        assert.deepEqual(m.api.commands, [{ type: 'ui.go', payload: { [kind]: 'bag' } }]);
        assert.deepEqual(buttons().map(b => b.getAttribute('aria-current')), [null, null, null, 'page']);
        assert.equal(buttons()[3].getAttribute('tabindex'), '0');
        buttons()[2].click();
        assert.equal(m.api.commands.length, 1, 'disabled');
        m.handle.update(ITEMS);
        assert.equal(buttons()[3].getAttribute('aria-current'), 'page', 'the same prop: the reader\'s choice stays');
        m.handle.update({ ...ITEMS, current: 'world' });
        assert.deepEqual(buttons().map(b => b.getAttribute('aria-current')), ['page', null, null, null]);
        // No command and no api: still a working nav.
        const bare = mount(widget, { items: ITEMS.items }, undefined);
        bare.el.querySelectorAll(`.ss-${kind}-item`)[0].click();
        assert.equal(bare.el.querySelectorAll(`.ss-${kind}-item`)[0].getAttribute('aria-current'), 'page');
    });

    test(`${kind}: the arrow keys, Home and End move the focus (not the choice), skip disabled items and wrap`, () => {
        const m = mount(widget, ITEMS);
        const buttons = () => m.el.querySelectorAll(`.ss-${kind}-item`);
        buttons()[1].focus();
        let event = key(buttons()[1], 'ArrowRight');
        assert.ok(event.defaultPrevented);
        assert.equal(m.doc.activeElement, buttons()[3], 'the disabled one is skipped');
        assert.equal(buttons()[3].getAttribute('tabindex'), '0');
        assert.equal(buttons()[1].getAttribute('tabindex'), '-1');
        key(buttons()[3], 'ArrowRight');
        assert.equal(m.doc.activeElement, buttons()[0], 'wraps to the first');
        key(buttons()[0], 'ArrowLeft');
        assert.equal(m.doc.activeElement, buttons()[3], 'and back');
        key(buttons()[3], 'Home');
        assert.equal(m.doc.activeElement, buttons()[0]);
        key(buttons()[0], 'End');
        assert.equal(m.doc.activeElement, buttons()[3]);
        key(buttons()[3], 'ArrowUp');
        assert.equal(m.doc.activeElement, buttons()[1]);
        event = key(buttons()[1], 'a');
        assert.ok(!event.defaultPrevented, 'other keys are left alone');
        assert.equal(m.api.commands.length, 0, 'moving the focus chooses nothing');
        assert.deepEqual(buttons().map(b => b.getAttribute('aria-current')), [null, 'page', null, null]);
        // A redraw keeps the focus on the same item.
        buttons()[3].focus();
        m.handle.update({ ...ITEMS, items: [...ITEMS.items, { id: 'fight', label: 'Fight' }] });
        assert.equal(m.doc.activeElement.getAttribute('data-id'), 'bag');
    });

    test(`${kind}: the item the focus moves to is scrolled into view when the row is wider than its box`, () => {
        const m = mount(widget, { ...ITEMS, items: Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` })), current: 'i0' });
        const list = m.el.querySelector(`.ss-${kind}-list`);
        list.rect = { left: 0, top: 0, width: 300, height: 50 };
        const buttons = m.el.querySelectorAll(`.ss-${kind}-item`);
        buttons.forEach((b, i) => { b.rect = { left: i * 100 - 40, top: 0, width: 90, height: 44 }; });
        buttons[0].focus();
        key(buttons[0], 'ArrowRight');
        key(buttons[1], 'ArrowRight');
        key(buttons[2], 'ArrowRight');
        assert.equal(list.scrolled.length, 1, 'only the item that was out of view');
        assert.deepEqual(list.scrolled[0], { left: 260 - (300 - 90) / 2, behavior: 'smooth' }, 'centred');
    });
}

test('revealItem: only an item that is cut off is scrolled, centred; nothing before layout', () => {
    const list = { getBoundingClientRect: () => ({ left: 0, right: 300, width: 300 }), scrollBy(o) { this.did = o; }, ownerDocument: {} };
    const item = rect => ({ getBoundingClientRect: () => rect });
    assert.equal(revealItem(list, item({ left: 10, right: 100, width: 90 })), false);
    assert.equal(revealItem(list, item({ left: 400, right: 490, width: 90 })), true);
    assert.deepEqual(list.did, { left: 400 - (300 - 90) / 2, behavior: 'auto' });
    revealItem(list, item({ left: -50, right: 40, width: 90 }), true);
    assert.deepEqual(list.did, { left: -50 - 105, behavior: 'smooth' });
    assert.equal(revealItem({ getBoundingClientRect: () => ({ left: 0, right: 0, width: 0 }) }, item({ left: 5, right: 9, width: 4 })), false, 'not laid out');
    assert.equal(revealItem(null, null), false);
    const plain = { getBoundingClientRect: () => ({ left: 0, right: 300, width: 300 }), scrollLeft: 20, ownerDocument: {} };
    revealItem(plain, item({ left: 400, right: 490, width: 90 }));
    assert.equal(plain.scrollLeft, 20 + 295, 'no scrollBy: scrollLeft');
    // Reduced motion: no smooth scrolling.
    const calm = { getBoundingClientRect: () => ({ left: 0, right: 300, width: 300 }), scrollBy(o) { this.did = o; }, ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
    revealItem(calm, item({ left: 400, right: 490, width: 90 }), true);
    assert.equal(calm.did.behavior, 'auto');
});

test('navItems: the first of each id, at most 24, text cut, junk dropped', () => {
    assert.equal(navItems(Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, label: 'x' }))).length, 24);
    assert.deepEqual(navItems([{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }, null, 7, {}, { label: 'No id' }]).map(i => [i.id, i.label]), [['a', 'A'], ['No id', 'No id']]);
    assert.equal(navItems([{ id: 'a', label: 'y'.repeat(99) }])[0].label.length, 40);
    assert.deepEqual(navItems('nope'), []);
});

// ---- dialog ------------------------------------------------------------------------------------------

const DIALOG = { title: 'Rest at the Guild Office?', text: 'Resting takes eight hours.\n\nThe bleeding will close.', actions: [{ id: 'cancel', label: 'Not now' }, { id: 'rest', label: 'Rest', kind: 'primary', icon: 'fa-moon' }], onSelect: 'ui.dialog' };

function openDialog(props = DIALOG, api = fakeApi()) {
    const doc = installDom();
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    const el = host(doc);
    const handle = dialog.render(el, props, api);
    return { doc, el, api, handle, opener, root: el.children[0], panel: el.querySelector('.ss-modal-panel') };
}

test('dialog: a labelled modal, described by its text, with its actions; the main action takes the focus', () => {
    const m = openDialog();
    assert.ok(classes(m.root).includes('ss-modal'), 'ss-modal*, not the mount\'s ss-dialog*');
    assert.ok(!m.el.querySelector('.ss-dialog'));
    assert.equal(m.panel.getAttribute('role'), 'dialog');
    assert.equal(m.panel.getAttribute('aria-modal'), 'true');
    const title = m.el.querySelector('.ss-modal-title');
    assert.equal(title.textContent, 'Rest at the Guild Office?');
    assert.equal(m.panel.getAttribute('aria-labelledby'), title.id);
    assert.equal(m.panel.getAttribute('aria-describedby'), m.el.querySelector('.ss-modal-text').id);
    assert.ok(title.id && title.id.startsWith('ss-modal-'));
    assert.deepEqual(m.el.querySelectorAll('.ss-modal-paragraph').map(n => n.textContent), ['Resting takes eight hours.', 'The bleeding will close.']);
    const actions = m.el.querySelectorAll('.ss-modal-action');
    assert.deepEqual(actions.map(a => a.textContent), ['Not now', 'Rest']);
    assert.ok(classes(actions[1]).includes('ss-modal-primary') && classes(actions[0]).includes('ss-modal-plain'));
    assert.ok(m.el.querySelector('i.fa-moon'));
    assert.equal(m.el.querySelector('.ss-modal-close').getAttribute('aria-label'), 'Close');
    assert.equal(m.doc.activeElement, actions[1], 'the main action');
    assert.ok(!m.root.hidden);
    // Alert: alertdialog; no title: named by `label`.
    m.handle.update({ ...DIALOG, title: '', alert: true, label: 'Confirm rest' });
    assert.equal(m.panel.getAttribute('role'), 'alertdialog');
    assert.equal(m.panel.getAttribute('aria-labelledby'), null);
    assert.equal(m.panel.getAttribute('aria-label'), 'Confirm rest');
});

test('dialog: Escape closes it with { dialog: "close" }, and the focus goes back to where it was', () => {
    const m = openDialog();
    const event = m.doc.fire('keydown', { key: 'Escape' });
    assert.ok(event.defaultPrevented && event.stopped);
    assert.deepEqual(m.api.commands, [{ type: 'ui.dialog', payload: { dialog: 'close' } }]);
    assert.ok(m.root.hidden);
    assert.equal(m.doc.activeElement, m.opener);
    assert.equal(m.doc.docListeners.length, 0, 'its document listeners are gone');
    // Closed: the keys are not its business any more.
    m.doc.fire('keydown', { key: 'Escape' });
    assert.equal(m.api.commands.length, 1);
});

test('dialog: Tab and Shift+Tab stay inside the panel, and a focus that lands outside is brought back', () => {
    const m = openDialog();
    const nodes = [m.el.querySelector('.ss-modal-close'), ...m.el.querySelectorAll('.ss-modal-action')];
    nodes.at(-1).focus();
    let event = m.doc.fire('keydown', { key: 'Tab', shiftKey: false });
    assert.ok(event.defaultPrevented);
    assert.equal(m.doc.activeElement, nodes[0], 'past the last: the first');
    event = m.doc.fire('keydown', { key: 'Tab', shiftKey: true });
    assert.ok(event.defaultPrevented);
    assert.equal(m.doc.activeElement, nodes.at(-1), 'before the first: the last');
    nodes[1].focus();
    event = m.doc.fire('keydown', { key: 'Tab', shiftKey: false });
    assert.ok(!event.defaultPrevented, 'in the middle: the browser moves on');
    // Focus on the page behind goes back in.
    m.opener.focus();
    m.doc.fire('focusin', {}, m.opener);
    assert.ok(m.panel.contains(m.doc.activeElement));
    // Without a close button or actions the panel itself keeps the focus.
    const lone = openDialog({ title: 'Note', closable: false });
    lone.doc.fire('keydown', { key: 'Tab' });
    assert.equal(lone.doc.activeElement, lone.panel);
});

test('dialog: an action runs { dialog: id } and closes; a click on the dimmed page closes, one on the panel does not; closable: false keeps it', () => {
    const m = openDialog();
    m.el.querySelectorAll('.ss-modal-action')[1].click();
    assert.deepEqual(m.api.commands, [{ type: 'ui.dialog', payload: { dialog: 'rest' } }]);
    assert.ok(m.root.hidden);
    assert.equal(m.doc.activeElement, m.opener);
    const b = openDialog();
    b.panel.dispatch('click', {});
    assert.ok(!b.root.hidden, 'a click inside the panel');
    b.root.dispatch('click', { target: b.root });
    assert.ok(b.root.hidden);
    assert.deepEqual(b.api.commands, [{ type: 'ui.dialog', payload: { dialog: 'close' } }]);
    const c = openDialog({ ...DIALOG, closable: false });
    assert.ok(c.el.querySelector('.ss-modal-close').hidden);
    c.doc.fire('keydown', { key: 'Escape' });
    c.root.dispatch('click', { target: c.root });
    assert.ok(!c.root.hidden && c.api.commands.length === 0);
    // The close button.
    const d = openDialog();
    d.el.querySelector('.ss-modal-close').click();
    assert.ok(d.root.hidden);
    // No command, no api: closes all the same.
    const e = openDialog({ title: 'x', actions: [{ label: 'Ok' }] }, undefined);
    e.el.querySelector('.ss-modal-action').click();
    assert.ok(e.root.hidden);
});

test('dialog: `open` toggles it; one the reader closed stays closed until the screen asks again; destroying frees the page', () => {
    const m = openDialog({ ...DIALOG, open: false });
    assert.ok(m.root.hidden);
    assert.equal(m.doc.docListeners.length, 0);
    m.handle.update({ ...DIALOG, open: true });
    assert.ok(!m.root.hidden);
    assert.equal(m.doc.docListeners.length, 2);
    m.doc.fire('keydown', { key: 'Escape' });
    assert.ok(m.root.hidden);
    m.handle.update({ ...DIALOG, open: true });
    assert.ok(m.root.hidden, 'a redraw with the same prop does not reopen it');
    m.handle.update({ ...DIALOG, open: false });
    m.handle.update({ ...DIALOG, open: true });
    assert.ok(!m.root.hidden, 'asked again');
    m.opener.focus();
    m.handle.destroy();
    assert.equal(m.el.children.length, 0);
    assert.equal(m.doc.docListeners.length, 0);
    // Destroyed while open: the focus goes back.
    const n = openDialog();
    n.handle.destroy();
    assert.equal(n.doc.activeElement, n.opener);
});

test('dialog: only the topmost of two open dialogs takes the keys', () => {
    const doc = installDom();
    const a = dialog.render(host(doc), { title: 'A', onSelect: 'a' }, fakeApi());
    const apiB = fakeApi();
    const b = dialog.render(host(doc), { title: 'B', onSelect: 'b' }, apiB);
    doc.fire('keydown', { key: 'Escape' });
    assert.equal(apiB.commands.length, 1, 'B closed');
    doc.fire('keydown', { key: 'Escape' });
    a.destroy();
    b.destroy();
});

test('dialogActions and dialogParagraphs: capped, tidied, kinds from a list', () => {
    assert.equal(dialogActions(Array.from({ length: 9 }, (_, i) => ({ label: `a${i}` }))).length, 4);
    assert.deepEqual(dialogActions([{ label: 'A', kind: 'evil' }, { id: 'b', label: 'B', kind: 'danger' }, { id: 'c' }, null]).map(a => [a.id, a.kind]), [['A', 'plain'], ['b', 'danger']]);
    assert.deepEqual(dialogParagraphs('One  two\nthree\n\n\n\nFour'), ['One two three', 'Four']);
    assert.equal(dialogParagraphs('x'.repeat(2000))[0].length, 600);
    assert.equal(dialogParagraphs(Array.from({ length: 20 }, (_, i) => `p${i}`).join('\n\n')).length, 8);
    assert.deepEqual(dialogParagraphs(null), []);
});
