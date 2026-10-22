// C3-4: Re-read of a reply while one of its kinds' features is off drops what those lines made: the
// reply's story receipts are all replaced and the off lines are skipped (FEATURE_OFF), so the feature's
// state from that reply is gone for good; turning the feature on again does not bring it back.
// SPEC §6 Features: "Its state is never touched: turning the feature on again brings everything back as it was."
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const ticks = () => ({
    id: 'tk', name: 'Ticks', version: '0.0.1',
    features: [{ id: 'tk.kind', label: 'Ticks' }],
    domains: { tkd: { initial: () => ({ ticks: {} }) } },
    capture: {
        kinds: { tick: { grammar: '~ tick Name | n: 1-9', feature: 'tk.kind' }, tock: { grammar: '+ tock Name' } },
        apply(ctx, line) {
            if (line.kind === 'tick') ctx.draft('tkd').ticks[line.name] = Number(line.labels?.n ?? 1);
            return { summary: line.name, narrate: false };
        },
    },
});

test('Re-read while a feature is off keeps that feature\'s changes on the reply', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [ticks()] });
    t.after(() => host.close());
    await host.send('One.', 'Reply one.\n<Changes>\n~ tick Alpha | n: 4\n+ tock Beta\n</Changes>');
    const index = host.ctx.chat.length - 1;
    assert.deepEqual(host.head().domains.tkd.ticks, { Alpha: 4 });
    host.features.set('tk.kind', false);
    const reread = await host.sdk.reread(index);
    assert.equal(reread.ok, true);
    host.features.set('tk.kind', true);
    assert.deepEqual(host.head().domains.tkd.ticks, { Alpha: 4 }, 'turning the feature back on brings the tick back');
});
