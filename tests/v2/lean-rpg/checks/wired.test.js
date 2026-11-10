// Story checks, wired into the real host (checks/ + precall.js, practice.js, the `roll` kind): the dice note rides on a reply that carries no fight and
// not on a fight reply or with the setting off; a Re-read keeps the reply's dice; each refusal is one Problems line and rolls nothing; the result is recorded
// with the reply (success, cost, fail, decisive); a skilled check gives its skill 3 practice (a utility skill too) and no XP; a reply from before the rule is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../../testkit/index.js';
import { CHECKS_SETTING, LEAN_RPG_FEATURE, PRACTICE, PRACTICE_SETTING, ROLLS_SETTING } from '../../../../src/v2/lean-rpg/index.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { checksOf } from '../../../../src/v2/lean-rpg/practice.js';
import { reply, success } from '../../data-modules/helpers.js';
import { tailOf } from '../helpers.js';
import { statPart } from '../../../../src/v2/lean-rpg/formula.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const definitionOf = name => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition);
const NOTE = /Dice for this reply, in order: (\d+), (\d+), (\d+)\./u;

async function world(t, { settings = {}, modules = [] } = {}) {
    t.after(seedCrypto(7));   // (the seeds the bus draws are fixed, so the dice of each test are the same every run)
    const host = await createHost({ modules, settings: { modules: { 'story-block': settings } } });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Skills']) success(await host.sdk.command('dm.define', { definition: definitionOf(name) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 20, dex: 12, cha: 10 } }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Astra' } }));
    await host.send('Learn.', reply('~ dm skills — learned | kind: learn-1 | name: Obscure | about: Slip into shadow. | stat: dex | uses: mana | type: utility'));
    return host;
}
// A reply written after the request is built: `make(dice)` gets the three dice the note named.
const after = (host, make) => ({ toString() { const found = NOTE.exec(tailOf(host.st.requests.at(-1))); return make(found ? [1, 2, 3].map(n => Number(found[n])) : []); } });
const records = host => host.ctx.chat.at(-1).extra.storySuite;
const diceOf = host => records(host).receipts.find(receipt => receipt.type === 'rpg.dice')?.data.v2.dice.list ?? null;
const sheet = host => host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields;
const slotOf = (host, name) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].find(n => sheet(host)[`skill${n}`] === name);
const messages = host => host.turn.problems().map(problem => problem.message);

test('a reply with no fight is offered three dice in the tail, and the receipt keeps them', { skip }, async t => {
    const host = await world(t);
    await host.send('I try.', after(host, () => 'The door sticks.'));
    const found = NOTE.exec(tailOf(host.st.requests.at(-1)));
    assert.ok(found, 'the note is in the prompt');
    assert.deepEqual(diceOf(host), [1, 2, 3].map(n => Number(found[n])));
    assert.ok(diceOf(host).every(die => die >= 1 && die <= 20));
});

test('Story checks off: no dice note, no dice receipt, no grammar line, and a roll line is refused with one Problems line', { skip }, async t => {
    const host = await world(t, { settings: { [CHECKS_SETTING]: false } });
    await host.send('I try.', 'Story.\n<Changes>\n? roll Astra | cha | normal | 9\n</Changes>');
    assert.equal(NOTE.test(tailOf(host.st.requests.at(-1))), false);
    assert.equal(JSON.stringify(host.st.requests.at(-1)).includes('skill or stat | easy, normal'), false);
    assert.equal(diceOf(host), null);
    assert.equal(checksOf(records(host).receipts).length, 0);
    assert.equal(messages(host).filter(text => text.includes('was not used: no dice were offered')).length, 1);
});

test('Rolls Off with Story checks on: the dice and the grammar line both stay (the switch is Story checks alone; Rolls is for fights)', { skip }, async t => {
    const host = await world(t, { settings: { [ROLLS_SETTING]: 'off' } });
    await host.send('I try.', after(host, dice => `Story.\n<Changes>\n? roll Astra | cha | normal | ${dice[0]}\n</Changes>`));
    const request = JSON.stringify(host.st.requests.at(-1));
    assert.ok(NOTE.test(tailOf(host.st.requests.at(-1))), 'the dice note is told');
    assert.ok(request.includes('skill or stat | easy, normal'), 'and the grammar line');
    assert.equal(checksOf(records(host).receipts).length, 1, 'the check is worked');
});

