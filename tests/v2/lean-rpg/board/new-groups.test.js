// After a finished board fight the reply may open a new foe group (set-slot + a start line); an open fight keeps clears only.
// Reinforcements (a group's count rising, a slot refilled) make the offer under the reply that did it; an unchanged group does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { boardReplyGrammar } from '../../../../src/v2/lean-rpg/index.js';
import { createFightOffers } from '../../../../src/v2/lean-rpg/board/offers.js';

async function world() {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    host.features.set(CORE_FEATURE.leanRpg, true);
    host.features.set(CORE_FEATURE.fightBoard, true);
    await host.send('Begin.', 'Opening.');
    for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 5 } })).ok, true);
    return host;
}
const line = text => `Story.\n<Changes>\n+ dm foes — ${text}\n</Changes>`;
const offerIndex = host => createFightOffers({ ctx: host.ctx, store: host.store, meta: () => host.ctx.chatMetadata, on: () => true }).find()?.index ?? null;

test('a finished fight allows set-slot for a new group and the start line; an open fight and a quiet reply do not', async () => {
    const host = await world();
    try {
        const state = host.store.head();
        const open = boardReplyGrammar(state, { fight: true }).join('\n');
        assert.doesNotMatch(open, /kind: set-slot-N/);
        assert.doesNotMatch(open, /new group arrives after this fight/);
        for (const stop of ['won', 'fled', 'lost']) {
            const text = boardReplyGrammar(state, { fight: true, ended: true }).join('\n');
            assert.match(text, /kind: set-slot-N/, stop);
            assert.match(text, /kind: clear-N/);
            assert.doesNotMatch(text, /kind: hurt-N/, 'code still moves the health');
            assert.match(text, /If a new group arrives after this fight, set a foe slot; a new fight starts on the board, so tell no blows\./);
        }
        assert.match(boardReplyGrammar(state, { fight: true, ended: true, manual: true }).join('\n'), /kind: hurt-N/);
    } finally { host.close(); }
});

test('a group whose count rises or a slot set again shows the offer under the reply that did it; an unchanged group does not', async () => {
    const host = await world();
    try {
        await host.send('Rats.', line('rats | kind: set-slot-1 | name: Rat | count: 2 | level: 1'));
        const first = host.store.headIndex();
        assert.equal(offerIndex(host), first);
        await host.send('Wait.', 'Nothing changes.');
        assert.equal(offerIndex(host), first, 'an unchanged group keeps its first offer');
        await host.send('More.', line('more rats | kind: set-slot-1 | name: Rat | count: 5 | level: 1'));
        const grown = host.store.headIndex();
        assert.equal(offerIndex(host), grown, 'a rising count is a new arrival');
        await host.send('Wait.', 'Still there.');
        assert.equal(offerIndex(host), grown);
        await host.send('Again.', `Story.\n<Changes>\n+ dm foes — gone | kind: clear-1\n+ dm foes — again | kind: set-slot-1 | name: Rat | count: 5 | level: 1\n</Changes>`);
        assert.equal(offerIndex(host), host.store.headIndex(), 'a slot cleared and set again, same name, is a new arrival');
    } finally { host.close(); }
});
