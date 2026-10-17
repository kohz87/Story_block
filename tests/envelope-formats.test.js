// The engine with the real built-in templates (rows and fields formats): legacy Inventory
// Block snapshots, escapes surviving the envelope, and cut-offs of structured bodies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBlocks } from '../src/templates.js';
import { formatFor } from '../src/formats/index.js';
import { ENVELOPE_MARKER, latestBlockInText, latestBlockState, normalizeTransport, stateForGeneration, stripBlocks, upsertBlock } from '../src/envelope.js';
import { buildContext } from '../src/prompt.js';

const defs = defaultBlocks().map(def => ({ ...def, enabled: true }));
// Looked up by id: the template list grows, positions are not part of the contract.
const byId = id => defs.find(def => def.id === id);
const [inventory, sheet, notes] = ['inventory', 'character-sheet', 'scene-notes'].map(byId);
const rows = formatFor(inventory);
const visible = text => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, '');
const items = state => state.categories.flatMap(category => category.items.map(item => [category.name, item.name, item.quantity, item.remark]));

test('an Inventory Block snapshot is read as the Inventory state', () => {
    const chat = [{ is_user: false, mes: 'Hi.\n<!-- INVENTORY_BLOCK_V05\n<Inventory>\nCoin Pouch | 1 | 42 Gold\n\n[Pack]\nRope \\| cord | 1 | Oakhaven --\\> Veyl\n</Inventory>\n-->' }];
    assert.deepEqual(items(stateForGeneration(chat, inventory)), [
        ['General', 'Coin Pouch', '1', '42 Gold'],
        ['Pack', 'Rope | cord', '1', 'Oakhaven --> Veyl'],
    ]);
    assert.equal(normalizeTransport(chat[0].mes, defs).changed, false, 'never rewritten');
});

test('a rows state written with upsertBlock reads back equal, escapes and all', () => {
    const state = { categories: [{ name: 'General', items: [{ name: 'Map', quantity: '1', remark: 'A --> B | </Inventory> <Blocks>' }] }] };
    const text = upsertBlock('Story.', inventory, rows.serialize(state, inventory));
    assert.deepEqual(latestBlockInText(text, inventory).state, rows.parse(rows.serialize(state, inventory), inventory).state);
    assert.equal(items(latestBlockInText(text, inventory).state)[0][3], 'A --> B | </Inventory> <Blocks>');
    assert.equal(visible(text), 'Story.\n\n');
    assert.equal(normalizeTransport(text, defs).changed, false);
});

test('a rows body cut anywhere and finished by Continue is read whole; a cut-off copy never replaces the state', () => {
    const full = `She paid.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Inventory>\nCoin Pouch | 1 | 90 Gold\n\n[Pack]\nRope | 1 | coiled\n</Inventory>\n<Character_Sheet>\nHP: 80/100\nGold: 90\n</Character_Sheet>\n</Blocks>\n-->`;
    const before = { is_user: false, mes: `Hi.\n<!-- ${ENVELOPE_MARKER}\n<Blocks>\n<Inventory>\nCoin Pouch | 1 | 100 Gold\n</Inventory>\n</Blocks>\n-->` };
    for (let i = full.indexOf('<!--') + 2; i < full.length; i++) {
        const received = normalizeTransport(full.slice(0, i), defs).text;
        assert.equal(visible(received), 'She paid.\n', JSON.stringify(full.slice(0, i)));
        const cutState = latestBlockState([before, { is_user: true, mes: 'buy' }, { is_user: false, mes: received }], inventory);
        if (i < full.indexOf('</Inventory>') + '</Inventory>'.length) assert.equal(cutState.messageIndex, 0, 'cut copy is not the state');
        const continued = normalizeTransport(`${received}${full.slice(i)}`, defs).text;
        assert.deepEqual(items(latestBlockInText(continued, inventory).state), [['General', 'Coin Pouch', '1', '90 Gold'], ['Pack', 'Rope', '1', 'coiled']]);
        assert.ok(latestBlockInText(continued, sheet), 'the fields block is read too');
        assert.equal(stripBlocks(continued, defs), 'She paid.\n');
    }
});

test('the context for the templates carries every format\'s rules, state and skeleton', () => {
    const state = rows.parse('Coin Pouch | 1 | 90 Gold', inventory).state;
    const context = buildContext([
        { def: inventory, state },
        { def: sheet, state: formatFor(sheet).empty(sheet) },
        { def: notes },
    ], { substitute: text => text.replaceAll('{{user}}', 'Ava') });
    assert.match(context, /### Inventory — <Inventory> \(kept/);
    assert.match(context, /Everything Ava's party owns/);
    assert.match(context, /Current state:\n<Inventory>\nCoin Pouch \| 1 \| 90 Gold\n<\/Inventory>/);
    assert.match(context, /### Character Sheet — <Character_Sheet> \(kept[^\n]*\n[\s\S]*?Current state: \(empty/);
    assert.match(context, /### Scene Notes — <Scene_Notes> \(this reply only\)/);
    for (const def of [inventory, sheet, notes]) assert.ok(context.includes(`<${def.tag}>\n${formatFor(def).skeleton(def)}\n</${def.tag}>`), def.tag);
    for (const def of [inventory, sheet, notes]) assert.ok(context.includes(`Format: ${formatFor(def).rules(def)}`), def.tag);
});
