// TEST-ONLY stand-in for the retired roll planner. Story Block no longer asks a model for a plan before a reply; this file lets the tests that
// exercise REPLAY of planner rolls (swipe, delete, Re-read, rebuild, guard) still produce the exact records the planner used to make: it
// reads a scripted answer (`fakeModel` in helpers.js) into a plan, builds the `rpg.resolve` payload as the old pre-call did and returns the same
// commands. Nothing in src/ calls it. The reader of the answer is the old plan.js parser, kept here word for word.
import { matchCharacter, matchFoe, matchSkill, readSheet } from '../../../src/v2/lean-rpg/read.js';
import { planIsEmpty, validatePlan } from '../../../src/v2/lean-rpg/plan.js';
import { FOE_SLOTS, FORMULA, LIMITS, STATS, USES, ROLLS_SETTING, LV_VERSION, PRACTICE, PRACTICE_SETTING, practiceOf } from '../../../src/v2/lean-rpg/names.js';
import { ROLL_TYPES } from '../../../src/v2/lean-rpg/formula.js';
import { hashText, normalizeType, withTimeout } from '../../../src/v2/assist/common.js';
import { stripBlock } from '../../../src/v2/capture.js';
import { packRulesOf, rulesFromSettings } from '../../../src/v2/lean-rpg/rules.js';
import { DICE_VERSION, FLOW_VERSION, claimKey, prepare } from '../../../src/v2/lean-rpg/resolve.js';
import { FIX_VERSION, openFoes, vetOpen } from '../../../src/v2/lean-rpg/open.js';
import { averageLevel, foeRandom, partyLevels, pickLevel } from '../../../src/v2/lean-rpg/foes.js';
import { GEAR_VERSION, gearIsOn, gearMarkOf } from '../../../src/v2/lean-rpg/gear.js';
import { dropOf } from '../../../src/v2/lean-rpg/ambush.js';
import { NO_ROLLS_LINE } from '../../../src/v2/lean-rpg/cue.js';
import { NOROLL } from '../../../src/v2/lean-rpg/names.js';
import { skipOf } from '../../../src/v2/lean-rpg/start.js';
import { readRecord } from '../../../src/v2/persist.js';

const TEXT = 60;
const DIFFICULTIES = Object.freeze(Object.keys(LIMITS.dc));
const PLAN_TYPES = Object.freeze(ROLL_TYPES.filter(type => type !== 'defence'));
const oneLine = (value, max = TEXT) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The foes an answer lists as new (`foe <name> | new | count: n | level: N | rank: R`; an old `class: X` is still read), as written: [{ name, count?, level?, rank?, class? }]. */
export function openLinesOf(answer) {
    const out = [];
    for (const raw of String(answer ?? '').split(/\r?\n/)) {
        const line = lineOf(raw);
        if (line?.head === 'foe' && line.labels.new) out.push({ name: line.name, count: line.labels.count, ...(line.labels.level !== undefined ? { level: line.labels.level } : {}), ...(line.labels.rank !== undefined ? { rank: line.labels.rank } : {}), ...(line.labels.class !== undefined ? { class: line.labels.class } : {}) });
    }
    return out;
}


const BULLET = /^[\s>*•\-–—\d.)]+(?=[A-Za-z])/;
const NONE = /^\W*(?:none|no rolls?)\b/i;

