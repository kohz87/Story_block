// The "Changed this reply" card as Reply.dc.html draws it (fix 8e): the changes as tiles, the module's checks as full-width rows
// with the die in a tile, the story-against-dice note only when they disagree, and the lines a module gives as tiles too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changesCardScreen, replyCardLines } from '../../../src/v2/screens/index.js';
import { core, queries, sceneState, show, stocked, text } from './helpers.js';

const lines = (answer, moduleId = 'rpg-battle') => replyCardLines([{ moduleId, fn: () => answer }], {});

test('replyCardLines: a check is normalised (the label, the modifier, the result); a line without a whole die or DC stays a plain line', () => {
    const [check] = lines([{ text: 'AGI check', check: { stat: 'dex', what: 'dress the wolf', d20: 4, roll: '4', mod: -1, dc: 10, story: 'success' } }]);
    assert.equal(check.kind, 'check');
    assert.equal(check.tone, 'bad', 'a result of fail rings the tile bad');
    assert.equal(check.check.label, 'DEX — dress the wolf');
    assert.equal(check.check.modText, '− 1 DEX');
    assert.equal(check.check.rollText, ' (Roll 4)');
    assert.equal(check.check.word, 'fail');
    assert.equal(check.check.disagree, 'story said success / dice said fail', 'the story and the dice disagree');
    const [won] = lines([{ text: 'CHA', check: { stat: 'cha', what: 'persuade', d20: 17, mod: 2, dc: 15, story: 'success' } }]);
    assert.equal(won.check.result, 'success', 'worked out from the total against the DC');
    assert.equal(won.check.total, 19);
    assert.equal(won.check.disagree, '', 'the story and the dice agree: no note');
    assert.equal(won.check.modText, '+ 2 CHA');
    const [plain] = lines([{ text: 'a check with no die', check: { stat: 'str', what: 'x', dc: 10 } }, { text: 'bad die', check: { d20: 21, dc: 10 } }]);
    assert.equal(plain.kind, 'line');
    assert.equal(plain.check, null);
    assert.equal(plain.tone, 'info');
});

test('replyCardLines: a tone the line names is kept; any other is info', () => {
    const [good, odd] = lines([{ text: 'a', tone: 'good' }, { text: 'b', tone: 'magenta' }]);
    assert.equal(good.tone, 'good');
    assert.equal(odd.tone, 'info');
});

test('changes card: checks are rows with the die in a tile; a disagreement is a note on the row; the lines are tiles', () => {
    const module = core();
    const state = stocked(module);
    const moduleLines = replyCardLines([{ moduleId: 'rpg-battle', fn: () => [
        { text: 'DEX check', check: { stat: 'dex', what: 'dress the ridge wolf', d20: 4, mod: 1, dc: 10, story: 'success' } },
        { text: 'CHA check', check: { stat: 'cha', what: 'persuade Elula', d20: 17, mod: 2, dc: 15, story: 'success' } },
        { text: 'Elula trusts you', tone: 'accent', flag: 'trust +2' },
    ] }], {});
    const { el, view } = show(changesCardScreen, { state, query: queries(module, state), changes: [], extra: { moduleLines } });
    assert.deepEqual(view.warnings, []);
    const rows = el.querySelectorAll('.check');
    assert.equal(rows.length, 2, 'one row per check');
    assert.equal(text(rows[0].querySelector('.dice')), '4');
    assert.ok(rows[0].getAttribute('class').includes('bad'), 'a failed check rows bad');
    assert.equal(text(rows[0].querySelector('.story')), 'story said success / dice said fail', 'the disagreement note');
    assert.equal(rows[1].querySelector('.story'), null, 'no note when they agree');
    assert.ok(rows[1].getAttribute('class').includes('good'));
    assert.equal(text(rows[1].querySelector('.res')), 'success');
    const tiles = el.querySelectorAll('.tile.extra');
    assert.equal(tiles.length, 1, 'a plain line is a tile, not a row');
    assert.equal(text(tiles[0].querySelector('.main')), 'Elula trusts you');
    assert.equal(text(tiles[0].querySelector('.flag')), 'trust +2');
    assert.ok(tiles[0].getAttribute('class').includes('tone-accent'));
    assert.ok(tiles[0].querySelector('.ico i'), 'the icon sits in its tile, beside the text');
});

// The card's text colours meet 4.5:1 on the solid surface of each scheme (the glass is no lighter than that surface for text).
const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

test('the card\'s text tones meet 4.5:1 on each scheme\'s solid surface', async () => {
    const { PALETTES } = await import('../../../src/v2/view/theme.js');
    for (const scheme of ['dark', 'light']) {
        const p = PALETTES[scheme];
        for (const tone of ['text', 'muted', 'good', 'bad', 'warn', 'info']) {
            const ratio = contrast(p[tone], p.solid);
            assert.ok(ratio >= 4.5, `${scheme} ${tone} is ${ratio.toFixed(2)}:1`);
        }
    }
});

// A long main or sub line was cut on one line with nothing to read it by (fix 8k): it wraps to two lines, and the full text is the title.
test('tiles: a long line is clamped to two lines and the whole text is in the title', () => {
    const module = core();
    const state = sceneState(module);
    state.domains.scene.place = { name: 'The Very Long Named Lakeshore Hamlet Beyond the Misty Ridge of Old Bluewatch', kind: 'settlement', region: 'Lakeshore' };
    const long = 'Elula, who has waited at the old mill for three days and trusts you now';
    const moduleLines = replyCardLines([{ moduleId: 'rpg-battle', fn: () => [{ text: long, flag: 'trust +2, and a debt of three silver', note: 'a note that is just as long as the rest' }] }], {});
    const { el } = show(changesCardScreen, { state, query: queries(module, state), changes: ['/domains/scene/place', '/domains/scene/present', '/domains/inventory/stacks'], extra: { moduleLines } });
    const place = el.querySelector('.tile.place .sub');
    assert.equal(place.getAttribute('title'), state.domains.scene.place.name, 'the place tile\'s sub line carries its whole text');
    const extra = el.querySelector('.tile.extra');
    assert.equal(extra.querySelector('.main').getAttribute('title'), long);
    assert.equal(extra.querySelector('.flag').getAttribute('title'), 'trust +2, and a debt of three silver');
    assert.equal(extra.querySelector('.note').getAttribute('title'), 'a note that is just as long as the rest');
    const present = el.querySelector('.tile.present .main');
    assert.equal(present.getAttribute('title'), text(present), 'who is here: the title repeats the line');
    const css = changesCardScreen.css;
    const rule = css.slice(css.indexOf('.tile .main, .tile .sub {'), css.indexOf('}', css.indexOf('.tile .main, .tile .sub {')));
    assert.match(rule, /-webkit-line-clamp: 2/);
    assert.match(rule, /line-clamp: 2/);
    assert.ok(!/nowrap/.test(rule), 'no longer one line');
});
