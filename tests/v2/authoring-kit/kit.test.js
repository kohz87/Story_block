// The authoring kit (authoring-kit/): a checker over Story Block's own validator, prompts whose numbers are Story Block's
// numbers, references that equal what Story Block ships, and a generated LIMITS.md that cannot drift. Story Studio carries a
// synced copy of the kit and tests the copy; this file tests the original.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPack, report, hintFor, withStandIns, SUITE_CAPABILITIES } from '../../../authoring-kit/check.mjs';
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

test('a capability the suite does not provide is an error, unless --with-capability names it', () => {
    const pack = clone(json('examples/tiny-world/pack.json'));
    pack.requires.capabilities.push('mystery-module');
    const result = checkPack(pack);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, 'MISSING_CAPABILITY');
    assert.match(report('x', result), /mystery-module[\s\S]*hint: .*--with-capability <name>/);
    // Only names passed that way are added, and each one only for its own run.
    assert.equal(checkPack(pack, { withCapabilities: ['other-module'] }).ok, false);
    const allowed = checkPack(pack, { withCapabilities: ['mystery-module'] });
    assert.equal(allowed.ok, true);
    assert.match(report('x', allowed), /note: --with-capability: "mystery-module"/);
    assert.equal(checkPack(pack).ok, false);
    // A misspelling of a real one is caught too.
    const typo = clone(json('examples/tiny-world/pack.json'));
    typo.requires.capabilities = ['rb-rules-v3'];
    assert.equal(checkPack(typo).ok, false);

    const file = join(tmpdir(), `kit-capability-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(pack));
    try {
        const run = node('authoring-kit/check.mjs', file);
        assert.equal(run.status, 1);
        assert.match(run.out, /^1 problem in /);
        assert.match(run.out, /requires\.capabilities\n {4}This pack needs mystery-module/);
        assert.equal(node('authoring-kit/check.mjs', file, '--with-capability', 'mystery-module').status, 0);
        assert.equal(node('authoring-kit/check.mjs', file, '--with-capability', 'mystery-module', '--with-capability', 'second').status, 0);
        assert.equal(node('authoring-kit/check.mjs', file, '--with-capability', 'other-module').status, 1);
        assert.equal(node('authoring-kit/check.mjs', file, '--with-capability').status, 2);
        assert.equal(node('authoring-kit/check.mjs', file, '--with-capability', 'Bad Name').status, 2);
    } finally { rmSync(file, { force: true }); }
    // The names the checker knows are the ones PACK-FORMAT.md tells authors about.
    for (const name of SUITE_CAPABILITIES) assert.ok(read('reference/PACK-FORMAT.md').includes(`\`${name}\``), name);
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

