import test from 'node:test';
import assert from 'node:assert/strict';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { validateRulesPack, exportRulesV2 } from '../../../../src/v2/packs/rules-v2.js';

export function openPack() {
    const pack = smallRulesPack();
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    pack.content.quests = [{ slug: 'task', name: 'Task', open: true, rank: 'F', category: 'side', giver: null,
        turnInPlace: null, requirements: [], objectives: [{ id: 'ob_00000001', kind: 'story' }],
        reward: { coinMin: 10, coinMax: 50, xpMin: 20, xpMax: 100, items: [] }, durationMinutes: null, repeat: null, chain: null }];
    return pack;
}
test('open ranges and unbound objectives survive canonical roundtrip', () => {
    const p = openPack();
    const checked = validateRulesPack(p); assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const exported = exportRulesV2(p); assert.equal(exported.ok, true, JSON.stringify(exported.errors));
    const again = validateRulesPack(exported.text); assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.deepEqual(again.resolved, checked.resolved);
    for (const objective of [{ id: 'ob_00000001', kind: 'kill', count: 1, allowVariants: true }, { id: 'ob_00000001', kind: 'visit' }, { id: 'ob_00000001', kind: 'collect', count: 1, consume: true }]) {
        p.content.quests[0].objectives = [objective]; assert.equal(validateRulesPack(p).ok, true);
    }
});
for (const [name, change] of [
    ['closed holes', q => { delete q.open; }], ['numeric open reward', q => { q.reward = { coin: 10, xp: 10, items: [] }; }],
    ['inverted bounds', q => { q.reward.coinMin = 51; }], ['out of rank bounds', q => { q.reward.xpMax = 101; }],
    ['unknown rank', q => { q.rank = 'Z'; }], ['items', q => { q.reward.items = [{ def: 'rope', qty: 1 }]; }],
    ['repeat without binding', q => { q.repeat = { cooldownMinutes: 0 }; }],
    ['invalid kind', q => { q.objectives[0].kind = 'guess'; }],
]) test(`open template refuses ${name}`, () => { const p = openPack(); change(p.content.quests[0]); assert.equal(validateRulesPack(p).ok, false); });

test('the independent Ersveil additions contain three bounded open templates for every F–C rank', async () => {
    const { readFileSync } = await import('node:fs');
    const base = new URL('../../../../examples/packs/ersveil-bluewatch/', import.meta.url);
    const pack = JSON.parse(readFileSync(new URL('pack.json', base)));
    const additions = JSON.parse(readFileSync(new URL('open-templates.json', base)));
    assert.equal(additions.length, 12);
    for (const rank of ['F', 'E', 'D', 'C']) {
        const rows = additions.filter(q => q.rank === rank);
        assert.equal(rows.length, 3);
        assert.deepEqual(rows.map(q => q.objectives[0].kind).sort(), ['collect', 'kill', 'story']);
        const [min, max] = pack.content.ranks.find(r => r.id === rank).reward;
        for (const q of rows) for (const unit of ['coin', 'xp']) {
            assert.ok(q.reward[`${unit}Min`] >= min && q.reward[`${unit}Max`] <= max);
            const fixture = openPack(); fixture.content.ranks = pack.content.ranks; fixture.content.quests = [q];
            const result = validateRulesPack(fixture); assert.equal(result.ok, true, JSON.stringify(result.errors));
        }
    }
});
