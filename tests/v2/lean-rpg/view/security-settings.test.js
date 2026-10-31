// What the story can write (a character's name, a skill, a foe, a line in the rolls) is shown as text and never parsed;
// the view code uses no markup APIs; the settings fold and its fallbacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { createPartyWidget } from '../../../../src/v2/lean-rpg/view/party.js';
import { buildPanel, panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { LEAN_RPG_SCHEMA, ROLLS_DEFAULT, renderLeanRpgSettings, rollsOf, withLeanRpgSettings } from '../../../../src/v2/lean-rpg/view/settings.js';
import { characterDefinition, fakeState, foesDefinition, roleOf, skillsDefinition } from './helpers.js';

const MARK = '<img src=x onerror="globalThis.pwned=1"><b>bold</b>';

test('the view sources use no markup, script or random APIs; only the stylesheet link sets an address', () => {
    const dir = new URL('../../../../src/v2/lean-rpg/view/', import.meta.url);
    const files = readdirSync(dir).filter(file => file.endsWith('.js'));
    assert.deepEqual(files.sort(), ['bars.js', 'battle-log.js', 'changes-lines.js', 'distribute.js', 'index.js', 'party-data.js', 'party.js', 'settings.js', 'skills.js', 'wizard-data.js', 'wizard.js']);
    for (const file of [...files, '../strings.js']) {
        const source = readFileSync(new URL(file, dir), 'utf8');
        assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|Math\.random|Date\.now/, file);
        assert.doesNotMatch(source, /\.on[a-z]+\s*=(?!=)/, `${file} assigns no on* handler`);
        assert.doesNotMatch(source, /setAttribute\(\s*['"]on/i, `${file} sets no on* attribute`);
        if (file !== 'index.js') assert.doesNotMatch(source, /setAttribute\(\s*['"](?:style|href|src)/i, `${file} sets no style, href or src`);
    }
});

test('names from the story are text on the cards and in the battle log', () => {
    const state = fakeState([
        { definition: characterDefinition('wessel', MARK), fields: { who: MARK } },
        { definition: skillsDefinition('wessel-skills', MARK), fields: { skill1: MARK } },
        { definition: foesDefinition(), fields: { foe1: MARK } },
    ]);
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    createPartyWidget({ headState: () => state, roleOf }).render(el, {}, {});
    assert.ok(el.textContent.includes(MARK), 'shown as text');
    assert.equal(el.querySelectorAll('img, script, iframe, style, a').length, 0);
    assert.equal(el.querySelectorAll('b').filter(node => node.children.length).length, 0, 'a <b> holds only text');
    const model = panelModel({ resolve: readResolve({ rounds: [{ n: 1, lines: [{ kind: 'act', outcome: 'success', skill: MARK, why: MARK, pc: { who: MARK, die: 1, stat: 'str', statBonus: 1, classValue: 1, classBonus: 2, rank: 0, edge: 0, total: 4 }, foe: { slot: 1, name: MARK, die: 1, base: 5, classValue: 1, classBonus: 2, total: 8 } }] }] }), state, before: state, roleOf });
    const panel = buildPanel(doc, model);
    assert.ok(panel.textContent.includes(MARK));
    assert.equal(panel.querySelectorAll('img, script, iframe, style, a').length, 0);
    assert.equal(globalThis.pwned, undefined);
});

test('the Lean RPG fold: Rolls is automatic until the reader says off; it hides with the feature', () => {
    const store = { leanRpgRolls: undefined };
    const settings = Object.assign(id => (id === 'story-block' ? { ...(store.leanRpgRolls ? { leanRpgRolls: store.leanRpgRolls } : {}) } : {}), {
        set: (id, key, value) => { store[key] = value; return value; }, stored: () => store,
    });
    assert.equal(rollsOf(settings), ROLLS_DEFAULT);
    assert.equal(rollsOf(() => ({ leanRpgRolls: 'off' })), 'off');
    assert.equal(rollsOf(() => ({ leanRpgRolls: 'maybe' })), 'automatic', 'an unknown value is the default');
    assert.deepEqual(LEAN_RPG_SCHEMA.leanRpgRolls.options.map(option => option.value), ['automatic', 'off']);
    const doc = setupDom(), pane = doc.createElement('div');
    doc.body.appendChild(pane);
    let on = true;
    const body = renderLeanRpgSettings(pane, { settings, doc, featureOn: () => on });
    const radios = pane.querySelectorAll('[role="radio"]');
    assert.equal(radios[0].getAttribute('aria-checked'), 'true');
    radios[1].click();
    assert.equal(store.leanRpgRolls, 'off');
    assert.equal(rollsOf(settings), 'off');
    assert.equal(body.filter('rolls'), 1);
    assert.equal(body.filter('nothing like it'), 0);
    assert.equal(body.el.hidden, true, 'a search that does not match hides it');
    assert.equal(body.filter(''), 1);
    on = false;
    body.refresh();
    assert.equal(body.el.hidden, true, 'feature off: hidden');
    assert.equal(body.filter(''), 0);
    body.destroy();
    assert.equal(pane.querySelectorAll('.rpg-settings').length, 0);
});

test('withLeanRpgSettings adds the fold after the Features page, keeping its other parts', () => {
    const calls = [];
    const features = (pane, ctx) => { calls.push('draw'); return { filter: () => 4, refresh: () => calls.push('refresh'), destroy: () => calls.push('destroy'), has: () => true, open: () => 'opened' }; };
    const bodies = { look: () => ({}), features };
    const merged = withLeanRpgSettings(bodies, { featureOn: () => true });
    assert.equal(merged.look, bodies.look);
    const doc = setupDom(), pane = doc.createElement('div');
    doc.body.appendChild(pane);
    const settings = Object.assign(() => ({}), { set: () => 'x', stored: () => ({}) });
    const body = merged.features(pane, { doc, options: { settings }, changed: () => {} });
    assert.equal(pane.querySelectorAll('.rpg-settings').length, 1);
    assert.equal(body.filter(''), 5, 'the page\'s count and the fold\'s');
    assert.equal(body.has(), true);
    assert.equal(body.open(), 'opened');
    body.refresh();
    body.destroy();
    assert.deepEqual(calls, ['draw', 'refresh', 'destroy']);
    assert.equal(pane.querySelectorAll('.rpg-settings').length, 0);
    assert.equal(withLeanRpgSettings({ look: 1 }, { featureOn: () => true }).look, 1, 'no Features body: nothing added');
});
