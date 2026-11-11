// The Fight tab board is exercised on the test host and its mounted page.
// It covers final exchanges, target selection, awards, rules gating and in-page discard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { STAGES, stageWord } from '../../../../src/v2/lean-rpg/names.js';
import { usesOf } from '../../../../src/v2/lean-rpg/practice.js';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { foeChips, partyChips, pendingAwards, resourcesOf } from '../../../../src/v2/lean-rpg/board/view-data.js';
import { foeGroupChip, resourceStrip, skillButton } from '../../../../src/v2/lean-rpg/board/view-chips.js';
import { createBoardView } from '../../../../src/v2/lean-rpg/board/view.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { character, levelFoeBlock, setup, sheetDomain, skillBlock } from '../helpers.js';
import { page, begin, makeBlocks, settle } from '../view/page.js';
import { planGear } from '../../../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { aiMessage } from '../../../../testkit/fake-st.js';
import { setupDom } from '../../view/mounts/helpers.js';

const BOARD_CSS = readFileSync(new URL('../../../../src/v2/lean-rpg/board/board.css', import.meta.url), 'utf8');

async function defineFoes(host, entries) {
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    entries.forEach(([name, count, level, hurt], at) => {
        Object.assign(foes.state[`foe${at + 1}`], { default: name });
        Object.assign(foes.state[`count${at + 1}`], { default: count });
        Object.assign(foes.state[`level${at + 1}`], { default: level });
        Object.assign(foes.state[`hurt${at + 1}`], { default: hurt });
    });
    const defined = await host.sdk.command('dm.define', { definition: foes });
    assert.equal(defined.ok, true, defined.message);
}

