// The Money section (src/v2/view/settings/money.js, UI stage step 3c): Story Block's General settings on the form engine in the
// concept's Money page: the coins as rows with "+ Add" and "Edit as text", the budget as a slider named in the smallest coin,
// what the store moved or refused said under the field, and the story's money paying as before after edits made here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';
import { BUDGET_SLIDER_MAX, MONEY_CARDS, MONEY_FOLD, budgetText, budgetUnit, coinProblems, moneySchema } from '../../../src/v2/view/settings/money.js';
import { SETTINGS_TEXT } from '../../../src/v2/host-ui.js';

const COINS = [{ name: 'penny/pennies', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }];

async function open(own = {}, options = {}) {
    const doc = setupDom();
    const host = await createHost({ settings: { modules: { 'story-block': own } } });
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map(), ...options });
    win.select('money');
    return { doc, host, win, root: win.root, page: win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'money') };
}
const field = (page, key) => page.querySelector(`.ss-field[data-field="${key}"]`);
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const stored = host => host.settings('story-block');
// A coin row's box: its name or its worth.
const cell = (page, at, key) => field(page, 'coins').querySelectorAll('.ss-lines-row')[at].querySelector(`.ss-lines-cell[data-field="${key}"] input`);
const type = (input, value) => { input.value = String(value); input.dispatch('change'); };
const budget = page => field(page, 'storyCoinPerReply');
const budgetSlider = page => budget(page).querySelector('.ss-slider-input');
const say = page => budget(page).querySelector('.ss-slider-value').textContent;
const err = (page, key) => field(page, key).querySelector('.ss-field-error');

test('the page groups the money settings and folds the advanced scale', async () => {
    const { page, host } = await open({ coins: COINS });
    assert.deepEqual(page.querySelectorAll('.ss-section-title').map(node => node.textContent), MONEY_CARDS.map(card => card.title));
    assert.deepEqual(page.querySelectorAll('.ss-section').map(card => card.querySelectorAll('.ss-field').map(row => row.dataset.field)), MONEY_CARDS.map(card => [...card.keys]));
    assert.ok(page.querySelector('.ss-form').classList.contains('ss-money'));
    assert.equal(page.querySelectorAll('details').length, 1);
    assert.equal(page.querySelector('details').open, false);
    assert.equal(page.querySelector('details').querySelector('summary').textContent, 'Advanced');
    assert.equal(field(page, 'economyScale').closest('details'), page.querySelector('details'));
    // The old rows are gone; every field of the group is still there, with its label and help as the schema has them.
    assert.equal(page.querySelectorAll('.story-suite-row').length, 0);
    assert.equal(field(page, 'coins').querySelector('.ss-field-label').textContent, 'Coins (smallest first)');
    assert.match(field(page, 'coins').querySelector('.ss-field-help').textContent, /^The coins of this world and what each is worth/);
    // No "N settings shown" line of its own: the window says it once.
    assert.equal(page.querySelector('.ss-form-status').hidden, true);
    host.close();
});

test('Coins: name and worth rows with "+ Add" and "Edit as text", written to the same setting as before', async () => {
    const { page, host } = await open({ coins: COINS });
    const coins = field(page, 'coins');
    assert.equal(coins.querySelectorAll('.ss-lines-row').length, 3);
    assert.equal(cell(page, 0, 'name').value, 'penny/pennies');
    assert.equal(cell(page, 1, 'value').value, '10');
    assert.equal(coins.querySelector('.ss-lines-add').textContent, `+ ${SETTINGS_TEXT.add}`);
    assert.equal(coins.querySelector('.ss-lines-toggle').textContent, SETTINGS_TEXT.asText);
    // Worth changed.
    type(cell(page, 1, 'value'), 12);
    assert.deepEqual(stored(host).coins[1], { name: 'silver', value: 12 });
    // A row added and named: the focus goes to its first box.
    coins.querySelector('.ss-lines-add').click();
    assert.equal(coins.querySelectorAll('.ss-lines-row').length, 4);
    type(cell(page, 3, 'name'), 'platinum');
    type(cell(page, 3, 'value'), 1000);
    assert.deepEqual(stored(host).coins.at(-1), { name: 'platinum', value: 1000 });
    // A row removed.
    coins.querySelectorAll('.ss-lines-remove')[0].click();
    assert.deepEqual(stored(host).coins.map(coin => coin.name), ['silver', 'gold', 'platinum']);
    // The same list as text, one coin a line.
    coins.querySelector('.ss-lines-toggle').click();
    const area = coins.querySelector('.ss-lines-text');
    assert.equal(area.value, 'silver: 12\ngold: 100\nplatinum: 1000');
    area.value = 'copper: 1\nsilver: 10';
    area.dispatch('change');
    assert.deepEqual(stored(host).coins, [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }]);
    host.close();
});

