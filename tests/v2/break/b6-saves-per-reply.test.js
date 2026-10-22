// B-b6-soak-6: every reply costs Story Block two whole-chat saves of its own before SillyTavern's own
// after-reply save: turn.js:192 flushes right after a beforeGenerate cue commits (Story Director's
// chronicle.surface does so before most replies once more than three world events are open; atlas.visit
// when the scene moves), and turn.js:403 flushes again at the end of the capture. Each save uploads the
// whole chat file, inside the interceptor (the request waits for it) and inside MESSAGE_RECEIVED (the
// reply is not drawn until it ends). In the soak this made the reply's request wait ~0.9 s and the
// capture ~2 s at 300 replies, growing linearly with the file. SPEC §3.3: one save per burst; the
// cue's ops can ride on the capture's save (or SillyTavern's own), since the reply is on its way.
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

// A module shaped like Story Director's chronicle part: a system command before every reply.
const surface = {
    id: 'zz-surface', name: 'Surface', version: '0.0.0',
    domains: { surface: { initial: () => ({ round: 0 }), validate: () => [] } },
    commands: { 'surface.pick'(ctx) { ctx.draft('surface').round += 1; return { summary: 'picked', narrate: false }; } },
    hooks: { beforeGenerate: () => ({ commands: [{ type: 'surface.pick', payload: {} }] }) },
};

test('one ordinary reply with a cue and a change line costs Story Block at most one chat save', async () => {
    const host = await createHost({ modules: [surface], st: { greeting: 'The quay.' } });
    await host.send('I look around.', 'Gulls.\n\n<Changes>\n+ present Fenna\n</Changes>');
    const before = host.st.saves.length;
    await host.send('I wait.', 'Rain.\n\n<Changes>\n+ present Marrit\n</Changes>');
    const saves = host.st.saves.length - before;
    assert.equal(host.head().domains.surface.round, 2, 'the cue ran before each reply');
    assert.ok(saves <= 1, `Story Block saved the whole chat ${saves} times for one reply`);
    host.close();
});
