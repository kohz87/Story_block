// B-b5b-robust-r2-1: ids and control names are prefixed per screen (`ss-t-<screen>-`), not per drawn
// copy. A screen is drawn more than once at a time: a card under every reply, or a tab and a hud. Then:
// - every copy has the same ids, so `<label for>` in the newest card (the only one that runs commands;
//   it comes last in the page) checks the control in the OLDEST card, and the newest card's draft never
//   gets it;
// - a radio group outside a <form> is one group across the copies, so a pick in one copy clears the
//   others on screen while their drafts keep the old value.
// Verified in Chromium (r2 NOTES: pw-dupid.mjs): label in copy 2 → copy 1's box checked, copy 2 submits
// without it; tip radios: copy 1 shows none checked, its draft still says "2".
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { compileTemplate, renderTemplate } from '../../../src/v2/view/template/index.js';

const TEMPLATE = '<form data-submit="shop.buy"><input type="checkbox" id="gift" data-draft="gift"><label for="gift">Gift wrap</label><button>Buy</button></form>'
    + '<div><input type="radio" name="tip" value="1" data-draft="tip"><input type="radio" name="tip" value="2" data-draft="tip"></div>';

function twoCopies() {
    const doc = installFakeDom();
    const compiled = compileTemplate(TEMPLATE);
    return [0, 1].map(() => {
        const el = doc.createElement('div');
        doc.body.appendChild(el);
        renderTemplate(el, compiled, { draft: {}, screenId: 'shop-card' }, { evaluate: () => null, screenId: 'shop-card', command: async () => ({ ok: true }) });
        return el;
    });
}

test('B-b5b-robust-r2-1: two copies of one screen never share an id (label for= must reach its own copy)', () => {
    const [a, b] = twoCopies();
    const idA = a.querySelector('input[type="checkbox"]').getAttribute('id');
    const idB = b.querySelector('input[type="checkbox"]').getAttribute('id');
    assert.notEqual(idA, idB, `both copies use id="${idA}"`);
    assert.equal(b.querySelector('label').getAttribute('for'), idB, 'the label points at its own copy');
});

test('B-b5b-robust-r2-1: a radio group outside a form is not shared between copies of a screen', () => {
    const [a, b] = twoCopies();
    const nameA = a.querySelector('input[type="radio"]').getAttribute('name');
    const nameB = b.querySelector('input[type="radio"]').getAttribute('name');
    assert.notEqual(nameA, nameB, `both copies' radios are in group "${nameA}"`);
});
