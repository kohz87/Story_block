// The replay-purity fuzz of data modules (DATA_MODULES.md section 8 test 5): random definitions, random chats on the real
// host, and after EVERY step these properties.
//
//  * the live head equals a cold replay of the chat as it is stored, and a cold replay with every checkpoint stripped (so every
//    guard is asked again, from the first reply); the Problems agree between live and full replay; the states at sampled
//    carriers agree; receipt revs only go up and the head is at the last;
//  * a replay touches nothing outside the chat: it runs here with the clock, Math.random and crypto trapped, and no command
//    (so no effect, no ID, no roll) is ever run by it;
//  * the data modules domain always validates; pins are kept; every pin, attach and migrate block is reply-bound;
//  * no hook or command threw (a failure of afterCapture/beforeGenerate is a bug here, never a "refusal").
// Steps: replies with valid and malformed dm lines (wrong labels, kinds, ops, ambiguous names), Continues, swipes, regenerates,
// deletes, Re-reads, reloads, rebuilds, Setup pins/attaches/migrations, reader actions, clock edits (up and down), actor
// changes, pack installs/updates/disables/removals, settings changes, save points, the restore barrier, and damage to the stored
// chat (spans stripped, guards edited, sources changed, recorded inputs cut). Checkpoint frequency and receipt trimming vary by seed.
//
//   node scripts/fuzz-data-modules.mjs <seed> <steps>      one run; prints { seed, steps, fails }
import { writeFileSync } from 'node:fs';
import { createStore } from '../../../../src/v2/store.js';
import { createCommandBus } from '../../../../src/v2/commands.js';
import { validateDomain } from '../../../../src/v2/data-modules/part.js';
import { DM_LIMITS } from '../../../../src/v2/data-modules/schema.js';
import { createHost } from '../../../../testkit/index.js';
import { fixture, directorStub } from '../helpers.js';
import { generate, witnessDefinition, rng } from './generate.js';

const J = value => JSON.stringify(value);
const reply = (...lines) => `The story.${lines.length ? `\n<Changes>\n${lines.join('\n')}\n</Changes>` : ''}`;
const TRAP_OK = new Set(['Date.now', 'Math.random']);
const GARBAGE_THROW = /Cannot read|is not a function|undefined|TypeError|RangeError|is not iterable|not defined/;

function lineFor(r, id, definition, { valid = true } = {}) {
    const names = Object.keys(definition.kinds);
    const kindName = r.pick(names);
    const kind = definition.kinds[kindName];
    const parts = [`kind: ${valid || r.chance(0.7) ? kindName : 'nope'}`];
    if (definition.scope === 'character') parts.push(`who: ${r.pick(['Wessel', 'Wessel', 'ca_wessel01', 'Nobody', 'Odda', 'Brecht'])}`);
    else if (!valid && r.chance(0.3)) parts.push('who: Wessel');
    for (const [label, schema] of Object.entries(kind.labels)) {
        if (!valid && r.chance(0.2)) continue;
        const value = schema.type === 'enum' ? (!valid && r.chance(0.3) ? 'bogus' : r.pick(schema.values))
            : schema.type === 'int' ? (!valid && r.chance(0.3) ? schema.max + 7 : r.int(schema.min, schema.max)) : 'true';
        parts.push(`${label}: ${value}`);
        if (!valid && r.chance(0.1)) parts.push(`${label}: ${value}`);
    }
    if (!valid && r.chance(0.1)) parts.push('stray words with no label');
    const op = valid || r.chance(0.7) ? kind.op : r.pick(['+', '-', '~', '!', '?']);
    const reference = r.chance(0.5) ? definition.slug : id;
    return `${op} dm ${reference} — reason ${r.int(1, 99)} | ${parts.join(' | ')}`;
}

function strip(chat) {
    const copy = JSON.parse(J(chat));
    const first = copy.findIndex(message => !message.is_user && message.extra?.storySuite);
    copy.forEach((message, index) => {
        if (index === first) return;
        for (const holder of [message.extra, ...(message.swipe_info ?? []).map(item => item.extra)]) {
            if (holder?.storySuite) { delete holder.storySuite.checkpoint; delete holder.storySuite.covers; delete holder.storySuite.coverHash; }
        }
    });
    return copy;
}

