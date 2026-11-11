// Builds the combat replay corpus from this tree (main 2.24.0): Standard-rules planner fights,
// a held planner fight that opens the board, board open/won/fled/member/pack fights, rpg.noroll
// and rpg.practice. It writes chats.json and goldens.json beside this file.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCrypto } from '../../qa/helpers/seeded.js';
import { character, foeBlock, levelFoeBlock, PARTY, setup, skillBlock } from '../../lean-rpg/helpers.js';
import { boardSession, markSend, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { dropOf } from '../../../../src/v2/lean-rpg/ambush.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { pendingStart } from '../../../../src/v2/turn/fight-start.js';
import { capture } from './corpus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const STANDARD = { rpgFormula: 'standard' };
const clone = value => JSON.parse(JSON.stringify(value));
const rollAt = (host, index) => host.ctx.chat[index].extra.storySuite.receipts.findLast(receipt => receipt.type === 'rpg.resolve');
const emptyFoeFields = () => ({ ...foeBlock([]), count1: 0, count2: 0, count3: 0, count4: 0 });
const opts = (blocks, board, settings = {}) => ({ blocks: clone(blocks), board, settings: clone(settings) });

async function take(host, rereadIndex, seed, options) {
    const chat = clone(host.ctx.chat);
    const chatMetadata = clone(host.ctx.chatMetadata ?? {});
    return { seed, ...options, chat, chatMetadata, rereadIndex };
}

async function replay(name, fixture) {
    const restore = seedCrypto(fixture.seed);
    try {
        const { host } = await setup({ blocks: clone(fixture.blocks), board: fixture.board, settings: clone(fixture.settings) });
        try {
            host.ctx.chatMetadata = clone(fixture.chatMetadata);
            await host.st.loadChat(clone(fixture.chat), `combat-corpus-${name}`);
            return await capture(host, fixture.rereadIndex);
        } finally { host.close(); }
    } finally { restore(); }
}

function openKnown(host) {
    const sid = host.store.carrierSid(host.store.headIndex());
    const opened = openBoard(host.ctx.chatMetadata, host.head(), { sid, rules: RULES });
    assert.equal(opened.error, undefined, opened.error);
    return opened.session;
}

async function plannerStandard(seed) {
    const blocks = PARTY();
    blocks.foes.fields = emptyFoeFields();
    const options = opts(blocks, false, STANDARD);
    const open = [
        'pace: normal',
        'foe Mud-Scale Crawlers | new | count: 6 | level: 5',
        'act Wessel | skill: Iron Breath | stat: STR | target: Mud-Scale Crawlers',
        'act Ren | skill: Spark | uses: mana | stat: INT | target: Mud-Scale Crawlers',
        'foe Mud-Scale Crawlers | target: Wessel | defend: AGI',
    ].join('\n');
    const follow = [
        'pace: careful',
        'act Wessel | skill: Iron Breath | stat: STR | target: Mud-Scale Crawlers',
        'act Ren | skill: Spark | uses: mana | stat: INT | target: Mud-Scale Crawlers',
        'foe Mud-Scale Crawlers | target: Ren | defend: AGI',
    ].join('\n');
    const { host } = await setup({ ...options, answers: [open, follow] });
    try {
        await host.send('Mud-scale crawlers boil out of the silt. I strike them.', 'The silt churns.');
        await host.send('I press the attack.', 'The crawlers surge.');
        return await take(host, 4, seed, options);
    } finally { host.close(); }
}

async function fightStartBoard(seed) {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 5 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'cut one foe']]) },
        foes: { role: 'foes', fields: emptyFoeFields() },
    };
    const options = opts(blocks, true);
    const answer = ['foe Cellar Rats | new | count: 1 | level: 1', 'act Astra | target: Cellar Rats | type: physical', 'foe Cellar Rats | target: Astra'].join('\n');
    const { host } = await setup({ ...options, answers: [answer] });
    try {
        const stopped = await host.send('I attack the cellar rats.', 'Not sent.');
        assert.equal(stopped.aborted, true);
        const meta = host.ctx.chatMetadata, pending = pendingStart(meta, host.ctx.chat);
        assert.equal(pending?.mode, 'new');
        const opening = host.turn.fightStartPreview();
        const open = openBoard(meta, opening.state, { sid: host.store.carrierSid(host.store.headIndex()), rules: RULES });
        assert.equal(open.error, undefined, open.error);
        Object.assign(open.session.setup, { opening: clone(pending.opening), approach: clone(opening.result.checks ?? []), drop: dropOf(opening.result) });
        pending.choice = 'board';
        const staged = stageExchange(meta, opening.state, [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined, staged.error);
        assert.equal(markSend(meta, pending, boardSession(meta)), true);
        const sent = await host.st.generate('regenerate', { reply: 'The rats break.' });
        assert.ok(sent.index >= 0);
        return await take(host, sent.index, seed, options);
    } finally { host.close(); }
}

