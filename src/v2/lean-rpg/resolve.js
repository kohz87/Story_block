// `rpg.resolve`, the Lean RPG's prelude (SPEC_RPG §2R A3/A5, SPEC_RPG_v1 §4.5.3 and §5).
//
// What it is. The pre-call (precall.js) turns the reader's message into a plan (plan.js). beforeGenerate asks for
// `rpg.resolve { key, plan }`; turn.js previews it for the prompt (the [Rolls] cue under [Happened]) and, once the
// reply is generated, stores it on that reply before its story lines, with the same seed. So a Re-read keeps the dice
// (same payload, same seed), a swipe draws new ones (a new pre-call, a new seed) and deleting the reply removes them.
// It changes no block value: the narrator's own change lines (set-health, add-xp, practice) do that.
//
// Dice. From the receipt's seed, in a fixed order: the checks first (one d20 each), then round by round, the party's
// actions in plan order and the foes' after them, each as two d20s (the party member's, then the foe's). A party
// member's total is d20 + stat/2 + 2×class + skill rank + edge; a foe's is d20 + 5 + 2×class (names.js FORMULA). The
// outcome is the party member's: a natural 20 succeeds, a natural 1 fails, a total that reaches the other side
// succeeds, one within FORMULA.costMargin short is "success at a cost", anything else fails. A foe's attack is
// the same roll seen from the defender, who rolls with the `defend` stat and no skill. Rounds = the smallest of the
// pace (careful 1, normal 5, all 8), LIMITS.roundCap, the first decisive round (a natural 1 or 20 on any die, or a
// margin of LIMITS.decisiveMargin either way) and what fits the cue budget (LIMITS.cueTokens); at least one.
//
// Refusals (plain sentences, in the cue and in `refused`): a name the sheet does not have, a skill it does not list, a
// stat the character lacks, a foe slot that is empty, a character who is Down. A skill whose resource is Empty
// (`uses: mana`, else stamina) is refused and the action is rolled without it.
//
// Replay. Guarded (docs/v2/REPLAY.md) and `replan`: the guard asks that the sheet inputs this roll used are still what
// the prefix holds; when an earlier reply is deleted or swiped and they changed, the roll is planned again with the same
// dice on the new numbers. Claim `rpg:resolve:<key>` (the reader's message) keeps it to one roll per message.
//
// ---- The record for the battle log (agent B) ----------------------------------------------------------------------
// The receipt (type 'rpg.resolve', on the reply's record: message.extra.storySuite.receipts, or the query `rpg.rolls`)
// has `summary` = the cue text and `data.v2.result` =
//   { v: 1, key, pace: 'careful'|'normal'|'all',
//     stop: 'decisive'|'pace'|'cap'|'budget'|'none',        why the rounds end where they do ('none': checks only)
//     checks: [Line], rounds: [{ n, decisive, lines: [Line] }],   the rounds TOLD to the narrator, in order
//     refused: [{ who, text }],                              not rolled, or a skill refused (text is a plain sentence)
//     summary: { exchanges, acts: [{ kind, who, target, skill, stat, outcomes: ['success'|'cost'|'fail', …] }], refused: n } }
// and a Line is
//   { kind: 'act' | 'foe' | 'check', outcome: 'success'|'cost'|'fail', skill: string|null, why?: string,
//     pc:  { who, die, stat, statBonus, classValue, classBonus, rank, edge, total },
//     foe: { slot, name, die, base, classValue, classBonus, total }          (acts and foe attacks; not checks)
//     difficulty, dc                                                          (checks only) }
// Every number is final: total = die + statBonus + classBonus + rank + edge for the party and die + base + classBonus
// for a foe. 'act': the party member attacks (the outcome is theirs); 'foe': the foe attacks, `stat` is the defend
// stat and `pc` the defender (outcome 'fail' means the defender failed). `summary.exchanges` = rounds.length is the
// number B shows as "Rolled for you: N exchanges". The told count is not recorded: the narrator is not asked to count.
import { FORMULA, LIMITS, PACE, RESOLVE, STAGES } from './names.js';
import { cueText, roundsThatFit } from './cue.js';
import { matchCharacter, matchFoe, matchSkill, readSheet } from './read.js';
import { validatePlan } from './plan.js';

