// (0.9.21) A provider's prompt cache: the instructions are the same text reply after reply,
// and everything that changes is in this reply's part, sent last.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlock } from '../src/schema.js';
import { templateById } from '../src/templates.js';
import { STATE_BEGIN, STATE_END, CONTEXT_BEGIN, CONTEXT_END, buildContextParts, defuseMacros, injectContext } from '../src/prompt.js';
import { formatFor } from '../src/formats/index.js';

const inventory = { ...templateById('inventory'), enabled: true };
const world = { ...templateById('world-state'), enabled: true };
const dice = { ...templateById('dice'), enabled: true };
const notes = normalizeBlock({ id: 'notes', name: 'Scene Notes', tag: 'Scene_Notes', kind: 'turn', format: 'text', prompt: 'Two lines on what changed.', when: { mode: 'keyword', keywords: ['secret'] } });
const staticDefs = [dice, inventory, world];
const ruleDefs = [dice, inventory, world, notes];
const rows = text => formatFor(inventory).parse(text, inventory).state;
const scene = text => ({ text });

const reply1 = [
    { def: dice, rolls: [12, 5, 19] },
    { def: inventory, state: rows('Coin Pouch | 1 | 90 Gold'), note: 'Purse in all: 90 gold.' },
    { def: world, state: scene('**📅 Time:** Goldwane 12') },
];
const reply2 = [
    { def: dice, rolls: [3, 17, 8] },
    { def: inventory, state: rows('Coin Pouch | 1 | 70 Gold\nRope | 1'), note: 'Purse in all: 70 gold.' },
    { def: world, state: scene('**📅 Time:** Goldwane 13') },
    { def: notes },
];

test('the instructions are byte-identical from reply to reply; what changed is in this reply\'s part', () => {
    const one = buildContextParts(reply1, { staticDefs, ruleDefs });
    const two = buildContextParts(reply2, { staticDefs, ruleDefs });
    assert.equal(one.static, two.static);
    assert.ok(one.static.startsWith(`${CONTEXT_BEGIN}\n`) && one.static.endsWith(CONTEXT_END));
    for (const changing of ['90 Gold', 'Goldwane 12', 'Roll 1 = 12', 'Purse in all']) {
        assert.ok(!one.static.includes(changing), `${changing} is not in the instructions`);
        assert.ok(one.tail.includes(changing), `${changing} is in this reply's part`);
    }
    assert.ok(one.tail.startsWith(`${STATE_BEGIN}\n## Story Blocks: this reply`) && one.tail.endsWith(STATE_END));
    // A block asked for only now and then is whole in this reply's part, with its skeleton.
    assert.doesNotMatch(one.static, /Scene_Notes/);
    assert.match(two.tail, /### Scene Notes — <Scene_Notes> \(this reply only\)\nTwo lines on what changed\.[\s\S]*This reply also writes <Scene_Notes>, in the envelope, like this:\n<Scene_Notes>/);
    // The rules are worded for every enabled block, so the one that comes and goes changes nothing.
    assert.match(one.static, /Blocks marked "this reply only" describe this reply alone/);
    // The Dice prompt points at the rolls; a block of the instructions this reply leaves out is said so.
    assert.match(one.static, /This reply's rolls, in order: given at the end of the prompt, under this reply\./);
    const fight = buildContextParts(reply1.slice(1), { staticDefs, ruleDefs });
    assert.equal(fight.static, one.static);
    assert.match(fight.tail, /Leave <Dice> out of this reply\./);
});

test('chat completion: the instructions go after the leading system messages, this reply\'s part where its placeholder stood', () => {
    const parts = buildContextParts(reply1, { staticDefs, ruleDefs });
    const placeholders = `${defuseMacros(parts.static)}\n${defuseMacros(parts.tail)}`;
    const event = { chat: [
        { role: 'system', content: 'main' },
        { role: 'assistant', content: 'old reply' },
        { role: 'user', content: 'go' },
        { role: 'system', content: `${placeholders}\nDIRECTOR NOTE` },
    ] };
    assert.equal(injectContext(event, parts, staticDefs).injected, true);
    assert.deepEqual(event.chat.map(message => message.role), ['system', 'system', 'assistant', 'user', 'system']);
    assert.equal(event.chat[1].content, parts.static);
    assert.equal(event.chat[4].content, `\n${parts.tail}\nDIRECTOR NOTE`);
    // Continue: with no placeholder, this reply's part goes before the reply being continued.
    const cont = { chat: [{ role: 'system', content: 'main' }, { role: 'user', content: 'go' }, { role: 'assistant', content: 'half a repl' }] };
    injectContext(cont, parts, staticDefs);
    assert.deepEqual(cont.chat.map(message => message.content === parts.static ? 'static' : message.content === parts.tail ? 'tail' : message.role), ['system', 'static', 'user', 'tail', 'assistant']);
});

test('text completion: each placeholder is replaced where SillyTavern put it', () => {
    const parts = buildContextParts(reply1, { staticDefs, ruleDefs });
    const event = { prompt: `<|im_start|>system\nCard.\n${defuseMacros(parts.static)}<|im_end|>\n<|im_start|>user\ngo<|im_end|>\n<|im_start|>system\n${defuseMacros(parts.tail)}<|im_end|>\n<|im_start|>assistant\n` };
    assert.equal(injectContext(event, parts, staticDefs).kind, 'text-extension-prompt');
    assert.equal(event.prompt, `<|im_start|>system\nCard.\n${parts.static}<|im_end|>\n<|im_start|>user\ngo<|im_end|>\n<|im_start|>system\n${parts.tail}<|im_end|>\n<|im_start|>assistant\n`);
});

test('two replies in a row share every character up to this reply\'s part', () => {
    const prompt = (entries, history) => {
        const parts = buildContextParts(entries, { staticDefs, ruleDefs });
        const event = { chat: [{ role: 'system', content: 'main' }, ...history, { role: 'system', content: defuseMacros(parts.tail) }] };
        injectContext(event, parts, staticDefs);
        return JSON.stringify(event.chat);
    };
    const history = [{ role: 'assistant', content: 'The cellar.' }, { role: 'user', content: 'I go down.' }];
    const first = prompt(reply1, history);
    const second = prompt(reply2, [...history, { role: 'assistant', content: 'Rats.' }, { role: 'user', content: 'I fight.' }]);
    let same = 0;
    while (same < first.length && first[same] === second[same]) same += 1;
    assert.ok(first.slice(0, same).includes(CONTEXT_END), 'the instructions are in the shared prefix');
    assert.ok(first.slice(0, same).includes('I go down.'), 'and the history before the new turn');
});
