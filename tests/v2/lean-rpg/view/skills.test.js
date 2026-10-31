// The Skills view (src/v2/lean-rpg/view/skills.js, mockup 31-skills): rank tones, the mastery bar, the roll line from the live
// sheet, empty slots, the pencil that edits the name and the description only (one multi-field dm.set), and the same on the real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { readParty } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { createPartyWidget } from '../../../../src/v2/lean-rpg/view/party.js';
import { RANK_TONES, masteryOf, renderSkills, rollOf } from '../../../../src/v2/lean-rpg/view/skills.js';
import { reply, rebuilt } from '../../data-modules/helpers.js';
import { fakeState } from './helpers.js';
import { begin, fieldsOf, makeBlocks, page, party, settle } from './page.js';

const template = role => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.definition.role === role).definition);
const character = (fields = {}) => ({ definition: template('character'), fields: { who: 'Wessel', str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10, soul: 2, ...fields } });
const SKILLS = {
    who: 'Wessel',
    skill1: 'Iron Breath', about1: 'The drill-yard breathing that keeps you on your feet when you are spent.', stat1: 'vit', uses1: 'stamina', rank1: 2, practice1: 40,
    skill2: 'Short blade', about2: 'Quick cuts and guards with a long knife or short sword.', stat2: 'agi', uses2: 'stamina', rank2: 0, practice2: 65,
    skill3: 'Rope work', about3: 'Knots, climbing, hauling, and throwing a line true.', stat3: 'dex', uses3: 'stamina', rank3: 1, practice3: 10,
    skill4: 'River swimming', about4: 'Cold water, currents, and getting a crewmate out alive.', stat4: 'vit', uses4: 'stamina', rank4: 3, practice4: 100,
};
const state = (skills = SKILLS) => fakeState([character(), { definition: template('skills'), fields: skills }]);
const wessel = (skills) => readParty(state(skills), { own: 'Wessel' })[0];

function draw(extra = {}, skills) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const calls = [], back = [];
    const api = { command: async (type, payload) => { calls.push([type, payload]); return extra.result ?? { ok: true }; } };
    const view = renderSkills(el, { character: wessel(skills), api: extra.noCommand ? {} : api, onBack: () => back.push(1), session: extra.session });
    return { doc, el, view, calls, back };
}
const rows = el => el.querySelectorAll('.rpg-skill');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('mastery: four cells, rank + 1 lit and the next filling with practice; Master is full; the tone follows the rank', () => {
    const at = (rank, practice) => masteryOf({ rank, practice, rankName: ['Novice', 'Adept', 'Expert', 'Master'][rank] });
    assert.deepEqual(at(0, 0), { value: 1, max: 4, tone: 'neutral', text: 'Novice · 0 / 100 to Adept' });
    assert.deepEqual(at(0, 65), { value: 1.65, max: 4, tone: 'neutral', text: 'Novice · 65 / 100 to Adept' });
    assert.deepEqual(at(1, 10), { value: 2.1, max: 4, tone: 'info', text: 'Adept · 10 / 100 to Expert' });
    assert.deepEqual(at(2, 40), { value: 3.4, max: 4, tone: 'accent', text: 'Expert · 40 / 100 to Master' });
    assert.deepEqual(at(3, 100), { value: 4, max: 4, tone: 'good', text: 'Master' });
    assert.deepEqual(at(3, 0), { value: 4, max: 4, tone: 'good', text: 'Master' }, 'Master is always full');
    assert.deepEqual([...RANK_TONES], ['neutral', 'info', 'accent', 'good']);
});

