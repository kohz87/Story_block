// The Fight tab board is exercised on the test host and its mounted page.
// It covers final exchanges, target selection, awards, rules gating and in-page discard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAN_RPG_TEMPLATES, STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { STAGES, stageWord } from '../../../../src/v2/lean-rpg/names.js';
import { usesOf } from '../../../../src/v2/lean-rpg/practice.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { pendingAwards } from '../../../../src/v2/lean-rpg/board/view-data.js';
import { createBoardView } from '../../../../src/v2/lean-rpg/board/view.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { character, levelFoeBlock, setup, sheetDomain, skillBlock } from '../helpers.js';
import { page, begin, makeBlocks, settle } from '../view/page.js';
import { planGear } from '../../../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { aiMessage } from '../../../../testkit/fake-st.js';

const BOARD_CSS = readFileSync(new URL('../../../../src/v2/lean-rpg/board/board.css', import.meta.url), 'utf8');

async function defineFoes(host, entries) {
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    entries.forEach(([name, count, level, hurt], at) => {
        Object.assign(foes.state[`foe${at + 1}`], { default: name });
        Object.assign(foes.state[`count${at + 1}`], { default: count });
        Object.assign(foes.state[`level${at + 1}`], { default: level });
        Object.assign(foes.state[`hurt${at + 1}`], { default: hurt });
    });
    const defined = await host.sdk.command('dm.define', { definition: foes });
    assert.equal(defined.ok, true, defined.message);
}

function renderMembers(t, { doc, host, members, order }) {
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    assert.equal(openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } }).error, undefined);
    const board = createBoardView({ doc, headState: () => host.head(), meta: () => meta, store: host.store,
        rules: () => ({ ...STANDARD_FORMULA, levelDivisor: 5 }), query: (name, args) => host.sdk.query(name, args),
        readerName: () => 'Wessel', levels: () => ({ ranks: [], playerRank: null }), on: () => true });
    const root = doc.createElement('div');
    let handles = [];
    doc.body.appendChild(root);
    const snapshot = { session: boardSession(meta), played: { state: host.head(), result: { members, order, rounds: [], opening: [], quickStart: [],
        idle: [], hurts: [], refused: [], stop: 'open' } }, heldSid: null };
    const draw = () => {
        for (const handle of handles) handle.destroy?.();
        handles = [];
        root.replaceChildren();
        board.render(root, snapshot, draw, handles, {});
    };
    draw();
    t.after(() => { for (const handle of handles) handle.destroy?.(); board.destroy(); });
    return root;
}

async function showStop(t, { character = {}, skills = {}, settings = {}, foes, action, stop }) {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    for (const [key, value] of Object.entries(settings)) host.settings.set('story-block', key, value);
    await begin(host);
    await makeBlocks(host, { character, skills });
    await defineFoes(host, foes);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
    let result = null;
    for (let attempt = 0; attempt < 100 && result?.stop !== stop; attempt += 1) {
        if (boardSession(meta)) discardBoard(meta);
        assert.equal(openBoard(meta, host.head(), { sid, rules }).error, undefined);
        const staged = stageExchange(meta, host.head(), action);
        assert.equal(staged.error, undefined, staged.error);
        result = staged.preview.result;
    }
    assert.equal(result?.stop, stop, `the seeded exchanges reach a ${stop} fight`);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    return { doc, result };
}

