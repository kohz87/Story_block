// Stand-ins for the RPG tests: a party sheet written straight into the data-module state (the Character, Skills
// and Foes blocks as the RPG reads them), a scripted pre-call model, and a host that has the RPG part on it.
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_FEATURE, ROLLS_SETTING, createLeanRpgPart } from '../../../src/v2/lean-rpg/index.js';

export const OWNER = 'story-block';

/** fakeModel(...answers): a callModel that answers in order (a string, an Error to throw, a function, or NEVER); `calls` records them. */
export const NEVER = Symbol('never answers');
export function fakeModel(...answers) {
    const calls = [];
    const callModel = async (prompt, options) => {
        calls.push({ prompt, options });
        const next = answers.length > 1 ? answers.shift() : answers[0];
        if (next === NEVER) return new Promise(() => {});
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(prompt) : next;
    };
    callModel.calls = calls;
    return callModel;
}

const int = value => value;
const slots = (prefix, list, size) => Object.fromEntries(Array.from({ length: size }, (_, n) => [`${prefix}${n + 1}`, list[n] ?? '']));

/** Field values of a Character block (stage indexes: 5 = Unhurt, 4 = Fresh). */
export const character = (who, over = {}) => ({
    who, health: 5, mana: 4, stamina: 4, str: 14, vit: 12, agi: 12, dex: 10, int: 8, luk: 9, cha: 10, points: 0, soul: 2, xp: 0, down: false, alive: true, ...over,
});
/** Field values of a Skills block: skills = [[name, rank, stat, uses, about], …] (stat 'str' and uses 'stamina' unless given). */
export const skillBlock = (who, skills = []) => ({
    who, ...slots('skill', skills.map(skill => skill[0]), 5), ...slots('rank', skills.map(skill => skill[1] ?? 0), 5),
    ...slots('practice', skills.map(() => 0), 5), ...slots('stat', skills.map(skill => skill[2] ?? 'str'), 5),
    ...slots('uses', skills.map(skill => skill[3] ?? 'stamina'), 5), ...slots('about', skills.map(skill => skill[4] ?? ''), 5),
});
/** Field values of a Foes block: foes = [[name, count, class, hurt], …]. */
export const foeBlock = (foes = []) => ({
    ...slots('foe', foes.map(foe => foe[0]), 4), ...slots('count', foes.map(foe => foe[1] ?? 1), 4),
    ...slots('class', foes.map(foe => foe[2] ?? 1), 4), ...slots('hurt', foes.map(foe => foe[3] ?? 5), 4),
});

/** The data-module domain holding blocks: `blocks` = { slug: { role, fields } }. */
export function sheetDomain(blocks) {
    const domain = { pins: {}, active: {}, instances: {}, perReply: {} };
    Object.entries(blocks).forEach(([slug, block], n) => {
        const id = `pack.chat/${slug}`;
        domain.pins[`h${n}`] = { definition: { id, slug, name: slug, role: block.role, schema: 1, scope: 'chat' }, packId: 'chat', interpreter: 1 };
        domain.active[id] = { hash: `h${n}`, generation: 1, subjects: ['chat'] };
        domain.instances[id] = { chat: { fields: block.fields, timers: {}, offers: {}, settled: {} } };
    });
    return domain;
}

export const PARTY = () => ({
    wessel: { role: 'character', fields: character('Wessel') },
    'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Iron Breath', 1, 'str'], ['Spark', 0, 'int', 'mana']]) },
    ren: { role: 'character', fields: character('Ren', { str: 8, int: 16, soul: 2 }) },
    'ren-skills': { role: 'skills', fields: skillBlock('Ren', [['Spark', 0, 'int', 'mana']]) },
    foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 1, 5]]) },
});

export const PLAN_ANSWER = [
    'pace: normal',
    'act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats | edge: +2 ambush from the drain lip',
    'act Ren | skill: Spark | uses: mana | stat: INT | target: Sluice Rats',
    'foe Sluice Rats | target: Wessel | defend: AGI',
].join('\n');

/**
 * A host with the RPG part on a module of its own (core module off): the sheet domain, the feature declared, the
 * part's command, hooks and replay guard, and `test.set` (sets one field of a block) for changing the sheet.
 * `options`: { blocks, answers, feature (default on), settings, timer, hold, earlier (rolls asked for with no dice version) }
 */
export async function setup({ blocks = PARTY(), answers = [PLAN_ANSWER], feature = true, settings = {}, timer, timeoutMs, earlier = false } = {}) {
    const callModel = fakeModel(...answers);
    const problems = [];
    let host = null;
    const part = createLeanRpgPart({
        callModel, chat: () => host.ctx.chat, chatId: () => host.ctx.chatId, metadata: () => host.ctx.chatMetadata ?? null,
        problem: entry => problems.push(entry), moduleId: OWNER, timer, timeoutMs,
    });
    const module = {
        id: OWNER, name: 'Story Block (RPG test)', version: '0.0.1',
        features: [{ id: LEAN_RPG_FEATURE, label: 'RPG', describe: 'Test.', default: false }],
        domains: { dataModules: { initial: () => sheetDomain(blocks) } },
        commands: {
            ...part.commands,
            'test.set'(ctx, { slug, field, value }) {
                ctx.draft('dataModules').instances[`pack.chat/${slug}`].chat.fields[field] = value;
                return { summary: `${slug}.${field} = ${value}`, narrate: false };
            },
        },
        queries: part.queries,
        // `earlier`: the rolls are asked for as they were before the dice version, a payload with no `dice` (a chat made on an older build).
        hooks: { ...part.hooks, ...(earlier ? { beforeGenerate: Object.assign(async (view, info) => {
            const out = await part.hooks.beforeGenerate(view, info);
            return out?.commands ? { ...out, commands: out.commands.map(({ payload: { dice: _, ...payload }, ...command }) => ({ ...command, payload })) } : out;
        }, { timeoutMs: part.hooks.beforeGenerate.timeoutMs }) } : {}), replayGuard: part.guard },
        settings: { defaults: { ...part.settings.defaults } },
    };
    // (The stat formula is Classic here unless a test asks otherwise: these tests pin Classic's numbers.)
    host = await createHost({ core: false, modules: [module], settings: { modules: { [OWNER]: { rpgFormula: 'classic', ...settings } } } });
    host.features.set(LEAN_RPG_FEATURE, feature);
    return { host, callModel, problems, part };
}

export const tailOf = request => request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
export const recordOf = (host, index) => host.ctx.chat[index].extra.storySuite;
export const rollReceipt = (host, index) => recordOf(host, index).receipts.find(receipt => receipt.type === 'rpg.resolve');
export { ROLLS_SETTING };
