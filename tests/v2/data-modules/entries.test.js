// The List of entries field (`type: "entries"`): a block field holding a list of small records the story adds to, changes and drops with its own
// lines. These tests run the whole host (pack, pin, story lines, replay); the editor and the draft are in tests/v2/blocks/entries-editor.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataModules } from '../../../src/v2/data-modules/check.js';
import { fullModuleGrammar } from '../../../src/v2/data-modules/grammar.js';
import { summaryOf } from '../../../src/v2/data-modules/part.js';
import { world, pin, reply, pack, view, reload, rebuilt } from './helpers.js';

const text = (max, label) => ({ type: 'text', max, default: '', ...(label ? { label } : {}) });
const questField = (extra = {}) => ({ type: 'entries', max: 3, label: 'Quests', ...extra,
    of: { title: text(40), step: text(80), status: { type: 'enum', values: ['active', 'done', 'failed'], default: 'active' }, reward: { type: 'int', min: 0, max: 500, default: 0 } } });
export function quests(extra = {}) {
    return { slug: 'quests', name: 'Quest log', schema: 1, stateVersion: 1, scope: 'chat',
        state: { quests: questField(), gold: { type: 'int', min: 0, max: 100, default: 0 } },
        kinds: {
            'add-quests': { op: '+', labels: { title: { type: 'text', max: 40 }, step: { type: 'text', max: 80, optional: true }, status: { type: 'enum', values: ['active', 'done', 'failed'], optional: true },
                reward: { type: 'int', min: 0, max: 500, optional: true } }, effects: [{ op: 'entryAdd', path: ['quests'] }] },
            'set-quests': { op: '~', labels: { at: { type: 'text', max: 60 }, step: { type: 'text', max: 80, optional: true }, status: { type: 'enum', values: ['active', 'done', 'failed'], optional: true },
                reward: { type: 'int', min: 0, max: 500, optional: true } }, effects: [{ op: 'entrySet', path: ['quests'] }] },
            'drop-quests': { op: '-', labels: { at: { type: 'text', max: 60 } }, effects: [{ op: 'entryDrop', path: ['quests'] }] },
        }, layout: 'cards', roles: { field: 'quests', title: 'title', status: 'status', step: 'step' }, ...extra };
}
const checkOne = definition => validateDataModules([definition], { packId: 'dm-test', capabilities: ['data-modules-v1'] });
const quest = host => view(host, 'pack.dm-test/quests').chat.quests;
// (a refused line is told in the console and kept in the Problems list; the test reads what was told since the last call)
let told = [];
const problems = () => told.splice(0).join(' | ');
const listen = t => { told = []; t.mock.method(console, 'warn', (...args) => { told.push(args.join(' ')); }); };

test('an entries field is checked: parts, max, and the lines that work it', () => {
    assert.equal(checkOne(quests()).ok, true);
    const bad = (mutate, pattern) => {
        const definition = quests();
        mutate(definition);
        const result = checkOne(definition);
        assert.equal(result.ok, false);
        assert.match(JSON.stringify(result.errors), pattern);
    };
    bad(d => { d.state.quests.max = 51; }, /max/);
    bad(d => { d.state.quests.of = {}; }, /at least 1/);
    bad(d => { d.state.quests.of.at = text(10); }, /one lowercase word/);
    bad(d => { d.state.quests.of['two-words'] = text(10); }, /one lowercase word/);
    bad(d => { d.state.quests.of.nested = { type: 'entries', of: { a: text(5) } }; }, /text, a number or a choice/);
    bad(d => { d.state.quests.of.tags = { type: 'text', max: 20, default: '', list: true }; }, /text, a number or a choice/);
    bad(d => { for (const key of 'abcdefghi') d.state.quests.of[`part${key}`] = text(5); }, /at most 8|permits at most/);
    bad(d => { d.kinds['add-quests'].labels.nope = { type: 'text', max: 5 }; }, /part of the entry/);
    bad(d => { d.kinds['add-quests'].labels.title.max = 41; }, /no wider/);
    bad(d => { d.kinds['drop-quests'].labels.status = { type: 'enum', values: ['done'] }; }, /part of the entry/);
    bad(d => { delete d.kinds['set-quests'].labels.at; }, /at label/);
    bad(d => { d.kinds['set-quests'].effects[0].path = ['gold']; }, /list of entries field/);
    bad(d => { d.rules = [{ id: 'r', when: true, then: [{ op: 'entryAdd', path: ['quests'] }] }]; }, /story line/);
    bad(d => { d.rules = [{ id: 'r', when: ['gt', ['get', ['quests']], 1], then: [] }]; }, /list of entries is changed by its own lines/);
});

