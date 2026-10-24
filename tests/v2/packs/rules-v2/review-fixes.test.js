// Review fixes F1-F10 for the rules pack v2 checker (RB_CONTRACT.md §7 and §10 D).
// Run: node --test "tests/v2/packs/rules-v2/*.test.js"
//
// The module is imported as a namespace so that a missing export fails its own test, not the file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as R from '../../../../src/v2/packs/rules-v2.js';
import { HOST_VERSION } from '../../../../src/v2/packs/validate.js';
// The validator before the rules kind was registered: the "old Story Block" of the F7 test (this host knows the kind now).
import { validatePack } from '../fixtures/old-host/validate.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { makeValidExtendedPack } from './fixtures/builders.js';
import { makeEveryKindPack } from './fixtures/everyKindPack.js';

const CODES = R.RULES_V2_ERROR_CODES;

/** Sets `value` at a path like `content.rules[0].classes[1].name`. */
function setPath(target, path, value) {
    const keys = path.split(/[.[\]]+/).filter(Boolean);
    let at = target;
    for (const key of keys.slice(0, -1)) at = at[key];
    at[keys.at(-1)] = value;
    return target;
}

const has = (res, code, path) => res.errors.some(e => e.code === code && (path === undefined || e.path === path));
const show = res => JSON.stringify(res.errors?.slice(0, 4));

// ---------------------------------------------------------------------------------------------
// F1: Story Block's own safety scan over every string and key
// ---------------------------------------------------------------------------------------------

const UNSAFE_TEXTS = [
    'javascript:alert(1)',
    'java&#x09;script:',
    '&#60;script&#62;',
    'data:text/html,x',
    'vbscript:msgbox(1)',
    'jav&#97;script:alert(1)',
    '&lt;img src=x onerror=alert(1)&gt;',
    'java\tscript:alert(1)',
    'see data:image/svg+xml,abc',
    '&amp;lt;b&amp;gt;',
];

const TEXT_SPOTS = [
    ['rules name', pack => pack.content.rules[0], 'name', 'content.rules[0].name'],
    ['class name', pack => pack.content.rules[0].classes[0], 'name', 'content.rules[0].classes[0].name'],
    ['class note', pack => pack.content.rules[0].classes[0], 'note', 'content.rules[0].classes[0].note'],
    ['skill name', pack => pack.content.rules[0].skills[0], 'name', 'content.rules[0].skills[0].name'],
    ['skill note', pack => pack.content.rules[0].skills[0], 'note', 'content.rules[0].skills[0].note'],
    ['branch name', pack => pack.content.rules[0].branches[0], 'name', 'content.rules[0].branches[0].name'],
    ['branch note', pack => pack.content.rules[0].branches[0], 'note', 'content.rules[0].branches[0].note'],
    ['stat label', pack => pack.content.rules[0].statLabels, 'STR', 'content.rules[0].statLabels.STR'],
    ['trainer name', pack => pack.content.rules[0].trainers[0], 'name', 'content.rules[0].trainers[0].name'],
    ['creature name', pack => pack.content.creatures[0], 'name', 'content.creatures[0].name'],
    ['creature loreTags', pack => pack.content.creatures[0].loreTags, 0, 'content.creatures[0].loreTags[0]'],
    ['quest name', pack => pack.content.quests[0], 'name', 'content.quests[0].name'],
    ['quest story objective', pack => pack.content.quests[1].objectives[2], 'text', 'content.quests[1].objectives[2].text'],
    ['quest flag key', pack => pack.content.quests[1].requirements[7], 'key', 'content.quests[1].requirements[7].key'],
    ['shop name', pack => pack.content.shops[0], 'name', 'content.shops[0].name'],
    ['recipe name', pack => pack.content.recipes[0], 'name', 'content.recipes[0].name'],
    ['item note', pack => pack.content.items[0], 'note', 'content.items[0].note'],
    ['place name', pack => pack.content.places[0], 'name', 'content.places[0].name'],
    ['envelope description', pack => pack, 'description', 'description'],
];

for (const [label, holder, key, path] of TEXT_SPOTS) {
    test(`F1: unsafe text is refused in ${label}`, () => {
        for (const text of UNSAFE_TEXTS) {
            const pack = makeEveryKindPack();
            pack.content.rules[0].statLabels = { STR: 'Strength' };
            holder(pack)[key] = text;
            const res = R.validateRulesPack(pack);
            assert.equal(res.ok, false, `${JSON.stringify(text)} in ${label} must be refused`);
            assert.ok(has(res, CODES.UNSAFE_MARKUP, path), `${JSON.stringify(text)}: expected unsafe-markup at ${path}, got ${show(res)}`);
        }
    });
}

test('F1: unsafe text in a key is refused', () => {
    for (const key of ['javascript:x', '&#60;script&#62;', 'a<b']) {
        const pack = makeEveryKindPack();
        pack.content.items[0].effect = { [key]: 1 };
        const res = R.validateRulesPack(pack);
        assert.equal(res.ok, false, key);
        assert.ok(has(res, CODES.UNSAFE_MARKUP), `${key}: ${show(res)}`);
    }
});

