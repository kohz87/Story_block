// The block engine additions for the lean RPG: `role`, the longer purpose, display names for numbers, cards, reply-end functions and
// hidden fields. Live = rebuild = reload for each of them, swipe and delete take them back, every new limit at its edge and one past it,
// and a definition that uses none of the new keys is exactly what it was in 2.7.2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { validateDataModules, dataModuleHash } from '../../../src/v2/data-modules/check.js';
import { grammarFor, summaryOf, blockCards, CARD_SLOTS } from '../../../src/v2/data-modules/part.js';
import { buildBlock } from '../../../src/v2/data-modules/block-builder.js';
import { ROLES } from '../../../src/v2/lean-rpg/index.js';
import { fixture, reload, rebuilt, reply, view, success } from './helpers.js';

const check = input => validateDataModules([input], { packId: 'chat', capabilities: ['data-modules-v1'] });
const id = 'pack.chat/hero';
const ROMAN = Object.fromEntries(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].map((name, at) => [String(at + 1), name]));
const HEALTH = { 0: 'Down', 1: 'Badly wounded', 2: 'Wounded', 3: 'Hurt', 4: 'Scratched', 5: 'Unhurt' };
const RANKS = { 0: 'Novice', 1: 'Adept', 2: 'Expert', 3: 'Master' };
const int = (min, max, value, extra = {}) => ({ type: 'int', min, max, default: value, ...extra });
const setKind = (field, schema) => ({ op: '~', labels: { to: { type: 'int', min: schema.min, max: schema.max } }, effects: [{ op: 'set', path: [field], value: ['arg', 'to'] }] });

// A small character sheet written the way the lean RPG's templates are: hand-made kinds, rules that raise class and rank, a hidden
// latch, a death latch of two reply-end functions and the cards that follow from it.
const hero = () => {
    const state = {
        health: int(0, 5, 5, { label: 'Health', names: HEALTH }), soul: int(1, 9, 1, { label: 'Soul Class', names: ROMAN }), xp: int(0, 100, 0, { label: 'XP' }),
        rank: int(0, 3, 0, { label: 'Rank', names: RANKS }), practice: int(0, 100, 0, { label: 'Practice' }),
        down: { type: 'bool', default: false, prompt: false }, alive: { type: 'bool', default: true, label: 'Alive' },
    };
    return {
        slug: 'hero', name: 'Hero', schema: 1, stateVersion: 1, scope: 'chat', role: 'character', state,
        kinds: {
            'set-health': setKind('health', state.health), 'set-soul': setKind('soul', state.soul),
            'add-xp': { op: '+', labels: { by: { type: 'int', min: 1, max: 100 } }, effects: [{ op: 'add', path: ['xp'], value: ['arg', 'by'], bounds: 'clamp' }] },
            'practice': { op: '+', labels: { by: { type: 'int', min: 1, max: 100 } }, effects: [{ op: 'add', path: ['practice'], value: ['arg', 'by'], bounds: 'clamp' }] },
            'button-rest': { op: '!', ui: true, title: 'Rest', labels: {}, effects: [{ op: 'set', path: ['health'], value: 5 }] },
            'button-get-up': { op: '!', ui: true, title: 'Get up', labels: {}, effects: [{ op: 'set', path: ['down'], value: false }] },
        },
        rules: [
            { id: 'class-up', when: ['ge', ['get', ['xp']], 100], then: [{ op: 'add', path: ['soul'], value: 1, bounds: 'clamp' }, { op: 'set', path: ['xp'], value: 0 }] },
            { id: 'rank-up', when: ['ge', ['get', ['practice']], 100], then: [{ op: 'add', path: ['rank'], value: 1, bounds: 'clamp' }, { op: 'set', path: ['practice'], value: 0 }] },
        ],
        replyEnd: [
            { type: 'reply-end', when: ['and', ['eq', ['get', ['health']], 0], ['get', ['down']]], effects: [{ op: 'set', path: ['alive'], value: false }] },
            { type: 'reply-end', when: true, effects: [{ op: 'set', path: ['down'], value: ['eq', ['get', ['health']], 0] }] },
        ],
        cards: [
            { type: 'card', when: ['eq', ['get', ['alive']], false], tone: 'end', title: 'The story ends here', text: 'Hero has fallen. Swipe the last reply to take it back.' },
            { type: 'card', when: ['le', ['get', ['health']], 1], tone: 'warn', title: 'Badly hurt', text: 'Hero needs a rest.', button: 'button-rest' },
        ],
        prompt: 'Hero is the reader\'s character.', show: { tab: true, card: false, tabName: 'Hero', icon: 'ph-heart' },
    };
};
const edit = change => { const d = hero(); change(d); return d; };
async function story(t, definition = hero()) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    success(await host.sdk.command('dm.define', { definition }));
    return host;
}
const sheet = host => view(host, id).chat;
const line = (kind, extra = '') => `~ dm hero — why | kind: ${kind}${extra}`;

