// RPG fix round 4, engine side (review 155 blockers 1, 2, 6, 7, 8, 10, 12 and the replay fuzz script; review 157 blocker 1).
// Each test is the review's repro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { LEAN_RPG_FEATURE } from '../../../src/v2/lean-rpg/index.js';
import { validateDataModules } from '../../../src/v2/data-modules/check.js';
import { blockCards, summaryOf } from '../../../src/v2/data-modules/part.js';
import { activeDefinition } from '../../../src/v2/data-modules/adapters.js';
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { readParty, stageMax } from '../../../src/v2/lean-rpg/view/party-data.js';
import { createPartyWidget } from '../../../src/v2/lean-rpg/view/party.js';
import { setupDom } from '../view/mounts/helpers.js';
import { characterDefinition, fakeState, roleOf } from './view/helpers.js';
import { reload, rebuilt, reply, success, view } from '../data-modules/helpers.js';

const template = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
const check = definition => validateDataModules([definition], { packId: 'chat', capabilities: ['data-modules-v1'] });
const line = (slug, kind, extra = '') => `${/^(add-|practice-)/.test(kind) ? '+' : '~'} dm ${slug} — why | kind: ${kind}${extra}`;
const sheet = (host, slug = 'character') => view(host, `pack.chat/${slug}`).chat;
async function story(t, ...names) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (const name of names) success(await host.sdk.command('dm.define', { definition: template(name) }));
    return host;
}
const settles = host => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'dm.settle');

// --- B1: a bar field has at most ten stages --------------------------------------------------------------------------------------

test('B1: a role block\'s bar fields (health, mana, stamina, a foe\'s health) have at most ten stages; the Party view clamps whatever got in', async t => {
    const huge = { type: 'int', min: 0, max: 4294967295, default: 1 };
    const sheetOf = state => ({ slug: 'sheet', name: 'Sheet', schema: 1, stateVersion: 1, scope: 'chat', role: 'character', kinds: {}, state: { who: { type: 'text', max: 40, default: 'Wessel' }, ...state } });
    for (const key of ['health', 'mana', 'stamina']) {
        const result = check(sheetOf({ [key]: huge }));
        assert.equal(result.ok, false, key);
        assert.equal(result.errors[0].path, `content.dataModules[0].state.${key}`);
    }
    const foes = state => ({ slug: 'foes', name: 'Foes', schema: 1, stateVersion: 1, scope: 'chat', role: 'foes', kinds: {}, state });
    assert.equal(check(foes({ hurt1: huge })).ok, false, 'a foe\'s health');
    const stages = max => check(sheetOf({ health: { type: 'int', min: 0, max, default: 0 } })).ok;
    assert.deepEqual([stages(9), stages(10), stages(11)], [true, false, false], 'ten stages (0 to 9) fit, eleven do not');
    assert.equal(check(sheetOf({ health: { type: 'int', min: 4294967290, max: 4294967295, default: 4294967290 } })).ok, false, 'a short range far from empty is not a bar either');
    const plain = sheetOf({ health: huge });
    delete plain.role;
    assert.equal(check(plain).ok, true, 'a block with no role is not the RPG\'s to limit');
    // through the real command, the chat block is refused with a plain sentence
    const host = await story(t);
    const refused = await host.sdk.command('dm.define', { definition: sheetOf({ health: huge }) });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /at most 10 stages/);
    // a block that is already in the state (an older chat) is drawn clamped
    const wide = characterDefinition('wessel', 'Wessel');
    wide.state.health = { ...huge, default: 4294967295 };
    const state = fakeState([{ definition: wide, fields: { health: 4294967295 } }]);
    const [character] = readParty(state, { roleOf });
    assert.equal(character.bars.health.max, 10);
    assert.equal(stageMax('health', huge), 10);
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    createPartyWidget({ headState: () => state, readerName: () => 'Wessel', roleOf, openWizard: null }).render(el, {}, { command: async () => ({ ok: true }) });
    assert.ok(el.querySelector('.rpg-card[data-character="Wessel"]'), 'the card is drawn');
});

// --- B2: hidden fields stay out of the role tail ---------------------------------------------------------------------------------

const HIDDEN = 'hidden clue: the king is a traitor';
const hiddenSkills = () => ({ slug: 'skills', name: 'Skills', schema: 1, stateVersion: 1, scope: 'chat', role: 'skills', kinds: {},
    state: { who: { type: 'text', max: 40, default: 'Wessel' }, skill1: { type: 'text', max: 40, default: 'Magic' }, about1: { type: 'text', max: 240, default: HIDDEN, prompt: false } } });

