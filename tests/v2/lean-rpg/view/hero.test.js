// The RPG in the game view's header (lean-rpg/view/hero-data.js, ui-host.js heroOf): with the feature on, the reader's own
// character's Health, Mana, Stamina and experience are the header's bars (they were only on the Party and Fight tabs: the header
// reads its pools from a party module's `party.pc`, which the RPG does not have). Off means off: no RPG, no bars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroLead } from '../../../../src/v2/lean-rpg/view/hero-data.js';
import { gameHeroProps } from '../../../../src/v2/view/game-header.js';
import { characterDefinition, fakeState, roleOf, skillsDefinition } from './helpers.js';
import { begin, fieldsOf, makeBlocks, page, settle } from './page.js';

const wessel = { definition: characterDefinition('wessel', 'Wessel'), fields: { health: 3, mana: 4, stamina: 1, soul: 2, xp: 40 } };
const ren = { definition: characterDefinition('ren', 'Ren'), fields: { health: 5, mana: 2, stamina: 3, xp: 85 } };
const state = () => fakeState([ren, wessel, { definition: skillsDefinition('wessel-skills', 'Wessel'), fields: {} }]);

test('the lead is the reader\'s own character: three stage bars with the stage word and the experience', () => {
    const lead = heroLead(state(), { own: 'Wessel', roleOf });
    assert.equal(lead.name, 'Wessel');
    assert.deepEqual(lead.bars, [
        { kind: 'hp', label: 'Health', value: 3, max: 5, text: 'Hurt' },
        { kind: 'mp', label: 'Mana', value: 4, max: 4, text: 'Fresh' },
        { kind: 'sp', label: 'Stamina', value: 1, max: 4, text: 'Spent' },
        { kind: 'exp', label: 'XP', value: 40, max: 100, text: '40 / 100' },
    ]);
});

test('no lead when no character is the reader\'s (a companion\'s bars are not the reader\'s), or none has been made, or the role is unknown', () => {
    assert.equal(heroLead(state(), { own: 'Nobody', roleOf }), null);
    assert.equal(heroLead(state(), { own: '', roleOf }), null);
    assert.equal(heroLead(fakeState([]), { own: 'Wessel', roleOf }), null);
    assert.equal(heroLead(state(), { own: 'Wessel', roleOf: () => null }), null);
    const left = { definition: characterDefinition('wessel', 'Wessel'), fields: { left: true } };
    assert.equal(heroLead(fakeState([left]), { own: 'Wessel', roleOf }), null, 'a character who left the party');
});

test('the header takes the RPG\'s bars only when no party module answers; a party module\'s pools win', () => {
    const lead = heroLead(state(), { own: 'Wessel', roleOf });
    const asked = answers => name => answers[name] ?? null;
    const props = gameHeroProps({ state: {}, query: asked({}), context: { personaName: 'Wessel' }, rpgLead: lead });
    assert.deepEqual(props.bars.map(bar => bar.kind), ['hp', 'mp', 'sp', 'exp']);
    const own = gameHeroProps({ state: {}, query: asked({ 'party.pc': { name: 'Wessel', hp: { cur: 20, max: 82 } } }), context: {}, rpgLead: lead });
    assert.deepEqual(own.bars, [{ kind: 'hp', label: 'HP', value: 20, max: 82, text: '20 / 82' }]);
    assert.deepEqual(gameHeroProps({ state: {}, query: asked({}), context: { personaName: 'Wessel' } }).bars, [], 'no RPG lead, no bars');
});

test('feature on: the open game view\'s header shows the bars, and they follow the character', async t => {
    const { doc, host, ui } = await page(t, { persona: 'Wessel' });
    await begin(host);
    const made = await makeBlocks(host, { who: 'Wessel', character: { health: 3, mana: 4, stamina: 1, xp: 40 } });
    ui.mounts.screen.open();
    await settle();
    const vitals = () => doc.querySelector('.ss-gameview-hero .ss-hero-vitals');
    assert.equal(vitals().hidden, false, 'the vitals are drawn');
    const bars = () => doc.querySelectorAll('.ss-gameview-hero .ss-bar').map(bar => [bar.querySelector('.ss-bar-label').textContent, bar.querySelector('.ss-bar-value').textContent]);
    assert.deepEqual(bars(), [['Health', 'Hurt'], ['Mana', 'Fresh'], ['Stamina', 'Spent'], ['XP', '40 / 100']]);
    assert.equal(doc.querySelector('.ss-gameview-hero .ss-hero-pools').hidden, false);
    const result = await host.sdk.command('dm.set', { module: made.character, field: 'health', value: 1 });
    assert.equal(result.ok, true, result.message);
    assert.equal(fieldsOf(host, made.character).health, 1);
    await settle();
    assert.deepEqual(bars()[0], ['Health', 'Badly wounded'], 'the header follows the head');
});

test('feature off: the blocks are only data, the header has no bars; on again they are back', async t => {
    const { doc, host, ui } = await page(t, { feature: false, persona: 'Wessel' });
    await begin(host);
    await makeBlocks(host, { who: 'Wessel' });
    ui.mounts.screen.open();
    await settle();
    assert.equal(doc.querySelector('.ss-gameview-hero .ss-hero-vitals').hidden, true, 'no RPG: no vitals');
    assert.equal(doc.querySelectorAll('.ss-gameview-hero .ss-bar').length, 0);
    host.features.set('story-block.rpg', true);
    await settle();
    ui.mounts.screen.update();
    assert.equal(doc.querySelector('.ss-gameview-hero .ss-hero-vitals').hidden, false, 'the RPG on: the bars come back');
    host.features.set('story-block.rpg', false);
    await settle();
    ui.mounts.screen.update();
    assert.equal(doc.querySelector('.ss-gameview-hero .ss-hero-vitals').hidden, true);
});

test('a character who is not the reader\'s gets no bars in the header', async t => {
    const { doc, host, ui } = await page(t, { persona: 'Mira' });
    await begin(host);
    await makeBlocks(host, { who: 'Wessel' });
    ui.mounts.screen.open();
    await settle();
    assert.equal(doc.querySelector('.ss-gameview-hero .ss-hero-vitals').hidden, true);
});
