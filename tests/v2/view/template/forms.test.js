// Forms (SPEC §13.6): inputs fill a draft held by the view (never the state); submit sends it as one command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, renderTemplate } from '../../../../src/v2/view/template/index.js';
import { fakeEvaluate, installFakeDom } from './helpers.js';

function setup(html, scope, options = {}) {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = compileTemplate(html);
    assert.deepEqual(compiled.warnings, []);
    const drafts = [];
    const calls = [];
    const view = renderTemplate(el, compiled, scope, {
        evaluate: fakeEvaluate,
        onDraft: (path, value, draft) => drafts.push([path, value, draft]),
        command: async (type, payload) => {
            calls.push([type, payload]);
            return { ok: true };
        },
        ...options,
    });
    return { doc, el, view, drafts, calls, compiled };
}

const type = (input, value, event = 'input') => {
    input.value = value;
    input.dispatch(event);
};

const FORM = `<form data-submit="party.create">
    <input name="n" data-draft="name" placeholder="Name">
    <input type="number" data-draft="stats.STR" min="1" max="8">
    <input type="range" data-draft="draft.stats.VIT" min="1" max="8">
    <select data-draft="role"><option value="">—</option><option data-each="q.roles as r" data-bind-attr="value: r.id">{{ r.name }}</option></select>
    <label data-each="q.origins as o"><input type="radio" name="origin" data-draft="origin" data-bind-attr="value: o">{{ o }}</label>
    <input type="checkbox" data-draft="hardcore">
    <label data-each="q.perks as p"><input type="checkbox" data-draft="perks" data-bind-attr="value: p">{{ p }}</label>
    <textarea data-draft="bio"></textarea>
    <p class="left">Points left: {{ 12 - draft.stats.STR - draft.stats.VIT }}</p>
    <button>Create</button>
</form>`;

const scope = () => ({
    q: { roles: [{ id: 'ranger', name: 'Ranger' }, { id: 'mage', name: 'Mage' }], origins: ['north', 'south'], perks: ['keen', 'tough', 'lucky'] },
    draft: { stats: { STR: 1, VIT: 1 } },
});

test('every input type fills the draft the host holds; the view re-renders from it', () => {
    const given = scope();
    const { el, view, drafts } = setup(FORM, given);
    const inputs = el.querySelectorAll('input');
    const [name, str, vit] = inputs;
    assert.equal(str.value, '1', 'the draft is shown');
    assert.equal(el.querySelector('.left').textContent, 'Points left: 10');
    type(name, 'Ren');
    type(str, '4');
    type(vit, '3', 'change');
    assert.equal(el.querySelector('.left').textContent, 'Points left: 5', 'derived text follows the draft');
    type(str, 'abc');
    assert.equal(view.draft().stats.STR, 4, 'not a number: the draft is kept');
    type(str, '');
    assert.equal(view.draft().stats.STR, null, 'an empty number field is null');
    type(str, '4');

    const select = el.querySelector('select');
    assert.deepEqual(select.querySelectorAll('option').map(o => o.getAttribute('value')), ['', 'ranger', 'mage']);
    type(select, 'mage', 'change');

    const radios = inputs.filter(input => input.getAttribute('name') === 'ss-t-origin');
    radios[1].checked = true;
    radios[1].dispatch('change');
    radios[0].checked = false;
    radios[0].dispatch('change');
    assert.equal(view.draft().origin, 'south', 'an unchecked radio does not clear the choice');

    const hardcore = inputs.find(input => input.getAttribute('data-draft') === 'hardcore');
    hardcore.checked = true;
    hardcore.dispatch('change');

    const perks = inputs.filter(input => input.getAttribute('data-draft') === 'perks');
    perks[2].checked = true;
    perks[2].dispatch('change');
    perks[0].checked = true;
    perks[0].dispatch('change');
    perks[2].checked = false;
    perks[2].dispatch('change');

    type(el.querySelector('textarea'), 'From the lake.');

    assert.deepEqual(view.draft(), {
        stats: { STR: 4, VIT: 3 }, name: 'Ren', role: 'mage', origin: 'south', hardcore: true, perks: ['keen'], bio: 'From the lake.',
    });
    assert.equal(view.draft(), given.draft, 'the dialog\'s own draft object was filled (its submit reads it)');
    assert.deepEqual(drafts[0].slice(0, 2), ['name', 'Ren']);
    assert.equal(drafts[0][2], given.draft);
    assert.equal(drafts.find(entry => entry[0] === 'stats.VIT')[1], 3, 'a draft. prefix is the same path');
    // The checked state follows the draft on re-render.
    assert.deepEqual(radios.map(r => r.checked), [false, true]);
    assert.deepEqual(perks.map(p => p.checked), [true, false, false]);
});

