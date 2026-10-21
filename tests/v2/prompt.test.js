// Prompt assembly (docs/v2/SPEC.md §5): the static part never changes with the state; the tail
// tells what happened, then each module in the fixed order, within the budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/v2/registry.js';
import { DEFAULT_TAIL_BUDGET, HAPPENED, STATIC_MARKER, assemble, estimateTokens, tailOrder } from '../../src/v2/prompt.js';

const freeze = value => Object.freeze(value);

// Modules registered out of order, with tails that read the state.
function suite() {
    const registry = createRegistry();
    registry.register({
        id: 'story-director',
        name: 'Story Director',
        domains: { director: { initial: () => ({ minutes: 0, quests: [] }) } },
        capture: { kinds: { quest: { grammar: '~ quest Name — step' }, event: { grammar: '! event Name — what happened' } }, apply: () => ({}) },
        context: {
            static: () => 'Quests move only when the story moves them.',
            tail: view => ({ lines: [`[Director] Day minute ${view.state.domains.director.minutes}.`], optional: view.state.domains.director.quests.map(quest => `Quest: ${quest}`) }),
        },
    });
    registry.register({
        id: 'zz-weather',
        name: 'Weather',
        context: { tail: view => ({ lines: [`[Weather] ${view.state.domains.weather?.sky ?? 'clear'}`] }) },
    });
    registry.register({
        id: 'rpg-battle',
        name: 'RPG Battle',
        domains: { party: { initial: () => ({ actors: {} }) }, combat: { initial: () => ({ session: null }) } },
        capture: { kinds: { wound: { grammar: '~ wound Name — how | harm: scratch|wound|grave' } }, apply: () => ({}) },
        context: {
            static: () => 'Stop at the check: write ? check and do not tell the outcome.',
            tail: view => ({ lines: Object.values(view.state.domains.party.actors).map(actor => `[Party] ${actor.name} ${actor.hp} HP`), optional: ['[Party] Tip: rest heals.'] }),
            budget: 400,
        },
    });
    registry.register({
        id: 'story-block',
        name: 'Story Block',
        domains: { scene: { initial: () => ({ place: { name: '' }, present: [] }) }, inventory: { initial: () => ({ stacks: {} }) } },
        capture: { kinds: { item: { grammar: '+ item Name | qty: 1' }, place: { grammar: '~ place Name | kind: settlement' } }, apply: () => ({}) },
        context: {
            static: () => 'Items and places are kept by code.',
            tail: view => ({ lines: [`[Scene] ${view.state.domains.scene.place.name || 'somewhere'}`, ...view.state.domains.scene.present.map(name => `Present: ${name}`)] }),
        },
    });
    return registry;
}

const view = state => freeze({ state, query: () => null, settings: () => ({}), chat: { length: 3, lastUser: 'Hi' } });

test('the static part is byte-identical for two very different states', () => {
    const registry = suite();
    const empty = registry.initialState();
    const busy = structuredClone(empty);
    busy.meta.rev = 412;
    busy.domains.scene = { place: { name: 'Bluewatch Village' }, present: ['Fenna', 'Old Tam', 'the {{char}}'] };
    busy.domains.party.actors = { ac_ren00001: { name: 'Ren', hp: 77 } };
    busy.domains.director = { minutes: 8123, quests: ['Granary Rats', 'North Levee Vipers'] };
    busy.domains.weather = { sky: 'storm' };
    const a = assemble({ registry, view: view(empty), untold: [] });
    const b = assemble({
        registry, view: view(busy),
        untold: [{ id: 'rc_1', narrate: true, summary: 'Ren drinks a Minor Healing Draught: +20 HP (now 77/82).' }],
        settings: { tailBudget: 50 },
    });
    assert.equal(a.staticText, b.staticText);
    assert.notEqual(a.tailText, b.tailText);
    // No state leaks into it.
    for (const word of ['Bluewatch', 'Ren', '8123', 'Granary', 'storm', '412']) assert.ok(!a.staticText.includes(word), word);
});

test('the static part: header, every kind\'s grammar in module-id order, then the statics in module-id order', () => {
    const { staticText } = assemble({ registry: suite(), view: view(suite().initialState()) });
    assert.ok(staticText.startsWith(`${STATIC_MARKER}\n`));
    const kinds = ['~ wound Name', '+ item Name', '~ place Name', '! event Name', '~ quest Name'];
    const at = kinds.map(kind => staticText.indexOf(kind));
    assert.ok(at.every(index => index > 0), 'every grammar line is there');
    assert.deepEqual([...at].sort((x, y) => x - y), at, 'rpg-battle, story-block (item, place), story-director (event, quest)');
    const statics = ['Stop at the check', 'Items and places', 'Quests move'].map(text => staticText.indexOf(text));
    assert.deepEqual([...statics].sort((x, y) => x - y), statics);
    assert.ok(statics[0] > at.at(-1), 'the statics come after the grammar');
    // Without capture kinds there is no change-block instruction, only the header.
    const bare = createRegistry();
    bare.register({ id: 'solo', context: { static: () => 'Solo rules.' } });
    const solo = assemble({ registry: bare, view: view(bare.initialState()) }).staticText;
    assert.ok(!solo.includes('<Changes>'));
    assert.ok(solo.endsWith('\n\nSolo rules.'));
});

