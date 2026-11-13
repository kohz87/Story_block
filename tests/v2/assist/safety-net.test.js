// The Assist safety net on the real host (MODULES §F123): a send waits for it only briefly; lines that
// arrive after the reader sent are kept on that reply (<Changes-assist-next>) and applied on the next reply
// right after its own lines, marked "late", through the stricter wall (never coin, never a new item); the
// stored lines are what Re-read and a swipe of the next reply use, with no new model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTING } from '../../../src/v2/assist/index.js';
import { assistSections, withAssist } from '../../../src/v2/capture.js';
import { ASSIST_WAIT_MS } from '../../../src/v2/turn.js';
import { createHost, hostAvailable } from '../../../testkit/index.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A model whose first answer waits until `release()`; later answers are 'none'.
function heldModel(answer) {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const calls = [];
    const model = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) {
            await held;
            return answer;
        }
        return 'none';
    };
    return { model, calls, release: () => release() };
}

async function hostWith(model) {
    const host = await createHost({ callModel: model, settings: { modules: { 'story-block': { [SETTING.extractor]: true } } } });
    host.features?.set?.('story-block.extractor', true);
    return host;
}

test('a send waits only briefly; late lines are kept on the reply and applied on the next one, marked, without coin or new items', { skip }, async () => {
    const { model, calls, release } = heldModel('~ place Old Mill | kind: settlement\n- item Coins | qty: 30\n+ present Elula\n~ wound Mira — bitten | harm: scratch');
    const host = await hostWith(model);
    const first = await host.send('I walk on.', 'You walk to the old mill. Elula waits at her counter.');
    await wait(5);
    assert.equal(calls.length, 1, 'the safety net is reading the first reply');
    // The second send: the interceptor waits at most ASSIST_WAIT_MS, then the reply goes on; the answer
    // arrives while it is being written.
    const intercept = host.st.interceptor;
    let waited = 0;
    host.st.interceptor = async (...args) => {
        const started = performance.now();
        await intercept(...args);
        waited = performance.now() - started;
        release();
        await wait(20);
    };
    const second = await host.send('I greet her.', 'She nods; Fenna comes in.\n<Changes>\n+ present Fenna\n</Changes>');
    host.st.interceptor = intercept;
    assert.ok(waited >= ASSIST_WAIT_MS - 50 && waited < ASSIST_WAIT_MS + 1500, `waited ${waited} ms`);
    const stored = assistSections(host.ctx.chat[first.index].mes);
    assert.deepEqual(stored.now, []);
    assert.ok(stored.next.includes('~ place Old Mill | kind: settlement'), 'kept on the reply it was read from');
    assert.ok(!stored.next.some(line => /Coins/.test(line)), 'no coin after send, even as an item');
    // Applied on the second reply, after its own line, marked late.
    const record = host.ctx.chat[second.index].extra.storySuite;
    const late = record.receipts.filter(receipt => receipt.assist === 'late');
    assert.ok(late.length >= 2, JSON.stringify(record.receipts.map(receipt => [receipt.type, receipt.assist])));
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    const ownAt = record.receipts.findIndex(receipt => receipt.cause === 'story' && receipt.assist === undefined);
    const lateAt = record.receipts.findIndex(receipt => receipt.assist === 'late');
    assert.ok(ownAt < lateAt || ownAt < 0, 'after the reply\'s own lines');
    // Re-read of the second reply uses the stored lines: same place, no new call.
    const callsNow = calls.length;
    const again = await host.sdk.reread(second.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(calls.length, callsNow);
    assert.ok(again.receipts.some(receipt => receipt.assist === 'late'));
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    // A swipe of the second reply applies them again from what is stored.
    await host.swipe('She only smiles.');
    await wait(20);
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    host.close();
});

test('an answer within the brief wait is applied on the reply it read, before the next prompt is built', { skip }, async () => {
    const { model, release } = heldModel('~ place Old Mill');
    const host = await hostWith(model);
    const first = await host.send('I walk on.', 'You walk to the old mill.');
    setTimeout(release, 100);
    await host.send('I look around.', 'Dusty sacks.');
    const receipts = host.ctx.chat[first.index].extra.storySuite.receipts;
    assert.ok(receipts.some(receipt => receipt.assist === 'now'), 'applied on the first reply');
    assert.deepEqual(assistSections(host.ctx.chat[first.index].mes).now, ['~ place Old Mill']);
    host.close();
});

test('a line the block already has is never applied twice (C-1 matching, and the same op, kind and name)', { skip }, async () => {
    const model = async () => '~ place Old Mill | kind: settlement\n+ present Elula';
    const host = await hostWith(model);
    const turn = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    await host.send('I walk on.', 'You reach the old mill; Elula is there.\n<Changes>\n~ place Old Mill\n</Changes>');
    const late = await turn;
    assert.deepEqual(late.receipts.map(receipt => receipt.assistLine), ['+ present Elula']);
    host.close();
});

// The USER's reply (4 Nov): the block set the place and who is present; the safety net wrote the same place in
// other words. Applied after the block, it read as a move and left everyone behind (present emptied).
const BLUEWATCH = 'Osken pays out at the desk; Nelje takes the pork. Kettle-Maw Tam joins them.\n<Changes>\n~ place Bluewatch — Guild Office | kind: settlement\n- present Osken\n+ present Nelje\n~ time CY611, Goldwane 12, 5:30 pm\n! time +2h 30m\n</Changes>';

test('a place or time the block set is never set again by the safety net (another wording of the place is not a move); a kind it left out still is', { skip }, async () => {
    let calls = 0;
    const model = async () => (++calls === 2 ? '~ place Bluewatch Village / Guild Office\n! time +1h\n~ weather rain\n+ present Kettle-Maw Tam' : 'none');
    const host = await hostWith(model);
    await host.send('I go to the desk.', 'Osken waits at the guild desk.\n<Changes>\n~ place Bluewatch — Guild Office\n+ present Osken\n</Changes>');
    const turn = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    await host.send('I collect the pay.', BLUEWATCH);
    const late = await turn;
    // The place and the clock the block set stay; the weather it left out and a new person are used.
    assert.deepEqual(late.receipts.map(receipt => receipt.assistLine), ['~ weather rain', '+ present Kettle-Maw Tam']);
    assert.equal(host.sdk.query('scene.place').name, 'Bluewatch');
    assert.deepEqual(host.sdk.query('scene.present').sort(), ['Kettle-Maw Tam', 'Nelje']);
    host.close();
});

test('Re-read of a reply that stored a reworded place from the safety net keeps who the block made present', { skip }, async () => {
    const host = await hostWith(async () => 'none');
    await host.send('I go to the desk.', 'Osken waits at the guild desk.\n<Changes>\n~ place Bluewatch — Guild Office\n+ present Osken\n</Changes>');
    const reply = await host.send('I collect the pay.', BLUEWATCH);
    // As saved by an earlier version: the safety net's reworded place kept in the reply's <Changes-assist>.
    const message = host.ctx.chat[reply.index];
    message.mes = withAssist(message.mes, ['~ place Bluewatch Village / Guild Office']);
    if (Array.isArray(message.swipes)) message.swipes[message.swipe_id ?? 0] = message.mes;
    const again = await host.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.ok(!again.receipts.some(receipt => receipt.assist === 'now'), 'the stored place line is not used');
    assert.equal(host.sdk.query('scene.place').name, 'Bluewatch');
    assert.deepEqual(host.sdk.query('scene.present'), ['Nelje']);
    host.close();
});

test('a late place from the reply before never holds back the next reply\'s own safety-net place (the newer one wins)', { skip }, async () => {
    const { model: held, release } = heldModel('~ place Market | kind: settlement');
    let calls = 0;
    const model = async prompt => (++calls === 1 ? held(prompt) : '~ place Tavern | kind: settlement');
    const host = await hostWith(model);
    await host.send('I go.', 'You head to the market.');
    await wait(5);
    const intercept = host.st.interceptor;
    host.st.interceptor = async (...args) => { await intercept(...args); release(); await wait(20); };
    const second = await host.send('I go on.', 'You step into the tavern.');
    host.st.interceptor = intercept;
    await wait(300);
    // The reply before's late place is applied first, then this reply's own safety-net place, which is newer.
    assert.deepEqual(assistSections(host.ctx.chat[second.index].mes).now, ['~ place Tavern | kind: settlement']);
    assert.equal(host.sdk.query('scene.place').name, 'Tavern');
    host.close();
});

test('a preset\'s ^ block: the safety net reads its lines the way the reply was captured, so live and Re-read end in the same scene', { skip }, async () => {
    let calls = 0;
    const model = async () => (++calls === 2 ? '~ place Old Market | kind: settlement\n~ weather rain' : 'none');
    const host = await hostWith(model);
    await host.send('I go.', 'You set out.');
    const turn = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    const reply = await host.send('I arrive.', 'You reach the market.\n<Changes>\n^~ ^place ^Market ^| ^kind: ^settlement\n</Changes>');
    const late = await turn;
    assert.deepEqual(late.receipts.map(receipt => receipt.assistLine), ['~ weather rain'], 'the place the block set is not set again');
    assert.equal(host.sdk.query('scene.place').name, 'Market');
    const live = JSON.stringify(host.sdk.query('scene.place'));
    const again = await host.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(JSON.stringify(host.sdk.query('scene.place')), live, 'Re-read: same place as live');
    host.close();
});

const WRONG_STOP = '~ place Bluewatch Outskirts | kind: wild | region: Bluewatch | with: Sister Temiwa';
const OFFICE_REPLY = 'You drive from Eastern Creek to Temiwa’s yard, sell meat in the village, and enter the Guild office. Sieke and the new clerk Dries greet you.\n<Changes>\n+ present Dries | at: Bluewatch Village / Guild Office\n~ time Goldwane 12, 5:30 pm\n~ chatter Sieke: Welcome back.\n~ chatter Sister Temiwa: We made it.\n~ chatter Dries: A visitor.\n</Changes>';

test('the creek to Guild reply refuses the intermediate stop and keeps all three people, including on the next reply and Re-read', { skip }, async () => {
    let calls = 0;
    const host = await hostWith(async () => (++calls === 1 ? 'none' : WRONG_STOP));
    await host.send('At the creek.', 'You wait by Eastern Creek.\n<Changes>\n~ place Bluewatch Outskirts / Eastern Creek | with: Sieke, Sister Temiwa\n</Changes>');
    let applied = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    const reply = await host.send('Return to the guild.', OFFICE_REPLY);
    let result = await applied;
    assert.equal(host.sdk.query('scene.place').name, 'Bluewatch Outskirts / Eastern Creek', 'the unsupported stop is not installed');
    assert.deepEqual(host.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
    assert.ok(result.problems.some(item => item.code === 'REFUSED' && /Dries/.test(item.message)), JSON.stringify(result.problems));
    assert.ok(!result.receipts.some(item => item.assistLine === WRONG_STOP));
    const again = await host.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(host.sdk.query('scene.place').name, 'Bluewatch Outskirts / Eastern Creek');
    assert.deepEqual(host.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
    applied = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    host.close();
});

test('the creek to Guild reply with the right destination moves there (Dries is already there, not in with:), keeps all three, and agrees on Re-read', { skip }, async () => {
    const right = '~ place Bluewatch Village / Guild Office | with: Sister Temiwa';
    let calls = 0;
    const host = await hostWith(async () => (++calls === 1 ? 'none' : right));
    await host.send('At the creek.', 'You wait by Eastern Creek.\n<Changes>\n~ place Bluewatch Outskirts / Eastern Creek | with: Sieke, Sister Temiwa\n</Changes>');
    const applied = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    const reply = await host.send('Return to the guild.', OFFICE_REPLY);
    await applied;
    assert.equal(host.sdk.query('scene.place').name, 'Bluewatch Village / Guild Office');
    assert.deepEqual(host.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
    const live = JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]);
    const again = await host.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]), live, 'Re-read: the same whole scene as live');
    host.close();
});