test('layout, roles and tones are checked against the entries field', () => {
    const bad = (mutate, pattern) => {
        const definition = quests();
        mutate(definition);
        const result = checkOne(definition);
        assert.equal(result.ok, false, 'must be refused');
        assert.match(JSON.stringify(result.errors), pattern);
    };
    assert.equal(checkOne(quests({ tones: { done: 'failed', failed: 'neutral' } })).ok, true);
    bad(d => { d.layout = 'grid'; }, /cards, bars or fields/);
    bad(d => { d.layout = 'bars'; delete d.roles; }, /every field to be a number/);
    bad(d => { delete d.roles; }, /needs roles/);
    bad(d => { d.layout = 'fields'; }, /belong to the cards layout/);
    bad(d => { d.roles.field = 'gold'; }, /list of entries/);
    bad(d => { d.roles.title = 'status'; }, /part of the entry of the right kind/);
    bad(d => { d.roles.step = 'missing'; }, /part of the entry of the right kind/);
    bad(d => { d.roles.status = 'step'; }, /part of the entry of the right kind/);
    bad(d => { d.roles.extra = 'x'; }, /Unknown field/);
    bad(d => { d.tones = { done: 'purple' }; }, /one of the status values/);
    bad(d => { d.tones = { missing: 'done' }; }, /one of the status values/);
    bad(d => { delete d.roles.status; d.tones = { done: 'done' }; }, /Tones need a status role/);
});

test('show.into names a tab to join and needs a tab of its own to join with', () => {
    const show = into => ({ tab: true, card: false, tabName: 'Quests', icon: 'ph-bookmark-simple', ...(into ? { into } : {}) });
    assert.equal(checkOne(quests({ show: show('reputation') })).ok, true);
    assert.equal(checkOne(quests({ show: show('pack.ersveil/reputation') })).ok, false); // (pinned change, INT-222: one rule for show.into, the lowercase TAB_ID of a tab; no dots or slashes)
    assert.equal(checkOne(quests({ show: { ...show('reputation'), tab: false, card: true } })).ok, false);
    assert.equal(checkOne(quests({ show: show('two words') })).ok, false);
    assert.equal(checkOne(quests({ show: { ...show(), into: 3 } })).ok, false);
});

test('the story adds, changes and drops entries by number or title, and replay gives the same list', async t => {
    listen(t);
    const host = await world(t, pack([quests()]));
    await pin(host);
    assert.deepEqual(quest(host), []);
    await host.send('Meet.', reply('+ dm quests — The widow asks for help | kind: add-quests | title: Find the key | step: Ask the smith | reward: 20',
        '+ dm quests — A second task | kind: add-quests | title: Warn the mill'));
    assert.equal(problems(), '');
    assert.deepEqual(quest(host), [
        { title: 'Find the key', step: 'Ask the smith', status: 'active', reward: 20 },
        { title: 'Warn the mill', step: '', status: 'active', reward: 0 }]);
    await host.send('Go.', reply('~ dm quests — The smith talks | kind: set-quests | at: find the KEY | step: Cross the river | status: done',
        '~ dm quests — Second task finished | kind: set-quests | at: 2 | status: failed'));
    assert.equal(problems(), '');
    assert.deepEqual(quest(host).map(entry => [entry.title, entry.step, entry.status]), [['Find the key', 'Cross the river', 'done'], ['Warn the mill', '', 'failed']]);
    await host.send('Done.', reply('- dm quests — Forgotten | kind: drop-quests | at: Warn the mill'));
    assert.deepEqual(quest(host).map(entry => entry.title), ['Find the key']);
    await reload(host);
    assert.deepEqual(quest(host).map(entry => entry.title), ['Find the key']);
    rebuilt(host);
});

