// The default screens drawn by the template renderer (SPEC §13.2) against fixture states, with the real
// condition language: what each shows, what it hides when a module is missing (and that hiding it costs
// no warnings), the filter draft, and the buttons' payloads, which the real command bus accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandBus } from '../../../src/v2/commands.js';
import { homeScreen, inventoryScreen, sceneScreen, changesCardScreen } from '../../../src/v2/screens/index.js';
import { counterIds, fakeRegistry, fakeStore } from '../helpers/bus-fakes.js';
import { core, queries, recordingWidgets, renderSkip, sceneState, settle, show, stocked, text } from './helpers.js';

const skip = renderSkip;

function inventoryView(state = null, options = {}) {
    const module = core();
    const s = state ?? stocked(module);
    return { module, state: s, ...show(inventoryScreen, { state: s, query: queries(module, s), ...options }) };
}

const visibleItems = el => el.querySelectorAll('.item').map(item => item.querySelector('.name').textContent);

test('inventory: grouped by kind, with qty, rarity, equipped marker and the wallet', { skip }, () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_sword001.equipped = 'hand';
    const { el, view } = show(inventoryScreen, { state, query: queries(module, state) });
    assert.deepEqual(view.warnings, []);
    assert.equal(text(el.querySelector('.wallet')), '125 gold');
    const groups = el.querySelectorAll('.group').map(group => [group.getAttribute('data-kind'), group.querySelectorAll('.item').length]);
    assert.deepEqual(groups.filter(([, n]) => n > 0), [['equipment', 2], ['consumable', 2], ['goods', 2]]);
    assert.deepEqual(visibleItems(el), ['Dagger', 'Iron Sword', 'Minor Healing Draught', 'Minor Healing Draught', 'Lantern', 'Rope']);
    const sword = el.querySelectorAll('.item')[1];
    assert.equal(sword.className, 'item r-uncommon equipped');
    assert.equal(text(sword.querySelector('.eq')), 'hand');
    assert.equal(sword.querySelector('.rarity').textContent, 'uncommon');
    assert.equal(sword.querySelectorAll('.qty').length, 0);
    const rope = el.querySelectorAll('.item')[5];
    assert.equal(rope.className, 'item');
    assert.equal(rope.querySelector('.qty').textContent, '×3');
    const cloudy = el.querySelectorAll('.item')[3];
    assert.equal(cloudy.querySelector('.note').textContent, 'cloudy');
    assert.equal(el.querySelectorAll('.empty').length, 0);
});

test('inventory: Equip, Unequip and Drop send the agreed payloads, which the bus accepts', { skip }, async () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_dagg0001.equipped = 'belt';
    // No party members: the plain Equip (the pickers come with members, below).
    delete state.domains.party;
    const store = fakeStore(state);
    const bus = createCommandBus({ store, registry: fakeRegistry([module]), id: counterIds(), seed: () => 42 });
    const { el, calls, results } = show(inventoryScreen, {
        state, query: queries(module, state), command: (type, payload, options) => bus.command(type, payload, options),
    });
    const item = name => el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === name);
    const buttons = row => row.querySelectorAll('button').map(button => text(button));

    assert.deepEqual(buttons(item('Dagger')), ['Unequip', 'Yes, drop it']);
    assert.deepEqual(buttons(item('Iron Sword')), ['Equip', 'Yes, drop it']);
    assert.deepEqual(buttons(item('Rope')), ['Drop 1', 'Drop all 3']);
    assert.deepEqual(buttons(item('Lantern')), ['Yes, drop it']);

    item('Iron Sword').querySelector('[data-command="inventory.equip"]').click();
    await settle();
    item('Dagger').querySelector('[data-command="inventory.unequip"]').click();
    await settle();
    item('Rope').querySelectorAll('[data-command="inventory.drop"]')[0].click();
    await settle();
    item('Rope').querySelectorAll('[data-command="inventory.drop"]')[1].click();
    await settle();
    assert.deepEqual(calls.map(([type, payload, options]) => [type, payload, options.cause]), [
        ['inventory.equip', { stack: 'it_sword001' }, 'ui'],
        ['inventory.unequip', { stack: 'it_dagg0001' }, 'ui'],
        ['inventory.drop', { stack: 'it_rope0001', qty: 1 }, 'ui'],
        ['inventory.drop', { stack: 'it_rope0001', qty: 3 }, 'ui'],
    ]);
    // The screen above was drawn once from the first state, so the last drop asks for the 3 it showed;
    // after the first drop only 2 are left and the bus refuses the rest in plain words.
    assert.deepEqual(results.map(result => result.ok), [true, true, true, false]);
    assert.equal(results[3].code, 'NOT_ENOUGH');
    const inv = store.head().domains.inventory;
    assert.equal(inv.stacks.it_sword001.equipped, 'hand');   // the def's slot
    assert.equal(inv.stacks.it_dagg0001.equipped, null);
    assert.equal(inv.stacks.it_rope0001.qty, 2);
});

