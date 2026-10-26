import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChanges } from '../../../src/v2/capture.js';
import { refusedFrom } from '../../../src/v2/reply-notes.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { createEvaluation, DataModuleError } from '../../../src/v2/data-modules/interpreter.js';
import { dataModuleDefaults } from '../../../src/v2/data-modules/check.js';
import { DM_LIMITS as L } from '../../../src/v2/data-modules/schema.js';
import { fixture, reply, int, definition, pack, success, world, pin, view, rebuilt, directorStub } from './helpers.js';

test('reputation: fields, immediate midpoint reward, ordered rules, latch and durable decisions', async t => {
    const host = await world(t); const offer = await pin(host);
    assert.equal(host.registry.domainOwner('dataModules'), 'story-block');
    assert.equal(host.registry.captureOwner('dm'), 'story-block');
    assert.ok(host.registry.contexts().find(row => row.moduleId === 'story-block').static().includes('+ dm reputation'));
    for (const reason of ['repaired the weir', 'brought back the register']) {
        await host.send('Help.', reply(`+ dm reputation — ${reason} | kind: gain | faction: guild`)); rebuilt(host);
    }
    assert.deepEqual(view(host).chat, { standing: { guild: 6, watch: 0, compact: 0 }, title: 'Guild Friend' });
    const span = host.ctx.chat.at(-1).extra.storySuite.spans.find(span => span.guard?.predicate?.kind === 'dm.act');
    assert.equal(span.guard.rulesHash, null); assert.equal(span.guard.predicate.hash, offer.hash);
    assert.deepEqual(span.recorded.decision.decisions[0].values, { amount: 3 });
    assert.equal(span.recorded.decision.decisions[0].ranges.amount.pick, 'midpoint');
    await host.send('Loss.', reply('- dm reputation — a loss | kind: loss | faction: guild', '- dm reputation — broke the seal | kind: loss | faction: watch'));
    assert.deepEqual(view(host).chat, { standing: { guild: 1, watch: -5, compact: 0 }, title: 'Guild Friend' });
    assert.deepEqual(host.sdk.query('dataModules.public', { module: offer.module, export: 'standing' }), view(host).chat);
    rebuilt(host); assert.deepEqual(host.store.problems(), []);
});

test('Continue claims share the source pair; a new reply has a new claim', async t => {
    const host = await world(t); await pin(host);
    const gain = '+ dm reputation — favour | kind: gain | faction: guild';
    await host.send('Help.', reply(gain));
    await host.cont(reply(gain.replace('favour', 'different reason')));
    assert.equal(view(host).chat.standing.guild, 3);
    assert.ok(host.turn.problems().some(problem => problem.code === 'CLAIMED'));
    await host.send('Again.', reply(gain)); assert.equal(view(host).chat.standing.guild, 6); rebuilt(host);
});

for (const [line, code] of [
    ['+ dm reputation — favour | kind: gain | faction: crown', 'DM_LABEL'],
    ['+ dm reputation — favour | kind: gain | faction: guild | who: Wessel', 'DM_LABEL'],
    ['+ dm reputation — favour | kind: gain', 'DM_LABEL'],
    ['+ dm reputation — favour | kind: other', 'DM_LABEL'],
    ['! dm reputation — favour | kind: gain | faction: guild', 'REFUSED'],
]) test(`atomic capture refusal ${line}`, async t => {
    const host = await world(t); await pin(host); const before = structuredClone(host.head().domains.dataModules);
    await host.send('Try.', reply(line));
    assert.deepEqual(host.head().domains.dataModules, before);
    const problem = host.turn.problems().find(problem => problem.code === code); assert.ok(problem, JSON.stringify(host.turn.problems()));
    assert.ok(refusedFrom(host.turn.problems(), host.ctx.chat.length - 1).some(row => row.reason.includes('Nothing applied')));
});

test('dm parser alone diagnoses duplicate labels and trailing text; legacy duplicate behavior is unchanged', () => {
    assert.match(parseChanges('+ dm reputation | kind: gain | kind: loss').problems[0], /DM_LABEL: duplicate label kind/);
    assert.match(parseChanges('+ dm reputation | kind: gain | spare text').problems[0], /DM_LABEL: unused trailing text/);
    assert.equal(parseChanges('+ item Rope | note: a | note: b').lines[0].labels.note, 'a; b');
});

