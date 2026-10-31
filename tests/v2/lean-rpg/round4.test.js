// RPG fix round 4 (review 155), on the whole host (core module, data-module blocks made from the stock templates, the RPG on).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply, success } from '../data-modules/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const template = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
const line = (slug, kind, extra = '') => `${/^(add-|practice-)/.test(kind) ? '+' : '~'} dm ${slug} — why | kind: ${kind}${extra}`;
const sheet = (host, slug) => host.sdk.query('dataModules.view', { module: `pack.chat/${slug}` }).chat;

// A host with the RPG on, a planner that answers `answers` in turn (the last one repeats), and the stock blocks made.
async function game(t, { answers = ['act Wessel | stat: STR | target: Rat'], who = ['Wessel'], foes = [['Rat', 1]], extra = [] } = {}) {
    const asked = [];
    const callModel = async prompt => { asked.push(prompt); return answers.length > 1 ? answers.shift() : answers[0]; };
    const host = await createHost({ callModel });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    await host.send('Begin.', 'Opening.');
    for (const [n, name] of who.entries()) {
        const character = template('Character');
        character.slug = `pc${n}`; character.name = name; character.state.who.default = name;
        success(await host.sdk.command('dm.define', { definition: character }));
    }
    const block = template('Foes');
    foes.forEach(([name, count], n) => { block.state[`foe${n + 1}`].default = name; block.state[`count${n + 1}`].default = count; });
    success(await host.sdk.command('dm.define', { definition: block }));
    for (const definition of extra) success(await host.sdk.command('dm.define', { definition }));
    return { host, asked };
}

test('B11: the used planner hold is cleared even when another afterCapture hook answers (the death settle)', { skip }, async t => {
    const { host } = await game(t);
    await host.send('I strike.', reply(line('pc0', 'set-health', ' | to: Down')));
    assert.ok(host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.type === 'rpg.resolve'), 'the rolls were made');
    assert.ok(host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.type === 'dm.settle'), 'and the reply settled the latch');
    assert.equal(host.ctx.chatMetadata?.rpgPlan, undefined, 'nothing of the plan is kept');
});

test('B11: a "none" plan on a reply with no accepted lines leaves no hold behind', { skip }, async t => {
    const { host } = await game(t, { answers: ['none'] });
    await host.send('I thank the guard.', 'He nods.');
    assert.equal(host.ctx.chatMetadata?.rpgPlan, undefined);
});

test('B13: a foe name with count 0 is empty for Fight and for the planner alike', { skip }, async t => {
    const { host } = await game(t, { foes: [] });
    success(await host.sdk.command('dm.set', { module: 'pack.chat/foes', field: 'foe1', value: 'Rat' }));
    const state = host.head();
    const { readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { hasFoes } = await import('../../../src/v2/lean-rpg/view/fight.js');
    const { readFoes } = await import('../../../src/v2/lean-rpg/view/party-data.js');
    assert.equal(readSheet(state).foes[0].filled, false, 'the planner: empty');
    assert.equal(hasFoes(state), false, 'Fight: no foe');
    assert.deepEqual(readFoes(state), []);
    success(await host.sdk.command('dm.set', { module: 'pack.chat/foes', field: 'count1', value: 1 }));
    assert.equal(readSheet(host.head()).foes[0].filled, true);
    assert.deepEqual(readFoes(host.head()).map(foe => [foe.name, foe.count]), [['Rat', 1]]);
});

test('B13: every Foes block is read by the planner, as Fight reads them: slots count on across blocks', { skip }, async t => {
    const { host } = await game(t, { foes: [] });
    const second = template('Foes');
    second.slug = 'foes-two'; second.name = 'More foes';
    second.state.foe2.default = 'Gutter Serpent'; second.state.count2.default = 2;
    success(await host.sdk.command('dm.define', { definition: second }));
    const { readSheet, matchFoe, parsePlanAnswer, validatePlan, prepare } = await import('../../../src/v2/lean-rpg/index.js');
    const { readFoes } = await import('../../../src/v2/lean-rpg/view/party-data.js');
    const sheet = readSheet(host.head());
    assert.deepEqual(readFoes(host.head()).map(foe => foe.name), ['Gutter Serpent'], 'Fight shows the second block\'s foe');
    assert.deepEqual(sheet.foes.filter(foe => foe.filled).map(foe => [foe.name, foe.slot]), [['Gutter Serpent', 6]], 'and so does the planner (5–8 are the second block\'s)');
    assert.equal(matchFoe(sheet, 'serpent').name, 'Gutter Serpent');
    assert.equal(matchFoe(sheet, 'foe 6').name, 'Gutter Serpent');
    const parsed = parsePlanAnswer('act Wessel | stat: STR | target: Gutter Serpent\nfoe Gutter Serpent | target: Wessel | defend: AGI', sheet);
    assert.deepEqual(parsed.plan.foes, [{ slot: 6, target: 'Wessel', defend: 'agi' }]);
    assert.ok(validatePlan(parsed.plan).ok);
});
