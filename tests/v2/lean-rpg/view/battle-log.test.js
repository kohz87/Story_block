import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../../testkit/index.js';
import { makeMessage } from '../../../ui-fake-dom.js';
import { setupDom } from '../../view/mounts/helpers.js';
import {
    BATTLE_ROOT, buildPanel, createBattleLog, createFoldStore, headerText, outcomeOf, panelModel, placeAtMarker, readResolve, resolveOf, rollText,
} from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { stripBattleMarker } from '../../../../src/v2/turn.js';
import { RESOLVE } from '../../../../src/v2/lean-rpg/index.js';
import { characterDefinition, defineAll, fakeState, foesDefinition, roleOf, setField, skillsDefinition } from './helpers.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

// What the rolls piece records for a reply (see the adapter's note at the top of battle-log.js).
const result = () => ({
    order: ['Sluice Rat A', 'Wessel', 'Ren'],
    rounds: [{ n: 2, actions: [
        { who: 'Sluice Rat A', target: 'Wessel', foe: true, outcome: 'fail', total: 12, vs: 15 },
        { who: 'Wessel', target: 'Sluice Rat A', skill: 'Iron Breath', stat: 'str', outcome: 'success', total: 26, vs: 16,
            mine: { d20: 14, parts: [{ label: 'STR', value: 7 }, { label: 'Class II', value: 4 }, { label: 'Adept', value: 1 }], total: 26 },
            theirs: { d20: 9, parts: [{ label: '', value: 5 }, { label: 'Class I', value: 2 }], total: 16 } },
        { who: 'Ren', target: 'Sluice Rat B', skill: 'Spark', outcome: 'success at a cost', total: 17, vs: 18 },
    ] }],
});
const state = fields => fakeState([
    { definition: characterDefinition('wessel', 'Wessel'), fields: { health: 4, mana: 3, stamina: 2, ...fields.wessel } },
    { definition: characterDefinition('ren', 'Ren'), fields: { health: 3, mana: 2, stamina: 2, ...fields.ren } },
    { definition: foesDefinition(), fields: { foe1: 'Sluice Rat A', hurt1: 5, foe2: 'Sluice Rat B', hurt2: 3, foe3: 'Sluice Rats', count3: 4, hurt3: 5, ...fields.foes } },
]);
const before = state({ wessel: { health: 5, mana: 3 }, ren: { stamina: 3 }, foes: { hurt1: 5, hurt2: 5 } });
const after = state({ wessel: { health: 4 }, ren: { stamina: 2 }, foes: { hurt1: 2, hurt2: 3 } });

test('the adapter reads A\'s record loosely and drops what it cannot read', () => {
    const read = readResolve(result());
    assert.equal(read.rounds.length, 1);
    assert.deepEqual(read.rounds[0].lines.map(line => [line.who, line.target, line.outcome, line.total, line.vs, line.foe]),
        [['Sluice Rat A', 'Wessel', 'fail', 12, 15, true], ['Wessel', 'Sluice Rat A', 'success', 26, 16, false], ['Ren', 'Sluice Rat B', 'cost', 17, 18, false]]);
    assert.equal(read.rounds[0].lines[1].breakdown, 'd20 14 + STR 7 + Class II 4 + Adept 1 = 26 vs d20 9 + 5 + Class I 2 = 16');
    assert.deepEqual(read.order, ['Sluice Rat A', 'Wessel', 'Ren']);
    assert.equal(readResolve(null), null);
    assert.equal(readResolve({ rounds: [{ actions: [{ nothing: true }] }] }), null);
    const odd = readResolve({ rounds: [{ round: 3, lines: [{ actor: 'Wessel', defender: 'Rat', result: 'HIT', vs: { total: 9 }, roll: { total: 20 } }] }], checks: [{ who: 'Ren', stat: 'dex', skill: 'Stealth', outcome: 'Fail', total: 8, vs: 12 }] });
    assert.deepEqual(odd.rounds[0], { n: 3, lines: [{ who: 'Wessel', target: 'Rat', skill: '', stat: '', foe: false, outcome: 'success', total: 20, vs: 9, breakdown: '', arrows: [] }] });
    assert.equal(odd.checks[0].what, 'Stealth');
    assert.deepEqual(['SUCCESS', 'Success at a cost', 'SUCCESS AT A COST', 'Fail', 'miss', 'maybe', ''].map(outcomeOf), ['success', 'cost', 'cost', 'fail', 'fail', '', '']);
});

