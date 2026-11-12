// Ersveil 2.2.0's hidden timeline (examples/packs/ersveil/pack.json): the big-beat events from CY 611 on and the Sealwarden recruit skill set. The events are checked as data
// (every condition reads, every "after" and every delay names something that exists, every lasting change fits Story
// Director's limits), and the story clock is walked from the start to CY 617 with a stand-in chronicle that prunes
// resolved entries like Story Director (30 kept), so the beats come in order, once each, Wendhild takes the throne,
// and a decision once made stays made (review 169).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateCondition, parse } from '../../../src/v2/events/condition.js';
import { rippleChoice } from '../../../src/v2/packs/content.js';

const pack = JSON.parse(readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8'));
const OWN = ['bluewatch-guild-board', 'bluewatch-signal-braziers', 'the-turning-611', 'the-turning-612', 'the-turning-613', 'ghost-fleet-waters', 'wailing-battlefield-nights'];
const events = pack.content.events;
const beats = events.filter(event => !OWN.includes(event.id));
const DAY = 1440;
const T = (year, month, day, hour = 0) => year * 360 * DAY + (month - 1) * 30 * DAY + (day - 1) * DAY + hour * 60;
const START = T(611, 5, 12, 6) + 40;
const lastingOf = event => (event.then ?? []).filter(step => step.command === 'chronicle.lasting').map(step => step.payload);
const written = new Set(beats.flatMap(event => lastingOf(event).map(payload => payload.name)));
const delays = event => [...event.when.matchAll(/(?<!!)query\('chronicle\.passed', \{ name: "([^"]*)"/g)].map(match => match[1]);
// The Director's ripples part as the pack reads it: `sway` is [Wendhild, Corvin, Hasse] (pack order) or null for no ripples data (no Director or no table:
// the leader is null and the rows are []). `leader` follows leaderOf: a tie keeps the earlier power of the pack's table.
const POWERS = ['wendhild', 'corvin', 'hasse'];
const rowsOf = sway => (sway ? sway.map((value, index) => ({ id: POWERS[index], sway: value })) : []);
const leaderOf = (sway, { among = POWERS, pick = 'top' } = {}) => {
    const pool = rowsOf(sway).filter(row => among.includes(row.id));
    if (!pool.length || !['top', 'bottom'].includes(pick)) return null;
    return pool.reduce((best, row) => ((pick === 'top' ? 1 : -1) * (row.sway - best.sway) > 0 ? row : best)).id;
};
// The view a condition reads: the clock, the place, the stand-in chronicle and the ripples.
function view({ minutes, place, chronicle = new Map(), sway = null }) {
    return {
        state: { domains: { director: { time: { minutes } } } },
        query(name, args) {
            if (name === 'scene.place') return place;
            if (name === 'ripples.sway') return rowsOf(sway);
            if (name === 'ripples.leader') return leaderOf(sway, args);
            if (name === 'packs.rippleChoice') return rippleChoice([pack], args, { hasQuery: query => query === 'ripples.sway', query: () => rowsOf(sway) });
            if (name === 'chronicle.passed') return chronicle.has(args.name) && minutes >= chronicle.get(args.name).since + args.minutes;
            return null;
        },
    };
}

test('the timeline is data Story Block and Story Director accept: conditions read, links resolve, lasting changes fit', () => {
    assert.equal(events.length, 135);
    assert.deepEqual(events.slice(0, 7).map(event => event.id), OWN, 'the 2.1.0 events come first, unchanged');
    const ids = new Set(events.map(event => event.id));
    assert.equal(ids.size, events.length, 'ids are unique');
    for (const event of beats) {
        assert.equal(parse(event.when).ok, true, `${event.id}: ${JSON.stringify(parse(event.when).error)}`);
        assert.ok(event.when.length <= 500 && event.cue.length <= 500, event.id);
        if (event.after) assert.ok(ids.has(event.after), `${event.id} follows ${event.after}`);
        for (const name of delays(event)) assert.ok(written.has(name), `${event.id} waits on "${name}", which some event writes`);
        for (const step of event.then ?? []) {
            assert.equal(step.command, 'chronicle.lasting', `${event.id} runs only Story Director's lasting change`);
            const { name, state, summary, place, factions, keep, ...rest } = step.payload;
            assert.deepEqual(rest, {}, `${event.id}: no other fields`);
            assert.ok(name.length >= 1 && name.length <= 80 && ['looming', 'ongoing', 'resolved'].includes(state), event.id);
            assert.ok(summary === undefined || summary.length <= 240, event.id);
            assert.ok(place === undefined || place.length <= 80, event.id);
            assert.ok(factions === undefined || (factions.length <= 4 && factions.every(faction => faction.length <= 80)), event.id);
            assert.ok(keep === undefined || (keep === true && state !== 'resolved'), `${event.id}: keep only on an open entry`);
        }
    }
    // Every entry a later event waits on for more than a few weeks is open (ongoing or looming): Story Director prunes
    // resolved entries past 30, never open ones (review 169 B3).
    const states = new Map();
    for (const event of beats) for (const payload of lastingOf(event)) states.set(payload.name, [...(states.get(payload.name) ?? []), payload.state]);
    for (const event of beats) for (const match of event.when.matchAll(/(?<!!)query\('chronicle\.passed', \{ name: "([^"]*)", minutes: (\d+)/g)) {
        if (Number(match[2]) <= 16 * DAY && !/^marrowbridge|^crown|^last-wall|^auvoth|^after-wall|^hasse|^corvin|^wendhild/.test(event.id)) continue;
        assert.ok(states.get(match[1]).some(state => state !== 'resolved'), `${event.id} waits on "${match[1]}", which is open`);
    }
    assert.ok(pack.requires.capabilities.includes('chronicle-lasting'));
});

test('nothing of the new timeline is told at the story start, wherever the story is', () => {
    for (const region of new Set(pack.content.places.map(place => place.region))) {
        const env = view({ minutes: START, place: { name: 'Somewhere', region } });
        const told = beats.filter(event => !event.after && evaluateCondition(event.when, env).met);
        assert.deepEqual(told.map(event => event.id), [], region);
    }
});

test('the pack has no Court favour module; the throne branches read the ripples queries, no event reads a data module', () => {
    assert.equal(pack.content.dataModules.some(definition => definition.slug === 'succession'), false);
    assert.equal(JSON.stringify(pack.content).includes('pack.ersveil/succession'), false);
    assert.equal(JSON.stringify(pack.content).includes('dataModules.view'), false, 'no event reads a data module');
    const reading = events.filter(event => /packs\.rippleChoice/.test(event.when)).map(event => event.id).sort();
    assert.deepEqual(reading, ['crown-corvin-over-hasse', 'crown-corvin-over-wendhild', 'crown-hasse-over-corvin', 'crown-hasse-over-wendhild', 'crown-wendhild-over-corvin',
        'crown-wendhild-over-hasse', 'marrowbridge-corvin', 'marrowbridge-hasse', 'marrowbridge-wendhild']);
});

// A chat that already fired a Court favour branch in 2.9.2 holds that branch's chronicle names (which nothing writes now);
// the fixed road's guards read them negated, so it never fires on top of the branch.
test('a chat already on a Court favour branch never gets the fixed road too', () => {
    const fires = (id, minutes, names) => {
        const chronicle = new Map(names.map(name => [name, { since: 0, state: 'resolved', touched: 0 }]));
        return evaluateCondition(events.find(event => event.id === id).when, view({ minutes, place: { name: 'x', region: 'y' }, chronicle })).met;
    };
    const crown = ['Highmark\'s war: Wendhild against Corvin'];
    assert.equal(fires('crown-wendhild-over-corvin', 318400000, crown), true, 'control: the fixed road fires on a plain chronicle');
    assert.equal(fires('crown-wendhild-over-corvin', 318400000, [...crown, 'Reign of Emperor Corvin']), false, 'Corvin already crowned');
    assert.equal(fires('marrowbridge-hasse', 318200000, []), true, 'control');
    for (const name of ['Highmark\'s war: Wendhild against Hasse', 'Highmark\'s war: Corvin against Hasse']) assert.equal(fires('marrowbridge-hasse', 318200000, [name]), false, name);
});

// Walk the clock at Bluewatch (or `place`), one reply every `step` story minutes, firing what is due like the engine does
// (an event fires once; an "after" link moves at most one step a reply), keeping the chronicle's "since" stamps and its
// states, pruning the oldest resolved entries past 30 like Story Director. `extra(minutes)` may add resolved entries of the story's own. Answers the ids fired, in order.
function walk({ place = { name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch' }, step = 6 * 60, extra = () => [], until = T(617, 1, 1), sway = () => null } = {}) {
    const chronicle = new Map();
    const fired = [];
    const done = new Set();
    const write = (name, state, minutes) => {
        const was = chronicle.get(name);
        chronicle.set(name, { since: was?.since ?? minutes, state, touched: minutes });
        const resolved = [...chronicle].filter(([, entry]) => entry.state === 'resolved').sort((a, b) => a[1].touched - b[1].touched);
        for (const [old] of resolved.slice(0, Math.max(0, resolved.length - 30))) chronicle.delete(old);
    };
    for (let minutes = START; minutes < until; minutes += step) {
        const before = new Set(done);
        const env = view({ minutes, place, chronicle, sway: sway(minutes) });
        for (const event of beats) {
            if (done.has(event.id) || (event.after && !before.has(event.after))) continue;
            const result = evaluateCondition(event.when, env);
            assert.equal(result.error, undefined, `${event.id}: ${JSON.stringify(result.error)}`);
            if (!result.met) continue;
            done.add(event.id); fired.push(event.id);
            for (const payload of lastingOf(event)) write(payload.name, payload.state, minutes);
        }
        for (const name of extra(minutes)) write(name, 'resolved', minutes);
    }
    return { fired, chronicle };
}

const order = (fired, ids) => {
    for (const id of ids) assert.ok(fired.includes(id), `${id} fired`);
    assert.deepEqual(ids.map(id => fired.indexOf(id)), ids.map(id => fired.indexOf(id)).toSorted((a, b) => a - b), `in order: ${ids.join(' → ')}`);
};
const variants = (fired, prefix) => fired.filter(id => id.startsWith(prefix) && !id.endsWith('-scene') && !id.includes('-news'));

test('Hasse is broken at Marrowbridge, Wendhild is crowned over Corvin, Auvoth is lost, the Wall holds', () => {
    const { fired } = walk();
    order(fired, ['flood-611', 'flood-611-scene', 'depths-611', 'who-pays-611', 'turning-611-harsh', 'ledger-611', 'sealwardens-612',
        'emperor-612', 'ardelia-612', 'inquest-612', 'turning-612', 'cinder-613', 'succession-613', 'marrowbridge-hasse', 'turning-613',
        'tide-613', 'chain-613', 'crown-wendhild-over-corvin', 'crown-wendhild-news', 'wendhild-north-614', 'troops-auvoth-614', 'auvoth-falls',
        'auvoth-evacuation-scene', 'last-wall-wendhild', 'last-wall-scene', 'after-wall-616']);
    assert.deepEqual(variants(fired, 'marrowbridge-'), ['marrowbridge-hasse']);
    assert.deepEqual(variants(fired, 'crown-'), ['crown-wendhild-over-corvin']);
    assert.equal(new Set(fired).size, fired.length, 'each event fires once');
    assert.ok(!fired.some(id => /corvin-south|hasse-archive|auvoth-falls-early|last-wall-(corvin|hasse)|marrowbridge-(corvin|wendhild)/.test(id)), 'the removed branches never fire');
});

test('review 169 B3: the story\'s own resolved entries pruning the chronicle never stop the Wall or let Auvoth fall twice', () => {
    // Two resolved world events a month from the crowning on: far past the 30 the chronicle keeps.
    const extra = minutes => (minutes > T(614, 2, 1) && minutes % (15 * DAY) < 6 * 60 ? [`Regional crisis ${minutes}`] : []);
    const plain = walk({ extra }).fired;
    order(plain, ['crown-wendhild-over-corvin', 'auvoth-falls', 'last-wall-wendhild', 'after-wall-616']);
    assert.equal(plain.filter(id => id === 'auvoth-falls').length, 1, 'Auvoth falls once');
});

test('review 169 B4: a reply that jumps days past the flood still gets the flood scene when the story is there', () => {
    // From the start, a reply every day; the reply at the flood shelters five days.
    const { fired } = walk({ step: 5 * DAY, until: T(611, 7, 1) });
    assert.ok(fired.includes('flood-611') && fired.includes('flood-611-scene'));
    assert.equal(fired.indexOf('flood-611-scene'), fired.indexOf('flood-611') + 1, 'in the same reply as the flood');
});

test('review 170: in Highmark with a month a reply, the battle, crown, evacuation and Wall scenes still play', () => {
    // A scene that waits on a chronicle entry fires one reply after its world event; its window outlasts a 30-day reply.
    const highmark = walk({ step: 30 * DAY, place: { name: 'Thornwall Redoubt', region: 'Highmark Empire' } }).fired;
    for (const id of ['marrowbridge-hasse-scene', 'crown-wendhild-scene', 'last-wall-scene']) assert.ok(highmark.includes(id), id);
    const north = walk({ step: 30 * DAY }).fired;
    assert.ok(north.includes('auvoth-evacuation-scene'));
});

test('away from the north the player hears of the beats as news, later, and sees no northern scenes', () => {
    const { fired } = walk({ place: { name: 'Osterhal', region: 'Ardelian Empire and Southmarch' } });
    assert.ok(fired.includes('ardelia-612-scene'));
    assert.ok(fired.includes('emperor-612-news-far'));
    for (const id of ['flood-611-scene', 'depths-611-scene', 'turning-611-scene', 'emperor-612-news-north']) assert.ok(!fired.includes(id), id);
});

test('the Sealwarden recruit skill set fits the pack format: five skills, each with a stat', () => {
    const [set] = pack.content.rpg.skillSets;
    assert.equal(set.name, 'Sealwarden recruit');
    assert.equal(set.skills.length, 5);
    for (const skill of set.skills) {
        assert.ok(skill.name.length <= 40 && skill.about.length >= 1 && skill.about.length <= 120, skill.name);
        assert.ok(['str', 'vit', 'agi', 'dex', 'int', 'luk', 'cha'].includes(skill.stat), skill.name);
    }
});

// ---- 2.9.5: the throne follows the player's deeds (the ripples table and the Director's `ripples` queries) ----

test('the ripples table names Wendhild, Corvin and Hasse in pack order with the old favour\'s bases 40, 35 and 25', () => {
    assert.deepEqual(pack.ripples.powers.map(power => [power.id, power.base]), [['wendhild', 40], ['corvin', 35], ['hasse', 25]]);
    for (const power of pack.ripples.powers) assert.ok(power.name && power.aliases.length && power.factions.includes(power.name), power.id);
    assert.ok(pack.ripples.powers[0].givers.includes('Sir Lothar') && pack.ripples.powers[0].npcs.some(npc => npc.name === 'Dame Ermengild'), 'cast and event people');
});

// Which of the three branches and which reign a chat gets for a sway [Wendhild, Corvin, Hasse] held the whole time.
const roadOf = sway => {
    const { fired } = walk({ sway: () => sway });
    return { fired, march: variants(fired, 'marrowbridge-'), crown: variants(fired, 'crown-') };
};

test('each Marrowbridge branch and each reign fires from the ripples leader', () => {
    // [Wendhild, Corvin, Hasse]: the lowest is broken, then the higher of the other two is crowned.
    const roads = [
        [[40, 35, 25], 'marrowbridge-hasse', 'crown-wendhild-over-corvin', 'Reign of Empress Wendhild'],
        [[35, 40, 25], 'marrowbridge-hasse', 'crown-corvin-over-wendhild', 'Reign of Emperor Corvin'],
        [[40, 25, 35], 'marrowbridge-corvin', 'crown-wendhild-over-hasse', 'Reign of Empress Wendhild'],
        [[25, 35, 40], 'marrowbridge-wendhild', 'crown-hasse-over-corvin', 'Reign of Emperor Hasse'],
        [[25, 40, 35], 'marrowbridge-wendhild', 'crown-corvin-over-hasse', 'Reign of Emperor Corvin'],
        [[35, 25, 40], 'marrowbridge-corvin', 'crown-hasse-over-wendhild', 'Reign of Emperor Hasse'],
    ];
    for (const [sway, march, crown, reign] of roads) {
        const road = roadOf(sway);
        assert.deepEqual(road.march, [march], `${sway}: the broken one`);
        assert.deepEqual(road.crown, [crown], `${sway}: the crown`);
        assert.ok(lastingOf(events.find(event => event.id === crown)).some(payload => payload.name === reign), `${crown} writes ${reign}`);
        assert.equal(new Set(road.fired).size, road.fired.length, `${sway}: each event fires once`);
        order(road.fired, ['succession-613', march, crown, 'last-wall-scene']);
        assert.equal(variants(road.fired, 'last-wall-').length, 1, `${sway}: the Wall holds once`);
    }
    // Corvin's reign loses Auvoth early (the old Corvin road), the others lose it on the usual date.
    assert.ok(roadOf([35, 40, 25]).fired.includes('auvoth-falls-early') && !roadOf([35, 40, 25]).fired.includes('auvoth-falls'));
    assert.ok(roadOf([40, 35, 25]).fired.includes('auvoth-falls') && !roadOf([40, 35, 25]).fired.includes('auvoth-falls-early'));
    assert.ok(roadOf([25, 35, 40]).fired.includes('hasse-archive-614') && roadOf([35, 40, 25]).fired.includes('corvin-south-614'));
});

test('ties go by pack order: the earliest power is the broken one, the earlier of two is crowned', () => {
    const tie = roadOf([30, 30, 30]);
    assert.deepEqual(tie.march, ['marrowbridge-wendhild'], 'the earliest is the least when all are level');
    assert.deepEqual(tie.crown, ['crown-corvin-over-hasse'], 'Corvin is before Hasse');
    assert.deepEqual(roadOf([30, 40, 40]).march, ['marrowbridge-wendhild']);
    assert.deepEqual(roadOf([40, 30, 30]).march, ['marrowbridge-corvin'], 'a tie for the least: Corvin is before Hasse');
    assert.deepEqual(roadOf([30, 30, 20]).crown, ['crown-wendhild-over-corvin'], 'Wendhild is before Corvin');
});

test('a chat with no ripples data follows the default road (Hasse broken, Wendhild over Corvin), and so does a Director with no table', () => {
    for (const road of [roadOf(null), walk({ sway: () => null })]) {
        assert.deepEqual(variants(road.fired, 'marrowbridge-'), ['marrowbridge-hasse']);
        assert.deepEqual(variants(road.fired, 'crown-'), ['crown-wendhild-over-corvin']);
    }
});

test('no double reign: the sway changing after a branch is fixed never starts a second branch, reign, fall or stand', () => {
    // Every reply the sway turns to another order (the leader flips from reply to reply), through all the date windows.
    const orders = [[40, 35, 25], [25, 40, 35], [35, 25, 40], [40, 25, 35], [25, 35, 40], [35, 40, 25]];
    for (const step of [6 * 60, DAY, 7 * DAY]) {
        const { fired, chronicle } = walk({ step, sway: minutes => orders[Math.floor(minutes / step) % orders.length] });
        assert.equal(new Set(fired).size, fired.length, 'each event fires once');
        assert.equal(variants(fired, 'marrowbridge-').length, 1, `step ${step}: one Marrowbridge branch`);
        assert.ok(variants(fired, 'crown-').length <= 1, `step ${step}: at most one crown`);
        const reigns = ['Reign of Empress Wendhild', 'Reign of Emperor Corvin', 'Reign of Emperor Hasse'].filter(name => chronicle.has(name));
        assert.ok(reigns.length <= 1, `step ${step}: ${reigns.join(', ')}`);
        assert.ok(fired.filter(id => /^auvoth-falls(-early)?$/.test(id)).length <= 1 && variants(fired, 'last-wall-').length <= 1);
    }
    // A chat already on the Corvin-Hasse war (Wendhild broken) keeps it whatever the sway says now: the other two branches' guards read its name
    // (this branch itself is stopped by its own claim, which a chat that fired it holds).
    const chronicle = new Map([["Highmark's war: Corvin against Hasse", { since: 0, state: 'ongoing', touched: 0 }]]);
    const fires = (id, sway) => evaluateCondition(events.find(event => event.id === id).when, view({ minutes: 318200000, place: { name: 'x', region: 'y' }, chronicle, sway })).met;
    for (const sway of [[40, 35, 25], [25, 40, 35], [35, 25, 40]]) for (const id of ['marrowbridge-hasse', 'marrowbridge-corvin']) assert.equal(fires(id, sway), false, `${id} ${sway}`);
});

// A small Director on the real host: quests change Hasse's sway, world entries behave like lasting
// chronicle entries, and fights are read from receipts, so the replay tests exercise the actual bus and store.
let swayShift = [0, 0, 0];     // what the scoring now adds to each power (a Director update): the test sets it after the decisions
function directorForDecisions() {
    return {
        id: 'test-director', name: 'Test director', version: '1.0.0',
        domains: {
            director: { initial: () => ({ time: { minutes: 0 }, deed: 'none' }), validate: () => [] },
            chronicle: { initial: () => ({ entries: {} }), validate: () => [] },
        },
        commands: {
            'test.time'(ctx, { minutes }) { ctx.draft('director').time.minutes = minutes; return { summary: 'Time.' }; },
            'test.fight'() { return { summary: 'A fight was won.' }; },
            'chronicle.lasting'(ctx, payload) {
                const entries = ctx.draft('chronicle').entries;
                entries[payload.name] = { ...payload, since: entries[payload.name]?.since ?? ctx.read('director').time.minutes };
                return { summary: payload.name };
            },
            'test.reign'(ctx, { name }) { ctx.draft('chronicle').entries[name] = { name, since: 0 }; return { summary: name }; },
        },
        queries: {
            'chronicle.passed': (state, { name, minutes }) => {
                const entry = state.domains.chronicle.entries[name];
                return !!entry && state.domains.director.time.minutes >= entry.since + minutes;
            },
            'ripples.sway': (state, _args, tools) => {
                const helped = state.domains.director.deed === 'hasse' || tools.receipts().some(entry => entry.receipt.type === 'test.fight');
                return rowsOf((helped ? [40, 35, 55] : [40, 35, 25]).map((value, at) => value + swayShift[at]));
            },
        },
        capture: { kinds: { deed: { grammar: '! deed Name' } }, apply(ctx, line) {
            ctx.draft('director').deed = line.name;
            return { summary: `Helped ${line.name}.` };
        } },
    };
}

async function decisionHost(t, { deed = 'none', swipes = false, fightAfterWar = false } = {}) {
    const { createHost } = await import('../../../testkit/index.js');
    const host = await createHost({ modules: [directorForDecisions()] });
    t.after(() => host.close());
    const alternatives = events.filter(event => event.decision).map(({ after, ...event }) => event);
    const mini = { id: 'ersveil', version: '1.0.0', requires: { storyBlock: '^2.31.0' }, ripples: pack.ripples, content: { events: alternatives } };
    const installed = await host.packs.packs.install(mini);
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    const story = name => `A deed.\n\n<Changes>\n! deed ${name}\n</Changes>`;
    await host.send('Begin.', story(deed));
    const earlier = host.ctx.chat.length - 1;
    if (swipes) await host.swipe(story('none'));
    await host.send('Later.', 'At Marrowbridge.');
    const warCarrier = host.ctx.chat.length - 1;
    assert.equal((await host.bus.command('test.time', { minutes: 318100000 }, { cause: 'ui' })).ok, true);
    const war = await host.bus.command('events.fire', { id: 'pack.ersveil/marrowbridge-hasse' }, { cause: 'system' });
    assert.equal(war.ok, true, war.message);
    if (fightAfterWar) assert.equal((await host.bus.command('test.fight', {}, { cause: 'system' })).ok, true);
    await host.send('Later still.', 'The Diet meets.');
    assert.equal((await host.bus.command('test.time', { minutes: 318400000 }, { cause: 'ui' })).ok, true);
    const crown = await host.bus.command('events.fire', { id: 'pack.ersveil/crown-wendhild-over-corvin' }, { cause: 'system' });
    assert.equal(crown.ok, true, crown.message);
    return { host, earlier, warCarrier, story };
}

function chosen(host) {
    const entries = host.head().domains.chronicle.entries;
    return {
        wars: Object.keys(entries).filter(name => name.startsWith("Highmark's war: ")),
        reigns: Object.keys(entries).filter(name => name.startsWith('Reign of ')),
        decisions: host.store.receipts().filter(entry => entry.receipt.type === 'events.fire').map(entry => entry.receipt.data.event),
    };
}

test('a Re-read replaces both later decisions from the changed deed and reloads identically', async t => {
    const { host, earlier, story } = await decisionHost(t);
    assert.deepEqual(chosen(host).reigns, ['Reign of Empress Wendhild']);
    host.ctx.chat[earlier].mes = story('hasse');
    host.ctx.chat[earlier].swipes[0] = story('hasse');
    const done = await host.turn.reread(earlier);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(chosen(host).wars, ["Highmark's war: Wendhild against Hasse"]);
    assert.deepEqual(chosen(host).reigns, ['Reign of Emperor Hasse']);
    assert.deepEqual(chosen(host).decisions, ['pack.ersveil/marrowbridge-corvin', 'pack.ersveil/crown-hasse-over-wendhild']);
    const before = JSON.stringify(host.head());
    await host.st.loadChat(structuredClone(host.ctx.chat));
    assert.equal(JSON.stringify(host.head()), before);
});

test('deleting or swiping an earlier deed reselects the surviving war and crown', async t => {
    const removed = await decisionHost(t, { deed: 'hasse' });
    assert.deepEqual(chosen(removed.host).reigns, ['Reign of Emperor Hasse']);
    await removed.host.st.deleteMessage(removed.earlier);
    assert.deepEqual(chosen(removed.host).reigns, ['Reign of Empress Wendhild']);
    assert.deepEqual(chosen(removed.host).wars, ["Highmark's war: Wendhild against Corvin"]);

    const swiped = await decisionHost(t, { deed: 'hasse', swipes: true });
    assert.deepEqual(chosen(swiped.host).reigns, ['Reign of Empress Wendhild']);
    await swiped.host.st.swipeTo(swiped.earlier, 0);
    assert.deepEqual(chosen(swiped.host).reigns, ['Reign of Emperor Hasse']);
    assert.deepEqual(chosen(swiped.host).wars, ["Highmark's war: Wendhild against Hasse"]);
});

test('a fight after a decision on the same carrier cannot influence that earlier decision on Re-read', async t => {
    const { host, earlier, story } = await decisionHost(t, { fightAfterWar: true });
    assert.deepEqual(chosen(host).wars, ["Highmark's war: Wendhild against Corvin"]);
    host.ctx.chat[earlier].mes = story('none');
    host.ctx.chat[earlier].swipes[0] = story('none');
    const done = await host.turn.reread(earlier);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(chosen(host).wars, ["Highmark's war: Wendhild against Corvin"]);
});

test('an existing 2.9.3 reign blocks every alternative crown even when sway changes', () => {
    const allCrowns = events.filter(event => event.decision === 'highmark-crown');
    for (const crown of allCrowns) for (const reign of ['Reign of Empress Wendhild', 'Reign of Emperor Corvin', 'Reign of Emperor Hasse']) {
        const chronicle = new Map([[reign, { since: 0 }], ["Highmark's war: Wendhild against Corvin", { since: 0 }], ["Highmark's war: Wendhild against Hasse", { since: 0 }], ["Highmark's war: Corvin against Hasse", { since: 0 }]]);
        const result = evaluateCondition(crown.when, view({ minutes: 318400000, chronicle, sway: [25, 35, 40] }));
        assert.equal(result.met, false, `${crown.id}: ${reign}`);
    }
});

test('a decision whose story did not change is kept when the scoring changes: swipe, delete, Re-read of a later reply', async t => {
    swayShift = [0, 0, 0];
    t.after(() => { swayShift = [0, 0, 0]; });
    const { host, earlier, story } = await decisionHost(t);
    await host.send('Later on.', 'Months pass.');
    const crowned = ['Reign of Empress Wendhild'];
    assert.deepEqual(chosen(host).reigns, crowned);
    swayShift = [-30, 0, 0];       // now Corvin would be picked
    await host.swipe('Months pass, again.');
    assert.deepEqual(chosen(host).reigns, crowned, 'swipe of the last reply');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.deepEqual(chosen(host).reigns, crowned, 'delete of the last reply');
    assert.deepEqual(chosen(host).wars, ["Highmark's war: Wendhild against Corvin"]);
    await host.send('One more.', 'Winter.');
    const done = await host.turn.reread(host.ctx.chat.length - 1);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(chosen(host).reigns, crowned, 'Re-read of a reply after the crown');
    const before = JSON.stringify(host.head());
    await host.st.loadChat(structuredClone(host.ctx.chat));
    assert.equal(JSON.stringify(host.head()), before);
    // the earlier deed changed: the war and the crown are picked again
    host.ctx.chat[earlier].mes = story('hasse');
    host.ctx.chat[earlier].swipes[0] = story('hasse');
    const again = await host.turn.reread(earlier);
    assert.equal(again.ok, true, again.message);
    assert.deepEqual(chosen(host).reigns, ['Reign of Emperor Hasse']);
});

// ---- 2.9.6: the flood news is one event (region(...)), so moving between the regions that hear it never repeats it ----
const NEWS_REGIONS = ['Highmark Empire', 'Valegard', 'River Confederacy: core cities', 'River Confederacy: locks/connectors', 'Wallwright League', 'Kingdom of Ashmere',
    'Aurelion/Church Heartland', 'Silver Mark', 'Startrace Tower', 'Ironanvil'];

test('2.9.6: one flood-news event covers both old region groups and the split event is gone', () => {
    const news = events.filter(event => event.id.startsWith('flood-611-news'));
    assert.deepEqual(news.map(event => event.id), ['flood-611-news']);
    assert.equal(news[0].after, 'flood-611');
    assert.match(news[0].when, /region\('Highmark Empire', 'Valegard'/);
    assert.ok(!/region ==/.test(news[0].when), 'no region chain is left');
    const at = (region, minutes = 316974720 + 9000) => evaluateCondition(news[0].when, view({ minutes, place: { name: 'x', region }, chronicle: new Map([['The early flood', { since: 316974720 }]]) })).met;
    for (const region of NEWS_REGIONS) assert.equal(at(region), true, region);
    for (const region of ['River Confederacy: Bluewatch', 'Shornmarch', 'Auvoth Compact', 'Ardelian Empire and Southmarch', '']) assert.equal(at(region), false, region);
    assert.equal(at('Valegard', 316974720 + 100), false, 'not before the news has had its days to travel');
    assert.equal(pack.version, '2.9.6');
});

test('2.9.6: moving between the two old region groups tells the flood news once', () => {
    const regions = ['Valegard', 'Silver Mark', 'Highmark Empire', 'Ironanvil', 'Startrace Tower'];
    const fired = [];
    const done = new Set(['flood-611']);
    const chronicle = new Map([['The early flood', { since: 316974720 }]]);
    const news = events.filter(event => event.id.startsWith('flood-611-news'));
    for (let reply = 0; reply < regions.length; reply += 1) {
        const env = view({ minutes: 316974720 + 9000 + reply * 360, place: { name: 'x', region: regions[reply] }, chronicle });
        for (const event of news) if (!done.has(event.id) && evaluateCondition(event.when, env).met) { done.add(event.id); fired.push(event.id); }
    }
    assert.deepEqual(fired, ['flood-611-news'], 'one bulletin, however the player moves between the groups');
});

test('2.9.6: a chat that already heard the news keeps its record, and written replies replay as they were', async t => {
    const { createHost } = await import('../../../testkit/index.js');
    const host = await createHost({});
    t.after(() => host.close());
    const mini = { id: 'ersveil', version: '2.9.6', requires: { storyBlock: '^2.31.0' }, content: { events: events.filter(event => event.id === 'flood-611-news').map(({ after, when, ...event }) => ({ ...event, when: "query('scene.place') != null && region('Valegard', 'Silver Mark')" })) } };
    const installed = await host.packs.packs.install(mini);
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    await host.send('Begin.', '<Changes>\n~ place Valegard Keep | kind: town | region: Valegard\n</Changes>');
    const before = JSON.stringify(host.ctx.chat.map(message => message.mes));
    const first = await host.bus.command('events.fire', { id: 'pack.ersveil/flood-611-news' }, { cause: 'system' });
    assert.equal(first.ok, true, first.message);
    const again = await host.bus.command('events.fire', { id: 'pack.ersveil/flood-611-news' }, { cause: 'system' });
    assert.equal(again.ok, false, 'the record stands: it is not told twice');
    assert.equal(JSON.stringify(host.ctx.chat.map(message => message.mes)), before, 'written replies are untouched');
});

// The old two-event list (2.9.5): the first group's event and the second group's own event, as the merged one was made from.
test('2.9.6: a chat that fired only the old second-group news: swap to the merged event, rebuild equals the head, Re-read is byte-identical, the claim stands', async t => {
    const { createHost } = await import('../../../testkit/index.js');
    const host = await createHost({});
    t.after(() => host.close());
    const [group1, group2] = [NEWS_REGIONS.slice(0, 6), NEWS_REGIONS.slice(6)];
    const { after, when, ...base } = events.find(event => event.id === 'flood-611-news');   // (the chronicle wait is left out: the mini-pack has no flood-611)
    const eventFor = (id, names) => ({ ...base, id, when: `query('scene.place') != null && region(${names.map(name => `'${name}'`).join(', ')})` });
    const oldPack = { id: 'ersveil', version: '2.9.5', requires: { storyBlock: '^2.31.1' }, content: { events: [eventFor('flood-611-news', group1), eventFor('flood-611-news-2', group2)] } };
    const first = await host.packs.packs.install(oldPack);
    assert.equal(first.ok, true, JSON.stringify(first.errors));
    await host.send('Begin.', '<Changes>\n~ place Silver Keep | kind: town | region: Silver Mark\n</Changes>');
    const fired = await host.bus.command('events.fire', { id: 'pack.ersveil/flood-611-news-2' }, { cause: 'system' });
    assert.equal(fired.ok, true, fired.message);
    await host.send('Onward.', 'The road goes on.');
    const at = host.ctx.chat.findIndex(message => message.extra?.storySuite?.receipts?.some(receipt => receipt.type === 'events.fire'));   // the reply that holds the fire
    assert.ok(at > 0, 'the fire is in a reply');
    // 2.9.6 replaces both with the merged event (the second group's event is gone from the list).
    const merged = await host.packs.packs.install({ id: 'ersveil', version: '2.9.6', requires: { storyBlock: '^2.31.1' }, content: { events: [eventFor('flood-611-news', NEWS_REGIONS)] } });
    assert.equal(merged.ok, true, JSON.stringify(merged.errors));
    const head = JSON.stringify(host.head()), chat = JSON.stringify(host.ctx.chat);
    assert.match(head, /event:pack\.ersveil\/flood-611-news-2/, 'the claim of the old second-group event is in the head');
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), head, 'rebuild equals the head');
    const done = await host.turn.reread(at);
    assert.equal(done.ok, true, done.message);
    assert.equal(JSON.stringify(host.head()), head, 'Re-read leaves the record byte-identical');
    assert.equal(JSON.stringify(host.ctx.chat), chat, 'Re-read leaves the chat byte-identical');
    await host.st.loadChat(structuredClone(host.ctx.chat));
    assert.equal(JSON.stringify(host.head()), head, 'reload equals the head');
    assert.match(JSON.stringify(host.head()), /event:pack\.ersveil\/flood-611-news-2/, 'the claim stands');
});