test('a hand-written block with a role, names, cards, reply-end functions and a hidden field is accepted and normalized', () => {
    const result = check(hero());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const [definition] = result.definitions;
    assert.equal(definition.role, 'character');
    assert.equal(definition.state.down.prompt, false);
    assert.deepEqual(definition.cards.map(card => card.tone), ['end', 'warn']);
    assert.equal(definition.replyEnd.length, 2);
    assert.deepEqual(ROLES, ['character', 'skills', 'foes', 'rules']);
});

test('role is optional and one of the roles', () => {
    for (const role of ROLES) assert.equal(check(edit(d => { d.role = role; })).ok, true, role);
    assert.equal(check(edit(d => { delete d.role; })).ok, true);
    for (const role of ['', 'boss', 7, null, ['character']]) {
        const result = check(edit(d => { d.role = role; }));
        assert.equal(result.ok, false, String(role));
        assert.equal(result.errors[0].path, 'content.dataModules[0].role');
    }
});

test('the purpose may be 1200 characters and not one more; the static total still has to fit 2000', () => {
    assert.equal(check(edit(d => { d.prompt = 'x'.repeat(1200); })).ok, true);
    assert.equal(check(edit(d => { d.prompt = '😀'.repeat(1200); })).ok, true, 'counted in characters');
    const over = check(edit(d => { d.prompt = 'x'.repeat(1201); }));
    assert.equal(over.ok, false);
    assert.match(over.errors[0].message, /at most 1200 characters/);
    // 1200 characters of purpose leave 800 for the story lines: a block whose lines do not fit is still refused.
    const crowded = check(edit(d => { d.prompt = 'x'.repeat(1200); d.kinds['set-health'].labels.to = { type: 'int', min: 0, max: 5 }; d.state.health.names = HEALTH;
        for (let n = 0; n < 8; n++) d.kinds[`extra-${n}`] = { op: '~', labels: { item: { type: 'enum', values: [`${'a'.repeat(100)}${n}`, 'b'] } }, effects: [] }; }));
    assert.equal(crowded.ok, false);
    assert.equal(crowded.errors[0].message, 'The purpose and story lines together must fit 2000 characters.');
});

test('names: at most 32 entries, whole values inside the range, short, distinct, and not numbers', () => {
    const withNames = names => check(edit(d => { d.state.big = int(0, 100, 0, { names }); }));
    const many = count => Object.fromEntries(Array.from({ length: count }, (_, at) => [String(at), `n${at}`]));
    assert.equal(withNames(many(32)).ok, true);
    assert.equal(withNames(many(33)).ok, false);
    assert.equal(withNames({}).ok, false, 'empty names are no names');
    assert.equal(withNames({ 100: 'top' }).ok, true, 'a name at the maximum');
    assert.equal(withNames({ 101: 'over' }).ok, false);
    assert.equal(withNames({ '-1': 'under' }).ok, false);
    assert.equal(withNames({ 1.5: 'half' }).ok, false);
    assert.equal(withNames({ '01': 'padded' }).ok, false, 'a value is written once, as the number');
    assert.equal(withNames({ 1: 'x'.repeat(40) }).ok, true);
    assert.equal(withNames({ 1: 'x'.repeat(41) }).ok, false);
    assert.equal(withNames({ 1: '' }).ok, false);
    assert.equal(withNames({ 1: 5 }).ok, false);
    assert.equal(withNames({ 1: '7' }).ok, false, 'a name that is a number could not be told from it');
    assert.equal(withNames({ 1: 'Same', 2: 'same' }).ok, false, 'distinct, however written');
    assert.equal(withNames([ 'a' ]).ok, false);
    assert.equal(check(edit(d => { d.state.flag = { type: 'bool', default: false, names: { 1: 'x' } }; })).ok, false, 'only on a number');
    assert.equal(check(edit(d => { d.state.where = { type: 'map', keys: ['a'], values: int(0, 3, 0, { names: { 1: 'x' } }) }; })).ok, false, 'not on the value of a map');
    const tidy = withNames({ 1: '  spaced   out  ' });
    assert.equal(tidy.definitions[0].state.big.names[1], 'spaced out');
});

