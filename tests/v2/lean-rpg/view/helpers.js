// Shared pieces for the RPG screen tests: block definitions as the templates will shape them (the `role` key is
// read through `roleOf`, since the block engine's own key lands in another piece), a hand-built story state for the
// pure readers, and the real host's blocks for the tests that save.
import assert from 'node:assert/strict';

const int = (min, max, value, extra = {}) => ({ type: 'int', min, max, default: value, ...extra });
const text = (max, value = '') => ({ type: 'text', max, default: value });
const STATS = ['str', 'vit', 'agi', 'dex', 'int', 'luk', 'cha'];
const SOUL = { names: { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' } };
const RANKS = { names: { 0: 'Novice', 1: 'Adept', 2: 'Expert', 3: 'Master' } };

export const ROLE_BY_SLUG = { wessel: 'character', ren: 'character', 'wessel-skills': 'skills', 'ren-skills': 'skills', foes: 'foes' };
export const roleOf = definition => ROLE_BY_SLUG[definition.slug] ?? null;

const base = (slug, name, state, show = { tab: false, card: true, tabName: name.slice(0, 20), icon: 'ph-star' }) => ({
    slug, name, schema: 1, stateVersion: 1, scope: 'chat', state, kinds: {}, prompt: '', show,
});

/** A Character block definition (chat scope): the fields COMMON.md fixes. */
export const characterDefinition = (slug, who) => base(slug, who, {
    who: text(40, who), health: int(0, 5, 5), mana: int(0, 4, 4), stamina: int(0, 4, 4),
    ...Object.fromEntries(STATS.map(key => [key, int(1, 20, 10, { label: key.toUpperCase() })])),
    points: int(0, 99, 0), soul: int(1, 9, 1, SOUL), xp: int(0, 100, 0), alive: { type: 'bool', default: true },
});

/** A Skills block definition: five slots of name, rank (0 to 3, named) and practice. */
export const skillsDefinition = (slug, who, show) => base(slug, `${who} skills`, {
    who: text(40, who),
    ...Object.fromEntries([1, 2, 3, 4, 5].flatMap(n => [[`skill${n}`, text(40)], [`rank${n}`, int(0, 3, 0, RANKS)], [`practice${n}`, int(0, 100, 0)]])),
}, show);

/** A Foes block definition: four slots of name, count, class and hurt stage. */
export const foesDefinition = (slug = 'foes') => base(slug, 'Foes', Object.fromEntries([1, 2, 3, 4].flatMap(n => [
    [`foe${n}`, text(40)], [`count${n}`, int(1, 20, 1)], [`class${n}`, int(1, 9, 1, SOUL)], [`hurt${n}`, int(0, 5, 5)],
])));

// The block engine's `names` key lands in another piece; until it does the real host's schema refuses it, so a block pinned
// there goes without (the readers fall back to the default words).
const unnamed = definition => ({ ...definition, state: Object.fromEntries(Object.entries(definition.state).map(([key, { names, ...field }]) => [key, field])) });

/** Pins every definition in the real host and checks each took. */
export async function defineAll(host, definitions) {
    for (const definition of definitions.map(unnamed)) {
        const result = await host.sdk.command('dm.define', { definition });
        assert.equal(result.ok, true, `${definition.slug}: ${result.message}`);
    }
}

export async function setField(host, slug, field, value) {
    const result = await host.sdk.command('dm.set', { module: `pack.chat/${slug}`, field, value });
    assert.equal(result.ok, true, `${slug}.${field}: ${result.message}`);
}

export const fieldsOf = (host, slug) => host.sdk.query('dataModules.view', { module: `pack.chat/${slug}` }).chat;

/**
 * A hand-built story state holding blocks: `blocks` is [{ definition, fields }]. Only what the readers look at.
 * `actors` (optional) are Story Director's `{ id, name }` for character-scope blocks.
 */
export function fakeState(blocks) {
    const pins = {}, active = {}, instances = {};
    blocks.forEach(({ definition, fields = {}, subjects = null }, at) => {
        const id = `pack.chat/${definition.slug}`, hash = `h${at}`;
        pins[hash] = { interpreter: 1, packId: 'chat', definition: { ...definition, id, pack: 'chat' } };
        const defaults = Object.fromEntries(Object.entries(definition.state).map(([key, schema]) => [key, schema.default]));
        active[id] = { hash, generation: 1, subjects: subjects ?? ['chat'] };
        instances[id] = { chat: { fields: { ...defaults, ...fields }, timers: {}, offers: {}, settled: {} } };
    });
    return { meta: { rev: 1 }, domains: { dataModules: { pins, active, instances, perReply: {} } } };
}
