// A block definition from a pasted example.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockFromExample, nameFromTag } from '../src/example.js';
import { normalizeBlock, validateBlock } from '../src/schema.js';

const SKILL_MASTERY = `<Skill_Mastery>
Soul Class: [I-IX] | Soul Growth: [0.00-99.99]/100 | Spirit Class: [I-IX] | Spirit Growth: [0.00-99.99]/100 | Soul Strain: [0-100]%

Spirit: Stage: [Unseen/Young Adult/Adult/True Form] | Next Spirit Stage: [Stage] | Requires: Spirit Class [numeral]

Aspect Tally: [attribute: score, two decimals | ..., highest first / none yet] | Aspects: [fixed Aspects / none]

Weapon Skill: [1-10]/10 | Weapon Skill XP: [0.00-9.99]/10 | Finesse: [1-10]/10 | Finesse XP: [0.00-9.99]/10

Social: [1-10]/10 | Social XP: [0.00-9.99]/10

Last Gains: [engagement or beat: Soul Growth: +x [base, share, split, res] | Spirit Growth: ... | Skill XP: +x [base, res] ... / none: why no beat qualified]

[Add newly established skills in the same Skill | Skill XP pairing, two skills per line. At Soul Class IX use Soul Growth: MAX; at Spirit Class IX use Spirit Growth: MAX. Mark a growth track frozen by the one-class gap with - HELD after it. Use hyphens, not parentheses.]
</Skill_Mastery>`;

test('a pasted block: tag and name, the skeleton as layout, the bracketed rules as instructions', () => {
    const { block, rules } = blockFromExample(SKILL_MASTERY);
    assert.equal(block.tag, 'Skill_Mastery');
    assert.equal(block.name, 'Skill Mastery');
    assert.equal(block.kind, 'stateful');
    assert.equal(block.format, 'text');
    assert.equal(block.display, 'plain');
    assert.equal(rules, 1);
    assert.match(block.prompt, /^Add newly established skills in the same Skill \| Skill XP pairing/);
    assert.match(block.prompt, /Use hyphens, not parentheses\.$/);
    // Every skeleton line is kept as written, placeholders and blank lines included.
    assert.match(block.layout, /^Soul Class: \[I-IX\] \| Soul Growth: \[0\.00-99\.99\]\/100/);
    assert.match(block.layout, /\n\nLast Gains: \[engagement or beat: .*why no beat qualified\]$/);
    assert.doesNotMatch(block.layout, /Add newly established/);
    // Long placeholder lines are not mistaken for rules.
    assert.match(block.layout, /Aspect Tally: \[attribute: score/);
    assert.deepEqual(validateBlock(normalizeBlock(block), []), []);
});

test('a rule paragraph wrapped over lines; no rules gives a default instruction', () => {
    const wrapped = blockFromExample('<Stats>\nHP: [0-100]/100\n\n[Keep HP between 0 and 100.\nHealing only from potions or rest.]\n</Stats>');
    assert.equal(wrapped.block.layout, 'HP: [0-100]/100');
    assert.equal(wrapped.block.prompt, 'Keep HP between 0 and 100. Healing only from potions or rest.');

    const plain = blockFromExample('<Stats>\nHP: [0-100]/100 | Gold: [number]\n</Stats>');
    assert.equal(plain.rules, 0);
    assert.match(plain.block.prompt, /Keep this block up to date/);
    assert.equal(plain.block.layout, 'HP: [0-100]/100 | Gold: [number]');
});

test('no tag: the whole text is the layout; empty or tagless-empty is refused', () => {
    const { block } = blockFromExample('Mood: [one word]\nGoal: [short text]');
    assert.equal(block.layout, 'Mood: [one word]\nGoal: [short text]');
    assert.equal(block.name, 'New Block');
    assert.equal(block.tag, 'New_Block');
    assert.match(blockFromExample('').error, /Paste a block first/);
    assert.match(blockFromExample('<Stats>\n\n</Stats>').error, /empty/);
});

test('nameFromTag', () => {
    assert.equal(nameFromTag('Skill_Mastery'), 'Skill Mastery');
    assert.equal(nameFromTag('worldState'), 'World State');
    assert.equal(nameFromTag('npc__notes'), 'Npc notes');
});