test('a hidden field is false or absent, on a field of its own', () => {
    for (const prompt of [true, false]) assert.equal(check(edit(d => { d.state.alive.prompt = prompt; })).ok, true);
    for (const prompt of ['no', 0, null]) assert.equal(check(edit(d => { d.state.alive.prompt = prompt; })).ok, false, String(prompt));
    assert.equal(check(edit(d => { d.state.where = { type: 'map', keys: ['a'], values: int(0, 3, 0, { prompt: false }) }; })).ok, false);
    assert.equal(check(edit(d => { d.kinds['set-health'].labels.to.prompt = false; })).ok, false, 'not on a label');
});

test('only a Button may write a hidden field; the story is never offered one, and cannot press one', async t => {
    const refused = check(edit(d => { d.kinds['set-down'] = { op: '~', labels: { to: { type: 'enum', values: [true, false] } }, effects: [{ op: 'set', path: ['down'], value: ['arg', 'to'] }] }; }));
    assert.equal(refused.ok, false);
    assert.equal(refused.errors[0].path, 'content.dataModules[0].kinds.set-down');
    assert.equal(check(edit(d => { d.kinds['change-down'] = { op: '~', labels: { by: { type: 'int', min: 0, max: 1 } }, effects: [{ op: 'add', path: [['arg', 'by']], value: 1 }] }; })).ok, false, 'a computed path could reach it');
    const [definition] = check(hero()).definitions;
    const grammar = grammarFor({ domains: { dataModules: { pins: { h: { interpreter: 1, definition } }, active: { [definition.id]: { hash: 'h', generation: 1, subjects: ['chat'] } } } } });
    assert.match(grammar, /kind: set-health/);
    assert.match(grammar, /kind: button-rest/);
    assert.doesNotMatch(grammar, /button-get-up/, 'a button on a hidden field is not offered to the story');
    const host = await story(t);
    await host.send('Go.', reply('! dm hero — why | kind: button-get-up'));
    assert.ok(host.turn.problems().some(problem => /cannot change this/.test(problem.message)), JSON.stringify(host.turn.problems()));
    // the reader's Button works, and the hidden field is the reader's and the rules'
    success(await host.sdk.command('dm.act', { module: id, kind: 'button-get-up' }));
    assert.equal(sheet(host).down, false);
    success(await host.sdk.command('dm.set', { module: id, field: 'down', value: true }));
    assert.equal(sheet(host).down, true);
    await reload(host);
});

test('a hidden field is left out of the tail; names are shown instead of numbers', () => {
    const [definition] = check(hero()).definitions;
    const state = fields => ({ domains: { dataModules: { pins: { h: { interpreter: 1, definition } }, active: { [definition.id]: { hash: 'h', generation: 1, subjects: ['chat'] } },
        instances: { [definition.id]: { chat: { fields: { health: 3, soul: 2, xp: 40, rank: 1, practice: 10, down: true, alive: true, ...fields }, timers: {}, offers: {}, settled: {} } } } } } });
    const tail = summaryOf(state(), definition.id);
    assert.equal(tail, 'Hero — health Hurt; soul II; xp 40; rank Adept; practice 10; alive true.');
    assert.doesNotMatch(tail, /down/);
    assert.match(summaryOf(state({ health: 0, rank: 3 }), definition.id), /health Down; soul II; xp 40; rank Master/);
    assert.match(summaryOf(state({ xp: 41 }), definition.id), /xp 41/, 'a value with no name stays a number');
});

