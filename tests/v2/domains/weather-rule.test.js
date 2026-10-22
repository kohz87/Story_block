// The weather a module sets by rule (MODULES §F122, src/v2/domains/scene.js `scene.weather`): a `system`
// step writes `{ text, rev, key }`, the story's `~ weather` writes `{ text, rev }` and so takes the key
// away, and a step without text marks the story's weather with a key, its words kept. Refused for the
// story's cause and for bad keys (nothing saved), off with `story-block.weather`. A module's afterCapture
// step that sets it is kept on the reply: Re-read, swipe, rebuild and reload give the live state.
// Also a pack's `weather` table (validation, `packs.weather`) and the money rule that comes with it: an
// amount in a coin the chat does not know is refused, never read as that many of its money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { WEATHER_KEY_CHARS, validateScene } from '../../../src/v2/domains/scene.js';
import { currencyOf, foreignCoin, parseAmount } from '../../../src/v2/domains/money.js';
import { validatePack, weatherOf } from '../../../src/v2/packs/index.js';
import { checkInvariants } from '../qa/helpers/oracle.js';

const block = (story, lines) => `${story}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const lastIndex = host => host.ctx.chat.length - 1;
const weather = host => host.head().domains.scene.weather;
const system = (host, payload) => host.bus.command('scene.weather', payload, { cause: 'system' });

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', block('The road to the harbour.', ['~ place Vell Harbour | kind: settlement']));
    return host;
}

test('scene.weather: a system step sets the weather with its key; the same again changes nothing', async t => {
    const host = await fresh(t);
    const set = await system(host, { text: 'cold <b>drizzle</b>, low fog', key: 'day 3 | the Lowmere' });
    assert.equal(set.ok, true, set.message);
    assert.deepEqual({ ...weather(host), rev: 0 }, { text: 'cold drizzle , low fog', rev: 0, key: 'day 3 | the Lowmere' });
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'cold drizzle , low fog' });
    assert.equal(set.receipt.narrate, false);
    const again = await system(host, { text: 'cold drizzle , low fog', key: 'day 3 | the Lowmere' });
    assert.equal(again.receipt.data.same, true);
    assert.deepEqual(validateScene(host.head().domains.scene), []);
});

test('scene.weather: the story\'s ~ weather takes the key away; a step without text marks the story\'s words', async t => {
    const host = await fresh(t);
    await system(host, { text: 'clear and mild', key: 'd1' });
    await host.send('Look up.', block('Clouds roll in.', ['~ weather heavy rain']));
    assert.equal(weather(host).text, 'heavy rain');
    assert.equal(weather(host).key, undefined, 'the story\'s weather carries no key');
    const marked = await system(host, { key: 'd1' });
    assert.equal(marked.ok, true, marked.message);
    assert.deepEqual([weather(host).text, weather(host).key], ['heavy rain', 'd1'], 'words kept, key set');
    assert.equal((await system(host, { key: 'd1' })).receipt.data.same, true);
});

test('scene.weather refusals save nothing: the story\'s cause, a bad key, no text and no weather, no words', async t => {
    const host = await fresh(t);
    const before = structuredClone(host.head());
    const story = host.bus.command('scene.weather', { text: 'sun' }, { cause: 'story' });
    assert.equal(story.ok, false);
    assert.match(story.message, /~ weather line/);
    assert.equal((await system(host, { key: 'd1' })).code, 'NOT_FOUND', 'nothing to mark yet');
    assert.equal((await system(host, { text: 'sun', key: 5 })).code, 'INVALID');
    assert.equal((await system(host, { text: 'sun', key: 'x'.repeat(WEATHER_KEY_CHARS + 1) })).code, 'INVALID');
    assert.equal((await system(host, { text: '<i></i> !!' })).code, 'INVALID');
    assert.equal((await system(host, { text: 42 })).code, 'INVALID');
    assert.deepEqual(host.head().domains, before.domains);
    assert.match(validateScene({ place: { name: '', kind: '', region: '' }, present: [], weather: { text: 'sun', rev: 1, key: '' } })[0], /key/);
});

test('scene.weather is off with story-block.weather', async t => {
    const host = await fresh(t);
    host.features.set('story-block.weather', false);
    const off = await system(host, { text: 'sun', key: 'd1' });
    assert.equal(off.ok, false);
    assert.equal(off.code, 'FEATURE_OFF');
    assert.equal(weather(host), undefined);
});

// A module that sets the weather right after the reply's lines when its key changes (as Story Director does).
const skyModule = () => ({
    id: 'sky-test',
    name: 'Sky test',
    version: '1.0.0',
    hooks: {
        afterCapture(view) {
            const scene = view.state.domains.scene;
            const key = `at ${scene.place.name}`;
            if (scene.weather?.key === key) return undefined;
            return { commands: [{ type: 'scene.weather', payload: scene.weather && !scene.weather.key ? { key } : { text: `fair over ${scene.place.name}`, key } }] };
        },
    },
});

test('a module\'s afterCapture weather step: kept on the reply, Re-read, swipe, delete and reload give the live state', async t => {
    const host = await fresh(t, { modules: [skyModule()] });
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'fair over Vell Harbour' }, 'set in the first reply');
    await host.send('We sail.', block('Out to sea.', ['~ place Grey Shoals | kind: wild']));
    assert.deepEqual(host.sdk.query('scene.weather'), { text: 'fair over Grey Shoals' });
    const at = lastIndex(host);
    const live = structuredClone(host.head());
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(host.head().domains, live.domains, 'Re-read of the unchanged reply');
    // The story's own weather wins for that key: the step only marks it.
    await host.swipe(block('A squall.', ['~ place Grey Shoals | kind: wild', '~ weather squall, white caps']));
    assert.deepEqual([weather(host).text, weather(host).key], ['squall, white caps', 'at Grey Shoals']);
    await host.send('On.', block('Still at sea.', ['+ present Captain Ro']));
    assert.equal(weather(host).text, 'squall, white caps', 'the same key: the story\'s word stands');
    checkInvariants(host, 'after the swipe');
    await host.st.deleteMessage(at);
    await host.st.deleteMessage(at - 1);
    assert.deepEqual(host.store.problems(), [], 'nothing skipped');
    checkInvariants(host, 'after a middle delete');
    const other = await createHost({ modules: [skyModule()], st: { chat: host.ctx.chat } });
    t.after(() => other.close());
    assert.deepEqual(other.head(), host.head(), 'a reload reads the same');
});

test('a pack\'s weather table: normalized, read through packs.weather; bad shapes refused', () => {
    const base = { id: 'sky', version: '1.0.0', requires: { storyBlock: '^2' } };
    const good = validatePack({ ...base, weather: {
        seasons: [{ name: 'winter', months: ['Frostfall', 'Deepwinter'] }],
        tables: [{ season: 'winter', region: 'Shornmarch', weather: ['hard frost,   clear sky', 'snow on the wind'] }, { weather: ['grey and mild'] }],
    } });
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    assert.deepEqual(weatherOf([good.pack]), {
        pack: 'sky',
        seasons: [{ name: 'winter', months: ['Frostfall', 'Deepwinter'] }],
        tables: [{ season: 'winter', region: 'Shornmarch', weather: ['hard frost, clear sky', 'snow on the wind'] }, { season: '', region: '', weather: ['grey and mild'] }],
    });
    assert.equal(validatePack(base).pack.weather, undefined, 'a pack without one normalizes as before');
    assert.equal(weatherOf([validatePack(base).pack]), null);
    const refused = (weather, code = 'BAD_WEATHER') => {
        const out = validatePack({ ...base, weather });
        assert.equal(out.ok, false, JSON.stringify(weather));
        assert.ok(out.errors.some(error => error.code === code), JSON.stringify(out.errors));
    };
    refused('rainy');
    refused({ tables: [] });
    refused({ tables: [{ weather: [] }] });
    refused({ tables: [{ weather: ['x'.repeat(61)] }] });
    refused({ tables: [{ weather: [7] }] });
    refused({ tables: [{ weather: ['sun'], climate: 'hot' }] });
    refused({ tables: [{ weather: ['sun'], region: 5 }] });
    refused({ seasons: [{ name: 'winter', months: ['A'] }, { name: 'spring', months: ['a'] }], tables: [{ weather: ['sun'] }] });
    refused({ seasons: [{ name: '', months: ['A'] }], tables: [{ weather: ['sun'] }] });
    refused({ tables: [{ weather: ['sun'] }], forecast: true }, 'UNKNOWN_FIELD');
    refused({ tables: [{ weather: ['<script>alert(1)</script>'] }], }, 'UNSAFE_HTML');
});

test('money: an amount in a coin the chat does not know is refused, never that many of its money', () => {
    const pennies = currencyOf({ currency: 'penny', currencyPlural: 'pennies' });
    assert.deepEqual(parseAmount('40', pennies), { amount: 40 });
    assert.deepEqual(parseAmount('40 pennies', pennies), { amount: 40 });
    assert.deepEqual(parseAmount('40 coins', pennies), { amount: 40 });
    assert.match(parseAmount('40 silver', pennies).error, /"silver" is not this chat's money: it counts in pennies/);
    assert.match(parseAmount('5 pieces of gold', pennies).error, /"gold"/);
    assert.equal(foreignCoin('40 silver', pennies), 'silver');
    assert.equal(foreignCoin('40 silver', currencyOf({ currency: 'penny', coins: [{ name: 'penny', value: 1 }, { name: 'silver', value: 10 }] })), '', 'with coins, coinValue decides');
    const gold = currencyOf({});
    assert.deepEqual(parseAmount('30 gp', gold), { amount: 30 }, 'gp is gold pieces');
    assert.deepEqual(parseAmount('30 gold coins', gold), { amount: 30 });
    assert.match(parseAmount('3 crowns', gold).error, /"crowns" is not this chat's money: it counts in gold/);
});

test('+ coin 40 silver where money is pennies: a Problem, the wallet unchanged', async t => {
    const host = await fresh(t, { settings: { modules: { 'story-block': { currency: 'penny', currencyPlural: 'pennies' } } } });
    const before = host.sdk.query('inventory.wallet', { owner: 'party' });
    await host.send('Pay me.', block('She counts out forty silver.', ['+ coin 40 silver | from: Elula']));
    assert.deepEqual(host.sdk.query('inventory.wallet', { owner: 'party' }), before);
    const told = host.turn.problems().filter(item => item.index === lastIndex(host)).map(item => item.message);
    assert.ok(told.some(message => /"silver" is not this chat's money: it counts in pennies/.test(message)), JSON.stringify(told));
});