test('UI kinds use the same interpreter, schema and claim; story-only kinds refuse UI', async t => {
    const host = await world(t, pack()); const offer = await pin(host);
    success(await host.sdk.command('dm.act', { module: offer.module, kind: 'gain', labels: {} }));
    assert.equal(view(host, offer.module).chat.points, 1);
    assert.equal((await host.sdk.command('dm.act', { module: offer.module, kind: 'gain' })).code, 'CLAIMED');
    rebuilt(host);
    const h2 = await world(t); const o2 = await pin(h2);
    assert.equal((await h2.sdk.command('dm.act', { module: o2.module, kind: 'gain', labels: { faction: 'guild' } })).code, 'REFUSED');
});

test('delayed offers freeze enum-selected range, binding, recipient and source; award settles just once', async t => {
    const d = definition(); d.state.ready = { type: 'bool', default: false };
    d.rewards = { prize: { bindings: { tier: { type: 'enum', values: ['low', 'high'] } },
        values: { amount: { binding: 'tier', table: { low: { min: 1, max: 3, pick: 'min' }, high: { min: 4, max: 6, pick: 'max' } } } },
        when: ['get', ['ready']], effects: [{ op: 'add', path: ['points'], value: ['reward', 'amount'], bounds: 'clamp' }] } };
    d.kinds.offer = { op: '+', labels: { tier: { type: 'enum', values: ['low', 'high'] } }, effects: [{ op: 'offer', key: 'prize', template: 'prize', bind: { tier: ['arg', 'tier'] } }] };
    d.kinds.award = { op: '!', labels: {}, effects: [{ op: 'award', offer: 'prize' }] };
    d.kinds.ready = { op: '!', labels: {}, effects: [{ op: 'set', path: ['ready'], value: true }] };
    const host = await world(t, pack([d])), offer = await pin(host);
    await host.send('Offer.', reply('+ dm counter — prize | kind: offer | tier: high'));
    const frozen = host.head().domains.dataModules.instances[offer.module].chat.offers.prize;
    assert.equal(frozen.values.amount, 6); assert.equal(frozen.recipient, 'chat'); assert.ok(frozen.source.evidence);
    await host.send('Premature.', reply('! dm counter — prize | kind: award'));
    assert.equal(view(host, offer.module).chat.points, 0);
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_CONDITION'));
    await host.send('Ready.', reply('! dm counter — ready | kind: ready', '! dm counter — prize | kind: award'));
    assert.equal(view(host, offer.module).chat.points, 6);
    assert.deepEqual(host.head().domains.dataModules.instances[offer.module].chat.offers, {});
    await host.send('Again.', reply('! dm counter — prize | kind: award', '+ dm counter — prize | kind: offer | tier: low'));
    assert.equal(view(host, offer.module).chat.points, 6);
    assert.equal(host.turn.problems().filter(problem => problem.code === 'CLAIMED').length, 2); rebuilt(host);
});

test('rules run once in authored order and do not re-enter an earlier rule', async t => {
    const d = definition(); d.rules = [
        { id: 'first', when: ['eq', ['get', ['points']], 2], then: [{ op: 'set', path: ['points'], value: 20 }] },
        { id: 'second', when: ['eq', ['get', ['points']], 1], then: [{ op: 'set', path: ['points'], value: 2 }] },
        { id: 'third', when: ['eq', ['get', ['points']], 2], then: [{ op: 'set', path: ['points'], value: 3 }] },
    ];
    const host = await world(t, pack([d])), offer = await pin(host);
    await host.send('Gain.', reply('+ dm counter — one | kind: gain'));
    assert.equal(view(host, offer.module).chat.points, 3); rebuilt(host);
});

