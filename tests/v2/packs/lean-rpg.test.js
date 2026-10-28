// The interim example pack examples/packs/lean-rpg (Lean RPG 0.1.0): two character-scoped data modules, data modules v1
// only. The pack passes the checker and the validator and stays inside v1's budgets; against the real Story Director
// (side by side, skipped without it, like the other suite tests) it pins beside the open-world Ersveil pack's three
// modules, takes the narrator lines its README lists (health, XP past 100, points, practice to a rank-up), spends stat
// points from the sheet (+1 / -1, refused at 0 points and at the bounds), and reloads and rebuilds to the same head.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPack, report } from '../../../authoring-kit/check.mjs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { moduleGrammar } from '../../../src/v2/data-modules/grammar.js';
import { DM_LIMITS as L } from '../../../src/v2/data-modules/schema.js';
import { createHost } from '../../../testkit/index.js';

const text = readFileSync(new URL('../../../examples/packs/lean-rpg/pack.json', import.meta.url), 'utf8');
const ersveil = readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8');
const CHARACTER = 'pack.lean-rpg/character';
const SKILLS = 'pack.lean-rpg/skills';
const CAPS = ['scene', 'inventory', 'data-modules-v1', 'story-director'];

let suite = null;
try { suite = await import('../break/helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;

test('lean-rpg passes the authoring-kit checker and the validator, needs Story Director, and keeps inside the v1 budgets', () => {
    const result = checkPack(text);
    assert.equal(result.ok, true, report('examples/packs/lean-rpg/pack.json', result));
    const checked = validatePack(JSON.parse(text), { capabilities: CAPS });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.equal(validatePack(JSON.parse(text), { capabilities: ['scene', 'inventory', 'data-modules-v1'] }).ok, false, 'character scope needs Story Director');
    const pack = JSON.parse(text);
    assert.deepEqual([pack.id, pack.version, pack.name], ['lean-rpg', '0.1.0', 'Lean RPG (interim)']);
    assert.deepEqual(Object.keys(pack.content), ['dataModules'], 'data modules only: no items, rules, start or currency');
    for (const definition of checked.pack.content.dataModules) {
        assert.equal(definition.scope, 'character');
        assert.ok(Object.keys(definition.state).length <= L.fields && Object.keys(definition.kinds).length <= L.kinds && definition.rules.length <= L.rules);
        const grammar = moduleGrammar(definition, definition.slug);
        assert.equal(grammar.split('\n').length, Object.keys(definition.kinds).length, `${definition.slug}: every kind's line fits the static budget`);
        assert.ok(grammar.length <= L.staticCharacters);
    }
    const character = pack.content.dataModules[0];
    assert.deepEqual(Object.keys(character.state), ['health', 'mana', 'stamina', 'soul-class', 'xp', 'points', 'stats', 'bonus']);
    assert.deepEqual(Object.keys(character.kinds), ['health', 'mana', 'stamina', 'xp', 'points', 'raise', 'lower']);
    assert.deepEqual(Object.entries(character.kinds).filter(([, kind]) => kind.ui).map(([name]) => name), ['raise', 'lower']);
    assert.equal(pack.content.dataModules[1].state.rank.keys.length, 16, 'sixteen skills, the most a fixed map holds');
});

async function table(t) {
    const SD = await import(new URL('Story_director/src/v2/module.js', `file://${suite.ROOT}/`).href);
    let sdk = null;
    const sd = SD.createModule({ host: { settings: id => sdk?.settings(id) ?? null, substitute: value => sdk?.substitute(value) } });
    const host = await createHost({ modules: [sd] });
    sdk = host.sdk; t.after(() => host.close());
    for (const [file, origin] of [[ersveil, 'ersveil.json'], [text, 'lean-rpg.json']]) {
        const installed = await host.packs.packs.install(file, { origin });
        assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    }
    const made = await host.sdk.command('checks.actor', { write: 'wr_wessel01', name: 'Wessel', expectedHash: host.sdk.query('checks.policy').hash });
    assert.equal(made.ok, true, made.message);
    await host.send('Begin.', 'The Guild office.\n<Changes>\n~ time Goldwane 12, 06:40 am\n</Changes>');
    const wessel = Object.keys(host.sdk.query('checks.policy').actors)[0];
    const offers = host.sdk.query('dataModules.offers');
    assert.deepEqual(offers.map(offer => offer.module), ['pack.ersveil/standing', 'pack.ersveil/fame', 'pack.ersveil/guild-membership', CHARACTER, SKILLS]);
    for (const offer of offers) {
        const pinned = await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash, subjects: offer.module.startsWith('pack.lean-rpg/') ? [wessel] : [] });
        assert.equal(pinned.ok, true, `${offer.module}: ${pinned.code} ${pinned.message}`);
    }
    return { host, wessel };
}
const reply = (...lines) => `The story.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const sheet = host => host.sdk.query('dataModules.view', { module: CHARACTER }).characters[0];
const skills = host => host.sdk.query('dataModules.view', { module: SKILLS }).characters[0];
const act = (host, kind, stat, at) => host.sdk.command('dm.act', { module: CHARACTER, kind, who: 'Wessel', labels: { stat, at } });

test('lean-rpg beside Ersveil (open world): five modules pin together; health, XP past 100 (class up, +2 points), points from the sheet, practice to a rank-up', { skip }, async t => {
    const { host } = await table(t);
    assert.equal(Object.keys(host.head().domains.dataModules.active).length, 5);
    assert.match(host.sdk.query('dataModules.view', { module: CHARACTER }).characters[0].name, /Wessel/);
    assert.deepEqual([sheet(host).health, sheet(host)['soul-class'], sheet(host).xp, sheet(host).points], ['unhurt', 1, 0, 6]);

    await host.send('Fight.', reply('~ dm character — a spear through the thigh | kind: health | who: Wessel | to: wounded',
        '~ dm character — ran the gate | kind: stamina | who: Wessel | to: tired', '+ dm character — the first kill | kind: xp | who: Wessel | amount: 30',
        '+ dm standing — saved the clerk | kind: gain | faction: guild | size: small'));
    assert.deepEqual([sheet(host).health, sheet(host).stamina, sheet(host).xp], ['wounded', 'tired', 30]);
    assert.deepEqual(host.store.problems(), []);
    // A second xp line in the same reply is claimed; amounts above 30 are refused.
    await host.send('Again.', reply('+ dm character — a | kind: xp | who: Wessel | amount: 30', '+ dm character — b | kind: xp | who: Wessel | amount: 30'));
    assert.equal(sheet(host).xp, 60);
    assert.ok(host.turn.problems().some(problem => problem.code === 'CLAIMED'));
    await host.send('More.', reply('+ dm character — c | kind: xp | who: Wessel | amount: 31'));
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_LABEL'));
    await host.send('More.', reply('+ dm character — d | kind: xp | who: Wessel | amount: 30'));
    await host.send('More.', reply('+ dm character — e | kind: xp | who: Wessel | amount: 25'));
    assert.deepEqual([sheet(host)['soul-class'], sheet(host).xp, sheet(host).points], [2, 15, 8], 'past 100: Soul Class II, the rest carried, +2 points');

    // The sheet's buttons: +1 spends a point (twice on one stat in one reply, the sheet redrawn between), -1 takes it back.
    assert.equal((await act(host, 'raise', 'str', 10)).ok, true);
    assert.equal((await act(host, 'raise', 'str', 11)).ok, true);
    assert.equal((await act(host, 'raise', 'str', 11)).code, 'CLAIMED', 'a stale button (the old value) is the same click again');
    assert.equal((await act(host, 'raise', 'dex', 11)).code, 'DM_CONDITION', 'a value the sheet no longer shows is refused');
    assert.deepEqual([sheet(host).stats.str, sheet(host).bonus.str, sheet(host).points], [12, 6, 6]);
    assert.equal((await act(host, 'lower', 'str', 12)).ok, true);
    assert.deepEqual([sheet(host).stats.str, sheet(host).points], [11, 7]);
    // Raising it again from the same value in the same reply is the same claim as before (a known v1 limit: send a reply first).
    assert.equal((await act(host, 'raise', 'str', 11)).code, 'CLAIMED');
    for (const stat of ['dex', 'con', 'int', 'wis', 'cha']) assert.equal((await act(host, 'raise', stat, 10)).ok, true);
    assert.equal((await act(host, 'raise', 'dex', 11)).ok, true);
    assert.equal(sheet(host).points, 1);
    assert.equal((await act(host, 'raise', 'con', 11)).ok, true);
    const none = await act(host, 'raise', 'int', 11);
    assert.equal(none.code, 'DM_CONDITION', 'no points left');
    assert.match(none.message, /No unspent points/);
    assert.equal(sheet(host).points, 0);
    // The narrator grants points too, one line per reply.
    await host.send('Rest.', reply('+ dm character — a hard lesson | kind: points | who: Wessel | amount: 2'));
    assert.equal(sheet(host).points, 2);

    // Practice: 20 progress ranks a skill up and keeps the rest.
    for (const xp of [5, 5, 5]) await host.send('Drill.', reply(`+ dm skills — drill | kind: practice | who: Wessel | skill: iron-breath | xp: ${xp}`));
    assert.deepEqual([skills(host).rank['iron-breath'], skills(host).progress['iron-breath']], [0, 15]);
    await host.send('Drill.', reply('+ dm skills — drill | kind: practice | who: Wessel | skill: iron-breath | xp: 5'));
    assert.deepEqual([skills(host).rank['iron-breath'], skills(host).progress['iron-breath'], skills(host).ranked], [1, 0, 1], 'adept, progress reset');
    await host.send('Drill.', reply('+ dm skills — drill | kind: practice | who: Wessel | skill: spark | xp: 3'));
    assert.deepEqual([skills(host).rank.spark, skills(host).progress.spark, skills(host).ranked], [0, 3, 0]);
    assert.deepEqual(host.store.problems(), []);
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.ersveil/standing' }).chat.standing.guild, 2);

    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live head');
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a cold rebuild gives the live head');
});

test('lean-rpg: a master stays master at 20/20, and Soul Class IX holds XP at 100', { skip }, async t => {
    const { host } = await table(t);
    for (let n = 0; n < 16; n += 1) await host.send('Drill.', reply('+ dm skills — drill | kind: practice | who: Wessel | skill: strike | xp: 5'));
    assert.deepEqual([skills(host).rank.strike, skills(host).progress.strike], [3, 20], 'master after 60, then full');
    for (let n = 0; n < 30; n += 1) await host.send('Fight.', reply('+ dm character — a fight | kind: xp | who: Wessel | amount: 30'));
    assert.deepEqual([sheet(host)['soul-class'], sheet(host).xp], [9, 100]);
    assert.equal(sheet(host).points, 6 + 8 * 2, 'two points for each of the eight classes gained');
    assert.deepEqual(host.store.problems(), []);
});
