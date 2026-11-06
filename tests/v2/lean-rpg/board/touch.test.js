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
<link rel="stylesheet" href="/src/v2/view/host.css"><link rel="stylesheet" href="/src/v2/view/mounts.css"><link rel="stylesheet" href="/src/v2/view/glass.css"><link rel="stylesheet" href="/src/v2/view/size.css">
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
window.boardTest = { count:() => boardSession(meta)?.exchanges.length ?? 0, configure:({ skills = 2, rounds = 0, wrap = false } = {}) => {
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

for (const viewport of [{ width:390, height:844 }, { width:360, height:740 }]) for (const frame of ['game', 'panel']) {
    test(`${frame} phone touch layout and gestures at ${viewport.width}×${viewport.height}`, async t => {
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
        await page.goto(`http://127.0.0.1:${web.address().port}/${frame === 'panel' ? '?panel' : ''}`);
        await page.waitForSelector('[data-ready="yes"]', { state: 'attached' });
        await page.waitForFunction(() => document.querySelector('.rpg-board-cards').style.getPropertyValue('--rpg-card-row-height'));
        if (frame === 'game') {
            const hero = page.locator('.ss-gameview-hero .ss-hero'), more = page.locator('.ss-hero-board-more');
            assert.equal(await hero.evaluate(el => el.classList.contains('ss-hero-compact')), true);
            assert.equal(await page.locator('.ss-hero-you').evaluate(el => getComputedStyle(el).display), 'none');
            assert.notEqual(await page.locator('.ss-hero-corner-item[data-kind="place"]').evaluate(el => getComputedStyle(el).display), 'none');
            assert.equal(await page.locator('.ss-hero-corner-item[data-kind="place"] .ss-hero-corner-text').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
            await more.tap();
            assert.equal(await more.getAttribute('aria-expanded'), 'true');
            assert.equal(await hero.evaluate(el => el.classList.contains('ss-hero-compact')), false);
            assert.notEqual(await page.locator('.ss-hero-you').evaluate(el => getComputedStyle(el).display), 'none');
            await more.tap();
            assert.equal(await more.getAttribute('aria-expanded'), 'false');
        }
        const revealControls = () => page.evaluate(() => {
            const body = document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-body') ?? document.querySelector('.ss-gameview-body');
            body.scrollTop = body.scrollHeight;
        });
        const configure = async options => {
            await page.evaluate(options => window.boardTest.configure(options), options);
            await page.waitForFunction(() => document.querySelector('.rpg-board-log').style.getPropertyValue('--rpg-log-content-height') &&
                document.querySelector('.rpg-board-choices').style.getPropertyValue('--rpg-choice-limit'));
            await revealControls();
        };
        const fit = () => page.evaluate(() => {
            const list = document.querySelector('.rpg-board-choices'), log = document.querySelector('.rpg-board-log');
            const controls = document.querySelector('.rpg-board-controls'), note = controls.querySelector('.rpg-board-note');
            const bar = document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-bar') ?? document.querySelector('.ss-gameview-nav');
            const body = document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-body') ?? document.querySelector('.ss-gameview-body');
            const box = node => { const r = node.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, height:r.height }; };
            const zoom = list.getBoundingClientRect().width / list.offsetWidth;
            const logStyle = getComputedStyle(log), controlStyle = getComputedStyle(controls);
            const logEdges = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + parseFloat(logStyle[key]), 0) * zoom;
            const controlEdges = (parseFloat(controlStyle.paddingBottom) + parseFloat(controlStyle.borderBottomWidth)) * zoom;
            return { rows:[...list.children].map(box), list:box(list), log:box(log), logContent:box(log.firstElementChild), logEdges,
                logScroll:log.scrollHeight > log.clientHeight + 1, newest:Math.abs(log.scrollHeight-log.clientHeight-log.scrollTop) < 2,
                listScroll:list.scrollHeight > list.clientHeight + 1, note:box(note), controls:box(controls), controlEdges, bar:box(bar), body:box(body) };
        });
        for (const skills of [0, 1, 2, 3, 4]) {
            await configure({ skills, rounds:0 });
            const current = await fit(), visible = current.rows.slice(0, 5);
            assert.equal(current.rows.length, skills + 2);
            assert.ok(visible.every(row => row.height >= 47.5 && row.top >= current.list.top - 1 && row.bottom <= current.list.bottom + 1), 'the first five choices are whole');
            assert.equal(current.listScroll, current.rows.length > 5, 'only choices after the fifth scroll');
            assert.ok(current.list.top >= current.body.top - 1 && current.note.bottom <= current.bar.top + 1, 'the choices and actions fit above the floating bar');
            assert.ok(Math.abs(current.controls.bottom - current.note.bottom - current.controlEdges) < 2, 'the controls do not grow empty space under the note');
            assert.ok(current.log.height < 140 && Math.abs(current.log.height - current.logContent.height - current.logEdges) < 3, 'the empty log is content-sized');
            if (skills === 4) {
                await page.locator('.rpg-board-choices').evaluate(list => { list.scrollTop = list.scrollHeight; });
                const lastVisible = await page.locator('.rpg-board-choices').evaluate(list => {
                    const last = list.lastElementChild.getBoundingClientRect(), box = list.getBoundingClientRect();
                    return last.top >= box.top - 1 && last.bottom <= box.bottom + 1;
                });
                assert.ok(lastVisible, 'choices after the fifth remain reachable');
            }
        }
        await configure({ skills:3, rounds:0, wrap:true });
        const wrapped = await fit();
        assert.ok(wrapped.rows.some(row => row.height > 50), 'the fixture contains a wrapped choice');
        assert.ok(!wrapped.listScroll && wrapped.rows.every(row => row.bottom <= wrapped.list.bottom + 1), 'five choices remain whole when a label wraps');
        await configure({ skills:2, rounds:1 });
        const shortLog = await fit();
        assert.ok(shortLog.log.height < 140 && !shortLog.logScroll && Math.abs(shortLog.log.height - shortLog.logContent.height - shortLog.logEdges) < 3, 'a short exchange log is content-sized');
        await configure({ skills:2, rounds:35 });
        const longLog = await fit();
        assert.ok(longLog.log.height >= 139.5, 'a long log keeps its screen-pixel minimum');
        assert.ok(longLog.logScroll, 'a long log scrolls within the available space');
        assert.ok(longLog.newest, 'a long log shows the newest exchange');
        await page.locator('.rpg-board-log').evaluate(log => { log.scrollTop = 0; });
        await page.locator('.rpg-board-note summary').tap();
        await revealControls();
        const expanded = await fit();
        assert.ok(Math.abs(expanded.controls.bottom - expanded.note.bottom - expanded.controlEdges) < 2, 'the expanded narrator note has no empty controls space below it');
        assert.equal(await page.locator('.rpg-board-log').evaluate(log => log.scrollTop), 0, 'resizing the log does not pull a reader away from older exchanges');
        await page.locator('.rpg-board-log').evaluate(log => { log.scrollTop = log.scrollHeight; });
        await page.locator('.rpg-board-note summary').tap();
        await revealControls();
        const metrics = await page.evaluate(() => {
            const choice = document.querySelector('.rpg-board-choice'), list = document.querySelector('.rpg-board-choices');
            const log = document.querySelector('.rpg-board-log'), status = document.querySelector('.rpg-board-status');
            const controls = document.querySelector('.rpg-board-controls'), discard = document.querySelector('.rpg-board-discard');
            const note = controls.querySelector('.rpg-board-note summary');
            const box = element => { const r = element.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
            const zoom = choice.getBoundingClientRect().width / choice.offsetWidth;
            const cards = document.querySelector('.rpg-board-cards');
            return { choice:box(choice), choices:[...list.querySelectorAll('button')].map(box), list:box(list), log:box(log), status:box(status), controls:box(controls), discard:box(discard), note:box(note),
                listScroll:list.scrollHeight > list.clientHeight,
                cards:box(cards), firstCard:box(cards.firstElementChild), cardsScroll:cards.scrollHeight > cards.clientHeight,
                logFamily:getComputedStyle(log).fontFamily, lineFamily:getComputedStyle(log.querySelector('p')).fontFamily, bodyFamily:getComputedStyle(controls).fontFamily,
                choiceFont:parseFloat(getComputedStyle(choice).fontSize)*zoom, logFont:parseFloat(getComputedStyle(log).fontSize)*zoom,
                touch:getComputedStyle(choice).touchAction, padding:parseFloat(getComputedStyle(controls).paddingBottom)*zoom,
                safe:parseFloat(getComputedStyle(document.querySelector('#safe')).paddingBottom),
                scroll:log.scrollHeight > log.clientHeight, newest:Math.abs(log.scrollHeight-log.clientHeight-log.scrollTop) < 2,
                overflow:document.documentElement.scrollWidth > innerWidth || (document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-body') ?? document.querySelector('.ss-gameview-body')).scrollWidth > (document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-body') ?? document.querySelector('.ss-gameview-body')).clientWidth,
                bar:box(document.querySelector('.story-suite-sheet:not([hidden]) .story-suite-sheet-bar') ?? document.querySelector('.ss-gameview-nav')) };
        });
        assert.ok(metrics.choices.every(choice => choice.height >= 47.5 && Math.abs(choice.width - metrics.list.width) < 2));
        assert.ok(metrics.discard.height >= 47.5 && metrics.discard.width >= 47.5);
        assert.ok(metrics.choiceFont >= 14.8 && metrics.logFont >= 12.8);
        assert.ok(metrics.log.height >= 139.5, 'the long live log keeps its screen-pixel minimum');
        assert.match(metrics.logFamily, /Arial/i);
        assert.equal(metrics.lineFamily, metrics.logFamily);
        assert.equal(metrics.logFamily, metrics.bodyFamily);
        assert.ok(metrics.firstCard.top >= metrics.cards.top - 1 && metrics.firstCard.bottom <= metrics.cards.bottom + 1, 'the first card row is whole');
        assert.ok(metrics.cardsScroll, 'additional cards scroll within their own area');
        assert.equal(metrics.touch, 'manipulation');
        assert.ok(metrics.status.bottom <= metrics.log.top && metrics.log.bottom <= metrics.controls.top);
        assert.ok(metrics.controls.bottom <= viewport.height && metrics.controls.bottom > viewport.height / 2);
        assert.ok(metrics.controls.bottom <= metrics.bar.top + 1, 'choices and actions stay above the bottom bar');
        assert.ok(metrics.choice.top >= metrics.list.top - 1 && metrics.choice.bottom <= metrics.list.bottom + 1, 'the first choice fits in its scroller');
        assert.ok(metrics.list.bottom <= metrics.controls.bottom + 1 && metrics.discard.bottom <= metrics.controls.bottom + 1 && metrics.note.bottom <= metrics.controls.bottom + 1, 'the choice list, action and note fit inside the controls');
        assert.equal(metrics.listScroll, false, 'four choices do not scroll');
        assert.ok(metrics.padding + 0.5 >= metrics.safe);
        assert.ok(metrics.scroll && metrics.newest);
        assert.equal(metrics.overflow, false);
        await page.locator('.rpg-board-cards').evaluate(cards => { cards.scrollTop = cards.scrollHeight; });
        await page.waitForFunction(() => {
            const cards = document.querySelector('.rpg-board-cards'), last = cards.lastElementChild.getBoundingClientRect(), box = cards.getBoundingClientRect();
            return last.top >= box.top - 1 && last.bottom <= box.bottom + 1;
        });
        await page.locator('.rpg-board-cards').evaluate(cards => { cards.scrollTop = 0; });
        if (metrics.listScroll) {
            const scrolled = await page.locator('.rpg-board-choices').evaluate(list => {
                list.scrollTop = list.scrollHeight;
                const last = list.lastElementChild.getBoundingClientRect(), box = list.getBoundingClientRect();
                const visible = last.top >= box.top - 1 && last.bottom <= box.bottom + 1;
                list.scrollTop = 0;
                return visible;
            });
            assert.ok(scrolled, 'the last choice is reachable by scrolling');
        }
        await page.locator('.rpg-board-log').evaluate(log => { log.scrollTop = 0; });
        assert.equal(await page.locator('.rpg-board-log').evaluate(log => log.scrollTop), 0);
        await page.locator('[data-choice="1"]').tap();
        assert.match(await page.locator('.rpg-board-prompt').innerText(), /Choose a target/);
        const back = page.locator('.rpg-board-back'), backBox = await back.boundingBox();
        assert.ok(backBox.width >= 47.5 && backBox.height >= 47.5);
        const targetControls = await page.evaluate(() => {
            const controls = document.querySelector('.rpg-board-controls').getBoundingClientRect();
            return { bottom:controls.bottom, children:['.rpg-board-choices', '.rpg-board-back', '.rpg-board-discard', '.rpg-board-note summary']
                .map(selector => document.querySelector(selector).getBoundingClientRect().bottom) };
        });
        assert.ok(targetControls.bottom <= metrics.bar.top + 1 && targetControls.children.every(bottom => bottom <= targetControls.bottom + 1), 'targeting choices and actions stay above the bottom bar');
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
        if (frame === 'game') assert.equal(await page.locator('.ss-hero-board-more').evaluate(el => getComputedStyle(el).display), 'none');
        await page.evaluate(() => window.boardTest.end());
        const scroller = page.locator(frame === 'panel' ? '.story-suite-sheet-body' : '.ss-gameview-body');
        assert.equal(await page.locator('#board').evaluate(el => el.classList.contains('rpg-board-finished')), true);
        assert.equal(await scroller.evaluate(el => el.scrollHeight > el.clientHeight), true, 'the ended board scrolls as one page');
        assert.equal(await page.locator('.rpg-board-log').evaluate(el => getComputedStyle(el).overflowY), 'visible');
        assert.ok((await page.locator('.rpg-board-log').boundingBox()).height >= 139.5);
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
        for (const selector of ['.rpg-board-send', '.rpg-board-discard']) {
            const button = await page.locator(selector).boundingBox();
            assert.ok(button.height >= 47.5, `${selector} remains a 48px touch target`);
        }
    });
}
