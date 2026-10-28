// Story Block 2.5.0: a rank's optional `xp` range (content.ranks[].xp = [lowest, highest], whole experience points). RPG Battle's
// experience curve is flat (100 XP a level), so a rank's coin `reward` range says nothing about how much XP a job of that rank
// should give: an E job whose XP had to sit inside 800 to 3000 would be eight levels or more. An open quest template's XP bounds are
// held to the rank's `xp` range when it has one, else to its `reward` range as before; coin bounds are held to `reward` always.
// Run: node --test tests/v2/packs/rank-xp.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { firstPackRanks, readerRanks } from '../../../src/v2/packs/ranks.js';
import { RANK_FIELDS, RANKS_LIMITS } from '../../../src/v2/packs/limits.js';
import * as R from '../../../src/v2/packs/rules-v2.js';
import { smallRulesPack } from './rules-v2/fixtures/smallRulesPack.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';

const { validateRulesPack, exportRulesV2 } = R;
const show = result => JSON.stringify(result.errors);
const withRanks = ranks => pack({ content: { ranks } });
const refused = (ranks, path) => {
    const result = validatePack(withRanks(ranks));
    assert.equal(result.ok, false, JSON.stringify(ranks));
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `${path}: ${show(result)}`);
    assert.equal(hit.code, 'BAD_RECORD');
    return hit;
};

test('xp is a rank field, written like reward, kept in order with the other fields and the pack', () => {
    assert.ok(RANK_FIELDS.includes('xp'));
    assert.equal(RANKS_LIMITS.xp, 1000000);
    const result = validatePack(withRanks([{ id: 'F', title: 'Registered', levels: [1, 10], reward: [50, 400], xp: [30, 150] }, { id: 'E', levels: [11, 20], reward: [800, 3000], xp: [150, 400] }, { id: 'D' }]));
    assert.equal(result.ok, true, show(result));
    assert.deepEqual(result.pack.content.ranks, [
        { id: 'F', title: 'Registered', levels: [1, 10], reward: [50, 400], xp: [30, 150], pack: 'mini' },
        { id: 'E', levels: [11, 20], reward: [800, 3000], xp: [150, 400], pack: 'mini' },
        { id: 'D', pack: 'mini' },
    ]);
    assert.equal(validatePack(withRanks([{ id: 'Z', xp: [0, 0] }, { id: 'Y', xp: [0, RANKS_LIMITS.xp] }])).ok, true, 'from 0 to the cap');
    assert.ok(!('xp' in validatePack(withRanks([{ id: 'F', reward: [1, 2] }])).pack.content.ranks[0]), 'a rank without xp gets no key');
});

test('a bad xp range is refused with a sentence, like a bad reward', () => {
    for (const xp of [[5], [1, 2, 3], [9, 3], [-1, 5], [1.5, 4], ['1', 2], [0, RANKS_LIMITS.xp + 1], 100, 'lots', null, {}]) {
        const hit = refused([{ id: 'F', xp }], 'content.ranks[0].xp');
        assert.match(hit.message, /xp must be \[lowest, highest\]: two whole amounts of experience from 0 to 1,000,000, the first not above the second/, JSON.stringify(xp));
    }
});

