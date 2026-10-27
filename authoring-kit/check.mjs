// Checks a pack file with Story Block's own validator: the one the extension and Story Studio use.
//
//   node check.mjs work/pack.json                 (from the authoring-kit folder; or node authoring-kit/check.mjs ...)
//   node check.mjs work/pack.json --through 3     a rules pack still being drafted: see below
//   node check.mjs work/pack.json --with-capability my-module     (repeatable) a module you really have installed
//
// Prints OK, or a numbered list of problems, each with the path it is at and a one-line hint. Exit code 0 when the
// pack is accepted, 1 when it is not (or cannot be read), 2 when it is used wrongly. No dependencies, no network.
//
// The pack is judged as if every module of a full Story Suite were installed, so only the pack itself is in question.
// A capability the suite does not provide (a misspelling, or a module this kit does not know) is an error, exit 1; an author who
// really has another module installed names what it provides with --with-capability <name>, and only those names are added.
// `--through N` (1 to 6, the steps of prompts/rules-pack/) is for a rules pack that is not finished: it fills in
// harmless stand-ins for what the steps AFTER N will write (skills, branches, item rules, trainers), so the checker can
// judge the steps already done. Whatever step N or an earlier step owns is judged exactly as written, missing or null
// included. A pack is only ever finished when it passes without --through.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SB_V2 } from './scripts/sb-root.mjs';

const { validatePack, slugify } = await import(new URL('packs/validate.js', SB_V2));
const { HOST_CAPABILITIES } = await import(new URL('packs/limits.js', SB_V2));

// Every capability a full Story Suite provides: the host's own, the module ids and the state areas they own.
export const SUITE_CAPABILITIES = Object.freeze([...new Set([...HOST_CAPABILITIES,
    'story-block', 'rpg-battle', 'story-director', 'npc-state-delta',
    'inventory', 'scene', 'party', 'combat', 'director', 'quests', 'npc'])]);

// One line of advice for each code the checkers use. A code without one gets the general line.
const HINTS = Object.freeze({
    'bad-schema': 'A field is missing, misspelled, of the wrong type or out of range; compare it with reference/rules-v2.schema.json.',
    'envelope-unknown': 'Remove the field or fix its spelling; only the fields the format lists are allowed.',
    'unsafe-markup': 'Take "<", ">" and HTML out of every text.',
    'control-character': 'Take line breaks and control characters out of names and notes.',
    'unsafe-key': 'Rename the key; "__proto__", "constructor" and "prototype" are not allowed.',
    'dup-id': 'Every slug is used once; classes, skills, branches and trainers share one list of slugs, and no branch slug ends in "-g".',
    'tier-chain': 'Tier 0 classes have parent null; every other class has a parent exactly one tier lower; every chain ends at tier 3.',
    'class-skills': 'Every class lists exactly 3 skills, and every skill belongs to exactly one class.',
    'branch-graph': 'A tier 3 skill has 8 written branches: a and b from the base, then a and b under each of -a, -b and -g; the slug is the form it creates.',
    'numeric-range': 'A number is outside its allowed range; see reference/LIMITS.md.',
    'bad-transform': 'A transform names an effect index that does not exist, or an op that does not fit that effect.',
    'bad-effect': 'An effect has the wrong targets or fields for its op: heal and shield need friendly targets and damageType null.',
    'mp-sp-conflict': 'A physical skill spends sp and has mp 0; every other type spends mp and has sp 0.',
    'numeric-only-branch': 'A written branch must change what the skill does (target, element, effects, type, stat), not only its numbers.',
    'budget-closure': 'Lower power, chance, rounds or amount (or drop a target from "all"); reference/LIMITS.md shows the power budget of each form.',
    'bad-ref': 'The name does not exist in this pack; check the slug against the list it comes from.',
    'too-large': 'The pack is too big; see reference/LIMITS.md for the sizes allowed.',
    'item-rule-mismatch': 'Every item has exactly one item rule; only equipment has slots, and hands must match the slots.',
    'bad-xp-per-level': 'xpPerLevel must be a whole number the format allows.',
    'step-limit': 'A branch graph is deeper than two steps.',
    'bad-form': 'A skill form needs 1 to 4 effects and a valid unit.',
    'bad-rules': 'A generated power-up does not fit: keep the first damage, heal or shield power at 980 or less (or the first stat amount at 9, or condition rounds at 5).',
    'bad-capability': 'List "rb-rules-v2" in requires.capabilities.',
    MISSING_CAPABILITY: 'Check the spelling against reference/PACK-FORMAT.md; if you really have a module installed that provides it, run the check with --with-capability <name>.',
    UNKNOWN_FIELD: 'Remove the field or fix its spelling; only the listed fields are allowed.',
    UNKNOWN_KIND: 'content only holds the kinds reference/PACK-FORMAT.md lists.',
    UNKNOWN_REF: 'The name does not exist in this pack; check it against the list it comes from.',
    BAD_RECORD: 'A record is missing a required field or has a value of the wrong kind.',
    BAD_CONTENT: 'content must be an object of lists.',
    BAD_REQUIRES: 'requires needs "storyBlock" (for example "^2") and an optional list "capabilities".',
    BAD_VERSION: 'version looks like 1.0.0.',
    BAD_ID: 'The pack id is 1 to 40 lowercase letters, digits or dashes.',
    HOST_VERSION: 'The pack asks for a Story Block version this one is not; use "^2".',
    DUPLICATE: 'Two records of one kind share a slug or name; make one different.',
    UNSAFE_HTML: 'Take "<", ">" and HTML out of the text.',
    TOO_LONG: 'The text is longer than the format allows; shorten it.',
    TOO_MANY: 'The list is longer than the format allows; see reference/LIMITS.md.',
    TOO_DEEP: 'The data is nested too deeply; flatten it.',
    NOT_PLAIN: 'Only plain JSON data is allowed.',
    DM_SCHEMA: 'A data module field is missing, unknown or wrongly typed; see reference/DATA-MODULES-FORMAT.md.',
    DM_BOUNDS: 'A value or a calculation can leave the bounds of the field it touches; widen the field or clamp.',
    DM_LABEL: 'Labels are single lowercase words with a declared type; "kind" and "who" are reserved.',
    DM_CONDITION: 'A condition must give true or false, with no conversion.',
    DM_BUDGET: 'The data module is larger than version 1 allows; see reference/LIMITS.md.',
    'not-json': 'Fix the JSON text: no comments, no trailing commas, double quotes around every key and string.',
});
const GENERAL = 'See reference/LIMITS.md and reference/PACK-FORMAT.md for what this part allows.';