export const RESULT_VERSION = 1;
const KEY = /^\d{1,7}-[0-9a-z]{1,7}$/;
export const claimKey = key => `rpg:resolve:${key}`;
const cap = word => word.charAt(0).toUpperCase() + word.slice(1);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The outcome for the party member's die and total against `against` (see the top). */
export function outcomeOf(die, total, against) {
    if (die === FORMULA.die) return 'success';
    if (die === 1) return 'fail';
    if (total >= against) return 'success';
    return total >= against - FORMULA.costMargin ? 'cost' : 'fail';
}

// The party member's side of a roll as the sheet gives it (no die yet).
function side(character, stat, rank, edge) {
    const value = character.stats[stat];
    return {
        who: character.who, stat, statBonus: Math.floor(value / FORMULA.statDivisor),
        classValue: character.soul, classBonus: FORMULA.classWeight * character.soul, rank, edge,
    };
}

// A skill phrase on a character's sheet: { skill, rank, refused } or { refusal } (a sentence).
function skillFor(character, phrase, uses) {
    if (!phrase) return { skill: null, rank: 0 };
    const found = matchSkill(character, phrase);
    if (!found) return { refusal: `no skill called ${phrase}` };
    const resource = uses === 'mana' ? 'mana' : 'stamina';
    if (character[resource] === 0) return { skill: null, rank: 0, refused: `${character.who} cannot use ${found.name} (${cap(resource)} ${STAGES[resource][0]}): rolled without it.` };
    return { skill: found.name, rank: found.rank };
}

/**
 * The plan against the sheet: what can be rolled, what is refused and why, and the witness (every sheet number the
 * roll depends on, which the replay guard asks again). → { acts, foes, checks, refused: [{ who, text }], witness }
 */
export function prepare(plan, sheet) {
    const out = { acts: [], foes: [], checks: [], refused: [] };
    const refuse = (who, text) => out.refused.push({ who, text });
    const ready = (who, stat) => {
        const character = matchCharacter(sheet, who);
        if (!character) return { refusal: `no character called ${who}` };
        if (character.alive === false || character.health === 0) return { refusal: `${character.who} is Down` };
        if (!Number.isInteger(character.stats[stat])) return { refusal: `${character.who} has no ${stat.toUpperCase()} on the sheet` };
        return { character };
    };
    for (const act of plan.acts ?? []) {
        const foe = matchFoe(sheet, act.target);
        const actor = ready(act.who, act.stat);
        const label = `${act.who} → ${act.target}`;
        if (actor.refusal) { refuse(act.who, `${label}: not rolled (${actor.refusal}).`); continue; }
        if (!foe) { refuse(act.who, `${label}: not rolled (no foe called ${act.target}).`); continue; }
        const skill = skillFor(actor.character, act.skill, act.uses);
        if (skill.refusal) { refuse(act.who, `${label}: not rolled (${skill.refusal}).`); continue; }
        if (skill.refused) refuse(act.who, skill.refused);
        const edge = Math.max(-FORMULA.edgeMax, Math.min(FORMULA.edgeMax, act.edge ?? 0));
        out.acts.push({ kind: 'act', skill: skill.skill, ...(act.why ? { why: act.why } : {}), pc: side(actor.character, act.stat, skill.rank, edge), foe });
    }
    for (const entry of plan.foes ?? []) {
        if (entry.hold) continue;
        const foe = (sheet.foes ?? []).find(slot => slot.slot === entry.slot && slot.filled);
        const label = `${foe?.name ?? `Foe ${entry.slot}`} attacks ${entry.target}`;
        if (!foe) { refuse(`foe${entry.slot}`, `${label}: not rolled (that foe slot is empty).`); continue; }
        const defender = ready(entry.target, entry.defend);
        if (defender.refusal) { refuse(entry.target, `${label}: not rolled (${defender.refusal}).`); continue; }
        out.foes.push({ kind: 'foe', skill: null, pc: side(defender.character, entry.defend, 0, 0), foe });
    }
    for (const check of plan.checks ?? []) {
        const actor = ready(check.who, check.stat);
        const label = `${check.who} — ${check.skill ?? check.stat.toUpperCase()}`;
        if (actor.refusal) { refuse(check.who, `${label}: not rolled (${actor.refusal}).`); continue; }
        const skill = skillFor(actor.character, check.skill, check.uses);
        if (skill.refusal) { refuse(check.who, `${label}: not rolled (${skill.refusal}).`); continue; }
        if (skill.refused) refuse(check.who, skill.refused);
        out.checks.push({ kind: 'check', skill: skill.skill, difficulty: check.difficulty, dc: LIMITS.dc[check.difficulty], pc: side(actor.character, check.stat, skill.rank, 0) });
    }
    const foeSide = foe => ({ slot: foe.slot, name: foe.name, base: FORMULA.foeBase, classValue: foe.class, classBonus: FORMULA.classWeight * foe.class });
    for (const entry of [...out.acts, ...out.foes]) entry.foe = foeSide(entry.foe);
    out.witness = { acts: out.acts, foes: out.foes, checks: out.checks, refused: out.refused };
    return out;
}

