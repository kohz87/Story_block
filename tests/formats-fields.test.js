import test from 'node:test';
import assert from 'node:assert/strict';

import * as fields from '../src/formats/fields.js';
import { normalizeBlock } from '../src/schema.js';

const def = normalizeBlock({
    name: 'Character Sheet',
    tag: 'Character_Sheet',
    format: 'fields',
    fields: [
        { label: 'HP', type: 'meter', max: 100 },
        { label: 'Stamina', type: 'meter', max: 50 },
        { label: 'Gold', type: 'number' },
        { label: 'Status', type: 'text', hint: 'conditions, or "fine"' },
        { label: 'Skills', type: 'list', hint: 'Name rank, comma separated' },
    ],
});

const parsed = body => {
    const result = fields.parse(body, def);
    assert.equal(result.ok, true, result.error);
    return result.state;
};
const entry = (state, label) => state.entries.find(item => item.label === label);

test('exports the format interface', () => {
    assert.equal(fields.id, 'fields');
    for (const name of ['empty', 'isEmpty', 'parse', 'serialize', 'diff', 'rules', 'skeleton']) {
        assert.equal(typeof fields[name], 'function', name);
    }
    assert.deepEqual(fields.empty(def), { entries: [] });
    assert.equal(fields.isEmpty(fields.empty(def)), true);
    assert.equal(fields.isEmpty(null), true);
});

test('parses the canonical shape into typed entries in definition order', () => {
    const state = parsed('Skills: Sword 3, Bow 1\nHP: 80/100\nStamina: 40/50\nGold: 120\nStatus: fine');
    assert.deepEqual(state.entries, [
        { label: 'HP', type: 'meter', raw: '80/100', value: 80, max: 100 },
        { label: 'Stamina', type: 'meter', raw: '40/50', value: 40, max: 50 },
        { label: 'Gold', type: 'number', raw: '120', value: 120 },
        { label: 'Status', type: 'text', raw: 'fine', value: 'fine' },
        { label: 'Skills', type: 'list', raw: 'Sword 3, Bow 1', value: 'Sword 3, Bow 1', items: ['Sword 3', 'Bow 1'] },
    ]);
    assert.equal(fields.isEmpty(state), false);
});

test('round-trips: parse(serialize(state)) gives an equal state', () => {
    const state = parsed('HP: 80/100\nStamina: 40/50\nGold: -3.5\nStatus: tired\nstill walking\nSkills: none\nMood: calm');
    const again = fields.parse(fields.serialize(state, def), def);
    assert.equal(again.ok, true);
    assert.deepEqual(again.state, state);
});

test('serialize writes the canonical lines and drops change notes', () => {
    const state = parsed('**HP:** 80 / 100 (+5 drank potion) | Stamina: 30 (=) | Gold: 1,200 coins\nSkills: Sword 3,, Bow 1,\nStatus: fine');
    assert.equal(fields.serialize(state, def), 'HP: 80/100\nStamina: 30/50\nGold: 1200\nStatus: fine\nSkills: Sword 3, Bow 1');
    // Only raw changes on the way round: notes are per reply, not state.
    const again = fields.parse(fields.serialize(state, def), def).state;
    assert.deepEqual(again.entries.map(({ raw, ...rest }) => rest), state.entries.map(({ raw, ...rest }) => rest));
    assert.equal(entry(again, 'HP').raw, '80/100');
});

test('keeps the change note in raw and reads value and max from meters', () => {
    const state = parsed('HP: 65/100 (-15 arrow wound)\nStamina: 20 / 40 (=)');
    assert.deepEqual(entry(state, 'HP'), { label: 'HP', type: 'meter', raw: '65/100 (-15 arrow wound)', value: 65, max: 100 });
    assert.deepEqual(entry(state, 'Stamina'), { label: 'Stamina', type: 'meter', raw: '20 / 40 (=)', value: 20, max: 40 });
    assert.equal(entry(parsed('HP: 70'), 'HP').max, 100, 'max falls back to the definition');
    assert.equal(entry(parsed('Stamina: 12'), 'Stamina').max, 50);
    assert.equal(entry(parsed('HP: [55]/100'), 'HP').value, 55, 'a bracketed real number is still a number');
});

