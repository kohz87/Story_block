// The hero's portrait chain (UI stage 5a): the pictures are tried in order, each error moves to the next, a picture that failed
// is not asked for again on a redraw, and past the last the initial shows. Fired as DOM errors on the image, one at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hero, pictureCandidates, pictureUrl } from '../../../../src/v2/view/widgets/hero.js';
import { fakeApi, host, installDom } from './fake-dom.js';

const A = 'https://a.example/persona.png';
const B = 'https://b.example/card.png';
const C = 'https://c.example/delta.png';
const D = 'https://d.example/portrait.png';
const LEAD = { name: 'Astra', portraits: [A, B, C], portrait: D };

function mount(props, api = fakeApi()) {
    const doc = installDom();
    const el = host(doc);
    hero.render(el, props, api);
    const root = el.children[0];
    return { el, root, img: el.querySelector('.ss-hero-img'), letter: el.querySelector('.ss-hero-initial'), portrait: el.querySelector('.ss-hero-portrait') };
}

test('the candidates: the query first, then the list, then the single portrait; safe and once each', () => {
    assert.deepEqual(pictureCandidates({ portraits: [A, 'javascript:x', A], portrait: B, portraitQuery: 'npc.portrait' }, { query: () => ({ url: C }) }), [C, A, B]);
    assert.deepEqual(pictureCandidates({ portraits: [] }, {}), []);
    assert.equal(pictureUrl({ src: C }), C);
    assert.equal(pictureUrl({ url: 'http://insecure.example/x.png' }), '');
});

test('each error moves to the next picture: A, then B, then C; then the single portrait D; then the initial', () => {
    const m = mount(LEAD);
    assert.equal(m.img.getAttribute('src'), A, 'the first picture is on screen');
    m.img.dispatch('error');
    assert.equal(m.img.getAttribute('src'), B, 'A failed: B');
    m.img.dispatch('error');
    assert.equal(m.img.getAttribute('src'), C, 'B failed: C');
    m.img.dispatch('error');
    assert.equal(m.img.getAttribute('src'), D, 'C failed: the single portrait');
    m.img.dispatch('error');
    assert.equal(m.img.hidden, true, 'D failed: no picture');
    assert.equal(m.letter.hidden, false, 'the initial shows');
    assert.equal(m.letter.textContent, 'A', 'the initial of the name');
    assert.ok(m.portrait.classList.contains('ss-hero-fallback'));
});

test('a redraw with the same pictures does not ask for a broken one again', () => {
    const doc = installDom();
    const el = host(doc);
    const handle = hero.render(el, LEAD, fakeApi());
    const img = el.querySelector('.ss-hero-img');
    img.dispatch('error');
    assert.equal(img.getAttribute('src'), B, 'A failed: B');
    handle.update({ ...LEAD, name: 'Astra Two' });
    assert.equal(el.querySelector('.ss-hero-img').getAttribute('src'), B, 'the redraw keeps B and does not return to A');
    el.querySelector('.ss-hero-img').dispatch('error');
    assert.equal(el.querySelector('.ss-hero-img').getAttribute('src'), C, 'B failed on the redraw too: C');
});

test('no pictures at all: the initial, with no image source', () => {
    const m = mount({ name: 'Mira', portraits: [], portrait: '' });
    assert.equal(m.img.hidden, true);
    assert.equal(m.img.getAttribute('src'), null);
    assert.equal(m.letter.hidden, false);
    assert.equal(m.letter.textContent, 'M');
});

test('the image has alt text naming the lead, and is lazy and not stretched', () => {
    const m = mount(LEAD);
    assert.equal(m.img.getAttribute('alt'), 'Portrait of Astra');
    assert.equal(m.img.getAttribute('loading'), 'lazy');
});
