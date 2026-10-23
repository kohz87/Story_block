// UI stage 4b, on a phone: the inspector and the map never move the page to show an element. A `scrollIntoView` or a plain
// `focus()` scrolls the page behind a fixed window on mobile and pushes the window off-screen, so the two screens scroll
// their own containers (or leave the page alone) and focus with `preventScroll`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCES = [
    new URL('../../../src/v2/screens/inspector.js', import.meta.url),
    new URL('../../../src/v2/view/widgets/map.js', import.meta.url),
];

test('the inspector and the map never call scrollIntoView, and every focus() passes preventScroll', () => {
    for (const url of SOURCES) {
        const source = readFileSync(url, 'utf8');
        assert.doesNotMatch(source, /scrollIntoView/, `${url.pathname}: scrollIntoView`);
        for (const match of source.matchAll(/\.focus\(([^)]*)\)/g)) {
            assert.match(match[1], /preventScroll:\s*true/, `${url.pathname}: focus(${match[1]}) without preventScroll`);
        }
    }
});
