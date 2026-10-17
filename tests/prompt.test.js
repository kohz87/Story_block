// Prompt: activeBlocks, buildContext, defuseMacros, injectContext, promptCarriesContext.
// Ports Inventory Block's prompt.test.js and the prompt cases of its v0.6.3–v0.6.5 audits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlock } from '../src/schema.js';
import { formatFor } from '../src/formats/index.js';
import { ENVELOPE_MARKER, bareBlockTexts } from '../src/envelope.js';
import {
    CONTEXT_BEGIN,
    CONTEXT_END,
    activeBlocks,
    buildContext,
    defuseMacros,
    hasContext,
    injectContext,
    promptCarriesContext,
} from '../src/prompt.js';

const notes = normalizeBlock({ id: 'notes', name: 'Scene Log', tag: 'Notes', kind: 'stateful', format: 'text', prompt: "What {{user}} and {{char}} know." });
const mood = normalizeBlock({ id: 'mood', name: 'Mood', tag: 'Mood', kind: 'turn', format: 'text', prompt: 'One word for the mood.' });
const defs = [notes, mood];

const envelope = (...blocks) => `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const note = text => `<Notes>\n${text}\n</Notes>`;
const assistant = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, is_system: false, mes });
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const contextFor = (text, extra = {}) => buildContext([{ def: notes, state: { text } }, { def: mood }], extra);
const ids = list => list.map(def => def.id);
const block = (when, extra = {}) => normalizeBlock({ id: 'b', name: 'B', tag: 'B', format: 'text', when, ...extra });

test('activeBlocks: enabled blocks with when "always", in definition order', () => {
    const off = normalizeBlock({ id: 'off', name: 'Off', tag: 'Off', format: 'text', enabled: false });
    assert.deepEqual(ids(activeBlocks([mood, off, notes], [])), ['mood', 'notes']);
    assert.deepEqual(activeBlocks(null, null), []);
});

test('activeBlocks: "every" counts assistant replies including the one being written', () => {
    const every = block({ mode: 'every', every: 3 });
    const chat = [assistant('greeting'), user('a'), assistant('r1'), user('b')];
    // Replies so far: 2, plus the one being written = 3.
    assert.deepEqual(ids(activeBlocks([every], chat)), ['b']);
    assert.deepEqual(ids(activeBlocks([every], [...chat, assistant('r2'), user('c')])), []);
    // System messages are not replies.
    assert.deepEqual(ids(activeBlocks([every], [...chat, { is_user: false, is_system: true, mes: 'note' }])), ['b']);
});

test('activeBlocks: Regenerate/Swipe do not count the reply being replaced twice; Continue extends the last reply', () => {
    const every = block({ mode: 'every', every: 2 });
    const chat = [assistant('greeting'), user('a'), assistant('r1')];
    assert.deepEqual(ids(activeBlocks([every], chat, 'normal')), [], '3 replies');
    assert.deepEqual(ids(activeBlocks([every], chat, 'regenerate')), ['b'], 'r1 is rewritten: still reply 2');
    assert.deepEqual(ids(activeBlocks([every], chat, 'swipe')), ['b']);
    assert.deepEqual(ids(activeBlocks([every], chat, 'continue')), ['b'], 'r1 is extended: still reply 2');
    // After a failed reply the chat ends with the user's message: nothing is replaced.
    assert.deepEqual(ids(activeBlocks([every], [...chat, user('again')], 'regenerate')), []);
});

test('activeBlocks: "keyword" scans the last scanDepth messages, whole word, case-insensitive', () => {
    const keyword = block({ mode: 'keyword', keywords: ['dragon', 'Black Gate'], scanDepth: 2 });
    assert.deepEqual(ids(activeBlocks([keyword], [user('A DRAGON appears!')])), ['b']);
    assert.deepEqual(ids(activeBlocks([keyword], [user('They pass the black  gate.')])), ['b'], 'spaces inside a keyword are flexible');
    assert.deepEqual(ids(activeBlocks([keyword], [user('dragonfly and snapdragon')])), [], 'whole words only');
    assert.deepEqual(ids(activeBlocks([keyword], [user('a dragon'), assistant('x'), user('y')])), [], 'outside scanDepth');
    assert.deepEqual(ids(activeBlocks([keyword], [user('a dragon'), assistant('x')])), ['b']);
    assert.deepEqual(ids(activeBlocks([keyword], [user('a dragon'), { is_user: false, is_system: true, mes: 'x' }, assistant('y')])), ['b'], 'system messages are skipped');
    const unicode = block({ mode: 'keyword', keywords: ['Drache'], scanDepth: 1 });
    assert.deepEqual(ids(activeBlocks([unicode], [user('Der Drache schläft.')])), ['b']);
    assert.deepEqual(ids(activeBlocks([unicode], [user('Drachenfels')])), []);
    assert.deepEqual(ids(activeBlocks([block({ mode: 'keyword', keywords: ['c++'] })], [user('I code in C++ daily')])), ['b'], 'regex characters are literal');
});

test('activeBlocks: a keyword inside a block (hidden or bare) does not fire', () => {
    const keyword = block({ mode: 'keyword', keywords: ['dragon'], scanDepth: 1 });
    const all = [keyword, notes];
    assert.deepEqual(ids(activeBlocks(all, [assistant(`Quiet night.\n${envelope(note('A dragon sleeps.'))}`)])), ['notes']);
    assert.deepEqual(ids(activeBlocks(all, [assistant(`Quiet night.\n${note('A dragon sleeps.')}`)])), ['notes']);
    // Regenerate scans the history before the reply being replaced.
    assert.deepEqual(ids(activeBlocks(all, [user('no'), assistant('a dragon!')], 'regenerate')), ['notes']);
});

test('buildContext: one section with the general rules once and each block in order', () => {
    const context = contextFor('The gate is shut.', { substitute: text => text.replaceAll('{{user}}', 'Ava').replaceAll('{{char}}', 'Mira') });
    assert.ok(context.startsWith(`${CONTEXT_BEGIN}\n## Story Blocks\n`));
    assert.ok(context.endsWith(`-->\n${CONTEXT_END}`));
    assert.equal(count(context, new RegExp(CONTEXT_BEGIN, 'g')), 1);
    assert.match(context, /At the very end of your reply, after the story, write exactly one hidden envelope/);
    assert.match(context, /in the order given, each tag exactly once, and close every tag/);
    assert.match(context, /Never write the blocks, their tags or their contents as visible narration/);
    assert.match(context, /Never write "-->" anywhere inside the envelope; write "--\\>" instead/);
    assert.match(context, /A backslash escapes the character after it[^\n]*keep such escapes exactly as written/);
    assert.match(context, /omission means loss/);
    assert.match(context, /Blocks marked "this reply only" describe this reply alone/);
    assert.ok(context.indexOf('### Scene Log — <Notes> (kept: rewrite the full current state)') < context.indexOf('### Mood — <Mood> (this reply only)'));
    assert.match(context, /What Ava and Mira know\./);
    assert.match(context, new RegExp(`Format: ${formatFor(notes).rules(notes).replace(/[.]/g, '\\.')}`));
    assert.match(context, /Current state:\n<Notes>\nThe gate is shut\.\n<\/Notes>/);
    assert.doesNotMatch(context.slice(context.indexOf('### Mood')), /Current state/, 'turn blocks carry no state');
});