test('F1: the other entry points scan strings too', () => {
    const pack = makeEveryKindPack();
    const manifest = JSON.parse(JSON.stringify(pack.content.rules[0]));
    manifest.skills[0].name = 'javascript:alert(1)';
    const norm = R.normalizeRulesV2(manifest, { packKey: 'fixture' });
    assert.equal(norm.ok, false);
    assert.ok(has(norm, CODES.UNSAFE_MARKUP, 'content.rules[0].skills[0].name'), show(norm));

    const good = R.normalizeRulesV2(pack.content.rules[0], { packKey: 'fixture' });
    assert.equal(good.ok, true);
    const content = JSON.parse(JSON.stringify(pack.content));
    delete content.rules;
    content.creatures[0].name = 'data:text/html,x';
    for (const run of [R.validateRulesV2, R.expandRulesV2]) {
        const res = run(good.manifest, content);
        assert.equal(res.ok, false);
        assert.ok(has(res, CODES.UNSAFE_MARKUP, 'content.creatures[0].name'), show(res));
    }

    const form = { ...R.validateRulesPack(pack).resolved.forms['pack.fixture/s30-base'], name: 'java&#x09;script:x' };
    assert.equal(R.powerScore(form).ok, false);
    assert.equal(R.generatePowerUp(form).ok, false);
});

test('F1: harmless text with schemes-like words, ampersands and punctuation still passes', () => {
    const pack = makeEveryKindPack();
    pack.content.rules[0].classes[0].name = 'Fire & Ice (x2)';
    pack.content.rules[0].classes[0].note = 'javascript is a language; data tables; R&D; AT&amp;T';
    const res = R.validateRulesPack(pack);
    assert.equal(res.ok, true, show(res));
});

// ---------------------------------------------------------------------------------------------
// F2: nothing exported throws
// ---------------------------------------------------------------------------------------------

test('F2: entries of owned content must be plain objects with a string slug', () => {
    const good = R.normalizeRulesV2(smallRulesPack().content.rules[0], { packKey: 'fixture' });
    assert.equal(good.ok, true);
    const base = () => {
        const content = JSON.parse(JSON.stringify(smallRulesPack().content));
        delete content.rules;
        return content;
    };
    for (const kind of ['items', 'creatures', 'quests', 'shops', 'recipes', 'places', 'events']) {
        for (const entry of [null, 5, 'x', [], undefined]) {
            const content = base();
            content[kind] = [entry];
            for (const run of [R.validateRulesV2, R.expandRulesV2]) {
                let res;
                assert.doesNotThrow(() => { res = run(good.manifest, content); }, `${kind}:[${String(entry)}]`);
                assert.equal(res.ok, false, `${kind}:[${String(entry)}]`);
                assert.ok(res.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string'));
            }
        }
    }
    for (const kind of ['items', 'creatures', 'quests', 'shops', 'recipes', 'places']) {
        for (const entry of [{}, { slug: 5 }, { slug: '' }]) {
            const content = base();
            content[kind] = [entry];
            const res = R.validateRulesV2(good.manifest, content);
            assert.equal(res.ok, false, `${kind}:${JSON.stringify(entry)}`);
        }
    }
    const events = base();
    events.events = [{ id: 7 }];
    assert.equal(R.validateRulesV2(good.manifest, events).ok, false);
    const ok = base();
    ok.events = [{ id: 'trial' }, { slug: 'other' }, {}];
    assert.equal(R.validateRulesV2(good.manifest, ok).ok, true);

    for (const kind of ['items', 'places', 'events']) {
        const pack = smallRulesPack();
        pack.content[kind] = [null];
        let res;
        assert.doesNotThrow(() => { res = R.validateRulesPack(pack); });
        assert.equal(res.ok, false, kind);
        assert.equal(R.exportRulesV2(pack).ok, false, kind);
    }
});

function hostileValues() {
    const revoked = (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })();
    const revokedArray = (() => { const { proxy, revoke } = Proxy.revocable([], {}); revoke(); return proxy; })();
    const trapThrows = new Proxy(Object.create(null), { get: () => () => { throw new Error('trap'); } });
    const throwingObject = new Proxy({}, trapThrows);
    const throwingArray = new Proxy([], trapThrows);
    const throwingOwnKeys = new Proxy({ a: 1 }, { ownKeys() { throw new Error('ownKeys'); } });
    const throwingDescriptor = new Proxy({ a: 1 }, { getOwnPropertyDescriptor() { throw new Error('descriptor'); } });
    const throwingPrototype = new Proxy({ a: 1 }, { getPrototypeOf() { throw new Error('prototype'); } });
    let getterRan = false;
    const getter = { get name() { getterRan = true; throw new Error('getter ran'); } };
    const cycle = { a: {} };
    cycle.a.back = cycle;
    const cycleArray = [];
    cycleArray.push(cycleArray);
    let deepObject = {};
    for (let i = 0, at = deepObject; i < 20000; i++) { at.x = {}; at = at.x; }
    let deepArray = [];
    for (let i = 0; i < 100000; i++) deepArray = [deepArray];
    let dag = { leaf: 1 };
    for (let d = 0; d < 8; d++) {
        const next = {};
        for (let k = 0; k < 10; k++) next[`k${k}`] = dag;
        dag = next;
    }
    const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
    const extra = [1, 2];
    extra.note = 'x';
    const hidden = {};
    Object.defineProperty(hidden, 'h', { value: 1, enumerable: false });
    return {
        values: {
            revoked, revokedArray, throwingObject, throwingArray, throwingOwnKeys, throwingDescriptor, throwingPrototype,
            getter, cycle, cycleArray, deepObject, deepArray, dag, sparse, extra, hidden,
            symbolKey: { [Symbol('s')]: 1 }, date: new Date(), map: new Map(), fn: () => 1, symbol: Symbol('x'), bigint: 10n,
            nan: { a: NaN }, infinity: [Infinity], undef: { a: undefined }, bytes: new Uint8Array(3),
            wide: Array.from({ length: 1001 }, () => 0), manyKeys: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, 0])),
            hugeString: 'x'.repeat(4001), nullProto: Object.assign(Object.create(null), { a: 1 }),
        },
        getterRan: () => getterRan,
    };
}

