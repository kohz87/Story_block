// Screens that name one `tab` are one tab, each a section of it (view/tab-merge.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTabs, MERGED_PREFIX } from '../../../src/v2/view/tab-merge.js';

const text = value => ({ type: 'text', value });
const screen = (id, extra = {}) => ({ id, title: id.toUpperCase(), icon: 'fa-flag', mounts: ['tab', 'card'], layout: { root: text(id) }, pack: `dm:${id}`, ...extra });
const kinds = merged => merged.layout.root.children.map(child => (child.type === 'story-block.heading' ? `h:${child.props.title}` : child.value ?? child.type));

test('screens with the same tab become one screen, in order, each under its own header', () => {
    const out = mergeTabs([screen('a', { tab: 'rep', order: 3 }), screen('b', { tab: 'rep', tabTitle: 'Reputation', order: 1 }), screen('c', { tab: 'rep', order: 2 })]);
    assert.equal(out.length, 1);
    const [merged] = out;
    assert.equal(merged.id, `${MERGED_PREFIX}rep`);
    assert.equal(merged.title, 'Reputation', 'the first tabTitle given names the tab');
    assert.deepEqual(kinds(merged), ['h:B', 'b', 'h:C', 'c', 'h:A', 'a']);
    assert.equal(merged.order, 1);
    assert.deepEqual(merged.mounts, ['tab'], 'a card mount is not a tab section');
    assert.equal(merged.pack, 'dm:a', 'the pack of the first screen given');
    assert.equal(Object.hasOwn(merged, 'tab'), false);
});

test('the merged screen takes the first tabTitle in the order the screens are given, else the first title', () => {
    assert.equal(mergeTabs([screen('a', { tab: 'rep', tabTitle: 'First' }), screen('b', { tab: 'rep', tabTitle: 'Second', order: 0 })])[0].title, 'Second', 'sorted first by order, then the first title found');
    assert.equal(mergeTabs([screen('a', { tab: 'rep' }), screen('b', { tab: 'rep' })])[0].title, 'A');
});

test('a section that draws its own header gets none added; a screen with no order keeps the order given', () => {
    const own = { ...screen('f', { tab: 'rep' }), layout: { root: { type: 'story-block.fields', props: { module: 'pack.x/f', field: 'f' } } } };
    const out = mergeTabs([screen('a', { tab: 'rep' }), own, screen('z', { tab: 'rep' })]);
    assert.deepEqual(kinds(out[0]), ['h:A', 'a', 'story-block.fields', 'h:Z', 'z']);
});

test('a lone screen with a tab is still a tab of its own; the merged screen stands where the first member stood', () => {
    const out = mergeTabs([screen('x'), screen('a', { tab: 'rep' }), screen('y'), screen('b', { tab: 'rep' })]);
    assert.deepEqual(out.map(entry => entry.id), ['x', `${MERGED_PREFIX}rep`, 'y']);
    assert.equal(mergeTabs([screen('only', { tab: 'solo', tabTitle: 'Solo' })])[0].title, 'Solo');
});

test('a screen that cannot be a section (a template, or only a card) passes through, minus its tab keys', () => {
    const template = { id: 't', mounts: ['tab'], template: '<p>t</p>', tab: 'rep', tabTitle: 'Rep', pack: 'p' };
    const card = screen('c', { tab: 'rep', mounts: ['card'] });
    const out = mergeTabs([template, card, screen('a', { tab: 'rep' })]);
    assert.deepEqual(out.map(entry => entry.id), ['t', 'c', `${MERGED_PREFIX}rep`]);
    assert.equal(Object.hasOwn(out[0], 'tab') || Object.hasOwn(out[0], 'tabTitle') || Object.hasOwn(out[1], 'tab'), false);
});

test('the tab is in the bar when any member is, and keeps the mounts the members share between them', () => {
    const out = mergeTabs([screen('a', { tab: 'rep', mounts: ['tab'] }), screen('b', { tab: 'rep', mounts: ['screen', 'tab'], bar: true })]);
    assert.equal(out[0].bar, true);
    assert.deepEqual(out[0].mounts.sort(), ['screen', 'tab']);
    assert.deepEqual(mergeTabs([screen('a'), screen('b', { tab: 'q' })]).map(entry => entry.id), ['a', `${MERGED_PREFIX}q`]);
});
