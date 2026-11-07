import test from 'node:test';
import assert from 'node:assert/strict';
import { referencedCheckpoints } from '../../../src/v2/timeline/referenced.js';
import { createHost } from '../../../testkit/index.js';

const json = value => ({
    ok: true,
    status: 200,
    async json() { return structuredClone(value); },
});

const archive = () => ({
    v: 1,
    journal: {
        make: {
            kind: 'make',
            participants: [{ module: 'npc-state-delta', checkpoint: 'nk_journal01', hash: 'h' }],
            desired: { 'npc-state-delta': { checkpoint: 'nk_desired1' } },
            slots: { 'npc-state-delta': { checkpoint: 'nk_slots001', ack: true } },
        },
        restore: { kind: 'restore', before: [{ checkpoint: 'nk_restore1' }] },
        native: { kind: 'native-mutation', before: { checkpoint: 'nk_natbefore' }, after: { checkpoint: 'nk_natafter' } },
        selection: { kind: 'selection', desired: { 'npc-state-delta': { checkpoint: 'nk_select02' } } },
        open: { kind: 'restore', phase: 'prepared', return: { checkpoint: 'nk_open0001' } },
    },
    prefix: {
        'npc-state-delta': {
            key: {
                before: { checkpoint: 'nk_before01' },
                after: { checkpoint: 'nk_after001' },
            },
        },
    },
    selection: { 'npc-state-delta': { checkpoint: 'nk_select01' } },
    baseline: { 'npc-state-delta': { checkpoint: 'nk_base0001' } },
    snapshots: { sp_1: { participants: [{ checkpoint: 'nk_snap0001' }] } },
    payloads: { hash1: { payload: { participants: [{ checkpoint: 'nk_payload1' }] }, proofs: {} } },
    pins: { batchResults: { br_1: { checkpoint: 'nk_pin00001' } } },
});

const chat = timeline => [{ chat_metadata: { storySuite: { timeline } } }, { mes: 'hello' }];

test('the reference scan counts every journal and archive field that names a checkpoint', async () => {
    const answer = await referencedCheckpoints({
        context: () => ({}),
        list: () => [{ label: 'Ann / one', kind: 'character', name: 'Ann', avatar: 'ann.png', id: 'one' }],
        read: () => chat(archive()),
    });
    assert.equal(answer.complete, true);
    assert.deepEqual(answer.unreadable, []);
    assert.deepEqual(answer.referenced, [
        'nk_after001', 'nk_base0001', 'nk_before01', 'nk_desired1', 'nk_journal01', 'nk_natafter',
        'nk_natbefore', 'nk_open0001', 'nk_payload1', 'nk_pin00001', 'nk_restore1', 'nk_select01',
        'nk_select02', 'nk_slots001', 'nk_snap0001',
    ]);
});

test('one unreadable chat makes the answer incomplete and keeps the readable chats\' references', async () => {
    const answer = await referencedCheckpoints({
        context: () => ({}),
        list: () => [{ label: 'Ann / one' }, { label: 'Bo / two' }],
        read: chatName => {
            if (chatName.label === 'Bo / two') throw new Error('the file is gone');
            return chat(archive());
        },
    });
    assert.equal(answer.complete, false);
    assert.deepEqual(answer.unreadable, [{ chat: 'Bo / two', reason: 'the file is gone' }]);
    assert.ok(answer.referenced.includes('nk_journal01'));
});

test('a chat from a newer timeline schema makes the answer incomplete and says why', async () => {
    const newer = { ...archive(), v: 2 };
    const answer = await referencedCheckpoints({
        context: () => ({}),
        list: () => [{ label: 'Ann / one' }],
        read: () => chat(newer),
    });
    assert.equal(answer.complete, false);
    assert.equal(answer.unreadable.length, 1);
    assert.match(answer.unreadable[0].reason, /newer version/);
});

test('an empty or malformed chat file cannot be read, so the answer is incomplete', async () => {
    const empty = await referencedCheckpoints({
        context: () => ({}),
        list: () => [{ label: 'Ann / empty' }],
        read: () => [],
    });
    assert.equal(empty.complete, false);
    assert.match(empty.unreadable[0].reason, /empty/);
    const malformed = await referencedCheckpoints({
        context: () => ({}),
        list: () => [{ label: 'Ann / broken' }],
        read: () => 'not a chat file',
    });
    assert.equal(malformed.complete, false);
    assert.match(malformed.unreadable[0].reason, /parsed/);
});

test('the default list walks character chat files and every group chat, and the open chat is read live', async () => {
    const context = {
        characters: [{ name: 'Ann', avatar: 'ann.png' }, { name: 'Bo', avatar: 'bo.png' }],
        groups: [{ id: 'grp_1', name: 'Party', chats: ['group-one'], chat_id: 'group-two' }],
        getRequestHeaders: () => ({ 'X-Test': 'yes' }),
        chatMetadata: { storySuite: { timeline: { v: 1, journal: { live: { checkpoint: 'nk_live0001' } } } } },
    };
    const requests = [];
    const fetchFn = async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, body });
        if (url === '/api/characters/chats') {
            return json([{ file_name: `${body.avatar_url === 'ann.png' ? 'ann-chat' : 'bo-chat'}.jsonl`, file_id: body.avatar_url === 'ann.png' ? 'ann-chat' : 'bo-chat' }]);
        }
        if (url === '/api/chats/get') return json(chat({ v: 1, journal: { one: { checkpoint: `nk_${body.file_name}` } } }));
        if (url === '/api/chats/group/get') return json(chat({ v: 1, journal: { one: { checkpoint: `nk_${body.id}` } } }));
        throw new Error(`unexpected ${url}`);
    };
    const answer = await referencedCheckpoints({ context: () => context, fetchFn });
    assert.equal(answer.complete, true);
    assert.deepEqual(answer.referenced, [
        'nk_ann-chat', 'nk_bo-chat', 'nk_group-one', 'nk_group-two', 'nk_live0001',
    ]);
    assert.deepEqual(requests.map(call => call.url), [
        '/api/characters/chats', '/api/characters/chats', '/api/chats/get', '/api/chats/get',
        '/api/chats/group/get', '/api/chats/group/get',
    ]);
});

test('the public query is asynchronous and reads the open chat metadata', async t => {
    const host = await createHost();
    t.after(() => host.close());
    const before = globalThis.SillyTavern;
    globalThis.SillyTavern = { getContext: () => host.ctx };
    t.after(() => {
        if (before === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = before;
    });
    host.ctx.characters = [];
    host.ctx.groups = [];
    host.ctx.getRequestHeaders = () => ({});
    host.ctx.chatMetadata = { storySuite: { timeline: { v: 1, journal: { live: { checkpoint: 'nk_live0001' } } } } };
    const answer = await host.sdk.query('timeline.referenced', {});
    assert.equal(answer.complete, true);
    assert.deepEqual(answer.referenced, ['nk_live0001']);
});