test('F2: every exported function returns a stable error for hostile input in every argument', () => {
    const pack = makeValidExtendedPack();
    const norm = R.normalizeRulesV2(pack.content.rules[0], { packKey: 'fixture' }).manifest;
    const content = JSON.parse(JSON.stringify(pack.content));
    delete content.rules;
    const resolved = R.validateRulesPack(pack).resolved;
    const form = JSON.parse(JSON.stringify(resolved.forms['pack.fixture/s30-base']));

    // One entry per function, listing its valid arguments. A new export without an entry fails below.
    const signatures = {
        sha256: [['abc']],
        canonicalizeJson: [[{ a: 1 }]],
        powerScore: [[form]],
        budgetOf: [[]],
        generatePowerUp: [[form, R.RULES_V2_CONSTANTS]],
        normalizeRulesV2: [[pack.content.rules[0], { packKey: 'fixture' }]],
        validateRulesV2: [[norm, content, R.RULES_V2_CONSTANTS]],
        expandRulesV2: [[norm, content, R.RULES_V2_CONSTANTS]],
        exportRulesV2: [[pack, R.RULES_V2_CONSTANTS]],
        validateRulesPack: [[pack, { constants: R.RULES_V2_CONSTANTS }]],
        checkResolvedLimits: [[resolved, R.RULES_V2_LIMITS]],
    };
    const exported = Object.entries(R).filter(([, value]) => typeof value === 'function').map(([name]) => name).sort();
    assert.deepEqual(exported, Object.keys(signatures).sort(), 'every exported function needs hostile-input coverage here');

    // Where success is the right answer: sha256 hashes strings and bytes, canonicalizeJson canonicalises
    // plain data, and an options bag that is not a plain object (anything but a Proxy or a bad graph) is ignored.
    const succeeds = {
        sha256: ['hugeString', 'bytes'],
        canonicalizeJson: ['nullProto'],
    };
    const ignoredOptions = ['fn', 'symbol', 'bigint', 'hugeString', 'nullProto', 'cycleArray', 'throwingArray', 'deepArray', 'sparse', 'extra', 'wide', 'infinity'];
    const optionPositions = new Set(['validateRulesPack:1', 'normalizeRulesV2:1']);

    const { values, getterRan } = hostileValues();
    for (const [name, [valid]] of Object.entries(signatures)) {
        for (let position = 0; position < valid.length; position++) {
            for (const [label, hostile] of Object.entries(values)) {
                const args = valid.slice();
                args[position] = hostile;
                let result;
                assert.doesNotThrow(() => { result = R[name](...args); }, `${name} arg ${position} threw on ${label}`);
                if (name === 'budgetOf' || name === 'checkResolvedLimits' && position === 1) continue;
                const mayPass = (succeeds[name] ?? []).includes(label) && position === 0
                    || optionPositions.has(`${name}:${position}`) && ignoredOptions.includes(label);
                if (mayPass) continue;
                assert.ok(result && result.ok === false, `${name} arg ${position} on ${label} must fail, got ${show(result)}`);
                assert.ok(Array.isArray(result.errors) && result.errors.length > 0, `${name} ${label}`);
                for (const error of result.errors) {
                    assert.equal(typeof error.code, 'string');
                    assert.equal(typeof error.path, 'string');
                    assert.equal(typeof error.message, 'string');
                }
            }
        }
    }
    assert.equal(getterRan(), false, 'no accessor of the input may run');
});

test('F2: the failure results are stable', () => {
    const { values } = hostileValues();
    assert.equal(R.powerScore(values.revoked).errors[0].code, CODES.BAD_FORM);
    assert.equal(R.generatePowerUp(values.revoked).errors[0].code, CODES.BAD_RULES);
    for (const name of ['validateRulesPack', 'exportRulesV2', 'canonicalizeJson', 'sha256', 'normalizeRulesV2', 'validateRulesV2', 'expandRulesV2']) {
        const result = R[name](values.revoked);
        assert.deepEqual(Object.keys(result).sort(), ['errors', 'ok'], name);
        assert.equal(result.errors[0].code, CODES.BAD_SCHEMA, name);
    }
    assert.ok(R.validateRulesPack(values.cycle).errors.some(e => /Circular/.test(e.message)));
    assert.ok(R.validateRulesPack(values.deepObject).errors.some(e => e.code === CODES.TOO_LARGE));
    assert.ok(R.validateRulesPack(values.symbolKey).errors.some(e => e.code === CODES.BAD_SCHEMA));
    assert.ok(R.validateRulesPack(values.getter).errors.some(e => /accessor/.test(e.message)));
});

test('F2: hostile text input to validateRulesPack never throws', () => {
    for (const text of ['[' .repeat(200000), '{"a":'.repeat(50000), '{"a":1,'.repeat(1000), '\u0000', '"' + 'x'.repeat(600000) + '"', '{"id":"\\ud800"}']) {
        let res;
        assert.doesNotThrow(() => { res = R.validateRulesPack(text); });
        assert.equal(res.ok, false);
    }
});

// ---------------------------------------------------------------------------------------------
// F3: references that carry this pack's own prefix must resolve here
// ---------------------------------------------------------------------------------------------

const PLACE_SPOTS = [
    ['shop.place', pack => pack.content.shops[0], 'place', 'content.shops[0].place'],
    ['trainer.place', pack => pack.content.rules[0].trainers[0], 'place', 'content.rules[0].trainers[0].place'],
    ['quest.turnInPlace', pack => pack.content.quests[1], 'turnInPlace', 'content.quests[1].turnInPlace'],
    ['visit objective place', pack => pack.content.quests[1].objectives[1], 'place', 'content.quests[1].objectives[1].place'],
    ['place requirement', pack => pack.content.quests[1].requirements[4], 'place', 'content.quests[1].requirements[4].place'],
];

