// The Assist safety net knows where and when the scene is (stage 40): the current place, the map's names near it (capped) and the
// story's date and time go into its prompt; its lines that give a known place an invented name, or set a time without a clock time,
// are refused with a Problems line on the reply and never applied. Pure checks first, then the extractor, then the real host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChanges } from '../../../src/v2/capture.js';
import { EXTRACTOR_FOOT, MAX_NEAR, SETTING, WHERE_HEAD, WORLD_FOOT, footFor, createAssistPart, extractorPrompt, hasClockTime, knownPlace, mapPlaces, parseExtractorAnswer, whereLines, whereNow, whereWhy } from '../../../src/v2/assist/index.js';
import { assistPlaceConflict, worldKnown } from '../../../src/v2/assist/where.js';
import { refusedFrom } from '../../../src/v2/reply-notes.js';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { fakeModel, on } from './helpers/fakes.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const one = raw => parseChanges(raw).lines[0];

const MAP = [
    { name: 'Bluewatch Village / Guild Office', aliases: ['Guild Office', 'Bluewatch Guild Office'], region: 'River Confederacy: Bluewatch', x: 64, y: 110 },
    { name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch', x: 62, y: 108 },
    { name: 'Auvoth', region: 'Auvoth Reach', x: 200, y: 300 },
    { name: 'East Ridge', region: 'River Confederacy: Bluewatch', x: 90, y: 100 },
];

test('map places are read without repeats; a name is known by its whole name, either side of "A / B", or an alias', () => {
    const places = mapPlaces(MAP, [{ name: 'bluewatch village' }, { name: '  ' }, null, { name: "Hollin's Reach", aliases: ['Hollins'] }], 'not a list');
    assert.deepEqual(places.map(place => place.name), ['Bluewatch Village / Guild Office', 'Bluewatch Village', 'Auvoth', 'East Ridge', "Hollin's Reach"]);
    assert.equal(knownPlace(places, 'Guild Office').name, 'Bluewatch Village / Guild Office');
    assert.equal(knownPlace(places, 'bluewatch guild office').name, 'Bluewatch Village / Guild Office');
    assert.equal(knownPlace(places, 'Bluewatch Village').name, 'Bluewatch Village', 'a whole name first');
    assert.equal(knownPlace(places, 'Guild Office').name, 'Bluewatch Village / Guild Office');
    assert.equal(knownPlace(mapPlaces([{ name: 'Mill Town / The Quay' }]), 'the quay').name, 'Mill Town / The Quay', 'a side of "A / B"');
    assert.equal(knownPlace(places, 'Hollins Reach').name, "Hollin's Reach", 'apostrophes ignored');
    assert.equal(knownPlace(places, 'Bluewatch Guild Branch'), null);
});

test('where now: the place, the nearest known names first (by the map\'s coordinates, else the region), capped, never the place itself; the date and time', () => {
    const places = mapPlaces(MAP);
    const around = whereNow({ here: { name: 'Bluewatch Village', kind: 'settlement', region: 'River Confederacy: Bluewatch' }, places, time: 'Goldwane 12, 611, 06:40 am' });
    assert.deepEqual(around.near, ['Bluewatch Village / Guild Office', 'East Ridge', 'Auvoth'], 'nearest first: the Guild Office is next door, then the ridge, then Auvoth');
    assert.ok(!around.near.includes('Bluewatch Village'), 'not the place itself');
    assert.deepEqual(whereLines(around), [
        'Story date and time now: Goldwane 12, 611, 06:40 am',
        'Place now: Bluewatch Village (settlement, River Confederacy: Bluewatch)',
        `Known places near it (use these exact names): ${around.near.join('; ')}`,
    ]);
    // Without coordinates the places in its region come first.
    const flat = mapPlaces([{ name: 'Far Town', region: 'Elsewhere' }, { name: 'Near Town', region: 'Here' }, { name: 'Here Town', region: 'Here' }]);
    assert.deepEqual(whereNow({ here: { name: 'Here Town', region: 'Here' }, places: flat }).near, ['Near Town', 'Far Town']);
    // The list is capped, and each name is cut.
    const many = mapPlaces(Array.from({ length: 80 }, (_, at) => ({ name: `Place ${at}`, x: at, y: 0 })));
    assert.equal(whereNow({ here: { name: 'Place 0' }, places: many }).near.length, MAX_NEAR);
    assert.deepEqual(whereNow({ here: { name: 'Place 0' }, places: many }, { cap: 3 }).near, ['Place 1', 'Place 2', 'Place 3']);
    assert.ok(whereNow({ here: { name: 'x'.repeat(500) }, places: [] }).here.name.length <= 80);
    // Nothing known: nothing told.
    assert.deepEqual(whereLines(whereNow({})), []);
    assert.deepEqual(whereLines(null), []);
});

test('a time line needs a clock time ("midday" and "mid-morning" are not times); a stretch moves the clock on and needs none', () => {
    for (const text of ['9:30 am', 'Goldwane 12, 9:30 am', '21:05', '9 pm', 'Goldwane 12, 09:30', 'noon', 'Goldwane 12, 9.30 am']) assert.equal(hasClockTime(text), true, text);
    for (const text of ['midday', 'mid-morning', 'Goldwane 12, mid-morning', 'evening', 'Goldwane 12', '12']) assert.equal(hasClockTime(text), false, text);
    for (const raw of ['~ time Goldwane 12, 9:30 am', '! time +2h', '! time 30 minutes', '! time an hour', '~ time 9 pm', '~ time 21:05']) assert.equal(whereWhy(one(raw)), '', raw);
    for (const raw of ['~ time midday', '~ time Goldwane 12, mid-morning', '! time later that day', '~ time evening', '~ time Goldwane 12']) {
        assert.match(whereWhy(one(raw)), /has no clock time; write a time like/, raw);
    }
    // Other kinds are not its business.
    assert.equal(whereWhy(one('~ weather cold drizzle')), '');
    assert.equal(whereWhy(one('~ place Anywhere')), '', 'no map known: no place is judged');
});

test('a place line that names a place the map has by an invented name is refused with the name the map uses; a new place is not', () => {
    const check = { places: mapPlaces(MAP), here: 'Bluewatch Village' };
    const why = raw => whereWhy(one(raw), check);
    assert.match(why('~ place Bluewatch Guild Branch | kind: guild office'), /"Bluewatch Guild Branch" is not a place name on the map; the map calls this place "Bluewatch Village \/ Guild Office"/);
    assert.match(why('~ place Bluewatch'), /the map calls this place "Bluewatch Village"/);
    for (const raw of ['~ place Bluewatch Village / Guild Office', '~ place Guild Office', '~ place bluewatch guild office', '~ place Bluewatch Village', '~ place East Ridge | kind: wild']) assert.equal(why(raw), '', raw);
    // New places: no distinctive word of the name is the map's alone, or it has a word of its own.
    for (const raw of ['~ place Auvoth Docks', '~ place Old Mill Road', '~ place Nameless Hollow', '~ place Guild Hall']) assert.equal(why(raw), '', raw);
    // The scene's own place is always a known name, whatever the map says.
    assert.equal(whereWhy(one('~ place The Tin Cup'), { places: mapPlaces(MAP), here: 'The Tin Cup' }), '');
});

test('the extractor prompt: where and when come after the instruction and before the reply\'s lines; with nothing known the prompt is as before', () => {
    const grammar = ['~ place Name | kind: settlement', '~ time <date, clock time>'];
    const around = whereNow({ here: { name: 'Bluewatch Village', kind: 'settlement' }, places: mapPlaces(MAP), time: 'Goldwane 12, 611, 06:40 am' });
    const prompt = extractorPrompt('They walk on.', grammar, ['~ weather fog'], around);
    const at = text => prompt.indexOf(text);
    assert.ok(at(EXTRACTOR_FOOT) > 0 && at(WHERE_HEAD) > at(EXTRACTOR_FOOT) && at('The reply\'s own lines:') > at(WHERE_HEAD) && at('The reply:') > at('The reply\'s own lines:'));
    assert.match(prompt, /Story date and time now: Goldwane 12, 611, 06:40 am\nPlace now: Bluewatch Village \(settlement\)\nKnown places near it \(use these exact names\): /);
    assert.equal(extractorPrompt('They walk on.', grammar, [], null), extractorPrompt('They walk on.', grammar, []));
    assert.ok(!extractorPrompt('x', grammar).includes(WHERE_HEAD));
    // The instruction: use a known name, a clock time, and what is refused.
    assert.match(EXTRACTOR_FOOT, /exact name of a known place/);
    assert.match(EXTRACTOR_FOOT, /clock time/);
    assert.match(EXTRACTOR_FOOT, /"midday" and "mid-morning" are not times/);
    assert.match(EXTRACTOR_FOOT, /is refused/);
    assert.match(EXTRACTOR_FOOT, /only when the reply moves the scene/);
    assert.match(EXTRACTOR_FOOT, /where the reply ENDS.*never a stop on the way/);
    assert.match(EXTRACTOR_FOOT, /place it is at now, write no place line/);
    assert.match(EXTRACTOR_FOOT, /Presence is the scene at the END: \+ present only for someone there when the reply ends, never someone met at a stop on the way; - present for someone present before who is gone at the end/);
});

test('safety-net places are refused only on evidence: an arrival the reply explicitly locates elsewhere; siblings differ, parents and aliases agree', () => {
    const reply = parseChanges('+ present Dries | at: Bluewatch Village / Guild Office\n~ chatter Sieke: The desk is busy.').lines;
    assert.match(assistPlaceConflict(one('~ place Bluewatch Outskirts | with: Sister Temiwa'), reply), /places Dries at/);
    // The correct destination is accepted whether or not its companion list names the people already there.
    for (const raw of ['~ place Bluewatch Village / Guild Office | with: Sister Temiwa', '~ place Guild Office | with: Dries, Sieke', '~ place Guild Office', '~ place Bluewatch Village | with: Sister Temiwa']) assert.equal(assistPlaceConflict(one(raw), reply), '', raw);
    // A bare + present or chatter names no place: no refusal, whatever `with:` says.
    const bare = parseChanges('+ present Dries\n~ chatter Sieke: Hello.').lines;
    for (const raw of ['~ place Bluewatch Outskirts | with: Sister Temiwa', '~ place Guild Office | with: Sister Temiwa']) assert.equal(assistPlaceConflict(one(raw), bare), '', raw);
    assert.equal(assistPlaceConflict(one('~ weather rain'), reply), '');
    const gone = parseChanges('+ present Dries | at: Market\n- present Dries').lines;
    assert.equal(assistPlaceConflict(one('~ place Guild Office | with: Sister Temiwa'), gone), '');
    // Siblings under one parent are different destinations; the shared parent proves nothing.
    const market = parseChanges('+ present Dries | at: Bluewatch Village / Market').lines;
    assert.match(assistPlaceConflict(one('~ place Bluewatch Village / Guild Office'), market), /places Dries at/);
    assert.match(assistPlaceConflict(one('~ place Bluewatch Village / Guild Office'), parseChanges('+ present Dries | at: Bluewatch Village / Market').lines), /places Dries at/);
    assert.equal(assistPlaceConflict(one('~ place Bluewatch Village / Market'), market), '');
    // Aliases resolve through the map: "Bluewatch Guild Office" is the Guild Office; "Market" under the same village is not.
    const alias = parseChanges('+ present Dries | at: Bluewatch Guild Office').lines;
    assert.equal(assistPlaceConflict(one('~ place Bluewatch Village / Guild Office'), alias, MAP), '');
    assert.equal(assistPlaceConflict(one('~ place Guild Office'), alias, MAP), '');
    assert.match(assistPlaceConflict(one('~ place Bluewatch Village / Market'), alias, MAP), /places Dries at/);
});

test('the answer: lines with an invented name or a vague time are refused as problems (the reader is told); the rest are kept', () => {
    const check = { places: mapPlaces(MAP), here: 'Bluewatch Village' };
    const answer = '~ place Bluewatch Guild Branch\n~ time midday\n! time +2h\n~ place East Ridge\n+ item Rope';
    const parsed = parseExtractorAnswer(answer, ['place', 'time', 'item'], null, check);
    assert.deepEqual(parsed.lines, ['! time +2h', '~ place East Ridge']);
    assert.deepEqual(parsed.refused.filter(item => item.problem).map(item => item.line), ['~ place Bluewatch Guild Branch', '~ time midday']);
    assert.deepEqual(parsed.refused.filter(item => !item.problem).map(item => item.line), ['+ item Rope'], 'the value wall\'s own refusals are not problems');
    assert.equal(parsed.dropped, 3);
});

function setup({ answers, where, grammar = ['~ place Name | kind: settlement', '~ time <date, clock time>'] }) {
    const callModel = fakeModel(...answers);
    const fed = [];
    const part = createAssistPart({
        callModel, settings: () => on({ extractor: true }), grammar: () => grammar, chatId: () => 'chat-1', warn: () => {},
        capture: async (text, at, options) => { fed.push({ text, ...at, options }); return { receipts: [], problems: [] }; },
        ...(where ? { where } : {}),
    });
    const after = reply => part.hooks.afterReply({ index: 2, swipe: 0, type: 'normal', mes: 'They walk to the guild office.', ...reply });
    return { callModel, fed, after, last: () => part.queries['assist.status']().extractor.last };
}
const WHERE = () => ({ here: { name: 'Bluewatch Village', kind: 'settlement' }, places: MAP, time: 'Goldwane 12, 611, 06:40 am' });

test('the extractor tells the model where and when, and hands the host the lines it kept and the ones it refused', async () => {
    const { callModel, fed, after } = setup({ answers: ['~ place Bluewatch Guild Branch | kind: guild office\n~ time midday\n~ place East Ridge'], where: WHERE });
    await after();
    const prompt = callModel.calls[0].prompt;
    assert.match(prompt, /Place now: Bluewatch Village \(settlement\)/);
    assert.match(prompt, /Story date and time now: Goldwane 12, 611, 06:40 am/);
    assert.match(prompt, /Known places near it \(use these exact names\): .*Bluewatch Village \/ Guild Office/);
    assert.equal(fed.length, 1);
    assert.equal(fed[0].text, '~ place East Ridge');
    assert.deepEqual(fed[0].options.refused.map(item => item.line), ['~ place Bluewatch Guild Branch | kind: guild office', '~ time midday']);
    assert.match(fed[0].options.refused[0].why, /map calls this place "Bluewatch Village \/ Guild Office"/);
    assert.match(fed[0].options.refused[1].why, /no clock time/);
});

test('when every line is refused the host is still told, so the reader sees why; a clean answer adds no refusals', async () => {
    const bad = setup({ answers: ['~ time mid-morning'], where: WHERE });
    await bad.after();
    assert.equal(bad.fed.length, 1);
    assert.equal(bad.fed[0].text, '');
    assert.equal(bad.fed[0].options.refused.length, 1);
    assert.equal(bad.last().outcome, 'nothing');
    assert.match(bad.last().message, /a line was refused/);
    const good = setup({ answers: ['~ time Goldwane 12, 9:30 am\n~ place Guild Office'], where: WHERE });
    await good.after();
    assert.equal(good.fed[0].text, '~ time Goldwane 12, 9:30 am\n~ place Guild Office');
    assert.equal(good.fed[0].options.refused, undefined);
    const none = setup({ answers: ['none'], where: WHERE });
    await none.after();
    assert.equal(none.fed.length, 0);
});

test('a where that throws or is missing is none of it: the prompt has no block, the time is still checked', async () => {
    const boom = setup({ answers: ['~ time midday'], where: () => { throw new Error('no map'); } });
    await boom.after();
    assert.ok(!boom.callModel.calls[0].prompt.includes(WHERE_HEAD));
    assert.equal(boom.fed[0].options.refused.length, 1);
    const plain = setup({ answers: ['~ place The Mill'] });
    await plain.after();
    assert.ok(!plain.callModel.calls[0].prompt.includes(WHERE_HEAD));
    assert.equal(plain.fed[0].text, '~ place The Mill');
});

// ---- the real host ---------------------------------------------------------------------------------------------------------------

const PACK = { id: 'blue', version: '1.0.0', requires: { storyBlock: '^2' }, content: { places: [
    { name: 'Bluewatch Village / Guild Office', aliases: ['Guild Office'], kind: 'guild office', region: 'River', x: 64, y: 110 },
    { name: 'Bluewatch Village', kind: 'settlement', region: 'River', x: 62, y: 108 },
] } };

// A stand-in for Story Director's `time` kind (the real one lives in its repo): the line's text, whatever it is, is "applied".
const CLOCK = { id: 'clock-probe', version: '1.0.0', domains: { clockProbe: { initial: () => ({ said: [] }) } },
    capture: { kinds: { time: { grammar: '~ time <date, clock time> · ! time +2h' } }, apply(ctx, line) { ctx.draft('clockProbe').said.push(line.raw); return { narrate: false }; } },
    queries: { 'director.time': () => ({ minutes: 400, text: 'Goldwane 12, 611, 06:40 am', parts: null }) } };

async function withMap(model) {
    const probe = await createHost({ modules: [CLOCK] });
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    const host = await createHost({ modules: [CLOCK], callModel: model,
        settings: { ...settings, modules: { ...(settings.modules ?? {}), 'story-block': { ...(settings.modules?.['story-block'] ?? {}), [SETTING.extractor]: true } } } });
    host.features?.set?.('story-block.extractor', true);
    return host;
}
const settleAssist = () => new Promise(resolve => setTimeout(resolve, 60));

test('on the real host: an invented place name and a vague time from the safety net are refused with Problems lines and not applied; a known name and a clock time are', { skip }, async () => {
    const prompts = [];
    const answers = ['~ place Bluewatch Guild Branch | kind: guild office\n~ time midday', '~ place Guild Office\n~ time Goldwane 12, 9:30 am'];
    const host = await withMap(async prompt => { prompts.push(prompt); return answers[prompts.length - 1] ?? 'none'; });
    try {
        const first = await host.send('I walk to the village.', 'You walk into Bluewatch Village.\n<Changes>\n~ place Bluewatch Village | kind: settlement\n</Changes>');
        await settleAssist();
        assert.match(prompts[0], /Place now: Bluewatch Village \(settlement\)/);
        assert.match(prompts[0], /Story date and time now: Goldwane 12, 611, 06:40 am/);
        assert.match(prompts[0], /Known places near it \(use these exact names\): Bluewatch Village \/ Guild Office/);
        const problems = host.turn.problems().filter(item => item.index === first.index && item.code === 'REFUSED');
        assert.deepEqual(problems.map(item => item.line), ['~ place Bluewatch Guild Branch | kind: guild office', '~ time midday']);
        assert.match(problems[0].message, /^"~ place Bluewatch Guild Branch \| kind: guild office" was not used: "Bluewatch Guild Branch" is not a place name on the map; the map calls this place "Bluewatch Village \/ Guild Office"/);
        assert.match(problems[1].message, /"midday" has no clock time/);
        // The reply's note lists them as refused lines.
        assert.deepEqual(refusedFrom(host.turn.problems(), first.index).map(item => item.line), ['~ place Bluewatch Guild Branch | kind: guild office', '~ time midday']);
        assert.equal(host.sdk.query('scene.place').name, 'Bluewatch Village', 'the invented name never became the place');
        // The next reply: known names are used, and the place moves.
        const second = await host.send('I go in.', 'You step into the guild office.');
        await settleAssist();
        assert.equal(host.sdk.query('scene.place').name, 'Guild Office');
        assert.deepEqual(host.head().domains.clockProbe.said, ['~ time Goldwane 12, 9:30 am'], 'the clock time was applied, the vague one never');
        assert.equal(host.turn.problems().filter(item => item.index === second.index && item.code === 'REFUSED').length, 0);
    } finally { host.close(); }
});

// ---- what the Chronicle holds, told to the safety net -------------------------------------------------------------------------------

test('worldKnown caps the open event names and the faction names with their stance; whereLines tells them, and the footer asks for reuse and labels', () => {
    const events = Array.from({ length: 14 }, (_, at) => ({ name: `Event ${at}` })).concat([{ name: '  ' }, null]);
    const known = worldKnown({ events, factions: [{ name: 'Red Cords', stance: 'neutral' }, { name: 'Shackles' }] });
    assert.equal(known.events.length, 10);
    assert.deepEqual(known.factions, [{ name: 'Red Cords', stance: 'neutral' }, { name: 'Shackles', stance: '' }]);
    assert.deepEqual(worldKnown(null), { events: [], factions: [] });
    const lines = whereLines({ ...known, events: ['Wolf-Push', 'Retaliation'] });
    assert.ok(lines.includes('Open world events the story already keeps (to update one, write ~ world with its exact name): Wolf-Push; Retaliation'));
    assert.ok(lines.includes('Factions the story already keeps, with stance (never write a stance for one): Red Cords (neutral); Shackles'));
    assert.match(WORLD_FOOT.join('\n'), /always written label: value \(place: /);
    assert.match(WORLD_FOOT.join('\n'), /reuse its exact name with ~ to update it/);
    assert.match(WORLD_FOOT.join('\n'), /Never change a stance the reply does not show changing, and never make a faction out of a place or a city name/);
});

// The footer as it was before the world lines existed (with the presence line): any reader without a world or faction kind gets exactly this.
const OLD_FOOT = ['Write a line only for what the reply clearly tells and its own lines (below) do not already say, with numbers only where it gives them. If nothing is missing, answer: none',
    'Write a place line only when the reply moves the scene. Name where the reply ENDS, the last place the story is at, never a stop on the way. If the scene ends at the place it is at now, write no place line.',
    'Presence is the scene at the END: + present only for someone there when the reply ends, never someone met at a stop on the way; - present for someone present before who is gone at the end.',
    'A place line uses the exact name of a known place whenever the reply is at one the map has (known places are listed below). A time line needs a clock time like the story date and time below (~ time <date>, 9:30 am sets it; ! time +2h moves it on): "midday" and "mid-morning" are not times, so write no time line unless the reply gives a clock time or a stretch. A line with an unknown name for a known place, or a time without a clock time, is refused.',
    'Answer with the lines only, between <Changes> and </Changes>.'].join('\n');

test('the world and label lines are in the prompt only when a world or faction kind is allowed; other readers get the footer as it was, in the same order', () => {
    assert.equal(EXTRACTOR_FOOT, OLD_FOOT);
    for (const grammar of [['~ time <date>'], ['~ place Name', '+ wound Name']]) assert.equal(footFor(grammar), OLD_FOOT);
    for (const grammar of [['+ world Name — news'], ['~ faction Name'], ['~ time', '+ faction Name | area | stance']]) {
        const foot = footFor(grammar);
        assert.ok(foot.startsWith(OLD_FOOT.split('\nAnswer with')[0]) && foot.endsWith('Answer with the lines only, between <Changes> and </Changes>.'));
        for (const line of WORLD_FOOT) assert.ok(foot.includes(line));
    }
    assert.ok(extractorPrompt('r', ['~ time']).includes(`\n${OLD_FOOT}\n\n`));
    assert.ok(extractorPrompt('r', ['~ time', '+ world Name']).includes(WORLD_FOOT[0]));
    assert.ok(!extractorPrompt('r', ['~ time']).includes(WORLD_FOOT[0]) && !/faction/.test(extractorPrompt('r', ['~ time'])));
});

const CHRONICLE = { id: 'chronicle-probe', version: '1.0.0', domains: { chronicleProbe: { initial: () => ({ said: [] }) } },
    capture: { kinds: { world: { grammar: '+ world Name — news | state: ongoing | place | factions' }, faction: { grammar: '+ faction Name — what it is | area | stance' } },
        apply(ctx, line) { ctx.draft('chronicleProbe').said.push(line.raw); return { narrate: false }; } },
    queries: { 'chronicle.events': () => [{ name: 'Shornmarch Wolf-Push' }], 'chronicle.factions': () => [{ name: 'Red Cords', stance: 'neutral' }] } };

test('on the real host: with a world or faction kind allowed the prompt names the open events and the factions with their stance; without one it does not', { skip }, async () => {
    for (const [kinds, told] of [['~ time, + world, ~ world, + faction, ~ faction', true], ['~ time', false]]) {
        const prompts = [];
        const host = await createHost({ modules: [CLOCK, CHRONICLE], callModel: async prompt => { prompts.push(prompt); return 'none'; },
            settings: { modules: { 'story-block': { [SETTING.extractor]: true, [SETTING.extractorKinds]: kinds } } } });
        try {
            host.features?.set?.('story-block.extractor', true);
            await host.send('I look around.', 'The pier is busy.');
            await settleAssist();
            assert.equal(prompts.length, 1);
            assert.equal(prompts[0].includes('Open world events the story already keeps (to update one, write ~ world with its exact name): Shornmarch Wolf-Push'), told);
            assert.equal(prompts[0].includes('Red Cords (neutral)'), told);
            // The footer: the world and label lines only with a world or faction kind; without one, the footer as it was.
            assert.equal(prompts[0].includes(WORLD_FOOT[0]) && prompts[0].includes(WORLD_FOOT[1]), told);
            if (!told) {
                // Complete pre-change prompt, including grammar, context and reply: a golden comparison through the host.
                const golden = ['You read one reply from an interactive story and list what changed in it that its own change lines missed, as change lines, one per line:',
                    'op kind Name[ — text][ | label: value]',
                    'op: + new or gained, - gone or lost, ~ changed, ! happened, ? asks code to decide (a check the reply stopped at).',
                    'Use only these kinds:', '- ~ time <date, clock time> · ! time +2h', OLD_FOOT, '',
                    'Where and when the scene is:', 'Story date and time now: Goldwane 12, 611, 06:40 am', '',
                    "The reply's own lines:", 'none', '', 'The reply:', '"""', 'The pier is busy.', '"""'].join('\n');
                assert.equal(prompts[0], golden);
            }
        } finally { host.close(); }
    }
});

test('a map-refused safety-net place also refuses a person mentioned only before the last paragraph', { skip }, async () => {
    let calls = 0;
    const host = await withMap(async () => (++calls === 2 ? '~ place Bluewatch Guild Branch\n+ present Gerrit' : 'none'));
    try {
        await host.send('At the guild.', 'Sieke is here.\n<Changes>\n~ place Bluewatch Village | with: Sieke\n</Changes>');
        const reply = await host.send('Run errands.', 'Gerrit serves stew at the Stray Oar.\n\nBack at the Guild office, Sieke waits.');
        await settleAssist();
        const refused = host.turn.problems().filter(item => item.index === reply.index && item.code === 'REFUSED');
        assert.ok(refused.some(item => item.line === '~ place Bluewatch Guild Branch' && /map calls this place/.test(item.message)));
        assert.ok(refused.some(item => item.line === '+ present Gerrit' && /not named in the reply's last paragraph/.test(item.message)));
        assert.deepEqual(host.sdk.query('scene.present'), ['Sieke']);
        assert.equal((await host.sdk.reread(reply.index)).ok, true);
        assert.deepEqual(host.sdk.query('scene.present'), ['Sieke']);
    } finally { host.close(); }
});
