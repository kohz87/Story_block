// The README teaches the scene board's markup with an example; it must keep drawing as a
// board, not fall back to plain text, or the guide would be teaching something that fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScene } from '../src/scene.js';
import { templateById } from '../src/templates.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('the README scene board example reads as a full scene', () => {
    const match = /\*\*Scene board\*\* \(World State\)\. Markdown the board understands:\n\n```\n([\s\S]*?)\n```/.exec(readme);
    assert.ok(match, 'the example is in the README');
    const scene = parseScene(match[1].replace(/\{\{user\}\}/g, 'Ren'), { layout: templateById('world-state').layout });
    assert.ok(scene, 'parses as a scene');
    assert.equal(scene.pc.name, 'Ren');
    assert.equal(scene.pc.fields['Guild Rank'], 'F (Lance Leader)', 'a field you invent is kept');
    assert.deepEqual(scene.people.map(person => [person.name, person.role]), [['Brenn', 'miller']]);
    assert.equal(scene.offscreen.length, 1);
    assert.equal(scene.threads.length, 1);
    assert.equal(scene.arc, 'Escalation');
    assert.equal(scene.phase, 'Building');
});