for (const [label, holder, key, path] of PLACE_SPOTS) {
    test(`F3: ${label} resolves locally, or is a pl_ id or another pack's id`, () => {
        const check = value => {
            const pack = makeEveryKindPack();
            holder(pack)[key] = value;
            return R.validateRulesPack(pack);
        };
        assert.equal(check('pack.fixture/haven').ok, true, 'a place of this pack');
        assert.equal(check('pl_0000abcd').ok, true, 'a canonical place id');
        const foreign = check('pack.world/harbor');
        assert.equal(foreign.ok, true, "another pack's place is external");
        assert.ok(foreign.warnings.some(w => w.path === path), 'external places are reported as warnings');
        for (const bad of ['pack.fixture/nowhere', 'pack.fixture/s00', 'np_00000001', 'th_00000001', 'pl_000', 'story/haven']) {
            const res = check(bad);
            assert.equal(res.ok, false, `${bad} must be refused`);
            assert.ok(has(res, CODES.BAD_REF, path) || has(res, CODES.BAD_SCHEMA, path), `${bad}: ${show(res)}`);
        }
        // An unresolved own-prefix place is specifically a bad reference (not a schema complaint).
        assert.ok(has(check('pack.fixture/nowhere'), CODES.BAD_REF, path));
    });
}

test('F3: quest.giver resolves to a creature of this pack, an np_ id or another pack', () => {
    const check = value => {
        const pack = makeEveryKindPack();
        pack.content.quests[1].giver = value;
        return R.validateRulesPack(pack);
    };
    assert.equal(check('pack.fixture/goblin-scout').ok, true);
    assert.equal(check('np_0000abcd').ok, true);
    assert.equal(check('pack.world/innkeeper').ok, true);
    for (const bad of ['pack.fixture/nobody', 'pack.fixture/haven', 'pl_00000001', 'th_00000001']) {
        const res = check(bad);
        assert.equal(res.ok, false, bad);
        assert.ok(has(res, CODES.BAD_REF, 'content.quests[1].giver'), `${bad}: ${show(res)}`);
    }
});

test('F3: a thread requirement is a th_ id and nothing else', () => {
    const check = value => {
        const pack = makeEveryKindPack();
        pack.content.quests[1].requirements[5].thread = value;
        return R.validateRulesPack(pack);
    };
    assert.equal(check('th_0000abcd').ok, true);
    for (const bad of ['pack.fixture/anything', 'pack.world/x', 'np_00000001', 'pl_00000001']) {
        const res = check(bad);
        assert.equal(res.ok, false, bad);
        assert.ok(has(res, CODES.BAD_REF, 'content.quests[1].requirements[5].thread'), `${bad}: ${show(res)}`);
    }
});

// ---------------------------------------------------------------------------------------------
// F4: item slot versus rule slots
// ---------------------------------------------------------------------------------------------

function gearPack(slot, allowedSlots, hands = 0) {
    const pack = makeValidExtendedPack();
    pack.content.items.push({ slug: 'trinket', name: 'Trinket', kind: 'equipment', rarity: 'common', value: 5, stack: false, slot, stats: {}, effect: {}, tags: [], note: '' });
    pack.content.rules[0].itemRules.push({ def: 'trinket', allowedSlots, hands, requires: {}, weight: 1, unique: false });
    return pack;
}

test('F4: a legacy free-text item slot is left to the rule', () => {
    for (const [slot, allowedSlots] of [['ring', ['accessory-1']], ['chest', ['body']], ['boots', ['feet']], ['helm', ['head', 'legs']], [null, ['head']]]) {
        const res = R.validateRulesPack(gearPack(slot, allowedSlots));
        assert.equal(res.ok, true, `${slot} / ${allowedSlots}: ${show(res)}`);
    }
});

test('F4: a standard item slot must be one the rule allows', () => {
    for (const slot of R.RULES_V2_SLOTS) {
        const matching = R.validateRulesPack(gearPack(slot, [slot], slot === 'weapon' || slot === 'offhand' ? 1 : 0));
        assert.equal(matching.ok, true, `${slot}: ${show(matching)}`);
        const other = slot === 'head' ? 'body' : 'head';
        const clash = R.validateRulesPack(gearPack(slot, [other]));
        assert.equal(clash.ok, false, `${slot} against ${other}`);
        assert.ok(has(clash, CODES.ITEM_RULE_MISMATCH, 'content.rules[0].itemRules[3].allowedSlots'), show(clash));
    }
});

// ---------------------------------------------------------------------------------------------
// F5: keys are NFC, free of controls, and collision-free
// ---------------------------------------------------------------------------------------------

test('F5: NFC and NFD spellings of a key give the same export and hashes', () => {
    const build = key => {
        const pack = makeEveryKindPack();
        pack.content.items[0].effect = { [key]: 1 };
        pack.content.items[1].stats = { [key]: 2 };
        return pack;
    };
    const nfc = R.exportRulesV2(build('café'));
    const nfd = R.exportRulesV2(build('café'));
    assert.equal(nfc.ok, true, show(nfc));
    assert.equal(nfd.ok, true, show(nfd));
    assert.equal(nfc.text, nfd.text);
    assert.equal(nfc.rulesHash, nfd.rulesHash);
    assert.equal(nfc.packHash, nfd.packHash);
    assert.ok(nfd.text.includes('"café"'), 'the export holds the NFC key');
    assert.ok(!nfd.text.includes('café'));
    assert.equal(R.validateRulesPack(build('café')).packHash, nfc.packHash);
    assert.deepEqual(Object.keys(R.validateRulesPack(build('café')).pack.content.items[0].effect), ['café']);
});

test('F5: canonicalizeJson normalises and sorts keys', () => {
    const out = R.canonicalizeJson({ z: 1, 'café': { b: 1, a: 2 } });
    assert.deepEqual(Object.keys(out), ['café', 'z']);
    assert.deepEqual(Object.keys(out['café']), ['a', 'b']);
});

