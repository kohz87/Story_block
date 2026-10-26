// Worked example B of docs/v2/DATA_MODULES.md (hunger and fatigue on Story Director's story time) against the
// real Story Director, side by side (skipped without it, like the other suite tests): Setup actor and clock,
// pin and attach, the doc's six-hour rest, the later two-hour tick, the meal, refusals and the lifecycle cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reply, fixture, success, view } from './helpers.js';
import { createHost } from '../../../testkit/index.js';

let suite = null;
try { suite = await import('../break/helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;

const ID = 'pack.ersveil-survival/survival';
const REST = (hours = 6) => `! dm pack.ersveil-survival/survival — slept at the camp | kind: rest | who: Wessel | hours: ${hours}`;
const MEAL = '! dm pack.ersveil-survival/survival — ate supper | kind: meal | who: Wessel';
const needs = host => { const [row] = view(host, ID).characters; return [row.hunger, row.fatigue]; };
const timer = host => Object.values(host.head().domains.dataModules.instances[ID].characters)[0].timers.needs;
const kinds = host => host.store.problems().map(problem => problem.code);
const reload = async host => {
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live head');
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a cold rebuild gives the live head');
};

async function camp(t, { attachLater = false } = {}) {
    const SD = await import(new URL('Story_director/src/v2/module.js', `file://${suite.ROOT}/`).href);
    let sdk = null;
    const sd = SD.createModule({ host: { settings: id => sdk?.settings(id) ?? null, substitute: text => sdk?.substitute(text) } });
    const host = await createHost({ modules: [sd] });
    sdk = host.sdk; t.after(() => host.close());
    success(await host.packs.packs.install(fixture('survival')));
    success(await host.sdk.command('checks.actor', { write: 'wr_wessel01', name: 'Wessel', expectedHash: host.sdk.query('checks.policy').hash }));
    await host.send('Begin.', reply('~ time March 2, 1000, 06:00 am'));
    const T = host.head().domains.director.time.minutes;
    const offer = host.sdk.query('dataModules.offers')[0];
    const wessel = Object.keys(host.sdk.query('checks.policy').actors)[0];
    success(await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash, subjects: attachLater ? [] : [wessel] }));
    if (attachLater) success(await host.sdk.command('dm.attach', { module: offer.module, who: 'Wessel' }));
    return { host, T, wessel, offer };
}

test('B: the doc\'s rest: 12/6 before, recovery clamps fatigue to 0, baseline T+360; the later +2h gives 16/2 and the meal 0/2', { skip }, async t => {
    const { host, T } = await camp(t);
    assert.deepEqual(needs(host), [0, 0]);
    assert.deepEqual(timer(host), { lastMinute: T, remainder: 0 });
    await host.send('Rest.', reply('! time +6h', REST()));
    assert.deepEqual(needs(host), [12, 0]);
    assert.deepEqual(timer(host), { lastMinute: T + 360, remainder: 0 });
    const record = host.ctx.chat.at(-1).extra.storySuite;
    assert.equal(record.receipts.filter(receipt => receipt.type === 'dm.tick').length, 0, 'afterCapture finds no further interval');
    await host.send('Later.', reply('! time +2h'));
    assert.deepEqual(needs(host), [16, 2], 'through that reply\'s tick');
    const tick = host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'dm.tick');
    assert.ok(tick && tick.afterCapture === true && tick.replan, 'a system step of that reply, planned again on a change before it');
    await host.send('Supper.', reply(MEAL));
    assert.deepEqual(needs(host), [0, 2]);
    assert.deepEqual(host.store.problems(), []);
    await reload(host);
});

test('B: attached later at the current minute: no retroactive hunger', { skip }, async t => {
    const { host, T } = await camp(t, { attachLater: true });
    assert.deepEqual(needs(host), [0, 0]);
    assert.equal(timer(host).lastMinute, T);
    await host.send('Rest.', reply('! time +6h', REST()));
    assert.deepEqual(needs(host), [12, 0]);
});

