// Rule marks: every reply first captured live carries the current rules, including `diedAny` for `- key Name | died`, on its record.
// A module's apply reads them as `ctx.carrier.rules` (frozen); Re-read, rebuild, reload and swipe keep them. An old reply without marks
// keeps its old behavior: Re-read never adds marks to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { parseChanges } from '../../src/v2/capture.js';
import { RULE_LINES, allRuleNames, ruleMarksFor, ruleMarksOf } from '../../src/v2/turn/rule-marks.js';

const ALL = allRuleNames(); // a new reply carries every current rule, sorted

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const recordOf = (host, index) => host.ctx.chat[index].extra.storySuite;

async function world(t, seen) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.sdk.registerModule({
        id: 'probe', name: 'Probe', version: '2.0.0-alpha.1',
        domains: { markprobe: { initial: () => ({ deaths: {} }), validate: () => [] } },
        capture: { kinds: { key: { grammar: '- key Name | died' } }, apply(ctx, line) {
            seen.push({ rules: ctx.carrier?.rules ?? null, frozen: Object.isFrozen(ctx.carrier?.rules ?? []) });
            if (ctx.carrier?.rules?.includes('diedAny') && ruleMarksFor([line]).length) ctx.draft('markprobe').deaths[line.name] = true;
            return { summary: `Key: ${line.name}`, narrate: false };
        } },
    });
    await host.send('Begin.', 'Opening.');
    return host;
}

test('the rule table: a key line with a death word is diedAny; other lines and kinds are not; marks are cleaned', () => {
    const line = raw => parseChanges(raw).lines[0];
    assert.deepEqual(ruleMarksFor([line('- key Vorn | died')]), ['diedAny']);
    assert.deepEqual(ruleMarksFor([line('- key Vorn | killed in the yard')]), ['diedAny']);
    assert.deepEqual(ruleMarksFor([line('- key Vorn | d**ie**d')]), ['diedAny'], 'Markdown is stripped before matching');
    assert.deepEqual(ruleMarksFor([line('- key Vorn | unpinned'), line('+ item Rope'), line('- away Vorn | died')]), []);
    assert.deepEqual(ruleMarksFor([line('- key Death | unpinned'), line('+ key Vorn | died')]), [], 'a name or another operation is not a death');
    assert.deepEqual(ruleMarksOf(['zzz', 'diedAny', 'diedAny', 7, 'constructor', null]), ['diedAny']);
    assert.deepEqual(ruleMarksOf('diedAny'), []);
    assert.deepEqual(ruleMarksFor([line('? roll Astra | cha | normal | 9')]), ['checks']);
    assert.deepEqual(ruleMarksFor([line('? check lockpick — the lock | dc: normal')]), [], '`check` is Story Director\'s word: no mark');
    assert.deepEqual(ruleMarksFor([line('+ party Mara | class: II')]), ['partyFields', 'partyFour', 'partyRoom'], 'any + party line');
    assert.deepEqual(ruleMarksFor([line('+ party Mara')]), ['partyFields', 'partyFour', 'partyRoom']);
    assert.deepEqual(ruleMarksFor([line('- party Mara')]), ['partyLeft'], 'a leaving line changes no room, and carries only partyLeft');
    assert.deepEqual(RULE_LINES.partyRoom({ kind: 'dm', op: '+', raw: '+ party Mara' }), true, 'conservative: the raw words count, however it parsed');
    assert.deepEqual(Object.keys(RULE_LINES), ['checks', 'partyRoom', 'partyFour', 'diedAny', 'factionTags', 'xpKept', 'oneCoin', 'partyFields', 'partyLeft', 'caretWords', 'foesFresh']);
    assert.deepEqual(ruleMarksFor([line('+ world Harbour Fight | factions: Quay Watch')]), ['factionTags'], 'any world line');
    assert.deepEqual(ruleMarksFor([line('~ world Harbour Fight | factions: Quay Watch'), line('- world Harbour Fight')]), ['factionTags']);
    assert.ok(allRuleNames().includes('factionTags'));
});

