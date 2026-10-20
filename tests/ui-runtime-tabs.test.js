// The real index.js against the fake DOM, so what is checked is the sidebar, card and settings
// panel the reader sees (v0.9.1):
// - a kept block registered with `tab: false` is prompted and kept as always but has no tab, no
//   badge and no count on the edge handle; registering it again may flip that;
// - chatter has no tab while another extension (NPC State Delta) announces it shows it;
// - the "New built-in blocks" line offers a template an older install never got.
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

// An install from before NPC Inner Chatter and Dice existed: its list is the reader's own.
const { defaultBlocks, templateById } = await import('../src/templates.js');
ctx.extensionSettings.storyBlock = { blocks: defaultBlocks().filter(block => !['inner-chatter', 'dice'].includes(block.id)) };

await import('../index.js');
const sb = globalThis.StoryBlock;
const emit = (type, ...args) => ctx.eventSource.emit(eventTypes[type], ...args);
// Mounting is scheduled on a timer; let it run.
const settle = () => new Promise(resolve => setTimeout(resolve, 60));

// One reader's block (with a tab) and a reply to hang the card under.
const notes = { id: 'notes', name: 'Notes', tag: 'Notes', kind: 'turn', format: 'text', enabled: true };
const reply = mes => ({ is_user: false, is_system: false, mes });
function openChat(display, { blocks = [notes], written = '' } = {}) {
    ctx.extensionSettings.storyBlock = { blocks, display };
    ctx.chat = [reply(`The road is quiet.\n<!-- STORY_BLOCKS_V1\n<Blocks>\n<Notes>\nQuiet.\n</Notes>\n${written}</Blocks>\n-->`)];
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
    sb.refresh();
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

test('settings: the panel in the suite\'s shared look, and suite.css linked once', () => {
    const links = doc.querySelectorAll('link#story-suite-css');
    assert.equal(links.length, 1);
    assert.equal(links[0].rel, 'stylesheet');
    assert.match(links[0].href, /^file:.*\/src\/suite\.css$/, 'next to index.js');
    const content = doc.querySelector('#story_block_settings .inline-drawer-content');
    assert.ok(content.classList.contains('story-suite-panel'));
    assert.deepEqual(content.children.map(node => node.className), ['story-suite-manage', 'story-suite-quickbar', 'story-suite-folds']);
    assert.ok(content.querySelector('.story-suite-quickbar #story_block_status'), 'the editor\'s status line sits in the quickbar');
    assert.ok(content.querySelector('.story-suite-manage .menu_button'));
    const folds = content.querySelectorAll('.story-suite-folds > details.story-suite-fold');
    assert.deepEqual(folds.map(node => node.dataset.fold), ['display', 'money', 'suite', 'blocks', 'sent']);
    for (const fold of folds) {
        assert.deepEqual(fold.children.map(node => node.tagName), ['SUMMARY', 'DIV']);
        assert.deepEqual(fold.children[0].children.map(node => node.tagName), ['B', 'SMALL']);
    }
    assert.deepEqual(content.querySelectorAll('[data-fold="suite"] label.story-suite-row').map(row => row.dataset.area), ['scene', 'timeline', 'items', 'stats', 'rolls']);
    assert.ok(content.querySelector('[data-fold="blocks"] .story-suite-fold-body > .story-block-view'), 'the editor\'s list as it is');
});

const newTemplatesLine = () => doc.querySelector('#story_block_settings .story-block-new-templates');
const offered = () => (newTemplatesLine()?.querySelectorAll('.story-block-new-template') ?? []).map(node => node.dataset.template);

test('settings: built-in blocks an older install lacks are offered once, Add (switched off) or Dismiss, remembered', async () => {
    assert.deepEqual(offered(), ['dice', 'inner-chatter'], 'in template order');
    assert.match(newTemplatesLine().textContent, /^New built-in blocks:🎲 Dice — Add · Dismiss💭 NPC Inner Chatter — Add · Dismiss$/);
    const item = key => newTemplatesLine().querySelector(`.story-block-new-template[data-template="${key}"]`);
    assert.match(item('inner-chatter').querySelector('.story-block-new-template-add').title, /switched off: nothing changes until you turn it on/);

    item('inner-chatter').querySelector('.story-block-new-template-dismiss').click();
    assert.deepEqual(offered(), ['dice']);
    assert.deepEqual(ctx.extensionSettings.storyBlock.dismissedTemplates, ['inner-chatter'], 'stored');
    assert.equal(ctx.extensionSettings.storyBlock.blocks.some(block => block.id === 'inner-chatter'), false, 'nothing added');

    item('dice').querySelector('.story-block-new-template-add').click();
    assert.equal(newTemplatesLine(), null, 'nothing left to offer');
    const dice = ctx.extensionSettings.storyBlock.blocks.find(block => block.id === 'dice');
    assert.equal(dice.enabled, false, 'added switched off');
    assert.equal(dice.template, 'dice');
    assert.deepEqual(ctx.extensionSettings.storyBlock.dismissedTemplates, ['inner-chatter', 'dice'], 'an added one is not offered again either');
    assert.match(doc.querySelector('#story_block_settings .story-block-io-message').textContent, /Added Dice, switched off/);
});

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

// ---- chatter shown on NPC State Delta's cards ----

const chatter = { ...templateById('inner-chatter'), enabled: true };
const chatterCopy = '<NPC_Inner_Chatter>\nMara: He has no idea.\n</NPC_Inner_Chatter>\n';
const announceDelta = (extra = {}) => globalThis.StorySuite.announce({ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.2.2', owns: ['scene', 'npc'], shows: ['chatter'], ...extra });

test('chatter has no tab while NPC State Delta shows it, and gets it back when it stops, is switched off or leaves', async () => {
    openChat('sidebar', { blocks: [notes, chatter], written: chatterCopy });
    const listedTab = () => sb.listBlocks().find(block => block.id === 'inner-chatter').tab;
    try {
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes', 'block:inner-chatter'], 'alone, as before');
        assert.equal(listedTab(), true);

        announceDelta();
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes'], 'redrawn on the suite change');
        assert.equal(listedTab(), false);
        assert.match(sb.getBlock('NPC_Inner_Chatter').text, /Mara: He has no idea\./, 'still read');

        announceDelta({ shows: [] });
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes', 'block:inner-chatter'], 'no longer shown there');
        announceDelta();
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes']);
        announceDelta({ enabled: false });
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes', 'block:inner-chatter'], 'switched off');
        announceDelta();
        await settle();
        globalThis.StorySuite.withdraw('npc-state-delta');
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes', 'block:inner-chatter'], 'withdrawn');

        // The reader's own Show tab still applies on top.
        ctx.extensionSettings.storyBlock.blocks = [notes, { ...chatter, visible: false }];
        sb.refresh();
        await settle();
        assert.deepEqual(sidebarTabs(), ['block:notes']);
    } finally {
        globalThis.StorySuite.withdraw('npc-state-delta');
        await settle();
    }
});

test('the card leaves chatter out the same way', async () => {
    openChat('card', { blocks: [notes, chatter], written: chatterCopy });
    try {
        announceDelta();
        await settle();
        assert.deepEqual(cardTabs(), ['block:notes']);
        globalThis.StorySuite.withdraw('npc-state-delta');
        await settle();
        assert.deepEqual(cardTabs(), ['block:notes', 'block:inner-chatter']);
    } finally {
        globalThis.StorySuite.withdraw('npc-state-delta');
        await settle();
    }
});

test('rail labels: a built-in block saved without one gets its template\'s, a plugin tab its own or its first word; empty tabs may hide (0.9.18)', async () => {
    const { short: _short, ...inventory } = { ...templateById('inventory'), enabled: true };
    openChat('sidebar', { blocks: [notes, inventory] });
    await settle();
    const shortOf = id => doc.querySelector(`#story_block_sidebar [data-tab-id="${id}"] .story-block-sidebar-tab-short`)?.textContent;
    assert.equal(shortOf('block:inventory'), 'Items', 'not "Inventory" cut short');
    const off = [sb.registerTab({ id: 'cast', label: 'Present NPCs', icon: '🎭', short: 'Cast', render() {} }), sb.registerTab({ id: 'dossiers', label: 'Dossier Archive', icon: '🗂', render() {} })];
    try {
        await settle();
        assert.equal(shortOf('ext:cast'), 'Cast');
        assert.equal(shortOf('ext:dossiers'), 'Dossier');
        assert.ok(sidebarTabs().includes('block:inventory'), 'an empty block keeps its tab by default');
        ctx.extensionSettings.storyBlock.hideEmptyTabs = true;
        sb.refresh();
        await settle();
        assert.ok(!sidebarTabs().includes('block:inventory'), 'and hides when asked');
        assert.ok(sidebarTabs().includes('block:notes'));
    } finally {
        off.forEach(undo => undo?.());
        ctx.extensionSettings.storyBlock.hideEmptyTabs = false;
        await settle();
    }
});
