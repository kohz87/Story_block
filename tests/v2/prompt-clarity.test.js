// Clearer instructions for the narrator (stage 40): the Wallet line says it is the purse BEFORE the reply and asks for a coin
// line for any money paid or received in it; a starting purse or kit (and the reader's own corrections) under [Happened] are
// told as the state as it stands, not as a payment; the coin kind's grammar line says to write the coin line whenever
// {{user}} is paid or pays. The static part stays byte-identical reply to reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KINDS } from '../../src/v2/domains/index.js';
import { TOLD, WALLET_NOTE } from '../../src/v2/domains/inventory.js';
import { STATIC_KEY, TAIL_KEY } from '../../src/v2/turn.js';
import { createHost } from '../../testkit/index.js';

const WALLET = `before this reply: write a coin line for any money paid or received in it`;
const tailOf = host => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).at(-1).value;
const staticOf = host => host.st.promptLog.filter(entry => entry.key === STATIC_KEY && entry.value).at(-1).value;

test('the Wallet line says it is the amount before this reply, and asks for a coin line for money paid or received in it', async t => {
    assert.equal(WALLET_NOTE, WALLET);
    const host = await createHost();
    t.after(() => host.close());
    await host.send('I look for work.', 'The clerk nods.\n<Changes>\n+ coin 70 | from: the clerk\n</Changes>');
    await host.send('I pay for a room.', 'Marrit pays the innkeeper.');
    const tail = tailOf(host);
    assert.match(tail, /^Wallet: 70 gold \(before this reply: write a coin line for any money paid or received in it\)$/m);
    assert.equal((tail.match(/Wallet:/g) ?? []).length, 1);
});

test('the coin kind\'s grammar line says to write the coin line whenever {{user}} is paid or pays, in one short clause; the static part is the same every reply', async t => {
    const clause = 'whenever {{user}} is paid or pays in the story, even a few coins, write the coin line';
    assert.ok(CORE_KINDS.coin.grammar.includes(clause));
    assert.ok(CORE_KINDS.coin.grammar.length < 220, 'one short clause, not a paragraph');
    const host = await createHost();
    t.after(() => host.close());
    await host.send('One.', 'A first reply.');
    const first = staticOf(host);
    await host.send('Two.', 'A second.\n<Changes>\n+ coin 5 | from: a stranger\n~ place Mill | kind: settlement\n</Changes>');
    assert.equal(staticOf(host), first, 'byte-identical across replies');
    assert.ok(first.includes('whenever You is paid or pays in the story, even a few coins, write the coin line'), '{{user}} is filled in');
});

test('a starting purse and kit (from a saved character) are told under [Happened] as the starting state, not as money or things that moved in the story', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'The guild hall.');
    const purse = await host.sdk.command('wallet.set', { amount: 70, starting: true });
    assert.equal(purse.ok, true, purse.message);
    assert.equal(purse.receipt.summary, 'You set the purse to 70 gold.', 'the reader\'s card keeps its words');
    assert.equal(purse.receipt.data.told, TOLD.startPurse);
    const kit = await host.sdk.command('inventory.add', { name: 'Bedroll', qty: 1, starting: true });
    assert.equal(kit.ok, true, kit.message);
    assert.equal(kit.receipt.summary, 'You added Bedroll.');
    assert.equal(kit.receipt.data.told, TOLD.startKit);
    await host.send('I pay Marrit.', 'Marrit pays 36 copper.');
    const tail = tailOf(host);
    assert.match(tail, /\[Happened\]\nYou set the purse to 70 gold\. \(Starting purse, set before the story began: not money paid or received in the story\.\)\nYou added Bedroll\. \(Starting kit, set before the story began: not found, bought or used in the story\.\)/);
    assert.match(tail, /Wallet: 70 gold \(before this reply/);
});

test('the reader\'s own corrections of the purse and the bag are told as the state as it stands too; the card\'s words do not change', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'The guild hall.\n<Changes>\n+ item Rope | qty: 2\n</Changes>');
    const purse = await host.sdk.command('wallet.set', { amount: 15 });
    const added = await host.sdk.command('inventory.add', { name: 'Torch', qty: 3 });
    const stack = host.sdk.query('inventory.items', {}).find(item => item.name === 'Rope');
    const edited = await host.sdk.command('inventory.edit', { stack: stack.stack, qty: 5 });
    for (const result of [purse, added, edited]) assert.equal(result.ok, true, result.message);
    assert.equal(purse.receipt.data.told, TOLD.editPurse);
    assert.equal(added.receipt.data.told, TOLD.editKit);
    assert.equal(edited.receipt.data.told, TOLD.editKit);
    assert.doesNotMatch(purse.receipt.summary + added.receipt.summary + edited.receipt.summary, /correction|starting/i);
    await host.send('On.', 'They walk on.');
    const tail = tailOf(host);
    for (const text of [TOLD.editPurse, TOLD.editKit]) assert.ok(tail.includes(`(${text})`), text);
    // Replay is the same: a rebuild keeps the receipts' words.
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
});

test('a receipt with no `told` text (the reader\'s move of the scene) is told as before: nothing is added in brackets', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Hall.');
    const moved = await host.sdk.command('scene.place', { name: 'Mill', kind: 'settlement' });
    assert.equal(moved.ok, true, moved.message);
    assert.equal(moved.receipt.data.told, undefined);
    await host.send('On.', 'Walking.');
    const happened = tailOf(host).split('\n').filter(line => /Mill/.test(line) && !line.startsWith('Place:'));
    assert.ok(happened.length > 0);
    assert.ok(happened.every(line => !line.includes('(')), happened.join('|'));
});