test('the grammar describes a named number by its names and its range, and the story may write either', async t => {
    const [definition] = check(hero()).definitions;
    const state = { domains: { dataModules: { pins: { h: { interpreter: 1, definition } }, active: { [definition.id]: { hash: 'h', generation: 1, subjects: ['chat'] } } } } };
    const grammar = grammarFor(state);
    assert.match(grammar, /kind: set-health \| to: Down\|Badly wounded\|Wounded\|Hurt\|Scratched\|Unhurt \(0\.\.5\)/);
    assert.match(grammar, /kind: set-soul \| to: I\|II\|III\|IV\|V\|VI\|VII\|VIII\|IX \(1\.\.9\)/);
    assert.match(grammar, /kind: add-xp \| by: 1\.\.100/, 'a number with no names is as it was');
    // names for some values only: the range, then the names it has
    const partial = check(edit(d => { d.state.xp.names = { 0: 'None', 100: 'Full' }; d.kinds['set-xp'] = setKind('xp', d.state.xp); })).definitions[0];
    assert.match(grammarFor({ domains: { dataModules: { pins: { h: { interpreter: 1, definition: partial } }, active: { [partial.id]: { hash: 'h', generation: 1, subjects: ['chat'] } } } } }), /kind: set-xp \| to: 0\.\.100 \(0=None, 100=Full\)/);
    const host = await story(t);
    await host.send('Hit.', reply(line('set-health', ' | to: wounded'), line('set-soul', ' | to: Iv')));
    assert.deepEqual([sheet(host).health, sheet(host).soul], [2, 4], 'a name in any case becomes its number');
    await host.send('Hit again.', reply(line('set-health', ' | to: 1')));
    assert.equal(sheet(host).health, 1, 'the number still works');
    await host.send('Bad.', reply(line('set-health', ' | to: mortal')));
    assert.equal(sheet(host).health, 1);
    const problem = host.turn.problems().find(each => /to must be a whole number from 0 to 5 or Down, Badly wounded, Wounded, Hurt, Scratched or Unhurt/.test(each.message));
    assert.ok(problem, JSON.stringify(host.turn.problems().map(each => each.message)));
    await reload(host);
});

test('"You set" and the receipt\'s summary use the names; the stored values stay numbers', async t => {
    const host = await story(t);
    await host.send('Go.', 'The road.');
    const set = success(await host.sdk.command('dm.set', { module: id, field: 'health', value: 2 }));
    assert.equal(set.receipt.summary, 'You set Hero: Health Unhurt → Wounded.');
    assert.equal(set.receipt.data.v2.result.to, 2);
    assert.equal(sheet(host).health, 2);
    const act = host.store.problems().length;
    await host.send('Level.', reply(line('set-soul', ' | to: III')));
    const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(each => each.type === 'capture.dm');
    assert.equal(receipt.summary, 'Hero: set-soul (Soul Class I → III).');
    assert.equal(host.store.problems().length, act);
    // a block that has no names keeps its plain summary
    const plain = await story(t, edit(d => { d.slug = 'plain'; d.name = 'Plain'; delete d.state.health.names; delete d.state.soul.names; delete d.state.rank.names; delete d.cards; delete d.replyEnd; }));
    await plain.send('Go.', 'Road.');
    assert.equal(success(await plain.sdk.command('dm.set', { module: 'pack.chat/plain', field: 'health', value: 2 })).receipt.summary, 'You set Plain: Health 5 → 2.');
});

