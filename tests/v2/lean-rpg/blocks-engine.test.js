// The Standard formula's blocks as the block engine runs them: Health 0..8, Stamina 0..7 and Mana 0..7 count the blocks left (the bar's size
// comes from the stats), the story writes stage words and the kinds turn them into blocks, a bar that grows gains its new block full (a Down
// character stays Down), one that shrinks holds at most its new size and never knocks anyone Down, a Foes group's Health follows its class, the
// tail and the sheet reader say it in words, and live = reload = rebuild. Classic's templates are byte-for-byte what they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES, STANDARD_TEMPLATES, COMBAT_PROMPT_STANDARD, templatesFor } from '../../../src/v2/lean-rpg/templates.js';
import { STAGES } from '../../../src/v2/lean-rpg/names.js';
import { readSheet } from '../../../src/v2/lean-rpg/read.js';
import { blocksFor, foeHealthBlocks } from '../../../src/v2/lean-rpg/formula.js';
import { summaryOf } from '../../../src/v2/data-modules/part.js';
import { validateDataModules, DM_LIMITS as L } from '../../../src/v2/data-modules/check.js';
import { fullModuleGrammar } from '../../../src/v2/data-modules/grammar.js';
import { reply, success, view, rebuilt, reload } from '../data-modules/helpers.js';

const CHECK = { packId: 'chat', capabilities: ['data-modules-v1', 'story-director'] };
const standard = name => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition);
const sheet = (host, slug) => view(host, `pack.chat/${slug}`).chat;
const set = async (host, slug, fields) => success(await host.sdk.command('dm.set', { module: `pack.chat/${slug}`, fields }));
// A line's sign is its kind's op: `+` for add-xp, `~` for the set kinds.
const say = (slug, kind, extra) => `${kind === 'add-xp' ? '+' : '~'} dm ${slug} — why | kind: ${kind}${extra}`;
async function story(t, ...names) {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (const name of names) success(await host.sdk.command('dm.define', { definition: standard(name) }));
    return host;
}
const bars = host => { const c = sheet(host, 'character'); return [c.health, c.stamina, c.mana]; };

// Classic: the checked definitions the block engine pins, hashed. These were computed on the build's base (2.13.0) before any change.
const CLASSIC_HASHES = {
    Character: '60b845ebb1c2f41bb631bd84894c467b222c43804ae8de87ac4da76cc511b112',
    Skills: '87692b232c660a4b13a45f81571c6d5e69002037f920c77c786b9fe6c6eba5c5',
    Foes: 'd6e980f381748e3bc43cc0522bc29f6c264f01ab185076673018102d560269e8',
    'Combat rules': '65ee8a16d315bf429e134cf4ed705218a550df6d9d35f6e174f6f452cb12968d',
};

test('Classic stays exactly as it was: the four templates and the hash of each checked definition are unchanged, and a Classic chat gets them', () => {
    assert.deepEqual(LEAN_RPG_TEMPLATES.map(entry => entry.name), ['Character', 'Skills', 'Foes', 'Combat rules']);
    for (const { name, definition } of LEAN_RPG_TEMPLATES) {
        const checked = validateDataModules([structuredClone(definition)], CHECK);
        assert.equal(createHash('sha256').update(JSON.stringify(checked.definitions[0])).digest('hex'), CLASSIC_HASHES[name], name);
    }
    assert.equal(templatesFor('classic'), LEAN_RPG_TEMPLATES);
    assert.equal(templatesFor('standard'), STANDARD_TEMPLATES);
    assert.equal(templatesFor(undefined), STANDARD_TEMPLATES, 'Standard is the default');
    assert.equal(LEAN_RPG_TEMPLATES[0].definition.state.health.max, 5);
    assert.equal(LEAN_RPG_TEMPLATES[0].definition.state.health.blocks, undefined);
});

