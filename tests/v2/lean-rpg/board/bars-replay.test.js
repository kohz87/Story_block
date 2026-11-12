// A fight on the doubled bars (a pin with `scale: 2`) replays as it was played: live = rebuild = Re-read = reload = after the middle of the chat is deleted,
// across seeded random fights (a plain attack, a skill, an area skill, one to three exchanges), and its record carries the mark. A fight on an old pin carries none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../../src/v2/lean-rpg/templates.js';
import { openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { runAuto } from '../../../../src/v2/lean-rpg/board/auto-run.js';
import { readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { pendingStart } from '../../../../src/v2/turn/fight-start.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { prng, seedCrypto } from '../../qa/helpers/seeded.js';
import { clearFoes } from '../../../../src/v2/lean-rpg/board/engine.js';
import { character, levelFoeBlock, rollReceipt, setup, sheetDomain, skillBlock } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const SKILLS = [['Cut', 3, 'str', 'stamina', 'cut one foe'], ['Sweep', 3, 'str', 'stamina', 'sweep every foe'], ['Spark', 2, 'int', 'mana', 'a bolt at one foe']];
// The stock Character as a made hero holds it: every field of the template at its default (the hidden bar sizes, Level, the cap), then what the test sets. The shared `character()` helper adds `soul`, which the stock block has no field for.
const stock = (who, over) => ({ ...Object.fromEntries(Object.entries(STANDARD_TEMPLATES[0].definition.state).filter(([, schema]) => 'default' in schema).map(([key, schema]) => [key, schema.default])), who, ...over });
const blocks = definition => ({
    hero: { role: 'character', definition: structuredClone(definition), fields: (definition === STANDARD_TEMPLATES[0].definition ? stock : character)('Astra', { str: 14, dex: 10, vit: 5, agi: 10, int: 10, ...(definition === STANDARD_TEMPLATES[0].definition ? { health: 10, stamina: 12, mana: 12, 'health-blocks': 10, 'stamina-blocks': 12, 'mana-blocks': 12 } : { health: 5, stamina: 5, mana: 5 }) }) },
    skills: { role: 'skills', fields: skillBlock('Astra', SKILLS) },
    foes: { role: 'foes', fields: levelFoeBlock([['Bristle-boar', 3, 30, 5], ['Rat', 1, 1, 4]]) },
});
const sheetOf = host => JSON.stringify(host.head().domains.dataModules.instances);

function open(host) {
    const opened = openBoard(host.ctx.chatMetadata, host.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules: RULES });
    assert.equal(opened.error, undefined, opened.error);
    return opened.session;
}

async function play(seed, definition) {
    const restore = seedCrypto(seed), random = prng(seed);
    const { host } = await setup({ blocks: blocks(definition), board: true });
    try {
        await host.send('Older.', 'An older reply.');
        const meta = host.ctx.chatMetadata, session = open(host);
        const choices = [{ kind: 'attack', target: 11 }, { kind: 'skill', skill: 'Cut', target: 11 }, { kind: 'skill', skill: 'Spark', target: 21 }, { kind: 'skill', skill: 'Sweep', area: true, group: 1 }];
        for (let n = random.int(1, 3); n > 0; n -= 1) {
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', ...random.pick(choices) }]);
            // (a refusal is a choice the sheet cannot pay or a fight already over: the fight goes on with what is staged)
            if (staged.error || staged.preview.result.stop !== 'open') break;
        }
        await host.send('Strike.', 'The fight.');
        const at = host.ctx.chat.length - 1, record = rollReceipt(host, at).data.v2.result;
        const live = JSON.stringify(host.head()), sheet = sheetOf(host);
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, `seed ${seed}: rebuild`);
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.equal(sheetOf(host), sheet, `seed ${seed}: Re-read`);
        await host.store.flush();
        const saved = structuredClone(host.st.saves.at(-1)), savedMeta = structuredClone(meta);
        await host.st.loadChat(saved, `bars-${seed}`);
        host.ctx.chatMetadata = savedMeta;
        assert.equal(sheetOf(host), sheet, `seed ${seed}: reload`);
        await host.st.deleteMessage(2);
        await host.st.deleteMessage(1);
        assert.equal(sheetOf(host), sheet, `seed ${seed}: the older pair deleted`);
        assert.deepEqual(rollReceipt(host, 2).data.v2.result.rounds, record.rounds, `seed ${seed}: the rounds are the ones played`);
        return { record, session };
    } finally { host.close(); restore(); }
}

