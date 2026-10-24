// The combination matrix runner (testkit/matrix, scripts/matrix.mjs, docs/v2/MATRIX.md) on its own: the
// rows are the contract's §2, a row whose module is not checked out is skipped, a module that does not load
// fails its rows, Story Block's own row passes every case it can, a negative row reports a known gap
// (and fails with --strict), the wrapper's exit codes, and the vendored copy runs the same rows. The
// real modules are run by `npm run matrix` next to the other checkouts (the suite helpers' folder rule);
// here a toy RPG Battle checkout (fixtures/) stands in only to test the runner's own handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES, ROWS, discoverRoots, formatDetails, formatTable, loadModules, runMatrix, summaryLine } from '../../../testkit/matrix/index.js';
import { syncTestkit } from '../../../scripts/sync-testkit.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const cell = (out, row, id) => out.results.find(result => result.row === row && result.id === id);

test('the rows are the combination table of the contract, §2', () => {
    assert.deepEqual(ROWS.map(row => row.name), ['SB', 'SB+SD', 'SB+NSD', 'SB+SD+NSD', 'SB+SD+RB', 'SB+SD+RB+NSD', 'SB+RB', 'SB+RB+NSD']);
    assert.deepEqual(ROWS.filter(row => row.dormant.length).map(row => [row.name, row.dormant]), [['SB+RB', ['rb']], ['SB+RB+NSD', ['rb']]]);
    for (const id of ['missing-query', 'malformed', 'feature-off', 'unset-clock', 'disabled-sd', 'late', 'duplicate', 'swipe', 're-read', 'delete']) {
        assert.ok(CASES.some(([key]) => key === id), `a column for ${id}`);
    }
});

test('Story Block alone: every case passes, the ones that need a module are n/a, SD disabled is todo', async () => {
    const out = await runMatrix({ rows: ['SB'] });
    assert.equal(out.ok, true, formatDetails(out.results));
    const marks = Object.fromEntries(out.results.map(result => [result.id, result.status]));
    for (const id of ['register', 'reply', 'action', 'replay', 'prompt', 'missing-query', 'malformed', 'feature-off', 'duplicate', 'swipe', 're-read', 'delete']) {
        assert.equal(marks[id], 'pass', `${id}: ${cell(out, 'SB', id).detail}`);
    }
    for (const id of ['dormant', 'unset-clock', 'late']) assert.equal(marks[id], 'na', id);
    assert.equal(marks['disabled-sd'], 'na');
    // The peers' query names are unknown to the host when they are not there, and the stand-ins were asked or not.
    assert.match(cell(out, 'SB', 'malformed').detail, /SD, NSD stood in/);
});

test('a row whose module is not checked out is skipped with the reason; the other rows run', async () => {
    const out = await runMatrix({ rows: ['SB', 'SB+SD'], missing: { sd: 'no Story_director checkout given' } });
    assert.equal(out.ok, true);
    assert.ok(out.results.filter(result => result.row === 'SB+SD').every(result => result.status === 'skip' && /no Story_director checkout given/.test(result.detail)));
    assert.ok(out.results.filter(result => result.row === 'SB').some(result => result.status === 'pass'));
    assert.match(formatTable(out.results), /\| SB\+SD \| skip \|/);
});