test('inventory: the filter box fills the draft and narrows the list', { skip }, () => {
    const draft = {};
    const { el, view, state, calls } = inventoryView(null, { draft });
    const filter = el.querySelector('.filter');
    const [kind, rarity] = filter.querySelectorAll('select');
    kind.value = 'equipment';
    kind.dispatch('change');
    assert.equal(draft.kind, 'equipment');
    assert.deepEqual(visibleItems(el), ['Dagger', 'Iron Sword']);
    assert.deepEqual(el.querySelectorAll('.group').map(group => group.getAttribute('data-kind')), ['equipment']);
    rarity.value = 'uncommon';
    rarity.dispatch('change');
    assert.deepEqual(visibleItems(el), ['Iron Sword']);
    const equipped = filter.querySelector('input[type="checkbox"]');
    equipped.checked = true;
    equipped.dispatch('change');
    assert.deepEqual(draft, { kind: 'equipment', rarity: 'uncommon', equippedOnly: true });
    assert.deepEqual(visibleItems(el), []);
    assert.ok(el.querySelector('.nomatch'), 'the "nothing matches" line is there (CSS shows it when no item is)');
    kind.value = '';
    kind.dispatch('change');
    rarity.value = '';
    rarity.dispatch('change');
    equipped.checked = false;
    equipped.dispatch('change');
    assert.equal(visibleItems(el).length, 6);
    assert.deepEqual(view.warnings, []);
    // The filter is the view's draft only: no command ran and the state is as it was.
    assert.deepEqual(calls, []);
    assert.equal(Object.keys(state.domains.inventory.stacks).length, 6);
});

test('inventory: an empty inventory says so, in the chat\'s currency', { skip }, () => {
    const module = core({}, { currency: 'crowns' });
    const state = stocked(module);
    state.domains.inventory.stacks = {};
    state.domains.inventory.wallets = {};
    const { el, view } = show(inventoryScreen, { state, query: queries(module, state) });
    assert.deepEqual(view.warnings, []);
    assert.equal(text(el.querySelector('.wallet')), '0 crowns');
    assert.equal(text(el.querySelector('.empty')), 'Nothing carried yet.');
    assert.equal(el.querySelectorAll('.filter').length, 0);
    assert.equal(el.querySelectorAll('.item').length, 0);
    assert.equal(el.querySelectorAll('.nomatch').length, 0);
});

