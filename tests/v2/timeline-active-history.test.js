// E6b review fix 3: after a restore, the replies and the reader's messages it faded never reach a generation request, because the
// restore hides them with SillyTavern's own flag (`is_system`, the ghost), which SillyTavern leaves out of every prompt it builds.
// The hide is part of the restore's commit and is noted on its journal entry; retracting the restore shows exactly those again and
// no others. Story Block's own readers of earlier messages (the chatter queries, the module view, the late lines) read through one
// active-history filter, and `savepoint.contract` reports retainedChatRestore only while they are wired and no hide failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHost } from '../../testkit/index.js';
import { withAssist } from '../../src/v2/capture.js';
import { ACTIVE_READERS, createTimeline } from '../../src/v2/timeline/index.js';
import { rulesModule, restore, clone, reload } from './helpers/timeline.js';

const ALPHA = 'SECRET-ALPHA-the-vault-is-under-the-mill';
const BETA = 'SECRET-BETA-the-reader-confesses';
const GAMMA = 'SECRET-GAMMA-continued-fact';
const SECRETS = [ALPHA, BETA, GAMMA];

const seen = request => JSON.stringify(request);

// Begin / Before. (active), a target reply holding the first secret with a save point inside it, a Continue with the third, the
// reader's own words (the second), the death reply; then the restore. Everything from the target reply on is faded.
async function world(t, { mainApi = 'openai', settings = {} } = {}) {
    t.mock.method(console, 'warn', () => {});
    const modules = [rulesModule()];
    const host = await createHost({ modules, settings, st: { mainApi } });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    await host.send('Accept the job.', `Target, and ${ALPHA}.`);
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.cont(` Continued: ${GAMMA}.`);
    await host.send(`I say: ${BETA}.`, 'Death.');
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    return { host, modules };
}

const text = request => (request.chat ? request.chat.map(entry => (typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content))).join('\n') : request.prompt);
const hiddenOf = host => host.ctx.chat.map(message => message.is_system === true);
const clean = (_host, request) => SECRETS.every(secret => !seen(request).includes(secret));

for (const mainApi of ['openai', 'textgen']) {
    test(`${mainApi}: a restore hides what it faded; no request carries it: normal, regex, swipe, Continue, quiet, rebuild, reload`, async t => {
        const { host, modules } = await world(t, { mainApi });
        const chat = host.ctx.chat;
        const history = await host.sdk.timeline.history({});
        // exactly the messages the history marks inactive are hidden
        assert.deepEqual(hiddenOf(host), history.messages.map(each => !each.active));
        assert.deepEqual(history.messages.map(x => x.active), [true, true, true, true, false, false, false]);
        const saved = host.st.saved();
        assert.deepEqual(saved.map(message => message.is_system === true), hiddenOf(host), 'the hide is in the chat file');
        // prompt-only regexes (SillyTavern runs them before anything else could look) change nothing about who is in the request
        const rules = [{ find: /Target, and /g }, { find: /I say: /g }, { find: / Continued: /g }, { find: /Accept the job\./g, replace: 'Accept.' }];
        host.st.promptRegex.push(...rules);
        await host.send('Move on.', 'Later.');
        let next = host.st.requests.at(-1);
        assert.equal(clean(host, next), true);
        assert.match(text(next), /Before\./);
        assert.match(text(next), /Accept\./, 'the regex did run over what is left');
        assert.match(text(next), /Move on\./);
        assert.equal(text(next).includes('Death.'), false);
        for (const [type, reply] of [['swipe', 'Later, again.'], ['continue', ' And on.'], ['quiet', 'q']]) {
            await host.st.generate(type, { reply });
            assert.equal(clean(host, host.st.requests.at(-1)), true, type);
        }
        assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, true);
        host.store.rebuild();
        await host.send('Again.', 'Once more.');
        assert.equal(clean(host, host.st.requests.at(-1)), true, 'rebuild');
        const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules, { st: { mainApi } });
        t.after(() => fresh.close());
        fresh.st.promptRegex.push(...rules);
        await fresh.send('After reload.', 'Fine.');
        next = fresh.st.requests.at(-1);
        assert.equal(clean(fresh, next), true, 'reload');
        assert.match(text(next), /Before\./);
        assert.deepEqual(hiddenOf(fresh).slice(0, 7), [false, false, false, false, true, true, true]);
        assert.equal(chat.length > 0, true);
    });
}

