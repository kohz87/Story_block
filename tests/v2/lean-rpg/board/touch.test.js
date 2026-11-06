// The production board in a real browser with touch and the phone's zoomed screen frame.
// Run with the optional browser package and its browser installed; no running host is used.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/src/v2/view/mounts.css"><link rel="stylesheet" href="/src/v2/view/size.css">
<link rel="stylesheet" href="/src/v2/lean-rpg/view/lean-rpg.css"><link rel="stylesheet" href="/src/v2/lean-rpg/board/board.css">
<style>html,body { margin:0; } * { box-sizing:border-box; } .ss-gameview-bar { height:50px; }
.ss-gameview-hero { height:60px; } .ss-gameview-nav { background:#222; } .ss-gameview-body { padding:12px; }
</style></head><body><div class="ss-gameview"><div class="ss-gameview-main">
<div class="ss-gameview-bar">Fight</div><div class="ss-gameview-hero">Party</div>
<div class="ss-gameview-body"><section id="board"></section></div><nav class="ss-gameview-nav"></nav>
</div></div><div id="safe" style="padding-bottom:env(safe-area-inset-bottom)"></div>
<script type="module">
import { STANDARD_TEMPLATES } from '/src/v2/lean-rpg/templates.js';
import { STANDARD_FORMULA } from '/src/v2/lean-rpg/rules.js';
import { createBoardView } from '/src/v2/lean-rpg/board/view.js';
import { boardSession, discardBoard, openBoard } from '/src/v2/lean-rpg/board/session.js';
import { playBoard } from '/src/v2/lean-rpg/board/engine.js';
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
    const action = [{ who:'Astra', kind:'attack', target:1 }];
    const played = playBoard(state, boardSession(meta).setup, [{ actions:action }, { actions:action }]);
    if (!played.error && played.result.stop === 'open') { ready = true; break; }
    discardBoard(meta);
}
if (!ready) throw new Error('No open two-exchange fight');
const id = boardSession(meta).id;
const lines = Array.from({ length:35 }, (_, n) => ({ n:n+1, lines:[{ kind:'act', pc:{ who:'Astra', die:12, total:18 }, foe:{ name:'Rats', total:10 }, outcome:'success' }] }));
receipts.push({ receipt:{ data:{ v2:{ result:{ board:{ id }, rounds:lines } } } } });
const node = document.querySelector('#board'), handles = [];
const view = createBoardView({ doc:document, headState:() => state, meta:() => meta, store, rules:() => ({ ...STANDARD_FORMULA, levelDivisor:5 }),
    query:() => null, readerName:() => 'Astra', roleOf:definition => definition.role, levels:() => ({ ranks:[], playerRank:null }), on:() => true });
function draw() { for (const handle of handles.splice(0)) handle.destroy?.(); view.clear(); node.replaceChildren(); node.classList.remove('rpg-board-active');
    const snapshot = view.snapshot(state); if (snapshot) view.render(node, snapshot, draw, handles, {}); else view.offer(node, draw); }
draw();
window.boardTest = { count:() => boardSession(meta)?.exchanges.length ?? 0 };
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

for (const viewport of [{ width:390, height:844 }, { width:360, height:740 }]) {
    test(`phone touch layout and gestures at ${viewport.width}×${viewport.height}`, async t => {
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
        const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true, deviceScaleFactor:1 });
        t.after(() => context.close());
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${web.address().port}/`);
        await page.waitForSelector('[data-ready="yes"]');
        const metrics = await page.evaluate(() => {
            const choice = document.querySelector('.rpg-board-choice'), list = document.querySelector('.rpg-board-choices');
            const log = document.querySelector('.rpg-board-log'), status = document.querySelector('.rpg-board-status');
            const controls = document.querySelector('.rpg-board-controls'), discard = document.querySelector('.rpg-board-discard');
            const box = element => { const r = element.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
            const zoom = choice.getBoundingClientRect().width / choice.offsetWidth;
            return { choice:box(choice), choices:[...list.querySelectorAll('button')].map(box), list:box(list), log:box(log), status:box(status), controls:box(controls), discard:box(discard),
                choiceFont:parseFloat(getComputedStyle(choice).fontSize)*zoom, logFont:parseFloat(getComputedStyle(log).fontSize)*zoom,
                touch:getComputedStyle(choice).touchAction, padding:parseFloat(getComputedStyle(controls).paddingBottom)*zoom,
                safe:parseFloat(getComputedStyle(document.querySelector('#safe')).paddingBottom),
                scroll:log.scrollHeight > log.clientHeight, newest:Math.abs(log.scrollHeight-log.clientHeight-log.scrollTop) < 2,
                overflow:document.documentElement.scrollWidth > innerWidth || document.querySelector('.ss-gameview-body').scrollWidth > document.querySelector('.ss-gameview-body').clientWidth };
        });
        assert.ok(metrics.choices.every(choice => choice.height >= 47.5 && Math.abs(choice.width - metrics.list.width) < 2));
        assert.ok(metrics.discard.height >= 43.5 && metrics.discard.width >= 43.5);
        assert.ok(metrics.choiceFont >= 14.8 && metrics.logFont >= 12.8);
        assert.equal(metrics.touch, 'manipulation');
        assert.ok(metrics.status.bottom <= metrics.log.top && metrics.log.bottom <= metrics.controls.top);
        assert.ok(metrics.controls.bottom <= viewport.height && metrics.controls.bottom > viewport.height / 2);
        assert.ok(metrics.padding + 0.5 >= metrics.safe);
        assert.ok(metrics.scroll && metrics.newest);
        assert.equal(metrics.overflow, false);
        await page.locator('.rpg-board-log').evaluate(log => { log.scrollTop = 0; });
        assert.equal(await page.locator('.rpg-board-log').evaluate(log => log.scrollTop), 0);
        await page.locator('[data-choice="1"]').tap();
        assert.match(await page.locator('.rpg-board-prompt').innerText(), /Choose a target/);
        const back = page.locator('.rpg-board-back'), backBox = await back.boundingBox();
        assert.ok(backBox.width >= 43.5 && backBox.height >= 43.5);
        await back.tap();
        await page.locator('[data-choice="1"]').tap();
        const target = await page.locator('[data-choice="1"]').boundingBox();
        await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
        await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
        assert.equal(await page.evaluate(() => window.boardTest.count()), 1, 'a double tap stages one exchange');
        assert.match(await page.locator('.rpg-board-log').innerText(), /Exchange 1/);
        assert.equal(await page.locator('.rpg-board-log').evaluate(log => Math.abs(log.scrollHeight-log.clientHeight-log.scrollTop) < 2), true);
        await page.waitForTimeout(600);
        await page.locator('[data-choice="1"]').tap();
        await page.locator('[data-choice="1"]').tap();
        assert.equal(await page.evaluate(() => window.boardTest.count()), 2, 'a later intentional choice stages another exchange');
        await page.locator('.rpg-board-discard').tap();
        assert.match(await page.locator('.rpg-board-controls').innerText(), /Discard this fight and its unsent exchanges/);
        await page.getByRole('button', { name:'Cancel' }).tap();
        assert.equal(await page.evaluate(() => window.boardTest.count()), 2);
        await page.locator('.rpg-board-discard').tap();
        await page.locator('.rpg-board-confirm').tap();
        assert.equal(await page.evaluate(() => window.boardTest.count()), 0);
    });
}