test('a line that cannot be applied is refused with a plain sentence and changes nothing', async t => {
    listen(t);
    const host = await world(t, pack([quests()]));
    await pin(host);
    await host.send('Meet.', reply('+ dm quests — a | kind: add-quests | title: One', '+ dm quests — b | kind: add-quests | title: Two | step: other'));
    const refused = async line => {
        const before = JSON.stringify(quest(host));
        await host.send('Try.', reply(line));
        assert.equal(JSON.stringify(quest(host)), before, line);
        return problems();
    };
    assert.match(await refused('~ dm quests — x | kind: set-quests | at: 3 | status: done'), /no such entry/i);
    assert.match(await refused('~ dm quests — x | kind: set-quests | at: Nothing | status: done'), /no such entry/i);
    assert.match(await refused('+ dm quests — x | kind: add-quests | title: ONE'), /already an entry with that title/);
    assert.match(await refused('~ dm quests — x | kind: set-quests | at: 1 | status: asleep'), /status must be active, done or failed/);
    assert.match(await refused('~ dm quests — x | kind: set-quests | at: 1 | reward: 900'), /reward must be/);
    assert.match(await refused('- dm quests — x | kind: drop-quests | at: 9'), /no such entry/i);
    assert.match(await refused('+ dm quests — x | kind: add-quests | step: no title'), /title is missing/);
    assert.match(await refused('+ dm quests — x | kind: add-quests | title: T | colour: red'), /not a label of this line/);
    // full: max is 3 here
    await host.send('Third.', reply('+ dm quests — c | kind: add-quests | title: Three'));
    assert.equal(quest(host).length, 3);
    assert.match(await refused('+ dm quests — x | kind: add-quests | title: Four'), /list is full/);
    // a line with the wrong sign for its kind
    assert.match(await refused('+ dm quests — x | kind: drop-quests | at: 1'), /written with -/);
});

test('the tail names each entry by number and title, with its choices and numbers, and no long texts', async t => {
    listen(t);
    const host = await world(t, pack([quests()]));
    await pin(host);
    assert.match(summaryOf(host.head(), 'pack.dm-test/quests'), /quests: none/);
    await host.send('Meet.', reply('+ dm quests — a | kind: add-quests | title: Find the key | step: A long step the story does not need again | reward: 20'));
    const line = summaryOf(host.head(), 'pack.dm-test/quests');
    assert.match(line, /quests: 1 "Find the key" active 20; gold 0/);
    assert.doesNotMatch(line, /long step/);
});

test('the story grammar for an entries field is three short lines', () => {
    const checked = checkOne(quests()).definitions[0];
    const grammar = fullModuleGrammar(checked, 'quests').split('\n');
    assert.deepEqual(grammar, [
        '+ dm quests — reason | kind: add-quests | title: text | [step: text] | [status: active|done|failed] | [reward: 0..500]',
        '~ dm quests — reason | kind: set-quests | at: number or title | [any part of add-quests]',
        '- dm quests — reason | kind: drop-quests | at: number or title']);
});

test('a block with no entries field reads and behaves as before', async t => {
    const plain = { slug: 'plain', name: 'Plain', schema: 1, stateVersion: 1, scope: 'chat', state: { n: { type: 'int', min: 0, max: 9, default: 0 } },
        kinds: { bump: { op: '~', labels: { to: { type: 'int', min: 0, max: 9 } }, effects: [{ op: 'set', path: ['n'], value: ['arg', 'to'] }] } } };
    const host = await world(t, pack([plain]));
    await pin(host);
    await host.send('Bump.', reply('~ dm plain — x | kind: bump | to: 4'));
    assert.equal(view(host, 'pack.dm-test/plain').chat.n, 4);
    assert.equal(fullModuleGrammar(checkOne(plain).definitions[0], 'plain'), '~ dm plain — reason | kind: bump | to: 0..9');
});