test('a Re-read keeps the dice and the results; a swipe is a new reply with new dice', { skip }, async t => {
    const host = await world(t);
    await host.send('I bluff.', after(host, dice => `Story.\n<Changes>\n? roll Astra | cha | normal | ${dice[0]}\n</Changes>`));
    const dice = diceOf(host), results = checksOf(records(host).receipts);
    assert.equal(results.length, 1);
    const index = host.ctx.chat.length - 1;
    success(await host.turn.reread(index));
    assert.deepEqual(diceOf(host), dice, 'the same dice after a Re-read');
    assert.deepEqual(checksOf(records(host).receipts), results, 'the same result');
    await host.swipe(after(host, () => 'Another try.'));
    assert.notDeepEqual(diceOf(host), dice, 'a swipe rolls its own');
});

test('the outcome is the die plus the stat part, against the difficulty; a bad line is refused with one note and no roll', { skip }, async t => {
    const host = await world(t);
    await host.send('I try three things.', after(host, dice => ['Story.', '<Changes>',
        `? roll Astra | cha | easy | ${dice[0]}`, `? roll Nobody | cha | easy | ${dice[1]}`, `? roll Astra | cha | hard | ${dice[1]}`, `? roll Astra | cha | normal | ${dice[0]}`, '</Changes>'].join('\n')));
    const results = checksOf(records(host).receipts), dice = diceOf(host);
    assert.equal(results.length, 2, 'the unknown person is refused; the second use of the first die is refused too');
    assert.equal(results[0].die, dice[0]);
    assert.equal(results[0].total, dice[0] + results[0].bonus);
    const total = dice[0] + results[0].bonus;   // (a natural 20 always succeeds and a natural 1 always fails: outcomeOf)
    assert.equal(results[0].outcome, dice[0] === 20 || (dice[0] !== 1 && total >= 10) ? 'success' : (dice[0] !== 1 && total >= 8 ? 'cost' : 'fail'));
    assert.equal(results[1].die, dice[1], 'the refused line used no die: the next line takes the second');
    assert.ok(messages(host).some(text => text.includes('was not used: unknown person')), 'one note for the unknown person');
    assert.ok(messages(host).some(text => text.includes('die reused') || text.includes('out of order')), 'and one for the die used twice');
});

test('a die that was not offered, an unknown skill and an unknown difficulty are refused', { skip }, async t => {
    const host = await world(t);
    await host.send('I try.', after(host, dice => ['Story.', '<Changes>', `? roll Astra | cha | normal | ${dice.includes(7) ? 8 : 7}`, `? roll Astra | juggling | normal | ${dice[0]}`, `? roll Astra | cha | brutal | ${dice[0]}`, '</Changes>'].join('\n')));
    assert.equal(checksOf(records(host).receipts).length, 0);
    const text = messages(host).join(' ');
    assert.ok(text.includes('die not offered') && text.includes('unknown skill or stat') && text.includes('unknown difficulty'));
});

test('a utility skill check gives that skill 3 practice and the reader no XP', { skip }, async t => {
    const host = await world(t);
    const slot = slotOf(host, 'Obscure'), xp = host.head().domains.dataModules.instances['pack.chat/character'].chat.fields.xp;
    assert.ok(slot, 'the utility skill is on the sheet');
    const before = sheet(host)[`practice${slot}`];
    await host.send('I slip away.', after(host, dice => `Story.\n<Changes>\n? roll Astra | Obscure | normal | ${dice[0]}\n</Changes>`));
    const [result] = checksOf(records(host).receipts);
    assert.equal(result.utility, true);
    assert.equal(result.practice.skill, 'Obscure');
    assert.equal(sheet(host)[`practice${slot}`], before + PRACTICE.perUse);
    assert.equal(host.head().domains.dataModules.instances['pack.chat/character'].chat.fields.xp, xp);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
});

