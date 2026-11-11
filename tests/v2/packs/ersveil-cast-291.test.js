// Ersveil 2.9.1 (content only): each cast look carries "about N cm" right after the kind and age, within the look limit, and the
// first-meeting stances (withYou) of Temiwa, Ysmeth, Nysseth and Harrak are the owner's words; Nysseth's last stage milestone leads
// with "she has chosen you". Why: withYou is shown from the first meeting, so it must read as a stranger's stance, not a bond.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAST_LIMITS } from '../../../src/v2/packs/limits.js';

const pack = JSON.parse(readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8'));
const by = id => pack.content.cast.find(person => person.id === id);

test('Ersveil 2.9.1: every look names its height in cm, in the owner\'s numbers, and stays within the look limit', () => {
    const heights = { temiwa: 160, rika: 150, barney: 105, gorm: 138, asphodel: 155, hush: 168, nerissa: 172, ysmeth: 178, nysseth: 182, lothar: 186, torka: 190, harrak: 210 };
    for (const [id, cm] of Object.entries(heights)) {
        const look = by(id).look;
        assert.equal([...look.matchAll(/about (\d+) cm/g)].map(m => m[1]).join(), String(cm), id);
        assert.ok([...look].length <= CAST_LIMITS.look, `${id}: ${[...look].length}`);
    }
    assert.equal(pack.version, '2.9.3');
});

test('Ersveil 2.9.1: first-meeting stances for Temiwa, Ysmeth, Nysseth and Harrak; Nysseth\'s last milestone leads with the choice', () => {
    assert.equal(by('temiwa').withYou, "You're a stranger to her: she barely meets your eye, answers in a few words, and looks at your wounds instead of your face.");
    assert.equal(by('ysmeth').withYou, 'Sizes you up like a commission: polite, exact, and she charges for everything.');
    assert.equal(by('nysseth').withYou, 'Soft-spoken and patient with a stranger, and quietly watchful: she remembers everything you say. The player can also push her toward or away from using those closest to Durvald against him.');
    assert.equal(by('harrak').withYou, 'Treats you as one more recruit until you prove otherwise. If you romance Torka, he watches you with scrutiny.');
    const last = by('nysseth').stages.at(-1);
    assert.equal(last.name, 'Asks you to stand between them');
    assert.match(last.milestone, /^she has chosen you: she watches over you and quietly deals with anyone who comes between you; asks you to stand between her and her daughter; she watches the door so you can sit with your back to it$/);
});
