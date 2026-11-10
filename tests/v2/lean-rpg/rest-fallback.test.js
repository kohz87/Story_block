// The `restFallback` rule (fix/rest-kinds): a story full rest of a marked Character that is refused as too soon is decided, on a reply captured with the mark, as the same
// line written with kind `rest` (the pin's own story rest kind; none: refused as before); an older reply without the mark keeps the refusal. The reply card shows an applied
// note that outlives a reload. The recovery wording line names only the recovery kinds the pin offers. Replay == live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { RESTED_FIELD, recoveryNote, restLine } from '../../../src/v2/data-modules/recovery.js';
import { directorStub, reload } from '../data-modules/helpers.js';
import { grammarFor } from '../../../src/v2/data-modules/part/views.js';
import { parseChanges } from '../../../src/v2/capture.js';
import { ruleMarksFor } from '../../../src/v2/turn/rule-marks.js';
import { fullModuleGrammar, moduleGrammar, referenceOf } from '../../../src/v2/data-modules/grammar.js';
import { DM_LIMITS as L } from '../../../src/v2/data-modules/schema.js';
import { replyRestFallbacks } from '../../../src/v2/reply-cards.js';
import { changesCardScreen } from '../../../src/v2/screens/index.js';
import { core, queries, renderSkip, show, stocked, text } from '../screens/helpers.js';

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
// The receipt's own summary of the short rest: bars it refilled named in it, and it survives a cold reload.
const NOTE = /^Astra: full rest too soon \(under 6 story hours\), counted as a short rest \((?:(?:Mana|Stamina) [^,()]+ → [^,()]+(?:, )?){2}\)\.$/u;
const noteOf = (host, at = host.ctx.chat.length - 1) => (host.ctx.chat[at].extra?.storySuite?.receipts ?? []).map(receipt => receipt.summary).find(text => /too soon/u.test(text ?? ''));
const marked = () => STANDARD_TEMPLATES.find(entry => entry.definition.role === 'character').definition;
const REST_LINE = restLine(marked());

// The Character prompt exactly as origin/main's template stores it (every old pin carries these bytes; its hash must not move).
const ORIGIN_PROMPT = 'One character: who they are, health, stamina and mana (words, shown as bars), seven stats 1 to 20, points, Level 1 to 99 and XP to 100. The narrator may lower health, mana and stamina, '
    + 'never raise them: rest, full-rest (once in 6 story hours) and heal (amount 1 to 3) do. They die only when Down before a reply and still Down at its end. The reader sets stats and points; at 100 XP the Level rises, and every third Level gives a point.';
const pinHash = host => host.head().domains.dataModules.active['pack.chat/character'].hash;

