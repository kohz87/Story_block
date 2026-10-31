// The party's mounts (src/v2/domains/mounts.js, feature `story-block.mounts`): up to six rows in `scene.mounts`, the capture kind
// `mount` (`+`, `~`, `-`; a missing pace is the kind's usual one; a seventh row is refused in plain words), the narrator's tail line,
// the queries `mounts.list` and `mounts.pace` that Story Director reads, the reader's pencil (`mounts.edit`), the Home card, and
// that a swipe, a Re-read, a middle delete and a reload treat the rows like any other change of the reply. Off means fully off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import {
    DEFAULT_PACE, KIND_PACE, MAX_ROWS, MOUNTS_FEATURE, WALK_PACE, mountRows, mountsPace, mountsTail, paceOfKind, validateMounts,
} from '../../../src/v2/domains/mounts.js';
import { initialScene, validateScene } from '../../../src/v2/domains/scene.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { homeScreen } from '../../../src/v2/screens/index.js';
import { checkInvariants } from '../qa/helpers/oracle.js';
import { recordingWidgets, renderSkip, show, text } from '../screens/helpers.js';
import { setupDom } from '../view/mounts/helpers.js';

const block = (story, lines) => `${story}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const staticText = host => host.st.requests.at(-1)?.chat?.[0]?.content ?? '';
const tailText = host => host.st.requests.at(-1).chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');
const lastIndex = host => host.ctx.chat.length - 1;
const problems = (host, index = lastIndex(host)) => host.turn.problems().filter(item => item.index === index).map(item => item.message);
const names = host => host.sdk.query('mounts.list').map(row => row.name);
const MARE = '+ mount Grey Mare | kind: horse | count: 1 | pace: 35 | where: ridden by Wessel';

async function fresh(t, settings = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings });
    t.after(() => host.close());
    await host.send('Hello.', block('The yard.', ['~ place Stray Oar | kind: inn']));
    return host;
}

// ---------------------------------------------------------------------------------------------------
// The pace of a kind, the state's validator, the rows read from a state

test('a missing pace is the kind\'s usual one: horse 35, pony 30, camel 30, mule 25, donkey 20, ox 15, cart 18, wagon 18, else 30', () => {
    assert.deepEqual(KIND_PACE, { horse: 35, pony: 30, camel: 30, mule: 25, donkey: 20, ox: 15, cart: 18, wagon: 18 });
    for (const [kind, pace] of Object.entries(KIND_PACE)) assert.equal(paceOfKind(kind), pace, kind);
    assert.equal(paceOfKind('  Horse '), 35, 'case and spaces do not matter');
    assert.equal(paceOfKind('horses'), 35);
    assert.equal(paceOfKind('oxen'), 15);
    for (const kind of ['', 'griffin', null, undefined]) assert.equal(paceOfKind(kind), DEFAULT_PACE, String(kind));
});

test('the validator: no mounts is fine; at most six rows with a name, short texts, a count of 1 to 8 and a pace of 1 to 200', () => {
    const row = (name, over = {}) => ({ name, kind: 'horse', count: 1, pace: 35, condition: '', where: '', ...over });
    const scene = rows => ({ ...initialScene(), mounts: rows });
    assert.deepEqual(validateScene(initialScene()), [], 'older chats read as none');
    assert.deepEqual(validateMounts(scene({ 'm:a': row('A') })), []);
    assert.match(validateMounts(scene('horse')).join(' '), /not a record/);
    assert.match(validateMounts(scene({ x: 'horse' })).join(' '), /A mount is not a record/);
    assert.match(validateMounts(scene({ x: row(' ') })).join(' '), /no name/);
    assert.match(validateMounts(scene({ x: row('N'.repeat(41)) })).join(' '), /name longer than 40/);
    assert.match(validateMounts(scene({ x: row('A', { kind: 'k'.repeat(21) }) })).join(' '), /kind is longer than 20/);
    assert.match(validateMounts(scene({ x: row('A', { condition: 'c'.repeat(61) }) })).join(' '), /condition is longer than 60/);
    assert.match(validateMounts(scene({ x: row('A', { where: 'w'.repeat(81) }) })).join(' '), /where is longer than 80/);
    assert.match(validateMounts(scene({ x: row('A', { count: 0 }) })).join(' '), /count is not a whole number from 1 to 8/);
    assert.match(validateMounts(scene({ x: row('A', { count: 9 }) })).join(' '), /count is not a whole number from 1 to 8/);
    assert.match(validateMounts(scene({ x: row('A', { pace: 201 }) })).join(' '), /pace is not a whole number from 1 to 200/);
    assert.match(validateMounts(scene({ x: row('A', { pace: 1.5 }) })).join(' '), /pace/);
    assert.match(validateMounts(scene({ x: row('Mare'), y: row(' mare') })).join(' '), /twice/);
    const seven = Object.fromEntries(Array.from({ length: MAX_ROWS + 1 }, (_, n) => [`m:${n}`, row(`Mount ${n}`)]));
    assert.match(validateScene(scene(seven)).join(' '), /At most 6 mounts/);
});

test('mounts.pace worked out from rows: the slowest row, the count in all, the walk when there are too few', () => {
    const state = rows => ({ domains: { scene: { ...initialScene(), mounts: Object.fromEntries(rows.map((row, n) => [`m:${n}`, { name: 'x', kind: '', count: 1, pace: 30, condition: '', where: '', ...row }])) } } });
    assert.equal(mountsPace({ domains: { scene: initialScene() } }), null, 'no mount, no pace');
    assert.deepEqual(mountsPace(state([{ name: 'Mare', pace: 35 }, { name: 'Burr', pace: 25 }, { name: 'Cart', pace: 25 }]), 1), { pace: 25, mounts: 3, riders: 1, short: 0, slowest: 'Burr' }, 'the first of equals');
    assert.deepEqual(mountsPace(state([{ name: 'Mare', pace: 35, count: 4 }, { name: 'Ox', pace: 15, count: 1 }]), 5), { pace: 15, mounts: 5, riders: 5, short: 0, slowest: 'Ox' }, 'a group counts its animals');
    assert.deepEqual(mountsPace(state([{ name: 'Mare', pace: 35 }]), 3), { pace: WALK_PACE, mounts: 1, riders: 3, short: 2, slowest: 'Mare' }, 'short: they walk');
    assert.equal(mountsPace(state([{ name: 'Mare', pace: 35 }]), 0).riders, 1, 'at least the one rider');
    assert.equal(mountsPace(state([{ name: 'Mare', pace: 35 }]), 'many').riders, 1);
});

// ---------------------------------------------------------------------------------------------------
// Capture

test('+ mount, ~ mount, - mount: rows in story order, a missing pace from the kind, names matched without case or extra spaces', async t => {
    const host = await fresh(t);
    await host.send('Saddle up.', block('The yard.', [MARE, '+ mount Guild remounts | kind: horse | count: 4', '+ mount Burr | kind: mule', '+ mount Old Flea']));
    assert.deepEqual(problems(host), []);
    assert.deepEqual(host.sdk.query('mounts.list'), [
        { name: 'Grey Mare', kind: 'horse', count: 1, pace: 35, condition: '', where: 'ridden by Wessel' },
        { name: 'Guild remounts', kind: 'horse', count: 4, pace: 35, condition: '', where: '' },
        { name: 'Burr', kind: 'mule', count: 1, pace: 25, condition: '', where: '' },
        { name: 'Old Flea', kind: '', count: 1, pace: 30, condition: '', where: '' },
    ]);
    const summaries = host.ctx.chat.at(-1).extra.storySuite.receipts.map(receipt => receipt.summary);
    assert.deepEqual(summaries.slice(0, 2), ['The party gets Grey Mare: horse, 35 km/day.', 'The party gets Guild remounts ×4: horse, 35 km/day.']);
    // `~` changes only what it names; the name matches without case or extra spaces.
    await host.send('Burr limps.', block('A stone.', ['~ mount  burr | condition: lame | where: stabled at the Stray Oar']));
    assert.deepEqual(problems(host), []);
    assert.deepEqual(host.sdk.query('mounts.list')[2], { name: 'Burr', kind: 'mule', count: 1, pace: 25, condition: 'lame', where: 'stabled at the Stray Oar' });
    // An empty label clears; a new kind takes its usual pace unless the line says one or the pace was set by hand.
    await host.send('Better.', block('Rested.', ['~ mount Burr | condition:', '~ mount Burr | kind: donkey', '~ mount Old Flea | kind: ox | pace: 12']));
    assert.deepEqual(host.sdk.query('mounts.list').slice(2), [
        { name: 'Burr', kind: 'donkey', count: 1, pace: 20, condition: '', where: 'stabled at the Stray Oar' },
        { name: 'Old Flea', kind: 'ox', count: 1, pace: 12, condition: '', where: '' },
    ]);
    // A `+` for a mount the party has updates it (a model repeats itself); nothing is added twice.
    await host.send('Again.', block('Again.', ['+ mount grey  MARE | where: led']));
    assert.equal(names(host).filter(name => name === 'Grey Mare').length, 1);
    assert.equal(host.sdk.query('mounts.list')[0].where, 'led');
    await host.send('Sold.', block('Sold.', ['- mount burr', '- mount Guild remounts']));
    assert.deepEqual(names(host), ['Grey Mare', 'Old Flea']);
    assert.deepEqual(problems(host), []);
});

test('hostile or odd lines: plain Problems, nothing saved on a refusal, numbers held to their range', async t => {
    const host = await fresh(t);
    await host.send('Saddle up.', block('The yard.', [MARE]));
    const before = JSON.stringify(host.head().domains.scene);
    await host.send('Odd.', block('Odd.', [
        '~ mount Nobody | condition: lame', '- mount Nobody', '+ mount', '+ mount Wagon | count: several', '+ mount Wagon | pace: fast',
        `+ mount ${'N'.repeat(41)}`, '* mount Wagon', '+ mount Grey Mare | count: 2.5',
    ]));
    const said = problems(host).join('\n');
    assert.match(said, /no mount called Nobody/);
    assert.match(said, /mount has no name/);
    assert.match(said, /count must be a whole number/);
    assert.match(said, /pace must be a whole number/);
    assert.match(said, /name is at most 40 characters/);
    assert.equal(JSON.stringify(host.head().domains.scene), before, 'a refused line changes nothing');
    // Out of range is held, and said.
    await host.send('Big.', block('Big.', ['+ mount Herd | kind: horse | count: 12 | pace: 900', '+ mount Slug | pace: 0']));
    assert.deepEqual(host.sdk.query('mounts.list').slice(1).map(row => [row.name, row.count, row.pace]), [['Herd', 8, 200], ['Slug', 1, 1]]);
    assert.match(problems(host).join('\n'), /count was held to 8/);
    assert.match(problems(host).join('\n'), /pace was held to 200/);
    // Long and markup-laden text is one plain line, cut: the name stays plain text for every screen.
    await host.send('Long.', block('Long.', [`~ mount Herd | condition: ${'tired and sore '.repeat(10)} | where: <b>by the <i>river</i></b>\nmore`, `~ mount Slug | kind: ${'k'.repeat(40)}`]));
    const herd = host.sdk.query('mounts.list')[1];
    assert.ok(Array.from(herd.condition).length <= 60 && herd.condition.endsWith('…'), 'condition cut with an ellipsis');
    assert.ok(Array.from(herd.where).length <= 80);
    assert.equal(host.sdk.query('mounts.list')[2].kind.length, 20);
    assert.deepEqual(validateScene(host.head().domains.scene), []);
});

test('- mount for a mount the party does not have is quiet, like - present: said plainly, ok, nothing changed, not a Problem (~ mount still is one)', async t => {
    const host = await fresh(t);
    await host.send('Saddle up.', block('The yard.', [MARE]));
    const before = JSON.stringify(host.head().domains.scene);
    await host.send('Gone.', block('Gone.', ['- mount Burr', '- mount Old Flea']));
    assert.deepEqual(problems(host), [], 'no Problem');
    assert.deepEqual(host.ctx.chat.at(-1).extra.storySuite.receipts.map(receipt => [receipt.summary, receipt.narrate, receipt.data.missing]), [['Burr is not with the party.', false, true], ['Old Flea is not with the party.', false, true]]);
    assert.equal(JSON.stringify(host.head().domains.scene), before, 'nothing changed');
    assert.deepEqual(names(host), ['Grey Mare']);
    // One that is there still goes, in the same reply as one that is not.
    await host.send('Sold.', block('Sold.', ['- mount Burr', '- mount  grey mare ']));
    assert.deepEqual(problems(host), []);
    assert.deepEqual(host.ctx.chat.at(-1).extra.storySuite.receipts.map(receipt => receipt.summary), ['Burr is not with the party.', 'The party no longer has Grey Mare.']);
    assert.deepEqual(names(host), []);
    await host.send('Odd.', block('Odd.', ['~ mount Burr | condition: lame']));
    assert.match(problems(host).join('\n'), /no mount called Burr/, 'a change to a mount the party does not have is still a Problem');
    checkInvariants(host, 'after the quiet lines');
});

test('a seventh row is refused with a plain Problem; the six stay', async t => {
    const host = await fresh(t);
    await host.send('Many.', block('Many.', ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(name => `+ mount ${name} | kind: pony`)));
    assert.deepEqual(names(host), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(problems(host), ['"+ mount G | kind: pony" was not used: The party can keep at most 6 mounts, so G was not added.']);
    // Sold one: there is room again. An update of a mount the party has is never "a seventh".
    await host.send('Sold.', block('Sold.', ['- mount C', '+ mount G | kind: pony', '+ mount A | where: led']));
    assert.deepEqual(names(host), ['A', 'B', 'D', 'E', 'F', 'G']);
    assert.deepEqual(problems(host), []);
});

// ---------------------------------------------------------------------------------------------------
// The prompt: one grammar line, the narrator's line, off means off

test('the grammar line and the tail line: one line each, the same bytes reply to reply, none of it while the feature is off', async t => {
    const host = await fresh(t);
    assert.equal(host.features.on(MOUNTS_FEATURE), true, 'on by default');
    await host.send('On.', 'Nothing yet.');
    const on = staticText(host);
    assert.equal(on.split('\n').filter(line => line.startsWith('+ mount Name')).length, 1, 'one grammar line');
    assert.doesNotMatch(tailText(host), /Mounts:/, 'no mount, no line');
    await host.send('Saddle up.', block('The yard.', [MARE, '+ mount Guild remounts | kind: horse | count: 4', '+ mount Burr | kind: mule | condition: tired | where: led']));
    await host.send('On.', 'On.');
    assert.equal(staticText(host), on, 'the static part does not move with the mounts');
    assert.match(tailText(host), /^Mounts: Grey Mare \(horse, 35 km\/day, ridden by Wessel\); Guild remounts ×4 \(horse, 35 km\/day\); Burr \(mule, 25 km\/day, tired, led\)$/m);
    assert.equal(mountsTail({ domains: { scene: initialScene() } }), null);

    host.features.set(MOUNTS_FEATURE, false);
    await host.send('On.', block('More.', ['+ mount Pia | kind: pony']));
    const off = staticText(host);
    assert.notEqual(off, on, 'the grammar line goes once');
    assert.equal(off, on.split('\n').filter(line => !line.startsWith('+ mount Name')).join('\n'), 'and only that line');
    assert.doesNotMatch(tailText(host), /Mounts:|mount/i, 'no narrator line');
    assert.deepEqual(host.turn.problems().filter(item => item.index === lastIndex(host)).map(item => [item.code, item.quiet]), [['FEATURE_OFF', true]], 'the line written while off is quietly not used');
    assert.equal(host.sdk.query('mounts.list'), null, 'queries are off with it');
    assert.equal(host.sdk.query('mounts.pace'), null);
    assert.equal((await host.sdk.command('mounts.edit', { mount: 'Burr', condition: 'fine' })).ok, false, 'the pencil command too');
    assert.equal(names2(host).includes('Pia'), false, 'nothing was captured');
    assert.equal(Object.keys(host.head().domains.scene.mounts).length, 3, 'the rows are kept for when it is on again');
    host.features.set(MOUNTS_FEATURE, true);
    await host.send('On.', 'On.');
    assert.equal(staticText(host), on, 'back on: the old bytes');
    assert.equal(names(host).length, 3);
});
const names2 = host => Object.values(host.head().domains.scene.mounts ?? {}).map(row => row.name);

test('with no mount ever written, the scene state is exactly what it was before mounts', async t => {
    const host = await fresh(t);
    await host.send('On.', 'On.');
    assert.equal(Object.hasOwn(host.head().domains.scene, 'mounts'), false);
    assert.deepEqual(host.sdk.query('mounts.list'), []);
    assert.equal(host.sdk.query('mounts.pace'), null);
});

// ---------------------------------------------------------------------------------------------------
// The queries: copies, story order, riders

test('mounts.list gives copies; mounts.pace is the slowest row and walks when the party has too few mounts', async t => {
    const host = await fresh(t);
    await host.send('Saddle up.', block('The yard.', [MARE, '+ mount Burr | kind: mule']));
    const list = host.sdk.query('mounts.list');
    list[0].name = 'changed';
    assert.equal(host.sdk.query('mounts.list')[0].name, 'Grey Mare', 'a copy');
    // The RPG is off: one rider.
    assert.deepEqual(host.sdk.query('mounts.pace'), { pace: 25, mounts: 2, riders: 1, short: 0, slowest: 'Burr' });
    await host.send('Sold.', block('Sold.', ['- mount Burr']));
    assert.deepEqual(host.sdk.query('mounts.pace'), { pace: 35, mounts: 1, riders: 1, short: 0, slowest: 'Grey Mare' });
    await host.send('Gone.', block('Gone.', ['- mount Grey Mare']));
    assert.equal(host.sdk.query('mounts.pace'), null, 'no mount, no pace');
    assert.deepEqual(host.sdk.query('mounts.list'), []);
});

async function character(host, who, soul = 1) {
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = who.toLowerCase(); defs.character.name = who; defs.character.state.who.default = who; defs.character.state.soul.default = soul;
    defs.skills.slug = `${who.toLowerCase()}-skills`; defs.skills.name = `${who}'s skills`; defs.skills.state.who.default = who;
    for (const definition of [defs.character, defs.skills]) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
}