test('reads numbers forgivingly', () => {
    assert.equal(entry(parsed('Gold: 1,200'), 'Gold').value, 1200);
    assert.equal(entry(parsed('Gold: -40 (debt)'), 'Gold').value, -40);
    assert.equal(entry(parsed('Gold: about 2.5 bars'), 'Gold').value, 2.5);
    assert.equal(entry(parsed('Gold: 120 (+20 loot)'), 'Gold').value, 120);
    assert.equal(entry(parsed('Gold: 1-2'), 'Gold').value, 1);
    const unreadable = parsed('Gold: lots\nStatus: fine');
    assert.equal(entry(unreadable, 'Gold').value, null);
    assert.equal(entry(unreadable, 'Gold').raw, 'lots');
});

test('labels match case-insensitively through bold, bullets and emoji', () => {
    const state = parsed([
        '- **hp**: 50/100',
        '* *STAMINA*: 10/50',
        '• Gold:** 7',
        '**Status: bruised**',
        '1. ⭐ skills: Lockpicking 2',
    ].join('\n'));
    assert.deepEqual(state.entries.map(item => [item.label, item.value]), [
        ['HP', 50], ['Stamina', 10], ['Gold', 7], ['Status', 'bruised'], ['Skills', 'Lockpicking 2'],
    ]);
});

test('splits several fields on one line at pipes', () => {
    const state = parsed('HP: 80/100 | Stamina: 30/50 | Gold: 120');
    assert.deepEqual(state.entries.map(item => [item.label, item.value]), [['HP', 80], ['Stamina', 30], ['Gold', 120]]);
});

test('a pipe inside a text or list value does not split it', () => {
    const state = parsed('HP: 80/100\nStatus: tired | hungry\nSkills: Sword 3 | Bow 1, Climb 2');
    assert.equal(entry(state, 'Status').value, 'tired | hungry');
    assert.deepEqual(entry(state, 'Skills').items, ['Sword 3 | Bow 1', 'Climb 2']);
    // ...but a known label after the pipe does.
    const split = parsed('Status: tired | Gold: 5');
    assert.equal(entry(split, 'Status').value, 'tired');
    assert.equal(entry(split, 'Gold').value, 5);
    // After a meter an unknown label splits too: a number cannot hold a pipe.
    const unknown = parsed('HP: 80/100 | Mana: 5');
    assert.equal(entry(unknown, 'HP').raw, '80/100');
    assert.deepEqual(entry(unknown, 'Mana'), { label: 'Mana', type: 'text', raw: '5', value: '5', unknown: true });
});

test('lines without a label continue the previous text or list value', () => {
    const state = parsed('Status: winded after the climb,\nleft knee aching\nSkills:\n- Sword 3\n- Bow 1\n- Tracking: novice\nGold: 4\nstray words after a number');
    assert.equal(entry(state, 'Status').value, 'winded after the climb,\nleft knee aching');
    assert.deepEqual(entry(state, 'Skills').items, ['Sword 3', 'Bow 1', 'Tracking: novice']);
    assert.equal(entry(state, 'Gold').raw, '4', 'nothing continues a number');
    assert.equal(state.entries.length, 3);
});

test('prose before the first label and markdown furniture are ignored', () => {
    const state = parsed('Here is the sheet.\n```\nHP: 90/100\n---\nStatus: fine\n```');
    assert.deepEqual(state.entries.map(item => item.label), ['HP', 'Status']);
    assert.equal(entry(state, 'Status').value, 'fine');
});

test('lists: trimmed, empties dropped, "none" and friends are an empty list', () => {
    assert.deepEqual(entry(parsed('Skills:  Sword 3 , , Bow 1 ,'), 'Skills').items, ['Sword 3', 'Bow 1']);
    for (const word of ['nothing', 'None', '-', 'none.']) {
        const skills = entry(parsed(`HP: 5/100\nSkills: ${word}`), 'Skills');
        assert.deepEqual(skills.items, [], word);
        assert.equal(skills.value, '');
    }
    assert.equal(fields.serialize(parsed('Skills: none'), def), 'Skills: none');
});