// --- review 222 fixes (BE-FIX222) ---
import { createEvaluation } from '../../../src/v2/data-modules/interpreter.js';

const titles = host => quest(host).map(entry => entry.title);
const ADD = title => `+ dm quests — x | kind: add-quests | title: ${title}`;
const DROP = at => `- dm quests — x | kind: drop-quests | at: ${at}`;
async function seeded(t, list = ['A', 'B', 'C', 'D'], definition = quests()) {
    listen(t);
    definition.state.quests.max = 10;
    const host = await world(t, pack([definition]));
    await pin(host);
    if (list.length) await host.send('Seed.', reply(...list.map(ADD)));
    return host;
}

test('B1: a number in at means the list as it stood before the reply: two drops by number drop the two the story meant, and a set after them finds its entry', async t => {
    const host = await seeded(t);
    await host.send('x', reply(DROP(1), DROP(2)));
    assert.equal(problems(), '');
    assert.deepEqual(titles(host), ['C', 'D']);
    const again = await seeded(t);
    await again.send('x', reply(DROP(1), DROP(2), '~ dm quests — x | kind: set-quests | at: 3 | status: done'));
    assert.equal(problems(), '');
    assert.deepEqual(quest(again).map(entry => [entry.title, entry.status]), [['C', 'done'], ['D', 'active']]);
    await reload(again);
    rebuilt(again);
});

test('B1: an entry dropped earlier in the reply is refused with a plain sentence, and a title added in the reply is found by title', async t => {
    const host = await seeded(t);
    await host.send('x', reply(DROP(2), '~ dm quests — x | kind: set-quests | at: 2 | status: done'));
    assert.match(problems(), /Entry 2 was dropped earlier in this reply/);
    assert.deepEqual(titles(host), ['A', 'C', 'D']);
    await host.send('y', reply(ADD('E'), '~ dm quests — x | kind: set-quests | at: e | status: failed', DROP('A'), DROP(1)));
    assert.match(problems(), /Entry 1 was dropped earlier in this reply/);
    assert.deepEqual(quest(host).map(entry => [entry.title, entry.status]), [['C', 'active'], ['D', 'active'], ['E', 'failed']]);
});

test('B3: the title is the part the roles name, in the add line, in at and in the tail', async t => {
    listen(t);
    const definition = quests();
    definition.state.quests.max = 10;
    definition.roles = { field: 'quests', title: 'title', status: 'status' };
    definition.state.quests.of = { giver: text(30), title: text(40), status: { type: 'enum', values: ['active', 'done', 'failed'], default: 'active' } };
    definition.kinds = {
        'add-quests': { op: '+', labels: { giver: { type: 'text', max: 30, optional: true }, title: { type: 'text', max: 40 }, status: { type: 'enum', values: ['active', 'done', 'failed'], optional: true } }, effects: [{ op: 'entryAdd', path: ['quests'] }] },
        'set-quests': { op: '~', labels: { at: { type: 'text', max: 60 }, giver: { type: 'text', max: 30, optional: true }, title: { type: 'text', max: 40, optional: true }, status: { type: 'enum', values: ['active', 'done', 'failed'], optional: true } }, effects: [{ op: 'entrySet', path: ['quests'] }] },
        'drop-quests': { op: '-', labels: { at: { type: 'text', max: 60 } }, effects: [{ op: 'entryDrop', path: ['quests'] }] },
    };
    const host = await world(t, pack([definition]));
    await pin(host);
    await host.send('x', reply('+ dm quests — x | kind: add-quests | giver: Widow Hale | title: Find the key', '+ dm quests — x | kind: add-quests | giver: Smith | title: Warn the mill'));
    assert.equal(problems(), '');
    assert.match(summaryOf(host.head(), 'pack.dm-test/quests'), /quests: 1 "Find the key" active; 2 "Warn the mill" active/);
    await host.send('y', reply(DROP('Find the key')));
    assert.equal(problems(), '');
    assert.deepEqual(titles(host), ['Warn the mill']);
});

