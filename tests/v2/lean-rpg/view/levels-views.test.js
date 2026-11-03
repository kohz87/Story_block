// Levels in the RPG screens (Story Block 2.17.0, approved mockup): the level pill and the XP row on the Party card, the foe pill, the help and the
// turn order on the Fight card, the battle log's level terms, and a story with no ranks. (Settings → RPG and the New character window are in
// settings.test.js and wizard.test.js; "Changed this reply" is in changes-lines.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { createPartyWidget } from '../../../../src/v2/lean-rpg/view/party.js';
import { createFightWidget, readFight } from '../../../../src/v2/lean-rpg/view/fight.js';
import { buildPanel, panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { heroLead } from '../../../../src/v2/lean-rpg/view/hero-data.js';
import { packLevels, readFoes, readParty } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { levelLabel } from '../../../../src/v2/lean-rpg/levels.js';
import { characterDefinition, fakeState, foesDefinition, roleOf } from './helpers.js';

const RANKS = [{ name: 'F', from: 1, to: 9 }, { name: 'E', from: 10, to: 19 }, { name: 'D', from: 20, to: 29 }, { name: 'SSS', from: 30, to: 99 }];
const GUILD = { module: 'guild-membership', field: 'letter', label: 'Guild' };
const guildBlock = letter => ({ definition: { slug: 'guild-membership', name: 'Guild', schema: 1, stateVersion: 1, scope: 'chat', state: { letter: { type: 'text', max: 4, default: '' } }, kinds: {}, prompt: '', show: { tab: false, card: false, tabName: 'Guild', icon: 'ph-star' } }, fields: { letter } });
const astra = (fields = {}) => ({ definition: characterDefinition('wessel', 'Astra'), fields: { health: 5, mana: 4, stamina: 3, level: 14, xp: 24, ...fields } });
const crawlers = (fields = {}) => ({ definition: foesDefinition(), fields: { foe1: 'Mud-Scale Crawlers', count1: 6, level1: 7, hurt1: 0, ...fields } });

function drawParty(state, levels = () => ({})) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    createPartyWidget({ headState: () => state, readerName: () => 'Astra', roleOf, levels }).render(el, {}, {});
    return el;
}
const pillOf = el => el.querySelector('.rpg-card .rpg-top .ss-pill.rpg-level-pill');

test('the Party card: a small level pill on the name row, "Lv 14 · Guild F" with the pack\'s player rank, and the XP row "24 / 100 to Lv 15"', () => {
    const state = fakeState([astra(), guildBlock('F')]);
    const el = drawParty(state, () => ({ ranks: RANKS, playerRank: GUILD }));
    const pill = pillOf(el);
    assert.equal(pill.textContent, 'Lv 14 · Guild F');
    assert.ok(pill.parentNode.parentNode.classList.contains('rpg-top'), 'on the name row, with the name');
    assert.match(el.querySelector('.rpg-xp').textContent, /24 \/ 100 to Lv 15/);
    assert.equal(heroLead(state, { own: 'Astra', roleOf, ranks: RANKS, playerRank: GUILD }).bars.at(-1).text, '24 / 100 to Lv 15', 'the hero XP line the same');
});

test('the Guild block not pinned or its letter empty: "Lv 14" alone; no player rank in the pack: the level band, "Rank E · Lv 14"', () => {
    assert.equal(pillOf(drawParty(fakeState([astra()]), () => ({ ranks: RANKS, playerRank: GUILD }))).textContent, 'Lv 14', 'block not pinned');
    assert.equal(pillOf(drawParty(fakeState([astra(), guildBlock('')]), () => ({ ranks: RANKS, playerRank: GUILD }))).textContent, 'Lv 14', 'letter empty');
    assert.equal(pillOf(drawParty(fakeState([astra()]), () => ({ ranks: RANKS, playerRank: null }))).textContent, 'Rank E · Lv 14');
});