test('local exports feed declared imports without exposing private fields or initializing a target', async t => {
    const source = definition(); source.exports = { score: { fields: ['points'] } };
    const target = definition(); target.slug = 'follower'; target.imports = { score: { query: 'dataModules.public', args: { module: 'pack.dm-test/counter', export: 'score' }, mode: 'prefix', projection: ['points'] } };
    target.kinds.gain.effects = [{ op: 'set', path: ['points'], value: ['input', 'score', 'points'] }];
    const host = await world(t, pack([source, target]));
    const offers = host.sdk.query('dataModules.offers');
    assert.equal((await host.sdk.command('dm.pin', { module: offers[1].module, hash: offers[1].hash, packHash: offers[1].packHash })).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(host.head().domains.dataModules, undefined);
    await pin(host); await pin(host, [], 1);
    await host.send('Scores.', reply('+ dm counter — point | kind: gain', '+ dm follower — copied | kind: gain'));
    assert.equal(view(host, offers[1].module).chat.points, 1); rebuilt(host);
    assert.equal(host.sdk.query('dataModules.public', { module: offers[0].module, export: 'private' }), null);
});

test('ambiguous bare slugs list both candidates; full IDs keep local kinds independent', async t => {
    const host = await world(t); const other = fixture('reputation'); other.id = 'another-faction'; other.content.dataModules[0].screens = [];
    success(await host.packs.packs.install(other)); await pin(host); await pin(host, [], 1);
    await host.send('Ambiguous.', reply('+ dm reputation — help | kind: gain | faction: guild'));
    assert.match(host.turn.problems()[0].message, /pack\.ersveil-factions\/reputation.*pack\.another-faction\/reputation/);
    await host.send('Explicit.', reply('+ dm pack.another-faction/reputation — help | kind: gain | faction: guild'));
    assert.equal(view(host, 'pack.another-faction/reputation').chat.standing.guild, 3);
    assert.equal(view(host).chat.standing.guild, 0); rebuilt(host);
});

test('survival timers settle before rest and after later time lines; prefixes exclude formatting and policy', async t => {
    const host = await world(t, fixture('survival'), [directorStub()]), offer = await pin(host, ['ca_wessel01']);
    await host.send('Rest.', reply('! time 360', '! dm survival — slept | kind: rest | who: Wessel | hours: 6'));
    assert.deepEqual(view(host, offer.module).characters[0], { id: 'ca_wessel01', name: 'Wessel', hunger: 12, fatigue: 0 });
    await host.send('Travel.', reply('! time 120'));
    assert.equal(view(host, offer.module).characters[0].hunger, 16);
    assert.equal(view(host, offer.module).characters[0].fatigue, 2);
    await host.send('Meal.', reply('! dm survival — ate supper | kind: meal | who: Wessel'));
    assert.equal(view(host, offer.module).characters[0].hunger, 0);
    assert.equal(view(host, offer.module).characters[0].fatigue, 2);
    const spans = host.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).filter(span => span.guard?.predicate?.kind?.startsWith('dm.'));
    assert.ok(spans.every(span => !JSON.stringify(span.recorded).includes('must never reach') && !JSON.stringify(span.recorded).includes('secret')));
    rebuilt(host);
});

for (const minutes of [59, 60, 61]) test(`timer boundary ${minutes} minutes and remainder`, async t => {
    const host = await world(t, fixture('survival'), [directorStub()]), offer = await pin(host, ['ca_wessel01']);
    await host.send('Time.', reply(`! time ${minutes}`));
    const instance = host.head().domains.dataModules.instances[offer.module].characters.ca_wessel01;
    assert.equal(instance.fields.hunger, Math.floor(minutes / 60) * 2);
    assert.deepEqual(instance.timers.needs, { lastMinute: 1000 + minutes, remainder: minutes % 60 }); rebuilt(host);
});

test('unset clock establishes a baseline; backwards edits keep the high-water minute and remainder', async t => {
    const host = await world(t, fixture('survival'), [directorStub({ minute: null })]), offer = await pin(host, ['ca_wessel01']);
    assert.equal(host.sdk.query('dataModules.setup')[0].status, 'Waiting');
    success(await host.sdk.command('test.minute', { minute: 1000 }));
    await host.send('Begin.', 'No change block.');
    assert.equal(view(host, offer.module).characters[0].hunger, 0);
    success(await host.sdk.command('test.minute', { minute: 1061 })); await host.send('Advance.', 'The road.');
    assert.equal(view(host, offer.module).characters[0].hunger, 2);
    success(await host.sdk.command('test.minute', { minute: 900 })); await host.send('Back.', 'No penalty.');
    assert.deepEqual(host.head().domains.dataModules.instances[offer.module].characters.ca_wessel01.timers.needs, { lastMinute: 1061, remainder: 1 });
    success(await host.sdk.command('test.minute', { minute: 1120 })); await host.send('Forward.', 'The road.');
    assert.equal(view(host, offer.module).characters[0].hunger, 4); rebuilt(host);
});