// "act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rat A | edge: +2 ambush" → { head: 'act', name: 'Wessel', labels: { skill, stat, … } }
function lineOf(raw) {
    const text = String(raw).replace(/\*\*|`/g, '').replace(BULLET, '').trim();
    const [first, ...rest] = text.split('|');
    const word = /^(pace|act|foe|check)\b\s*:?\s*(.*)$/i.exec(first.trim());
    if (!word) return null;
    const head = word[1].toLowerCase();
    const labels = {};
    for (const part of rest) {
        const at = part.indexOf(':');
        if (at < 0) {
            const flag = /^\s*(hold|area|magic|support|new|ambush)\s*$/i.exec(part);
            if (flag) labels[flag[1].toLowerCase()] = true;
            continue;
        }
        labels[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
    if (head === 'foe' && /\bhold\s*$/i.test(word[2])) return { head, name: word[2].replace(/\s*[,—-]?\s*\bhold\s*$/i, '').trim(), labels: { ...labels, hold: true } };
    return { head, name: word[2].trim(), labels };
}

const statOf = value => {
    const word = String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return STATS.includes(word) ? word : STATS.find(stat => word.startsWith(stat)) ?? null;
};

// "+2 ambush from the drain lip" → { edge: 2, why: 'ambush from the drain lip' }; a bare reason is no edge.
function edgeOf(value) {
    const match = /^\s*([+-]?\d+)\s*(.*)$/.exec(String(value ?? ''));
    if (!match) return {};
    const edge = Math.max(-FORMULA.edgeMax, Math.min(FORMULA.edgeMax, Number(match[1])));
    const why = oneLine(match[2]);
    return { ...(edge ? { edge } : {}), ...(why && edge ? { why } : {}) };
}

// "else: Iaijutsu": the skill an act goes on with when its own skill's resource is spent. Only for an act that names a skill; the backup is a skill the character has.
function elseOf(character, labels, skill) {
    const named = oneLine(labels.else);
    if (!named || !skill.named || /^(none|no|-|—)$/i.test(named)) return {};
    const found = character ? matchSkill(character, named) : null;
    return found ? { else: found.name } : {};
}

// "guard: Shadow Step": the skill the character defends with in this message (evade, dodge, parry, block). It is copied onto the foe lines aimed at
// the character at parse time, so the plan recorded holds it on the foe lines and a replay never works it out again.
const guardOf = (character, labels) => {
    const named = oneLine(labels.guard);
    if (!named || /^(none|no|-|—)$/i.test(named)) return null;
    return (character ? matchSkill(character, named) : null)?.name ?? null;
};

// "then: Iaijutsu": the skill an act uses from round 2 on (round 1 and an opening action use `skill:`). A skill the character has, other than the first.
function thenOf(character, labels, skill) {
    const named = oneLine(labels.then);
    if (!named || /^(none|no|-|—)$/i.test(named)) return {};
    const found = character ? matchSkill(character, named) : null;
    return found && found.name !== skill.entry.skill ? { then: found.name } : {};
}

const difficultyOf = value => {
    const word = String(value ?? '').trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
    if (DIFFICULTIES.includes(word)) return word;
    return word === 'veryhard' || word === 'very-hard' ? 'very hard' : null;
};

const typeOf = value => {
    const word = String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return PLAN_TYPES.find(type => word.startsWith(type)) ?? null;
};

const usesOf = value => {
    const word = String(value ?? '').trim().toLowerCase();
    return USES.find(use => word.startsWith(use)) ?? null;
};

// The skill a line names and what it rolls with: a skill the character has brings its own stat and resource (the line's `stat`
// and `uses` are not read); no skill, or one the character lacks (rolled untrained), takes the line's stat. `stat` is null when
// the line has none: with a skill named the line still stands (the roll uses the character's best stat, untrained, and says so,
// resolve.js); with no skill there is nothing to roll with. `entry` is what goes into the plan.
function skillOf(character, labels) {
    const named = oneLine(labels.skill);
    const phrase = named && !/^(none|no|-|—)$/i.test(named) ? named : '';
    const found = phrase ? matchSkill(character, phrase) : null;
    const stat = found?.stat ?? statOf(labels.stat);
    const uses = found?.uses ? null : usesOf(labels.uses);
    return { stat, entry: { ...(phrase ? { skill: found?.name ?? phrase } : {}), ...(found?.uses || !uses ? {} : { uses }), ...(found?.stat || !stat ? {} : { stat }) }, named: Boolean(phrase) };
}

/**
 * The pre-call's answer read against the sheet: { plan } (at least one thing to roll), { none: true } (the model said
 * no rolls) or { error } (a plain sentence) for an answer with no line in it, or none of whose lines could be placed.
 * A line that names someone or a foe the sheet does not have, a stat that is not one of the seven, or a difficulty
 * that is not a word is dropped by itself; the rest stands. `dropped` counts them.
 */
export function parsePlanAnswer(answer, sheet, { formula = 'standard' } = {}) {
    const text = String(answer ?? '').trim();
    if (!text) return { error: 'the answer was empty' };
    const std = formula === 'standard';
    const plan = { ...(std ? { formula: 'standard' } : {}), pace: 'normal', acts: [], foes: [], checks: [] };
    let read = 0;
    let dropped = 0;
    let none = false;
    const guards = new Map();
    for (const raw of text.split(/\r?\n/)) {
        const line = lineOf(raw);
        if (!line) {
            if (!read && !none && NONE.test(raw.replace(/\*\*|`/g, '').trim())) none = true;
            continue;
        }
        read += 1;
        const { head, name, labels } = line;
        if (head === 'pace') {
            const pace = String(name).toLowerCase().match(/careful|normal|all/)?.[0];
            if (pace) plan.pace = pace; else dropped += 1;
        } else if (head === 'act') {
            const who = matchCharacter(sheet, name);
            const skill = skillOf(who, labels);
            const stat = skill.stat;
            const guard = who ? guardOf(who, labels) : null;
            if (guard && !guards.has(who.who)) guards.set(who.who, guard);
            if (std) {
                // Standard: the type decides the stat, so a line needs only a character and a target (a foe, or an ally for support).
                const support = labels.support !== undefined && !/^(no|none|false|-|—)$/i.test(String(labels.support));
                const mate = support ? matchCharacter(sheet, labels.target) : null;
                const target = support ? mate : matchFoe(sheet, labels.target);
                const difficulty = support ? difficultyOf(labels.support === true ? 'normal' : labels.support) ?? 'normal' : null;
                if (!who || !target || plan.acts.length >= LIMITS.acts) { dropped += 1; continue; }
                const type = typeOf(labels.type);
                const fit = type === 'check' ? statOf(labels.fit ?? labels.stat) : null;
                plan.acts.push({ who: who.who, ...skill.entry, ...thenOf(who, labels, skill), ...elseOf(who, labels, skill), ...(type ? { type } : {}), ...(fit ? { fit } : {}), ...(!support && labels.area ? { area: true } : {}),
                    ...(support ? { support: true, difficulty } : {}), target: support ? mate.who : target.name, ...edgeOf(labels.edge) });
                continue;
            }
            const target = matchFoe(sheet, labels.target);
            if (!who || !(stat || skill.named) || !target || plan.acts.length >= LIMITS.acts) { dropped += 1; continue; }
            plan.acts.push({ who: who.who, ...skill.entry, ...thenOf(who, labels, skill), ...elseOf(who, labels, skill), target: target.name, ...edgeOf(labels.edge) });
        } else if (head === 'foe') {
            // A foe listed as new (open.js) is read apart (openLinesOf): a line that asks for one is not a line to place.
            if (labels.new) continue;
            const foe = matchFoe(sheet, name);
            if (!foe || plan.foes.some(entry => entry.slot === foe.slot) || plan.foes.length >= LIMITS.foes) { dropped += 1; continue; }
            if (labels.hold) { plan.foes.push({ slot: foe.slot, hold: true }); continue; }
            const target = matchCharacter(sheet, labels.target);
            const defend = statOf(labels.defend) ?? 'agi';
            if (!target) { dropped += 1; continue; }
            // A skill of the defender's counts when they defend (it brings its own stat, as an act's does); `defend` stays as the stat for
            // none, or for a skill they lack. An answer from before this had no skill: its plans never carry the key.
            const named = oneLine(labels.skill);
            const phrase = named && !/^(none|no|-|—)$/i.test(named) ? named : '';
            plan.foes.push({ slot: foe.slot, target: target.who, ...(std ? { ...(labels.magic ? { againstMagic: true } : {}) } : { defend }), ...(phrase ? { skill: matchSkill(target, phrase)?.name ?? phrase } : {}) });
        } else if (head === 'check') {
            const who = matchCharacter(sheet, name);
            const skill = skillOf(who, labels);
            const difficulty = difficultyOf(labels.difficulty ?? labels.dc);
            if (std) {
                if (!who || !difficulty || plan.checks.length >= LIMITS.checks) { dropped += 1; continue; }
                const type = ['social', 'check'].includes(typeOf(labels.type)) ? typeOf(labels.type) : null;
                const fit = statOf(labels.fit ?? labels.stat);
                plan.checks.push({ who: who.who, ...skill.entry, ...(type ? { type } : {}), ...(fit && !skill.entry.stat ? { fit } : {}), difficulty, ...(labels.ambush ? { ambush: true } : {}) });
                continue;
            }
            if (!who || !(skill.stat || skill.named) || !difficulty || plan.checks.length >= LIMITS.checks) { dropped += 1; continue; }
            plan.checks.push({ who: who.who, ...skill.entry, difficulty, ...(labels.ambush ? { ambush: true } : {}) });
        }
    }
    // A guard skill goes on every foe line aimed at that character that names no skill of its own (a hold line has no target, and a skill the planner gave stays).
    for (const foe of plan.foes) if (!foe.hold && !foe.skill && guards.has(foe.target)) foe.skill = guards.get(foe.target);
    // No ambush edge without an ambush check: an act's own "+2 ambush" is dropped when the plan has no check that carries `ambush` (ambush.js).
    if (!plan.checks.some(check => check.ambush === true)) {
        for (const act of plan.acts) if (act.edge && /\bambush/i.test(act.why ?? '')) { delete act.edge; delete act.why; }
    }
    if (none && !read) return { none: true };
    if (!read && !none) return { error: `"${oneLine(text, 80)}" has no pace, act, foe or check line and is not "none"` };
    if (!validatePlan(plan).ok) return { error: validatePlan(plan).errors[0] };
    // Lines that were all dropped are a failed plan, not "no rolls": the narrator is told to keep the fight undecided.
    if (planIsEmpty(plan)) return dropped ? { error: `none of its ${dropped === 1 ? 'line' : 'lines'} named anyone or anything on the sheet` } : { none: true, dropped };
    return { plan, dropped };
}