test('F5: a control character in a key is refused', () => {
    for (const key of ['bad\u0007key', 'tab\tkey', 'new\nline', 'del\u007fkey', 'nul\u0000']) {
        const pack = makeEveryKindPack();
        pack.content.items[0].effect = { [key]: 1 };
        const res = R.validateRulesPack(pack);
        assert.equal(res.ok, false, JSON.stringify(key));
        assert.ok(has(res, CODES.CONTROL_CHARACTER), show(res));
        assert.equal(R.canonicalizeJson({ [key]: 1 }).ok, false, `canonicalizeJson ${JSON.stringify(key)}`);
    }
    // The same key inside JSON text.
    const text = JSON.stringify(makeEveryKindPack()).replace('"heal":30', '"heal\\u0007":30');
    assert.ok(text.includes('heal\\u0007'));
    assert.ok(has(R.validateRulesPack(text), CODES.CONTROL_CHARACTER));
});

test('F5: keys that collide after normalisation are refused', () => {
    // In what the checker owns (the manifest and its definitions); Story Block's own fields (an item's effect) are Story Block's to judge.
    const pack = makeEveryKindPack();
    pack.content.rules[0].statLabels = Object.fromEntries([['caf\u00e9', 'a'], ['cafe\u0301', 'b']]);
    const res = R.validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(has(res, CODES.DUP_ID), show(res));
    assert.equal(R.canonicalizeJson({ 'café': 1, 'café': 2 }).ok, false);
    assert.equal(R.exportRulesV2(pack).ok, false);
});

// ---------------------------------------------------------------------------------------------
// F6: duplicate keys in JSON text
// ---------------------------------------------------------------------------------------------

