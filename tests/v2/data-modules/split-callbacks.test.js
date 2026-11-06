import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataModules } from '../../../src/v2/data-modules/check.js';
import { createDataModulesPart } from '../../../src/v2/data-modules/part.js';

test('block edits call the supplied restore reader without a receiver', () => {
    const receivers = [];
    const part = createDataModulesPart({ restore: function () {
        receivers.push(this);
        return { state: this === undefined ? 'pending' : 'idle' };
    } });
    const ctx = { cause: 'ui', caller: null, fail: (code, message) => ({ ok: false, code, message }) };

    const result = part.commands['dm.define'](ctx, { definition: { slug: 'hero' } });

    assert.equal(result.code, 'RESTORE_PENDING');
    assert.deepEqual(receivers, [undefined]);
});

test('story XP uses the supplied settings reader without a receiver', () => {
    const checked = validateDataModules([{
        slug: 'hero', name: 'Hero', schema: 1, stateVersion: 1, scope: 'chat', role: 'character',
        state: { xp: { type: 'int', min: 0, max: 100, default: 0 } },
        kinds: { gain: { op: '+', labels: { by: { type: 'int', min: 1, max: 100 } },
            effects: [{ op: 'add', path: ['xp'], value: ['arg', 'by'], bounds: 'clamp' }] } },
    }], { packId: 'chat', capabilities: ['data-modules-v1'] });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const [definition] = checked.definitions;
    const domain = { pins: { hash: { interpreter: 1, definition } },
        active: { [definition.id]: { hash: 'hash', generation: 1, subjects: ['chat'] } },
        instances: { [definition.id]: { chat: { fields: { xp: 0 }, timers: {}, offers: {}, settled: {} } } }, perReply: {} };
    const draft = structuredClone(domain), receivers = [];
    const part = createDataModulesPart({ settings: function () {
        receivers.push(this);
        return { rpgXpRate: this === undefined ? 200 : 50 };
    } });
    const ctx = {
        cause: 'story', caller: null, source: { sid: 's', swipeKey: 'w' }, epoch: 0,
        read: name => name === 'dataModules' ? domain : null,
        draft: () => draft, feature: () => true, claim: () => true,
        cursor: () => ({ block: 1 }), replayGuard() {},
        fail: (code, message) => { throw new Error(`${code}: ${message}`); },
    };

    part.commands['dm.capture'].handler(ctx, { op: '+', name: 'hero', labels: { kind: 'gain', by: '4' } });

    assert.equal(draft.instances[definition.id].chat.fields.xp, 8);
    assert.deepEqual(receivers, [undefined]);
});