// ---- the old pre-call, around the part's own hook ----------------------------------------------------------------

const ROLLS_QUERY = 'rpg.rolls';
const ORDER_LOOKBACK = 12;
const claimed = (state, key) => state?.meta?.claims?.[claimKey(key)] === true;

function carriedDrop(view, index) {
    let found = null;
    try { found = view.query?.(ROLLS_QUERY, { index: index - 1 }) ?? null; } catch { found = null; }
    return dropOf(found?.result);
}

function carriedOrder(view, index) {
    for (let at = index - 1; at >= 0 && at >= index - ORDER_LOOKBACK; at -= 1) {
        let found = null;
        try { found = view.query?.(ROLLS_QUERY, { index: at }) ?? null; } catch { found = null; }
        const order = found?.result?.order;
        if (Array.isArray(order) && order.length) return order.map(({ id, name, total, die, bonus, agi, party, left }) => ({ id, name, total, ...(Number.isSafeInteger(die) ? { die } : {}), ...(Number.isSafeInteger(bonus) ? { bonus } : {}), agi, party, ...(Number.isSafeInteger(left) && left >= 0 ? { left } : {}) }));
        if (found) return null;
    }
    return null;
}

/**
 * Wraps `part.hooks.beforeGenerate` the way the retired pre-call worked. `deps`: { callModel, chat(), metadata(), moduleId, timer, timeoutMs }.
 * A board fight, a claimed message, a "send without the RPG" and Rolls off answer exactly as the real hook does (it is asked first); when it has
 * nothing to carry, the scripted planner is asked and its plan is rolled by an `rpg.resolve` command.
 */
