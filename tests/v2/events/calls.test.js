// The allow-listed calls of the condition language, against head-state layouts (SPEC §7, MODULES B1/C1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition } from '../../../src/v2/events/condition.js';
import { ARITY, CALLS, runCall } from '../../../src/v2/events/calls.js';

const state = domains => ({ v: 2, meta: { rev: 3, claims: {} }, domains });
const met = (source, domains = {}, query) => {
    const result = evaluateCondition(source, { state: state(domains), query });
    assert.equal(result.error, undefined, `${source}: ${result.error?.message}`);
    return result.met;
};
const why = (source, domains = {}, query) => evaluateCondition(source, { state: state(domains), query }).error;

const director = {
    time: { minutes: 750 },
    threads: {
        th_aaaaaaaa: { id: 'th_aaaaaaaa', kind: 'quest', key: 'Granary Rats', status: 'active', fields: { step: 'the cellar is cleared', giver: 'Fenna' }, taken: { rev: 2 } },
        th_bbbbbbbb: { id: 'th_bbbbbbbb', kind: 'event', key: 'Dragon sighted', status: 'resolved', fields: {} },
        th_cccccccc: { id: 'th_cccccccc', kind: 'quest', key: 'Lost Ring', status: 'resolved', fields: {} },
    },
    keys: { 'granary rats': 'th_aaaaaaaa', 'the rat job': 'th_aaaaaaaa', 'dragon sighted': 'th_bbbbbbbb' },
};

const inventory = {
    defs: {
        'story/moonveil-trout': { id: 'story/moonveil-trout', name: 'Moonveil Trout', kind: 'goods' },
        'pack.fantasy/rope': { id: 'pack.fantasy/rope', name: 'Rope', kind: 'goods' },
        'story/empty': { id: 'story/empty', name: 'Empty Flask', kind: 'goods' },
    },
    stacks: {
        it_aaaaaaaa: { id: 'it_aaaaaaaa', def: 'story/moonveil-trout', qty: 2, owner: 'party' },
        it_bbbbbbbb: { id: 'it_bbbbbbbb', def: 'story/moonveil-trout', qty: 1, owner: 'ac_aaaaaaaa' },
        it_cccccccc: { id: 'it_cccccccc', def: 'pack.fantasy/rope', qty: 1, owner: 'party' },
        it_dddddddd: { id: 'it_dddddddd', def: 'story/empty', qty: 0, owner: 'party' },
    },
    wallets: {},
    aliases: { 'moonveil trout': 'story/moonveil-trout', 'violet trout': 'story/moonveil-trout', rope: 'pack.fantasy/rope' },
};

const party = {
    pc: 'ac_bbbbbbbb',
    order: ['ac_bbbbbbbb', 'ac_aaaaaaaa'],
    actors: {
        ac_aaaaaaaa: { id: 'ac_aaaaaaaa', name: 'Lyra', level: 3, hp: { cur: 20, max: 30 } },
        ac_bbbbbbbb: { id: 'ac_bbbbbbbb', name: 'Ren', level: 31, hp: { cur: 77, max: 82 } },
        ac_cccccccc: { id: 'ac_cccccccc', name: 'ren', level: 1, hp: { cur: 1, max: 1 } },
    },
};

test('the allow-list and its arity', () => {
    assert.deepEqual(CALLS, ['query', 'quest', 'has', 'time', 'actor', 'count']);
    assert.deepEqual(Object.keys(ARITY), CALLS);
    const errors = [];
    const fail = (code, message) => { errors.push(code); throw new Error(message); };
    assert.throws(() => runCall('toString', [], {}, fail));
    assert.throws(() => runCall('time', [1], {}, fail));
    assert.deepEqual(errors, ['NOT_ALLOWED', 'SYNTAX']);
});

test('quest(key): by key or alias, any case; any thread kind; null when unknown or no Director', () => {
    assert.equal(met(`quest('Granary Rats').status == 'active'`, { director }), true);
    assert.equal(met(`quest('granary RATS').fields.step == 'the cellar is cleared'`, { director }), true);
    assert.equal(met(`quest('the rat job').fields.giver == 'Fenna'`, { director }), true, 'an alias');
    assert.equal(met(`quest('Lost Ring').status == 'resolved'`, { director }), true, 'by the thread key when the index lacks it');
    assert.equal(met(`quest('Dragon sighted').kind == 'event'`, { director }), true);
    assert.equal(met(`quest('Nobody') == null`, { director }), true);
    assert.equal(met(`quest('Nobody').status == 'resolved'`, { director }), false, 'reading through null is null, not an error');
    assert.equal(met(`quest('Granary Rats') == null`, {}), true, 'no Director: null');
    assert.equal(met(`quest('Granary Rats').taken.rev >= 2`, { director }), true);
    assert.match(why(`quest(3) == null`, { director }).message, /quest\(\) needs a name in quotes, not a number/);
    assert.match(why(`quest('') == null`, { director }).message, /not an empty word/);
    assert.match(why(`quest('Granary Rats') == 1`, { director }).message, /== compares .* not a record/);
});

