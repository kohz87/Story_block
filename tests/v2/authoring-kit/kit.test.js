// The authoring kit (authoring-kit/): a checker over Story Block's own validator, prompts whose numbers are Story Block's
// numbers, references that equal what Story Block ships, and a generated LIMITS.md that cannot drift. Story Studio carries a
// synced copy of the kit and tests the copy; this file tests the original.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPack, report, withStandIns } from '../../../authoring-kit/check.mjs';
import { join as joinSteps, readAnswer, RULES_LISTS, CONTENT_LISTS } from '../../../authoring-kit/scripts/join.mjs';
import * as R from '../../../src/v2/packs/rules-v2.js';
import { DM_LIMITS } from '../../../src/v2/data-modules/schema.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const kit = join(root, 'authoring-kit');
const read = (...parts) => readFileSync(join(kit, ...parts), 'utf8');
const json = (...parts) => JSON.parse(read(...parts));
const clone = value => JSON.parse(JSON.stringify(value));
const node = (...args) => {
    try { return { status: 0, out: execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (error) { return { status: error.status, out: String(error.stdout ?? ''), err: String(error.stderr ?? '') }; }
};
const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
});
const kitFiles = () => walk(kit).filter(path => !path.includes(`${join(kit, 'work')}`) || path.endsWith('README.md'));

test('the checker accepts every example pack the kit and Story Block ship', () => {
    const files = [
        'reference/example-rules-pack.json', 'reference/data-modules/faction-standing.pack.json',
        'reference/data-modules/survival-meters.pack.json', 'examples/tiny-world/pack.json',
    ].map(path => join(kit, path));
    for (const name of ['ersveil-bluewatch', 'ersveil-factions', 'ersveil-survival', 'riverside-starter']) files.push(join(root, 'examples', 'packs', name, 'pack.json'));
    for (const file of files) {
        const result = checkPack(readFileSync(file, 'utf8'));
        assert.equal(result.ok, true, `${file}: ${report(file, result)}`);
    }
});

test('the command line prints OK with the hashes and exits 0, and a broken pack prints a numbered list and exits 1', () => {
    const good = node('authoring-kit/check.mjs', 'authoring-kit/examples/tiny-world/pack.json');
    assert.equal(good.status, 0);
    assert.match(good.out, /^OK authoring-kit\/examples\/tiny-world\/pack\.json\nrules [0-9a-f]{12}  pack [0-9a-f]{12}\n$/);

    // The host reads the shape of a pack first, the rules after: a wrong place id shows alone, the rules problems after it.
    const shape = clone(json('examples/tiny-world/pack.json'));
    shape.content.shops[0].place = 'lanternfall';
    const shapeText = report('shape.json', checkPack(shape));
    assert.match(shapeText, /^1 problem in shape\.json\n/);
    assert.match(shapeText, /content\.shops\[0\]\.place\n.*\n {4}hint: Places and other ids are written in full as pack\.<pack id>\/<slug>/);

    const broken = clone(json('examples/tiny-world/pack.json'));
    broken.content.rules[0].skills[0].base.effects[0].target = 'all';
    broken.content.rules[0].branches[0].transforms = [{ op: 'set-power', at: 0, value: 110 }];
    const text = report('broken.json', checkPack(broken));
    assert.match(text, /^2 problems in broken\.json\n/);
    assert.match(text, / 1\. content\.rules\[0\]\.skills\[0\]\.base\.powerScore\n {4}Skill "lantern-swing" power score 30 exceeds tier 0 budget 12\n {4}hint: .*budget/);
    assert.match(text, /content\.rules\[0\]\.branches\[0\]\n {4}Written branch must change behavior, not merely numeric fields\n {4}hint: A written branch must change what the skill does/);
    for (const line of text.split('\n').filter(line => /^ ?\d+\. /.test(line))) assert.match(line, /^ ?\d+\. \S/);

    const run = node('authoring-kit/check.mjs', 'authoring-kit/nothing-here.json');
    assert.equal(run.status, 1);
    assert.match(run.err, /Cannot read authoring-kit\/nothing-here\.json/);
    assert.equal(node('authoring-kit/check.mjs').status, 2);
    assert.equal(node('authoring-kit/check.mjs', 'x.json', '--through', '9').status, 2);
});