test('the roll: d20 + half the stat + rank + 2 × Soul Class, worked out from the live sheet', () => {
    const [iron, blade, rope, swim] = wessel().skills;
    assert.deepEqual(rollOf(iron, wessel()), { total: 12, stat: 'VIT', value: 12, half: 6, rank: 2, bonus: 4 });
    assert.equal(rollOf(blade, wessel()).total, 9, 'AGI 11 → +5, Novice +0, class II +4');
    assert.equal(rollOf(rope, wessel()).total, 10);
    // Under other numbers (Settings → RPG): a third of the stat, a Soul Class worth three.
    assert.deepEqual(rollOf(iron, wessel(), { statDivisor: 3, classWeight: 3 }), { total: 4 + 2 + 6, stat: 'VIT', value: 12, half: 4, rank: 2, bonus: 6 });
    assert.equal(rollOf(swim, wessel()).total, 13);
    const none = rollOf({ ...iron, stat: null }, wessel());
    assert.deepEqual([none.stat, none.total], [null, 6], 'a skill with no stat of its own: rank and class only');
});

test('the view: a card per skill with the rank pill, STAT · Uses, what it does, the mastery bar and the roll line', () => {
    const { el } = draw();
    assert.equal(el.querySelector('.rpg-sheet-name').textContent, 'Wessel\'s skills');
    assert.deepEqual(el.querySelectorAll('.rpg-pills .ss-pill').map(node => node.textContent), ['Soul Class II', '4 of 5 slots']);
    assert.deepEqual(rows(el).map(row => row.querySelector('.rpg-skill-name').textContent), ['Iron Breath', 'Short blade', 'Rope work', 'River swimming']);
    assert.deepEqual(rows(el).map(row => row.querySelector('.rpg-rank').textContent), ['Expert', 'Novice', 'Adept', 'Master']);
    assert.deepEqual(rows(el).map(row => ['neutral', 'info', 'accent', 'good'].find(tone => row.querySelector('.rpg-rank').classList.contains(`rpg-tone-${tone}`)) ?? 'neutral'), ['accent', 'neutral', 'info', 'good']);
    assert.deepEqual(rows(el).map(row => row.querySelector('.rpg-skill-uses').textContent), ['VIT · Stamina', 'AGI · Stamina', 'DEX · Stamina', 'VIT · Stamina']);
    assert.equal(rows(el)[0].querySelector('.rpg-skill-about').textContent, SKILLS.about1);
    assert.deepEqual(rows(el).map(row => row.querySelector('.rpg-skill-roll').textContent), [
        'Rolls with it: d20 +12 = VIT 12 → +6 · Expert +2 · Soul Class II +4',
        'Rolls with it: d20 +9 = AGI 11 → +5 · Novice +0 · Soul Class II +4',
        'Rolls with it: d20 +10 = DEX 10 → +5 · Adept +1 · Soul Class II +4',
        'Rolls with it: d20 +13 = VIT 12 → +6 · Master +3 · Soul Class II +4',
    ]);
    assert.equal(rows(el)[0].querySelector('.rpg-skill-roll b').textContent, 'Rolls with it: d20 +12');
});

test('the mastery bar is the real ss.meter: four cells, the value, the words and the tone', () => {
    const { el } = draw();
    const meters = rows(el).map(row => row.querySelector('.rpg-skill-meter .ss-w-meter'));
    assert.deepEqual(meters.map(node => node.getAttribute('aria-valuemax')), ['4', '4', '4', '4']);
    assert.deepEqual(meters.map(node => node.getAttribute('aria-valuenow')), ['3.4', '1.65', '2.1', '4']);
    assert.match(meters[0].getAttribute('aria-valuetext'), /Expert · 40 \/ 100 to Master/);
    assert.match(meters[3].getAttribute('aria-valuetext'), /Master/);
    assert.deepEqual(['accent', 'neutral', 'info', 'good'].map((tone, at) => meters[at].classList.contains(`ss-w-tone-${tone}`)), [true, true, true, true]);
    // Expert 40 / 100: three cells lit and a fourth partly; Master: all four lit; Novice 65: one lit and the next partly.
    const lit = meter => [meter.querySelectorAll('.ss-w-on').length, meter.querySelectorAll('.ss-w-part').length];
    assert.deepEqual(meters.map(lit), [[3, 1], [1, 1], [2, 1], [4, 0]]);
});

