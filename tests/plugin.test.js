// The plugin API's pure half: snapshots, the copy a generation sees, plugin blocks, listeners.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_MARKER, normalizeTransport, stripBlocks } from '../src/envelope.js';
import { blockInText, blockSnapshot, blockSummary, createListeners, findBlockDef, generationSnapshot, hasTab, pluginBlockDef } from '../src/plugin.js';
import { templateById } from '../src/templates.js';

const world = { ...templateById('world-state'), enabled: true };
const envelope = (...blocks) => `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const reply = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, mes });
const ws = time => `<World_State>\n**📅 Time:** ${time} | **🌤 Loc:** Auvoth\n</World_State>`;

test('findBlockDef matches ids, and tags without regard to case', () => {
    assert.equal(findBlockDef([world], 'world-state'), world);
    assert.equal(findBlockDef([world], 'world_state'), world);
    assert.equal(findBlockDef([world], 'Nope'), null);
    assert.equal(findBlockDef([world], ''), null);
    assert.deepEqual(Object.keys(blockSummary(world)).sort(), ['display', 'enabled', 'format', 'id', 'kind', 'name', 'optional', 'tab', 'tag', 'visible']);
    // `tab` (v0.9.1) follows the reader's "Show tab" switch.
    assert.equal(blockSummary(world).tab, true);
    assert.equal(blockSummary({ ...world, visible: false }).tab, false);
    // A display another extension shows itself (v0.9.1: chatter) has no tab; others keep theirs.
    const chatter = { ...templateById('inner-chatter'), enabled: true };
    assert.equal(hasTab(chatter), true);
    assert.equal(hasTab(chatter, { shownElsewhere: ['chatter'] }), false);
    assert.equal(blockSummary(chatter, { shownElsewhere: ['chatter'] }).tab, false);
    assert.equal(hasTab(world, { shownElsewhere: ['chatter'] }), true);
    assert.equal(hasTab({ ...chatter, visible: false }), false, 'the reader\'s Show tab still applies');
});

test('blockSnapshot: the newest valid copy, or the one before a given message', () => {
    const chat = [reply(`Dawn.\n${envelope(ws('Haywane 12, dawn'))}`), user('Go.'), reply(`Noon.\n${envelope(ws('Haywane 12, noon'))}`)];
    const now = blockSnapshot(chat, world);
    assert.equal(now.messageIndex, 2);
    assert.match(now.text, /noon/);
    assert.equal(now.tag, 'World_State');
    assert.match(blockSnapshot(chat, world, { beforeIndex: 2 }).text, /dawn/);
    assert.equal(blockSnapshot([], world), null);
    assert.equal(blockSnapshot(chat, null), null);
});

test('generationSnapshot: a swipe or regenerate sees the copy before the reply it replaces', () => {
    const chat = [reply(envelope(ws('Haywane 12, dawn'))), user('Go.'), reply(envelope(ws('Haywane 12, noon')))];
    assert.match(generationSnapshot(chat, world, 'normal').text, /noon/);
    assert.match(generationSnapshot(chat, world, 'swipe').text, /dawn/);
    assert.match(generationSnapshot(chat, world, 'regenerate').text, /dawn/);
    // Ending on the user's message, nothing is replaced.
    assert.match(generationSnapshot(chat.slice(0, 2), world, 'swipe').text, /dawn/);
});

test('plugin blocks are transport only, keep their tag to themselves, and merge repeats', () => {
    const { def } = pluginBlockDef({ id: 'story-director', tag: 'Director', name: 'Story Director' }, [world]);
    assert.equal(def.plugin, true);
    assert.equal(def.visible, false);
    assert.equal(def.kind, 'turn');
    assert.equal(def.repeating, true);
    assert.equal(def.prompt, '');
    assert.equal(blockSummary(def).tab, false, 'transport only: never a tab');
    assert.equal(pluginBlockDef({ id: 'story-director', tag: 'Director', tab: true }, []).def.visible, false, 'whatever spec.tab says');
    assert.match(pluginBlockDef({ id: 'x', tag: 'World_State' }, [world]).error, /already used/);
    assert.match(pluginBlockDef({ id: 'x', tag: 'bad tag' }, []).error, /tag/);
    assert.match(pluginBlockDef({ id: 'Bad Id', tag: 'Ok' }, []).error, /id/);

    // A bare <Director> written after the story moves into the envelope and leaves the narration.
    const raw = 'The courier rode out.\n<Director>\n+ agenda Courier — now: rides south\n</Director>';
    const moved = normalizeTransport(raw, [world, def]).text;
    assert.match(moved, new RegExp(ENVELOPE_MARKER));
    assert.equal(stripBlocks(moved, [world, def]).trim(), 'The courier rode out.');
    assert.match(blockInText(moved, def).text, /\+ agenda Courier/);

    const twice = `${envelope('<Director>\n+ agenda A — now: here\n</Director>', '<Director>\n- B — gone\n</Director>')}`;
    const merged = blockInText(twice, def).text;
    assert.match(merged, /\+ agenda A/);
    assert.match(merged, /- B — gone/);
    assert.equal(blockInText('no blocks here', def), null);
});

test('listeners: a throwing listener is skipped, unsubscribe works', () => {
    const list = createListeners('test');
    const seen = [];
    const warn = console.warn;
    console.warn = () => {};
    try {
        list.add(() => { throw new Error('boom'); });
        const off = list.add(payload => seen.push(payload.n));
        list.emit({ n: 1 });
        off();
        list.emit({ n: 2 });
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(seen, [1]);
    assert.equal(list.size, 1);
    assert.equal(typeof list.add('not a function'), 'function');
});

test('async reply listeners finish in priority order and isolate rejected callbacks', async t => {
    const list = createListeners('reply');
    const seen = [];
    t.mock.method(console, 'warn', () => {});
    list.add(() => seen.push('director'));
    list.add(async () => { await Promise.resolve(); seen.push('rpg'); }, { priority: -10 });
    list.add(async () => { throw new Error('failed plugin'); }, { priority: -5 });
    await list.emitAsync({});
    assert.deepEqual(seen, ['rpg', 'director']);
    assert.equal(console.warn.mock.callCount(), 1);
});
