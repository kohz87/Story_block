// Module lifecycle (RB_CONTRACT §2 P22, docs/v2/LIFECYCLE.md): requires.peers, dormant / ready /
// ready→dormant / restore-pending, sdk.modules status and reason, and what a dormant module costs
// the others (nothing). `mech` is the stand-in for a mechanics module that needs Story Director.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../testkit/index.js';
import { INIT_PREFIX, createRegistry, definitionProblems, definitionWarnings } from '../../src/v2/registry.js';
import { ensureModules } from '../../src/v2/sdk.js';

const PEER = 'story-director';

// Story Director's stand-in: a time domain and a clock command.
const director = (version = '2.0.0-beta.2', extra = {}) => ({
    id: PEER,
    name: 'Story Director',
    version,
    domains: { director: { initial: () => ({ minutes: 0 }) } },
    commands: { 'director.advance'(ctx, { by = 1 } = {}) { ctx.draft('director').minutes += by; return { summary: 'time passes', narrate: false }; } },
    queries: { 'director.time': state => ({ minutes: state.domains.director?.minutes ?? null }) },
    ...extra,
});

// The mechanics module: needs Story Director, keeps a party, reads wound lines, speaks in the prompt.
function mech({ range = '>=2.0.0-beta.1', calls = {}, id = 'rpg-battle', peers = { [PEER]: range }, hooks = {}, domain = 'party' } = {}) {
    const count = name => { calls[name] = (calls[name] ?? 0) + 1; };
    return {
        id,
        name: 'RPG Battle',
        version: '2.0.0-beta.2',
        requires: { storyBlock: '>=2.0.0-beta.2', peers },
        domains: { [domain]: { initial: () => ({ rulesVersion: 2, rulesHash: 'h-1', actors: {} }) } },
        commands: {
            'combat.start'(ctx) { ctx.draft(domain).actors.hero = { hp: 10 }; count('start'); return { summary: 'A fight starts.', narrate: false }; },
            'combat.peek'(ctx) {
                let said = null;
                try { ctx.call('director.advance', {}); } catch (error) { said = error.code; }
                return { summary: `called: ${said}`, narrate: false, data: { said } };
            },
        },
        queries: { 'combat.session': state => ({ fighters: Object.keys(state.domains[domain]?.actors ?? {}) }) },
        capture: {
            kinds: { wound: { grammar: '~ wound Name — how' } },
            apply(ctx, line) { ctx.draft(domain).actors[line.name] = { hurt: true }; count('capture'); return { summary: `${line.name} is hurt.`, narrate: false }; },
        },
        context: { static: () => 'RB RULES: fights are played in code.', tail: () => ({ lines: ['RB TAIL'], optional: [] }), budget: 100 },
        hooks: {
            canGenerate: () => { count('canGenerate'); return { ok: false, reason: 'Make a character first.' }; },
            beforeGenerate: () => { count('beforeGenerate'); return ['RB CUE']; },
            afterReply: () => { count('afterReply'); },
            ...hooks,
        },
        tabs: [{ id: 'party', title: 'Party', render: () => {} }],
    };
}

// NSD's stand-in: no peers; a canGenerate that allows and a cue of its own.
const social = () => ({
    id: 'npc-state-delta',
    name: 'NPC State Delta',
    version: '1.2.20',
    domains: { npc: { initial: () => ({ meters: {} }) } },
    hooks: { canGenerate: () => true, beforeGenerate: () => ['NSD CUE'] },
    context: { static: () => 'NSD RULES.', budget: 50 },
});

// Everything the last reply's request carried (the prompt text the model was sent).
const requestText = host => JSON.stringify(host.st.requests.at(-1));
const modulesById = host => Object.fromEntries(host.sdk.modules().map(entry => [entry.id, entry]));
const initReceipts = (host, id) => host.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.type === `${INIT_PREFIX}${id}`);