test('submit sends the whole draft as one command, and nothing else', async () => {
    const given = { ...scope(), draft: Object.freeze({ stats: Object.freeze({ STR: 1, VIT: 1 }) }) };
    const { el, calls, view } = setup(FORM, given);
    const [name, str] = el.querySelectorAll('input');
    type(name, 'Ren');
    type(str, '5');
    const event = el.querySelector('form').dispatch('submit');
    assert.equal(event.defaultPrevented, true, 'the page never navigates');
    await new Promise(resolve => setTimeout(resolve));
    assert.deepEqual(calls, [['party.create', { stats: { STR: 5, VIT: 1 }, name: 'Ren' }]]);
    assert.deepEqual(given.draft, { stats: { STR: 1, VIT: 1 } }, 'a frozen host draft is copied, never written');
    assert.notEqual(view.draft(), given.draft);
    calls[0][1].stats.STR = 99;
    el.querySelector('form').dispatch('submit');
    await new Promise(resolve => setTimeout(resolve));
    assert.equal(calls[1][1].stats.STR, 5, 'each submit gets its own copy');
});

test('onSubmit takes the draft instead of running the command (a dialog that runs its own submit)', () => {
    const submitted = [];
    const { el, calls } = setup('<form data-submit="party.create"><input data-draft="name"></form>', {}, { onSubmit: (type, draft) => submitted.push([type, draft]) });
    type(el.querySelector('input'), 'Ren');
    el.querySelector('form').dispatch('submit');
    assert.deepEqual(submitted, [['party.create', { name: 'Ren' }]]);
    assert.equal(calls.length, 0);
});

test('a data-submit button outside a form sends the draft on click', async () => {
    const { el, calls } = setup('<div><input data-draft="pick"><button data-submit="quest.take">Take</button></div>', {});
    type(el.querySelector('input'), 'q_1');
    el.querySelector('button').click();
    await new Promise(resolve => setTimeout(resolve));
    assert.deepEqual(calls, [['quest.take', { pick: 'q_1' }]]);
});

test('a field being typed in is not overwritten by a re-render', () => {
    const { doc, el, view } = setup('<input data-draft="name"><p>{{ draft.name }}</p>', { draft: { name: 'A' } });
    const input = el.querySelector('input');
    input.focus();
    input.value = 'Ren ';
    input.dispatch('input');
    assert.equal(input.value, 'Ren ', 'the focused field keeps what the reader typed');
    assert.equal(el.querySelector('p').textContent, 'Ren ');
    // While focused, a re-render from elsewhere leaves the field as typed.
    view.update({ draft: { name: 'A' } });
    assert.equal(input.value, 'Ren ');
    assert.equal(el.querySelector('p').textContent, 'A', 'the new host draft is shown elsewhere');
    doc.activeElement = null;
    view.update({ draft: { name: 'B' } });
    assert.equal(input.value, 'B', 'once the reader leaves the field it follows the draft');
});

test('the host can reset the draft by passing a new one; dynamic keys inside loops', () => {
    const html = '<div data-each="q.stats as k"><input type="number" data-draft="stats[k]"><span>{{ k }}={{ draft.stats[k] }}</span></div>';
    const doc = installFakeDom();
    const el = doc.createElement('div');
    const compiled = compileTemplate(html);
    const first = { stats: { STR: 1, DEX: 2 } };
    const options = { evaluate: fakeEvaluate };
    const view = renderTemplate(el, compiled, { q: { stats: ['STR', 'DEX'] }, draft: first }, options);
    const [, dex] = el.querySelectorAll('input');
    type(dex, '6');
    assert.deepEqual(view.draft(), { stats: { STR: 1, DEX: 6 } });
    assert.deepEqual(el.querySelectorAll('span').map(s => s.textContent), ['STR=1', 'DEX=6']);
    renderTemplate(el, compiled, { q: { stats: ['STR', 'DEX'] }, draft: first }, options);
    assert.equal(view.draft().stats.DEX, 6, 'the same host draft does not undo the reader\'s input');
    renderTemplate(el, compiled, { q: { stats: ['STR', 'DEX'] }, draft: { stats: { STR: 3, DEX: 3 } } }, options);
    assert.deepEqual(el.querySelectorAll('input').map(i => i.value), ['3', '3'], 'a new draft resets the form');
});

test('widgets inside a form read and write the draft through api.draft', () => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    const compiled = compileTemplate('<form data-submit="party.create"><ss-widget name="ss.stepper" data-props=\'{"draft":"stats.STR","min":1,"max":8}\'></ss-widget><p>{{ draft.stats.STR }}</p></form>');
    let api;
    const widgets = { 'ss.stepper': { render(target, props, widgetApi) { api = widgetApi; target.textContent = props.draft; } } };
    const view = renderTemplate(el, compiled, { draft: { stats: { STR: 2 } } }, { widgets });
    assert.equal(api.draft.get('stats.STR'), 2);
    api.draft.set('stats.STR', 3);
    assert.equal(view.draft().stats.STR, 3);
    assert.equal(el.querySelector('p').textContent, '3');
    assert.deepEqual(api.draft.value(), { stats: { STR: 3 } });
    api.onDraft('stats.STR', 4);
    assert.equal(view.draft().stats.STR, 4, 'onDraft(name, value), as ss.stepper calls it');
});
