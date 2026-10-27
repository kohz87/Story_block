// The Ersveil starter pack (examples/packs/ersveil-bluewatch): it validates, its map and calendar
// come out of the packs queries, its start state applies, and its quests, events and ready-made
// character read the way Story Director, the events engine and RPG Battle's creation read them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { applyStart, mergeStart } from '../../../src/v2/packs/content.js';
import { LIMITS } from '../../../src/v2/packs/limits.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { byteLength } from '../../../src/v2/packs/safety.js';
import { initialInventory, validateInventory } from '../../../src/v2/domains/inventory.js';
import { initialScene, validateScene } from '../../../src/v2/domains/scene.js';
import { WALLET_KEY, currencyOf, parseAmount } from '../../../src/v2/domains/money.js';
import { evaluateCondition, parse } from '../../../src/v2/events/condition.js';
import { fakeSettings } from './helpers/fake-settings.js';

const file = new URL('../../../examples/packs/ersveil-bluewatch/pack.json', import.meta.url);
const text = readFileSync(file, 'utf8');
const raw = () => JSON.parse(text);
const PACK = 'ersveil-bluewatch';
// A rules pack's currency is stored with `display` ('mixed' unless the pack says 'base'; PACKS.md, rules pack).
const CURRENCY = { name: 'copper', plural: 'copper', short: 'c', display: 'mixed', coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'bronze', plural: 'bronze', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }] };

function checked() {
    const result = validatePack(text);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
}

