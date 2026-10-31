// Check a pack using the same validator as Story Block.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SB_V2 } from './scripts/sb-root.mjs';

const { validatePack } = await import(new URL('packs/validate.js', SB_V2));
const { HOST_CAPABILITIES } = await import(new URL('packs/limits.js', SB_V2));
export const SUITE_CAPABILITIES = Object.freeze([...new Set([...HOST_CAPABILITIES,
    'story-block', 'story-director', 'npc-state-delta', 'inventory', 'scene', 'director', 'quests', 'npc', 'chronicle-lasting'])]);

export function hintFor(error) {
    if (error?.code === 'MISSING_CAPABILITY') return 'Check the capability name, or use --with-capability <name> for an installed module.';
    if (error?.code === 'not-json') return 'Fix the JSON: use double quotes and remove trailing commas.';
    if (String(error?.code ?? '').startsWith('DM_')) return 'See reference/DATA-MODULES-FORMAT.md and reference/LIMITS.md.';
    return 'Check the field and its value against reference/PACK-FORMAT.md.';
}

export function checkPack(input, { withCapabilities = [] } = {}) {
    let value = input;
    if (typeof value === 'string') {
        try { value = JSON.parse(value.replace(/^\uFEFF/, '')); }
        catch (error) { return { ok: false, errors: [{ code: 'not-json', path: '', message: `This is not valid JSON: ${error.message}` }], notes: [] }; }
    }
    const capabilities = [...new Set([...SUITE_CAPABILITIES, ...withCapabilities])];
    const notes = withCapabilities.filter(name => !SUITE_CAPABILITIES.includes(name))
        .map(name => `--with-capability: "${name}" is taken as provided by an installed module.`);
    const result = validatePack(value, { capabilities });
    if (result.ok) return { ok: true, errors: [], notes, hashes: result.packHash ? { packHash: result.packHash } : {} };
    return { ok: false, errors: result.errors ?? [], notes, capped: (result.errors?.length ?? 0) >= 20 };
}

export function report(file, result) {
    const lines = [];
    if (result.ok) {
        lines.push(`OK ${file}`);
        if (result.hashes?.packHash) lines.push(`pack ${result.hashes.packHash.slice(0, 12)}`);
    } else {
        lines.push(`${result.errors.length} problem${result.errors.length === 1 ? '' : 's'} in ${file}`, '');
        result.errors.forEach((error, i) => {
            lines.push(`${String(i + 1).padStart(2)}. ${error.path || '(whole file)'}`);
            lines.push(`    ${error.message}`, `    hint: ${hintFor(error)}`);
        });
        if (result.capped) lines.push('', 'Fix these problems and run the checker again for the rest.');
    }
    for (const note of result.notes ?? []) lines.push('', `note: ${note}`);
    return lines.join('\n');
}

function main(argv) {
    const args = argv.slice(2);
    const withCapabilities = [];
    for (let at = args.indexOf('--with-capability'); at >= 0; at = args.indexOf('--with-capability')) {
        const name = args[at + 1];
        if (!name || !/^[a-z][a-z0-9-]{0,39}$/.test(name)) { console.error('--with-capability needs a lowercase name'); return 2; }
        withCapabilities.push(name);
        args.splice(at, 2);
    }
    if (args.length !== 1 || args[0].startsWith('--')) { console.error('usage: node check.mjs <pack.json> [--with-capability <name>]...'); return 2; }
    let text;
    try { text = readFileSync(args[0], 'utf8'); } catch (error) { console.error(`Cannot read ${args[0]}: ${error.code ?? error.message}`); return 1; }
    const result = checkPack(text, { withCapabilities });
    console.log(report(args[0], result));
    return result.ok ? 0 : 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv);