test('a story with no ranks and no player rank: just "Lv 14" on the card and "Lv 7" on the foe, nothing broken', () => {
    const state = fakeState([astra(), crawlers()]);
    assert.equal(pillOf(drawParty(state)).textContent, 'Lv 14');
    assert.deepEqual(readFoes(state, { roleOf }).map(foe => foe.levelText), ['Lv 7']);
    assert.deepEqual(packLevels(undefined), { ranks: [], playerRank: null });
    assert.deepEqual(packLevels([{ slug: 'formula', formula: 'standard' }]), { ranks: [], playerRank: null });
    assert.equal(levelLabel(14, []), 'Lv 14');
    assert.equal(levelLabel(14, RANKS), 'Rank E · Lv 14');
    assert.equal(levelLabel(14, RANKS, { playerRank: { label: 'Guild', value: 'F' } }), 'Lv 14 · Guild F');
});

test('the pack\'s ranks and player rank are picked up from its rpg records', () => {
    const found = packLevels([{ slug: 'formula', formula: 'standard' }, { slug: 'ranks', ranks: RANKS, playerRank: GUILD }]);
    assert.deepEqual(found.ranks.map(rank => rank.name), ['F', 'E', 'D', 'SSS']);
    assert.deepEqual(found.playerRank, GUILD);
    assert.deepEqual(packLevels([{ ranks: [{ name: 'F' }, { name: 'E', from: 1, to: 9 }], playerRank: { module: 3 } }]), { ranks: [{ name: 'E', from: 1, to: 9 }], playerRank: null }, 'a damaged entry is left out');
});

test('the XP row at the cap says so (the XP holds at 100); the level reads from the Level field, held 1 to 99', () => {
    const el = drawParty(fakeState([astra({ level: 99, cap: 99, xp: 100 })]));
    assert.match(el.querySelector('.rpg-xp').textContent, /100 \/ 100 · level cap/);
    const [capped] = readParty(fakeState([astra({ level: 40, cap: 40, xp: 100 })]), { roleOf });
    assert.deepEqual([capped.level, capped.cap], [40, 40]);
    assert.equal(readParty(fakeState([astra({ level: 500 })]), { roleOf })[0].level, 99);
    assert.equal(readParty(fakeState([astra({ level: 'x' })]), { roleOf })[0].level, 1);
});

// ---- Fight

const pc = (who, extra = {}) => ({ who, die: 14, stat: 'agi', statBonus: 5, classValue: 14, classBonus: 2, rank: 2, edge: 0, total: 37, ...extra });
const foeSide = (extra = {}) => ({ slot: 1, name: 'Mud-Scale Crawlers', die: 9, base: 4, classValue: 7, classBonus: 1, total: 22, ...extra });
const record = extra => ({ v: 1, checks: [], refused: [], rounds: [{ n: 1, lines: [{ kind: 'act', outcome: 'success', skill: 'Iaijutsu', pc: pc('Astra'), foe: foeSide() }] }],
    order: [{ id: 'c:astra', name: 'Astra', total: 29, party: true }, { id: 'f:1', name: 'Mud-Scale Crawlers', total: 14, party: false }], ...extra });
const world = () => fakeState([astra(), crawlers()]);
const latestOf = (state, extra) => ({ latest: () => ({ index: 3, key: 'k', model: panelModel({ resolve: readResolve(record(extra)), state, before: null, roleOf, ranks: RANKS }) }) });
function drawFight(state, battleLog) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    createFightWidget({ headState: () => state, readerName: () => 'Astra', roleOf, battleLog, levels: () => ({ ranks: RANKS, playerRank: GUILD }) }).render(el, {}, {});
    return el;
}

test('the Fight card: the foe pill "Rank F · Lv 7" beside its name, the help, the turn-order chips with levels and the note', () => {
    const el = drawFight(world(), latestOf(world()));
    const foe = el.querySelector('.rpg-foe[data-foe="Mud-Scale Crawlers"]');
    const pill = foe.querySelector('.rpg-foe-top .rpg-foe-side .ss-pill.rpg-level-pill');
    assert.equal(pill.textContent, 'Rank F · Lv 7');
    assert.equal(foe.querySelector('.rpg-name').textContent, 'Mud-Scale Crawlers ×6');
    assert.equal(readFight(world(), { roleOf, ranks: RANKS })[0].levelText, 'Rank F · Lv 7');
    const chips = el.querySelectorAll('.rpg-order .rpg-order-pill').map(node => node.textContent);
    assert.deepEqual(chips, ['1 Astra (Lv 14)29', '2 Mud-Scale Crawlers (Lv 7)14']);
    assert.equal(el.querySelector('.rpg-order-note').textContent, 'Rolled at the start of this fight (d20 + level ÷ 5 + AGI/2; foes the same with their own level). A swipe rolls it again.');
});

