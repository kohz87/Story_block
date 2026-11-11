// The production board in a real browser: a phone's touch and zoomed frame (390×844, 360×740), then a tablet and a desktop width (820, 1280).
// Run with the optional browser package and its browser installed; no running host is used.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/src/v2/view/host.css"><link rel="stylesheet" href="/src/v2/view/size.css">
<link rel="stylesheet" href="/src/v2/lean-rpg/view/lean-rpg.css"><link rel="stylesheet" href="/src/v2/lean-rpg/board/board.css">
<style>html,body { margin:0; --ss-font:Arial,sans-serif; } * { box-sizing:border-box; } .ss-gameview-bar { height:50px; }
.ss-gameview-nav { background:#222; } .ss-gameview-body { padding:12px; }
.ss-gameview[hidden] { display:none; } .story-suite-sheet-bar { background:#222; }
</style></head><body><div class="ss-gameview"><div class="ss-gameview-main">
<div class="ss-gameview-bar">Fight</div><div class="ss-gameview-hero"></div>
<div class="ss-gameview-body"><section id="board"></section></div><nav class="ss-gameview-nav"></nav>
</div></div>
<div class="story-suite-sheet" hidden><div class="story-suite-sheet-head"><b>Story</b><button class="story-suite-sheet-close">Close</button></div>
<div class="story-suite-sheet-body"><div class="story-suite-pane"><div id="panel-slot"></div></div></div>
<nav class="story-suite-sheet-bar">Party / Inventory / Quests / World / Fight</nav></div>
<div id="safe" style="padding-bottom:env(safe-area-inset-bottom)"></div>
<script type="module">
import { STANDARD_TEMPLATES } from '/src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '/src/v2/lean-rpg/rules.js';
import { createBoardView } from '/src/v2/lean-rpg/board/view.js';
import { boardSession, discardBoard, openBoard, stageExchange } from '/src/v2/lean-rpg/board/session.js';
import { playBoard } from '/src/v2/lean-rpg/board/engine.js';
import { hero } from '/src/v2/view/widgets/hero.js';
hero.render(document.querySelector('.ss-gameview-hero'), { name:'Astra', place:'Bluewatch', time:'Day 1', weather:'Rain', compact:true, boardExpandable:true,
    you:{ rank:'F', rankLabel:'Guild Rank', wearing:'A travelling coat', condition:'Tired' },
    bars:[{ kind:'hp', label:'Health', value:4, max:5 }, { kind:'mp', label:'Mana', value:2, max:5 }, { kind:'sp', label:'Stamina', value:3, max:5 }] }, {});
const domain = { pins:{}, active:{}, instances:{}, perReply:{} };
for (const role of ['character', 'skills', 'foes']) {
    const definition = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === role).definition);
    const fields = Object.fromEntries(Object.entries(definition.state).map(([key, value]) => [key, structuredClone(value.default)]));
    if (role === 'character') Object.assign(fields, { who:'Astra', vit:20, health:5 });
    if (role === 'skills') Object.assign(fields, { who:'Astra', skill1:'Cut', about1:'strike a foe', stat1:'str', uses1:'stamina',
        skill2:'Sweep', about2:'sweep every foe in reach', stat2:'agi', uses2:'stamina' });
    if (role === 'foes') Object.assign(fields, { foe1:'Rats', count1:8, level1:1, hurt1:5, foe2:'Spiders', count2:8, level2:1, hurt2:5 });
    const id = 'pack.chat/' + role;
    domain.pins[id] = { definition, packId:'chat', interpreter:1 };
    domain.active[id] = { hash:id, generation:1, subjects:['chat'] };
    domain.instances[id] = { chat:{ fields, timers:{}, offers:{}, settled:{} } };
}
const state = { domains:{ dataModules:domain } }, meta = {}, receipts = [];
const store = { carrierSid:() => 'reply', headIndex:() => 1, receipts:() => receipts };
let ready = false;
for (let n = 0; n < 100; n += 1) {
    const opened = openBoard(meta, state, { sid:'reply', rules:{ ...STANDARD_FORMULA, levelDivisor:5 } });
    if (opened.error) throw new Error(opened.error);
    const action = [{ who:'Astra', kind:'attack', target:11 }];
    const played = playBoard(state, boardSession(meta).setup, [{ actions:action }, { actions:action }]);
    if (!played.error && played.result.stop === 'open') { ready = true; break; }
    discardBoard(meta);
}
if (!ready) throw new Error('No open two-exchange fight');
const id = boardSession(meta).id;
const lines = Array.from({ length:35 }, (_, n) => ({ n:n+1, lines:[{ kind:'act', pc:{ who:'Astra', die:12, total:18 }, foe:{ name:'Rats', total:10 }, outcome:'success' }] }));
const node = document.querySelector('#board'), handles = [];
if (location.search.includes('panel')) {
    document.querySelector('.ss-gameview').hidden = true;
    document.querySelector('.story-suite-sheet').hidden = false;
    document.querySelector('#panel-slot').append(node);
}
const view = createBoardView({ doc:document, headState:() => state, meta:() => meta, store, rules:() => ({ ...STANDARD_FORMULA, levelDivisor:5 }),
    query:() => null, readerName:() => 'Astra', roleOf:definition => definition.role, levels:() => ({ ranks:[], playerRank:null }), on:() => true,
    start:{ waiting:() => true, sending:() => false, send:() => {} } });