test('XP 100 raises the class and practice 100 raises the rank, capped at 9 and 3; a swipe or delete takes the rise back', async t => {
    const host = await story(t);
    await host.send('Fight.', reply(line('add-xp', ' | by: 40').replace('~', '+'), '+ dm hero — drilled | kind: practice | by: 70'));
    assert.deepEqual([sheet(host).xp, sheet(host).soul, sheet(host).practice, sheet(host).rank], [40, 1, 70, 0]);
    await host.send('Fight on.', reply('+ dm hero — won | kind: add-xp | by: 60', '+ dm hero — drilled | kind: practice | by: 30'));
    assert.deepEqual([sheet(host).xp, sheet(host).soul, sheet(host).practice, sheet(host).rank], [0, 2, 0, 1], 'class and rank rose, XP and practice went back to 0');
    assert.ok(host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.data?.v2?.result?.rules?.includes('class-up')));
    await reload(host);
    // a swipe takes the rise back, and a new reply can raise it again
    await host.swipe('A quiet road.');
    assert.deepEqual([sheet(host).xp, sheet(host).soul, sheet(host).practice, sheet(host).rank], [40, 1, 70, 0]);
    await reload(host);
    await host.swipe(reply('+ dm hero — won | kind: add-xp | by: 60'));
    assert.deepEqual([sheet(host).xp, sheet(host).soul, sheet(host).practice, sheet(host).rank], [0, 2, 70, 0]);
    await reload(host);
    // so does deleting the reply that earned it
    await host.st.deleteMessage(host.store.headIndex());
    assert.deepEqual([sheet(host).xp, sheet(host).soul, sheet(host).practice, sheet(host).rank], [40, 1, 70, 0]);
    await reload(host);
    // the caps: Soul Class 9 and rank 3 are not passed
    success(await host.sdk.command('dm.set', { module: id, field: 'soul', value: 9 }));
    success(await host.sdk.command('dm.set', { module: id, field: 'rank', value: 3 }));
    await host.send('More.', reply('+ dm hero — won | kind: add-xp | by: 100', '+ dm hero — drilled | kind: practice | by: 100'));
    assert.deepEqual([sheet(host).soul, sheet(host).rank, sheet(host).xp, sheet(host).practice], [9, 3, 0, 0]);
    await reload(host);
});

test('the death latch: only a character already Down when the reply began, and still Down at its end, dies', async t => {
    const host = await story(t);
    await host.send('Hit.', reply(line('set-health', ' | to: Down')));
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive], [0, true, true], 'Down in this reply: latched, not dead');
    await reload(host);
    // a reply that heals before it ends is not a death either
    await host.send('Heal.', reply(line('set-health', ' | to: 3')));
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive], [3, false, true]);
    await host.send('Hit.', reply(line('set-health', ' | to: 0')));
    assert.deepEqual([sheet(host).down, sheet(host).alive], [true, true]);
    await host.send('Hit again.', reply(line('set-health', ' | to: 0')));
    assert.deepEqual([sheet(host).down, sheet(host).alive], [true, false], 'already Down, still Down: the story ends');
    await reload(host);
    // a swipe takes the death back, and a different reply decides again
    await host.swipe(reply(line('set-health', ' | to: 2')));
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive], [2, false, true]);
    await reload(host);
    await host.swipe(reply(line('set-health', ' | to: 0')));
    assert.equal(sheet(host).alive, false);
    await reload(host);
    rebuilt(host);
});

test('a delete or an edit before the death plans the latch again, and nothing is left when nothing is left to settle', async t => {
    const host = await story(t);
    await host.send('Quiet.', reply('~ place Camp'));
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.type === 'dm.settle'), false, 'nothing to settle: no step');
    await host.send('Hit.', reply(line('set-health', ' | to: 0')));
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.filter(receipt => receipt.type === 'dm.settle').length, 1);
    const hit = host.store.headIndex();
    await host.send('Time passes.', reply('+ dm hero — drilled | kind: practice | by: 5'));
    assert.deepEqual([sheet(host).down, sheet(host).alive], [true, false]);
    assert.deepEqual(host.turn.problems().filter(problem => /settle/.test(problem.message)), [], 'a step that settles nothing is never asked');
    await host.st.deleteMessage(hit);
    assert.deepEqual([sheet(host).health, sheet(host).down, sheet(host).alive, sheet(host).practice], [5, false, true, 5]);
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.type === 'dm.settle'), false, 'the settle step went with what it settled');
    assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
    await reload(host);
    rebuilt(host);
});

