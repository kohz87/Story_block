// The all-domain payload and version manifest (contract §8; docs/v2/TIMELINE.md): every registry domain is captured, none
// by a list kept by hand, and a restore says where each domain came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { capture, planRestore, registered } from '../../src/v2/timeline/index.js';
import { RULES, clone, nativeModule, reload, restore, rulesModule, sealerModule } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const image = host => ({ chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) });
const payloadOf = (host, snapshot) => host.ctx.chatMetadata.storySuite.timeline.payloads[snapshot.payloadHash].payload;

// A module with a domain nobody in the host has heard of (the test domain), one command that changes it.
const brandNew = (domain = 'zz-brand-new', extra = {}) => ({
    id: `mod-${domain}`, name: 'Brand new', version: '1.0.0',
    domains: { [domain]: { initial: () => ({ n: 0 }), ...extra } },
    commands: { [`${domain}.bump`](ctx) { ctx.draft(domain).n += 1; return { summary: 'bumped', narrate: false }; } },
});

test('every registry domain is captured, including one registered a moment ago; no list of domains is kept by hand', async t => {
    const host = await createHost({ modules: [rulesModule(), nativeModule().def] });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ coin 5']));
    const first = (await host.sdk.timeline.make({ kind: 'manual', name: 'One' })).snapshot;
    const names = registered(host.registry).filter(item => host.registry.module(item.owner).domains[item.name].snapshot !== 'when-present').map(item => item.name);
    assert.deepEqual(names.filter(name => !Object.hasOwn(payloadOf(host, first).domains, name)), [], 'every registered domain is in the payload');
    assert.deepEqual(Object.keys(payloadOf(host, first).domains).sort(), [...Object.keys(host.head().domains)].filter(name => name !== 'savepoints').sort());
    for (const core of ['inventory', 'scene']) assert.equal(Object.hasOwn(payloadOf(host, first).domains, core), true, core);
    assert.deepEqual(['director', 'party', 'progress', 'gear', 'combat', 'training', 'npc', 'rules', 'nat'].filter(name => !names.includes(name)), []);
    // A module that registers a new domain after the first save: the next save has it, the first does not.
    await host.sdk.registerModule(brandNew());
    await host.sdk.command('zz-brand-new.bump');
    const second = (await host.sdk.timeline.make({ kind: 'manual', name: 'Two' })).snapshot;
    assert.equal(Object.hasOwn(payloadOf(host, first).domains, 'zz-brand-new'), false);
    assert.deepEqual(payloadOf(host, second).domains['zz-brand-new'], { n: 1 });
    assert.equal(registered(host.registry).some(item => item.name === 'zz-brand-new'), true);
    assert.deepEqual(Object.keys(payloadOf(host, second).domains).sort(), Object.keys(host.head().domains).sort(),
        'the second save holds every domain, the first save\'s savepoints included');
    assert.deepEqual(payloadOf(host, second).domains.savepoints.points[first.id].id, first.id);
    assert.deepEqual(payloadOf(host, second).domainVersions['zz-brand-new'], 1);
    for (const name of Object.keys(payloadOf(host, second).domains)) assert.equal(Number.isInteger(payloadOf(host, second).domainVersions[name]), true, `${name} has a version`);
});

test('capture: the payload of the contract, the proof pins beside it, and what the registry and the state do not agree on', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ coin 5']));
    await host.sdk.command('tl.claim', { key: 'k1' });
    const state = clone(host.head());
    // A domain of a module that is gone, and a registered domain the state does not hold yet.
    state.domains.ghost = { left: true };
    delete state.domains.gear;
    state.meta.proofs = { pf_abcdefgh: 'f'.repeat(64) };
    const { payload, proofs, manifest } = capture({ registry: host.registry, state, settings: id => (id === RULES ? { rank: 'gold', ui: 'dark' } : {}) });
    assert.deepEqual(Object.keys(payload).sort(), ['domainVersions', 'domains', 'effectiveSettings', 'participants', 'schema', 'storyClaims']);
    assert.equal(payload.schema, 2);
    assert.deepEqual(payload.domains.ghost, { left: true }, 'an orphan is data too');
    assert.equal(Object.hasOwn(payload.domains, 'gear'), false);
    assert.deepEqual(manifest.absent, ['gear']);
    assert.deepEqual(manifest.orphans, ['ghost']);
    assert.equal(manifest.held.includes('party'), true);
    assert.deepEqual(payload.storyClaims, { k1: true });
    assert.deepEqual(proofs, { pf_abcdefgh: 'f'.repeat(64) });
    assert.deepEqual(payload.participants, []);
    assert.deepEqual(payload.effectiveSettings, {}, 'no module named rule settings');
    assert.equal(payload.domainVersions.ghost, 1);
    // The payload is a copy: changing it does not change the story.
    payload.domains.party.pools.hp = 0;
    assert.equal(host.head().domains.party.pools.hp, 20);
});

