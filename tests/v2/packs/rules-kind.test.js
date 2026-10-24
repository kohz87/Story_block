// The rules content kind in Story Block's pack loader (RB_CONTRACT §7 and §10 E, "Register content.rules"): registered next to
// the others, the rules checker (rules-v2.js) run on content.rules before anything is wrapped, name+slug wrapping, the lookup,
// count and tag, and the `rb-rules-v2` capability. Opt-in scope for creatures, quests, shops and recipes is rules-scope.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { CONTENT_KINDS, HOST_CAPABILITIES, LIMITS, OPTIONAL_KINDS } from '../../../src/v2/packs/limits.js';
import { HOST_VERSION, validatePack } from '../../../src/v2/packs/validate.js';
import { validatePack as oldValidatePack } from './fixtures/old-host/validate.js';
import * as R from '../../../src/v2/packs/rules-v2.js';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { contentOf } from '../../../src/v2/packs/content.js';
import { createPacksPart, rulesOf } from '../../../src/v2/packs/index.js';
import { packTag } from '../../../src/v2/packs/kind.js';
import { renderPacksPanel } from '../../../src/v2/packs/panel.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { smallRulesPack } from './rules-v2/fixtures/smallRulesPack.js';
import { makeEveryKindPack } from './rules-v2/fixtures/everyKindPack.js';
import { makeValidExtendedPack } from './rules-v2/fixtures/builders.js';

const doc = installFakeDom();
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const show = result => JSON.stringify(result.errors ?? result);
const has = (result, code, path) => (result.errors ?? []).some(error => error.code === code && (path === undefined || error.path === path));
// The capability names the modules give (Story Director and RPG Battle); the host adds its own.
const MODULES = ['story-director', 'rpg-battle', 'story-block', 'scene', 'inventory'];

test('the rules kind is registered as a content kind that is kept only when the file gives it', () => {
    assert.ok(CONTENT_KINDS.includes('rules'));
    assert.ok(OPTIONAL_KINDS.includes('rules'));
    assert.deepEqual([...HOST_CAPABILITIES], [R.RULES_V2_CAPABILITY], 'the host has the capability the checker asks a rules pack to declare');
    const plain = validatePack({ id: 'plain', version: '1.0.0', requires: { storyBlock: '^2' }, content: { items: [] } });
    assert.equal(plain.ok, true, show(plain));
    assert.ok(!('rules' in plain.pack.content), 'a pack without a manifest has no rules key, as before');
});

test('an old host refuses the kind with UNKNOWN_KIND (frozen old validator); this host takes the same pack', () => {
    const pack = smallRulesPack();
    for (const capabilities of [null, MODULES]) {
        const old = oldValidatePack(clone(pack), { hostVersion: HOST_VERSION, capabilities });
        assert.equal(old.ok, false);
        assert.ok(has(old, 'UNKNOWN_KIND', 'content.rules'), show(old));
    }
    const current = validatePack(clone(pack), { hostVersion: HOST_VERSION, capabilities: [...MODULES, ...HOST_CAPABILITIES] });
    assert.equal(current.ok, true, show(current));
    assert.deepEqual(Object.keys(current.pack.content.rules[0]).slice(-3).sort(), ['id', 'pack', 'slug']);
});

