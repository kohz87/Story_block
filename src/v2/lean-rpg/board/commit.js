// Commits staged board choices as the reply's one guarded RPG resolution.
// The engine replays the recorded setup and seed; only the resulting bars and gear wear are written.
// Its guard checks the recorded input against the prefix on delete, rewind and reload.

import { condWord } from '../../domains/gear.js';
import { applyGear, earnedLegend, gearMatches, gearValid, noteGear, wearGear } from '../gear.js';
import { LV_VERSION, PRACTICE, RESOLVE, practiceOf } from '../names.js';
import { readSheet } from '../read.js';
import { hasLevels, normalizeRules } from '../rules.js';
import { playBoard } from './engine.js';
import { settledNote } from './note.js';

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keyPattern = /^\d{1,7}-[0-9a-z]{1,7}$/u;
const claim = key => `rpg:resolve:${key}`;
const shape = board => isObject(board) && isObject(board.setup) && Array.isArray(board.exchanges) && board.exchanges.length <= 99
    && typeof board.id === 'string' && board.id.length > 0 && board.id.length <= 120
    && Array.isArray(board.groups) && board.groups.length > 0 && board.groups.length <= 64
    && board.groups.every(slot => Number.isInteger(slot) && slot >= 1 && slot <= 64);
const witness = state => ({ dataModules: state?.domains?.dataModules ?? null });
const startState = ctx => ({ domains: { dataModules: ctx.read('dataModules'), inventory: ctx.read('inventory'), scene: ctx.read('scene') } });

/** Resolve a board payload only on the system prelude path. */
export function resolveBoard(ctx, payload) {
    const key = String(payload?.key ?? ''), board = payload?.board;
    if (ctx.cause !== 'system' || ctx.caller !== null) ctx.fail('REFUSED', 'The fight is settled before the reply.');
    if (!keyPattern.test(key) || !shape(board)) ctx.fail('INVALID', 'The saved fight is damaged.');
    const rules = normalizeRules(board.setup.rules);
    if (ctx.hash(rules) !== ctx.hash(board.setup.rules)) ctx.fail('INVALID', 'The fight rules are damaged.');
    const state = startState(ctx), gear = board.setup.gear;
    if (gear && (!gearValid(gear) || !gearMatches(state, gear, ctx.hash))) ctx.fail('NO_LONGER_DONE', 'The gear changed since this fight was opened.');
    const played = playBoard(state, board.setup, board.exchanges);
    if (played.error) ctx.fail('NO_LONGER_DONE', played.error);
    if (!ctx.claim(claim(key))) ctx.fail('CLAIMED', 'This message has already been rolled for.');
    const base = played.result, practice = practiceOf(payload.practice) ?? PRACTICE.perUse;
    const result = { v: 1, key, pace: 'careful', rules, flow: 2, fix: 3, practice, ...(hasLevels(rules) ? { lv: LV_VERSION } : {}),
        ...(gear ? { gear } : {}), checks: [], ...base, board: { id: board.id, seed: board.setup.seed, offset: board.setup.offset, groups: board.groups } };
    const lines = [...result.opening, ...result.rounds.flatMap(round => round.lines)];
    if (gear) {
        noteGear(lines, gear);
        const wear = wearGear(ctx, gear, { opening: result.opening, rounds: result.rounds, rules, condWord });
        if (wear.length) result.wear = wear;
        if (earnedLegend(result, applyGear(readSheet(state), gear), hasLevels(rules))) result.legend = 1;
    }
    const predicate = { kind: RESOLVE, board: 1, key, setup: ctx.hash(board), rules: ctx.hash(rules), practice };
    ctx.replayGuard({ owner: ctx.module, version: 2, epoch: ctx.epoch, rulesHash: null, predicate,
        inputHash: ctx.hash({ source: ctx.source, predicate, witness: witness(state) }) }, { key, board, practice });
    if (result.hurts.length) {
        const instances = ctx.draft('dataModules')?.instances;
        for (const hurt of result.hurts) {
            const fields = instances?.[hurt.module]?.chat?.fields;
            if (fields && Object.hasOwn(fields, hurt.field)) fields[hurt.field] = hurt.to;
        }
    }
    return { summary: settledNote(result), narrate: true, replan: true, data: { v2: { key: claim(key), result } } };
}

/** The prefix witness for a board roll. Changed inputs cause the host to plan it again. */
export function boardGuard({ state, hash }, { guard, source, recorded }) {
    const bad = reason => ({ ok: false, reason });
    try {
        const predicate = guard?.predicate, board = recorded?.board;
        if (guard?.version !== 2 || guard.rulesHash !== null || predicate?.kind !== RESOLVE || predicate?.board !== 1
            || !shape(board) || recorded.key !== predicate.key || hash(board) !== predicate.setup || hash(normalizeRules(board.setup.rules)) !== predicate.rules
            || recorded.practice !== predicate.practice || practiceOf(recorded.practice) === null) return bad('The saved fight is damaged.');
        if (board.setup.gear && (!gearValid(board.setup.gear) || !gearMatches(state, board.setup.gear, hash))) return bad('The gear before the fight changed.');
        return hash({ source, predicate, witness: witness(state) }) === guard.inputHash ? { ok: true } : bad('The sheet before the fight changed.');
    } catch { return bad('The saved fight is damaged.'); }
}
