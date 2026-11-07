// Captures the D0 combat replay golden for one chat: the full-replay head, Problems, the narrator cue
// rebuilt from each roll record, the battle log model/note per reply, and the Re-read result.
// make.mjs writes the fixtures from this tree; combat-corpus.test.js replays the same chats and compares.

import { RESOLVE } from '../../../../src/v2/lean-rpg/names.js';
import { receiptCue } from '../../../../src/v2/lean-rpg/cue.js';
import { createBattleLog } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { readRecord } from '../../../../src/v2/persist.js';

export const roleOf = definition => definition?.role ?? null;
const clone = value => JSON.parse(JSON.stringify(value ?? null));

function cuesOf(host) {
    const out = [];
    host.ctx.chat.forEach((message, index) => {
        const receipts = readRecord(message)?.receipts ?? [];
        for (const receipt of receipts) if (receipt?.type === RESOLVE) out.push({ index, cue: receiptCue(receipt) });
    });
    return out;
}

function battleOf(host) {
    const log = createBattleLog({ ctx: host.ctx, doc: null, store: host.store, featureOn: () => true, roleOf });
    return host.ctx.chat.flatMap((message, index) => {
        if (message.is_user || message.is_system) return [];
        return [{ index, model: log.modelAt(index)?.model ?? null, note: log.noteAt(index)?.model ?? null }];
    });
}

/** A full replay, then the golden record for `rereadIndex`. The returned chat is not changed by the Re-read. */
export async function capture(host, rereadIndex) {
    host.store.rebuild();
    const state = clone(host.head());
    const problems = clone(host.store.problems());
    const cues = clone(cuesOf(host));
    const battle = clone(battleOf(host));
    const reread = await host.turn.reread(rereadIndex);
    return { state, problems, cues, battle, reread: clone(reread) };
}
