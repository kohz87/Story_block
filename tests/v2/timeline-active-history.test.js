// E6b review fix 3: after a restore, the replies and the reader's messages it faded never reach a generation request. One
// active-history filter (src/v2/timeline/active.js, fed by the coordinator's one rule) serves both prompt paths and every host
// reader of earlier messages, and `savepoint.contract` reports retainedChatRestore only while every one of them is wired.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHost } from '../../testkit/index.js';
import { withAssist } from '../../src/v2/capture.js';
import { ACTIVE_READERS, createTimeline } from '../../src/v2/timeline/index.js';
import { createActiveHistory } from '../../src/v2/timeline/active.js';
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

for (const mainApi of ['openai', 'textgen']) {
    test(`${mainApi}: history marks the secrets inactive and the next request carries none of them, nor after a reload or a rebuild`, async t => {
        const { host, modules } = await world(t, { mainApi });
        const history = await host.sdk.timeline.history({});
        assert.deepEqual(history.messages.map(x => x.active), [true, true, true, true, false, false, false]);
        for (const secret of SECRETS) assert.equal(history.messages.some(x => x.active && x.text.includes(secret)), false);
        await host.send('Move on.', 'Later.');
        const next = host.st.requests.at(-1);
        for (const secret of SECRETS) assert.equal(seen(next).includes(secret), false, `${secret} reached the request`);
        assert.match(text(next), /Before\./);
        assert.match(text(next), /Accept the job\./);
        assert.match(text(next), /Move on\./);
        assert.equal(text(next).includes('Death.'), false, 'the restoring reply is faded too');
        // a swipe, a regenerate and a Continue of the new reply
        for (const [type, reply] of [['swipe', 'Later, again.'], ['regenerate', 'Later, once more.'], ['continue', ' And on.']]) {
            await host.st.generate(type, { reply });
            for (const secret of SECRETS) assert.equal(seen(host.st.requests.at(-1)).includes(secret), false, `${type}: ${secret}`);
        }
        // a rebuild and a start again from the chat file
        host.store.rebuild();
        await host.send('Again.', 'Once more.');
        for (const secret of SECRETS) assert.equal(seen(host.st.requests.at(-1)).includes(secret), false, `rebuild: ${secret}`);
        const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules, { st: { mainApi } });
        t.after(() => fresh.close());
        await fresh.send('After reload.', 'Fine.');
        for (const secret of SECRETS) assert.equal(seen(fresh.st.requests.at(-1)).includes(secret), false, `reload: ${secret}`);
        assert.match(text(fresh.st.requests.at(-1)), /Before\./);
    });
}

// A prompt-only regex (SillyTavern's own feature: it changes the text of the prompt, never the chat) takes out the words a text
// match would have used. The faded messages are tied to the request by who spoke and which swipe, so they go all the same.
for (const mainApi of ['openai', 'textgen']) {
    test(`${mainApi}: a prompt-only regex over the history does not let faded text through, also after a rebuild and a reload`, async t => {
        const { host, modules } = await world(t, { mainApi });
        const rules = [{ find: /Target, and /g }, { find: /I say: /g }, { find: / Continued: /g }, { find: /Accept the job\./g, replace: 'Accept.' }];
        host.st.promptRegex.push(...rules);
        await host.send('Move on.', 'Later.');
        let next = host.st.requests.at(-1);
        for (const secret of SECRETS) assert.equal(seen(next).includes(secret), false, `${secret} reached the request`);
        assert.match(text(next), /Before\./);
        assert.match(text(next), /Accept\./, 'the regex did run over what is left');
        assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, true);
        assert.equal(host.turn.problems().some(problem => problem.code === 'HISTORY_UNTIED'), false);
        host.store.rebuild();
        await host.send('Again.', 'Once more.');
        for (const secret of SECRETS) assert.equal(seen(host.st.requests.at(-1)).includes(secret), false, `rebuild: ${secret}`);
        // a swipe, which leaves out the reply being swiped
        await host.swipe('Later, again.');
        for (const secret of SECRETS) assert.equal(seen(host.st.requests.at(-1)).includes(secret), false, `swipe: ${secret}`);
        const fresh = await reload(createHost, { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) }, modules, { st: { mainApi } });
        t.after(() => fresh.close());
        fresh.st.promptRegex.push(...rules);
        await fresh.send('After reload.', 'Fine.');
        next = fresh.st.requests.at(-1);
        for (const secret of SECRETS) assert.equal(seen(next).includes(secret), false, `reload: ${secret}`);
        assert.match(text(next), /Before\./);
        assert.equal(fresh.sdk.query('savepoint.contract', {}).retainedChatRestore, true);
    });
}

