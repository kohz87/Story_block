// C2-4 (a2 pass 1): parseAmount (domains/money.js:53-64) refuses a signed amount only for - − – —, and
// reads the first digit run of what is left, so other minus signs and fractions are paid as whole
// positive amounts: "+ coin ‐30" (U+2010), "⁻30" (superscript minus), "－30" (fullwidth) pay 30, and
// "+ coin .5" (half a coin) pays 5. Within the per-reply budget, but more (or other) than was written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../../../src/v2/domains/money.js';

for (const written of ['‐30', '‑30', '‒30', '⁻30', '₋30', '﹣30', '－30']) {
    test(`"+ coin ${written}" is refused like "+ coin -30" (a sign is not written on the amount)`, () => {
        assert.ok(parseAmount(written).error, `"${written}" was read as ${JSON.stringify(parseAmount(written))}`);
    });
}

for (const written of ['.5', '٫5', '2⁵', '½5']) {
    test(`"+ coin ${written}" is not paid as a different whole amount`, () => {
        const read = parseAmount(written);
        assert.ok(read.error, `"${written}" was read as ${JSON.stringify(read)}`);
    });
}
