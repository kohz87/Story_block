// Screen registry (SPEC §13.1, §13.7): validation, precedence, fallback with a reason, reader choices,
// and data bindings resolved in dependency order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CSS_LIMIT, createScreens, dataOrder, resolveData, validateScreen } from '../../../../src/v2/view/screens.js';
import { screen } from './helpers.js';

const ok = def => assert.deepEqual(validateScreen(def), []);
const bad = (def, pattern) => {
    const errors = validateScreen(def);
    assert.ok(errors.some(error => pattern.test(error)), `expected ${pattern} in ${JSON.stringify(errors)}`);
};

test('validateScreen accepts a template screen and a layout screen', () => {
    ok(screen('rpg-battle/party', ['tab', 'screen']));
    ok({ id: 'story/map', mounts: ['screen'], layout: { root: { type: 'stack' } }, css: '.a{}', theme: { '--ss-accent': '#7c5cff', '--gap': 4 } });
    ok({ id: 'x/y', mounts: ['dialog'], template: '', data: { pc: { query: 'party.pc' }, gear: { query: 'items.gear', args: { actor: '$pc.id' } } } });
});

test('validateScreen rejects a bad id, mounts, body, css, theme', () => {
    bad({ mounts: ['tab'], template: '' }, /needs an id/);
    bad({ id: '/lead', mounts: ['tab'], template: '' }, /needs an id/);
    bad({ id: 'a/b', template: '' }, /must list where it may appear/);
    bad({ id: 'a/b', mounts: [], template: '' }, /must list where it may appear/);
    bad({ id: 'a/b', mounts: ['sidebar'], template: '' }, /"sidebar" is not a mount/);
    bad({ id: 'a/b', mounts: ['tab', 'tab'], template: '' }, /twice/);
    bad({ id: 'a/b', mounts: ['tab'] }, /exactly one of template or layout/);
    bad({ id: 'a/b', mounts: ['tab'], template: '', layout: { root: {} } }, /exactly one of template or layout/);
    bad({ id: 'a/b', mounts: ['tab'], template: 3 }, /template must be text/);
    bad({ id: 'a/b', mounts: ['tab'], layout: { nodes: [] } }, /layout must be \{ root/);
    bad({ id: 'a/b', mounts: ['tab'], template: '', css: 'x'.repeat(CSS_LIMIT + 1) }, /larger than 64 KB/);
    bad({ id: 'a/b', mounts: ['tab'], template: '', css: 7 }, /css must be text/);
    bad({ id: 'a/b', mounts: ['tab'], template: '', theme: { color: 'red' } }, /not a CSS custom property/);
    bad({ id: 'a/b', mounts: ['tab'], template: '', theme: { '--c': {} } }, /must be text or a number/);
    bad({ id: 'a/b', mounts: ['tab'], template: '', title: 4 }, /title must be text/);
    assert.deepEqual(validateScreen(null), ['A screen definition must be an object.']);
    assert.match(validateScreen(screen('a/b', ['tab']), { id: 'a/c' })[0], /given for screen "a\/c"/);
});

test('validateScreen checks the shape of data bindings', () => {
    bad({ ...screen('a/b', ['tab']), data: [] }, /data must be an object/);
    bad({ ...screen('a/b', ['tab']), data: { 'bad-name': { query: 'q' } } }, /not a usable data name/);
    bad({ ...screen('a/b', ['tab']), data: { pc: 'party.pc' } }, /must be \{ query, args \}/);
    bad({ ...screen('a/b', ['tab']), data: { pc: {} } }, /needs a query name/);
    bad({ ...screen('a/b', ['tab']), data: { pc: { query: 'q', args: [1] } } }, /args must be an object/);
    bad({ ...screen('a/b', ['tab']), data: { pc: { query: 'q', bind: 1 } } }, /unknown field "bind"/);
    bad({ ...screen('a/b', ['tab']), data: { gear: { query: 'q', args: { a: '$pc.id' } } } }, /uses \$pc/);
    bad({ ...screen('a/b', ['tab']), data: { a: { query: 'q', args: { x: '$b' } }, b: { query: 'q', args: { y: '$a' } } } }, /circle/);
});

test('validateScreen allows steps only on dialog-only screens, each with an id and one body', () => {
    const steps = [{ id: 'who', title: 'Who', template: '<input data-draft="name">' }, { id: 'stats', layout: { root: {} } }];
    ok({ id: 'game/new', mounts: ['dialog'], template: '', steps });
    bad({ id: 'game/new', mounts: ['dialog', 'tab'], template: '', steps }, /steps are only for screens shown as a dialog/);
    bad({ id: 'game/new', mounts: ['dialog'], template: '', steps: [] }, /steps must be a list/);
    bad({ id: 'game/new', mounts: ['dialog'], template: '', steps: [{ id: 'a', template: '' }, { id: 'a', template: '' }] }, /two steps are called "a"/);
    bad({ id: 'game/new', mounts: ['dialog'], template: '', steps: [{ template: '' }] }, /step 1 needs an id/);
    bad({ id: 'game/new', mounts: ['dialog'], template: '', steps: [{ id: 'a' }] }, /step 1 needs exactly one of template or layout/);
    bad({ id: 'game/new', mounts: ['dialog'], template: '', steps: [{ id: 'a', template: '', next: 'b' }] }, /unknown field "next"/);
});

function registry(reader = {}) {
    let settings = reader;
    const screens = createScreens({ reader: () => settings, saveReader: next => { settings = next; } });
    return { screens, settings: () => settings };
}

test('precedence: reader, then card, then the last pack set, then the module default', () => {
    const { screens } = registry();
    screens.addModule('rpg-battle', [screen('rpg-battle/party', ['tab'], { title: 'Module' })]);
    assert.equal(screens.resolve('rpg-battle/party').source, 'module');
    screens.setPack('pack.a', [screen('rpg-battle/party', ['tab'], { title: 'Pack A' })]);
    screens.setPack('pack.b', [screen('rpg-battle/party', ['tab'], { title: 'Pack B' })]);
    assert.deepEqual([screens.resolve('rpg-battle/party').origin, screens.resolve('rpg-battle/party').screen.title], ['pack.b', 'Pack B']);
    screens.setCard([screen('rpg-battle/party', ['tab'], { title: 'Card' })]);
    assert.equal(screens.resolve('rpg-battle/party').screen.title, 'Card');
    screens.choose('rpg-battle/party', screen('rpg-battle/party', ['tab'], { title: 'Mine' }));
    assert.deepEqual([screens.resolve('rpg-battle/party').source, screens.resolve('rpg-battle/party').screen.title], ['reader', 'Mine']);
    assert.deepEqual(screens.resolve('rpg-battle/party').fallbacks, []);

    // Reset pins the module default over the card and packs; clearing the choice restores the order.
    screens.reset('rpg-battle/party');
    assert.equal(screens.resolve('rpg-battle/party').screen.title, 'Module');
    screens.clearChoice('rpg-battle/party');
    assert.equal(screens.resolve('rpg-battle/party').screen.title, 'Card');
    screens.choose('rpg-battle/party', { use: 'pack:pack.a' });
    assert.equal(screens.resolve('rpg-battle/party').screen.title, 'Pack A');
    screens.choose('rpg-battle/party', { use: 'pack' });
    assert.equal(screens.resolve('rpg-battle/party').screen.title, 'Pack B');
    screens.removePack('pack.b');
    screens.clearCard();
    screens.clearChoice('rpg-battle/party');
    assert.equal(screens.resolve('rpg-battle/party').screen.title, 'Pack A');
    assert.equal(screens.resolve('nobody/here'), null);
});

test('a screen that fails validation falls back to the next source, with the reason kept', () => {
    const { screens } = registry();
    screens.addModule('rpg-battle', [screen('rpg-battle/party', ['tab'], { title: 'Module' })]);
    screens.setPack('pack.a', [{ id: 'rpg-battle/party', mounts: ['tab'], template: '', css: 'x'.repeat(CSS_LIMIT + 1) }]);
    screens.setCard([{ id: 'rpg-battle/party', mounts: ['tab'] }]);
    screens.choose('rpg-battle/party', { id: 'rpg-battle/other', mounts: ['tab'], template: '' });
    const resolved = screens.resolve('rpg-battle/party');
    assert.equal(resolved.source, 'module');
    assert.deepEqual(resolved.fallbacks.map(item => item.source), ['reader', 'card', 'pack']);
    assert.match(resolved.fallbacks[0].reason, /given for screen "rpg-battle\/party"/);
    assert.match(resolved.fallbacks[1].reason, /exactly one of template or layout/);
    assert.match(resolved.fallbacks[2].reason, /64 KB/);
    assert.deepEqual(screens.problems().map(item => [item.id, item.source]), [
        ['rpg-battle/party', 'reader'], ['rpg-battle/party', 'card'], ['rpg-battle/party', 'pack'],
    ]);

    // A pin to a version that does not exist says so and uses the normal order.
    screens.choose('rpg-battle/party', { use: 'pack:pack.zzz' });
    const pinned = screens.resolve('rpg-battle/party');
    assert.equal(pinned.source, 'module');
    assert.match(pinned.fallbacks[0].reason, /no such version/);

    // Nothing usable: no screen, every reason listed.
    const { screens: other } = registry();
    other.addModule('m', [{ id: 'm/broken', mounts: ['tab'] }]);
    assert.deepEqual([other.resolve('m/broken').screen, other.resolve('m/broken').fallbacks.length], [null, 1]);
    assert.deepEqual(other.list('tab'), []);
});

test('list(mount) gives usable screens for that mount, by id; module clashes throw', () => {
    const { screens } = registry();
    screens.addModule('b', [screen('b/hud', ['hud']), screen('b/sheet', ['tab', 'screen'])]);
    screens.addModule('a', [screen('a/inv', ['tab'])]);
    screens.setPack('p', [screen('p/extra', ['screen'])]);
    assert.deepEqual(screens.list('tab').map(entry => entry.id), ['a/inv', 'b/sheet']);
    assert.deepEqual(screens.list('screen').map(entry => entry.id), ['b/sheet', 'p/extra']);
    assert.deepEqual(screens.ids(), ['a/inv', 'b/hud', 'b/sheet', 'p/extra']);
    assert.throws(() => screens.addModule('c', [screen('a/inv', ['tab'])]), /already defined by module "a"/);
    assert.throws(() => screens.setPack('q', [screen('q/x', ['tab']), screen('q/x', ['tab'])]), /twice/);
    assert.throws(() => screens.setCard([{ mounts: ['tab'] }]), /without an id/);
    screens.removeModule('a');
    assert.deepEqual(screens.list('tab').map(entry => entry.id), ['b/sheet']);
});

test('reader settings: card opt-ins per screen, choices saved through saveReader, version bumps', () => {
    const { screens, settings } = registry({ other: 1 });
    screens.addModule('m', [screen('m/card', ['card'])]);
    const before = screens.version();
    assert.equal(screens.cardsOn('m/card'), false);
    screens.setCards('m/card', true);
    assert.equal(screens.cardsOn('m/card'), true);
    assert.deepEqual(settings(), { other: 1, screens: {}, cards: { 'm/card': true } });
    screens.setCards('m/card', false);
    assert.equal(screens.cardsOn('m/card'), false);
    screens.reset('m/card');
    assert.deepEqual(screens.choice('m/card'), { use: 'module' });
    assert.ok(screens.version() > before);
});

test('data bindings run in dependency order with $alias.path arguments', () => {
    const data = {
        gear: { query: 'items.gear', args: { actor: '$pc.id', slots: ['$pc.slots.0', 'hand'] } },
        pc: { query: 'party.pc', args: { who: '$party.lead' } },
        party: { query: 'party.all' },
        price: { query: 'shop.price', args: { cost: '$5', item: '$gear.0' } },
    };
    assert.deepEqual(dataOrder(data), { ok: true, order: ['party', 'pc', 'gear', 'price'] });
    const calls = [];
    const answers = {
        'party.all': { lead: 'ac_ren00001' },
        'party.pc': { id: 'ac_ren00001', slots: ['head'] },
        'items.gear': ['it_sword001'],
        'shop.price': 12,
    };
    const result = resolveData(data, (name, args) => { calls.push([name, args]); return answers[name]; });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
        ['party.all', {}],
        ['party.pc', { who: 'ac_ren00001' }],
        ['items.gear', { actor: 'ac_ren00001', slots: ['head', 'hand'] }],
        ['shop.price', { cost: '$5', item: 'it_sword001' }],
    ]);
    assert.deepEqual(result.q, { party: answers['party.all'], pc: answers['party.pc'], gear: answers['items.gear'], price: 12 });
});

test('data bindings: a cycle or an unknown alias is an error; a failing query gives null and a problem', () => {
    const cycle = resolveData({ a: { query: 'q', args: { x: '$c' } }, b: { query: 'q', args: { x: '$a' } }, c: { query: 'q', args: { x: '$b.y' } } }, () => 1);
    assert.equal(cycle.ok, false);
    assert.equal(cycle.code, 'CYCLE');
    assert.match(cycle.message, /"a", "b", "c" depend on each other/);
    assert.equal(resolveData({ a: { query: 'q', args: { x: '$a' } } }, () => 1).code, 'CYCLE');
    const unknown = resolveData({ a: { query: 'q', args: { x: '$nope.id' } } }, () => 1);
    assert.equal(unknown.code, 'UNKNOWN_ALIAS');
    assert.equal(resolveData(undefined, () => 1).ok, true);

    const result = resolveData({ a: { query: 'boom' }, b: { query: 'echo', args: { from: '$a.id' } } }, (name, args) => {
        if (name === 'boom') throw new Error('no such query');
        return args;
    });
    assert.deepEqual(result.q, { a: null, b: { from: null } });
    assert.deepEqual(result.problems, ['a: no such query']);
});