test('the board selects a target, keeps its exchange final and confirms discard', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { skills: { skill1: 'Shadow Cut', about1: 'sweep every foe', uses1: 'mana' }, character: { mana: 0 } });
    await defineFoes(host, [['Rats', 2, 1, 5], ['Spiders', 1, 1, 5]]);
    await settle();
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.ok(fight().querySelector('.rpg-board-open'));
    fight().querySelector('.rpg-board-open').click();
    assert.ok(fight().querySelector('.rpg-board-log'));
    const blocked = fight().querySelectorAll('.rpg-board-choice').find(node => node.textContent.includes('Shadow Cut'));
    assert.equal(blocked.disabled, true);
    assert.match(blocked.textContent, /Mana is Empty/);
    doc.key('1');
    assert.match(fight().textContent, /Choose a target/);
    const targets = [...fight().querySelectorAll('.rpg-board-choice')].map(node => node.textContent);
    assert.ok(targets.some(text => /Rats \(Lv 1, /.test(text)), 'the target line names the foe, level and bar');
    assert.ok(targets.some(text => /Spiders \(Lv 1, /.test(text)), 'every standing foe has a target line');
    const escape = { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {} };
    doc.listeners.find(entry => entry.fn.name === 'keydown' && entry.capture).fn(escape);
    assert.match(fight().textContent, /choose an action/);
    fight().querySelector('[data-choice="1"]').click();
    fight().querySelector('[data-choice="2"]').click();
    assert.match(fight().querySelector('.rpg-board-log').textContent, /Exchange 1/);
    assert.equal(fight().querySelector('.rpg-board-undo'), null);
    assert.equal(boardSession(host.ctx.chatMetadata).exchanges.length, 1);
    fight().querySelector('.rpg-board-discard').click();
    assert.match(fight().textContent, /Discard this fight/);
    fight().querySelectorAll('.ss-button').find(node => node.textContent === 'Cancel').click();
    assert.equal(boardSession(host.ctx.chatMetadata).exchanges.length, 1);
    fight().querySelector('.rpg-board-discard').click();
    fight().querySelector('.rpg-board-confirm').click();
    assert.ok(fight().querySelector('.rpg-board-open'));
});

test('the board ends on a won card', async t => {
    const { doc, result } = await showStop(t, {
        character: { str: 20, agi: 20 }, foes: [['Rats', 1, 1, 1]],
        action: [{ who: 'Wessel', kind: 'attack', target: 1 }], stop: 'won',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'won');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight won/);
    assert.match(fight.textContent, /Your next message carries this fight/);
    assert.match(fight.querySelector('.rpg-board-awards').textContent, /Pending XP: Wessel \+\d+ XP\. Pending practice: none/);
    assert.ok(fight.querySelector('.rpg-board-note'));
});

test('the board ends on a lost card', async t => {
    const { doc, result } = await showStop(t, {
        character: { str: 3, agi: 3, vit: 3, health: 1 }, foes: [['Rats', 12, 99, 5]],
        action: [{ who: 'Wessel', kind: 'attack', target: 1 }], stop: 'lost',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'lost');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight lost/);
});

test('the board ends on a fled card', async t => {
    const { doc, result } = await showStop(t, {
        character: { agi: 20 }, foes: [['Rats', 1, 1, 5]],
        action: [{ who: 'Wessel', kind: 'flee' }], stop: 'fled',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'fled');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight fled/);
});

test('the end card uses the current XP rate and practice setting', async t => {
    const { doc, result } = await showStop(t, {
        character: { str: 20, agi: 20 }, skills: { skill1: 'Cut', about1: 'strike a foe', stat1: 'str', uses1: 'stamina' },
        settings: { rpgXpRate: 200, rpgPracticePerUse: 5 }, foes: [['Rats', 1, 1, 1]],
        action: [{ who: 'Wessel', kind: 'skill', skill: 'Cut', target: 1 }], stop: 'won',
    });
    const awards = doc.querySelector('.rpg-board-awards').textContent;
    assert.match(awards, /Wessel \+4 XP/);
    const uses = usesOf(result).find(item => item.skill === 'Cut').n;
    assert.ok(awards.includes(`Wessel: Cut +${Math.min(20, uses * 5)}`));
});

for (const outcome of ['success', 'fail']) test(`the log labels a defence ${outcome} and uses words for bars`, async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Rats', 3, 3, 5]]);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    let result, defence;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        result = stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 1 }]).preview?.result;
        defence = result?.rounds.flatMap(round => round.lines).find(line => line.kind === 'foe' && line.outcome === outcome);
        if (defence) break;
        discardBoard(meta);
    }
    assert.ok(defence);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const log = doc.querySelector('.rpg-board-log').textContent;
    assert.match(log, new RegExp(`Rats attacks Wessel.*Wessel's defence: ${outcome.toUpperCase()}`));
    assert.match(log, /d20 \d+ [+-]\d+ = \d+ vs \d+/);
    assert.doesNotMatch(log, /(?:health|mana|stamina)\s+\d+\s*→\s*\d+/i);
    if (defence.damage) assert.ok(log.includes(`Wessel health ${stageWord(STAGES.health, defence.damage.from, defence.damage.size)} → ${stageWord(STAGES.health, defence.damage.to, defence.damage.size)}`));
    assert.doesNotMatch(doc.querySelector('.rpg-board-status').textContent, /\d+ of \d+/);
});

