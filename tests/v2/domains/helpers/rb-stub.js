// A small test-only stand-in for the rebuilt RPG Battle (RB_CONTRACT §3): just the queries and commands
// Story Block's inventory seams talk to, answering from plain options a test changes between calls.
//
//   purse.currency / rules.moneyPolicy   the money seam (contract P14)
//   rules.item / rules.registerItem      the generated-item route (P01); the rule table is a domain of its
//                                        own, so a refusal anywhere in the command rolls definition AND rule back
//   rules.sheet / rules.equipPlan        the equipment planner (P07), eight slots, two-handed and swap
//   item.equip                           RB's own equip command: it calls inventory.equipOn
//
// It is not RB's code and checks no real rules: it exists so the host's side can be tested alone.

import { equipInputHash } from '../../../../src/v2/domains/inventory.js';
import { hashOf } from '../../../../src/v2/domains/digest.js';

export const RB_ID = 'rpg-battle';
export const SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2'];
export const RULES_HASH = 'a'.repeat(64);
export const STATS = { STR: 8, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 8, CHA: 8 };

const clone = value => JSON.parse(JSON.stringify(value));
const failure = (code, message) => ({ ok: false, code, message });

/**
 * options (all optional, read at call time so a test can change them):
 *   currency      what purse.currency answers (an object, null, or a function that throws)
 *   policy        what rules.moneyPolicy answers ({ storyCreditCap, storyDebitCap }), or a function of the args
 *   stats, life   the actors' sheet (rules.sheet) { stats, life }
 *   minStr        equipment whose def.stats.reqSTR is above the actor's STR is refused
 *   fixedPlan     answered verbatim by rules.equipPlan (an old or forged plan)
 *   planAnswer    what rules.equipPlan answers instead of a plan (a value, or a function that may throw)
 *   refuseRegister  a message: rules.registerItem refuses with it, after touching the rule table
 *   skipDefinition  rules.registerItem records its rule but never calls inventory.registerDefinition
 *   tweakDef      a function (def) → def: the definition RB registers when it is not the one it was given
 *   omit          names of queries or commands this stand-in does not have at all (an older or partial RB)
 * `log` collects what was asked: { queries: [], commands: [] }.
 */
