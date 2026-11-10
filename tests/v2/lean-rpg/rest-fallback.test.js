// What a rest says it restores, and a story full rest that is too soon counting as a short rest. The recovery sentence is said by code for a marked Character
// (an older pin keeps its old text and still reads the new one; an unmarked pin is untouched). A reply captured under the `restFallback` mark refills stamina and
// mana and leaves health and rested-at; a reply without the mark keeps the refusal on Re-read, rebuild and reload. Not too soon: a full rest as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { REST_WORDS, REST_WORDS_OLD, recoveryNote, recoveryPrompt } from '../../../src/v2/data-modules/recovery.js';
import { grammarFor } from '../../../src/v2/data-modules/part/views.js';
import { directorStub, reload } from '../data-modules/helpers.js';

const OLD_PROMPT = STANDARD_TEMPLATES[0].definition.prompt.replace(REST_WORDS, REST_WORDS_OLD);

async function world({ oldPin = false } = {}) {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } }, modules: [directorStub({ minute: 1000 })] });
    host.features.set(CORE_FEATURE.leanRpg, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) {
        const copy = structuredClone(definition);
        if (oldPin && copy.role === 'character') copy.prompt = OLD_PROMPT;
        assert.equal((await host.sdk.command('dm.define', { definition: copy })).ok, true);
    }
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 1, str: 20, agi: 20, vit: 20 } })).ok, true);
    return host;
}
const fields = host => host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
const set = (host, patch) => host.sdk.command('dm.set', { module: 'pack.chat/character', fields: patch });
const say = (host, lines) => host.send('Go.', `Told.\n<Changes>\n${lines.join('\n')}\n</Changes>`);
const problems = host => host.turn.problems().map(problem => problem.message);
const same = host => { const live = JSON.stringify(host.head()); host.store.rebuild(); assert.equal(JSON.stringify(host.head()), live, 'rebuild == live'); };
const FULL = ['~ dm character — a nap | kind: full-rest'];
const top = host => { const f = fields(host); return { stamina: f.stamina, mana: f.mana }; };
// A reply captured before the mark: the host's first capture records no rule marks.
async function sayUnmarked(host, lines) {
    const setter = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    try { await say(host, lines); } finally { host.store.setRuleMarks = setter; }
}

test('the recovery sentence reaches a pin made with the old text, a new pin, and leaves an unmarked pin alone', async () => {
    for (const oldPin of [true, false]) {
        const host = await world({ oldPin });
        try {
            const pinned = host.head().domains.dataModules.pins;
            const stored = Object.values(pinned).map(pin => pin.definition).find(definition => definition.role === 'character').prompt;
            assert.equal(stored.includes(REST_WORDS_OLD), oldPin, 'the pin keeps what it was made with');
            const text = grammarFor(host.head());
            assert.ok(text.includes(REST_WORDS) && !text.includes(REST_WORDS_OLD), `sent text, oldPin=${oldPin}`);
            assert.equal(text, grammarFor(host.head()), 'byte-identical call to call');
        } finally { host.close(); }
    }
    const unmarked = characterV1For();
    assert.equal(recoveryPrompt(unmarked), unmarked.prompt);
    const withOld = { ...unmarked, prompt: OLD_PROMPT };
    assert.equal(recoveryPrompt(withOld), OLD_PROMPT, 'a pin without the mark is untouched');
    assert.match(REST_WORDS, /an hour or two.*night's sleep.*1 to 3 health steps/u);
});

test('marked reply, full rest too soon: stamina and mana refilled, health and rested-at kept, note says short rest; Re-read, rebuild and reload agree', async () => {
    const host = await world();
    try {
        await set(host, { health: 1 });
        await say(host, FULL);
        const restedAt = fields(host)['rested-at'], full = top(host);
        assert.ok(fields(host).health > 1);
        await set(host, { health: 2, stamina: 1, mana: 1 });
        await say(host, FULL);
        assert.deepEqual(top(host), full);
        assert.equal(fields(host).health, 2, 'health untouched');
        assert.equal(fields(host)['rested-at'], restedAt, 'rested-at not moved');
        assert.ok(problems(host).includes(recoveryNote.restFallback('Astra')), JSON.stringify(problems(host)));
        assert.equal(recoveryNote.restFallback('Astra'), 'Astra: full rest too soon (last under 6 story hours ago), counted as a short rest.');
        const live = JSON.stringify(host.head());
        same(host);
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.equal(JSON.stringify(host.head()), live, 'Re-read keeps it');
        await reload(host);
        assert.equal(JSON.stringify(host.head()), live, 'reload keeps it');
    } finally { host.close(); }
});

test('reply without the mark: a too-soon full rest is refused as before, on Re-read, rebuild and reload', async () => {
    const host = await world();
    try {
        await set(host, { health: 1 });
        await say(host, FULL);
        await set(host, { health: 2, stamina: 1, mana: 1 });
        await sayUnmarked(host, FULL);
        assert.deepEqual([fields(host).health, fields(host).stamina, fields(host).mana], [2, 1, 1]);
        assert.ok(problems(host).includes(recoveryNote.fullRest('Astra')));
        const live = JSON.stringify(host.head());
        same(host);
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.equal(JSON.stringify(host.head()), live);
        assert.ok(problems(host).includes(recoveryNote.fullRest('Astra')));
        await reload(host);
        assert.equal(JSON.stringify(host.head()), live);
    } finally { host.close(); }
});

test('not too soon: a full rest restores health as before, marked or not', async () => {
    const host = await world();
    try {
        await set(host, { health: 1, stamina: 1, mana: 1 });
        await say(host, FULL);
        const full = fields(host);
        assert.ok(full.health > 1 && full.stamina > 1 && full.mana > 1);
        assert.notEqual(full['rested-at'], 0);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 360 })).ok, true);
        await set(host, { health: 1 });
        await sayUnmarked(host, FULL);
        assert.equal(fields(host).health, full.health);
        assert.equal(fields(host)['rested-at'], 1000 + 360);
        assert.ok(!problems(host).includes(recoveryNote.restFallback('Astra')));
        same(host);
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.equal(fields(host).health, full.health);
    } finally { host.close(); }
});
