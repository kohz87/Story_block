// C3-5: the registry keeps the module's own definition object and reads its `features` again on every
// featureOn / features() call (registry.js featureDecl: `feature.label.trim()`, `def.features.find`). A
// module that changes its definition after registering (a label set to a number, a feature pushed later)
// makes sdk.features(), sdk.feature(), the reader's features.set/list (the settings overlay's Features
// list) throw, and its kind lines are lost (invariant 4: nothing throws to the reader).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const ticks = () => ({
    id: 'tk', name: 'Ticks', version: '0.0.1',
    features: [{ id: 'tk.kind', label: 'Ticks' }],
    domains: { tkd: { initial: () => ({ ticks: {} }) } },
    capture: {
        kinds: { tick: { grammar: '~ tick Name | n: 1-9', feature: 'tk.kind' } },
        apply(ctx, line) { ctx.draft('tkd').ticks[line.name] = Number(line.labels?.n ?? 1); return { summary: line.name, narrate: false }; },
    },
});

for (const [name, change] of [
    ['a label changed to a number', def => { def.features[0].label = 7; }],
    ['a feature pushed after registering', def => { def.features.push({ id: 'tk.late', label: 'Late' }); }],
]) {
    test(`a module's definition changed after it registered (${name}) does not make the features calls throw`, async t => {
        t.mock.method(console, 'warn', () => {});
        const def = ticks();
        const host = await createHost({ modules: [def] });
        t.after(() => host.close());
        change(def);
        assert.doesNotThrow(() => host.sdk.features());
        assert.doesNotThrow(() => host.sdk.feature('tk.kind'));
        assert.doesNotThrow(() => host.features.list());
        assert.doesNotThrow(() => host.features.set('tk.kind', true));
        await host.send('One.', 'Reply.\n<Changes>\n~ tick Alpha | n: 4\n</Changes>');
        assert.deepEqual(host.head().domains.tkd.ticks, { Alpha: 4 });
    });
}
