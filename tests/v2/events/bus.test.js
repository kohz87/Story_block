// The events part on the real command bus (src/v2/commands.js) with the bus tests' store and registry
// stand-ins: receipts, claims, then-commands and rollback as the host will run them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandBus } from '../../../src/v2/commands.js';
import { createEventsPart } from '../../../src/v2/events/index.js';
import { counterIds, fakeRegistry, fakeStore } from '../helpers/bus-fakes.js';

const INITIAL = {
    v: 2,
    meta: { rev: 0, claims: {} },
    domains: {
        inventory: { defs: {}, stacks: {}, wallets: { party: { cp: 0 } }, aliases: {} },
        director: { time: { minutes: 600 } },
    },
};

function setup(defs) {
    const store = fakeStore(INITIAL);
    let bus = null;
    const part = createEventsPart({
        events: () => defs,
        command: (type, payload, options) => bus.command(type, payload, options),
        query: () => null,
    });
    const registry = fakeRegistry([{
        id: 'story-block',
        domains: { inventory: {}, director: {} },
        commands: {
            ...part.commands,
            'wallet.receive'(ctx, { amount }) {
                if (!Number.isInteger(amount) || amount < 1) ctx.fail('INVALID', 'An amount must be a whole number from 1.');
                ctx.draft('inventory').wallets.party.cp += amount;
                return { summary: `+${amount} cp` };
            },
        },
        queries: part.queries,
    }]);
    bus = createCommandBus({ store, registry, id: counterIds(), seed: () => 7 });
    const view = () => ({ state: store.head(), query: () => null, settings: {}, chat: { length: 2, lastUser: '' } });
    return { store, part, view };
}

test('real bus: a due event becomes one system receipt with the cue, its claim and its then-commands', () => {
    const { store, part, view } = setup([
        { id: 'pack.demo/gate', when: 'time() >= 480', cue: 'The gate opens at dawn.', then: [{ command: 'wallet.receive', payload: { amount: 12 } }] },
        { id: 'pack.demo/camp', after: 'pack.demo/gate', when: 'true', cue: 'Smoke from the camp.' },
    ]);
    assert.equal(part.hooks.beforeGenerate(view()), undefined);
    assert.equal(store.appended.length, 1);
    const { receipt } = store.appended[0];
    assert.equal(receipt.type, 'events.fire');
    assert.equal(receipt.module, 'story-block');
    assert.equal(receipt.cause, 'system');
    assert.equal(receipt.summary, 'The gate opens at dawn.');
    assert.equal(receipt.narrate, true);
    assert.equal(store.head().meta.claims['event:pack.demo/gate'], true);
    assert.equal(store.head().domains.inventory.wallets.party.cp, 12);
    const afterGate = store.head();

    part.hooks.beforeGenerate(view());
    assert.deepEqual(store.appended.map(entry => entry.receipt.summary), ['The gate opens at dawn.', 'Smoke from the camp.']);
    part.hooks.beforeGenerate(view());
    assert.equal(store.appended.length, 2, 'both claimed: nothing more');
    assert.deepEqual(part.queries['events.status'](store.head()).fired, ['pack.demo/camp', 'pack.demo/gate']);

    // Swipe away the carrier that told the camp: the head goes back to just after the gate.
    store.replaceHead(afterGate);
    assert.deepEqual(part.queries['events.status'](store.head()).due, ['pack.demo/camp']);
    part.hooks.beforeGenerate(view());
    assert.equal(store.appended.at(-1).receipt.summary, 'Smoke from the camp.', 'it can happen again on the new line');
    assert.equal(store.head().domains.inventory.wallets.party.cp, 12, 'the gate did not pay twice');
});

test('real bus: a refused then-command leaves nothing behind and is reported', () => {
    const { store, part, view } = setup([
        { id: 'bad', when: 'true', cue: 'x', then: [{ command: 'wallet.receive', payload: { amount: 5 } }, { command: 'wallet.receive', payload: { amount: 0 } }] },
        { id: 'ghost', when: 'true', cue: 'y', then: [{ command: 'no.such.command' }] },
    ]);
    part.hooks.beforeGenerate(view());
    assert.equal(store.appended.length, 0);
    assert.deepEqual(store.head(), INITIAL);
    const { lastRun } = part.queries['events.status'](store.head());
    assert.deepEqual(lastRun.fired, []);
    assert.deepEqual(lastRun.failed.map(entry => [entry.id, entry.code]), [['bad', 'INVALID'], ['ghost', 'UNKNOWN_COMMAND']]);
});