test('the Standard templates are the same four blocks, version 2, each passing the checker and the limits', () => {
    assert.deepEqual(STANDARD_TEMPLATES.map(entry => entry.name), LEAN_RPG_TEMPLATES.map(entry => entry.name));
    assert.deepEqual(STANDARD_TEMPLATES.map(entry => entry.definition.role), ['character', 'skills', 'foes', 'rules']);
    for (const { name, definition } of STANDARD_TEMPLATES) {
        const checked = validateDataModules([structuredClone(definition)], CHECK);
        assert.equal(checked.ok, true, `${name}: ${JSON.stringify(checked.errors)}`);
        assert.ok(Buffer.byteLength(JSON.stringify(definition)) <= L.definitionBytes, name);
        assert.ok(Object.keys(definition.state).length <= L.fields && Object.keys(definition.kinds).length <= L.kinds, name);
    }
    for (const name of ['Character', 'Foes', 'Combat rules']) assert.equal(standard(name).stateVersion, 2, name);
    assert.ok(COMBAT_PROMPT_STANDARD.length <= L.prompt, 'the Combat rules text fits the block\'s 1200');
    for (const heading of ['No Plot Armor:', 'Exchanges:', 'Weight & Risk:', 'Believable Outcomes:', 'Rolls:']) assert.ok(COMBAT_PROMPT_STANDARD.includes(heading), heading);
});

test('the Standard Character: Health 0..8, Stamina 0..7, Mana 0..7 marked as bars with no fixed names, stats from 5, 4 points a Soul Class, hidden bar sizes', () => {
    const { state, rules } = standard('Character');
    assert.deepEqual([state.health, state.stamina, state.mana].map(field => [field.min, field.max, field.blocks, field.names]), [[0, 8, 'health', undefined], [0, 7, 'stamina', undefined], [0, 7, 'mana', undefined]]);
    assert.deepEqual([state.health.default, state.stamina.default, state.mana.default], [5, 4, 4], 'full for stats of 5');
    for (const stat of ['str', 'vit', 'agi', 'dex', 'int', 'luk', 'cha']) assert.deepEqual([state[stat].min, state[stat].max, state[stat].default], [1, 20, 5], stat);
    for (const key of ['health-blocks', 'stamina-blocks', 'mana-blocks']) assert.deepEqual([state[key].prompt, state[key].edit], [false, false], `${key} is the rules' own`);
    assert.deepEqual(rules.map(rule => rule.id), ['health-bar', 'stamina-bar', 'mana-bar', 'class-up']);
    assert.deepEqual(rules.at(-1).then.at(-1), { op: 'add', path: ['points'], value: 4, bounds: 'clamp' });
    assert.deepEqual(standard('Foes').state.hurt1, { type: 'int', min: 0, max: 8, default: 4, label: 'Health 1', blocks: 'foe' });
});

test('the narrator\'s grammar for the bars is still the stage words, never block counts', async t => {
    const host = await story(t, 'Character', 'Foes');
    const grammar = fullModuleGrammar(standard('Character'), 'character');
    assert.match(grammar, /kind: set-health \| to: Down\|Badly wounded\|Wounded\|Hurt\|Scratched\|Unhurt \(0\.\.5\)/);
    assert.match(grammar, /kind: set-stamina \| to: Empty\|Spent\|Tired\|Winded\|Fresh \(0\.\.4\)/);
    assert.match(fullModuleGrammar(standard('Foes'), 'foes'), /kind: hurt-1 \| to: Down\|Badly wounded\|Wounded\|Hurt\|Scratched\|Unhurt/);
    await host.send('Hit.', reply(say('character', 'set-health', ' | to: Splendid')));
    assert.deepEqual(bars(host), [5, 4, 4], 'a word that is not a stage is refused, nothing applied');
});

