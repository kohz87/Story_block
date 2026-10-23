// What a pack is for (src/v2/packs/kind.js): the tag the Packs list shows under a pack's name, read from its own fields: the modules
// it declares (requires.capabilities), else what it holds (places and calendars, races and skills), else "Pack".
import test from 'node:test';
import assert from 'node:assert/strict';
import { packTag } from '../../../src/v2/packs/kind.js';
import { validatePack } from '../../../src/v2/packs/validate.js';

const content = (lists = {}) => ({ items: [], creatures: [], shops: [], recipes: [], events: [], quests: [], races: [], talents: [], skills: [], presets: [], places: [], routes: [], terms: [], ranks: [], crafts: [], meterPresets: [], markets: [], ...lists });
const pack = ({ capabilities = [], lists = {}, extra = {} } = {}) => ({ requires: { storyBlock: '^2', capabilities }, content: content(lists), ...extra });

test('a declared module names the pack: its tag says what it is for', () => {
    assert.equal(packTag(pack({ capabilities: ['story-director'] })), 'World pack · Story Director');
    assert.equal(packTag(pack({ capabilities: ['director'] })), 'World pack · Story Director', 'the state area Story Director owns');
    assert.equal(packTag(pack({ capabilities: ['rpg-battle'] })), 'Rules pack · RPG Battle');
    assert.equal(packTag(pack({ capabilities: ['party', 'combat'] })), 'Rules pack · RPG Battle', 'the areas RPG Battle owns');
    assert.equal(packTag(pack({ capabilities: ['inventory', 'scene'] })), 'Story Block pack');
});

test('a pack that declares two modules, or none it knows, is "Pack" when it holds nothing to tell by', () => {
    assert.equal(packTag(pack({ capabilities: ['director', 'party'] })), 'Pack', 'two modules');
    assert.equal(packTag(pack({ capabilities: ['npc-state-delta'] })), 'Pack', 'a module this list does not name, and no content');
    assert.equal(packTag(pack()), 'Pack', 'nothing declared, nothing held');
    assert.equal(packTag(null), 'Pack', 'a pack that is not usable');
});

test('with nothing declared, what the pack holds decides', () => {
    assert.equal(packTag(pack({ lists: { places: [{ name: 'Harbour' }] } })), 'World pack · Story Director');
    assert.equal(packTag(pack({ extra: { calendar: { months: [] } } })), 'World pack · Story Director', 'a calendar');
    assert.equal(packTag(pack({ extra: { weather: { tables: {} } } })), 'World pack · Story Director', 'weather');
    assert.equal(packTag(pack({ lists: { races: [{ name: 'Dwarf' }] } })), 'Rules pack · RPG Battle');
    assert.equal(packTag(pack({ lists: { items: [{ name: 'Rope' }] } })), 'Story Block pack', 'items alone are the host\'s');
    assert.equal(packTag(pack({ extra: { currency: { name: 'mark' } } })), 'Story Block pack', 'a currency alone');
    // Creatures and quests are read by both modules, so they say nothing; a world and a rules pack at once are not sorted.
    assert.equal(packTag(pack({ lists: { creatures: [{ name: 'Wolf' }], quests: [{ name: 'Q' }] } })), 'Pack');
    assert.equal(packTag(pack({ lists: { places: [{ name: 'Harbour' }], skills: [{ name: 'Brew' }] } })), 'Pack');
});

test('a validated pack gets the same tag (its declared modules and its content)', () => {
    const checked = validatePack({ id: 'world-x', version: '1.0.0', name: 'Harbour', requires: { storyBlock: '^2', capabilities: ['story-director'] }, content: { places: [{ name: 'Harbour', x: 1, y: 2 }] } });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.equal(packTag(checked.pack), 'World pack · Story Director');
});

test('a validated pack that holds nothing and declares nothing is "Pack" (its empty theme and nulls do not count as content)', () => {
    const checked = validatePack({ id: 'nothing-x', version: '1.0.0', requires: { storyBlock: '^2' }, content: {} });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.equal(packTag(checked.pack), 'Pack');
    const themed = validatePack({ id: 'theme-x', version: '1.0.0', requires: { storyBlock: '^2' }, content: {}, theme: { '--ss-accent': '#3f7f8f' } });
    assert.equal(themed.ok, true, JSON.stringify(themed.errors));
    assert.equal(packTag(themed.pack), 'Story Block pack', 'a theme is what the pack holds');
});
