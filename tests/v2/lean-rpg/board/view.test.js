// The Fight tab board is exercised on the test host and its mounted page.
// It covers buttons, the target list, number keys, undo and in-page discard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { page, begin, makeBlocks, settle } from '../view/page.js';

async function defineFoes(host, entries) {
    const foes = structuredClone(LEAN_RPG_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    entries.forEach(([name, count, level, hurt], at) => {
        Object.assign(foes.state[`foe${at + 1}`], { default: name });
        Object.assign(foes.state[`count${at + 1}`], { default: count });
        Object.assign(foes.state[`level${at + 1}`], { default: level });
        Object.assign(foes.state[`hurt${at + 1}`], { default: hurt });
    });
    const defined = await host.sdk.command('dm.define', { definition: foes });
    assert.equal(defined.ok, true, defined.message);
}

async function showStop(t, { character = {}, foes, action, stop }) {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { character });
    await defineFoes(host, foes);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
    let result = null;
    for (let attempt = 0; attempt < 100 && result?.stop !== stop; attempt += 1) {
        if (boardSession(meta)) discardBoard(meta);
        assert.equal(openBoard(meta, host.head(), { sid, rules }).error, undefined);
        const staged = stageExchange(meta, host.head(), action);
        assert.equal(staged.error, undefined, staged.error);
        result = staged.preview.result;
    }
    assert.equal(result?.stop, stop, `the seeded exchanges reach a ${stop} fight`);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    return { doc, result };
}

test('the board opens, selects a target by keyboard, rolls once, undoes and confirms discard', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { skills: { skill1: 'Shadow Cut', about1: 'sweep every foe', uses1: 'mana' }, character: { mana: 0 } });
    await defineFoes(host, [['Rats', 2, 1, 5], ['Spiders', 1, 1, 5]]);
    await settle();
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.ok(fight().querySelector('.rpg-board-open'));
    fight().querySelector('.rpg-board-open').click();
    assert.ok(fight().querySelector('.rpg-board-log'));
    const blocked = fight().querySelectorAll('.rpg-board-choice').find(node => node.textContent.includes('Shadow Cut'));
    assert.equal(blocked.disabled, true);
    assert.match(blocked.textContent, /Mana is Empty/);
    doc.key('1');
    assert.match(fight().textContent, /Choose a target/);
    const targets = [...fight().querySelectorAll('.rpg-board-choice')].map(node => node.textContent);
    assert.ok(targets.some(text => /Rats \(Lv 1, /.test(text)), 'the target line names the foe, level and bar');
    assert.ok(targets.some(text => /Spiders \(Lv 1, /.test(text)), 'every standing foe has a target line');
    const escape = { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {} };
    doc.listeners.find(entry => entry.fn.name === 'keydown' && entry.capture).fn(escape);
    assert.match(fight().textContent, /choose an action/);
    fight().querySelector('[data-choice="1"]').click();
    fight().querySelector('[data-choice="2"]').click();
    assert.match(fight().querySelector('.rpg-board-log').textContent, /Exchange 1/);
    fight().querySelector('.rpg-board-undo').click();
    assert.doesNotMatch(fight().querySelector('.rpg-board-log').textContent, /Exchange 1/);
    fight().querySelector('.rpg-board-discard').click();
    assert.match(fight().textContent, /Discard this fight/);
    fight().querySelector('.rpg-board-confirm').click();
    assert.ok(fight().querySelector('.rpg-board-open'));
});

test('the board ends on a won card', async t => {
    const { doc, result } = await showStop(t, {
        character: { str: 20, agi: 20 }, foes: [['Rats', 1, 1, 1]],
        action: [{ who: 'Wessel', kind: 'attack', target: 1 }], stop: 'won',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'won');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight won/);
    assert.match(fight.textContent, /Your next message carries this fight/);
    assert.ok(fight.querySelector('.rpg-board-note'));
});

test('the board ends on a lost card', async t => {
    const { doc, result } = await showStop(t, {
        character: { str: 3, agi: 3, vit: 3, health: 1 }, foes: [['Rats', 12, 99, 5]],
        action: [{ who: 'Wessel', kind: 'attack', target: 1 }], stop: 'lost',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'lost');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight lost/);
});

test('the board ends on a fled card', async t => {
    const { doc, result } = await showStop(t, {
        character: { agi: 20 }, foes: [['Rats', 1, 1, 5]],
        action: [{ who: 'Wessel', kind: 'flee' }], stop: 'fled',
    });
    const fight = doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.equal(result.stop, 'fled');
    assert.match(fight.querySelector('.rpg-board-end').textContent, /Fight fled/);
});

test('the phone rules keep choices at 48 px with a safe-area bottom and no double tap', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/board/board.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-board-choice\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*48px;[^}]*font-size:\s*15px;[^}]*touch-action:\s*manipulation/s);
    assert.match(css, /@media\s*\(max-width:\s*600px\)/);
    assert.match(css, /env\(safe-area-inset-bottom\)/);
    assert.match(css, /\.rpg-board-actions button[^{]*\{[^}]*min-height:\s*44px/s);
});