test('placeholders copied from the skeleton give null values and do not count', () => {
    const skeleton = fields.skeleton(def);
    const all = fields.parse(skeleton, def);
    assert.equal(all.ok, false);
    assert.match(all.error, /placeholder/);

    // Stamina is the one real value that keeps this body valid.
    const state = parsed('HP: [0-100]/100 [(±N reason) or (=)]\nStamina: 20/50\nGold: ?\nStatus: [conditions, or "fine"]\nSkills: [Name rank, comma separated]\nMood: [value]\nHome: [Ravenhold]');
    assert.deepEqual(entry(state, 'HP'), { label: 'HP', type: 'meter', raw: '[0-100]/100 [(±N reason) or (=)]', value: null, max: 100 });
    assert.equal(entry(state, 'Stamina').value, 20);
    assert.equal(entry(state, 'Gold').value, null);
    assert.equal(entry(parsed('HP: 1/100\nGold: [number]'), 'Gold').value, null);
    assert.equal(entry(parsed('HP: 1/100\nStamina: [0-50]/50 (=)'), 'Stamina').value, null);
    assert.equal(entry(state, 'Status').value, null);
    assert.deepEqual(entry(state, 'Skills').items, []);
    assert.equal(entry(state, 'Skills').value, null);
    assert.equal(entry(state, 'Mood').value, null);
    // A bracketed answer that is not this field's placeholder is the model's own text.
    assert.equal(entry(state, 'Home').value, '[Ravenhold]');
    assert.equal(fields.isEmpty({ entries: [entry(state, 'HP')] }), true);
});

test('a body with real values and some placeholders is valid; nulls serialize as "?"', () => {
    const state = parsed('HP: 70/100\nGold: [number]\nSkills: [Name rank, comma separated]');
    assert.equal(fields.serialize(state, def), 'HP: 70/100\nGold: ?\nSkills: ?');
    const again = fields.parse(fields.serialize(state, def), def).state;
    assert.equal(entry(again, 'Gold').value, null);
    assert.equal(entry(again, 'Skills').value, null);
    assert.deepEqual(fields.parse(fields.serialize(again, def), def).state, again);
});

test('labels the definition lacks become unknown text entries after the defined ones', () => {
    const state = parsed('Mood: wary\nHP: 70/100\nWeather: rain, cold\nGold: 3');
    assert.deepEqual(state.entries.map(item => [item.label, !!item.unknown]), [
        ['HP', false], ['Gold', false], ['Mood', true], ['Weather', true],
    ]);
    assert.equal(entry(state, 'Weather').value, 'rain, cold');
    assert.equal(fields.serialize(state, def), 'HP: 70/100\nGold: 3\nMood: wary\nWeather: rain, cold');
});

test('a sentence with a colon is not taken for a label', () => {
    const state = parsed('Status: shaken\nAfter the ambush in the old mill he said: run');
    assert.equal(entry(state, 'Status').value, 'shaken\nAfter the ambush in the old mill he said: run');
    assert.equal(state.entries.length, 1);
});

test('duplicate labels: the last one wins', () => {
    const state = parsed('HP: 80/100\nGold: 5\nHP: 75/100');
    assert.equal(entry(state, 'HP').value, 75);
    assert.equal(state.entries.filter(item => item.label === 'HP').length, 1);
});

test('invalid bodies are rejected with a readable error and never throw', () => {
    for (const body of ['', '   ', 'Just a paragraph of story.', 'Mood: calm\nWeather: rain', 'HP:\nGold:', null, undefined, 42, {}]) {
        const result = fields.parse(body, def);
        assert.equal(result.ok, false, String(body));
        assert.equal(typeof result.error, 'string');
        assert.ok(result.error.length > 0 && result.error.length < 120);
    }
    assert.match(fields.parse('Mood: calm', def).error, /No known field/);
    assert.equal(fields.parse('HP: 5', normalizeBlock({ name: 'X', format: 'fields' })).ok, false);
    assert.equal(fields.parse('HP: 5', null).ok, false);
    const long = `Status: ${'a'.repeat(20000)} ${'| x '.repeat(2000)}`;
    assert.equal(fields.parse(long, def).ok, true);
});