const rolled = (entry, pcDie, foeDie) => {
    const pcTotal = pcDie + entry.pc.statBonus + entry.pc.classBonus + entry.pc.rank + entry.pc.edge;
    const line = { kind: entry.kind, skill: entry.skill, ...(entry.why ? { why: entry.why } : {}), pc: { ...entry.pc, die: pcDie, total: pcTotal } };
    if (entry.kind === 'check') return { ...line, difficulty: entry.difficulty, dc: entry.dc, outcome: outcomeOf(pcDie, pcTotal, entry.dc) };
    const foeTotal = foeDie + entry.foe.base + entry.foe.classBonus;
    const decisive = [pcDie, foeDie].some(die => die === 1 || die === FORMULA.die) || Math.abs(pcTotal - foeTotal) >= LIMITS.decisiveMargin;
    return { ...line, foe: { ...entry.foe, die: foeDie, total: foeTotal }, outcome: outcomeOf(pcDie, pcTotal, foeTotal), decisive };
};

/**
 * Rolls a prepared plan: `roll()` gives one d20 (1–20) from the receipt's seed. → { checks, rounds, stop, text, summary }
 * with the rounds already cut to the stop and the cue budget (the dice of rounds that are cut were drawn and are dropped).
 */
export function rollPrepared(plan, prepared, roll) {
    const checks = prepared.checks.map(entry => rolled(entry, roll(), 0));
    const fight = [...prepared.acts, ...prepared.foes];
    const most = fight.length ? Math.min(PACE[plan.pace], LIMITS.roundCap) : 0;
    const all = [];
    for (let n = 1; n <= most; n += 1) {
        const lines = fight.map(entry => rolled(entry, roll(), roll()));
        const decisive = lines.some(line => line.decisive);
        all.push({ n, decisive, lines: lines.map(({ decisive: _, ...line }) => line) });
        if (decisive) break;
    }
    const refused = prepared.refused.map(entry => entry.text);
    const fits = all.length ? roundsThatFit({ checks, rounds: all, refused, decisive: all.at(-1).decisive }) : 0;
    const rounds = all.slice(0, fits);
    const decisive = rounds.length > 0 && rounds.at(-1).decisive;
    const stop = !rounds.length ? 'none' : fits < all.length ? 'budget' : decisive ? 'decisive' : rounds.length === PACE[plan.pace] ? 'pace' : 'cap';
    const text = cueText({ checks, rounds, refused, decisive });
    return { checks, rounds, stop, text, summary: summaryOf(checks, rounds, prepared.refused) };
}

// "Rolled for you: N exchanges": one entry per action of the plan with its outcome in each round told.
function summaryOf(checks, rounds, refused) {
    const acts = [];
    const entry = (line, target) => ({ kind: line.kind, who: line.kind === 'foe' ? line.foe.name : line.pc.who, target, skill: line.skill, stat: line.pc.stat, outcomes: [] });
    for (const line of checks) acts.push({ ...entry(line, null), outcomes: [line.outcome] });
    const index = new Map();
    for (const round of rounds) round.lines.forEach((line, at) => {
        if (!index.has(at)) { index.set(at, acts.length); acts.push(entry(line, line.kind === 'foe' ? line.pc.who : line.foe.name)); }
        acts[index.get(at)].outcomes.push(line.outcome);
    });
    return { exchanges: rounds.length, acts, refused: refused.length };
}

