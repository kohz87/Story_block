// A turn on a fake SillyTavern (docs/v2/SPEC.md §4, §5): the interceptor sets (or empties) the two
// prompt slots, prompt-ready puts back what a preset dropped, MESSAGE_RECEIVED captures the
// reply's change lines. The store and the bus are the testkit's stand-ins (testkit/fakes.js);
// the last test runs the same flow on the real runtime when it is in this checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable, sharedPrefix, EXTENSION_PROMPT_TYPES } from '../../testkit/index.js';
import { STATIC_KEY, TAIL_KEY, V1_KEYS, createTurn, restoreMissing } from '../../src/v2/turn.js';
import { HAPPENED, STATIC_MARKER } from '../../src/v2/prompt.js';
import { createRegistry } from '../../src/v2/registry.js';

// A small inventory module: items by name, a capture kind `item`, a command for the UI.
function bag() {
    return {
        id: 'bag',
        name: 'Bag',
        domains: {
            inventory: {
                initial: () => ({ items: {} }),
                validate: slice => (Object.values(slice.items).some(qty => qty < 0) ? ['A count went below zero.'] : []),
            },
        },
        commands: {
            'bag.add'(ctx, { name, qty }) {
                const inv = ctx.draft('inventory');
                inv.items[name] = (inv.items[name] ?? 0) + qty;
                return { summary: `Ren picks up ${qty} ${name} (now ${inv.items[name]}).`, narrate: true };
            },
        },
        capture: {
            kinds: { item: { grammar: '+ item Name | qty: 1', aliases: ['items'] } },
            apply(ctx, line) {
                const inv = ctx.draft('inventory');
                const qty = Number(line.labels.qty ?? 1);
                if (!Number.isInteger(qty) || qty < 1) ctx.fail('INVALID', `"${line.labels.qty}" is not a count.`);
                const have = inv.items[line.name] ?? 0;
                if (line.op === '-' && have < qty) ctx.fail('NOT_ENOUGH', `There is no ${line.name} left.`);
                inv.items[line.name] = line.op === '-' ? have - qty : have + qty;
                return { summary: `${line.op === '-' ? 'Lost' : 'Got'} ${qty} ${line.name}.`, narrate: false };
            },
        },
        context: {
            static: () => 'Bag: the story never sets counts.',
            tail: view => ({ lines: [`[Bag] ${Object.entries(view.state.domains.inventory.items).map(([name, qty]) => `${name} x${qty}`).join(', ') || 'empty'}`] }),
        },
    };
}

const fakeHost = ({ modules = [], ...options } = {}) => createHost({ fakes: true, core: false, modules: [bag(), ...modules], ...options });
const stored = (host, index) => host.ctx.chat[index].extra.storySuite;
const items = host => host.head().domains.inventory.items;
const systemText = request => request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n---\n');

test('install empties the v1 keys and both slots; the interceptor sets both for an ordinary reply', async () => {
    const host = await fakeHost();
    const keys = Object.fromEntries(host.st.promptLog.slice(0, V1_KEYS.length).map(entry => [entry.key, entry]));
    for (const [key, place] of V1_KEYS) {
        assert.equal(keys[key].value, '');
        assert.equal(keys[key].position, place === 'static' ? EXTENSION_PROMPT_TYPES.IN_PROMPT : EXTENSION_PROMPT_TYPES.IN_CHAT);
    }
    await host.st.addUser('I look around.');
    await host.turn.interceptor([], 8192, () => {}, 'normal');
    const prompts = host.st.prompts();
    assert.deepEqual({ ...prompts[STATIC_KEY], value: undefined }, { value: undefined, position: EXTENSION_PROMPT_TYPES.IN_PROMPT, depth: 0, scan: false, role: 0 });
    assert.deepEqual({ ...prompts[TAIL_KEY], value: undefined }, { value: undefined, position: EXTENSION_PROMPT_TYPES.IN_CHAT, depth: 0, scan: false, role: 0 });
    assert.ok(prompts[STATIC_KEY].value.startsWith(STATIC_MARKER));
    assert.ok(prompts[STATIC_KEY].value.includes('+ item Name | qty: 1'));
    assert.ok(prompts[STATIC_KEY].value.endsWith('Bag: the story never sets counts.'));
    assert.equal(prompts[TAIL_KEY].value, '[Bag] empty');
    host.close();
});

