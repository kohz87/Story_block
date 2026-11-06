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
const phone = css.slice(css.indexOf('@media (max-width: 759.98px) {'), css.indexOf('@media (max-width: 759.98px), (pointer: coarse)'));

test('only a phone game header with an active board presents the compact fight hero', () => {
    assert.match(phone, /\.ss-gameview-main:has\(\.rpg-board-active\) \.ss-gameview-hero \.ss-hero-board-more/);
    assert.match(phone, /\.ss-hero-compact:not\(\.ss-hero-board-expanded\)/);
    assert.match(phone, /\.ss-hero-corner-item:not\(\[data-kind="place"\]\)/);
    assert.match(phone, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(phone, /:is\(\.ss-hero-name, \.ss-hero-corner-text\) \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
    assert.match(phone, /@container \(min-width: 600px\)/);
    assert.match(rule(phone, '.ss-gameview-main:has(.rpg-board-active) .ss-gameview-hero .ss-hero-board-expanded .ss-hero-head .ss-hero-edit'), /right: calc\(70px \/ var\(--ss-zoomed, 1\)\)/);
});

test('phone log grows with its content up to the available space', () => {
    const log = rule(phone, '.rpg-board-log.rpg-battle');
    assert.match(log, /min-height: min\(var\(--rpg-log-content-height, 0px\), calc\(140px \/ var\(--ss-zoomed, 1\)\)\)/);
    assert.match(rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-log.rpg-battle'), /flex: 0 1 auto/);
    const measured = rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-log.rpg-battle.rpg-board-log-measured');
    assert.match(measured, /contain: size/);
    assert.match(measured, /flex: 1 1 min\(var\(--rpg-log-content-height\), calc\(140px \/ var\(--ss-zoomed, 1\)\)\)/);
    assert.match(measured, /max-height: var\(--rpg-log-content-height\)/);
    assert.match(rule(phone, '.rpg-board-log-content'), /display: flow-root/);
    assert.match(log, /font-family: inherit/);
    assert.match(log, /font-size: calc\(13px \/ var\(--ss-zoomed, 1\)\)/);
});

test('phone cards scroll in measured whole rows', () => {
    const status = rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-status');
    assert.match(status, /flex: 0 0 auto/);
    const cards = rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-cards');
    assert.match(cards, /height: var\(--rpg-card-row-height, auto\)/);
    assert.match(cards, /grid-auto-rows: var\(--rpg-card-row-height, max-content\)/);
    assert.match(cards, /overflow-y: auto/);
    assert.match(cards, /scroll-snap-type: y mandatory/);
    assert.match(rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-cards > *'), /scroll-snap-align: start/);
});

test('phone controls fit their contents and prioritize up to five choices', () => {
    const controls = rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-controls');
    const choices = rule(phone, '.rpg-board-active:not(.rpg-board-finished) .rpg-board-choices');
    assert.match(controls, /flex: 0 0 auto/);
    assert.match(choices, /flex: 0 0 auto/);
    assert.match(choices, /grid-auto-rows: max-content/);
    assert.match(choices, /max-height: var\(--rpg-choice-limit, calc\(5 \* \(48px \/ var\(--ss-zoomed, 1\)\) \+ 16px\)\)/);
    assert.match(rule(css, '.rpg-board-choices'), /overflow-y: auto/);
    assert.match(rule(css, ':is(.story-suite-sheet, .ss-gameview, .ss-cards) .rpg-board-choices > button.rpg-board-choice'), /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important/);
    assert.match(rule(phone, ':is(.story-suite-sheet, .ss-gameview, .ss-cards) .rpg-board-controls :is(button, summary)'), /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important/);
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