test('ranks go from lowest to highest in xp too, as in levels and reward', () => {
    const hit = refused([{ id: 'F', xp: [100, 400] }, { id: 'E', xp: [50, 900] }], 'content.ranks[1].xp');
    assert.match(hit.message, /ranks go from lowest to highest, but its xp start below rank "F"'s/);
    assert.equal(validatePack(withRanks([{ id: 'F', xp: [100, 400] }, { id: 'E' }, { id: 'D', xp: [100, 900] }])).ok, true, 'a rank without xp skips the comparison');
});

test('packs.content({ kind: "ranks" }) answers with the xp range, as copies', async () => {
    const { part, packs } = createPacksPart({ settings: fakeSettings() });
    assert.equal((await packs.install(JSON.stringify({ ...withRanks([{ id: 'F', levels: [1, 10], reward: [50, 400], xp: [30, 150] }]), id: 'guild' }))).ok, true);
    const ask = () => part.queries['packs.content']({}, { kind: 'ranks' });
    assert.deepEqual(ask()[0].xp, [30, 150]);
    ask()[0].xp[0] = 999;
    assert.deepEqual(ask()[0].xp, [30, 150], 'copies');
});

test('the reader\'s ladder takes a rank\'s xp from the pack rank it is paid as, like its reward', () => {
    const theirs = firstPackRanks([
        { id: 'F', levels: [1, 10], reward: [50, 400], xp: [30, 150], pack: 'guild' },
        { id: 'E', levels: [11, 20], reward: [800, 3000], pack: 'guild' },
        { id: 'D', levels: [21, 30], reward: [3000, 12000], xp: [300, 900], pack: 'guild' },
    ]);
    const ladder = readerRanks(['Soul I', 'Soul II', 'Soul III'], theirs, { perRank: 10 });
    assert.deepEqual(ladder.map(rank => rank.reward), [[50, 400], [800, 3000], [3000, 12000]]);
    assert.deepEqual(ladder.map(rank => rank.xp), [[30, 150], undefined, [300, 900]]);
    assert.ok(!('xp' in ladder[1]), 'no xp where the pack rank has none');
    theirs[0].xp[0] = 77;
    assert.deepEqual(ladder[0].xp, [30, 150], 'copies');
});

// ---- the open quest template check ----------------------------------------------------------------------------------

const template = (reward, extra = {}) => ({
    slug: 'open-task-e', name: 'Task', open: true, rank: 'E', category: 'side', giver: null, turnInPlace: null, requirements: [],
    objectives: [{ id: 'ob_00000001', kind: 'story' }], reward: { items: [], ...reward }, durationMinutes: null, repeat: null, chain: null, ...extra,
});
const rulesPack = (rank, reward) => {
    const value = smallRulesPack();
    value.content.ranks = [{ id: 'E', title: 'Journeyman', levels: [11, 20], reward: [800, 3000], ...rank }];
    value.content.quests = [template(reward)];
    return value;
};
const NO_XP = { coinMin: 800, coinMax: 1600, xpMin: 900, xpMax: 1500 };
const FLAT = { coinMin: 800, coinMax: 1600, xpMin: 100, xpMax: 400 };

test('without a rank xp range an open template\'s XP is held to the coin reward range, exactly as before', () => {
    assert.equal(validateRulesPack(rulesPack({}, NO_XP)).ok, true);
    for (const reward of [{ ...NO_XP, xpMin: 100 }, { ...NO_XP, xpMax: 3001 }, { ...NO_XP, xpMin: 1600, xpMax: 900 }]) {
        const result = validateRulesPack(rulesPack({}, reward));
        assert.equal(result.ok, false, JSON.stringify(reward));
        assert.deepEqual(result.errors.map(error => [error.code, error.path, error.message]), [['bad-schema', 'content.quests[0].reward', "Open xp bounds must be ordered and inside rank E's reward range"]]);
    }
});

test('with a rank xp range, XP is held to it and the coin to the reward range', () => {
    const rank = { xp: [100, 400] };
    assert.equal(validateRulesPack(rulesPack(rank, FLAT)).ok, true, 'a flat-curve job: 100 to 400 XP beside 800 to 1600 coin');
    assert.equal(validateRulesPack(rulesPack(rank, { ...FLAT, xpMin: 100, xpMax: 100 })).ok, true, 'at the edges');
    assert.equal(validateRulesPack(rulesPack(rank, { ...FLAT, xpMin: 400, xpMax: 400 })).ok, true);
    // The coin-sized XP that the old rule demanded is now too much.
    for (const reward of [NO_XP, { ...FLAT, xpMin: 99 }, { ...FLAT, xpMax: 401 }, { ...FLAT, xpMin: 300, xpMax: 200 }]) {
        const result = validateRulesPack(rulesPack(rank, reward));
        assert.equal(result.ok, false, JSON.stringify(reward));
        assert.deepEqual(result.errors.map(error => [error.code, error.path, error.message]), [['bad-schema', 'content.quests[0].reward', "Open xp bounds must be ordered and inside rank E's xp range"]]);
    }
    // Coin keeps the coin rule, whatever the xp range says.
    const coin = validateRulesPack(rulesPack(rank, { ...FLAT, coinMax: 3001 }));
    assert.deepEqual(coin.errors.map(error => [error.path, error.message]), [['content.quests[0].reward', "Open coin bounds must be ordered and inside rank E's reward range"]]);
    const both = validateRulesPack(rulesPack(rank, { coinMin: 5, coinMax: 6, xpMin: 1000, xpMax: 2000 }));
    assert.deepEqual(both.errors.map(error => error.message), ["Open coin bounds must be ordered and inside rank E's reward range", "Open xp bounds must be ordered and inside rank E's xp range"]);
});

test('a malformed rank xp range never reaches a template: the envelope refuses it; the rules checker alone names the rank', () => {
    for (const xp of [[400, 100], [1.5, 4], [-1, 4], [1], 'x']) {
        const full = validateRulesPack(rulesPack({ xp }, FLAT));
        assert.equal(full.ok, false);
        assert.ok(full.errors.some(error => error.path === 'content.ranks[0].xp' && error.code === 'BAD_RECORD'), show(full));
        const result = validateRulesPack(rulesPack({ xp }, FLAT), { envelope: false, hashes: false });
        assert.equal(result.ok, false, JSON.stringify(xp));
        assert.deepEqual(result.errors.map(error => [error.code, error.path]), [['bad-schema', 'content.quests[0].rank']]);
        assert.match(result.errors[0].message, /^Rank E's xp range must be two whole amounts/);
    }
});

test('the whole pack, through the host\'s checker: a flat-curve template passes with the rank xp range and fails without', () => {
    const run = value => validatePack(value, { hostVersion: '2.5.0', capabilities: null });
    const good = run(rulesPack({ xp: [100, 400] }, FLAT));
    assert.equal(good.ok, true, show(good));
    assert.deepEqual(good.pack.content.ranks[0].xp, [100, 400]);
    assert.equal(run(rulesPack({}, FLAT)).ok, false);
    const bad = run(rulesPack({ xp: [400, 100] }, FLAT));
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some(error => error.path === 'content.ranks[0].xp' && error.code === 'BAD_RECORD'), show(bad));
});

test('a pack without rank xp keeps its bytes and hashes; one with it hashes differently and exports the range', () => {
    const plain = rulesPack({}, NO_XP);
    const flat = rulesPack({ xp: [900, 1500] }, NO_XP);
    const a = validateRulesPack(plain);
    const b = validateRulesPack(flat);
    assert.equal(a.ok && b.ok, true);
    assert.notEqual(a.packHash, b.packHash);
    assert.ok(!exportRulesV2(plain).text.includes('"xp": ['), 'no xp key appears in a pack that has none');
    assert.notEqual(a.rulesHash, b.rulesHash, 'the ranks are part of the rules hash too');
    assert.equal(validateRulesPack(rulesPack({}, NO_XP)).rulesHash, a.rulesHash, 'and the same pack hashes the same');
});