test('rb-rules-v2: a host without it says MISSING_CAPABILITY when its capabilities are supplied, and checks only the form when they are not', () => {
    const pack = smallRulesPack();
    const lacking = validatePack(clone(pack), { capabilities: MODULES });
    assert.equal(lacking.ok, false);
    assert.ok(has(lacking, 'MISSING_CAPABILITY', 'requires.capabilities'), show(lacking));
    assert.match(lacking.errors.find(error => error.code === 'MISSING_CAPABILITY').message, /rb-rules-v2/);
    assert.equal(validatePack(clone(pack), { capabilities: null }).ok, true, 'null: form only');
    assert.equal(validatePack(clone(pack)).ok, true, 'no option at all is null too');
    assert.equal(validatePack(clone(pack), { capabilities: [...MODULES, 'rb-rules-v2'] }).ok, true);
    // A pack that does not declare the capability is refused whatever the host has: an older host could not tell it needs the kind.
    const silent = smallRulesPack({ requires: { storyBlock: '^2', capabilities: ['story-director', 'rpg-battle'] } });
    for (const capabilities of [null, [...MODULES, 'rb-rules-v2']]) {
        const result = validatePack(clone(silent), { capabilities });
        assert.ok(has(result, 'MISSING_CAPABILITY', 'requires.capabilities'), show(result));
    }
    // A pack that declares the capability and has no manifest is an ordinary pack that needs a host with it.
    const bare = { id: 'bare', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['rb-rules-v2'] }, content: {} };
    assert.ok(has(validatePack(bare, { capabilities: MODULES }), 'MISSING_CAPABILITY'));
    assert.equal(validatePack(bare, { capabilities: [...MODULES, 'rb-rules-v2'] }).ok, true);
});

test('a valid small graph validates; the pack is normalized with the manifest as one wrapped record, and carries the checker\'s hashes', () => {
    const pack = smallRulesPack();
    const result = validatePack(clone(pack), { capabilities: [...MODULES, 'rb-rules-v2'] });
    assert.equal(result.ok, true, show(result));
    const checked = R.validateRulesPack(clone(pack));
    assert.equal(result.rulesHash, checked.rulesHash);
    assert.equal(result.packHash, checked.packHash);
    assert.deepEqual(result.raw, pack, 'raw is what was given');
    const [rules] = result.pack.content.rules;
    assert.equal(result.pack.content.rules.length, 1);
    assert.deepEqual(rules, { ...checked.pack.content.rules[0] }, 'the checker\'s normalized manifest, wrapped with its own id/slug/pack');
    assert.equal(rules.classes.length, 4);
    assert.equal(rules.skills.length, 12);
    assert.equal(rules.branches.length, 24);
    assert.equal(rules.classes[3].skills[0], 'pack.fixture/s30', 'nested slugs are full IDs');
    assert.equal(rules.branches[0].skill, 'pack.fixture/s30');
    // Old packs carry no hashes.
    const old = validatePack({ id: 'plain', version: '1.0.0', requires: { storyBlock: '^2' }, content: {} });
    assert.ok(!('rulesHash' in old) && !('packHash' in old));
});

test('name+slug wrapping: the manifest and the definitions it owns get pack.<id>/<slug>, slug and pack from records()', () => {
    const result = validatePack(makeEveryKindPack(), { capabilities: null });
    assert.equal(result.ok, true, show(result));
    const { content } = result.pack;
    assert.equal(content.rules[0].id, 'pack.fixture/rules');
    assert.equal(content.rules[0].slug, 'rules');
    assert.equal(content.rules[0].pack, 'fixture');
    assert.equal(content.rules[0].name, 'Fixture rules');
    for (const kind of ['creatures', 'quests', 'shops', 'recipes']) {
        assert.ok(content[kind].length, kind);
        for (const record of content[kind]) {
            assert.equal(record.id, `pack.fixture/${record.slug}`, kind);
            assert.equal(record.pack, 'fixture');
            assert.equal(typeof record.name, 'string');
        }
    }
    // The wrappers sit beside the manifest, not in it: the checker takes the wrapped record back (it strips exactly id and pack), and the
    // manifest without them is what it checked in the first place.
    const wrapped = content.rules[0];
    const again = R.normalizeRulesV2(wrapped, { packKey: 'fixture' });
    assert.equal(again.ok, true, show(again));
    assert.deepEqual(again.manifest, R.normalizeRulesV2(makeEveryKindPack().content.rules[0], { packKey: 'fixture' }).manifest);
    // A pack that carries the wrappers itself (a re-exported normalized pack) is read the same way.
    const given = makeEveryKindPack();
    given.content.rules[0].id = 'pack.fixture/rules';
    given.content.rules[0].pack = 'fixture';
    given.content.creatures[0].id = 'pack.fixture/goblin-scout';
    given.content.creatures[0].pack = 'fixture';
    const second = validatePack(given, { capabilities: null });
    assert.equal(second.ok, true, show(second));
    assert.deepEqual(second.pack, result.pack);
    // Wrong wrappers are not silently replaced.
    const wrong = makeEveryKindPack();
    wrong.content.rules[0].pack = 'other';
    assert.equal(validatePack(wrong).ok, false);
});