test('text that is not JSON is reported with where it went wrong', () => {
    const result = checkPack('{ "id": "x", }');
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'not-json');
    assert.match(report('x.json', result), /not valid JSON.*line 1 column 14[\s\S]*hint: Fix the JSON text/);
});

test('every error code the rules checker and the host use gets a hint of its own or the general one', () => {
    const text = read('check.mjs');
    for (const code of Object.values(R.RULES_V2_ERROR_CODES)) {
        if (['envelope-unknown', 'unsafe-markup'].includes(code) || text.includes(`'${code}'`) || text.includes(`${code}:`)) continue;
        assert.fail(`no hint for the checker code ${code}`);
    }
});

test('a capability the kit does not know is a note, never a refusal', () => {
    const pack = clone(json('examples/tiny-world/pack.json'));
    pack.requires.capabilities.push('mystery-module');
    const result = checkPack(pack);
    assert.equal(result.ok, true);
    assert.match(report('x', result), /note: requires\.capabilities lists "mystery-module"/);
});

test('--through judges the steps done with stand-ins for the rest, and never passes a pack that is wrong', () => {
    const full = json('examples/tiny-world/pack.json');
    const cut = (...kinds) => {
        const pack = clone(full);
        const rules = pack.content.rules[0];
        if (kinds.includes('skills')) rules.skills = [];
        if (kinds.includes('branches')) rules.branches = [];
        if (kinds.includes('itemRules')) rules.itemRules = [];
        if (kinds.includes('trainers')) rules.trainers = [];
        for (const kind of ['creatures', 'quests', 'shops', 'recipes']) if (kinds.includes(kind)) delete pack.content[kind];
        return pack;
    };
    const later = ['creatures', 'quests', 'shops', 'recipes', 'trainers'];
    const stages = [
        [1, cut('skills', 'branches', 'itemRules', ...later)],
        [2, cut('branches', 'itemRules', ...later)],
        [3, cut('itemRules', ...later)],
        [4, cut(...later)],
        [5, cut('quests', 'shops', 'recipes', 'trainers')],
        [6, cut('shops', 'recipes', 'trainers')],
    ];
    for (const [through, pack] of stages) {
        const result = checkPack(pack, { through });
        assert.equal(result.ok, true, `through ${through}: ${report('x', result, { through })}`);
        assert.match(report('x', result, { through }), new RegExp(`^OK through step ${through}: x\n`));
    }
    // Without --through a half-written pack is not accepted.
    assert.equal(checkPack(stages[0][1]).ok, false);
    assert.equal(checkPack(stages[2][1]).ok, false);

    // A wrong class tree is found at step 1, a wrong skill at step 2, a wrong branch at step 3, a wrong item rule at step 4.
    const wrongTree = stages[0][1];
    wrongTree.content.rules[0].classes[2].parent = 'lamplighter';
    assert.ok(checkPack(wrongTree, { through: 1 }).errors.some(error => error.code === 'tier-chain'));
    const wrongSkill = stages[1][1];
    wrongSkill.content.rules[0].skills[0].base.effects[0].target = 'all';
    assert.ok(checkPack(wrongSkill, { through: 2 }).errors.some(error => error.code === 'budget-closure'));
    const wrongBranch = stages[2][1];
    wrongBranch.content.rules[0].branches[0].transforms = [{ op: 'set-power', at: 0, value: 110 }];
    assert.ok(checkPack(wrongBranch, { through: 3 }).errors.some(error => error.code === 'numeric-only-branch'));
    const wrongRule = stages[3][1];
    wrongRule.content.rules[0].itemRules[5].allowedSlots = ['offhand'];
    assert.ok(checkPack(wrongRule, { through: 4 }).errors.some(error => error.code === 'item-rule-mismatch'));

    // Stand-ins change nothing that is already written, and never reach the input.
    const input = clone(stages[0][1]);
    const before = JSON.stringify(input);
    withStandIns(input, 1);
    assert.equal(JSON.stringify(input), before);
    const cli = node('authoring-kit/check.mjs', 'authoring-kit/examples/tiny-world/pack.json', '--through', '3');
    assert.equal(cli.status, 0);
    assert.match(cli.out, /^OK through step 3: /);
});