/** The one-line advice for a problem: by its code, with sharper lines for the mistakes made most often. */
export function hintFor({ code, path = '', message = '' }) {
    // A trainer template (step 7 (c)): the path and the message tell which of its four mistakes this is. A fixed
    // trainer has a place and a whole-number fee, so it never produces the first two.
    const trainerField = /^content\.rules\[0\]\.trainers\[\d+\]\.(place|fee|rank)$/.exec(path)?.[1];
    if (code === 'envelope-unknown' && trainerField === 'place') return 'A trainer template has no place: it stands where the story offers it. Remove "place", or remove "open" to make a fixed trainer.';
    if (code === 'bad-schema' && trainerField === 'fee') {
        if (/Expected object/.test(message)) return 'A trainer template\'s fee is a range: {"coinMin": 30, "coinMax": 80}.';
        if (/must be ordered/.test(message)) return 'coinMin must not be above coinMax.';
    }
    if (code === 'bad-schema' && trainerField === 'rank') return 'Name a rank id from content.ranks, such as "F".';
    // Count bounds, foe aliases and offer words (Story Block 2.5.0): the path tells which one this is.
    if (/\.objectives\[\d+\]\.count(Min|Max)$/.test(path) && code === 'envelope-unknown') return 'Only an open quest template ("open": true) bounds a count, and only on a kill or collect objective; remove countMin and countMax here.';
    if (/\.objectives\[\d+\]\.count$/.test(path) && /countM(in|ax)/.test(message)) return 'An open objective\'s count must lie between its countMin and its countMax; move one of the three numbers (both bounds are optional, each 1 to 999).';
    if (/\.objectives\[\d+\]\.countM(in|ax)$/.test(path)) return 'countMin and countMax are whole numbers from 1 to 999, and countMin is not above the objective\'s count.';
    if (/^content\.creatures\[\d+\]\.aliases/.test(path)) return 'A foe\'s aliases are at most 8 different names, each 1 to 80 characters: other names the story may use for this creature, never another creature\'s name.';
    if (/^content\.rules\[0\]\.offerWords/.test(path)) return 'offerWords holds the lists hunt, cull, gather, deliver, explore, escort, task, easy, normal, hard and nightmare, each at most 40 lower-case words of 1 to 24 characters.';
    if (code === 'bad-schema' && /does not match pattern/.test(message)) {
        if (message.includes('(?:[a-z][a-z0-9]*_[0-9a-z]{8}|')) return 'Places and other ids are written in full as pack.<pack id>/<slug>, with the pack\'s own id.';
        if (message.includes('^[a-z0-9]+(?:-[a-z0-9]+)*$')) return 'A slug is lowercase letters, digits and single dashes, with no spaces or capitals.';
    }
    return HINTS[code] ?? GENERAL;
}

