// Ersveil 2.2.0's hidden timeline (examples/packs/ersveil/pack.json): the big-beat events from CY 611 on, the Court
// favour module that decides Highmark's throne, and the Sealwarden recruit skill set. The events are checked as data
// (every condition reads, every "after" and every delay names something that exists, every lasting change fits Story
// Director's limits), and the story clock is walked from the start to CY 617 with a stand-in chronicle, so the beats come
// in order, once each, and the throne follows the favour.
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
const delays = event => [...event.when.matchAll(/chronicle\.passed', \{ name: "([^"]*)"/g)].map(match => match[1]);

// The view a condition reads: the clock, the place, the stand-in chronicle and the Court favour (null: not enabled).
function view({ minutes, place, chronicle = new Map(), favour = null }) {
    return {
        state: { domains: { director: { time: { minutes } } } },
        query(name, args) {
            if (name === 'scene.place') return place;
            if (name === 'chronicle.passed') return chronicle.has(args.name) && minutes >= chronicle.get(args.name) + args.minutes;
            if (name === 'dataModules.view') return args?.module === 'pack.ersveil/succession' && favour ? { chat: { ...favour } } : null;
            return null;
        },
    };
}

test('the timeline is data Story Block and Story Director accept: conditions read, links resolve, lasting changes fit', () => {
    assert.equal(events.length, 141);
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
            assert.ok(keep === undefined || keep === true, event.id);
        }
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

test('Marrowbridge breaks exactly one claimant for any favour, and the throne goes to exactly one of the other two', () => {
    const variants = prefix => beats.filter(event => event.id.startsWith(prefix) && !event.id.endsWith('-scene') && !event.id.includes('-news'));
    const marrow = variants('marrowbridge-');
    const crowns = variants('crown-').filter(event => event.after);
    assert.equal(marrow.length, 3);
    assert.equal(crowns.length, 6);
    const minutes = T(614, 2, 1, 12);
    const values = [0, 25, 35, 40, 41, 100];
    const cases = [null];
    for (const wendhild of values) for (const corvin of values) for (const hasse of values) cases.push({ wendhild, corvin, hasse });
    for (const favour of cases) {
        const env = view({ minutes, place: null, favour });
        const broken = marrow.filter(event => evaluateCondition(event.when, env).met);
        assert.equal(broken.length, 1, `${JSON.stringify(favour)}: ${broken.map(event => event.id)}`);
        const crowned = crowns.filter(event => event.after === broken[0].id && evaluateCondition(event.when, env).met);
        assert.equal(crowned.length, 1, `${JSON.stringify(favour)} after ${broken[0].id}: ${crowned.map(event => event.id)}`);
        const loser = broken[0].id.replace('marrowbridge-', '');
        assert.ok(!crowned[0].id.startsWith(`crown-${loser}-`), 'the broken claimant is never crowned');
    }
    // No module (or its defaults, 40/35/25): Corvin falls at Marrowbridge and Wendhild is crowned.
    for (const favour of [null, { wendhild: 40, hasse: 35, corvin: 25 }]) {
        const env = view({ minutes, place: null, favour });
        assert.equal(marrow.find(event => evaluateCondition(event.when, env).met).id, 'marrowbridge-corvin');
        assert.equal(crowns.find(event => event.after === 'marrowbridge-corvin' && evaluateCondition(event.when, env).met).id, 'crown-wendhild-over-hasse');
    }
    const module = pack.content.dataModules.find(definition => definition.slug === 'succession');
    assert.deepEqual(Object.fromEntries(Object.entries(module.state).map(([key, field]) => [key, field.default])), { wendhild: 40, hasse: 35, corvin: 25 });
    assert.equal(module.screens, undefined, 'no screen: the favour is the narrator\'s to keep');
});

// Walk the clock from the start to CY 617 at Bluewatch, one reply every six story hours, firing what is due like the
// engine does (an event fires once; an "after" link moves at most one step a reply) and keeping the chronicle's
// "since" stamps. Answers the ids fired, in order.
function walk(favour, place = { name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch' }) {
    const chronicle = new Map();
    const fired = [];
    const done = new Set();
    for (let minutes = START; minutes < T(617, 1, 1); minutes += 6 * 60) {
        const before = new Set(done);
        const env = view({ minutes, place, chronicle, favour });
        for (const event of beats) {
            if (done.has(event.id) || (event.after && !before.has(event.after))) continue;
            const result = evaluateCondition(event.when, env);
            assert.equal(result.error, undefined, `${event.id}: ${JSON.stringify(result.error)}`);
            if (!result.met) continue;
            done.add(event.id); fired.push(event.id);
            for (const payload of lastingOf(event)) if (!chronicle.has(payload.name)) chronicle.set(payload.name, minutes);
        }
    }
    return { fired, chronicle };
}

const order = (fired, ids) => {
    for (const id of ids) assert.ok(fired.includes(id), `${id} fired`);
    assert.deepEqual(ids.map(id => fired.indexOf(id)), ids.map(id => fired.indexOf(id)).toSorted((a, b) => a - b), `in order: ${ids.join(' → ')}`);
};

test('with no favour recorded, the default history plays out in order: Corvin falls, Wendhild is crowned, Auvoth is lost, the Wall holds', () => {
    const { fired, chronicle } = walk(null);
    order(fired, ['flood-611', 'flood-611-scene', 'depths-611', 'who-pays-611', 'turning-611-harsh', 'ledger-611', 'sealwardens-612',
        'emperor-612', 'ardelia-612', 'inquest-612', 'turning-612', 'cinder-613', 'succession-613', 'marrowbridge-corvin', 'turning-613',
        'tide-613', 'chain-613', 'crown-wendhild-over-hasse', 'wendhild-north-614', 'troops-auvoth-614', 'auvoth-falls',
        'auvoth-evacuation-scene', 'last-wall-wendhild', 'last-wall-scene', 'after-wall-616']);
    for (const absent of ['marrowbridge-hasse', 'marrowbridge-wendhild', 'auvoth-falls-early', 'corvin-south-614', 'hasse-archive-614', 'last-wall-corvin', 'last-wall-hasse'])
        assert.ok(!fired.includes(absent), absent);
    assert.equal(new Set(fired).size, fired.length, 'each event fires once');
    assert.ok(chronicle.get('The early flood') >= T(611, 6, 12, 8) && chronicle.get('The early flood') < T(611, 6, 13), 'the early flood comes a month in');
    assert.ok(chronicle.get('The Last Wall holds') >= T(615, 9, 21, 4) && chronicle.get('The Last Wall holds') < T(615, 9, 22));
});

test('the favour changes the history: Corvin crowned loses Auvoth early; Hasse crowned threatens the Iron Archive', () => {
    const corvin = walk({ wendhild: 10, hasse: 30, corvin: 60 }).fired;
    order(corvin, ['marrowbridge-wendhild', 'crown-corvin-over-hasse', 'corvin-south-614', 'auvoth-falls-early', 'last-wall-corvin']);
    assert.ok(!corvin.includes('auvoth-falls'), 'Auvoth is lost once');
    const hasse = walk({ wendhild: 50, hasse: 60, corvin: 20 }).fired;
    order(hasse, ['marrowbridge-corvin', 'crown-hasse-over-wendhild', 'hasse-archive-614', 'auvoth-falls', 'last-wall-hasse']);
});

test('away from the north the player hears of the beats as news, later, and sees no northern scenes', () => {
    const { fired } = walk(null, { name: 'Osterhal', region: 'Ardelian Empire and Southmarch' });
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
