// A story line for a data module with no `kind:` (a model leaves it out, or writes `letter: F` where `kind: promote` belongs): when
// exactly one kind of that module, written with the line's op, accepts the line's labels, that is the kind; with none or with
// several the line is refused as before ("kind must be …"), never guessed. Ersveil's guild membership has one `~` kind (promote,
// the only one with a `letter` label) and three `+` kinds that take no labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';
import { reply, success } from './helpers.js';

const ID = 'pack.ersveil/guild-membership';
const ersveil = () => JSON.parse(readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8'));
const guild = host => host.sdk.query('dataModules.view', { module: ID }).chat;
const dmProblems = host => host.turn.problems().filter(problem => ['DM_LABEL', 'REFUSED'].includes(problem.code));

async function world(t) {
    const host = await createHost();
    t.after(() => host.close());
    success(await host.packs.packs.install(ersveil()));
    const offer = host.sdk.query('dataModules.offers').find(row => row.module === ID);
    success(await host.sdk.command('dm.pin', { module: ID, hash: offer.hash, packHash: offer.packHash, subjects: [] }));
    await host.send('Begin.', 'The guild hall.');
    await host.send('I sign the register.', reply(`+ dm ${ID} — signs the register | kind: register`));
    assert.equal(guild(host).registered, true);
    return host;
}

test('~ dm guild-membership — … | letter: F, with no kind: is promote (the only ~ kind that takes a letter)', async t => {
    const host = await world(t);
    await host.send('The panel meets.', reply('~ dm guild-membership — the examiners pass them | letter: E'));
    assert.equal(guild(host).letter, 'E');
    assert.deepEqual(dmProblems(host), []);
    // The same line with the module's full id, and with the kind written, still work as before.
    await host.send('Again.', reply(`~ dm ${ID} — a second panel | kind: promote | letter: D`));
    assert.equal(guild(host).letter, 'D');
    await host.send('And again.', reply(`~ dm ${ID} — a third panel | letter: C`));
    assert.equal(guild(host).letter, 'C');
    await host.send('A re-test.', reply('~ dm guild-membership — back to the start | letter: F'));
    assert.equal(guild(host).letter, 'F');
    assert.deepEqual(dmProblems(host), []);
});

test('the inferred kind is the same line replayed: a swipe, a reload and a cold rebuild give the same letter', async t => {
    const host = await world(t);
    await host.send('The panel meets.', reply('~ dm guild-membership — the examiners pass them | letter: B'));
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
    await host.swipe('Another telling.');
    assert.equal(guild(host).letter, 'F', 'the swipe took the promotion back');
});

test('more than one kind accepts the line (three + kinds take no labels), or none does: refused as today, nothing applied', async t => {
    const host = await world(t);
    const before = JSON.stringify(host.head().domains.dataModules);
    // `+` with no kind and no labels fits register, dues and contract.
    await host.send('Dues?', reply('+ dm guild-membership — pays the dues'));
    assert.equal(JSON.stringify(host.head().domains.dataModules), before);
    assert.ok(dmProblems(host).some(problem => /kind must be register, dues or contract|kind must be/.test(problem.message)), JSON.stringify(dmProblems(host).map(problem => problem.message)));
    // `~` with a label no kind has fits none.
    const count = dmProblems(host).length;
    await host.send('Odd.', reply('~ dm guild-membership — nothing fits | rank: S'));
    assert.equal(JSON.stringify(host.head().domains.dataModules), before);
    assert.ok(dmProblems(host).length > count);
    // `~` with a letter that is not one of the module's: promote does not accept it, so no kind does; refused, the letter stays.
    await host.send('Bad letter.', reply('~ dm guild-membership — a made-up grade | letter: Z'));
    assert.equal(guild(host).letter, 'F');
    assert.match(dmProblems(host).at(-1).message, /kind must be register, dues, contract, promote or yearend; nothing applied/);
    // With the kind written, the value is judged as it always was.
    await host.send('Bad letter, kind written.', reply(`~ dm ${ID} — a made-up grade | kind: promote | letter: Z`));
    assert.match(dmProblems(host).at(-1).message, /letter must be/);
    // An op no kind uses with that label, e.g. `- dm … | letter: F`, is refused too.
    await host.send('Wrong op.', reply('- dm guild-membership — strips them | letter: F'));
    assert.equal(guild(host).letter, 'F');
});