test('the budget is a slider; its words are the smallest coin\'s, and follow a change to the coins or the money word', async () => {
    const { page, host } = await open({ coins: COINS, storyCoinPerReply: 60 });
    const slider = budgetSlider(page);
    assert.equal(slider.min, '0');
    assert.equal(slider.max, String(BUDGET_SLIDER_MAX));
    assert.equal(slider.value, '60');
    assert.equal(say(page), '60 pennies', 'named after the coin worth 1');
    assert.equal(slider.getAttribute('aria-valuetext'), '60 pennies');
    // Moving it stores it, in whole coins.
    slider.value = '1';
    slider.dispatch('change');
    assert.equal(stored(host).storyCoinPerReply, 1);
    assert.equal(say(page), '1 penny');
    slider.value = '0';
    slider.dispatch('change');
    assert.equal(say(page), 'Automatic: no limit — the story decides');
    slider.value = '60';
    slider.dispatch('change');
    // The coin is renamed: the unit follows, plural as written after the slash.
    type(cell(page, 0, 'name'), 'farthing/farthings');
    assert.equal(say(page), '60 farthings');
    // Its worth changed to 2: no coin is worth 1, so the money word (Currency) is the unit.
    type(cell(page, 0, 'value'), 2);
    assert.equal(say(page), '60 gold', 'the default money word');
    type(field(page, 'currency').querySelector('input'), 'mark');
    assert.equal(say(page), '60 marks');
    // No coins at all: the money word still.
    const coins = field(page, 'coins');
    while (coins.querySelectorAll('.ss-lines-remove').length) coins.querySelectorAll('.ss-lines-remove')[0].click();
    assert.deepEqual(stored(host).coins, []);
    assert.equal(say(page), '60 marks');
    type(field(page, 'currencyPlural').querySelector('input'), 'marken');
    assert.equal(say(page), '60 marken');
    host.close();
});

test('a budget past the slider\'s range is shown whole, not cut to the end', async () => {
    const { page, host } = await open({ storyCoinPerReply: 5000 });
    const slider = budgetSlider(page);
    assert.equal(slider.value, '5000');
    assert.equal(slider.max, '5000');
    assert.equal(say(page), '5,000 gold');
    slider.value = '70';
    slider.dispatch('change');
    assert.equal(stored(host).storyCoinPerReply, 70);
    assert.equal(slider.max, String(BUDGET_SLIDER_MAX), 'back to the usual range');
    host.close();
});

test('budgetUnit and budgetText: the coin worth 1, else the money word; 0 is Automatic', () => {
    assert.deepEqual(budgetUnit({ coins: COINS }), { one: 'penny', many: 'pennies' });
    assert.deepEqual(budgetUnit({ coins: [{ name: 'silver', value: 10 }], currency: 'mark' }), { one: 'mark', many: 'marks' }, 'no coin worth 1');
    assert.deepEqual(budgetUnit({}), { one: 'gold', many: 'gold' });
    assert.equal(budgetText(60, { currency: 'mark' }), '60 marks');
    assert.equal(budgetText(1, { currency: 'mark' }), '1 mark');
    assert.equal(budgetText(1234, { coins: COINS }), '1,234 pennies');
    assert.equal(budgetText(0, {}), 'Automatic: no limit — the story decides');
    assert.equal(budgetText(Number.NaN, {}), 'Automatic: no limit — the story decides');
});

