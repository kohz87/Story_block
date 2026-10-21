// Robustness fixes from the break rounds (b5b-robust, b1-capture, b3-economy 5): what the break tests in
// tests/v2/break/ do not pin down on their own. Each test here fails on the code before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINE, extractBlock, hideBlock, parseChanges, stripBlock, withoutReasoning } from '../../src/v2/capture.js';
import { HAPPENED, MIN_HAPPENED, assemble } from '../../src/v2/prompt.js';
import { createRegistry } from '../../src/v2/registry.js';
import { MAX_CHANGE_LINES, createSettings, settingValue } from '../../src/v2/sdk.js';
import { STORY_ITEM_QTY } from '../../src/v2/domains/inventory.js';
import { parseAmount } from '../../src/v2/domains/money.js';
import { cleanName } from '../../src/v2/domains/names.js';
import { MAX_DEPTH, parseHtml, tooDeep } from '../../src/v2/view/template/html.js';
import { MAX_AT_DEPTH, cssDepth, scopeCss } from '../../src/v2/view/css.js';
import { unsafeCss } from '../../src/v2/packs/validate.js';
import { installFakeDom } from '../ui-fake-dom.js';
import { renderSettingsHost } from '../../src/v2/host-ui.js';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const codes = host => host.turn.problems().map(problem => problem.code);

async function fresh(t, options) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

// ---- capture.js -----------------------------------------------------------------------------------

test('a </Changes> in the middle of a line does not end the block: the lines after it are read', () => {
    const mes = 'Story.\n<Changes>\n+ item Rope | note: says </Changes> on it\n+ item Torch\n</Changes>';
    const { lines, problems } = parseChanges(extractBlock(mes));
    assert.deepEqual(lines.map(line => line.name), ['Rope', 'Torch']);
    assert.equal(lines[0].labels.note, 'says </Changes> on it');
    assert.deepEqual(problems, []);
    assert.equal(stripBlock(hideBlock(mes)), 'Story.');
});

test('a close tag at the end of a change line still ends the block; story after it stays story', () => {
    const mes = 'Story.\n<Changes>\n+ item Rope</Changes>\nThe end.';
    assert.equal(extractBlock(mes), '+ item Rope');
    assert.equal(stripBlock(mes), 'Story.\n\nThe end.');
});

test('a mid-line close followed by story text is not dropped silently: the story lines become Problems', () => {
    const mes = 'Story.\n<Changes>\n+ item Rope </Changes> and then they left.';
    const { lines, problems } = parseChanges(extractBlock(mes));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].name, 'Rope </Changes> and then they left.');
    assert.deepEqual(problems, []);
});

test('mismatched reasoning tags (<thinking>…</think>) are reasoning too', () => {
    const mes = '<thinking>draft\n<Changes>\n+ coin 9\n</Changes>\n</think>Story.\n<Changes>\n+ coin 5\n</Changes>';
    assert.equal(withoutReasoning(mes).startsWith('Story.'), true);
    assert.equal(extractBlock(mes), '+ coin 5');
});

test('label:value without a space is a label; 09:00 and links stay text', () => {
    const [line] = parseChanges('- item Rope | qty:3 | at 09:00 | see https://example.com/x').lines;
    assert.equal(line.labels.qty, '3');
    assert.equal(line.text, 'at 09:00; see https://example.com/x');
    const [timed] = parseChanges('! time 09:00').lines;
    assert.equal(timed.name, '09:00');
});

test('a change line longer than MAX_LINE is a Problem, not read', () => {
    const { lines, problems } = parseChanges(`+ item Rope | note: ${'x'.repeat(MAX_LINE)}`);
    assert.equal(lines.length, 0);
    assert.match(problems[0], /longer than 2000 characters/);
});

test('the hidden comment breaks up every "--", so nothing ends it early', () => {
    const hidden = hideBlock('Story.\n<Changes>\n+ item Rope | note: a---b --!> c -->\n</Changes>');
    const body = hidden.slice(hidden.indexOf('<!--') + 4, -3);
    assert.doesNotMatch(body, /--/);
});

// ---- turn.js: line cap, Continue, budgets --------------------------------------------------------

