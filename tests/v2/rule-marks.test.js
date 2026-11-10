// Rule marks: a reply captured LIVE with a line a newer rule covers (a `- key Name | died` line: diedAny) carries `rules: ['diedAny']` on its record,
// a module's apply reads it as `ctx.carrier.rules` (frozen), and a Re-read, a rebuild and a reload keep it. A reply without such a line has none, and an old
// chat (recorded without the mark) stays byte-identical on rebuild, reload and Re-read: a Re-read never adds a mark to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { RULE_LINES, ruleMarksFor, ruleMarksOf } from '../../src/v2/turn/rule-marks.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const recordOf = (host, index) => host.ctx.chat[index].extra.storySuite;

async function world(t, seen) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.sdk.registerModule({
        id: 'probe', name: 'Probe', version: '2.0.0-alpha.1',
        capture: { kinds: { key: { grammar: '- key Name | died' } }, apply(ctx, line) { seen.push({ rules: ctx.carrier?.rules ?? null, frozen: Object.isFrozen(ctx.carrier?.rules ?? []) }); return { summary: `Key: ${line.name}`, narrate: false }; } },
    });
    await host.send('Begin.', 'Opening.');
    return host;
}

test('the rule table: a key line with a death word is diedAny; other lines and kinds are not; marks are cleaned', () => {
    const line = raw => ({ kind: raw.split(' ')[1], raw });
    assert.deepEqual(ruleMarksFor([line('- key Vorn | died')]), ['diedAny']);
    assert.deepEqual(ruleMarksFor([line('- key Vorn | killed in the yard')]), ['diedAny']);
    assert.deepEqual(ruleMarksFor([line('- key Vorn | unpinned'), line('+ item Rope'), line('- away Vorn | died')]), []);
    assert.deepEqual(ruleMarksOf(['zzz', 'diedAny', 'diedAny', 7, 'constructor', null]), ['diedAny']);
    assert.deepEqual(ruleMarksOf('diedAny'), []);
    assert.deepEqual(ruleMarksFor([line('? roll Astra | cha | normal | 9')]), ['checks']);
    assert.deepEqual(ruleMarksFor([line('? check lockpick — the lock | dc: normal')]), [], '`check` is Story Director\'s word: no mark');
    assert.deepEqual(Object.keys(RULE_LINES), ['checks', 'diedAny']);
});

test('a live capture with a died key line marks the reply; the module reads it; a reply without the line has no mark', { }, async t => {
    const seen = [];
    const host = await world(t, seen);
    await host.send('Plain.', reply('Nothing.', ['+ item Rope']));
    const plain = host.ctx.chat.length - 1;
    assert.equal(recordOf(host, plain).rules, undefined);
    await host.send('Vorn falls.', reply('He dies.', ['- key Vorn | died']));
    const at = host.ctx.chat.length - 1;
    assert.deepEqual(recordOf(host, at).rules, ['diedAny']);
    assert.deepEqual(seen.at(-1), { rules: ['diedAny'], frozen: true });
    await host.send('Another.', reply('Quiet.', ['- key Ann | unpinned']));
    assert.equal(recordOf(host, host.ctx.chat.length - 1).rules, undefined);
});

test('a Re-read keeps the mark; a rebuild and a reload keep it too', async t => {
    const seen = [];
    const host = await world(t, seen);
    await host.send('Vorn falls.', reply('He dies.', ['- key Vorn | died']));
    const at = host.ctx.chat.length - 1;
    seen.length = 0;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(seen.at(-1)?.rules, ['diedAny'], 'the Re-read gave the module the mark');
    assert.deepEqual(recordOf(host, at).rules, ['diedAny']);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(recordOf(host, at).rules, ['diedAny']);
});

test('an old reply (recorded without the mark) stays unmarked and byte-identical on rebuild, reload and Re-read', async t => {
    const seen = [];
    const host = await world(t, seen);
    const setRuleMarks = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('no mark: an old chat'); };
    await host.send('Vorn falls.', reply('He dies.', ['- key Vorn | died']));
    host.store.setRuleMarks = setRuleMarks;
    const at = host.ctx.chat.length - 1;
    assert.equal(recordOf(host, at).rules, undefined);
    assert.equal(seen.at(-1).rules, null);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload');
    assert.deepEqual(host.store.problems(), []);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(host.head()), live, 'a Re-read');
    assert.equal(recordOf(host, at).rules, undefined, 'a Re-read adds no mark');
    assert.equal(seen.at(-1).rules, null, 'the module saw no mark on the Re-read');
});