test('normal, swipe, regenerate and continue get both slots; quiet and impersonate get neither and capture nothing', async () => {
    const host = await fakeHost();
    for (const type of ['normal', 'swipe', 'regenerate', 'continue', undefined]) {
        await host.turn.interceptor([], 8192, () => {}, 'quiet');
        assert.equal(host.st.prompt(STATIC_KEY), '');
        await host.turn.interceptor([], 8192, () => {}, type);
        assert.ok(host.st.prompt(STATIC_KEY), `${type}: static set`);
        assert.ok(host.st.prompt(TAIL_KEY), `${type}: tail set`);
    }
    for (const type of ['quiet', 'impersonate', 'Quiet', 'something-new']) {
        await host.turn.interceptor([], 8192, () => {}, 'normal');
        await host.turn.onGenerationEnded();
        host.turn.onPromptReady({ chat: [] });
        await host.turn.interceptor([], 8192, () => {}, type);
        assert.equal(host.st.prompt(STATIC_KEY), '', `${type}: static emptied`);
        assert.equal(host.st.prompt(TAIL_KEY), '', `${type}: tail emptied`);
    }
    // A quiet generation adds no message, so nothing is captured; the request carried nothing.
    host.turn.clearProblems();
    const quiet = await host.quiet('<Changes>\n+ item Rope\n</Changes>');
    assert.ok(!JSON.stringify(quiet.request).includes(STATIC_MARKER));
    assert.ok(!JSON.stringify(quiet.request).includes('[Bag]'));
    assert.deepEqual(items(host), {});
    // An impersonation neither.
    const before = host.st.saves.length;
    const impersonated = await host.st.generate('impersonate', { reply: 'I say hi.' });
    assert.ok(!JSON.stringify(impersonated.request).includes(STATIC_MARKER));
    assert.equal(host.st.saves.length, before);
    host.close();
});

test('a reply\'s change lines are captured, appended to it, hidden, and saved once', async () => {
    const host = await fakeHost();
    const turns = [];
    const committed = [];
    host.sdk.on('turn', turn => turns.push(turn));
    host.sdk.on('committed', ({ receipt }) => committed.push(receipt.id));
    // The greeting's initial state, written when the chat opened, is saved before the reply.
    await host.store.flush();
    const saves = host.st.saves.length;
    const { index } = await host.send('I fish.', 'Ren lands a trout.\n\n<Changes>\n+ item Moonveil Trout | qty: 2\n+ items Rope\n</Changes>');
    assert.equal(index, 2);
    assert.deepEqual(items(host), { 'Moonveil Trout': 2, Rope: 1 });
    const carrier = stored(host, 2);
    assert.deepEqual(carrier.receipts.map(receipt => [receipt.type, receipt.cause, receipt.module]), [
        ['capture.item', 'story', 'bag'],
        ['capture.item', 'story', 'bag'],
    ]);
    assert.equal(carrier.ops.length, 4);
    assert.deepEqual(carrier.narrated, []);
    assert.equal(host.st.saves.length, saves + 1, 'one save for the whole reply');
    // The block is kept, hidden, in the reply and its swipe; the story reads as written.
    const message = host.ctx.chat[2];
    assert.match(message.mes, /^Ren lands a trout\.\n\n<!-- STORY_SUITE_V2\n<Changes>\n/);
    assert.equal(message.swipes[0], message.mes);
    assert.deepEqual(host.st.rendered, [2]);
    assert.equal(turns.length, 1);
    assert.deepEqual(turns[0].receipts.map(receipt => receipt.id), committed);
    assert.deepEqual(turns[0].problems, []);
    // The spent note is emptied once the reply is in.
    assert.equal(host.st.prompt(TAIL_KEY), '');
    assert.equal(host.st.prompt(STATIC_KEY), '');
    host.close();
});

