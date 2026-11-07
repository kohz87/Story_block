// How the story starts a fight under the board: the narrator sets a foe slot (fixed grammar), the tail says what happens next,
// (a reply that opens foes makes the offer under it: start-ui.test.js and auto-start.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';

const staticOf = result => result.request.chat[0].content;
const tailOf = result => result.request.chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');

test('the foe lines are how the story starts a fight: set-slot is fixed, the tail says the reader plays it, a standing fight allows clears only', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    try {
        host.features.set(CORE_FEATURE.leanRpg, true);
        host.features.set(CORE_FEATURE.fightBoard, true);
        await host.send('Begin.', 'Opening.');
        for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 5 } })).ok, true);
        const quiet = await host.send('I wait.', 'Quiet.');
        assert.match(staticOf(quiet), /kind: set-slot-N/, 'the board keeps the foe-opening kind in the fixed text');
        assert.match(tailOf(quiet), /A fight starts when you set a foe slot; the reader plays it on the board/);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Rats', count1: 1, level1: 2, hurt1: 5 } })).ok, true);
        const fight = await host.send('I wait.', 'The rats watch.');
        assert.equal(staticOf(quiet), staticOf(fight), 'the fixed text does not follow the fight');
        assert.doesNotMatch(tailOf(fight), /A fight starts when you set a foe slot/);
        assert.match(tailOf(fight), /kind: clear-N/);
        assert.doesNotMatch(tailOf(fight), /kind: hurt-N/, 'code moves the foes\' health');
    } finally { host.close(); }
});

test('Rolls off still lets the story hurt and clear foes in the tail', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard', rpgRolls: 'off' } } } });
    try {
        host.features.set(CORE_FEATURE.leanRpg, true);
        host.features.set(CORE_FEATURE.fightBoard, true);
        await host.send('Begin.', 'Opening.');
        const foe = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
        assert.equal((await host.sdk.command('dm.define', { definition: foe })).ok, true);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Rats', count1: 1, level1: 2, hurt1: 5 } })).ok, true);
        const result = await host.send('I wait.', 'Nothing moves.');
        assert.match(tailOf(result), /kind: hurt-N/);
        assert.match(tailOf(result), /kind: clear-N/);
    } finally { host.close(); }
});
