// Ersveil 2.2.0's hidden timeline (examples/packs/ersveil/pack.json): the big-beat events from CY 611 on, the Court
// favour module that decides Highmark's throne, and the Sealwarden recruit skill set. The events are checked as data
// (every condition reads, every "after" and every delay names something that exists, every lasting change fits Story
// Director's limits), and the story clock is walked from the start to CY 617 with a stand-in chronicle that prunes
// resolved entries like Story Director (30 kept), so the beats come in order, once each, the throne follows the favour,
// and a decision once made stays made (review 169).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateCondition, parse } from '../../../src/v2/events/condition.js';
import { createHost, hostAvailable } from '../../../testkit/index.js';

const available = await hostAvailable();
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
const MODULE = 'pack.ersveil/succession';

// The Court favour fields the module's rules keep, worked out the same way (a least tie breaks against the later name in
// Wendhild, Corvin, Hasse; a pair tie goes to the earlier).
function court({ wendhild, corvin, hasse }) {
    const least = hasse <= wendhild && hasse <= corvin ? 'hasse' : corvin < hasse && corvin <= wendhild ? 'corvin' : 'wendhild';
    return { wendhild, corvin, hasse, least, wc: corvin > wendhild ? 'corvin' : 'wendhild', wh: hasse > wendhild ? 'hasse' : 'wendhild', ch: hasse > corvin ? 'hasse' : 'corvin' };
}

// The view a condition reads: the clock, the place, the stand-in chronicle and the Court favour (null: not enabled).
function view({ minutes, place, chronicle = new Map(), favour = null }) {
    return {
        state: { domains: { director: { time: { minutes } } } },
        query(name, args) {
            if (name === 'scene.place') return place;
            if (name === 'chronicle.passed') return chronicle.has(args.name) && minutes >= chronicle.get(args.name).since + args.minutes;
            if (name === 'dataModules.view') return args?.module === MODULE && favour ? { chat: court(favour) } : null;
            return null;
        },
    };
}