test('a reply captured before the rule has no mark: its check line is not used, and a Re-read does the same', { skip }, async t => {
    const host = await world(t);
    await host.send('I try.', after(host, () => 'Story.'));
    const index = host.ctx.chat.length - 1, record = records(host);
    // (an old reply: no dice, no mark; the narrator's line is edited in afterwards)
    record.receipts = record.receipts.filter(receipt => receipt.type !== 'rpg.dice');
    host.ctx.chat[index].mes = 'Story.\n<Changes>\n? roll Astra | cha | normal | 5\n</Changes>';
    const before = JSON.stringify(host.head().domains);
    await host.turn.reread(index);
    assert.equal(checksOf(records(host).receipts).length, 0);
    assert.equal(records(host).receipts.some(receipt => receipt.type === 'capture.check'), false, 'the line made no receipt');
    assert.equal(JSON.stringify(host.head().domains), before, 'no state moved');
});

test('Story Director\'s `check` word is untouched: a module that owns it changes neither the dice nor the roll kind', { skip }, async t => {
    const owner = { id: 'checks', name: 'Checks', capture: { kinds: { check: { grammar: '? check skill — what | dc: normal' } }, apply: () => ({ summary: 'checked', narrate: false }) } };
    const host = await world(t, { modules: [owner] });
    await host.send('I try.', after(host, dice => `Story.\n<Changes>\n? roll Astra | cha | normal | ${dice[0]}\n? check lockpick — the lock | dc: normal\n</Changes>`));
    const request = JSON.stringify(host.st.requests.at(-1));
    assert.ok(NOTE.test(tailOf(host.st.requests.at(-1))), 'the dice note is told');
    assert.ok(request.includes('? check skill — what | dc: normal') && request.includes('skill or stat | easy, normal'), 'both grammar lines are told');
    assert.equal(checksOf(records(host).receipts).length, 1, 'the roll line made its result');
    assert.equal(records(host).receipts.some(receipt => receipt.type === 'capture.check'), true, 'and the other module kept its own line');
});

test('the grammar line is constant text: told with or without a party', { skip }, async t => {
    const bare = await createHost();
    t.after(() => bare.close());
    bare.features.set(LEAN_RPG_FEATURE, true);
    await bare.send('Begin.', 'Opening.');
    const line = '? roll Name | skill or stat | easy, normal, hard or very hard | die (an attempt that can fail, with one of this reply\'s dice, in order; at most 3)';
    assert.ok(JSON.stringify(bare.st.requests.at(-1)).includes(line), 'no party');
    const host = await world(t);
    await host.send('I try.', 'The door sticks.');
    assert.ok(JSON.stringify(host.st.requests.at(-1)).includes(line), 'one member');
});

test('the note tells each member\'s exact bonuses, and they are the very numbers code adds', { skip }, async t => {
    const host = await world(t);
    await host.send('I try.', after(host, () => 'Story.'));
    const note = NOTE.exec(tailOf(host.st.requests.at(-1))) && tailOf(host.st.requests.at(-1));
    const stats = host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
    const cha = statPart('check', { cha: stats.cha, dex: stats.dex }, { fittingStat: 'cha' }).value + Math.floor(stats.level / 5);
    assert.ok(note.includes(`CHA+${cha}`), `the note names CHA+${cha}`);
    const obscure = /Obscure\+(\d+)/u.exec(note);
    assert.ok(obscure, 'and the skill');
    await host.send('I slip away.', after(host, dice => `Story.\n<Changes>\n? roll Astra | CHA | normal | ${dice[0]}\n? roll Astra | Obscure | normal | ${dice[1]}\n</Changes>`));
    const [stat, skill] = checksOf(records(host).receipts);
    assert.equal(stat.bonus, cha);
    assert.equal(skill.bonus, Number(obscure[1]));
});