test('a sibling destination is refused, an alias of the right one is accepted', { skip }, async () => {
    for (const [line, place] of [['~ place Bluewatch Village / Market | with: Sister Temiwa', 'Bluewatch Outskirts / Eastern Creek'], ['~ place Bluewatch Village / Guild Office | with: Sister Temiwa', 'Bluewatch Village / Guild Office']]) {
        let calls = 0;
        const host = await hostWith(async () => (++calls === 1 ? 'none' : line));
        await host.send('At the creek.', 'You wait by Eastern Creek.\n<Changes>\n~ place Bluewatch Outskirts / Eastern Creek | with: Sieke, Sister Temiwa\n</Changes>');
        const applied = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
        await host.send('Return.', OFFICE_REPLY);
        await applied;
        assert.equal(host.sdk.query('scene.place').name, place, line);
        assert.deepEqual(host.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
        host.close();
    }
});

test('a Continue that adds an arrival does not undo a kept Assist move on Re-read (the decision made at capture stands)', { skip }, async () => {
    let calls = 0;
    const host = await hostWith(async () => (++calls === 2 ? '~ place Guild Office | with: Sister Temiwa' : 'none'));
    await host.send('At the creek.', 'Sieke and Temiwa are here.\n<Changes>\n~ place Creek | with: Sieke, Sister Temiwa\n</Changes>');
    const applied = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    const reply = await host.send('Go.', 'You reach the Guild office.');
    await applied;
    assert.equal(host.sdk.query('scene.place').name, 'Guild Office');
    const message = host.ctx.chat[reply.index];
    message.mes = message.mes.replace('You reach the Guild office.', 'You reach the Guild office. Dries waits.\n<Changes>\n+ present Dries | at: Market\n</Changes>');
    if (Array.isArray(message.swipes)) message.swipes[message.swipe_id ?? 0] = message.mes;
    const again = await host.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(host.sdk.query('scene.place').name, 'Guild Office', 'the move kept at capture is not refused later');
    host.close();
});

test('a departure inside the same Assist answer is not undone by its place line, now and late, and Re-read agrees', { skip }, async () => {
    const answer = '- present Watch\n~ place Guild Office | with: Sister Temiwa, Watch';
    const creek = 'Sieke and Watch are here.\n<Changes>\n~ place Creek | with: Sieke, Watch\n</Changes>';
    const settled = host => new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    // Now: the answer is read within the send.
    let calls = 0;
    const now = await hostWith(async () => (++calls === 2 ? answer : 'none'));
    await now.send('At the creek.', creek);
    const applied = settled(now);
    const reply = await now.send('Go.', 'You reach the Guild office with Temiwa.');
    await applied;
    assert.deepEqual(now.sdk.query('scene.present').sort(), ['Sieke', 'Sister Temiwa']);
    const again = await now.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.deepEqual(now.sdk.query('scene.present').sort(), ['Sieke', 'Sister Temiwa']);
    now.close();
    // Late: the answer arrives while the next reply is written and is applied after its lines.
    const held = heldModel(answer);
    let more = 0;
    const late = await hostWith(async prompt => (++more === 2 ? held.model(prompt) : 'none'));
    await late.send('At the creek.', creek);
    await late.send('Go.', 'You reach the Guild office with Temiwa.');
    await wait(5);
    const intercept = late.st.interceptor;
    late.st.interceptor = async (...args) => { await intercept(...args); held.release(); await wait(20); };
    const next = await late.send('Enter.', 'Dries arrives.\n<Changes>\n+ present Dries\n</Changes>');
    late.st.interceptor = intercept;
    assert.equal(late.sdk.query('scene.place').name, 'Guild Office');
    assert.deepEqual(late.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
    const reread = await late.sdk.reread(next.index);
    assert.equal(reread.ok, true, JSON.stringify(reread));
    assert.deepEqual(late.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
    late.close();
});

test('an old reply (carrying the earlier rule marks, not assistPlace) keeps the former move byte for byte on live and Re-read', { skip }, async () => {
    let calls = 0;
    const host = await hostWith(async () => (++calls === 2 ? '~ place Guild Office | with: Sister Temiwa' : 'none'));
    await host.send('At the creek.', 'Sieke and Temiwa are here.\n<Changes>\n~ place Creek | with: Sieke, Sister Temiwa\n</Changes>');
    const setter = host.store.setRuleMarks;
    host.store.setRuleMarks = (index, names) => setter(index, names.filter(name => name !== 'assistPlace'));
    const applied = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    const reply = await host.send('Go.', 'You arrive at the office.\n<Changes>\n+ present Dries | at: Market\n</Changes>');
    await applied;
    host.store.setRuleMarks = setter;
    const record = host.ctx.chat[reply.index].extra.storySuite;
    assert.ok(!record.rules?.includes('assistPlace'));
    const former = { place: 'Guild Office', present: ['Sister Temiwa'] };
    const state = () => ({ place: host.sdk.query('scene.place').name, present: host.sdk.query('scene.present') });
    assert.deepEqual(state(), former);
    const live = JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]);
    const again = await host.sdk.reread(reply.index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.deepEqual(state(), former);
    assert.equal(JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]), live, 'whole scene byte-identical');
    host.close();
});

