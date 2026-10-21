// B-b7-combos-1: a module that gains a domain in a newer version (or the host gaining a core domain)
// must not lose the data its existing domains already hold in a chat. Today `module.init.<id>`
// resets EVERY domain of the module when ANY one of them is missing (registry.js initHandler +
// sdk.js missingModules), so upgrading wipes the party / director / inventory of every old chat.
// Drop into Story_block/tests/v2/break/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../../testkit/index.js';

const v1Module = () => ({
    id: 'zz-upgrade',
    name: 'Upgrade',
    version: '1.0.0',
    domains: { roster: { initial: () => ({ members: {} }) } },
    commands: {
        'roster.add'(ctx, payload) {
            ctx.draft('roster').members[payload.name] = { level: 7 };
            return { summary: `${payload.name} joins.`, narrate: false };
        },
    },
    queries: { 'roster.members': state => state.domains.roster?.members ?? null },
});

// The same module one release later: one more domain (as RPG Battle gained `checks`, Story
// Director gained its atlas/chronicle parts).
const v2Module = () => {
    const def = v1Module();
    return { ...def, version: '1.1.0', domains: { ...def.domains, ledger: { initial: () => ({ lines: [] }) } } };
};

test('a module that gains a domain keeps the data of the domains the chat already has', async () => {
    const old = await createHost({ modules: [v1Module()] });
    assert.equal((await old.sdk.command('roster.add', { name: 'Ren' })).ok, true);
    await old.send('Hello', 'Hi.');
    assert.deepEqual(old.sdk.query('roster.members'), { Ren: { level: 7 } });
    const chat = structuredClone(old.ctx.chat);
    old.close();

    // The reader updates the extension and reopens the same chat.
    const upgraded = await createHost({ modules: [v2Module()], st: { chat } });
    assert.ok(upgraded.head().domains.ledger, 'the new domain is added');
    assert.deepEqual(upgraded.sdk.query('roster.members'), { Ren: { level: 7 } }, 'the existing roster must survive the upgrade');
    upgraded.close();
});

test('the core module gaining a domain keeps the chat inventory (host upgrade)', async () => {
    const old = await createHost({ modules: [] });
    await old.send('Look', 'A rope.\n<Changes>\n+ item Rope | qty: 2\n</Changes>');
    const stacks = Object.values(old.head().domains.inventory.stacks).map(stack => stack.qty);
    assert.deepEqual(stacks, [2]);
    const chat = structuredClone(old.ctx.chat);
    old.close();

    // Simulate a host whose core state lacks one of its domains in an old chat: drop `scene` from
    // every stored checkpoint, as a chat written before that domain existed would be.
    for (const message of chat) {
        const record = message.extra?.storySuite;
        if (record?.checkpoint) delete record.checkpoint.domains.scene;
        for (const info of message.swipe_info ?? []) if (info?.extra?.storySuite?.checkpoint) delete info.extra.storySuite.checkpoint.domains.scene;
        if (record?.ops) record.ops = record.ops.filter(op => !op.path.startsWith('/domains/scene'));
    }
    const upgraded = await createHost({ modules: [], st: { chat } });
    assert.ok(upgraded.head().domains.scene, 'the missing core domain is added');
    assert.deepEqual(Object.values(upgraded.head().domains.inventory.stacks).map(stack => stack.qty), [2], 'the inventory must survive');
    upgraded.close();
});