test('an unknown kind, an unreadable line and a rejected line become problems; the rest is kept', async () => {
    const host = await fakeHost();
    const turns = [];
    host.sdk.on('turn', turn => turns.push(turn));
    await host.send('I trade.', [
        'Done.',
        '<Changes>',
        '+ item Rope | qty: 2',
        '~ quest Granary Rats | step: cleared',
        'Nothing else.',
        '- item Lantern',
        '+ item Coin | qty: lots',
        '- item Rope',
        '</Changes>',
    ].join('\n'));
    assert.deepEqual(items(host), { Rope: 1 }, 'the accepted lines are applied');
    assert.equal(stored(host, 2).receipts.length, 2);
    const problems = host.turn.problems();
    assert.deepEqual(problems.map(item => [item.module, item.code]), [
        [null, 'UNREADABLE'],
        [null, 'UNKNOWN_KIND'],
        ['bag', 'NOT_ENOUGH'],
        ['bag', 'INVALID'],
    ]);
    assert.match(problems[1].message, /No module keeps "quest", so "~ quest Granary Rats \| step: cleared" was not used\./);
    assert.match(problems[2].message, /"- item Lantern" was not used: There is no Lantern left\./);
    assert.ok(problems.every(item => item.index === 2 || item.code === 'UNREADABLE'));
    assert.deepEqual(host.turn.problems('bag').map(item => item.code), ['NOT_ENOUGH', 'INVALID']);
    assert.equal(turns[0].problems.length, 4);
    host.close();
});

test('a module that throws in capture is a problem, not an error for the reader', async () => {
    const host = await fakeHost({
        modules: [{ id: 'boom', capture: { kinds: { boom: { grammar: '! boom Name' } }, apply() { throw new Error('kaboom'); } } }],
    });
    await host.send('Go.', 'Text.\n<Changes>\n! boom Thing\n+ item Rope\n</Changes>');
    assert.deepEqual(items(host), { Rope: 1 });
    assert.deepEqual(host.turn.problems('boom').map(item => [item.code, item.message]), [['FAILED', '"! boom Thing" was not used: kaboom']]);
    host.close();
});

test('what happened since the last reply is told once: [Happened] in the tail, then recorded as narrated', async () => {
    const host = await fakeHost();
    await host.send('Hi.', 'Hello.');
    const picked = await host.sdk.command('bag.add', { name: 'Rope', qty: 2 });
    assert.equal(picked.ok, true);
    const { request } = await host.send('I look at my rope.', 'A fine rope.');
    const tail = request.chat.at(-1);
    assert.equal(tail.role, 'system');
    assert.equal(tail.content, `${HAPPENED}\nRen picks up 2 Rope (now 2).\n[Bag] Rope x2`);
    // The receipt sits on the reply it followed; the next reply recorded that it told it.
    assert.deepEqual(stored(host, 2).receipts.map(receipt => receipt.id), [picked.receipt.id]);
    assert.deepEqual(stored(host, 4).narrated, [picked.receipt.id]);
    const again = await host.send('And now?', 'Nothing new.');
    assert.equal(again.request.chat.at(-1).content, '[Bag] Rope x2', 'not told twice');
    host.close();
});

test('the static part is byte-identical across two consecutive requests with the state changed', async () => {
    const host = await fakeHost();
    const first = await host.send('One.', 'Reply one.\n<Changes>\n+ item Rope | qty: 3\n</Changes>');
    await host.sdk.command('bag.add', { name: 'Lantern', qty: 1 });
    const second = await host.send('Two.', 'Reply two.');
    const [a, b] = [first.request.chat[0].content, second.request.chat[0].content];
    assert.equal(a, b);
    assert.notEqual(first.request.chat.at(-1).content, second.request.chat.at(-1).content);
    const shared = sharedPrefix(first.request, second.request);
    // Everything up to the first reply is the same start.
    assert.ok(shared.chars > JSON.stringify(first.request.chat.slice(0, 3)).length - 2, `shared ${shared.percent}%`);
    assert.ok(shared.percent > 50);
    host.close();
});

