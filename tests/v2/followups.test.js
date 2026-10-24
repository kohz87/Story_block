// The follow-ups finished with the break-round fixes: sdk.reread (F40), the currency plural on the
// screens and from packs, a used consumable going to item.use (F96), events fired only from their
// pack definition, owners who must be in the party, pack places that are hidden, and the packs
// panel's counts. Each test fails on the code before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { changesSummary } from '../../src/v2/screens/changes-card.js';
import { countsLine } from '../../src/v2/packs/panel.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { USED_WORDS, usedByLine } from '../../src/v2/domains/inventory.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const names = host => host.sdk.query('inventory.items').map(item => `${item.name}×${item.qty}`).sort();

async function fresh(t, options) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

// ---- sdk.reread (F40) -----------------------------------------------------------------------------

test('reread: the edited block replaces the story changes; the reader\'s own actions on the reply stay', async t => {
    const host = await fresh(t);
    await host.send('Search.', reply('Rope.', ['+ item Rope | qty: 2', '~ place Old Mill | kind: ruin']));
    const index = host.ctx.chat.length - 1;
    const moved = await host.sdk.command('scene.place', { name: 'Riverbank' });
    assert.equal(moved.ok, true, moved.message);
    const turns = [];
    host.events.on('turn', turn => turns.push(turn));
    const saves = host.st.saves.length;
    await host.st.editMessage(index, reply('A torch, not rope.', ['+ item Torch', '+ coin 5']));
    const done = await host.sdk.reread(index);
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(done.receipts.map(receipt => receipt.type), ['capture.item', 'capture.coin']);
    assert.deepEqual(names(host), ['Torch×1']);
    assert.equal(host.head().domains.inventory.wallets.party.coin, 5);
    assert.equal(host.head().domains.scene.place.name, 'Riverbank', 'the reader\'s move after the reply is kept on top');
    const record = host.ctx.chat[index].extra.storySuite;
    assert.deepEqual(record.receipts.map(receipt => receipt.cause), ['story', 'story', 'ui']);
    const revs = record.receipts.map(receipt => receipt.rev);
    assert.equal(new Set(revs).size, revs.length, 'every receipt on the reply keeps a rev of its own');
    assert.deepEqual(turns.map(turn => [turn.index, turn.type]), [[index, 'reread']]);
    assert.deepEqual(turns[0].problems, []);
    assert.equal(host.st.saves.length, saves + 1, 'saved once');
    // The block is hidden again, and a rebuild from the chat gives the same state.
    assert.doesNotMatch(host.ctx.chat[index].mes.replace(/<!--[\s\S]*?-->/g, ''), /<Changes>/);
    const live = host.head();
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
});

test('reread: refused lines come back as problems; the swipe shown is the one read', async t => {
    const host = await fresh(t);
    await host.send('Search.', reply('Rope.', ['+ item Rope']));
    const index = host.ctx.chat.length - 1;
    await host.swipe(reply('A lamp.', ['+ item Lamp']));
    await host.st.editMessage(index, reply('A lamp and junk.', ['+ item Lamp', '- item Anvil', 'not a line']));
    const done = await host.sdk.reread(index);
    assert.equal(done.ok, true);
    assert.deepEqual(names(host), ['Lamp×1']);
    assert.deepEqual(done.problems.map(problem => problem.code).sort(), ['NOT_FOUND', 'UNREADABLE']);
});

test('reread: a reply whose old story changes a later reply depends on is refused, and nothing changes', async t => {
    const host = await fresh(t);
    await host.send('Search.', reply('Rope.', ['+ item Rope']));
    const index = host.ctx.chat.length - 1;
    await host.send('Use it.', reply('Gone.', ['- item Rope']));
    const before = JSON.stringify(host.ctx.chat);
    await host.st.editMessage(index, reply('Nothing.', ['+ item Lamp']));
    const edited = JSON.stringify(host.ctx.chat);
    const done = await host.sdk.reread(index);
    assert.equal(done.ok, false);
    assert.equal(done.code, 'CONFLICT');
    assert.match(done.message, /A later change \(message \d+\) depends on this reply/);
    assert.equal(JSON.stringify(host.ctx.chat), edited, 'no record was written');
    assert.notEqual(edited, before);
});

