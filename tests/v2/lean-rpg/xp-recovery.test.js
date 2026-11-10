// Marked Character (scale 2): XP comes from won fights only (the story's add-xp is refused, the marked fight formula pays 15 + 2 per extra foe), the story
// cannot raise Health, Stamina or Mana, and rest / full-rest / heal recover them. An unmarked pin keeps every old rule. Replay == live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { memberXp, fightGuard } from '../../../src/v2/lean-rpg/fight.js';
import { hasRestButtons, isMarkedCharacter, fullRestTooSoon, recoveryNote } from '../../../src/v2/data-modules/recovery.js';
import { directorStub, reload } from '../data-modules/helpers.js';
import { cueOfResult } from '../../../src/v2/lean-rpg/cue.js';
import { grammarFor } from '../../../src/v2/data-modules/part/views.js';

async function world({ old = false, clock = false, minute = 1000 } = {}) {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } },
        ...(clock ? { modules: [directorStub({ minute })] } : {}) });
    host.features.set(CORE_FEATURE.leanRpg, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) {
        assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(old && definition.role === 'character' ? characterV1For() : definition) })).ok, true);
    }
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 1, str: 20, agi: 20, vit: 20 } })).ok, true);
    return host;
}
const fields = host => host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
const say = (host, lines) => host.send('Go.', `Told.\n<Changes>\n${lines.join('\n')}\n</Changes>`);
// A reply captured before the `restFallback` rule: no mark, so a too-soon full rest is still refused (rest-fallback.test.js covers the marked reply).
const sayOld = async (host, lines) => {
    const setter = host.store.setRuleMarks;
    host.store.setRuleMarks = () => { throw new Error('old reply'); };
    try { await say(host, lines); } finally { host.store.setRuleMarks = setter; }
};
const set = (host, patch) => host.sdk.command('dm.set', { module: 'pack.chat/character', fields: patch });
const problems = host => JSON.stringify(host.turn.problems().map(problem => problem.message));
const same = host => { const live = JSON.stringify(host.head()); host.store.rebuild(); assert.equal(JSON.stringify(host.head()), live, 'rebuild == live'); };

test('the marked fight pays (15 + 2 per extra foe) x levels x gap: 15, 17, 25, 37 at one level, 60 for a level 14 foe against level 4', () => {
    const at = (count, level = 4, own = 4) => memberXp([{ count, level }], own, true);
    assert.deepEqual([1, 2, 6, 12].map(count => at(count)), [15, 17, 25, 37]);
    assert.equal(at(1, 14, 4), 60);
    assert.equal(memberXp([{ count: 6, level: 5 }], 25, true), 0);
    assert.equal(memberXp([{ count: 3, level: 4 }, { count: 2, level: 4 }], 4, true), 19 + 17);
});

test('the unmarked fight sum is what it was (count x bands x 2)', () => {
    assert.equal(memberXp([{ count: 6, level: 4 }], 4), 12);
    assert.equal(memberXp([{ count: 6, level: 4 }], 4, false), 12);
});

test('the template carries the mark, no add-xp, and no rest buttons (rest is the narrator\'s)', () => {
    const definition = STANDARD_TEMPLATES[0].definition;
    assert.equal(isMarkedCharacter(definition), true);
    assert.equal(isMarkedCharacter(characterV1For()), false);
    assert.equal(definition.kinds['add-xp'], undefined);
    assert.deepEqual(['button-rest', 'button-full-rest'].map(key => definition.kinds[key]), [undefined, undefined]);
    assert.deepEqual(Object.values(definition.kinds).filter(kind => kind.ui), []);
    assert.equal(hasRestButtons(definition), false);
    assert.ok(characterV1For().kinds['add-xp'] && characterV1For().kinds['button-rest'].title === 'Rest');
    const lines = JSON.stringify(STANDARD_TEMPLATES.map(entry => entry.definition.prompt));
    assert.equal(/add-xp|XP line|XP guide/.test(lines), false);
});

test("the owner's reply 30 line is refused on a marked pin and applied on an old one", async () => {
    const line = '+ dm character — the Inspector pays | kind: add-xp | amount: 40';
    const marked = await world();
    try {
        await say(marked, [line]);
        assert.equal(fields(marked).xp, 0);
        assert.ok(problems(marked).includes(recoveryNote.xp('Astra')), problems(marked));
        same(marked);
    } finally { marked.close(); }
    const old = await world({ old: true });
    try {
        await say(old, [line]);
        assert.equal(fields(old).xp, 40);
        assert.equal(problems(old).includes('fights only'), false);
    } finally { old.close(); }
});

