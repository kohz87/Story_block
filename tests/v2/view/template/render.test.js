// Rendering: every binding form, loops in loops, conditions, changed() highlighting, widgets, and a second
// render that patches instead of rebuilding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, destroyTemplate, isCompiled, renderTemplate } from '../../../../src/v2/view/template/index.js';
import { makeScope } from '../../../../src/v2/view/bind.js';
import { countWrites, fakeEvaluate, inner, installFakeDom, print } from './helpers.js';

function setup() {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    return { doc, el };
}

const STATE = {
    v: 2,
    meta: { rev: 3, claims: {} },
    domains: {
        scene: { place: { name: 'Bluewatch', kind: 'settlement', region: '' }, present: ['Fenna'] },
        inventory: {
            defs: { 'story/trout': { name: 'Moonveil Trout' }, 'story/rope': { name: 'Rope' } },
            stacks: {
                it_aaaaaaaa: { id: 'it_aaaaaaaa', def: 'story/trout', qty: 2 },
                it_bbbbbbbb: { id: 'it_bbbbbbbb', def: 'story/rope', qty: 1 },
            },
        },
    },
};

test('{{ }} in text and attributes, data-bind, data-bind-attr, data-bind-var, data-class', () => {
    const { el } = setup();
    const compiled = compileTemplate(`<section class="hud" title="{{ q.pc.name }} at {{ state.scene.place.name }}"
        data-bind-var="--hp: ratio(q.pc.hp.cur, q.pc.hp.max); --mp: pct(q.pc.mp.cur, q.pc.mp.max); --label: q.pc.tone"
        data-class="hurt: q.pc.hp.cur < 30; ok: !q.pc.down; down: q.pc.down">
        <b data-bind="q.pc.name">placeholder <i>gone</i></b>
        <img data-bind-attr="src: q.pc.portrait; alt: q.pc.name; hidden: q.pc.down">
        <span>{{ q.pc.hp.cur }}/{{ q.pc.hp.max }} · {{ fmt.money(q.purse) }} · {{ len(state.inventory.stacks) }} kinds</span>
    </section>`);
    assert.deepEqual(compiled.warnings, []);
    assert.equal(isCompiled(compiled), true);
    const pc = { name: 'Ren', hp: { cur: 20, max: 80 }, mp: { cur: 5, max: 10 }, portrait: 'https://img.example/ren.png', down: false, tone: 'warm' };
    renderTemplate(el, compiled, { state: STATE, q: { pc, purse: 125 } }, { evaluate: fakeEvaluate });
    const section = el.querySelector('section');
    assert.equal(section.getAttribute('title'), 'Ren at Bluewatch');
    assert.deepEqual(section.styleProps, { '--hp': '0.25', '--mp': '50', '--label': 'warm' });
    assert.equal(section.className, 'hud hurt ok');
    assert.equal(print(section.querySelector('b')), '<b>Ren</b>');
    const img = section.querySelector('img');
    assert.equal(img.getAttribute('src'), 'https://img.example/ren.png');
    assert.equal(img.getAttribute('alt'), 'Ren');
    assert.equal(img.getAttribute('hidden'), null);
    assert.equal(section.querySelector('span').textContent, '20/80 · 125 · 2 kinds');

    renderTemplate(el, compiled, { state: STATE, q: { pc: { ...pc, hp: { cur: 70, max: 80 }, down: true, portrait: null }, purse: 3 } }, { evaluate: fakeEvaluate });
    assert.equal(section.className, 'hud down', 'classes toggled off and on');
    assert.equal(img.getAttribute('src'), null, 'null removes the attribute');
    assert.equal(img.getAttribute('hidden'), '', 'true sets a boolean attribute');
    assert.equal(section.styleProps['--hp'], '0.875');
    assert.equal(el.querySelector('section'), section, 'the same element, patched');
});

