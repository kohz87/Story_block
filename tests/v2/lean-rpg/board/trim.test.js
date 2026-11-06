// The board trims only stock combat instructions, with a static prompt that does not follow the fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { staticTextWith } from '../../../../src/v2/prompt.js';

const staticOf = result => result.request.chat[0].content;

test('board on trims the stock lines, keeps flavour and has the same static text in and out of a fight', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    try {
        host.features.set(CORE_FEATURE.leanRpg, true);
        host.features.set(CORE_FEATURE.fightBoard, true);
        await host.send('Begin.', 'Opening.');
        for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 5 } })).ok, true);
        const quiet = await host.send('I wait.', 'Quiet.');
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Rats', count1: 1, level1: 2, hurt1: 5 } })).ok, true);
        const fight = await host.send('I wait.', 'The rats watch.');
        const text = staticOf(fight);
        assert.equal(staticOf(quiet), text);
        assert.match(text, /No Plot Armor: combat follows physical reality/);
        assert.match(text, /kind: set-slot-N/);
        assert.doesNotMatch(text, /kind: hurt-N|kind: clear-N|Rolls: tell the rolled result|code gives XP for a won fight/);
        assert.match(text, /Other deeds 5 to 40/);
        const counted = staticTextWith(host.registry, { [CORE_FEATURE.fightBoard]: true });
        assert.match(counted, /kind: set-slot-N/);
        assert.doesNotMatch(counted, /kind: hurt-N|kind: clear-N|Rolls: tell the rolled result/);
        host.features.set(CORE_FEATURE.fightBoard, false);
        const classic = await host.send('I wait.', 'The rats wait.');
        assert.match(staticOf(classic), /kind: hurt-N/);
        assert.match(staticOf(classic), /kind: clear-N/);
        assert.match(staticOf(classic), /Rolls: tell the rolled result/);
    } finally { host.close(); }
});

test('Classic and Rolls off keep manual foe changes in the per-reply text', async () => {
    for (const values of [{ rpgFormula: 'classic' }, { rpgFormula: 'standard', rpgRolls: 'off' }]) {
        const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': values } } });
        try {
            host.features.set(CORE_FEATURE.leanRpg, true);
            host.features.set(CORE_FEATURE.fightBoard, true);
            await host.send('Begin.', 'Opening.');
            const foe = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
            assert.equal((await host.sdk.command('dm.define', { definition: foe })).ok, true);
            const result = await host.send('I wait.', 'Nothing moves.');
            const text = result.request.chat.filter(message => message.role === 'system').map(message => message.content);
            assert.doesNotMatch(text[0], /kind: hurt-N|kind: clear-N/);
            assert.match(text.at(-1), /kind: hurt-N/);
            assert.match(text.at(-1), /kind: clear-N/);
        } finally { host.close(); }
    }
});
