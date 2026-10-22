// Choices and Inner chatter (MODULES §F115, src/v2/extras.js, src/v2/extras-ui.js): display kinds a reply
// may carry for the reader alone. Captured with hostile input (markup, overlong text, too many lines,
// invisible characters), each under its feature (off: no grammar line, a quiet Problem), never state;
// the Choices click fills SillyTavern's message box and sends nothing; Re-read, swipes, a middle delete
// and a fresh rebuild show the same; chatter reaches a later prompt only with the reader's setting; with
// and without NPC State Delta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { makeMessage } from '../ui-fake-dom.js';
import { setupDom } from './view/mounts/helpers.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { fillInput } from '../../src/v2/extras-ui.js';
import {
    CHATTER_CHARS, CHATTER_FEATURE, CHOICE_CHARS, CHOICES_FEATURE, cutPoints, displayLines, readChatter, readChoice,
} from '../../src/v2/extras.js';

const BOTH = { features: { [CHOICES_FEATURE]: true, [CHATTER_FEATURE]: true } };
const block = (story, lines) => `${story}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const REPLY = block('The wall rose above the yard. Minke watched the gate.', [
    '+ item Rope | qty: 1',
    '? choice Climb the wall',
    '? choice Bribe the guard',
    '~ chatter Minke: …he\'d better not die down there',
    '~ chatter Arn — *keep your head down, boy*',
]);
const lastIndex = host => host.ctx.chat.length - 1;
const extrasOf = (host, index = lastIndex(host)) => displayLines(host.ctx.chat[index].mes, { entryOf: word => host.registry.capture(word) });
// The static part as the last request carried it (the slots are emptied after each reply).
const staticText = host => host.st.requests.at(-1)?.chat?.[0]?.content ?? '';

async function fresh(t, settings = BOTH, modules = []) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings, modules });
    t.after(() => host.close());
    await host.send('Hello.', 'The road to the Watch Granary.');
    return host;
}

// ---------------------------------------------------------------------------------------------------
// Reading one line

test('a choice is text: markup stays text, invisible characters go, it is cut by code points', () => {
    assert.deepEqual(readChoice({ raw: '? choice <img src=x onerror=alert(1)> **now**' }).value, { text: '<img src=x onerror=alert(1)> now' });
    assert.deepEqual(readChoice({ raw: '- ? choice: Climb​ the‮ wall\n' }).value, { text: 'Climb the wall' });
    // A letter outside the BMP (a surrogate pair in UTF-16).
    const long = `? choice ${'𐐷'.repeat(200)}`;
    const text = readChoice({ raw: long }).value.text;
    assert.equal(Array.from(text).length, CHOICE_CHARS, 'at most the cap, in code points');
    assert.ok(text.endsWith('…'));
    assert.ok(Array.from(text).slice(0, -1).every(point => point === '𐐷'), 'no character split in half');
    assert.match(readChoice({ raw: '? choice ...' }).error, /no text/);
});

test('a chatter line is a name and a thought; no name or no thought is refused', () => {
    assert.deepEqual(readChatter({ raw: '~ chatter Minke: …he\'d better not die down there' }).value, { name: 'Minke', text: '…he\'d better not die down there' });
    assert.deepEqual(readChatter({ raw: '~ chatter Jean-Luc — *keep moving*' }).value, { name: 'Jean-Luc', text: 'keep moving' });
    assert.deepEqual(readChatter({ raw: '~ chatter **Old Tam**: <b>bold</b> thought' }).value, { name: 'Old Tam', text: '<b>bold</b> thought' });
    const long = readChatter({ raw: `~ chatter ${'N'.repeat(90)}: ${'x'.repeat(400)}` });
    assert.match(long.error ?? '', /names no one/, 'a "name" past the speaker window is no name');
    const cut = readChatter({ raw: `~ chatter Minke: ${'ж'.repeat(400)}` }).value;
    assert.equal(Array.from(cut.text).length, CHATTER_CHARS);
    assert.match(readChatter({ raw: '~ chatter just a thought with no speaker' }).error, /names no one/);
    assert.match(readChatter({ raw: '~ chatter Minke:' }).error, /no thought/);
    assert.equal(cutPoints('abc', 3), 'abc');
});

// ---------------------------------------------------------------------------------------------------
// Capture on the real host

test('on: both grammar lines are in the static part, which stays byte-identical reply to reply', async t => {
    const host = await fresh(t);
    await host.send('Look.', 'You look.');
    const first = staticText(host);
    assert.match(first, /^\? choice /m);
    assert.match(first, /^~ chatter /m);
    await host.send('I look.', REPLY);
    await host.send('Then?', block('Later.', ['? choice Run', '~ chatter Minke: hm']));
    assert.equal(staticText(host), first);
});

test('off (the default): no grammar line, and a line written anyway is a quiet Problem, not a refusal', async t => {
    const host = await fresh(t, null);
    assert.ok(staticText(host).includes('<Changes>'), 'the static part was sent');
    assert.equal(host.features.on(CHOICES_FEATURE), false);
    assert.equal(host.features.on(CHATTER_FEATURE), false);
    assert.doesNotMatch(staticText(host), /choice|chatter/);
    await host.send('I look.', REPLY);
    const index = lastIndex(host);
    const off = host.turn.problems().filter(item => item.index === index);
    assert.deepEqual(off.map(item => [item.code, item.quiet]), [['FEATURE_OFF', true], ['FEATURE_OFF', true], ['FEATURE_OFF', true], ['FEATURE_OFF', true]]);
    assert.match(off[0].message, /Choices is turned off/);
    assert.match(off[2].message, /Inner chatter is turned off/);
    assert.deepEqual(extrasOf(host), {}, 'nothing to show while off');
    // The rest of the reply was used, and the lines are hidden like any block.
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Rope')?.qty, 1);
    assert.doesNotMatch(host.ctx.chat[index].mes.replace(/<!--[\s\S]*?-->/g, ''), /choice|chatter/);
    // Turned on later, the reply's own lines show (read from its text; nothing was stored either way).
    host.features.set(CHOICES_FEATURE, true);
    assert.deepEqual(extrasOf(host).choice.map(item => item.text), ['Climb the wall', 'Bribe the guard']);
});

test('display lines change no state: no receipt, no op, no meta.rev for them', async t => {
    const host = await fresh(t);
    const rev = host.head().meta.rev;
    await host.send('I look.', block('Quiet.', ['? choice Wait', '? choice Leave', '~ chatter Minke: …dull']));
    const index = lastIndex(host);
    assert.equal(host.head().meta.rev, rev, 'meta.rev did not move');
    assert.deepEqual(host.store.opsAt(index), []);
    assert.equal(host.store.receipts().filter(receipt => /choice|chatter/.test(receipt.type)).length, 0);
    assert.deepEqual(host.turn.problems().filter(item => item.index === index), []);
    assert.deepEqual(extrasOf(host), { choice: [{ text: 'Wait' }, { text: 'Leave' }], chatter: [{ name: 'Minke', text: '…dull' }] });
});

test('hostile input: too many lines are Problems (first ones kept), markup and junk are refused or kept as text', async t => {
    const host = await fresh(t);
    const lines = [
        '? choice One', '? choice <script>alert(1)</script>', '? choice Three', '? choice Four', '? choice Five', '? choice Six',
        '~ chatter A: one', '~ chatter B: two', '~ chatter C: three', '~ chatter D: four',
        '~ chatter nobody speaks here', '? choice ***',
    ];
    await host.send('Go.', block('Chaos.', lines));
    const index = lastIndex(host);
    const told = host.turn.problems().filter(item => item.index === index);
    assert.deepEqual(told.map(item => [item.code, item.line]), [
        ['LIMITED', '? choice Five'], ['LIMITED', '? choice Six'], ['LIMITED', '~ chatter D: four'],
        ['INVALID', '~ chatter nobody speaks here'], ['INVALID', '? choice ***'],
    ]);
    assert.ok(told.every(item => item.quiet !== true), 'refusals are told on the card, not quietly');
    assert.match(told[0].message, /at most 4 choices/);
    const shown = extrasOf(host);
    assert.deepEqual(shown.choice.map(item => item.text), ['One', '<script>alert(1)</script>', 'Three', 'Four']);
    assert.deepEqual(shown.chatter.map(item => item.name), ['A', 'B', 'C']);
    // A line as long as the host reads (2,000 characters) is still cut to the cap for display.
    await host.send('More.', block('Long.', [`? choice ${'a'.repeat(1900)}`]));
    assert.equal(Array.from(extrasOf(host).choice[0].text).length, CHOICE_CHARS);
});

test('choices a Continue adds past the cap get the same "not applied" Problem as the original reply\'s', async t => {
    const host = await fresh(t);
    await host.send('Go.', block('The gate.', ['? choice One', '? choice Two', '? choice Three', '~ chatter A: one', '~ chatter B: two']));
    const index = lastIndex(host);
    assert.deepEqual(host.turn.problems().filter(item => item.index === index), []);
    await host.cont(`\n\nThe guard turns.\n\n${block('', ['? choice Four', '? choice Five', '? choice Six', '~ chatter C: three', '~ chatter D: four']).trim()}`);
    assert.equal(lastIndex(host), index, 'the same reply');
    const told = host.turn.problems().filter(item => item.index === index);
    assert.deepEqual(told.map(item => [item.code, item.line]), [['LIMITED', '? choice Five'], ['LIMITED', '? choice Six'], ['LIMITED', '~ chatter D: four']]);
    assert.match(told[0].message, /"\? choice Five" was not used: a reply shows at most 4 choices, and this one had more/);
    assert.ok(told.every(item => item.quiet !== true));
    // What the card shows agrees: the first four, in order; Re-read tells the same lines.
    assert.deepEqual(extrasOf(host).choice.map(item => item.text), ['One', 'Two', 'Three', 'Four']);
    assert.deepEqual(extrasOf(host).chatter.map(item => item.name), ['A', 'B', 'C']);
    const again = await host.turn.reread(index);
    assert.deepEqual((again?.problems ?? []).filter(item => item.code === 'LIMITED').map(item => item.line), ['? choice Five', '? choice Six', '~ chatter D: four']);
});

test('a Continue under the cap tells nothing', async t => {
    const host = await fresh(t);
    await host.send('Go.', block('The gate.', ['? choice One', '? choice Two']));
    const index = lastIndex(host);
    await host.cont(`\n\nThen.\n\n${block('', ['? choice Three', '? choice Four']).trim()}`);
    assert.deepEqual(host.turn.problems().filter(item => item.index === index), []);
    assert.deepEqual(extrasOf(host).choice.map(item => item.text), ['One', 'Two', 'Three', 'Four']);
});

test('a choice line written in the story near the block is taken and hidden like any change line', async t => {
    const host = await fresh(t);
    await host.send('Go.', 'The gate stood open.\n\n? choice Slip through the gate\n\n<Changes>\n? choice Wait for dusk\n</Changes>');
    const mes = host.ctx.chat[lastIndex(host)].mes;
    assert.doesNotMatch(mes.replace(/<!--[\s\S]*?-->/g, ''), /\? choice/);
    assert.deepEqual(extrasOf(host).choice.map(item => item.text), ['Wait for dusk', 'Slip through the gate']);
});

// ---------------------------------------------------------------------------------------------------
// Replay: Re-read, swipes, deletes, a reload

test('Re-read, swipes, a middle delete and a rebuild show the same choices and chatter', async t => {
    const host = await fresh(t);
    await host.send('I look.', REPLY);
    const at = lastIndex(host);
    const before = extrasOf(host, at);
    assert.equal(before.choice.length, 2);
    assert.equal(before.chatter.length, 2);
    // Re-read of the unchanged reply.
    const again = await host.turn.reread(at);
    assert.equal(again.ok, true);
    assert.deepEqual(extrasOf(host, at), before);
    // A swipe has its own lines; swiping back shows the first swipe's again.
    await host.swipe(block('Another take.', ['? choice Go around', '~ chatter Minke: hmm']));
    assert.deepEqual(extrasOf(host, at), { choice: [{ text: 'Go around' }], chatter: [{ name: 'Minke', text: 'hmm' }] });
    await host.st.swipeTo(at, 0);
    assert.deepEqual(extrasOf(host, at), before);
    // A reply after it, then a middle delete: each remaining reply keeps its own.
    await host.send('Next.', block('Next.', ['? choice Sleep']));
    const later = extrasOf(host);
    await host.st.deleteMessage(1);
    await host.st.deleteMessage(1);
    assert.deepEqual(extrasOf(host, at - 2), before);
    assert.deepEqual(extrasOf(host), later);
    // A fresh host over the saved chat (a reload) reads the same.
    const saved = host.ctx.chat;
    const other = await createHost({ settings: BOTH, st: { chat: saved } });
    t.after(() => other.close());
    assert.deepEqual(extrasOf(other, at - 2), before);
});

// ---------------------------------------------------------------------------------------------------
// Never sent back, unless the reader asks

test('chatter never reaches a later prompt by default; with the setting, the answered reply\'s thoughts go as one tail line', async t => {
    const host = await fresh(t);
    await host.send('I look.', REPLY);
    await host.send('I climb.', 'You climb.');
    const sent = JSON.stringify(host.st.requests.at(-1));
    assert.doesNotMatch(sent, /better not die/, 'not in the history (the block is stripped) nor the tail');
    host.settings.set('story-block', 'chatterInPrompt', true);
    await host.send('Back down.', block('Down.', ['~ chatter Arn: finally']));
    // The reply this message answered ("You climb.") had no chatter: nothing.
    assert.doesNotMatch(JSON.stringify(host.st.requests.at(-1)), /Inner chatter last reply/);
    await host.send('And?', 'Silence.');
    const tail = host.st.requests.at(-1).chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
    assert.match(tail, /\[Inner chatter last reply, unspoken: only the thinker knows\] Arn: finally/);
    // A swipe of the newest reply uses the reply before it (the one the reader answered), not itself.
    await host.swipe(block('Silence again.', ['~ chatter Minke: never this one']));
    await host.swipe('Third.');
    const swiped = JSON.stringify(host.st.requests.at(-1));
    assert.match(swiped, /Arn: finally/);
    assert.doesNotMatch(swiped, /never this one/);
    // The static part did not move with the setting.
    host.settings.set('story-block', 'chatterInPrompt', false);
    await host.send('Hm.', 'Ok.');
    assert.doesNotMatch(JSON.stringify(host.st.requests.at(-1)), /Inner chatter last reply/);
});

// ---------------------------------------------------------------------------------------------------
// The page: buttons that only fill the box, the folded strip, the dossier chip

async function page(t, { settings = BOTH, modules = [] } = {}) {
    t.mock.method(console, 'warn', () => {});
    const doc = setupDom();
    const box = doc.createElement('textarea');
    box.id = 'send_textarea';
    box.value = '';
    box.events = [];
    box.dispatchEvent = event => box.events.push(event.type);
    doc.body.appendChild(box);
    const send = doc.createElement('div');
    send.id = 'send_but';
    send.clicks = 0;
    send.addEventListener('click', () => { send.clicks += 1; });
    doc.body.appendChild(send);
    const host = await createHost({ settings, modules });
    t.after(() => host.close());
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    t.after(() => ui.destroy());
    const draw = () => {
        for (const old of doc.querySelectorAll('.mes')) old.remove();
        host.ctx.chat.forEach((message, index) => makeMessage(doc, index));
        ui.extras.refreshAll();
    };
    const at = (index, selector) => doc.querySelector(`.mes[mesid="${index}"] ${selector}`);
    return { doc, host, ui, draw, at, box, send };
}

test('the latest reply\'s choices are buttons; a click fills the message box and sends nothing', async t => {
    const { host, draw, at, box, send } = await page(t);
    await host.send('Hello.', 'The road.');
    await host.send('I look.', block('The wall.', ['? choice Climb the wall', '? choice <img src=x onerror=alert(1)>']));
    draw();
    const index = lastIndex(host);
    const buttons = [...(at(index, '.story-suite-choices')?.querySelectorAll('.story-suite-choice') ?? [])];
    assert.deepEqual(buttons.map(node => node.textContent), ['Climb the wall', '<img src=x onerror=alert(1)>']);
    assert.equal(at(index, 'img'), null, 'markup from the story never becomes an element');
    const length = host.ctx.chat.length;
    const requests = host.st.requests.length;
    box.value = 'Carefully,';
    buttons[0].click();
    assert.equal(box.value, 'Carefully, Climb the wall', 'after what the reader typed');
    assert.deepEqual(box.events, ['input']);
    assert.equal(send.clicks, 0, 'Send was not pressed');
    assert.equal(host.ctx.chat.length, length, 'no message was added');
    assert.equal(host.st.requests.length, requests, 'nothing was generated');
    // An earlier reply shows no buttons; once the reader answers, the choices go.
    assert.equal(at(index - 2, '.story-suite-choices'), null);
    await host.send('Climb the wall', 'You climb.');
    draw();
    assert.equal(at(index, '.story-suite-choices'), null);
    assert.equal(fillInput('x', { document: { querySelector: () => null } }), 'unavailable');
});

test('inner chatter is a folded strip under each reply; plain names without NPC State Delta', async t => {
    const { host, draw, at } = await page(t);
    await host.send('Hello.', REPLY);
    await host.send('Next.', block('Later.', ['~ chatter Minke: <b>still</b> here']));
    draw();
    for (const index of [2, 4]) assert.ok(at(index, '.story-suite-chatter'), `reply ${index} has its strip`);
    const head = at(4, '.story-suite-chatter-head');
    const list = at(4, '.story-suite-chatter-list');
    assert.equal(head.textContent, 'Inner chatter(1)');
    assert.equal(list.hidden, true, 'starts folded');
    head.click();
    assert.equal(list.hidden, false);
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    assert.equal(at(4, 'b'), null, 'markup is text');
    assert.equal(at(4, '.story-suite-chatter-text').textContent, '<b>still</b> here');
    assert.equal(at(4, '.story-suite-chatter-dossier'), null, 'no NSD: no chip that links');
    assert.equal(at(4, '.story-suite-chatter-name').textContent, 'Minke');
    // The strip stays open through a redraw, and is not part of the story text.
    draw();
    assert.equal(at(4, '.story-suite-chatter-list').hidden, false);
    assert.doesNotMatch(at(4, '.mes_text').textContent, /still/);
});

test('with NPC State Delta knowing the name, the name is a chip that opens the dossier', async t => {
    const opened = [];
    const nsd = {
        id: 'npc-state-delta', name: 'NPC State Delta', version: '0.0.1',
        queries: { 'npc.dossier': (state, args) => (String(args?.name).toLowerCase() === 'minke' ? { name: 'Minke' } : null) },
    };
    const previous = globalThis.NPCStateDelta;
    globalThis.NPCStateDelta = { openDossier: name => { opened.push(name); return true; } };
    t.after(() => { globalThis.NPCStateDelta = previous; });
    const { host, draw, at, doc } = await page(t, { modules: [nsd] });
    await host.send('Hello.', REPLY);
    draw();
    const chips = doc.querySelectorAll('.mes[mesid="2"] .story-suite-chatter-name');
    assert.deepEqual(chips.map(node => [node.textContent, node.tagName.toLowerCase()]), [['Minke', 'button'], ['Arn', 'span']]);
    at(2, '.story-suite-chatter-dossier').click();
    assert.deepEqual(opened, ['Minke']);
});

test('turning a feature off takes its part away at once; the other stays', async t => {
    const { host, draw, at } = await page(t);
    await host.send('Hello.', REPLY);
    draw();
    assert.ok(at(2, '.story-suite-choices'));
    host.features.set(CHOICES_FEATURE, false);
    assert.equal(at(2, '.story-suite-choices'), null);
    assert.ok(at(2, '.story-suite-chatter'));
    host.features.set(CHATTER_FEATURE, false);
    assert.equal(at(2, '.story-suite-extras'), null);
});
