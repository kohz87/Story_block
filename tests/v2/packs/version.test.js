// requires.storyBlock ranges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, parseVersion, satisfies } from '../../../src/v2/packs/version.js';

test('ranges a pack may give', () => {
    const table = [
        ['2.0.0', '^2', true], ['2.9.4', '^2', true], ['3.0.0', '^2', false], ['1.9.9', '^2', false],
        ['2.3.0', '^2.3', true], ['2.2.9', '^2.3', false], ['2.4.1', '^2.3.1', true],
        ['0.3.5', '^0.3', true], ['0.4.0', '^0.3', false], ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false],
        ['2.1.7', '~2.1', true], ['2.2.0', '~2.1', false], ['2.1.4', '~2.1.3', true], ['2.9.0', '~2', true],
        ['2.5.0', '2.x', true], ['3.0.0', '2.x', false], ['2.5.0', '2', true], ['2.1.0', '2.1', true], ['2.2.0', '2.1', false],
        ['2.0.0', '2.0.0', true], ['2.0.1', '=2.0.0', false], ['9.9.9', '*', true], ['1.0.0', 'x', true],
        ['2.0.0', '>=2.0.0', true], ['1.9.0', '>=2', false], ['3.0.0', '>2', true], ['2.9.0', '>2', false],
        ['2.4.0', '<=2.4', true], ['2.5.0', '<=2.4', false], ['2.9.9', '<3', true], ['3.0.0', '<3', false],
        ['2.5.0', '>=2.0.0 <3', true], ['3.1.0', '>= 2.0.0 < 3', false],
        ['1.2.0', '^1.2 || ^2', true], ['2.2.0', '^1.2 || ^2', true], ['4.0.0', '^1.2 || ^2', false],
        // Pre-releases (R2-b7-1): ordered the semver way; a bound written as a release means the release,
        // one only implied (^2, 2.x, <3) takes in the pre-releases.
        ['2.0.0-alpha.3', '^2', true], ['2.0.0-alpha.3', '>=2.0.0', false], ['2.0.0-alpha.3', '2.x', true],
        ['2.0.0-alpha.3', '>=2.0.0-alpha.2', true], ['2.0.0-alpha.1', '>=2.0.0-alpha.2', false],
        ['2.0.0-alpha.10', '>2.0.0-alpha.9', true], ['2.0.0-beta', '>2.0.0-alpha.9', true], ['2.0.0', '>2.0.0-alpha.9', true],
        ['2.0.0-alpha', '<2.0.0-alpha.1', true], ['3.0.0-alpha.1', '^2', false], ['3.0.0-alpha.1', '<3', false],
        ['2.0.0-alpha.2', '=2.0.0-alpha.2', true], ['2.0.0-alpha.2', '2.0.0', false],
    ];
    for (const [version, range, expected] of table) assert.equal(satisfies(version, range), expected, `${version} in ${range}`);
});

test('what does not parse never matches', () => {
    for (const range of ['', 'two', '^', '>=2 ||', '^2.a', 'x'.repeat(101), '<*']) assert.equal(parseRange(range), null, range);
    assert.equal(satisfies('2.0', '^2'), false);
    assert.equal(satisfies('2.0.0', 'two'), false);
    assert.deepEqual(parseVersion('2.1.3-rc.1+build'), [2, 1, 3, ['rc', 1]]);
    assert.deepEqual(parseVersion('2.1.3'), [2, 1, 3, null]);
});
