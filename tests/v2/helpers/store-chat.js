// Fakes for the store tests: a SillyTavern-like chat with swipes, and a store wired to it.
import { register } from 'node:module';
import { apply } from './ops-stub.js';

register('./ops-hooks.mjs', import.meta.url);
const { createStore } = await import('../../../src/v2/store.js');

export { apply, createStore };

export const initial = () => ({ v: 2, meta: { rev: 0, claims: {} }, domains: { inventory: { stacks: {} }, scene: { place: '' } } });

export const greeting = (mes = 'Hello.') => ({ name: 'Narrator', is_user: false, mes, swipe_id: 0, swipes: [mes],
    swipe_info: [{ extra: {} }], extra: {} });
export const user = (mes = 'I look around.') => ({ name: 'You', is_user: true, mes, extra: {} });
export const reply = (mes = 'You see a lake.') => ({ name: 'Narrator', is_user: false, mes, swipe_id: 0, swipes: [mes],
    swipe_info: [{ extra: {} }], extra: {} });

// SillyTavern's new swipe: the old extra is copied into the new swipe (the worst case v1 met).
export function newSwipe(message, mes = `${message.mes} (again)`) {
    message.swipes.push(mes);
    message.swipe_info.push({ extra: structuredClone(message.extra) });
    message.swipe_id = message.swipes.length - 1;
    message.extra = structuredClone(message.extra);
    message.mes = mes;
}

export function showSwipe(message, swipe) {
    message.swipe_id = swipe;
    message.extra = structuredClone(message.swipe_info[swipe].extra);
    message.mes = message.swipes[swipe];
}

export function deleteSwipe(message, swipe) {
    message.swipes.splice(swipe, 1);
    message.swipe_info.splice(swipe, 1);
    showSwipe(message, Math.min(swipe, message.swipes.length - 1));
}

let seq = 0;
export const receipt = (fields = {}) => ({ id: `rc_${(++seq).toString(36).padStart(8, '0')}`, type: 'test.do',
    module: 'test', cause: 'ui', seed: 1, summary: 'Something happens.', narrate: true, data: {}, rev: 0, ...fields });

// One committed action: set meta.rev and put a stack.
export function action(store, id, qty, fields = {}) {
    const rev = store.head().meta.rev + 1;
    const r = receipt({ rev, ...fields });
    const ops = [{ op: 'replace', path: '/meta/rev', value: rev },
        { op: store.head().domains.inventory.stacks[id] ? 'replace' : 'add', path: `/domains/inventory/stacks/${id}`, value: { id, qty } }];
    store.append({ ops, receipt: r });
    return r;
}

export function setup(messages = [greeting()], options = {}) {
    const ctx = { chat: messages, saves: 0 };
    const store = createStore({ chat: () => ctx.chat, save: async () => { ctx.saves++; }, apply, recordId: nextId, ...options });
    return { ctx, store };
}

let ids = 0;
export const nextId = () => `sw_${(++ids).toString(36).padStart(8, '0')}`;

// Full replay ignoring every checkpoint but the first: what the checkpoints must agree with.
export function fullReplay(chat, upTo) {
    let state = null;
    for (let i = 0; i <= upTo; i++) {
        const message = chat[i];
        if (message.is_user) continue;
        const record = message.extra?.storySuite;
        if (!record || record.v !== 2 || (record.swipe ?? 0) !== (message.swipe_id ?? 0)) continue;
        if (!state && record.checkpoint) state = structuredClone(record.checkpoint);
        if (state) state = apply(state, record.ops);
    }
    return state;
}

export const withoutStory = value => JSON.parse(JSON.stringify(value, (key, val) => (key === 'storySuite' ? undefined : val)));
