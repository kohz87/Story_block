// The board trims only stock combat instructions, with a static prompt that does not follow the fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { staticTextWith } from '../../../../src/v2/prompt.js';
import { rpgLib, setRpgLib } from '../../../../src/v2/rpg-lazy.js';

const staticOf = result => result.request.chat[0].content;
const tailOf = result => result.request.chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');

test('board on trims the stock lines, keeps flavour and has the same static text in and out of a fight', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    try {
        host.features.set(CORE_FEATURE.leanRpg, true);
        host.features.set(CORE_FEATURE.fightBoard, true);
        await host.send('Begin.', 'Opening.');
        for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 5 } })).ok, true);
        const quiet = await host.send('I wait.', 'Quiet.');
        host.features.set(CORE_FEATURE.fightBoard, false);
        const quietOff = await host.send('I wait.', 'Quiet again.');
        host.features.set(CORE_FEATURE.fightBoard, true);
        assert.ok(staticOf(quiet).length <= staticOf(quietOff).length);
        assert.doesNotMatch(tailOf(quiet), /No Plot Armor:|Up to four foe groups in the fight/);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Rats', count1: 1, level1: 2, hurt1: 5 } })).ok, true);
        const fight = await host.send('I wait.', 'The rats watch.');
        const text = staticOf(fight);
        assert.equal(staticOf(quiet), text);
        assert.doesNotMatch(text, /No Plot Armor: combat follows physical reality/);
        assert.match(tailOf(fight), /No Plot Armor: combat follows physical reality/);
        assert.match(tailOf(fight), /Up to four foe groups in the fight.*The narrator sets a slot when a group arrives\./);
        assert.doesNotMatch(text, /Up to four foe groups in the fight/);
        assert.match(text, /kind: set-slot-N/);
        assert.doesNotMatch(text, /kind: hurt-N|kind: clear-N|Rolls: tell the rolled result|code gives XP for a won fight/);
        assert.match(text, /Other deeds 5 to 40/);
        const counted = staticTextWith(host.registry, { [CORE_FEATURE.fightBoard]: true });
        assert.match(counted, /kind: set-slot-N/);
        assert.doesNotMatch(counted, /kind: hurt-N|kind: clear-N|Rolls: tell the rolled result/);
        const loaded = rpgLib();
        try {
            setRpgLib(null);
            const dataPart = text => text.slice(text.indexOf('Data modules in this story'));
            assert.equal(dataPart(staticTextWith(host.registry, { [CORE_FEATURE.fightBoard]: true })), dataPart(counted), 'board grammar previews agree before the RPG library loads');
        } finally { setRpgLib(loaded); }
        host.features.set(CORE_FEATURE.fightBoard, false);
        const classic = await host.send('I wait.', 'The rats wait.');
        assert.ok(text.length <= staticOf(classic).length);
        assert.match(staticOf(classic), /kind: hurt-N/);
        assert.match(staticOf(classic), /kind: clear-N/);
        assert.match(staticOf(classic), /Rolls: tell the rolled result/);
    } finally { host.close(); }
});

test('Rolls off keeps manual foe changes in the per-reply text', async () => {
    for (const values of [{ rpgFormula: 'standard', rpgRolls: 'off' }]) {
        const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': values } } });
        try {
            host.features.set(CORE_FEATURE.leanRpg, true);
            host.features.set(CORE_FEATURE.fightBoard, true);
            await host.send('Begin.', 'Opening.');
            const foe = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
            assert.equal((await host.sdk.command('dm.define', { definition: foe })).ok, true);
            assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Rats', count1: 1, level1: 2, hurt1: 5 } })).ok, true);
            const result = await host.send('I wait.', 'Nothing moves.');
            const text = result.request.chat.filter(message => message.role === 'system').map(message => message.content);
            assert.doesNotMatch(text[0], /kind: hurt-N|kind: clear-N/);
            assert.match(text.at(-1), /kind: hurt-N/);
            assert.match(text.at(-1), /kind: clear-N/);
        } finally { host.close(); }
    }
});

test('fixed board grammar does not depend on Rolls or fight state; manual practice moves to the tail', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    try {
        host.features.set(CORE_FEATURE.leanRpg, true);
        host.features.set(CORE_FEATURE.fightBoard, true);
        await host.send('Begin.', 'Opening.');
        for (const { definition } of STANDARD_TEMPLATES) assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(definition) })).ok, true);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra' } })).ok, true);
        const quiet = await host.send('Wait.', 'Still.');
        host.settings.set('story-block', 'rpgRolls', 'off');
        const manual = await host.send('Wait.', 'Still.');
        assert.equal(staticOf(quiet), staticOf(manual));
        assert.match(tailOf(manual), /kind: practice-N/);
        assert.doesNotMatch(tailOf(manual), /kind: hurt-N|kind: clear-N|No Plot Armor:/);
    } finally { host.close(); }
});

test('a pack’s combat flavour appears unchanged only in a fight reply', async () => {
    const host = await createHost({ callModel: async () => 'none', settings: { modules: { 'story-block': { rpgFormula: 'standard' } } } });
    try {
        host.features.set(CORE_FEATURE.leanRpg, true);
        host.features.set(CORE_FEATURE.fightBoard, true);
        await host.send('Begin.', 'Opening.');
        for (const { definition: source } of STANDARD_TEMPLATES) {
            const definition = structuredClone(source);
            if (definition.role === 'rules') definition.prompt = definition.prompt.replace('XP guide:', 'The tide fights for neither side.\nXP guide:');
            assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
        }
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra' } })).ok, true);
        const quiet = await host.send('Wait.', 'Still.');
        assert.doesNotMatch(`${staticOf(quiet)} ${tailOf(quiet)}`, /The tide fights for neither side/);
        assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/foes', fields: { foe1: 'Rats', count1: 1, level1: 2, hurt1: 5 } })).ok, true);
        const fight = await host.send('Wait.', 'Still.');
        assert.equal(staticOf(quiet), staticOf(fight));
        assert.match(tailOf(fight), /The tide fights for neither side\./);
        assert.doesNotMatch(tailOf(fight), /Rolls: tell the rolled result|XP guide: code gives XP/);
    } finally { host.close(); }
});