test('the tail: [Happened] first, then scene, inventory, party … director, then the rest by id', () => {
    const registry = suite();
    const state = registry.initialState();
    state.domains.scene.place.name = 'Bluewatch';
    state.domains.party.actors = { a: { name: 'Ren', hp: 77 } };
    const { tailText, parts } = assemble({
        registry, view: view(state),
        untold: [
            { id: 'rc_1', narrate: true, summary: 'Ren drinks a draught: +20 HP (now 77/82).' },
            { id: 'rc_2', narrate: false, summary: 'Not for telling.' },
            { id: 'rc_3', narrate: true, summary: 'The trader pays 3 silver.\n' },
        ],
    });
    assert.equal(tailText, [
        HAPPENED,
        'Ren drinks a draught: +20 HP (now 77/82).',
        'The trader pays 3 silver.',
        '[Scene] Bluewatch',
        '[Party] Ren 77 HP',
        '[Party] Tip: rest heals.',
        '[Director] Day minute 0.',
        '[Weather] clear',
    ].join('\n'));
    assert.deepEqual(tailOrder(registry.contexts()).map(context => context.moduleId), ['story-block', 'rpg-battle', 'story-director', 'zz-weather']);
    assert.deepEqual(parts.map(part => [part.place, part.module]), [
        ['static', 'story-suite'], ['static', 'rpg-battle'], ['static', 'story-block'], ['static', 'story-director'],
        ['tail', 'story-suite'], ['tail', 'story-block'], ['tail', 'rpg-battle'], ['tail', 'story-director'], ['tail', 'zz-weather'],
    ]);
    assert.equal(parts[4].label, 'Happened');
    assert.ok(parts.every(part => part.tokens === estimateTokens(part.text)));
    // Nothing untold: no [Happened] at all.
    assert.ok(!assemble({ registry, view: view(state) }).tailText.includes(HAPPENED));
});

test('a module over its budget drops its optional lines first, then its last lines', () => {
    const registry = createRegistry();
    const line = n => `${'x'.repeat(36)} ${n}`; // 38-39 chars: about 10 tokens each
    registry.register({
        id: 'scene-mod',
        domains: { scene: { initial: () => ({}) } },
        context: { tail: () => ({ lines: [line(1), line(2), line(3)], optional: [line('o1'), line('o2')] }), budget: 40 },
    });
    const { tailText, parts } = assemble({ registry, view: view(registry.initialState()) });
    // 3 required lines are ~30 tokens; one optional fits, the second does not.
    assert.equal(tailText, [line(1), line(2), line(3), line('o1')].join('\n'));
    assert.equal(parts.at(-1).dropped, 1);
    const tight = createRegistry();
    tight.register({ id: 'scene-mod', context: { tail: () => ({ lines: [line(1), line(2), line(3)], optional: [line('o1')] }), budget: 20 } });
    assert.equal(assemble({ registry: tight, view: view(tight.initialState()) }).tailText, [line(1), line(2)].join('\n'));
});

test('the host budget drops optional lines from the last module back, then required ones; [Happened] stays', () => {
    const registry = createRegistry();
    const line = (tag, n) => `${tag} ${'y'.repeat(34)} ${n}`;
    const tail = tag => () => ({ lines: [line(tag, 1), line(tag, 2)], optional: [line(tag, 'opt')] });
    registry.register({ id: 'a-scene', domains: { scene: { initial: () => ({}) } }, context: { tail: tail('S') } });
    registry.register({ id: 'b-director', domains: { director: { initial: () => ({}) } }, context: { tail: tail('D') } });
    const untold = [{ id: 'rc_1', narrate: true, summary: 'z'.repeat(200) }];
    const run = tailBudget => assemble({ registry, view: view(registry.initialState()), untold, settings: { tailBudget } });

    const roomy = run(10_000).tailText.split('\n');
    assert.equal(roomy.length, 2 + 6);
    // Over budget: the director's optional line goes first, then the scene's.
    const tokens = text => estimateTokens(text);
    const full = run(10_000).tailText;
    const minusOne = run(tokens(full) - 1).tailText.split('\n');
    assert.ok(!minusOne.includes(line('D', 'opt')) && minusOne.includes(line('S', 'opt')));
    const noOptional = run(tokens(full) - 15).tailText.split('\n');
    assert.ok(!noOptional.includes(line('D', 'opt')) && !noOptional.includes(line('S', 'opt')));
    assert.ok(noOptional.includes(line('D', 2)) && noOptional.includes(line('S', 2)));
    // Then the last module's required lines, from its end.
    const fewer = run(tokens(full) - 25).tailText.split('\n');
    assert.ok(!fewer.includes(line('D', 2)) && fewer.includes(line('D', 1)) && fewer.includes(line('S', 2)));
    // A budget smaller than [Happened] keeps [Happened] whole and drops everything else.
    assert.equal(run(1).tailText, `${HAPPENED}\n${'z'.repeat(200)}`);
    // The default is the spec's 1,500 tokens.
    assert.equal(DEFAULT_TAIL_BUDGET, 1500);
    assert.deepEqual(run(undefined).tailText, full);
});

test('a module whose static() or tail() throws is left out and reported, the rest still sent', () => {
    const registry = createRegistry();
    registry.register({ id: 'broken', name: 'Broken', context: { static: () => { throw new Error('no'); }, tail: () => { throw new Error('nope'); } } });
    registry.register({ id: 'fine', context: { static: () => 'Fine rules.', tail: () => ({ lines: ['Fine now.'] }) } });
    const result = assemble({ registry, view: view(registry.initialState()) });
    assert.ok(result.staticText.endsWith('Fine rules.'));
    assert.equal(result.tailText, 'Fine now.');
    assert.deepEqual(result.problems, ['Broken: instructions failed: no', 'Broken: this reply failed: nope']);
});

test('cues from beforeGenerate join their module\'s tail as required lines', () => {
    const registry = suite();
    const { tailText } = assemble({ registry, view: view(registry.initialState()), cues: { 'story-director': ['Due now: the bell rings.'] } });
    assert.ok(tailText.includes('Due now: the bell rings.\n[Director] Day minute 0.'));
});