test('reread: refused for the reader\'s messages, system messages, messages without a record and missing ones', async t => {
    const host = await fresh(t);
    await host.send('Search.', reply('Rope.', ['+ item Rope']));
    const user = host.ctx.chat.findLastIndex(message => message.is_user);
    assert.equal((await host.sdk.reread(user)).code, 'REFUSED');
    assert.equal((await host.sdk.reread(99)).code, 'NOT_FOUND');
    host.ctx.chat.push({ name: 'System', is_user: false, is_system: true, mes: 'Note.', extra: {} });
    assert.match((await host.sdk.reread(host.ctx.chat.length - 1)).message, /system message/);
    host.ctx.chat.at(-1).is_system = false;
    assert.match((await host.sdk.reread(host.ctx.chat.length - 1)).message, /no story record/);
});

// ---- currency plural (a, b) -----------------------------------------------------------------------

test('the changes card summary uses the currency plural for amounts other than one', () => {
    const currency = { name: 'mark', plural: 'marks', short: 'm' };
    const state = coin => ({ domains: { inventory: { wallets: { party: { coin } }, stacks: {}, defs: {} } } });
    assert.match(changesSummary({ state: state(45), before: state(1), changes: ['/domains/inventory/wallets/party/coin'], currency }), /\+44 marks/);
    assert.match(changesSummary({ state: state(2), before: state(1), changes: ['/domains/inventory/wallets/party/coin'], currency }), /\+1 mark(?!s)/);
});

test('a pack\'s currency plural passes through to the settings suggestion', async t => {
    const checked = validatePack(JSON.stringify({ id: 'mk', version: '1.0.0', name: 'Marks', requires: { storyBlock: '^2' }, currency: { name: 'crown', plural: 'crownen', short: 'c' } }));
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.deepEqual(checked.pack.currency, { name: 'crown', short: 'c', plural: 'crownen' });
    assert.equal(validatePack(JSON.stringify({ id: 'mk', version: '1.0.0', name: 'M', requires: { storyBlock: '^2' }, currency: { name: 'c', plural: 'x'.repeat(25) } })).ok, false);
    const probe = await createHost();
    await probe.packs.packs.install(JSON.stringify({ id: 'mk', version: '1.0.0', name: 'Marks', requires: { storyBlock: '^2' }, currency: { name: 'crown', plural: 'crownen' } }), { origin: 'pack.json' });
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    const host = await fresh(t, { settings });
    assert.deepEqual(host.sdk.query('inventory.currency'), { name: 'crown', plural: 'crownen', short: 'c' });
});

// ---- `- item X` used → item.use (d) -----------------------------------------------------------------

const user = () => {
    const calls = [];
    return {
        calls,
        def: {
            id: 'use-probe', name: 'Use probe', version: '0.0.0',
            commands: {
                'item.use'(ctx, payload) {
                    calls.push(payload);
                    const found = ctx.query('inventory.find', { name: payload.name });
                    ctx.call('inventory.consume', { def: found.defs[0].id, qty: payload.qty });
                    return { summary: `${payload.on ?? 'Someone'} drinks the ${payload.name}.`, narrate: true, data: { healed: 5 } };
                },
            },
        },
    };
};