function renderMembers(t, { doc, host, members, order, rounds = [], oldArea = false }) {
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    assert.equal(openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } }).error, undefined);
    if (oldArea) delete boardSession(meta).setup.areaAll;   // a fight staged before `areaAll`: it keeps the main-group choice
    const board = createBoardView({ doc, headState: () => host.head(), meta: () => meta, store: host.store,
        rules: () => ({ ...STANDARD_FORMULA, levelDivisor: 5 }), query: (name, args) => host.sdk.query(name, args),
        readerName: () => 'Wessel', levels: () => ({ ranks: [], playerRank: null }), on: () => true });
    const root = doc.createElement('div');
    let handles = [];
    doc.body.appendChild(root);
    const snapshot = { session: boardSession(meta), played: { state: host.head(), result: { members, order, rounds, opening: [], quickStart: [],
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
    await defineFoes(host, [['Rats', 2, 1, 12], ['Spiders', 1, 1, 12]]);
    await settle();
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.ok(fight().querySelector('.rpg-board-open'));
    fight().querySelector('.rpg-board-open').click();
    assert.ok(fight().querySelector('.rpg-board-log'));
    const blocked = fight().querySelectorAll('.rpg-board-choice').find(node => node.textContent.includes('Shadow Cut'));
    assert.equal(blocked.disabled, true);
    assert.match(blocked.textContent, /not enough/);
    assert.ok(blocked.classList.contains('rpg-skill-blocked'), 'greyed');
    doc.key('1');
    assert.match(fight().textContent, /Choose a group/, 'single target: groups first');
    const groups = [...fight().querySelectorAll('.rpg-board-choice')].map(node => node.textContent);
    assert.deepEqual(groups, ['1. Rats ×2', '2. Spiders']);
    fight().querySelector('[data-choice="1"]').click();   // a group of several opens its members
    assert.match(fight().textContent, /Choose a target/);
    const targets = [...fight().querySelectorAll('.rpg-board-choice')].map(node => node.textContent);
    assert.ok(targets.some(text => /Rats 1\s+Unhurt/.test(text)), 'the target line names each standing member and its bar');
    assert.ok(targets.some(text => /Rats 2\s+Unhurt/.test(text)), 'every standing member has a target line');
    const rowOf = cls => fight().querySelector(`.${cls}`).parentNode;
    assert.equal(rowOf('rpg-board-back'), rowOf('rpg-board-discard'), 'Back and Discard fight share one row container');
    assert.match(rowOf('rpg-board-back').className, /rpg-board-actions/);
    const escape = { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {} };
    doc.listeners.find(entry => entry.fn.name === 'keydown' && entry.capture).fn(escape);
    assert.match(fight().textContent, /choose an action/);
    assert.equal(rowOf('rpg-board-auto'), rowOf('rpg-board-discard'), 'Auto and Discard fight share one row container');
    fight().querySelector('[data-choice="1"]').click();
    fight().querySelector('[data-choice="1"]').click();
    fight().querySelector('[data-choice="2"]').click();
    assert.match(fight().querySelector('.rpg-board-log').textContent, /Exchange 1/);
    const excerpt = fight().querySelector('.rpg-board-excerpt');   // the wide board's two-line box (board.css clamps it; a phone hides it)
    assert.ok(excerpt && excerpt.textContent.length > 0 && !/Exchange 1/.test(excerpt.textContent), 'the last exchange\'s lines, without its heading');
    const kids = [...fight().querySelector('.rpg-board-body').children]; assert.ok(kids.indexOf(excerpt) + 1 === kids.indexOf(fight().querySelector('.rpg-board-log')), 'the excerpt sits right above the log summary');
    assert.equal(fight().querySelector('.rpg-board-undo'), null);
    assert.equal(boardSession(host.ctx.chatMetadata).exchanges.length, 1);
    fight().querySelector('.rpg-board-discard').click();
    assert.match(fight().textContent, /Discard this fight/);
    assert.equal(rowOf('rpg-board-confirm'), fight().querySelectorAll('.ss-button').find(node => node.textContent === 'Cancel').parentNode, 'the confirm pair shares a row');
    fight().querySelectorAll('.ss-button').find(node => node.textContent === 'Cancel').click();
    assert.equal(boardSession(host.ctx.chatMetadata).exchanges.length, 1);
    fight().querySelector('.rpg-board-discard').click();
    fight().querySelector('.rpg-board-confirm').click();
    assert.ok(fight().querySelector('.rpg-board-open'));
});

test('the marked board stages a selected heal on its named party member and labels the result', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    // (Health 8 of 16 blocks: a decisive foe hit of the harder-foes rule takes 4 and cannot Down Wessel before her Mend is told)
    await makeBlocks(host, { character: { health: 8, vit: 20 }, skills: { skill1: 'Mend', about1: 'heal an ally', stat1: 'int', uses1: 'mana' } });
    await defineFoes(host, [['Rat', 1, 1, 4]]);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    fight().querySelector('.rpg-board-open').click();
    const choice = fight().querySelectorAll('.rpg-board-choice').find(node => node.textContent.includes('Mend → Wessel'));
    assert.ok(choice);
    choice.click();
    assert.equal(boardSession(host.ctx.chatMetadata).exchanges[0].actions[0].support, true);
    assert.match(fight().querySelector('.rpg-board-log').textContent, /Wessel heals Wessel \(Mend\)/);
});

test('the board ends on a won card', async t => {
    const { doc, result } = await showStop(t, {
        character: { str: 20, agi: 20 }, foes: [['Rats', 1, 1, 1]],
        action: [{ who: 'Wessel', kind: 'attack', target: 1 }], stop: 'won',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'won');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight won/);
    assert.ok(fight.querySelector('.rpg-board-active').classList.contains('rpg-board-finished'), 'an ended board unlocks its phone layout');
    assert.match(fight.textContent, /Your next message carries this fight/);
    assert.match(fight.querySelector('.rpg-board-awards').textContent, /Pending XP: Wessel \+\d+ XP\. Pending practice: none/);
    assert.match(fight.querySelector('.rpg-board-awards-phone').textContent, /^Pending: Wessel \+\d+ XP$/);
    assert.ok(fight.querySelector('.rpg-board-note'));
});

test('the board ends on a lost card', async t => {
    const { doc, result } = await showStop(t, {
        character: { str: 3, agi: 3, vit: 3, health: 1 }, foes: [['Rats', 12, 99, 15]],
        action: [{ who: 'Wessel', kind: 'attack', target: 11 }], stop: 'lost',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'lost');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight lost/);
});