test('escaping: --> and the block tag inside a value survive the round trip', () => {
    const state = { entries: [
        { label: 'Status', type: 'text', raw: 'a --> b </Character_Sheet> <Blocks>', value: 'a --> b </Character_Sheet> <Blocks>' },
        { label: 'Skills', type: 'list', raw: 'x-->y, </Character_Sheet>', value: 'x-->y, </Character_Sheet>', items: ['x-->y', '</Character_Sheet>'] },
    ] };
    const body = fields.serialize(state, def);
    assert.equal(body.includes('-->'), false);
    assert.equal(/<\/?Character_Sheet/i.test(body), false);
    assert.equal(/<\/?Blocks/i.test(body), false);
    assert.deepEqual(fields.parse(body, def).state, state);
});

test('diff reports added, removed and changed by label, with display strings', () => {
    const before = parsed('HP: 80/100\nGold: 120\nStatus: fine\nSkills: Sword 3\nMood: calm');
    const after = parsed('hp: 65/100 (-15 arrow)\nGold: 120 (=)\nSkills: Sword 3, Bow 1\nStamina: 40/50\nMood: furious');
    assert.deepEqual(fields.diff(before, after, def), [
        { type: 'changed', label: 'HP', from: '80/100', to: '65/100' },
        { type: 'added', label: 'Stamina', to: '40/50' },
        { type: 'changed', label: 'Skills', from: 'Sword 3', to: 'Sword 3, Bow 1' },
        { type: 'removed', label: 'Status', from: 'fine' },
    ]);
    assert.deepEqual(fields.diff(before, before, def), []);
    assert.deepEqual(fields.diff(fields.empty(def), parsed('Gold: 1'), def), [{ type: 'added', label: 'Gold', to: '1' }]);
    assert.deepEqual(fields.diff(null, null, def), []);
});

test('diff ignores unknown entries and treats a null value as absent', () => {
    assert.deepEqual(fields.diff(parsed('HP: 5/100\nMood: calm'), parsed('HP: 5/100\nWeather: rain'), def), []);
    assert.deepEqual(fields.diff(parsed('HP: 5/100\nGold: 9'), parsed('HP: 5/100\nGold: [number]'), def), [
        { type: 'removed', label: 'Gold', from: '9' },
    ]);
    assert.deepEqual(fields.diff(parsed('HP: 5/100\nSkills: Bow 1'), parsed('HP: 5/100\nSkills: none'), def), [
        { type: 'changed', label: 'Skills', from: 'Bow 1', to: 'none' },
    ]);
});

test('skeleton writes one placeholder line per field', () => {
    assert.equal(fields.skeleton(def), [
        'HP: [0-100]/100',
        'Stamina: [0-50]/50',
        'Gold: [number]',
        'Status: [conditions, or "fine"]',
        'Skills: [Name rank, comma separated]',
    ].join('\n'));
    const bare = normalizeBlock({ name: 'Bare', format: 'fields', fields: [{ label: 'Note', type: 'text' }, { label: 'Tags', type: 'list' }] });
    assert.equal(fields.skeleton(bare), 'Note: [value]\nTags: [comma separated]');
    assert.equal(fields.parse(fields.skeleton(bare), bare).ok, false, 'generic placeholders do not count');
});

test('rules list every field in order with the core instructions', () => {
    const text = fields.rules(def);
    const at = label => text.indexOf(`- ${label}:`);
    assert.ok(at('HP') > 0 && at('HP') < at('Stamina') && at('Stamina') < at('Gold') && at('Gold') < at('Status') && at('Status') < at('Skills'));
    assert.match(text, /HP: \[0-100\]\/100/);
    assert.match(text, /Status: \[conditions, or "fine"\]/);
    assert.match(text, /Carry every value forward/);
    assert.match(text, /Never invent/);
    assert.match(text, /No other labels/);
    assert.equal(typeof fields.rules(null), 'string');
});