test('a Continue of an old unmarked death cannot change its earlier lines on Re-read', async t => {
    const seen = [], host = await world(t, seen), setter = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Vorn falls.', reply('He falls.', ['- key Vorn | died']));
    host.store.setRuleMarks = setter;
    const at = host.ctx.chat.length - 1;
    await host.cont(`\n\n${reply('Ann falls too.', ['- key Ann | died'])}`);
    assert.equal(recordOf(host, at).rules, undefined);
    assert.equal(seen.at(-1).rules, null);
    assert.deepEqual(host.head().domains.markprobe.deaths, {});
    const live = JSON.stringify(host.head());
    seen.length = 0;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(seen.map(item => item.rules), [null, null]);
    assert.equal(JSON.stringify(host.head()), live);
});

test('a first death in a Continue is marked when no earlier death could change', async t => {
    const seen = [], host = await world(t, seen);
    await host.send('Wait.', 'They wait.');
    const at = host.ctx.chat.length - 1;
    await host.cont(`\n\n${reply('Vorn falls.', ['- key Vorn | d**ie**d'])}`);
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.deepEqual(seen.at(-1).rules, ALL);
    assert.deepEqual(host.head().domains.markprobe.deaths, { Vorn: true });
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(seen.at(-1).rules, ALL);
});

test('a new reply gets a first death mark in a Continue after reload', async t => {
    const seen = [], host = await world(t, seen);
    await host.send('Wait.', 'They wait.');
    const at = host.ctx.chat.length - 1;
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    await host.cont(`\n\n${reply('Vorn falls.', ['- key Vorn | died'])}`);
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.deepEqual(host.head().domains.markprobe.deaths, { Vorn: true });
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(seen.at(-1).rules, ALL);
});

test('a new reply carries every rule mark from its first capture, with no death line, and keeps it through reload, swipe and Re-read', async t => {
    const seen = [], host = await world(t, seen);
    await host.send('Wait.', 'They wait.');
    const at = host.ctx.chat.length - 1;
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.equal(recordOf(host, at).foeCap, 20);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.deepEqual(recordOf(host, at).rules, ALL);
    await host.swipe('Again.');
    await host.st.swipeTo(at, 0);
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(recordOf(host, at).rules, ALL);
});

test('editing an old unmarked reply and Re-reading it never grants the new death rule', async t => {
    const seen = [], host = await world(t, seen), setter = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Vorn falls.', reply('He falls.', ['- key Vorn | died']));
    host.store.setRuleMarks = setter;
    const at = host.ctx.chat.length - 1;
    await host.st.editMessage(at, reply('Ann falls.', ['- key Ann | died']));
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(recordOf(host, at).rules, undefined);
    assert.equal(seen.at(-1).rules, null);
    assert.deepEqual(host.head().domains.markprobe.deaths, {});
});

test('late lines cannot mark an old death, but a first late death on a plain reply is marked', async t => {
    const seen = [], host = await world(t, seen);
    let giveCapture;
    const ready = () => new Promise(resolve => { giveCapture = resolve; });
    await host.sdk.registerModule({ id: 'late-probe', name: 'Late probe', version: '1', hooks: { afterReply: ({ capture }) => giveCapture?.(capture) } });
    let captured = ready(), setter = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Vorn falls.', reply('He falls.', ['- key Vorn | died']));
    host.store.setRuleMarks = setter;
    const at = host.ctx.chat.length - 1;
    await (await captured)('- key Ann | died');
    assert.equal(recordOf(host, at).rules, undefined);
    seen.length = 0;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(seen.map(item => item.rules), [null, null]);
    captured = ready();
    await host.send('Wait.', 'They wait.');
    const next = host.ctx.chat.length - 1;
    await (await captured)('- key Ren | died');
    assert.deepEqual(recordOf(host, next).rules, ALL);
    assert.equal((await host.turn.reread(next)).ok, true);
    assert.deepEqual(seen.at(-1).rules, ALL);
});