test('a name+slug manifest outside the schema is refused: the slug is "rules", one manifest, a name of 80 at most', () => {
    const mutate = change => {
        const pack = smallRulesPack();
        change(pack.content.rules);
        return validatePack(pack, { capabilities: null });
    };
    assert.ok(has(mutate(rules => { rules[0].slug = 'other'; }), 'bad-schema', 'content.rules[0].slug'));
    assert.ok(has(mutate(rules => { delete rules[0].slug; }), 'bad-schema', 'content.rules[0].slug'));
    assert.ok(has(mutate(rules => { rules[0].name = 'n'.repeat(81); }), 'numeric-range', 'content.rules[0].name'));
    assert.ok(has(mutate(rules => { rules.push(clone(rules[0])); }), 'bad-schema', 'content.rules'));
    assert.ok(has(mutate(rules => { rules.length = 0; }), 'bad-schema', 'content.rules'));
});

test('a malformed nested field fails with the checker\'s own code and path', () => {
    const power = smallRulesPack();
    power.content.rules[0].skills[0].base.effects[0].power = -50;
    const bad = validatePack(power, { capabilities: null });
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.errors.map(error => [error.code, error.path]), [['numeric-range', 'content.rules[0].skills[0].base.effects[0].power']]);
    assert.ok(!('pack' in bad), 'nothing is normalized after a refusal');

    const tier = smallRulesPack();
    tier.content.rules[0].classes[2].parent = 'c0';
    assert.ok(has(validatePack(tier), 'tier-chain'), 'a tier chain broken inside the manifest');

    const ref = smallRulesPack();
    ref.content.rules[0].classes[0].skills[0] = 'missing';
    assert.ok(has(validatePack(ref), 'bad-ref', 'content.rules[0].classes[0].skills[0]'));

    // Text with markup keeps the code and path of whichever layer found it; it never gets in.
    const markup = smallRulesPack();
    markup.content.rules[0].skills[0].name = 'Slash <script>x</script>';
    assert.equal(validatePack(markup).ok, false);

    // Every error the checker gives stays within the pack's error limit.
    const many = smallRulesPack();
    many.content.rules[0].skills.forEach(skill => { skill.base.effects[0].power = -1; });
    assert.ok(validatePack(many, { limits: { ...LIMITS, errors: 3 } }).errors.length <= 3);
});

test('this host\'s own checks still apply to the rest of a rules pack (strict items, old skills, version)', () => {
    const item = makeValidExtendedPack();
    item.content.items[0].oops = 1;
    assert.ok(has(validatePack(item), 'UNKNOWN_FIELD', 'content.items[0].oops'));
    const range = smallRulesPack({ requires: { storyBlock: '^3', capabilities: ['rb-rules-v2'] } });
    assert.ok(has(validatePack(range), 'HOST_VERSION', 'requires.storyBlock'));
    // The checker is never reached for a pack that is not valid JSON or not an object.
    assert.equal(validatePack('{ nope').errors[0].code, 'NOT_JSON');
    assert.equal(validatePack([]).errors[0].code, 'NOT_OBJECT');
    // JSON text is read like any pack.
    const text = JSON.stringify(smallRulesPack(), null, 2);
    assert.equal(validatePack(text, { capabilities: null }).ok, true);
});

