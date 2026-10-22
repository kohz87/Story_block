// Break round, cell 2 (half the features on, live p1-c2-half): with `story-block.extractor` on, a reply
// that came without its <Changes> block gets no "No change lines" note (MODULES §F40: the extractor will
// read it). When the extractor's own model call then fails (an error, a time-out — live,
// the mock's empty side answer: "assist: the reply's changes were not read: No message generated"),
// nothing was kept and nothing tells the reader: no note, no card (cards off in that run), only a console
// warning. The note should come back for a reply the extractor did not read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { makeMessage } from '../../ui-fake-dom.js';
import { setupDom } from '../view/mounts/helpers.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';

async function page(callModel) {
    const doc = setupDom();
    const form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const drawerHost = doc.createElement('div');
    drawerHost.id = 'extensions_settings';
    doc.body.appendChild(drawerHost);
    const host = await createHost({ callModel });
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    const draw = () => {
        for (const old of doc.querySelectorAll('.mes')) old.remove();
        host.ctx.chat.forEach((message, index) => makeMessage(doc, index));
        ui.notes.refreshAll();
    };
    const noteAt = index => doc.querySelector(`.mes[mesid="${index}"] .story-suite-reply-note`);
    return { host, draw, noteAt };
}

for (const [what, callModel] of [
    ['a time-out', () => new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5))],
    ['an error', async () => { throw new Error('No message generated'); }],
]) {
    test(`extractor on, its call fails (${what}): the reply without change lines still gets the "nothing was kept" note`, async () => {
        const { host, draw, noteAt } = await page(callModel);
        try {
            host.features.set(CORE_FEATURE.extractor, true);
            await host.send('and now?', 'You find a rope and pocket it.');
            await new Promise(resolve => setTimeout(resolve, 30));
            const last = host.sdk.query('assist.status')?.extractor?.last;
            assert.equal(last?.outcome, 'failed', `the extractor ran and did not read the reply: ${JSON.stringify(last)}`);
            draw();
            const note = noteAt(2);
            assert.ok(note, 'no note under a reply whose changes nobody read');
            assert.equal(note.getAttribute('data-kind'), 'missing');
        } finally {
            host.close();
        }
    });
}