test('Standard block bars show words without counts on the board', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    for (const role of ['character', 'foes']) {
        const definition = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === role).definition);
        if (role === 'character') Object.assign(definition.state.who, { default: 'Wessel' });
        else for (const [key, value] of Object.entries({ foe1: 'Rats', count1: 1, level1: 1, hurt1: 2 })) definition.state[key].default = value;
        const made = await host.sdk.command('dm.define', { definition });
        assert.equal(made.ok, true, made.message);
    }
    const sid = host.store.carrierSid(host.store.headIndex());
    assert.equal(openBoard(host.ctx.chatMetadata, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } }).error, undefined);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const status = doc.querySelector('.rpg-board-status').textContent;
    assert.match(status, /Unhurt|Hurt|Wounded|Fresh/);
    assert.doesNotMatch(status, /\d+\s+of\s+\d+/);
});

test('a replacement choice stays locked after a roll, then accepts a later action', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { character: { vit: 20 } });
    await defineFoes(host, [['Rats', 12, 3, 5]]);
    const meta = host.ctx.chatMetadata, state = host.head(), sid = host.store.carrierSid(host.store.headIndex());
    const action = [{ who: 'Wessel', kind: 'attack', target: 1 }];
    let found = false;
    for (let n = 0; n < 100; n += 1) {
        openBoard(meta, state, { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const played = playBoard(state, boardSession(meta).setup, [{ actions: action }, { actions: action }]);
        if (!played.error && played.result.stop === 'open') { found = true; break; }
        discardBoard(meta);
    }
    assert.ok(found);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    fight().querySelector('[data-choice="1"]').click();
    assert.equal(boardSession(meta).exchanges.length, 1);
    const replacement = fight().querySelector('[data-choice="1"]');
    assert.equal(replacement.disabled, true);
    replacement.click();
    assert.equal(boardSession(meta).exchanges.length, 1);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(replacement.disabled, false);
    replacement.click();
    assert.equal(boardSession(meta).exchanges.length, 2);
});

