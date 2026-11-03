// Rule lines on the reply card: a fired rule that changed nothing is not shown; one that changed fields shows one line per field,
// "<Block> <field>: <new value>", the block by its screen title (else its name), the field by the screen's label (else humanized).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecord } from '../../../src/v2/persist.js';
import { replyRules } from '../../../src/v2/reply-cards.js';
import { changesSummary } from '../../../src/v2/screens/changes-card.js';
import { world, pin, reply, pack, int, reload } from './helpers.js';

const bind = (module, path) => ({ query: 'dataModules.view', args: { module }, path });
function guild(withScreen) {
    return { slug: 'guild', name: 'Guild membership', schema: 1, stateVersion: 1, scope: 'chat',
        state: {
            registered: { type: 'bool', default: false },
            standing: { type: 'enum', values: ['unregistered', 'probation', 'good'], default: 'unregistered' },
            dues: int(50, 0, 500), 'member-years': int(0, 0, 99),
        },
        kinds: {
            register: { op: '+', labels: {}, effects: [{ op: 'set', path: ['registered'], value: true }] },
            note: { op: '+', labels: {}, effects: [] },
        },
        rules: [
            { id: 'dues-flat', when: ['eq', ['get', ['registered']], true], then: [{ op: 'set', path: ['dues'], value: 50 }] },
            { id: 'probation', when: ['and', ['eq', ['get', ['registered']], true], ['eq', ['get', ['member-years']], 0]], then: [{ op: 'set', path: ['standing'], value: 'probation' }] },
            { id: 'years', when: ['eq', ['get', ['registered']], true], then: [{ op: 'set', path: ['member-years'], value: 0 }, { op: 'set', path: ['dues'], value: 60 }] },
        ],
        ...(withScreen ? { screens: [{ id: 'guild-screen', title: 'Guild', icon: 'fa-id-badge', mounts: ['tab', 'card'], layout: { root: { type: 'col', children: [
            { type: 'badge', label: 'Standing', bind: bind('pack.dm-test/guild', 'chat.standing') },
        ] } } }] } : {}),
    };
}
const linesAt = (host, index) => {
    const record = readRecord(host.ctx.chat[index]);
    return replyRules(record, host.store.problems(), index, { state: host.store.at(index), before: index > 0 ? host.store.at(index - 1) : null });
};

test('a rule that changed nothing is silent; one that changed fields has a line per field, in the screen\'s words', async t => {
    const host = await world(t, pack([guild(true)]));
    await pin(host);
    await host.send('Sign.', reply('+ dm guild — Registered | kind: register'));
    const head = host.store.headIndex();
    const lines = linesAt(host, head);
    // Rule order. member-years was set to 0 = 0 (nothing); dues 50 is 60 after the reply, standing is probation.
    assert.deepEqual(lines.map(line => line.text), ['Guild dues: 60', 'Guild standing: probation']);
    assert.ok(lines.every(line => line.kind === 'line' && line.tone === 'accent' && line.icon === 'fa-bolt'));
    assert.ok(lines.every(line => line.summary === line.text));
    assert.doesNotMatch(changesSummary({ lines }), /Rule:|dues-flat/);
    assert.match(changesSummary({ lines }), /Guild dues: 60 · Guild standing: probation/);
    // A second reply: the rules fire again, change nothing now.
    await host.send('Again.', reply('+ dm guild — Still | kind: note'));
    assert.deepEqual(linesAt(host, host.store.headIndex()).map(line => line.text), []);
    // Reload and rebuild tell the same.
    await reload(host);
    assert.deepEqual(linesAt(host, head).map(line => line.text), ['Guild dues: 60', 'Guild standing: probation']);
});

test('a block with no screen is named by its name and a field by its humanized id', async t => {
    const host = await world(t, pack([guild(false)]));
    await pin(host);
    await host.send('Sign.', reply('+ dm guild — Registered | kind: register'));
    assert.deepEqual(linesAt(host, host.store.headIndex()).map(line => line.text), ['Guild membership dues: 60', 'Guild membership standing: probation']);
});

test('a map field changed by a rule is told by its key, with the screen label when one binds the key', async t => {
    const d = { slug: 'rep', name: 'Reputation', schema: 1, stateVersion: 1, scope: 'chat',
        state: { standing: { type: 'map', keys: ['guild', 'watch'], values: int(0, -5, 5) }, seen: { type: 'bool', default: false } },
        kinds: { see: { op: '+', labels: {}, effects: [{ op: 'set', path: ['seen'], value: true }] } },
        rules: [{ id: 'bump', when: ['eq', ['get', ['seen']], true], then: [{ op: 'set', path: ['standing', 'guild'], value: 2 }, { op: 'set', path: ['standing', 'watch'], value: 0 }] }],
        screens: [{ id: 'rep-screen', title: 'Standing', icon: 'fa-flag', mounts: ['tab', 'card'], layout: { root: { type: 'col', children: [
            { type: 'text', label: 'Guild', bind: bind('pack.dm-test/rep', 'chat.standing.guild') }] } } }] };
    const host = await world(t, pack([d]));
    await pin(host);
    await host.send('See.', reply('+ dm rep — Seen | kind: see'));
    assert.deepEqual(linesAt(host, host.store.headIndex()).map(line => line.text), ['Standing guild: 2']);
});