test('with the RPG on, the riders are the party\'s characters who have not left; short walks at 20', async t => {
    const host = await fresh(t);
    host.features.set(CORE_FEATURE.leanRpg, true);
    await character(host, 'Wessel');
    await character(host, 'Mara');
    await character(host, 'Tobin');
    await host.send('Saddle up.', block('The yard.', [MARE, '+ mount Burr | kind: mule']));
    assert.deepEqual(host.sdk.query('mounts.pace'), { pace: WALK_PACE, mounts: 2, riders: 3, short: 1, slowest: 'Burr' }, 'three riders, two mounts: they walk');
    await host.send('More.', block('More.', ['+ mount Pia | kind: pony']));
    assert.deepEqual(host.sdk.query('mounts.pace'), { pace: 25, mounts: 3, riders: 3, short: 0, slowest: 'Burr' });
    // Someone who left is not carried.
    await host.send('Tobin goes home.', block('Goodbye.', ['- party Tobin', '- mount Pia']));
    assert.deepEqual(problems(host), []);
    assert.deepEqual(host.sdk.query('mounts.pace'), { pace: 25, mounts: 2, riders: 2, short: 0, slowest: 'Burr' }, 'Tobin left: two riders, two mounts');
    host.features.set(CORE_FEATURE.leanRpg, false);
    assert.deepEqual(host.sdk.query('mounts.pace'), { pace: 25, mounts: 2, riders: 1, short: 0, slowest: 'Burr' }, 'the RPG off: the one reader');
});