// The 13 Nov reply: Gerrit serves stew on the way, but the story ends back at the Guild office.
const ERRAND_REPLY = 'You leave the Guild office for the tailor, the well and the smithy, then knock at Widow Merne’s door. At the Stray Oar, innkeeper Gerrit serves you stew. You check the baker’s board by the well.\n\nBack inside the Guild office, Sieke and Sister Temiwa settle at the desk.';
const SAME_VILLAGE = '~ place Bluewatch Village | kind: settlement | region: Bluewatch';
const AT_VILLAGE = 'Sieke and Sister Temiwa wait.\n<Changes>\n~ place Bluewatch Village | kind: settlement | region: Bluewatch | with: Sieke, Sister Temiwa\n</Changes>';
const settleTurn = host => new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));

test('a same-place safety-net answer cannot add someone met on the way; the final scene survives Re-read and reload', { skip }, async () => {
    let calls = 0;
    const host = await hostWith(async () => (++calls === 2 ? `${SAME_VILLAGE}\n+ present Gerrit` : 'none'));
    try {
        await host.send('At the guild.', AT_VILLAGE);
        const settled = settleTurn(host);
        const reply = await host.send('Run the errands.', ERRAND_REPLY);
        const result = await settled;
        assert.equal(host.sdk.query('scene.place').name, 'Bluewatch Village');
        assert.deepEqual(host.sdk.query('scene.present').sort(), ['Sieke', 'Sister Temiwa']);
        assert.ok(host.ctx.chat[reply.index].extra.storySuite.rules.includes('assistPresent'));
        assert.deepEqual(assistSections(host.ctx.chat[reply.index].mes).now, [SAME_VILLAGE]);
        assert.ok(result.problems.some(item => item.line === '+ present Gerrit' && item.code === 'REFUSED' && /Gerrit.*not named in the reply's last paragraph/.test(item.message)));
        const scene = JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]);
        assert.equal((await host.sdk.reread(reply.index)).ok, true);
        assert.equal(JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]), scene);
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]), scene);
    } finally { host.close(); }
});

