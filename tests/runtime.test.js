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

// ---- kept blocks (v0.7): RPG Battle's sheet, read every reply, written only by the plugin ----

const characterSpec = {
    kept: true,
    id: 'rpg-character',
    tag: 'Character',
    owner: 'RPG Battle',
    name: 'Character',
    icon: '⚔️',
    format: 'fields',
    display: 'fields',
    fields: [{ label: 'HP', type: 'meter', max: 62 }, { label: 'MP', type: 'meter', max: 30 }, { label: 'Checks', type: 'text' }],
    promptNote: 'The player character, as RPG Battle tracks it.',
    diceModifier: "Modifier: the matching stat's bonus from the <Character> block's Checks line (for example CHA +1); ignore the −3 to +3 guess.",
};

test('kept block: registered, written by setBlockText, shown read-only in the prompt, a model copy dropped, never warned about', async () => {
    const sb = globalThis.StoryBlock;
    const { templateById } = await import('../src/templates.js');
    setBlocks([{ ...templateById('dice'), enabled: true }, { id: 'notes', name: 'Notes', tag: 'Notes', kind: 'turn', format: 'text' }]);
    assert.deepEqual(sb.registerBlock(characterSpec), { ok: true });
    assert.equal(sb.registerBlock({ ...characterSpec, owner: '' }).ok, false);
    try {
        const listed = sb.listBlocks().find(block => block.id === 'rpg-character');
        assert.equal(listed.kind, 'kept');
        assert.equal(listed.owner, 'RPG Battle');
        assert.equal(listed.tab, true, 'a tab unless registered with tab: false (v0.9.1)');
        assert.ok(sb.listBlocks().every(block => typeof block.tab === 'boolean'));

        ctx.chat = [{ is_user: false, mes: 'The road is quiet.' }, { is_user: true, mes: 'fight' }, { is_user: false, mes: 'The goblin falls.' }];
        await assert.rejects(sb.setBlockText(2, 'Character', 'nothing readable'), /Character could not be read/);
        assert.equal(await sb.setBlockText(2, 'Character', 'HP: 58/62 | MP: 21/30\nChecks: STR +2 | CHA +1'), true);
        const snap = sb.getBlock('Character');
        assert.equal(snap.messageIndex, 2);
        assert.deepEqual(snap.state.entries.map(entry => [entry.label, entry.value]), [['HP', 58], ['MP', 21], ['Checks', 'STR +2 | CHA +1']]);
        assert.equal(sb.blockForGeneration('rpg-character', 'normal').messageIndex, 2);
        assert.equal(sb.blockForGeneration('rpg-character', 'swipe'), null, 'a swipe of #2 sees the copy before it');

        ctx.chat.push({ is_user: true, mes: 'drink the potion' });
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        const event = replyChat(...history());
        await emit('CHAT_COMPLETION_PROMPT_READY', event);
        const context = event.chat.find(message => String(message.content).includes('STORY_BLOCKS_V1_CONTEXT_BEGIN')).content;
        assert.match(context, /### Character — <Character> \(kept by RPG Battle: read it, never write it\)\nThe player character, as RPG Battle tracks it\.\nCurrent state:\n<Character>\nHP: 58\/62 \| MP: 21\/30\nChecks: STR \+2 \| CHA \+1\n<\/Character>/);
        assert.match(context, /- Modifier: the matching stat's bonus from the <Character> block's Checks line/);
        assert.doesNotMatch(context.slice(context.indexOf('Write it exactly like this:')), /Character/);
        assert.equal((JSON.stringify(event.chat).match(/HP: 58\/62/g) ?? []).length, 1, 'history lost its copy; the context has the one');

        notices.length = 0;
        await finish('She drinks.\n<Character>\nHP: 62/62 | MP: 30/30\n</Character>\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Notes>\nHealed.\n</Notes>\n</Blocks>\n-->');
        const mes = ctx.chat.at(-1).mes;
        assert.doesNotMatch(mes, /<Character/, 'the model\'s copy is gone from the reply');
        assert.match(mes, /^She drinks\.\n/);
        assert.match(mes, /<Notes>\nHealed\.\n<\/Notes>/);
        assert.equal(sb.getBlock('Character').messageIndex, 2, 'the extension\'s copy stays current');
        assert.equal(notices.filter(notice => /Character/.test(notice)).length, 0, 'no missing-block warning');

        // An edit that writes the tag by hand is dropped the same way.
        ctx.chat[2].mes += '\n<Character>\nHP: 1/62\n</Character>';
        await emit('MESSAGE_EDITED', 2);
        assert.equal(sb.getBlock('Character').state.entries[0].value, 58);
    } finally {
        assert.equal(sb.unregisterBlock('rpg-character'), true);
        delete ctx.extensionSettings.storyBlock;
    }
});

// ---- Story Suite (v0.8): the handshake with Story Director, NPC State Delta and RPG Battle ----

// Every element under `root`, the stubs FakeElement hands out for selectors included.
const allElements = root => [root, ...[...root.children, ...root.stubs.values()].filter(child => child instanceof FakeElement).flatMap(allElements)];
const suiteSection = () => allElements(fixed['#extensions_settings']).find(node => String(node.className).includes('story-block-suite'));
const storyBlockProvider = () => globalThis.StorySuite.providers().find(provider => provider.id === 'story-block');

test('suite: Story Block announces itself on load with what its enabled blocks offer, and a light api', () => {
    const provider = storyBlockProvider();
    assert.equal(provider.name, 'Story Block');
    assert.equal(provider.version, globalThis.StoryBlock.version);
    assert.equal(provider.enabled, true);
    assert.deepEqual(provider.owns, ['items'], 'a first install has only Inventory on');
    assert.equal(globalThis.StorySuite.api('story-block').listBlocks, globalThis.StoryBlock.listBlocks);
    assert.equal(globalThis.StorySuite.api('story-block').getBlock, globalThis.StoryBlock.getBlock);
    assert.deepEqual(Object.keys(globalThis.StorySuite.api('story-block')).sort(), ['getBlock', 'listBlocks', 'manage', 'openSuite']);
    assert.equal(provider.settings, '#story_block_settings', 'its panel, for Story Suite\'s overlay');
});

test('suite: the announcement follows the enabled blocks, announced again only when the offer changes', async () => {
    const { templateById } = await import('../src/templates.js');
    const changes = [];
    const off = globalThis.StorySuite.onChange(() => changes.push(storyBlockProvider()?.owns.join() ?? 'withdrawn'));
    try {
        setBlocks([{ ...templateById('character-sheet'), enabled: true }, { ...templateById('dice'), enabled: true }, { ...templateById('world-state'), enabled: false }]);
        await emit('CHAT_CHANGED');
        assert.deepEqual(storyBlockProvider().owns, ['stats', 'rolls']);
        await emit('CHAT_CHANGED');
        assert.deepEqual(changes, ['stats,rolls'], 'an unchanged offer is not announced again');
        setBlocks([{ ...templateById('world-state'), enabled: true }]);
        await emit('CHAT_CHANGED');
        assert.deepEqual(storyBlockProvider().owns, ['scene', 'timeline']);
        // A registry that lost Story Block (another extension replaced it) gets it back.
        globalThis.StorySuite.withdraw('story-block');
        await emit('CHAT_CHANGED');
        assert.deepEqual(storyBlockProvider().owns, ['scene', 'timeline']);
    } finally {
        off();
        delete ctx.extensionSettings.storyBlock;
        await emit('CHAT_CHANGED');
    }
});

test('suite: Source of truth defaults to Automatic for each shared area and keeps only known choices', async () => {
    ctx.extensionSettings.storyBlock = { sourceOfTruth: { stats: 'mine', rolls: 'nonsense' } };
    ctx.chat = [{ is_user: false, mes: 'Hi.' }, { is_user: true, mes: 'go' }];
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    assert.deepEqual(ctx.extensionSettings.storyBlock.sourceOfTruth, { scene: 'auto', timeline: 'auto', items: 'auto', stats: 'mine', rolls: 'auto' });
    await finish();
    delete ctx.extensionSettings.storyBlock;
});

test('suite: the settings section has a choice per area, saves it, and redraws when another extension announces', async () => {
    const section = suiteSection();
    assert.ok(section, 'the Source of truth section is in the settings panel');
    const selects = allElements(section).filter(node => node.tagName === 'SELECT');
    assert.deepEqual(selects.map(node => node.id), ['story_block_source_scene', 'story_block_source_timeline', 'story_block_source_items', 'story_block_source_stats', 'story_block_source_rolls']);
    assert.deepEqual(selects[3].children.map(option => option.value), ['auto', 'mine', 'theirs']);
    assert.deepEqual(selects[3].children.map(option => option.textContent), ['Automatic', 'This extension (Story Block)', 'The other one']);
    assert.equal(selects[3].value, 'auto');

    const { templateById } = await import('../src/templates.js');
    setBlocks([{ ...templateById('character-sheet'), enabled: true }]);
    await emit('CHAT_CHANGED');
    const status = () => allElements(suiteSection()).filter(node => String(node.className).includes('story-suite-status')).map(node => node.textContent);
    assert.equal(status()[3], 'Now: Story Block');
    globalThis.StorySuite.announce({ id: 'rpg-battle', name: 'RPG Battle', version: '1.0.0', owns: ['stats', 'items', 'rolls'] });
    try {
        assert.equal(status()[3], 'Now: RPG Battle', 'redrawn on the suite\'s change');
        const stats = allElements(suiteSection()).find(node => node.id === 'story_block_source_stats');
        stats.value = 'mine';
        stats.listeners.change.forEach(fn => fn());
        assert.equal(ctx.extensionSettings.storyBlock.sourceOfTruth.stats, 'mine');
        assert.equal(status()[3], 'Now: Story Block');
    } finally {
        globalThis.StorySuite.withdraw('rpg-battle');
        delete ctx.extensionSettings.storyBlock;
        await emit('CHAT_CHANGED');
    }
});

test('settings: Display, Source of truth and Blocks fold, each with a one-line summary', async () => {
    const folds = allElements(fixed['#extensions_settings']).filter(node => String(node.className).includes('story-suite-fold '));
    assert.deepEqual(folds.map(node => node.dataset.fold), ['display', 'suite', 'blocks']);
    assert.deepEqual(folds.map(node => node.tagName), ['DETAILS', 'DETAILS', 'DETAILS']);
    assert.deepEqual(folds.map(node => Boolean(node.open)), [false, false, true], 'Blocks starts open');
    const hint = key => allElements(folds.find(node => node.dataset.fold === key)).find(node => String(node.className).includes('story-suite-fold-hint')).textContent;
    assert.equal(hint('display'), 'Sidebar');
    assert.equal(hint('suite'), 'Automatic');
    assert.match(hint('blocks'), /^\d+ of \d+ on$/);
    assert.ok(allElements(folds[0]).some(node => node.className === 'story-block-display'), 'Display holds its controls (markup the fake DOM does not parse)');
    assert.ok(allElements(folds[1]).some(node => node.id === 'story_block_source_stats'), 'so does Source of truth');
    // The suite's shared markup (src/suite.css): summary (<b>, <small>) + one body.
    assert.deepEqual(folds.map(node => node.children.map(child => child.tagName === 'SUMMARY' ? 'summary' : child.className)), Array(3).fill(['summary', 'story-suite-fold-body']));
    assert.equal(folds[2].children[1].children.length, 1, 'Blocks holds the editor\'s view');
    assert.ok(allElements(folds[1]).filter(node => node.tagName === 'LABEL').every(node => node.className === 'story-suite-row'), 'Source of truth rows');
    const panel = allElements(fixed['#extensions_settings']).find(node => String(node.className).includes('story-suite-folds'));
    assert.ok(panel, 'the folds sit together');
    assert.ok(allElements(fixed['#extensions_settings']).some(node => node.className === 'story-suite-quickbar'));
});

test('suite: Story Suite\'s entry points (menu item, settings link) show only while two or more extensions are announced', () => {
    const menuItem = () => fixed['#extensionsMenu'].children.find(node => node.id === 'story_suite_menu');
    const link = () => allElements(fixed['#extensions_settings']).find(node => node.className === 'story-suite-manage');
    assert.ok(menuItem(), 'its own item, next to Rescan');
    assert.equal(fixed['#extensionsMenu'].children.find(node => node.id === 'story_block_menu').innerHTML.includes('Rescan'), true);
    assert.match(menuItem().innerHTML, /fa-sliders.*Story Suite/);
    assert.equal(link().getAttribute('data-story-suite-link'), '', 'marked so the overlay hides it inside itself');
    assert.equal(menuItem().style.display, 'none', 'alone: hidden');
    assert.equal(link().style.display, 'none');
    globalThis.StorySuite.announce({ id: 'story-director', name: 'Story Director', version: '1.0.0', owns: [], enabled: false });
    try {
        assert.equal(menuItem().style.display, '', 'a second extension, even switched off, shows them');
        assert.equal(link().style.display, '');
    } finally {
        globalThis.StorySuite.withdraw('story-director');
    }
    assert.equal(menuItem().style.display, 'none');
    assert.equal(link().style.display, 'none');
});

test('suite: api.manage reads and sets Story Block\'s Source of truth like its own select; openSuite needs a page', async () => {
    const manage = globalThis.StorySuite.api('story-block').manage;
    assert.deepEqual(manage.areas, ['scene', 'timeline', 'items', 'stats', 'rolls']);
    assert.equal('setEnabled' in manage, false, 'Story Block is always on');
    try {
        assert.deepEqual(manage.sources(), { scene: 'auto', timeline: 'auto', items: 'auto', stats: 'auto', rolls: 'auto' });
        assert.equal(manage.setSource('stats', 'theirs'), true);
        assert.equal(ctx.extensionSettings.storyBlock.sourceOfTruth.stats, 'theirs', 'saved');
        assert.equal(allElements(suiteSection()).find(node => node.id === 'story_block_source_stats').value, 'theirs', 'its own select redrawn');
        manage.sources().stats = 'mine';
        assert.equal(manage.sources().stats, 'theirs', 'a copy');
        assert.equal(manage.setSource('npc', 'mine'), false, 'not an area Story Block keeps');
        manage.setSource('stats', 'nonsense');
        assert.equal(manage.sources().stats, 'auto');
        assert.equal(globalThis.StorySuite.api('story-block').openSuite(), false, 'no page body to show it on here');
    } finally {
        delete ctx.extensionSettings.storyBlock;
        await emit('CHAT_CHANGED');
    }
});

test('suite: the Dice block takes a kept modifier unless the reader keeps rolls with Story Block while RPG Battle offers them', async () => {
    const sb = globalThis.StoryBlock;
    const { templateById } = await import('../src/templates.js');
    const promptContext = async () => {
        ctx.chat.push({ is_user: true, mes: 'climb' });
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        const event = replyChat(...history());
        await emit('CHAT_COMPLETION_PROMPT_READY', event);
        await finish('She climbs.');
        return event.chat.find(message => String(message.content).includes('STORY_BLOCKS_V1_CONTEXT_BEGIN')).content;
    };
    setBlocks([{ ...templateById('dice'), enabled: true }]);
    await emit('CHAT_CHANGED');
    assert.deepEqual(sb.registerBlock(characterSpec), { ok: true });
    try {
        ctx.chat = [{ is_user: false, mes: 'The wall is wet.' }];
        await sb.setBlockText(0, 'Character', 'HP: 58/62\nChecks: STR +2');
        const modifier = /- Modifier: the matching stat's bonus/;
        assert.match(await promptContext(), modifier, 'alone, as in 0.7');
        ctx.extensionSettings.storyBlock.sourceOfTruth = { rolls: 'mine' };
        assert.match(await promptContext(), modifier, '"This extension" with nobody else offering rolls changes nothing');
        globalThis.StorySuite.announce({ id: 'rpg-battle', name: 'RPG Battle', version: '1.0.0', owns: ['stats', 'rolls'] });
        const own = await promptContext();
        assert.doesNotMatch(own, modifier, 'the reader keeps Story Block\'s own modifier');
        assert.match(own, /### Character — <Character> \(kept by RPG Battle/, 'the sheet itself is still shown');
        ctx.extensionSettings.storyBlock.sourceOfTruth = { rolls: 'auto' };
        assert.match(await promptContext(), modifier, 'Automatic: RPG Battle owns rolls');
    } finally {
        globalThis.StorySuite.withdraw('rpg-battle');
        sb.unregisterBlock('rpg-character');
        delete ctx.extensionSettings.storyBlock;
        await emit('CHAT_CHANGED');
    }
});

test('suite: chatter blocks get one line pointing at NPC State Delta\'s cards while it is here and on', async () => {
    const { templateById } = await import('../src/templates.js');
    const chatter = { ...templateById('inner-chatter'), enabled: true };
    const promptContext = async () => {
        ctx.chat.push({ is_user: true, mes: 'listen' });
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        const event = replyChat(...history());
        await emit('CHAT_COMPLETION_PROMPT_READY', event);
        await finish('They whisper.');
        return event.chat.find(message => String(message.content).includes('STORY_BLOCKS_V1_CONTEXT_BEGIN')).content;
    };
    const line = /\nVoice each NPC as their NPC State Delta card describes\.\n/;
    setBlocks([chatter, { ...templateById('scene-notes'), enabled: true }]);
    await emit('CHAT_CHANGED');
    try {
        ctx.chat = [{ is_user: false, mes: 'The tavern is loud.' }];
        assert.doesNotMatch(await promptContext(), /NPC State Delta card/, 'alone, as before');
        globalThis.StorySuite.announce({ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.2.2', owns: ['scene', 'npc'], shows: ['chatter'] });
        const context = await promptContext();
        assert.match(context, line);
        assert.equal((context.match(/NPC State Delta card/g) ?? []).length, 1, 'only under the chatter block');
        assert.ok(context.indexOf('NPC State Delta card') > context.indexOf('### NPC Inner Chatter'));
        assert.ok(context.indexOf('NPC State Delta card') < context.indexOf('### Scene Notes'));
        assert.equal(ctx.extensionSettings.storyBlock.blocks[0].prompt, chatter.prompt, 'the stored prompt is unchanged');
        globalThis.StorySuite.announce({ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.2.2', owns: ['scene', 'npc'], enabled: false });
        assert.doesNotMatch(await promptContext(), /NPC State Delta card/, 'switched off');
    } finally {
        globalThis.StorySuite.withdraw('npc-state-delta');
        delete ctx.extensionSettings.storyBlock;
        await emit('CHAT_CHANGED');
    }
});

test('suite: api.manage.tokens() estimates the next ordinary reply, kept blocks included, and never throws', async () => {
    const sb = globalThis.StoryBlock;
    const { templateById } = await import('../src/templates.js');
    const tokens = globalThis.StorySuite.api('story-block').manage.tokens;
    setBlocks([{ ...templateById('inventory'), enabled: true }, { ...templateById('scene-notes'), enabled: true }, { ...templateById('dice'), enabled: false }]);
    await emit('CHAT_CHANGED');
    assert.deepEqual(sb.registerBlock(characterSpec), { ok: true });
    try {
        ctx.chat = [{ is_user: false, mes: envelope(inventory(12)) }];
        await sb.setBlockText(0, 'Character', 'HP: 58/62\nChecks: STR +2');
        const result = tokens();
        assert.ok(result.input > 100 && result.output > 0);
        assert.deepEqual(result.parts.map(part => part.label), ['Character (kept by RPG Battle)', 'Inventory', 'Scene Notes', 'Rules and envelope'], 'enabled blocks only');
        assert.equal(result.parts.reduce((total, part) => total + part.input, 0), result.input);

        // The same section the next reply gets.
        ctx.chat.push({ is_user: true, mes: 'look' });
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        const event = replyChat(...history());
        await emit('CHAT_COMPLETION_PROMPT_READY', event);
        await finish('She looks.');
        const context = event.chat.find(message => String(message.content).includes('STORY_BLOCKS_V1_CONTEXT_BEGIN')).content;
        ctx.chat.splice(-2);
        assert.equal(tokens().input, Math.round(context.length / 4));

        // Never throws: a broken chat gives zeros.
        const chat = ctx.chat;
        ctx.chat = [{ get is_user() { throw new Error('boom'); } }];
        assert.deepEqual(tokens(), { input: 0, output: 0, parts: [] });
        ctx.chat = chat;
    } finally {
        sb.unregisterBlock('rpg-character');
        delete ctx.extensionSettings.storyBlock;
        await emit('CHAT_CHANGED');
    }
});