// ---------------------------------------------------------------------------------------------------
// The reader's pencil

test('mounts.edit changes a row by hand on the latest reply, and only the reader can', async t => {
    const host = await fresh(t);
    await host.send('Saddle up.', block('The yard.', [MARE, '+ mount Burr | kind: mule']));
    const saves = host.ctx.chat.length;
    const edit = await host.sdk.command('mounts.edit', { mount: 'Burr', condition: 'sore', pace: 22, count: 2, where: 'at the farrier', kind: 'mule', name: 'Old Burr' });
    assert.equal(edit.ok, true, edit.message);
    assert.deepEqual(host.sdk.query('mounts.list')[1], { name: 'Old Burr', kind: 'mule', count: 2, pace: 22, condition: 'sore', where: 'at the farrier' });
    assert.equal(host.ctx.chat.length, saves, 'kept on the latest reply');
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.at(-1).type, 'mounts.edit');
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.at(-1).data.edit, true);
    for (const [payload, pattern] of [
        [{ mount: 'Nobody', condition: 'x' }, /no mount called Nobody/],
        [{ condition: 'x' }, /Which mount/],
        [{ mount: 'Old Burr', name: 'grey mare' }, /already the name/],
        [{ mount: 'Old Burr', name: '  ' }, /needs the mount's name/],
        [{ mount: 'Old Burr', count: 'lots' }, /whole number/],
        [{ mount: 'Old Burr', condition: 5 }, /must be text/],
    ]) {
        const result = await host.sdk.command('mounts.edit', payload);
        assert.equal(result.ok, false, JSON.stringify(payload));
        assert.match(result.message, pattern);
    }
    assert.equal(host.sdk.query('mounts.list')[1].name, 'Old Burr', 'the refusals changed nothing');
    // The story cannot use the command (its lines are the capture kind).
    await host.send('Say.', block('Say.', ['+ mount Pia | kind: pony']));
    assert.equal(names(host).includes('Pia'), true);
    assert.deepEqual(validateScene(host.head().domains.scene), []);
});