test('a preset without the Main Prompt: the static part goes at the start of this reply\'s part', async () => {
    const host = await fakeHost({ st: { mainPrompt: false } });
    const { request } = await host.send('Hello.', 'Hi.');
    assert.equal(request.chat.filter(message => message.content.includes(STATIC_MARKER)).length, 1);
    const tail = request.chat.at(-1);
    assert.ok(tail.content.startsWith(`${STATIC_MARKER}\n`));
    assert.ok(tail.content.endsWith('Bag: the story never sets counts.\n\n[Bag] empty'));
    assert.equal(host.turn.session(), null);
    // With the Main Prompt it is where SillyTavern put it, once.
    const normal = await fakeHost();
    const sent = await normal.send('Hello.', 'Hi.');
    assert.equal(sent.request.chat.filter(message => message.content.includes(STATIC_MARKER)).length, 1);
    assert.ok(sent.request.chat[0].content.includes(STATIC_MARKER));
    assert.equal(sent.request.chat.at(-1).content, '[Bag] empty');
    host.close();
    normal.close();
});

test('restoreMissing: only what is missing, before a Continue\'s own text when both are', () => {
    const chat = [{ role: 'user', content: 'Hi' }, { role: 'system', content: 'Other tail\n[Bag] empty' }];
    assert.equal(restoreMissing(chat, `${STATIC_MARKER}\nRules`, '[Bag] empty'), 'static');
    assert.equal(chat[1].content, `Other tail\n${STATIC_MARKER}\nRules\n\n[Bag] empty`);
    assert.equal(restoreMissing(chat, `${STATIC_MARKER}\nRules`, '[Bag] empty'), '', 'already there');
    const both = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Half a rep' }];
    assert.equal(restoreMissing(both, `${STATIC_MARKER}\nRules`, '[Bag] empty'), 'both');
    assert.deepEqual(both.map(message => message.role), ['user', 'system', 'assistant']);
    assert.equal(both[1].content, `${STATIC_MARKER}\nRules\n\n[Bag] empty`);
    const parts = [{ role: 'system', content: [{ type: 'text', text: '[Bag] empty' }] }];
    assert.equal(restoreMissing(parts, `${STATIC_MARKER}\nRules`, '[Bag] empty'), 'static');
    assert.equal(parts[0].content[0].text, `${STATIC_MARKER}\nRules\n\n[Bag] empty`);
    assert.equal(restoreMissing([], '', 'x'), '');
});

test('a quiet prompt built while the reply is pending carries nothing; the reply\'s prompt gets both back', async () => {
    const host = await fakeHost();
    await host.st.addUser('Hi.');
    await host.turn.interceptor([], 8192, () => {}, 'normal');
    // Another extension runs a quiet generation from inside its own interceptor.
    const quiet = await host.st.generate('quiet', { reply: 'summary' });
    assert.ok(!JSON.stringify(quiet.request).includes(STATIC_MARKER));
    assert.ok(host.st.prompt(STATIC_KEY).startsWith(STATIC_MARKER), 'filled again after the quiet prompt');
    assert.equal(host.st.prompt(TAIL_KEY), '[Bag] empty');
    host.close();
});

test('the prompt history loses hidden change blocks; text completion too', async () => {
    const host = await fakeHost();
    await host.send('One.', 'Reply one.\n<Changes>\n+ item Rope\n</Changes>');
    const { request } = await host.send('Two.', 'Reply two.');
    const assistant = request.chat.filter(message => message.role === 'assistant').map(message => message.content);
    assert.deepEqual(assistant, ['The story begins.', 'Reply one.']);
    assert.ok(systemText(request).includes('<Changes>'), 'the instruction\'s own example stays');
    host.close();

    const text = await fakeHost({ st: { mainApi: 'textgenerationwebui' } });
    await text.send('One.', 'Reply one.\n<Changes>\n+ item Rope\n</Changes>');
    const second = await text.send('Two.', 'Reply two.');
    assert.ok(!second.request.prompt.includes('STORY_SUITE_V2'));
    assert.ok(!second.request.prompt.includes('+ item Rope'));
    assert.ok(second.request.prompt.includes(STATIC_MARKER));
    assert.ok(second.request.prompt.includes('[Bag] Rope x1'));
    text.close();
});

