// A toy stand-in for a module checkout that does not name its peers yet (RPG Battle today), for the matrix
// runner's own tests (tests/v2/matrix/runner.test.js): it is ready whatever is registered, so a negative
// row that expects it dormant fails. Same habits as fixtures/rpg_battle, which names Story Director.

export const MODULE_ID = 'rpg-battle';

export function createModule() {
    return {
        id: MODULE_ID,
        name: 'RPG Battle (toy)',
        version: '0.0.0',
        domains: { party: { initial: () => ({ pc: null, actors: {}, rested: null }) } },
        commands: {
            'party.create': (ctx, payload = {}) => {
                const party = ctx.draft('party');
                party.pc = 'pc1';
                party.actors.pc1 = { id: 'pc1', name: String(payload.name ?? 'Wessel'), conditions: [] };
                return { summary: `${payload.name ?? 'Wessel'} is ready.` };
            },
        },
        queries: { 'party.actors': state => Object.keys(state.domains.party?.actors ?? {}) },
        hooks: {
            canGenerate: view => (view?.state?.domains?.party?.pc ? { ok: true } : { ok: false, reason: 'Create your character first.' }),
        },
    };
}