test('F6: a duplicate key in JSON text is refused with dup-id', () => {
    const text = JSON.stringify(smallRulesPack());
    const dupName = text.replace(/^\{/, '{"name":"First",');
    assert.ok(dupName.indexOf('"name":"First"') < dupName.indexOf('"name":"Fixture"'));
    let res = R.validateRulesPack(dupName);
    assert.equal(res.ok, false);
    assert.ok(has(res, CODES.DUP_ID, 'name'), show(res));

    const dupSchema = text.replace('"schema":2', '"schema":2,"schema":2');
    assert.notEqual(dupSchema, text);
    res = R.validateRulesPack(dupSchema);
    assert.equal(res.ok, false);
    assert.ok(has(res, CODES.DUP_ID, 'content.rules[0].schema'), show(res));

    // Escaped spellings are the same key; array positions appear in the path.
    res = R.validateRulesPack(text.replace(/^\{/, '{"\\u006eame":"First",'));
    assert.ok(has(res, CODES.DUP_ID, 'name'), show(res));
    res = R.validateRulesPack(text.replace('"slug":"s00"', '"slug":"s00","slug":"s00"'));
    assert.ok(has(res, CODES.DUP_ID, 'content.rules[0].skills[0].slug'), show(res));
    assert.equal(R.exportRulesV2(dupName).ok, false);
});

test('F6: the same key in different objects, and keys inside strings, are not duplicates', () => {
    const pack = smallRulesPack();
    pack.description = 'a "name":"x","name":"y" in text';
    const text = JSON.stringify(pack, null, 1);
    const res = R.validateRulesPack(text);
    assert.equal(res.ok, true, show(res));
    assert.equal(R.validateRulesPack(`﻿${text}`).ok, true, 'a BOM is tolerated like Story Block does');
    assert.equal(R.validateRulesPack(text).packHash, R.validateRulesPack(pack).packHash);
});

// ---------------------------------------------------------------------------------------------
// F7: the rb-rules-v2 capability
// ---------------------------------------------------------------------------------------------

test('F7: content.rules without the rb-rules-v2 capability is MISSING_CAPABILITY', () => {
    assert.equal(R.RULES_V2_CAPABILITY, 'rb-rules-v2');
    for (const capabilities of [[], ['story-director'], ['story-director', 'rpg-battle'], undefined]) {
        const pack = smallRulesPack();
        if (capabilities === undefined) delete pack.requires.capabilities;
        else pack.requires.capabilities = capabilities;
        const res = R.validateRulesPack(pack);
        assert.equal(res.ok, false, JSON.stringify(capabilities));
        assert.ok(has(res, 'MISSING_CAPABILITY', 'requires.capabilities'), show(res));
        assert.equal(R.exportRulesV2(pack).ok, false);
    }
    const pack = smallRulesPack();
    pack.requires.capabilities = ['story-director', 'rb-rules-v2'];
    assert.equal(R.validateRulesPack(pack).ok, true);
    pack.requires.capabilities = 'rb-rules-v2';
    assert.ok(has(R.validateRulesPack(pack), CODES.BAD_CAPABILITY));
});

test('F7: section 10 D old Story Block fixture (the frozen old validator): UNKNOWN_KIND, and MISSING_CAPABILITY when capabilities are supplied', () => {
    const pack = smallRulesPack();
    const unknownHost = validatePack(JSON.parse(JSON.stringify(pack)), { hostVersion: HOST_VERSION, capabilities: null });
    assert.equal(unknownHost.ok, false);
    assert.ok(unknownHost.errors.some(e => e.code === 'UNKNOWN_KIND' && e.path === 'content.rules'), show(unknownHost));
    assert.ok(!unknownHost.errors.some(e => e.code === 'MISSING_CAPABILITY'), 'with capabilities null the form is all that is checked');

    const oldHost = validatePack(JSON.parse(JSON.stringify(pack)), { hostVersion: HOST_VERSION, capabilities: ['story-director', 'rpg-battle'] });
    assert.equal(oldHost.ok, false);
    assert.ok(oldHost.errors.some(e => e.code === 'UNKNOWN_KIND' && e.path === 'content.rules'), show(oldHost));
    assert.ok(oldHost.errors.some(e => e.code === 'MISSING_CAPABILITY' && e.path === 'requires.capabilities'), show(oldHost));

    // The checker reports the same missing capability for a host that lacks it, and passes on a host that has it.
    const lacking = R.validateRulesPack(pack, { capabilities: ['story-director', 'rpg-battle'] });
    assert.ok(has(lacking, 'MISSING_CAPABILITY', 'requires.capabilities'), show(lacking));
    assert.equal(R.validateRulesPack(pack, { capabilities: ['story-director', 'rpg-battle', 'rb-rules-v2'] }).ok, true);
});

// ---------------------------------------------------------------------------------------------
// F8: shared references cannot blow up the safety walk
// ---------------------------------------------------------------------------------------------

test('F8: a width-10, depth-8 shared-reference graph is refused quickly with too-large', () => {
    let dag = { leaf: 1 };
    for (let d = 0; d < 8; d++) {
        const next = {};
        for (let k = 0; k < 10; k++) next[`k${k}`] = dag;
        dag = next;
    }
    const pack = smallRulesPack();
    pack.content.items = [{ slug: 'trap', name: 'Trap', kind: 'goods', effect: dag }];
    for (const run of [() => R.validateRulesPack(pack), () => R.exportRulesV2(pack), () => R.canonicalizeJson(dag), () => R.validateRulesV2({}, { items: [{ slug: 'x', effect: dag }] })]) {
        const started = Date.now();
        const res = run();
        assert.ok(Date.now() - started < 2000, 'must return quickly');
        assert.equal(res.ok, false);
        assert.ok(has(res, CODES.TOO_LARGE), show(res));
    }
    assert.equal(R.RULES_V2_LIMITS.nodes, 100000);
});

test('F8: shared references that stay within the node budget are allowed', () => {
    const pack = smallRulesPack();
    const shared = { STR: 1 };
    pack.content.items = [
        { slug: 'one', name: 'One', kind: 'goods', stats: shared },
        { slug: 'two', name: 'Two', kind: 'goods', stats: shared },
    ];
    pack.content.rules[0].itemRules = [
        { def: 'one', allowedSlots: [], hands: 0, requires: {}, weight: 1 },
        { def: 'two', allowedSlots: [], hands: 0, requires: {}, weight: 1 },
    ];
    assert.equal(R.validateRulesPack(pack).ok, true);
});

// ---------------------------------------------------------------------------------------------
// F9: rulesHash and packHash
// ---------------------------------------------------------------------------------------------

test('F9: rulesHash is the contract H, packHash covers the whole pack; both are stable and different', () => {
    const pack = makeEveryKindPack();
    const checked = R.validateRulesPack(pack);
    assert.equal(checked.ok, true, show(checked));
    assert.match(checked.rulesHash, /^[0-9a-f]{64}$/);
    assert.match(checked.packHash, /^[0-9a-f]{64}$/);
    assert.notEqual(checked.rulesHash, checked.packHash);
    assert.equal('hash' in checked, false, 'the ambiguous name is gone');

    const exported = R.exportRulesV2(pack);
    assert.equal(exported.rulesHash, checked.rulesHash);
    assert.equal(exported.packHash, checked.packHash);

    const norm = R.normalizeRulesV2(pack.content.rules[0], { packKey: 'fixture' });
    const content = { ...pack.content };
    const expanded = R.expandRulesV2(norm.manifest, content);
    assert.equal(expanded.ok, true, show(expanded));
    assert.equal(expanded.rulesHash, checked.rulesHash, 'expandRulesV2 computes the same rulesHash');
    assert.equal('hash' in expanded, false);

    // Stable across repeated runs, across import of the export, and across key order.
    assert.equal(R.validateRulesPack(pack).packHash, checked.packHash);
    const again = R.exportRulesV2(exported.text);
    assert.equal(again.text, exported.text);
    assert.equal(again.rulesHash, checked.rulesHash);
    assert.equal(again.packHash, checked.packHash);
    const shuffle = value => {
        if (Array.isArray(value)) return value.map(shuffle);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, shuffle(v)]));
        return value;
    };
    const shuffled = R.exportRulesV2(shuffle(pack));
    assert.equal(shuffled.text, exported.text);
    assert.equal(shuffled.rulesHash, checked.rulesHash);
    assert.equal(shuffled.packHash, checked.packHash);
});

test('F9: the envelope changes packHash only; the rules or the constants change both', () => {
    const base = R.validateRulesPack(makeEveryKindPack());
    const envelope = makeEveryKindPack();
    envelope.version = '2.1.0';
    envelope.name = 'Another name';
    const changedEnvelope = R.validateRulesPack(envelope);
    assert.equal(changedEnvelope.rulesHash, base.rulesHash, 'the contract H ignores the envelope');
    assert.notEqual(changedEnvelope.packHash, base.packHash);

    const rules = makeEveryKindPack();
    rules.content.rules[0].skills[0].name = 'Renamed';
    const changedRules = R.validateRulesPack(rules);
    assert.notEqual(changedRules.rulesHash, base.rulesHash);
    assert.notEqual(changedRules.packHash, base.packHash);

    const content = makeEveryKindPack();
    content.content.creatures[0].name = 'Renamed foe';
    assert.notEqual(R.validateRulesPack(content).rulesHash, base.rulesHash);

    const constants = R.validateRulesPack(makeEveryKindPack(), { constants: { xpPerLevel: 200 } });
    assert.notEqual(constants.rulesHash, base.rulesHash);
    assert.notEqual(constants.packHash, base.packHash);
});