test('content.rules is found by lookup, counted and classified once the pack is installed', async () => {
    const settings = fakeSettings();
    const installed = createInstalled({ settings, capabilities: () => MODULES });
    const result = await installed.install(JSON.stringify(makeEveryKindPack()), { source: 'file', origin: 'rules.json' });
    assert.deepEqual(result, { ok: true, id: 'fixture', name: 'Fixture', action: 'installed' }, show(result));
    const [entry] = installed.list();
    assert.deepEqual(entry.counts, { items: 3, creatures: 2, shops: 1, recipes: 1, events: 1, quests: 2, races: 0, talents: 0, places: 2, rules: 1 });
    assert.equal(entry.tag, 'Rules pack · RPG Battle', 'a rules manifest settles the tag even though the pack also needs Story Director');
    assert.deepEqual(entry.missing, []);
    assert.equal(entry.problem, '');
    assert.equal(entry.enabled, true);

    const packs = installed.packs();
    assert.equal(contentOf(packs, 'rules').length, 1);
    assert.equal(contentOf(packs, 'rules')[0].id, 'pack.fixture/rules');
    assert.equal(contentOf(packs, 'rules', { pack: 'other' }).length, 0);
    const [found] = rulesOf(packs);
    assert.deepEqual({ ...found, manifest: undefined }, { pack: 'fixture', version: '2.0.0', id: 'pack.fixture/rules', name: 'Fixture rules', manifest: undefined });
    assert.equal(found.manifest.classes.length, 4);
    found.manifest.classes.length = 0;
    assert.equal(rulesOf(packs)[0].manifest.classes.length, 4, 'a fresh copy');
    assert.deepEqual(rulesOf(packs, { pack: 'other' }), []);
    assert.deepEqual(rulesOf(null), []);

    // The query the other parts read.
    const part = createPacksPart({ settings, capabilities: () => MODULES }).part;
    assert.equal(part.queries['packs.rules']({}, {}).length, 1);
    assert.equal(part.queries['packs.rules']({}, { pack: 'fixture' })[0].manifest.skills.length, 12);
    assert.equal(part.queries['packs.rules']({}).length, 1);
    assert.equal(part.queries['packs.content']({}, { kind: 'rules' }).length, 1);
    assert.equal(part.queries['packs.list']({})[0].counts.rules, 1);
    assert.equal(part.queries['packs.list']({})[0].tag, 'Rules pack · RPG Battle');
});

test('installing, switching off and removing a rules pack keeps the installed state, the lookups and the tag right', async () => {
    const settings = fakeSettings();
    const installed = createInstalled({ settings, capabilities: () => MODULES });
    const changes = [];
    installed.subscribe(() => changes.push(installed.list().map(entry => [entry.id, entry.enabled, entry.counts.rules ?? 0])));
    assert.equal((await installed.install(smallRulesPack())).action, 'installed');
    assert.equal((await installed.install(smallRulesPack())).action, 'unchanged');
    assert.deepEqual(settings.root.packs.map(entry => entry.pack.id), ['fixture']);
    assert.deepEqual(settings.root.packs[0].pack, smallRulesPack(), 'the raw pack is what is stored');
    assert.equal(installed.packs().length, 1);
    assert.equal(installed.list()[0].tag, 'Rules pack · RPG Battle');

    assert.equal(await installed.setEnabled('fixture', false), true);
    assert.equal(installed.packs().length, 0, 'switched off: no content');
    assert.deepEqual(contentOf(installed.packs(), 'rules'), []);
    assert.deepEqual(rulesOf(installed.packs()), []);
    assert.equal(installed.list()[0].enabled, false);
    assert.equal(installed.list()[0].tag, 'Rules pack · RPG Battle', 'the tag does not depend on the switch');
    assert.equal(installed.list()[0].counts.rules, 1, 'still counted: it is installed');
    assert.equal(await installed.setEnabled('fixture', true), true);
    assert.equal(rulesOf(installed.packs()).length, 1);

    // An update replaces the manifest in place and keeps its place and switch.
    await installed.setEnabled('fixture', false);
    const changed = smallRulesPack({ version: '2.1.0', name: 'Fixture two' });
    changed.content.rules[0].statLabels = { STR: 'Might' };
    assert.equal((await installed.install(changed)).action, 'updated');
    assert.equal(installed.list()[0].enabled, false);
    assert.equal(installed.list()[0].version, '2.1.0');
    await installed.setEnabled('fixture', true);
    assert.equal(rulesOf(installed.packs())[0].manifest.statLabels.STR, 'Might');

    assert.equal(await installed.remove('fixture'), true);
    assert.deepEqual(installed.list(), []);
    assert.deepEqual(installed.packs(), []);
    assert.deepEqual(rulesOf(installed.packs()), []);
    assert.equal(await installed.remove('fixture'), false);
    assert.deepEqual(settings.root.packs, []);
    assert.deepEqual(changes.map(change => change.flat().join(',')), ['fixture,true,1', 'fixture,false,1', 'fixture,true,1', 'fixture,false,1', 'fixture,false,1', 'fixture,true,1', '']);
});