test('text completion: what SillyTavern left out is put back around the prompt', () => {
    const registry = createRegistry();
    registry.register(bag());
    const turn = createTurn({ ctx: {}, store: {}, bus: {}, registry, settings: () => ({}) });
    const event = { prompt: 'Story so far.' };
    turn.onTextPromptReady(event);
    assert.equal(event.prompt, 'Story so far.', 'no pending reply: untouched');
});

test('Continue reads only a block the continuation adds, and keeps what the reply was told', async () => {
    const host = await fakeHost();
    await host.send('Go.', 'Half a reply');
    await host.cont(' and the rest.\n<Changes>\n+ item Rope\n</Changes>');
    assert.deepEqual(items(host), { Rope: 1 });
    await host.cont(' Even more.');
    assert.deepEqual(items(host), { Rope: 1 }, 'the block already read is not read again');
    assert.equal(stored(host, 2).receipts.length, 1);
    host.close();
});

test('a swipe is captured on its own; a message the interceptor did not prepare is not captured', async () => {
    const host = await fakeHost();
    const turns = [];
    host.sdk.on('turn', turn => turns.push([turn.index, turn.type, turn.receipts.length]));
    await host.send('Go.', 'First.\n<Changes>\n+ item Rope\n</Changes>');
    await host.swipe('Second.\n<Changes>\n+ item Lamp\n</Changes>');
    assert.deepEqual(turns, [[2, 'normal', 1], [2, 'swipe', 1]]);
    assert.equal(items(host).Lamp, 1);
    assert.match(host.ctx.chat[2].swipes[1], /^Second\.\n\n<!-- STORY_SUITE_V2/);
    host.st.addMessage({ name: 'Narrator', is_user: false, mes: '<Changes>\n+ item Gold\n</Changes>', swipes: ['x'], swipe_id: 0, swipe_info: [{ extra: {} }], extra: {} });
    await host.turn.onMessageReceived(3);
    assert.ok(!('Gold' in items(host)), '/sendas or a narrator message is not a reply');
    host.close();
});

test('macros in the story\'s own words reach the model as written, except the persona and character names', async () => {
    const host = await fakeHost();
    await host.send('Go.', 'Done.\n<Changes>\n+ item {{random::a,b}} Map\n+ item <USER> Key\n</Changes>');
    const { request } = await host.send('Look.', 'Ok.');
    const tail = request.chat.at(-1).content;
    assert.ok(tail.includes('{\u200b{random::a,b}} Map'), 'other macros are kept as written');
    assert.ok(tail.includes('<\u200bUSER> Key'));
    host.close();
});

test('{{user}} and {{char}} in the static and tail text become the persona\'s and character\'s names', async () => {
    const note = {
        id: 'note',
        context: { static: () => 'Only {{user}} decides what {{user}} does.', tail: () => ({ lines: ['{{char}} waits for {{ user }}.'], optional: [] }) },
    };
    const host = await createHost({ fakes: true, core: false, modules: [note] });
    const one = await host.send('Hi.', 'Hello.');
    const two = await host.send('Again.', 'Hello again.');
    const text = request => request.chat.map(message => message.content).join('\n');
    assert.ok(text(one.request).includes(`Only ${host.ctx.name1} decides what ${host.ctx.name1} does.`));
    assert.ok(text(one.request).includes(`${host.ctx.name2} waits for ${host.ctx.name1}.`));
    assert.ok(!text(one.request).includes('{{user}}') && !text(one.request).includes('{\u200b{user}}'));
    assert.equal(host.turn.session(), null);
    const statics = [one, two].map(({ request }) => request.chat.find(message => message.content.includes('Only ')).content);
    assert.equal(statics[0], statics[1], 'the static part stays byte-identical');
    host.close();
});