export function legacyPlanner(part, { callModel, chat, metadata = () => null, moduleId = 'story-block', timeoutMs = 45000, timer } = {}) {
    const real = part.hooks.beforeGenerate;
    const noDice = skipOf(metadata);
    async function plan(view, sheet, message, excerpt, rules) {
        let answer;
        try {
            answer = await withTimeout(() => callModel('legacy planner prompt', { maxTokens: 250, helper: 'rolls', timeoutMs }), timeoutMs, timer);
        } catch (error) {
            return error?.code === 'TIMEOUT' ? { failed: 'the planning call timed out.', reason: 'timeout', limit: timeoutMs }
                : { failed: `the planning call failed (${String(error?.message ?? error).slice(0, 120)}).`, reason: 'failed', limit: timeoutMs };
        }
        const rankAt = level => { try { return view.query?.('rpg.rank', { level }) ?? null; } catch { return null; } };
        const wanted = openLinesOf(answer);
        let open = [], looked = sheet;
        if (wanted.length && view.state?.domains?.dataModules) {
            const vetted = vetOpen(wanted, sheet, [message, excerpt], { rankAt }).open;
            const domain = structuredClone(view.state.domains.dataModules);
            const placed = openFoes(domain, vetted.map((entry, at) => ({ name: entry.name, count: entry.count, level: pickLevel(entry, averageLevel(partyLevels(sheet)), foeRandom(0, at)) })));
            if (placed.length) {
                const kept = new Set(placed.map(entry => entry.name));
                open = vetted.filter(entry => kept.has(entry.name));
                looked = readSheet({ domains: { dataModules: domain } });
            }
        }
        const parsed = parsePlanAnswer(answer, looked, { formula: 'standard' });
        if (parsed.error) return { failed: `the answer could not be read (${parsed.error}).`, reason: 'unreadable', limit: timeoutMs };
        if (parsed.none) return { plan: null };
        const ready = prepare(parsed.plan, looked, rules);
        if (!ready.acts.length && !ready.foes.length && !ready.checks.length) return { plan: null };
        return { plan: open.length ? { ...parsed.plan, open } : parsed.plan };
    }
    return async function beforeGenerate(view, info = {}) {
        // (the real hook now also offers a story-check die roll on a reply with no fight: the retired planner's replies carry none)
        const given = await real(view, info);
        const out = given?.commands?.every(command => command.type === 'rpg.dice') ? (given.lines ? { lines: given.lines } : null) : given;
        if (out?.commands) return out;
        if (view?.feature?.('story-block.rpg') !== true || info?.commit === false) return out;
        if (!['normal', 'regenerate', 'swipe'].includes(normalizeType(info?.type))) return out;
        const sheet = readSheet(view.state);
        const messages = chat() ?? [];
        if (!messages.some(message => message && !message.is_user)) return out;
        const index = normalizeType(info?.type) === 'swipe' ? messages.length - 2 : messages.length - 1;
        const last = messages[index];
        const text = String(last?.mes ?? '').trim();
        if (!last?.is_user || !text) return out;
        const key = `${index}-${hashText(text)}`;
        if (claimed(view.state, key) || (normalizeType(info?.type) === 'normal' && noDice.peek()) || !sheet.characters.length) return out;
        const values = (() => { try { return view.settings(moduleId) ?? {}; } catch { return {}; } })();
        if (values[ROLLS_SETTING] === 'off') return out;
        let pack = null;
        try { pack = packRulesOf(view.query?.('packs.content', { kind: 'rpg' })); } catch { /* no pack rules */ }
        const rules = rulesFromSettings(values, pack);
        const before = messages[index - 1];
        const excerpt = before && !before.is_user ? stripBlock(String(before.mes ?? '')) : '';
        const planned = await plan(view, sheet, text, excerpt, rules);
        if (planned.failed) {
            if (sheet.foes.some(foe => foe.filled && foe.hurt > 0)) {
                const seconds = Math.max(1, Math.round(planned.limit / 1000));
                return { lines: [NO_ROLLS_LINE], commands: [{ type: NOROLL, payload: { key, reason: planned.reason, ...(planned.reason === 'timeout' ? { limit: seconds } : {}) } }] };
            }
            return out;
        }
        if (!planned.plan) return out;
        const order = planned.plan ? carriedOrder(view, index) : null;
        const drop = carriedDrop(view, index);
        const gear = gearIsOn(sheet, (name, args) => view.query?.(name, args)) ? gearMarkOf({ v: GEAR_VERSION, lead: String(last.name ?? '') }) : null;
        const payload = { key, plan: planned.plan, rules, dice: DICE_VERSION, flow: FLOW_VERSION, fix: FIX_VERSION, lv: LV_VERSION, practice: practiceOf(values[PRACTICE_SETTING]) ?? PRACTICE.perUse, ...(order ? { order } : {}), ...(drop ? { ambush: drop } : {}), ...(gear ? { gear } : {}) };
        return { commands: [{ type: 'rpg.resolve', payload }] };
    };
}