test('B4: one pair of straight or curly quotes around at is ignored', async t => {
    const host = await seeded(t, ['A', 'B', 'C', 'D', 'E']);
    await host.send('x', reply(DROP('"B"'), DROP('“C”'), DROP("'D'")));
    assert.equal(problems(), '');
    assert.deepEqual(titles(host), ['A', 'E']);
});

test('F4: a title that another entry has is refused on add (and on a change); at also takes #2 and 2., and a title that is a number', async t => {
    const host = await seeded(t, ['A', 'B', '1999']);
    await host.send('x', reply(ADD('b')));
    assert.match(problems(), /already an entry with that title/);
    assert.deepEqual(titles(host), ['A', 'B', '1999']);
    await host.send('x', reply('~ dm quests — x | kind: set-quests | at: #2 | status: done', '~ dm quests — x | kind: set-quests | at: 1. | status: failed', '~ dm quests — x | kind: set-quests | at: 1999 | status: done'));
    assert.equal(problems(), '');
    assert.deepEqual(quest(host).map(entry => entry.status), ['failed', 'done', 'done']);
});

test('an old list that holds two entries of one title still refuses an at that names that title', () => {
    const definition = checkOne(quests()).definitions[0];
    const instance = { fields: { quests: [{ title: 'One', step: '', status: 'active', reward: 0 }, { title: 'One', step: '', status: 'active', reward: 0 }], gold: 0 }, timers: {}, offers: {}, settled: {} };
    const evaluation = createEvaluation(definition, instance);
    assert.throws(() => evaluation.effects(definition.kinds['set-quests'].effects, { arg: { at: 'one', status: 'done' } }), /More than one entry has that title/);
});

test('B5: a long list ends on an entry boundary with +N more, the open entries come first and the other fields stay', async t => {
    listen(t);
    const definition = quests();
    definition.state.quests.max = 30;
    definition.state.quests.of.title = text(60);
    const host = await world(t, pack([definition]));
    await pin(host);
    const lines = Array.from({ length: 30 }, (_, at) => `+ dm quests — x | kind: add-quests | title: Quest number ${at + 1} of the long road | status: ${at % 5 === 4 ? 'active' : 'done'}`);
    await host.send('Many.', reply(...lines.slice(0, 15)));
    await host.send('More.', reply(...lines.slice(15)));
    assert.equal(problems(), '');
    const line = summaryOf(host.head(), 'pack.dm-test/quests');
    assert.ok(line.length <= 1000, `${line.length} characters`);
    assert.match(line, /\+\d+ more; gold 0\.$/, 'ends on a whole entry, then +N more, then the other fields');
    assert.doesNotMatch(line, /Quest number \d+( of( the( long)?)?)?[;.]? *$/m, 'no entry is cut');
    for (const open of [5, 10, 15, 20, 25, 30]) assert.match(line, new RegExp(`${open} "Quest number ${open} of the long road" active`), `open entry ${open} is named`);
    assert.match(line, /^Quest log — quests: /);
    // every entry shown is whole: it ends with its status word (and its reward)
    for (const piece of line.replace(/^Quest log — quests: /, '').replace(/; gold 0\.$/, '').split('; ').filter(piece => !piece.startsWith('+'))) assert.match(piece, /^\d+ "Quest number \d+ of the long road" (active|done) 0$/);
});

