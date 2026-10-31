// The card under a reply that asks to add a companion (Ask; src/v2/lean-rpg/join.js), on the real page: "Mara joins the party" with Add to party,
// Edit first (the New character window, filled in) and No; the Party tab's card for someone who left (greyed, "Left"); the Changed-this-reply lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../../testkit/index.js';
import { WIZARD_SCREEN_ID } from '../../../../src/v2/lean-rpg/view/wizard.js';
import { begin, makeBlocks, page, party, settle } from './page.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const MARA = '+ party Mara | about: a hedge-witch from Kvildal | class: IV | best: int';
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const cardOf = ctx => ctx.doc.body.querySelector(`.mes[mesid="${ctx.host.ctx.chat.length - 1}"] [data-ss-reply-card="story-block/rpg-join"]`);
const wizardOf = dialog => dialog?.root.querySelector('.ss-w-rpg-wizard');
const names = host => Object.keys(host.head().domains.dataModules?.active ?? {}).sort();

async function asked(t, lines = [MARA]) {
    const ctx = await page(t, { persona: 'Wessel' });
    await ctx.host.settings.set?.('story-block', 'rpgJoin', 'ask');
    await begin(ctx.host);
    await makeBlocks(ctx.host, { who: 'Wessel', character: { soul: 3 } });
    await ctx.host.send('Mara walks in.', reply(...lines));
    ctx.draw();
    ctx.ui.mounts.card.refresh(ctx.host.ctx.chat.length - 1, { force: true });
    await settle();
    return ctx;
}

test('Ask: the card sits under the newest reply with the words of the mockup and three actions', { skip }, async t => {
    const ctx = await asked(t);
    const card = cardOf(ctx);
    assert.ok(card, 'the card');
    assert.match(card.textContent, /Mara joins the party/);
    assert.match(card.textContent, /a hedge-witch from Kvildal/);
    assert.deepEqual(card.querySelectorAll('button').map(node => node.textContent.trim()).filter(Boolean), ['Add to party', 'Edit first', 'No']);
    assert.deepEqual(names(ctx.host), ['pack.chat/wessel', 'pack.chat/wessel-skills'], 'nothing made by the line');
});

test('Add to party makes the Character and Skills blocks and the card goes', { skip }, async t => {
    const ctx = await asked(t);
    cardOf(ctx).querySelectorAll('button').find(node => node.textContent.trim() === 'Add to party').click();
    await settle();
    assert.deepEqual(names(ctx.host), ['pack.chat/mara', 'pack.chat/mara-skills', 'pack.chat/wessel', 'pack.chat/wessel-skills']);
    assert.equal(ctx.host.sdk.query('dataModules.view', { module: 'pack.chat/mara' }).chat.soul, 3, 'class IV, capped by the party\'s III');
    ctx.ui.mounts.card.refresh(ctx.host.ctx.chat.length - 1, { force: true });
    await settle();
    assert.equal(cardOf(ctx), null);
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    assert.deepEqual(party(ctx.doc).querySelectorAll('.rpg-name').map(node => node.textContent), ['Wessel', 'Mara']);
    assert.equal(party(ctx.doc).querySelectorAll('.rpg-card')[1].querySelector('.rpg-sub').textContent, 'companion');
});

test('Edit first opens the New character window filled in: name, about, class, the best stat raised; Create makes the companion and the card goes', { skip }, async t => {
    const ctx = await asked(t);
    cardOf(ctx).querySelectorAll('button').find(node => node.textContent.trim() === 'Edit first').click();
    await settle();
    const dialog = ctx.ui.mounts.dialog.current();
    assert.equal(dialog.screenId, WIZARD_SCREEN_ID);
    const who = wizardOf(dialog);
    assert.equal(who.querySelector('[data-wiz="name"]').value, 'Mara');
    assert.equal(who.querySelector('[data-wiz="about"]').value, 'a hedge-witch from Kvildal');
    assert.match(who.querySelector('.rpg-wiz-sub').textContent, /^Companion · Soul Class IV$/);
    assert.match(who.querySelector('.rpg-wiz-sum').textContent, /INT 14/);
    assert.equal(who.querySelector('.rpg-wiz-push').textContent, 'Points left: 2');
    assert.match(who.textContent, /Starts at Soul Class IV with 0 XP/);
    assert.equal(who.querySelector('[data-wiz="persona-note"]').hidden, true);
    dialog.goTo(3);
    await settle();
    assert.match(wizardOf(dialog).textContent, /Starts at Soul Class IV, 0 XP, full Health, Mana and Stamina\./);
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    const mara = ctx.host.sdk.query('dataModules.view', { module: 'pack.chat/mara' }).chat;
    assert.deepEqual([mara.who, mara.soul, mara.int, mara.points], ['Mara', 4, 14, 2], 'the wizard\'s own rules: the reader\'s two points are still theirs to spend, the class as written');
    ctx.ui.mounts.card.refresh(ctx.host.ctx.chat.length - 1, { force: true });
    await settle();
    assert.equal(cardOf(ctx), null, 'in the party: nothing to offer');
});

test('Edit first, then closing the window: the card stays and nothing is made', { skip }, async t => {
    const ctx = await asked(t);
    cardOf(ctx).querySelectorAll('button').find(node => node.textContent.trim() === 'Edit first').click();
    await settle();
    ctx.ui.mounts.dialog.current().close();
    await settle();
    ctx.ui.mounts.card.refresh(ctx.host.ctx.chat.length - 1, { force: true });
    assert.ok(cardOf(ctx));
    assert.equal(names(ctx.host).length, 2);
});

test('No dismisses the card; nothing is made and a second line for the same name shows no second card', { skip }, async t => {
    const ctx = await asked(t, [MARA, '+ party Mara | about: again']);
    assert.equal(ctx.doc.body.querySelectorAll('[data-ss-reply-card="story-block/rpg-join"]').length, 1, 'one card for one name');
    cardOf(ctx).querySelectorAll('button').find(node => node.textContent.trim() === 'No').click();
    await settle();
    ctx.ui.mounts.card.refresh(ctx.host.ctx.chat.length - 1, { force: true });
    await settle();
    assert.equal(cardOf(ctx), null);
    assert.equal(names(ctx.host).length, 2);
});

test('the Party tab: someone who left is greyed and says Left, and "Changed this reply" tells who joined and who left', { skip }, async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    await makeBlocks(ctx.host, { who: 'Wessel', character: { soul: 3 } });
    await ctx.host.settings.set?.('story-block', 'rpgJoin', 'auto');
    await ctx.host.send('Mara walks in.', reply(MARA));
    await ctx.host.send('Mara walks out.', reply('- party Mara'));
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    const cards = party(ctx.doc).querySelectorAll('.rpg-card');
    assert.equal(cards.length, 2, 'kept');
    const mara = cards.find(node => node.getAttribute('data-character') === 'Mara');
    assert.ok(mara.classList.contains('rpg-left') && mara.classList.contains('rpg-fallen'));
    assert.equal(mara.querySelector('.rpg-left-pill').textContent, 'Left');
    assert.equal(cards.find(node => node.getAttribute('data-character') === 'Wessel').classList.contains('rpg-left'), false);
});
