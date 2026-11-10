// The `restFallback` rule (fix/rest-kinds): a story full rest of a marked Character that is refused as too soon counts as a short rest on
// a reply captured with the mark; an older reply without it keeps the refusal. The new recovery sentence is shown for marked pins, old
// or new, and an unmarked Character's prompt is left as it was. Replay == live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { REST_WORDS, REST_WORDS_OLD, RESTED_FIELD, recoveryNote, recoveryPrompt } from '../../../src/v2/data-modules/recovery.js';
import { directorStub, reload } from '../data-modules/helpers.js';
import { grammarFor } from '../../../src/v2/data-modules/part/views.js';
import { fullModuleGrammar, moduleGrammar, referenceOf } from '../../../src/v2/data-modules/grammar.js';
import { DM_LIMITS as L } from '../../../src/v2/data-modules/schema.js';

async function world({ old = false, clock = false, minute = 1000, character = null } = {}) {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } },
        ...(clock ? { modules: [directorStub({ minute })] } : {}) });
    host.features.set(CORE_FEATURE.leanRpg, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) {
        const pinned = definition.role === 'character' ? character ?? (old ? characterV1For() : definition) : definition;
        const defined = await host.sdk.command('dm.define', { definition: structuredClone(pinned) });
        assert.equal(defined.ok, true, JSON.stringify(defined));
    }
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 1, str: 20, agi: 20, vit: 20 } })).ok, true);
    return host;
}
const fields = host => host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
const say = (host, lines) => host.send('Go.', `Told.\n<Changes>\n${lines.join('\n')}\n</Changes>`);
// A reply captured before the `restFallback` rule: no mark, so a too-soon full rest is still refused.
const sayOld = async (host, lines) => {
    const setter = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    try { await say(host, lines); } finally { host.store.setRuleMarks = setter; }
};
const set = (host, patch) => host.sdk.command('dm.set', { module: 'pack.chat/character', fields: patch });
const messages = host => host.turn.problems().map(problem => problem.message);
const rulesOf = host => host.ctx.chat.at(-1).extra?.storySuite?.rules;
const bars = host => ({ health: fields(host).health, stamina: fields(host).stamina, mana: fields(host).mana, rested: fields(host)[RESTED_FIELD] });
const marked = () => STANDARD_TEMPLATES.find(entry => entry.definition.role === 'character').definition;

// The Character prompt exactly as origin/main's template stores it (every old pin carries these bytes; its hash must not move).
const ORIGIN_PROMPT = 'One character: who they are, health, stamina and mana (words, shown as bars), seven stats 1 to 20, points, Level 1 to 99 and XP to 100. The narrator may lower health, mana and stamina, '
    + 'never raise them: rest, full-rest (once in 6 story hours) and heal (amount 1 to 3) do. They die only when Down before a reply and still Down at its end. The reader sets stats and points; at 100 XP the Level rises, and every third Level gives a point.';
const pinHash = host => host.head().domains.dataModules.active['pack.chat/character'].hash;

test('the stored Character prompt is the historical text; the new sentence shows at render for old and new pins; an unmarked Character is left alone', async () => {
    const current = marked();
    assert.equal(current.prompt, ORIGIN_PROMPT, 'the template stores the old prompt byte for byte');
    assert.ok(current.prompt.includes(REST_WORDS_OLD));
    assert.equal(recoveryPrompt(current), ORIGIN_PROMPT.replace(REST_WORDS_OLD, REST_WORDS));
    const unmarked = characterV1For();
    assert.equal(recoveryPrompt(unmarked), unmarked.prompt);
    const unmarkedWithOld = { ...unmarked, prompt: `${unmarked.prompt} Never raise them: ${REST_WORDS_OLD}` };
    assert.equal(recoveryPrompt(unmarkedWithOld), unmarkedWithOld.prompt, 'an unmarked pin is not rewritten');

    const host = await world();
    try {
        const hash = pinHash(host);
        const grammar = grammarFor(host.head());
        assert.ok(grammar.includes(REST_WORDS), 'the narrator sees the new sentence');
        assert.equal(grammar.includes(REST_WORDS_OLD), false);
        assert.equal(host.head().domains.dataModules.pins[hash].definition.prompt, ORIGIN_PROMPT, 'the stored pin keeps the old text');
        host.store.rebuild();
        assert.equal(pinHash(host), hash, 'rebuild');
        await reload(host);
        assert.equal(pinHash(host), hash, 'reload');
    } finally { host.close(); }
    const plain = await world({ old: true });
    try {
        const grammar = grammarFor(plain.head());
        assert.equal(grammar.includes(REST_WORDS), false, 'an unmarked pin gains no recovery sentence');
        assert.ok(grammar.includes(characterV1For().prompt), 'an unmarked pin keeps its prompt');
    } finally { plain.close(); }
});

