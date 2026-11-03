// Prompt diet (stage 59, Story Block part): a shorter header, the coin rule said once, the mount, weather and `you` lines only while their feature is
// on, the Carried line without where a thing was found (the screens keep the note). Each is a few characters less in every reply's prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { promptNote, inventoryTail } from '../../src/v2/domains/inventory.js';
import { STATIC_KEY, TAIL_KEY } from '../../src/v2/turn.js';
import { YOU_FEATURE } from '../../src/v2/domains/scene.js';
import { MOUNTS_FEATURE } from '../../src/v2/domains/mounts.js';

const staticOf = host => host.st.promptLog.filter(entry => entry.key === STATIC_KEY && entry.value).at(-1).value;
const tailOf = host => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).at(-1).value;
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test('the static header is short and keeps what the parser and the narrator need: the marker, the block, the ops, the kinds', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('One.', 'A first reply.');
    const text = staticOf(host);
    const header = text.slice(0, text.indexOf('Kinds:') + 6);
    assert.ok(header.startsWith('[Story Suite: how this story is kept]'));
    for (const piece of ['[Happened]', '<Changes>', '</Changes>', 'op kind Name — what happened | label: value', '+ new or gained, - gone or lost, ~ changed, ! happened, ? asks code to decide', 'This is the only block you write: no state, inventory or party blocks', 'outside any thinking']) assert.ok(header.includes(piece), piece);
    assert.ok(header.length < 760, `${header.length} characters (was 827)`);
});

test('the coin rule is said once in the static part and not again in the tail', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('One.', 'A first reply.');
    const all = `${staticOf(host)}\n${tailOf(host)}`;
    assert.equal(count(all, /write the coin line|write a coin line|coin line for/g), 1, 'one ask for the coin line');
    assert.doesNotMatch(staticOf(host).split('\n').find(line => line.startsWith('Code keeps the inventory')), /coin/);
});

test('the mount, weather and `you` lines are in the prompt only while their feature is on', async t => {
    const on = await createHost();
    t.after(() => on.close());
    await on.send('One.', 'A first reply.');
    assert.match(staticOf(on), /^\+ mount /m);
    assert.match(staticOf(on), /^~ weather /m);
    assert.match(staticOf(on), /^~ you /m);
    const off = await createHost({ settings: { features: { [YOU_FEATURE]: false, [MOUNTS_FEATURE]: false, 'story-block.weather': false } } });
    t.after(() => off.close());
    await off.send('One.', 'A first reply.');
    assert.doesNotMatch(staticOf(off), /^(\+ mount|~ weather|~ you) /m);
    assert.doesNotMatch(tailOf(off), /Your look|^Mounts?:|weather/im);
    assert.ok(staticOf(off).length < staticOf(on).length - 300, 'the three grammar lines are a real saving');
});

test('Carried leaves out where a thing was found; the rest of the note stays; the stored note is not touched', () => {
    assert.equal(promptNote('found at the drain'), '');
    assert.equal(promptNote('Found in the cellar'), '');
    assert.equal(promptNote('tarred hemp, found at the drain'), 'tarred hemp');
    assert.equal(promptNote('picked up near the gate; rusty'), 'rusty');
    assert.equal(promptNote('tarred hemp, sixty feet'), 'tarred hemp, sixty feet', 'a note with no provenance is the same text');
    assert.equal(promptNote('found a way to open it'), 'found a way to open it', 'only "found at/in/on/near…" is provenance');
    const state = { domains: { inventory: { defs: { 'story/rope': { id: 'story/rope', name: 'Rope', kind: 'misc', tags: [] }, 'story/lamp': { id: 'story/lamp', name: 'Lamp', kind: 'misc', tags: [] } },
        stacks: { it_a: { stack: 'it_a', def: 'story/rope', qty: 1, owner: 'party', equipped: null, note: 'found at the drain' }, it_b: { stack: 'it_b', def: 'story/lamp', qty: 1, owner: 'party', equipped: null, note: 'brass, found at the drain' } }, wallets: {}, nextId: 3 } } };
    const { lines } = inventoryTail(state, { currency: { name: 'gold', plural: 'gold', short: '' }, chars: 800, optionalChars: 400 });
    assert.ok(lines.includes('Carried: Lamp (brass), Rope'), lines.join('|'));
    assert.equal(state.domains.inventory.stacks.it_a.note, 'found at the drain');
});
