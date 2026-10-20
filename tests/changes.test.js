// Changes only (0.9.16): the Inventory written as + / - / ~ lines, applied by the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { templateById } from '../src/templates.js';
import { applyChanges, parse } from '../src/formats/rows.js';
import { applyReplyChanges, changeDefs, changesOnly, changesTag } from '../src/changes.js';
import { latestBlockInText, latestBlockState, normalizeTransport } from '../src/envelope.js';
import { buildContext } from '../src/prompt.js';

const inventory = templateById('inventory');
const BODY = [
    'Coin Pouch | 1 | 6 Silver, 8 Copper',
    '',
    '[Equipment > Weapons]',
    'Short Sword | 1 | Equipped · Common · ATK +4 · Notched near the guard',
    '',
    '[Consumables]',
    'Minor Healing Draught | 4 | heal 20',
    '',
    '[Gear]',
    'Rope | 1 | 30 ft, hemp',
    'Flint & Steel | 1',
    '',
    '[Loot]',
    '(empty)',
].join('\n');
const envelope = body => `<!-- STORY_BLOCKS_V1\n<Blocks>\n${body}\n</Blocks>\n-->`;
const reply = (story, body) => ({ is_user: false, mes: `${story}\n\n${envelope(body)}` });

test('changes apply to the last state; every row not named stays byte for byte', () => {
    const { body, applied, failed } = applyChanges(BODY, [
        '- Minor Healing Draughts | 1',
        '[Loot]',
        '+ Brood-Mother Skull | 1 | uncommon material · MDEF',
        '~ Coin Pouch | 1 | 7 Silver, 8 Copper',
        '= Short Sword | 1 | Equipped · Common · ATK +4, fire',
        '- Torch | 1',
    ].join('\n'), inventory);
    assert.equal(applied.length, 4);
    assert.deepEqual(failed, [{ line: '- Torch | 1', why: 'no such row' }]);
    assert.equal(body, [
        'Coin Pouch | 1 | 7 Silver, 8 Copper',
        '',
        '[Equipment > Weapons]',
        'Short Sword | 1 | Equipped · Common · ATK +4, fire',
        '',
        '[Consumables]',
        'Minor Healing Draught | 3 | heal 20',
        '',
        '[Gear]',
        'Rope | 1 | 30 ft, hemp',
        'Flint & Steel | 1',
        '',
        '[Loot]',
        'Brood-Mother Skull | 1 | uncommon material · MDEF',
    ].join('\n'));
    assert.ok(parse(body, inventory).ok);
});

test('+ stacks onto a row it has, - at 0 or with no number takes the row, a new section is added', () => {
    const { body } = applyChanges(BODY, '+ Rope | 2 | ignored note\n- Flint & Steel\n- Minor Healing Draught | 9\n[Trophies]\n+ Wolf Pelt | 1', inventory);
    assert.match(body, /^Rope \| 3 \| 30 ft, hemp$/m);
    assert.doesNotMatch(body, /Flint|Minor Healing/);
    assert.match(body, /\[Trophies\]\nWolf Pelt \| 1$/);
    // "the skull" finds the one row holding that word; ~ without a note keeps the note.
    const next = applyChanges(`${body}\n\n[Loot]\nBrood-Mother Skull | 1 | uncommon material`, '~ skull | 2', inventory).body;
    assert.match(next, /Brood-Mother Skull \| 2 \| uncommon material/);
});

test('a reply\'s <Inventory_Changes> becomes its whole <Inventory>; nothing to change carries the state on', () => {
    const before = reply('The cellar.', `<Inventory>\n${BODY}\n</Inventory>`);
    const text = `The rat falls.\n\n${envelope('<Inventory_Changes>\n- Minor Healing Draught | 1\n</Inventory_Changes>')}`;
    const chat = [before, { is_user: true, mes: 'I drink.' }, { is_user: false, mes: text }];
    const { text: out, results } = applyReplyChanges(text, [inventory], chat, 2);
    assert.doesNotMatch(out, /Inventory_Changes/);
    assert.match(latestBlockInText(out, inventory).body, /Minor Healing Draught \| 3 \| heal 20/);
    assert.equal(results[0].applied.length, 1);
    // The same reply worked again (a render, an edit): no change.
    assert.equal(applyReplyChanges(out, [inventory], [...chat.slice(0, 2), { is_user: false, mes: out }], 2).text, out);
    // A swipe of it reads the state before it, never its own earlier version.
    const swiped = applyReplyChanges(text, [inventory], [...chat.slice(0, 2), { is_user: false, mes: out }], 2).text;
    assert.equal(swiped, out);
    // "No changes" (or an empty tag): the reply carries no copy; the state before stays current.
    const quiet = `A quiet night.\n\n${envelope('<Inventory_Changes>\nNo changes.\n</Inventory_Changes>')}`;
    const after = applyReplyChanges(quiet, [inventory], [before, { is_user: true, mes: 'sleep' }, { is_user: false, mes: quiet }], 2).text;
    assert.equal(after, 'A quiet night.');
    assert.match(latestBlockState([before, { is_user: true }, { is_user: false, mes: after }], inventory).body, /Minor Healing Draught \| 4/);
});