test('the timeline is data Story Block and Story Director accept: conditions read, links resolve, lasting changes fit', () => {
    assert.equal(events.length, 136);
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
    for (const event of beats) for (const match of event.when.matchAll(/chronicle\.passed', \{ name: "([^"]*)", minutes: (\d+)/g)) {
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

test('the Court favour module starts as approved (Wendhild 40, Corvin 35, Hasse 25) and keeps its result fields by rules', () => {
    const module = pack.content.dataModules.find(definition => definition.slug === 'succession');
    const defaults = Object.fromEntries(Object.entries(module.state).map(([key, field]) => [key, field.default]));
    assert.deepEqual(defaults, { wendhild: 40, corvin: 35, hasse: 25, ...court({ wendhild: 40, corvin: 35, hasse: 25 }) }, 'the result fields start as the rules would set them');
    assert.equal(module.screens, undefined, 'no screen: the favour is the narrator\'s to keep');
    for (const field of ['least', 'wc', 'wh', 'ch']) assert.equal(module.state[field].edit, false, `${field} is never edited by hand`);
    for (const kind of Object.values(module.kinds)) assert.ok(JSON.stringify(kind.effects).includes('"claimant"'), 'the story writes only the claimants');
});

// Walk the clock at Bluewatch (or `place`), one reply every `step` story minutes, firing what is due like the engine does
// (an event fires once; an "after" link moves at most one step a reply), keeping the chronicle's "since" stamps and its
// states, pruning the oldest resolved entries past 30 like Story Director. `favourAt(minutes)` is the favour then (null:
// the module is off); `extra(minutes)` may add resolved entries of the story's own. Answers the ids fired, in order.
function walk({ favourAt = () => null, place = { name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch' }, step = 6 * 60, extra = () => [], until = T(617, 1, 1) } = {}) {
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
        const env = view({ minutes, place, chronicle, favour: favourAt(minutes) });
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

test('with no favour recorded (or the defaults), Hasse is broken at Marrowbridge, Wendhild is crowned over Corvin, Auvoth is lost, the Wall holds', () => {
    for (const favourAt of [() => null, () => ({ wendhild: 40, corvin: 35, hasse: 25 })]) {
        const { fired } = walk({ favourAt });
        order(fired, ['flood-611', 'flood-611-scene', 'depths-611', 'who-pays-611', 'turning-611-harsh', 'ledger-611', 'sealwardens-612',
            'emperor-612', 'ardelia-612', 'inquest-612', 'turning-612', 'cinder-613', 'succession-613', 'marrowbridge-hasse', 'turning-613',
            'tide-613', 'chain-613', 'crown-wendhild-over-corvin', 'crown-wendhild-news', 'wendhild-north-614', 'troops-auvoth-614', 'auvoth-falls',
            'auvoth-evacuation-scene', 'last-wall-wendhild', 'last-wall-scene', 'after-wall-616']);
        assert.deepEqual(variants(fired, 'marrowbridge-'), ['marrowbridge-hasse']);
        assert.deepEqual(variants(fired, 'crown-'), ['crown-wendhild-over-corvin']);
        for (const absent of ['auvoth-falls-early', 'corvin-south-614', 'hasse-archive-614', 'last-wall-corvin', 'last-wall-hasse']) assert.ok(!fired.includes(absent), absent);
        assert.equal(new Set(fired).size, fired.length, 'each event fires once');
    }
});

test('the favour changes the history: Corvin crowned loses Auvoth early; Hasse crowned threatens the Iron Archive', () => {
    const corvin = walk({ favourAt: () => ({ wendhild: 10, corvin: 60, hasse: 30 }) }).fired;
    order(corvin, ['marrowbridge-wendhild', 'crown-corvin-over-hasse', 'corvin-south-614', 'auvoth-falls-early', 'last-wall-corvin']);
    assert.ok(!corvin.includes('auvoth-falls'), 'Auvoth is lost once');
    const hasse = walk({ favourAt: () => ({ wendhild: 50, corvin: 20, hasse: 60 }) }).fired;
    order(hasse, ['marrowbridge-corvin', 'crown-hasse-over-wendhild', 'hasse-archive-614', 'auvoth-falls', 'last-wall-hasse']);
});

test('review 169 B2: favour that changes after Marrowbridge or the crowning never decides them a second time', () => {
    const MB = T(613, 6, 20, 12), CR = T(614, 2, 1, 12);
    // Hasse is broken at the defaults; afterwards the story undermines him again and backs Corvin past Wendhild.
    const favourAt = minutes => (minutes < MB ? { wendhild: 40, corvin: 35, hasse: 25 } : minutes < CR ? { wendhild: 40, corvin: 35, hasse: 5 } : { wendhild: 40, corvin: 70, hasse: 90 });
    const { fired } = walk({ favourAt });
    assert.deepEqual(variants(fired, 'marrowbridge-'), ['marrowbridge-hasse']);
    assert.equal(variants(fired, 'crown-').length, 1, variants(fired, 'crown-').join(', '));
    // Crowned at the crown date with Corvin ahead: Corvin; a later swing to Wendhild crowns no one else.
    const swing = minutes => (minutes < T(614, 2, 2) ? { wendhild: 40, corvin: 60, hasse: 20 } : { wendhild: 99, corvin: 0, hasse: 0 });
    const crowned = walk({ favourAt: swing }).fired;
    assert.deepEqual(variants(crowned, 'crown-'), ['crown-corvin-over-wendhild']);
    assert.ok(crowned.includes('auvoth-falls-early') && !crowned.includes('auvoth-falls'));
});

test('review 169 B3: the story\'s own resolved entries pruning the chronicle never stop the Wall or let Auvoth fall twice', () => {
    // Two resolved world events a month from the crowning on: far past the 30 the chronicle keeps.
    const extra = minutes => (minutes > T(614, 2, 1) && minutes % (15 * DAY) < 6 * 60 ? [`Regional crisis ${minutes}`] : []);
    const plain = walk({ extra }).fired;
    order(plain, ['crown-wendhild-over-corvin', 'auvoth-falls', 'last-wall-wendhild', 'after-wall-616']);
    const early = walk({ extra, favourAt: () => ({ wendhild: 4, corvin: 43, hasse: 35 }) }).fired;
    assert.ok(early.includes('auvoth-falls-early') && !early.includes('auvoth-falls'), 'Auvoth falls once');
    assert.ok(early.includes('last-wall-corvin'));
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

test('the Court favour module, pinned in a real host: story lines move the claimants and its rules keep the result fields', { skip: available.ok ? false : available.reason }, async t => {
    const host = await createHost({ modules: [{ id: 'chronicle-stand-in', version: '1.0.0', capabilities: ['chronicle-lasting'] }] });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(pack)).ok, true);
    await host.send('Begin.', 'The story begins.');
    const offer = host.sdk.query('dataModules.offers').find(row => row.module === MODULE);
    assert.equal((await host.sdk.command('dm.pin', { module: MODULE, hash: offer.hash, packHash: offer.packHash, subjects: [] })).ok, true);
    const now = () => host.sdk.query('dataModules.view', { module: MODULE }).chat;
    assert.deepEqual(now(), court({ wendhild: 40, corvin: 35, hasse: 25 }));
    const line = (op, kind, who) => `The story.\n<Changes>\n${op} dm succession — our deeds | kind: ${kind} | claimant: ${who} | size: great\n</Changes>`;
    await host.send('We help Hasse.', line('+', 'back', 'hasse'));
    await host.send('We shame Wendhild.', line('-', 'undermine', 'wendhild'));
    const after = now();
    assert.deepEqual(after, court({ wendhild: after.wendhild, corvin: after.corvin, hasse: after.hasse }), 'the result fields follow the claimants');
    assert.ok(after.hasse > 25 && after.wendhild < 40);
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
