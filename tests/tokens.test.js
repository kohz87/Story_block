// What Story Block adds to the next ordinary reply, in tokens (v0.9.1, Story Suite's
// api.manage.tokens()): an estimate from the same entries and context section the prompt uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_MARKER, latestBlockState } from '../src/envelope.js';
import { buildContext } from '../src/prompt.js';
import { pluginBlockDef } from '../src/plugin.js';
import { templateById } from '../src/templates.js';
import { CHARS_PER_TOKEN, RULES_PART, contextTokens, tokensOf } from '../src/tokens.js';

const on = id => ({ ...templateById(id), enabled: true });
const party = pluginBlockDef({ kept: true, id: 'rpg-party', tag: 'Party', owner: 'RPG Battle', name: 'Party' }, []).def;
const envelope = (...blocks) => `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const sum = (parts, key) => parts.reduce((total, part) => total + part[key], 0);

test('tokensOf: about four characters a token', () => {
    assert.equal(CHARS_PER_TOKEN, 4);
    assert.equal(tokensOf(''), 0);
    assert.equal(tokensOf('x'.repeat(400)), 100);
    assert.equal(tokensOf(null), 0);
});

test('contextTokens: input is the whole section, parts add up, a kept block is listed under its owner and writes nothing', () => {
    const inventory = on('inventory');
    const notes = on('scene-notes');
    const found = latestBlockState([{ is_user: false, mes: envelope('<Party kept="RPG Battle">\nRen — you | HP 40/40\n</Party>') }], party);
    const entries = [{ def: party, state: found.state, body: found.body }, { def: inventory, state: null }, { def: notes }];
    const result = contextTokens(entries);
    assert.equal(result.input, tokensOf(buildContext(entries)), 'exactly the section the prompt gets');
    assert.deepEqual(result.parts.map(part => part.label), ['Party (kept by RPG Battle)', 'Inventory', 'Scene Notes', RULES_PART]);
    assert.equal(sum(result.parts, 'input'), result.input);
    assert.equal(sum(result.parts, 'output'), result.output);
    assert.equal(result.parts[0].output, 0, 'the model never writes a kept block');
    assert.ok(result.parts.every(part => Number.isInteger(part.input) && part.input >= 0 && Number.isInteger(part.output) && part.output >= 0));
    assert.ok(result.parts[1].output > 0 && result.parts[2].output > 0);
    // A block's input is about what switching it off would save (0.9.22: its own sections' length,
    // from one build of the section; switching it off may also drop a rule worded for it).
    const saved = result.input - tokensOf(buildContext(entries.filter(entry => entry.def !== notes)));
    assert.ok(Math.abs(result.parts[2].input - saved) <= 30, `${result.parts[2].input} vs ${saved}`);

    // A stateful block with a state writes its state back.
    const state = { text: 'x'.repeat(800) };
    const longNotes = { ...notes, kind: 'stateful' };
    const grown = contextTokens([{ def: longNotes, state }]);
    assert.ok(grown.parts[0].output >= 200, 'its 800 characters, and its tags');
});

test('contextTokens: nothing prompted is nothing; a kept block not written yet adds nothing; a runtime note counts', () => {
    assert.deepEqual(contextTokens([]), { input: 0, output: 0, parts: [] });
    assert.deepEqual(contextTokens([{ def: party, state: null, body: '' }]), { input: 0, output: 0, parts: [] });
    const chatter = on('inner-chatter');
    const plain = contextTokens([{ def: chatter }]);
    const noted = contextTokens([{ def: chatter, note: 'Voice each NPC as their NPC State Delta card describes.' }]);
    assert.ok(noted.input > plain.input);
    // (0.9.21) About ten tokens, and this reply's frame around it when it is that part's only line.
    assert.ok(noted.input - plain.input <= 45, 'about ten tokens, and a frame');
    assert.equal(noted.output, plain.output);
});

test('a list written as changes only counts a few change lines as its output, not the whole list (0.9.19)', async () => {
    const { templateById } = await import('../src/templates.js');
    const { parse } = await import('../src/formats/rows.js');
    const inventory = templateById('inventory');
    const state = parse(Array.from({ length: 30 }, (_, index) => `Item number ${index} | 1 | a long note about item ${index}`).join('\n'), inventory).state;
    const changes = contextTokens([{ def: inventory, state }]).parts.find(part => part.label === 'Inventory');
    const whole = contextTokens([{ def: { ...inventory, updates: 'full' }, state }]).parts.find(part => part.label === 'Inventory');
    assert.ok(changes.output < 30, `${changes.output} tokens out`);
    assert.ok(whole.output > 200, `${whole.output} tokens out when rewritten whole`);
});
