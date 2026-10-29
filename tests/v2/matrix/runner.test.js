// The combination matrix runner and its command-line wrapper.
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
    assert.deepEqual(ROWS.map(row => row.name), ['SB', 'SB+SD', 'SB+NSD', 'SB+SD+NSD']);
    assert.ok(ROWS.every(row => row.dormant.length === 0));
    for (const id of ['missing-query', 'malformed', 'feature-off', 'unset-clock', 'disabled-sd', 'late', 'duplicate', 'swipe', 're-read', 'delete']) {
        assert.ok(CASES.some(([key]) => key === id), `a column for ${id}`);
    }
});

test('Story Block alone: every applicable case passes, including n/a for SD disabled', async () => {
    const out = await runMatrix({ rows: ['SB'] });
    assert.equal(out.ok, true, formatDetails(out.results));
    const marks = Object.fromEntries(out.results.map(result => [result.id, result.status]));
    for (const id of ['register', 'reply', 'action', 'replay', 'prompt', 'missing-query', 'malformed', 'feature-off', 'duplicate', 'swipe', 're-read', 'delete']) {
        assert.equal(marks[id], 'pass', `${id}: ${cell(out, 'SB', id).detail}`);
    }
    for (const id of ['unset-clock', 'late']) assert.equal(marks[id], 'na', id);
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

test('missing modules are skipped and broken modules fail their rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-matrix-'));
    try {
        const loaded = await loadModules({ sd: join(dir, 'nowhere') });
        assert.match(loaded.missing.sd, /is not there/);
        const broken = await loadModules({ sd: fixture('broken') });
        assert.deepEqual(Object.keys(broken.broken), ['sd']);
        const out = await runMatrix({ ...broken, rows: ['SB+SD'] });
        assert.equal(out.ok, false);
        assert.ok(out.results.every(result => result.status === 'fail'));
        mkdirSync(join(dir, 'Story_director'));
        mkdirSync(join(dir, 'sb'));
        assert.deepEqual(discoverRoots(dir), { sb: join(dir, 'sb'), sd: join(dir, 'Story_director') });
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scripts/matrix.mjs: a table and exit 0; --json; unknown option exits 2; --strict', () => {
    const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'matrix.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, STORY_SUITE_ROOT: '', MATRIX_SD: '', MATRIX_NSD: '' } });
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
        assert.equal(run('--root', empty, '--rows', 'SB', '--strict').status, 0);
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
        assert.equal(matrix, 2);
        assert.match(readFileSync(join(target, 'VERSION'), 'utf8'), /\nmatrix 2\n$/);
        const vendored = await import(pathToFileURL(join(target, 'testkit', 'matrix', 'index.js')).href);
        assert.match(vendored.describeTestkit(), /\(vendored\), matrix 2$/);
        const out = await vendored.runMatrix({ rows: ['SB'], cases: ['register', 'reply', 'replay', 'swipe'] });
        assert.equal(out.ok, true, vendored.formatDetails(out.results));
        assert.deepEqual(out.results.map(result => result.id), ['register', 'reply', 'replay', 'swipe']);
        execFileSync(process.execPath, ['--check', join(target, 'testkit', 'matrix', 'run.js')]);
    } finally {
        rmSync(module, { recursive: true, force: true });
    }
});