test('editing the reply that ends the story takes the death back', async t => {
    const host = await story(t);
    await host.send('Hit.', reply(line('set-health', ' | to: 0')));
    await host.send('Hit again.', reply('+ dm hero — a | kind: practice | by: 5'));
    assert.equal(sheet(host).alive, false);
    const last = host.store.headIndex();
    await host.st.editMessage(last, reply('+ dm hero — b | kind: practice | by: 7', line('set-health', ' | to: 4')));
    assert.equal((await host.sdk.reread(last)).ok, true);
    assert.deepEqual([sheet(host).health, sheet(host).practice, sheet(host).down, sheet(host).alive], [4, 7, false, true]);
    await reload(host);
    await host.st.editMessage(last, reply('+ dm hero — c | kind: practice | by: 9'));
    assert.equal((await host.sdk.reread(last)).ok, true);
    assert.deepEqual([sheet(host).practice, sheet(host).down, sheet(host).alive], [9, true, false]);
    await reload(host);
});

test('a Continue or late lines do not settle the reply again', async t => {
    const host = await story(t);
    await host.send('Hit.', reply(line('set-health', ' | to: 0')));
    assert.deepEqual([sheet(host).down, sheet(host).alive], [true, true]);
    await host.cont(reply('~ place Camp'));
    assert.equal(sheet(host).alive, true, 'a reply is settled once');
    await reload(host);
});

test('the cards follow the head state, run their button on the latest reply, and are never stored', async t => {
    const host = await story(t);
    assert.equal(blockCards(host.head()).length, 0);
    await host.send('Hit.', reply(line('set-health', ' | to: 1')));
    let cards = blockCards(host.head());
    assert.deepEqual(cards.map(each => each.card.title), ['Badly hurt']);
    assert.equal(cards[0].card.tone, 'accent');
    assert.deepEqual(cards[0].card.actions, [{ id: 'button-rest', label: 'Rest', primary: true, command: 'dm.act', payload: { module: id, kind: 'button-rest' } }]);
    // the registry draws them under the head reply through the reply-cards socket
    const entries = host.registry.cardEntries().filter(entry => entry.id.startsWith('story-block/block-card-'));
    assert.equal(entries.length, CARD_SLOTS);
    const drawn = entries.map(entry => entry.fn(host.head(), null, {})).filter(Boolean);
    assert.deepEqual(drawn.map(card => card.title), ['Badly hurt']);
    // its button is an ordinary reader command
    const rested = success(await host.sdk.command(cards[0].card.actions[0].command, cards[0].card.actions[0].payload));
    assert.equal(rested.receipt.data.edit, true);
    assert.equal(sheet(host).health, 5);
    assert.equal(blockCards(host.head()).length, 0, 'the condition no longer holds: the card goes');
    // death: the end card; undone by a swipe
    await host.send('Down.', reply(line('set-health', ' | to: 0')));
    await host.send('Down again.', reply(line('set-health', ' | to: 0')));
    assert.deepEqual(blockCards(host.head()).map(each => each.card.title), ['The story ends here', 'Badly hurt']);
    assert.equal(blockCards(host.head())[0].card.tone, 'bad');
    await reload(host);
    assert.deepEqual(blockCards(host.head()).map(each => each.card.title), ['The story ends here', 'Badly hurt']);
    await host.swipe('A quiet road.');
    assert.equal(sheet(host).alive, true);
    assert.deepEqual(blockCards(host.head()).map(each => each.card.title), ['Badly hurt'], 'the swipe took the end card back; the hurt card stays with the health');
    const receipts = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []);
    assert.ok(!receipts.some(receipt => JSON.stringify(receipt).includes('Badly hurt')), 'a card is derived, never written into a receipt');
    rebuilt(host);
});

