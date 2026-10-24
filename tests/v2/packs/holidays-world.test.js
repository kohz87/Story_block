// A pack calendar's holidays reach Story Director's World screen: its Upcoming lists those within its
// range (director.world), on the pack's calendar. Needs a Story Director checkout beside this one
// (<root>/Story_director, or STORY_SUITE_ROOT); skipped otherwise. Story Block's own side of holidays
// (validation, packs.calendar) is in ersveil-format.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHost } from '../../../testkit/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
function directorModule() {
    const roots = [process.env.STORY_SUITE_ROOT, path.resolve(here, '../../../..')].filter(Boolean);
    for (const root of roots) {
        const file = path.join(root, 'Story_director', 'src', 'v2', 'module.js');
        if (existsSync(file)) return file;
    }
    return null;
}
const SD_FILE = directorModule();
let SD = null;
if (SD_FILE) {
    try { SD = await import(pathToFileURL(SD_FILE).href); } catch { SD = null; }
}
const skip = SD?.createModule && SD.createModule().queries?.['director.world'] ? false : 'no Story Director checkout with the World screen beside this one (Story_director, or STORY_SUITE_ROOT)';

const PACK = {
    id: 'holiday-test', version: '1.0.0', name: 'Holiday test', requires: { storyBlock: '^2' },
    calendar: {
        era: 'CY',
        months: [{ name: 'Dawnwane', days: 30 }, { name: 'Rainmoot', days: 30 }, { name: 'Goldwane', days: 30 }],
        start: { year: 611, month: 'Rainmoot', day: 20, hour: 8 },
        holidays: [{ name: 'Lantern Night', month: 'Goldwane', day: 2 }, { name: 'First Light', month: 1, day: 1 }, { name: 'Rain Feast', month: 'Rainmoot', day: 25 }],
    },
};

test('Story Director\'s World Upcoming shows the pack\'s holidays in its range', { skip }, async () => {
    // Install the pack before the chat starts, so the chat's clock runs on its calendar from its start.
    const probe = await createHost({ settings: {} });
    const done = await probe.packs.packs.install(JSON.stringify(PACK), { origin: 'pack.json' });
    assert.equal(done.ok, true, JSON.stringify(done.errors));
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    let host = null;
    const sd = SD.createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ settings, modules: [sd] });
    try {
        assert.deepEqual(host.sdk.query('packs.calendar').holidays.map(day => day.name), ['Lantern Night', 'First Light', 'Rain Feast']);
        await host.send('Hello.', 'The quay at dawn.\n\n<Changes>\n~ place Bluewatch\n</Changes>');
        const world = host.sdk.query('director.world');
        assert.equal(world.clockSet, true, 'the pack\'s start set the clock');
        // Rainmoot 20 → Rain Feast in 5 days, Lantern Night (Goldwane 2) in 12; First Light (next Dawnwane 1) is past 30 days.
        const holidays = world.upcoming.filter(item => item.kind === 'holiday');
        assert.deepEqual(holidays.map(item => [item.name, item.label]), [['Rain Feast', 'in 5 days'], ['Lantern Night', 'in 12 days']]);
    } finally {
        host.close();
    }
});