test('the story writes a word and the kind turns it into blocks for the bar\'s size: first word 0, last the full bar, the nearest block between', async t => {
    const host = await story(t, 'Character');
    await set(host, 'character', { vit: 10, agi: 15, int: 5 }); // Health 6, Stamina 6, Mana 4
    assert.deepEqual(bars(host), [6, 6, 4]);
    const expected = { Down: 0, 'Badly wounded': 1, Wounded: 2, Hurt: 4, Scratched: 5, Unhurt: 6 }; // round(index × 6 / 5), halves up
    for (const [word, blocks] of Object.entries(expected)) {
        await host.send('Hit.', reply(say('character', 'set-health', ` | to: ${word}`)));
        assert.equal(sheet(host, 'character').health, blocks, `${word} of 6`);
        await host.send('Mend.', reply(say('character', 'set-health', ' | to: Unhurt')));
    }
    for (const [word, blocks] of Object.entries({ Empty: 0, Spent: 2, Tired: 3, Winded: 5, Fresh: 6 })) {
        await host.send('Run.', reply(say('character', 'set-stamina', ` | to: ${word}`)));
        assert.equal(sheet(host, 'character').stamina, blocks, `${word} of 6`);
    }
    await host.send('Cast.', reply(say('character', 'set-mana', ' | to: Steady')));
    assert.equal(sheet(host, 'character').mana, 3, 'Steady is three quarters of four blocks');
    rebuilt(host);
});

test('a bar that grows gains its new block full: the blocks already there stay as they were', async t => {
    const host = await story(t, 'Character');
    await host.send('Hit.', reply(say('character', 'set-health', ' | to: Hurt'))); // 3 of 5
    assert.equal(sheet(host, 'character').health, 3);
    await set(host, 'character', { vit: 10, points: 1 }); // Health 6: the new block comes full
    assert.deepEqual([sheet(host, 'character').health, sheet(host, 'character')['health-blocks']], [4, 6]);
    await set(host, 'character', { vit: 15, agi: 10, int: 10 }); // Health 7, Stamina 5, Mana 5: each gains one full block
    assert.deepEqual(bars(host), [5, 5, 5]);
    assert.deepEqual(['health-blocks', 'stamina-blocks', 'mana-blocks'].map(key => sheet(host, 'character')[key]), [7, 5, 5]);
    await set(host, 'character', { vit: 20 }); // 8
    assert.equal(sheet(host, 'character').health, 6);
    rebuilt(host);
});

test('a Down character stays Down when a bar grows: the new block does not stand them up', async t => {
    const host = await story(t, 'Character');
    await host.send('Hit.', reply(say('character', 'set-health', ' | to: Down')));
    assert.equal(sheet(host, 'character').health, 0);
    await set(host, 'character', { vit: 10 });
    assert.deepEqual([sheet(host, 'character').health, sheet(host, 'character')['health-blocks']], [0, 6], 'still Down, and the bar is one block bigger');
    await host.send('Mend.', reply(say('character', 'set-health', ' | to: Unhurt')));
    assert.equal(sheet(host, 'character').health, 6, 'a full bar is the new size');
    rebuilt(host);
});

test('a lower stat shrinks the bar and holds the current value at the new size; it never knocks a character Down', async t => {
    const host = await story(t, 'Character');
    await set(host, 'character', { vit: 20, agi: 20, int: 20 }); // Health 8, Stamina 7, Mana 7: all gained full
    assert.deepEqual(bars(host), [8, 7, 7]);
    await set(host, 'character', { vit: 5, agi: 5, int: 5 });
    assert.deepEqual(bars(host), [5, 4, 4], 'the value is held at the new size');
    assert.deepEqual(['health-blocks', 'stamina-blocks', 'mana-blocks'].map(key => sheet(host, 'character')[key]), [5, 4, 4]);
    await host.send('Hit.', reply(say('character', 'set-health', ' | to: Badly wounded'), say('character', 'set-mana', ' | to: Drained')));
    const hurt = bars(host);
    await set(host, 'character', { vit: 1, int: 1 }); // below the bars' floor: 4 and 3 blocks
    assert.equal(sheet(host, 'character').health, Math.min(hurt[0], 4));
    assert.ok(sheet(host, 'character').health > 0, 'never Down by a lower stat');
    assert.equal(sheet(host, 'character').down, false);
    rebuilt(host);
});