test('a marked story full rest under six story hours with the mark counts as a short rest; rebuild, Re-read and reload agree', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal(top.rested, 1000);
        assert.ok(top.health > 1);
        assert.ok(rulesOf(host).includes('restFallback'), 'the reply carries the mark');

        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 359 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await say(host, ['~ dm character — a bed too soon | kind: full-rest']);
        assert.deepEqual(bars(host), { health: 1, stamina: top.stamina, mana: top.mana, rested: 1000 }, 'short rest: Health and rested-at stay');
        assert.ok(messages(host).includes(recoveryNote.restFallback('Astra')), messages(host));
        assert.equal(messages(host).includes(recoveryNote.fullRest('Astra')), false);

        const after = bars(host);
        host.store.rebuild();
        assert.deepEqual(bars(host), after, 'rebuild');
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.deepEqual(bars(host), after, 'Re-read');
        await reload(host);
        assert.deepEqual(bars(host), after, 'reload');
    } finally { host.close(); }
});

test('the same full rest on a reply without the mark is still refused and changes nothing', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 359 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await sayOld(host, ['~ dm character — a bed too soon | kind: full-rest']);
        assert.equal(rulesOf(host), undefined, 'an old reply has no mark');
        assert.deepEqual(bars(host), { health: 1, stamina: 1, mana: 1, rested: top.rested }, 'nothing changed');
        assert.ok(messages(host).includes(recoveryNote.fullRest('Astra')), messages(host));
        assert.equal(messages(host).includes(recoveryNote.restFallback('Astra')), false);
        const after = bars(host);
        host.store.rebuild();
        assert.deepEqual(bars(host), after, 'rebuild');
        await reload(host);
        assert.deepEqual(bars(host), after, 'reload');
    } finally { host.close(); }
});

test('a full rest not too soon is a full rest as before, Health too', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 360 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await say(host, ['~ dm character — a bed | kind: full-rest']);
        assert.deepEqual(bars(host), { health: top.health, stamina: top.stamina, mana: top.mana, rested: 1000 + 360 });
        assert.equal(messages(host).includes(recoveryNote.restFallback('Astra')), false);
        assert.equal(messages(host).includes(recoveryNote.fullRest('Astra')), false);
        const after = bars(host);
        host.store.rebuild();
        assert.deepEqual(bars(host), after, 'rebuild');
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.deepEqual(bars(host), after, 'Re-read');
        await reload(host);
        assert.deepEqual(bars(host), after, 'reload');
    } finally { host.close(); }
});

// The refused unmarked reply: a Re-read, a swipe and a reload keep it refused and changing nothing.
test('an unmarked reply stays refused through Re-read, swipe and reload', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 359 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await sayOld(host, ['~ dm character — a bed too soon | kind: full-rest']);
        const refused = { health: 1, stamina: 1, mana: 1, rested: top.rested };
        assert.deepEqual(bars(host), refused);
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.deepEqual(bars(host), refused, 'Re-read of the unmarked reply: still refused');
        assert.ok(messages(host).includes(recoveryNote.fullRest('Astra')), messages(host));
        await reload(host);
        assert.deepEqual(bars(host), refused, 'reload');
        // a swipe of it is a new reply: it carries the mark and counts as a short rest; swiping back keeps nothing of it
        await host.swipe('Told.\n<Changes>\n~ dm character — again | kind: full-rest\n</Changes>');
        assert.ok(rulesOf(host).includes('restFallback'));
        assert.deepEqual(bars(host), { health: 1, stamina: top.stamina, mana: top.mana, rested: top.rested }, 'the swipe is marked');
        await reload(host);
        assert.deepEqual(bars(host), { health: 1, stamina: top.stamina, mana: top.mana, rested: top.rested }, 'reload of the marked swipe');
    } finally { host.close(); }
});

