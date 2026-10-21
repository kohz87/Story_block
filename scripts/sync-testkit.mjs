// npm run sync-testkit -- <module checkout> [--from <Story Block checkout>]
//
// Copies Story Block's testkit and v2 runtime into a module's tests/vendor/story-block/ (docs/v2/SPEC.md
// §10), keeping the layout so the testkit's relative imports work there: testkit/, src/v2/, src/id.js,
// and every other file under src/ that those import (followed through their imports). Writes VERSION
// with the commit it was copied from. The vendored folder is replaced as a whole, so files Story Block
// dropped do not linger. Plain Node, no dependencies.
//
// The target defaults to the current directory (a module running `node ../Story_block/scripts/
// sync-testkit.mjs`); `--from` defaults to the checkout this script is in, or $STORY_BLOCK.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR = join('tests', 'vendor', 'story-block');
const ROOTS = ['testkit', join('src', 'v2'), join('src', 'id.js')];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

/** Every file to copy, relative to `from`: the roots plus what their scripts import from inside `from`. */
export function filesToCopy(from) {
    const files = new Set();
    const queue = [];
    for (const root of ROOTS) {
        const path = join(from, root);
        if (!existsSync(path)) continue;
        for (const file of statSync(path).isDirectory() ? walk(path) : [path]) queue.push(file);
    }
    while (queue.length) {
        const file = queue.pop();
        const rel = relative(from, file);
        if (files.has(rel)) continue;
        files.add(rel);
        if (!/\.m?js$/.test(file)) continue;
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
            const target = resolve(dirname(file), match[1]);
            const inside = relative(from, target);
            if (inside.startsWith('..') || inside.split(sep)[0] === 'node_modules' || !existsSync(target)) continue;
            queue.push(target);
        }
    }
    return [...files].sort();
}

function commitOf(from) {
    try {
        const sha = execFileSync('git', ['-C', from, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const dirty = execFileSync('git', ['-C', from, 'status', '--porcelain', '--', ...ROOTS, 'src'], { encoding: 'utf8' }).trim();
        return dirty ? `${sha}+local-changes` : sha;
    } catch {
        return 'unknown (not a git checkout)';
    }
}

/** Copies into `<to>/tests/vendor/story-block/`; returns { target, files, commit }. */
export function syncTestkit({ from, to }) {
    const source = resolve(from);
    const target = join(resolve(to), VENDOR);
    if (!existsSync(join(source, 'testkit', 'index.js'))) throw new Error(`${source} is not a Story Block checkout with a testkit/.`);
    if (resolve(to) === source) throw new Error('The target is Story Block itself; give the module checkout to copy into.');
    const files = filesToCopy(source);
    rmSync(target, { recursive: true, force: true });
    for (const file of files) {
        mkdirSync(dirname(join(target, file)), { recursive: true });
        cpSync(join(source, file), join(target, file));
    }
    const commit = commitOf(source);
    let version = '';
    try { version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version ?? ''; } catch { version = ''; }
    // A package.json marks the folder as ES modules even when the module's own package does not.
    writeFileSync(join(target, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    writeFileSync(join(target, 'VERSION'), `Story Block ${version}\ncommit ${commit}\nfiles ${files.length}\n`);
    return { target, files, commit };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = process.argv.slice(2);
    let from = process.env.STORY_BLOCK || resolve(dirname(fileURLToPath(import.meta.url)), '..');
    let to = process.cwd();
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--from') from = args[++i];
        else if (args[i] === '--to') to = args[++i];
        else to = args[i];
    }
    try {
        const { target, files, commit } = syncTestkit({ from, to });
        console.log(`Copied ${files.length} files into ${target} (commit ${commit}).`);
    } catch (error) {
        console.error(`sync-testkit: ${error.message}`);
        process.exitCode = 1;
    }
}
