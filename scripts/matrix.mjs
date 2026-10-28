// npm run matrix -- [--root <folder>] [--sd <path>] [--nsd <path>] [options]
// Runs the Story Block, Story Director and NPC State Delta combinations.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeTestkit, discoverRoots, formatDetails, formatTable, loadModules, runMatrix, summaryLine } from '../testkit/matrix/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FLAGS = new Set(['--strict', '--json', '--verbose']);

function parse(argv) {
    const out = { roots: {}, strict: false, json: false, verbose: false };
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        if (FLAGS.has(flag)) { out[flag.slice(2)] = true; continue; }
        const value = argv[++i];
        if (value === undefined) throw new Error(`${flag} needs a value.`);
        if (['--sd', '--nsd'].includes(flag)) out.roots[flag.slice(2)] = value;
        else if (flag === '--root') out.root = value;
        else if (flag === '--rows') out.rows = value.split(',').map(item => item.trim()).filter(Boolean);
        else if (flag === '--cases') out.cases = value.split(',').map(item => item.trim()).filter(Boolean);
        else if (flag === '--only') out.only = value;
        else throw new Error(`Unknown option ${flag}.`);
    }
    return out;
}

try {
    const options = parse(process.argv.slice(2));
    const base = resolve(options.root ?? process.env.STORY_SUITE_ROOT ?? resolve(here, '..', '..'));
    const found = discoverRoots(base);
    const roots = {};
    for (const key of ['sd', 'nsd']) {
        roots[key] = options.roots[key] ?? process.env[`MATRIX_${key.toUpperCase()}`] ?? found[key];
    }
    const { loaded, missing, broken } = await loadModules(roots);
    const out = await runMatrix({ loaded, missing, broken, rows: options.rows ?? null, only: options.only ?? null, cases: options.cases ?? null, strict: options.strict });
    if (options.json) {
        console.log(JSON.stringify({ testkit: describeTestkit(), roots, ...out }, null, 2));
    } else {
        console.log(`Story Suite matrix, ${describeTestkit()}${options.strict ? ', strict' : ''}`);
        for (const [key, root] of Object.entries(roots)) console.log(`  ${key}: ${loaded[key] ? root : (missing[key] ?? String(broken[key]?.message ?? 'not loaded'))}`);
        console.log('');
        console.log(formatTable(out.results));
        const details = formatDetails(out.results, { verbose: options.verbose });
        if (details) console.log(`\n${details}`);
        console.log(`\n${summaryLine(out)}`);
    }
    process.exitCode = out.ok ? 0 : 1;
} catch (error) {
    console.error(`matrix: ${error.message}`);
    process.exitCode = 2;
}