test('fights on the doubled bars replay equal to live over seeded random plays, and carry the mark', async () => {
    const costs = new Set(), hits = new Set();
    for (const seed of [301, 302, 303, 304, 305, 306, 307, 308]) {
        const { record, session } = await play(seed, STANDARD_TEMPLATES[0].definition);
        assert.equal(session.setup.bars, 2);
        assert.equal(record.bars, 2, 'the result carries the mark');
        for (const round of record.rounds) for (const line of round.lines) {
            if (line.cost) costs.add(`${line.area ? 'area' : 'one'}:${line.cost.blocks}`);
            if (line.damage && line.kind === 'act') hits.add(`${line.skill ? 'skill' : 'plain'}:${line.decisive ? 'decisive' : 'plain'}:${line.area ? 'area' : 'one'}`);
        }
    }
    for (const cost of costs) assert.match(cost, /^(area:2|one:1)$/, 'an area skill costs 2, a single-target one 1');
    assert.ok(costs.size >= 1 && hits.size >= 2, `the seeds covered costs ${[...costs]} and hits ${[...hits]}`);
});

test('fights on an old pin replay as before and carry no mark at all', async () => {
    for (const seed of [311, 312, 313]) {
        const { record, session } = await play(seed, characterV1For());
        assert.equal(Object.hasOwn(session.setup, 'bars'), false);
        assert.equal(JSON.stringify(record).includes('"bars"'), false);
    }
});

test('a marked Auto heal stages, tells the heal and survives rebuild, Re-read and reload', async () => {
    const restore = seedCrypto(921);
    const setupBlocks = blocks(STANDARD_TEMPLATES[0].definition);
    setupBlocks.hero.fields.health = 4;
    setupBlocks.skills.fields = skillBlock('Astra', [['Mend', 3, 'int', 'mana', 'heal an ally']]);
    const { host } = await setup({ blocks: setupBlocks, board: true });
    try {
        const meta = host.ctx.chatMetadata;
        open(host);
        const played = runAuto({ meta, state: host.head(), rules: RULES, cap: 1 });
        assert.equal(played.done, 1, played.error);
        await host.send('Heal.', 'A spell is cast.');
        const at = host.ctx.chat.length - 1, receipt = rollReceipt(host, at), record = receipt.data.v2.result;
        assert.ok(record.rounds[0].lines.some(line => line.support && line.skill === 'Mend'));
        assert.equal(readResolve(record, { summary: receipt.summary }).receipt, receipt.summary, 'the receipt is the exact settled board note');
        const live = sheetOf(host);
        host.store.rebuild();
        assert.equal(sheetOf(host), live);
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.equal(sheetOf(host), live);
        await host.store.flush();
        await host.st.loadChat(structuredClone(host.st.saves.at(-1)), 'heal-replay');
        assert.equal(sheetOf(host), live);
    } finally { host.close(); restore(); }
});

