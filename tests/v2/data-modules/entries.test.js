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
    await host.send('Meet.', reply('+ dm quests — a | kind: add-quests | title: One', '+ dm quests — b | kind: add-quests | title: One | step: other'));
    const refused = async line => {
        const before = JSON.stringify(quest(host));
        await host.send('Try.', reply(line));
        assert.equal(JSON.stringify(quest(host)), before, line);
        return problems();
    };
    assert.match(await refused('~ dm quests — x | kind: set-quests | at: 3 | status: done'), /no such entry/i);
    assert.match(await refused('~ dm quests — x | kind: set-quests | at: Nothing | status: done'), /no such entry/i);
    assert.match(await refused('~ dm quests — x | kind: set-quests | at: One | status: done'), /More than one entry has that title/);
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
