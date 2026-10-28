import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPack, report } from '../../../authoring-kit/check.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = name => readFileSync(new URL(`../../../authoring-kit/reference/data-modules/${name}.pack.json`, import.meta.url), 'utf8');

test('the data-module examples pass the same checker as the host', () => {
    for (const name of ['faction-standing', 'survival-meters']) {
        const result = checkPack(data(name));
        assert.equal(result.ok, true, report(name, result));
    }
});

test('the command-line checker reports a valid pack and an invalid one', () => {
    const output = execFileSync(process.execPath, ['authoring-kit/check.mjs', 'authoring-kit/reference/data-modules/faction-standing.pack.json'], { cwd: root, encoding: 'utf8' });
    assert.match(output, /^OK authoring-kit\/reference\/data-modules\/faction-standing\.pack\.json/);
    assert.equal(checkPack('{ invalid').errors[0].code, 'not-json');
    const input = JSON.parse(data('faction-standing'));
    input.requires.capabilities.push('other-module');
    assert.equal(checkPack(input).ok, false);
    assert.equal(checkPack(input, { withCapabilities: ['other-module'] }).ok, true);
});

test('the limits reference is generated from the host exports', () => {
    const output = execFileSync(process.execPath, ['authoring-kit/scripts/limits.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(output, readFileSync(new URL('../../../authoring-kit/reference/LIMITS.md', import.meta.url), 'utf8'));
});