test('the guard keeps final-paragraph arrivals, departures, new moves and answers with no place line', { skip }, async () => {
    const cases = [
        { answer: `+ present Gerrit\n- present Sieke\n${SAME_VILLAGE}`, story: `${ERRAND_REPLY} GERRIT's bowl is on the desk.`, present: ['Gerrit', 'Sister Temiwa'], place: 'Bluewatch Village' },
        { answer: '+ present Gerrit\n~ place Guild Office', story: ERRAND_REPLY, present: ['Gerrit', 'Sieke', 'Sister Temiwa'], place: 'Guild Office' },
        { answer: '+ present Gerrit', story: ERRAND_REPLY, present: ['Gerrit', 'Sieke', 'Sister Temiwa'], place: 'Bluewatch Village' },
    ];
    for (const sample of cases) {
        let calls = 0;
        const host = await hostWith(async () => (++calls === 2 ? sample.answer : 'none'));
        try {
            await host.send('At the guild.', AT_VILLAGE);
            const settled = settleTurn(host);
            const reply = await host.send('Go.', sample.story);
            const result = await settled;
            assert.deepEqual(host.sdk.query('scene.present').sort(), sample.present, sample.answer);
            assert.equal(host.sdk.query('scene.place').name, sample.place);
            assert.ok(!result.problems.some(item => item.line === '+ present Gerrit' && item.code === 'REFUSED'));
            assert.equal((await host.sdk.reread(reply.index)).ok, true);
            assert.deepEqual(host.sdk.query('scene.present').sort(), sample.present);
        } finally { host.close(); }
    }
});