test('- item X marked used goes to item.use when a module answers it; lost or sold is taken away as before', async t => {
    const probe = user();
    const host = await fresh(t, { modules: [probe.def] });
    const grant = await host.bus.command('inventory.grant', { def: { name: 'Healing Draught', kind: 'consumable' }, qty: 4 }, { cause: 'system' });
    assert.equal(grant.ok, true, grant.message);
    await host.send('Drink.', reply('Mira drinks one.', ['- item Healing Draught | on: Mira']));
    assert.deepEqual(probe.calls, [{ name: 'Healing Draught', on: 'Mira', qty: 1, story: true }]);
    const receipt = host.sdk.receipts().at(-1).receipt;
    assert.equal(receipt.summary, 'Mira drinks the Healing Draught.');
    assert.equal(receipt.data.used, true);
    await host.send('Sell.', reply('The trader buys two.', ['- item Healing Draught | qty: 2 | sold to the trader']));
    assert.equal(probe.calls.length, 1, 'sold is not a use');
    assert.deepEqual(names(host), ['Healing Draught×1']);
    await host.send('Use.', reply('Quiet.', ['- item Healing Draught | used: yes']));
    assert.equal(probe.calls.length, 2);
    assert.deepEqual(names(host), []);
});

test('- item X used without a module answering item.use consumes as before; a non-consumable is never routed', async t => {
    const host = await fresh(t);
    await host.bus.command('inventory.grant', { def: { name: 'Healing Draught', kind: 'consumable' }, qty: 2 }, { cause: 'system' });
    await host.send('Drink.', reply('She drank it.', ['- item Healing Draught']));
    assert.deepEqual(names(host), ['Healing Draught×1']);
    assert.ok(usedByLine({ text: '', labels: {} }, 'She quaffed it.'));
    assert.ok(!usedByLine({ text: 'spilled', labels: {} }, 'She drank it.'));
    assert.ok(USED_WORDS.test('swallowed'));
});

// ---- events (B3-1, B3-9) --------------------------------------------------------------------------

const eventPack = event => JSON.stringify({ id: 'ev', version: '1.0.0', name: 'Events', requires: { storyBlock: '^2' }, content: { events: [event] } });

test('a pack event\'s steps come from its definition and run as caller event:<id>', async t => {
    const seen = [];
    const spy = {
        id: 'spy', name: 'Spy', version: '0.0.0',
        commands: { 'spy.note'(ctx) { seen.push(ctx.caller); return { summary: 'noted' }; } },
    };
    const host = await fresh(t, { modules: [spy] });
    assert.equal((await host.packs.packs.install(eventPack({ id: 'bells', when: 'true', cue: 'Bells ring.', then: [{ command: 'spy.note' }] }), { origin: 'pack.json' })).ok, true);
    await host.send('Listen.', 'Bells.');
    assert.deepEqual(seen, ['event:pack.ev/bells']);
    const forged = host.bus.command('events.fire', { id: 'pack.ev/bells', cue: 'Forged.', then: [{ command: 'wallet.receive', payload: { amount: 50 } }] }, { cause: 'system' });
    assert.equal(forged.code, 'CLAIMED', 'once: already happened; the payload\'s cue and steps never count');
});

test('a repeating event pays once per reply: not again on a regenerate, a Continue or a dry run', async t => {
    const host = await fresh(t);
    await host.packs.packs.install(eventPack({ id: 'tithe', when: 'true', cue: 'A tithe.', once: false, then: [{ command: 'wallet.receive', payload: { owner: 'party', amount: 10 } }] }), { origin: 'pack.json' });
    const coin = () => host.head().domains.inventory.wallets.party?.coin ?? 0;
    await host.send('Wait.', 'One.');
    assert.equal(coin(), 10);
    await host.regenerate('One again.');
    await host.cont(' On.');
    await host.st.generate('normal', { reply: 'x', dryRun: true });
    assert.equal(coin(), 10);
    await host.send('Wait more.', 'Two.');
    assert.equal(coin(), 20, 'the next reply pays again');
});

// ---- owners (B3-7) ----------------------------------------------------------------------------------