function draw() { for (const handle of handles.splice(0)) handle.destroy?.(); view.clear(); node.replaceChildren(); node.classList.remove('rpg-board-active');
    const snapshot = view.snapshot(state); if (snapshot) view.render(node, snapshot, draw, handles, {}); else view.offer(node, draw); }
draw();
window.boardTest = { count:() => boardSession(meta)?.exchanges.length ?? 0, configure:({ skills = 2, rounds = 0, wrap = false, groups = 2 } = {}) => {
    const foe = domain.instances['pack.chat/foes'].chat.fields;
    ['Rats', 'Spiders', 'Wolves', 'Crows', 'Gulls', 'Bats'].forEach((name, at) => Object.assign(foe, { ['foe' + (at + 1)]:at < groups ? name : '', ['count' + (at + 1)]:at < groups ? 8 : 0, ['level' + (at + 1)]:1, ['hurt' + (at + 1)]:5 }));
    const fields = domain.instances['pack.chat/skills'].chat.fields;
    for (let n = 1; n <= 5; n += 1) {
        fields['skill' + n] = n <= skills ? (wrap && n === 2 ? 'An exceptionally long skill name that must wrap over several lines on a phone' : 'Cut ' + n) : '';
        fields['about' + n] = 'strike a foe'; fields['stat' + n] = 'str'; fields['uses' + n] = 'stamina';
    }
    receipts.length = 0;
    if (rounds) receipts.push({ receipt:{ data:{ v2:{ result:{ board:{ id }, rounds:lines.slice(0, rounds) } } } } });
    draw();
}, end:() => {
    discardBoard(meta);
    for (let n = 0; n < 200; n += 1) {
        openBoard(meta, state, { sid:'reply', rules:{ ...STANDARD_FORMULA, levelDivisor:5 } });
        const played = stageExchange(meta, state, [{ who:'Astra', kind:'flee' }]);
        if (!played.error && played.preview.result.stop !== 'open') {
            const endedId = boardSession(meta).id;
            receipts.push({ receipt:{ data:{ v2:{ result:{ board:{ id:endedId }, rounds:lines } } } } });
            draw(); return played.preview.result.stop;
        }
        discardBoard(meta);
    }
    throw new Error('No ended fight');
} };
document.body.dataset.ready = 'yes';
</script></body></html>`;

async function server() {
    const instance = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            if (pathname === '/') { response.writeHead(200, { 'content-type':'text/html' }); response.end(html); return; }
            const file = resolve(root, `.${decodeURIComponent(pathname)}`);
            if (!file.startsWith(`${root}${sep}src${sep}`)) { response.writeHead(404); response.end(); return; }
            const content = await readFile(file);
            response.writeHead(200, { 'content-type': extname(file) === '.css' ? 'text/css' : 'text/javascript' }); response.end(content);
        } catch { response.writeHead(404); response.end(); }
    });
    await new Promise((accept, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', accept); });
    return instance;
}

const PHONES = [{ width:390, height:844 }, { width:360, height:740 }];
for (const viewport of [...PHONES, { width:820, height:1000 }, { width:1280, height:800 }]) for (const frame of viewport.width < 760 ? ['game', 'panel'] : ['game']) {
    const phone = viewport.width < 760;
    test(`${frame} board layout and gestures at ${viewport.width}×${viewport.height}`, async t => {
        let chromium;
        try { ({ chromium } = await import('playwright')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; t.skip('Install the optional browser package to run the rendered touch tests.'); return; }
        let browser;
        try { browser = await chromium.launch({ headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] }); }
        catch (error) {
            if (/EPERM|operation not permitted|executable doesn't exist/i.test(String(error))) { t.skip(`Browser unavailable: ${String(error).split('\n')[0]}`); return; }
            throw error;
        }
        t.after(() => browser.close());
        let web;
        try { web = await server(); } catch (error) { if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip(`Local server unavailable: ${error.code}`); return; } throw error; }
        t.after(() => new Promise(done => web.close(done)));
        const context = await browser.newContext({ viewport, isMobile:phone, hasTouch:phone, deviceScaleFactor:1 });
        t.after(() => context.close());
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${web.address().port}/${frame === 'panel' ? '?panel' : ''}`);
        await page.waitForSelector('[data-ready="yes"]', { state: 'attached' });
        await page.waitForSelector('.rpg-board-cards .rpg-chip');
        const tap = locator => (phone ? locator.tap() : locator.click());
        if (frame === 'game' && phone) {
            const hero = page.locator('.ss-gameview-hero .ss-hero'), more = page.locator('.ss-hero-board-more');
            assert.equal(await hero.evaluate(el => el.classList.contains('ss-hero-compact')), true);
            assert.equal(await page.locator('.ss-hero-you').evaluate(el => getComputedStyle(el).display), 'none');
            await more.tap();
            assert.equal(await more.getAttribute('aria-expanded'), 'true');
            assert.equal(await hero.evaluate(el => el.classList.contains('ss-hero-compact')), false);
            await more.tap();
            assert.equal(await more.getAttribute('aria-expanded'), 'false');
        }
        const bodySelector = frame === 'panel' ? '.story-suite-sheet-body' : '.ss-gameview-body';
        const configure = async options => { await page.evaluate(options => window.boardTest.configure(options), options); };
        const layout = () => page.evaluate(bodySelector => {
            const box = node => { const r = node.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height }; };
            const body = document.querySelector(bodySelector), status = document.querySelector('.rpg-board-status'), controls = document.querySelector('.rpg-board-controls');
            const scrollers = ['.rpg-board-status', '.rpg-board-cards', '.rpg-board-choices', '.rpg-board-log', '.rpg-board-controls', '.rpg-board-active']
                .filter(selector => { const el = document.querySelector(selector), y = getComputedStyle(el).overflowY; return /auto|scroll/.test(y) || el.scrollHeight > el.clientHeight + 1; });
            const buttons = [...document.querySelectorAll('.rpg-board-choice')];
            return { boardWidth:document.querySelector('#board').offsetWidth, status:box(status), controls:box(controls), body:box(body), scrollers, buttons:buttons.map(box), lefts:[...new Set(buttons.map(b => Math.round(b.getBoundingClientRect().left)))].length,
                overflow:document.documentElement.scrollWidth > innerWidth || body.scrollWidth > body.clientWidth + 1,
                chips:[...document.querySelectorAll('.rpg-chips-foes .rpg-chip-name')].map(n => n.textContent), party:[...document.querySelectorAll('.rpg-chips-party .rpg-chip-name')].map(n => n.textContent),
                labels:[...document.querySelectorAll('.rpg-actor .rpg-res-label')].map(n => n.textContent),
                bar:box(document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-bar') ?? document.querySelector('.ss-gameview-nav')),
                logOpen:document.querySelector('.rpg-board-log').open, scrolled:body.scrollTop };
        }, bodySelector);
        for (const skills of [0, 1, 2, 3, 4]) {
            await configure({ skills, rounds:0 });
            const now = await layout();
                        assert.equal(now.buttons.length, skills + 2, 'Attack, the skills and Flee');
            assert.ok(now.buttons.every(b => b.height >= (phone ? 47.5 : 36)), 'buttons are at least 36px (48px on a phone)');
            const columns = now.boardWidth >= 900 ? 3 : 2;   // the board's own CSS width (the game view may be zoomed)
            assert.equal(now.lefts, Math.min(columns, now.buttons.length), `${columns} columns of skill buttons`);
            if (!phone) assert.ok(now.boardWidth >= 700, 'a wide board is 700px or more');
            assert.deepEqual(now.scrollers, [], 'nothing inside the board scrolls');
            assert.equal(now.overflow, false, 'no horizontal scroll');
            assert.deepEqual(now.chips, ['Rats ×8Lv 1', 'Spiders ×8Lv 1'], 'a group of several is ONE chip');
            assert.deepEqual(now.party, ['AstraLv 1']);
            assert.deepEqual(now.labels, ['Mana', 'Stamina']);
        }
        // six foe groups (the six-group rule): six chips, nothing overflows or scrolls, the choices stay touch targets
        await configure({ skills:2, rounds:0, groups:6 });
        const six = await layout();
        assert.equal(six.chips.length, 6, 'six foe groups are six chips');
        assert.equal(six.overflow, false, 'six groups: no horizontal scroll');
        assert.deepEqual(six.scrollers, [], 'six groups: nothing inside the board scrolls');
        assert.ok(six.buttons.every(b => b.height >= (phone ? 47.5 : 36)), 'six groups: buttons stay touch targets');
        await configure({ skills:2, rounds:0, groups:2 });
        const wide = await layout();
        if (phone) assert.ok(wide.controls.top >= wide.status.bottom - 1, 'one column on a phone');
        else {
            assert.ok(wide.status.right <= wide.controls.left + 1, 'status on the left, actions on the right');
            assert.ok(Math.abs(wide.status.top - wide.controls.top) < 3, 'side by side');
        }
        await configure({ skills:4, rounds:35 });
        await page.locator('.rpg-board-log > summary').click();
        assert.equal((await layout()).logOpen, true, 'a tap opens the full log');
        if (phone) {
            await page.evaluate(bodySelector => { const body = document.querySelector(bodySelector); body.scrollTop = body.scrollHeight; }, bodySelector);
            const stuck = await layout();
            assert.ok(stuck.scrolled > 100, 'the page scrolled');
            assert.ok(stuck.status.top - stuck.body.top < 12 && stuck.status.bottom > stuck.body.top, 'the status stays at the top while the page scrolls');
        }
        await page.locator('.rpg-board-log > summary').click();
        await configure({ skills:2, rounds:1 });
        await tap(page.locator('[data-choice="1"]'));   // Attack: two groups, so the groups come first
        assert.match(await page.locator('.rpg-board-prompt').innerText(), /Choose a group/);
        const back = page.locator('.rpg-board-back'), backBox = await back.boundingBox();
        assert.ok(backBox.width >= 35.5 && backBox.height >= (phone ? 47.5 : 36), `Back is a touch target ${JSON.stringify(backBox)}`);
        await tap(back);
        await tap(page.locator('[data-choice="1"]'));
        const group = await page.locator('[data-choice="1"]').boundingBox();
        if (phone) { await page.touchscreen.tap(group.x + group.width / 2, group.y + group.height / 2); await page.touchscreen.tap(group.x + group.width / 2, group.y + group.height / 2); }
        else { await page.mouse.click(group.x + group.width / 2, group.y + group.height / 2); await page.mouse.click(group.x + group.width / 2, group.y + group.height / 2); }
        assert.equal(await page.evaluate(() => window.boardTest.count()), 1, 'a double tap stages one exchange');
        assert.match(await page.locator('.rpg-board-log > summary').innerText(), /Exchange 1/);
        await page.waitForTimeout(600);
        await tap(page.locator('[data-choice="1"]'));
        await tap(page.locator('[data-choice="1"]'));
        assert.equal(await page.evaluate(() => window.boardTest.count()), 2, 'a later intentional choice stages another exchange');
        await tap(page.locator('.rpg-board-discard'));
        assert.match(await page.locator('.rpg-board-controls').innerText(), /Discard this fight and its unsent exchanges/);
        await tap(page.getByRole('button', { name:'Cancel' }));
        assert.equal(await page.evaluate(() => window.boardTest.count()), 2);
        await tap(page.locator('.rpg-board-discard'));
        await tap(page.locator('.rpg-board-confirm'));
        assert.equal(await page.evaluate(() => window.boardTest.count()), 0);
        await page.evaluate(() => window.boardTest.end());
        assert.equal(await page.locator('#board').evaluate(el => el.classList.contains('rpg-board-finished')), true);
        assert.equal(await page.locator('.rpg-board-log').evaluate(el => el.open), true, 'the finished fight shows its whole log');
        if (!phone) return;
        const scroller = page.locator(frame === 'panel' ? '.story-suite-sheet-body' : '.ss-gameview-body');
        assert.equal(await scroller.evaluate(el => el.scrollHeight > el.clientHeight), true, 'the ended board scrolls as one page');
        assert.equal(await page.locator('.rpg-board-end-description').evaluate(el => getComputedStyle(el).display), 'none');
        assert.match(await page.locator('.rpg-board-awards-phone').innerText(), /^Pending:/);
        await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const end = await page.evaluate(() => {
            const bar = document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-bar') ?? document.querySelector('.ss-gameview-nav');
            const controls = document.querySelector('.rpg-board-controls');
            return { barTop:bar.getBoundingClientRect().top, bottom:controls.getBoundingClientRect().bottom,
                buttons:[...controls.querySelectorAll('button, summary')].map(button => ({ top:button.getBoundingClientRect().top, bottom:button.getBoundingClientRect().bottom })) };
        });
        assert.ok(end.buttons.length >= 3, 'the end card has send, discard and the narrator note');
        assert.ok(end.bottom <= end.barTop + 1 && end.buttons.every(button => button.top >= 0 && button.bottom <= end.barTop + 1), 'end buttons scroll above the bottom bar');
        for (const selector of ['.rpg-board-send', '.rpg-board-discard']) assert.ok((await page.locator(selector).boundingBox()).height >= 47.5, `${selector} remains a 48px touch target`);
    });
}