test('a host without the capability, or one that cannot say, handles a rules pack by the same rules as any capability', async () => {
    const lacking = createInstalled({ settings: fakeSettings(), capabilities: () => ['story-block'] });
    // The host adds rb-rules-v2 itself; what it lacks here is the modules the pack also names.
    const refused = await lacking.install(smallRulesPack({ requires: { storyBlock: '^2', capabilities: ['rb-rules-v2', 'rpg-battle'] } }));
    assert.equal(refused.ok, false);
    assert.ok(has(refused, 'MISSING_CAPABILITY'), show(refused));
    assert.deepEqual(lacking.list(), []);
    // Capabilities unknown (the sdk is not up): form only, installed; later listed as needing what is not there.
    const settings = fakeSettings();
    let names = null;
    const unknown = createInstalled({ settings, capabilities: () => names });
    assert.equal((await unknown.install(smallRulesPack({ requires: { storyBlock: '^2', capabilities: ['rb-rules-v2', 'rpg-battle'] } }))).ok, true);
    assert.deepEqual(unknown.list()[0].missing, []);
    names = ['story-block'];
    assert.deepEqual(unknown.list()[0].missing, ['rpg-battle'], 'rb-rules-v2 is the host\'s own, so it is never missing');
});

test('a stored rules pack is checked again on read: a hand-edited one stays listed with its problem and gives nothing', () => {
    const edited = smallRulesPack();
    edited.content.rules[0].classes[1].parent = 'c3';
    const settings = fakeSettings({ packs: [
        { id: 'fixture', version: '2.0.0', enabled: true, pack: edited },
        { id: 'fine', version: '2.0.0', enabled: true, pack: smallRulesPack({ id: 'fine' }) },
    ] });
    const installed = createInstalled({ settings });
    const [broken, fine] = installed.list();
    assert.match(broken.problem, /./);
    assert.deepEqual(broken.counts, {});
    assert.equal(broken.tag, 'Pack');
    assert.equal(fine.problem, '');
    assert.equal(fine.counts.rules, 1);
    assert.deepEqual(installed.packs().map(pack => pack.id), ['fine']);
});

test('the kind tag: a rules manifest is a Rules pack whatever modules it also names; without one, the old reading stands', () => {
    const checked = validatePack(smallRulesPack({ requires: { storyBlock: '^2', capabilities: ['story-director', 'rpg-battle', 'rb-rules-v2'] } }), { capabilities: null });
    assert.equal(checked.ok, true, show(checked));
    assert.equal(packTag(checked.pack), 'Rules pack · RPG Battle');
    // The same declaration without a manifest is two modules: not classified.
    assert.equal(packTag({ requires: { capabilities: ['story-director', 'rpg-battle'] }, content: {} }), 'Pack');
    // The capability alone is the host's, not a module's: it says nothing, and only a manifest makes a Rules pack.
    assert.equal(packTag({ requires: { capabilities: ['rb-rules-v2'] }, content: {} }), 'Pack');
    assert.equal(packTag({ requires: { capabilities: ['rb-rules-v2'] }, content: { places: [{ name: 'Harbour' }] } }), 'World pack · Story Director');
    assert.equal(packTag({ requires: { capabilities: ['rb-rules-v2', 'rpg-battle'] }, content: {} }), 'Rules pack · RPG Battle');
    assert.equal(packTag({ requires: { capabilities: ['rb-rules-v2'] }, content: { items: [{ name: 'Rope' }] } }), 'Story Block pack');
    // With the manifest, or with RPG Battle's content, it is a Rules pack.
    assert.equal(packTag({ requires: { capabilities: [] }, content: { rules: [{ slug: 'rules' }] } }), 'Rules pack · RPG Battle');
    assert.equal(packTag({ requires: { capabilities: ['story-director'] }, content: { places: [{ name: 'Harbour' }], rules: [{ slug: 'rules' }] } }), 'Rules pack · RPG Battle');
    assert.equal(packTag({ requires: { capabilities: [] }, content: { rules: [] } }), 'Pack', 'an empty list is not a manifest');
    assert.equal(packTag({ requires: { capabilities: ['story-director'] }, content: { places: [{ name: 'Harbour' }] } }), 'World pack · Story Director');
});