test('a marked reply survives a swipe to plain text, and a reload, as a short rest', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await say(host, ['~ dm character — too soon | kind: full-rest']);
        const kept = { health: 1, stamina: top.stamina, mana: top.mana, rested: 1000 };
        assert.deepEqual(bars(host), kept);
        await reload(host);
        assert.deepEqual(bars(host), kept, 'reload');
        await host.swipe('Nothing happens.');
        assert.deepEqual(bars(host), { health: 1, stamina: 1, mana: 1, rested: 1000 }, 'the swipe without a line changes nothing');
    } finally { host.close(); }
});

// A joined companion made on the old template: its pin hash survives a Re-read and a later action stays active.
test('a re-read automatic party join keeps its pin hash (the historical prompt) and a later action on it stays active', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard', rpgJoin: 'auto' } } } });
    host.features.set(CORE_FEATURE.leanRpg, true);
    try {
        await host.send('Begin.', 'Opening.');
        for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
        await say(host, ['+ party Mara | about: a hedge-witch | class: I | best: int']);
        const mara = 'pack.chat/mara';
        const joined = host.head().domains.dataModules.active[mara];
        assert.ok(joined, 'Mara joined');
        const hash = joined.hash, joinAt = host.store.headIndex();
        assert.equal(host.head().domains.dataModules.pins[hash].definition.prompt, ORIGIN_PROMPT, 'the join stored the historical prompt');
        await say(host, ['~ dm mara — a nap | kind: rest']);
        assert.deepEqual(host.store.problems(), []);
        assert.equal((await host.turn.reread(joinAt)).ok, true);
        assert.equal(host.head().domains.dataModules.active[mara].hash, hash, 'Re-read of the join: same pin hash');
        assert.deepEqual(host.store.problems(), [], 'the later action is still active');
        host.store.rebuild();
        assert.equal(host.head().domains.dataModules.active[mara].hash, hash, 'rebuild');
        await reload(host);
        assert.equal(host.head().domains.dataModules.active[mara].hash, hash, 'reload');
        assert.deepEqual(host.store.problems(), []);
        assert.ok(grammarFor(host.head()).includes(REST_WORDS), 'and the narrator is told the new wording for it');
    } finally { host.close(); }
});

// The fallback is a fixed stamina and mana refill, never the pin's own `rest` effects.
test('a customised marked pin whose rest kind does more: the fallback only refills stamina and mana', async () => {
    const custom = structuredClone(marked());
    custom.kinds.rest.effects = [...custom.kinds.rest.effects, { op: 'add', path: ['health'], value: 5, bounds: 'clamp' }];
    const host = await world({ clock: true, character: custom });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await say(host, ['~ dm character — too soon | kind: full-rest']);
        assert.deepEqual(bars(host), { health: 1, stamina: top.stamina, mana: top.mana, rested: 1000 }, 'Health stays; the extra rest effect is not run');
        assert.equal(fields(host)['rested-known'], true);
        const after = bars(host);
        host.store.rebuild();
        assert.deepEqual(bars(host), after, 'rebuild');
        await reload(host);
        assert.deepEqual(bars(host), after, 'reload');
    } finally { host.close(); }
});

