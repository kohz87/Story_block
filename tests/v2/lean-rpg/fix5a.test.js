// RPG fix round 5, engine side (review 158 blockers 2, 3 and 6). Each test is the review's repro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { validateDataModules } from '../../../src/v2/data-modules/check.js';
import { blockCards, settleReserve } from '../../../src/v2/data-modules/part.js';
import { ROLES } from '../../../src/v2/lean-rpg/index.js';
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { pack, reload, rebuilt, reply, success, view } from '../data-modules/helpers.js';

const template = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
const check = definition => validateDataModules([definition], { packId: 'chat', capabilities: ['data-modules-v1'] });
const line = (slug, kind, extra = '') => `~ dm ${slug} — why | kind: ${kind}${extra}`;
const settles = host => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'dm.settle');
async function story(t) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    return host;
}
async function heroes(host, count) {
    for (let n = 0; n < count; n += 1) {
        const definition = template('Character');
        definition.slug = `hero-${n}`; definition.name = `Hero ${n}`; definition.state.who.default = `Hero${n}`;
        success(await host.sdk.command('dm.define', { definition }));
    }
}

// --- B2: the settle reserve is what a settle can cost ----------------------------------------------------------------------------------

test('B2: eight stock Characters leave the story its room: the first block action is taken, and every settle still runs', async t => {
    const host = await story(t);
    await heroes(host, 8);
    await host.send('Hit.', reply(line('hero-0', 'set-health', ' | to: Hurt')));
    assert.equal(view(host, 'pack.chat/hero-0').chat.health, 3, JSON.stringify(host.turn.problems().map(problem => problem.message)));
    assert.equal(settles(host).length, 8);
    rebuilt(host);
    await reload(host);
});

test('B2: with seven Characters the story keeps 25 of its 32 root places (one is held for each of seven settles), and the 26th is refused plainly', async t => {
    const host = await story(t);
    await heroes(host, 7);
    const tags = Array.from({ length: 30 }, (_, n) => `t${n}`);
    const ticker = { slug: 'ticker', name: 'Ticker', schema: 1, stateVersion: 1, scope: 'chat', state: { n: { type: 'int', min: 0, max: 99, default: 0 } },
        kinds: { tick: { op: '~', labels: { tag: { type: 'enum', values: tags } }, oncePerReply: ['tag'], effects: [{ op: 'add', path: ['n'], value: 1, bounds: 'clamp' }] } } };
    success(await host.sdk.command('dm.define', { definition: ticker }));
    await host.send('Tick.', reply(...tags.map(tag => `~ dm ticker — why | kind: tick | tag: ${tag}`)));
    assert.equal(view(host, 'pack.chat/ticker').chat.n, 25, 'the ticks that fit beside seven settle roots');
    assert.ok(host.turn.problems().some(problem => /last place is kept for settling/.test(problem.message)));
    assert.equal(settles(host).length, 7, 'no settle was refused');
    rebuilt(host);
    await reload(host);
});

test('B2: the visits held for settling are counted from the blocks\' own functions: never less than the settles took, much less than a flat share', async t => {
    const host = await story(t);
    // 4 reply-end functions of 16 effects each, every effect a small sum: far more than the stock latch costs
    const effects = Array.from({ length: 16 }, () => ({ op: 'set', path: ['a'], value: ['min', ['add', ['add', ['get', ['a']], 1], ['add', ['get', ['a']], 2]], 3] }));
    const heavy = { slug: 'heavy', name: 'Heavy', schema: 1, stateVersion: 1, scope: 'chat', role: 'rules', state: { a: { type: 'int', min: 0, max: 5, default: 0 } }, kinds: {},
        replyEnd: Array.from({ length: 4 }, () => ({ type: 'reply-end', when: true, effects })) };
    const copy = slug => ({ ...structuredClone(heavy), slug, name: slug });
    for (const slug of ['h1', 'h2', 'h3', 'h4', 'h5']) success(await host.sdk.command('dm.define', { definition: copy(slug) }));
    const ticker = { slug: 'ticker', name: 'Ticker', schema: 1, stateVersion: 1, scope: 'chat', state: { n: { type: 'int', min: 0, max: 99, default: 0 } },
        kinds: { tick: { op: '~', labels: { tag: { type: 'enum', values: ['a', 'b'] } }, oncePerReply: ['tag'], effects: [{ op: 'add', path: ['n'], value: 1, bounds: 'clamp' }] } } };
    success(await host.sdk.command('dm.define', { definition: ticker }));
    await host.send('Tick.', reply('~ dm ticker — why | kind: tick | tag: a'));
    assert.equal(view(host, 'pack.chat/ticker').chat.n, 1);
    assert.equal(settles(host).length, 5, 'the five settles all ran inside the reply\'s visits');
    // the estimate is never less than what the settles really took, and a stock Character is a small share of it
    const reserve = settleReserve(host.head());
    const spent = Object.values(host.head().domains.dataModules.perReply).flatMap(reply => Object.values(reply.actions)).reduce((sum, action) => sum + action.visits, 0);
    assert.ok(reserve.visits >= spent - 1, `${reserve.visits} held for ${spent} spent (the tick is 1 or 2 of them)`);
    assert.equal(reserve.roots, 5);
    assert.ok(reserve.visits < 5 * 2048, 'less than a flat share for each');
    const stock = await story(t);
    await heroes(stock, 8);
    assert.ok(settleReserve(stock.head()).visits < 8 * 200, `${settleReserve(stock.head()).visits} for eight stock Characters`);
});

