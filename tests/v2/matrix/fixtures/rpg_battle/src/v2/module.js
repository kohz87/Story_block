// A toy stand-in for a module checkout, for the matrix runner's own tests (tests/v2/matrix/runner.test.js):
// it has RPG Battle's id and its two habits the negative rows are about, a party that must be made before
// any reply and a command that makes it, and nothing else. It is not a copy of the module.

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
        hooks: {
            canGenerate: view => (view?.state?.domains?.party?.pc ? { ok: true } : { ok: false, reason: 'Create your character first.' }),
        },
    };
}