test('B2: prompt: false holds for the skills, foes and who of a role block, with the RPG on and off', async t => {
    const host = await story(t);
    success(await host.sdk.command('dm.define', { definition: hiddenSkills() }));
    const foes = { slug: 'foes', name: 'Foes', schema: 1, stateVersion: 1, scope: 'chat', role: 'foes', kinds: {}, state: {
        foe1: { type: 'text', max: 40, default: 'Rat' }, count1: { type: 'int', min: 0, max: 9, default: 3 }, class1: { type: 'int', min: 1, max: 9, default: 4, prompt: false },
        foe2: { type: 'text', max: 40, default: 'Secret baron', prompt: false }, count2: { type: 'int', min: 0, max: 9, default: 1 } } };
    const sheet = { slug: 'sheet', name: 'Sheet', schema: 1, stateVersion: 1, scope: 'chat', role: 'character', kinds: {}, state: {
        who: { type: 'text', max: 40, default: 'Hidden Name', prompt: false }, str: { type: 'int', min: 1, max: 20, default: 10 } } };
    for (const definition of [foes, sheet]) success(await host.sdk.command('dm.define', { definition }));
    const forbidden = [HIDDEN, 'traitor', 'Secret baron', 'Class IV', 'Hidden Name'];
    for (const rpg of [true, false]) {
        const state = host.head();
        for (const slug of ['skills', 'foes', 'sheet']) for (const word of forbidden) assert.ok(!summaryOf(state, `pack.chat/${slug}`, { rpg }).includes(word), `${slug} ${word} rpg=${rpg}`);
    }
    assert.match(summaryOf(host.head(), 'pack.chat/skills'), /^Wessel skills:\n- Magic/, 'what is not hidden is still told');
    assert.match(summaryOf(host.head(), 'pack.chat/foes'), /^Foes: Rat ×3\./);
    // the prompt really sent: feature off (the ordinary block line) and on (the compact line)
    for (const on of [false, true]) {
        host.features.set(LEAN_RPG_FEATURE, on);
        const sent = JSON.stringify((await host.send('Go.', 'On.')).request);
        for (const word of forbidden) assert.ok(!sent.includes(word), `sent ${word} on=${on}`);
        assert.equal(sent.includes('Wessel skills:'), on, 'the compact role line only while the RPG is on');
        assert.ok(sent.includes('Magic'));
    }
});

// --- B6: the story cannot kill a character -----------------------------------------------------------------------------------------

test('B6: the stock Character has no set-alive; a narrator line cannot kill a healthy character, death only comes by the reply-end latch', async t => {
    assert.equal('set-alive' in template('Character').kinds, false);
    const host = await story(t, 'Character');
    await host.send('Strike.', reply(line('character', 'set-alive', ' | to: false')));
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive], [5, false, true]);
    assert.ok(host.turn.problems().some(problem => /set-alive/.test(problem.message) || /character/.test(problem.message)), 'the line is refused, not applied');
    // the latch still works: Down in one reply, still Down in the next
    await host.send('Hit.', reply(line('character', 'set-health', ' | to: Down')));
    assert.equal(sheet(host).alive, true);
    await host.send('Hit again.', reply(line('character', 'set-health', ' | to: Down')));
    assert.equal(sheet(host).alive, false);
    rebuilt(host);
    await reload(host);
});

// --- B7: Re-reading an earlier reply settles a later one ---------------------------------------------------------------------------

test('B7: after Re-read of reply A to Down, a later reply B with an unrelated accepted line settles the death: live = rebuild = reload = playing it forward', async t => {
    const host = await story(t, 'Character');
    await host.send('A.', reply(line('character', 'set-health', ' | to: Hurt')));
    const a = host.store.headIndex();
    await host.send('B.', reply('~ place Dungeon | kind: ruin'));
    assert.equal(settles(host).length, 2, 'every reply with accepted lines holds its settle step, a no-op or not');
    assert.deepEqual([sheet(host).health, sheet(host).alive], [3, true]);
    await host.st.editMessage(a, reply(line('character', 'set-health', ' | to: Down')));
    success(await host.sdk.reread(a));
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive], [0, true, false], 'B now settles: Down at the start of B and still Down at its end');
    assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
    rebuilt(host);
    await reload(host);
    // the same two replies played forward
    const forward = await story(t, 'Character');
    await forward.send('A.', reply(line('character', 'set-health', ' | to: Down')));
    await forward.send('B.', reply('~ place Dungeon | kind: ruin'));
    assert.deepEqual(sheet(forward), sheet(host), 'the Re-read gives what playing the final replies forward gives');
    // and the other way: Re-read A back to Hurt takes B\'s settling away
    await host.st.editMessage(a, reply(line('character', 'set-health', ' | to: Hurt')));
    success(await host.sdk.reread(a));
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive], [3, false, true]);
    rebuilt(host);
    await reload(host);
});