test('the board ends on a fled card', async t => {
    const { doc, result } = await showStop(t, {
        character: { agi: 20 }, foes: [['Rats', 1, 1, 12]],
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
    assert.match(awards, /Wessel \+30 XP/);
    const uses = usesOf(result).find(item => item.skill === 'Cut').n;
    assert.ok(awards.includes(`Wessel: Cut +${Math.min(20, uses * 5)}`));
});

for (const outcome of ['success', 'fail', 'soaked']) test(`the log labels a defence ${outcome} and uses words for bars`, async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Rats', 3, 3, 5]]);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    let result, defence;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
        result = stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 11 }]).preview?.result;
        defence = result?.rounds.flatMap(round => round.lines).find(line => line.kind === 'foe' && (outcome === 'soaked' ? Number.isInteger(line.soaked) : line.outcome === outcome && line.soaked === undefined));
        if (defence) break;
        discardBoard(meta);
    }
    assert.ok(defence);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const log = doc.querySelector('.rpg-board-log').textContent;
    assert.match(log, new RegExp(`Rats 1 attacks Wessel.*Wessel's defence: ${outcome === 'soaked' ? 'GLANCED OFF' : outcome.toUpperCase()}`));
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
    assert.ok(doc.querySelector('.rpg-board-status .rpg-mini[aria-label="Health"]'), 'Health is a mini-bar on the chip');
    assert.doesNotMatch(status, /Unhurt|Hurt|Mana|Stamina/, 'chips carry Health only');
    assert.doesNotMatch(status, /\d+\s+of\s+\d+/);
});

test('a replacement choice stays locked after a roll, then accepts a later action', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { character: { vit: 20 } });
    await defineFoes(host, [['Rats', 12, 3, 5]]);
    const meta = host.ctx.chatMetadata, state = host.head(), sid = host.store.carrierSid(host.store.headIndex());
    const action = [{ who: 'Wessel', kind: 'attack', target: 11 }];
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
    const action = [{ who: 'Wessel', kind: 'attack', target: 11 }];
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
    stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 11 }]);
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
    assert.equal(stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 11 }]).error, undefined);
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
    stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 11 }]);
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
        const staged = stageExchange(meta, state, [{ who: 'Wessel', kind: 'attack', target: 11 }]);
        if (staged.preview?.result.stop === 'open' && staged.preview.result.wear?.some(event => event.to === 'broken')) { result = staged; break; }
        discardBoard(meta);
    }
    assert.ok(result, 'found a staged weapon break');
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const choice = doc.querySelector('[data-ss-screen="story-block/fight"]').querySelector('[data-choice="1"]');
    assert.match(choice.textContent, /^AttackSTR$/);
    assert.doesNotMatch(choice.textContent, /Cane Sword/);
});

test('chips group the foes (×N, Health only), and a single target opens the group, then its members', async t => {
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
    const foes = [...root.querySelectorAll('.rpg-board-cards .rpg-chips-foes .rpg-chip')];
    assert.equal(foes.length, 1, 'three members are ONE chip');
    assert.equal(foes[0].querySelector('.rpg-chip-name').textContent, 'Bristle-boar ×2Lv 1', 'the foes standing, and the level');
    const mini = foes[0].querySelector('.rpg-mini[aria-label="Health"]');
    assert.equal(mini.querySelectorAll('i').length, 4, 'a 4-segment Health mini-bar');
    assert.equal(mini.querySelectorAll('i.lit').length, 3, '8 of 12 blocks: 3 segments lit');
    assert.doesNotMatch(foes[0].textContent, /Unhurt|Mana|Stamina|\d+\/\d+/u, 'Health only');
    assert.equal(root.querySelector('.rpg-board-cards .rpg-foe'), null, 'no foe cards');
    assert.equal(root.querySelector('.rpg-board-order').textContent, 'Order: Wessel · Bristle-boars (1, 2, 3) · 2 attacks on you each exchange');
    assert.ok(root.querySelector('.rpg-board-log').tagName === 'DETAILS', 'the log is one line that opens');
    root.querySelector('[data-choice="1"]').click();   // Attack: one group with several members opens them directly
    assert.equal(root.querySelector('.rpg-board-prompt').textContent, 'Choose a target');
    assert.deepEqual([...root.querySelectorAll('.rpg-board-choices .rpg-board-choice')].map(node => node.textContent),
        ['1. Bristle-boar 1 Unhurt', '2. Bristle-boar 3 Unhurt'], 'Down members are not targetable');
});