test('the stored Character prompt is the historical text; a marked Character gets one separate recovery line after its own lines; an unmarked one gets none', async () => {
    const current = marked();
    assert.equal(current.prompt, ORIGIN_PROMPT, 'the template stores the old prompt byte for byte');
    assert.equal(REST_LINE, "Recovery: rest (an hour or two) refills mana and stamina; full-rest (a night's sleep, once in 6 story hours) refills health, stamina and mana; heal (1 to 3) restores only health.");
    const host = await world();
    try {
        const hash = pinHash(host);
        const grammar = grammarFor(host.head());
        const own = moduleGrammar(current, referenceOf(['pack.chat/character'], 'pack.chat/character'), { seen: new Map() });
        assert.ok(grammar.includes(`${own}\n${REST_LINE}`), 'the line follows the module\'s own lines, which are all there');
        assert.equal(grammar.split(REST_LINE).length, 2, 'once');
        assert.ok(grammar.includes(ORIGIN_PROMPT), 'the old prompt sentence is not swapped');
        assert.equal(host.head().domains.dataModules.pins[hash].definition.prompt, ORIGIN_PROMPT, 'the stored pin keeps the old text');
        assert.equal(grammarFor(host.head()), grammar, 'the same bytes each time');
        host.store.rebuild();
        assert.equal(pinHash(host), hash, 'rebuild');
        await reload(host);
        assert.equal(pinHash(host), hash, 'reload');
    } finally { host.close(); }
    const plain = await world({ old: true });
    try {
        const grammar = grammarFor(plain.head());
        assert.equal(grammar.includes(REST_LINE), false, 'an unmarked pin gains no recovery line');
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
        assert.equal(messages(host).some(text => /short rest/u.test(text)), false, 'it is an applied outcome, not a "not applied" problem');
        assert.equal(messages(host).includes(recoveryNote.fullRest('Astra')), false);
        assert.match(noteOf(host), NOTE, 'the receipt itself says it was a short rest');
        const told = noteOf(host);

        const after = bars(host);
        host.store.rebuild();
        assert.equal(noteOf(host), told, 'rebuild');
        assert.deepEqual(bars(host), after, 'rebuild');
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.deepEqual(bars(host), after, 'Re-read');
        assert.equal(noteOf(host), told, 'Re-read');
        await reload(host);
        assert.deepEqual(bars(host), after, 'reload');
        assert.equal(noteOf(host), told, 'a cold reload keeps the note on the receipt');
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
        assert.equal(messages(host).some(text => /counted as a short rest/u.test(text)), false);
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
        assert.equal(messages(host).some(text => /counted as a short rest/u.test(text)), false);
        assert.equal(messages(host).includes(recoveryNote.fullRest('Astra')), false);
                host.store.rebuild();
        await reload(host);
        assert.deepEqual(bars(host), { health: top.health, stamina: top.stamina, mana: top.mana, rested: 1000 + 360 }, 'rebuild and reload');
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
        assert.ok(grammarFor(host.head()).includes(REST_LINE), 'and the narrator is told the recovery line for it');
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
        await set(host, { stamina: 1, mana: 1 });
        await say(host, ['~ dm character — too soon | kind: full-rest']);
        assert.match(noteOf(host), NOTE);
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

// The recovery line has its own room: a pin at the prompt cap or the grammar cap shows every old character and kind line, then the line.
test('the recovery line is added whole after a pin at the prompt cap or the grammar cap, which loses nothing', async () => {
    const base = marked(), ref = referenceOf(['pack.chat/character'], 'pack.chat/character');
    const atPrompt = { ...structuredClone(base), prompt: 'y'.repeat(L.prompt) };
    assert.equal([...atPrompt.prompt].length, L.prompt);
    const host = await world({ character: atPrompt });
    try {
        const hash = pinHash(host), grammar = grammarFor(host.head());
        assert.ok(grammar.includes(atPrompt.prompt), 'the whole 1,200-character prompt');
        for (const line of fullModuleGrammar(atPrompt, ref).split('\n')) assert.ok(grammar.includes(line), `kept: ${line.slice(0, 40)}`);
        assert.ok(grammar.includes(`${moduleGrammar(atPrompt, ref, { seen: new Map() })}\n${REST_LINE}`), 'the line follows');
        assert.equal(host.head().domains.dataModules.pins[hash].definition.prompt, atPrompt.prompt, 'the pin is untouched');
        assert.equal(pinHash(host), hash);
    } finally { host.close(); }
    // grammar cap: kinds are added until the module's own grammar is within a few characters of the cap
    const size = definition => fullModuleGrammar(definition, ref).length;
    const edge = structuredClone(base);
    for (const letter of 'abcdefghij') { // (a Character holds 16 kinds at most)
        if (size({ ...edge, kinds: { ...edge.kinds, [`tonic-${letter}`]: structuredClone(edge.kinds.heal) } }) > L.staticCharacters) break;
        edge.kinds[`tonic-${letter}`] = structuredClone(edge.kinds.heal);
    }
    const room = L.staticCharacters - size(edge);
    assert.ok(room >= 0 && room < 700, `kinds fill the grammar (room ${room})`);
    edge.prompt = `${'x'.repeat(Math.max(0, room - 10))} ${base.prompt}`.trim();
    assert.ok(size(edge) <= L.staticCharacters && size(edge) > L.staticCharacters - 40, `within 40 of the cap (${size(edge)})`);
    const second = await world(); // (the define check measures under the longer full reference, so the pinned state is edited directly)
    try {
        const state = structuredClone(second.head()), modules = state.domains.dataModules;
        modules.pins[modules.active['pack.chat/character'].hash].definition = edge;
        const grammar = grammarFor(state);
        for (const line of fullModuleGrammar(edge, ref).split('\n')) assert.ok(grammar.includes(line), `kept: ${line.slice(0, 40)}`);
        assert.ok(grammar.includes(`${moduleGrammar(edge, ref, { seen: new Map() })}\n${REST_LINE}`), 'the line follows, outside the 2,000');
    } finally { second.close(); }
});

// Marking: a reply whose earlier full-rest (or kind-less dm) line was captured without the mark is never given it by a later Continue.
test('the mark is conservative: any dm line without a kind, or naming full-rest with any operation, protects earlier text', () => {
    const line = text => parseChanges(text).lines[0];
    for (const text of ['~ dm character — a bed', '+ dm character — a bed | kind: full-rest', '! dm character | kind: full-rest', '~ dm character — a bed | kind: full-rest']) assert.deepEqual(ruleMarksFor([line(text)]), ['restFallback'], text);
    for (const text of ['~ dm character — a salve | kind: heal | amount: 1', '- key Vorn | unpinned', '+ item Rope']) assert.deepEqual(ruleMarksFor([line(text)]), [], text);
});

test('a Continue cannot mark a reply whose earlier dm line was captured without the mark; Re-read and reload agree', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        // the first capture's marking fails, with a kind-less line that a handler could read as a full rest
        await sayOld(host, ['~ dm character — a bed']);
        const at = host.ctx.chat.length - 1;
        assert.equal(rulesOf(host), undefined);
        await host.cont('\n\n<Changes>\n~ dm character — again | kind: full-rest\n</Changes>');
        assert.equal(rulesOf(host), undefined, 'the Continue adds no mark');
        const refused = JSON.stringify(bars(host));
        assert.equal(messages(host).some(text => /counted as a short rest/u.test(text)), false);
        assert.equal((await host.turn.reread(at)).ok, true);
        assert.equal(rulesOf(host), undefined, 'Re-read');
        assert.equal(JSON.stringify(bars(host)), refused, 'Re-read');
        await reload(host);
        assert.equal(rulesOf(host), undefined, 'reload');
        assert.equal(JSON.stringify(bars(host)), refused, 'reload');
        assert.equal(bars(host).rested, top.rested);
    } finally { host.close(); }
});

// Swipe back to the original replies.
test('swiping back to the original marked reply, and to the original unmarked one, keeps what each decided', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        const top = bars(host);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await say(host, ['~ dm character — too soon | kind: full-rest']);
        const at = host.ctx.chat.length - 1, kept = { health: 1, stamina: top.stamina, mana: top.mana, rested: 1000 }, told = noteOf(host);
        assert.match(told, NOTE);
        await host.swipe('Nothing happens.');
        assert.deepEqual(bars(host), { health: 1, stamina: 1, mana: 1, rested: 1000 });
        await host.st.swipeTo(at, 0);
        assert.deepEqual(bars(host), kept, 'back on the marked reply: still a short rest');
        assert.equal(noteOf(host), told, 'and the note');
        await reload(host);
        assert.deepEqual(bars(host), kept);
        assert.equal(noteOf(host), told, 'reload after the swipe back');
        // the unmarked reply
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await sayOld(host, ['~ dm character — a bed too soon | kind: full-rest']);
        const old = host.ctx.chat.length - 1, refused = { health: 1, stamina: 1, mana: 1, rested: 1000 };
        assert.deepEqual(bars(host), refused);
        await host.swipe('Nothing happens.');
        await host.st.swipeTo(old, 0);
        assert.deepEqual(bars(host), refused, 'back on the unmarked reply: still refused');
        assert.equal(rulesOf(host), undefined);
        assert.equal(noteOf(host, old), undefined);
        await reload(host);
        assert.deepEqual(bars(host), refused);
    } finally { host.close(); }
});