test('capture: a module that names its rule settings has them saved with the payload', async t => {
    const def = rulesModule();
    def.settings = { defaults: { difficulty: 'normal', theme: 'dark' }, rules: ['difficulty', 'missing'] };
    const host = await createHost({ modules: [def], settings: { modules: { [RULES]: { difficulty: 'hard', theme: 'light' } } } });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.'));
    const made = (await host.sdk.timeline.make({ kind: 'manual' })).snapshot;
    assert.deepEqual(payloadOf(host, made).effectiveSettings, { [RULES]: { difficulty: 'hard' } }, 'the rules, not the reader\'s theme');
});

test('restore: a domain saved by an older version is migrated, one with no migration is not restored, a newer one cannot be read', async t => {
    const v1 = { id: 'tl-versioned', name: 'Versioned', version: '1.0.0', domains: { vv: { initial: () => ({ n: 1 }) } }, commands: { 'vv.bump'(ctx) { ctx.draft('vv').n += 1; return { summary: 'bumped', narrate: false }; } } };
    const host = await createHost({ modules: [v1, sealerModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('x'));
    await host.sdk.command('vv.bump');
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'v1' })).snapshot;
    await host.sdk.command('vv.bump');
    const stored = image(host);
    const v2 = (extra = {}) => ({ ...v1, version: '2.0.0', domains: { vv: { version: 2, initial: () => ({ n: 1, label: 'new' }), ...extra } } });
    // No migration: the save cannot be brought forward.
    const without = await reload(createHost, stored, [v2(), sealerModule()]);
    t.after(() => without.close());
    const refused = await restore(without, saved.id);
    assert.equal(refused.prepared.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(refused.prepared.message, /version 1, this is 2.*migrate/);
    assert.equal(without.head().domains.vv.n, 3, 'nothing was restored');
    // With one: the saved slice goes through it, and the manifest says so.
    const withMigrate = await reload(createHost, stored, [v2({ migrate: (slice, { from, to }) => ({ ...slice, label: `from ${from} to ${to}` }) }), sealerModule()]);
    t.after(() => withMigrate.close());
    const done = await restore(withMigrate, saved.id);
    assert.equal(done.activated.status, 'complete', done.prepared.message);
    assert.deepEqual(clone(withMigrate.head().domains.vv), { n: 2, label: 'from 1 to 2' });
    const manifest = withMigrate.timeline.host.journal().findLast(entry => entry.kind === 'restore').manifest;
    assert.equal(manifest.domains.vv.source, 'migrated');
    assert.equal(manifest.domains.vv.version, 2);
    // A migration that throws, or answers nothing, is a save that cannot be used.
    const broken = await reload(createHost, stored, [v2({ migrate: () => { throw new Error('no way'); } }), sealerModule()]);
    t.after(() => broken.close());
    assert.match((await restore(broken, saved.id)).prepared.message, /no way/);
    const empty = await reload(createHost, stored, [v2({ migrate: () => 7 }), sealerModule()]);
    t.after(() => empty.close());
    assert.equal((await restore(empty, saved.id)).prepared.code, 'SNAPSHOT_UNAVAILABLE');
    // A save made by version 3 cannot be read by version 2.
    const v3 = { ...v1, version: '3.0.0', domains: { vv: { version: 3, initial: () => ({ n: 1 }) } } };
    const newest = await createHost({ modules: [v3, sealerModule()] });
    t.after(() => newest.close());
    await newest.send('Hello.', reply('x'));
    const later = (await newest.sdk.timeline.make({ kind: 'manual', name: 'v3' })).snapshot;
    await newest.sdk.command('vv.bump');
    const older = await reload(createHost, image(newest), [v2({ migrate: slice => slice }), sealerModule()]);
    t.after(() => older.close());
    const unread = await restore(older, later.id);
    assert.equal(unread.prepared.code, 'SNAPSHOT_UNAVAILABLE', unread.prepared.message);
    assert.match(unread.prepared.message, /newer version/);
    assert.equal(older.head().domains.vv.n, 2);
});

test('restore: a domain that came after the save is brought to its own default, or the save cannot be used', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('x'));
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Before' })).snapshot;
    await host.sdk.command('tl.xp', { amount: 5 });
    const stored = image(host);
    // A module with a new domain arrives after the save and says nothing of how to go back without it.
    const silent = await reload(createHost, stored, [rulesModule(), brandNew('later')]);
    t.after(() => silent.close());
    await silent.sdk.command('later.bump');
    const held = await restore(silent, saved.id);
    assert.equal(held.prepared.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(held.prepared.message, /later/);
    assert.equal(silent.head().domains.later.n, 1, 'the later domain is not touched by a restore that cannot be done');
    // With `absent()` it is set to that default and the manifest records it.
    const kind = await reload(createHost, stored, [rulesModule(), brandNew('later', { absent: () => ({ n: -1 }) })]);
    t.after(() => kind.close());
    await kind.sdk.command('later.bump');
    const done = await restore(kind, saved.id);
    assert.equal(done.activated.status, 'complete', done.prepared.message);
    assert.deepEqual(clone(kind.head().domains.later), { n: -1 });
    assert.equal(kind.head().domains.progress.xp, 0);
    assert.equal(kind.timeline.host.journal().findLast(entry => entry.kind === 'restore').manifest.domains.later.source, 'default');
});