test('a reply holds at most maxChangeLines lines (default 150); the rest are one TOO_MANY Problem', async t => {
    const host = await fresh(t);
    assert.equal(host.sdk.settings().maxChangeLines, MAX_CHANGE_LINES);
    host.settings.set(null, 'maxChangeLines', 10);
    await host.send('Look.', reply('Things.', Array.from({ length: 14 }, (_, i) => `+ item Thing${i}`)));
    assert.equal(host.sdk.query('inventory.items').length, 10);
    const problems = host.turn.problems().filter(problem => problem.code === 'TOO_MANY');
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /14 change lines; only the first 10 were read, so 4 lines were not used/);
});

test('the swipe_info copy of a reply\'s record is written once, after all its lines', async t => {
    const host = await fresh(t);
    let copies = 0;
    const real = structuredClone;
    t.mock.method(globalThis, 'structuredClone', value => {
        if (value && typeof value === 'object' && value.v === 2 && Array.isArray(value.spans)) copies += 1;
        return real(value);
    });
    await host.send('Look.', reply('Rope.', Array.from({ length: 40 }, (_, i) => `+ item Rope${i}`)));
    t.mock.restoreAll();
    const message = host.ctx.chat.at(-1);
    assert.equal(host.sdk.query('inventory.items').length, 40);
    assert.deepEqual(message.swipe_info[message.swipe_id].extra.storySuite, message.extra.storySuite);
    assert.ok(copies <= 3, `the record was copied ${copies} times`);
});

test('a Continue reads only the block it adds, and the first block is not read twice', async t => {
    const host = await fresh(t);
    await host.send('Search.', reply('Rope.', ['+ item Rope', '+ coin 5']));
    await host.cont(' And a torch.\n\n<Changes>\n+ item Torch\n</Changes>');
    const items = host.sdk.query('inventory.items').map(item => `${item.name}×${item.qty}`).sort();
    assert.deepEqual(items, ['Rope×1', 'Torch×1']);
    assert.equal(coin(host), 5);
    // Re-read later still finds every line: both blocks are kept hidden.
    assert.deepEqual(parseChanges(extractBlock(host.ctx.chat.at(-1).mes)).lines.map(line => line.name), ['Rope', '5', 'Torch']);
});

test('story coin: one reply pays at most the budget; the clamp is a LIMITED Problem; the next reply starts again', async t => {
    const host = await fresh(t);
    await host.send('Chest.', reply('Gold.', ['+ coin 700 | from: a chest', '+ coin 700 | from: the lid']));
    assert.equal(coin(host), 1000, '1000 × level 1 with no quest ranks');
    assert.deepEqual(codes(host), ['LIMITED']);
    assert.match(host.turn.problems()[0].message, /700 gold was written, but one reply may give at most 1000 gold; 300 gold was paid/);
    await host.send('More.', reply('Gold.', ['+ coin 50']));
    assert.equal(coin(host), 1050);
});

test('story coin: a third line past the budget is refused; a swipe gets its own budget', async t => {
    const host = await fresh(t);
    await host.send('Chest.', reply('Gold.', ['+ coin 1000', '+ coin 1']));
    assert.equal(coin(host), 1000);
    assert.ok(host.turn.problems().some(problem => problem.code === 'REFUSED' && /all the money one reply may give/.test(problem.message)));
    await host.swipe(reply('Less gold.', ['+ coin 600', '+ item Gold | qty: 600']));
    assert.equal(coin(host), 1000, 'the currency-named item counts against the same budget');
});

test('story coin: the setting storyCoinPerReply sets the budget; code payouts are not counted', async t => {
    const host = await fresh(t);
    host.settings.set('story-block', 'storyCoinPerReply', 30);
    await host.send('Chest.', reply('Gold.', ['+ coin 40']));
    assert.equal(coin(host), 30);
    const paid = await host.bus.command('wallet.receive', { owner: 'party', amount: 5000 }, { cause: 'system' });
    assert.equal(paid.ok, true);
    assert.equal(coin(host), 5030);
});

test('story coin: with quest ranks and a player character, the budget is the top reward of the PC\'s rank', async t => {
    const ranks = {
        id: 'ranks-probe', name: 'Ranks', version: '0.0.0',
        queries: {
            'party.pc': () => ({ level: 7 }),
            'quest.ranks': () => [{ id: 'F', levels: [1, 5], reward: [10, 50] }, { id: 'E', levels: [6, 12], reward: [50, 220] }],
        },
    };
    const host = await fresh(t, { modules: [ranks] });
    await host.send('Chest.', reply('Gold.', ['+ coin 999']));
    assert.equal(coin(host), 220);
});