test('the status chips and the strip are pure: ×N only above one, Mana omitted without a Mana bar, a skill cost and "not enough"', () => {
    const doc = setupDom();
    const hounds = foeGroupChip(doc, { name: 'Ridge hounds', count: 12, level: 2, value: 5, max: 8, tone: 'warn' });
    assert.equal(hounds.querySelector('.rpg-chip-name').textContent, 'Ridge hounds ×12Lv 2');
    assert.equal(foeGroupChip(doc, { name: 'Gorrak', count: 1, level: 4, value: 4, max: 4, tone: 'good' }).querySelector('.rpg-chip-name').textContent, 'GorrakLv 4');
    assert.equal(hounds.querySelectorAll('.rpg-mini i.lit').length, 3);
    assert.deepEqual(foeChips([{ slot: 11, group: 1, name: 'Wolf 1', value: 4, size: 4, standing: true }, { slot: 12, group: 1, name: 'Wolf 2', value: 2, size: 4, standing: true }], [{ slot: 1, name: 'Wolves', level: 3 }])
        .map(({ name, count, level, value, max }) => ({ name, count, level, value, max })), [{ name: 'Wolves', count: 2, level: 3, value: 6, max: 8 }]);
    assert.deepEqual(partyChips([{ name: 'Astra', level: 3, bars: { health: { value: 2, max: 4 } } }]).map(({ name, level, value, max }) => ({ name, level, value, max })), [{ name: 'Astra', level: 3, value: 2, max: 4 }]);
    const both = resourceStrip(doc, { mana: { value: 10, max: 10 }, stamina: { value: 7, max: 12 } });
    assert.deepEqual([...both.querySelectorAll('.rpg-res-label')].map(node => node.textContent), ['Mana', 'Stamina']);
    assert.deepEqual([...both.querySelectorAll('.rpg-res-count')].map(node => node.textContent), ['10/10', '7/12']);
    assert.equal(both.querySelector('.rpg-res-sp .rpg-res-fill').style.width, '58%');
    const plain = resourceStrip(doc, resourcesOf({ size: { mana: 0, stamina: 6, health: 4 }, mana: 0, stamina: 3 }));
    assert.deepEqual([...plain.querySelectorAll('.rpg-res-label')].map(node => node.textContent), ['Stamina'], 'a member without Mana shows Stamina only');
    assert.equal(resourcesOf({ stamina: 3 }), null, 'no block sizes: no strip');
    const skill = skillButton(doc, { name: 'Flash', stat: 'agi', uses: 'mana', cost: 2, area: true });
    assert.equal(skill.textContent, 'Flasharea · AGI · 2 Mana');
    assert.equal(skill.disabled, false);
    const dull = skillButton(doc, { name: 'Guard Break', stat: 'str', uses: 'stamina', cost: 8, blocked: 'Stamina is Empty' });
    assert.equal(dull.disabled, true);
    assert.equal(dull.textContent, 'Guard BreakSTR · 8 Stamina · not enough');
});

test('the choosing member shows a Mana and Stamina strip right above the skills, and each skill its cost', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { skills: { skill1: 'Shadow Cut', about1: 'sweep every foe', uses1: 'mana', stat1: 'agi' } });
    await defineFoes(host, [['Bristle-boar', 1, 1, 5]]);
    const members = [{ slot: 11, group: 1, n: 1, name: 'Bristle-boar', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true }];
    const root = renderMembers(t, { doc, host, members, order: [{ id: 'c:wessel', name: 'Wessel', party: true }, { id: 'f:11', name: 'Bristle-boar', party: false }] });
    const strip = root.querySelector('.rpg-board-controls .rpg-actor');
    assert.ok(strip, 'the strip is in the controls');
    assert.deepEqual([...strip.querySelectorAll('.rpg-res-label')].map(node => node.textContent), ['Mana', 'Stamina']);
    assert.equal(strip.nextElementSibling.className, 'rpg-board-choices', 'no named defence skill: no Defence row, the skills follow at once');
    assert.equal(root.querySelector('.rpg-chip-title').textContent, 'Bristle-boar', 'the name is its own wrapping span');
    const skills = [...root.querySelectorAll('.rpg-board-choice')].map(node => node.textContent);
    assert.ok(skills.some(text => /^Shadow Cutarea · AGI · \d Mana$/u.test(text)), JSON.stringify(skills));
});

