// Kept blocks without a tab (v0.9.1): the real index.js against the fake DOM, so what is
// checked is the sidebar and card the reader sees. A kept block registered with `tab: false`
// is prompted and kept as always but has no tab, no badge and no count on the edge handle;
// registering it again may flip that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';

const doc = installFakeDom();

// What the fake DOM lacks and the sidebar feature-detects (as in ui-sidebar.test.js).
function listenable(target) {
    target.listeners = [];
    target.addEventListener = (type, fn) => target.listeners.push({ type, fn });
    target.removeEventListener = (type, fn) => { target.listeners = target.listeners.filter(entry => entry.type !== type || entry.fn !== fn); };
    return target;
}
listenable(doc);
const win = listenable({ innerWidth: 1440 });
win.matchMedia = () => ({ matches: false });
globalThis.window = win;
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.getComputedStyle = () => ({ display: 'block' });

const sheld = doc.createElement('div');
sheld.id = 'sheld';
sheld.getBoundingClientRect = () => ({ left: 360, right: 1080, top: 40, bottom: 900, width: 720, height: 860 });
const chatElement = doc.createElement('div');
chatElement.id = 'chat';
sheld.appendChild(chatElement);
doc.body.appendChild(sheld);
// The Extensions menu and settings drawer, so the menu button and settings panel mount.
for (const id of ['extensionsMenu', 'extensions_settings']) {
    const host = doc.createElement('div');
    host.id = id;
    doc.body.appendChild(host);
}

const handlers = {};
const eventTypes = Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'CHAT_COMPLETION_PROMPT_READY', 'MESSAGE_RECEIVED', 'CHAT_CHANGED']
    .map(name => [name, name.toLowerCase()]));
const extensionPrompts = {};
const ctx = {
    chat: [],
    mainApi: 'openai',
    extensionSettings: {},
    getCurrentChatId: () => 'chat-kept-tab',
    saveSettingsDebounced() {},
    async saveChat() {},
    substituteParams: text => text,
    updateMessageBlock() {},
    setExtensionPrompt(key, value) { extensionPrompts[key] = value; },
    eventTypes,
    eventSource: {
        on(type, fn) { (handlers[type] ??= []).push(fn); },
        async emit(type, ...args) { for (const fn of handlers[type] ?? []) await fn(...args); },
    },
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map(level => [level, () => {}]));

await import('../index.js');
const sb = globalThis.StoryBlock;
const emit = (type, ...args) => ctx.eventSource.emit(eventTypes[type], ...args);
// Mounting is scheduled on a timer; let it run.
const settle = () => new Promise(resolve => setTimeout(resolve, 60));

// One reader's block (with a tab) and a reply to hang the card under.
const notes = { id: 'notes', name: 'Notes', tag: 'Notes', kind: 'turn', format: 'text', enabled: true };
const reply = mes => ({ is_user: false, is_system: false, mes });
function openChat(display) {
    ctx.extensionSettings.storyBlock = { blocks: [notes], display };
    ctx.chat = [reply('The road is quiet.\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Notes>\nQuiet.\n</Notes>\n</Blocks>\n-->')];
    chatElement.replaceChildren();
    const message = doc.createElement('div');
    message.className = 'mes';
    message.setAttribute('mesid', '0');
    const block = doc.createElement('div');
    block.className = 'mes_block';
    const text = doc.createElement('div');
    text.className = 'mes_text';
    block.appendChild(text);
    message.appendChild(block);
    chatElement.appendChild(message);
}

const partySpec = {
    kept: true,
    id: 'rpg-party',
    tag: 'Party',
    owner: 'RPG Battle',
    name: 'Party',
    format: 'fields',
    display: 'fields',
    fields: [{ label: 'HP', type: 'meter', max: 62 }, { label: 'Checks', type: 'text' }],
    promptNote: 'Your character and companions, as RPG Battle tracks them.',
};

const sidebarTabs = () => doc.querySelectorAll('#story_block_sidebar [data-tab-id]').filter(node => node.getAttribute('role') === 'tab').map(node => node.dataset.tabId);
const cardTabs = () => doc.querySelectorAll('.story-block-card .story-block-tab').map(node => node.dataset.tabId);
const handleCount = () => doc.querySelector('#story_block_handle .story-block-handle-count')?.textContent ?? '';

