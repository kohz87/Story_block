import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { createParticipants, PARTICIPANT_TIMEOUT_MS } from '../../src/v2/timeline/participants.js';
import { nativeModule, rulesModule, restore, clone, batchFor } from './helpers/timeline.js';

const turn = () => new Promise(resolve => setImmediate(resolve));

test('a hung native prepare releases the host queue at 10 seconds and stays quarantined until it settles', { timeout: 2000 }, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(PARTICIPANT_TIMEOUT_MS, 10000);
    const native = nativeModule();
    const host = await createHost({ modules: [native.def] });
    t.after(() => host.close());
    await host.send('Go.', 'Native state.');
    const head = await host.sdk.timeline.head();
    let release;
    let calls = 0;
    const input = { participant: native.def.id, source: head.source, expectedHead: head.headHash,
        prepare: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    };
    const waiting = native.native.handle.nativeMutation(input);
    for (let pass = 0; pass < 20 && !release; pass++) await turn();
    assert.equal(typeof release, 'function');
    t.mock.timers.tick(PARTICIPANT_TIMEOUT_MS);
    assert.equal((await waiting).code, 'FAILED');
    assert.equal((await host.sdk.timeline.status()).state, 'idle', 'the queue can answer another operation');
    assert.equal(host.sdk.query('savepoint.contract', {}).participantsReady, false);
    assert.equal((await native.native.handle.nativeMutation(input)).code, 'FAILED');
    assert.equal(calls, 1, 'a second prepare cannot overlap a late callback');
    release({});
    await turn();
    assert.equal(host.sdk.query('savepoint.contract', {}).participantsReady, true);
    assert.deepEqual(host.timeline.host.journal(), [], 'late preparation cannot commit anything');
});

test('participant timeout slots belong to one chat; late completion cannot clear another chat slot', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const a = {}, b = {};
    let holder = a;
    const participants = createParticipants({ timeoutMs: 10, chat: () => holder });
    let finishA, finishB;
    const first = participants.run('native', () => new Promise(resolve => { finishA = resolve; }));
    await turn();
    t.mock.timers.tick(10);
    await assert.rejects(first, /timed out/);
    assert.equal(participants.ready(), false);
    holder = b;
    assert.equal(participants.ready(), true);
    const second = participants.run('native', () => new Promise(resolve => { finishB = resolve; }));
    await turn();
    finishA({});
    await turn();
    assert.equal(participants.ready(), false);
    finishB({});
    await second;
    assert.equal(participants.ready(), true);
    holder = a;
    assert.equal(participants.ready(), true);
});

test('old day-start payloads and old pre-restore pins remain readable for retained history', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Start.', 'Day one.');
    const points = [];
    for (let day = 1; day <= 4; day++) {
        const made = await host.timeline.host.make({kind: 'day-start', day});
        assert.equal(made.ok, true, made.message);
        points.push(made.snapshot);
        await host.send('Later.', `Day ${day + 1}.`);
    }
    const first = await restore(host, points[0].id, {batch: batchFor('br_oldpin01')});
    assert.equal(first.activated.status, 'complete');
    const pin = clone(host.timeline.host.pin('br_oldpin01'));
    await host.send('Again.', 'Another return.');
    const second = await restore(host, points[0].id, {batch: batchFor('br_newpin01')});
    assert.equal(second.activated.status, 'complete');
    assert.deepEqual(host.timeline.host.pin('br_oldpin01'), pin);
    for (const point of points) assert.notEqual(host.timeline.archive.payload(point.payloadHash), null);
});

test('native preparation and registered callbacks share one timeout/quarantine implementation', async () => {
    const { readFile } = await import('node:fs/promises');
    const participants = await readFile(new URL('../../src/v2/timeline/participants.js', import.meta.url), 'utf8');
    const coordinator = await readFile(new URL('../../src/v2/timeline/coordinator.js', import.meta.url), 'utf8');
    assert.equal((participants.match(/timer = setTimeout\(/g) ?? []).length, 1);
    assert.equal((participants.match(/async function run\(/g) ?? []).length, 1);
    assert.match(participants, /answer = await run\(module,/);
    assert.match(coordinator, /await participants\.run\(who,/);
    assert.equal(coordinator.includes('boundedParticipant'), false);
});