test('whole names are checked in the last story paragraph, and a mixed arrival is refused as one line', { skip }, async () => {
    let calls = 0;
    const host = await hostWith(async () => (++calls === 2 ? `+ present Gerrit, Sister Temiwa\n${SAME_VILLAGE}` : 'none'));
    try {
        await host.send('At the guild.', AT_VILLAGE);
        const settled = settleTurn(host);
        const reply = await host.send('Return.', `${ERRAND_REPLY} Gerritson waits.\n<think>Gerrit is here.</think>\n<Changes>\n~ weather clear\n</Changes>`);
        const result = await settled;
        assert.ok(result.problems.some(item => item.line === '+ present Gerrit, Sister Temiwa' && /Gerrit is not named/.test(item.message)));
        assert.deepEqual(host.sdk.query('scene.present').sort(), ['Sieke', 'Sister Temiwa']);
        assert.ok(!assistSections(host.ctx.chat[reply.index].mes).now.some(line => line.startsWith('+ present')));
    } finally { host.close(); }
});

test('a duplicate safety-net place removed before capture still guards an arrival', { skip }, async () => {
    let calls = 0;
    const host = await hostWith(async () => (++calls === 2 ? `${SAME_VILLAGE}\n+ present Gerrit\n~ weather rain` : 'none'));
    try {
        await host.send('At the guild.', AT_VILLAGE);
        const settled = settleTurn(host);
        const reply = await host.send('Return.', `${ERRAND_REPLY}\n<Changes>\n${SAME_VILLAGE}\n</Changes>`);
        const result = await settled;
        assert.ok(result.problems.some(item => item.line === '+ present Gerrit' && item.code === 'REFUSED'));
        assert.deepEqual(assistSections(host.ctx.chat[reply.index].mes).now, ['~ weather rain']);
        assert.deepEqual(host.sdk.query('scene.present').sort(), ['Sieke', 'Sister Temiwa']);
    } finally { host.close(); }
});