// The fallback witnesses the last full rest: if it changes, the saved short rest fails closed.
test('the fallback fails its guard when the earlier full rest it depended on is edited away', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest', '~ dm character — a salve | kind: heal | amount: 1']);
        const first = host.ctx.chat.length - 1;
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
        await say(host, ['~ dm character — too soon | kind: full-rest']);
        assert.ok(messages(host).includes(recoveryNote.restFallback('Astra')));
        assert.deepEqual(host.store.problems(), []);
        await host.st.editMessage(first, 'Told.\n<Changes>\n~ dm character — a salve | kind: heal | amount: 1\n</Changes>');
        assert.equal((await host.turn.reread(first)).ok, true);
        assert.ok(host.store.problems().length > 0, 'the later short rest is inactive until it is re-read');
        assert.equal(host.store.problems()[0].code, 'REPLAY_PREREQUISITE');
        assert.match(host.store.problems()[0].message, /Re-read/);
        assert.equal(fields(host).health, 2, 'the short rest is not replayed on the changed prefix');
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.ok(fields(host).health > 2, 'Re-read decides it again: now a full rest');
        assert.deepEqual(host.store.problems(), []);
    } finally { host.close(); }
});

// The render-time swap never drops prompt text or kind lines.
test('the new sentence is kept off a pin whose prompt or grammar would overflow', async () => {
    const base = marked();
    const swappedBy = REST_WORDS.length - REST_WORDS_OLD.length;
    const make = pad => ({ ...structuredClone(base), prompt: `${'x'.repeat(pad)} ${REST_WORDS_OLD}` });
    // prompt cap: an old prompt of 1,200 whose swap would be longer is shown as stored
    const full = make(L.prompt - REST_WORDS_OLD.length - 1);
    assert.equal([...full.prompt].length, L.prompt);
    const nearPrompt = make(L.prompt - REST_WORDS_OLD.length - 1 - 10);
    assert.ok([...nearPrompt.prompt].length + swappedBy > L.prompt);
    for (const definition of [full, nearPrompt]) {
        const host = await world({ character: definition });
        try {
            const grammar = grammarFor(host.head());
            assert.ok(grammar.includes(REST_WORDS_OLD), 'the old sentence stays');
            assert.equal(grammar.includes(REST_WORDS), false);
        } finally { host.close(); }
    }
    // grammar cap: kinds are added until the old prompt's grammar is within 10 characters of the cap, so the swapped one would cut a kind line
    const ref = referenceOf(['pack.chat/character'], 'pack.chat/character');
    const size = definition => fullModuleGrammar(definition, ref).length;
    const edge = structuredClone(base);
    const letters = 'abcdefghij';  // (a Character holds 16 kinds at most)
    for (let n = 0; n < letters.length && size({ ...edge, kinds: { ...edge.kinds, [`tonic-${letters[n]}`]: structuredClone(edge.kinds.heal) } }) <= L.staticCharacters; n += 1) edge.kinds[`tonic-${letters[n]}`] = structuredClone(edge.kinds.heal);
    const room = L.staticCharacters - size(edge);
    assert.ok(room >= 0 && room < 700, `kinds fill the grammar (room ${room})`);
    edge.prompt = `${'x'.repeat(Math.max(0, room - 10))} ${base.prompt}`.trim();
    assert.ok([...edge.prompt].length + swappedBy <= L.prompt, 'the swapped prompt alone would fit its own cap');
    assert.ok(size(edge) <= L.staticCharacters && size(edge) + swappedBy > L.staticCharacters, `the old prompt fits (${size(edge)}) and the swapped would not`);
    // (a pin the define check would refuse at this size under the longer full reference, so the pinned state is edited directly)
    const host = await world();
    try {
        const state = structuredClone(host.head());
        const dataModules = state.domains.dataModules;
        dataModules.pins[dataModules.active['pack.chat/character'].hash].definition = edge;
        const grammar = grammarFor(state);
        assert.ok(grammar.includes(REST_WORDS_OLD), 'the old sentence stays when the swap would cost a kind line');
        assert.equal(grammar.includes(REST_WORDS), false);

        for (const line of fullModuleGrammar(edge, ref).split('\n')) assert.ok(grammar.includes(line), `kept: ${line.slice(0, 40)}`);
    } finally { host.close(); }
});
