// Fixture builders for valid and broken rules-v2 packs.

import { smallRulesPack } from './smallRulesPack.js';
import { RULES_V2_ERROR_CODES } from '../../../../../src/v2/packs/rules-v2.js';

export function makeValidExtendedPack() {
    const pack = smallRulesPack();

    // 7 renamed stat labels
    pack.content.rules[0].statLabels = {
        STR: 'Strength',
        VIT: 'Vitality',
        AGI: 'Agility',
        DEX: 'Dexterity',
        INT: 'Intelligence',
        LUK: 'Luck',
        CHA: 'Charisma',
    };

    // 3 items: 2H weapon, 1H dual-wield, and non-equipment consumable
    pack.content.items = [
        {
            slug: 'greatsword',
            name: 'Iron Greatsword',
            kind: 'equipment',
            rarity: 'common',
            value: 100,
            stack: false,
            slot: 'weapon',
            stats: { STR: 5 },
            effect: {},
            tags: ['weapon', 'two-handed'],
            note: 'A heavy 2H sword',
        },
        {
            slug: 'dagger',
            name: 'Steel Dagger',
            kind: 'equipment',
            rarity: 'common',
            value: 40,
            stack: false,
            slot: 'weapon',
            stats: { DEX: 3 },
            effect: {},
            tags: ['weapon', 'one-handed'],
            note: 'Can be wielded in either hand',
        },
        {
            slug: 'potion',
            name: 'Healing Salve',
            kind: 'consumable',
            rarity: 'common',
            value: 15,
            stack: true,
            slot: null,
            stats: {},
            effect: { heal: 30 },
            tags: ['healing'],
            note: 'Restores health',
        },
    ];

    // 1:1 itemRules coverage
    pack.content.rules[0].itemRules = [
        {
            def: 'greatsword',
            allowedSlots: ['weapon'],
            hands: 2,
            requires: { STR: 10 },
            weight: 80,
            unique: false,
        },
        {
            def: 'dagger',
            allowedSlots: ['weapon', 'offhand'],
            hands: 1,
            requires: { DEX: 8 },
            weight: 20,
            unique: false,
        },
        {
            def: 'potion',
            allowedSlots: [],
            hands: 0,
            requires: {},
            weight: 5,
            unique: false,
        },
    ];

    // 2 creatures (foes)
    pack.content.creatures = [
        {
            slug: 'goblin-scout',
            name: 'Goblin Scout',
            tier: 0,
            level: 1,
            stats: { STR: 5, VIT: 4, AGI: 7, DEX: 6, INT: 3, LUK: 4, CHA: 2 },
            skills: ['s00'],
            loot: [{ def: 'potion', chance: 40, qty: 1 }],
            loreTags: ['goblinoid', 'scout'],
        },
        {
            slug: 'orc-brute',
            name: 'Orc Brute',
            tier: 1,
            level: 5,
            stats: { STR: 12, VIT: 10, AGI: 5, DEX: 6, INT: 3, LUK: 4, CHA: 3 },
            skills: ['s10', 's11'],
            loot: [{ def: 'dagger', chance: 15, qty: 1 }],
            loreTags: ['orc', 'warrior'],
        },
    ];

    // 1 shop (place must be qualified ID pack.fixture/haven)
    pack.content.shops = [
        {
            slug: 'haven-armory',
            name: 'Haven Armory',
            place: 'pack.fixture/haven',
            kind: 'general',
            stock: [
                { item: 'greatsword', qty: 2, price: 120 },
                { item: 'potion', qty: 20, price: 15 },
            ],
        },
    ];

    // 1 recipe
    pack.content.recipes = [
        {
            slug: 'brew-potion',
            name: 'Brew Healing Salve',
            craft: 'alchemy',
            makes: 'potion',
            qty: 2,
            materials: [{ item: 'potion', qty: 1 }],
            fee: 5,
            minutes: 30,
            dc: 10,
            stat: 'INT',
            known: true,
        },
    ];

    // 1 quest
    pack.content.quests = [
        {
            slug: 'scout-threat',
            name: 'Neutralize Goblin Scout',
            category: 'bounty',
            giver: null,
            turnInPlace: 'pack.fixture/haven',
            requirements: [],
            objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'goblin-scout', count: 1 }],
            reward: { coin: 50, xp: 40, items: [{ def: 'potion', qty: 1 }] },
            durationMinutes: null,
            repeat: null,
            chain: null,
        },
    ];

    // 1 event for trainer eventTemplates
    pack.content.events = [
        {
            id: 'trial-combat',
            when: 'always',
            cue: 'Master blade training begins',
            once: true,
            then: [],
        },
    ];

    // 1 trainer (place must be pack.fixture/haven, eventTemplates must resolve to internal event)
    pack.content.rules[0].trainers = [
        {
            slug: 'weapon-master',
            name: 'Master Blade',
            place: 'pack.fixture/haven',
            skills: ['s30'],
            fee: 250,
            minutes: 60,
            eventTemplates: ['trial-combat'],
        },
    ];

    return pack;
}