test('the breakdown text: the d20 and each term, then the other side', () => {
    assert.equal(rollText({ d20: 14, parts: [{ label: 'STR', value: 7 }, { label: 'Edge', value: -2 }], total: 19 }), 'd20 14 + STR 7 − Edge 2 = 19');
    assert.equal(rollText({ total: 5 }), '');
    assert.equal(rollText(null), '');
});

test('resolveOf takes the rpg.resolve receipt the replay kept, not one it skipped', () => {
    const record = { receipts: [{ id: 'a', type: 'inventory.add' }, { id: 'b', type: RESOLVE, data: { v2: { result: result() } } }] };
    assert.equal(resolveOf(record).rounds.length, 1);
    assert.equal(resolveOf(record, [{ receipts: ['b'] }]), null);
    assert.equal(resolveOf({ receipts: [] }), null);
});

test('the model: arrows on the last action aimed at the name, status for who fought, the foes line', () => {
    const model = panelModel({ resolve: readResolve(result()), state: after, before, roleOf });
    const lines = model.rounds[0].lines;
    assert.deepEqual(lines.map(line => line.arrows), [['Wessel Scratched'], ['Sluice Rat A Wounded'], ['Sluice Rat B Hurt', 'Ren Tired']]);
    assert.deepEqual(model.status.map(who => who.name), ['Wessel', 'Ren']);
    assert.deepEqual(model.status[0].rows.map(row => [row.key, row.word]), [['health', 'Scratched'], ['mana', 'Steady'], ['stamina', 'Tired']]);
    assert.deepEqual(model.foes.map(foe => foe.text), ['Sluice Rat A: Wounded', 'Sluice Rat B: Hurt', 'Sluice Rats ×4: Unhurt']);
});

test('the header says which exchanges', () => {
    assert.equal(headerText({ rounds: [{ n: 2 }] }), 'Combat · Exchange 2');
    assert.equal(headerText({ rounds: [{ n: 1 }, { n: 3 }] }), 'Combat · Exchanges 1–3');
    assert.equal(headerText({ rounds: [] }), 'Check');
});

function panel(options = {}) {
    const doc = setupDom();
    const model = panelModel({ resolve: readResolve(result()), state: after, before, roleOf });
    return { doc, model, node: buildPanel(doc, model, options) };
}

test('the panel: short lines, the coloured result word, (26 vs 16), the arrow, aligned bars and the foes line', () => {
    const { node } = panel({ index: 4 });
    assert.equal(node.getAttribute('data-ss-screen'), 'lean-rpg/battle-log', 'a root of the look, so the tokens reach it');
    assert.equal(node.querySelector('.rpg-bl-title').textContent, 'Combat · Exchange 2');
    assert.equal(node.querySelector('.rpg-bl-order').textContent, 'Turn order: Sluice Rat A > Wessel > Ren');
    assert.equal(node.querySelector('.rpg-bl-round-title').textContent, 'Round 2');
    assert.deepEqual(node.querySelectorAll('.rpg-act-text').map(line => line.textContent), [
        'Sluice Rat A attacks Wessel — Fail (12 vs 15) → Wessel Scratched',
        'Wessel uses Iron Breath on Sluice Rat A — Success (26 vs 16) → Sluice Rat A Wounded',
        'Ren uses Spark on Sluice Rat B — Success at a cost (17 vs 18) → Sluice Rat B Hurt, Ren Tired',
    ]);
    assert.deepEqual(node.querySelectorAll('.rpg-out').map(word => word.className), ['rpg-out rpg-out-fail', 'rpg-out rpg-out-success', 'rpg-out rpg-out-cost']);
    assert.equal(node.querySelector('.rpg-skill').textContent, 'Iron Breath');
    const wessel = node.querySelector('.rpg-bl-who[data-who="Wessel"]');
    assert.deepEqual(wessel.querySelectorAll('.rpg-bl-stat').map(cell => cell.querySelector('.rpg-bl-word').textContent), ['Scratched', 'Steady', 'Tired']);
    assert.equal(wessel.querySelector('.rpg-bl-health .rpg-bl-track').style.getPropertyValue('--rpg-fill'), '0.8');
    assert.equal(wessel.querySelector('.rpg-bl-mana .rpg-bl-track').style.getPropertyValue('--rpg-fill'), '0.75');
    assert.equal(node.querySelector('.rpg-bl-foes').textContent, 'FoesSluice Rat A: Wounded · Sluice Rat B: Hurt · Sluice Rats ×4: Unhurt');
});