// The foe-clear mark: a board fight that ended (won, lost or fled) clears its groups from the Foes block as part of its recorded result.
const RAIDER = JSON.stringify({ groups: [{ name: 'Raider', count: 1 }] });
const standing = host => readSheet(host.head()).foes.filter(foe => foe.filled);
async function endFight(seed, how, { clear = true, health = 10, after = null } = {}) {
    const restore = seedCrypto(seed), parts = blocks(STANDARD_TEMPLATES[0].definition);
    parts.hero.fields.health = health;
    parts.foes.fields = levelFoeBlock([['Raider', 1, how === 'lost' ? 30 : 1, 12]]);
    const { host, callModel } = await setup({ blocks: parts, board: true, ...(after ? { planner: false, precheck: true, answers: [RAIDER] } : {}) });
    try {
        const meta = host.ctx.chatMetadata, opened = openBoard(meta, host.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules: RULES }), session = opened.session;
        if (!clear) delete session.setup.foesClear;
        const pick = how === 'fled' ? { kind: 'flee' } : { kind: 'attack', target: opened.preview.result.members[0].slot };
        let stop = 'open';
        for (let n = 0; n < 12 && stop === 'open'; n += 1) {
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', ...pick }]);
            if (staged.error) break;
            stop = staged.preview.result.stop;
        }
        if (stop !== how) return null;
        await host.send('Strike.', 'The fight.');
        const at = host.ctx.chat.length - 1, record = rollReceipt(host, at).data.v2.result, live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, `${how} ${seed}: replay equals live`);
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.equal(JSON.stringify(host.head()), live, `${how} ${seed}: Re-read equals live`);
        return { record, left: standing(host), sheet: readSheet(host.head()), after: after ? await after(host, callModel) : null };
    } finally { host.close(); restore(); }
}
async function found(how, options) {
    for (let seed = 400; seed < 460; seed += 1) { const out = await endFight(seed, how, options); if (out) return out; }
    assert.fail(`no seed ended ${how}`);
}

test('a won, lost or fled board fight clears its foes in its recorded result; replay equals live', async () => {
    for (const how of ['won', 'lost', 'fled']) {
        const { record, left } = await found(how, how === 'lost' ? { health: 1 } : {});
        assert.equal(record.stop, how);
        assert.deepEqual(record.cleared, [1], `${how}: the result names the slot it cleared`);
        assert.equal(left.length, 0, `${how}: no foe stands on`);
    }
});

test('a fight opened without the mark (an old chat) keeps its foes, and records no clear', async () => {
    const { record, left } = await found('lost', { health: 1, clear: false });
    assert.equal(Object.hasOwn(record, 'cleared'), false);
    assert.ok(left.length > 0);
});

test('after a lost fight a typed attack on a new foe goes through createPrecall: the pre-check runs and a new fight is held for the board', async () => {
    const { left, after } = await found('lost', { health: 1, after: async (host, callModel) => {
        const stopped = await host.send('A second lone raider steps out. I attack.', 'Not sent.');
        const pending = pendingStart(host.ctx.chatMetadata, host.ctx.chat);
        return { aborted: stopped.aborted, helpers: callModel.calls.map(call => call.options.helper), mode: pending?.mode, opened: pending?.result?.opened?.map(entry => entry.name) };
    } });
    assert.equal(left.length, 0);
    assert.equal(after.aborted, true, 'the send is held');
    assert.deepEqual(after.helpers, ['precheck']);
    assert.equal(after.mode, 'new');
    assert.deepEqual(after.opened, ['Raider']);
});

test('the foe clear runs the Foes block\'s own rules after its clear kind, as the stale-Down clear does', () => {
    const base = STANDARD_TEMPLATES[2].definition, definition = structuredClone(base);
    definition.state.tally = { type: 'int', min: 0, max: 99, default: 0, label: 'Tally' };
    definition.rules = [...(definition.rules ?? []), { id: 'tally', when: ['eq', ['get', ['count1']], 0], then: [{ op: 'set', path: ['tally'], value: 7 }] }];
    const domain = sheetDomain({ foes: { role: 'foes', definition, fields: { ...Object.fromEntries(Object.entries(definition.state).map(([key, schema]) => [key, schema.default])), foe1: 'Raider', count1: 2, level1: 1, hurt1: 5 } } });
    assert.deepEqual(clearFoes(domain, readSheet({ domains: { dataModules: domain } }).foes, [1]), [1]);
    const fields = domain.instances['pack.chat/foes'].chat.fields;
    assert.equal(fields.count1, 0);
    assert.equal(fields.foe1, '');
    assert.equal(fields.tally, 7, 'the rule ran');
});
