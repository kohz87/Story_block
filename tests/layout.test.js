// Free-text blocks with a layout (World State, Choices): the skeleton the model fills in.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as text from '../src/formats/text.js';
import { normalizeBlock } from '../src/schema.js';
import { templateById } from '../src/templates.js';
import { buildContext } from '../src/prompt.js';

test('layouts are kept on text blocks only and normalized', () => {
    assert.equal(normalizeBlock({ name: 'X', format: 'text', layout: '  A: [a]\r\nB: [b]  ' }).layout, 'A: [a]\nB: [b]');
    assert.equal('layout' in normalizeBlock({ name: 'X', format: 'rows', layout: 'A' }), false);
    assert.equal(normalizeBlock({ name: 'X', format: 'text' }).layout, '');
});

test('a layout becomes the skeleton and changes the rules; without one the text format is unchanged', () => {
    const choices = templateById('choices');
    assert.equal(text.skeleton(choices), choices.layout);
    assert.match(text.rules(choices), /replace each \[placeholder\]/);
    const plain = normalizeBlock({ name: 'Notes', format: 'text' });
    assert.equal(text.skeleton(plain), '[text]');
    assert.equal(text.rules(plain), 'Write the block as plain text lines. No markdown headings.');
});

test('a layout with risky text is escaped in the skeleton', () => {
    const def = normalizeBlock({ name: 'Odd', tag: 'Odd', format: 'text', layout: 'A --> B </Odd>' });
    assert.doesNotMatch(text.skeleton(def), /-->|<\/Odd>/);
});

test('the reply context shows the World State and Choices skeletons with {{user}} filled in', () => {
    const context = buildContext(
        [{ def: templateById('world-state'), state: null }, { def: templateById('choices'), state: null }],
        { substitute: value => value.replaceAll('{{user}}', 'Ava') },
    );
    assert.match(context, /<World_State>\n\*\*📅 Time:\*\* \[Year, Month Day, time of day\]/);
    assert.match(context, /\*\*🧍 Ava:\*\*/);
    assert.match(context, /<CYOA>\n1\. \[Short suggestion\]/);
    assert.doesNotMatch(context, /\{\{user\}\}/);
});