test('buildContext: the skeleton envelope lists every block in order with its skeleton', () => {
    const context = contextFor('x');
    const skeleton = context.slice(context.indexOf('Write it exactly like this:\n') + 'Write it exactly like this:\n'.length, context.indexOf(CONTEXT_END));
    assert.equal(skeleton, `${envelope(`<Notes>\n${formatFor(notes).skeleton(notes)}\n</Notes>`, `<Mood>\n${formatFor(mood).skeleton(mood)}\n</Mood>`)}\n`);
});

test('buildContext: state reaches the model verbatim, never substituted', () => {
    const context = buildContext([{ def: notes, state: { text: "{{user}}'s letter, <USER> owes {{roll:1d6}}" } }], { substitute: text => text.replaceAll('{{user}}', 'Ava') });
    assert.match(context, /What Ava and \{\{char\}\} know\./);
    assert.match(context, /\{\{user\}\}'s letter, <USER> owes \{\{roll:1d6\}\}/);
});

test('buildContext: an empty or missing state says so outside the tags', () => {
    for (const state of [{ text: '' }, null, undefined]) {
        const context = buildContext([{ def: notes, state }]);
        assert.match(context, /Current state: \(empty — start it from the story\)/);
        assert.doesNotMatch(context, /Current state:\n<Notes>/);
    }
});

test('buildContext: only the rules that apply, nothing for no entries', () => {
    assert.equal(buildContext([]), '');
    assert.equal(buildContext(undefined), '');
    assert.equal(buildContext([{ state: {} }]), '');
    assert.doesNotMatch(buildContext([{ def: mood }]), /omission means loss/);
    assert.doesNotMatch(buildContext([{ def: notes, state: { text: 'x' } }]), /this reply only/);
    const blank = normalizeBlock({ id: 'blank', name: 'Blank', tag: 'Blank', kind: 'turn', format: 'text', prompt: '' });
    assert.match(buildContext([{ def: blank }]), /### Blank — <Blank> \(this reply only\)\nFormat: /);
});

test('hasContext and promptCarriesContext find the markers in strings and multi-part content', () => {
    const context = contextFor('x');
    assert.equal(hasContext(context), true);
    assert.equal(hasContext(CONTEXT_BEGIN), false);
    assert.equal(hasContext(null), false);
    assert.equal(promptCarriesContext({ prompt: `a\n${context}` }), true);
    assert.equal(promptCarriesContext({ prompt: 'a' }), false);
    assert.equal(promptCarriesContext({ chat: [{ role: 'system', content: context }] }), true);
    assert.equal(promptCarriesContext({ chat: [{ role: 'user', content: [{ type: 'image_url' }, { type: 'text', text: context }] }] }), true);
    assert.equal(promptCarriesContext({ chat: [{ role: 'user', content: ['plain', context] }] }), true);
    assert.equal(promptCarriesContext({ chat: [{ role: 'user', content: 'plain' }, null] }), false);
    assert.equal(promptCarriesContext(null), false);
});

test('M1: the placeholder copy is defused and the real context replaces it at prompt-ready', () => {
    const real = buildContext([{ def: notes, state: { text: "{{user}}'s Letter, <USER> owes {{roll:1d6}}" } }]);
    const placeholder = defuseMacros(real);
    assert.doesNotMatch(placeholder, /\{\{|<USER>/);
    assert.equal(placeholder.length, real.length + count(real, /\{\{|<USER>/g), 'reserves about the same size');
    assert.equal(hasContext(placeholder), true, 'markers survive defusing');
    const event = { prompt: `<|im_start|>system\n${placeholder}<|im_end|>\nhistory`, dryRun: false };
    assert.deepEqual(injectContext(event, real, defs), { injected: true, kind: 'text-extension-prompt' });
    assert.ok(event.prompt.includes("{{user}}'s Letter, <USER> owes {{roll:1d6}}"), 'model sees the state verbatim');
    assert.doesNotMatch(event.prompt, /​/);
    assert.ok(event.prompt.startsWith('<|im_start|>system\n'));
    assert.equal(defuseMacros(undefined), '');
});

test('chat prompt: history loses old blocks, the context goes in after the leading system messages', () => {
    const event = { chat: [
        { role: 'system', content: 'rules' },
        { role: 'system', content: 'card' },
        { role: 'assistant', content: `old story\n${envelope(note('100 Gold'), '<Mood>\ncalm\n</Mood>')}` },
        { role: 'assistant', content: 'bare one\n<Notes>\n95 Gold\n</Notes>\n<Blocks>\n<World_State>\nw\n</World_State>\n</Blocks>' },
        { role: 'user', content: 'continue' },
    ], dryRun: false };
    const original = event.chat;
    const context = contextFor('90 Gold');
    assert.deepEqual(injectContext(event, context, defs), { injected: true, kind: 'chat' });
    assert.equal(event.chat, original, 'shared chat-array identity is preserved for other extensions');
    assert.deepEqual(event.chat.map(message => message.role), ['system', 'system', 'system', 'assistant', 'assistant', 'user']);
    assert.equal(event.chat[2].content, context);
    const serialized = JSON.stringify(event.chat);
    assert.doesNotMatch(serialized, /100 Gold|95 Gold|calm|World_State/);
    assert.equal(event.chat[3].content, 'old story\n');
    assert.equal(count(serialized, /<!-- STORY_BLOCKS_V1/g), 1, 'only the skeleton envelope remains');
});

test('chat prompt: user and system content keep blocks a person wrote; hidden envelopes and history copies go', () => {
    const history = '<Notes>\nThe guards are on alert.\n</Notes>';
    const example = '<Notes>\nExample format\n</Notes>';
    const knownBlocks = new Set(bareBlockTexts(`reply\n${history}`, defs));
    const event = { chat: [
        { role: 'system', content: `Card. Format example:\n${example}` },
        { role: 'user', content: `Chat so far:\n${history}\n${envelope(note('hidden'))}\nNow go.` },
    ] };
    injectContext(event, contextFor('x'), defs, { knownBlocks });
    assert.equal(event.chat[0].content, `Card. Format example:\n${example}`);
    assert.equal(event.chat[2].content, 'Chat so far:\n\n\nNow go.');
    const plain = { chat: [{ role: 'user', content: `Pasted:\n${history}` }] };
    injectContext(plain, contextFor('x'), defs);
    assert.equal(plain.chat[1].content, `Pasted:\n${history}`, 'without knownBlocks every visible block a person wrote stays');
});

test('chat prompt: the placeholder-only system message is dropped; a shared one keeps its other text', () => {
    const placeholder = defuseMacros(contextFor('old'));
    const event = { chat: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: placeholder },
        { role: 'system', content: `${placeholder}\nFOREIGN_EXTENSION_KEEP` },
    ] };
    injectContext(event, contextFor('new'), defs);
    assert.deepEqual(event.chat.map(message => message.role), ['system', 'system', 'user', 'system']);
    assert.equal(event.chat[3].content, '\nFOREIGN_EXTENSION_KEEP');
    const serialized = JSON.stringify(event.chat);
    assert.equal(count(serialized, new RegExp(CONTEXT_BEGIN, 'g')), 1);
    assert.doesNotMatch(serialized, /\\nold\\n/);
});

test('chat prompt: reinjection is idempotent and refreshes the state', () => {
    const event = { chat: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hi' }] };
    injectContext(event, contextFor('10 Gold'), defs);
    injectContext(event, contextFor('500 Gold'), defs);
    const serialized = JSON.stringify(event.chat);
    assert.equal(event.chat.length, 3);
    assert.equal(count(serialized, new RegExp(CONTEXT_BEGIN, 'g')), 1);
    assert.doesNotMatch(serialized, /10 Gold/);
    assert.match(serialized, /500 Gold/);
});

test('chat prompt: multi-part content is cleaned part by part; other parts are untouched', () => {
    const image = { type: 'image_url', image_url: { url: 'data:x' } };
    const event = { chat: [
        { role: 'assistant', content: [{ type: 'text', text: `story\n${envelope(note('old'))}` }, image, `more\n${note('bare')}`] },
        { role: 'user', content: [{ type: 'text', text: `look ${envelope(note('hidden'))}` }, image] },
        { role: 'system', content: [{ type: 'text', text: defuseMacros(contextFor('old')) }] },
        { role: 'tool', content: null },
    ] };
    injectContext(event, contextFor('new'), defs);
    assert.deepEqual(event.chat[1].content, [{ type: 'text', text: 'story\n' }, image, 'more\n']);
    assert.equal(event.chat[1].content[1], image);
    assert.deepEqual(event.chat[2].content, [{ type: 'text', text: 'look ' }, image]);
    assert.equal(event.chat.length, 4, 'the placeholder-only system message (as parts) is dropped');
    assert.equal(event.chat[3].content, null);
    assert.equal(event.chat[0].role, 'system');
});

test('text prompt: the placeholder is replaced in place; otherwise the context is prepended', () => {
    const marked = { prompt: `<|im_start|>system\n${defuseMacros(contextFor('old'))}<|im_end|>\nold story\n${envelope(note('old state'))}\nuser: hi`, dryRun: false };
    const context = contextFor('new state');
    assert.equal(injectContext(marked, context, defs).kind, 'text-extension-prompt');
    assert.equal(marked.prompt, `<|im_start|>system\n${context}<|im_end|>\nold story\n\nuser: hi`);
    const unmarked = { prompt: `history\n<Notes>\nbare old\n</Notes>` };
    assert.deepEqual(injectContext(unmarked, context, defs), { injected: true, kind: 'text' });
    assert.equal(unmarked.prompt, `${context}\nhistory\n`);
    // Reinjection replaces the context it injected before.
    injectContext(unmarked, contextFor('newer'), defs);
    assert.equal(count(unmarked.prompt, new RegExp(CONTEXT_BEGIN, 'g')), 1);
    assert.match(unmarked.prompt, /newer/);
});

test('text prompt filtering preserves foreign extension payloads', () => {
    const foreign = '<npc_state_v1>{"id":"npc-katrin"}</npc_state_v1>';
    const event = { prompt: `story\n${envelope(note('10 Gold'))}\n${foreign}` };
    injectContext(event, contextFor('500 Gold'), defs);
    assert.doesNotMatch(event.prompt, /10 Gold/);
    assert.match(event.prompt, /500 Gold/);
    assert.ok(event.prompt.includes(foreign));
});

test('injectContext: an empty context only cleans the prompt', () => {
    const chat = { chat: [{ role: 'system', content: defuseMacros(contextFor('x')) }, { role: 'assistant', content: `a\n${envelope(note('x'))}` }] };
    assert.deepEqual(injectContext(chat, '', defs), { injected: false, kind: 'chat', reason: 'empty-context' });
    assert.deepEqual(chat.chat, [{ role: 'assistant', content: 'a\n' }]);
    const text = { prompt: `a\n${envelope(note('x'))}` };
    assert.equal(injectContext(text, '', defs).reason, 'empty-context');
    assert.equal(text.prompt, 'a\n');
});

test('injectContext: dry runs and unsupported events are not touched', () => {
    const dry = { chat: [{ role: 'assistant', content: envelope(note('x')) }], dryRun: true };
    assert.deepEqual(injectContext(dry, contextFor('x'), defs), { injected: false, reason: 'invalid-event' });
    assert.equal(dry.chat[0].content, envelope(note('x')));
    assert.deepEqual(injectContext(null, 'x', defs), { injected: false, reason: 'invalid-event' });
    assert.deepEqual(injectContext({ other: true }, 'x', defs), { injected: false, reason: 'unsupported-event' });
});

test('an entry\'s note is one more line under its prompt, for that reply only (v0.9.1: chatter and NPC State Delta)', () => {
    const chatter = normalizeBlock({ id: 'chatter', name: 'Chatter', tag: 'Chatter', kind: 'turn', format: 'text', display: 'chatter', prompt: 'Private NPC talk.' });
    const note = 'Voice each NPC as their NPC State Delta card describes.';
    const withNote = buildContext([{ def: chatter, note }]);
    assert.match(withNote, /### Chatter — <Chatter> \(this reply only\)\nPrivate NPC talk\.\nVoice each NPC as their NPC State Delta card describes\.\n/);
    assert.equal(count(withNote, /NPC State Delta/g), 1, 'once, and not in the envelope to write');
    const without = buildContext([{ def: chatter }]);
    assert.doesNotMatch(without, /NPC State Delta/);
    assert.equal(withNote.replace(`${note}\n`, ''), without, 'nothing else changes');
    assert.equal(chatter.prompt, 'Private NPC talk.', 'the stored prompt is unchanged');
});