// The prerequisite cases: the earlier full rest deleted, or swiped to another reply, fails the saved short rest closed until it is re-read.
test('deleting the earlier full rest, or swiping it to another reply, fails the later short rest closed until it is re-read', async () => {
    for (const how of ['delete', 'swipe']) {
        const host = await world({ clock: true });
        try {
            await set(host, { health: 1 });
            await say(host, ['~ dm character — first | kind: full-rest', '~ dm character — a salve | kind: heal | amount: 1']);
            const first = host.ctx.chat.length - 1;
            if (how === 'swipe') {
                await host.swipe('Told.\n<Changes>\n~ dm character — a salve | kind: heal | amount: 1\n</Changes>');
                await host.st.swipeTo(first, 0);
            }
            assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
            await set(host, { stamina: 1, mana: 1 });
            await say(host, ['~ dm character — too soon | kind: full-rest']);
            assert.match(noteOf(host), NOTE, how);
            const later = host.ctx.chat.length - 1;
            if (how === 'delete') await host.st.deleteMessage(first); else await host.st.swipeTo(first, 1);
            assert.ok(host.store.problems().length > 0, `${how}: the short rest is inactive`);
            assert.equal(host.store.problems()[0].code, 'REPLAY_PREREQUISITE', how);
            const at = how === 'delete' ? later - 1 : later;
            assert.equal((await host.turn.reread(at)).ok, true);
            assert.deepEqual(host.store.problems(), [], `${how}: Re-read decides it again`);
            await reload(host);
            assert.deepEqual(host.store.problems(), [], `${how}: reload`);
        } finally { host.close(); }
    }
});