test('story items: at most STORY_ITEM_QTY of one item per reply, repeated lines counted together', async t => {
    const host = await fresh(t);
    await host.send('Arrows.', reply('Arrows.', ['+ item Arrow | qty: 12', '+ item Arrow | qty: 12', '+ item Arrow', '+ item Rope | qty: 30']));
    const qty = name => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
    assert.equal(qty('Arrow'), STORY_ITEM_QTY);
    assert.equal(qty('Rope'), STORY_ITEM_QTY);
    assert.deepEqual(codes(host), ['LIMITED', 'REFUSED', 'LIMITED']);
    const granted = await host.bus.command('inventory.grant', { name: 'Arrow', qty: 40 }, { cause: 'system' });
    assert.equal(granted.ok, true, 'a grant by code is not held to the story limit');
});

test('B3-5: an amount with a sign is refused; the op is the only sign', () => {
    for (const text of ['-50', '−50 marks', '– 5', '30']) {
        const parsed = parseAmount(text);
        if (text === '30') assert.deepEqual(parsed, { amount: 30 });
        else assert.match(parsed.error, /without a sign/, text);
    }
});

test('names: NFC, and zero-width and bidi characters removed', () => {
    assert.equal(cleanName('Rópe'), 'Rópe');
    assert.equal(cleanName('Fen​na‮'), 'Fenna');
});

// ---- prompt.js: [Happened] and names ---------------------------------------------------------------

function registryWith(def) {
    const registry = createRegistry();
    if (def) registry.register(def);
    return registry;
}

test('[Happened] keeps the first lines and tells the rest as one counted line past half the budget', () => {
    const untold = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, narrate: true, summary: `Thing number ${i} happened in the square.` }));
    const { tailText } = assemble({ registry: registryWith(), view: {}, untold, settings: { tailBudget: 400 } });
    const lines = tailText.split('\n');
    assert.equal(lines[0], HAPPENED);
    assert.equal(lines[1], 'Thing number 0 happened in the square.');
    assert.match(lines.at(-1), /^…and \d+ more things happened\.$/);
    const shown = lines.length - 2;
    assert.equal(Number(/\d+/.exec(lines.at(-1))[0]) + shown, 300, 'every receipt is told or counted');
    assert.ok(Math.ceil(tailText.length / 4) <= 200);
    const few = assemble({ registry: registryWith(), view: {}, untold: untold.slice(0, MIN_HAPPENED).map(r => ({ ...r, summary: 'x'.repeat(2000) })), settings: { tailBudget: 100 } });
    assert.equal(few.tailText.split('\n').length, MIN_HAPPENED + 1, 'the first few are never dropped');
});

test('names are filled in before a module\'s budget is counted', () => {
    const def = { id: 'named', name: 'Named', context: { tail: () => ({ lines: ['{{user}} one', '{{user}} two', '{{user}} three'] }), budget: 30 } };
    const { tailText } = assemble({ registry: registryWith(def), view: {}, substitute: text => text.replace(/\{\{user\}\}/g, 'N'.repeat(40)) });
    assert.equal(tailText.split('\n').length, 2, tailText);
});

// ---- settings ---------------------------------------------------------------------------------

test('settings.set keeps a value to its schema field: text cut at max, numbers inside min/max', () => {
    const registry = createRegistry();
    registry.register({ id: 'shop', name: 'Shop', settings: { defaults: { place: '', n: 1, mode: 'a' }, schema: { place: { type: 'text', max: 5 }, n: { type: 'int', min: 1, max: 9 }, mode: { type: 'choice', options: ['a', 'b'] } } } });
    const es = {};
    const settings = createSettings({ root: () => es, registry });
    assert.equal(settings.set('shop', 'place', 'Bluewatch'), 'Bluew');
    assert.equal(settings.set('shop', 'n', 40), 9);
    assert.equal(settings.set('shop', 'n', 'many'), undefined);
    assert.equal(settings.set('shop', 'mode', 'z'), undefined);
    assert.equal(settings.set('shop', 'free', { any: 1 }).any, 1, 'a key without a schema field is stored as given');
    assert.deepEqual(es.storySuite.modules.shop, { place: 'Bluew', n: 9, free: { any: 1 } });
    assert.equal(settingValue({ type: 'text', max: 3 }, 12345), '123');
    assert.equal(settings.set(null, 'maxChangeLines', 5), 10, 'the host\'s own schema too');
});