// --- B8: the action cap leaves room to settle ----------------------------------------------------------------------------------------

test('B8: 31 distinct story actions fill a reply, the 32nd is refused plainly, and the settle step still runs', async t => {
    const host = await story(t, 'Character');
    const tags = Array.from({ length: 32 }, (_, n) => `t${n}`);
    const ticker = { slug: 'ticker', name: 'Ticker', schema: 1, stateVersion: 1, scope: 'chat', state: { n: { type: 'int', min: 0, max: 99, default: 0 } },
        kinds: { tick: { op: '~', labels: { tag: { type: 'enum', values: tags } }, oncePerReply: ['tag'], effects: [{ op: 'add', path: ['n'], value: 1, bounds: 'clamp' }] } } };
    success(await host.sdk.command('dm.define', { definition: ticker }));
    await host.send('Hit.', reply(line('character', 'set-health', ' | to: Down')));
    const ticks = tags.slice(0, 31).map(tag => `~ dm ticker — why | kind: tick | tag: ${tag}`);
    await host.send('Again.', reply(line('character', 'set-health', ' | to: Down'), ...ticks));
    assert.equal(sheet(host, 'ticker').n, 30, 'the Down line and 30 ticks are the 31 story actions taken; the 32nd is refused because one place is kept for settling');
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive], [0, true, false], 'the settle step ran: already Down, still Down');
    assert.ok(host.turn.problems().some(problem => /last place is kept for settling/.test(problem.message)), JSON.stringify(host.turn.problems().map(problem => problem.message)));
    assert.deepEqual(host.turn.problems().filter(problem => /DM_BUDGET|Retained|budget/i.test(problem.message) && /settle/i.test(problem.message)), []);
    rebuilt(host);
    await reload(host);
});

// --- B10: feature off, no RPG code path runs ----------------------------------------------------------------------------------------

test('B10: with the RPG off, role blocks in the chat produce no hook output, no model call, no roll, no compact tail line, and no command beyond the pinned list', async t => {
    const calls = [];
    const host = await createHost({ callModel: async prompt => { calls.push(prompt); return 'none'; } });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Skills', 'Foes', 'Combat rules']) success(await host.sdk.command('dm.define', { definition: template(name) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Wessel', skill1: 'Iron Breath', stat1: 'vit', uses1: 'stamina' } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Rat', count1: 2 } }));
    const sent = (await host.send('I hit the rat.', 'The rat squeals.')).request;
    const text = JSON.stringify(sent);
    assert.equal(calls.length, 0, 'no planner call');
    assert.ok(!text.includes('[Rolls]'));
    assert.ok(!text.includes('Wessel skills:') && !text.includes('Iron Breath (Novice'), 'a role block is told like any block while the RPG is off');
    assert.ok(text.includes('Skills — '), 'the ordinary block line');
    const receipts = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []);
    assert.equal(receipts.some(receipt => receipt.type === 'rpg.resolve'), false);
    assert.equal(host.ctx.chatMetadata?.leanRpgPlan, undefined);
    const names = Object.keys(createCoreModule().commands).sort();
    assert.deepEqual(names.filter(name => name.startsWith('rpg.')), ['rpg.joinNo', 'rpg.resolve'], 'the pinned RPG commands (inert while the feature is off: rpg.resolve only runs as a prelude the hook asks for, rpg.joinNo is the reader\'s No on a companion\'s card, and both are refused by the feature gate)');
    assert.deepEqual(names, ['assist.precheck', 'dm.act', 'dm.attach', 'dm.capture', 'dm.define', 'dm.join', 'dm.migrate', 'dm.pin', 'dm.redefine', 'dm.remove', 'dm.set', 'dm.settle', 'dm.tick', 'events.fire', 'inventory.add', 'inventory.consume', 'inventory.drop', 'inventory.edit', 'inventory.equip', 'inventory.grant', 'inventory.lootTake',
        'inventory.merge', 'inventory.repair', 'inventory.split', 'inventory.transfer', 'inventory.unequip', 'inventory.wear', 'mounts.edit', 'rpg.joinNo', 'rpg.resolve', 'savepoint.make', 'savepoint.restore', 'scene.place', 'scene.present', 'scene.weather', 'wallet.pay', 'wallet.receive', 'wallet.set']);
});

