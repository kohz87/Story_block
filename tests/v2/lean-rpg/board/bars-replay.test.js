// A fight on the doubled bars (a pin with `scale: 2`) replays as it was played: live = rebuild = Re-read = reload = after the middle of the chat is deleted,
// across seeded random fights (a plain attack, a skill, an area skill, one to three exchanges), and its record carries the mark. A fight on an old pin carries none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { STANDARD_TEMPLATES, characterV1For } from '../../../../src/v2/lean-rpg/templates.js';
import { openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { prng, seedCrypto } from '../../qa/helpers/seeded.js';
import { character, levelFoeBlock, rollReceipt, setup, skillBlock } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const SKILLS = [['Cut', 3, 'str', 'stamina', 'cut one foe'], ['Sweep', 3, 'str', 'stamina', 'sweep every foe'], ['Spark', 2, 'int', 'mana', 'a bolt at one foe']];
const blocks = definition => ({
    hero: { role: 'character', definition: structuredClone(definition), fields: character('Astra', { str: 14, dex: 10, vit: 5, agi: 10, int: 10, ...(definition === STANDARD_TEMPLATES[0].definition ? { health: 10, stamina: 12, mana: 12 } : { health: 5, stamina: 5, mana: 5 }) }) },
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