test('data-each over records and lists, with an index or key; loops in loops; data-if per item', () => {
    const { el } = setup();
    const compiled = compileTemplate(`<ul>
        <li data-each="state.inventory.stacks as s, id" data-if="s.qty > 0">{{ id }} {{ state.inventory.defs[s.def].name }} ×{{ s.qty }}</li>
    </ul>
    <div class="party"><div class="actor" data-each="q.actors as a, i">
        <h3>{{ i }}. {{ a.name }}</h3>
        <span class="skill" data-each="a.skills as sk, j" data-class="first: j == 0">{{ a.name }}/{{ sk.name }}#{{ j }}</span>
        <em data-if="len(a.skills) == 0">no skills</em>
    </div></div>`);
    assert.deepEqual(compiled.warnings, []);
    const actors = [
        { id: 'ac_1', name: 'Ren', skills: [{ name: 'Cut' }, { name: 'Parry' }] },
        { id: 'ac_2', name: 'Lyra', skills: [] },
    ];
    renderTemplate(el, compiled, { state: STATE, q: { actors } }, { evaluate: fakeEvaluate });
    assert.deepEqual(el.querySelectorAll('li').map(li => li.textContent), ['it_aaaaaaaa Moonveil Trout ×2', 'it_bbbbbbbb Rope ×1']);
    assert.deepEqual(el.querySelectorAll('h3').map(h => h.textContent), ['0. Ren', '1. Lyra']);
    assert.deepEqual(el.querySelectorAll('.skill').map(s => s.textContent), ['Ren/Cut#0', 'Ren/Parry#1']);
    assert.deepEqual(el.querySelectorAll('.skill').map(s => s.className), ['skill first', 'skill']);
    assert.deepEqual(el.querySelectorAll('em').map(e => e.textContent), ['no skills']);
    assert.equal(el.querySelectorAll('.actor')[0].querySelectorAll('em').length, 0);

    // Reorder, drop and add: items with the same id keep their element.
    const [renEl, lyraEl] = el.querySelectorAll('.actor');
    const stacks = { ...STATE.domains.inventory.stacks, it_bbbbbbbb: { ...STATE.domains.inventory.stacks.it_bbbbbbbb, qty: 0 } };
    const state = { ...STATE, domains: { ...STATE.domains, inventory: { ...STATE.domains.inventory, stacks } } };
    renderTemplate(el, compiled, { state, q: { actors: [actors[1], { id: 'ac_3', name: 'Kael', skills: [{ name: 'Hex' }] }, actors[0]] } }, { evaluate: fakeEvaluate });
    assert.deepEqual(el.querySelectorAll('li').map(li => li.textContent), ['it_aaaaaaaa Moonveil Trout ×2'], 'data-if dropped the empty stack');
    assert.deepEqual(el.querySelectorAll('h3').map(h => h.textContent), ['0. Lyra', '1. Kael', '2. Ren']);
    const after = el.querySelectorAll('.actor');
    assert.equal(after[0], lyraEl);
    assert.equal(after[2], renEl);
    assert.deepEqual(el.querySelectorAll('.skill').map(s => s.textContent), ['Kael/Hex#0', 'Ren/Cut#0', 'Ren/Parry#1']);

    renderTemplate(el, compiled, { state, q: { actors: 'not a list' } }, { evaluate: fakeEvaluate });
    assert.equal(el.querySelectorAll('.actor').length, 0, 'a value that is not a list renders nothing');
});

test('a second render with the same data writes nothing to the page', () => {
    const { el } = setup();
    const compiled = compileTemplate(`<div class="card" data-class="low: q.hp < 10" data-bind-var="--hp: ratio(q.hp, 100)" title="{{ q.name }}">
        <p data-each="q.list as x, i" data-if="x.on"><b data-bind="x.name"></b> {{ i }} <a data-bind-attr="href: x.url">go</a></p>
        <ss-widget name="ss.meter" data-props='{"bind":"q.hp","max":100}'></ss-widget>
    </div>`);
    let renders = 0;
    const widgets = { 'ss.meter': { render(target, props) { renders += 1; target.textContent = `${props.value}/${props.max}`; } } };
    const q = { hp: 7, name: 'Ren', list: [{ id: 'a', name: 'A', on: true, url: 'https://a.example' }, { id: 'b', name: 'B', on: false }] };
    const options = { evaluate: fakeEvaluate, widgets };
    renderTemplate(el, compiled, { q }, options);
    const before = inner(el);
    const writes = countWrites(() => renderTemplate(el, compiled, { q: structuredClone(q) }, options));
    assert.equal(writes, 0);
    assert.equal(inner(el), before);
    assert.equal(renders, 1, 'unchanged props do not redraw the widget');
    const changedWrites = countWrites(() => renderTemplate(el, compiled, { q: { ...q, name: 'Lyra' } }, options));
    assert.equal(changedWrites, 1, 'one changed value, one write');
});

