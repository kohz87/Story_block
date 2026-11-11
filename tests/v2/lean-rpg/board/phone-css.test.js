// The phone board keeps a readable log and a whole card row; finished fights use the normal page scroller.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../../src/v2/lean-rpg/board/board.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const hostCss = readFileSync(new URL('../../../../src/v2/view/host.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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

test('phone: the status chips stay at the top and the log is one line that opens', () => {
    assert.match(rule(phone, '.rpg-board-status'), /position: sticky/);
    assert.match(rule(phone, '.rpg-board-status'), /top: 0/);
    assert.match(rule(css, '.rpg-board-log > summary'), /cursor: pointer/);
    assert.match(rule(css, '.rpg-board-log'), /font-size: calc\(13px \/ var\(--ss-zoomed, 1\)\)/);
    assert.doesNotMatch(css, /rpg-board-log-measured|--rpg-log-content-height|contain: size/);
});

test('nothing on the board scrolls: chips wrap, the skills are a grid', () => {
    assert.doesNotMatch(css, /overflow(?:-y)?\s*:\s*(?:auto|scroll)|scroll-snap|100dvh|--rpg-card-row-height/);
    assert.match(rule(css, '.rpg-chips'), /display: flex/);
    assert.match(rule(css, '.rpg-chips'), /flex-wrap: wrap/);
    assert.match(rule(css, '.rpg-chip'), /flex: 1 1 auto/);   // natural width, at least 2 to a row
    assert.match(rule(css, '.rpg-chip'), /max-width: calc\(50% - 3px\)/);
    assert.match(rule(css, '.rpg-chip'), /min-width: 0/);
    const title = rule(css, '.rpg-chip-title');   // a name breaks between words, 2 lines, then an ellipsis
    assert.match(title, /-webkit-line-clamp: 2/);
    assert.match(title, /word-break: normal/);
    assert.match(title, /overflow-wrap: normal/);
    assert.doesNotMatch(rule(css, '.rpg-chip-name'), /overflow-wrap: anywhere/);
    assert.match(rule(css, '.rpg-res-label'), /flex: 0 0 auto/);   // the bar starts after a fixed-width label
    assert.match(rule(css, '.rpg-res-label'), /min-width: 5em/);
});

test('skills are a 2-column grid (3 from 900px) of buttons at least 36px tall (48px on a phone)', () => {
    const choices = rule(css, '.rpg-board-choices');
    assert.match(choices, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.doesNotMatch(choices, /max-height|overflow/);
    assert.match(rule(css, '.rpg-board-choice'), /min-height: 48px/);
    assert.match(css, /@container rpgboard \(min-width: 900px\) \{ \.rpg-board-choices \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \} \}/);
    assert.match(rule(css, ':is(.story-suite-sheet, .ss-gameview, .ss-cards) .rpg-board-choices > button.rpg-board-choice'), /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important/);
    assert.match(rule(phone, ':is(.story-suite-sheet, .ss-gameview, .ss-cards) .rpg-board-controls :is(button, summary)'), /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important/);
});

test('a board 700px wide or more puts the status on the left and the actions on the right, foes 3 and party 4 to a row', () => {
    const wide = css.slice(css.indexOf('@container rpgboard (min-width: 700px) {'));
    assert.match(rule(css, '.rpg-board-active'), /container: rpgboard \/ inline-size/);
    assert.match(wide, /\.rpg-board-body \{ display: grid; grid-template-columns: minmax\(0, 1\.1fr\) minmax\(0, 1fr\)/);
    assert.match(wide, /\.rpg-board-controls \{ grid-column: 2; grid-row: 1 \/ span 3; \}/);
    assert.match(wide, /grid-template-rows: auto auto 1fr/);   // no dead gap: the log sits right under the status
    assert.match(wide, /\.rpg-chip \{ max-width: none; \}/);
    assert.match(wide, /\.rpg-chips-foes \.rpg-chip \{ flex: 0 0 calc\(\(100% - 10px\) \/ 3\); \}/);
    assert.match(wide, /\.rpg-chips-party \.rpg-chip \{ flex: 0 0 calc\(\(100% - 15px\) \/ 4\); \}/);
});

test('phone end card replaces its long copy and keeps full-width 48px buttons', () => {
    assert.match(rule(phone, '.rpg-board-end-description, .rpg-board-awards'), /display: none/);
    assert.match(rule(phone, '.rpg-board-awards-phone'), /display: block/);
    assert.match(rule(css, '.rpg-board-ended .rpg-board-actions'), /flex-direction: column/);
    assert.match(rule(css, '.rpg-board-ended .rpg-board-actions button'), /width: 100%/);
    assert.match(rule(phone, ':is(.story-suite-sheet, .ss-gameview, .ss-cards) .rpg-board-ended button'), /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\) !important/);
});

test('board control buttons sit in one wrapping row, 8px apart, Discard fight at the far end', () => {
    const row = rule(css, '.rpg-board-actions');
    assert.match(row, /display: flex/);
    assert.match(row, /flex-wrap: wrap/);
    assert.match(row, /gap: 8px/);
    assert.match(rule(css, '.rpg-board-actions .rpg-board-discard'), /margin-left: auto/);
});

test('finished phone fights keep the whole page scroll', () => {
    assert.match(phone, /:has\(\.rpg-board-active:not\(\.rpg-board-finished\)\)/);
    assert.doesNotMatch(css, /\.rpg-board-finished \.rpg-board-log[^{]*\{[^}]*overflow/);
});

test('the finished board leaves bottom-bar room in panel and phone game views', () => {
    for (const selector of ['.story-suite-sheet-body:has(.rpg-board-active.rpg-board-finished)::after',
        '.ss-gameview-body:has(.rpg-board-active.rpg-board-finished)::after']) {
        const spacer = rule(phone, selector);
        assert.match(spacer, /display: block/);
        assert.match(spacer, /height: var\(--ss-bottom-bar-space, var\(--ss-bottom-bar-height, 0px\)\)/);
    }
    const panelSpacer = rule(hostCss, '.story-suite-sheet-body::after');
    assert.match(panelSpacer, /display: block/);
    assert.match(panelSpacer, /height: var\(--ss-bottom-bar-space\)/);
});

test('the sticky status is flush with the scroller edge, so no text shows above it', () => {
    assert.match(phone, /\.rpg-board-status \{ top: calc\(-1 \* var\(--rpg-pad, 12px\)\)/);
    assert.match(phone, /\.story-suite-sheet-body:has\(\.rpg-board-active\) \{ --rpg-pad: 8px; \}/);
});
