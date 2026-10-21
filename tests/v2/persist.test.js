// v2 carrier records (SPEC §2.2) and save batching (§3.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    carrierIndexes, createSaver, isCarrier, lastCarrier, readRecord, recordFault, swipeOf, writeRecord,
} from '../../src/v2/persist.js';

const record = (fields = {}) => ({ v: 2, sid: 'sw_a', ops: [], receipts: [], narrated: [], spans: [], ...fields });

test('carriers are every non-user message: greeting, replies, system and narrator messages', () => {
    const chat = [{ is_user: false, mes: 'Hi' }, { is_user: true, mes: 'Me' }, { is_user: false, is_system: true, mes: 'Note' },
        null, { is_user: false, name: 'Narrator', mes: '...' }, { is_user: true }];
    assert.deepEqual(carrierIndexes(chat), [0, 2, 4]);
    assert.equal(lastCarrier(chat), 4);
    assert.equal(lastCarrier(chat, 4), 2);
    assert.equal(lastCarrier([]), -1);
    assert.equal(isCarrier({ is_user: true }), false);
    assert.equal(swipeOf({}), 0);
    assert.equal(swipeOf({ swipe_id: 2 }), 2);
});

test('only well-formed v2 records count; v1 extras and other shapes are no record', () => {
    const at = extra => readRecord({ is_user: false, extra });
    assert.equal(at(undefined), null);
    assert.equal(at({ storyBlockIdentity: { id: 'x', swipe: 0 } }), null);
    assert.equal(at({ storySuite: { v: 1, ops: [], receipts: [], narrated: [] } }), null);
    assert.equal(at({ storySuite: record({ ops: null }) }), null);
    assert.equal(at({ storySuite: record({ narrated: 'a' }) }), null);
    assert.equal(at({ storySuite: record({ checkpoint: [] }) }), null);
    assert.equal(readRecord({ is_user: true, extra: { storySuite: record() } }), null, 'user messages hold nothing');
    const good = record({ checkpoint: { v: 2, meta: { rev: 0 }, domains: {} } });
    assert.equal(at({ storySuite: good }), good);
    // A checkpoint is a whole state (break round b2-timeline-7): v 2, meta with a whole-number rev, domains.
    for (const checkpoint of [{}, { v: 2 }, { v: 2, meta: {}, domains: {} }, { v: 2, meta: { rev: 1.5 }, domains: {} },
        { v: 2, meta: { rev: 0 }, domains: [] }, { v: 1, meta: { rev: 0 }, domains: {} }]) {
        assert.equal(at({ storySuite: record({ checkpoint }) }), null, JSON.stringify(checkpoint));
        assert.match(recordFault({ is_user: false, extra: { storySuite: record({ checkpoint }) } }), /checkpoint/);
    }
    assert.match(recordFault({ is_user: false, extra: { storySuite: record({ ops: null }) } }), /changes/);
    assert.equal(recordFault({ is_user: false, extra: { storySuite: good } }), '');
    assert.equal(recordFault({ is_user: false, extra: { storySuite: { v: 1 } } }), '', 'not a v2 record: not ours to report');
});

test('a record copied into another swipe is not that swipe\'s; one shifted by a deleted swipe still is', () => {
    const own = record({ swipe: 0, sid: 'sw_a' });
    const copied = { is_user: false, swipe_id: 1, extra: { storySuite: { ...own } },
        swipe_info: [{ extra: { storySuite: own } }, { extra: { storySuite: { ...own } } }] };
    assert.equal(readRecord(copied), null);
    const shifted = { is_user: false, swipe_id: 1, extra: { storySuite: record({ swipe: 2, sid: 'sw_c' }) },
        swipe_info: [{ extra: { storySuite: own } }, { extra: { storySuite: record({ swipe: 2, sid: 'sw_c' }) } }] };
    assert.equal(readRecord(shifted)?.sid, 'sw_c');
    const anonymous = { is_user: false, swipe_id: 1, extra: { storySuite: record({ swipe: 0, sid: undefined }) } };
    assert.equal(readRecord(anonymous), null, 'no way to tell a copy apart: none');
    const shared = { is_user: false, swipe_id: 1, extra: { storySuite: record({ swipe: 0 }) } };
    shared.swipe_info = [{ extra: { storySuite: record({ swipe: 0, sid: 'sw_other' }) } }, { extra: shared.extra }];
    assert.equal(readRecord(shared)?.sid, 'sw_a');
    assert.equal(readRecord({ is_user: false, extra: { storySuite: record() } })?.sid, 'sw_a', 'unstamped records are trusted');
});