test('the Packs panel: a rules pack shows its tag and count, then follows the switch and Remove', async () => {
    const settings = fakeSettings();
    const packs = createInstalled({ settings, capabilities: () => MODULES });
    const root = doc.createElement('div');
    const input = () => root.querySelector('.ss-packs-file');
    renderPacksPanel(root, { packs, readLorebook: async () => ({ character: '', entries: [], problem: '' }), doc });
    doc.body.appendChild(root);
    input().files = [{ name: 'rules.json', size: 10, text: async () => JSON.stringify(makeEveryKindPack()) }];
    input().dispatch('change');
    await tick();
    assert.deepEqual(texts(root, '.ss-packs-message'), ['Installed Fixture.']);
    assert.deepEqual(texts(root, '.ss-packs-tag'), ['Rules pack · RPG Battle']);
    assert.match(texts(root, '.ss-packs-facts')[0], /^3 items, 2 creatures, 1 shop, 1 recipe, 1 event, 2 quests, 2 places, 1 rules set/);
    assert.equal(root.querySelector('.ss-packs-problem'), null);

    root.querySelector('.ss-packs-enabled').click();
    await tick();
    assert.equal(packs.list()[0].enabled, false);
    assert.equal(root.querySelector('.ss-packs-enabled').getAttribute('aria-checked'), 'false');
    assert.deepEqual(texts(root, '.ss-packs-tag'), ['Rules pack · RPG Battle']);
    assert.equal(rulesOf(packs.packs()).length, 0);
    root.querySelector('.ss-packs-enabled').click();
    await tick();
    assert.equal(rulesOf(packs.packs()).length, 1);

    root.querySelector('.ss-packs-remove').click();
    root.querySelector('.ss-packs-confirm-yes').click();
    await tick();
    assert.deepEqual(texts(root, '.ss-packs-empty'), ['No packs installed.']);
    assert.deepEqual(texts(root, '.ss-packs-tag'), []);
    assert.deepEqual(rulesOf(packs.packs()), []);
    root.remove();

    // A refusal reads in the checker's words and saves nothing.
    const bad = smallRulesPack();
    bad.content.rules[0].skills[0].base.effects[0].power = -50;
    const again = doc.createElement('div');
    const panel = renderPacksPanel(again, { packs, readLorebook: async () => ({}), doc });
    again.querySelector('.ss-packs-file').files = [{ name: 'bad.json', size: 10, text: async () => JSON.stringify(bad) }];
    again.querySelector('.ss-packs-file').dispatch('change');
    await tick();
    assert.deepEqual(texts(again, '.ss-packs-message'), ['bad.json was not imported.']);
    assert.equal(texts(again, '.ss-packs-errors li').length, 1);
    assert.equal(packs.list().length, 0);
    panel.refresh();
});

test('the checker does not recurse: validatePack on a pack the checker re-checks gives the same answer from either side', () => {
    const pack = makeEveryKindPack();
    const direct = R.validateRulesPack(clone(pack), { capabilities: [...MODULES, 'rb-rules-v2'] });
    const viaHost = validatePack(clone(pack), { capabilities: [...MODULES, 'rb-rules-v2'] });
    assert.equal(direct.ok, true, show(direct));
    assert.equal(viaHost.ok, true, show(viaHost));
    assert.equal(viaHost.rulesHash, direct.rulesHash);
    // The same bad pack is refused with the same errors by both.
    const bad = makeEveryKindPack();
    bad.content.rules[0].branches.pop();
    assert.deepEqual(validatePack(clone(bad)).errors, R.validateRulesPack(clone(bad)).errors);
});
