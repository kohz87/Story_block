// The two examples in docs/v2/LAYOUTS.md must stay valid and draw what they promise,
// or the reference would be teaching layouts that fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLayout, validateLayout, tabFromLayout } from '../../../src/v2/layout/index.js';
import { mount, fakeQuery, one, settle } from './helpers/fake-dom.js';
import { texts } from '../../ui-fake-dom.js';

const doc = readFileSync(new URL('../../../docs/v2/LAYOUTS.md', import.meta.url), 'utf8');
const example = heading => {
    const match = new RegExp(`## Example: ${heading}\\n[\\s\\S]*?\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(doc);
    assert.ok(match, `the ${heading} example is in LAYOUTS.md`);
    return JSON.parse(match[1]);
};

// A tiny stand-in for the condition language, enough for the examples' conditions.
const evaluate = (cond, scope) => {
    if (cond === 'item.kind == \'consumable\'') return scope.item.kind === 'consumable';
    if (cond === 'item.points > 0') return scope.item.points > 0;
    throw new Error(`unknown condition ${cond}`);
};

test('the inventory screen example validates and draws rows with working buttons', async () => {
    const layout = example('inventory screen');
    assert.deepEqual(validateLayout(layout), []);
    const { host } = mount();
    const query = fakeQuery({
        'inventory.wallet': { silver: 12 },
        'inventory.items': [
            { id: 'it_draught1', name: 'Minor Healing Draught', qty: 2, kind: 'consumable', rarity: 'common', owner: 'ac_pc000001' },
            { id: 'it_sword001', name: 'Iron Sword', qty: 1, kind: 'equipment', rarity: 'rare', owner: 'ac_pc000001', icon: 'https://example.com/sword.png' },
        ],
    });
    const calls = [];
    const command = async (type, payload) => { calls.push([type, payload]); return { ok: true }; };
    const result = renderLayout(host, layout, { query, command, evaluate });
    assert.deepEqual(result.problems, []);
    assert.equal(one(host, '.ss-l-root').style.getPropertyValue('--ss-l-accent'), '#c8a24a');
    assert.equal(one(host, '.ss-l-root > .ss-l-col > .ss-l-row .ss-l-badge .ss-l-value').textContent, '12');
    const rows = host.querySelectorAll('.ss-l-item');
    assert.equal(rows.length, 2);
    assert.deepEqual(texts(rows[0], '.ss-l-button-label'), ['Use', 'Drop']);
    assert.deepEqual(texts(rows[1], '.ss-l-button-label'), ['Drop'], 'only consumables can be used');
    assert.equal(one(rows[1], '.ss-l-badge').classList.contains('ss-l-tone-rare'), true);
    assert.equal(one(rows[1], 'img').getAttribute('src'), 'https://example.com/sword.png');
    assert.equal(rows[0].querySelectorAll('img').length, 0, 'no icon, no image');

    rows[0].querySelectorAll('button')[0].click();
    rows[1].querySelectorAll('button')[0].click();
    await settle();
    assert.deepEqual(calls, [
        ['item.use', { stack: 'it_draught1', target: 'ac_pc000001' }],
        ['inventory.drop', { stack: 'it_sword001', qty: 1 }],
    ]);
});

test('the character sheet example validates and draws each actor with pages', async () => {
    const layout = example('character sheet');
    assert.deepEqual(validateLayout(layout), []);
    const actor = (id, name, points) => ({
        id, name, kind: 'pc', role: 'ranger', level: 3, xp: 40, points,
        hp: { cur: 30, max: 40 }, mp: { cur: 5, max: 10 }, sp: { cur: 8, max: 8 },
        stats: { STR: 4, VIT: 5, AGI: 6, DEX: 7, INT: 3, LUK: 2, CHA: 1 },
        skills: [{ name: 'Shadow Cut', level: 2 }], conditions: [{ kind: 'poisoned', stacks: 1 }],
    });
    const { host } = mount();
    const calls = [];
    const tab = tabFromLayout(layout);
    assert.deepEqual([tab.id, tab.title, tab.icon], ['example/character-sheet', 'Sheet', 'fa-id-card']);
    const view = { query: fakeQuery({ 'party.actors': [actor('ac_ren00001', 'Ren', 2), actor('ac_lyra0001', 'Lyra', 0)] }) };
    const result = tab.render(host, view, { command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; }, evaluate });
    assert.deepEqual(result.problems, []);

    const sheets = host.querySelectorAll('.ss-l-root > .ss-l-list > .ss-l-item > .ss-l-box');
    assert.deepEqual(sheets.map(sheet => one(sheet, ':scope > .ss-l-box-title').textContent), ['Ren', 'Lyra']);
    assert.deepEqual(texts(sheets[0], '.ss-l-meter-num'), ['30 / 40', '5 / 10', '8 / 8']);
    assert.deepEqual(texts(sheets[0], '.ss-l-tabpanel .ss-l-grid .ss-l-value'), ['4', '5', '6', '7', '3', '2', '1']);
    assert.deepEqual(texts(sheets[0], '.ss-l-button-label'), ['+STR', '+AGI', '+INT']);
    assert.equal(sheets[1].querySelectorAll('button.ss-l-button').length, 0, 'no points, no spend buttons');

    sheets[0].querySelectorAll('button.ss-l-button')[1].click();
    await settle();
    assert.deepEqual(calls, [['party.spend', { actor: 'ac_ren00001', stat: 'AGI' }]]);

    const pageButtons = sheets[0].querySelectorAll('.ss-l-tab');
    pageButtons[1].click();
    assert.deepEqual(texts(one(sheets[0], '.ss-l-tabpanel'), '.ss-l-text'), ['Shadow Cut']);
    pageButtons[2].click();
    assert.equal(one(sheets[0], '.ss-l-tabpanel .ss-l-badge').textContent, 'poisoned');
    assert.equal(sheets[1].querySelector('.ss-l-tabpanel .ss-l-grid .ss-l-value').textContent, '4', 'each sheet has its own page');
});