export function createRbStub(options = {}) {
    const stub = { options, log: { queries: [], commands: [], payloads: [] } };
    const ask = name => stub.log.queries.push(name);
    const said = (value, args) => (typeof value === 'function' ? value(args) : value);

    // The planner: the state it reads is the transaction's (what a query gets), like RB's own.
    function planFor(state, args) {
        const inventory = state.domains.inventory;
        const stack = inventory.stacks[args.stack];
        if (!stack) return failure('NOT_FOUND', 'No such piece.');
        const def = inventory.defs[stack.def];
        const sheetOf = options.stats ?? STATS;
        if (def.kind !== 'equipment') return failure('REFUSED', `${def.name} is not equipment.`);
        if (Number(def.stats?.reqSTR ?? 0) > (sheetOf.STR ?? 0)) return failure('REFUSED', `${def.name} needs STR ${def.stats.reqSTR}.`);
        const pc = state.domains.party?.pc ?? null;
        const wearerOf = piece => (piece.owner === 'party' ? pc ?? 'party' : piece.owner);
        const worn = Object.values(inventory.stacks).filter(piece => piece.id !== stack.id && piece.equipped !== null && wearerOf(piece) === args.actor);
        const at = slot => worn.find(piece => piece.equipped === slot) ?? null;
        const twoHanded = piece => inventory.defs[piece.def]?.tags?.includes('two-handed') === true;
        const unequip = [];
        let slot = args.targetSlot ?? null;
        const base = String(def.slot ?? '').replace(/-\d+$/, '');
        if (slot !== null && !SLOTS.includes(slot)) return failure('REFUSED', `${slot} is not a slot.`);
        // A chosen slot has to suit the piece: a weapon in either hand, a ring in either ring slot, the rest in theirs.
        const suits = base === 'accessory' ? ['accessory-1', 'accessory-2'] : base === 'weapon' ? ['weapon', 'offhand'] : [base];
        if (slot !== null && !suits.includes(slot)) return failure('REFUSED', `${def.name} does not go in ${slot}.`);
        if (slot === null) {
            if (base === 'accessory') slot = at('accessory-1') ? (at('accessory-2') ? 'accessory-1' : 'accessory-2') : 'accessory-1';
            else slot = base;
        }
        if (!SLOTS.includes(slot)) return failure('REFUSED', `${def.name} has no slot to be worn in.`);
        if (slot === 'offhand' && at('weapon') && twoHanded(at('weapon'))) return failure('REFUSED', `${inventory.defs[at('weapon').def].name} is two-handed.`);
        if (at(slot)) unequip.push(at(slot).id);
        if (slot === 'weapon' && twoHanded(stack) && at('offhand')) unequip.push(at('offhand').id);
        const move = [];
        if (stack.owner !== args.actor) move.push({ stack: stack.id, from: stack.owner, to: args.actor });
        for (const id of unequip) if (inventory.stacks[id].owner !== args.actor) move.push({ stack: id, from: inventory.stacks[id].owner, to: args.actor });
        const affected = [...new Set([...unequip, ...move.map(entry => entry.stack)])].filter(id => id !== stack.id).map(id => inventory.stacks[id]);
        const inputHash = equipInputHash({
            rulesHash: RULES_HASH, actor: args.actor, stats: sheetOf, life: options.life ?? 'alive', targetSlot: args.targetSlot ?? null, stack, affected,
        });
        return { ok: true, plan: { actor: args.actor, stack: stack.id, def: stack.def, slot, unequip, move, rulesHash: RULES_HASH, inputHash } };
    }

    stub.module = {
        id: RB_ID,
        domains: { rbrules: { initial: () => ({ rules: {} }), validate: () => [] } },
        commands: {
            'rules.registerItem'(ctx, payload = {}) {
                stub.log.commands.push('rules.registerItem');
                stub.log.payloads.push({ caller: ctx.caller, payload: clone(payload) });
                const def = options.tweakDef ? options.tweakDef(clone(payload.def)) : clone(payload.def);
                const rules = ctx.draft('rbrules');
                rules.rules[def.id] = { rule: payload.rule ?? 'derived', template: payload.template ?? null, from: ctx.caller };
                if (options.refuseRegister) ctx.fail('RULES_MISMATCH', options.refuseRegister);
                if (options.skipDefinition) return { summary: 'Rule stored.', data: { def: def.id }, narrate: false };
                const out = ctx.call('inventory.registerDefinition', { write: payload.write, def, hash: hashOf(def) });
                return { summary: `Registered ${def.name}.`, data: { def: def.id, hash: out.data.hash, ruleHash: hashOf(rules.rules[def.id]), created: out.data.created }, narrate: false };
            },
            // Pack activation: the frozen pack definitions, registered one by one without a stack.
            'rules.activate'(ctx, payload = {}) {
                stub.log.commands.push('rules.activate');
                const made = (payload.defs ?? []).map((def, at) => ctx.call('inventory.registerDefinition', { write: `wr_${String(at).padStart(8, '0')}`, def, hash: hashOf(def) }).data.created);
                return { summary: `${made.length} definitions.`, data: { created: made }, narrate: false };
            },
            // A registration as written by the caller, unchecked, for the host's own checks to answer.
            'test.define': (ctx, payload = {}) => ctx.call('inventory.registerDefinition', payload),
            // The rules module's own money moves (a reward, a fee), as its trade and quest commands make them.
            'purse.pay': (ctx, payload = {}) => ctx.call('wallet.pay', payload),
            'purse.receive': (ctx, payload = {}) => ctx.call('wallet.receive', payload),
            'item.equip'(ctx, payload = {}) {
                stub.log.commands.push('item.equip');
                return ctx.call('inventory.equipOn', { stack: payload.stack, actor: payload.actor, ...(payload.targetSlot ? { targetSlot: payload.targetSlot } : {}) });
            },
        },
        queries: {
            'purse.currency': () => {
                ask('purse.currency');
                const value = said(options.currency ?? null);
                return value === undefined ? null : value;
            },
            'rules.moneyPolicy': (state, args) => {
                ask('rules.moneyPolicy');
                return said(options.policy ?? null, args);
            },
            'rules.item': (state, args) => {
                ask('rules.item');
                const rules = state.domains.rbrules?.rules ?? {};
                return Object.hasOwn(rules, args?.def) ? clone(rules[args.def]) : null;
            },
            'rules.sheet': (state, args) => {
                ask('rules.sheet');
                if (options.noSheet) return null;
                return { id: args.actor, stats: clone(options.stats ?? STATS), life: options.life ?? 'alive' };
            },
            'rules.equipPlan': (state, args) => {
                ask('rules.equipPlan');
                if (options.fixedPlan) return clone(options.fixedPlan);
                if (typeof options.planAnswer === 'function') return options.planAnswer(state, args);
                if (options.planAnswer !== undefined) return clone(options.planAnswer);
                return planFor(state, args);
            },
        },
    };
    for (const name of options.omit ?? []) {
        delete stub.module.queries[name];
        delete stub.module.commands[name];
    }
    return stub;
}
