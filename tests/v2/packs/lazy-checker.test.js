// The pack checker loads on first need (packs/installed.js). This file has its own process, so the checker starts unloaded here (the
// other lazy-load tests share one process, where an earlier install has already loaded it): a stored pack is "still loading" and gives
// no content until the checker lands, that answer is never kept, and the turn's wait (ready) is what ends the gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstalled, checkerLoaded } from '../../../src/v2/packs/installed.js';

const TINY = { id: 'tiny', name: 'Tiny', version: '1.0.0', requires: { storyBlock: '^2' }, content: { items: [{ name: 'Brass key', slot: 'hand' }] } };
const root = { packs: [{ id: 'tiny', version: '1.0.0', enabled: true, source: 'file', origin: '', pack: TINY }] };
const installed = createInstalled({ settings: { read: () => root, save: () => {} } });

test('a stored pack before the checker lands: listed as loading, no content, nothing kept; after ready() it is whole', async () => {
    assert.equal(checkerLoaded(), false, 'a fresh process has no checker');
    assert.deepEqual(installed.packs(), [], 'no content while the checker is on its way');
    assert.equal(installed.list()[0].problem, 'The pack checker is still loading.');
    assert.equal(installed.inspect(TINY).errors[0].code, 'LOADING');
    await installed.ready();
    assert.equal(checkerLoaded(), true);
    assert.equal(installed.list()[0].problem, '', 'the loading answer was not kept');
    assert.deepEqual(installed.packs().map(pack => pack.id), ['tiny']);
    assert.equal(installed.ready(), undefined, 'nothing left to wait for');
});