test('the board draws only party members who have not left, and draws one again when they return', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    const sister = await makeBlocks(host, { who: 'Temiwa', character: { left: true } });
    await defineFoes(host, [['Bristle-boar', 1, 1, 5]]);
    const foe = { slot: 11, group: 1, n: 1, name: 'Bristle-boar', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true };
    const order = [{ id: 'c:wessel', name: 'Wessel', party: true }, { id: 'f:11', name: 'Bristle-boar', party: false }];
    const names = root => [...root.querySelectorAll('.rpg-board-cards .rpg-chip-party .rpg-chip-name')].map(node => node.textContent.replace(/Lv \d+$/u, ''));
    for (const members of [[foe], null]) {
        assert.deepEqual(names(renderMembers(t, { doc, host, members, order })), ['Wessel'], `a member who left is not drawn (${members ? 'members' : 'plain'} layout)`);
        discardBoard(host.ctx.chatMetadata);
    }
    const back = await host.sdk.command('dm.set', { module: sister.character, field: 'left', value: false });
    assert.equal(back.ok, true, back.message);
    for (const members of [[foe], null]) {
        assert.deepEqual(names(renderMembers(t, { doc, host, members, order })).sort(), ['Temiwa', 'Wessel'], 'a member who returns is drawn again');
        discardBoard(host.ctx.chatMetadata);
    }
});

test('E5: a newly opened board shows the seeded member order before the first choice', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Bristle-boar', 3, 1, 5]]);
    const sid = host.store.carrierSid(host.store.headIndex()), meta = host.ctx.chatMetadata;
    const opened = openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
    assert.equal(opened.error, undefined, opened.error);
    assert.equal(boardSession(meta).exchanges.length, 0);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const order = doc.querySelector('[data-ss-screen="story-block/fight"] .rpg-board-order');
    assert.ok(order, 'the order line is present before any choice');
    // (the world's Foes block is a new one, so the harder-foes cap shows: three boars make 3 attacks, the party of one takes at most 2)
    assert.match(order.textContent, /^Order: .*Bristle-boars \(1, 2, 3\).*2 attacks on you each exchange$/u);
});

test('a pack is one chip with about how many are left, and stays a single target', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Cellar-rats', 12, 1, 5]]);
    const pack = { slot: 11, group: 1, n: 1, name: 'Cellar-rats', value: 5, size: 8, pack: true, count: 12, left: 8, attacks: 2, standing: true };
    const root = renderMembers(t, { doc, host, members: [pack], order: [{ id: 'c:wessel', name: 'Wessel', party: true }, { id: 'f:11', name: 'Cellar-rats', party: false }] });
    const chip = root.querySelector('.rpg-chips-foes .rpg-chip');
    assert.equal(chip.querySelector('.rpg-chip-name').textContent, 'Cellar-rats ×8Lv 1');
    assert.equal(root.querySelector('.rpg-board-order').textContent, 'Order: Wessel · Cellar-rats · 2 attacks on you each exchange');
    root.querySelector('[data-choice="1"]').click();   // one group, one member: no target step
    assert.equal(boardSession(host.ctx.chatMetadata).exchanges[0].actions[0].target, 11);
});

test('a Down pack stays as a dimmed chip', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Cellar-rats', 12, 1, 5]]);
    const pack = { slot: 11, group: 1, n: 1, name: 'Cellar-rats', value: 0, size: 8, pack: true, count: 12, left: 0, attacks: 0, standing: false };
    const root = renderMembers(t, { doc, host, members: [pack], order: [] });
    const chip = root.querySelector('.rpg-chips-foes .rpg-chip');
    assert.ok(chip.classList.contains('rpg-chip-down'));
    assert.equal(chip.querySelectorAll('.rpg-mini i.lit').length, 0);
    assert.equal(root.classList.contains('rpg-board-finished'), false);
});

