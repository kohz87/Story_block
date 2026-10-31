// The real page for the Skills view and the wizard tests: the testkit host with Story Block's UI mounted on a fake DOM, the Lean RPG
// feature on, and the real view loader (the definitions' own `role` key is read; nothing is faked about it).
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { makeMessage } from '../../../ui-fake-dom.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { mountUi } from '../../../../src/v2/ui-host.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';

export const settle = async () => { for (let n = 0; n < 8; n += 1) await new Promise(resolve => setImmediate(resolve)); };
export const PARTY = 'story-block/party';
export const party = doc => doc.querySelector(`.ss-gameview [data-ss-screen="${PARTY}"]`);

/** { doc, host, ui, loads, draw }; `feature` turns the Lean RPG on first, `persona` is the reader's name, `wrap` stands between the page and the host's commands. */
export async function page(t, { feature = true, persona = null, wrap = null } = {}) {
    const doc = setupDom();
    const form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true, localStorage: null };
    const host = await createHost();
    if (persona !== null) host.ctx.name1 = persona;
    if (feature) host.features.set(CORE_FEATURE.leanRpg, true);
    const loads = [];
    const loadLeanRpg = () => { loads.push(1); return import('../../../../src/v2/lean-rpg/view/index.js'); };
    // The testkit host has no dialog opener (runtime.setDialog is the page's to plug in): the same plug, over the host's own sdk.
    let opener = null, topmost = null;
    // `wrap(type, payload, options, run)` may answer a command itself (a test makes one fail); `run` is the real one.
    const command = (type, payload, options) => (wrap ? wrap(type, payload, options, (...args) => host.sdk.command(...args)) : host.sdk.command(type, payload, options));
    const sdk = { ...host.sdk, command, dialog: Object.freeze({ open: (id, opts) => opener?.(id, opts) ?? null, current: () => topmost?.() ?? null }) };
    const runtime = { registry: host.registry, store: host.store, sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features,
        packs: host.packs, setDialog: (open, current) => { opener = open; topmost = current; } };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, loadLeanRpg });
    t.after(() => { ui.destroy(); host.close(); });
    const draw = () => { for (const old of doc.querySelectorAll('.mes')) old.remove(); host.ctx.chat.forEach((message, index) => makeMessage(doc, index)); };
    await settle();
    return { doc, host, ui, loads, draw };
}

/** A chat with its first reply, so blocks can be made (a block is made by an action on a reply). */
export async function begin(host) { await host.send('Begin.', 'Opening.'); }

/** Makes the Character and Skills blocks from the real templates (field defaults changed by `over`: { character, skills } maps). */
export async function makeBlocks(host, { who = 'Wessel', character = {}, skills = {} } = {}) {
    const slug = who.toLowerCase();
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = slug; defs.character.name = who; defs.character.state.who.default = who;
    defs.skills.slug = `${slug}-skills`; defs.skills.name = `${who}'s skills`; defs.skills.state.who.default = who;
    for (const [key, value] of Object.entries(character)) defs.character.state[key].default = value;
    for (const [key, value] of Object.entries(skills)) defs.skills.state[key].default = value;
    for (const definition of [defs.character, defs.skills]) {
        const made = await host.sdk.command('dm.define', { definition });
        assert.equal(made.ok, true, `${definition.slug}: ${made.message}`);
    }
    return { character: `pack.chat/${slug}`, skills: `pack.chat/${slug}-skills` };
}

export const fieldsOf = (host, module) => host.sdk.query('dataModules.view', { module }).chat;
