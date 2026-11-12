// The narrator's natural clear `! dm foes - cleared` (no kind): read as clear-N when exactly one foe group stands, under the `foesClear` rule mark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { success, view, reply, rebuilt } from '../data-modules/helpers.js';

const standard = name => (name === 'Character' ? characterV1For() : structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition));
const foes = host => view(host, 'pack.chat/foes').chat;
const SET = (slot, name) => `+ dm foes — why | kind: set-slot-${slot} | name: ${name} | count: 3 | level: 2`;
async function chat(t, ...sets) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Foes']) success(await host.sdk.command('dm.define', { definition: standard(name) }));
    if (sets.length) await host.send('Raiders.', reply(...sets));
    return host;
}

test('the run\'s exact line `! dm foes - cleared` clears the one group that stands (and survives a rebuild)', async t => {
    const host = await chat(t, SET(1, 'Tannery raiders'));
    assert.equal(foes(host).count1, 3);
    await host.send('Done.', reply('! dm foes - cleared'));
    assert.deepEqual([foes(host).count1, foes(host).foe1, foes(host).hurt1], [0, '', 12]);
    rebuilt(host);
});

test('`- dm foes — cleared` (the right sign, no kind) clears it too; a line that names a kind is unchanged', async t => {
    const host = await chat(t, SET(1, 'Tannery raiders'));
    await host.send('Done.', reply('- dm foes — cleared'));
    assert.equal(foes(host).count1, 0);
    await host.send('More.', reply(SET(2, 'Rats')));
    await host.send('Gone.', reply('- dm foes — why | kind: clear-2 | why: down'));
    assert.equal(foes(host).count2, 0);
});

test('two groups standing: the bare clear is a guess, so it is not used and both stay', async t => {
    const host = await chat(t, SET(1, 'Tannery raiders'), SET(2, 'Rats'));
    await host.send('Done.', reply('! dm foes - cleared'));
    assert.deepEqual([foes(host).count1, foes(host).count2], [3, 3]);
});

test('other words are not a clear, and an empty block stays empty', async t => {
    const host = await chat(t, SET(1, 'Tannery raiders'));
    await host.send('Hm.', reply('! dm foes - they circle you'));
    assert.equal(foes(host).count1, 3);
    const empty = await chat(t);
    await empty.send('Done.', reply('! dm foes - cleared'));
    assert.equal(foes(empty).count1, 0);
});

test('a reply captured before the rule (no foesClear mark) keeps the line unused, also on a Re-read; a marked one clears and keeps clearing on a Re-read', async t => {
    const host = await chat(t, SET(1, 'Tannery raiders'));
    const setter = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Done.', reply('! dm foes - cleared'));
    host.store.setRuleMarks = setter;
    const old = host.ctx.chat.length - 1;
    assert.equal(host.ctx.chat[old].extra.storySuite.rules, undefined);
    assert.equal(foes(host).count1, 3, 'an unmarked reply: the line is not used');
    assert.equal((await host.turn.reread(old)).ok, true);
    assert.equal(foes(host).count1, 3, 'and not on a Re-read');
    await host.send('Again.', reply('! dm foes - cleared'));
    const fresh = host.ctx.chat.length - 1;
    assert.ok(host.ctx.chat[fresh].extra.storySuite.rules.includes('foesClear'));
    assert.equal(foes(host).count1, 0);
    assert.equal((await host.turn.reread(fresh)).ok, true);
    assert.equal(foes(host).count1, 0);
    rebuilt(host);
});