test('join.mjs puts step answers back together: the tiny world split into steps joins to the same pack', () => {
    const full = json('examples/tiny-world/pack.json');
    const rules = full.content.rules[0];
    const base = clone(full);
    for (const kind of ['creatures', 'quests', 'shops', 'recipes', 'rules']) delete base.content[kind];
    const steps = [
        { classes: rules.classes },
        { skills: rules.skills.slice(0, 7) },
        { skills: rules.skills.slice(7) },
        { branches: rules.branches.slice(0, 12) },
        { branches: rules.branches.slice(12) },
        { itemRules: rules.itemRules },
        { creatures: full.content.creatures },
        { quests: full.content.quests },
        { trainers: rules.trainers, shops: full.content.shops, recipes: full.content.recipes },
        { statLabels: rules.statLabels, memory: rules.memory },
    ];
    // A chat answer may come wrapped in a fence with a sentence around it.
    const wrapped = readAnswer(`Here is step 1:\n\n\`\`\`json\n${JSON.stringify(steps[0])}\n\`\`\`\n\nDone.`);
    assert.deepEqual(wrapped, steps[0]);
    const joined = joinSteps({ ...base, name: full.name }, steps.map((answer, i) => ({ name: `step ${i}`, answer })));
    joined.content.rules[0].name = rules.name;
    assert.deepEqual(joined.content, full.content);
    assert.deepEqual(joined.requires, full.requires);
    assert.equal(checkPack(joined).ok, true);

    // Giving a record again replaces it; a base pack without a manifest or the capability gets both.
    const fixed = clone(steps[0].classes[0]);
    fixed.note = 'Changed.';
    const again = joinSteps(base, [...steps.slice(0, 9), { name: 'fix', answer: { classes: [fixed] } }].map((s, i) => s.answer ? s : { name: `s${i}`, answer: s }));
    assert.equal(again.content.rules[0].classes.length, rules.classes.length);
    assert.equal(again.content.rules[0].classes[0].note, 'Changed.');
    const bare = joinSteps({ id: 'x', version: '1.0.0', name: 'X' }, []);
    assert.deepEqual(bare.requires.capabilities, ['rb-rules-v2']);
    assert.equal(bare.content.rules[0].slug, 'rules');
    assert.throws(() => joinSteps(base, [{ name: 'f.json', answer: { monsters: [] } }]), /f\.json: "monsters" is not a key the join knows/);
    assert.throws(() => joinSteps(base, [{ name: 'f.json', answer: { classes: 'no' } }]), /"classes" must be a list/);
    for (const key of [...RULES_LISTS, ...CONTENT_LISTS]) assert.ok(read('scripts/join.mjs').includes(`'${key}'`));
});

test('reference/ equals what Story Block ships', () => {
    assert.equal(read('reference/rules-v2.schema.json'), readFileSync(join(root, 'src/v2/packs/rules-v2.schema.json'), 'utf8'));
    assert.deepEqual(json('reference/rules-v2.schema.json'), JSON.parse(JSON.stringify(R.rulesV2Schema)));
    // The data module examples are the shipped example packs under neutral names.
    const neutral = (text, pairs) => pairs.reduce((out, [from, to]) => out.split(from).join(to), text);
    const ship = name => readFileSync(join(root, 'examples/packs', name, 'pack.json'), 'utf8');
    assert.equal(read('reference/data-modules/faction-standing.pack.json'), neutral(ship('ersveil-factions'), [
        ['pack.ersveil-factions/', 'pack.faction-standing/'], ['"ersveil-factions"', '"faction-standing"'],
        ['Ersveil faction standing', 'Faction standing'], ['"ersveil-reputation"', '"faction-reputation"']]));
    assert.equal(read('reference/data-modules/survival-meters.pack.json'), neutral(ship('ersveil-survival'), [
        ['pack.ersveil-survival/', 'pack.survival-meters/'], ['"ersveil-survival"', '"survival-meters"'],
        ['Ersveil survival meters', 'Survival meters']]));
});

test('LIMITS.md is exactly what scripts/limits.mjs prints', () => {
    const printed = node('authoring-kit/scripts/limits.mjs');
    assert.equal(printed.status, 0, printed.err);
    assert.equal(read('reference/LIMITS.md'), printed.out);
    assert.match(printed.out, /\| Classes \| 1 to 40 entries \|/);
    assert.match(printed.out, /Budgets: tier 0 12, tier 1 24, tier 2 36, tier 3 48; each branch step adds 12 \(a tier 3 step 1 form 60, a step 2 form 72\)/);
});