test('a late first death on a loaded unmarked reply keeps the old rule', async t => {
    const seen = [], host = await world(t, seen);
    let resolveCapture;
    const capture = new Promise(resolve => { resolveCapture = resolve; });
    await host.sdk.registerModule({ id: 'late-old', name: 'Late old', version: '1', hooks: { afterReply: ({ capture: add }) => resolveCapture(add) } });
    await host.send('Wait.', 'They wait.');
    const at = host.ctx.chat.length - 1;
    const saved = JSON.parse(JSON.stringify(host.ctx.chat));
    delete saved[at].extra.storySuite.rules; // a chat saved before the marks existed
    await host.st.loadChat(saved);
    await (await capture)('- key Vorn | died');
    assert.equal(recordOf(host, at).rules, undefined);
    assert.deepEqual(host.head().domains.markprobe.deaths, {});
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(seen.at(-1).rules, null);
});

test('the mark belongs to its swipe, including the saved swipe copy', async t => {
    const seen = [], host = await world(t, seen);
    await host.send('Vorn falls.', reply('He falls.', ['- key Vorn | died']));
    const at = host.ctx.chat.length - 1;
    await host.swipe('No one falls.');
    assert.deepEqual(recordOf(host, at).rules, ALL, 'a new swipe is marked at its first capture too');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    await host.st.swipeTo(at, 0);
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(seen.at(-1).rules, ALL);
    await host.st.swipeTo(at, 1);
    assert.deepEqual(recordOf(host, at).rules, ALL);
});

test('swiping from a loaded old reply marks only the new swipe and restores the old record byte for byte', async t => {
    const seen = [], host = await world(t, seen);
    const setFoeCap = host.store.setFoeCap, setRuleMarks = host.store.setRuleMarks;
    host.store.setFoeCap = host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Vorn falls.', reply('He falls.', ['- key Vorn | died']));
    host.store.setFoeCap = setFoeCap;
    host.store.setRuleMarks = setRuleMarks;
    const at = host.ctx.chat.length - 1;
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    const oldRecord = JSON.stringify(recordOf(host, at)), oldHead = JSON.stringify(host.head());
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal(recordOf(host, at).rules, undefined);
    await host.swipe(reply('Ann falls.', ['- key Ann | died']));
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.deepEqual(host.head().domains.markprobe.deaths, { Ann: true });
    await host.st.swipeTo(at, 0);
    assert.equal(JSON.stringify(recordOf(host, at)), oldRecord);
    assert.equal(JSON.stringify(host.head()), oldHead);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(host.head()), oldHead);
    assert.equal(recordOf(host, at).foeCap, undefined);
    assert.equal(recordOf(host, at).rules, undefined);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), oldHead);
    await host.st.swipeTo(at, 1);
    assert.equal(recordOf(host, at).foeCap, 20);
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.deepEqual(host.head().domains.markprobe.deaths, { Ann: true });
});

test('a missing mark writer cannot make a rule live without recording it', async t => {
    const seen = [], host = await world(t, seen);
    host.store.setRuleMarks = undefined;
    await host.send('Vorn falls.', reply('He falls.', ['- key Vorn | died']));
    assert.equal(recordOf(host, host.ctx.chat.length - 1).rules, undefined);
    assert.equal(seen.at(-1).rules, null);
});

test('every live reply is marked at its first capture, line or no line; the module reads it and acts only on a death line', async t => {
    const seen = [];
    const host = await world(t, seen);
    await host.send('Plain.', reply('Nothing.', ['+ item Rope']));
    const plain = host.ctx.chat.length - 1;
    assert.deepEqual(recordOf(host, plain).rules, ALL);
    await host.send('Vorn falls.', reply('He dies.', ['- key Vorn | died']));
    const at = host.ctx.chat.length - 1;
    assert.deepEqual(recordOf(host, at).rules, ALL);
    assert.deepEqual(seen.at(-1), { rules: ALL, frozen: true });
    await host.send('Another.', reply('Quiet.', ['- key Ann | unpinned']));
    assert.deepEqual(recordOf(host, host.ctx.chat.length - 1).rules, ALL);
    assert.deepEqual(host.head().domains.markprobe.deaths, { Vorn: true });
});