test('the breakdown is on tap; a line with none is not a toggle', () => {
    const { node } = panel();
    const [rat, wessel, ren] = node.querySelectorAll('.rpg-act');
    const line = wessel.querySelector('.rpg-act-line'), why = wessel.querySelector('.rpg-why');
    assert.equal(why.hidden, true);
    assert.equal(line.getAttribute('aria-expanded'), 'false');
    line.click();
    assert.equal(why.hidden, false);
    assert.equal(why.textContent, 'd20 14 + STR 7 + Class II 4 + Adept 1 = 26 vs d20 9 + 5 + Class I 2 = 16');
    assert.equal(line.getAttribute('aria-expanded'), 'true');
    line.click();
    assert.equal(why.hidden, true);
    assert.equal(rat.querySelector('.rpg-why'), null);
    assert.equal(ren.querySelector('.rpg-why'), null);
});

test('the header folds the panel and says so', () => {
    const folds = [];
    const { node } = panel({ onFold: on => folds.push(on) });
    const head = node.querySelector('.rpg-bl-head'), body = node.querySelector('.rpg-bl-body');
    assert.equal(body.hidden, false);
    head.click();
    assert.equal(body.hidden, true);
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    assert.ok(node.classList.contains('rpg-bl-folded'));
    head.click();
    assert.equal(body.hidden, false);
    assert.deepEqual(folds, [true, false]);
    assert.equal(panel({ folded: true }).node.querySelector('.rpg-bl-body').hidden, true);
});

test('a check is one line, the breakdown on tap', () => {
    const doc = setupDom();
    const model = panelModel({ resolve: readResolve({ checks: [{ who: 'Wessel', skill: 'Stealth', stat: 'dex', outcome: 'success', total: 19, vs: 15, breakdown: 'd20 12 + DEX 5 + 2 = 19' }] }), state: after, before, roleOf });
    const node = buildPanel(doc, model);
    assert.equal(node.querySelector('.rpg-bl-title').textContent, 'Check');
    assert.equal(node.querySelector('.rpg-act-text').textContent, 'Wessel — Stealth: 19 vs 15 — Success');
    assert.equal(node.querySelectorAll('.rpg-bl-status').length, 0, 'no fight, no status');
});

// ---- the marker in a drawn message ----

function mes(doc, build) {
    const message = makeMessage(doc, 5), text = message.querySelector('.mes_text');
    text.textContent = '';
    build(text, tag => doc.createElement(tag), value => doc.createTextNode(value));
    return { message, text };
}
const kids = text => text.children.map(node => `${node.tagName.toLowerCase()}:${node.textContent}`);
const spot = doc => { const node = doc.createElement('div'); node.className = BATTLE_ROOT; node.textContent = 'PANEL'; return node; };

test('the marker paragraph is replaced by the panel; the prose around it stays', () => {
    const doc = setupDom();
    const { text } = mes(doc, (root, el) => {
        for (const line of ['Before.', '[battle]', 'After.']) { const p = el('p'); p.textContent = line; root.appendChild(p); }
    });
    assert.equal(placeAtMarker(doc, text, spot(doc)), true);
    assert.deepEqual(kids(text), ['p:Before.', 'div:PANEL', 'p:After.']);
});

test('a marker between line breaks splits the paragraph around the panel', () => {
    const doc = setupDom();
    const { text } = mes(doc, (root, el, t) => {
        const p = el('p');
        p.append(t('The rat bites.'), el('br'), t('[battle]'), el('br'), t('It falls back.'));
        root.appendChild(p);
    });
    placeAtMarker(doc, text, spot(doc));
    assert.deepEqual(kids(text), ['p:The rat bites.', 'div:PANEL', 'p:It falls back.']);
});

test('the marker is matched case-folded and trimmed; a second one is hidden; none is no match', () => {
    const doc = setupDom();
    const { text } = mes(doc, (root, el) => {
        for (const line of ['One.', '  [BATTLE]  ', 'Two.', '[battle]', 'Three.']) { const p = el('p'); p.textContent = line; root.appendChild(p); }
    });
    assert.equal(placeAtMarker(doc, text, spot(doc)), true);
    assert.deepEqual(kids(text), ['p:One.', 'div:PANEL', 'p:Two.', 'p:', 'p:Three.']);
    const none = mes(doc, (root, el) => { const p = el('p'); p.textContent = 'He said [battle] cries and a [battle]-axe.'; root.appendChild(p); });
    assert.equal(placeAtMarker(doc, none.text, spot(doc)), false, 'only a line of its own counts');
});