// ---------------------------------------------------------------------------------------------------
// Replay: a swipe, Re-read, a middle delete and a reload

test('a swipe takes its mounts back; Re-read keeps them; a reload reads what the story holds', async t => {
    const host = await fresh(t);
    await host.send('Saddle up.', block('The yard.', [MARE]));
    await host.send('More.', block('More.', ['+ mount Burr | kind: mule', '~ mount Grey Mare | condition: tired']));
    const at = lastIndex(host);
    assert.deepEqual(names(host), ['Grey Mare', 'Burr']);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.sdk.query('mounts.list').map(row => [row.name, row.condition]), [['Grey Mare', 'tired'], ['Burr', '']]);
    // A swipe has its own mounts; the other swipe, with none, rolls back to the reply before.
    await host.swipe(block('Another.', ['+ mount Pia | kind: pony', '- mount Grey Mare']));
    assert.deepEqual(names(host), ['Pia']);
    await host.swipe('Nothing this time.');
    assert.deepEqual(host.sdk.query('mounts.list').map(row => [row.name, row.condition]), [['Grey Mare', '']]);
    await host.st.swipeTo(at, 0);
    assert.deepEqual(host.sdk.query('mounts.list').map(row => [row.name, row.condition]), [['Grey Mare', 'tired'], ['Burr', '']]);
    checkInvariants(host, 'after the swipes');
    // Re-read after the reply's text was edited: the old lines' effects are replaced by the new ones.
    host.ctx.chat[at].mes = block('More.', ['+ mount Burr | kind: mule | pace: 24']);
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.sdk.query('mounts.list').map(row => [row.name, row.pace, row.condition]), [['Grey Mare', 35, ''], ['Burr', 24, '']]);
    checkInvariants(host, 'after Re-read');
    const other = await createHost({ st: { chat: host.ctx.chat } });
    t.after(() => other.close());
    assert.deepEqual(other.head(), host.head());
    assert.deepEqual(other.sdk.query('mounts.list'), host.sdk.query('mounts.list'));
});