test('spending points (several fields in one edit) grows the bar in the same step, and live = reload = rebuild after swipes and a reload', async t => {
    const host = await story(t, 'Character');
    await host.send('Fight.', reply(say('character', 'add-xp', ' | amount: 100'), say('character', 'set-health', ' | to: Hurt')));
    assert.deepEqual([sheet(host, 'character').soul, sheet(host, 'character').points], [2, 4], 'a Soul Class rise gives 4 points');
    await set(host, 'character', { vit: 10, str: 6, points: 0 });
    assert.deepEqual([sheet(host, 'character').health, sheet(host, 'character').points], [4, 0]);
    rebuilt(host);
    await reload(host);
    await host.swipe(reply(say('character', 'set-health', ' | to: Scratched')));
    // the swipe takes the reply with the XP and the spent points back (they were made on it), so the bar is the size its stats give again
    const now = sheet(host, 'character');
    assert.equal(now.health, 4, 'Scratched of 5');
    assert.equal(now['health-blocks'], blocksFor(now).health);
    rebuilt(host);
    await reload(host);
});

test('Rest fills stamina and mana to the size their stats give', async t => {
    const host = await story(t, 'Character');
    await set(host, 'character', { agi: 15, int: 10 });
    await host.send('Run.', reply(say('character', 'set-stamina', ' | to: Empty'), say('character', 'set-mana', ' | to: Empty')));
    assert.deepEqual([sheet(host, 'character').stamina, sheet(host, 'character').mana], [0, 0]);
    success(await host.sdk.command('dm.act', { module: 'pack.chat/character', kind: 'button-rest' }));
    assert.deepEqual([sheet(host, 'character').stamina, sheet(host, 'character').mana], [6, 5], 'AGI 15 gives 6 stamina blocks, INT 10 gives 5 mana blocks');
});

test('a Foes group\'s Health is blocks left out of 4 + class/2: it arrives full, the story hurts it by words, and Down means 0', async t => {
    const host = await story(t, 'Foes');
    await host.send('A drake.', reply('+ dm foes — why | kind: set-slot-1 | name: Weir-drake | count: 1 | class: 4', '+ dm foes — why | kind: set-slot-2 | name: Sluice Rat | count: 2 | class: 1'));
    assert.deepEqual([sheet(host, 'foes').hurt1, sheet(host, 'foes').hurt2], [foeHealthBlocks(4), foeHealthBlocks(1)]);
    assert.deepEqual([sheet(host, 'foes').hurt1, sheet(host, 'foes').hurt2], [6, 4]);
    await host.send('Hit.', reply(say('foes', 'hurt-1', ' | to: Scratched'), say('foes', 'hurt-2', ' | to: Wounded')));
    assert.deepEqual([sheet(host, 'foes').hurt1, sheet(host, 'foes').hurt2], [5, 2]);
    await host.send('Finish.', reply(say('foes', 'hurt-1', ' | to: Down')));
    assert.equal(sheet(host, 'foes').hurt1, 0);
    await host.send('Gone.', reply('- dm foes — why | kind: clear-1 | why: down'));
    assert.deepEqual([sheet(host, 'foes').count1, sheet(host, 'foes').hurt1], [0, 4], 'a cleared slot goes back to its default');
    rebuilt(host);
});

test('the tail says the bars in words spread over the size (never block counts), leaves a full bar out, and the foes the same', async t => {
    const host = await story(t, 'Character', 'Foes');
    await set(host, 'character', { who: 'Wessel', vit: 10, agi: 10, int: 5 });
    assert.match(summaryOf(host.head(), 'pack.chat/character'), /^Wessel — STR 5 VIT 10 AGI 10 DEX 5 INT 5 LUK 5 CHA 5; soul I\.$/, 'full bars are left out');
    await set(host, 'character', { health: 4, stamina: 2, mana: 4 });
    const line = summaryOf(host.head(), 'pack.chat/character');
    assert.match(line, /^Wessel — health Hurt; stamina Tired; STR 5 /, '4 of 6 is Hurt, 2 of 5 is Tired');
    assert.doesNotMatch(line, /\b(of 6|blocks|health 4|stamina 2)\b/);
    assert.doesNotMatch(line, /health-blocks|stamina-blocks|mana-blocks/, 'the sizes are the rules\' own');
    await host.send('A drake.', reply('+ dm foes — why | kind: set-slot-1 | name: Weir-drake | count: 1 | class: 4'));
    assert.equal(summaryOf(host.head(), 'pack.chat/foes'), 'Foes: Weir-drake (Class IV).');
    await host.send('Hit.', reply(say('foes', 'hurt-1', ' | to: Scratched')));
    assert.equal(summaryOf(host.head(), 'pack.chat/foes'), 'Foes: Weir-drake (Class IV, Scratched).');
});