// ---------------------------------------------------------------------------------------------
// F10: defaults, -0, paths, collisions, self links, imports
// ---------------------------------------------------------------------------------------------

test('F10: currency defaults (coins [], display mixed) are applied so equivalent packs hash the same', () => {
    const plain = makeEveryKindPack();
    plain.currency = { name: 'mark', plural: 'marks', short: 'm' };
    const explicit = makeEveryKindPack();
    explicit.currency = { name: 'mark', plural: 'marks', short: 'm', coins: [], display: 'mixed' };
    const a = R.validateRulesPack(plain);
    const b = R.validateRulesPack(explicit);
    assert.equal(a.ok, true, show(a));
    assert.equal(b.ok, true, show(b));
    assert.deepEqual(a.pack.currency, { name: 'mark', plural: 'marks', short: 'm', coins: [], display: 'mixed' });
    assert.equal(R.exportRulesV2(plain).text, R.exportRulesV2(explicit).text);
    assert.equal(a.packHash, b.packHash);
    assert.equal(a.rulesHash, b.rulesHash);
    assert.ok(R.exportRulesV2(plain).text.includes('"display": "mixed"'));

    // The export imports again (Story Block's own currency check does not see the defaults).
    const roundTrip = R.exportRulesV2(R.exportRulesV2(plain).text);
    assert.equal(roundTrip.ok, true, show(roundTrip));
    assert.equal(roundTrip.packHash, a.packHash);

    const base = makeEveryKindPack();
    base.currency = { name: 'mark', display: 'base' };
    assert.notEqual(R.validateRulesPack(base).packHash, R.validateRulesPack(plain).packHash);
    base.currency.display = 'fancy';
    assert.ok(has(R.validateRulesPack(base), CODES.BAD_SCHEMA, 'currency.display'));

    const none = makeEveryKindPack();
    delete none.currency;
    assert.equal(R.validateRulesPack(none).pack.currency, undefined, 'no currency stays no currency');

    const coins = R.validateRulesPack(makeEveryKindPack());
    assert.equal(coins.ok, true);
    assert.equal(coins.pack.currency.coins.length, 2);
    assert.equal(coins.pack.currency.display, 'mixed');
});

test('F10: -0 becomes 0 everywhere', () => {
    const pack = makeEveryKindPack();
    pack.content.rules[0].itemRules[2].weight = -0;
    pack.content.rules[0].skills[0].base.cost.cooldown = -0;
    pack.content.quests[0].reward.coin = -0;
    const res = R.validateRulesPack(pack);
    assert.equal(res.ok, true, show(res));
    assert.ok(Object.is(res.pack.content.rules[0].itemRules[2].weight, 0));
    assert.ok(Object.is(res.resolved.items['pack.fixture/potion'].weight, 0));
    assert.ok(Object.is(res.resolved.manifest.skills[0].base.cost.cooldown, 0));
    assert.ok(Object.is(res.resolved.quests['pack.fixture/scout-threat'].reward.coin, 0));
    assert.ok(Object.is(res.raw.content.quests[0].reward.coin, 0));
    assert.ok(Object.is(R.canonicalizeJson({ a: [-0] }).a[0], 0));
    const text = JSON.stringify(smallRulesPack()).replace('"mp":0', '"mp":-0');
    const parsed = R.validateRulesPack(text);
    assert.equal(parsed.ok, true);
    assert.ok(Object.is(parsed.pack.content.rules[0].skills[0].base.cost.mp, 0));
    assert.equal(parsed.packHash, R.validateRulesPack(smallRulesPack()).packHash);
});

test('F10: error paths always start at content.rules[0] for the manifest', () => {
    const norm = R.normalizeRulesV2({ ...smallRulesPack().content.rules[0], schema: 3 }, { packKey: 'fixture' });
    assert.ok(has(norm, CODES.BAD_SCHEMA, 'content.rules[0].schema'), show(norm));
    const noClasses = R.normalizeRulesV2({ ...smallRulesPack().content.rules[0], classes: [] }, { packKey: 'fixture' });
    assert.ok(noClasses.errors.every(e => e.path.startsWith('content.rules[0]')), show(noClasses));
    assert.ok(R.normalizeRulesV2(null, { packKey: 'fixture' }).errors[0].path.startsWith('content.rules[0]'));
    const wrapper = smallRulesPack().content.rules[0];
    wrapper.classes[0].id = 'Not An Id';
    assert.ok(has(R.normalizeRulesV2(wrapper, { packKey: 'fixture' }), CODES.BAD_SCHEMA, 'content.rules[0].classes[0].id'));

    const unsafe = smallRulesPack().content.rules[0];
    unsafe.name = 'a<b';
    assert.ok(has(R.normalizeRulesV2(unsafe, { packKey: 'fixture' }), CODES.UNSAFE_MARKUP, 'content.rules[0].name'));
    const good = R.normalizeRulesV2(smallRulesPack().content.rules[0], { packKey: 'fixture' }).manifest;
    const unsafeManifest = { ...good, name: 'a<b' };
    assert.ok(has(R.validateRulesV2(unsafeManifest, {}), CODES.UNSAFE_MARKUP, 'content.rules[0].name'));
    const { pack: _pack, ...noPack } = good;
    assert.ok(has(R.validateRulesV2(noPack, {}), CODES.BAD_SCHEMA, 'content.rules[0].pack'));

    // A skill's branch problems point at its index, not at its slug.
    const pack = smallRulesPack();
    pack.content.rules[0].branches = pack.content.rules[0].branches.filter(b => !(b.skill === 's31' && b.choice === 'b' && b.step === 1));
    const res = R.validateRulesPack(pack);
    assert.equal(res.ok, false);
    const index = pack.content.rules[0].skills.findIndex(s => s.slug === 's31');
    assert.ok(has(res, CODES.BRANCH_GRAPH, `content.rules[0].skills[${index}].branches`), show(res));
    assert.ok(res.errors.every(e => !/\[s\d+\]/.test(e.path)), 'no slug inside brackets');
});