async function fightStartHeld(seed) {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, vit: 20, health: 5 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'cut one foe']]) },
        foes: { role: 'foes', fields: emptyFoeFields() },
    };
    const options = opts(blocks, true);
    const answer = ['foe Cellar Rats | new | count: 1 | level: 1', 'act Astra | target: Cellar Rats | type: physical', 'foe Cellar Rats | target: Astra'].join('\n');
    const { host } = await setup({ ...options, answers: [answer] });
    try {
        const stopped = await host.send('I attack the cellar rats.', 'Not sent.');
        assert.equal(stopped.aborted, true);
        assert.equal(pendingStart(host.ctx.chatMetadata, host.ctx.chat)?.mode, 'new');
        return await take(host, 0, seed, options);
    } finally { host.close(); }
}

const hero = (over = {}) => ({ role: 'character', fields: character('Astra', { str: 5, agi: 20, vit: 8, health: 5, ...over }) });
const cut = (rank = 0) => ({ role: 'skills', fields: skillBlock('Astra', [['Cut', rank, 'str', 'stamina', 'cut one foe']]) });

async function boardOpen(seed) {
    const blocks = { hero: hero({ agi: 8 }), skills: cut(0), foes: { role: 'foes', fields: levelFoeBlock([['Iron Colossus', 1, 50, 7]]) } };
    const options = opts(blocks, true);
    const { host } = await setup(options);
    try {
        openKnown(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
        assert.equal(staged.error, undefined, staged.error);
        assert.equal(staged.preview.result.stop, 'open');
        await host.send('I strike the colossus.', 'The colossus stands.');
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

async function boardWon(seed) {
    const blocks = { hero: hero({ str: 20, vit: 20 }), skills: cut(3), foes: { role: 'foes', fields: levelFoeBlock([['Cellar Rat', 1, 1, 1]]) } };
    const options = opts(blocks, true);
    const { host } = await setup(options);
    try {
        openKnown(host);
        let receipt = null;
        for (let n = 0; n < 8; n += 1) {
            const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
            assert.equal(staged.error, undefined, staged.error);
            await host.send(`I attack the rat (${n + 1}).`, `The rat fights (${n + 1}).`);
            receipt = rollAt(host, host.ctx.chat.length - 1);
            if (receipt.data.v2.result.stop !== 'open') break;
        }
        assert.equal(receipt?.data?.v2?.result?.stop, 'won');
        return await take(host, host.ctx.chat.length - 1, seed, options);
    } finally { host.close(); }
}

async function boardFled(seed) {
    const blocks = { hero: hero(), skills: cut(0), foes: { role: 'foes', fields: levelFoeBlock([['Cellar Rat', 1, 1, 4]]) } };
    const options = opts(blocks, true);
    const { host } = await setup(options);
    try {
        const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
        let staged = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            delete meta.rpgFightBoard;
            meta.rpgFightAttempts = { ...(meta.rpgFightAttempts ?? {}), [sid]: attempt };
            const opened = openBoard(meta, host.head(), { sid, rules: RULES });
            assert.equal(opened.error, undefined, opened.error);
            staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'flee' }]);
            assert.equal(staged.error, undefined, staged.error);
            if (staged.preview.result.stop === 'fled') break;
        }
        assert.equal(staged?.preview?.result?.stop, 'fled');
        await host.send('I run for the door.', 'We flee.');
        assert.equal(rollAt(host, 2).data.v2.result.stop, 'fled');
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

async function boardMembers(seed) {
    const blocks = { hero: hero(), skills: cut(0), foes: { role: 'foes', fields: levelFoeBlock([['Bristle-boar', 3, 1, 4]]) } };
    const options = opts(blocks, true);
    const { host } = await setup(options);
    try {
        openKnown(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        assert.equal(staged.error, undefined, staged.error);
        assert.equal(staged.preview.result.stop, 'open');
        assert.equal(staged.preview.result.members.length, 3);
        await host.send('I strike the first boar.', 'The boars close in.');
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

async function boardPacks(seed) {
    const blocks = { hero: hero(), skills: cut(0), foes: { role: 'foes', fields: levelFoeBlock([['Reed-gnasher', 13, 1, 4]]) } };
    const options = opts(blocks, true);
    const { host } = await setup(options);
    try {
        openKnown(host);
        const staged = stageExchange(host.ctx.chatMetadata, host.head(), [{ who: 'Astra', kind: 'attack', target: 11 }]);
        assert.equal(staged.error, undefined, staged.error);
        assert.equal(staged.preview.result.stop, 'open');
        assert.deepEqual(staged.preview.result.members.map(member => member.pack), [true, true]);
        await host.send('I strike the first pack.', 'The reeds rustle.');
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

async function noroll(seed) {
    const options = opts(PARTY(), false, STANDARD);
    const { host } = await setup({ ...options, answers: [new Error('offline')] });
    try {
        await host.send('I hit the lead rat with Iron Breath, Ren covers me with Spark.', 'The rats scatter.');
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

async function practice(seed) {
    const blocks = PARTY();
    const options = opts(blocks, false, STANDARD);
    const answer = [
        'pace: normal',
        'act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats',
        'act Ren | skill: Spark | uses: mana | stat: INT | target: Sluice Rats',
        'foe Sluice Rats | target: Wessel | defend: AGI',
    ].join('\n');
    const { host } = await setup({ ...options, answers: [answer] });
    try {
        await host.send('I hit the lead rat with Iron Breath, Ren covers me with Spark.', 'The rats scatter.');
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

// A chat whose character is made on today's template, the doubled bars (the pin carries `scale: 2`): the fight is marked `bars: 2`, a skill hits for 2, an area skill costs 2.
// (The other cases keep the stage-field pins of the test helpers, which never carried the mark, so their goldens are the old rule's.)
async function boardScaled(seed) {
    const hero = { role: 'character', definition: structuredClone(STANDARD_TEMPLATES[0].definition), fields: character('Astra', { str: 20, dex: 20, vit: 5, agi: 10, int: 5, health: 10, stamina: 12, mana: 10 }) };
    const skills = { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'cut one foe'], ['Sweep', 3, 'str', 'stamina', 'sweep every foe']]) };
    const options = opts({ hero, skills, foes: { role: 'foes', fields: levelFoeBlock([['Bristle-boar', 2, 20, 6]]) } }, true);
    const { host } = await setup(options);
    try {
        openKnown(host);
        const meta = host.ctx.chatMetadata;
        assert.equal(boardSession(meta).setup.bars, 2);
        let staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'skill', skill: 'Sweep', area: true, group: 1 }]);
        assert.equal(staged.error, undefined, staged.error);
        staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'skill', skill: 'Cut', target: 11 }]);
        assert.equal(staged.error, undefined, staged.error);
        assert.equal(staged.preview.result.bars, 2);
        await host.send('I sweep the boars, then cut the nearest.', 'The boars scatter.');
        assert.equal(rollAt(host, 2).data.v2.result.bars, 2);
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

// A chat on today's template with a VIT 20 hero against a strong foe, the soak mark: the fight is marked `soak: 1`, and a hit that only just lands is soaked.
async function boardSoak(seed) {
    const hero = { role: 'character', definition: structuredClone(STANDARD_TEMPLATES[0].definition), fields: character('Astra', { str: 10, dex: 10, vit: 20, agi: 10, int: 5, health: 16, stamina: 12, mana: 10 }) };
    const skills = { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'cut one foe'], ['Shadow Step', 1, 'agi', 'stamina', 'dodge a blow']]) };
    const options = opts({ hero, skills, foes: { role: 'foes', fields: levelFoeBlock([['Cellar Brute', 1, 40, 8]]) } }, true);
    const { host } = await setup(options);
    try {
        openKnown(host);
        const meta = host.ctx.chatMetadata;
        assert.deepEqual([boardSession(meta).setup.bars, boardSession(meta).setup.soak], [2, 1]);
        for (let n = 0; n < 3; n += 1) {
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
            assert.equal(staged.error, undefined, staged.error);
        }
        await host.send('I hold the brute off.', 'The brute swings and misses.');
        const result = rollAt(host, 2).data.v2.result;
        assert.equal(result.soak, 1);
        assert.ok(result.rounds.some(round => round.lines.some(line => line.soaked)), 'a hit was soaked');
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

// A chat on today's Foes template (Health up to 15) with two lone foes: the fight is marked `foesHard: 1`, foes hit for 2 and 4 blocks and add level / 4 to their rolls.
async function boardHard(seed) {
    const hero = { role: 'character', definition: structuredClone(STANDARD_TEMPLATES[0].definition), fields: character('Astra', { str: 14, dex: 10, vit: 10, agi: 10, int: 5, health: 12, stamina: 12, mana: 10 }) };
    const skills = { role: 'skills', fields: skillBlock('Astra', [['Cut', 3, 'str', 'stamina', 'cut one foe']]) };
    const foes = { role: 'foes', definition: structuredClone(STANDARD_TEMPLATES.find(entry => entry.definition.role === 'foes').definition), fields: levelFoeBlock([['Cellar Brute', 1, 40, 13], ['Cellar Rat', 1, 8, 12]], 6) };
    const options = opts({ hero, skills, foes }, true);
    const { host } = await setup(options);
    try {
        openKnown(host);
        const meta = host.ctx.chatMetadata;
        assert.equal(boardSession(meta).setup.foesHard, 1);
        for (let n = 0; n < 3; n += 1) {
            const staged = stageExchange(meta, host.head(), [{ who: 'Astra', kind: 'attack', target: 1 }]);
            assert.equal(staged.error, undefined, staged.error);
        }
        await host.send('I hold the brute off.', 'The brute swings.');
        const result = rollAt(host, 2).data.v2.result;
        assert.equal(result.foesHard, 1);
        return await take(host, 2, seed, options);
    } finally { host.close(); }
}

const CASES = [
    ['board-fled', boardFled],
    ['board-members', boardMembers],
    ['board-open', boardOpen],
    ['board-packs', boardPacks],
    ['board-won', boardWon],
    ['noroll', noroll],
    ['planner-fight-start-board', fightStartBoard],
    ['planner-fight-start-held', fightStartHeld],
    ['planner-standard-opened', plannerStandard],
    ['practice', practice],
    ['board-scaled', boardScaled],
    ['board-soak', boardSoak],
    ['board-hard', boardHard],
];

// (`ONLY=board-scaled node make.mjs`: builds just the named cases and merges them into the files, leaving every other chat and golden as it is)
const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
const read = file => (only.length ? JSON.parse(readFileSync(join(HERE, file), 'utf8')) : {});
const chats = read('chats.json'), goldens = read('goldens.json');
for (const [name, build] of CASES) {
    if (only.length && !only.includes(name)) continue;
    const index = CASES.findIndex(entry => entry[0] === name);
    const restore = seedCrypto(900 + index);
    try {
        chats[name] = await build(901 + index);
    } finally { restore(); }
}
for (const [name] of CASES.filter(([name]) => !only.length || only.includes(name))) {
    goldens[name] = await replay(name, chats[name]);
    console.log(`${name}: ${chats[name].chat.length} messages, replay ok, ${goldens[name].cues.length} cue(s)`);
}
writeFileSync(join(HERE, 'chats.json'), `${JSON.stringify(Object.fromEntries(Object.entries(chats).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2)}\n`);
writeFileSync(join(HERE, 'goldens.json'), `${JSON.stringify(Object.fromEntries(Object.entries(goldens).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2)}\n`);