test('deleting the reply that added a mount: later replies still apply, a change to the gone mount is passed over, nothing is skipped', async t => {
    const host = await fresh(t);
    await host.send('Saddle up.', block('The yard.', [MARE]));                                  // first: makes the field and Grey Mare
    const first = lastIndex(host);
    await host.send('Burr.', block('Burr.', ['+ mount Burr | kind: mule']));
    const second = lastIndex(host);
    await host.send('Both.', block('Both.', ['~ mount Grey Mare | condition: tired', '~ mount Burr | condition: lame', '~ place Weir | kind: ford']));
    await host.send('Pia.', block('Pia.', ['+ mount Pia | kind: pony', '- mount Burr']));
    assert.deepEqual(names(host), ['Grey Mare', 'Pia']);
    // The first reply deleted: Burr and Pia (the field is made again), Grey Mare's tired is passed over, the place still moves.
    await host.st.deleteMessage(first);
    await host.st.deleteMessage(first - 1);
    assert.deepEqual(host.store.problems(), [], 'nothing skipped');
    assert.deepEqual(names(host), ['Pia']);
    assert.equal(host.sdk.query('scene.place').name, 'Weir', 'the rest of the reply that changed the gone mount applied');
    assert.deepEqual(validateScene(host.head().domains.scene), []);
    checkInvariants(host, 'after the first delete');
    // The second reply (Burr's) deleted too: the lame and the removal of Burr are passed over.
    const index = host.ctx.chat.findIndex((message, n) => !message.is_user && n > 0 && /\+ mount Burr/.test(message.mes));
    assert.ok(index > 0 && second > 0);
    await host.st.deleteMessage(index);
    await host.st.deleteMessage(index - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual(names(host), ['Pia']);
    checkInvariants(host, 'after the second delete');
    // Deleting the last reply takes Pia back; a fresh host over the chat agrees.
    await host.st.deleteMessage(lastIndex(host));
    assert.deepEqual(names(host), []);
    assert.equal(host.sdk.query('mounts.pace'), null);
    await host.send('Again.', block('Again.', ['+ mount Pia | kind: pony']));
    const other = await createHost({ st: { chat: host.ctx.chat } });
    t.after(() => other.close());
    assert.deepEqual(other.head(), host.head());
});

test('the cap is checked on replay too: taking away the reply that sold a mount skips the block that would make a seventh, alone', async t => {
    const host = await fresh(t);
    await host.send('Six.', block('Six.', ['A', 'B', 'C', 'D', 'E', 'F'].map(name => `+ mount ${name}`)));
    const six = lastIndex(host);
    await host.send('Sell.', block('Sell.', ['- mount A']));
    await host.send('Buy.', block('Buy.', ['+ mount G', '~ place Dock']));
    assert.deepEqual(names(host), ['B', 'C', 'D', 'E', 'F', 'G']);
    // Taking away the sale: G would be a seventh, so that reply's block is skipped whole (reported), not the state broken.
    const sale = host.ctx.chat.findIndex(message => !message.is_user && /- mount A/.test(message.mes));
    await host.st.deleteMessage(sale);
    await host.st.deleteMessage(sale - 1);
    assert.deepEqual(validateScene(host.head().domains.scene), []);
    assert.equal(names(host).length <= MAX_ROWS, true);
    assert.ok(six > 0);
    checkInvariants(host, 'after the delete');
});

// ---------------------------------------------------------------------------------------------------
// Home

test('Home shows the Mounts card only while the party has a mount: a row each, the slowest, and the walk when short', { skip: renderSkip }, async t => {
    const host = await fresh(t);
    const query = (name, args) => host.sdk.query(name, args);
    const card = () => show(homeScreen, { state: host.head(), query, widgets: recordingWidgets().widgets });
    assert.equal(card().el.querySelectorAll('.mounts').length, 0, 'no mount, no card');
    await host.send('Saddle up.', block('The yard.', [MARE, '+ mount Guild remounts | kind: horse | count: 4', '+ mount Burr | kind: mule | condition: tired | where: led', '+ mount Cart <b>one</b> | kind: cart']));
    const { el, view } = card();
    assert.deepEqual(view.warnings, []);
    const rows = el.querySelectorAll('.mounts .mount');
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(row => text(row.querySelector('.mount-name b'))), ['Grey Mare', 'Guild remounts', 'Burr', 'Cart <b>one</b>']);
    assert.equal(text(rows[0].querySelector('.mount-sub')), 'horse · ridden by Wessel');
    assert.equal(text(rows[1].querySelector('.mount-name')).includes('×4'), true);
    assert.equal(text(rows[2].querySelector('.mount-sub')), 'mule · tired · led');
    assert.equal(text(rows[0].querySelector('.mount-pace')), '35 km/day');
    assert.equal(text(rows[2].querySelector('.mount-pace')), '25 km/day');
    assert.equal(rows[0].querySelectorAll('.fa-horse').length, 1, 'a horse icon');
    assert.equal(rows[2].querySelectorAll('.fa-horse-head').length, 1, 'a mule icon');
    assert.equal(rows[3].querySelectorAll('.fa-cart-flatbed').length, 1, 'a cart icon');
    assert.equal(el.querySelectorAll('.mounts b b, .mounts i[onerror]').length, 0, 'text is text');
    assert.equal(text(el.querySelector('.mount-note')), 'The party travels at the slowest: 18 km/day riding.');
    host.features.set(CORE_FEATURE.leanRpg, true);
    for (const who of ['Wessel', 'Mara']) await character(host, who);
    await host.send('Sold.', block('Sold.', ['- mount Burr', '- mount Cart <b>one</b>', '- mount Guild remounts']));
    assert.equal(text(card().el.querySelector('.mount-note')), 'Not enough mounts for everyone: the party walks (20 km/day).', 'one mount, two riders');
});

