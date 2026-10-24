// UI stage 4b, on a phone: the inspector, the map and the shared list card and dialog never move the page to show an element.
// A `scrollIntoView` or a plain `focus()` scrolls the page behind a fixed window on mobile and pushes the window off-screen.
// This is a source guard, not proof: it catches a new bare call in these files. The behaviour itself is checked on a phone
// profile in the live instance (the scratchpad checks listed in the PR), and the focus helper is `focusNode` (view/scroll.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCES = [
    '../../../src/v2/screens/inspector.js',
    '../../../src/v2/view/widgets/map.js',
    '../../../src/v2/view/widgets/listcard.js',
    '../../../src/v2/view/widgets/dialog.js',
];

test('the inspector, the map, the list card and the dialog: no scrollIntoView, and every focus call passes preventScroll', () => {
    for (const rel of SOURCES) {
        const url = new URL(rel, import.meta.url);
        const source = readFileSync(url, 'utf8');
        assert.doesNotMatch(source, /scrollIntoView/, `${rel}: scrollIntoView`);
        for (const match of source.matchAll(/\.focus\??\.?\(([^)]*)\)/g)) {
            assert.match(match[1], /preventScroll:\s*true/, `${rel}: focus(${match[1]}) without preventScroll`);
        }
    }
});