export function makeBrokenPack(errorCode) {
    const pack = makeValidExtendedPack();

    switch (errorCode) {
        case RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN:
            pack.extraUnknownField = 'not-allowed';
            break;
        case RULES_V2_ERROR_CODES.BAD_CAPABILITY:
            pack.requires.capabilities = 'not-an-array';
            break;
        case RULES_V2_ERROR_CODES.UNSAFE_MARKUP:
            pack.content.rules[0].skills[0].name = 'Slash <script>alert(1)</script>';
            break;
        case RULES_V2_ERROR_CODES.UNSAFE_KEY:
            pack.content.rules[0].statLabels['constructor'] = 'Exploit';
            break;
        case RULES_V2_ERROR_CODES.CONTROL_CHARACTER:
            pack.content.rules[0].skills[0].name = 'Slash\x00Invalid';
            break;
        case RULES_V2_ERROR_CODES.DUP_ID:
            // duplicate skill slug
            pack.content.rules[0].skills[1].slug = pack.content.rules[0].skills[0].slug;
            break;
        case 'generated-collision':
            // branch slug ending with reserved -g
            pack.content.rules[0].branches[0].slug = 's30-base-g';
            break;
        case 'skill-generated-collision':
            // skill slug colliding with generated form
            pack.content.rules[0].skills[0].slug = 's30-base-g';
            break;
        case 'class-generated-collision':
            // class slug colliding with generated form
            pack.content.rules[0].classes[2].slug = 's30-base-g';
            pack.content.rules[0].classes[3].parent = 's30-base-g';
            break;
        case 'item-generated-collision':
            // item slug colliding with generated form
            pack.content.items[2].slug = 's30-base-g';
            pack.content.rules[0].itemRules[2].def = 's30-base-g';
            break;
        case RULES_V2_ERROR_CODES.TIER_CHAIN:
            // c2 skips c1 and points to c0
            pack.content.rules[0].classes[2].parent = 'c0';
            break;
        case 'cycle-class':
            // c1 points to c2, creating cycle c1 <-> c2
            pack.content.rules[0].classes[1].parent = 'c2';
            break;
        case 'orphan-class':
            pack.content.rules[0].classes[1].parent = 'nonexistent-class';
            break;
        case 'leaf-not-tier3':
            pack.content.rules[0].classes[3].tier = 2;
            break;
        case 'root-not-tier0':
            pack.content.rules[0].classes[0].tier = 1;
            break;
        case RULES_V2_ERROR_CODES.BAD_REF:
            pack.content.rules[0].classes[0].skills[0] = 'nonexistent-skill';
            break;
        case 'foreign-internal-ref':
            pack.content.rules[0].classes[0].skills[0] = 'pack.other/s00';
            break;
        case RULES_V2_ERROR_CODES.CLASS_SKILLS:
            // Duplicate skill inside same class
            pack.content.rules[0].classes[0].skills = ['s00', 's00', 's02'];
            break;
        case 'skills-count-2':
            pack.content.rules[0].classes[0].skills = ['s00', 's01'];
            break;
        case 'skills-count-4':
            pack.content.rules[0].classes[0].skills = ['s00', 's01', 's02', 's10'];
            break;
        case 'orphan-skill':
            // Append orphan unowned skill
            pack.content.rules[0].skills.push({
                slug: 'orphan-skill',
                name: 'Orphan Skill',
                base: {
                    type: 'physical',
                    stat: 'STR',
                    unit: null,
                    cost: { mp: 0, sp: 1, cooldown: 0 },
                    effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical' }],
                },
            });
            break;
        case RULES_V2_ERROR_CODES.BRANCH_GRAPH:
            // Missing step 1 branch 'b' for s30
            pack.content.rules[0].branches = pack.content.rules[0].branches.filter(
                b => !(b.skill === 's30' && b.step === 1 && b.choice === 'b')
            );
            break;
        case 'missing-step2-branch':
            // Drop step 2 branches from selected parents (base-a, base-b), leaving 12 written branches instead of 24
            pack.content.rules[0].branches = pack.content.rules[0].branches.filter(
                b => !(b.step === 2 && (b.fromForm.endsWith('-a') || b.fromForm.endsWith('-b')))
            );
            break;
        case 'unknown-kind':
            pack.content.unknownKind = [];
            break;
        case 'unaccounted-branch':
            // Append branch for nonexistent skill
            pack.content.rules[0].branches.push({
                slug: 's99-base-a',
                name: 'Phantom Branch',
                skill: 'nonexistent-skill',
                fromForm: 's99-base',
                step: 1,
                choice: 'a',
                transforms: [{ op: 'set-element', at: 0, value: 'fire' }],
            });
            break;
        case RULES_V2_ERROR_CODES.NUMERIC_RANGE:
            pack.content.rules[0].skills[0].base.effects[0].power = -50;
            break;
        case RULES_V2_ERROR_CODES.BAD_TRANSFORM:
            // transform at index 1 on single-effect array (0 is valid, 1 is out of range, within schema 0..3)
            pack.content.rules[0].branches[0].transforms = [
                { op: 'set-target', at: 1, value: 'all' },
            ];
            break;
        case RULES_V2_ERROR_CODES.NUMERIC_ONLY_BRANCH:
            // written branch only changing power (numeric-only)
            pack.content.rules[0].branches[0].transforms = [
                { op: 'set-power', at: 0, value: 90 },
            ];
            break;
        case RULES_V2_ERROR_CODES.BUDGET_CLOSURE:
            // power 990 exceeds budget
            pack.content.rules[0].branches[0].transforms = [
                { op: 'set-target', at: 0, value: 'all' },
                { op: 'set-power', at: 0, value: 990 },
            ];
            break;
        case RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH:
            // remove an itemRule leaving item without rule
            pack.content.rules[0].itemRules.pop();
            break;
        case 'item-rule-duplicate':
            // duplicate item rule for greatsword covering missing potion
            pack.content.rules[0].itemRules[2] = { ...pack.content.rules[0].itemRules[0] };
            break;
        case 'item-rule-2h-offhand':
            // 2H weapon cannot occupy offhand
            pack.content.rules[0].itemRules[0].allowedSlots = ['weapon', 'offhand'];
            break;
        case 'item-rule-non-equip-slot':
            // non-equipment item cannot have allowedSlots
            pack.content.rules[0].itemRules[2].allowedSlots = ['body'];
            break;
        case RULES_V2_ERROR_CODES.BAD_EFFECT:
            // damage effect with damageType null
            pack.content.rules[0].skills[0].base.effects[0].damageType = null;
            break;
        case RULES_V2_ERROR_CODES.MP_SP_CONFLICT:
            // physical form with mp > 0
            pack.content.rules[0].skills[0].base.cost.mp = 15;
            break;
        case RULES_V2_ERROR_CODES.BAD_XP_PER_LEVEL:
            return { pack, constants: { xpPerLevel: 95 } };
        case 'generated-legendary':
            return {
                pack,
                constants: undefined,
                form: {
                    id: 'pack.fixture/s30-base',
                    skill: 'pack.fixture/s30',
                    name: 'Step 0 Form',
                    step: 0,
                    origin: 'generated',
                    rarity: 'legendary',
                    tier: 3,
                    effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical' }],
                },
            };
        case RULES_V2_ERROR_CODES.BAD_SCHEMA:
            pack.content.rules[0].schema = 3;
            break;
        default:
            throw new Error(`Unknown errorCode for fixture builder: ${errorCode}`);
    }

    return { pack, constants: undefined };
}
