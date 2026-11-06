// The phone board keeps a readable log and a whole card row; finished fights use the normal page scroller.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../../src/v2/lean-rpg/board/board.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (text, selector) => {
    const lines = text.split('\n');
    const at = lines.findIndex(line => line.trimStart().startsWith(`${selector} {`));
    assert.ok(at >= 0, `${selector} exists`);
    const rest = lines.slice(at).join('\n');
    return rest.slice(0, rest.indexOf('}'));
};
const phone = css.slice(css.indexOf('@media (max-width: 759.98px) {'), css.indexOf('@media (max-width: 759.98px) and (max-height: 800px)'));

test('only a phone game header with an active board presents the compact fight hero', () => {
    assert.match(phone, /\.ss-gameview-main:has\(\.rpg-board-active\) \.ss-gameview-hero \.ss-hero-board-more/);
    assert.match(phone, /\.ss-hero-compact:not\(\.ss-hero-board-expanded\)/);
    assert.match(phone, /\.ss-hero-corner-item:not\(\[data-kind="place"\]\)/);
    assert.match(phone, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(phone, /:is\(\.ss-hero-name, \.ss-hero-corner-text\) \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
    assert.match(phone, /@container \(min-width: 600px\)/);
    assert.match(rule(phone, '.ss-gameview-main:has(.rpg-board-active) .ss-gameview-hero .ss-hero-board-expanded .ss-hero-head .ss-hero-edit'), /right: calc\(70px \/ var\(--ss-zoomed, 1\)\)/);
});

test('phone log uses the body font and a 140px on-screen minimum', () => {
    const log = rule(phone, '.rpg-board-log.rpg-battle');
    assert.match(log, /min-height: calc\(140px \/ var\(--ss-zoomed, 1\)\)/);
    assert.match(log, /font-family: inherit/);
    assert.match(log, /font-size: calc\(13px \/ var\(--ss-zoomed, 1\)\)/);
});

test('phone cards scroll after at least the measured first row', () => {
    const cards = rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-cards');
    assert.match(cards, /min-height: var\(--rpg-first-row-height, 120px\)/);
    assert.match(cards, /overflow-y: auto/);
    assert.match(rule(phone, '.rpg-board-cards'), /grid-auto-rows: max-content/);
    assert.match(rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-choices'), /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\)/);
    assert.match(rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-controls'), /flex: 0 1 auto/);
});

test('phone end card replaces its long copy and keeps full-width 48px buttons', () => {
    assert.match(rule(phone, '.rpg-board-end-description, .rpg-board-awards'), /display: none/);
    assert.match(rule(phone, '.rpg-board-awards-phone'), /display: block/);
    assert.match(rule(css, '.rpg-board-ended .rpg-board-actions'), /flex-direction: column/);
    assert.match(rule(css, '.rpg-board-ended .rpg-board-actions button'), /width: 100%/);
    assert.match(rule(phone, ':is(.story-suite-sheet, .ss-gameview, .ss-cards) .rpg-board-ended button'), /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important/);
});

test('finished phone fights unlock the body and show the whole log', () => {
    assert.match(phone, /:has\(\.rpg-board-active:not\(\.rpg-board-finished\)\)/);
    const log = rule(phone, '.rpg-board-finished .rpg-board-log.rpg-battle');
    assert.match(log, /flex: 0 0 auto/);
    assert.match(log, /overflow: visible/);
});

test('the finished board leaves bottom-bar room in panel and phone game views', () => {
    for (const selector of ['.story-suite-sheet-body:has(.rpg-board-active.rpg-board-finished)::after',
        '.ss-gameview-body:has(.rpg-board-active.rpg-board-finished)::after']) {
        const spacer = rule(css, selector);
        assert.match(spacer, /display: block/);
        assert.match(spacer, /height: var\(--ss-bottom-bar-space, var\(--ss-bottom-bar-height, 0px\)\)/);
    }
});