test('a refused exchange keeps its reason on the board after the redraw', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { character: { vit: 20 } });
    await defineFoes(host, [['Rats', 12, 3, 5]]);
    const meta = host.ctx.chatMetadata, state = host.head(), sid = host.store.carrierSid(host.store.headIndex());
    const action = [{ who: 'Wessel', kind: 'attack', target: 1 }];
    let found = false;
    for (let n = 0; n < 100; n += 1) {
        openBoard(meta, state, { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        const played = playBoard(state, boardSession(meta).setup, [{ actions: action }, { actions: action }]);
        if (!played.error && played.result.stop === 'open') { found = true; break; }
        discardBoard(meta);
    }
    assert.ok(found);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    fight().querySelector('[data-choice="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 500));
    boardSession(meta).setup.witness.offset += 1;
    fight().querySelector('[data-choice="1"]').click();
    assert.match(fight().querySelector('.rpg-board-error')?.textContent ?? '', /cannot be checked/, 'the reason survives the redraw');
});

test('Classic offers no board and the normal planner still runs', async t => {
    const { doc, host, ui } = await page(t, { formula: 'classic' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Rats', 1, 1, 5]]);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    assert.equal(doc.querySelector('.rpg-board-open'), null);
    assert.equal(doc.querySelector('.rpg-board-log'), null);
    const ordinary = await setup({ board: true, settings: { rpgFormula: 'classic' }, blocks: {
        hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: levelFoeBlock([['Rats', 1, 1, 5]]) },
    } });
    try {
        await ordinary.host.send('I strike.', 'A clash.');
        assert.equal(ordinary.callModel.calls.length, 1);
        assert.equal(boardSession(ordinary.host.ctx.chatMetadata), null);
    } finally { ordinary.host.close(); }
});

test('the board checks current and saved rules, including a stale offer', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Rats', 1, 1, 5]]);
    const meta = host.ctx.chatMetadata, standard = { ...STANDARD_FORMULA, levelDivisor: 5 }, classic = { ...standard, formula: 'classic' };
    let current = standard;
    const board = createBoardView({ doc, headState: () => host.head(), meta: () => meta, store: host.store, rules: () => current,
        query: (name, args) => host.sdk.query(name, args), readerName: () => 'Wessel', levels: () => ({}), on: () => true });
    t.after(() => board.destroy());
    const holder = doc.createElement('div');
    board.offer(holder, () => {});
    current = classic;
    holder.querySelector('.rpg-board-open').click();
    assert.equal(boardSession(meta), null, 'a stale offer cannot open under Classic');
    current = standard;
    assert.equal(openBoard(meta, host.head(), { sid: host.store.carrierSid(host.store.headIndex()), rules: standard }).error, undefined);
    assert.ok(board.snapshot(host.head()));
    current = classic;
    assert.match(board.snapshot(host.head()).played.error, /Standard.*discard/i, 'a staged fight remains accessible under Classic');
    current = standard;
    boardSession(meta).setup.rules = classic;
    assert.match(board.snapshot(host.head()).played.error, /setup is damaged/i, 'an unsupported saved session can be discarded');
});

test('a staged fight remains discardable when its opening reply no longer matches', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Rats', 3, 3, 5]]);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
    stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 1 }]);
    boardSession(meta).anchor = 'missing-reply';
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.match(fight().textContent, /no longer matches.*restore.*discard/i);
    fight().querySelector('.rpg-board-discard').click();
    fight().querySelector('.rpg-board-confirm').click();
    assert.equal(boardSession(meta), null);
});

test('a changed sheet leaves discard and its confirmation on the board', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { character: { str: 10 } });
    await defineFoes(host, [['Rats', 3, 3, 5]]);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
    assert.equal(stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 1 }]).error, undefined);
    assert.equal((await host.sdk.command('dm.set', { module: blocks.character, field: 'str', value: 12 })).ok, true);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.match(fight().textContent, /sheet or gear changed.*restore.*discard/i);
    fight().querySelector('.rpg-board-discard').click();
    assert.match(fight().textContent, /Discard this fight/);
    fight().querySelector('.rpg-board-confirm').click();
    assert.equal(boardSession(meta), null);
});

test('the reloaded board explains a held reply and lets the reader discard it', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { character: { str: 10 } });
    await defineFoes(host, [['Rats', 3, 3, 5]]);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
    stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 1 }]);
    host.st.addUser('I strike.');
    await host.turn.interceptor([], 8192, () => assert.fail('the fight should preflight'), 'normal');
    const edit = host.bus.run('dm.set', { module: blocks.character, field: 'str', value: 12 }, { cause: 'ui' });
    assert.equal(edit.ok, true, edit.message);
    host.store.append({ ops: edit.ops, receipt: edit.receipt, ...(edit.block ? { block: edit.block } : {}) });
    await host.store.flush();
    assert.equal(host.head().domains.dataModules.instances[blocks.character].chat.fields.str, 12);
    const index = host.st.addMessage(aiMessage('The fight continues.'));
    assert.equal(await host.turn.onMessageReceived(index), null);
    await host.store.flush();
    const chat = structuredClone(host.st.saves.at(-1));
    host.ctx.chatMetadata = structuredClone(meta);
    await host.st.loadChat(chat, 'held-board-view');
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.match(fight().textContent, /waiting.*restore.*discard.*regenerate/i);
    fight().querySelector('.rpg-board-discard').click();
    fight().querySelector('.rpg-board-confirm').click();
    assert.equal(boardSession(host.ctx.chatMetadata), null);
    assert.equal(host.ctx.chatMetadata.rpgFightHeldDiscarded[host.store.carrierSid(index)], true);
    assert.match(fight().textContent, /discarded.*regenerate/i);
    assert.equal((await host.turn.reread(index)).ok, false);
});

