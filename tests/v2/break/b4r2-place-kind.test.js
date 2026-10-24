// B4r2-5 (Story Block only, mirrored from Story Director's b4r2-place-kind-carried): a move line
// without `| kind:` carried the old place's kind to the new one, so walking from "East Ridge | kind:
// wild" back to "~ place Bluewatch Village" made the village wild. A move takes the kind the pack
// gives a place of that name (else none); the same place keeps its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';

const PACK = readFileSync(new URL('../../../examples/packs/ersveil-bluewatch/pack.json', import.meta.url), 'utf8');
const said = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const kind = host => host.head().domains.scene.place.kind;

test('moving to another place without a kind does not carry the old place\'s kind there', async () => {
    const probe = await createHost();
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    const host = await createHost({ settings });
    try {
        await host.send('Here.', said('The village.', ['~ place Bluewatch Village | kind: settlement']));
        await host.send('Out we go.', said('The ridge.', ['~ place East Ridge | kind: wild']));
        await host.send('Further.', said('A hollow.', ['~ place Nameless Hollow']));
        assert.equal(kind(host), '', 'a place no pack knows gets no kind');
        await host.send('Back.', said('Back in town.', ['~ place Bluewatch Village']));
        assert.equal(kind(host), 'settlement', 'the pack\'s kind for Bluewatch Village');
        await host.send('Still here.', said('The square.', ['~ place Bluewatch Village | region: Lakeshire']));
        assert.equal(kind(host), 'settlement', 'the same place keeps its kind');
    } finally { host.close(); }
});