test('the pencil on a Home row opens the six fields, saves only what changed on the latest reply, and shows the row again', { skip: renderSkip }, async t => {
    const doc = setupDom(), form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const host = await fresh(t);
    const ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => ui.destroy());
    await host.send('Saddle up.', block('The yard.', [MARE, '+ mount Burr | kind: mule']));
    assert.equal(ui.mounts.screen.open('story-block/home'), true);
    const rows = () => doc.querySelectorAll('.ss-gameview .mounts .mount');
    assert.equal(rows().length, 2);
    const pencil = rows()[1].querySelector('.ss-w-editable-pencil');
    assert.equal(pencil.getAttribute('aria-label'), 'Edit mount');
    pencil.click();
    const inputs = rows()[1].querySelectorAll('.ss-w-editable-form input');
    assert.deepEqual(inputs.map(input => input.getAttribute('aria-label')), ['Name', 'Kind', 'How many', 'Pace (km/day)', 'Condition', 'Where']);
    assert.deepEqual(inputs.map(input => input.value), ['Burr', 'mule', '1', '25', '', '']);
    inputs[4].value = 'lame';
    inputs[5].value = 'stabled at the Stray Oar';
    inputs[3].value = '999';
    rows()[1].querySelector('.ss-w-editable-save').click();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(host.sdk.query('mounts.list')[1], { name: 'Burr', kind: 'mule', count: 1, pace: 200, condition: 'lame', where: 'stabled at the Stray Oar' }, 'a pace past the limit is held');
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.at(-1).type, 'mounts.edit');
    assert.equal(text(rows()[1].querySelector('.mount-sub')), 'mule · lame · stabled at the Stray Oar');
    assert.equal(text(rows()[1].querySelector('.mount-pace')), '200 km/day');
    // Nothing changed: no command.
    const receipts = host.ctx.chat.at(-1).extra.storySuite.receipts.length;
    rows()[0].querySelector('.ss-w-editable-pencil').click();
    rows()[0].querySelector('.ss-w-editable-save').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.length, receipts);
    // Off: the card goes with the feature.
    host.features.set(MOUNTS_FEATURE, false);
    assert.equal(rows().length, 0);
});