test('has(itemName, qty?): alias, name or def id; every owner counts; at least qty', () => {
    assert.equal(met(`has('Moonveil Trout')`, { inventory }), true);
    assert.equal(met(`has('violet trout', 3)`, { inventory }), true, 'an alias; 2 with the party + 1 with Lyra');
    assert.equal(met(`has('Moonveil Trout', 4)`, { inventory }), false);
    assert.equal(met(`has('ROPE')`, { inventory }), true);
    assert.equal(met(`has('the  Rope')`, { inventory }), true, 'the inventory alias key: articles and spacing tidied');
    assert.equal(met(`has('Ropes')`, { inventory }), false, 'no plural guessing');
    assert.equal(met(`has('pack.fantasy/rope', 1)`, { inventory }), true, 'a def id');
    assert.equal(met(`has('Empty Flask')`, { inventory }), false, 'a zero stack holds nothing');
    assert.equal(met(`has('Dragon Egg')`, { inventory }), false);
    assert.equal(met(`has('Rope')`, {}), false, 'no inventory: false');
    assert.equal(met(`!has('Dragon Egg') && has('Rope')`, { inventory }), true);
    for (const bad of ['0', '-1', '1.5', `'2'`, 'null']) {
        assert.match(why(`has('Rope', ${bad})`, { inventory }).message, /has\(\) counts in whole numbers from 1/, bad);
    }
    assert.match(why(`has(null)`, { inventory }).message, /has\(\) needs a name in quotes/);
});

test('time(): the Director minutes, or null', () => {
    assert.equal(met('time() >= 720 && time() < 780', { director }), true);
    assert.equal(met('time() == null', {}), true);
    assert.equal(met('time() == null', { director: { time: { minutes: null } } }), true);
    assert.equal(met('time() == null', { director: { time: { minutes: 1.5 } } }), true, 'not a whole minute: unknown');
    assert.equal(why('time() >= 480', {}).code, 'TYPE', 'comparing an unknown clock is an error the status reports');
});

test('actor(name): by id or name, any case; the party order decides between namesakes', () => {
    assert.equal(met(`actor('Ren').level >= 30`, { party }), true, 'Ren is first in order, before ac_cccccccc "ren"');
    assert.equal(met(`actor('lyra').hp.cur < actor('Lyra').hp.max`, { party }), true);
    assert.equal(met(`actor('ac_cccccccc').level == 1`, { party }), true, 'by id');
    assert.equal(met(`actor('Kael') == null`, { party }), true);
    assert.equal(met(`actor('Ren') == null`, {}), true);
    const unordered = { actors: { ac_zzzzzzzz: { name: 'Mo', level: 2 }, ac_aaaaaaaa: { name: 'Mo', level: 9 } } };
    assert.equal(met(`actor('Mo').level == 9`, { party: unordered }), true, 'without an order, ids decide');
});

test('count(list): lists, records, null', () => {
    const query = name => ({ list: [1, 2, 3], record: { a: 1, b: 2 }, none: null, word: 'abc', num: 3 })[name];
    assert.equal(met(`count(query('list')) == 3`, {}, query), true);
    assert.equal(met(`count(query('record')) == 2`, {}, query), true);
    assert.equal(met(`count(query('none')) == 0`, {}, query), true);
    assert.equal(met(`count(query('missing')) == 0`, {}, query), true);
    assert.match(why(`count(query('word')) == 3`, {}, query).message, /count\(\) counts a list or a record, not a word/);
    assert.match(why(`count(query('num')) == 3`, {}, query).message, /not a number/);
});

test('query(name, args?): passes the args record, refuses events.* and bad names', () => {
    const asked = [];
    const query = (name, args) => {
        asked.push([name, args]);
        return name === 'party.pc' ? { level: 30 } : [{ name: 'Wolf', count: 3 }];
    };
    assert.equal(met(`query('party.pc').level >= 30`, {}, query), true);
    assert.equal(met(`query('combat.foesBeaten', { sinceRev: 2, kind: 'wolf' })[0].count >= 3`, {}, query), true);
    assert.deepEqual(asked, [['party.pc', undefined], ['combat.foesBeaten', { sinceRev: 2, kind: 'wolf' }]]);
    assert.equal(why(`query('events.status') == null`, {}, query).code, 'NOT_ALLOWED');
    assert.match(why(`query('events.status') == null`, {}, query).message, /events engine about itself/);
    assert.match(why(`query(1) == null`, {}, query).message, /query\(\) needs a name in quotes/);
    assert.equal(why(`query('${'q'.repeat(81)}') == null`, {}, query).code, 'LIMIT');
    assert.equal(asked.length, 2, 'refused queries are never asked');
});

test('calls read the state and never change it', () => {
    const domains = { director, inventory, party };
    const before = JSON.stringify(domains);
    met(`quest('Granary Rats') != null && has('Rope') && actor('Ren').level > 1 && time() > 0 && count(actor('Ren').hp) == 2`, domains);
    assert.equal(JSON.stringify(domains), before);
});
