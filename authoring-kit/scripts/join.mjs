// Joins a base pack and the answers of the rules-pack steps into one pack file.
//
//   node scripts/join.mjs work/base-pack.json work/steps/*.json --out work/pack.json
//
// Each step file holds one JSON object whose keys say where its lists go (a chat answer may be wrapped in a ```json
// fence; the fence is dropped). Lists are added in the order given; a record with a slug (an item rule: a `def`) that
// is already there is replaced, so a corrected answer can simply be given again later.
//
//   into the rules manifest (content.rules[0]): classes, skills, branches, itemRules, trainers, and the settings
//                                               statLabels and memory
//   into content:                               items, places, ranks, crafts, creatures, quests, shops, recipes
//
// The manifest is created when the base pack has none, and "rb-rules-v2" is added to requires.capabilities.
// No dependencies, no network. Check the result with check.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RULES_LISTS = Object.freeze(['classes', 'skills', 'branches', 'itemRules', 'trainers']);
export const RULES_SETTINGS = Object.freeze(['statLabels', 'memory']);
export const CONTENT_LISTS = Object.freeze(['items', 'places', 'ranks', 'crafts', 'creatures', 'quests', 'shops', 'recipes']);

const keyOf = (record, list) => list === 'itemRules' ? record?.def : list === 'ranks' || list === 'crafts' ? record?.id : record?.slug;

/**
 * Reads JSON from text that may be a chat answer: the one ```json fence when there is one, else the whole text.
 * More than one fence is an error (which one is meant?); `name` is the file, so the message can say where.
 */
export function readAnswer(text, name = 'answer') {
    const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)];
    if (fences.length > 1) throw new Error(`${name}: more than one JSON block; keep one`);
    try { return JSON.parse((fences.length ? fences[0][1] : text).replace(/^\uFEFF/, '')); }
    catch (error) { throw new Error(`${name}: not valid JSON (${error.message})`); }
}

function put(target, records, list) {
    for (const record of records) {
        const key = keyOf(record, list);
        const at = key === undefined ? -1 : target.findIndex(have => keyOf(have, list) === key);
        if (at >= 0) target[at] = record; else target.push(record);
    }
}

/** Returns the joined pack, or throws an Error saying which file and key is wrong. */
export function join(base, steps) {
    const pack = structuredClone(base);
    pack.content ??= {};
    pack.requires ??= { storyBlock: '^2' };
    pack.requires.capabilities = [...new Set([...(pack.requires.capabilities ?? []), 'rb-rules-v2'])];
    pack.content.rules ??= [];
    pack.content.rules[0] ??= { slug: 'rules', name: `${pack.name ?? pack.id ?? 'Pack'} rules`, schema: 2 };
    const rules = pack.content.rules[0];
    for (const list of RULES_LISTS) rules[list] ??= [];
    for (const { name, answer } of steps) {
        if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) throw new Error(`${name}: expected one JSON object`);
        for (const [key, value] of Object.entries(answer)) {
            if (RULES_LISTS.includes(key) || CONTENT_LISTS.includes(key)) {
                if (!Array.isArray(value)) throw new Error(`${name}: "${key}" must be a list`);
                if (RULES_LISTS.includes(key)) put(rules[key], value, key);
                else put(pack.content[key] ??= [], value, key);
            } else if (RULES_SETTINGS.includes(key)) rules[key] = value;
            else throw new Error(`${name}: "${key}" is not a key the join knows (${[...RULES_LISTS, ...RULES_SETTINGS, ...CONTENT_LISTS].join(', ')})`);
        }
    }
    return pack;
}

function main(argv) {
    const args = argv.slice(2);
    const at = args.indexOf('--out');
    let out = null;
    if (at >= 0) { out = args[at + 1]; args.splice(at, 2); }
    if (args.length < 1 || (at >= 0 && !out)) { console.error('usage: node scripts/join.mjs <base-pack.json> [step.json ...] [--out pack.json]'); return 2; }
    try {
        const [basePath, ...stepPaths] = args;
        const base = readAnswer(readFileSync(basePath, 'utf8'), basePath);
        const steps = stepPaths.map(path => ({ name: path, answer: readAnswer(readFileSync(path, 'utf8'), path) }));
        const text = JSON.stringify(join(base, steps), null, 2) + '\n';
        if (out) { writeFileSync(out, text); console.error(`Wrote ${out} from ${steps.length} step file${steps.length === 1 ? '' : 's'}. Now run: node check.mjs ${out}`); }
        else process.stdout.write(text);
        return 0;
    } catch (error) { console.error(`join: ${error.message}`); return 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv);