// The fallback is a rest line: whatever the pin's own `rest` does, the same fields and receipt changes as the written `kind: rest`.
test('a too-soon full rest on a marked reply is decided as a written rest line, for the standard pin and for a pin whose rest has rules', async () => {
    const odd = structuredClone(marked());
    odd.kinds.rest.effects = [...odd.kinds.rest.effects, { op: 'add', path: ['health'], value: 2, bounds: 'clamp' }];
    odd.rules = [...odd.rules, { id: 'rest-points', when: ['and', ['ge', ['get', ['stamina']], 1], ['lt', ['get', ['points']], 6]], then: [{ op: 'add', path: ['points'], value: 1, bounds: 'clamp' }] }];
    const run = async (character, kind) => {
        const host = await world({ clock: true, character });
        try {
            await set(host, { health: 1 });
            await say(host, ['~ dm character — first | kind: full-rest']);
            assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
            await set(host, { health: 1, stamina: 1, mana: 1 });
            await say(host, [`~ dm character — too soon | kind: ${kind}`]);
            const { id: _id, summary: _summary, seed: _seed, line: _line, data, ...receipt } = host.ctx.chat.at(-1).extra.storySuite.receipts.findLast(each => each.data?.v2?.result?.kind === 'rest');
            const { fallback, ...result } = data.v2.result;
            const out = { fields: structuredClone(fields(host)), receipt, result, fallback };
            host.store.rebuild();
            assert.deepEqual(fields(host), out.fields, 'rebuild');
            await reload(host);
            assert.deepEqual(fields(host), out.fields, 'reload');
            return out;
        } finally { host.close(); }
    };
    for (const [name, character] of [['standard', null], ['customised', odd]]) {
        const written = await run(character, 'rest'), fell = await run(character, 'full-rest');
        assert.equal(fell.fallback, true, name);
        assert.equal(written.fallback, undefined, name);
        assert.equal(fell.result.kind, 'rest', `${name}: the recorded kind is rest`);
        assert.deepEqual(fell.fields, written.fields, `${name}: the same fields`);
        assert.deepEqual(fell.receipt, written.receipt, `${name}: the same receipt changes`);
        assert.deepEqual(fell.result, written.result, `${name}: the same recorded result`);
    }
    const custom = await run(odd, 'full-rest');
    assert.equal(custom.fields.health, 3, 'the pin\'s own rest ran: Health +2');
    assert.ok(custom.fields.points > (await run(null, 'full-rest')).fields.points, 'and its rule');
});

test('a pin with no story rest kind (missing, a screen button, another operation) refuses the too-soon full rest as before', async () => {
    const without = structuredClone(marked()), button = structuredClone(marked()), other = structuredClone(marked());
    delete without.kinds.rest;
    button.kinds.rest.ui = true;
    other.kinds.rest.op = '+';
    for (const [name, character] of [['missing', without], ['button', button], ['op', other]]) {
        const host = await world({ clock: true, character });
        try {
            await set(host, { health: 1 });
            await say(host, ['~ dm character — first | kind: full-rest']);
            assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
            await set(host, { health: 1, stamina: 1, mana: 1 });
            const before = JSON.stringify(bars(host));
            await say(host, ['~ dm character — too soon | kind: full-rest']);
            assert.equal(JSON.stringify(bars(host)), before, `${name}: nothing changed`);
            assert.ok(messages(host).includes(recoveryNote.fullRest('Astra')), `${name}: ${messages(host)}`);
            assert.equal(noteOf(host), undefined, name);
            host.store.rebuild();
            await reload(host);
            assert.equal(JSON.stringify(bars(host)), before, `${name}: rebuild and reload`);
        } finally { host.close(); }
    }
});

