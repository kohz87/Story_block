// One valid pack that uses every effect kind, both unit kinds, every transform op, every quest
// objective kind and every quest requirement kind (RB_CONTRACT.md §10 D: "each effect variant").
// Built on the extended fixture; nothing here depends on the checker's own helpers.

import { makeValidExtendedPack } from './builders.js';

const damage = (power, target = 'one', element = 'none', damageType = 'physical') => ({ op: 'damage', target, power, element, damageType });
const condition = (kind, target, chance, rounds) => ({ op: 'condition', target, kind, chance, rounds });
const stat = (target, name, amount, rounds) => ({ op: 'stat', target, stat: name, amount, rounds });

/** Base definitions by skill slug; everything else keeps the small tree's plain physical damage. */
const BASES = {
    // tier 0, budget 12
    s01: { type: 'heal', stat: 'INT', unit: null, cost: { mp: 4, sp: 0, cooldown: 0 }, effects: [{ op: 'heal', target: 'self', power: 50, element: 'none', damageType: null }] },
    s02: { type: 'buff', stat: 'CHA', unit: null, cost: { mp: 3, sp: 0, cooldown: 1 }, effects: [stat('self', 'STR', 2, 2)] },
    // tier 1, budget 24
    s10: { type: 'magic', stat: 'INT', unit: null, cost: { mp: 6, sp: 0, cooldown: 0 }, effects: [damage(30, 'all', 'fire', 'magic')] },
    s11: { type: 'debuff', stat: 'INT', unit: null, cost: { mp: 5, sp: 0, cooldown: 2 }, effects: [condition('poison', 'one', 50, 3), stat('one', 'AGI', -2, 2)] },
    s12: {
        type: 'buff', stat: 'CHA', cost: { mp: 8, sp: 0, cooldown: 3 },
        unit: { kind: 'summon', class: 'c0', statShare: 50, poolShare: 50, rounds: 3 },
        effects: [{ op: 'shield', target: 'allies', power: 40, element: 'none', damageType: null }],
    },
    // tier 2, budget 36
    s20: {
        type: 'physical', stat: 'DEX', cost: { mp: 0, sp: 3, cooldown: 0 },
        unit: { kind: 'pet', class: 'c1', statShare: 30, poolShare: 40, rounds: 5 },
        effects: [damage(50)],
    },
    s21: { type: 'buff', stat: 'VIT', unit: null, cost: { mp: 7, sp: 0, cooldown: 4 }, effects: [condition('regen', 'allies', 100, 2), condition('guard', 'self', 25, 1)] },
    s22: { type: 'heal', stat: 'INT', unit: null, cost: { mp: 9, sp: 0, cooldown: 0 }, effects: [{ op: 'heal', target: 'ally', power: 60, element: 'holy', damageType: null }] },
    // tier 3, budget 48: three effects so every transform op has something to work on
    s30: { type: 'physical', stat: 'STR', unit: null, cost: { mp: 0, sp: 2, cooldown: 1 }, effects: [damage(40), condition('bleed', 'one', 50, 2), stat('one', 'AGI', -1, 2)] },
};

/** The eight written branches of s30, one per (parent, choice), covering all nine transform ops. */
const S30_BRANCHES = [
    { parent: 's30-base', step: 1, choice: 'a', transforms: [{ op: 'set-element', at: 0, value: 'fire' }, { op: 'set-power', at: 0, value: 70 }] },
    { parent: 's30-base', step: 1, choice: 'b', transforms: [{ op: 'remove-effect', at: 2 }, { op: 'add-effect', value: { op: 'heal', target: 'self', power: 30, element: 'none', damageType: null } }] },
    { parent: 's30-base-g', step: 2, choice: 'a', transforms: [{ op: 'set-target', at: 0, value: 'all' }] },
    { parent: 's30-base-g', step: 2, choice: 'b', transforms: [{ op: 'replace-effect', at: 1, value: condition('stun', 'one', 25, 1) }] },
    { parent: 's30-base-a', step: 2, choice: 'a', transforms: [{ op: 'set-stat', value: 'DEX' }] },
    { parent: 's30-base-a', step: 2, choice: 'b', transforms: [{ op: 'set-target', at: 2, value: 'all' }, { op: 'set-cost', value: { mp: 0, sp: 5, cooldown: 2 } }] },
    { parent: 's30-base-b', step: 2, choice: 'a', transforms: [{ op: 'set-type', value: 'magic' }, { op: 'set-cost', value: { mp: 6, sp: 0, cooldown: 0 } }] },
    { parent: 's30-base-b', step: 2, choice: 'b', transforms: [{ op: 'set-target', at: 2, value: 'allies' }] },
];

export function makeEveryKindPack() {
    const pack = makeValidExtendedPack();
    const rules = pack.content.rules[0];

    for (const skill of rules.skills) {
        if (BASES[skill.slug]) skill.base = JSON.parse(JSON.stringify(BASES[skill.slug]));
    }
    rules.branches = rules.branches.filter(branch => branch.skill !== 's30');
    S30_BRANCHES.forEach(({ parent, step, choice, transforms }) => {
        rules.branches.push({ slug: `${parent}-${choice}`, name: `${parent}-${choice}`, skill: 's30', fromForm: parent, step, choice, transforms });
    });

    pack.currency = { name: 'mark', plural: 'marks', short: 'm', coins: [{ name: 'penny', value: 1 }, { name: 'silver', value: 10 }] };

    pack.content.quests = [
        {
            slug: 'scout-threat', name: 'Neutralize Goblin Scout', category: 'bounty', giver: null, turnInPlace: 'pack.fixture/haven',
            requirements: [],
            objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'goblin-scout', count: 1 }],
            reward: { coin: 50, xp: 40, items: [{ def: 'potion', qty: 1 }] },
            durationMinutes: null, repeat: null, chain: { previous: null, next: 'supply-run' },
        },
        {
            slug: 'supply-run', name: 'Supply run', category: 'side', giver: 'np_00000007', turnInPlace: 'pack.fixture/mill',
            requirements: [
                { kind: 'level', min: 3 },
                { kind: 'stat', stat: 'STR', min: 8 },
                { kind: 'quest', template: 'scout-threat' },
                { kind: 'item', def: 'potion', qty: 2 },
                { kind: 'place', place: 'pack.fixture/mill' },
                { kind: 'thread', thread: 'th_00000001' },
                { kind: 'class', classes: ['c0', 'c1'] },
                { kind: 'flag', key: 'met-ranger', value: true },
            ],
            objectives: [
                { id: 'ob_00000002', kind: 'collect', def: 'potion', count: 3, consume: true },
                { id: 'ob_00000003', kind: 'visit', place: 'pl_00000009' },
                { id: 'ob_00000004', kind: 'story', text: 'Talk to the miller' },
                { id: 'ob_00000005', kind: 'kill', foe: 'orc-brute', count: 2 },
            ],
            reward: { coin: 100, xp: 80, items: [{ def: 'potion', qty: 2 }, { def: 'dagger', qty: 1 }] },
            durationMinutes: 600, repeat: { cooldownMinutes: 60 }, chain: { previous: 'scout-threat', next: null },
        },
    ];
    return pack;
}