test('changed(): highlights only what this carrier changed', () => {
    const { el } = setup();
    const compiled = compileTemplate(`<ul><li data-each="state.inventory.stacks as s" data-class="flash: changed(s.qty)" data-if="!settings.onlyChanged || changed(s)">{{ s.id }}</li></ul>
        <p data-class="moved: changed('state.scene.place')">{{ state.scene.place.name }}</p>`);
    const ops = [{ op: 'replace', path: '/domains/inventory/stacks/it_bbbbbbbb/qty', value: 1 }];
    renderTemplate(el, compiled, { state: STATE, ops, settings: { onlyChanged: false } }, { evaluate: fakeEvaluate });
    assert.deepEqual(el.querySelectorAll('li').map(li => [li.textContent, li.className]), [['it_aaaaaaaa', ''], ['it_bbbbbbbb', 'flash']]);
    assert.equal(el.querySelector('p').className, '');
    // "Only what changed": the reader's toggle hides the rest.
    renderTemplate(el, compiled, { state: STATE, ops, settings: { onlyChanged: true } }, { evaluate: fakeEvaluate });
    assert.deepEqual(el.querySelectorAll('li').map(li => li.textContent), ['it_bbbbbbbb']);
    // A carrier that moved the party.
    renderTemplate(el, compiled, makeScope({ state: STATE, ops: [{ op: 'replace', path: '/domains/scene/place/name', value: 'Bluewatch' }], settings: { onlyChanged: false } }), { evaluate: fakeEvaluate });
    assert.equal(el.querySelector('p').className, 'moved');
    assert.deepEqual(el.querySelectorAll('li.flash').length, 0);
    // The mounts' scope: `changes` (pointers) and `api` (its command runs the buttons).
    const calls = [];
    const mountScope = { state: STATE, changes: ['/domains/inventory/stacks/it_aaaaaaaa'], settings: { onlyChanged: true }, mount: 'card', index: 4, screenId: 'x/y', api: { command: async (...args) => calls.push(args) } };
    renderTemplate(el, compiled, mountScope, { evaluate: fakeEvaluate });
    assert.deepEqual(el.querySelectorAll('li').map(li => [li.textContent, li.className]), [['it_aaaaaaaa', 'flash']]);
});

test('data-command runs the command with the payload filled from the item; one run at a time', async () => {
    const { el } = setup();
    const compiled = compileTemplate(`<div><div data-each="state.inventory.stacks as s">
        <button data-command="item.use" data-payload='{"stack":"{{ s.id }}","target":"{{ q.pc }}","qty":{{ s.qty }}}'>Use</button>
        <button data-command="inventory.drop">Drop</button>
    </div></div>`);
    const calls = [];
    const results = [];
    let release;
    const command = (type, payload, options) => {
        calls.push([type, payload, options]);
        return new Promise(resolve => { release = () => resolve({ ok: true }); });
    };
    renderTemplate(el, compiled, { state: STATE, q: { pc: 'ac_7h2m9x4q' } }, { command, onResult: (result, info) => results.push([result, info.type]) });
    const [use] = el.querySelectorAll('button');
    assert.equal(use.getAttribute('type'), 'button', 'a command button never submits a form');
    use.click();
    use.click();
    assert.equal(calls.length, 1, 'a second click while running is ignored');
    assert.deepEqual(calls[0], ['item.use', { stack: 'it_aaaaaaaa', target: 'ac_7h2m9x4q', qty: 2 }, { cause: 'ui' }]);
    assert.equal(use.className, 'ss-busy');
    release();
    await new Promise(resolve => setTimeout(resolve));
    assert.equal(use.className, '');
    assert.deepEqual(results, [[{ ok: true }, 'item.use']]);
    el.querySelectorAll('button')[3].click();
    assert.deepEqual(calls[1], ['inventory.drop', {}, { cause: 'ui' }], 'no payload is an empty record');
});

test('bad commands, payloads and loops are reported, not run', async () => {
    const { el } = setup();
    const warnings = [];
    const compiled = compileTemplate(`<button data-command="not a command">a</button><button data-command="x.y" data-payload='{bad'>b</button>
        <button data-command="x.y" data-payload='[{{ q.n }}]'>c</button><p data-each="q.list as state">d</p><p data-each="nonsense">e</p>
        <p data-payload='{}'>f</p><div data-props='{}'>g</div><div data-draft="x">h</div>`);
    assert.equal(compiled.warnings.length, 7);
    const calls = [];
    renderTemplate(el, compiled, { q: { n: 1 } }, { command: async (...args) => calls.push(args), onWarn: message => warnings.push(message) });
    for (const button of el.querySelectorAll('button')) button.click();
    await new Promise(resolve => setTimeout(resolve));
    assert.equal(calls.length, 0);
    assert.ok(warnings.some(w => /must be a record/.test(w)));
    assert.equal(el.querySelectorAll('p').length, 1, 'bad loops are left out');
});

test('a mount scope\'s api runs commands when no command option is given', async () => {
    const { el } = setup();
    const calls = [];
    const api = { tag: 'host', async command(...args) { calls.push([this.tag, ...args]); return { ok: true }; } };
    renderTemplate(el, compileTemplate('<button data-command="quest.take" data-payload=\'{"id":"{{ q.id }}"}\'>x</button>'), { q: { id: 'q_1' }, api });
    el.querySelector('button').click();
    await new Promise(resolve => setTimeout(resolve));
    assert.deepEqual(calls, [['host', 'quest.take', { id: 'q_1' }, { cause: 'ui' }]]);
});

