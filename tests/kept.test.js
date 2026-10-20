// Kept blocks (v0.7): a plugin's block the model reads every reply and never writes (RPG
// Battle's Character sheet). Validation, the prompt, the stamp that tells the extension's
// copies from the model's, and the dice modifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_MARKER, dropForeignCopies, extractBlocks, latestBlockInText, latestBlockState, normalizeTransport, upsertBlock } from '../src/envelope.js';
import { escapeBody } from '../src/formats/escape.js';
import { blockInText, blockSnapshot, blockSummary, generationSnapshot, hasTab, pluginBlockDef } from '../src/plugin.js';
import { buildContext } from '../src/prompt.js';
import { templateById } from '../src/templates.js';
import { blockStatusInText, blockView } from '../src/view.js';

const DICE_MODIFIER = "Modifier: the matching stat's bonus from the <Character> block's Checks line (for example CHA +1); ignore the −3 to +3 guess.";
const characterSpec = {
    kept: true,
    id: 'rpg-character',
    tag: 'Character',
    owner: 'RPG Battle',
    name: 'Character',
    icon: '⚔️',
    display: 'fields',
    format: 'fields',
    fields: [
        { label: 'HP', type: 'meter', max: 62 },
        { label: 'MP', type: 'meter', max: 30 },
        { label: 'Checks', type: 'text', hint: 'STAT +N, pipe separated' },
    ],
    promptNote: 'The player character as RPG Battle tracks it. HP and MP are current/max.',
    diceModifier: DICE_MODIFIER,
};
const character = pluginBlockDef(characterSpec, []).def;
const world = { ...templateById('world-state'), enabled: true };
const dice = { ...templateById('dice'), enabled: true };
const reply = mes => ({ is_user: false, is_system: false, mes });
const sheet = '<Character kept="RPG Battle">\nHP: 58/62 | MP: 21/30\nChecks: STR +2 | CHA +1\n</Character>';
const envelope = (...blocks) => `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const entry = value => value.state.entries.map(item => [item.label, item.value, item.max ?? null]);

test('registerBlock kept spec: a stateful-underneath, optional, visible plugin block with its owner', () => {
    assert.equal(character.kept, true);
    assert.equal(character.plugin, true);
    assert.equal(character.owner, 'RPG Battle');
    assert.equal(character.kind, 'stateful');
    assert.equal(character.visible, true);
    assert.equal(character.optional, true, 'never warned about');
    assert.equal(character.prompt, '');
    assert.deepEqual(character.fields.map(field => [field.label, field.type, field.max ?? null]), [['HP', 'meter', 62], ['MP', 'meter', 30], ['Checks', 'text', null]]);
    assert.equal(character.diceModifier, DICE_MODIFIER);
    const summary = blockSummary(character);
    assert.equal(summary.kind, 'kept');
    assert.equal(summary.owner, 'RPG Battle');
    assert.equal(summary.tab, true, 'a tab by default');
    assert.equal(hasTab(character), true);

    // Defaults: the display follows the format.
    const party = pluginBlockDef({ kept: true, id: 'rpg-party', tag: 'Party', owner: 'RPG Battle' }, [character]).def;
    assert.deepEqual([party.format, party.display, party.name, party.promptNote, party.diceModifier], ['text', 'plain', 'Party', '', '']);
    assert.equal(pluginBlockDef({ kept: true, id: 'stats', tag: 'Stats', owner: 'X', fields: [{ label: 'HP', type: 'meter' }] }, []).def.format, 'fields');
});

test('registerBlock kept spec: checked like the editor checks a block, plus owner, format and display', () => {
    const error = spec => pluginBlockDef({ ...characterSpec, ...spec }, [world]).error;
    assert.match(error({ owner: '  ' }), /owner/);
    assert.match(error({ format: 'rows' }), /format/);
    assert.match(error({ display: 'tree' }), /display/);
    assert.match(error({ format: 'text', display: 'fields' }), /needs the "fields" format/);
    assert.match(error({ fields: [] }), /at least one field/);
    assert.match(error({ fields: [{ label: 'HP', type: 'gauge' }] }), /field "HP": the type/);
    assert.match(error({ fields: [{ type: 'meter' }] }), /label/);
    assert.match(error({ tag: 'World_State' }), /already used/);
    assert.match(error({ tag: 'Char-Sheet' }), /letters, numbers and underscores/, 'the envelope only reads word tags');
    assert.match(error({ tag: 'details' }), /reserved/);
    assert.match(error({ tab: 'no' }), /tab is true or false/);
    // A plugin registering the same id again replaces its block instead of clashing with it.
    assert.ok(pluginBlockDef({ ...characterSpec, name: 'Hero' }, [character]).def);
    assert.match(pluginBlockDef({ ...characterSpec, id: 'other' }, [character]).error, /already used/);
});

test('setBlockText round-trip: a fields kept block written as pipe lines keeps every value', () => {
    // What setBlockText stores: the plugin's plain text, escaped for the envelope, stamped.
    const text = 'HP: 58/62 | MP: 21/30\nChecks: STR +2 | DEX +1 | CHA +1';
    const mes = upsertBlock('The goblin falls.', character, escapeBody(text, character.tag));
    assert.match(mes, /<Character kept="RPG Battle">\nHP: 58\/62 \| MP: 21\/30\n/);
    const snap = blockSnapshot([reply(mes)], character);
    assert.deepEqual(entry(snap), [['HP', 58, 62], ['MP', 21, 30], ['Checks', 'STR +2 | DEX +1 | CHA +1', null]]);
    assert.equal(snap.text, text);
    // Written again into the same message: replaced, not added.
    const next = upsertBlock(mes, character, 'HP: 40/62 | MP: 21/30');
    assert.equal(extractBlocks(next, [character]).length, 1);
    assert.deepEqual(entry(blockSnapshot([reply(next)], character)).slice(0, 2), [['HP', 40, 62], ['MP', 21, 30]]);
});

test('a copy the model writes never counts as the kept block, and is dropped from the reply', () => {
    const own = reply(`Dawn.\n${envelope(sheet)}`);
    const forged = 'The healer smiles.\n<Character>\nHP: 62/62 | MP: 30/30\n</Character>';
    const chat = [own, { is_user: true, mes: 'heal me' }, reply(normalizeTransport(forged, [character]).text)];
    // Moved out of the narration into the envelope, but not the newest state.
    assert.match(chat[2].mes, /^The healer smiles\.\n<!-- STORY_BLOCKS_V1/);
    assert.equal(latestBlockInText(chat[2].mes, character), null);
    assert.equal(latestBlockState(chat, character).messageIndex, 0);
    assert.equal(blockStatusInText(chat[2].mes, character).status, 'missing');
    assert.equal(blockView(chat, character).state.entries[0].value, 58);

    // Dropped: the bare tag and the envelope it alone filled go; other blocks stay.
    assert.equal(dropForeignCopies(forged, [world, character]), 'The healer smiles.');
    const mixed = `Noon.\n${envelope('<Character>\nHP: 1/62\n</Character>', '<World_State>\n**📅 Time:** noon\n</World_State>')}`;
    const kept = dropForeignCopies(mixed, [world, character]);
    assert.doesNotMatch(kept, /<Character/);
    assert.match(kept, /<World_State>\n\*\*📅 Time:\*\* noon\n<\/World_State>/);
    // The extension's own copy is never touched, and nothing to drop leaves the text as it is.
    assert.equal(dropForeignCopies(own.mes, [world, character]), own.mes);
    assert.equal(dropForeignCopies(mixed, [world]), mixed);
});

test('prompt: the kept block is shown read-only, first, and never in the envelope to write', () => {
    const found = latestBlockState([reply(envelope(sheet))], character);
    const notes = { ...templateById('scene-notes'), enabled: true };
    const context = buildContext([{ def: character, state: found.state, body: found.body }, { def: notes }]);
    assert.match(context, /### Character — <Character> \(kept by RPG Battle: read it, never write it\)\nThe player character as RPG Battle tracks it\. HP and MP are current\/max\./);
    // (0.9.21) Its newest copy is in this reply's part.
    assert.match(context, /### Character: current state \(kept by RPG Battle\)\n<Character>\nHP: 58\/62 \| MP: 21\/30\nChecks: STR \+2 \| CHA \+1\n<\/Character>/);
    assert.match(context, /Blocks marked "read it, never write it" are kept by another extension/);
    assert.ok(context.indexOf('### Character') < context.indexOf('### Scene Notes'));
    const skeleton = context.slice(context.indexOf('Write it exactly like this:'), context.indexOf('STORY_BLOCKS_V1_CONTEXT_END'));
    assert.doesNotMatch(skeleton, /Character/);
    assert.match(skeleton, /<Scene_Notes>/);
    assert.doesNotMatch(context, /kept=/, 'the stamp never reaches the model');
    // A writable stateful block's "kept: rewrite" rule is not triggered by a kept block alone.
    assert.doesNotMatch(context, /Rewrite each kept block in full/);

    // Only kept blocks: no envelope to write at all. Nothing written yet: no section.
    const alone = buildContext([{ def: character, state: found.state, body: found.body }]);
    assert.match(alone, /kept by RPG Battle/);
    assert.doesNotMatch(alone, /Write it exactly like this|hidden envelope/);
    assert.equal(buildContext([{ def: character, state: null, body: '' }]), '');
    assert.doesNotMatch(buildContext([{ def: character, state: null }, { def: notes }]), /Character/);
});

test('dice: the modifier line is appended only when a kept block with one is shown and the Dice block is prompted', () => {
    const found = latestBlockState([reply(envelope(sheet))], character);
    const keptEntry = { def: character, state: found.state, body: found.body };
    const rolls = [4, 17, 9];
    const modifierLine = `\n- ${DICE_MODIFIER}\nFormat:`;
    const both = buildContext([keptEntry, { def: dice, rolls }]);
    assert.ok(both.includes(modifierLine), 'appended to the Dice instructions, before its format');
    assert.equal(both.split(DICE_MODIFIER).length - 1, 1, 'once');
    assert.equal(dice.prompt.includes(DICE_MODIFIER), false, 'the stored prompt is unchanged');

    assert.doesNotMatch(buildContext([{ def: dice, rolls }]), /Checks line/, 'no kept block');
    assert.doesNotMatch(buildContext([{ def: character, state: null }, { def: dice, rolls }]), /Checks line/, 'kept block not written yet');
    const plainKept = pluginBlockDef({ ...characterSpec, diceModifier: undefined }, []).def;
    assert.doesNotMatch(buildContext([{ ...keptEntry, def: plainKept }, { def: dice, rolls }]), /Checks line/, 'no modifier given');
    const notDice = { ...templateById('scene-notes'), enabled: true };
    assert.doesNotMatch(buildContext([keptEntry, { def: notDice }]), /Checks line/, 'Dice not prompted');
    const everyone = { ...templateById('dice-everyone'), enabled: true };
    assert.doesNotMatch(buildContext([keptEntry, { def: everyone, rolls }]), /Checks line/, 'Dice: Everyone rolls for NPCs too');
});

test('tab: false (v0.9.1): kept, read and prompted exactly as before, but no tab; registering again flips it', () => {
    const hidden = pluginBlockDef({ ...characterSpec, tab: false }, [world]).def;
    assert.equal(hasTab(hidden), false);
    assert.equal(hidden.visible, false);
    assert.deepEqual([hidden.kept, hidden.plugin, hidden.kind, hidden.optional, hidden.owner, hidden.diceModifier], [true, true, 'stateful', true, 'RPG Battle', DICE_MODIFIER]);
    const summary = blockSummary(hidden);
    assert.deepEqual([summary.kind, summary.owner, summary.tab], ['kept', 'RPG Battle', false]);
    // Everything but the tab is the tabbed block's: the same definition otherwise.
    const { visible: _a, ...rest } = hidden;
    const { visible: _b, ...tabbed } = character;
    assert.deepEqual(rest, tabbed);

    // Stamped, read, and a model's copy still never counts.
    const mes = upsertBlock('The goblin falls.', hidden, escapeBody('HP: 58/62 | MP: 21/30\nChecks: STR +2 | CHA +1', hidden.tag));
    assert.match(mes, /<Character kept="RPG Battle">/);
    const chat = [reply(mes), { is_user: true, mes: 'go' }, reply(normalizeTransport('Dawn.\n<Character>\nHP: 1/62\n</Character>', [hidden]).text)];
    assert.equal(blockSnapshot(chat, hidden).messageIndex, 0);
    assert.equal(generationSnapshot(chat, hidden, 'swipe').messageIndex, 0);
    assert.equal(blockInText(chat[2].mes, hidden), null);
    assert.match(blockInText(mes, hidden).text, /HP: 58\/62/);
    assert.equal(dropForeignCopies('Dawn.\n<Character>\nHP: 1/62\n</Character>', [hidden]), 'Dawn.');

    // Prompted read-only, with its dice modifier, word for word as the tabbed block.
    const found = latestBlockState(chat, hidden);
    const prompt = def => buildContext([{ def, state: found.state, body: found.body }, { def: dice, rolls: [4, 17, 9] }]);
    assert.match(prompt(hidden), /### Character — <Character> \(kept by RPG Battle: read it, never write it\)/);
    assert.equal(prompt(hidden), prompt(character));

    // Registering the same id again flips it, either way; left out means a tab.
    assert.equal(hasTab(pluginBlockDef({ ...characterSpec, tab: true }, [hidden]).def), true);
    assert.equal(hasTab(pluginBlockDef(characterSpec, [hidden]).def), true);
    assert.equal(hasTab(pluginBlockDef({ ...characterSpec, tab: false }, [character]).def), false);
});