test('the sheet reader gives the blocks left and each bar\'s size for a Standard block, and a Classic block\'s record is exactly what it was', async t => {
    const host = await story(t, 'Character', 'Skills', 'Foes');
    await set(host, 'character', { who: 'Wessel', vit: 10, agi: 15, int: 10 });
    await set(host, 'character', { health: 4 });
    await host.send('A drake.', reply('+ dm foes — why | kind: set-slot-1 | name: Weir-drake | count: 1 | class: 4'));
    const read = readSheet(host.head());
    const wessel = read.characters[0];
    assert.deepEqual([wessel.health, wessel.stamina, wessel.mana], [4, 6, 5], 'blocks left');
    assert.deepEqual(wessel.size, { health: 6, stamina: 6, mana: 5 });
    assert.deepEqual(wessel.size, blocksFor({ vit: 10, agi: 15, int: 10 }));
    assert.ok(wessel.hidden.includes('health-blocks'), 'the sizes the rules keep are hidden fields');
    assert.deepEqual([read.foes[0].hurt, read.foes[0].size], [6, 6]);
    assert.equal(read.foes[1].size, 4);
    // Classic: no `size` anywhere
    const classic = await createHost(); t.after(() => classic.close());
    await classic.send('Begin.', 'Opening.');
    for (const entry of LEAN_RPG_TEMPLATES.slice(0, 3)) success(await classic.sdk.command('dm.define', { definition: structuredClone(entry.definition) }));
    await set(classic, 'character', { who: 'Wessel' });
    await classic.send('A rat.', reply('+ dm foes — why | kind: set-slot-1 | name: Rat | count: 1 | class: 1'));
    const old = readSheet(classic.head());
    assert.equal('size' in old.characters[0], false);
    assert.equal('size' in old.foes[0], false);
    assert.deepEqual([old.characters[0].health, old.foes[0].hurt], [5, 5]);
    assert.deepEqual(STAGES.health.length, 6);
});

test('the checker takes `blocks` only on an int field with a known bar, and a label\'s own `names` like a field\'s', () => {
    const check = change => { const d = standard('Character'); change(d); return validateDataModules([d], CHECK); };
    assert.equal(check(() => {}).ok, true);
    assert.equal(check(d => { d.state.health.blocks = 'bogus'; }).ok, false, 'unknown bar');
    assert.equal(check(d => { d.state.who.blocks = 'health'; }).ok, false, 'not an int field');
    assert.equal(check(d => { d.kinds['set-health'].labels.to.blocks = 'health'; }).ok, false, 'not on a label');
    assert.equal(check(d => { d.kinds['set-health'].labels.to.names = { 9: 'Out of range' }; }).ok, false, 'a label\'s names are held to its range');
    assert.equal(check(d => { d.kinds['set-health'].labels.to.names = { 0: 'Down', 1: 'Down' }; }).ok, false, 'and to distinct words');
    assert.equal(check(d => { delete d.kinds['set-health'].labels.to.names; }).ok, true, 'a label with no names is as it always was');
    const text = check(d => { d.kinds['set-health'].labels.to = { type: 'text', max: 10, names: { 0: 'x' } }; });
    assert.equal(text.ok, false, 'names are for a number label');
});

test('"Changed this reply" says a Standard bar\'s change in stage words, for the story\'s line and for the reader\'s edit, never in block counts', async t => {
    const host = await story(t, 'Character');
    const summaries = () => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).map(receipt => receipt.summary).filter(Boolean);
    await host.send('Hit.', reply(say('character', 'set-health', ' | to: Hurt')));
    assert.ok(summaries().some(text => /Health Unhurt → Hurt/.test(text)), summaries().join(' | '));
    await set(host, 'character', { stamina: 1 });
    assert.ok(summaries().some(text => /Stamina Fresh → Spent/.test(text)), summaries().join(' | '));
    assert.ok(!summaries().some(text => /Health \d → \d/.test(text)), 'no block counts');
    rebuilt(host);
});