// --- B3: the death card of a character always shows ---------------------------------------------------------------------------------

test('B3: more than eight other end cards cannot push the death card out of the eight slots', async t => {
    const host = await story(t);
    const ends = [1, 2, 3, 4].map(n => ({ type: 'card', when: true, tone: 'end', title: 'x', text: 'End.' }));
    for (const slug of ['one', 'two']) {
        const cards = ends.map((card, n) => ({ ...card, title: `${slug} ${n + 1}` }));
        success(await host.sdk.command('dm.define', { definition: { slug, name: slug, schema: 1, stateVersion: 1, scope: 'chat', state: { a: { type: 'bool', default: false } }, kinds: {}, cards } }));
    }
    success(await host.sdk.command('dm.define', { definition: template('Character') }));
    await host.send('Down.', reply(line('character', 'set-health', ' | to: Down')));
    await host.send('Place.', reply('~ place Dungeon | kind: ruin'));
    assert.equal(view(host, 'pack.chat/character').chat.alive, false);
    const all = blockCards(host.head()).map(entry => entry.card.title);
    assert.equal(all.length, 9);
    assert.equal(all[0], 'The story ends here', 'a character\'s death card is first, before eight other end cards');
    const slots = createCoreModule().cards;
    const shown = Object.keys(slots).filter(key => key.startsWith('block-card-')).map(key => slots[key].for(host.head())?.title).filter(Boolean);
    assert.equal(shown.length, 8);
    assert.ok(shown.includes('The story ends here'), JSON.stringify(shown));
    assert.deepEqual(all.slice(1, 3), ['one 1', 'one 2'], 'other end cards keep pin order after it');
});

// --- B6: a role block belongs to the chat -------------------------------------------------------------------------------------------

test('B6: a role on a block for a character is refused with a plain sentence; the same block for the chat is accepted', async t => {
    const foes = scope => ({ ...template('Foes'), scope });
    for (const role of ROLES) {
        const made = { slug: 'sheet', name: 'Sheet', schema: 1, stateVersion: 1, scope: 'character', role, state: { who: { type: 'text', max: 40, default: 'W' } }, kinds: {} };
        const result = check(made);
        assert.equal(result.ok, false, role);
        assert.equal(result.errors[0].path, 'content.dataModules[0].role');
        assert.match(result.errors[0].message, /belongs to the chat/);
        assert.equal(check({ ...made, scope: 'chat' }).ok, true, `${role} for the chat`);
    }
    assert.equal(check(foes('character')).ok, false);
    assert.equal(check(foes('chat')).ok, true);
    // a block for a character with no role is as before
    const plain = { slug: 'plain', name: 'Plain', schema: 1, stateVersion: 1, scope: 'character', state: { a: { type: 'bool', default: false } }, kinds: {} };
    assert.equal(check(plain).ok, true);
    // a pack carrying one is refused when it is installed, so it can never be pinned and attached
    const host = await createHost(); t.after(() => host.close());
    const installed = await host.packs.packs.install(pack([foes('character')]));
    assert.notEqual(installed.ok, true);
    assert.match(JSON.stringify(installed), /belongs to the chat/);
});
