// Ersveil 2.9.2 (content only): each cast look is physical features only (the kind word and the height first, no age), no real-world
// breed or brand name is in the pack, fields.People carries the age, personalities are the core (at most 320 characters) and voices
// at most 280, and Temiwa is exactly as the owner approved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8');
const pack = JSON.parse(raw);
const cast = pack.content.cast;
const by = id => cast.find(person => person.id === id);

test('Ersveil 2.9.2: the pack is 2.9.2 and no look names an age or "looks about"', () => {
    assert.equal(pack.version, '2.9.3');
    assert.equal(cast.length, 12);
    for (const person of cast) {
        assert.doesNotMatch(person.look, /\blooks about\b|\b\d+\b(?! cm)/, person.id);
        assert.match(person.look, /^[A-Z][A-Za-z -]+( \([^)]*\))?( woman| man)?, about \d+ cm[.:]/, person.id);
    }
});

test('Ersveil 2.9.2: fields.People has the kind and the age for all twelve', () => {
    const people = Object.fromEntries(cast.map(person => [person.id, person.fields.People]));
    assert.equal(people.temiwa, 'Dogfolk woman, 21');
    assert.equal(people.ysmeth, 'Dwelf, 58 (looks about 25)');
    assert.equal(people.nysseth, 'Elf, about 240 (looks about 35)');
    for (const [id, text] of Object.entries(people)) assert.match(text, /^[A-Z][A-Za-z ]+( \([^)]*\))?( woman| man)?, (about )?\d+( \(looks about \d+\))?$/, id);
});

test('Ersveil 2.9.2: no real-world breed or brand name anywhere in the pack', () => {
    assert.doesNotMatch(raw, /\b(shiba|inu|akita|corgi|husky|labrador|poodle|collie|spaniel|chihuahua)\b/i);
});

test('Ersveil 2.9.2: personality at most 320 characters, voice at most 280', () => {
    for (const person of cast) {
        assert.ok([...person.personality].length <= 320, `${person.id} personality ${[...person.personality].length}`);
        assert.ok([...person.voice].length <= 280, `${person.id} voice ${[...person.voice].length}`);
    }
});

test('Ersveil 2.9.2: Temiwa is exactly as approved', () => {
    const temiwa = by('temiwa');
    assert.equal(temiwa.look, 'Dogfolk woman, about 160 cm. Black dog ears with cream points, the left one notched. A curled black tail with a cream underside. Long straight black hair that falls like a waterfall. An exceptionally full, curvy figure, especially her chest. Fingertips scarred from flame rites. Brown eyes ringed dark from too little sleep. She smells of lye and smoke.');
    assert.equal(temiwa.personality, 'Dandere: shy and withdrawn, a few words at a time. Soft and caring but weary to the bone; her dry sarcasm is quiet and aimed at the Church, not at people. Chaste and innocent in love, and easily flustered. Her faith is cracked but not dead.');
    assert.ok(temiwa.behaviour.includes("Presentation: low - a seductive air she doesn't mean; stares mortify her and she never plays on them"));
    assert.match(temiwa.voice, /"Flame keep you, since nobody else will\."/);
    assert.match(temiwa.voice, /"my candle"/);
});

test('Ersveil 2.9.2: Nysseth\'s smiling removal moved into her Mercy lever, and Rika\'s hidden reading into her mannerism', () => {
    assert.ok(by('nysseth').behaviour.some(line => /^Mercy: low .*smiling as she does/.test(line)));
    assert.doesNotMatch(by('nysseth').personality, /smiling/);
    assert.ok(by('rika').mannerisms.some(line => /^Hides that she cannot read/.test(line)));
});
