// The three complete screens in docs/v2/TEMPLATES.md compile without warnings, their CSS scopes cleanly,
// and they render what the page says from sample data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTemplate, renderTemplate } from '../../../../src/v2/view/template/index.js';
import { scopeCss } from '../../../../src/v2/view/css.js';
import { conditionEvaluator } from '../../../../src/v2/view/bind.js';
import { compile, evaluate } from '../../../../src/v2/events/index.js';
import { standardWidgets } from '../../../../src/v2/view/widgets/index.js';
import { fakeEvaluate, installFakeDom } from './helpers.js';

// The examples run with the real condition language (no truthiness, no arithmetic) and with the test
// stand-in; both must render them without a single warning.
const LANGUAGES = [['the condition language', conditionEvaluator({ compile, evaluate })], ['the test stand-in', fakeEvaluate]];

const doc = readFileSync(new URL('../../../../docs/v2/TEMPLATES.md', import.meta.url), 'utf8');
const blocks = {};
for (const match of doc.matchAll(/```(html|css) ([\w-]+)\n([\s\S]*?)```/g)) (blocks[match[2]] ??= {})[match[1]] = match[3];

let language = LANGUAGES[0][1];

function show(name, scope, options = {}) {
    const { html, css } = blocks[name];
    const compiled = compileTemplate(html);
    assert.deepEqual(compiled.warnings, [], `${name}: template warnings`);
    const scoped = scopeCss(css, `example/${name}`);
    assert.deepEqual(scoped.warnings, [], `${name}: css warnings`);
    const page = installFakeDom();
    const el = page.createElement('div');
    page.body.appendChild(el);
    const view = renderTemplate(el, compiled, scope, { evaluate: language, ...options });
    assert.deepEqual(view.warnings, [], `${name}: render warnings`);
    return { el, view, css: scoped.css };
}