test('an arrival is refused when the safety-net place conflicts with the reply or the place handler rejects it', { skip }, async () => {
    for (const place of ['~ place Bluewatch Outskirts', `~ place Guild Office | kind: ${'x'.repeat(81)}`]) {
        let calls = 0;
        const host = await hostWith(async () => (++calls === 2 ? `+ present Gerrit\n${place}` : 'none'));
        try {
            await host.send('At the guild.', AT_VILLAGE);
            const settled = settleTurn(host);
            const reply = await host.send('Return.', `${ERRAND_REPLY}\n<Changes>\n+ present Dries | at: Guild Office\n</Changes>`);
            const result = await settled;
            assert.ok(result.problems.some(item => item.line === '+ present Gerrit' && item.code === 'REFUSED'), place);
            assert.ok(result.problems.some(item => item.line === place), place);
            assert.deepEqual(host.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
            assert.ok(!assistSections(host.ctx.chat[reply.index].mes).now.includes('+ present Gerrit'));
            assert.equal((await host.sdk.reread(reply.index)).ok, true);
            assert.deepEqual(host.sdk.query('scene.present').sort(), ['Dries', 'Sieke', 'Sister Temiwa']);
        } finally { host.close(); }
    }
});

test('a deferred same-place answer checks the source reply before storing lines for the next reply', { skip }, async () => {
    const held = heldModel(`+ present Gerrit\n${SAME_VILLAGE}`);
    let calls = 0;
    const host = await hostWith(async prompt => (++calls === 2 ? held.model(prompt) : 'none'));
    try {
        await host.send('At the guild.', AT_VILLAGE);
        const source = await host.send('Run the errands.', ERRAND_REPLY);
        await wait(5);
        const intercept = host.st.interceptor;
        host.st.interceptor = async (...args) => { await intercept(...args); held.release(); await wait(20); };
        const next = await host.send('Enter.', 'Gerrit is only mentioned in this later reply.');
        host.st.interceptor = intercept;
        assert.deepEqual(assistSections(host.ctx.chat[source.index].mes).next, [SAME_VILLAGE]);
        assert.ok(host.turn.problems().some(item => item.index === source.index && item.line === '+ present Gerrit' && item.code === 'REFUSED'));
        assert.deepEqual(host.sdk.query('scene.present').sort(), ['Sieke', 'Sister Temiwa']);
        assert.equal((await host.sdk.reread(next.index)).ok, true);
        assert.deepEqual(host.sdk.query('scene.present').sort(), ['Sieke', 'Sister Temiwa']);
    } finally { host.close(); }
});

test('a reply without assistPresent keeps its earlier safety-net arrival through Re-read and reload', { skip }, async () => {
    let calls = 0;
    const host = await hostWith(async () => (++calls === 2 ? `${SAME_VILLAGE}\n+ present Gerrit` : 'none'));
    try {
        await host.send('At the guild.', AT_VILLAGE);
        const setter = host.store.setRuleMarks;
        host.store.setRuleMarks = (index, names) => setter(index, names.filter(name => name !== 'assistPresent'));
        const settled = settleTurn(host);
        const reply = await host.send('Run the errands.', ERRAND_REPLY);
        await settled;
        host.store.setRuleMarks = setter;
        assert.ok(!host.ctx.chat[reply.index].extra.storySuite.rules.includes('assistPresent'));
        assert.deepEqual(host.sdk.query('scene.present').sort(), ['Gerrit', 'Sieke', 'Sister Temiwa']);
        assert.ok(assistSections(host.ctx.chat[reply.index].mes).now.includes('+ present Gerrit'));
        const scene = JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]);
        assert.equal((await host.sdk.reread(reply.index)).ok, true);
        assert.equal(JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]), scene);
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify([host.sdk.query('scene.place'), host.sdk.query('scene.present')]), scene);
    } finally { host.close(); }
});