test('--through never lets an incomplete or wrong earlier step pass: stand-ins fill only what later steps write', () => {
    const full = json('examples/tiny-world/pack.json');
    const later = pack => { for (const kind of ['creatures', 'quests', 'shops', 'recipes']) delete pack.content[kind]; pack.content.rules[0].trainers = []; };
    // The step that owns each thing, and a way to leave it missing, null or wrong. A pack with the damage at step k must fail
    // for every --through N from k to 6 (the stand-ins at N stand in for steps after N only).
    const damage = [
        [1, 'classes missing', (p, r) => { delete r.classes; }],
        [1, 'classes null', (p, r) => { r.classes = null; }],
        [1, 'a class with the wrong parent', (p, r) => { r.classes[2].parent = 'lamplighter'; }],
        [1, 'a class with two skills', (p, r) => { r.classes[0].skills.pop(); }],
        [2, 'skills missing', (p, r) => { delete r.skills; }],
        [2, 'skills null', (p, r) => { r.skills = null; }],
        [2, 'skills empty', (p, r) => { r.skills = []; }],
        [2, 'one class skill not written', (p, r) => { r.skills.splice(0, 1); }],
        [2, 'a skill over its budget', (p, r) => { r.skills[0].base.effects[0].target = 'all'; }],
        [3, 'branches missing', (p, r) => { delete r.branches; }],
        [3, 'branches null', (p, r) => { r.branches = null; }],
        [3, 'branches empty', (p, r) => { r.branches = []; }],
        [3, 'one branch short', (p, r) => { r.branches.pop(); }],
        [3, 'a numbers-only branch', (p, r) => { r.branches[0].transforms = [{ op: 'set-power', at: 0, value: 110 }]; }],
        [4, 'itemRules missing', (p, r) => { delete r.itemRules; }],
        [4, 'itemRules null', (p, r) => { r.itemRules = null; }],
        [4, 'itemRules empty', (p, r) => { r.itemRules = []; }],
        [4, 'items empty and itemRules null', (p, r) => { p.content.items = []; r.itemRules = null; }],
        [4, 'one item without a rule', (p, r) => { r.itemRules.pop(); }],
        [4, 'a rule with the wrong slots', (p, r) => { r.itemRules[5].allowedSlots = ['offhand']; }],
        [5, 'a foe with an unknown skill', (p, r) => { p.content.creatures[0].skills = ['no-such-skill']; }],
        [5, 'a foe with no stats', (p, r) => { delete p.content.creatures[0].stats; }],
        [6, 'a quest for a foe that is not there', (p, r) => { p.content.quests[0].objectives[0].foe = 'no-such-foe'; }],
    ];
    for (const [step, label, change] of damage) {
        for (let through = 1; through <= 6; through += 1) {
            const pack = clone(full);
            if (through < 5) later(pack);
            if (through === 5) { for (const kind of ['quests', 'shops', 'recipes']) delete pack.content[kind]; pack.content.rules[0].trainers = []; }
            if (through === 6) { for (const kind of ['shops', 'recipes']) delete pack.content[kind]; pack.content.rules[0].trainers = []; }
            if (step > through) continue;
            change(pack, pack.content.rules[0]);
            // For --through below the step that owns the part, the part is not required yet: only steps <= through are held to account.
            const result = checkPack(pack, { through });
            assert.equal(result.ok, false, `--through ${through} passed with step ${step} damaged: ${label}`);
            const cli = report('x', result, { through });
            assert.match(cli, /^\d+ problems? in x/, label);
        }
    }
    // The reported case: no items and itemRules null passes nothing at --through 4, and the full check agrees.
    const reported = clone(full);
    later(reported);
    reported.content.items = [];
    reported.content.rules[0].itemRules = null;
    assert.equal(checkPack(reported, { through: 4 }).ok, false);
    assert.ok(checkPack(reported, { through: 4 }).errors.some(error => error.path === 'content.rules[0].itemRules'));
    assert.equal(checkPack(reported).ok, false);
    // The same pack passes --through 3, where item rules are a later step.
    assert.equal(checkPack(reported, { through: 3 }).ok, true);
    // Absent lists of later steps are stand-ins; null in a step already due is not.
    const standIn = withStandIns(clone(full), 2);
    assert.ok(standIn.content.rules[0].itemRules.length >= full.content.rules[0].itemRules.length);
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
    // Two blocks are an error that names the file; so is text that is not JSON.
    assert.throws(() => readAnswer('```json\n{"classes":[]}\n```\nand then\n```json\n{"skills":[]}\n```', 'answer.md'), /^Error: answer\.md: more than one JSON block; keep one$/);
    assert.throws(() => readAnswer('{ nope', 'f.json'), /f\.json: not valid JSON/);
    const dir = mkdtempSync(join(tmpdir(), 'kit-join-'));
    try {
        const basePath = join(dir, 'base.json');
        const twice = join(dir, 'twice.md');
        writeFileSync(basePath, JSON.stringify({ id: 'x', version: '1.0.0', name: 'X' }));
        writeFileSync(twice, '```json\n{"classes":[]}\n```\n```json\n{"skills":[]}\n```\n');
        const run = node('authoring-kit/scripts/join.mjs', basePath, twice, '--out', join(dir, 'out.json'));
        assert.equal(run.status, 1);
        assert.ok(run.err.includes(`join: ${twice}: more than one JSON block; keep one`), run.err);
        assert.equal(existsSync(join(dir, 'out.json')), false);
        writeFileSync(twice, 'Here you go:\n```json\n{"classes":[]}\n```\n');
        assert.equal(node('authoring-kit/scripts/join.mjs', basePath, twice, '--out', join(dir, 'out.json')).status, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
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
    // Trainers: fixed and templates share one list; each kind has its own row, from the schema's own numbers.
    assert.match(printed.out, /\| Trainers \(fixed and templates together\) \| 0 to 100 entries \|/);
    assert.match(printed.out, /\| Trainer \(fixed\) \| place a full place id; skills 1 to 30; fee 1 to 1,000,000 \(never 0\); minutes exactly 60; up to 8 eventTemplates \|/);
    assert.match(printed.out, /\| Trainer template \| `open: true`, a `rank` that names a pack rank, no `place`; skills 1 to 30; fee `\{ coinMin, coinMax \}`, each 1 to 1,000,000, coinMin not above coinMax; minutes exactly 60; up to 8 eventTemplates \|/);
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
    const trainer = defs.fixedTrainer.properties;
    assert.ok(steps.includes(`"minutes":${trainer.minutes.const}`));
    assert.ok(steps.includes(`"eventTemplates":[]`));
    assert.ok(steps.includes(`at most 1000000`) && trainer.fee.maximum === 1000000 && trainer.fee.minimum === 1);
    // Trainer templates (step 7 (c)): the same numbers, for the template's fee range.
    const template = defs.openTrainer.properties;
    const range = defs.openFee.properties;
    const step7 = read('prompts/rules-pack/07-trainers-shops-recipes.md');
    assert.ok(step7.includes('"open":true') && template.open.const === true);
    assert.ok(step7.includes(`"minutes":${template.minutes.const}`));
    assert.ok(step7.includes('"coinMin"') && step7.includes('"coinMax"'));
    assert.ok(step7.includes(`at least ${range.coinMin.minimum}`) && range.coinMin.minimum === 1);
    assert.equal(step7.split(`at most ${range.coinMax.maximum}`).length - 1, 2, 'both the fixed fee and the template fee state the maximum');
    assert.equal(range.coinMax.maximum, trainer.fee.maximum);
    assert.ok(step7.includes(`${template.skills.minItems}-${template.skills.maxItems} skill slugs`));
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
    fails((p, r) => { p.content.quests[0].giver = 'npc/some-person'; }, 'bad-ref');
    fails((p, r) => { p.content.quests[0].turnInPlace = 'lanternfall'; }, 'bad-schema');
    fails((p, r) => { r.classes[0].note = 'a <b>tag</b>'; }, 'UNSAFE_HTML');
    // Trainer templates: the mistakes step 7 (c) warns about.
    const lesson = () => ({ slug: 'open-drills', name: 'Drills', open: true, rank: 'F', skills: ['lantern-swing', 'warding-glow'], fee: { coinMin: 20, coinMax: 60 }, minutes: 60, eventTemplates: [] });
    const withTemplate = change => (p, r) => { const t = lesson(); change(t); r.trainers.push(t); };
    assert.equal(checkPack((() => { const pack = clone(full); pack.content.rules[0].trainers.push(lesson()); return pack; })()).ok, true, 'a well-formed template is accepted');
    fails(withTemplate(t => { t.place = 'pack.lanternfall/lanternfall'; }), 'envelope-unknown');
    fails(withTemplate(t => { t.fee = { coinMin: 61, coinMax: 60 }; }), 'bad-schema');
    fails(withTemplate(t => { t.rank = 'Z'; }), 'bad-schema');
    fails(withTemplate(t => { t.fee = 40; }), 'bad-schema');
});

test('a trainer template\'s four mistakes each get the sharper hint, and a fixed trainer never gets them', () => {
    const full = json('examples/tiny-world/pack.json');
    const lesson = () => ({ slug: 'open-drills', name: 'Drills', open: true, rank: 'F', skills: ['lantern-swing', 'warding-glow'], fee: { coinMin: 20, coinMax: 60 }, minutes: 60, eventTemplates: [] });
    const hintsFor = change => {
        const pack = clone(full);
        const t = lesson();
        change(t);
        pack.content.rules[0].trainers.push(t);
        const result = checkPack(pack);
        assert.equal(result.ok, false);
        return result.errors.map(error => ({ path: error.path, hint: hintFor(error) }));
    };
    const at = 'content.rules[0].trainers[1]';
    assert.deepEqual(hintsFor(t => { t.place = 'pack.lanternfall/lanternfall'; }), [{ path: `${at}.place`, hint: 'A trainer template has no place: it stands where the story offers it. Remove "place", or remove "open" to make a fixed trainer.' }]);
    assert.deepEqual(hintsFor(t => { t.fee = 40; }), [{ path: `${at}.fee`, hint: 'A trainer template\'s fee is a range: {"coinMin": 30, "coinMax": 80}.' }]);
    assert.deepEqual(hintsFor(t => { t.fee = { coinMin: 61, coinMax: 60 }; }), [{ path: `${at}.fee`, hint: 'coinMin must not be above coinMax.' }]);
    assert.deepEqual(hintsFor(t => { t.rank = 'Z'; }), [{ path: `${at}.rank`, hint: 'Name a rank id from content.ranks, such as "F".' }]);
    // The same text comes out of the command line.
    const pack = clone(full);
    pack.content.rules[0].trainers.push({ ...lesson(), place: 'pack.lanternfall/lanternfall', fee: 40 });
    const file = join(tmpdir(), `kit-template-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(pack));
    try {
        const run = node('authoring-kit/check.mjs', file);
        assert.equal(run.status, 1);
        assert.match(run.out, /trainers\[1\]\.place\n.*\n {4}hint: A trainer template has no place/);
        assert.match(run.out, /trainers\[1\]\.fee\n.*\n {4}hint: A trainer template's fee is a range/);
    } finally { rmSync(file, { force: true }); }
    // A fixed trainer's own mistakes keep the general hints.
    const fixed = clone(full);
    fixed.content.rules[0].trainers[0].fee = 0;
    const bad = checkPack(fixed);
    assert.equal(bad.ok, false);
    for (const error of bad.errors) assert.notEqual(hintFor(error), 'coinMin must not be above coinMax.');
    assert.equal(hintFor({ code: 'bad-schema', path: 'content.rules[0].trainers[0].rank', message: 'x' }), 'Name a rank id from content.ranks, such as "F".');
    assert.equal(hintFor({ code: 'bad-schema', path: 'content.rules[0].shops[0].place', message: 'x' }), hintFor({ code: 'bad-schema', message: 'x' }));
});

test('a template whose dearest lesson costs more than a whole quest of its rank pays gets a note, and still passes', () => {
    const pack = clone(json('examples/tiny-world/pack.json'));
    const [, top] = pack.content.ranks.find(row => row.id === 'F').reward;
    const lesson = (coinMax) => ({ slug: 'open-drills', name: 'Drills', open: true, rank: 'F', skills: ['lantern-swing'], fee: { coinMin: 20, coinMax }, minutes: 60, eventTemplates: [] });
    pack.content.rules[0].trainers.push(lesson(top));
    const quiet = checkPack(pack);
    assert.equal(quiet.ok, true);
    assert.deepEqual(quiet.notes, [], 'a range that reaches the rank\'s reward maximum is quiet');
    pack.content.rules[0].trainers[1] = lesson(top + 1);
    const loud = checkPack(pack);
    assert.equal(loud.ok, true, 'a note is advice, never a failure');
    assert.deepEqual(loud.notes, [`content.rules[0].trainers[1]: a lesson can cost up to ${top + 1}, more than a whole rank F quest pays (${top}). Check the range.`]);
    assert.match(report('x.json', loud), /^OK x\.json\nrules [0-9a-f]{12}  pack [0-9a-f]{12}\n\nnote: content\.rules\[0\]\.trainers\[1\]: a lesson can cost up to /);
    const file = join(tmpdir(), `kit-template-note-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(pack));
    try {
        const run = node('authoring-kit/check.mjs', file);
        assert.equal(run.status, 0);
        assert.match(run.out, /note: content\.rules\[0\]\.trainers\[1\]: a lesson can cost up to/);
    } finally { rmSync(file, { force: true }); }
    // A fixed trainer never gets the note, whatever its fee.
    const fixed = clone(json('examples/tiny-world/pack.json'));
    fixed.content.rules[0].trainers[0].fee = 999999;
    const result = checkPack(fixed);
    assert.equal(result.ok, true);
    assert.deepEqual(result.notes, []);
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

// ---- Story Block 2.5.0: count bounds, foe aliases and offer words (GENERATIVE_OFFERS_SPEC §12.1, §12.3) ----

const openHunt = (extra = {}) => ({
    slug: 'open-hunt-f', name: 'Hunt', open: true, rank: 'F', category: 'bounty', giver: null, turnInPlace: null, requirements: [],
    objectives: [{ id: 'open-hunt-f/kill', kind: 'kill', count: 3, countMin: 1, countMax: 8, allowVariants: true, ...extra }],
    reward: { coinMin: 40, coinMax: 120, xpMin: 30, xpMax: 90, items: [] }, durationMinutes: null, repeat: null, chain: null,
});

test('the quests and foes prompts teach count bounds and aliases with Story Block\'s own numbers', () => {
    const defs = R.rulesV2Schema.$defs;
    const quests = read('prompts/rules-pack/06-quests.md');
    const foes = read('prompts/rules-pack/05-foes.md');
    const bound = defs.openObjective.oneOf[0].properties.countMin;
    assert.deepEqual([bound.minimum, bound.maximum], [1, 999]);
    assert.deepEqual(defs.openObjective.oneOf[1].properties.countMax, defs.openObjective.oneOf[0].properties.countMax);
    assert.ok(quests.includes('"countMin" and/or "countMax" (whole numbers 1-999)'));
    assert.ok(quests.includes('countMin <= count <= countMax'));
    assert.ok(quests.includes('one story, one hunt and one delivery\n  template for each rank you use'));
    const aliases = defs.foe.properties.aliases;
    assert.deepEqual([aliases.maxItems, aliases.items.minLength, aliases.items.maxLength, aliases.uniqueItems], [8, 1, 80, true]);
    assert.ok(foes.includes('"aliases":[...] (at most 8 different names of 1-80\nUTF-16 units'));
    assert.ok(foes.includes('An alias is never\nthe name or slug of any creature (this one included) nor an alias of another creature'));
    // Each code the checker answers for an alias is named in the step's typical problems, with what causes it.
    assert.match(foes, /`bad-schema` \([^)]*an alias that equals, apart from capitals and spacing, a creature's name or slug, another creature's alias or an earlier alias of the same creature, or has no visible character\)/);
    assert.match(foes, /`numeric-range` \(more than 8 aliases, an alias of 0 or over 80 UTF-16 units\)/);
    assert.match(foes, /`dup-id` \(an alias written twice exactly\)/);
    // A pack that uses the 2.5 fields needs a Story Block that knows them.
    for (const text of [quests, foes, read('reference/PACK-FORMAT.md')]) assert.ok(text.includes('"storyBlock": "^2.5"') || text.includes('`"storyBlock": "^2.5"`'));
    // The reference page says all three, and LIMITS.md (generated) carries their numbers.
    const format = read('reference/PACK-FORMAT.md');
    for (const word of ['countMin', 'countMax', 'aliases', 'offerWords', 'nightmare']) assert.ok(format.includes(word), word);
    const limits = read('reference/LIMITS.md');
    assert.match(limits, /optional `aliases`, up to 8 different names the story may use for it \(1 to 80 UTF-16 units each; an alias never equals, apart from capitals and spacing, a creature's name or slug, another creature's alias or one of its own, and has a visible character\)/);
    assert.match(limits, /`countMin` and `countMax` \(each 1 to 999/);
    assert.match(limits, /`offerWords` on the rules manifest: the lists hunt, cull, gather, deliver, explore, escort, task, easy, normal, hard, nightmare; each 0 to 40 entries, a word 1 to 24 UTF-16 units, lower case/);
    assert.deepEqual(Object.keys(defs.offerWords.properties), ['hunt', 'cull', 'gather', 'deliver', 'explore', 'escort', 'task', 'easy', 'normal', 'hard', 'nightmare']);
});

test('the checker accepts count bounds, aliases and offer words, and each mistake gets its own hint', () => {
    const full = json('examples/tiny-world/pack.json');
    const build = change => {
        const pack = clone(full);
        pack.content.quests.push(openHunt());
        change(pack);
        return pack;
    };
    const good = checkPack(build(pack => {
        pack.content.creatures[0].aliases = ['wisp', 'marsh light'];
        pack.content.rules[0].offerWords = { hunt: ['jagd'], easy: ['leicht'] };
    }));
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    const hints = change => {
        const result = checkPack(build(change));
        assert.equal(result.ok, false);
        return result.errors.map(error => ({ path: error.path, hint: hintFor(error) }));
    };
    const q = 'content.quests[2].objectives[0]';
    const bounds = 'An open objective\'s count must lie between its countMin and its countMax; move one of the three numbers (both bounds are optional, each 1 to 999).';
    assert.deepEqual(hints(p => { p.content.quests[2].objectives[0].countMin = 4; }), [{ path: `${q}.count`, hint: bounds }]);
    assert.deepEqual(hints(p => { p.content.quests[2].objectives[0].countMax = 2; }), [{ path: `${q}.count`, hint: bounds }]);
    assert.match(hints(p => { p.content.quests[2].objectives[0].countMin = 0; })[0].hint, /whole numbers from 1 to 999/);
    // A closed quest, or a visit objective, has no count to bound.
    const closed = hints(p => { p.content.quests[0].objectives[0].countMax = 6; });
    assert.equal(closed.length, 1);
    assert.match(closed[0].hint, /^Only an open quest template/);
    // Each alias mistake gets the hint for the code the checker really answers with.
    const alias = change => { const out = hints(p => change(p.content.creatures)); assert.equal(out.length, 1, JSON.stringify(out)); return out[0]; };
    assert.deepEqual(alias(c => { c[0].aliases = ['wisp', 'wisp']; }), { path: 'content.creatures[0].aliases', hint: 'An alias is written twice; list each alias once.' });
    assert.deepEqual(alias(c => { c[0].aliases = Array.from({ length: 9 }, (_, i) => `a${i}`); }), { path: 'content.creatures[0].aliases', hint: 'A foe has at most 8 aliases.' });
    assert.deepEqual(alias(c => { c[0].aliases = ['x'.repeat(81)]; }), { path: 'content.creatures[0].aliases[0]', hint: 'An alias is 1 to 80 UTF-16 units long.' });
    const collide = /^An alias may not equal, apart from capitals and spacing, any creature's name or slug/;
    for (const [aliases, at] of [[['Wisp', 'wisp'], 1], [[`Mud  Crawler`], 0], [['reed-wisp'], 0], [['\u200b'], 0]]) {
        const found = alias(c => { c[0].aliases = aliases; });
        assert.equal(found.path, `content.creatures[0].aliases[${at}]`);
        assert.match(found.hint, collide);
    }
    assert.match(hints(p => { p.content.rules[0].offerWords = { hunt: ['Slay'] }; })[0].hint, /^offerWords holds the lists hunt, cull/);
    // An inverted range is said once, at countMax.
    assert.deepEqual(hints(p => { Object.assign(p.content.quests[2].objectives[0], { countMin: 9, countMax: 8 }); }), [{ path: `${q}.countMax`, hint: 'countMin is above countMax: swap them, or lower countMin, so that countMin <= count <= countMax.' }]);
    assert.match(hints(p => { p.content.rules[0].offerWords = { slay: ['x'] }; })[0].hint, /^offerWords holds the lists/);
});