test('B: hours 9 refuses the entire rest line (the +6h time line, a different line, stays)', { skip }, async t => {
    const { host, T } = await camp(t);
    await host.send('Rest.', reply('! time +6h', REST(9)));
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_LABEL' && /hours/.test(problem.message)));
    // The tick still settles the elapsed time: only the rest line was refused.
    assert.deepEqual(needs(host), [12, 6]);
    assert.equal(host.head().domains.director.time.minutes, T + 360);
});

test('B: swiping away the six-hour reply removes its SD advance, timer settlement and recovery together', { skip }, async t => {
    const { host, T } = await camp(t);
    await host.send('Rest.', reply('! time +6h', REST()));
    const at = host.ctx.chat.length - 1;
    await host.swipe(reply('Nothing happens.'));
    assert.equal(host.head().domains.director.time.minutes, T);
    assert.deepEqual(needs(host), [0, 0]);
    assert.deepEqual(timer(host), { lastMinute: T, remainder: 0 });
    await reload(host);
    assert.equal(host.ctx.chat.length - 1, at);
});

test('B: a delete before a later tick re-plans that tick on the new interval (same step, same seed, no roll)', { skip }, async t => {
    const { host, T } = await camp(t);
    await host.send('One hour.', reply('! time +1h'));
    const first = host.ctx.chat.length - 1;
    await host.send('Three hours.', reply('! time +3h'));
    const second = host.ctx.chat.length - 1;
    assert.deepEqual(needs(host), [8, 4]);
    const seed = host.ctx.chat[second].extra.storySuite.receipts.find(receipt => receipt.type === 'dm.tick').seed;
    await host.st.deleteMessage(first);
    assert.equal(host.head().domains.director.time.minutes, T + 180);
    assert.deepEqual(needs(host), [6, 3], 'three periods from T');
    const again = host.ctx.chat[second - 1].extra.storySuite.receipts.find(receipt => receipt.type === 'dm.tick');
    assert.equal(again.seed, seed);
    assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
    await reload(host);
});

test('B: a delete that removes all the elapsed time takes the tick away (NO_LONGER_DONE), no empty step is left', { skip }, async t => {
    const { host, T } = await camp(t);
    await host.send('One hour.', reply('! time +1h'));
    const first = host.ctx.chat.length - 1;
    await host.st.deleteMessage(first);
    assert.deepEqual(needs(host), [0, 0]);
    assert.equal(host.head().domains.director.time.minutes, T);
    await reload(host);
});

test('B: a meal that read the hunger before an earlier tick was deleted waits for a Re-read, and Re-read recomputes from the new start', { skip }, async t => {
    const { host } = await camp(t);
    await host.send('Rest.', reply('! time +6h', REST()));
    const rest = host.ctx.chat.length - 1;
    await host.send('Later.', reply('! time +2h'));
    const later = host.ctx.chat.length - 1;
    await host.send('Supper.', reply(MEAL));
    const meal = host.ctx.chat.length - 1;
    assert.deepEqual(needs(host), [0, 2]);
    await host.st.deleteMessage(later);
    // The +2h tick is gone; the meal read 16 hunger and now finds 12.
    assert.deepEqual(needs(host), [12, 0]);
    assert.deepEqual(kinds(host), ['REPLAY_PREREQUISITE']);
    success(await host.turn.reread(meal - 1));
    assert.deepEqual(needs(host), [0, 0]);
    assert.deepEqual(kinds(host), []);
    assert.ok(rest < later);
    await reload(host);
});

test('B: a backwards story-time edit accrues nothing and keeps the high-water minute; going forward again resumes only past it', { skip }, async t => {
    const { host, T } = await camp(t);
    await host.send('Hours.', reply('! time +3h'));
    assert.deepEqual(needs(host), [6, 3]);
    await host.send('Back.', reply('~ time March 2, 1000, 07:00 am'));
    assert.deepEqual(needs(host), [6, 3], 'absolute backwards edit: nothing accrues');
    assert.deepEqual(timer(host), { lastMinute: T + 180, remainder: 0 });
    await host.send('Forward, but not past it.', reply('! time +1h'));
    assert.deepEqual(needs(host), [6, 3], 'still behind the high-water minute');
    await host.send('Past it.', reply('! time +3h'));
    assert.deepEqual(needs(host), [10, 5], 'only the two hours past the high-water minute count');
    await reload(host);
});