test('LIMITS.md states the power scoring the way the checker computes it', () => {
    const strike = { type: 'physical', stat: 'STR', cost: { mp: 0, sp: 1, cooldown: 0 }, unit: null, effects: [{ op: 'damage', target: 'one', power: 100, element: 'none', damageType: 'physical' }] };
    assert.equal(R.powerScore(strike).score, 10);
    assert.equal(R.powerScore({ ...strike, effects: [{ ...strike.effects[0], target: 'all' }] }).score, 30);
    assert.equal(R.powerScore({ ...strike, unit: { kind: 'summon', class: 'x', statShare: 50, poolShare: 50, rounds: 3 } }).score, 22);
    assert.equal(R.powerScore({ ...strike, effects: [{ op: 'condition', target: 'one', kind: 'burn', chance: 60, rounds: 3 }] }).score, 9);
    assert.equal(R.powerScore({ ...strike, effects: [{ op: 'stat', target: 'allies', stat: 'STR', amount: 2, rounds: 2 }] }).score, 24);
});

test('the master prompt and the steps state Story Block\'s current numbers', () => {
    const master = read('prompts/rules-pack/00-master.md');
    const steps = readdirSync(join(kit, 'prompts/rules-pack')).map(name => read('prompts/rules-pack', name)).join('\n');
    const [t0, t1, t2, t3] = R.RULES_V2_CONSTANTS.classBudget;
    const step = R.RULES_V2_CONSTANTS.pathBudgetIncrement;
    const defs = R.rulesV2Schema.$defs;
    const props = R.rulesV2Schema.properties;
    const expected = [
        `tier 0 -> ${t0}, tier 1 -> ${t1}, tier 2 -> ${t2}, tier 3 -> ${t3}`,
        `Each path step adds ${step}: a tier-3 step-1 form -> ${t3 + step}, a step-2 form -> ${t3 + 2 * step}`,
        `At most\n  ${props.classes.maxItems} classes and ${props.skills.maxItems} skills in all`,
        `a skill's slug at\n  most ${R.RULES_V2_LIMITS.skillSlug} characters`,
        `at most 64 characters`.replace('64', String(defs.slug.maxLength)),
        `Names 1-${defs.name.maxLength} characters. Notes at most ${defs.note.maxLength} characters`,
        `cooldown 0-${defs.cost.properties.cooldown.maximum}`,
        `power ${defs.effect.oneOf[0].properties.power.minimum}-${defs.effect.oneOf[0].properties.power.maximum}`,
        `chance ${defs.effect.oneOf[1].properties.chance.minimum}-${defs.effect.oneOf[1].properties.chance.maximum}, rounds ${defs.effect.oneOf[1].properties.rounds.minimum}-${defs.effect.oneOf[1].properties.rounds.maximum}`,
        `amount ${defs.effect.oneOf[2].properties.amount.minimum}..${defs.effect.oneOf[2].properties.amount.maximum} not 0`,
        `statShare\n  ${defs.unit.properties.statShare.minimum}-${defs.unit.properties.statShare.maximum}, poolShare ${defs.unit.properties.poolShare.minimum}-${defs.unit.properties.poolShare.maximum}, rounds ${defs.unit.properties.rounds.minimum}-${defs.unit.properties.rounds.maximum}`,
        `Stat values ${defs.stats.properties.STR.minimum}-${defs.stats.properties.STR.maximum}`,
        `ceil(power/10)`, `ceil(chance/25) x rounds`, `2 x |amount| x rounds`, `x 3 if the target is "all" or "allies"`, `plus 12\n  if unit is not null`,
    ];
    for (const text of expected) assert.ok(master.includes(text), `00-master.md should say: ${text}`);
    // Where the generated power-up lives: +20 power on the first damage, heal or shield effect, so 980 is the most it can start at.
    assert.ok(master.includes('+20\n  power') || master.includes('+20 power'));
    assert.ok(master.includes('980'));
    assert.equal(1000 - 20, 980);
    const trainer = defs.trainer.properties;
    assert.ok(steps.includes(`"minutes":${trainer.minutes.const}`));
    assert.ok(steps.includes(`"eventTemplates":[]`));
    assert.ok(steps.includes(`at most 1000000`) && trainer.fee.maximum === 1000000 && trainer.fee.minimum === 1);
    assert.ok(steps.includes('"weight":<whole number 0-10000>') && defs.itemRule.properties.weight.maximum === 10000);
    assert.ok(steps.includes('tier":0-9') && defs.foe.properties.tier.maximum === 9);
    assert.ok(steps.includes('dc":5-40') && defs.recipe.properties.dc.minimum === 5 && defs.recipe.properties.dc.maximum === 40);
    assert.ok(steps.includes('minutes":0-1440') && defs.recipe.properties.minutes.maximum === 1440);
    assert.equal(R.RULES_V2_PROGRESSION.graph.perClass.written, 24);
    assert.ok(steps.includes('8 written branches per skill and 24 per class'));
    assert.ok(steps.includes('step-1 form <= 60') && steps.includes('step-2 form <= 72'));
});