test('beforeGenerate: tail lines join the module\'s part; commands are committed as system receipts and told', async () => {
    const host = await fakeHost({
        modules: [{
            id: 'clock',
            domains: { director: { initial: () => ({ bell: false }) } },
            commands: { 'clock.ring'(ctx) { ctx.draft('director').bell = true; return { summary: 'The bell rings at midnight.', narrate: true }; } },
            hooks: { beforeGenerate: view => (view.state.domains.director.bell ? ['The bell has rung.'] : { lines: ['Midnight comes.'], commands: [{ type: 'clock.ring' }, { type: 'clock.nope' }] }) },
        }],
    });
    const { request } = await host.send('Wait.', 'Ok.');
    const tail = request.chat.at(-1).content;
    assert.ok(tail.startsWith(`${HAPPENED}\nThe bell rings at midnight.`));
    assert.ok(tail.endsWith('Midnight comes.'));
    assert.deepEqual(host.turn.problems('clock').map(item => item.code), ['UNKNOWN_COMMAND']);
    const receipt = stored(host, 0).receipts.find(item => item.type === 'clock.ring');
    assert.equal(receipt.cause, 'system');
    assert.deepEqual(stored(host, 2).narrated, [receipt.id]);
    host.close();
});

test('the preview lists what the next reply would be sent, without changing anything', async () => {
    const host = await fakeHost();
    const saves = host.st.saves.length;
    const parts = host.turn.preview();
    assert.deepEqual(parts.map(part => [part.place, part.module]), [['static', 'story-suite'], ['static', 'bag'], ['tail', 'bag']]);
    assert.equal(host.st.saves.length, saves);
    assert.equal(host.turn.session(), null);
    host.close();
});

test('chat change and deleted messages rebuild the head; a chat with no state gets its initial state', async () => {
    const host = await fakeHost();
    const heads = [];
    host.sdk.on('head', event => heads.push(event.index));
    await host.send('Go.', 'Done.\n<Changes>\n+ item Rope\n</Changes>');
    await host.st.deleteMessage(2);
    assert.equal(heads.at(-1), 0);
    await host.st.loadChat([{ name: 'Narrator', is_user: false, mes: 'A new tale.', swipes: ['A new tale.'], swipe_id: 0, swipe_info: [{ extra: {} }], extra: {} }], 'chat-2');
    assert.deepEqual(host.head().domains, { inventory: { items: {} } });
    assert.equal(host.turn.session(), null);
    host.close();
});

test('canGenerate: a module can hold a story generation back, with a reason; quiet ones are not asked', async () => {
    let ready = false;
    let asked = 0;
    const opened = [];
    const host = await fakeHost({
        modules: [{
            id: 'creator',
            name: 'Creator',
            hooks: {
                canGenerate: async view => { asked += 1; return ready || { ok: false, reason: `Make your character first (${view.chat.length} messages).` }; },
                onBlocked: (reason, moduleId) => opened.push([moduleId, reason]),
            },
        }, { id: 'maybe', hooks: { canGenerate: () => (asked > 2 ? false : true) } }, { id: 'buggy', hooks: { canGenerate() { throw new Error('oops'); } } }],
    });
    const stopped = await host.send('Hello?', 'Should not be written.');
    assert.equal(stopped.aborted, true);
    assert.equal(host.ctx.chat.length, 2, 'no reply');
    assert.equal(host.st.requests.length, 0, 'nothing was sent');
    assert.deepEqual(host.st.notices, [{ reason: 'Make your character first (2 messages).', moduleId: 'creator' }]);
    assert.deepEqual(opened, [['creator', 'Make your character first (2 messages).']]);
    assert.deepEqual(host.turn.blocked(), [{ moduleId: 'creator', reason: 'Make your character first (2 messages).' }]);
    assert.equal(host.st.prompt(STATIC_KEY), '');
    assert.equal(host.turn.session(), null);
    assert.deepEqual(host.turn.problems('buggy').map(item => item.code), ['FAILED'], 'a throwing hook is logged and does not block');
    // Quiet generations are never asked.
    await host.quiet('x');
    assert.equal(asked, 1);
    // Ready: the next one goes through; `false` alone blocks with a plain default reason.
    ready = true;
    const sent = await host.st.generate('normal', { reply: 'Now it goes.' });
    assert.equal(sent.index, 2);
    host.st.addUser('Again.');
    const second = await host.st.generate('normal', { reply: 'no' });
    assert.equal(second.aborted, true);
    assert.equal(host.st.notices.at(-1).reason, 'maybe is not ready for the story to go on yet.');
    host.close();
});