test('cards: at most 4 a block, a title of 60 and a text of 240, a known tone, a button that asks for nothing', () => {
    const card = (extra = {}) => ({ when: ['eq', ['get', ['alive']], false], tone: 'info', title: 'T', text: 'x', ...extra });
    const withCards = cards => check(edit(d => { d.cards = cards; }));
    assert.equal(withCards(Array.from({ length: 4 }, () => card())).ok, true);
    assert.equal(withCards(Array.from({ length: 5 }, () => card())).ok, false);
    assert.equal(withCards([card({ title: 't'.repeat(60) })]).ok, true);
    assert.equal(withCards([card({ title: 't'.repeat(61) })]).ok, false);
    assert.equal(withCards([card({ title: ' ' })]).ok, false);
    assert.equal(withCards([card({ text: 'x'.repeat(240) })]).ok, true);
    assert.equal(withCards([card({ text: 'x'.repeat(241) })]).ok, false);
    assert.equal(withCards([card({ text: '' })]).ok, true);
    for (const tone of ['info', 'warn', 'end']) assert.equal(withCards([card({ tone })]).ok, true, tone);
    assert.equal(withCards([card({ tone: 'good' })]).ok, false);
    assert.equal(withCards([card({ button: 'button-rest' })]).ok, true);
    assert.equal(withCards([card({ button: 'set-health' })]).ok, false, 'a button of the block, not a story kind');
    assert.equal(withCards([card({ button: 'button-missing' })]).ok, false);
    assert.equal(check(edit(d => { d.kinds['button-ask'] = { op: '!', ui: true, labels: { n: { type: 'int', min: 0, max: 1 } }, effects: [] }; d.cards = [card({ button: 'button-ask' })]; })).ok, false, 'a card cannot give a button its labels');
    assert.equal(withCards([card({ when: ['get', ['health']] })]).ok, false, 'a card is asked a yes or no');
    assert.equal(withCards([card({ extra: 1 })]).ok, false);
    assert.equal(withCards([card({ type: 'reply-end' })]).ok, false);
    assert.equal(withCards([card({ id: 'a' }), card({ id: 'a' })]).ok, false);
    assert.equal(withCards([card({ when: ['ge', ['input', 'clock', 'minutes'], 5] })]).ok, false, 'no import inside a card');
    assert.equal(withCards('nope').ok, false);
    assert.equal(check({ ...hero(), scope: 'character' }).ok, false, 'cards are for chat blocks');
});

test('reply-end functions: at most 4 a block, effects on the block\'s own fields, in the order written', () => {
    const fn = (extra = {}) => ({ when: true, effects: [{ op: 'set', path: ['alive'], value: true }], ...extra });
    const withEnd = list => check(edit(d => { d.replyEnd = list; }));
    assert.equal(withEnd(Array.from({ length: 4 }, () => fn())).ok, true);
    assert.equal(withEnd(Array.from({ length: 5 }, () => fn())).ok, false);
    assert.equal(withEnd([fn({ when: ['lt', ['get', ['health']], 3] })]).ok, true);
    assert.equal(withEnd([fn({ when: 3 })]).ok, false);
    assert.equal(withEnd([fn({ effects: [] })]).ok, false, 'a function that does nothing');
    assert.equal(withEnd([fn({ effects: [{ op: 'set', path: ['nothing'], value: 1 }] })]).ok, false, 'only declared fields');
    assert.equal(withEnd([fn({ effects: [{ op: 'reward', template: 'x', bind: {} }] })]).ok, false);
    assert.equal(withEnd([fn({ effects: [{ op: 'add', path: ['xp'], value: 5 }] })]).ok, true);
    assert.equal(withEnd([fn({ effects: Array.from({ length: 17 }, () => ({ op: 'set', path: ['alive'], value: true })) })]).ok, false);
    assert.equal(withEnd([fn({ type: 'card' })]).ok, false);
    assert.equal(withEnd([fn({ id: 'x' }), fn({ id: 'x' })]).ok, false);
    assert.equal(withEnd([fn({ extra: true })]).ok, false);
    assert.equal(withEnd({}).ok, false);
});

test('reply-end functions run in order, each seeing what the one before left', async t => {
    const definition = edit(d => {
        d.replyEnd = [
            { when: ['ge', ['get', ['xp']], 10], effects: [{ op: 'set', path: ['practice'], value: 5 }] },
            { when: ['eq', ['get', ['practice']], 5], effects: [{ op: 'set', path: ['rank'], value: 2 }] },
        ];
        delete d.cards;
    });
    const host = await story(t, definition);
    await host.send('Go.', reply('+ dm hero — a | kind: add-xp | by: 10'));
    assert.deepEqual([sheet(host).practice, sheet(host).rank], [5, 2]);
    await reload(host);
    await host.swipe(reply('+ dm hero — a | kind: add-xp | by: 5'));
    assert.deepEqual([sheet(host).practice, sheet(host).rank], [0, 0]);
    await reload(host);
});