test('a bad Coins line is named, and the list is kept as it was', async () => {
    const { page, host } = await open({ coins: COINS });
    const coins = field(page, 'coins');
    coins.querySelector('.ss-lines-toggle').click();
    const area = coins.querySelector('.ss-lines-text');
    area.value = 'copper: 1\nsilver: lots\ngold: 100';
    area.dispatch('change');
    const error = coins.querySelector('.ss-lines-error');
    assert.equal(error.hidden, false);
    assert.equal(error.getAttribute('role'), 'alert');
    assert.match(error.textContent, /^Line 2 \("silver: lots"\): /);
    assert.match(error.textContent, /The list is kept as it was until every line reads\.$/);
    assert.equal(area.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(stored(host).coins, COINS, 'nothing stored');
    // Fixed: the error goes and the list is stored.
    area.value = 'copper: 1\nsilver: 10';
    area.dispatch('change');
    assert.equal(error.hidden, true);
    assert.deepEqual(stored(host).coins, [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }]);
    host.close();
});

test('what the store moved or refused is said under the field: a worth moved into its range, a name cut, a budget moved', async () => {
    const { page, host } = await open({ coins: COINS });
    // A worth past the most a coin may be worth is moved, and the row is named.
    type(cell(page, 2, 'value'), 5_000_000);
    assert.equal(stored(host).coins[2].value, 1_000_000);
    assert.equal(cell(page, 2, 'value').value, '1000000');
    assert.equal(err(page, 'coins').hidden, false);
    assert.equal(err(page, 'coins').textContent, 'Row 3, Worth: Set to 1000000, the most this allows.');
    assert.equal(err(page, 'coins').getAttribute('role'), 'alert');
    // Not a number in a worth box: the setting stays, and the row says so.
    type(cell(page, 1, 'value'), 'ten');
    assert.match(err(page, 'coins').textContent, /^Row 2, Worth: Enter a whole number\. The setting stays 10\.$/);
    assert.equal(stored(host).coins[1].value, 10);
    // A money word cut at its length.
    const word = field(page, 'currency').querySelector('input');
    type(word, 'x'.repeat(30));
    assert.equal(stored(host).currency.length, 24);
    assert.equal(err(page, 'currency').textContent, 'Cut to 24 characters, the most this allows.');
    // The money scale is text (it may hold a fraction); it is cut too.
    type(field(page, 'economyScale').querySelector('input'), '1'.repeat(20));
    assert.equal(err(page, 'economyScale').textContent, 'Cut to 12 characters, the most this allows.');
    host.close();
});

test('coinProblems: what the story will not use, in words (a row with no name, a number in a name, no worth, a name used twice, past the eighth)', () => {
    assert.deepEqual(coinProblems(COINS), []);
    assert.deepEqual(coinProblems([{ name: '', value: 1 }]), ['Coin 1 has no name, so it is not used.']);
    assert.deepEqual(coinProblems([{ name: '5p', value: 5 }]), ['Coin 1 (5p) has a number in its name, so it is not used.']);
    assert.deepEqual(coinProblems([{ name: 'silver', value: null }]), ['Coin 1 (silver) needs a worth from 1 to 1,000,000, so it is not used.']);
    assert.deepEqual(coinProblems([{ name: 'silver', value: 0 }, { name: 'gold', value: 1.5 }]), ['Coin 1 (silver) needs a worth from 1 to 1,000,000, so it is not used.', 'Coin 2 (gold) needs a worth from 1 to 1,000,000, so it is not used.']);
    assert.deepEqual(coinProblems([{ name: 'silver', value: 10 }, { name: 'Silver', value: 20 }]), ['Coin 2 (Silver) is named like an earlier coin, so it is not used.']);
    assert.deepEqual(coinProblems([{ name: 'penny/pennies', value: 1 }, { name: 'pennies', value: 2 }]), ['Coin 2 (pennies) is named like an earlier coin, so it is not used.'], 'a plural counts');
    const nine = Array.from({ length: 9 }, (_, at) => ({ name: `coin${'abcdefghi'[at]}`, value: at + 1 }));
    assert.deepEqual(coinProblems(nine), ['Only 8 coins count; the rest are not used.']);
    assert.equal(coinProblems([{ name: '', value: 1 }, { name: '', value: 1 }, { name: '', value: 1 }], 2).length, 2, 'at most two sentences');
    assert.deepEqual(coinProblems(null), []);
});