test('writing stamps the shown swipe and keeps swipe_info in step, touching nothing else', () => {
    const message = { is_user: false, mes: 'B', swipe_id: 1, swipes: ['A', 'B'],
        swipe_info: [{ extra: { keep: 1 } }, { send_date: 'x' }], extra: { other: true } };
    const stored = writeRecord(message, record());
    assert.equal(stored.swipe, 1);
    assert.equal(message.extra.storySuite, stored);
    assert.equal(message.extra.other, true);
    assert.deepEqual(message.swipe_info[1], { send_date: 'x', extra: { storySuite: stored } });
    assert.notEqual(message.swipe_info[1].extra.storySuite, stored);
    assert.deepEqual(message.swipe_info[0], { extra: { keep: 1 } });
    const bare = { is_user: false, mes: 'C' };
    writeRecord(bare, record());
    assert.deepEqual(Object.keys(bare), ['is_user', 'mes', 'extra']);
    const shared = { is_user: false, swipe_id: 0, extra: {} };
    shared.swipe_info = [{ extra: shared.extra }];
    writeRecord(shared, record());
    assert.equal(shared.swipe_info[0].extra.storySuite, shared.extra.storySuite);
});

test('the saver needs a save function and serializes overlapping flushes', async () => {
    assert.throws(() => createSaver({}), TypeError);
    let active = 0;
    let most = 0;
    let saves = 0;
    const saver = createSaver({ save: async () => {
        active++; most = Math.max(most, active);
        await new Promise(resolve => setImmediate(resolve));
        active--; saves++;
    } });
    await saver.flush();
    assert.equal(saves, 0, 'nothing to save');
    saver.touch();
    const one = saver.flush();
    saver.touch();
    const two = saver.flush();
    await Promise.all([one, two]);
    assert.equal(most, 1);
    assert.ok(saves >= 1 && saves <= 2, `both changes go out in one or two saves (${saves})`);
    assert.equal(saver.dirty(), false);
    assert.equal(saver.pending(), false);
});

test('the saver asks verify around a save; a problem fails the save and keeps it dirty (SPEC §3.3)', async () => {
    const seen = [];
    let problem = 'the head does not hold rev 3';
    const saver = createSaver({
        save: async () => { seen.push('save'); },
        verify: { before: () => { seen.push('before'); return 'token'; }, after: token => { seen.push(`after ${token}`); return problem; } },
    });
    saver.touch();
    await assert.rejects(saver.flush(), /does not hold rev 3/);
    assert.deepEqual(seen, ['before', 'save', 'after token']);
    assert.equal(saver.dirty(), true);
    problem = '';
    await saver.flush();
    assert.equal(saver.dirty(), false);
    // A change made while the save runs is not checked now: the next save takes it, and checks it.
    seen.length = 0;
    let touchDuring = true;
    const busy = createSaver({ save: async () => { if (touchDuring) busy.touch(); touchDuring = false; }, verify: { before: () => 1, after: () => { seen.push('after'); return ''; } } });
    busy.touch();
    await busy.flush();
    assert.deepEqual(seen, [], 'not verified while a newer change waits');
    assert.equal(busy.dirty(), true);
    await busy.flush();
    assert.deepEqual(seen, ['after']);
    assert.equal(busy.dirty(), false);
});