test('restore: a domain of a module that is gone comes back as saved; one made after the save by a module that is gone is removed', async t => {
    const mod = brandNew('guest');
    const host = await createHost({ modules: [rulesModule(), mod] });
    t.after(() => host.close());
    await host.send('Hello.', reply('x'));
    await host.sdk.command('guest.bump');
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'With the guest' })).snapshot;
    await host.sdk.command('guest.bump');
    const stored = image(host);
    // The guest module is not installed any more: its slice is an orphan in the story, and still data.
    const away = await reload(createHost, stored, [rulesModule()]);
    t.after(() => away.close());
    assert.equal(away.head().domains.guest.n, 2);
    const done = await restore(away, saved.id);
    assert.equal(done.activated.status, 'complete', done.prepared.message);
    assert.deepEqual(clone(away.head().domains.guest), { n: 1 }, 'the orphan goes back to what it was');
    assert.equal(away.timeline.host.journal().findLast(entry => entry.kind === 'restore').manifest.domains.guest.source, 'orphan');
    // An orphan the save never held is data from after the save: it goes.
    const later = await reload(createHost, stored, [rulesModule()]);
    t.after(() => later.close());
    const first = (await later.sdk.timeline.make({ kind: 'manual', name: 'Without a module' })).snapshot;
    const arrived = await reload(createHost, image(later), [rulesModule(), brandNew('stray')]);
    t.after(() => arrived.close());
    await arrived.sdk.command('stray.bump');
    const gone = await reload(createHost, image(arrived), [rulesModule()]);
    t.after(() => gone.close());
    assert.equal(gone.head().domains.stray.n, 1);
    const result = await restore(gone, first.id);
    assert.equal(result.activated.status, 'complete', result.prepared.message);
    assert.equal(Object.hasOwn(gone.head().domains, 'stray'), false, 'nothing after the save is kept');
    assert.equal(gone.timeline.host.journal().findLast(entry => entry.kind === 'restore').manifest.domains.stray.source, 'removed');
});

test('restore refuses a save whose slices the validators of today reject, and installs nothing', async t => {
    let limit = 100;
    const picky = {
        id: 'tl-picky', name: 'Picky', version: '1.0.0',
        domains: { pk: { initial: () => ({ n: 1 }), validate: slice => (slice.n > limit ? [`pk: ${slice.n} is over ${limit}`] : []) } },
        commands: { 'pk.set'(ctx, { n }) { ctx.draft('pk').n = n; return { summary: 'set', narrate: false }; } },
    };
    const host = await createHost({ modules: [rulesModule(), picky] });
    t.after(() => host.close());
    await host.send('Hello.', reply('x'));
    await host.sdk.command('pk.set', { n: 50 });
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Fifty' })).snapshot;
    await host.sdk.command('pk.set', { n: 5 });
    limit = 10;   // the rule got stricter since the save
    const refused = await restore(host, saved.id);
    assert.equal(refused.prepared.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(refused.prepared.message, /pk: 50 is over 10/);
    assert.equal(host.head().domains.pk.n, 5);
    assert.equal(host.registry.restore().state, 'idle');
    assert.equal(host.timeline.host.journal().findLast(entry => entry.kind === 'restore'), undefined, 'nothing was even prepared');
    limit = 100;
    assert.equal((await restore(host, saved.id)).activated.status, 'complete');
    assert.equal(host.head().domains.pk.n, 50);
});

test('a save whose slices break the state\'s generic rules (an id that is no id) is not restored, at the plan', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('x'));
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Fine' })).snapshot;
    const entry = clone(host.ctx.chatMetadata.storySuite.timeline.payloads[saved.payloadHash]);
    entry.payload.domains.gear = { equipped: { id: 'not an id' } };
    const point = host.head().domains.savepoints.points[saved.id];
    const plan = planRestore({
        registry: host.registry, state: host.head(), entry, descriptor: point, returnRecord: { id: 'rt_planonly1', restoreAt: point.target },
        newEpoch: 'ep_planonly1', deathEvents: ['ev_x'], batchResult: { id: 'br_batch001', hash: 'b'.repeat(64) },
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(plan.message, /generic rules/);
});