test('the Coins field says so when a row it keeps is one the story will not use', async () => {
    const { page, host } = await open({ coins: COINS });
    field(page, 'coins').querySelector('.ss-lines-add').click();
    type(cell(page, 3, 'name'), 'silver');
    type(cell(page, 3, 'value'), 50);
    assert.equal(err(page, 'coins').textContent, 'Coin 4 (silver) is named like an earlier coin, so it is not used.');
    assert.equal(stored(host).coins.length, 4, 'kept as typed');
    type(cell(page, 3, 'name'), 'platinum');
    assert.equal(err(page, 'coins').hidden, true);
    host.close();
});

test('moneySchema: the General group regrouped into the cards; a field the cards do not name goes in a card at the end', () => {
    const base = {
        currency: { type: 'text', label: 'Currency' }, coins: { type: 'list', form: 'lines', label: 'Coins', of: { name: 'text', value: { type: 'int', min: 1 } } },
        storyCoinPerReply: { type: 'int', min: 0, max: 1_000_000_000, label: 'Budget' }, tip: { type: 'bool', label: 'Tip' },
        other: { type: 'text', label: 'Trade: Other', group: 'Trade' },
    };
    const schema = moneySchema(base, () => ({}));
    assert.deepEqual(Object.keys(schema), ['coins', 'storyCoinPerReply', 'currency', 'tip'], 'cards in order, then the rest; another group\'s field is not here');
    assert.deepEqual(Object.values(schema).map(field => field.group), ['Coins', 'What the story may pay', 'Money words', 'More']);
    assert.equal(schema.coins.form, undefined, 'rows first: the text form is a button away');
    assert.equal(schema.storyCoinPerReply.form, 'slider');
    assert.equal(schema.storyCoinPerReply.sliderMax, BUDGET_SLIDER_MAX);
    assert.equal(schema.storyCoinPerReply.max, 1_000_000_000, 'the store\'s limit is untouched');
    assert.equal(schema.storyCoinPerReply.format(0), 'Automatic: no limit — the story decides');
    assert.equal(base.coins.form, 'lines', 'the registry\'s own schema is not changed');
    assert.deepEqual(moneySchema(undefined, () => ({})), {});
});

test('the General group\'s fold key still opens the Money page, the first field focused', async () => {
    const doc = setupDom();
    const host = await createHost({});
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map(), fold: MONEY_FOLD });
    assert.equal(win.section(), 'money');
    assert.equal(MONEY_FOLD, 'story-block::group:General');
    const first = win.root.querySelector('.ss-settings-page[data-ss-section="money"] .ss-field[data-field="coins"]');
    assert.ok(first.contains(doc.activeElement), 'in the Coins row');
    host.close();
});

test('the story still pays: a + coin line after edits made here is worth what the page says', async () => {
    const { page, host } = await open({ coins: [{ name: 'penny/pennies', value: 1 }] });
    // Edit the coins here: add silver at 10 and gold at 100, and set the budget.
    const coins = field(page, 'coins');
    for (const [name, worth] of [['silver', 10], ['gold', 100]]) {
        coins.querySelector('.ss-lines-add').click();
        const at = coins.querySelectorAll('.ss-lines-row').length - 1;
        type(cell(page, at, 'name'), name);
        type(cell(page, at, 'value'), worth);
    }
    budgetSlider(page).value = '500';
    budgetSlider(page).dispatch('change');
    assert.equal(wallet(host), 0);
    await host.send('I sell the pelt.', 'He pays.\n<Changes>\n+ coin 3 silver | from: the trader\n</Changes>');
    assert.equal(wallet(host), 30, '3 silver at 10 each');
    await host.send('More.', 'A purse.\n<Changes>\n+ coin 2 gold\n</Changes>');
    assert.equal(wallet(host), 230);
    // The worth changed here is the worth the next reply pays.
    type(cell(page, 1, 'value'), 20);
    await host.send('Again.', 'He pays.\n<Changes>\n+ coin 2 silver\n</Changes>');
    assert.equal(wallet(host), 270, '2 silver at 20 each');
    // And the budget set here holds: a reply pays at most that much, whatever its lines say.
    budgetSlider(page).value = '50';
    budgetSlider(page).dispatch('change');
    await host.send('Rich.', 'A fortune.\n<Changes>\n+ coin 3 gold\n</Changes>');
    assert.equal(wallet(host), 320, 'the budget is 50 and 3 gold is 300: 50 paid');
    host.close();
});
