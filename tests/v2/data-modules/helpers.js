import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';

export const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
export const reply = (...lines) => `The story.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
export const int = (value = 0, min = 0, max = 100) => ({ type: 'int', min, max, default: value });
export const definition = () => ({ slug: 'counter', name: 'Counter', schema: 1, stateVersion: 1, scope: 'chat',
    state: { points: int() }, kinds: { gain: { op: '+', ui: true, labels: {}, effects: [{ op: 'add', path: ['points'], value: 1, bounds: 'clamp' }] } } });
export const pack = (definitions = [definition()]) => ({ id: 'dm-test', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1'] }, content: { dataModules: definitions } });
export const success = result => { assert.equal(result.ok, true, `${result.code}: ${result.message ?? JSON.stringify(result.errors)}`); return result; };
export async function world(t, input = fixture('reputation'), modules = []) {
    const host = await createHost({ modules }); t.after(() => host.close());
    success(await host.packs.packs.install(input));
    return host;
}
export async function pin(host, subjects = [], index = 0) {
    const offer = host.sdk.query('dataModules.offers')[index];
    success(await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash, subjects }));
    return offer;
}
export const view = (host, module = 'pack.ersveil-factions/reputation') => host.sdk.query('dataModules.view', { module });
export function rebuilt(host) {
    const state = JSON.stringify(host.head()); host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), state, 'cold rebuild equals live');
}
// A small unit-test owner of SD's published state contracts. Integration tests use real SD.
export function directorStub({ minute = 1000, actors = [{ id: 'ca_wessel01', name: 'Wessel', bonuses: {} }] } = {}) {
    return { id: 'story-director', version: '2.0.0', domains: {
        director: { initial: () => ({ time: { minutes: minute } }) },
        checks: { initial: () => ({ policy: { actors: Object.fromEntries(actors.map(actor => [actor.id, actor])) } }) },
    }, commands: {
        'test.minute'(ctx, { minute }) { ctx.draft('director').time.minutes = minute; return { narrate: false }; },
        'test.actor'(ctx, { id, name }) { const actors = ctx.draft('checks').policy.actors; if (name === null) delete actors[id]; else actors[id] = { id, name, bonuses: {} }; return { narrate: false }; },
    }, capture: { kinds: { time: { grammar: '! time <minutes>' } }, apply(ctx, line) {
        ctx.draft('director').time.minutes += Number(line.name); return { narrate: false };
    } }, queries: { 'director.time': state => ({ ...state.domains.director.time, formatted: 'must never reach a data guard' }),
        'checks.policy': state => ({ ...state.domains.checks.policy, secret: 'not projected' }) } };
}
