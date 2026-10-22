// The scene's weather (MODULES §F120, src/v2/domains/scene.js): `~ weather cold drizzle, low fog` keeps
// `scene.weather = { text, rev }`, read by the query `scene.weather` → { text } | null. Descriptive only.
// Captured with hostile input (markup, overlong text, invisible characters, no words, a wrong op: nothing
// saved on a refusal), under its feature `story-block.weather` (on by default; its grammar line is in the
// static part only while it is on, which then stays byte-identical), replayed on Re-read, swipes, a middle
// delete and a reload like the other scene fields, shown on Scene and Home, and added to the tail's Place
// line cut short.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { WEATHER_CHARS, WEATHER_FEATURE, WEATHER_TAIL_CHARS, initialScene, sceneTail, validateScene, weatherText } from '../../../src/v2/domains/scene.js';
import { homeScreen, sceneScreen } from '../../../src/v2/screens/index.js';
import { checkInvariants } from '../qa/helpers/oracle.js';
import { recordingWidgets, renderSkip, show, text } from '../screens/helpers.js';

const block = (story, lines) => `${story}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const staticText = host => host.st.requests.at(-1)?.chat?.[0]?.content ?? '';
const tailText = host => host.st.requests.at(-1).chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');
const lastIndex = host => host.ctx.chat.length - 1;

async function fresh(t, settings = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings });
    t.after(() => host.close());
    await host.send('Hello.', block('The road to the harbour.', ['~ place Vell Harbour | kind: settlement']));
    return host;
}

// ---------------------------------------------------------------------------------------------------
// Reading one line

test('a weather text is one plain line: markup and invisible characters out, cut by code points', () => {
    assert.equal(weatherText('~ weather cold drizzle, low fog'), 'cold drizzle, low fog');
    assert.equal(weatherText('- ~ weather: **cold** <b>drizzle</b>​, <img src=x onerror=alert(1)>low‮ fog'), 'cold drizzle , low fog');
    assert.equal(weatherText('~ weather a < b > c'), 'a c', 'what looks like a tag goes, brackets and all');
    assert.equal(weatherText('~ weather 5 > 3'), '5 3', 'a lone angle bracket is not kept either');
    const long = weatherText(`~ weather ${'𐐷'.repeat(200)}`);
    assert.equal(Array.from(long).length, WEATHER_CHARS);
    assert.ok(long.endsWith('…'));
    assert.ok(Array.from(long).slice(0, -1).every(point => point === '𐐷'), 'no character split in half');
    assert.equal(weatherText('~ weather ...'), '');
    assert.equal(weatherText('~ weather <i></i>'), '');
});

test('the validator: no weather is fine; a weather is a text of at most 60 code points and a rev', () => {
    assert.deepEqual(initialScene(), { place: { name: '', kind: '', region: '' }, present: [] }, 'absent until a reply writes one');
    const ok = { ...initialScene(), weather: { text: 'rain', rev: 3 } };
    assert.deepEqual(validateScene(ok), []);
    assert.match(validateScene({ ...ok, weather: 'rain' }).join(' '), /not a record/);
    assert.match(validateScene({ ...ok, weather: { text: ' ', rev: 3 } }).join(' '), /no text/);
    assert.match(validateScene({ ...ok, weather: { text: 'x'.repeat(61), rev: 3 } }).join(' '), /longer than 60/);
    assert.deepEqual(validateScene({ ...ok, weather: { text: '𐐷'.repeat(60), rev: 3 } }), [], 'counted in code points');
    assert.match(validateScene({ ...ok, weather: { text: 'rain', rev: -1 } }).join(' '), /rev/);
});

// ---------------------------------------------------------------------------------------------------
// Capture on the real host

test('~ weather keeps { text, rev } in the scene; scene.weather answers { text }; no receipt is told', async t => {
    const host = await fresh(t);
    assert.equal(host.sdk.query('scene.weather'), null, 'none until a reply writes one');
    await host.send('We walk.', block('Rain sets in.', ['~ weather cold drizzle, low fog']));
    const receipt = host.store.receipts().at(-1)?.receipt ?? host.store.receipts().at(-1);
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'cold drizzle, low fog' });
    assert.deepEqual(host.head().domains.scene.weather, { text: 'cold drizzle, low fog', rev: receipt.rev });
    assert.equal(receipt.narrate, false, 'never re-narrated');
    assert.deepEqual(host.turn.problems().filter(item => item.index === lastIndex(host)), []);
    // The same text again changes nothing (the rev stays the one it was written at).
    const was = host.head().domains.scene.weather;
    await host.send('On.', block('Still raining.', ['~ weather cold drizzle, low fog']));
    assert.deepEqual(host.head().domains.scene.weather, was);
    // A new one replaces it; the place and the people are not touched.
    await host.send('On.', block('It clears.', ['+ weather clear, a cold wind']));
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'clear, a cold wind' });
    assert.equal(host.sdk.query('scene.place').name, 'Vell Harbour');
    assert.doesNotMatch(host.ctx.chat[lastIndex(host)].mes.replace(/<!--[\s\S]*?-->/g, ''), /weather/, 'the line is hidden like any change line');
});

test('refused: a wrong op or no words; nothing is saved', async t => {
    const host = await fresh(t);
    await host.send('We walk.', block('Rain.', ['~ weather rain']));
    const before = JSON.stringify(host.head());
    await host.send('On.', block('Nothing.', ['- weather rain', '~ weather ...', '! weather storm']));
    const told = host.turn.problems().filter(item => item.index === lastIndex(host));
    assert.deepEqual(told.map(item => item.code), ['INVALID', 'INVALID', 'INVALID']);
    assert.match(told[0].message, /use ~ weather/);
    assert.match(told[1].message, /no words/);
    const after = host.head();
    assert.deepEqual(after.domains.scene, JSON.parse(before).domains.scene);
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'rain' });
});

test('the feature: on by default with its grammar line in a byte-identical static part; off: no line, a quiet Problem, null', async t => {
    const host = await fresh(t);
    assert.equal(host.features.on(WEATHER_FEATURE), true);
    const on = staticText(host);
    assert.match(on, /^~ weather cold drizzle, low fog \(only when the weather changes, not every reply; a few words, at most 60 characters\)$/m);
    await host.send('We walk.', block('Rain.', ['~ weather rain']));
    await host.send('On.', block('Fog.', ['~ weather fog']));
    assert.equal(staticText(host), on, 'the same bytes reply to reply, whatever the weather');
    host.features.set(WEATHER_FEATURE, false);
    await host.send('On.', block('Snow.', ['~ weather snow']));
    const off = staticText(host);
    assert.notEqual(off, on, 'changed once');
    assert.doesNotMatch(off, /weather/);
    const told = host.turn.problems().filter(item => item.index === lastIndex(host));
    assert.deepEqual(told.map(item => [item.code, item.quiet]), [['FEATURE_OFF', true]]);
    assert.equal(host.sdk.query('scene.weather'), null, 'the query is off with it');
    assert.equal(host.head().domains.scene.weather.text, 'fog', 'the line written while off changed nothing');
    await host.send('On.', 'More snow.');
    assert.equal(staticText(host), off);
    host.features.set(WEATHER_FEATURE, true);
    await host.send('On.', 'Thaw.');
    assert.equal(staticText(host), on, 'back on: the old bytes');
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'fog' });
});

test('the tail: the weather ends the Place line, cut to about 8 tokens, only while the feature is on', async t => {
    const host = await fresh(t);
    await host.send('We walk.', block('Rain.', ['~ weather cold drizzle, low fog']));
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^Place: Vell Harbour \(settlement\); cold drizzle, low fog$/m);
    await host.send('On.', block('A storm.', [`~ weather ${'a heavy storm rolling in off the grey sea '.repeat(2)}`]));
    await host.send('On.', 'On.');
    const line = tailText(host).split('\n').find(item => item.startsWith('Place: '));
    const added = line.slice('Place: Vell Harbour (settlement)'.length);
    assert.ok(Array.from(added).length <= 2 + WEATHER_TAIL_CHARS, 'the separator and at most the tail cut');
    assert.ok(added.endsWith('…'), 'cut, and marked so');
    assert.ok(Array.from(added).length <= 32, 'about 8 tokens at 4 characters a token');
    host.features.set(WEATHER_FEATURE, false);
    await host.send('On.', 'On.');
    assert.match(tailText(host), /^Place: Vell Harbour \(settlement\)$/m);
    // No place yet: no Place line, so no weather in the tail.
    const state = { domains: { scene: { ...initialScene(), weather: { text: 'rain', rev: 1 } } } };
    assert.deepEqual(sceneTail(state, { weather: true }), []);
});

// ---------------------------------------------------------------------------------------------------
// Replay: Re-read, swipes, a middle delete, a reload

test('Re-read, swipes, a middle delete and a reload keep the weather as a rebuild does', async t => {
    const host = await fresh(t);
    await host.send('We walk.', block('Rain.', ['~ weather rain']));
    const first = lastIndex(host);
    await host.send('On.', block('Fog.', ['~ weather fog']));
    const at = lastIndex(host);
    // Re-read of the unchanged reply.
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'fog' });
    // A swipe has its own weather; the other swipe without one rolls back to the reply before.
    await host.swipe(block('Sun.', ['~ weather bright sun']));
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'bright sun' });
    await host.swipe('No weather this time.');
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'rain' });
    await host.st.swipeTo(at, 0);
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'fog' });
    checkInvariants(host, 'after the swipes');
    // Deleting the reply that first wrote a weather: the later one's write replays whole (scratch).
    await host.st.deleteMessage(first);
    await host.st.deleteMessage(first - 1);
    assert.deepEqual(host.store.problems(), [], 'nothing skipped');
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'fog' });
    assert.deepEqual(validateScene(host.head().domains.scene), []);
    checkInvariants(host, 'after the middle delete');
    // Deleting the last one: no weather again.
    await host.st.deleteMessage(lastIndex(host));
    assert.equal(host.sdk.query('scene.weather'), null);
    // A fresh host over the saved chat (a reload) reads the same.
    await host.send('On.', block('Hail.', ['~ weather hail']));
    const other = await createHost({ st: { chat: host.ctx.chat } });
    t.after(() => other.close());
    assert.deepEqual(other.sdk.query('scene.weather'), { text: 'hail' });
    assert.deepEqual(other.head(), host.head());
});

// ---------------------------------------------------------------------------------------------------
// Scene and Home

test('Scene and Home show the weather as text; none without one', { skip: renderSkip }, async t => {
    const host = await fresh(t);
    const query = (name, args) => host.sdk.query(name, args);
    assert.equal(show(sceneScreen, { state: host.head(), query }).el.querySelectorAll('.weather').length, 0);
    await host.send('We walk.', block('Rain.', ['~ weather <b>cold</b> drizzle, low fog']));
    for (const screen of [sceneScreen, homeScreen]) {
        const { el, view } = show(screen, { state: host.head(), query, widgets: recordingWidgets().widgets });
        assert.deepEqual(view.warnings, [], screen.id);
        assert.equal(text(el.querySelector('.weather')), 'cold drizzle, low fog', screen.id);
        assert.equal(el.querySelectorAll('.weather b').length, 0);
    }
    host.features.set(WEATHER_FEATURE, false);
    assert.equal(show(sceneScreen, { state: host.head(), query }).el.querySelectorAll('.weather').length, 0, 'off: not shown');
});