async function installedPart() {
    const settings = fakeSettings();
    const made = createPacksPart({ settings });
    const result = await made.packs.install(text, { origin: 'pack.json' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return { ...made, settings };
}

// Story Director's own code, when a checkout is next to this one (it is not in Story Block's CI).
const DIRECTOR = [fileURLToPath(new URL('../../../../Story_director/', import.meta.url)), '/home/user/_wt/int-story_director', '/home/user/story_director']
    .find(root => existsSync(`${root}/src/v2/quests/parse.js`) && existsSync(`${root}/src/calendar.js`));
const director = DIRECTOR ? { skip: false } : { skip: 'No Story Director checkout with src/v2/quests/parse.js next to this repo.' };

// Story Director's clock: minutes since year 0, the first month, day 1, 00:00 (calendar.js).
const minutesAt = (calendar, { year, month, day, hour = 0, minute = 0 }) => {
    const index = calendar.months.findIndex(entry => entry.name === month);
    const daysBefore = calendar.months.slice(0, index).reduce((sum, entry) => sum + entry.days, 0);
    const yearDays = calendar.months.reduce((sum, entry) => sum + entry.days, 0);
    return ((year * yearDays + daysBefore + day - 1) * 1440) + hour * 60 + minute;
};

test('the pack validates, under the size limit, with every content kind', () => {
    assert.ok(byteLength(text) < LIMITS.packBytes, `${byteLength(text)} bytes`);
    const pack = checked();
    assert.equal(pack.id, PACK);
    assert.equal(pack.version, '1.6.0');
    assert.deepEqual(pack.currency, CURRENCY);
    for (const kind of ['items', 'creatures', 'shops', 'recipes', 'events', 'quests', 'races', 'talents', 'skills', 'presets', 'places', 'routes', 'terms', 'ranks', 'crafts', 'meterPresets', 'rules']) {
        assert.ok(pack.content[kind].length > 0, `${kind} is not empty`);
    }
    assert.deepEqual(pack.requires, { storyBlock: '^2', capabilities: ['inventory', 'scene', 'rb-rules-v2'] });
});

test('money is the lore\'s coins, counted in copper: whole numbers, and every amount in the text a known coin', () => {
    const pack = checked();
    for (const item of pack.content.items) assert.ok(Number.isInteger(item.value) && item.value >= 0, item.name);
    for (const shop of pack.content.shops) for (const line of shop.stock) assert.ok(line.price === undefined || Number.isInteger(line.price), shop.name);
    assert.equal(pack.start.inventory.money, 44, '4 silver 4 copper');
    // No "marks" left from the one-coin days (MODULES §F108): "Silver Mark" and Highmark are proper names, and so
    // is the skill Duelist's Mark (slug duelists-mark).
    assert.equal(text.replace(/Silver Mark|Highmark|Duelist's Mark|duelists-mark/g, '').match(/\bmarks?\b/gi), null);
    // Every "<number> <word>" money amount names one of the pack's coins.
    const currency = currencyOf({ currency: pack.currency.name, currencyPlural: pack.currency.plural, coins: pack.currency.coins });
    for (const [, amount] of text.matchAll(/\b(\d+ (?:copper|silver|gold|bronze))\b/g)) assert.ok(parseAmount(amount, currency).amount > 0, amount);
});

test('places, routes and the calendar come out of the packs queries', async () => {
    const { part } = await installedPart();
    const places = part.queries['packs.content']({}, { kind: 'places' });
    const routes = part.queries['packs.content']({}, { kind: 'routes' });
    const bluewatch = places.find(place => place.name === 'Bluewatch Village');
    assert.deepEqual({ ...bluewatch, note: undefined }, {
        name: 'Bluewatch Village', aliases: [], region: 'River Confederacy: core cities', kind: 'settlement', layer: '',
        x: 64, y: 110, note: undefined, id: `pack.${PACK}/bluewatch-village`, slug: 'bluewatch-village', pack: PACK,
        market: 'village', tags: ['river', 'frontier'],
    });
    assert.equal(places.find(place => place.name === 'Auvoth Depths').layer, 'underground');
    for (const city of ['Auvoth', 'Shorn', 'Ledgerford', 'Glassdock', 'Coinwater', 'Thousand Sails', 'Highmark Capital', 'Guild Office', 'East Bluff', 'North Culvert', 'Watch Granary']) {
        assert.ok(places.some(place => place.name === city), city);
    }
    const names = new Set(places.map(place => place.name));
    for (const route of routes) {
        assert.ok(names.has(route.from) && names.has(route.to), `${route.from} → ${route.to}`);
        assert.ok(route.km !== null || route.hours !== null, `${route.from} → ${route.to} has a length`);
        assert.equal(route.pack, PACK);
    }
    const way = (a, b) => routes.find(route => (route.from === a && route.to === b) || (route.from === b && route.to === a));
    assert.deepEqual([way('Auvoth', 'Bluewatch Village').kind, way('Auvoth', 'Bluewatch Village').km], ['frontier road', 70]);
    assert.deepEqual([way('Glassdock', 'Bluewatch Village').kind, way('Glassdock', 'Bluewatch Village').km], ['river', 440]);
    assert.equal(way('Bluewatch Village', 'Guild Office').hours, 0.1, 'a walk inside the village is minutes, not km a day');

    const calendar = part.queries['packs.calendar']();
    assert.equal(calendar.pack, PACK);
    assert.equal(calendar.era, 'CY');
    assert.deepEqual(calendar.months.map(month => month.name), ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane', 'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend']);
    assert.ok(calendar.months.every(month => month.days === 30));
    assert.deepEqual(calendar.start, { year: 611, month: 'Goldwane', day: 12, hour: 6, minute: 40 }, 'the first message: CY 611, Goldwane 12, 06:40 am');
});

test('the start state applies to a new chat: Bluewatch, Wessel\'s kit and a purse of copper', () => {
    const start = mergeStart([checked()]);
    assert.deepEqual(start.currency, CURRENCY);
    assert.deepEqual(start.scene, { place: { name: 'Bluewatch Village', kind: 'settlement', region: 'River Confederacy' }, present: ['Marrit', 'Quay inspector'] });
    let n = 0;
    const id = prefix => `${prefix}_${String(++n).padStart(8, '0')}`;
    const initial = { v: 2, meta: { rev: 0, claims: {} }, domains: { scene: initialScene(), inventory: initialInventory() } };
    const state = applyStart(initial, start, { id });
    assert.deepEqual(validateScene(state.domains.scene), []);
    assert.deepEqual(validateInventory(state.domains.inventory), []);
    assert.equal(state.domains.scene.place.name, 'Bluewatch Village');
    const held = Object.values(state.domains.inventory.stacks).map(stack => [state.domains.inventory.defs[stack.def].name, stack.qty, stack.note]);
    assert.deepEqual(held, [['Cane-Blade', 1, ''], ['Patched Oilcloth Coat', 1, ''], ['Knife', 1, 'For work, not fights'], ['Whetstone', 1, 'Worn thin']]);
    const blade = state.domains.inventory.defs[`pack.${PACK}/cane-blade`];
    assert.deepEqual([blade.kind, blade.slot, blade.stats, blade.stack], ['equipment', 'weapon', { ATK: 4 }, false]);
    assert.equal(state.domains.inventory.aliases['walking stick'], `pack.${PACK}/cane-blade`, 'the story may call it his walking stick');
    assert.deepEqual(state.domains.inventory.wallets, { party: { [WALLET_KEY]: 44 } });
});

test('shops, recipes and loot name items of the pack', () => {
    const pack = checked();
    const ids = new Set(pack.content.items.map(item => item.id));
    // Rules v2 shops: a slug kind and the id of a place of the pack (SPEC: rules pack schema 2, shop).
    assert.deepEqual(pack.content.shops.map(shop => [shop.name, shop.kind]), [
        ['Watch Stores', 'general-goods'], ['Salt-and-Ash Dispensary', 'apothecary'], ['Gate Forge', 'smith'], ['Stray Oar', 'inn'],
        ['Delver\'s Provisions', 'general-goods'], ['Auvoth Apothecary', 'apothecary'], ['Hulkrow Chandlery', 'general-goods'], ['Mirage Blade Exchange', 'smith'],
    ]);
    const places = new Set(pack.content.places.map(place => place.id));
    for (const shop of pack.content.shops) {
        assert.ok(places.has(shop.place), `${shop.name} is at a place of the pack: ${shop.place}`);
        for (const line of shop.stock) assert.ok(ids.has(line.item), `${shop.name}: ${line.item}`);
    }
    for (const recipe of pack.content.recipes) assert.ok(ids.has(recipe.makes) && recipe.materials.every(line => ids.has(line.item)), recipe.name);
    const draught = pack.content.items.find(item => item.name === 'Minor Healing Draught');
    assert.deepEqual([draught.kind, draught.effect], ['consumable', { heal: 20 }]);
    for (const creature of pack.content.creatures) {
        for (const row of creature.loot) assert.ok(ids.has(row.def), `${creature.name} drops ${row.def}`);
        assert.ok(Number.isInteger(creature.level) && creature.level >= 1 && creature.skills.length >= 1, creature.name);
    }
    // Quest rewards and collect objectives name items of the pack, and every place a quest names is a place of it.
    for (const quest of pack.content.quests) {
        for (const row of quest.reward.items) assert.ok(ids.has(row.def), `${quest.name} pays ${row.def}`);
        for (const objective of quest.objectives) {
            if (objective.kind === 'collect' && (!quest.open || objective.def)) assert.ok(ids.has(objective.def), `${quest.name} asks for ${objective.def}`);
            if (objective.kind === 'visit') assert.ok(places.has(objective.place), `${quest.name} sends to ${objective.place}`);
        }
        if (quest.turnInPlace) assert.ok(places.has(quest.turnInPlace), `${quest.name} turns in at ${quest.turnInPlace}`);
    }
});

test('creatures have the rules v2 foe shape: tier, level, seven stats, written skills, loot of the pack', () => {
    // Rules v2 foes (RB_CONTRACT §7) replace the legacy template/moves record: a closed record whose skills are
    // skills of the pack's manifest and whose loot rows are `{ def, chance, qty }`.
    const pack = checked();
    const skills = new Set(pack.content.rules[0].skills.map(skill => skill.id));
    assert.equal(pack.content.creatures.length, 40);
    for (const creature of pack.content.creatures) {
        assert.deepEqual(Object.keys(creature).sort(), ['id', 'level', 'loot', 'loreTags', 'name', 'pack', 'skills', 'slug', 'stats', 'tier'], creature.name);
        assert.ok(Number.isInteger(creature.tier) && creature.tier >= 0 && creature.tier <= 9, `${creature.name}: tier`);
        assert.ok(Number.isInteger(creature.level) && creature.level >= 1 && creature.level <= 99, `${creature.name}: level`);
        assert.deepEqual(Object.keys(creature.stats).sort(), ['AGI', 'CHA', 'DEX', 'INT', 'LUK', 'STR', 'VIT'], `${creature.name}: the seven stats`);
        for (const value of Object.values(creature.stats)) assert.ok(Number.isInteger(value) && value >= 1 && value <= 99, `${creature.name}: stat ${value}`);
        assert.ok(creature.skills.length >= 1 && creature.skills.length <= 3, `${creature.name}: one to three skills`);
        for (const skill of creature.skills) assert.ok(skills.has(skill), `${creature.name} uses ${skill}`);
        for (const row of creature.loot) {
            assert.deepEqual(Object.keys(row).sort(), ['chance', 'def', 'qty'], `${creature.name}: loot row`);
            assert.ok(row.chance >= 0 && row.chance <= 100 && row.qty >= 1, `${creature.name}: ${row.def}`);
        }
    }
});

test('the three Bluewatch jobs: place, target and reward in copper, as rules v2 quests', () => {
    // Rules v2 quests (RB_CONTRACT §7) replace the free-form giver/place/goal/reward text: a turn-in place, structured
    // objectives (a kill names a foe of the pack) and a reward of coin, xp and items; the coin is a whole number of
    // copper inside the F rank's reward range. The giver is an id or null (the clerk has no id in the pack).
    const pack = checked();
    const foes = new Map(pack.content.creatures.map(creature => [creature.id, creature]));
    const village = `pack.${PACK}/bluewatch-village`;
    const F = pack.content.ranks.find(rank => rank.id === 'F');
    const jobs = pack.content.quests.slice(0, 3);
    assert.deepEqual(jobs.map(job => [job.name, job.turnInPlace, job.objectives.map(objective => [objective.kind, foes.get(objective.foe)?.name, objective.count]), job.reward.coin]), [
        ['Granary Rats', village, [['kill', 'Cellar Rat Swarm', 6]], 50],
        ['East Bluff Wolves', village, [['kill', 'Starved Crag Wolf', 4]], 200],
        ['Culvert Leeches', village, [['kill', 'Sluice Leech', 8]], 120],
    ]);
    for (const job of jobs) {
        assert.ok(job.giver === null || /^(?:[a-z][a-z0-9]*_[0-9a-z]{8}|pack\.[a-z0-9._-]+\/[a-z0-9_-]+)$/.test(job.giver), `${job.name}: giver ${job.giver}`);
        assert.ok(Number.isInteger(job.reward.coin) && job.reward.coin >= F.reward[0] && job.reward.coin <= F.reward[1], `${job.name} pays inside the F range`);
        assert.equal(job.requirements.length, 0, `${job.name} is open to a new Guild hand`);
    }
});

test('the event times are the calendar\'s minutes, the way Story Director\'s clock counts them', director, async () => {
    const { makeCalendar } = await import(`${DIRECTOR}/src/calendar.js`);
    const { calendar } = checked();
    const clock = makeCalendar({ era: calendar.era, months: calendar.months });
    const at = moment => minutesAt(calendar, moment);
    assert.equal(clock.format(at(calendar.start)), 'CY 611, Goldwane 12, 06:40 am');
    assert.equal(clock.format(at({ year: 611, month: 'Goldwane', day: 14, hour: 19 })), 'CY 611, Goldwane 14, 07:00 pm');
    const parsed = clock.parse('CY 611, Goldwane 14, 07:00 pm');
    assert.equal(parsed.abs, at({ year: 611, month: 'Goldwane', day: 14, hour: 19 }));
});

// ---------------------------------------------------------------- events

const T = (day, hour, minute = 0) => minutesAt(checked().calendar, { year: 611, month: 'Goldwane', day, hour, minute });

function world({ minutes = null, place = 'Bluewatch Village', done = [] } = {}) {
    const threads = {};
    const keys = {};
    done.forEach((name, index) => {
        const id = `th_done000${index}`;
        threads[id] = { id, kind: 'quest', key: name, status: 'resolved', ended: { rev: 4, reason: '', outcome: 'done' } };
        keys[name.toLowerCase()] = id;
    });
    const state = { domains: { scene: { place: { name: place, kind: 'settlement', region: '' }, present: [] }, director: { time: { minutes }, threads, keys } } };
    return { state, query: name => (name === 'scene.place' ? state.domains.scene.place : null) };
}

const met = (event, env) => {
    const result = evaluateCondition(event.when, env);
    assert.equal(result.error, undefined, `${event.slug}: ${result.error?.message}`);
    return result.met;
};

test('every event condition parses in the events language and gives true or false', () => {
    const pack = checked();
    for (const event of pack.content.events) {
        assert.equal(parse(event.when).ok, true, `${event.slug}: ${JSON.stringify(parse(event.when).error)}`);
        for (const env of [world(), world({ minutes: T(12, 7) }), world({ minutes: T(15, 0), done: ['Culvert Leeches', 'Granary Rats', 'East Bluff Wolves'] })]) met(event, env);
    }
    assert.deepEqual(pack.content.events.map(event => [event.slug, event.after]), [
        ['guild-board', null],
        ['wolves-at-dusk', `pack.${PACK}/guild-board`],
        ['culvert-rising', `pack.${PACK}/guild-board`],
        ['culvert-floods', `pack.${PACK}/culvert-rising`],
        ['culvert-cleared', `pack.${PACK}/guild-board`],
        ['granary-cleared', `pack.${PACK}/guild-board`],
    ]);
});

test('the chain: the board opens at 8, the culvert floods at its due time unless the job is done', () => {
    const events = Object.fromEntries(checked().content.events.map(event => [event.slug, event]));
    // No clock yet, or before eight: nothing on the board.
    assert.equal(met(events['guild-board'], world()), false);
    assert.equal(met(events['guild-board'], world({ minutes: T(12, 6, 40) })), false);
    assert.equal(met(events['guild-board'], world({ minutes: T(12, 8) })), true);
    assert.equal(met(events['guild-board'], world({ minutes: T(12, 8), place: 'Auvoth' })), false, 'only in Bluewatch');
    assert.match(events['guild-board'].cue, /Granary Rats.*East Bluff Wolves.*Culvert Leeches/);

    assert.equal(met(events['wolves-at-dusk'], world({ minutes: T(12, 18, 59) })), false);
    assert.equal(met(events['wolves-at-dusk'], world({ minutes: T(12, 19) })), true);
    assert.equal(met(events['wolves-at-dusk'], world({ minutes: T(12, 19), done: ['East Bluff Wolves'] })), false);

    assert.equal(met(events['culvert-rising'], world({ minutes: T(13, 18) })), true);
    assert.equal(met(events['culvert-floods'], world({ minutes: T(14, 18, 59) })), false, 'not before the due time');
    assert.equal(met(events['culvert-floods'], world({ minutes: T(14, 19) })), true, 'the job was never done');
    assert.equal(met(events['culvert-floods'], world({ minutes: T(16, 0), done: ['Culvert Leeches'] })), false, 'done in time: no flood');

    assert.equal(met(events['culvert-cleared'], world({ minutes: T(13, 10), done: ['Culvert Leeches'] })), true);
    assert.equal(met(events['culvert-cleared'], world({ minutes: T(15, 0), done: ['Culvert Leeches'] })), false, 'too late for the Watch-Captain\'s thanks');
    assert.deepEqual(events['culvert-cleared'].then, [{ command: 'wallet.receive', payload: { owner: 'party', amount: 20, note: 'Watch-Captain Rorke\'s thanks for the culvert' } }]);
    assert.equal(met(events['granary-cleared'], world({ minutes: T(12, 12), done: ['Granary Rats'] })), true);
});

// ---------------------------------------------------------------- creation

test('Wessel (kit) pre-fills the Human race, two talents, his stat points and his two skills', () => {
    const pack = checked();
    const [preset] = pack.content.presets;
    assert.deepEqual({ ...preset, note: undefined }, {
        name: 'Wessel (kit)', note: undefined, race: `pack.${PACK}/human`, talents: [`pack.${PACK}/shadow-bent`, `pack.${PACK}/river-born`],
        points: { STR: 0, VIT: 1, AGI: 2, DEX: 3, INT: 1, LUK: 1, CHA: 0 }, skills: [`pack.${PACK}/cane-draw`, `pack.${PACK}/shadow-cut`],
        id: `pack.${PACK}/wessel-kit`, slug: 'wessel-kit', pack: PACK,
    });
    // RPG Battle's creation: every stat starts at 5, 10 points, a talent costs its net stat change (at least 1).
    const byId = kind => new Map(pack.content[kind].map(record => [record.id, record]));
    const races = byId('races');
    const talents = byId('talents');
    const stats = Object.fromEntries(['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'].map(stat => [stat, 5]));
    for (const source of [races.get(preset.race).stats, ...preset.talents.map(talent => talents.get(talent).stats), preset.points]) {
        for (const [stat, value] of Object.entries(source)) stats[stat] += value;
    }
    assert.deepEqual(stats, { STR: 5, VIT: 6, AGI: 8, DEX: 8, INT: 7, LUK: 6, CHA: 5 }, 'the kit file\'s stats');
    const cost = preset.talents.reduce((sum, talent) => sum + Math.max(1, Object.values(talents.get(talent).stats).reduce((a, b) => a + b, 0)), 0);
    assert.equal(cost + Object.values(preset.points).reduce((a, b) => a + b, 0), 10, 'exactly the 10 creation points');
    const skills = byId('skills');
    assert.deepEqual(preset.skills.map(skill => [skills.get(skill).name, skills.get(skill).type, skills.get(skill).stat, skills.get(skill).target]), [
        ['Cane Draw', 'physical', 'DEX', 'one'], ['Shadow Cut', 'magic', 'INT', 'all'],
    ], 'the first message\'s <Learned> lines');
    assert.deepEqual(pack.content.races.map(race => race.name), ['Human', 'Elf', 'Dwarf', 'Halfling', 'Beastfolk', 'Orc', 'Goblin']);
    for (const race of pack.content.races) assert.ok(Object.values(race.stats).reduce((a, b) => a + b, 0) === 0 && Object.values(race.stats).every(n => Math.abs(n) <= 1), `${race.name}: small and even`);
});

test('nothing in the pack runs as code: it installs through the safety checks and round-trips as data', async () => {
    const { settings, packs } = await installedPart();
    assert.deepEqual(settings.root.packs[0].pack, raw(), 'kept as given');
    assert.deepEqual(packs.list()[0].counts, { items: 43, creatures: 40, shops: 8, recipes: 7, events: 6, quests: 42, races: 7, talents: 6, skills: 2, presets: 1, places: 54, routes: 63, terms: 1, ranks: 7, crafts: 2, meterPresets: 2, markets: 2, rules: 1 });
});