test('F10: a class and a skill (or trainer, or branch) cannot share a slug', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[0].slug = 's00';
    pack.content.rules[0].classes[1].parent = 's00';
    const res = R.validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === CODES.DUP_ID && e.path === 'content.rules[0].skills[0].slug' && /s00/.test(e.message)), show(res));

    const trainer = makeValidExtendedPack();
    trainer.content.rules[0].trainers[0].slug = 'c3';
    assert.ok(has(R.validateRulesPack(trainer), CODES.DUP_ID, 'content.rules[0].trainers[0].slug'));

    const branch = smallRulesPack();
    branch.content.rules[0].branches[0].slug = 's31';
    assert.ok(R.validateRulesPack(branch).errors.some(e => e.code === CODES.DUP_ID && e.path === 'content.rules[0].branches[0].slug' && /s31/.test(e.message)));

    // Different content kinds keep separate lists: an item and a recipe may share a slug.
    const shared = makeValidExtendedPack();
    shared.content.recipes[0].slug = 'potion';
    assert.equal(R.validateRulesPack(shared).ok, true);
});

test('F10: a skill cannot replace itself, a quest cannot chain to itself, objective ids are unique', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].skills[0].replaces = 's00';
    assert.ok(has(R.validateRulesPack(pack), CODES.BAD_REF, 'content.rules[0].skills[0].replaces'));
    pack.content.rules[0].skills[0].replaces = 'pack.fixture/s00';
    assert.ok(has(R.validateRulesPack(pack), CODES.BAD_REF, 'content.rules[0].skills[0].replaces'));
    pack.content.rules[0].skills[0].replaces = 's01';
    assert.equal(R.validateRulesPack(pack).ok, true);

    for (const [link, value] of [['previous', 'scout-threat'], ['next', 'scout-threat'], ['next', 'pack.fixture/scout-threat']]) {
        const quest = makeEveryKindPack();
        quest.content.quests[0].chain = { previous: null, next: null, [link]: value };
        const res = R.validateRulesPack(quest);
        assert.ok(has(res, CODES.BAD_REF, `content.quests[0].chain.${link}`), `${link}=${value}: ${show(res)}`);
    }
    const chained = makeEveryKindPack();
    assert.equal(R.validateRulesPack(chained).ok, true, 'a chain to another quest is fine');

    const objectives = makeEveryKindPack();
    objectives.content.quests[1].objectives[1].id = objectives.content.quests[1].objectives[0].id;
    const res = R.validateRulesPack(objectives);
    assert.ok(has(res, CODES.DUP_ID, 'content.quests[1].objectives[1].id'), show(res));
    const otherQuest = makeEveryKindPack();
    otherQuest.content.quests[1].objectives[0].id = otherQuest.content.quests[0].objectives[0].id;
    assert.equal(R.validateRulesPack(otherQuest).ok, true, 'the same id in two quests is allowed');
});

test('F10: the module imports nothing it does not use and no JSON import attribute', () => {
    const source = readFileSync(new URL('../../../../src/v2/packs/rules-v2.js', import.meta.url), 'utf8');
    assert.ok(!/with\s*\{\s*type:\s*'json'\s*\}/.test(source), 'no JSON import attribute');
    assert.ok(!/\.json'/.test(source.split('\n').filter(line => line.startsWith('import')).join('\n')), 'no .json import');
    const imports = [...source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+'([^']+)';/gm)];
    assert.ok(imports.length >= 5);
    const body = source.replace(/^import[^\n]*\n/gm, '');
    for (const [, names, from] of imports) {
        for (const name of names.split(',').map(part => part.trim().split(/\s+as\s+/).pop()).filter(Boolean)) {
            assert.ok(new RegExp(`\\b${name}\\b`).test(body), `${name} from ${from} is imported but unused`);
        }
    }
});

test('JSON schema: the JS module, the JSON file and the contract schema are deeply equal', async () => {
    const jsModule = await import('../../../../src/v2/packs/rules-v2.schema.js');
    const jsonFile = JSON.parse(readFileSync(new URL('../../../../src/v2/packs/rules-v2.schema.json', import.meta.url), 'utf8'));
    assert.deepEqual(jsModule.rulesV2SchemaSource, jsonFile);
    assert.deepEqual(R.rulesV2Schema, jsonFile);
    assert.deepEqual(jsonFile, JSON.parse(JSON.stringify(R.rulesV2Schema)));

    // The contract embeds the same schema (same method as the reviewer's schemacmp probe). The contract
    // lives in docs/v2/contract on main; set RB_CONTRACT_PATH to check against another copy.
    const candidates = [process.env.RB_CONTRACT_PATH, new URL('../../../../docs/v2/contract/RB_CONTRACT.md', import.meta.url).pathname].filter(Boolean);
    const path = candidates.find(candidate => { try { readFileSync(candidate); return true; } catch { return false; } });
    if (!path) return; // checked out without the contract: the two files above are still compared
    const md = readFileSync(path, 'utf8');
    const start = md.indexOf('### Machine-readable schema');
    const open = md.indexOf('```json', start);
    const close = md.indexOf('```', open + 7);
    assert.ok(start >= 0 && open > start && close > open, 'the contract embeds a schema block');
    const embedded = JSON.parse(md.slice(open + 7, close));
    assert.deepEqual(embedded, jsonFile, 'rules-v2.schema.json equals the contract schema');
    assert.deepEqual(embedded, jsModule.rulesV2SchemaSource, 'rules-v2.schema.js equals the contract schema');
});