test('the rules recorded with the dice, not today\'s settings, decide a Re-read: difficulty, practice per use, and the switch', { skip }, async t => {
    const host = await world(t);
    const slot = slotOf(host, 'Obscure');
    await host.send('I slip away.', after(host, dice => `Story.\n<Changes>\n? roll Astra | Obscure | normal | ${dice[0]}\n</Changes>`));
    const index = host.ctx.chat.length - 1, results = checksOf(records(host).receipts), practice = sheet(host)[`practice${slot}`], dice = records(host).receipts.find(receipt => receipt.type === 'rpg.dice').data.v2.dice;
    assert.equal(results[0].practiceGained, PRACTICE.perUse);
    host.settings.set('story-block', PRACTICE_SETTING, 5);
    host.settings.set('story-block', 'rpgDifficulty', 'harsh');
    host.settings.set('story-block', CHECKS_SETTING, false);
    success(await host.turn.reread(index));
    assert.deepEqual(checksOf(records(host).receipts), results, 'the same results: the switch is off, the practice and difficulty changed');
    assert.equal(sheet(host)[`practice${slot}`], practice, 'the practice stays');
    assert.deepEqual(records(host).receipts.find(receipt => receipt.type === 'rpg.dice').data.v2.dice, dice, 'and the dice record');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild agrees');
    await host.send('Next.', 'Quiet.');
    assert.equal(diceOf(host), null, 'a new reply gets no dice with the switch off');
});

test('a change to a skill an earlier reply made plans the check again, so its card is not left stale', { skip }, async t => {
    const host = await world(t);
    await host.send('I slip away.', after(host, dice => `Story.\n<Changes>\n? roll Astra | Obscure | normal | ${dice[0]}\n</Changes>`));
    const [was] = checksOf(records(host).receipts), later = host.ctx.chat.length - 1;
    assert.equal(was.stat, 'dex');
    // The reply that taught the skill is edited: it now rests on STR, and a Re-read of it replays everything after it.
    const learn = host.ctx.chat.findIndex(message => String(message.mes).includes('kind: learn-1'));
    host.ctx.chat[learn].mes = host.ctx.chat[learn].mes.replace('stat: dex', 'stat: str');
    success(await host.turn.reread(learn));
    const [now] = checksOf(host.ctx.chat[later].extra.storySuite.receipts);
    assert.equal(now.stat, 'str');
    assert.equal(now.bonus, statPart('check', host.head().domains.dataModules.instances['pack.chat/character'].chat.fields, { skillStat: 'str' }).value + Math.floor(20 / 5) + now.rank);
});

test('a line refused for a skill the sheet lacked is planned again when an earlier reply adds that skill', { skip }, async t => {
    const host = await world(t);
    await host.send('I slip away.', after(host, dice => `Story.\n<Changes>\n? roll Astra | Shadowcraft | normal | ${dice[0]}\n</Changes>`));
    const later = host.ctx.chat.length - 1;
    assert.equal(checksOf(records(host).receipts).length, 0, 'the skill is not on the sheet: refused');
    const learn = host.ctx.chat.findIndex(message => String(message.mes).includes('kind: learn-1'));
    host.ctx.chat[learn].mes = host.ctx.chat[learn].mes.replace('name: Obscure', 'name: Shadowcraft');
    success(await host.turn.reread(learn));
    const [now] = checksOf(host.ctx.chat[later].extra.storySuite.receipts);
    assert.ok(now, 'the check is worked on the sheet as it now is');
    assert.equal(now.what, 'Shadowcraft');
});

test('a reply made with Story checks off keeps its receipts after a Re-read, and a rebuild and a reload agree, even once the switch is on', { skip }, async t => {
    const host = await world(t, { settings: { [CHECKS_SETTING]: false } });
    await host.send('I try.', 'Story.\n<Changes>\n+ item Rope\n</Changes>');
    const index = host.ctx.chat.length - 1, receiptTypes = () => records(host).receipts.map(receipt => receipt.type);
    const before = receiptTypes();
    host.settings.set('story-block', CHECKS_SETTING, true);
    success(await host.turn.reread(index));
    assert.deepEqual(receiptTypes(), before, 'the same receipts after a Re-read: no dice appear in an old reply');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload');
});
