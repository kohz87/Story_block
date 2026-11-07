// The roll planner and the Classic rules are gone: the settings page and the wizard show nothing of them, a pack that asks for Classic is
// refused in plain words (Standard is accepted), and a message in a fight makes no model call at all, with the fight board on or off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_FEATURE, createLeanRpgPart } from '../../../src/v2/lean-rpg/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { pack } from '../packs/helpers/fixtures.js';
import { OWNER, PARTY, fakeModel, sheetDomain } from './helpers.js';
import { begin, makeBlocks, page, party, settle } from './view/page.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

test('the RPG settings page has no Classic chip, no planner time limit row and no planner card', { skip }, async t => {
    const ctx = await page(t, { feature: true, persona: 'Wessel' });
    await begin(ctx.host);
    await makeBlocks(ctx.host, { who: 'Wessel', character: { str: 12 } });
    const win = ctx.ui.openSettings();
    win.select('rpg');
    await settle();
    const root = ctx.doc.querySelector('[data-ss-section="rpg"]');
    assert.ok(root.querySelector('[data-card="formula"]'), 'the page is drawn');
    assert.equal(root.querySelector('[data-card="planner"]'), null);
    assert.equal(root.querySelectorAll('.rpg-chip').filter(node => /classic/i.test(node.textContent)).length, 0);
    assert.doesNotMatch(root.textContent, /classic/i);
    assert.doesNotMatch(root.textContent, /Planner time limit|roll planner/i);
    assert.equal(root.querySelector('[data-setting="rpgPlannerSeconds"]'), null);
    assert.equal(root.querySelector('textarea[data-field="planner"]'), null);
    win.close();
});

test('the New character wizard shows no Classic note on any step', { skip }, async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    party(ctx.doc).querySelector('.rpg-create').click();
    await settle();
    const dialog = ctx.ui.mounts.dialog.current();
    for (const step of [0, 1, 2, 3]) {
        dialog.goTo(step);
        await settle();
        const text = dialog.root.querySelector('.ss-w-rpg-wizard').textContent;
        assert.doesNotMatch(text, /classic/i, `step ${step}`);
        assert.doesNotMatch(text, /half of it/, `step ${step}`);
    }
    dialog.close();
});

test('a pack with content.rpg.formula "classic" is refused in plain words; "standard" is accepted', () => {
    const refused = validatePack(JSON.stringify(pack({ content: { rpg: { formula: 'classic' } } })));
    assert.equal(refused.ok, false);
    const hit = refused.errors.find(error => error.path === 'content.rpg.formula');
    assert.ok(hit, JSON.stringify(refused.errors));
    assert.equal(hit.code, 'BAD_CONTENT');
    assert.match(hit.message, /"classic" is no longer supported/);
    assert.match(hit.message, /Use "standard" or leave the formula out/);
    for (const formula of ['standard', undefined]) {
        const result = validatePack(JSON.stringify(pack({ content: { rpg: { formula, numbers: { foeBase: 6 } } } })));
        assert.equal(result.ok, true, JSON.stringify(result.errors));
    }
});

// A host with the real RPG part (no planner behind it) and a model that is counted: the host's own callModel, not only the part's.
async function hostWithModel(board) {
    const model = fakeModel('pace: normal\nact Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats');
    let host = null;
    const part = createLeanRpgPart({ chat: () => host.ctx.chat, metadata: () => host.ctx.chatMetadata ?? null, moduleId: OWNER });
    const module = {
        id: OWNER, name: 'Story Block (RPG test)', version: '0.0.1',
        features: [{ id: LEAN_RPG_FEATURE, label: 'RPG', describe: 'Test.', default: false }, { id: CORE_FEATURE.fightBoard, label: 'Fight board', describe: 'Test.', default: false }],
        domains: { dataModules: { initial: () => sheetDomain(PARTY()) } },
        commands: { ...part.commands }, queries: { ...part.queries }, hooks: { ...part.hooks, replayGuard: part.guard }, settings: { defaults: { ...part.settings.defaults } },
    };
    host = await createHost({ core: false, modules: [module], callModel: model });
    host.features.set(LEAN_RPG_FEATURE, true);
    host.features.set(CORE_FEATURE.fightBoard, board);
    return { host, model };
}

for (const board of [false, true]) {
    test(`a risky message in an open fight makes no model call (fight board ${board ? 'on' : 'off'})`, { skip }, async () => {
        const { host, model } = await hostWithModel(board);
        const sent = await host.send('I attack the sluice rats', 'The rats scatter.');
        // (With the board on, the open fight holds the reply until the reader plays the board; either way nothing asks a model.)
        if (!board) assert.ok(sent.request, 'the reply was made');
        assert.equal(model.calls.length, 0, 'no planner, no other model call');
        const rolls = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'rpg.resolve');
        assert.deepEqual(rolls, [], 'and no roll was made before the reply');
        host.close();
    });
}
