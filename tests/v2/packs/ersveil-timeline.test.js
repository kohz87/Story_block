// Ersveil 2.2.0's hidden timeline (examples/packs/ersveil/pack.json): the big-beat events from CY 611 on and the Sealwarden recruit skill set. The events are checked as data
// (every condition reads, every "after" and every delay names something that exists, every lasting change fits Story
// Director's limits), and the story clock is walked from the start to CY 617 with a stand-in chronicle that prunes
// resolved entries like Story Director (30 kept), so the beats come in order, once each, Wendhild takes the throne,
// and a decision once made stays made (review 169).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateCondition, parse } from '../../../src/v2/events/condition.js';

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
// The view a condition reads: the clock, the place and the stand-in chronicle.
function view({ minutes, place, chronicle = new Map() }) {
    return {
        state: { domains: { director: { time: { minutes } } } },
        query(name, args) {
            if (name === 'scene.place') return place;
            if (name === 'chronicle.passed') return chronicle.has(args.name) && minutes >= chronicle.get(args.name).since + args.minutes;
            return null;
        },
    };
}

test('the timeline is data Story Block and Story Director accept: conditions read, links resolve, lasting changes fit', () => {
    assert.equal(events.length, 106);
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

test('the pack has no Court favour module and no event reads one', () => {
    assert.equal(pack.content.dataModules.some(definition => definition.slug === 'succession'), false);
    assert.equal(JSON.stringify(pack.content).includes('pack.ersveil/succession'), false);
    assert.equal(JSON.stringify(pack.content).includes('dataModules.view'), false, 'no event reads a data module');
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
function walk({ place = { name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch' }, step = 6 * 60, extra = () => [], until = T(617, 1, 1) } = {}) {
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
        const env = view({ minutes, place, chronicle });
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