test('nothing on the board scrolls: no observers, no inner scrollers, a sticky status, two columns from 700px, three skill columns from 900px', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Cellar-rats', 12, 1, 5]]);
    const observers = [];
    doc.defaultView.ResizeObserver = class { constructor() { observers.push(this); } observe() {} unobserve() {} disconnect() {} };
    const pack = { slot: 11, group: 1, n: 1, name: 'Cellar-rats', value: 5, size: 8, pack: true, count: 12, left: 8, attacks: 2, standing: true };
    const root = renderMembers(t, { doc, host, members: [pack], order: [] });
    assert.equal(observers.length, 0, 'no measuring: nothing is sized to fit a scroller');
    assert.ok(root.querySelector('.rpg-board-body > .rpg-board-status'));
    assert.ok(root.querySelector('.rpg-board-body > .rpg-board-controls'));
    assert.doesNotMatch(BOARD_CSS, /(?:overflow(?:-y)?\s*:\s*(?:auto|scroll)|scroll-snap|max-height\s*:\s*35vh|--rpg-card-row-height|--rpg-choice-limit)/u);
    assert.match(BOARD_CSS, /@media \(max-width: 759\.98px\) \{\s*[^}]*\.rpg-board-status \{ position: sticky; top: 0;/u);
    assert.match(BOARD_CSS, /\.rpg-board-active \{ container: rpgboard \/ inline-size;/u);
    assert.match(BOARD_CSS, /@container rpgboard \(min-width: 700px\) \{[^@]*grid-template-columns: minmax\(0, 1\.1fr\) minmax\(0, 1fr\)[^@]*flex: 0 0 calc\(\(100% - 10px\) \/ 3\)[^@]*flex: 0 0 calc\(\(100% - 15px\) \/ 4\)/u);
    assert.match(BOARD_CSS, /\.rpg-board-choices \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
    assert.match(BOARD_CSS, /@container rpgboard \(min-width: 900px\) \{ \.rpg-board-choices \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
    assert.match(BOARD_CSS, /\.rpg-skill-blocked \{ opacity: \.45; \}/u);
    assert.match(BOARD_CSS, /\.rpg-board-members \.rpg-board-controls button \{ min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important; \}/u);
});

test('a log the reader opened stays open across the redraws of a running fight', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await defineFoes(host, [['Bristle-boar', 2, 1, 5]]);
    const members = [11, 12].map(slot => ({ slot, group: 1, n: slot - 10, name: `Bristle-boar ${slot - 10}`, value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true }));
    const root = renderMembers(t, { doc, host, members, order: [] });
    const log = () => root.querySelector('.rpg-board-log');
    assert.equal(log().open, false, 'closed at first');
    log().open = true;
    log().dispatch('toggle');
    root.querySelector('[data-choice="1"]').click();   // a choice redraws the board
    assert.equal(log().open, true, 'still open after the redraw');
});

const AREA_MEMBERS = [
    { slot: 11, group: 1, n: 1, name: 'Bristle-boar 1', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
    { slot: 12, group: 1, n: 2, name: 'Bristle-boar 2', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
    { slot: 13, group: 1, n: 3, name: 'Bristle-boar 3', value: 0, size: 4, pack: false, count: 1, left: 0, attacks: 0, standing: false },
    { slot: 21, group: 2, n: 1, name: 'Spiders', value: 4, size: 4, pack: false, count: 1, left: 1, attacks: 1, standing: true },
    { slot: 31, group: 3, n: 1, name: 'Worms', value: 0, size: 4, pack: false, count: 1, left: 0, attacks: 0, standing: false },
];
const AREA_ORDER = [{ id: 'c:wessel', name: 'Wessel', party: true }, { id: 'f:11', party: false }, { id: 'f:12', party: false }, { id: 'f:21', party: false }];
async function areaBoard(t, opts) {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { skills: { skill1: 'Shadow Cut', about1: 'sweep every foe', uses1: 'mana' } });
    await defineFoes(host, [['Bristle-boar', 3, 1, 5], ['Spiders', 2, 1, 5], ['Worms', 2, 1, 5]]);
    return { host, root: renderMembers(t, { doc, host, members: AREA_MEMBERS, order: AREA_ORDER, ...opts }) };
}

test('an area skill is one tap: it stages at once with no group, and the staged line reads just who and the skill', async t => {
    const { host, root } = await areaBoard(t, {});
    const area = [...root.querySelectorAll('.rpg-board-choice')].find(node => node.textContent.includes('Shadow Cut'));
    assert.match(area.textContent, /^Shadow Cutarea · STR · 2 Mana$|^Shadow Cutarea · \w+ · 1 Mana$/u);
    area.click();
    const exchanges = boardSession(host.ctx.chatMetadata).exchanges;
    assert.equal(exchanges.length, 1, 'staged by the one tap (a one-member party)');
    assert.equal(exchanges[0].actions[0].area, true);
    assert.equal('group' in exchanges[0].actions[0], false, 'no group');
    assert.equal(root.querySelector('.rpg-board-area-note'), null);
});

test('the staged line of an area skill reads just "Temiwa · Shadow Cut" in a party of two', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host);
    await makeBlocks(host, { who: 'Temiwa', skills: { skill1: 'Shadow Cut', about1: 'sweep every foe', uses1: 'mana' } });   // Temiwa chooses first
    await defineFoes(host, [['Bristle-boar', 3, 1, 5], ['Spiders', 2, 1, 5]]);
    const root = renderMembers(t, { doc, host, members: AREA_MEMBERS.slice(0, 4), order: AREA_ORDER });
    [...root.querySelectorAll('.rpg-board-choice')].find(node => node.textContent.includes('Shadow Cut')).click();
    assert.equal(root.querySelector('.rpg-board-staged').textContent, 'Temiwa · Shadow Cut');
    assert.equal(root.querySelector('.rpg-board-prompt').textContent, 'Wessel: choose an action');
    assert.equal(root.querySelector('.rpg-board-step').textContent, '2 of 2');
    assert.equal(boardSession(host.ctx.chatMetadata).exchanges.length, 0, 'the exchange waits for the second member');
    assert.equal(root.querySelector('.rpg-board-back').disabled, false, 'Back is live once something is staged');
    root.querySelector('.rpg-board-back').click();   // Back takes the staged action back
    assert.equal(root.querySelector('.rpg-board-staged'), null);
    assert.equal(root.querySelector('.rpg-board-back').disabled, true, 'Back stays in its row, disabled, with nothing to take back');
});

test('a fight staged before areaAll keeps asking for a main group when more than one group stands', async t => {
    const { root } = await areaBoard(t, { oldArea: true });
    const area = [...root.querySelectorAll('.rpg-board-choice')].find(node => node.textContent.includes('Shadow Cut'));
    area.click();
    assert.equal(root.querySelector('.rpg-board-prompt').textContent, 'Wessel: Shadow Cut (area)');
    assert.equal(root.querySelector('.rpg-board-area-note').textContent, 'Hits every enemy group. The group you pick takes the full effect, and the others take one Health block less.');
    assert.deepEqual([...root.querySelectorAll('.rpg-board-choices .rpg-board-choice')].map(node => node.textContent), ['Main target: Bristle-boars', 'Main target: Spiders']);
});

test('the board log shows one line per area group without repeating the roll', async t => {
    const { doc, host } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { skills: { skill1: 'Shadow Cut', about1: 'sweep every foe', uses1: 'mana' } });
    await defineFoes(host, [['Tunnel Rat', 24, 1, 5], ['Grey-Tooth Nest-Mother', 1, 1, 5]]);
    const order = [{ id: 'c:wessel', name: 'Wessel', total: 100 }, { id: 'f:11', name: 'Tunnel Rat pack 1', total: 1 },
        { id: 'f:12', name: 'Tunnel Rat pack 2', total: 1 }, { id: 'f:2', name: 'Grey-Tooth Nest-Mother', total: 1 }];
    const played = playBoard(host.head(), { seed: 3, offset: 0, rules: { ...STANDARD_FORMULA, levelDivisor: 5 }, members: 1, aoe: 1, order },
        [{ actions: [{ who: 'Wessel', kind: 'skill', skill: 'Shadow Cut', area: true, group: 1 }] }]);
    assert.equal(played.error, undefined, played.error);
    const root = renderMembers(t, { doc, host, members: played.result.members, order: played.result.order, rounds: played.result.rounds });
    const lines = [...root.querySelectorAll('.rpg-board-log-content p')].map(node => node.textContent);
    const main = lines.filter(text => text.startsWith('Wessel → Tunnel Rat packs'));
    const other = lines.filter(text => /^… also (hits|targets) Grey-Tooth Nest-Mother \(reduced\)/u.test(text));
    assert.equal(main.length, 1, JSON.stringify(lines));
    assert.equal(other.length, 1, JSON.stringify(lines));
    assert.match(main[0], /d20/u);
    assert.doesNotMatch(other[0], /d20/u);
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