const guardOf = (ctx, predicate, witness) => ({ owner: ctx.module, version: 2, epoch: ctx.epoch, rulesHash: null, predicate, inputHash: ctx.hash({ source: ctx.source, predicate, witness }) });

/**
 * `rpg.resolve { key, plan }`: the command (a prelude: turn.js previews it with a seed and stores it on the generated
 * reply with the same seed). `key` is the reader's message (its index and a hash of its text), as Assist's pre-roll keys it.
 */
export function resolve(ctx, payload = {}) {
    if (ctx.cause !== 'system' || ctx.caller !== null) ctx.fail('REFUSED', 'Rolls are made by Story Block before a reply, not by an action.');
    const key = String(payload?.key ?? '');
    if (!KEY.test(key)) ctx.fail('INVALID', 'A roll needs the key of the message it was made for.');
    const checked = validatePlan(payload?.plan);
    if (!checked.ok) ctx.fail('INVALID', `That is not a plan: ${checked.errors[0]}`);
    const plan = payload.plan;
    const sheet = readSheet({ domains: { dataModules: ctx.read('dataModules') } });
    const prepared = prepare(plan, sheet);
    if (!prepared.acts.length && !prepared.foes.length && !prepared.checks.length) ctx.fail('NO_LONGER_DONE', 'Nothing is left to roll on this sheet.');
    if (!ctx.claim(claimKey(key))) ctx.fail('CLAIMED', 'This message has already been rolled for.');
    const dice = rollPrepared(plan, prepared, () => ctx.roll(`d${FORMULA.die}`).total);
    const predicate = { kind: RESOLVE, key, plan: ctx.hash(plan) };
    ctx.replayGuard(guardOf(ctx, predicate, prepared.witness), { key, plan });
    const result = {
        v: RESULT_VERSION, key, pace: plan.pace, stop: dice.stop, checks: dice.checks, rounds: dice.rounds,
        refused: prepared.refused, summary: dice.summary,
    };
    return { summary: dice.text, narrate: true, replan: true, data: { v2: { key: claimKey(key), result } } };
}

/**
 * The replay guard (docs/v2/REPLAY.md): the roll stands while the sheet numbers it used are what the prefix holds. Pure:
 * the state before the block and what it recorded, nothing else.
 */
export function leanRpgGuard({ state, hash }, { guard, source, recorded }) {
    const bad = reason => ({ ok: false, reason });
    try {
        const predicate = guard?.predicate;
        if (guard?.version !== 2 || guard.rulesHash !== null || !isObject(predicate) || predicate.kind !== RESOLVE) return bad('Malformed roll guard.');
        if (!isObject(recorded) || !validatePlan(recorded.plan).ok || hash(recorded.plan) !== predicate.plan || recorded.key !== predicate.key) return bad('The roll\'s plan was damaged.');
        const witness = prepare(recorded.plan, readSheet(state)).witness;
        if (hash({ source, predicate, witness }) !== guard.inputHash) return bad('The sheet before this roll changed; Re-read this reply.');
        return { ok: true };
    } catch { return bad('Damaged roll record.'); }
}

// ---- reading a reply's rolls --------------------------------------------------------------------------------------

/**
 * The rolls kept on one reply: `entries` = [{ index, receipt }] (store.receipts(), or the receipts of one record with an
 * `index`), `index` = the reply. → { receipt, result, summary } for the last `rpg.resolve` receipt there that has a
 * result record, else null.
 */
export function rollsOf(entries, index) {
    const found = (Array.isArray(entries) ? entries : []).findLast(entry => entry?.receipt?.type === RESOLVE && entry.index === index
        && isObject(entry.receipt.data?.v2?.result) && entry.receipt.data.v2.result.v === RESULT_VERSION);
    if (!found) return null;
    const result = found.receipt.data.v2.result;
    return { receipt: found.receipt, result, summary: result.summary ?? { exchanges: result.rounds?.length ?? 0, acts: [], refused: 0 } };
}