test('the reader edits XP by hand on a marked character', async () => {
    const host = await world();
    try { assert.equal((await set(host, { xp: 30 })).ok, true); assert.equal(fields(host).xp, 30); } finally { host.close(); }
});

test('the story cannot raise Health, Stamina or Mana on a marked pin; lowering works; an old pin may raise', async () => {
    const host = await world();
    try {
        await set(host, { health: 4, stamina: 4, mana: 4 });
        await say(host, ['~ dm character — x | kind: set-health | to: Unhurt', '~ dm character — x | kind: set-stamina | to: Fresh', '~ dm character — x | kind: set-mana | to: Fresh']);
        assert.deepEqual([fields(host).health, fields(host).stamina, fields(host).mana], [4, 4, 4]);
        assert.ok(problems(host).includes(recoveryNote.raised('Astra', 'health')), problems(host));
        await say(host, ['~ dm character — x | kind: set-health | to: Down']);
        assert.equal(fields(host).health, 0);
        same(host);
    } finally { host.close(); }
    const old = await world({ old: true });
    try {
        await set(old, { health: 1 });
        await say(old, ['~ dm character — x | kind: set-health | to: Unhurt']);
        assert.ok(fields(old).health > 1);
    } finally { old.close(); }
});

test('rest refills Stamina and Mana; full-rest also Health; heal adds at most 3 a reply', async () => {
    const host = await world();
    try {
        const full = fields(host);
        const top = { health: full.health, stamina: full.stamina, mana: full.mana };
        await set(host, { health: 2, stamina: 1, mana: 1 });
        await say(host, ['~ dm character — a nap | kind: rest']);
        assert.deepEqual([fields(host).health, fields(host).stamina, fields(host).mana], [2, top.stamina, top.mana]);
        await say(host, ['~ dm character — a healer | kind: heal | amount: 3', '~ dm character — again | kind: heal | amount: 3']);
        assert.equal(fields(host).health, 5, 'one heal line per reply, 3 at most');
        await say(host, ['~ dm character — a bed | kind: full-rest']);
        assert.equal(fields(host).health, top.health);
        same(host);
    } finally { host.close(); }
});

test('full-rest from the story is refused under 6 story hours after the last; no clock: allowed', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — a bed | kind: full-rest']);
        const top = fields(host).health;
        assert.ok(top > 1);
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 359 })).ok, true);
        await set(host, { health: 1 });
        await sayOld(host, ['~ dm character — a bed | kind: full-rest']);
        assert.equal(fields(host).health, 1);
        assert.ok(problems(host).includes(recoveryNote.fullRest('Astra')), problems(host));
        assert.equal((await host.sdk.command('test.minute', { minute: 1000 + 360 })).ok, true);
        await say(host, ['~ dm character — a bed | kind: full-rest']);
        assert.equal(fields(host).health, top);
        same(host);
        const index = host.store.headIndex();
        assert.equal((await host.turn.reread(index)).ok, true);
        assert.equal(fields(host).health, top);
    } finally { host.close(); }
    const bare = await world();
    try {
        for (const n of [1, 2]) { await set(bare, { health: 1 }); await say(bare, ['~ dm character — a bed | kind: full-rest']); assert.ok(fields(bare).health > 1, `no clock, rest ${n}`); }
    } finally { bare.close(); }
    assert.equal(fullRestTooSoon(null, 5), false);
    assert.equal(fullRestTooSoon(100, 0), false);
});

test('the clock records negative, zero and large safe minutes and still enforces six hours', async () => {
    for (const minute of [-100, 0, 2_000_000_001]) {
        const host = await world({ clock: true, minute });
        try {
            await set(host, { health: 1 });
            await say(host, ['~ dm character — bed | kind: full-rest']);
            assert.equal(fields(host)['rested-at'], minute);
            await set(host, { health: 1 });
            await sayOld(host, ['~ dm character — bed | kind: full-rest']);
            assert.equal(fields(host).health, 1);
            assert.equal(host.turn.problems().at(-1).message, recoveryNote.fullRest('Astra'));
            same(host);
        } finally { host.close(); }
    }
});