test('a kept block with tab: false is prompted and kept, but has no sidebar tab; registering again flips it', async () => {
    openChat('sidebar');
    assert.deepEqual(sb.registerBlock({ ...partySpec, tab: false }), { ok: true });
    try {
        assert.equal(await sb.setBlockText(0, 'Party', 'HP: 58/62\nChecks: STR +2'), true);
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes'], 'only the reader\'s block has a tab');
        assert.equal(sb.listBlocks().find(block => block.id === 'rpg-party').tab, false);
        assert.equal(sb.listBlocks().find(block => block.id === 'notes').tab, true);
        // Read exactly as any kept block.
        assert.equal(sb.getBlock('Party').messageIndex, 0);
        assert.equal(sb.blockForGeneration('rpg-party', 'normal').state.entries[0].value, 58);
        assert.match(sb.blockInText(ctx.chat[0].mes, 'Party').text, /HP: 58\/62/);

        // Prompted read-only as always.
        ctx.chat.push({ is_user: true, mes: 'onward' });
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        const event = { chat: [{ role: 'system', content: 'rules' }, { role: 'assistant', content: ctx.chat[0].mes }, { role: 'user', content: 'onward' }, { role: 'system', content: extensionPrompts.story_block }], dryRun: false };
        await emit('CHAT_COMPLETION_PROMPT_READY', event);
        const context = event.chat.find(message => String(message.content).includes('STORY_BLOCKS_V1_CONTEXT_BEGIN')).content;
        assert.match(context, /### Party — <Party> \(kept by RPG Battle: read it, never write it\)\nYour character and companions, as RPG Battle tracks them\.\nCurrent state:\n<Party>\nHP: 58\/62\nChecks: STR \+2\n<\/Party>/);
        // A model's copy is still dropped, and the extension's stays current.
        ctx.chat.push(reply('They march.\n<Party>\nHP: 1/62\n</Party>'));
        await emit('MESSAGE_RECEIVED', ctx.chat.length - 1);
        assert.doesNotMatch(ctx.chat.at(-1).mes, /<Party/);
        assert.equal(sb.getBlock('Party').messageIndex, 0);
        ctx.chat.splice(1);
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes']);

        // Flipped on: the tab appears on the refresh the registration triggers. And off again.
        assert.deepEqual(sb.registerBlock({ ...partySpec, tab: true }), { ok: true });
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes', 'block:rpg-party']);
        assert.equal(sb.listBlocks().find(block => block.id === 'rpg-party').tab, true);
        sb.registerBlock({ ...partySpec, tab: false });
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes']);
        // Default (tab left out): a tab, as before 0.9.1.
        sb.registerBlock(partySpec);
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes', 'block:rpg-party']);
    } finally {
        assert.equal(sb.unregisterBlock('rpg-party'), true);
        await settle();
    }
});

test('the card leaves a tab-less kept block out too', async () => {
    openChat('card');
    sb.registerBlock({ ...partySpec, tab: false });
    try {
        await sb.setBlockText(0, 'Party', 'HP: 40/62\nChecks: STR +2');
        await settle();
        assert.deepEqual(cardTabs(), ['block:notes']);
        sb.registerBlock(partySpec);
        await settle();
        assert.deepEqual(cardTabs(), ['block:notes', 'block:rpg-party']);
    } finally {
        sb.unregisterBlock('rpg-party');
        await settle();
    }
});

test('no tab, no badge: the edge handle counts a kept block\'s changes only while it has a tab', async () => {
    openChat('sidebar');
    ctx.chat.push({ is_user: true, mes: 'fight' }, reply('The goblin falls.'));
    sb.registerBlock({ ...partySpec, tab: false });
    try {
        await sb.setBlockText(0, 'Party', 'HP: 58/62\nChecks: STR +2');
        await sb.setBlockText(2, 'Party', 'HP: 40/62\nChecks: STR +2');
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes']);
        assert.equal(handleCount(), '', 'nothing counted');
        sb.registerBlock(partySpec);
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes', 'block:rpg-party']);
        assert.equal(handleCount(), '1', 'HP changed this reply');
    } finally {
        sb.unregisterBlock('rpg-party');
        await settle();
    }
});