test('a foe with a `class` field (a chat made before Levels) reads it as its level', () => {
    const old = { definition: foesDefinition(), fields: { foe1: 'Weir-drake', count1: 1, class1: 4, hurt1: 5 } };
    assert.deepEqual(readFoes(fakeState([old]), { roleOf, ranks: RANKS }).map(foe => [foe.level, foe.levelText]), [[4, 'Rank F · Lv 4']]);
});

// ---- Battle log

test('the battle log: turn order with levels, the Foes line "×6 · Rank F · Lv 7: Down", and the why lines show the level ÷ 5 term', () => {
    const state = world();
    const model = panelModel({ resolve: readResolve(record({ lv: 1 })), state, before: null, roleOf, ranks: RANKS });
    const node = buildPanel(setupDom(), model, { index: 3 });
    assert.equal(node.querySelector('.rpg-bl-order').textContent, 'Turn order: Astra (Lv 14) 29 > Mud-Scale Crawlers (Lv 7) 14');
    assert.match(node.querySelector('.rpg-bl-foe-list').textContent, /^Mud-Scale Crawlers ×6 · Rank F · Lv 7: Down$/);
    const why = model.rounds[0].lines[0].breakdown;
    assert.equal(why, 'd20 14 + AGI 5 + Lv 14 ÷ 5 = 2 + Expert 2 = 37 vs d20 9 + 4 + Lv 7 ÷ 5 = 1 = 22');
});

test('a record without the Levels mark replays as recorded: "Class II 4", and the Standard breakdown keeps its class term', () => {
    const old = readResolve(record({ rounds: [{ n: 1, lines: [{ kind: 'act', outcome: 'success', skill: 'Iaijutsu', pc: pc('Astra', { classValue: 2, classBonus: 4 }), foe: foeSide({ classValue: 1, classBonus: 2 }) }] }] }));
    assert.equal(old.rounds[0].lines[0].breakdown, 'd20 14 + AGI 5 + Class II 4 + Expert 2 = 37 vs d20 9 + 4 + Class I 2 = 22');
    const standard = readResolve(record({ rounds: [{ n: 1, lines: [{ kind: 'act', type: 'physical', outcome: 'success', skill: 'Iaijutsu',
        pc: pc('Astra', { classValue: 2, classBonus: 4, mainValue: 10, secondValue: 6, total: 29 }), foe: foeSide({ classValue: 4, classBonus: 12, total: 24 }) }] }] }));
    assert.match(standard.rounds[0].lines[0].breakdown, /\+ Class II 4 = 29 · vs Mud-Scale Crawlers d20 9 \+ 4 \+ Class IV 12 = 24/);
    const marked = readResolve(record({ lv: 1, rounds: [{ n: 1, lines: [{ kind: 'act', type: 'physical', outcome: 'success', skill: 'Iaijutsu',
        pc: pc('Astra', { mainValue: 10, secondValue: 6, total: 29 }), foe: foeSide({ total: 24 }) }] }] }));
    assert.match(marked.rounds[0].lines[0].breakdown, /\+ Lv 14 ÷ 5 = 2 = 29 · vs Mud-Scale Crawlers d20 9 \+ 4 \+ Lv 7 ÷ 5 = 1 = 24/);
});

test('the level pill is the app\'s small pill at 12px text and 20px tall, and the starting level field is narrow', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-level-pill \{[^}]*font-size: 12px;[^}]*height: 20px;/);
    assert.match(css, /\.rpg-wiz-level \{[^}]*width: 76px;/);
});