test('a Re-read keeps the mark; a rebuild and a reload keep it too', async t => {
    const seen = [];
    const host = await world(t, seen);
    await host.send('Vorn falls.', reply('He dies.', ['- key Vorn | died']));
    const at = host.ctx.chat.length - 1;
    seen.length = 0;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(seen.at(-1)?.rules, ALL, 'the Re-read gave the module the mark');
    assert.deepEqual(recordOf(host, at).rules, ALL);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(recordOf(host, at).rules, ALL);
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

test('a new reply with a world line carries factionTags; an old reply recorded without the mark never gains it on Continue or Re-read', async t => {
    const seen = [], host = await world(t, seen), setter = host.store.setRuleMarks;
    await host.send('Brawl.', reply('A brawl.', ['+ world Harbour Fight | factions: Quay Watch']));
    const fresh = host.ctx.chat.length - 1;
    assert.ok(recordOf(host, fresh).rules.includes('factionTags'));
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Quiet.', reply('Quiet.', ['~ world Harbour Fight | factions: Quay Watch']));
    host.store.setRuleMarks = setter;
    const old = host.ctx.chat.length - 1;
    await host.cont(`\n\n${reply('Brawl.', ['+ world Harbour Fight | factions: Quay Watch'])}`);
    assert.equal(recordOf(host, old).rules, undefined);
    assert.equal((await host.turn.reread(old)).ok, true);
    assert.equal(recordOf(host, old).rules, undefined);
    assert.ok(recordOf(host, fresh).rules.includes('factionTags'));
});

test('caretWords: a ^ before every word is dropped only for a fresh or marked reply; an old reply keeps reading such a line as unreadable', async t => {
    const written = '^- ^key ^Vorn ^| ^note: ^a^b ^and ^more';
    assert.equal(parseChanges(written).lines.length, 0, 'default reading is unchanged');
    const read = parseChanges(written, { caret: true });
    assert.deepEqual(read.problems, []);
    assert.equal(read.lines[0].kind, 'key');
    assert.equal(read.lines[0].labels.note, 'a^b and more', 'a ^ inside a word stays');
    assert.equal(read.lines[0].raw, '- key Vorn | note: a^b and more');
    assert.equal(parseChanges('+ item Hat^Box', { caret: true }).lines[0].name, 'Hat^Box', 'a line not starting with ^ is untouched');
    assert.deepEqual(ruleMarksFor(read.lines), [], 'no parsed line falls under the rule: only a first capture marks it');
    const seen = [], host = await world(t, seen), setter = host.store.setRuleMarks;
    const edit = (index, text) => { const message = host.ctx.chat[index]; message.mes = text; if (message.swipes) message.swipes[message.swipe_id ?? 0] = text; };
    await host.send('Vorn.', reply('He nods.', ['^- ^key ^Vorn ^| ^unpinned']));
    const fresh = host.ctx.chat.length - 1;
    assert.ok(recordOf(host, fresh).rules.includes('caretWords'));
    assert.equal(seen.length, 1, 'a new reply is read tolerantly at its first capture');
    assert.equal((await host.turn.reread(fresh)).ok, true);
    assert.equal(seen.length, 2, 'the marked reply\'s Re-read reads it again');
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    await host.send('Ann.', reply('She nods.', ['- key Ann | unpinned']));
    host.store.setRuleMarks = setter;
    const old = host.ctx.chat.length - 1;
    assert.equal(recordOf(host, old).rules, undefined);
    assert.equal(seen.length, 3);
    edit(old, reply('She nods.', ['^- ^key ^Ann ^| ^unpinned']));
    assert.equal((await host.turn.reread(old)).ok, true);
    assert.equal(seen.length, 3, 'an old unmarked reply\'s Re-read still finds the line unreadable');
    assert.equal(recordOf(host, old).rules, undefined);
    edit(fresh, reply('He nods.', ['^- ^key ^Vorn ^| ^unpinned']));
    assert.equal((await host.turn.reread(fresh)).ok, true);
    assert.equal(seen.length, 4, 'a marked reply reads the edited line');
});
