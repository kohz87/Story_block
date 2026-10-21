// b1-capture round 2, B-b1r2-4: each change line cost time in proportion to the whole domain it drafted
// (a copy, a diff and a read of the whole slice; ctx.query copied the whole state), so a 150-line reply
// after 750 story items took 6–30 s. The bus now reads the head's own frozen state and diffs only what
// changed (tests/v2/state-views.test.js holds it to the old ops).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('a 150-line reply after five such replies is captured within 3 s', async t => {
    const host = await fresh(t);
    let k = 0;
    for (let r = 0; r < 5; r += 1) await host.send('More.', reply('Things.', Array.from({ length: 150 }, () => `+ item Thing ${k += 1}`)));
    const started = performance.now();
    await host.send('More.', reply('Things.', Array.from({ length: 150 }, () => `+ item Thing ${k += 1}`)));
    const ms = performance.now() - started;
    t.diagnostic(`sixth reply: ${Math.round(ms)} ms`);
    assert.ok(ms < 3000, `the sixth reply took ${Math.round(ms)} ms`);
});

// The story's own replies may bring only 10 new kinds of item each now (r2-2), so the inventory here is
// filled the way a long story fills it, through a module's grants; then one reply names 150 of them.
test('a 150-line reply over 900 items the party holds is captured within 6 s', async t => {
    const filler = {
        id: 'filler', name: 'Filler', version: '2.0.0-alpha.1',
        commands: {
            'filler.fill'(ctx, { from, n }) {
                for (let i = from; i < from + n; i += 1) ctx.call('inventory.grant', { name: `Thing ${i}`, owner: 'party' });
                return { summary: `${n} things.` };
            },
        },
    };
    const host = await fresh(t, { modules: [filler] });
    for (let from = 0; from < 900; from += 300) assert.equal((await host.sdk.command('filler.fill', { from, n: 300 })).ok, true);
    assert.equal(Object.keys(host.head().domains.inventory.stacks).length, 900);
    const started = performance.now();
    await host.send('More.', reply('Things.', Array.from({ length: 150 }, (_, i) => `+ item Thing ${i * 6}`)));
    const ms = performance.now() - started;
    t.diagnostic(`150 lines over 900 items: ${Math.round(ms)} ms`);
    const held = host.sdk.query('inventory.items').filter(item => item.qty === 2).length;
    assert.equal(held, 150, 'every line was taken');
    assert.ok(ms < 6000, `the reply took ${Math.round(ms)} ms`);
});