test('retracting the restore shows exactly the messages it hid; a message the reader hid beforehand stays hidden, one they showed afterwards stays shown', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    await host.send('Accept the job.', `Target, and ${ALPHA}.`);
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.send(`I say: ${BETA}.`, 'Middle.');
    await host.send('Go on.', 'Death.');
    // [0 greeting, 1 Begin, 2 Before, 3 Accept, 4 Target, 5 I say, 6 Middle, 7 Go on, 8 Death]
    const chat = host.ctx.chat;
    chat[6].is_system = true;   // the reader hid this one themselves, before the restore
    chat[1].is_system = true;   // and this one, which the restore does not fade
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    assert.deepEqual(hiddenOf(host), [false, true, false, false, true, true, true, true, true]);
    const entry = host.timeline.host.journal().find(each => each.kind === 'restore');
    assert.deepEqual(entry.hid.map(item => item.index), [4, 5, 7, 8], 'the restore noted exactly what it hid: not the one already hidden');
    assert.deepEqual(entry.hid.map(item => item.sid !== null), [true, false, false, true], 'by place and record id (a reader\'s message has none)');
    assert.deepEqual(entry.hid.map(item => host.ctx.chat[item.index].story_suite_hid), entry.hid.map(item => item.stamp));
    assert.equal(host.ctx.chat[6].story_suite_hid, undefined, 'nothing is marked on a message the reader hid');
    // the reader shows one of them again while it is faded: their choice, no Problem, not hidden again
    chat[5].is_system = false;
    host.sdk.query('savepoint.contract', {});
    await host.sdk.timeline.status();
    assert.equal(chat[5].is_system, false);
    assert.equal(host.turn.problems().some(problem => problem.code === 'HIDE_FAILED'), false);
    // an earlier reply is deleted (the places shift), then the restore reply goes: the story no longer holds the restore
    await host.st.deleteMessage(2);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.timeline.host.recover();
    // [0 greeting, 1 Begin (reader hid), 3 Accept, 4 Target, 5 I say (reader showed), 6 Middle (reader hid), 7 Go on]
    assert.deepEqual(hiddenOf(host), [false, true, false, false, false, true, false]);
    assert.deepEqual(host.ctx.chat.map(each => each.mes.slice(0, 6)), ['The st', 'Begin.', 'Accept', 'Target', 'I say:', 'Middle', 'Go on.']);
    // and the request that follows has what is active and visible
    await host.send('Move on.', 'Later.');
    assert.match(text(host.st.requests.at(-1)), /Target/);
    assert.match(text(host.st.requests.at(-1)), /Go on\./);
    assert.equal(text(host.st.requests.at(-1)).includes('Middle'), false, 'the reader\'s own hide still holds');
});

test('swiping the restore reply away shows what it hid, and swiping back hides it again', async t => {
    const { host } = await world(t);
    const last = host.ctx.chat.length - 1;
    await host.swipe('An alternative ending.');
    assert.deepEqual(hiddenOf(host).slice(0, 7), [false, false, false, false, false, false, false]);
    await host.send('Move on.', 'Later.');
    assert.equal(SECRETS.some(secret => seen(host.st.requests.at(-1)).includes(secret)), true, 'no restore on the line of history: the story is as it was');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.swipeTo(last, 0);
    await host.timeline.host.recover();
    assert.deepEqual(hiddenOf(host).slice(0, 7), [false, false, false, false, true, true, true]);
});

test('active messages with the same words, a hidden note of the same speaker and an active tool result lose nothing', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Go.', 'The same words.');
    host.ctx.chat.push({ name: 'Narrator', is_user: false, is_system: true, mes: 'A hidden note.', send_date: '', extra: {} });
    host.ctx.chat.push({ name: 'Tool', is_user: false, is_system: false, mes: 'tool says: 42', send_date: '', extra: {} });
    await host.send('Accept.', 'Target.');
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.send('Go.', 'The same words.');
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    await host.send('Later.', 'Fine.');
    const contents = host.st.requests.at(-1).chat.map(entry => entry.content);
    assert.equal(contents.filter(content => content === 'The same words.').length, 1, 'the active one stays, the faded one goes');
    assert.equal(contents.filter(content => content === 'Go.').length, 1);
    assert.equal(contents.includes('tool says: 42'), true);
    assert.equal(contents.includes('A hidden note.'), false);
    assert.equal(contents.includes('Target.'), false);
    assert.equal(host.ctx.chat[3].is_system, true, 'the note stays as the reader had it');
});

test('a message that cannot be hidden is a Problem, and retainedChatRestore is false for that chat', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    await host.send('Accept.', 'Target.');
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.send('Go on.', 'Death.');
    assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, true);
    Object.freeze(host.ctx.chat[4]);
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    assert.equal(host.turn.problems().filter(problem => problem.code === 'HIDE_FAILED').length, 1);
    assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, false);
    assert.equal(host.ctx.chat[5].is_system, true, 'the others were hidden');
});

test('a chat that never restored is not touched', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    await host.send('Next.', 'Second.');
    const before = JSON.stringify(host.ctx.chat);
    await host.sdk.timeline.status();
    host.sdk.query('savepoint.contract', {});
    host.store.rebuild();
    await host.timeline.host.recover();
    assert.equal(JSON.stringify(host.ctx.chat), before);
    assert.equal(host.ctx.chat.some(message => 'is_system' in message && message.is_system !== false), false);
});