test('a text field with max gets maxlength on its input', () => {
    const doc = installFakeDom();
    const registry = createRegistry();
    registry.register({ id: 'shop', name: 'Shop', settings: { defaults: { place: '' }, schema: { place: { type: 'text', max: 24 } } } });
    const settings = createSettings({ root: () => ({}), registry });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const input = root.querySelectorAll('.story-suite-row').find(row => row.dataset.field === 'place').querySelector('input');
    assert.equal(input.maxLength, 24);
});

// ---- templates and CSS ------------------------------------------------------------------------

test('templates: elements past MAX_DEPTH are flattened with one warning; tooDeep tells', () => {
    const warnings = [];
    const nodes = parseHtml(`${'<div>'.repeat(MAX_DEPTH + 10)}x${'</div>'.repeat(MAX_DEPTH + 10)}<p>after</p>`, warnings);
    let depth = 0;
    for (let node = nodes[0]; node?.children; node = node.children[0]) depth += 1;
    assert.equal(depth, MAX_DEPTH, 'MAX_DEPTH elements, then the text');
    assert.equal(nodes[1].tag, 'p', 'the end tags of the flattened ones close nothing above them');
    assert.equal(warnings.filter(line => /nested more than 64 deep/.test(line)).length, 1);
    assert.equal(tooDeep('<div>'.repeat(MAX_DEPTH)), false);
    assert.equal(tooDeep('<div>'.repeat(MAX_DEPTH + 1)), true);
});

test('pack install refuses a screen template or step nested past MAX_DEPTH and CSS past MAX_AT_DEPTH', async t => {
    const host = await fresh(t);
    const pack = screen => JSON.stringify({ id: 'deep', version: '1.0.0', name: 'Deep', requires: { storyBlock: '^2' }, content: {}, screens: [{ id: 'deep-board', title: 'Board', mounts: ['tab'], ...screen }] });
    const deep = await host.packs.packs.install(pack({ template: '<div>'.repeat(MAX_DEPTH + 1) }), { origin: 'pack.json' });
    assert.equal(deep.ok, false);
    assert.ok(deep.errors.some(error => /nests elements more than 64 deep/.test(error.message)), JSON.stringify(deep.errors));
    const step = await host.packs.packs.install(pack({ template: '<p>x</p>', steps: [{ id: 'a', title: 'A', template: '<b>'.repeat(MAX_DEPTH + 1) }] }), { origin: 'pack.json' });
    assert.equal(step.ok, false);
    const css = `${'@media (x) {'.repeat(MAX_AT_DEPTH + 1)}.a { color: red }${'}'.repeat(MAX_AT_DEPTH + 1)}`;
    const styled = await host.packs.packs.install(pack({ template: '<p>x</p>', css }), { origin: 'pack.json' });
    assert.equal(styled.ok, false);
    assert.match(unsafeCss(css), /nest @-rules at most 8 deep/);
    assert.equal(unsafeCss(`${'@media (x) {'.repeat(MAX_AT_DEPTH)}.a { color: red }${'}'.repeat(MAX_AT_DEPTH)}`), '');
});

test('scopeCss keeps MAX_AT_DEPTH levels of @-rules and drops deeper ones with a warning', () => {
    const css = depth => `${'@media (min-width: 1px) {'.repeat(depth)}.a { color: red }${'}'.repeat(depth)}`;
    assert.equal(cssDepth(css(3)), 4);
    const kept = scopeCss(css(MAX_AT_DEPTH), 's');
    assert.match(kept.css, /color: red/);
    const dropped = scopeCss(css(MAX_AT_DEPTH + 1), 's');
    assert.doesNotMatch(dropped.css, /color: red/);
    assert.ok(dropped.warnings.some(line => /nest at most 8 deep/.test(line)));
});
