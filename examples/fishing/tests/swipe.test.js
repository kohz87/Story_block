import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSdk } from './helpers/fake-sdk.js';
import { mount, fakeTimers, flush } from './helpers/fake-dom.js';
import { fishingModule } from '../src/module.js';
import { resetFishingWidget } from '../src/widget.js';

// One cast is one fish even when the reply that narrates it is swiped: the commands run once, from
// the clicks; the reply only tells the receipt, and a swipe tells the same receipt again.
test('swiping the narration reply neither repeats the cast nor loses the catch', async () => {
    resetFishingWidget();
    const fake = createFakeSdk();
    const def = fishingModule(fake.sdk);
    fake.sdk.registerModule(def);
    fake.setPlace({ name: 'Moonfall Lake', kind: 'wild' });
    const el = mount();
    const timers = fakeTimers();
    const render = () => def.tabs[0].render(el, fake.view(), { command: fake.sdk.command, timers });
    fake.sdk.on('committed', render);
    fake.sdk.on('head', render);
    fake.sdk.on('turn', render);
    render();

    await el.find(['data-act', 'cast']).click();
    await flush();
    const session = Object.values(fake.head().domains.fishing.sessions)[0];
    await timers.advance(session.bite.bite + 1);
    await el.find(['data-act', 'reel']).click();
    await flush();

    const landed = fake.carriers[0].swipes[0].receipts.find(r => r.type === 'fishing.reel');
    assert.ok(landed.data.catch, 'the receipt carries the catch');
    assert.match(landed.summary, /lands/);

    const toldFirst = fake.reply();
    assert.deepEqual(toldFirst, [landed.id], 'the reply tells the landed fish (the cast itself is not narrated)');
    const toldAgain = fake.swipe();
    assert.deepEqual(toldAgain, [landed.id], 'the swiped reply tells it again');
    fake.swipe();
    render();

    const calls = type => fake.calls.filter(c => c.type === type).length;
    assert.equal(calls('fishing.cast'), 1);
    assert.equal(calls('fishing.reel'), 1);
    assert.equal(calls('inventory.grant'), 1);
    const stacks = Object.values(fake.head().domains.inventory.stacks);
    assert.equal(stacks.length, 1);
    assert.equal(stacks[0].qty, 1);
    assert.equal(fake.head().domains.fishing.log.length, 1);
    assert.equal(fake.head().domains.fishing.log[0].id, landed.data.catch.id);
    assert.equal(timers.pending(), 0);
});