// The card: an applied line from the recorded result (live, after a cold reload, after a swipe back), never "not applied"; a replay-inactive receipt gives none; a long name is bounded.
test('the reply card shows the short rest as an applied line, live, after reload and after swiping back, skipping an inactive receipt', { skip: renderSkip }, async () => {
    const host = await world({ clock: true });
    try {
        const lines = index => replyRestFallbacks(host.ctx.chat[index].extra.storySuite, host.store.problems(), index);
        await set(host, { who: 'N'.repeat(70), health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest', '~ dm character — a salve | kind: heal | amount: 1']);
        const first = host.ctx.chat.length - 1;
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 100 })).ok, true);
        await set(host, { stamina: 1, mana: 1 });
        await say(host, ['~ dm character — too soon | kind: full-rest']);
        const at = host.ctx.chat.length - 1;
        const expected = `${'N'.repeat(40)}: full rest too soon (under 6 story hours), counted as a short rest (Mana Drained → Fresh, Stamina Spent → Fresh).`;
        const drawn = () => {
            const module = core(), state = stocked(module);
            const { el } = show(changesCardScreen, { state, query: queries(module, state), changes: [], extra: { moduleLines: lines(at) } });
            return el;
        };
        const check = where => {
            assert.deepEqual(lines(at).map(line => line.text), [expected], where);
            assert.equal(lines(at)[0].tone, 'good', where);
            const el = drawn();
            assert.equal(text(el.querySelector('.extra .main')), expected, `${where}: drawn on the card`);
            assert.equal(el.querySelector('.refused'), null, `${where}: not in the not-applied list`);
        };
        check('live');
        await reload(host);
        check('cold reload');
        await host.swipe('Nothing happens.');
        assert.deepEqual(lines(at), [], 'the swipe has no line');
        await host.st.swipeTo(at, 0);
        check('swipe back');
        await host.st.deleteMessage(first);
        assert.ok(host.store.problems().length > 0);
        assert.deepEqual(lines(at - 1), [], 'a replay-inactive receipt gives no applied line');
    } finally { host.close(); }
});

// The wording line: only the story recovery kinds the pinned definition offers, each with its meaning; none: no line; pins and hashes stay.
test('the recovery line names only the recovery kinds a pin offers; a pre-recovery scaled pin and customised pins', async () => {
    const trim = (...names) => { const definition = structuredClone(marked()); for (const name of ['rest', 'full-rest', 'heal']) if (!names.includes(name)) delete definition.kinds[name]; return definition; };
    assert.equal(restLine(trim('heal')), 'Recovery: heal (1 to 3) restores only health.');
    assert.equal(restLine(trim('rest', 'heal')), 'Recovery: rest (an hour or two) refills mana and stamina; heal (1 to 3) restores only health.');
    assert.equal(restLine(trim('full-rest')), "Recovery: full-rest (a night's sleep, once in 6 story hours) refills health, stamina and mana.");
    const screenRest = trim('rest', 'full-rest');
    screenRest.kinds.rest.ui = true;
    assert.equal(restLine(screenRest).includes('rest (an hour'), false, 'a screen kind is not a story kind');
    // the pin made before the recovery kinds (commit 91bde032): scaled bars, set-*, add-xp and the reader's button-rest only
    const early = trim();
    early.kinds['button-rest'] = { op: '!', ui: true, title: 'Rest', labels: {}, effects: structuredClone(marked().kinds.rest.effects) };
    early.kinds['add-xp'] = { op: '~', labels: { amount: { type: 'int', min: 1, max: 100 } }, effects: [{ op: 'add', path: ['xp'], value: ['arg', 'amount'], bounds: 'clamp' }] };
    assert.equal(restLine(early), '', 'no recovery kind: no line');
    for (const [name, character, expected] of [['pre-recovery', early, ''], ['heal only', trim('heal'), restLine(trim('heal'))]]) {
        const host = await world({ character });
        try {
            const hash = pinHash(host), grammar = grammarFor(host.head());
            assert.equal(grammar.includes('Recovery:'), expected !== '', name);
            if (expected) assert.ok(grammar.includes(expected), name);
            assert.equal(grammar.includes('refills mana'), false, `${name}: no claim for a kind it lacks`);
            host.store.rebuild();
            await reload(host);
            assert.equal(pinHash(host), hash, `${name}: the pin and its hash stay`);
            assert.equal(grammarFor(host.head()), grammar, name);
        } finally { host.close(); }
    }
});
