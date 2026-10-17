// Drives the real index.js event flow against a minimal fake SillyTavern + DOM
// (ported from Inventory Block's runtime tests).
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
    constructor(tag = 'div') {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.dataset = {};
        this.style = { setProperty() {} };
        this.attributes = {};
        this.value = '';
        this.innerHTML = '';
        this.textContent = '';
        this.className = '';
        this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
        this.stubs = new Map();
        this.listeners = {};
    }
    querySelector(selector) {
        if (!this.stubs.has(selector)) this.stubs.set(selector, new FakeElement());
        return this.stubs.get(selector);
    }
    querySelectorAll() { return []; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    removeEventListener() {}
    appendChild(child) { this.children.push(child); return child; }
    append(...nodes) { this.children.push(...nodes); }
    prepend(node) { this.children.unshift(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    insertBefore(node) { this.children.push(node); return node; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    contains() { return false; }
    closest() { return null; }
    remove() {}
    focus() {}
}

const statusLine = new FakeElement();
const fixed = {
    '#extensionsMenu': new FakeElement(),
    '#extensions_settings': new FakeElement(),
    '#chat': new FakeElement(),
};
globalThis.document = {
    body: { dataset: {} },
    createElement: tag => new FakeElement(tag),
    createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => new FakeElement('fragment'),
    getElementById: id => (id === 'story_block_status' ? statusLine : null),
    querySelector(selector) { return selector in fixed ? fixed[selector] : null; },
    querySelectorAll: () => [],
    activeElement: null,
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.getComputedStyle = () => ({ display: 'none' });
globalThis.CSS = { escape: value => String(value) };

const handlers = {};
const emitted = [];
const eventTypes = Object.fromEntries([
    'GENERATION_AFTER_COMMANDS', 'CHAT_COMPLETION_PROMPT_READY', 'GENERATE_AFTER_COMBINE_PROMPTS', 'MESSAGE_RECEIVED',
    'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED',
    'CHAT_CHANGED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPE_DELETED',
].map(name => [name, name.toLowerCase()]));

const envelope = (...blocks) => `<!-- STORY_BLOCKS_V1\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const inventory = gold => `<Inventory>\nCoin Pouch | 1 | ${gold} Gold\n</Inventory>`;
const extensionPrompts = {};
const extensionPromptPositions = {};
const notices = [];
globalThis.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map(level => [level, message => notices.push(`${level}: ${message}`)]));
const ctx = {
    chat: [],
    mainApi: 'openai',
    extensionSettings: {},
    getCurrentChatId: () => 'chat-1',
    saveSettingsDebounced() {},
    async saveChat() {},
    substituteParams: text => text.replaceAll('{{user}}', 'Ava'),
    updateMessageBlock(id) { emitted.push(['updateMessageBlock', id]); },
    setExtensionPrompt(key, value, position) { extensionPrompts[key] = value; extensionPromptPositions[key] = position; },
    eventTypes,
    eventSource: {
        on(type, fn) { (handlers[type] ??= []).push(fn); },
        makeFirst(type, fn) { (handlers[type] ??= []).unshift(fn); },
        async emit(type, ...args) {
            emitted.push([type, ...args]);
            for (const fn of handlers[type] ?? []) await fn(...args);
        },
    },
};
globalThis.SillyTavern = { getContext: () => ctx };

await import('../index.js');
const emit = (type, ...args) => ctx.eventSource.emit(eventTypes[type], ...args);
const placeholder = () => extensionPrompts.story_block;
// A reply prompt as SillyTavern builds it for a preset with Main Prompt disabled: in-prompt
// (relative) extension prompts are dropped, in-chat ones at depth 0 follow the history.
const replyChat = (...messages) => {
    const extra = placeholder() && extensionPromptPositions.story_block === 1 ? [{ role: 'system', content: placeholder() }] : [];
    return { chat: [{ role: 'system', content: 'rules' }, ...messages, ...extra], dryRun: false };
};
const history = () => ctx.chat.map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.mes }));
const finish = async (mes = 'reply') => {
    // Clears the pending session (and its watchdog timer) the way a received reply does.
    ctx.chat.push({ is_user: false, is_system: false, mes });
    await emit('MESSAGE_RECEIVED', ctx.chat.length - 1);
};
const setBlocks = list => { ctx.extensionSettings.storyBlock = { blocks: list }; };

test('first run starts from the templates', () => {
    assert.ok(Array.isArray(ctx.extensionSettings.storyBlock?.blocks ?? []));
    assert.equal(typeof globalThis.storyBlockGenerationInterceptor, 'function');
    assert.equal(typeof globalThis.StoryBlock?.registerTab, 'function');
});

test('display defaults: sidebar, strip off, pinned', async () => {
    delete ctx.extensionSettings.storyBlock;
    ctx.chat = [{ is_user: false, mes: envelope(inventory(10)) }, { is_user: true, mes: 'go' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const own = ctx.extensionSettings.storyBlock;
    assert.equal(own.display, 'sidebar');
    assert.equal(own.showTurnStrip, false);
    assert.equal(own.sidebarPinned, true);
    ctx.extensionSettings.storyBlock = { ...own, display: 'nonsense', showTurnStrip: 'yes' };
    await finish();
    assert.equal(ctx.extensionSettings.storyBlock.display, 'sidebar', 'unknown values fall back');
    assert.equal(ctx.extensionSettings.storyBlock.showTurnStrip, false, 'only true turns the strip on');
});

test('chat completion: the reply prompt gets one context with the newest state, and history loses old blocks', async () => {
    delete ctx.extensionSettings.storyBlock;
    ctx.chat = [{ is_user: false, mes: `Hi.\n${envelope(inventory(100))}` }, { is_user: true, mes: 'buy' }, { is_user: false, mes: `Bought.\n${envelope(inventory(90))}` }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    assert.equal(extensionPromptPositions.story_block, 1, 'placeholder goes in-chat for chat completion');
    const event = replyChat(...history());
    await emit('CHAT_COMPLETION_PROMPT_READY', event);
    const text = JSON.stringify(event.chat);
    assert.match(text, /STORY_BLOCKS_V1_CONTEXT_BEGIN[\s\S]*90 Gold/);
    assert.doesNotMatch(text, /100 Gold/);
    assert.doesNotMatch(text, /\\u200b|​/, 'placeholder replaced by the real context');
    assert.equal((text.match(/STORY_BLOCKS_V1_CONTEXT_BEGIN/g) ?? []).length, 1);
    assert.equal(placeholder(), '', 'placeholder withdrawn after the reply prompt');
    await finish(`Done.\n${envelope(inventory(85))}`);
    assert.match(statusLine.textContent, /block instructions sent \(Inventory; placeholder found, chat completion\)/);
});

test('Inventory Block snapshots already in a chat are read as the Inventory state', async () => {
    ctx.chat = [{ is_user: false, mes: 'Hi.\n<!-- INVENTORY_BLOCK_V05\n<Inventory>\nCoin Pouch | 1 | 42 Gold\n</Inventory>\n-->' }, { is_user: true, mes: 'go' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const event = replyChat(...history());
    await emit('CHAT_COMPLETION_PROMPT_READY', event);
    assert.match(JSON.stringify(event.chat), /42 Gold/);
    assert.doesNotMatch(JSON.stringify(event.chat), /INVENTORY_BLOCK_V05\\n/, 'the old snapshot is not left in history');
    await finish();
});

test('regenerate of an assistant reply uses the state before it', async () => {
    ctx.chat = [{ is_user: false, mes: envelope(inventory(100)) }, { is_user: true, mes: 'buy' }, { is_user: false, mes: envelope(inventory(90)) }];
    await emit('GENERATION_AFTER_COMMANDS', 'regenerate', {}, false);
    const event = replyChat();
    await emit('CHAT_COMPLETION_PROMPT_READY', event);
    assert.match(JSON.stringify(event.chat), /100 Gold/);
    await finish();
});

test('a raw call by another extension before the reply prompt is left untouched', async () => {
    ctx.chat = [{ is_user: false, mes: envelope(inventory(70)) }, { is_user: true, mes: 'go' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const raw = { chat: [{ role: 'user', content: `Scan this: ${envelope(inventory(70))}` }], dryRun: false };
    await emit('CHAT_COMPLETION_PROMPT_READY', raw);
    assert.equal(raw.chat[0].content, `Scan this: ${envelope(inventory(70))}`, 'background prompt unchanged');
    const reply = replyChat(...history());
    await emit('CHAT_COMPLETION_PROMPT_READY', reply);
    assert.match(JSON.stringify(reply.chat), /STORY_BLOCKS_V1_CONTEXT_BEGIN[\s\S]*70 Gold/);
    await finish();
});

test('text completion: the context replaces the placeholder in place', async () => {
    ctx.mainApi = 'textgenerationwebui';
    try {
        ctx.chat = [{ is_user: false, mes: envelope(inventory(60)) }, { is_user: true, mes: 'go' }];
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        assert.equal(extensionPromptPositions.story_block, 0);
        const event = { prompt: `Story so far.\n${placeholder()}\n${ctx.chat[0].mes}\nUser: go`, dryRun: false };
        await emit('GENERATE_AFTER_COMBINE_PROMPTS', event);
        assert.ok(event.prompt.startsWith('Story so far.\nSTORY_BLOCKS_V1_CONTEXT_BEGIN'));
        assert.equal((event.prompt.match(/60 Gold/g) ?? []).length, 1, 'state once, history stripped');
        await finish();
    } finally {
        ctx.mainApi = 'openai';
    }
});

test('receiving a reply hides a bare <Blocks> and warns about a missing stateful block', async () => {
    setBlocks([
        { id: 'inventory', name: 'Inventory', tag: 'Inventory', kind: 'stateful', format: 'rows' },
        { id: 'notes', name: 'Notes', tag: 'Notes', kind: 'turn', format: 'text' },
    ]);
    ctx.chat = [{ is_user: false, mes: envelope(inventory(50)) }, { is_user: true, mes: 'go' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    await emit('CHAT_COMPLETION_PROMPT_READY', replyChat(...history()));
    notices.length = 0;
    await finish('She left.\n<Blocks>\n<Notes>\nThe door is open.\n</Notes>\n</Blocks>');
    const mes = ctx.chat.at(-1).mes;
    assert.match(mes, /^She left\.\n<!-- STORY_BLOCKS_V1\n/);
    assert.match(mes, /<Notes>\nThe door is open\.\n<\/Notes>/);
    assert.match(notices.join('\n'), /warning: Inventory was missing\. The last valid state of each stateful block stays current\./);
    delete ctx.extensionSettings.storyBlock;
});

test('block prompts get {{user}} substituted; state text never does', async () => {
    setBlocks([{ id: 'inventory', name: 'Inventory', tag: 'Inventory', kind: 'stateful', format: 'rows', prompt: "{{user}}'s things." }]);
    ctx.chat = [{ is_user: false, mes: envelope('<Inventory>\n{{user}}\'s Letter | 1 | sealed\n</Inventory>') }, { is_user: true, mes: 'go' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const event = replyChat(...history());
    await emit('CHAT_COMPLETION_PROMPT_READY', event);
    const text = JSON.stringify(event.chat);
    assert.match(text, /Ava's things\./);
    assert.match(text, /\{\{user\}\}'s Letter \| 1 \| sealed/);
    await finish();
    delete ctx.extensionSettings.storyBlock;
});

test('fallback: without the extension-prompt API the reply prompt still gets the context', async () => {
    const setExtensionPrompt = ctx.setExtensionPrompt;
    delete ctx.setExtensionPrompt;
    try {
        ctx.chat = [{ is_user: false, mes: envelope(inventory(30)) }, { is_user: true, mes: 'go' }];
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        const reply = { chat: [{ role: 'system', content: 'rules' }], dryRun: false };
        await emit('CHAT_COMPLETION_PROMPT_READY', reply);
        assert.match(JSON.stringify(reply.chat), /STORY_BLOCKS_V1_CONTEXT_BEGIN[\s\S]*30 Gold/);
        await finish();
    } finally {
        ctx.setExtensionPrompt = setExtensionPrompt;
    }
});

test('dice: rolled before the reply, handed over, stamped on the block; an optional block may be skipped silently', async () => {
    setBlocks([
        { id: 'dice', name: 'Dice', tag: 'Dice', kind: 'lead', optional: true, format: 'text', display: 'dice', rolls: { count: 3, sides: 20 }, prompt: 'Rolls: {{rolls}}.' },
    ]);
    ctx.chat = [{ is_user: false, mes: 'Hi.' }, { is_user: true, mes: 'climb' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const event = replyChat(...history());
    await emit('CHAT_COMPLETION_PROMPT_READY', event);
    const handed = /Rolls: (\d+), (\d+), (\d+)\./.exec(JSON.stringify(event.chat));
    assert.ok(handed, 'three rolls handed over');
    const rolls = handed.slice(1).map(Number);
    for (const roll of rolls) assert.ok(roll >= 1 && roll <= 20);
    await finish(`<Dice>\n🎲 Climb — d20 vs 10 → ${rolls[0]} · success\n</Dice>\nShe climbed.`);
    assert.match(ctx.chat.at(-1).mes, new RegExp(`<Dice rolls="${rolls.join(', ')}">`));
    assert.match(ctx.chat.at(-1).mes, /^<!-- STORY_BLOCKS_V1\n/, 'the leading block is hidden');

    notices.length = 0;
    ctx.chat.push({ is_user: true, mes: 'rest' });
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    await emit('CHAT_COMPLETION_PROMPT_READY', replyChat(...history()));
    await finish('They rested. Nothing needed a roll.');
    assert.equal(notices.filter(notice => /Dice/.test(notice)).length, 0, 'no warning for an optional block left out');
    delete ctx.extensionSettings.storyBlock;
});

test('dice written as one tag per roll are folded into one block and stamped once', async () => {
    setBlocks([{ id: 'dice', name: 'Dice', tag: 'Dice', kind: 'lead', optional: true, repeating: true, format: 'text', display: 'dice', rolls: { count: 3, sides: 20 }, prompt: 'Rolls: {{rolls}}.' }]);
    ctx.chat = [{ is_user: false, mes: 'Hi.' }, { is_user: true, mes: 'go' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const event = replyChat(...history());
    await emit('CHAT_COMPLETION_PROMPT_READY', event);
    const [a, b] = /Rolls: (\d+), (\d+), \d+\./.exec(JSON.stringify(event.chat)).slice(1);
    await finish(`<Dice>\n🎲 Climb — d20 vs 10 → ${a} · success\n</Dice>\n<Dice>\n🎲 Look — d20 vs 10 → ${b} · success\n</Dice>\nThey moved on.`);
    const mes = ctx.chat.at(-1).mes;
    assert.equal((mes.match(/<Dice\b/g) ?? []).length, 1, 'one tag left');
    assert.match(mes, /<Dice rolls="[^"]+">\n🎲 Climb[^\n]*\n🎲 Look/);
    delete ctx.extensionSettings.storyBlock;
});