test('the static instruction asks for <Changes> only, never a state block', async () => {
    const host = await fakeHost();
    await host.st.addUser('Hi.');
    await host.turn.interceptor([], 8192, () => {}, 'normal');
    const text = host.st.prompt(STATIC_KEY);
    assert.match(text, /This is the only block you write: no state, inventory or party blocks/);
    assert.equal(text.match(/<[A-Z][A-Za-z_]*>/g).join(','), '<Changes>', 'no other block tag is named');
    host.close();
});

test('the real runtime with the core module: items, coins, place and presence from one reply', async t => {
    const available = await hostAvailable();
    if (!available.ok) {
        t.skip(available.reason);
        return;
    }
    const host = await createHost();
    assert.ok(host.registry.has('story-block'));
    const { request } = await host.send('I land the fish and walk into the village.', [
        'The trout fights, then gives. Fenna waves from the gate of Bluewatch.',
        '<Changes>',
        '+ item Moonveil Trout | qty: 1 | note: violet-streaked',
        '+ item Moonveil Trout | qty: 1',
        '~ place Bluewatch Village | kind: settlement',
        '+ present Fenna',
        '- item Rope',
        '</Changes>',
    ].join('\n'));
    assert.ok(request.chat[0].content.includes('+ item Name | qty: 1'));
    const head = host.head();
    const trout = Object.values(head.domains.inventory.stacks).filter(stack => head.domains.inventory.defs[stack.def]?.name === 'Moonveil Trout');
    assert.equal(trout.reduce((sum, stack) => sum + stack.qty, 0), 2, 'the second line ran on the state the first left');
    assert.equal(head.domains.scene.place.name, 'Bluewatch Village');
    assert.deepEqual(head.domains.scene.present, ['Fenna']);
    assert.deepEqual(host.turn.problems('story-block').map(item => item.line), ['- item Rope']);
    const receipts = host.ctx.chat[2].extra.storySuite.receipts;
    assert.ok(receipts.every(receipt => receipt.cause === 'story' && receipt.module === 'story-block'));
    assert.deepEqual(receipts.map(receipt => receipt.rev), [1, 2, 3, 4], 'one rev per line, in reply order');
    const next = await host.send('Who is here?', 'Fenna.');
    assert.ok(next.request.chat.at(-1).content.includes('Fenna'));
    host.close();
});

test('the real runtime: a whole turn on store.js and commands.js', async t => {
    const available = await hostAvailable();
    if (!available.ok) {
        t.skip(available.reason);
        return;
    }
    const host = await createHost({ core: false, modules: [bag()] });
    await host.send('I fish.', 'A trout.\n<Changes>\n+ item Trout | qty: 2\n- item Boot\n</Changes>');
    assert.deepEqual(items(host), { Trout: 2 });
    assert.deepEqual(host.turn.problems('bag').map(item => item.code), ['NOT_ENOUGH']);
    const picked = await host.sdk.command('bag.add', { name: 'Rope', qty: 1 });
    assert.equal(picked.ok, true);
    const { request } = await host.send('Next.', 'Ok.\n<Changes>\n+ item Coin\n</Changes>');
    assert.ok(request.chat.at(-1).content.startsWith(`${HAPPENED}\nRen picks up 1 Rope (now 1).`));
    assert.deepEqual(items(host), { Trout: 2, Rope: 1, Coin: 1 });
    // A swipe of the last reply takes back what that reply's first swipe changed (§2.2).
    await host.swipe('Another ending.\n<Changes>\n+ item Lamp\n</Changes>');
    assert.deepEqual(items(host), { Trout: 2, Rope: 1, Lamp: 1 });
    await host.st.swipeTo(4, 0);
    assert.deepEqual(items(host), { Trout: 2, Rope: 1, Coin: 1 });
    // Deleting the reply that holds the Rope's receipt takes the Rope back.
    await host.st.deleteMessage(4);
    await host.st.deleteMessage(3);
    await host.st.deleteMessage(2);
    assert.deepEqual(items(host), {});
    host.close();
});