test('requires.peers is checked as a map of module ids to ranges; other requires keys are still ignored with the warning', () => {
    assert.deepEqual(definitionProblems({ id: 'a', requires: { storyBlock: '^2', peers: { [PEER]: '^2', 'other-mod': '>=1.0.0-alpha.2' } } }), []);
    assert.match(definitionProblems({ id: 'a', requires: { peers: [PEER] } }).join(), /requires\.peers is not an object/);
    assert.match(definitionProblems({ id: 'a', requires: { peers: { [PEER]: 'soon' } } }).join(), /requires\.peers\["story-director"\] is not a version range/);
    assert.match(definitionProblems({ id: 'a', requires: { peers: { [PEER]: 3 } } }).join(), /is not a version range/);
    assert.match(definitionProblems({ id: 'a', requires: { peers: { 'Story Director': '^2' } } }).join(), /is not a module id/);
    assert.deepEqual(definitionWarnings({ id: 'a', requires: { storyBlock: '^2', peers: { [PEER]: '^2' } } }), []);
    assert.deepEqual(definitionWarnings({ id: 'a', requires: { peers: { [PEER]: '^2' }, storyDirector: '^2' } }),
        ['"requires.storyDirector" is not a requires field this Story Block knows; it is ignored']);
    const registry = createRegistry({ hostVersion: '2.0.0-beta.2' });
    assert.throws(() => registry.register({ id: 'bad', requires: { peers: { [PEER]: 'soon' } } }), /cannot be registered/);
    assert.equal(registry.has('bad'), false);
});

test('a module with no peers is always ready, and sdk.modules() keeps its fields and adds status and reason', async () => {
    const host = await createHost({ modules: [social()] });
    const entry = modulesById(host)['npc-state-delta'];
    assert.deepEqual(entry, {
        id: 'npc-state-delta', name: 'NPC State Delta', version: '1.2.20', domains: ['npc'], commands: [], kinds: [], tabs: [], features: [], status: 'ready', reason: null,
    });
    assert.equal(modulesById(host)['story-block'].status, 'ready');
    assert.ok(Object.isFrozen(entry));
    host.close();
});