test('inventory: a member\'s things show their name', { skip }, () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_dagg0001.owner = 'ac_ren00001';
    state.domains.party = { pc: 'ac_ren00001', order: ['ac_ren00001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    const { el } = show(inventoryScreen, { state, query: queries(module, state) });
    const owners = el.querySelectorAll('.owner').map(node => node.textContent);
    assert.deepEqual(owners, ['Ren']);
});

test('scene: the place and who is here, without portraits when NSD is not installed', { skip }, () => {
    const module = core();
    const state = sceneState(module);
    const { drawn, widgets } = recordingWidgets();
    const { el, view } = show(sceneScreen, { state, query: queries(module, state), widgets, changes: ['/domains/scene/place/name'] });
    assert.deepEqual(view.warnings, []);
    assert.equal(el.querySelector('h3').textContent, 'Bluewatch Village');
    assert.equal(text(el.querySelector('.sub')), 'settlement Lakeshore');
    assert.equal(el.querySelector('.place').className, 'place panel moved');
    assert.equal(el.querySelector('.present').className, 'present panel');
    assert.deepEqual(el.querySelectorAll('.who .name').map(node => node.textContent), ['Fenna', 'Old Tam']);
    assert.equal(el.querySelector('.count').textContent, '2');
    assert.equal(drawn['ss.portrait'], undefined);
    assert.equal(el.querySelector('.cast').className, 'cast');
});

test('scene: portraits from npc.portrait when NSD answers', { skip }, () => {
    const module = core();
    const state = sceneState(module);
    state.domains.director = { time: { minutes: 2 * 1440 + 9 * 60 + 30 } };
    const { drawn, widgets } = recordingWidgets();
    const query = queries(module, state, {
        'npc.known': () => ['Fenna', 'Old Tam'],
        'npc.portrait': (s, { name }) => (name === 'Fenna' ? 'https://img.example/fenna.png' : null),
    });
    const { el, view } = show(sceneScreen, { state, query, widgets });
    assert.deepEqual(view.warnings, []);
    assert.equal(el.querySelector('.cast').className, 'cast faces');
    assert.deepEqual(drawn['ss.portrait'].map(props => [props.name, props.value]), [['Fenna', 'https://img.example/fenna.png'], ['Old Tam', null]]);
    assert.equal(text(el.querySelector('.time')), 'Day 3, 09:30');
});

test('scene: nobody here and no place yet', { skip }, () => {
    const module = core();
    const state = stocked(module);
    const { el, view } = show(sceneScreen, { state, query: queries(module, state) });
    assert.deepEqual(view.warnings, []);
    assert.equal(text(el.querySelector('h3')), 'Somewhere not yet named');
    assert.equal(text(el.querySelector('.nobody')), 'No one else is here.');
    assert.equal(el.querySelectorAll('.who').length, 0);
    assert.equal(el.querySelectorAll('.time').length, 0);
});

test('changes card: only what this reply touched', { skip }, () => {
    const module = core();
    const state = sceneState(module);
    state.domains.inventory.stacks.it_sword001.equipped = 'hand';
    const changes = [
        '/domains/inventory/stacks/it_rope0001/qty',
        '/domains/inventory/stacks/it_sword001/equipped',
        '/domains/inventory/wallets/party/coin',
        '/domains/scene/present',
        '/meta/rev',
    ];
    const { el, view } = show(changesCardScreen, { state, query: queries(module, state), changes });
    assert.deepEqual(view.warnings, []);
    const lines = el.querySelectorAll('.line').map(line => text(line));
    // Stacks come in the state's key order.
    assert.deepEqual(lines, ['Rope now ×3', 'Iron Sword now ×1 equipped: hand', 'Wallet: now 125 gold', 'Here now: Fenna, Old Tam']);
    assert.equal(el.querySelectorAll('.none').length, 0);
    assert.equal(el.querySelectorAll('.place').length, 0);
});

test('changes card: a move, and a reply that changed nothing here', { skip }, () => {
    const module = core();
    const state = sceneState(module);
    const moved = show(changesCardScreen, { state, query: queries(module, state), changes: ['/domains/scene/place'] });
    assert.deepEqual(moved.view.warnings, []);
    assert.deepEqual(moved.el.querySelectorAll('.line').map(line => text(line)), ['Now at Bluewatch Village']);
    const quiet = show(changesCardScreen, { state, query: queries(module, state), changes: ['/domains/director/time/minutes', '/meta/rev'] });
    assert.deepEqual(quiet.view.warnings, []);
    assert.equal(quiet.el.querySelectorAll('.line').length, 0);
    assert.equal(text(quiet.el.querySelector('.none')), 'Nothing changed in the inventory or the scene.');
});

test('home: Story Block alone shows the place and the purse, and nothing else', { skip }, () => {
    const module = core();
    const state = sceneState(module);
    state.domains.inventory.stacks.it_sword001.equipped = 'hand';
    const { drawn, widgets } = recordingWidgets();
    const { el, view, problems } = show(homeScreen, { state, query: queries(module, state), widgets });
    assert.deepEqual(view.warnings, []);
    assert.equal(problems.length, 4, 'the missing modules\' queries are reported to the mount, not drawn');
    assert.deepEqual(el.querySelectorAll('section').map(section => section.className), ['panel scene', 'panel purse']);
    assert.equal(text(el.querySelector('.place')), 'Bluewatch Village · Lakeshore');
    assert.equal(text(el.querySelector('.here')), 'Here: Fenna, Old Tam');
    assert.equal(text(el.querySelector('.wallet')), '125 gold · 6 things carried');
    assert.deepEqual(el.querySelectorAll('.worn li').map(li => text(li)), ['Iron Sword']);
    assert.deepEqual(drawn, { 'story-block.savepoints': [{}], 'story-block.packs-hint': [{}] }, 'only the save points and packs slots (the host widgets draw or hide them)');
});

test('home: with RPG Battle and Story Director, their panels appear', { skip }, () => {
    const module = core();
    const state = sceneState(module);
    const ren = { id: 'ac_ren00001', name: 'Ren', level: 4, role: 'ranger', hp: { cur: 20, max: 82 }, mp: { cur: 3, max: 10 }, sp: { cur: 0, max: 0 }, conditions: [{ kind: 'poisoned', stacks: 1 }] };
    const lyra = { id: 'ac_lyra0001', name: 'Lyra', hp: { cur: 30, max: 30 } };
    state.domains.party = { pc: ren.id, order: [ren.id, lyra.id], actors: { [ren.id]: ren, [lyra.id]: lyra } };
    state.domains.director = { time: { minutes: 0 } };
    // Story Director's board: four open quests (three shown) and one offer, each with the Director's own
    // status line; Home shows the words as they are and works nothing out.
    const active = [1, 2, 3, 4].map(n => ({ id: `th_quest000${n}`, key: `Quest ${n}`, goal: n === 1 ? 'clear the cellar' : '',
        meter: n === 1, progress: n === 1 ? { have: 2, need: 3, met: false } : null,
        status: n === 2 ? { state: 'here', text: 'Ready to turn in' } : { state: 'notyet', text: n === 1 ? 'Not yet: 2/3 rats' : 'Not yet' } }));
    const offers = [{ id: 'th_offer0001', key: 'Lost Ring', goal: 'find the ring', status: { state: 'offered', text: 'Offered — say you take it' } }];
    const query = queries(module, state, {
        'party.pc': () => ren,
        'combat.session': () => null,
        'combat.offers': () => [{ id: 'of_1', foes: [{ name: 'Cellar Rat', count: 6 }, { name: 'Rat King', count: 1 }], stakes: 'death' }],
        'quest.board': () => ({ active, offers, hasActive: true, hasOffers: true }),
    });
    const { drawn, widgets } = recordingWidgets();
    const { el, view, problems } = show(homeScreen, { state, query, widgets });
    assert.deepEqual(view.warnings, []);
    assert.deepEqual(problems, []);
    assert.deepEqual(el.querySelectorAll('section').map(section => section.className), ['panel hero', 'panel party', 'panel fight', 'panel scene', 'panel purse', 'panel quests']);
    assert.equal(el.querySelector('.hero h3').textContent, 'Ren');
    assert.equal(text(el.querySelector('.hero .sub')), 'Level 4 · ranger');
    assert.deepEqual(drawn['ss.meter'].map(props => [props.label, props.value]), [
        ['HP', { cur: 20, max: 82 }], ['MP', { cur: 3, max: 10 }], ['Lyra', { cur: 30, max: 30 }], ['Progress', '2'],
    ]);
    assert.deepEqual(drawn['ss.meter'][3], { value: '2', max: '3', label: 'Progress', tone: 'accent' });
    assert.deepEqual(drawn['ss.badge'].map(props => props.label), ['poisoned']);
    assert.deepEqual(drawn['ss.portrait'].map(props => props.name), ['Ren']);
    assert.equal(text(el.querySelector('.offer')), 'Ahead: 6 Cellar Rat, 1 Rat King to the death');
    assert.equal(el.querySelectorAll('.fight .on').length, 0);
    assert.equal(text(el.querySelector('.time')), 'Day 1, 00:00');
    assert.deepEqual(el.querySelectorAll('.quest b').map(b => b.textContent), ['Quest 1', 'Quest 2', 'Quest 3', 'Lost Ring']);
    assert.equal(text(el.querySelector('.quest')), 'Quest 1 Not yet: 2/3 rats — clear the cellar ss.meter:Progress');
    assert.deepEqual(el.querySelectorAll('.quest .status').map(chip => [chip.getAttribute('data-state'), chip.textContent]), [
        ['notyet', 'Not yet: 2/3 rats'], ['here', 'Ready to turn in'], ['notyet', 'Not yet'], ['offered', 'Offered — say you take it'],
    ]);
    assert.equal(el.querySelectorAll('.quest .progress').length, 1, 'only the first open quest with a target gets a bar');
    assert.equal(text(el.querySelector('.more')), 'and more on the Quests screen');
});

test('home and scene: the story time through the host\'s fmt.time (the calendar), not "Day N"', { skip }, async () => {
    const { formatStoryTime } = await import('../../../src/v2/view/clock.js');
    const ersveil = { era: 'CY', months: ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane'].map(name => ({ name, days: 30 })) };
    const module = core();
    const state = sceneState(module);
    state.domains.director = { time: { minutes: 3 * 180 * 1440 + 4 * 30 * 1440 + 11 * 1440 + 19 * 60 + 40 } };
    const formatters = { time: minutes => formatStoryTime(minutes, ersveil) };
    for (const screen of [homeScreen, sceneScreen]) {
        const { el } = show(screen, { state, query: queries(module, state), widgets: recordingWidgets().widgets, extra: { formatters } });
        assert.equal(text(el.querySelector('.time')), 'CY 3, Goldwane 12, 7:40 pm', screen.id);
    }
});

test('home: a fight under way replaces the foes ahead', { skip }, () => {
    const module = core();
    const state = sceneState(module);
    const query = queries(module, state, {
        'combat.session': () => ({ id: 'cb_1', status: 'active' }),
        'combat.offers': () => [{ id: 'of_1', foes: [{ name: 'Wolf', count: 2 }] }],
    });
    const { el, view } = show(homeScreen, { state, query, widgets: recordingWidgets().widgets });
    assert.deepEqual(view.warnings, []);
    assert.equal(text(el.querySelector('.fight .on')), 'A fight is under way. Open the Fight screen to act.');
    assert.equal(el.querySelectorAll('.offer').length, 0);
});
