// 2.17.0 final review: a query run from inside a command (Story Director's chronicle.note/digest) sees a roll's cue as its summary, like sdk.receipts().
import test from 'node:test';
import assert from 'node:assert/strict';
const { OWNER, PARTY, PLAN_ANSWER, fakeModel, sheetDomain } = await import('../../../tests/v2/lean-rpg/helpers.js');
const { createHost } = await import('../../../testkit/index.js');
const { LEAN_RPG_FEATURE, RESOLVE, createLeanRpgPart } = await import('../../../src/v2/lean-rpg/index.js');

test('a query run from a command sees the roll cue as the receipt summary, as sdk.query does', async () => {
    const callModel = fakeModel(PLAN_ANSWER);
    let host = null;
    const part = createLeanRpgPart({ callModel, chat: () => host.ctx.chat, chatId: () => host.ctx.chatId, metadata: () => host.ctx.chatMetadata ?? null, problem: () => {}, moduleId: OWNER });
    const rolls = (_state, _args, tools) => (tools.receipts() ?? []).map(e => e.receipt).filter(r => r.type === RESOLVE).map(r => r.summary);
    const module = {
        id: OWNER, name: 'probe', version: '0.0.1',
        features: [{ id: LEAN_RPG_FEATURE, label: 'RPG', describe: 'Test.', default: false }],
        domains: { dataModules: { initial: () => sheetDomain(PARTY()) } },
        commands: { ...part.commands, 'probe.cmd'(ctx) { const seen = ctx.query('probe.rolls', {}); return { summary: 'probe', narrate: false, data: { seen } }; } },
        queries: { ...part.queries, 'probe.rolls': rolls },
        hooks: { ...part.hooks, replayGuard: part.guard },
        settings: { defaults: { ...part.settings.defaults } },
    };
    host = await createHost({ core: false, modules: [module], settings: { modules: { [OWNER]: { rpgFormula: 'classic' } } } });
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const viaSdk = host.sdk.query('probe.rolls', {});
    const res = await host.sdk.command('probe.cmd', {});
    const viaCmd = res?.receipt?.data?.seen;
    
    
    host.close();
    assert.ok(viaSdk[0]?.startsWith('[Rolls]'));
    assert.ok(viaCmd?.[0]?.startsWith('[Rolls]'), 'a command-run query sees no cue');
});