test('a reply that writes the whole block keeps it; a changes-only setting off writes it whole', () => {
    const text = `Reorganised.\n\n${envelope('<Inventory>\nRope | 1\n</Inventory>\n<Inventory_Changes>\n+ Torch | 1\n</Inventory_Changes>')}`;
    const out = applyReplyChanges(text, [inventory], [{ is_user: false, mes: text }], 0).text;
    assert.equal(latestBlockInText(out, inventory).body, 'Rope | 1');
    assert.doesNotMatch(out, /Inventory_Changes/);
    assert.equal(changesOnly({ ...inventory, updates: 'full' }), false);
    assert.equal(applyReplyChanges(text, [{ ...inventory, updates: 'full' }], [], 0).text, text);
});

test('a bare <Inventory_Changes> is moved into the envelope, out of the narration', () => {
    const defs = [inventory, ...changeDefs([inventory])];
    const { text } = normalizeTransport('She pockets the skull.\n<Inventory_Changes>\n+ Skull | 1\n</Inventory_Changes>', defs);
    assert.match(text, /<!-- STORY_BLOCKS_V1\n<Blocks>\n<Inventory_Changes>/);
    assert.equal(text.split('<!--')[0].trim(), 'She pockets the skull.');
});

test('the prompt asks for the changes, shows the whole state, and the skeleton has the changes tag', () => {
    const state = parse(BODY, inventory).state;
    const context = buildContext([{ def: inventory, state }], { substitute: text => text.replaceAll('{{user}}', 'Ren') });
    assert.equal(changesTag(inventory), 'Inventory_Changes');
    assert.match(context, /### Inventory — <Inventory_Changes> \(kept: write only the changes\)/);
    assert.match(context, /"\+ Item \| Qty \| Note" gained/);
    assert.match(context, /"~ Item \| Qty \| Note" a row that now reads differently/);
    assert.match(context, /Leave <Inventory_Changes> out when this reply changes nothing/);
    assert.match(context, /Current state:\n<Inventory>\nCoin Pouch/);
    assert.match(context, /<Inventory_Changes>\n\[Section\]\n\+ \(Item\) \| \(Qty\) \| \(Note\)\n- \(Item\) \| \(Qty\)\n<\/Inventory_Changes>/);
    assert.doesNotMatch(context, /Rewrite each kept block in full/);
});

test('every reply holds the whole state: a block it does not write is carried in as it stood (0.9.17)', async () => {
    const { carryStates } = await import('../src/envelope.js');
    const world = { ...templateById('world-state'), enabled: true };
    const before = reply('The cellar.', `<Inventory>\n${BODY}\n</Inventory>\n<World_State>\n**📍 Location:** Granary\n</World_State>`);
    const quiet = 'A quiet night.';
    const chat = [before, { is_user: true, mes: 'sleep' }, { is_user: false, mes: quiet }];
    const out = carryStates(quiet, [inventory, world], chat, 2);
    assert.equal(latestBlockInText(out, inventory).body, BODY);
    assert.match(latestBlockInText(out, world).body, /Granary/);
    assert.equal(out.split('<!--')[0].trim(), quiet, 'nothing visible');
    // The reply now stands alone: with every earlier message gone, the state is still there.
    assert.equal(latestBlockState([{ is_user: false, mes: out }], inventory).body, BODY);
    // A copy of its own (even a cut-off one) stays; kept and switched-off blocks are not carried.
    const own = `Moved.\n\n${envelope('<Inventory>\nRope | 1\n</Inventory>')}`;
    assert.equal(carryStates(own, [inventory], chat, 2), own);
    const cut = 'Moved.\n\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Inventory>\nRope | 1';
    assert.equal(carryStates(cut, [inventory], chat, 2), cut);
    assert.equal(carryStates(quiet, [{ ...inventory, kept: true }, { ...world, enabled: false }], chat, 2), quiet);
    // Nothing before it: nothing to carry.
    assert.equal(carryStates(quiet, [inventory], [{ is_user: true, mes: 'hi' }, { is_user: false, mes: quiet }], 1), quiet);
});