// ---- on the real host ----

async function world(t, { feature = true } = {}) {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel'), characterDefinition('ren', 'Ren'), skillsDefinition('wessel-skills', 'Wessel'), foesDefinition()]);
    await setField(host, 'foes', 'foe1', 'Sluice Rat A');
    const first = await host.send('To the quay.', 'The quay.\n\n[battle]\n\nAfter.');
    const head = host.store.headIndex();
    await setField(host, 'foes', 'hurt1', 2);
    host.ctx.chat[head].extra.storySuite.receipts.push({ id: 'rc_rpg0001', type: RESOLVE, module: 'story-block', cause: 'system', summary: '', narrate: false, rev: 99, data: { v2: { result: result() } } });
    const doc = setupDom();
    doc.defaultView = { localStorage: memory() };
    const log = createBattleLog({ ctx: host.ctx, doc, store: host.store, featureOn: () => feature, roleOf, events: host.events });
    t.after(() => log.destroy());
    return { host, doc, log, head, first };
}
const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map }; };
function message(doc, index, build) {
    const el = makeMessage(doc, index), text = el.querySelector('.mes_text');
    text.textContent = '';
    build(text, tag => doc.createElement(tag));
    return el;
}
const prose = (...lines) => (root, el) => { for (const line of lines) { const p = el('p'); p.textContent = line; root.appendChild(p); } };

test('on a reply with recorded rolls the panel is drawn at its marker, inside the message', async t => {
    const { doc, log, head } = await world(t);
    const el = message(doc, head, prose('The quay.', '[battle]', 'After.'));
    const cards = doc.createElement('div'); cards.className = 'ss-cards';
    el.querySelector('.mes_block').appendChild(cards);
    const node = log.refresh(head, el);
    assert.ok(node);
    assert.equal(node.getAttribute('data-variant'), 'inline');
    assert.deepEqual(kids(el.querySelector('.mes_text')).map(item => item.split(':')[0]), ['p', 'div', 'p']);
    assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 1);
    assert.match(node.textContent, /Wessel uses Iron Breath on Sluice Rat A — Success \(26 vs 16\) → Sluice Rat A Wounded/);
});

test('with no marker the same panel is a card under the reply, above "Changed this reply"', async t => {
    const { doc, log, head } = await world(t);
    const el = message(doc, head, prose('The quay.', 'After.'));
    const cards = doc.createElement('div'); cards.className = 'ss-cards';
    el.querySelector('.mes_block').appendChild(cards);
    const node = log.refresh(head, el);
    assert.equal(node.getAttribute('data-variant'), 'card');
    const blocks = el.querySelector('.mes_block').children;
    assert.deepEqual(blocks.map(child => child.className.split(' ')[0]), ['mes_text', 'rpg-battle', 'ss-cards']);
});

test('a redraw keeps the same panel while nothing changed, and follows the marker when it appears', async t => {
    const { doc, log, head } = await world(t);
    const el = message(doc, head, prose('The quay.', 'After.'));
    const first = log.refresh(head, el);
    assert.equal(log.refresh(head, el), first, 'nothing changed: the same node');
    const text = el.querySelector('.mes_text');
    const marker = doc.createElement('p'); marker.textContent = '[battle]';
    text.appendChild(marker);
    const moved = log.refresh(head, el);
    assert.equal(moved.getAttribute('data-variant'), 'inline');
    assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 1, 'the card went when the panel moved into the text');
    assert.equal(log.refresh(head, el), moved, 'and it stays while the marker is consumed');
});

test('a reply with no recorded rolls, a message of the reader\'s and the feature off draw nothing', async t => {
    const { doc, log, host, head } = await world(t);
    const quiet = message(doc, 1, prose('Opening.'));
    assert.equal(log.refresh(1, quiet), null);
    assert.equal(quiet.querySelectorAll(`.${BATTLE_ROOT}`).length, 0);
    const reader = message(doc, head - 1, prose('To the quay.'));
    assert.equal(log.refresh(head - 1, reader), null);
    const off = await createHost();
    t.after(() => off.close());
    const el = message(doc, head, prose('The quay.'));
    const log2 = createBattleLog({ ctx: host.ctx, doc, store: host.store, featureOn: () => false, roleOf });
    assert.equal(log2.refresh(head, el), null);
    assert.equal(el.querySelectorAll(`.${BATTLE_ROOT}`).length, 0);
    log2.destroy();
});