test('grants, transfers and payments to an owner not in the party are refused; party.actors decides', async t => {
    const party = {
        id: 'party-probe', name: 'Party', version: '0.0.0',
        queries: { 'party.actors': () => [{ id: 'ac_lyra0001', name: 'Lyra' }] },
    };
    const host = await fresh(t, { modules: [party] });
    const ghost = await host.bus.command('inventory.grant', { name: 'Rope', owner: 'ac_zzzzzzzz' }, { cause: 'system' });
    assert.equal(ghost.code, 'REFUSED');
    assert.match(ghost.message, /ac_zzzzzzzz is not in the party/);
    assert.equal((await host.bus.command('wallet.receive', { owner: 'ac_zzzzzzzz', amount: 5 }, { cause: 'system' })).code, 'REFUSED');
    assert.equal((await host.bus.command('inventory.grant', { name: 'Rope', owner: 'ac_lyra0001' }, { cause: 'system' })).ok, true);
});

// ---- packs: hidden places, panel counts (f, g) ------------------------------------------------------

test('a pack place may be hidden (or secret); anything else there is refused', () => {
    const pack = places => JSON.stringify({ id: 'map', version: '1.0.0', name: 'Map', requires: { storyBlock: '^2' }, content: { places } });
    const checked = validatePack(pack([{ name: 'Vault', x: 1, y: 2, hidden: true }, { name: 'Grotto', x: 3, y: 4, secret: true }, { name: 'Square', x: 0, y: 0 }]));
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.deepEqual(checked.pack.content.places.map(place => place.hidden ?? false), [true, true, false]);
    assert.equal(validatePack(pack([{ name: 'Vault', x: 1, y: 2, hidden: 'yes' }])).ok, false);
});

test('the packs panel counts terms and ranks', () => {
    assert.equal(countsLine({ items: 2, terms: 1, ranks: 7 }, false), '2 items, 1 term set, 7 ranks');
});

// ---- Re-read plans a `replan` system step again (B-a1-13) -------------------------------------------

// A clock the story moves (`! tick +N`) and a cue before each reply that folds what the clock gave into a
// total (like RPG Battle's story-time heal): `replan: true` says it was planned from the story state.
const folding = replan => ({
    id: 'fold-test', name: 'Fold test', version: '0.0.0',
    domains: { fold: { initial: () => ({ clock: 0, folded: 0, gained: 0 }), validate: () => [] } },
    commands: {
        'fold.cue'(ctx) {
            const fold = ctx.draft('fold');
            const gain = Math.max(0, fold.clock - fold.folded);
            fold.gained += gain;
            fold.folded = Math.max(fold.folded, fold.clock);
            return { summary: `Folded ${gain}.`, narrate: false, ...(replan ? { replan: true } : {}) };
        },
    },
    hooks: { beforeGenerate: view => (view?.state?.domains?.fold?.clock > view?.state?.domains?.fold?.folded ? { commands: [{ type: 'fold.cue', payload: {} }] } : { commands: [] }) },
    capture: {
        kinds: { tick: { grammar: '! tick +<n>' } },
        apply(ctx, line) {
            const fold = ctx.draft('fold');
            fold.clock += Number(String(line.name).replace('+', '')) || 0;
            return { summary: `Tick ${fold.clock}.`, narrate: false };
        },
    },
});

test('reread: a system step marked replan runs again on the new story changes; one not marked is applied as it was', async t => {
    for (const replan of [true, false]) {
        const host = await fresh(t, { modules: [folding(replan)] });
        await host.send('Wait.', reply('Hours pass.', ['! tick +8']));
        const index = host.ctx.chat.length - 1;
        await host.send('Go on.', 'Morning.');
        assert.deepEqual(host.head().domains.fold, { clock: 8, folded: 8, gained: 8 }, 'the cue folded the 8');
        const cue = host.sdk.receipts().map(entry => entry.receipt).find(receipt => receipt.type === 'fold.cue');
        assert.equal(Boolean(cue?.replan), replan, 'the receipt keeps what to run it again with');
        await host.st.editMessage(index, reply('Only an hour.', ['! tick +1']));
        const done = await host.sdk.reread(index);
        assert.equal(done.ok, true, done.message);
        assert.deepEqual(host.head().domains.fold, replan ? { clock: 1, folded: 1, gained: 1 } : { clock: 1, folded: 8, gained: 8 },
            replan ? 'planned again: the 1 the reply now gives' : 'applied as it was');
        host.close();
    }
});
