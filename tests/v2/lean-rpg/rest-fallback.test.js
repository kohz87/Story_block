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

async function world({ old = false, clock = false, minute = 1000, character = null } = {}) {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } },
        ...(clock ? { modules: [directorStub({ minute })] } : {}) });
    host.features.set(CORE_FEATURE.leanRpg, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) {
        const pinned = definition.role === 'character' ? character ?? (old ? characterV1For() : definition) : definition;
        assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(pinned) })).ok, true);
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

test('the new recovery sentence reaches an old pin and a new pin; an unmarked Character is left alone', async () => {
    const current = marked();
    const old = structuredClone(current);
    old.prompt = old.prompt.replace(REST_WORDS, REST_WORDS_OLD);
    assert.ok(old.prompt.includes(REST_WORDS_OLD), 'the old pin was built with the old sentence');
    assert.equal(recoveryPrompt(old), current.prompt);
    assert.equal(recoveryPrompt(current), current.prompt);

    const unmarked = characterV1For();
    assert.equal(recoveryPrompt(unmarked), unmarked.prompt);
    const unmarkedWithOld = { ...unmarked, prompt: `${unmarked.prompt} Never raise them: ${REST_WORDS_OLD}` };
    assert.equal(recoveryPrompt(unmarkedWithOld), unmarkedWithOld.prompt, 'an unmarked pin is not rewritten');

    const pinned = await world({ character: old });
    try {
        const grammar = grammarFor(pinned.head());
        assert.ok(grammar.includes(REST_WORDS), 'the narrator sees the new sentence for an old pin');
        assert.equal(grammar.includes(REST_WORDS_OLD), false, 'the old sentence is not shown');
    } finally { pinned.close(); }
    const fresh = await world();
    try {
        const grammar = grammarFor(fresh.head());
        assert.ok(grammar.includes(REST_WORDS), 'the narrator sees the new sentence for a new pin');
        assert.equal(grammar.includes(REST_WORDS_OLD), false);
    } finally { fresh.close(); }
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
