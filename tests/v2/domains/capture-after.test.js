// A capture kind with `after: ['place', 'mount']` (registry captureEntry, turn.js linesInOrder): its lines of a reply run behind the reply's
// lines of those kinds, whatever order they were written in; every other line keeps its place. Story Director's `~ trip` uses it, so the
// trip is planned from the place and the mounts the same reply sets up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const block = lines => `The road.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// A module whose `plan` kind notes the scene's place and the party's mounts as they stand when its line runs; `note` has no `after`.
const seen = [];
const PLANNER = {
    id: 'planner',
    name: 'Planner',
    capture: {
        kinds: { plan: { grammar: '~ plan Where', after: ['place', 'mount', 'nothing'] }, note: { grammar: '~ note Text' } },
        apply(ctx, line) {
            seen.push({ kind: line.kind, name: line.name, place: ctx.query('scene.place')?.name ?? '', mounts: (ctx.query('mounts.list') ?? []).length });
            return { summary: `${line.kind}: ${line.name}`, narrate: false };
        },
    },
};

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    seen.length = 0;
    const host = await createHost({ modules: [PLANNER] });
    t.after(() => host.close());
    return host;
}

test('a kind with `after` runs behind the reply\'s place and mount lines; the others keep their order', async t => {
    const host = await fresh(t);
    await host.send('Go.', block(['~ note first', '~ plan one', '~ place Vell Harbour | kind: settlement', '~ note second', '+ mount Grey Mare | kind: horse', '~ plan two', '~ note third']));
    const order = seen.map(item => `${item.kind}:${item.name}`);
    // The place line and the mount line are the scene's own; the planner's lines move behind the last of them (the mount line).
    assert.deepEqual(order, ['note:first', 'note:second', 'plan:one', 'plan:two', 'note:third']);
    const one = seen.find(item => item.name === 'one');
    assert.equal(one.place, 'Vell Harbour', 'the plan line written before the place line sees the place');
    assert.equal(one.mounts, 1, 'and the mount written after it');
});

test('with no line of the named kinds the order is the written one; a Re-read runs the same order again and changes nothing', async t => {
    const host = await fresh(t);
    await host.send('Go.', block(['~ plan one', '~ note two']));
    assert.deepEqual(seen.map(item => item.name), ['one', 'two']);
    seen.length = 0;
    await host.send('Go on.', block(['~ plan three', '~ place Vell Harbour | kind: settlement']));
    assert.deepEqual(seen.map(item => [item.name, item.place]), [['three', 'Vell Harbour']]);
    const before = JSON.stringify(host.head().domains.scene);
    const index = host.ctx.chat.length - 1;
    seen.length = 0;
    const result = await host.sdk.reread(index);
    assert.equal(result.ok, true);
    assert.deepEqual(seen.map(item => [item.name, item.place]), [['three', 'Vell Harbour']], 'the Re-read runs the plan line after the place line too');
    assert.equal(JSON.stringify(host.head().domains.scene), before);
});