test('deleting the time advance cannot replay a full rest less than six hours after the previous one', async () => {
    const host = await world({ clock: true });
    try {
        await set(host, { health: 1 });
        await say(host, ['~ dm character — first | kind: full-rest']);
        await set(host, { health: 1 });
        await say(host, ['! time 360']);
        const timeReply = host.store.headIndex();
        await sayOld(host, ['~ dm character — second | kind: full-rest']);
        assert.ok(fields(host).health > 1);
        await reload(host);
        await host.st.deleteMessage(timeReply);
        await host.st.deleteMessage(timeReply - 1);
        assert.equal(fields(host).health, 1);
        same(host);
        assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
        assert.equal(fields(host).health, 1);
        assert.ok(problems(host).includes(recoveryNote.fullRest('Astra')));
        await reload(host);
    } finally { host.close(); }
});

test('a marked pin with an old combat rules block cannot prompt for story XP', async () => {
    const host = await world();
    try {
        const definition = structuredClone(STANDARD_TEMPLATES.find(entry => entry.definition.role === 'rules').definition);
        definition.prompt += '\nXP guide: Other deeds 5 to 40.';
        assert.equal((await host.sdk.command('dm.redefine', { module: 'pack.chat/combat-rules', definition })).ok, true);
        assert.doesNotMatch(grammarFor(host.head()), /XP guide|Other deeds/);
        assert.doesNotMatch(grammarFor(host.head(), { rules: { skip: true, keep: /XP guide:.*$/u } }), /XP guide|Other deeds/);
    } finally { host.close(); }
});

test('a marked roll cue does not ask for XP; a saved old roll keeps its wording', () => {
    const base = { checks: [], rounds: [{ n: 1, lines: [] }], flow: 2, stop: 'won' };
    assert.match(cueOfResult(base), /write no XP line/);
    assert.doesNotMatch(cueOfResult({ ...base, noXp: true }), /XP/);
});

// A Character pinned before the buttons went (the two kinds are still in its definition): its recorded button lines replay, the sheet draws nothing.
const REFILL = bars => bars.map(bar => ({ op: 'set', path: [bar], value: ['get', [`${bar}-blocks`]] }));
test('a Character pinned with the Short rest and Full rest buttons still replays their recorded lines', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    try {
        host.features.set(CORE_FEATURE.leanRpg, true);
        await host.send('Begin.', 'Opening.');
        const pinned = structuredClone(STANDARD_TEMPLATES[0].definition);
        Object.assign(pinned.kinds, {
            'button-rest': { op: '!', ui: true, title: 'Short rest', labels: {}, effects: REFILL(['stamina', 'mana']) },
            'button-full-rest': { op: '!', ui: true, title: 'Full rest', labels: {}, effects: REFILL(['health', 'stamina', 'mana']) },
        });
        assert.equal(hasRestButtons(pinned), true, 'the block screen hides these two for such a pin');
        assert.equal((await host.sdk.command('dm.define', { definition: pinned })).ok, true);
        await set(host, { health: 1, stamina: 1, mana: 1 });
        const short = await host.sdk.command('dm.act', { module: 'pack.chat/character', kind: 'button-rest' });
        assert.equal(short.ok, true, JSON.stringify(short));
        assert.deepEqual([fields(host).health, fields(host).stamina > 1, fields(host).mana > 1], [1, true, true]);
        const fullRest = await host.sdk.command('dm.act', { module: 'pack.chat/character', kind: 'button-full-rest' });
        assert.equal(fullRest.ok, true, JSON.stringify(fullRest));
        assert.ok(fields(host).health > 1);
    } finally { host.close(); }
});

test('a damaged fight mark is refused by the guard', () => {
    const run = (predicate, recorded) => fightGuard({ state: { domains: {} }, hash: () => 'x' }, { guard: { version: 2, rulesHash: null, predicate, inputHash: 'x' }, source: {}, recorded });
    assert.equal(run({ kind: 'rpg.fight', bars: 2 }, { was: [1] }).ok, false);
    assert.equal(run({ kind: 'rpg.fight' }, { was: [1], bars: 3 }).ok, false);
});

test('a fight the story settles without the board pays no XP on the new rules; an old pin still pays', async t => {
    for (const old of [false, true]) {
        const host = await world({ old });
        t.after(() => host.close?.());
        await say(host, ['+ dm foes — rats appear | kind: set-slot-1 | name: Rats | count: 1 | level: 1']);
        const before = fields(host).xp;
        await say(host, ['~ dm foes — the rats fall | kind: hurt-1 | to: 0']);
        const receipts = host.store.receipts().map(entry => entry.receipt?.type ?? entry.type);
        assert.equal(receipts.includes('rpg.fight'), old, old ? 'the old rules pay it' : 'the new rules do not');
        if (!old) assert.equal(fields(host).xp, before);
        same(host);
    }
});
