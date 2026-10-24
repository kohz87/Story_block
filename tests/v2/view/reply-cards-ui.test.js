// One reply card drawn (fix 8e, view/reply-cards-ui.js): the ring by tone, the tile, the rows and their tags, at most three buttons with
// the primary in the accent, Later only when the card asks for it, the folded line, and what a click does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawReplyCard } from '../../../src/v2/view/reply-cards-ui.js';
import { normalizeCard } from '../../../src/v2/reply-cards.js';
import { setupDom } from './mounts/helpers.js';

const card = normalizeCard({
    tone: 'good', icon: 'ph-user', title: 'Start your adventure', text: 'Make your character.',
    rows: [{ icon: 'ph-star', text: 'Race', tag: 'new', tagTone: 'good' }, { text: 'Talents' }],
    actions: [{ id: 'create', label: 'Create character', command: 'creation.start', primary: true }, { id: 'skip', label: 'Skip', command: 'creation.skip' }],
    later: true,
});

test('a card: the tone ring, the tile and the title, the rows with their tags, the buttons with the primary in the accent, Later', () => {
    const doc = setupDom();
    const node = drawReplyCard(doc, { key: 'qa/start', card }, { head: true });
    assert.equal(node.getAttribute('data-ss-reply-card'), 'qa/start');
    assert.equal(node.getAttribute('data-tone'), 'good');
    assert.ok(node.getAttribute('class').includes('ss-rc-good'));
    assert.equal(node.getAttribute('aria-label'), 'Start your adventure');
    assert.equal(node.querySelector('.ss-rc-title').textContent, 'Start your adventure');
    assert.equal(node.querySelector('.ss-rc-text').textContent, 'Make your character.');
    assert.ok(node.querySelector('.ss-rc-tile'), 'the icon tile');
    const rows = node.querySelectorAll('.ss-rc-row');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector('.ss-rc-row-text').textContent, 'Race');
    assert.equal(rows[0].querySelector('.ss-rc-tag').textContent, 'new');
    assert.ok(rows[0].querySelector('.ss-rc-tag').getAttribute('class').includes('ss-rc-tag-good'));
    const buttons = node.querySelectorAll('.ss-rc-action');
    assert.deepEqual(buttons.map(button => button.textContent), ['Create character', 'Skip', 'Later']);
    assert.ok(buttons[0].getAttribute('class').includes('ss-rc-primary'), 'the primary button is the accent one');
    assert.ok(!buttons[1].getAttribute('class').includes('ss-rc-primary'));
});

test('the buttons of a card that is not the newest reply are disabled, and say why', () => {
    const doc = setupDom();
    const node = drawReplyCard(doc, { key: 'qa/start', card }, { head: false });
    const button = node.querySelector('.ss-rc-action');
    assert.equal(button.disabled, true);
    assert.ok(button.getAttribute('title').includes('newest reply'));
});

test('clicks: an action hands its own object to onAct; Later hands on; a folded card hands off to unfold', () => {
    const doc = setupDom();
    const acted = [];
    const folds = [];
    const node = drawReplyCard(doc, { key: 'k', card }, { head: true, onAct: action => acted.push(action.id), onFold: on => folds.push(on) });
    const [create, , later] = node.querySelectorAll('.ss-rc-action');
    create.click();
    later.click();
    assert.deepEqual(acted, ['create']);
    assert.deepEqual(folds, [true]);
});

test('a card without Later has no Later button; a folded card is one line with the first row, then Open', () => {
    const doc = setupDom();
    const plain = normalizeCard({ title: 'Battle', tone: 'bad', rows: [{ text: 'Ridge Wolf ×2' }], actions: [] });
    assert.equal(drawReplyCard(doc, { key: 'b', card: plain }, { head: true }).querySelector('.ss-rc-later'), null);
    const folds = [];
    const line = drawReplyCard(doc, { key: 'k', card }, { folded: true, onFold: on => folds.push(on) });
    assert.equal(line.querySelector('.ss-rc-line').textContent, 'Start your adventure · Race · Open');
    line.querySelector('.ss-rc-line').click();
    assert.deepEqual(folds, [false]);
    const bare = drawReplyCard(doc, { key: 'b', card: normalizeCard({ title: 'Battle' }) }, { folded: true });
    assert.equal(bare.querySelector('.ss-rc-line').textContent, 'Battle · Open', 'no row: the text, then Open');
});

test('a module\'s words are printed as text, never as markup', () => {
    const doc = setupDom();
    const hostile = normalizeCard({ title: '<b>bold</b>', text: '<img src=x onerror=1>', rows: [{ text: '<i>x</i>' }] });
    const node = drawReplyCard(doc, { key: 'h', card: hostile }, { head: true });
    assert.equal(node.querySelector('img'), null);
    assert.equal(node.querySelector('.ss-rc-title').children.length, 0, 'the title is text only');
    assert.equal(node.querySelector('.ss-rc-text').children.length, 0);
    assert.equal(node.querySelector('.ss-rc-title').textContent, '<b>bold</b>');
});