test('a definition that uses none of the new keys is what it was in 2.7.2: its hash, its grammar and its tail', () => {
    // These values were taken from the branch before the new keys (stage16/lean-rpg at f50ad31).
    const hashes = {
        reputation: ['1e79e03e1830563f32a7fb8f348d8385b58c818ea23b10adf787bff16ffa12a7'],
        survival: ['0fda0e3b068ed90a1912cc9674046243ebc49de0ce52c8db1e3d63bef2bc5af9'],
    };
    for (const [name, want] of Object.entries(hashes)) {
        const pack = fixture(name);
        const result = validateDataModules(pack.content.dataModules, { packId: pack.id, capabilities: ['data-modules-v1', 'story-director'] });
        assert.deepEqual(result.definitions.map(definition => dataModuleHash(definition)), want, name);
    }
    const built = buildBlock({ name: "Wessel's Notes", fields: [
        { name: 'Mood', type: 'text', max: 30, default: 'calm' }, { name: 'Fatigue', type: 'number', min: 0, max: 10, default: 0 },
        { name: 'Standing', type: 'choice', values: ['new', 'trusted'], default: 'new' }, { name: 'Known contacts', type: 'list', default: '' },
    ], prompt: 'Keep track of these.', show: { tab: true, card: true, tabName: 'Notes', icon: 'ph-bookmark-simple' }, functions: [
        { type: 'button', name: 'Rest', effects: [{ field: 'fatigue', op: 'add', value: -3 }, { field: 'mood', op: 'set', value: 'rested' }] },
        { type: 'rule', name: 'Tired', when: { field: 'fatigue', op: 'ge', value: 5 }, effects: [{ field: 'mood', op: 'set', value: 'tired' }] },
    ] });
    assert.equal(built.ok, true);
    assert.equal(dataModuleHash(built.checked), '49dbeb39da1b3e7efaae1b23c5648dc704b7b85576cbc6353d0e11272c392936');
    const definition = built.checked;
    const state = { domains: { dataModules: { pins: { h: { interpreter: 1, definition } }, active: { [definition.id]: { hash: 'h', generation: 1, subjects: ['chat'] } },
        instances: { [definition.id]: { chat: { fields: { mood: 'calm', fatigue: 4, standing: 'new', 'known-contacts': 'Mara; Teo' }, timers: {}, offers: {}, settled: {} } } } } } };
    assert.equal(grammarFor(state), 'Data modules in this story (write these lines exactly; a refused line changes nothing):\nKeep track of these.\n~ dm wessel-s-notes — reason | kind: set-mood | to: text\n~ dm wessel-s-notes — reason | kind: set-fatigue | to: 0..10\n~ dm wessel-s-notes — reason | kind: set-standing | to: new|trusted\n~ dm wessel-s-notes — reason | kind: set-known-contacts | to: text\n! dm wessel-s-notes — reason | kind: button-rest');
    assert.equal(summaryOf(state, definition.id), 'Wessel\'s Notes — mood "calm"; fatigue 4; standing "new"; known-contacts "Mara; Teo".');
    // and the normalized form gains no key it did not have
    for (const key of ['role', 'cards', 'replyEnd']) assert.equal(Object.hasOwn(definition, key), false, key);
});

test('a block with no cards, no reply-end functions and no hidden fields stores and draws nothing more', async t => {
    const host = await story(t, edit(d => { delete d.replyEnd; delete d.cards; delete d.role; delete d.state.down.prompt; }));
    await host.send('Hit.', reply(line('set-health', ' | to: 0')));
    await host.send('Hit again.', reply(line('set-health', ' | to: 0')));
    assert.equal(sheet(host).alive, true);
    assert.equal(host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).some(receipt => receipt.type === 'dm.settle'), false);
    assert.deepEqual(blockCards(host.head()), []);
    await reload(host);
});