test('without a command runner, a click says so instead of failing', () => {
    const { el } = setup();
    const view = renderTemplate(el, compileTemplate('<button data-command="item.use">x</button>'), {});
    el.querySelector('button').click();
    assert.ok(view.warnings.some(w => /No command runner/.test(w)));
});

test('<ss-widget>: props with holes and bind, api, update, unknown and failing widgets, cleanup', async () => {
    const { el } = setup();
    const compiled = compileTemplate(`<div>
        <ss-widget name="ss.meter" class="hp" data-props='{"bind":"q.pc.hp","label":"{{ q.pc.name }}","tone":"hp"}'></ss-widget>
        <ss-widget name="rpg-battle.battle-board" data-props='{"session":{{ q.session }}}'></ss-widget>
        <ss-widget name="ss.nothing"></ss-widget>
        <ss-widget name="ss.broken"></ss-widget>
    </div>`);
    const log = [];
    const widgets = new Map([
        ['ss.meter', { render(target, props, api) {
            log.push(['render', props]);
            target.textContent = `${props.label}: ${props.value.cur}/${props.value.max}`;
            assert.equal(api.resolve('q.pc.name'), 'Ren');
            assert.equal(typeof api.query, 'function', 'host api passed through');
            return { update(next) { log.push(['update', next]); target.textContent = `${next.label}: ${next.value.cur}/${next.value.max}`; }, destroy() { log.push(['destroy']); } };
        } }],
        ['rpg-battle.battle-board', { render(target, props, api) { log.push(['board', props]); api.command('combat.act', { action: 'strike' }); } }],
        ['ss.broken', { render() { throw new Error('kaput'); } }],
    ]);
    const calls = [];
    const options = { widgets, api: { query: () => null }, command: async (...args) => calls.push(args) };
    const view = renderTemplate(el, compiled, { q: { pc: { name: 'Ren', hp: { cur: 5, max: 9 } }, session: { id: 'cb_1' } } }, options);
    const [meter, board, missing, broken] = el.querySelectorAll('ss-widget');
    assert.equal(meter.className, 'hp');
    assert.equal(meter.textContent, 'Ren: 5/9');
    assert.deepEqual(log[0], ['render', { bind: 'q.pc.hp', label: 'Ren', tone: 'hp', value: { cur: 5, max: 9 } }]);
    assert.deepEqual(log[1], ['board', { session: { id: 'cb_1' } }]);
    await new Promise(resolve => setTimeout(resolve));
    assert.deepEqual(calls, [['combat.act', { action: 'strike' }, { cause: 'ui' }]]);
    assert.equal(missing.className, 'ss-widget-missing');
    assert.match(missing.textContent, /no widget called "ss.nothing"/);
    assert.match(broken.textContent, /kaput/);
    assert.ok(view.warnings.some(w => /kaput/.test(w)));

    renderTemplate(el, compiled, { q: { pc: { name: 'Ren', hp: { cur: 6, max: 9 } }, session: { id: 'cb_1' } } }, options);
    assert.deepEqual(log[2], ['update', { bind: 'q.pc.hp', label: 'Ren', tone: 'hp', value: { cur: 6, max: 9 } }]);
    assert.equal(meter.textContent, 'Ren: 6/9');
    assert.equal(log.filter(entry => entry[0] === 'board').length, 1, 'same props, no redraw');
    destroyTemplate(el);
    assert.deepEqual(log.at(-1), ['destroy']);
});

test('a raw scope works like makeScope, extra names included; a different template replaces the old one', () => {
    const { el } = setup();
    const first = compileTemplate('<p>{{ hero.name }} {{ state.scene.place.name }}</p>');
    renderTemplate(el, first, { state: STATE, hero: { name: 'Ren' } });
    assert.equal(el.textContent, 'Ren Bluewatch');
    const second = compileTemplate('<b>{{ q.x }}</b>');
    renderTemplate(el, second, { q: { x: 'two' } });
    assert.equal(inner(el), '<b>two</b>');
    assert.throws(() => renderTemplate(el, { nodes: null }, {}), /compileTemplate/);
    assert.throws(() => renderTemplate(null, second, {}), /element/);
});

test('SVG is built with the SVG namespace when the document has it', () => {
    const { el, doc } = setup();
    const made = [];
    doc.createElementNS = (ns, tag) => {
        made.push([ns, tag]);
        return doc.createElement(tag);
    };
    renderTemplate(el, compileTemplate('<svg viewBox="0 0 10 10"><rect width="10" data-bind-attr="height: q.h"/></svg>'), { q: { h: 4 } });
    assert.deepEqual(made, [['http://www.w3.org/2000/svg', 'svg'], ['http://www.w3.org/2000/svg', 'rect']]);
    assert.equal(el.querySelector('rect').getAttribute('height'), '4');
});
