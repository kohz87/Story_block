// Tabs shown only while active, on the real host (fix 8e): Settings → Tabs shows "shown only while active" (or the screen's own note)
// in place of a switch for such a screen or a module's tab; an ordinary tab keeps its switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../src/v2/runtime.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { createFakeContext } from '../../testkit/fake-st.js';
import { setupDom } from './view/mounts/helpers.js';

test('Settings → Tabs: an active screen or tab has its note and no switch; an ordinary one keeps its switch', async () => {
    const doc = setupDom();
    const st = createFakeContext();
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    await runtime.turn.onChatChanged();
    await runtime.sdk.registerModule({
        id: 'qa-fight',
        name: 'Fight',
        version: '2.0.0-alpha.1',
        screens: [
            { id: 'qa-fight/field', title: 'Field', icon: 'fa-khanda', mounts: ['screen'], template: '<p>Field</p>', active: () => ({ on: false }), activeNote: 'Shown during battles.' },
            { id: 'qa-fight/notes', title: 'Notes', icon: 'fa-note-sticky', mounts: ['screen'], template: '<p>Notes</p>' },
        ],
        tabs: [{ id: 'bout', title: 'Bout', icon: 'fa-hand-fist', render: () => {}, active: () => ({ on: false }) }],
    });
    ui.refresh();
    const rows = ui.tabs.rows();
    const field = rows.find(row => row.id === 'qa-fight/field');
    assert.equal(field.activeNote, 'Shown during battles.', 'the screen\'s own note');
    const bout = rows.find(row => row.id === 'qa-fight/bout');
    assert.equal(bout.activeNote, 'Shown only while it is active (during a battle, for example).', 'a tab with no note of its own gets the default');
    const notes = rows.find(row => row.id === 'qa-fight/notes');
    assert.equal(notes.activeNote, undefined, 'an ordinary screen has a switch, not a note');
    // The off one is not on the bar, but it still opens by id.
    assert.equal(ui.mounts.screen.open('qa-fight/field'), true);
    assert.equal(ui.mounts.screen.current(), 'qa-fight/field');
});