test('an oversized timer jump refuses atomically, leaves its cursor, and does not block an independent module', async t => {
    const host = await world(t, fixture('survival'), [directorStub()]), offer = await pin(host, ['ca_wessel01']);
    success(await host.packs.packs.install(fixture('reputation'))); await pin(host, [], 1);
    const before = structuredClone(host.head().domains.dataModules.instances[offer.module]);
    await host.send('Jump.', reply(`! time ${L.elapsedMinutes + 1}`, '+ dm reputation — help | kind: gain | faction: guild'));
    assert.deepEqual(host.head().domains.dataModules.instances[offer.module], before);
    assert.equal(view(host).chat.standing.guild, 3);
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_BUDGET')); rebuilt(host);
});

test('missing/dormant peers stop new survival work; existing slices still replay', async t => {
    const host = await world(t, fixture('survival'), [directorStub()]), offer = await pin(host, ['ca_wessel01']);
    host.registry.setEnabled('story-director', false, 'Director disabled.');
    const before = structuredClone(host.head().domains.dataModules);
    await host.send('Meal.', reply('! dm survival — meal | kind: meal | who: Wessel'));
    assert.deepEqual(host.head().domains.dataModules, before);
    assert.ok(host.turn.problems().some(problem => problem.code === 'DEPENDENCY_UNAVAILABLE')); rebuilt(host);
    assert.equal(view(host, offer.module).characters.length, 1);
});

test('a late field overflow discards earlier effects, timer cursor and claims together', async t => {
    const d = definition(); d.kinds.gain.effects.push({ op: 'add', path: ['points'], value: 100 });
    const host = await world(t, pack([d])); await pin(host); const before = structuredClone(host.head());
    await host.send('Overflow.', reply('+ dm counter — point | kind: gain'));
    assert.deepEqual(host.head(), before);
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_BOUNDS'));
});

test('unused discovery and Setup inspection allocate no data domain or writes; screens mount only from frozen pins', async t => {
    const host = await world(t), before = JSON.stringify({ chat: host.ctx.chat, state: host.head() });
    for (let i = 0; i < 3; i++) { host.sdk.query('dataModules.offers'); host.sdk.query('dataModules.setup'); }
    assert.equal(JSON.stringify({ chat: host.ctx.chat, state: host.head() }), before);
    assert.deepEqual(host.sdk.query('dataModules.presentation'), []);
    await pin(host);
    assert.equal(host.sdk.query('dataModules.presentation')[0].id, 'ersveil-reputation');
    await host.packs.packs.remove('ersveil-factions');
    assert.equal(host.sdk.query('dataModules.presentation')[0].id, 'ersveil-reputation');
});

test('pure interpreter charges visits, short circuits absent inputs, clamps, divides and checks unsafe intermediates', () => {
    const d = validatePack(pack()).pack.content.dataModules[0];
    const instance = { fields: dataModuleDefaults(d.state), timers: {}, offers: {}, settled: {} };
    const ev = createEvaluation(d, instance);
    assert.equal(ev.evaluate(['and', false, ['input', 'missing', 'field']]), false);
    assert.equal(ev.evaluate(['or', true, ['input', 'missing', 'field']]), true);
    assert.equal(ev.evaluate(['floorDiv', -5, 2]), -3);
    assert.equal(ev.evaluate(['clamp', 200, 0, 100]), 100);
    assert.throws(() => ev.evaluate(['mul', L.integer, 2]), error => error instanceof DataModuleError && error.code === 'DM_BOUNDS');
    assert.throws(() => ev.charge(L.rootVisits), error => error.code === 'DM_BUDGET');
});