export async function runFuzz({ seed = 1, steps = 40, verbose = false } = {}) {
    const r = rng(seed);
    const fails = [];
    const trace = [];
    const sourceDeletes = { noOp: 0, clock: 0 };
    let before = null;      // the chat before the step that is running (DUMP writes it with the failing one)
    const fail = (label, message, extra) => {
        if (fails.length < 4) fails.push({ label, message, ...(extra ? { extra } : {}) });
        if (process.env.DUMP && fails.length === 1 && host) writeFileSync(process.env.DUMP, J({ label, before, chat: host.ctx.chat }));
    };
    const warn = console.warn;
    console.warn = () => {};
    let host = null;
    const saved = { now: Date.now, random: Math.random };
    try {
        // ---- the library ----------------------------------------------------------------------
        const defs = new Map();
        const packs = [];
        const gen = (slug, options) => generate(r, slug, options);
        const alpha = gen('alpha', { clock: r.chance(0.6), offers: r.chance(0.5) });
        const beta = gen('beta', { scope: 'character', clock: true, source: 'pack.fz-a/alpha' });
        const gamma = gen('gamma', { offers: true });
        const witness = witnessDefinition(r);
        packs.push({ id: 'fz-a', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1', 'story-director'] }, content: { dataModules: [alpha, beta, gamma, witness] } });
        if (r.chance(0.5)) packs.push({ id: 'fz-b', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1'] }, content: { dataModules: [gen('alpha', {})] } });
        if (r.chance(0.6)) packs.push(fixture('reputation'));
        if (r.chance(0.6)) packs.push(fixture('survival'));
        const catalog = () => {
            defs.clear();
            for (const pack of packs) for (const definition of pack.content.dataModules) defs.set(`pack.${pack.id}/${definition.slug}`, definition);
        };

        host = await createHost({
            modules: [directorStub({ actors: [{ id: 'ca_wessel01', name: 'Wessel', bonuses: {} }, { id: 'ca_odda0001', name: 'Odda', bonuses: {} }] })],
            storeOptions: { checkpointEvery: r.pick([2, 3, 5, 8, 100]), receiptKeep: r.pick([3, 6, 200]) },
        });
        for (const pack of packs) {
            const done = await host.packs.packs.install(pack);
            if (!done.ok) throw new Error(`install ${pack.id}: ${J(done.errors).slice(0, 300)}`);
        }
        catalog();
        const send = (...lines) => host.send(`Turn ${r.int(1, 999)}.`, reply(...lines));
        await host.send('Begin.', 'The camp.');

        const randomLines = () => {
            const lines = [];
            for (let n = r.int(0, 3); n > 0; n -= 1) {
                const live = pinned().filter(each => defs.has(each));
                const id = live.length && r.chance(0.75) ? r.pick(live) : r.pick([...defs.keys()]);
                lines.push(lineFor(r, id, defs.get(id), { valid: r.chance(0.8) }));
            }
            if (r.chance(0.35)) lines.push(`! time ${r.pick([5, 30, 59, 60, 61, 120, 400, 2000])}`);
            if (r.chance(0.05)) lines.push('+ dm nothing — a stray | kind: none');
            return lines;
        };
        const aiIndexes = () => host.ctx.chat.map((message, index) => (message.is_user ? -1 : index)).filter(index => index >= 0);
        const pinned = () => Object.keys(host.head()?.domains?.dataModules?.active ?? {});
        const probe = kind => send(`! dm pack.fz-a/witness — source probe | kind: ${kind}`);
        const probeInstance = () => host.head()?.domains?.dataModules?.instances?.['pack.fz-a/witness']?.chat;
        const probeReady = () => {
            const domain = host.head()?.domains?.dataModules, active = domain?.active?.['pack.fz-a/witness'];
            return Boolean(active && domain.pins[active.hash]?.definition.kinds.repeat);
        };
        const staleProbe = () => host.store.problems().some(problem => problem.index === host.ctx.chat.length - 1 && problem.code === 'REPLAY_PREREQUISITE');

        const operations = {
            deleteNoOpSource: async () => {
                if (!probeReady()) return;
                await probe('reset'); verify('no-op reset');
                await probe('prime'); verify('no-op source');
                const source = host.ctx.chat.length - 1;
                await probe('repeat'); verify('no-op repeat');
                if (!probeInstance()?.fields.title) { fail('no-op source', 'probe did not earn its title'); return; }
                await host.st.deleteMessage(source);
                sourceDeletes.noOp += 1;
                if (probeInstance()?.fields.score !== 1 || probeInstance()?.fields.title !== false || !staleProbe()) fail('no-op source', 'deleting the original write did not invalidate the no-op set and reward');
            },
            deleteClockSource: async () => {
                if (!probeReady()) return;
                await send();
                await host.sdk.command('test.minute', { minute: 1000 }); verify('clock baseline');
                await probe('reset'); verify('clock reset');
                await send(`! time ${witness.rules[0].when[2][2] - 1000}`); verify('clock source');
                const source = host.ctx.chat.length - 1;
                await probe('arm'); verify('clock gate');
                if (!probeInstance()?.fields['clock-title']) { fail('clock source', 'probe did not earn its clock title'); return; }
                await host.st.deleteMessage(source);
                sourceDeletes.clock += 1;
                if (host.head().domains.director.time.minutes !== 1000 || probeInstance()?.fields['clock-title'] !== false || !staleProbe()) fail('clock source', 'deleting the advance did not invalidate the clock-gated rule');
            },
            reply: () => send(...randomLines()),
            replyMany: async () => { await send(...randomLines()); await send(...randomLines()); },
            cont: () => host.cont(reply(...randomLines())),
            swipe: () => host.swipe(reply(...randomLines())),
            regenerate: () => host.regenerate(reply(...randomLines())),
            delete: async () => {
                const list = host.ctx.chat.map((_, index) => index).filter(index => index > 0);
                if (!list.length) return;
                await host.st.deleteMessage(r.chance(0.5) ? list[r.int(0, Math.min(list.length - 1, 3))] : r.pick(list));
            },
            reread: async () => {
                const list = aiIndexes().filter(index => index > 0);
                if (!list.length) return;
                const index = r.pick(list);
                const message = host.ctx.chat[index];
                message.mes = reply(...randomLines());
                if (Array.isArray(message.swipes)) message.swipes[message.swipe_id ?? 0] = message.mes;
                await host.turn.reread(index);
            },
            edit: async () => { const list = aiIndexes().filter(index => index > 0); if (list.length) await host.st.editMessage(r.pick(list), reply(...randomLines())); },
            reload: () => host.st.loadChat(JSON.parse(J(host.ctx.chat))),
            rebuild: () => host.store.rebuild(),
            setup: async () => {
                const rows = host.sdk.query('dataModules.setup');
                const row = r.pick(rows);
                if (!row) return;
                if (!row.pinned && row.available !== false) {
                    const subjects = row.definition.scope === 'character' ? row.actors.filter(() => r.chance(0.6)).map(actor => actor.id) : [];
                    await host.sdk.command('dm.pin', { module: row.module, hash: row.hash, packHash: row.packHash, subjects });
                } else if (row.status === 'Migration available') await host.sdk.command('dm.migrate', { module: row.module, hash: row.hash, packHash: row.packHash });
                else if (row.pinned && row.definition.scope === 'character') await host.sdk.command('dm.attach', { module: row.module, who: r.pick(row.actors)?.id ?? 'Nobody' });
            },
            act: async () => {
                const list = pinned();
                if (!list.length) return;
                const id = r.pick(list);
                const definition = defs.get(id);
                if (!definition) return;
                const ui = Object.entries(definition.kinds).filter(([, kind]) => kind.ui);
                if (!ui.length) return;
                const [name, kind] = r.pick(ui);
                const labels = Object.fromEntries(Object.entries(kind.labels).map(([label, schema]) => [label, schema.type === 'enum' ? r.pick(schema.values) : schema.type === 'int' ? r.int(schema.min, schema.max) : true]));
                await host.sdk.command('dm.act', { module: id, kind: name, labels, ...(definition.scope === 'character' ? { who: 'Wessel' } : {}) });
            },
            clock: () => host.sdk.command('test.minute', { minute: r.pick([0, 500, 1000, 1030, 1500, 3000, 9000, 700000]) }),
            actor: async () => {
                const id = r.pick(['ca_wessel01', 'ca_odda0001', 'ca_brecht01']);
                await host.sdk.command('test.actor', { id, name: r.chance(0.3) ? null : r.pick(['Wessel', 'Odda', 'Brecht']) });
            },
            library: async () => {
                const pack = r.pick(packs);
                const roll = r.int(0, 3);
                if (roll === 0) await host.packs.packs.setEnabled(pack.id, r.chance(0.5));
                else if (roll === 1 && pack.id.startsWith('fz-')) {
                    const next = structuredClone(pack);
                    next.version = `1.${r.int(1, 9)}.0`;
                    next.content.dataModules = pack.content.dataModules.map(definition => (r.chance(0.5) ? generate(r, definition.slug, { scope: definition.scope, clock: Object.hasOwn(definition.imports ?? {}, 'clock'), offers: Object.hasOwn(definition.kinds, 'promise'), source: definition.imports?.src?.args.module ?? null }) : definition));
                    const done = await host.packs.packs.install(next);
                    if (done.ok) { packs[packs.indexOf(pack)] = next; catalog(); }
                } else if (roll === 2) await host.packs.packs.remove(pack.id);
                else await host.packs.packs.install(pack);
            },
            settings: () => host.settings.set('story-block', 'maxChangeLines', r.int(5, 20)),
            savepoint: () => host.sdk.timeline.make({ kind: 'manual', name: `Save ${r.int(1, 99)}` }),
            barrier: async () => {
                host.registry.setRestore('pending', 'Restoring a save point.');
                const list = pinned();
                const before = J(host.head().domains.dataModules ?? null);
                if (list.length) await host.sdk.command('dm.act', { module: list[0], kind: Object.keys(defs.get(list[0])?.kinds ?? { none: 1 })[0] });
                await send(...randomLines().filter(line => line.includes(' dm ')));
                host.registry.setRestore('idle', '');
                void before;
            },
            damage: () => {
                const list = host.ctx.chat.map((message, index) => (!message.is_user && message.extra?.storySuite?.spans?.some(span => span?.guard) ? index : -1)).filter(index => index > 0);
                if (!list.length) return;
                const message = host.ctx.chat[r.pick(list)];
                const record = structuredClone(message.extra.storySuite);
                const spans = record.spans.filter(span => span?.guard);
                const span = r.pick(spans);
                const how = r.int(0, 6);
                if (how === 0) record.spans = record.spans.map(each => ({ n: each.n, story: each.story }));
                else if (how === 1) delete span.guard;
                else if (how === 2) span.guard.inputHash = '0'.repeat(64);
                else if (how === 3) span.source = { ...span.source, swipeKey: 'sw_zzzzzzzz' };
                else if (how === 4) span.recorded = null;
                else if (how === 5) record.receipts = record.receipts.map(receipt => (receipt.data?.v2 ? { ...receipt, data: { ...receipt.data, v2: { ...receipt.data.v2, guard: { ...receipt.data.v2.guard, epoch: 'ep_00000009' } } } } : receipt));
                else delete record.prefix;
                message.extra.storySuite = record;
                host.store.rebuild();
            },
        };
        const names = Object.keys(operations);
        const weights = { deleteNoOpSource: 2, deleteClockSource: 2, reply: 24, replyMany: 4, cont: 5, swipe: 5, regenerate: 3, delete: 7, reread: 7, edit: 2, reload: 3, rebuild: 2, setup: 9, act: 5, clock: 4, actor: 3, library: 4, settings: 1, savepoint: 2, barrier: 1, damage: 3 };
        const deck = names.flatMap(name => Array(weights[name] ?? 1).fill(name));

        // ---- the properties -------------------------------------------------------------------
        const hostValidate = (state, domainNames) => domainNames.flatMap(name => {
            const fn = host.registry.validator(name);
            if (typeof fn !== 'function') return [];
            try { return (fn(state?.domains?.[name], state) ?? []).map(String); } catch (error) { return [String(error?.message ?? error)]; }
        });
        const cold = chat => {
            const store = createStore({ chat: () => chat, save: async () => {}, validate: hostValidate, scratch: name => host.registry.scratch(name), checkpointEvery: 100000, checkpointBytes: 1 << 30 });
            createCommandBus({ store, registry: host.registry, settings: host.settings });
            store.ensureInitial(host.registry.initialState());
            return store;
        };
        const key = problems => J(problems.map(problem => [problem.index, problem.block ?? null, problem.code ?? null]).sort((a, b) => a[0] - b[0] || (a[1] ?? -1) - (b[1] ?? -1)));

        const verify = label => {
            let head;
            try { head = host.store.head(); } catch (error) { fail(label, `head threw: ${error.message}`); return; }
            const live = J(head);
            const chat = JSON.parse(J(host.ctx.chat));
            const stripped = strip(chat);
            Date.now = () => { throw new Error('replay read the clock'); };
            Math.random = () => { throw new Error('replay used Math.random'); };
            try {
                const trusted = cold(JSON.parse(J(chat)));
                if (head && J(trusted.head()) !== live) fail(label, 'live head differs from a cold replay of the stored chat', { live: live.slice(0, 400), cold: J(trusted.head()).slice(0, 400) });
                const full = cold(stripped);
                if (head && J(full.head()) !== live) fail(label, 'live head differs from a replay with every checkpoint stripped (all guards asked)', { live: live.slice(0, 400), full: J(full.head()).slice(0, 400) });
                if (key(host.store.problems()) !== key(full.problems())) fail(label, 'Problems differ between live and a full replay', { live: key(host.store.problems()), full: key(full.problems()) });
                const carriers = host.ctx.chat.map((message, index) => (!message.is_user && message.extra?.storySuite ? index : -1)).filter(index => index >= 0);
                for (let k = 0; k < Math.min(3, carriers.length); k += 1) {
                    const index = r.pick(carriers);
                    let a, b;
                    try { a = J(host.store.at(index)); b = J(full.at(index)); } catch { continue; }
                    if (a !== b) fail(label, `state at carrier ${index} differs from a full replay`);
                }
            } catch (error) {
                fail(label, `cold replay threw: ${error.message}`, String(error.stack).split('\n').slice(0, 4).join(' | '));
            } finally { Date.now = saved.now; Math.random = saved.random; }
            const revs = host.store.receipts().map(entry => entry.receipt.rev).filter(Number.isInteger);
            if (!revs.every((rev, n) => n === 0 || rev > revs[n - 1])) fail(label, 'receipt revs are not strictly increasing', revs.join(','));
            if (head && revs.length && head.meta.rev !== revs.at(-1)) fail(label, 'the head rev is not the last receipt rev');
            const domain = head?.domains?.dataModules;
            if (domain !== undefined) {
                const problems = validateDomain(domain);
                if (problems.length) fail(label, `dataModules does not validate: ${problems.join(' ')}`);
                for (const [module, active] of Object.entries(domain.active)) if (!domain.pins[active.hash]) fail(label, `pin ${module} lost its definition`);
                for (const each of Object.values(domain.perReply)) if (each.roots > DM_LIMITS.replyRoots) fail(label, 'per-reply roots over the budget');
            }
            for (const message of host.ctx.chat) for (const span of message.extra?.storySuite?.spans ?? []) {
                if (['dm.pin', 'dm.attach', 'dm.migrate'].includes(span?.guard?.predicate?.kind) && span.guard.replyBound !== true) fail(label, `${span.guard.predicate.kind} is not reply-bound`);
            }
            for (const problem of host.turn.problems()) if (GARBAGE_THROW.test(problem.message ?? '') && /failed|threw/i.test(problem.message ?? '')) fail(label, `a hook or command threw: ${problem.message}`);
        };

        verify('start');
        const offer = host.sdk.query('dataModules.offers').find(row => row.module === 'pack.fz-a/witness');
        const pin = await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash });
        if (!pin.ok) fail('probe pin', `could not pin generated witness module: ${J(pin)}`);
        verify('probe pin');
        // Every seed exercises both semantic failures, before arbitrary edits can remove the pin.
        for (const name of ['deleteNoOpSource', 'deleteClockSource']) {
            await operations[name]();
            verify(name);
        }
        // Most of the chat runs with something pinned: enable up to three modules (and attach actors) in the first replies.
        for (let n = r.int(1, 3); n > 0; n -= 1) {
            try { await operations.setup(); if (r.chance(0.6)) await send(...randomLines()); } catch (error) { fail('opening', `the operation threw: ${error?.message}`); }
            verify(`opening#${n}`);
        }
        for (let step = 0; step < steps && fails.length < 3; step += 1) {
            const name = r.pick(deck);
            before = JSON.parse(J(host.ctx.chat));
            try { await operations[name](); } catch (error) {
                if (!/read-only|newer|restore|^fake:/i.test(String(error?.message)) && !/testkit\/fake-st\.js/.test(String(error?.stack).split('\n').slice(0, 3).join(' '))) fail(`${name}#${step}`, `the operation threw: ${error?.message}`, String(error?.stack).split('\n').slice(0, 4).join(' | '));
            }
            trace.push(name);
            verify(`${name}#${step}`);
        }
        const stats = { sourceDeletes, pinned: pinned().length, spans: host.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).filter(span => String(span.guard?.predicate?.kind ?? '').startsWith('dm.')).length };
        host.close();
        host = null;
        return { seed, steps, fails, stats, ...(verbose ? { trace } : {}) };
    } finally {
        Date.now = saved.now; Math.random = saved.random; console.warn = warn;
        host?.close();
    }
}
void TRAP_OK;