test('a grid of the exact rules the prompts promise is enforced by the checker', () => {
    const full = json('examples/tiny-world/pack.json');
    const fails = (change, code) => {
        const pack = clone(full);
        change(pack, pack.content.rules[0]);
        const result = checkPack(pack);
        assert.equal(result.ok, false, code);
        assert.ok(result.errors.some(error => error.code === code), `${code}: ${JSON.stringify(result.errors)}`);
    };
    fails((p, r) => { r.classes[1].parent = null; }, 'tier-chain');
    fails((p, r) => { r.classes[3].skills[2] = 'lantern-swing'; }, 'class-skills');
    fails((p, r) => { r.skills[0].base.cost = { mp: 3, sp: 3, cooldown: 0 }; }, 'mp-sp-conflict');
    fails((p, r) => { r.skills[0].base.cost.cooldown = 11; }, 'numeric-range');
    fails((p, r) => { r.skills[11].base.effects[2].power = 990; }, 'bad-rules');
    fails((p, r) => { r.branches.pop(); }, 'branch-graph');
    fails((p, r) => { r.itemRules.pop(); }, 'item-rule-mismatch');
    fails((p, r) => { r.branches[0].slug = 'wrong'; }, 'branch-graph');
    fails((p, r) => { p.content.quests[0].giver = 'npc/marta-vell'; }, 'bad-ref');
    fails((p, r) => { p.content.quests[0].turnInPlace = 'lanternfall'; }, 'bad-schema');
    fails((p, r) => { r.classes[0].note = 'a <b>tag</b>'; }, 'UNSAFE_HTML');
});