test('loadModules: a missing folder or entry is missing, an entry that throws is broken and fails its rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-matrix-'));
    try {
        mkdirSync(join(dir, 'rpg_battle'));
        const loaded = await loadModules({ rb: fixture('rpg_battle'), sd: join(dir, 'nowhere'), nsd: join(dir, 'rpg_battle') });
        assert.deepEqual(Object.keys(loaded.loaded), ['rb']);
        assert.match(loaded.missing.sd, /is not there/);
        assert.match(loaded.missing.nsd, /is not there/);
        const broken = await loadModules({ rb: fixture('broken') });
        assert.deepEqual(Object.keys(broken.broken), ['rb']);
        const out = await runMatrix({ ...broken, rows: ['SB+RB'] });
        assert.equal(out.ok, false);
        assert.ok(out.results.every(result => result.status === 'fail' && /RB does not load: this checkout is broken on purpose/.test(result.detail)));
        assert.deepEqual(discoverRoots(dir), { rb: join(dir, 'rpg_battle') });
        mkdirSync(join(dir, 'Story_director'));
        mkdirSync(join(dir, 'sb'));
        assert.deepEqual(discoverRoots(dir), { sb: join(dir, 'sb'), rb: join(dir, 'rpg_battle'), sd: join(dir, 'Story_director') });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a negative row while RB is not dormant: a known gap that names the cause, not a failure; --strict fails it', async () => {
    const modules = await loadModules({ rb: fixture('rpg_battle') });
    assert.deepEqual(Object.keys(modules.loaded), ['rb']);
    const out = await runMatrix({ ...modules, rows: ['SB+RB'] });
    assert.equal(out.ok, true, formatDetails(out.results));
    assert.equal(cell(out, 'SB+RB', 'register').status, 'pass', 'RB is registered once');
    assert.equal(cell(out, 'SB+RB', 'dormant').status, 'gap');
    assert.match(cell(out, 'SB+RB', 'dormant').detail, /no status yet.*"Create your character first\."/);
    for (const id of ['reply', 'action', 'prompt', 'swipe', 're-read', 'delete', 'late', 'duplicate', 'feature-off']) {
        assert.equal(cell(out, 'SB+RB', id).status, 'gap', id);
        assert.match(cell(out, 'SB+RB', id).detail, /RB is not dormant yet and holds the reader's first message back/);
    }
    // Nothing is replayed when nothing was written: replay does not pass for a run that wrote no reply.
    assert.equal(cell(out, 'SB+RB', 'replay').status, 'gap');
    assert.match(formatTable(out.results), /\| SB\+RB \| ok \| gap \|/);
    const strict = await runMatrix({ ...modules, rows: ['SB+RB'], strict: true });
    assert.equal(strict.ok, false);
    assert.equal(cell(strict, 'SB+RB', 'dormant').status, 'fail');
    assert.match(cell(strict, 'SB+RB', 'dormant').detail, /^strict: /);
    assert.match(summaryLine(strict), /matrix FAILED/);
    assert.match(summaryLine(out), /^matrix ok: .*gap/);
});

test('scripts/matrix.mjs: a table and exit 0; --json; unknown option exits 2; --strict exits 1 on a gap', () => {
    const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'matrix.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, STORY_SUITE_ROOT: '', MATRIX_RB: '', MATRIX_SD: '', MATRIX_NSD: '' } });
    const empty = mkdtempSync(join(tmpdir(), 'sb-matrix-empty-'));
    try {
        const plain = run('--root', empty, '--rows', 'SB,SB+SD');
        assert.equal(plain.status, 0, plain.stderr);
        assert.match(plain.stdout, /Story Suite matrix, Story Block .*\(checkout\), matrix \d+/);
        assert.match(plain.stdout, /\| SB\+SD \| skip \|/);
        assert.match(plain.stdout, /matrix ok:/);
        const json = JSON.parse(run('--root', empty, '--rows', 'SB', '--json').stdout);
        assert.equal(json.ok, true);
        assert.ok(json.results.every(result => result.row === 'SB'));
        const bad = run('--bogus', 'x');
        assert.equal(bad.status, 2);
        assert.match(bad.stderr, /Unknown option --bogus/);
        const toy = run('--root', empty, '--rb', fixture('rpg_battle'), '--rows', 'SB+RB');
        assert.equal(toy.status, 0, toy.stdout);
        assert.equal(run('--root', empty, '--rb', fixture('rpg_battle'), '--rows', 'SB+RB', '--strict').status, 1);
        assert.equal(run('--root', empty, '--rows', 'SB', '--cases', 'swipe').status, 0);
    } finally {
        rmSync(empty, { recursive: true, force: true });
    }
});

test('sync-testkit takes testkit/matrix along, writes its version, and the vendored copy runs a row', async () => {
    const module = mkdtempSync(join(tmpdir(), 'sb-matrix-sync-'));
    try {
        const { target, files, matrix } = syncTestkit({ from: root, to: module });
        for (const file of ['testkit/matrix/index.js', 'testkit/matrix/run.js', 'testkit/matrix/modules.js', 'testkit/matrix/rows.js', 'testkit/matrix/report.js', 'testkit/matrix/version.js']) {
            assert.ok(files.includes(file), file);
        }
        assert.equal(matrix, 1);
        assert.match(readFileSync(join(target, 'VERSION'), 'utf8'), /\nmatrix 1\n$/);
        const vendored = await import(pathToFileURL(join(target, 'testkit', 'matrix', 'index.js')).href);
        assert.match(vendored.describeTestkit(), /\(vendored\), matrix 1$/);
        const out = await vendored.runMatrix({ rows: ['SB'], cases: ['register', 'reply', 'replay', 'swipe'] });
        assert.equal(out.ok, true, vendored.formatDetails(out.results));
        assert.deepEqual(out.results.map(result => result.id), ['register', 'reply', 'replay', 'swipe']);
        execFileSync(process.execPath, ['--check', join(target, 'testkit', 'matrix', 'run.js')]);
    } finally {
        rmSync(module, { recursive: true, force: true });
    }
});