test('the legend uses the same tones as the rank pills', () => {
    const { el } = draw();
    const pills = el.querySelectorAll('.rpg-skill-legend .ss-pill');
    assert.deepEqual(pills.map(node => node.textContent), ['Novice +0', 'Adept +1', 'Expert +2', 'Master +3']);
    assert.deepEqual(pills.map(node => ['info', 'accent', 'good'].find(tone => node.classList.contains(`rpg-tone-${tone}`)) ?? 'neutral'), ['neutral', 'info', 'accent', 'good']);
    assert.match(el.querySelector('.rpg-skill-legend').textContent, /^Mastery:.*to rolls with that skill$/);
});

test('an empty slot is a dashed line, one per slot, and a skill-less character has five', () => {
    const { el } = draw();
    assert.deepEqual(el.querySelectorAll('.rpg-skill-empty').map(node => node.textContent), ['Empty slot · filled when the story has Wessel learn a new skill']);
    const bare = draw({}, { who: 'Wessel' });
    assert.equal(bare.el.querySelectorAll('.rpg-skill-empty').length, 5);
    assert.equal(rows(bare.el).length, 0);
    assert.equal(bare.el.querySelector('.rpg-slots').textContent, '0 of 5 slots');
});

test('a skill from a block with no stat of its own says what it can: the stat is the story\'s pick', () => {
    const { el } = draw({}, { who: 'Wessel', skill1: 'Hide', rank1: 1, stat1: '', uses1: '' });
    const row = rows(el)[0];
    assert.ok(!row.querySelector('.rpg-skill-uses'));
    assert.equal(row.querySelector('.rpg-skill-roll').textContent, 'Rolls with the stat the story picks: Adept +1 · Soul Class II +4');
});

test('Back to the party calls back; the note says rank and practice only move through play', () => {
    const { el, back } = draw();
    el.querySelector('.rpg-skills-back').click();
    assert.equal(back.length, 1);
    assert.match(el.querySelector('.rpg-skill-note').textContent, /Rank and practice only move through play/);
});

