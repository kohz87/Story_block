import test from 'node:test';
import assert from 'node:assert/strict';
import { turnCount, turnItems } from '../src/turn.js';
import { blockView } from '../src/view.js';
import { normalizeBlock } from '../src/schema.js';
import { templateById } from '../src/templates.js';

const inventory = templateById('inventory');
const sheet = normalizeBlock({ ...templateById('character-sheet'), enabled: true });
const notes = normalizeBlock({ id: 'notes', name: 'Notes', tag: 'Notes', kind: 'turn', format: 'text' });
const envelope = (...blocks) => `<!-- STORY_BLOCKS_V1\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const reply = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, mes });

test('strip items describe this reply\'s changes with gain/loss tones, block by block', () => {
    const chat = [
        reply(envelope('<Inventory>\nCoin Pouch | 1 | 100 Gold\n</Inventory>', '<Character_Sheet>\nHP: 80/100\nGold: 100\n</Character_Sheet>')),
        user('go'),
        reply(envelope('<Inventory>\nCoin Pouch | 1 | 85 Gold\nBandage | 1 | linen\n</Inventory>', '<Character_Sheet>\nHP: 72/100\nGold: 120\n</Character_Sheet>', '<Notes>\nGuards are on alert.\nSecond line.\n</Notes>')),
    ];
    const views = [inventory, sheet, notes].map(def => ({ view: blockView(chat, def), tabId: `block:${def.id}` }));
    assert.deepEqual(turnItems(views).map(item => [item.tabId, item.text, item.tone]), [
        ['block:inventory', '+ Bandage ×1', 'up'],
        ['block:inventory', '~ Coin Pouch: 100 Gold → 85 Gold', 'down'],
        ['block:character-sheet', 'HP 80/100 → 72/100', 'down'],
        ['block:character-sheet', 'Gold 100 → 120', 'up'],
        ['block:notes', 'Notes: Guards are on alert.', 'neutral'],
    ]);
    assert.equal(turnCount(views[0].view), 2);
});

test('carried-over state adds nothing; problems become warnings', () => {
    const chat = [reply(envelope('<Inventory>\nRope | 1 |\n</Inventory>')), user('go'), reply(envelope('<Inventory>\nRope | 1 |\nrope | 2 |\n</Inventory>'))];
    const view = blockView(chat, inventory);
    assert.equal(turnCount(view), 0);
    assert.deepEqual(turnItems([{ view, tabId: 't' }]), [{ tabId: 't', block: 'Inventory', text: 'Inventory couldn\'t be read', tone: 'warn' }]);
    assert.deepEqual(turnItems([{ view: blockView([reply('x'), user('y'), reply('prose')], inventory), tabId: 't' }]), []);
});