test('a request that cannot be tied to the chat is a Problem and retainedChatRestore is false for that chat, until a request is tied', async t => {
    const { host } = await world(t);
    const intercept = host.st.interceptor;
    host.st.interceptor = (coreChat, ...rest) => intercept([...coreChat].reverse(), ...rest);
    await host.send('Move on.', 'Later.');
    assert.equal(host.turn.problems().filter(problem => problem.code === 'HISTORY_UNTIED').length, 1);
    assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, false);
    // the second line over the finished request still takes the faded words it can find
    for (const secret of SECRETS) assert.equal(seen(host.st.requests.at(-1)).includes(secret), false, secret);
    await host.send('Again.', 'Still.');
    assert.equal(host.turn.problems().filter(problem => problem.code === 'HISTORY_UNTIED').length, 1, 'told once');
    host.st.interceptor = intercept;
    await host.send('Tied.', 'Now.');
    assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, true);
});

test('a reply that is not faded, whose words are the same as a faded one, stays in the request', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Go.', 'The same words.');
    await host.send('Accept.', 'Target.');
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.send('Go.', 'The same words.');
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    await host.send('Later.', 'Fine.');
    const contents = host.st.requests.at(-1).chat.map(entry => entry.content);
    assert.equal(contents.filter(content => content === 'The same words.').length, 1, 'the active one stays, the faded one goes');
    assert.equal(contents.filter(content => content === 'Go.').length, 1);
    assert.equal(contents.includes('Target.'), false);
});

test('a chat that never restored builds the request it always did', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    await host.send('Next.', 'Second.');
    const contents = host.st.requests.at(-1).chat.map(entry => entry.content);
    for (const part of ['Begin.', 'Before.', 'Next.']) assert.equal(contents.includes(part), true);
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

test('savepoint.contract reports retainedChatRestore only once every host reader of earlier messages is wired', async t => {
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
    assert.throws(() => bare.active('some.other'), /not a host reader/);
});

test('the filter cuts a request from the newest message back, so a later message is never taken for an earlier one', () => {
    const chat = [{ mes: 'Same.' }, { mes: 'Gone.' }, { mes: 'Same.' }];
    const reader = createActiveHistory({ messages: () => chat, faded: () => new Set([0]) }).reader('prompt.chat');
    // the oldest message was left out of the request (a full context): the later 'Same.' is not the faded one
    assert.deepEqual(reader.chatPrompt([{ role: 'assistant', content: 'Gone.' }, { role: 'assistant', content: 'Same.' }]), [{ role: 'assistant', content: 'Gone.' }, { role: 'assistant', content: 'Same.' }]);
    assert.equal(reader.textPrompt('A\nNarrator: Gone.\nNarrator: Same.\n'), 'A\nNarrator: Gone.\nNarrator: Same.\n');
    const both = createActiveHistory({ messages: () => chat, faded: () => new Set([0, 1]) }).reader('prompt.text');
    assert.equal(both.textPrompt('Narrator: Same.\nNarrator: Gone.\nNarrator: Same.\n'), 'Narrator: Same.\n');
});

test('one rule says what is faded and one filter applies it: no second copy', async () => {
    const read = async path => readFile(new URL(`../../src/v2/${path}`, import.meta.url), 'utf8');
    const coordinator = await read('timeline/coordinator.js');
    assert.equal((coordinator.match(/function activeLine\(/g) ?? []).length, 1);
    assert.equal((coordinator.match(/\.faded\b/g) ?? []).length, 1, 'the faded intervals are read in one place');
    assert.match(coordinator.slice(coordinator.indexOf('async function history('), coordinator.indexOf('// ---- make')), /activeLine\(\{ ids: true \}\)/);
    for (const path of ['turn.js', 'sdk.js', 'runtime.js', 'domains/index.js']) {
        assert.equal(/HOST_DOMAIN|domains\.savepoints|\bfaded:/.test((await read(path)).replace(/\/\/.*$/gm, '')), false, `${path} decides nothing about what is faded`);
    }
    // every named reader is asked for in the host, and only there
    const asked = (await Promise.all(['turn.js', 'sdk.js', 'runtime.js'].map(read))).join('\n');
    for (const name of ACTIVE_READERS) assert.equal(asked.includes(`'${name}'`), true, `${name} is wired`);
});