test('B5: a list of a few entries is told whole, in order; a block with no list keeps its 100-token tail', async t => {
    const host = await seeded(t, ['A', 'B', 'C']);
    assert.equal(summaryOf(host.head(), 'pack.dm-test/quests'), 'Quest log — quests: 1 "A" active 0; 2 "B" active 0; 3 "C" active 0; gold 0.');
    const plain = { slug: 'plain', name: 'Plain', schema: 1, stateVersion: 1, scope: 'chat', state: { note: { type: 'text', max: 240, default: '' } },
        kinds: { say: { op: '~', labels: { to: { type: 'text', max: 240 } }, effects: [{ op: 'set', path: ['note'], value: ['arg', 'to'] }] } } };
    const other = await world(t, pack([plain]));
    await pin(other);
    await other.send('x', reply(`~ dm plain — x | kind: say | to: ${'word '.repeat(60)}`));
    assert.ok(summaryOf(other.head(), 'pack.dm-test/plain').length <= 400, 'unchanged: 100 tokens');
});

test('F1: deleting an earlier reply that added an entry recomputes the later adds, with no Re-read', async t => {
    const host = await seeded(t, []);
    const at = {};
    for (const title of ['A', 'B', 'C', 'D']) { await host.send(`add ${title}`, reply(ADD(title))); at[title] = host.ctx.chat.length - 1; }
    assert.deepEqual(titles(host), ['A', 'B', 'C', 'D']);
    await host.st.deleteMessage(at.B);
    assert.deepEqual(titles(host), ['A', 'C', 'D']);
    assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
    await reload(host);
    rebuilt(host);
});

test('F1: the adds after a deleted reply hold; a later change or drop, which reads the whole list, waits for its Re-read', async t => {
    const host = await seeded(t, []);
    await host.send('one', reply(ADD('A')));
    const first = host.ctx.chat.length - 1;
    await host.send('two', reply(ADD('B')));
    await host.send('three', reply('~ dm quests — x | kind: set-quests | at: B | status: done'));
    const third = host.ctx.chat.length - 1;
    await host.st.deleteMessage(first);
    assert.deepEqual(quest(host).map(entry => [entry.title, entry.status]), [['B', 'active']], 'the add of B holds; the change that read the whole list is off');
    assert.equal(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
    assert.equal((await host.turn.reread(third - 1)).ok, true);
    assert.deepEqual(quest(host).map(entry => [entry.title, entry.status]), [['B', 'done']]);
});

test('INT-222: when every entry is open and some go behind "+N more", the oldest are hidden and the newest kept', async t => {
    listen(t);
    const definition = quests();
    definition.state.quests.max = 30;
    definition.state.quests.of.title = text(60);
    const host = await world(t, pack([definition]));
    await pin(host);
    const lines = Array.from({ length: 30 }, (_, at) => `+ dm quests — x | kind: add-quests | title: Quest number ${at + 1} of the long road | status: active`);
    await host.send('Many.', reply(...lines.slice(0, 15)));
    await host.send('More.', reply(...lines.slice(15)));
    const line = summaryOf(host.head(), 'pack.dm-test/quests');
    assert.match(line, /\+\d+ more/);
    assert.match(line, /30 "Quest number 30 of the long road" active/, 'the newest is kept');
    assert.doesNotMatch(line, /\b1 "Quest number 1 of the long road"/, 'the oldest is behind +N more');
    assert.ok(line.length <= 1000, `${line.length} characters`);
});

test('INT-222: the list tail never passes its 250 tokens (1000 characters), also with long titles and long other fields', async t => {
    listen(t);
    const definition = quests();
    definition.state.quests.max = 30;
    definition.state.quests.of.title = text(60);
    const host = await world(t, pack([definition]));
    await pin(host);
    const lines = Array.from({ length: 30 }, (_, at) => `+ dm quests — x | kind: add-quests | title: ${`T${at + 1} `.repeat(14).slice(0, 59).trim()} | status: ${at % 3 ? 'active' : 'done'}`);
    await host.send('Many.', reply(...lines.slice(0, 15)));
    await host.send('More.', reply(...lines.slice(15)));
    assert.ok(summaryOf(host.head(), 'pack.dm-test/quests').length <= 1000);
});