test('the next attack choice loses a weapon that broke in the staged exchange', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    host.features.set('story-block.gear', true);
    await begin(host);
    await makeBlocks(host, { character: { str: 3, dex: 12, agi: 10, vit: 20 } });
    await defineFoes(host, [['Rats', 6, 60, 5]]);
    await host.send('Equip.', 'Ready.\n<Changes>\n+ item Cane Sword | kind: weapon | rarity: rare | DEX: +2 | equipped: weapon\n</Changes>');
    assert.equal(host.bus.command('gear.wear', { owner: 'party', slot: 'weapon', steps: 2 }, { cause: 'system' }).ok, true);
    const meta = host.ctx.chatMetadata, state = host.head(), sid = host.store.carrierSid(host.store.headIndex());
    const query = (name, args) => host.sdk.query(name, args);
    const gear = planGear(readSheet(state), query), weapon = query('inventory.gear', { owner: 'party' }).slots.weapon;
    let result = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        openBoard(meta, state, { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 }, gear, weapons: { wessel: weapon } });
        const staged = stageExchange(meta, state, [{ who: 'Wessel', kind: 'attack', target: 1 }]);
        if (staged.preview?.result.stop === 'open' && staged.preview.result.wear?.some(event => event.to === 'broken')) { result = staged; break; }
        discardBoard(meta);
    }
    assert.ok(result, 'found a staged weapon break');
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const choice = doc.querySelector('[data-ss-screen="story-block/fight"]').querySelector('[data-choice="1"]');
    assert.match(choice.textContent, /Attack \(STR\)/);
    assert.doesNotMatch(choice.textContent, /Cane Sword/);
});

test('member cards, target lines and the grouped order line come from the staged members', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Bristle-boar', 3, 1, 5]]);
    const members = [
        { slot: 11, group: 1, n: 1, name: 'Bristle-boar 1', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
        { slot: 12, group: 1, n: 2, name: 'Bristle-boar 2', value: 0, size: 4, pack: false, count: 1, left: 0, attacks: 0, standing: false },
        { slot: 13, group: 1, n: 3, name: 'Bristle-boar 3', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
    ];
    const root = renderMembers(t, { doc, host, members, order: [{ id: 'c:wessel', name: 'Wessel', party: true },
        { id: 'f:11', name: 'Bristle-boar 1', party: false }, { id: 'f:12', name: 'Bristle-boar 2', party: false },
        { id: 'f:13', name: 'Bristle-boar 3', party: false }] });
    const cards = [...root.querySelectorAll('.rpg-board-cards .rpg-foe')];
    assert.deepEqual(cards.map(card => card.querySelector('.rpg-foe-top .rpg-name').textContent), ['Bristle-boar 1', 'Bristle-boar 2', 'Bristle-boar 3']);
    assert.equal(cards[1].classList.contains('rpg-down'), true, 'the Down member is greyed with the existing class');
    assert.ok(cards.every(card => card.querySelector('.rpg-foe-side .rpg-level-pill')));
    assert.ok(cards.every(card => card.querySelector('.rpg-foe-bar .ss-w-meter')), 'the Fight tab foe-card meter is reused');
    assert.equal(root.querySelector('.rpg-board-order').textContent, 'Order: Wessel · Bristle-boars (1, 3) · 2 attacks on you each exchange');
    root.querySelector('[data-choice="1"]').click();
    assert.equal(root.querySelector('.rpg-board-prompt').textContent, 'Choose a target');
    assert.deepEqual([...root.querySelectorAll('.rpg-board-choices .rpg-board-choice')].map(node => node.textContent),
        ['1. Bristle-boar 1  Unhurt', '2. Bristle-boar 3  Unhurt'], 'Down members are not targetable');
});

test('a pack card wears the pack pill, its thinning line, and stays a single target', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Cellar-rats', 12, 1, 5]]);
    const pack = { slot: 11, group: 1, n: 1, name: 'Cellar-rats', value: 5, size: 8, pack: true, count: 12, left: 8, attacks: 2, standing: true };
    const root = renderMembers(t, { doc, host, members: [pack], order: [{ id: 'c:wessel', name: 'Wessel', party: true }, { id: 'f:11', name: 'Cellar-rats', party: false }] });
    const card = root.querySelector('.rpg-foe[data-foe="Cellar-rats"]');
    assert.ok(card.classList.contains('rpg-foe-pack'));
    assert.equal(card.querySelector('.rpg-pack-pill').textContent, 'pack');
    assert.equal(card.querySelector('.rpg-pack-line').textContent, 'About 8 left · 2 attacks each exchange');
    assert.equal(root.querySelector('.rpg-board-order').textContent, 'Order: Wessel · Cellar-rats · 2 attacks on you each exchange');
    assert.match(BOARD_CSS, /\.rpg-board-cards \.rpg-foe-pack \{ grid-column: 1 \/ -1; \}/u);
});