// --- B12: an end card always has a slot ------------------------------------------------------------------------------------------------

test('B12: cards are ordered end first, then warn, then info, so the death card has a slot among more than eight', async t => {
    const host = await story(t);
    const cards = tone => [1, 2, 3, 4].map(n => ({ type: 'card', when: true, tone, title: `${tone} ${n}`, text: 'Always.' }));
    for (const slug of ['one', 'two']) {
        success(await host.sdk.command('dm.define', { definition: { slug, name: slug, schema: 1, stateVersion: 1, scope: 'chat', state: { a: { type: 'bool', default: false } }, kinds: {}, cards: cards('info') } }));
    }
    success(await host.sdk.command('dm.define', { definition: template('Character') }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', field: 'alive', value: false }));
    const all = blockCards(host.head()).map(entry => entry.card.title);
    assert.equal(all.length, 9);
    assert.equal(all[0], 'The story ends here', 'end first');
    const slots = createCoreModule().cards;
    const shown = Object.keys(slots).filter(key => key.startsWith('block-card-')).map(key => slots[key].for(host.head())?.title).filter(Boolean);
    assert.equal(shown.length, 8);
    assert.ok(shown.includes('The story ends here'), JSON.stringify(shown));
    // warn before info, pin order inside a tone
    success(await host.sdk.command('dm.define', { definition: { slug: 'warn', name: 'warn', schema: 1, stateVersion: 1, scope: 'chat', state: { a: { type: 'bool', default: false } }, kinds: {}, cards: cards('warn').slice(0, 1) } }));
    assert.deepEqual(blockCards(host.head()).map(entry => entry.card.title).slice(0, 3), ['The story ends here', 'warn 1', 'info 1']);
});

// --- the replay fuzz script ---------------------------------------------------------------------------------------------------------------

test('the replay fuzz script\'s delete-swipe step runs (it called an undefined function and swallowed the error)', { timeout: 120000 }, () => {
    const script = fileURLToPath(new URL('../../../scripts/fuzz-replay.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '5', '120', '7'], { encoding: 'utf8', env: { ...process.env, TRACE: '1' } });
    if (run.error) return;    // (a sandbox that cannot start a child: nothing to measure)
    const steps = run.stdout.split('\n').filter(row => row.startsWith('delswipe |'));
    assert.ok(steps.length >= 1, run.stderr.slice(0, 300));
    assert.deepEqual(steps.filter(row => /\| throw \|/.test(row)), []);
    assert.match(run.stdout.split('\n')[0], /"fails":\[\]/);
});

// --- B17 (review 157): redefining one chat block again and again ---------------------------------------------------------------------

const pinsOf = host => Object.keys(host.head().domains.dataModules.pins);
async function redefine(host, slug, change) {
    const module = `pack.chat/${slug}`;
    const definition = structuredClone(activeDefinition(host.head(), module));
    delete definition.id; delete definition.pack;
    change(definition);
    return host.sdk.command('dm.redefine', { module, definition });
}

test('B17: 40 combat-text edits, on one reply and across replies, never fill the pin budget; live = rebuild = reload', async t => {
    const host = await story(t, 'Character', 'Combat rules');
    for (let n = 1; n <= 40; n += 1) {
        if (n % 3 === 0) await host.send(`m${n}`, `r${n}`);
        success(await redefine(host, 'combat-rules', definition => { definition.prompt = `Text ${n}`; }));
        assert.ok(pinsOf(host).length <= 2, `${n}: ${pinsOf(host).length} pins`);
    }
    assert.equal(activeDefinition(host.head(), 'pack.chat/combat-rules').prompt, 'Text 40');
    success(await host.sdk.command('dm.define', { definition: template('Foes') }));
    rebuilt(host);
    await reload(host);
    // an edit that leaves the definition as it is keeps its pin
    const before = pinsOf(host);
    success(await redefine(host, 'combat-rules', () => {}));
    assert.deepEqual(pinsOf(host), before);
    assert.equal(activeDefinition(host.head(), 'pack.chat/combat-rules').prompt, 'Text 40');
});

test('B17: a swipe or delete of the editing reply brings the previous definition (and its pin) back', async t => {
    for (const removal of ['swipe', 'delete']) {
        const host = await story(t, 'Combat rules');
        await host.send('Go.', 'A reply.');
        success(await redefine(host, 'combat-rules', definition => { definition.prompt = 'First'; }));
        await host.send('Next.', 'Another reply.');
        const pinsBefore = pinsOf(host);
        success(await redefine(host, 'combat-rules', definition => { definition.prompt = 'Second'; }));
        assert.equal(activeDefinition(host.head(), 'pack.chat/combat-rules').prompt, 'Second');
        assert.ok(!pinsBefore.every(hash => pinsOf(host).includes(hash)), 'the replaced pin is gone');
        if (removal === 'swipe') await host.swipe('A different reply.'); else await host.st.deleteMessage(host.store.headIndex());
        assert.equal(activeDefinition(host.head(), 'pack.chat/combat-rules').prompt, 'First', removal);
        if (removal === 'swipe') assert.deepEqual(pinsOf(host), pinsBefore, 'the pin that was replaced is back');
        else assert.deepEqual(pinsOf(host).sort(), pinsBefore.sort());
        rebuilt(host);
        await reload(host);
    }
});

test('B17: Re-read and delete of earlier replies, whose blocks were made on definitions since replaced, replay on the pins they recorded', async t => {
    const host = await story(t, 'Character', 'Combat rules');
    await host.send('A.', reply(line('character', 'set-health', ' | to: Hurt')));
    const a = host.store.headIndex();
    for (let n = 1; n <= 3; n += 1) {
        await host.send(`B${n}.`, reply(`~ place Camp ${n}`));
        success(await redefine(host, 'combat-rules', definition => { definition.prompt = `Edited ${n}`; }));
    }
    assert.ok(pinsOf(host).length <= 3);
    const prompt = () => activeDefinition(host.head(), 'pack.chat/combat-rules').prompt;
    // Re-read of A, whose later replies were made on definitions that are gone from the state: nothing is lost
    await host.st.editMessage(a, reply(line('character', 'set-health', ' | to: Scratched')));
    success(await host.sdk.reread(a));
    assert.equal(sheet(host).health, 4);
    assert.equal(prompt(), 'Edited 3');
    assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
    rebuilt(host);
    await reload(host);
    // Re-read of the reply that carries the first edit, and a delete of the last: the steps that no longer apply are skipped as they always
    // were (an edit of a block goes with the reply it was made on); what stays replays on the pins it recorded
    await host.st.editMessage(a + 2, reply('~ place Harbour'));
    success(await host.sdk.reread(a + 2));
    rebuilt(host);
    await reload(host);
    await host.st.deleteMessage(host.store.headIndex());
    assert.equal(typeof prompt(), 'string');
    assert.ok(pinsOf(host).length <= 3);
    rebuilt(host);
    await reload(host);
});

function prng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let x = state;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

for (const seed of [1, 2, 3, 4, 5, 6]) {
    test(`B17 replay fuzz with redefines, seed ${seed}: live = cold rebuild = reload after every step`, async t => {
        const random = prng(seed * 104729), pick = list => list[Math.floor(random() * list.length)];
        const host = await story(t, 'Character', 'Combat rules');
        const floor = host.store.headIndex();
        for (let step = 0; step < 40; step += 1) {
            const head = host.store.headIndex(), roll = random();
            if (roll < 0.3) await host.send(`m${step}`, reply(line('character', pick(['set-health', 'set-health']), ` | to: ${pick(['Down', 'Hurt', 'Unhurt', 'Wounded'])}`)));
            else if (roll < 0.6) await redefine(host, pick(['character', 'combat-rules']), definition => { definition.prompt = `Text ${pick(['a', 'b', 'c', 'd'])}`; });
            else if (roll < 0.7 && head > floor && !host.ctx.chat.at(-1).is_user) await host.swipe(reply('~ place Camp'));
            else if (roll < 0.8 && head > floor + 1) await host.st.deleteMessage(head);
            else if (roll < 0.92) {
                const replies = host.ctx.chat.map((message, index) => index).filter(index => index > floor && !host.ctx.chat[index].is_user);
                if (replies.length) { const at = pick(replies); await host.st.editMessage(at, reply(line('character', 'set-health', ` | to: ${pick(['Down', 'Hurt'])}`))); await host.sdk.reread(at); }
            } else await reload(host);
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live, `seed ${seed} step ${step}: a cold rebuild equals the live story`);
            await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
            assert.equal(JSON.stringify(host.head()), live, `seed ${seed} step ${step}: a reload equals the live story`);
            assert.ok(pinsOf(host).length <= 3, `seed ${seed} step ${step}: ${pinsOf(host).length} pins`);
        }
    });
}