const minutes = (day, hour, minute) => (day - 1) * 1440 + hour * 60 + minute;
const STATE = {
    v: 2,
    meta: { rev: 12, claims: {} },
    domains: {
        scene: { place: { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore' }, present: [] },
        director: { time: { minutes: minutes(3, 9, 30) }, threads: {}, keys: {}, problems: [] },
    },
};

test('the docs have the three examples', () => {
    assert.deepEqual(Object.keys(blocks).sort(), ['hud-card', 'points-buy', 'status-card']);
    for (const block of Object.values(blocks)) assert.ok(block.html && block.css);
});

for (const [label, evaluator] of LANGUAGES) {
    test(`example 1: character HUD card (${label})`, () => {
        language = evaluator;
        const pc = {
            id: 'ac_7h2m9x4q', name: 'Ren', level: 4, role: 'ranger', xp: 0, hp: { cur: 20, max: 82 }, portrait: 'https://img.example/ren.png',
            conditions: [{ kind: 'poisoned', stacks: 2, turns: 3 }, { kind: 'blessed', stacks: 1, turns: 5 }],
        };
        const portraits = [];
        const widgets = { 'ss.portrait': { render(el, props) { portraits.push(props); el.textContent = props.name; } } };
        const { el, css } = show('hud-card', { state: STATE, q: { pc, xp: { have: 300, need: 400 } }, ops: [{ op: 'replace', path: '/domains/scene/place', value: {} }] }, { widgets });
        const hud = el.querySelector('.hud');
        assert.equal(hud.className, 'hud hurt');
        assert.deepEqual(hud.styleProps, { '--hp': '0.2439', '--xp': '0.75' });
        assert.deepEqual(portraits, [{ src: 'https://img.example/ren.png', name: 'Ren', frame: 'rounded', size: 'lg' }]);
        assert.equal(el.querySelector('.who').textContent.replace(/\s+/g, ' ').trim(), 'Ren Lv 4 ranger');
        assert.equal(el.querySelector('.bar.hp span').textContent, 'HP 20 / 82');
        assert.equal(el.querySelector('.bar.xp span').textContent, 'EXP 75%');
        assert.deepEqual(el.querySelectorAll('.badge').map(b => [b.textContent.replace(/\s+/g, ''), b.className]), [['poisoned×23', 'badge'], ['blessed5', 'badge long']]);
        assert.equal(el.querySelectorAll('.none').length, 0);
        assert.equal(el.querySelector('.time').textContent, 'Day 3, 09:30');
        assert.equal(el.querySelector('.place').className, 'place moved');
        assert.ok(css.includes('@keyframes ss-example-hud-card-pulse'));
        assert.ok(css.includes('[data-ss-screen="example/hud-card"] .hurt .bar.hp > i { animation: ss-example-hud-card-pulse 1s ease-in-out infinite }'));
        // No PC yet: nothing.
        const empty = show('hud-card', { state: STATE, q: { pc: null, xp: null } }, { widgets });
        assert.equal(empty.el.querySelectorAll('.hud').length, 0);
    });

    test(`example 2: inline status card, all lines and "only what changed" (${label})`, () => {
        language = evaluator;
        const q = {
            events: [{ id: 'th_aaaaaaaa', kind: 'event', key: 'Dragon sighted', summary: 'Smoke over the eastern ridge', fields: { due: 'dusk' } }],
            quests: [{ id: 'th_bbbbbbbb', kind: 'quest', key: 'Granary Rats', fields: { goal: 'clear the cellar' } }],
            progress: { have: 2, need: 3, met: false },
        };
        const ops = [{ op: 'replace', path: '/domains/director/time/minutes', value: STATE.domains.director.time.minutes }];
        const rows = el => el.querySelectorAll('.row').map(row => [row.querySelector('.k').textContent, row.querySelector('.v').textContent.replace(/\s+/g, ' ').trim(), row.className]);
        const all = show('status-card', { state: STATE, q, ops, settings: {} });
        assert.deepEqual(rows(all.el), [
            ['Time', 'Day 3, 09:30', 'row new'],
            ['Place', 'Bluewatch Village · Lakeshore', 'row'],
            ['Next', 'Smoke over the eastern ridge — due dusk', 'row'],
            ['Goal', 'Granary Rats — clear the cellar 2 / 3', 'row goal'],
        ]);
        assert.deepEqual(all.el.querySelector('.goal').styleProps, { '--done': '0.6667' });
        const only = show('status-card', { state: STATE, q: { ...q, progress: { have: 3, need: 3, met: true } }, ops, settings: { onlyChanged: true } });
        assert.deepEqual(rows(only.el), [['Time', 'Day 3, 09:30', 'row new']]);
        assert.equal(only.el.querySelector('.status-card').className, 'status-card quiet');
    });

    test(`example 3: points-buy form fills the draft and submits it to party.create (${label})`, async () => {
        language = evaluator;
        const rules = { points: 12, min: 1, max: 8, stats: ['STR', 'VIT', 'AGI'], races: [{ id: 'elf', name: 'Elf', note: 'Keen eyes' }, { id: 'dwarf', name: 'Dwarf', note: 'Stout' }], talents: [{ id: 'keen', name: 'Keen' }, { id: 'tough', name: 'Tough' }] };
        const steppers = [];
        const apis = [];
        const widgets = {
            'ss.stepper': {
                render(el, props, api) {
                    steppers.push(props);
                    apis.push(api);
                    el.textContent = `${props.label}=${props.value}`;
                    return { update(next) { steppers.push(next); el.textContent = `${next.label}=${next.value}`; } };
                },
            },
        };
        const calls = [];
        const draft = { name: '', race: '', stats: { STR: 1, VIT: 1, AGI: 1 }, talents: [] };
        const { el } = show('points-buy', { q: { rules }, draft }, { widgets, command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; } });
        assert.deepEqual(el.querySelectorAll('option').map(o => [o.getAttribute('value'), o.textContent, o.getAttribute('title')]), [['', 'Choose…', null], ['elf', 'Elf', 'Keen eyes'], ['dwarf', 'Dwarf', 'Stout']]);
        assert.equal(el.querySelector('legend small').textContent, '12 points to spend · 1–8 each');
        assert.deepEqual(steppers.map(p => [p.name, p.value, p.min, p.max]), [['stats.STR', 1, 1, 8], ['stats.VIT', 1, 1, 8], ['stats.AGI', 1, 1, 8]]);

        const name = el.querySelector('input');
        name.value = 'Ren';
        name.dispatch('input');
        const select = el.querySelector('select');
        select.value = 'elf';
        select.dispatch('change');
        // The steppers fill the draft the way ss.stepper does: api.onDraft(name, value).
        apis[1].onDraft('stats.VIT', 5);
        assert.equal(draft.stats.VIT, 5);
        assert.deepEqual(steppers.at(-1), { name: 'stats.VIT', label: 'VIT', value: 5, min: 1, max: 8 }, 'that stepper got its new value');
        assert.equal(el.querySelectorAll('ss-widget').map(w => w.textContent).join(' '), 'STR=1 VIT=5 AGI=1');
        const tough = el.querySelectorAll('input').find(input => input.getAttribute('value') === 'tough');
        tough.checked = true;
        tough.dispatch('change');
        el.querySelector('textarea').value = 'From the lake.';
        el.querySelector('textarea').dispatch('input');
        assert.equal(el.querySelector('button').textContent, 'Create Ren');
        el.querySelector('form').dispatch('submit');
        await new Promise(resolve => setTimeout(resolve));
        assert.deepEqual(calls, [['party.create', { name: 'Ren', race: 'elf', stats: { STR: 1, VIT: 5, AGI: 1 }, talents: ['tough'], note: 'From the lake.' }]]);
        assert.equal(draft.name, 'Ren', 'the dialog\'s draft holds the input');
    });
}

test('example 3 with Story Block\'s own ss.stepper: its + button fills the dialog\'s draft', () => {
    const rules = { points: 12, min: 1, max: 8, stats: ['STR', 'VIT'], races: [], talents: [] };
    const draft = { name: '', race: '', stats: { STR: 1, VIT: 1 }, talents: [] };
    language = LANGUAGES[0][1];
    const { el } = show('points-buy', { q: { rules }, draft }, { widgets: standardWidgets });
    const [str] = el.querySelectorAll('ss-widget');
    str.querySelector('.ss-w-stepper-inc').click();
    str.querySelector('.ss-w-stepper-inc').click();
    assert.deepEqual(draft.stats, { STR: 3, VIT: 1 });
    assert.equal(el.querySelectorAll('ss-widget')[0], str, 'the widget is kept, given new props');
});