test('an area skill asks for a standing group only when more than one group stands', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { skills: { skill1: 'Shadow Cut', about1: 'sweep every foe', uses1: 'mana' } });
    await defineFoes(host, [['Bristle-boar', 3, 1, 5], ['Spiders', 2, 1, 5], ['Worms', 2, 1, 5]]);
    const members = [
        { slot: 11, group: 1, n: 1, name: 'Bristle-boar 1', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
        { slot: 12, group: 1, n: 2, name: 'Bristle-boar 2', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
        { slot: 13, group: 1, n: 3, name: 'Bristle-boar 3', value: 0, size: 4, pack: false, count: 1, left: 0, attacks: 0, standing: false },
        { slot: 21, group: 2, n: 1, name: 'Spiders', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
        { slot: 31, group: 3, n: 1, name: 'Worms', value: 0, size: 4, pack: false, count: 1, left: 0, attacks: 0, standing: false },
    ];
    const root = renderMembers(t, { doc, host, members, order: [{ id: 'c:wessel', name: 'Wessel', party: true },
        { id: 'f:11', party: false }, { id: 'f:12', party: false }, { id: 'f:21', party: false }] });
    const area = [...root.querySelectorAll('.rpg-board-choice')].find(node => node.textContent.includes('Shadow Cut'));
    assert.match(area.textContent, /— one group$/u);
    area.click();
    assert.equal(root.querySelector('.rpg-board-prompt').textContent, 'Choose a group');
    assert.deepEqual([...root.querySelectorAll('.rpg-board-choices .rpg-board-choice')].map(node => node.textContent), ['1. Bristle-boars', '2. Spiders']);
    assert.ok([...root.querySelectorAll('.rpg-board-choices .rpg-board-choice')].every(node => node.classList.contains('rpg-board-choice')), 'groups use the 48px choice buttons');
    assert.match(BOARD_CSS, /\.rpg-board-members \.rpg-board-controls button \{ min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important; \}/u);
});

test('pending awards use opening groups, settings and the per-reply practice cap', () => {
    const state = { domains: { dataModules: sheetDomain({
        hero: { role: 'character', fields: character('Astra', { level: 1 }) },
        skills: { role: 'skills', fields: skillBlock('Astra', [['Cut', 3]]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Rats', 2, 1, 0], ['Spiders', 3, 1, 0]]) },
    }) } };
    const result = { stop: 'won', rounds: Array.from({ length: 8 }, (_, n) => ({ n: n + 2, lines: [{ pc: { who: 'Astra' }, skill: 'Cut' }] })) };
    const awards = pendingAwards(state, { groups: [1, 2], setup: { offset: 1 } }, result, { rpgXpRate: 200, rpgPracticePerUse: 5 });
    assert.deepEqual(awards.xp, [{ who: 'Astra', amount: 20 }]);
    assert.deepEqual(awards.practice, [{ who: 'Astra', skill: 'Cut', amount: 20 }]);
    assert.deepEqual(pendingAwards(state, { groups: [1, 2] }, { ...result, stop: 'fled' }).xp, []);
    Object.assign(state.domains.dataModules.instances['pack.chat/foes'].chat.fields, { count1: 50, level1: 99 });
    assert.deepEqual(pendingAwards(state, { groups: [1, 2] }, result, { rpgXpRate: 300 }).xp, [{ who: 'Astra', amount: 180 }], 'the raw fight XP is capped before scaling');
});
