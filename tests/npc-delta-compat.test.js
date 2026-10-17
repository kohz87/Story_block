// World State written by Story Block must stay readable by NPC State Delta, which takes story
// dates, presence and identity evidence from <World_State>. The static checks always run; the
// checks against NPC State Delta's own readers run when its checkout is available
// (NPC_STATE_DELTA_PATH, or a sibling clone) and are skipped otherwise, e.g. in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { templateById } from '../src/templates.js';
import { buildContext } from '../src/prompt.js';
import { normalizeTransport, latestBlockInText } from '../src/envelope.js';
import { blocksFromSettings } from './helpers/blocks.js';

const worldState = templateById('world-state');
const filled = [
    '**📅 Time:** 1042, Harvestmoon 14, dusk | **🌤 Loc:** Heron Ford | Riverlands | **🌡 Wx:** Light rain, cool, grey light',
    '',
    '---',
    '',
    '**🧍 Maelis:**',
    '* *Outfit:* Travel leathers, forearm bound in linen',
    '* *Position:* By the fire, sharpening her short sword',
    '',
    '---',
    '',
    '**👥 NPCs Present:**',
    '**Astra:**',
    '* *Outfit:* Borrowed grey cloak over a mail shirt',
    '* *Position:* At the wagon, counting rations',
    '* *Mood:* Wary',
    '',
    '---',
    '**📡 Off-Screen:**',
    '* Captain Rhys Patrolling the north road with the Iron Guard',
].join('\n');
const reply = `Maelis sat by the fire.\n<Blocks>\n<World_State>\n${filled}\n</World_State>\n</Blocks>`;

test('the template keeps the labels NPC State Delta keys on, and the skeleton fills {{user}}', () => {
    assert.equal(worldState.tag, 'World_State');
    for (const label of ['NPCs Present:', 'Off-Screen:', '📅 Time:']) assert.ok(worldState.layout.includes(label), label);
    assert.ok(worldState.layout.indexOf('📅 Time:') < worldState.layout.indexOf('NPCs Present:'), 'the date comes before NPCs Present');
    const context = buildContext([{ def: worldState, state: null }], { substitute: text => text.replaceAll('{{user}}', 'Maelis') });
    assert.match(context, /\*\*🧍 Maelis:\*\*/);
});

test('a received World State stays a literal <World_State> block in the raw message', () => {
    const { text } = normalizeTransport(reply, blocksFromSettings([worldState]));
    assert.match(text, /<World_State>\n\*\*📅 Time:\*\* 1042, Harvestmoon 14/);
    assert.equal(latestBlockInText(text, worldState).state.text, filled);
});

const deltaRoot = process.env.NPC_STATE_DELTA_PATH ?? new URL('../../kohz87/npc_state_delta/', import.meta.url).pathname;
const hasDelta = existsSync(`${deltaRoot}/calendar.js`) && existsSync(`${deltaRoot}/core-mechanics.js`);

const deltaSkip = hasDelta ? false : 'NPC State Delta checkout not found';

test('NPC State Delta reads the story date from Story Block\'s message', { skip: deltaSkip }, async () => {
    const calendar = await import(pathToFileURL(`${deltaRoot}/calendar.js`).href);
    const { text } = normalizeTransport(reply, blocksFromSettings([worldState]));
    // The reader takes the calendar settings as the reader enters them (Month:days lines).
    const found = calendar.extractStructuredWorldDate(text, { months: 'Frostmoon:30\nHarvestmoon:30' });
    assert.equal(found?.date?.year, 1042);
    assert.equal(found?.date?.month, 'Harvestmoon');
    assert.equal(found?.date?.day, 14);
});

// NPC State Delta's scan cleaner (stripUiNoise) unwraps Story Block's hidden
// <!-- STORY_BLOCKS_V1 … --> envelope before stripping comments and tags (since NPC State Delta 1.2.0).
test('NPC State Delta keeps the World State evidence from Story Block\'s message', { skip: deltaSkip }, async () => {
    const mechanics = await import(pathToFileURL(`${deltaRoot}/core-mechanics.js`).href);
    const { text } = normalizeTransport(reply, blocksFromSettings([worldState]));
    const evidence = mechanics.stripUiNoise(text);
    assert.match(evidence, /World State:/);
    assert.match(evidence, /Astra/);
    assert.match(evidence, /Captain Rhys/);
});