test('the pencil edits the name and the description and nothing else: two fields, one multi-field dm.set', async () => {
    const { el, calls } = draw();
    const pencil = rows(el)[0].querySelector('.rpg-skill-pencil');
    assert.match(pencil.getAttribute('aria-label'), /Edit Iron Breath's name or description/);
    pencil.click();
    const form = rows(el)[0].querySelector('.rpg-skill-form');
    assert.ok(form);
    assert.deepEqual(form.querySelectorAll('[data-skill-field]').map(node => node.getAttribute('data-skill-field')), ['name', 'about'], 'no stat, uses, rank or practice to type');
    assert.equal(form.querySelectorAll('select').length, 0);
    assert.equal(form.querySelector('[data-skill-field="name"]').value, 'Iron Breath');
    assert.equal(form.querySelector('[data-skill-field="name"]').getAttribute('maxlength'), '40');
    assert.equal(form.querySelector('[data-skill-field="about"]').getAttribute('maxlength'), '120');
    form.querySelector('[data-skill-field="name"]').value = '  Iron   Breath II ';
    form.querySelector('[data-skill-field="name"]').dispatch('input');
    form.querySelector('[data-skill-field="about"]').value = 'Breathing drills.';
    form.querySelector('[data-skill-field="about"]').dispatch('input');
    form.querySelector('.rpg-skill-save').click();
    await tick();
    assert.deepEqual(calls, [['dm.set', { module: 'pack.chat/skills', fields: { skill1: 'Iron Breath II', about1: 'Breathing drills.' } }]]);
});

test('an empty name is refused in plain words, an unchanged skill sends nothing, Cancel closes the editor, a failed save says why and keeps it', async () => {
    const one = draw();
    rows(one.el)[1].querySelector('.rpg-skill-pencil').click();
    const form = () => rows(one.el)[1].querySelector('.rpg-skill-form');
    form().querySelector('[data-skill-field="name"]').value = '   ';
    form().querySelector('[data-skill-field="name"]').dispatch('input');
    form().querySelector('.rpg-skill-save').click();
    await tick();
    assert.deepEqual(one.calls, []);
    assert.equal(one.el.querySelector('.rpg-skill-status').textContent, 'A skill needs a name.');
    assert.ok(form(), 'the editor stays open');
    one.el.querySelector('.rpg-skill-cancel').click();
    assert.ok(!form());
    assert.equal(one.calls.length, 0);

    const same = draw();
    rows(same.el)[0].querySelector('.rpg-skill-pencil').click();
    rows(same.el)[0].querySelector('.rpg-skill-save').click();
    await tick();
    assert.deepEqual(same.calls, [], 'nothing changed: nothing sent');
    assert.ok(!rows(same.el)[0].querySelector('.rpg-skill-form'), 'and the editor closes');

    const refused = draw({ result: { ok: false, code: 'REFUSED', message: 'Skills: that is locked; nothing applied.' } });
    rows(refused.el)[0].querySelector('.rpg-skill-pencil').click();
    const input = rows(refused.el)[0].querySelector('[data-skill-field="name"]');
    input.value = 'Other';
    input.dispatch('input');
    rows(refused.el)[0].querySelector('.rpg-skill-save').click();
    await tick();
    assert.equal(refused.el.querySelector('.rpg-skill-status').textContent, 'Skills: that is locked; nothing applied.');
    assert.ok(rows(refused.el)[0].querySelector('.rpg-skill-form'), 'a refused save keeps the editor and its text');
    assert.equal(rows(refused.el)[0].querySelector('[data-skill-field="name"]').value, 'Other');
});

test('without a command there is no pencil; the Skills view then only reads', () => {
    const { el } = draw({ noCommand: true });
    assert.equal(el.querySelectorAll('.rpg-skill-pencil').length, 0);
    assert.equal(rows(el).length, 4);
});

test('names and descriptions from the story are text, never markup', () => {
    const mark = '<img src=x onerror="globalThis.pwned=1"><b>bold</b>';
    const { el } = draw({}, { who: 'Wessel', skill1: mark, about1: mark, stat1: 'str', uses1: 'mana' });
    assert.ok(el.textContent.includes(mark));
    assert.equal(el.querySelectorAll('img, script, iframe, style, a').length, 0);
    assert.equal(globalThis.pwned, undefined);
});

test('the Party widget opens the view in place of the cards and a story change keeps it (and an open editor) open', async () => {
    let current = state();
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const calls = [];
    const widget = createPartyWidget({ headState: () => current, readerName: () => 'Wessel' });
    const handle = widget.render(el, {}, { command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; } });
    el.querySelector('.rpg-skills-open').click();
    assert.ok(el.querySelector('.rpg-skills-view'));
    assert.equal(el.querySelector('.rpg-main').hidden, true);
    rows(el)[2].querySelector('.rpg-skill-pencil').click();
    el.querySelector('[data-skill-field="name"]').value = 'Rope-work';
    el.querySelector('[data-skill-field="name"]').dispatch('input');
    current = state({ ...SKILLS, practice1: 50 });
    handle.update({});
    assert.ok(el.querySelector('.rpg-skills-view'), 'still open after the page drew it again');
    assert.equal(el.querySelector('[data-skill-field="name"]').value, 'Rope-work', 'with what was typed');
    assert.match(rows(el)[0].querySelector('.ss-w-meter').getAttribute('aria-valuetext'), /50 \/ 100/, 'and the new numbers');
    // The skill under the editor was renamed by the story: the editor closes and says so.
    current = state({ ...SKILLS, skill3: 'Ropes' });
    handle.update({});
    assert.ok(!el.querySelector('.rpg-skill-form'));
    assert.match(el.querySelector('.rpg-skill-status').textContent, /changed while you were editing/);
    el.querySelector('.rpg-skills-back').click();
    assert.ok(!el.querySelector('.rpg-skills-view'));
    assert.equal(el.querySelector('.rpg-main').hidden, false);
    assert.deepEqual(calls, []);
});