const STATS = ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bare = ref => typeof ref === 'string' ? ref.replace(/^pack\.[^/]+\//, '') : ref;

/**
 * A copy of a rules pack with stand-ins for what the steps after `through` will write, so the checker can judge the
 * rest: a plain strike for each class skill not yet written (step 2), eight stat-only branches for each tier 3 skill
 * without branches (step 3), and a rule for each item without one (step 4). Anything it cannot read is left as it is.
 */
export function withStandIns(pack, through) {
    const doc = structuredClone(pack);
    try {
        const rules = doc?.content?.rules?.[0];
        if (!isRecord(rules) || !Array.isArray(rules.classes)) return doc;
        // A list a later step writes may be absent for now. A list step `through` or an earlier step owns is judged as it stands.
        const owner = { skills: 2, branches: 3, itemRules: 4, trainers: 7 };
        for (const [key, step] of Object.entries(owner)) if (step > through) rules[key] ??= [];
        if (through < 2 && Array.isArray(rules.skills)) {
            const have = new Set(rules.skills.map(skill => skill?.slug));
            for (const cls of rules.classes) for (const ref of Array.isArray(cls?.skills) ? cls.skills : []) {
                const slug = bare(ref);
                if (typeof slug === 'string' && !have.has(slug)) {
                    have.add(slug);
                    rules.skills.push({ slug, name: slug, base: { type: 'physical', stat: 'STR', cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [{ op: 'damage', target: 'one', power: 10, element: 'none', damageType: 'physical' }], unit: null } });
                }
            }
        }
        if (through < 3 && Array.isArray(rules.skills) && Array.isArray(rules.branches)) {
            const advanced = new Set(rules.classes.filter(cls => cls?.tier === 3).flatMap(cls => Array.isArray(cls.skills) ? cls.skills.map(bare) : []));
            const written = new Set(rules.branches.map(branch => bare(branch?.skill)));
            for (const skill of rules.skills) {
                if (!advanced.has(skill?.slug) || written.has(skill.slug)) continue;
                const start = STATS.includes(skill.base?.stat) ? skill.base.stat : 'STR';
                const pick = (not) => STATS.find(stat => !not.includes(stat));
                const add = (from, choice, step, stat) => rules.branches.push({ slug: `${from}-${choice}`, skill: skill.slug, fromForm: from, step, choice, name: `${skill.slug} ${from}-${choice}`.slice(0, 80), transforms: [{ op: 'set-stat', value: stat }] });
                const base = `${skill.slug}-base`;
                const a = pick([start]);
                const b = pick([start, a]);
                add(base, 'a', 1, a); add(base, 'b', 1, b);
                for (const [form, stat] of [[`${base}-a`, a], [`${base}-b`, b], [`${base}-g`, start]]) {
                    const x = pick([stat]);
                    add(form, 'a', 2, x); add(form, 'b', 2, pick([stat, x]));
                }
            }
        }
        if (through < 4 && Array.isArray(rules.itemRules) && Array.isArray(doc.content.items)) {
            const have = new Set(rules.itemRules.map(rule => bare(rule?.def)));
            for (const item of doc.content.items) {
                const slug = isRecord(item) ? (item.slug ?? slugify(String(item.name ?? ''))) : null;
                if (!slug || have.has(slug)) continue;
                let slots = [];
                let hands = 0;
                if (item.kind === 'equipment') {
                    const slot = item.slot;
                    slots = slot === 'weapon' || slot === 'offhand' ? [slot] : /^accessory/.test(slot ?? '') ? ['accessory-1', 'accessory-2'] : ['head', 'body', 'legs', 'feet'].includes(slot) ? [slot] : ['body'];
                    hands = slot === 'weapon' || slot === 'offhand' ? 1 : 0;
                }
                rules.itemRules.push({ def: slug, allowedSlots: slots, hands, requires: {}, weight: 0 });
            }
        }
    } catch { /* an unreadable pack is the checker's to describe */ }
    return doc;
}

/**
 * Advice for a trainer template whose dearest lesson costs more than a whole quest of its rank pays. The validator
 * accepts it on purpose (lessons are not bound to quest pay), so this is a note and never a failure.
 */
export function templateFeeNotes(pack) {
    const notes = [];
    try {
        const trainers = pack?.content?.rules?.[0]?.trainers;
        const ranks = pack?.content?.ranks;
        if (!Array.isArray(trainers) || !Array.isArray(ranks)) return notes;
        trainers.forEach((trainer, i) => {
            if (!isRecord(trainer) || trainer.open !== true || !isRecord(trainer.fee)) return;
            const rank = ranks.find(row => isRecord(row) && row.id === trainer.rank);
            const top = Array.isArray(rank?.reward) ? rank.reward[1] : undefined;
            if (Number.isFinite(top) && Number.isFinite(trainer.fee.coinMax) && trainer.fee.coinMax > top) {
                notes.push(`content.rules[0].trainers[${i}]: a lesson can cost up to ${trainer.fee.coinMax}, more than a whole rank ${rank.id} quest pays (${top}). Check the range.`);
            }
        });
    } catch { /* a note is a bonus */ }
    return notes;
}

/**
 * Checks pack text or an object. Returns { ok, errors, notes, capped, hashes? }; never throws.
 * `withCapabilities`: names a module the author really has installed provides, added to the suite's own.
 */
export function checkPack(input, { through = null, withCapabilities = [] } = {}) {
    let pack = input;
    if (typeof input === 'string') {
        try { pack = JSON.parse(input.replace(/^\uFEFF/, '')); }
        catch (error) { return { ok: false, errors: [{ code: 'not-json', path: '', message: `This is not valid JSON: ${error.message}` }], notes: [] }; }
    }
    const capabilities = [...new Set([...SUITE_CAPABILITIES, ...withCapabilities])];
    const notes = withCapabilities.filter(name => !SUITE_CAPABILITIES.includes(name)).map(name => `--with-capability: "${name}" is taken as provided by a module you have installed; Story Block refuses the pack where no installed module provides it.`);
    const draft = through !== null && through < 7 && isRecord(pack) ? withStandIns(pack, through) : pack;
    const result = validatePack(draft, { capabilities });
    if (result.ok) {
        const hashes = {};
        for (const key of ['rulesHash', 'packHash']) { try { if (result[key]) hashes[key] = result[key]; } catch { /* a hash is a bonus */ } }
        return { ok: true, errors: [], notes: [...notes, ...templateFeeNotes(pack)], hashes };
    }
    const errors = result.errors ?? [];
    return { ok: false, errors, notes, capped: errors.length >= 20 };
}

export function report(file, result, { through = null } = {}) {
    const lines = [];
    if (result.ok) {
        lines.push(through !== null && through < 7 ? `OK through step ${through}: ${file}` : `OK ${file}`);
        if (through !== null && through < 7) lines.push(`(steps ${through + 1} to 7 are not judged yet; when they are written, run the check without --through)`);
        else if (result.hashes?.rulesHash) lines.push(`rules ${result.hashes.rulesHash.slice(0, 12)}  pack ${result.hashes.packHash?.slice(0, 12) ?? ''}`.trimEnd());
        else if (result.hashes?.packHash) lines.push(`pack ${result.hashes.packHash.slice(0, 12)}`);
    } else {
        lines.push(`${result.errors.length} problem${result.errors.length === 1 ? '' : 's'} in ${file}`, '');
        result.errors.forEach((error, i) => {
            lines.push(`${String(i + 1).padStart(2)}. ${error.path || '(whole file)'}`);
            lines.push(`    ${error.message}`);
            lines.push(`    hint: ${hintFor(error)}`);
        });
        if (result.capped) lines.push('', 'The checker stops at 20 problems: fix these, then run it again for the rest.');
    }
    for (const note of result.notes ?? []) lines.push('', `note: ${note}`);
    return lines.join('\n');
}

function main(argv) {
    const args = argv.slice(2);
    let through = null;
    const withCapabilities = [];
    for (const [flag, take] of [['--through', value => { through = Number(value); }], ['--with-capability', value => { withCapabilities.push(value); }]]) {
        for (let at = args.indexOf(flag); at >= 0; at = args.indexOf(flag)) {
            if (args[at + 1] === undefined || args[at + 1].startsWith('--')) { console.error(`${flag} needs a value`); return 2; }
            take(args[at + 1]);
            args.splice(at, 2);
        }
    }
    if (through !== null && (!Number.isInteger(through) || through < 1 || through > 7)) { console.error('--through takes a step number from 1 to 7'); return 2; }
    if (withCapabilities.some(name => !/^[a-z][a-z0-9-]{0,39}$/.test(name))) { console.error('--with-capability takes a name of lowercase letters, digits and dashes'); return 2; }
    if (args.length !== 1 || args[0].startsWith('--')) { console.error('usage: node check.mjs <pack.json> [--through 1..7] [--with-capability <name>]...'); return 2; }
    let text;
    try { text = readFileSync(args[0], 'utf8'); } catch (error) { console.error(`Cannot read ${args[0]}: ${error.code ?? error.message}`); return 1; }
    const result = checkPack(text, { through, withCapabilities });
    console.log(report(args[0], result, { through }));
    return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv);
