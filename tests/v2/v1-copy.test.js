// An old copy of Story Block (version 1) enabled next to this one (src/v2/v1-copy.js): told once, as one plain Problems line
// with a notice, from v1's own signs only (its public object, before or after this copy set its own, and its settings
// drawer), never from anything else, and not at all once it is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { V1_COPY_CODE, V1_COPY_PROBLEM, createV1Watch, hasV1Settings, isV1Api } from '../../src/v2/v1-copy.js';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
// v1's public object as index.v1.js builds it (the parts the check looks at).
const v1Api = () => Object.freeze({ version: '0.9.31', apiVersion: 1, listBlocks: () => [], getBlock: () => null, registerBlock: () => ({ ok: true }), refresh: () => {} });
const v2Api = () => Object.freeze({ apiVersion: 2, version: '2.16.3', ready: Promise.resolve(), sdk: {} });
const docWith = ids => ({ getElementById: id => (ids.includes(id) ? { id } : null) });
function watch({ before = null, now = null, doc = docWith([]) } = {}) {
    const told = [];
    const w = createV1Watch({ before, current: () => now, doc, report: entry => told.push(entry), problems: () => told });
    return { w, told, set: value => { now = value; } };
}

test('v1\'s signs are the ones index.v1.js makes, and v2 makes none of them', () => {
    const v1 = read('index.v1.js');
    assert.match(v1, /globalThis\.StoryBlock = Object\.freeze\(\{\s*version: VERSION,\s*apiVersion: 1,/);
    for (const name of ['listBlocks', 'getBlock', 'registerBlock']) assert.match(v1, new RegExp(`\\b${name}\\b`));
    for (const id of ['story_block_rescan', 'story_block_display', 'story_block_money']) assert.ok(v1.includes(`id="${id}"`), id);
    const v2 = read('index.js');
    assert.match(v2, /globalThis\.StoryBlock = Object\.freeze\(\{ apiVersion: 2,/);
    const sources = readdirSync(new URL('../../src/v2/', import.meta.url), { recursive: true }).filter(name => /\.(js|html|css)$/.test(name) && name !== 'v1-copy.js').map(name => read(`src/v2/${name}`)).join('\n');
    for (const id of ['story_block_rescan', 'story_block_display', 'story_block_money']) assert.ok(!sources.includes(id), `v2 never uses ${id}`);
});

test('isV1Api and hasV1Settings: v1\'s object and drawer only', () => {
    assert.equal(isV1Api(v1Api()), true);
    for (const other of [v2Api(), null, undefined, 1, 'StoryBlock', {}, { apiVersion: 1 }, { ...v1Api(), sdk: {} }, { apiVersion: '1', listBlocks() {}, getBlock() {}, registerBlock() {} }]) {
        assert.equal(isV1Api(other), false, JSON.stringify(other));
    }
    const throwing = new Proxy({}, { get() { throw new Error('no'); } });
    assert.equal(isV1Api(throwing), false);
    assert.equal(hasV1Settings(docWith(['story_block_rescan'])), true);
    assert.equal(hasV1Settings(docWith(['story_suite_v2_bar', 'npc_state_delta_launcher_with_story_block'])), false);
    assert.equal(hasV1Settings(null), false);
    assert.equal(hasV1Settings({ getElementById() { throw new Error('no'); } }), false);
});

test('v1 loaded before this copy: told once, a plain line with a notice', () => {
    const { w, told } = watch({ before: v1Api(), now: v2Api() });
    assert.equal(w.check(), true);
    assert.equal(w.check(), true);
    assert.deepEqual(told, [{ code: V1_COPY_CODE, message: V1_COPY_PROBLEM, toast: true }]);
    assert.equal(V1_COPY_PROBLEM, 'An old copy of Story Block (version 1) seems to be installed too; remove it under Extensions.');
});

test('v1 loaded after this copy (its object put back over ours), or its drawer on the page: told once', () => {
    const late = watch({ now: v2Api() });
    assert.equal(late.w.check(), false);
    late.set(v1Api());
    assert.equal(late.w.check(), true);
    assert.equal(late.told.length, 1);
    const drawer = watch({ now: v2Api(), doc: docWith(['story_block_display']) });
    assert.equal(drawer.w.check(), true);
    assert.equal(drawer.told.length, 1);
});

test('no v1: nothing is ever said (this copy alone, nothing set, a module\'s own object, legacy text in the chat)', () => {
    for (const setup of [{ now: v2Api() }, { now: undefined }, { before: v2Api(), now: v2Api() }, { before: { apiVersion: 2, sdk: {} }, now: null }]) {
        const { w, told } = watch(setup);
        assert.equal(w.check(), false);
        assert.deepEqual(told, []);
    }
});