test('the fold is the viewer\'s: kept per chat and reply, not in the story', async t => {
    const { doc, log, host, head } = await world(t);
    const el = message(doc, head, prose('The quay.', 'After.'));
    const node = log.refresh(head, el);
    node.querySelector('.rpg-bl-head').click();
    const store = doc.defaultView.localStorage;
    assert.equal(store.map.size, 1);
    assert.match(String(store.map.values().next().value), /true/);
    const again = log.refresh(head, el);
    assert.equal(again.querySelector('.rpg-bl-body').hidden, true, 'redrawn folded');
    assert.notEqual(again, node);
    assert.ok(!JSON.stringify(host.ctx.chat).includes('rpg-bl'), 'nothing of the panel is in the chat');
    assert.equal(createFoldStore(setupDom()).has('x'), false, 'a page with no storage still works');
});

test('refreshAll goes over every drawn reply', async t => {
    const { doc, log, head } = await world(t);
    message(doc, head, prose('The quay.', '[battle]'));
    log.refreshAll();
    assert.equal(doc.querySelectorAll(`.${BATTLE_ROOT}`).length, 1);
    log.destroy();
    assert.equal(doc.querySelectorAll(`.${BATTLE_ROOT}`).length, 0, 'destroy takes the panels away');
});

// ---- out of the prompt ----

test('the marker line leaves the prompt history; the text around it stays', () => {
    assert.equal(stripBattleMarker('The quay.\n\n[battle]\n\nAfter.'), 'The quay.\n\nAfter.');
    assert.equal(stripBattleMarker('A.\n[battle]\nB.'), 'A.\nB.');
    assert.equal(stripBattleMarker('A.\n  [Battle]  \n\nB.'), 'A.\nB.');
    assert.equal(stripBattleMarker('A.\n[battle]'), 'A.\n');
    assert.equal(stripBattleMarker('He loved a [battle] cry.\nNo marker here.'), 'He loved a [battle] cry.\nNo marker here.');
    assert.equal(stripBattleMarker('Plain.'), 'Plain.');
    assert.equal(stripBattleMarker(7), 7);
});

test('the history strip runs only while the feature is on: chat completion and text completion', async t => {
    for (const mainApi of ['openai', 'textgenerationwebui']) {
        const on = await createHost({ st: { mainApi } });
        t.after(() => on.close());
        on.features.set('story-block.lean-rpg', true);
        await on.send('One.', 'The quay.\n\n[battle]\n\nAfter.');
        const second = await on.send('Two.', 'Reply two.');
        const seen = mainApi === 'openai' ? second.request.chat.filter(item => item.role === 'assistant').map(item => item.content).join('\n') : second.request.prompt;
        assert.ok(seen.includes('The quay.'), `${mainApi}: the reply is still there`);
        assert.ok(!/\[battle\]/.test(seen), `${mainApi}: no marker in the history`);
        const off = await createHost({ st: { mainApi } });
        t.after(() => off.close());
        await off.send('One.', 'The quay.\n\n[battle]\n\nAfter.');
        const third = await off.send('Two.', 'Reply two.');
        const kept = mainApi === 'openai' ? third.request.chat.filter(item => item.role === 'assistant').map(item => item.content).join('\n') : third.request.prompt;
        assert.ok(/\[battle\]/.test(kept), `${mainApi}: with the feature off the text goes in as it always did`);
    }
});

test('the stylesheet: a dark monospace panel from tokens, the status bars aligned, a tap row 44px tall', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-battle \{[^}]*monospace/);
    assert.match(css, /\.rpg-bl-head \{[^}]*min-height: 44px/);
    assert.match(css, /\.rpg-bl-stat \{[^}]*grid-template-columns: 4\.6em minmax\(36px, 1fr\) 8\.5em/, 'label, bar and word in fixed columns, so the bars line up');
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.rpg-bl-stats \{ grid-template-columns: 1fr/, 'one row per bar on a phone');
});