test('a missing peer: the module is dormant, its names are reserved once, and it costs nothing', async () => {
    const calls = {};
    const host = await createHost({ modules: [social()] });
    await host.sdk.registerModule(mech({ calls }));
    const entry = modulesById(host)['rpg-battle'];
    assert.equal(entry.status, 'dormant');
    assert.equal(entry.reason, 'Needs story-director >=2.0.0-beta.1, which is not installed.');
    assert.deepEqual([entry.domains, entry.commands, entry.kinds], [['party'], ['combat.start', 'combat.peek'], ['wound']], 'declared inventory stays listed');

    // Reserved: nobody else can take its names, and it was registered once.
    assert.equal(host.registry.domainOwner('party'), 'rpg-battle');
    await assert.rejects(host.sdk.registerModule(mech()), /already registered|already belongs/);
    await assert.rejects(host.sdk.registerModule({ id: 'squatter', commands: { 'combat.start': () => ({}) } }), /"combat.start" already belongs to "rpg-battle"/);
    assert.equal(host.sdk.modules().filter(item => item.id === 'rpg-battle').length, 1);

    // No domain init, no receipt for it.
    assert.equal(Object.hasOwn(host.head().domains, 'party'), false);
    assert.deepEqual(initReceipts(host, 'rpg-battle'), []);
    assert.equal(host.registry.initialState().domains.party, undefined);

    // Views can show the reason; queries answer nothing; tabs stay.
    assert.equal(host.sdk.query('combat.session'), null);
    assert.ok(host.registry.tabs().some(tab => tab.id === 'party'));

    // Actions refuse with the reason; the system path finds no command; nothing is committed.
    const before = host.sdk.receipts().length;
    const refused = await host.sdk.command('combat.start', {});
    assert.deepEqual({ ok: refused.ok, code: refused.code }, { ok: false, code: 'DEPENDENCY_UNAVAILABLE' });
    assert.match(refused.message, /^RPG Battle is not running: Needs story-director/);
    assert.equal((await host.sdk.preview('combat.start', {})).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal((await host.bus.command('combat.start', {}, { cause: 'system' })).code, 'UNKNOWN_COMMAND');
    assert.equal(host.registry.command('combat.start'), null);
    assert.equal(host.sdk.receipts().length, before);

    // No hooks, no context, no capture, no cues, no veto.
    assert.deepEqual(host.registry.hookEntries('canGenerate').map(item => item.moduleId), ['npc-state-delta']);
    assert.deepEqual(host.registry.contexts().map(item => item.moduleId), ['npc-state-delta', 'story-block']);
    assert.equal(host.registry.capture('wound'), null);
    const out = await host.send('I go.', 'He steps out.\n\n<Changes>\n~ wound Ann — a cut\n</Changes>');
    assert.notEqual(out.aborted, true, 'a dormant module\'s canGenerate is suppressed, not answered false');
    assert.deepEqual(host.st.notices, []);
    assert.deepEqual(calls, {}, 'none of its hooks, commands or capture ran');
    assert.doesNotMatch(requestText(host), /RB RULES|RB TAIL|RB CUE|wound/);
    assert.match(requestText(host), /NSD RULES/, 'the others are there');
    assert.equal(Object.hasOwn(host.head().domains, 'party'), false);
    assert.deepEqual(await host.turn.blockers(), []);
    host.close();
});

test('a dormant module\'s command reached by ctx.call from another module is catchable, not fatal', async () => {
    const host = await createHost({ modules: [] });
    await host.sdk.registerModule(mech());      // dormant: needs Story Director
    await host.sdk.registerModule({
        id: 'caller',
        domains: { caller: { initial: () => ({}) } },
        commands: {
            'caller.try'(ctx) {
                let said = null;
                try { ctx.call('combat.start', {}); } catch (error) { said = error.code; }
                return { summary: `said ${said}`, narrate: false, data: { said } };
            },
        },
    });
    const done = await host.sdk.command('caller.try', {});
    assert.equal(done.ok, true);
    assert.equal(done.receipt.data.said, 'UNKNOWN_COMMAND');
    host.close();
});

test('a late peer wakes the module on registration: set up once, advertised once, never registered twice', async () => {
    const calls = {};
    const host = await createHost({ modules: [social()] });
    const announced = [];
    host.sdk.on('modules', ({ changes }) => announced.push(...changes.map(change => `${change.id}:${change.from}>${change.status}`)));
    await host.sdk.registerModule(mech({ calls }));
    assert.deepEqual(announced, ['rpg-battle:null>dormant']);

    await host.sdk.registerModule(director());
    assert.deepEqual(announced, ['rpg-battle:null>dormant', 'rpg-battle:dormant>ready'], 'advertised once');
    const entry = modulesById(host)['rpg-battle'];
    assert.deepEqual([entry.status, entry.reason], ['ready', null]);
    assert.deepEqual(host.sdk.modules().map(item => item.id), ['npc-state-delta', 'rpg-battle', 'story-block', PEER].sort());
    assert.deepEqual(host.head().domains.party, { rulesVersion: 2, rulesHash: 'h-1', actors: {} }, 'set up when ready');
    assert.equal(initReceipts(host, 'rpg-battle').length, 1);

    // Everything is on now; more cycles change nothing and announce nothing.
    host.sdk.view();
    await host.sdk.command('director.advance', {});
    await ensureModules({ store: host.store, bus: host.bus, registry: host.registry, events: host.events });
    assert.equal(initReceipts(host, 'rpg-battle').length, 1);
    assert.equal(announced.length, 2);
    assert.deepEqual(host.registry.hookEntries('canGenerate').map(item => item.moduleId), ['npc-state-delta', 'rpg-battle']);
    assert.ok(host.registry.capture('wound'));
    assert.equal((await host.sdk.command('combat.start', {})).ok, true);
    assert.deepEqual(host.sdk.query('combat.session'), { fighters: ['hero'] });
    await assert.rejects(host.sdk.registerModule(director()), /already registered/);
    host.close();
});

test('a peer that registers first, then the module: ready at once', async () => {
    const host = await createHost({ modules: [director()] });
    await host.sdk.registerModule(mech());
    assert.equal(modulesById(host)['rpg-battle'].status, 'ready');
    assert.equal(initReceipts(host, 'rpg-battle').length, 1);
    host.close();
});

test('a dormant module on a new chat has no domain; a chat that has the domain keeps it', async () => {
    const host = await createHost({ modules: [] });
    await host.sdk.registerModule(mech());
    await host.send('Hi.', 'Hello.');
    assert.equal(Object.hasOwn(host.head().domains, 'party'), false);
    await host.sdk.registerModule(director());
    assert.ok(host.head().domains.party);
    const chat = structuredClone(host.ctx.chat);
    host.close();

    // The same chat with the peer gone: dormant, and the saved slice is untouched.
    const again = await createHost({ modules: [], st: { chat } });
    await again.sdk.registerModule(mech());
    assert.equal(modulesById(again)['rpg-battle'].status, 'dormant');
    assert.deepEqual(again.head().domains.party, { rulesVersion: 2, rulesHash: 'h-1', actors: {} });
    assert.equal(initReceipts(again, 'rpg-battle').length, 1, 'not set up again');
    again.close();
});

test('wrong-version peers: ranges are checked, prereleases included', async () => {
    const cases = [
        ['2.0.0-beta.2', '>=2.0.0-beta.1', 'ready'],
        ['2.0.0-beta.2', '^2', 'ready'],
        ['2.0.0', '>=2.0.0-beta.1', 'ready'],
        ['2.0.0-alpha.9', '>=2.0.0-beta.1', 'dormant'],
        ['1.9.0', '^2', 'dormant'],
        ['3.0.0', '^2', 'dormant'],
        ['2.0.0-beta.2', '>=2.0.0', 'dormant'],
        ['', '^2', 'dormant'],
        ['not-a-version', '^2', 'dormant'],
    ];
    for (const [version, range, expected] of cases) {
        const host = await createHost({ modules: [director(version)] });
        await host.sdk.registerModule(mech({ range }));
        const entry = modulesById(host)['rpg-battle'];
        assert.equal(entry.status, expected, `${version || '(no version)'} vs ${range}`);
        if (expected === 'dormant') assert.match(entry.reason, new RegExp(`^Needs story-director ${range.replace(/[.^>=*]/g, '\\$&')}; the one installed is ${version ? version.replace(/\./g, '\\.') : 'of unknown version'}\\.$`));
        host.close();
    }
});

test('an off peer: ready to dormant keeps the state and stops the hooks; back on, nothing is set up twice', async () => {
    const calls = {};
    const host = await createHost({ modules: [director(), social()] });
    await host.sdk.registerModule(mech({ calls }));
    await host.sdk.command('combat.start', {});
    assert.deepEqual(host.head().domains.party.actors, { hero: { hp: 10 } });
    const announced = [];
    host.sdk.on('modules', ({ changes }) => announced.push(...changes.map(change => `${change.id}:${change.status}`)));

    assert.equal(host.registry.setEnabled(PEER, false, 'Switched off for the test.'), true);
    host.sdk.view();   // the next view sees it
    assert.deepEqual(announced.sort(), ['rpg-battle:dormant', 'story-director:dormant']);
    const dormant = modulesById(host);
    assert.equal(dormant[PEER].reason, 'Switched off for the test.');
    assert.match(dormant['rpg-battle'].reason, /^Needs Story Director, which is not ready: Switched off for the test\.$/);
    assert.deepEqual(host.head().domains.party.actors, { hero: { hp: 10 } }, 'state preserved');
    const before = { ...calls };
    const out = await host.send('I go.', 'He leaves.\n\n<Changes>\n~ wound Ann — a cut\n</Changes>');
    assert.notEqual(out.aborted, true);
    assert.deepEqual(calls, before, 'no hook or capture ran while dormant');
    assert.equal(host.head().domains.party.actors.Ann, undefined);
    assert.equal((await host.sdk.command('combat.start', {})).code, 'DEPENDENCY_UNAVAILABLE');

    // Back on: picked up at the next action; the slice is not reset and not set up again.
    host.registry.setEnabled(PEER, true);
    assert.equal((await host.sdk.command('combat.start', {})).ok, true);
    assert.deepEqual(announced.slice(2).sort(), ['rpg-battle:ready', 'story-director:ready']);
    assert.equal(initReceipts(host, 'rpg-battle').length, 1);
    assert.equal(host.registry.setEnabled('story-block', false), false, 'the host\'s own module cannot be switched off');
    assert.equal(host.registry.setEnabled('nobody', false), false);
    host.close();
});

test('a peer that is itself dormant does not count; chains settle', async () => {
    const host = await createHost({ modules: [] });
    await host.sdk.registerModule({ id: 'c-mod', version: '1.0.0', requires: { peers: { 'b-mod': '^1' } }, domains: { cdom: { initial: () => ({}) } } });
    await host.sdk.registerModule({ id: 'b-mod', version: '1.0.0', requires: { peers: { 'a-mod': '^1' } }, domains: { bdom: { initial: () => ({}) } } });
    assert.deepEqual(host.sdk.modules().filter(m => m.id.endsWith('-mod')).map(m => [m.id, m.status]), [['b-mod', 'dormant'], ['c-mod', 'dormant']]);
    assert.match(modulesById(host)['c-mod'].reason, /^Needs b-mod, which is not ready: Needs a-mod \^1, which is not installed\.$/);
    await host.sdk.registerModule({ id: 'a-mod', version: '1.2.0', domains: { adom: { initial: () => ({}) } } });
    assert.deepEqual(host.sdk.modules().filter(m => m.id.endsWith('-mod')).map(m => [m.id, m.status]), [['a-mod', 'ready'], ['b-mod', 'ready'], ['c-mod', 'ready']]);
    assert.deepEqual(['adom', 'bdom', 'cdom'].map(name => Object.hasOwn(host.head().domains, name)), [true, true, true]);
    host.close();
});

test('cyclic peers refuse activation; an unrelated module and the host go on', async () => {
    const host = await createHost({ modules: [social()] });
    await host.sdk.registerModule({ id: 'x-mod', version: '1.0.0', requires: { peers: { 'y-mod': '^1' } }, domains: { xdom: { initial: () => ({}) } }, hooks: { canGenerate: () => false } });
    assert.equal(modulesById(host)['x-mod'].reason, 'Needs y-mod ^1, which is not installed.');
    await host.sdk.registerModule({ id: 'y-mod', version: '1.0.0', requires: { peers: { 'x-mod': '^1' } }, domains: { ydom: { initial: () => ({}) } } });
    const byId = modulesById(host);
    assert.deepEqual([byId['x-mod'].status, byId['y-mod'].status], ['dormant', 'dormant']);
    assert.equal(byId['x-mod'].reason, 'Its peers need each other (x-mod → y-mod → x-mod), so none of them can start.');
    assert.equal(byId['y-mod'].reason, 'Its peers need each other (y-mod → x-mod → y-mod), so none of them can start.');
    assert.equal(byId['npc-state-delta'].status, 'ready');
    assert.equal(Object.hasOwn(host.head().domains, 'xdom'), false);
    assert.equal(Object.hasOwn(host.head().domains, 'ydom'), false);
    // A module that needs one of them waits too; a module on its own self-cycle too.
    await host.sdk.registerModule({ id: 'z-mod', version: '1.0.0', requires: { peers: { 'x-mod': '^1' } } });
    assert.match(modulesById(host)['z-mod'].reason, /^Needs x-mod, which is not ready: Its peers need each other/);
    await host.sdk.registerModule({ id: 'solo', version: '1.0.0', requires: { peers: { solo: '^1' } } });
    assert.match(modulesById(host).solo.reason, /^Its peers need each other \(solo → solo\)/);
    const out = await host.send('Go.', 'Done.');
    assert.notEqual(out.aborted, true, 'a cyclic module\'s canGenerate false never reaches the story');
    host.close();
});

test('discovery: a dormant or restore-pending module is not advertised ready, so no fights are asked for', async () => {
    // Story Director\'s fightRunner on a lifecycle-capable host: a ready entry that registers combat.* commands.
    const fights = sdk => sdk.modules().some(entry => entry.id !== PEER && entry.status === 'ready' && entry.commands.some(type => type.startsWith('combat.')));
    const host = await createHost({ modules: [] });
    await host.sdk.registerModule(mech({ peers: { 'missing-mod': '^1' } }));
    assert.equal(fights(host.sdk), false, 'dormant: no encounter requests');
    assert.equal(host.sdk.query('combat.session'), null, 'its query probe answers nothing either');
    await host.sdk.registerModule({ id: 'missing-mod', version: '1.0.0' });
    assert.equal(fights(host.sdk), true, 'late activation shows it at the next look');
    host.registry.setRestore('pending', 'Restoring a save point.');
    assert.equal(fights(host.sdk), false, 'restore-pending: no mechanics module is ready');
    host.registry.setRestore('idle');
    assert.equal(fights(host.sdk), true);
    host.close();
});

test('dormant hooks do not block Story Block or NSD generation; ready ones still do', async () => {
    const calls = {};
    const host = await createHost({ modules: [social()] });
    await host.sdk.registerModule(mech({ calls }));
    const sent = await host.send('Hello?', 'A reply.');
    assert.notEqual(sent.aborted, true);
    assert.deepEqual(host.st.notices, []);
    assert.deepEqual(host.turn.blocked(), []);
    assert.deepEqual(calls, {});
    assert.match(requestText(host), /NSD RULES/);
    assert.doesNotMatch(requestText(host), /RB RULES|RB CUE/);

    // Ready: its veto holds the story back, with its reason.
    await host.sdk.registerModule(director());
    host.st.addUser('Again.');
    const stopped = await host.st.generate('normal', { reply: 'No.' });
    assert.equal(stopped.aborted, true);
    assert.deepEqual(host.st.notices.map(item => item.reason), ['Make a character first.']);
    assert.deepEqual((await host.turn.blockers()).map(item => item.moduleId), ['rpg-battle']);

    // The peer goes away again: the veto is suppressed, not answered false.
    host.registry.setEnabled(PEER, false);
    const go = await host.st.generate('normal', { reply: 'It goes.' });
    assert.notEqual(go.aborted, true);
    assert.equal(host.st.notices.length, 1);
    assert.deepEqual(await host.turn.blockers(), []);
    host.close();
});

test('restore-pending: a host-wide barrier; nothing is ready, generation waits, the host\'s own steps stay', async () => {
    const calls = {};
    const host = await createHost({ modules: [director(), social()] });
    await host.sdk.registerModule(mech({ calls, hooks: { canGenerate: () => true } }));
    await host.sdk.command('combat.start', {});
    assert.equal(host.registry.restore().state, 'idle');
    const announced = [];
    host.sdk.on('modules', ({ changes }) => announced.push(...changes.map(change => `${change.id}:${change.status}`)));

    host.registry.setRestore('pending', 'Going back to a save point.');
    host.sdk.view();
    assert.deepEqual(announced.sort(), ['npc-state-delta:restore-pending', 'rpg-battle:restore-pending', 'story-block:restore-pending', 'story-director:restore-pending']);
    for (const entry of host.sdk.modules()) assert.deepEqual([entry.status, entry.reason], ['restore-pending', 'Going back to a save point.'], entry.id);

    // Dispatch: mechanics commands refuse with RESTORE_PENDING; the host's own commands and steps go on.
    const refused = await host.sdk.command('combat.start', {});
    assert.deepEqual({ ok: refused.ok, code: refused.code }, { ok: false, code: 'RESTORE_PENDING' });
    assert.match(refused.message, /^RPG Battle is waiting: Going back to a save point\.$/);
    assert.equal((await host.bus.command('director.advance', {}, { cause: 'system' })).code, 'UNKNOWN_COMMAND');
    assert.equal(host.registry.capture('wound'), null);
    assert.equal(host.sdk.query('combat.session'), null);
    assert.deepEqual(host.registry.hookEntries('beforeGenerate').map(item => item.moduleId), host.registry.hookEntries('beforeGenerate').filter(item => item.moduleId === 'story-block').map(item => item.moduleId));
    assert.deepEqual(host.registry.contexts().map(item => item.moduleId), ['story-block']);
    const scene = await host.sdk.command('scene.place', { name: 'Gate' });
    assert.notEqual(scene.code, 'RESTORE_PENDING', 'Story Block\'s own commands are not held');

    // Generation waits, with the reason; the module set-up does not touch the chat.
    const stopped = await host.send('Wait.', 'Never.');
    assert.equal(stopped.aborted, true);
    assert.deepEqual(host.st.notices.at(-1), { reason: 'Going back to a save point.', moduleId: 'story-block' });
    assert.deepEqual((await host.turn.blockers()).map(item => [item.moduleId, item.action, item.canOpen]), [['story-block', false, false]]);
    const receipts = host.sdk.receipts().length;
    assert.deepEqual(await ensureModules({ store: host.store, bus: host.bus, registry: host.registry, events: host.events }), []);
    assert.equal(host.sdk.receipts().length, receipts);

    // Failed only reports; it holds nothing. Idle: back to ready and the story goes on.
    host.registry.setRestore('failed', 'A part disagreed.');
    assert.deepEqual(host.registry.restore(), { state: 'failed', reason: 'A part disagreed.' });
    assert.equal(modulesById(host)['rpg-battle'].status, 'ready');
    host.registry.setRestore('idle');
    assert.deepEqual(host.registry.restore(), { state: 'idle', reason: '' });
    assert.equal((await host.sdk.command('combat.start', {})).ok, true);
    const go = await host.st.generate('normal', { reply: 'Now.' });
    assert.notEqual(go.aborted, true);
    assert.throws(() => host.registry.setRestore('maybe'), /a restore is idle, pending, failed/);
    host.close();
});

test('a module with no peers behaves as before: same lookups, same dispatch, no new refusals', async () => {
    const host = await createHost({ modules: [social()] });
    assert.deepEqual(host.registry.lifecycles().map(item => item.status), ['ready', 'ready']);
    assert.deepEqual(host.registry.peers('npc-state-delta'), []);
    assert.equal(host.registry.refusal('scene.place'), null);
    assert.equal(host.registry.held('npc-state-delta'), false);
    assert.equal(host.registry.lifecycle('nobody'), null);
    assert.equal((await host.sdk.command('scene.place', { name: 'Gate' })).ok, true);
    host.close();
});