test('every file the README, the prompts and the agent files point to exists', () => {
    const files = kitFiles();
    const mentioned = [];
    for (const path of files.filter(path => path.endsWith('.md'))) {
        const text = readFileSync(path, 'utf8');
        for (const match of text.matchAll(/`((?:prompts|reference|scripts|examples)\/[A-Za-z0-9_./-]+)`/g)) mentioned.push([path, match[1]]);
        for (const match of text.matchAll(/\]\(((?!https?:)[A-Za-z0-9_./-]+)\)/g)) {
            if (!match[1].startsWith('#')) mentioned.push([path, join(path.includes('/reference/') ? 'reference' : '', match[1].replace(/^\.\//, ''))]);
        }
    }
    assert.ok(mentioned.length > 20);
    for (const [from, target] of mentioned) assert.ok(existsSync(join(kit, target)), `${from.slice(kit.length + 1)} mentions ${target}, which does not exist`);
    for (const name of ['00-master', '00-base-pack', '01-classes', '02-skills', '03-branches', '04-item-rules', '05-foes', '06-quests', '07-trainers-shops-recipes', '08-reward-tuning', '09-join-and-check']) {
        assert.ok(existsSync(join(kit, 'prompts/rules-pack', `${name}.md`)), name);
    }
    for (const name of ['01-design', '02-lines', '03-check-and-try']) assert.ok(existsSync(join(kit, 'prompts/data-module', `${name}.md`)), name);
    assert.ok(existsSync(join(kit, 'prompts/code-module/README.md')));
    const readme = read('README.md');
    for (const name of ['00-master.md', '01-classes', '07-trainers-shops-recipes', '08-reward-tuning', '09-join-and-check', '01-design', '03-check-and-try']) assert.ok(readme.includes(name), `README names ${name}`);
});

test('every {{placeholder}} a prompt uses is explained in that prompt', () => {
    for (const path of walk(join(kit, 'prompts')).filter(path => path.endsWith('.md'))) {
        const text = readFileSync(path, 'utf8');
        const used = new Set([...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(match => match[1]));
        for (const name of used) assert.ok(text.includes(`| \`{{${name}}}\``) || text.includes(`\`{{${name}}}\``), `${path.slice(kit.length + 1)} uses {{${name}}} without a row for it`);
    }
});

test('the agent files are pointers, and the standing rules say what they must', () => {
    for (const name of ['CLAUDE.md', 'GEMINI.md']) {
        const text = read(name);
        assert.equal(text.trim().split('\n').length, 1, name);
        assert.match(text, /AGENTS\.md/);
    }
    const rules = read('AGENTS.md');
    for (const phrase of ['only from the lore and the references', 'only valid JSON files in `work/`', 'Keep existing slugs', 'After every step, run the checker', 'work/notes.md', 'No network, no installing']) {
        assert.ok(rules.includes(phrase) || rules.toLowerCase().includes(phrase.toLowerCase()), phrase);
    }
    assert.match(read('.gitignore'), /^\/work\/\*$/m);
    assert.match(read('.gitignore'), /^!\/work\/README\.md$/m);
});

test('the kit names no model, and only its README names tools; nothing is specific to one person or world', () => {
    const models = /\b(sonnet|opus|haiku|gpt-?\d|chatgpt|openai|anthropic|llama|mistral|gemini-\d|claude-\d)\b/i;
    const tools = /\b(claude code|cursor|gemini cli|antigravity|codex cli|codex|gemini)\b/i;
    const person = /\b(ersveil|wessel|bluewatch)\b/i;
    for (const path of kitFiles()) {
        const rel = path.slice(kit.length + 1);
        const text = readFileSync(path, 'utf8');
        assert.doesNotMatch(text, models, `${rel} names a model`);
        assert.doesNotMatch(text, person, `${rel} is specific to one world`);
        if (rel !== 'README.md') assert.doesNotMatch(text, tools, `${rel} names a tool`);
    }
});

test('the example world: the lore page is one page, and every name in the pack is in it', () => {
    const lore = read('examples/tiny-world/lore.md');
    assert.ok(lore.split('\n').length < 60);
    const pack = json('examples/tiny-world/pack.json');
    const normalized = lore.toLowerCase().replace(/['’]/g, '');
    for (const cls of pack.content.rules[0].classes) assert.ok(normalized.includes(cls.name.toLowerCase().replace(/['’]/g, '')), cls.name);
    for (const place of pack.content.places) assert.ok(normalized.includes(place.name.toLowerCase().replace(/^the /, '')), place.name);
    for (const item of pack.content.items) assert.ok(normalized.includes(item.name.toLowerCase().replace(/['’]/g, '')) || normalized.includes(item.name.toLowerCase().replace(/['’]s? /, ' ').replace(/['’]/g, '')), item.name);
    assert.equal(pack.content.rules[0].classes.length, 4);
    assert.equal(pack.content.rules[0].branches.length, 24);
});

test('the data module numbers the prompts quote are the interpreter\'s', () => {
    const format = read('reference/DATA-MODULES-FORMAT.md');
    assert.ok(format.includes(`up to ${DM_LIMITS.definitions} per pack`));
    assert.ok(format.includes(`Depth ${DM_LIMITS.expressionDepth}, ${DM_LIMITS.expressionNodes} nodes`));
    assert.ok(format.includes(`1 to ${DM_LIMITS.enumValues} distinct`) && format.includes(`1 to ${DM_LIMITS.mapKeys} slugs`));
    assert.ok(format.includes(`(1 to ${DM_LIMITS.text})`));
    assert.ok(format.includes(`at most ${DM_LIMITS.slug} characters`));
    assert.ok(format.includes(`at most ${DM_LIMITS.migrations} steps`));
    assert.ok(format.includes(`1 to ${DM_LIMITS.elapsedMinutes.toLocaleString('en-US')} minutes`));
});