test('the Inner chatter tail line never carries the thoughts of a faded reply', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [rulesModule()], settings: { features: { 'story-block.chatter': true } } });
    t.after(() => host.close());
    host.settings.set('story-block', 'chatterInPrompt', true);
    await host.send('Begin.', 'Before.');
    await host.send('Accept.', 'Target.');
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.send('Go on.', `Death.\n\n<Changes>\n~ chatter Arn: ${GAMMA}\n</Changes>`);
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    await host.send('Move on.', 'Later.');
    assert.equal(seen(host.st.requests.at(-1)).includes(GAMMA), false);
    assert.doesNotMatch(seen(host.st.requests.at(-1)), /Inner chatter last reply/);
});

test('a module\'s view shows the last reader message that is not faded; late safety-net lines of a faded reply are not applied', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host } = await world(t);
    assert.equal(host.sdk.view().chat.lastUser, 'Accept the job.');
    // the restoring reply holds late lines kept for the next reply: they belong to the faded line
    const last = host.ctx.chat.length - 1;
    host.ctx.chat[last].mes = withAssist(host.ctx.chat[last].mes, ['+ present Elula'], { next: true });
    await host.send('Move on.', 'Later.');
    assert.equal((host.head().domains.scene?.present ?? []).some(person => String(person?.name ?? person).includes('Elula')), false);
});

test('the same late lines on a reply that is not faded are applied (the check can tell)', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    const last = host.ctx.chat.length - 1;
    host.ctx.chat[last].mes = withAssist(host.ctx.chat[last].mes, ['+ present Elula'], { next: true });
    await host.send('Move on.', 'Later.');
    assert.equal((host.head().domains.scene?.present ?? []).some(person => String(person?.name ?? person).includes('Elula')), true);
});

test('the chatter queries and the Scene screen never carry the thoughts of a faded reply, also after a rebuild and a reload', async t => {
    t.mock.method(console, 'warn', () => {});
    const modules = [rulesModule()];
    const settings = { features: { 'story-block.chatter': true } };
    const host = await createHost({ modules, settings });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    await host.send('Accept.', 'Arn arrives.\n\n<Changes>\n+ present Arn\n</Changes>');
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.send('Go on.', `Death.\n\n<Changes>\n~ chatter Arn: ${GAMMA}\n</Changes>`);
    assert.equal(JSON.stringify(host.sdk.query('chatter.head', {})).includes(GAMMA), true, 'the thought is there before the restore');
    assert.equal(JSON.stringify(host.sdk.query('scene.chatter', {})).includes(GAMMA), true);
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    const gone = h => {
        assert.equal(JSON.stringify(h.sdk.query('chatter.head', {})).includes(GAMMA), false, 'chatter.head');
        assert.equal(JSON.stringify(h.sdk.query('scene.chatter', {})).includes(GAMMA), false, 'scene.chatter');
    };
    gone(host);
    host.store.rebuild();
    gone(host);
    const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules, { settings });
    t.after(() => fresh.close());
    gone(fresh);
});

test('savepoint.contract reports retainedChatRestore only once every reader of earlier messages is wired', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, true, 'the host wires them all');
    // a timeline whose readers are not all asked for
    const bare = createTimeline({ store: host.store, registry: host.registry, metadata: () => host.ctx.chatMetadata, chat: () => host.ctx.chat });
    assert.equal(bare.contract().snapshots, true);
    for (const [at, name] of ACTIVE_READERS.entries()) {
        assert.equal(bare.contract().retainedChatRestore, false, `not before ${name}`);
        bare.active(name);
        assert.equal(bare.contract().retainedChatRestore, at === ACTIVE_READERS.length - 1, `after ${name}`);
    }
    assert.throws(() => bare.active('some.other'), /not one of Story Block's readers/);
});

test('one rule says what is faded, one mechanism keeps it out of a request, and nothing else filters prompts', async () => {
    const read = async path => readFile(new URL(`../../src/v2/${path}`, import.meta.url), 'utf8');
    const coordinator = await read('timeline/coordinator.js');
    assert.equal((coordinator.match(/function activeLine\(/g) ?? []).length, 1);
    assert.equal((coordinator.match(/\.faded\b/g) ?? []).length, 1, 'the faded intervals are read in one place');
    assert.equal((coordinator.match(/function syncHidden\(/g) ?? []).length, 1, 'one function hides and shows');
    assert.equal((coordinator.match(/\.is_system = /g) ?? []).length, 1, 'the flag is set in the one `flip`');
    assert.match(coordinator.slice(coordinator.indexOf('async function history('), coordinator.indexOf('// ---- make')), /activeLine\(\{ ids: true \}\)/);
    for (const path of ['turn.js', 'sdk.js', 'runtime.js', 'domains/index.js']) {
        const source = (await read(path)).replace(/\/\/.*$/gm, '');
        assert.equal(/HOST_DOMAIN|domains\.savepoints|\bfaded:\s*\(|\.is_system\s*=[^=]|chatPrompt|textPrompt|intercept\(/.test(source), false, `${path} decides nothing about what is faded and filters no prompt`);
    }
    const asked = (await Promise.all(['turn.js', 'sdk.js', 'runtime.js'].map(read))).join('\n');
    for (const name of ACTIVE_READERS) assert.equal(asked.includes(`'${name}'`), true, `${name} is wired`);
});