test('the stylesheet: the rank tones, a two-column list on a wide container, theme tokens only', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    for (const tone of ['info', 'accent', 'good']) assert.match(css, new RegExp(`\\.rpg-tone-${tone} \\{[^}]*var\\(--ss-${tone}\\)`));
    assert.match(css, /\.rpg-skill-empty \{[^}]*dashed/);
    assert.match(css, /@container \(min-width: 760px\) \{\s*\.rpg-skill-list \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css, /\brgba?\(/);
});

test('on the real page: Skills opens the view, the pencil saves one dm.set, rank and practice are untouched, and live = reload = rebuild', async t => {
    const { doc, host, ui } = await page(t);
    await begin(host);
    const { skills } = await makeBlocks(host, { skills: { skill1: 'Iron Breath', about1: 'Drill breathing.', stat1: 'vit', rank1: 1, practice1: 30, skill2: 'Spark', stat2: 'int', uses2: 'mana' } });
    await host.send('Go.', 'The quay.');
    ui.mounts.screen.open('story-block/party');
    await settle();
    party(doc).querySelector('.rpg-skills-open').click();
    const view = party(doc).querySelector('.rpg-skills-view');
    assert.ok(view);
    assert.deepEqual(view.querySelectorAll('.rpg-skill-name').map(node => node.textContent), ['Iron Breath', 'Spark']);
    assert.deepEqual(view.querySelectorAll('.rpg-skill-uses').map(node => node.textContent), ['VIT · Stamina', 'INT · Mana']);
    view.querySelector('.rpg-skill[data-slot="1"] .rpg-skill-pencil').click();
    const name = party(doc).querySelector('[data-skill-field="name"]'), about = party(doc).querySelector('[data-skill-field="about"]');
    name.value = 'Iron Breath II';
    name.dispatch('input');
    about.value = 'Longer drills.';
    about.dispatch('input');
    party(doc).querySelector('.rpg-skill-save').click();
    await settle();
    const fields = fieldsOf(host, skills);
    assert.deepEqual([fields.skill1, fields.about1, fields.rank1, fields.practice1, fields.stat1, fields.uses1], ['Iron Breath II', 'Longer drills.', 1, 30, 'vit', 'stamina']);
    assert.ok(!party(doc).querySelector('.rpg-skill-form'), 'saved: the editor closes');
    assert.equal(party(doc).querySelector('.rpg-skill[data-slot="1"] .rpg-skill-name').textContent, 'Iron Breath II');
    const edits = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'dm.set');
    assert.equal(edits.length, 1, 'one action for both fields');
    assert.match(edits[0].summary, /Skill 1 .* → "Iron Breath II"/);
    rebuilt(host);
    // The story practises the skill and it rises; the view shows it live.
    await host.send('Train.', reply('+ dm skills-1 — drills | kind: practice-1 | amount: 20'.replace('skills-1', 'wessel-skills')));
    assert.equal(fieldsOf(host, skills).practice1, 50);
    rebuilt(host);
});

test('feature off: no Party tab, no Skills view, nothing loaded', async t => {
    const { doc, host, ui, loads } = await page(t, { feature: false });
    await begin(host);
    await makeBlocks(host);
    assert.equal(loads.length, 0);
    assert.equal(ui.screens.resolve('story-block/party'), null);
    assert.equal(ui.screens.resolve('story-block/new-character'), null);
    ui.mounts.screen.open();
    assert.equal(doc.querySelectorAll('.rpg-skills-view').length, 0);
});
