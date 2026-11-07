// Starting a fight without the planner: the offer line's two buttons, the typed-attack hold with just two choices, Auto on the board,
// and the resume note. Everything runs on the mounted production UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { boardSession } from '../../../../src/v2/lean-rpg/board/session.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';

async function world(t, { hero = { agi: 20, str: 20 }, foe = 'name: Rat | count: 1 | level: 1', settings = null } = {}) {
    const app = await page(t, { formula: 'standard' });
    const { host } = app;
    host.features.set(CORE_FEATURE.fightBoard, false);
    await begin(host);
    await makeBlocks(host, { character: hero });
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    await host.send('Foes appear.', `Foes appear.\n<Changes>\n+ dm foes — a fight starts | kind: set-slot-1 | ${foe}\n</Changes>`);
    host.features.set(CORE_FEATURE.fightBoard, true);
    if (settings) for (const [key, value] of Object.entries(settings)) host.settings.set('story-block', key, value);
    app.draw();
    host.events.emit('head', { index: host.store.headIndex() });
    await settle();
    return app;
}
const fightScreen = doc => doc.querySelector('[data-ss-screen="story-block/fight"]');

test('a typed attack on a standing foe is held with just two choices; Auto-fight plays the cap and Send tells it', async t => {
    const { doc, host } = await world(t);
    const blocked = await host.send('I attack the rat.', 'Not yet.');
    assert.equal(blocked.aborted, true);
    await settle();
    const pause = fightScreen(doc).querySelector('.rpg-fight-pause');
    assert.match(pause.textContent, /This is an attack on Rat/);
    assert.match(pause.textContent, /Your message waits while the fight is played on the board\./);
    assert.deepEqual(pause.querySelectorAll('button').map(node => node.textContent), ['Fight on the board', 'Auto-fight (up to 3 exchanges)']);
    assert.equal(doc.querySelector('.rpg-fight-pause-narrate'), null, '"Narrate it instead" is gone');
    pause.querySelector('.rpg-fight-pause-auto').click();
    await settle();
    const session = boardSession(host.ctx.chatMetadata);
    assert.ok(session.exchanges.length >= 1 && session.exchanges.length <= 3);
    assert.match(fightScreen(doc).querySelector('.rpg-board-auto-note').textContent, /^Auto played \d+ exchanges?/);
    assert.ok(fightScreen(doc).querySelector('.rpg-board-send'), '"Send with this fight" is offered');
    host.ctx.generate = type => host.st.generate(type, { reply: 'The fight is told.' });
    fightScreen(doc).querySelector('.rpg-board-send').click();
    await settle();
    assert.equal(host.ctx.chat.at(-1).mes, 'The fight is told.');
    assert.equal(host.ctx.chatMetadata.rpgFightStart, undefined);
});

test('the attack hold names the cap in its Auto-fight button', async t => {
    const { doc, host } = await world(t, { settings: { rpgAutoCap: 9 } });
    assert.equal((await host.send('I attack the rat.', 'Not yet.')).aborted, true);
    await settle();
    assert.deepEqual(fightScreen(doc).querySelectorAll('.rpg-fight-pause button').map(node => node.textContent), ['Fight on the board', 'Auto-fight (until the end)']);
});

test('Auto is a button beside the choices; a manual pick takes over and clears its note; Auto again plays on', async t => {
    const { doc, host, ui } = await world(t, { hero: { agi: 1, str: 1, vit: 20 }, foe: 'name: Ogre | count: 1 | level: 40' });
    ui.mounts.screen.open('story-block/fight');
    await settle();
    fightScreen(doc).querySelector('.rpg-board-open').click();
    await settle();
    assert.equal(fightScreen(doc).querySelector('.rpg-board-auto-note'), null, 'no note before Auto');
    assert.equal(fightScreen(doc).querySelector('.rpg-board-auto').textContent, 'Auto');
    fightScreen(doc).querySelector('.rpg-board-auto').click();
    await settle();
    const first = boardSession(host.ctx.chatMetadata).exchanges.length;
    assert.ok(first >= 1 && first <= 3);
    assert.match(fightScreen(doc).querySelector('.rpg-board-auto-note').textContent, /^Auto played/);
    const open = fightScreen(doc).querySelector('.rpg-board-auto');
    assert.ok(open, 'the fight is still open, so Auto offers another run');
    {
        assert.equal(open.textContent, 'Auto again');
        await new Promise(resolve => setTimeout(resolve, 450));
        fightScreen(doc).querySelector('.rpg-board-choice').click();
        const target = fightScreen(doc).querySelector('.rpg-board-choice');
        if (/target/i.test(fightScreen(doc).querySelector('.rpg-board-prompt')?.textContent ?? '')) target.click();
        await settle();
        assert.equal(fightScreen(doc).querySelector('.rpg-board-auto-note'), null, 'a hand-picked exchange clears the note');
        assert.equal(boardSession(host.ctx.chatMetadata).exchanges.length, first + 1);
    }
});

test('the Fight tab\'s own offer has Auto-fight beside Fight on the board', async t => {
    const { doc, host, ui } = await world(t);
    ui.mounts.screen.open('story-block/fight');
    await settle();
    fightScreen(doc).querySelector('.rpg-board-open-auto').click();
    await settle();
    assert.ok(boardSession(host.ctx.chatMetadata).exchanges.length >= 1);
    assert.match(fightScreen(doc).querySelector('.rpg-board-auto-note').textContent, /^Auto played/);
});
