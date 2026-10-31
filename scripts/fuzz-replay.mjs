// Property fuzz of the replay core (docs/v2/REPLAY.md): a guarded test module, random chats, and after EVERY step these
// invariants. The head is what a replay from the first record gives (checkpoints are never trusted wrongly), the state
// at sampled carriers and the Problems are too, revs are strictly increasing and the head is at the last, a guard that
// refuses leaves no guarded effect, a quarantined record has no effect, and the boundaries of steps planned again are
// what the chat now gives. Steps: commands, send, swipe, show (any carrier), delete (swipe, message), edit, reload,
// reconcile (the turn's, after every timeline change too), truncate, Re-read, strip a record's spans, make a
// checkpoint legacy (no prefix), orphan a guarded receipt, edit a receipt's guard, edit a record's source identity,
// change an outside setting the guarded blocks record.
//
//   node scripts/fuzz-replay.mjs <seed> <steps> [checkpointEvery]      one run; prints { seed, steps, fails }
//   for s in $(seq 1 300); do node scripts/fuzz-replay.mjs $s 120 $(( (s % 2) * 3 + 4 )); done | grep -v '"fails":\[\]'
//
// Env: SB=<another checkout> to run the same seeds on it, TRACE=1 for the steps, DUMP=<file> the chat at the first failure,
// DUMPBEFORE=<file> the chat before the step that failed.
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SB = process.env.SB || fileURLToPath(new URL('..', import.meta.url));
const imp = p => import(pathToFileURL(`${SB}/${p}`).href);
const { createStore } = await imp('src/v2/store.js');
const { createCommandBus } = await imp('src/v2/commands.js');
const { createRegistry } = await imp('src/v2/registry.js');
const { guarded, Q1, Q2, Q5, Q9 } = await imp('tests/v2/helpers/guarded.js');
const { greeting } = await imp('tests/v2/helpers/store-chat.js');
const { isMetaSpan } = await imp('src/v2/replay.js');

// A fake SillyTavern message with send_date per swipe (what persist.js marks look at).
let clock = 1700000000000;
const date = () => new Date(clock += 60000).toISOString();
export const user = text => ({ name: 'You', is_user: true, mes: text, send_date: date(), extra: {} });
export const reply = text => { const d = date(); return { name: 'N', is_user: false, mes: text, send_date: d, swipe_id: 0, swipes: [text], swipe_info: [{ send_date: d, extra: {} }], extra: {} }; };
export function newSwipe(m, text) {
  m.swipe_info[m.swipe_id] = { ...m.swipe_info[m.swipe_id], extra: structuredClone(m.extra) };
  const d = date();
  m.swipes.push(text); m.swipe_info.push({ send_date: d, extra: structuredClone(m.extra) });
  m.swipe_id = m.swipes.length - 1; m.extra = structuredClone(m.extra); m.mes = text; m.send_date = d;
}
export function showSwipe(m, i) {
  m.swipe_info[m.swipe_id] = { ...m.swipe_info[m.swipe_id], extra: structuredClone(m.extra) };
  m.swipe_id = i; m.extra = structuredClone(m.swipe_info[i].extra); m.mes = m.swipes[i]; m.send_date = m.swipe_info[i].send_date;
}
export function delSwipe(m, i) {
  m.swipes.splice(i, 1); m.swipe_info.splice(i, 1);
  const j = Math.min(i, m.swipes.length - 1);
  m.swipe_id = j; m.extra = structuredClone(m.swipe_info[j].extra); m.mes = m.swipes[j]; m.send_date = m.swipe_info[j].send_date;
}


const [seedArg, stepsArg, ckArg] = process.argv.slice(2);
let s = Number(seedArg) >>> 0 || 1;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const pick = n => Math.floor(rnd() * n);
let m = 777; Math.random = () => { m = (m * 1103515245 + 12345) >>> 0; return m / 4294967296; };
Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } }, configurable: true });

const mod = guarded();
mod.commands['gt.tick'] = (ctx, { minutes }) => { ctx.draft('gt').minutes = minutes; return { summary: 'tick', narrate: false }; };
let chat = [greeting()];
let ids = 0;
function mk(ch, ck = Number(ckArg) || 5, mode = null) {
  const registry = createRegistry(); registry.register(guardedMod(mode));
  const validate = (state, names) => names.flatMap(n => { const f = registry.validator(n); return typeof f === 'function' ? (f(state?.domains?.[n], state) ?? []) : []; });
  const store = createStore({ chat: () => ch, save: async () => {}, validate, scratch: n => registry.scratch(n), recordId: () => `sw_${(++ids).toString(16).padStart(12, '0')}`, checkpointEvery: ck, checkpointBytes: 1 << 30 });
  const bus = createCommandBus({ store, registry });
  store.ensureInitial(registry.initialState());
  return { registry, store, bus };
}
const setting = { value: 's0' };      // an outside fact the guarded blocks record when they are planned
function guardedMod(mode) { const g = guarded({ ...(mode ? { mode } : {}), setting, strict: true }); g.commands['gt.tick'] = mod.commands['gt.tick']; return g; }
let H = mk(chat);
const fails = [];
const fail = (msg, extra) => { fails.push({ msg, extra }); if (process.env.DUMP && fails.length === 1) { fs.writeFileSync(process.env.DUMP, JSON.stringify(chat)); } };
const J = x => JSON.stringify(x);
const afterTimeline = () => { H.store.rebuild(); const from = H.store.replansFrom(); if (Number.isInteger(from) && !H.store.readOnly()) { try { H.store.reconcile(from, { rerun }); } catch { /* atomic: nothing written */ } } };
const last = () => { for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) return i; return -1; };
const rerun = (state, receipt, info) => H.bus.run(receipt.type, receipt.replan.payload, { cause: 'system', state, seed: receipt.seed, reply: { index: info.index, sid: H.store.carrierSid(info.index), ordinal: info.span.source.ordinal } });

function check(label) {
  // P1: checkpoint independence + P2: reload invariance
  let head; try { head = H.store.head(); } catch (e) { fail(label + ': head threw ' + e.message); return; }
  const ref = JSON.parse(J(chat));
  const stripped = JSON.parse(J(chat));
  let firstSeen = false;
  for (const mm of stripped) for (const holder of [mm.extra, ...(mm.swipe_info ?? []).map(i => i.extra)]) {
    const r = holder?.storySuite; if (!r) continue;
  }
  // strip all but the first carrier's checkpoint (shown record and copies)
  let first = stripped.findIndex(mm => !mm.is_user && mm.extra?.storySuite);
  stripped.forEach((mm, i) => { if (i === first) return; for (const holder of [mm.extra, ...(mm.swipe_info ?? []).map(x => x.extra)]) if (holder?.storySuite) { delete holder.storySuite.checkpoint; delete holder.storySuite.covers; delete holder.storySuite.coverHash; } });
  if (first >= 0) {
    const sH = mk(stripped, 100000);
    const a = J(head), b = J(sH.store.head());
    if (head && a !== b) fail(label + ': head differs from checkpoint-stripped replay', { a, b });
    // A (semantic): with every owner's guard refusing, nothing a guarded block did is in the story, whatever was renumbered or stripped
    const tH = mk(JSON.parse(J(stripped)), 100000, { value: 'throw' });
    const tg = tH.store.head()?.domains?.gt;
    const th = tH.store.head();
    if (tg && (tg.coin !== 0 || Object.values(tg.credits).some(v => v) || Object.keys(tg.attempts).length || Object.keys(th.meta.claims).length)) fail(label + ': a guarded block applied without its guard', { coin: tg.coin, claims: Object.keys(th.meta.claims).join(',') });
    // P: the Problems after a rebuild from checkpoints are those of a full replay
    const key = list => J(list.map(p => [p.index, p.block, p.code ?? null]).sort((x, y) => x[0] - y[0] || (x[1] ?? -1) - (y[1] ?? -1)));
    const pa = key(H.store.problems()), pb = key(sH.store.problems());
    if (pa !== pb) fail(label + ': problems differ from a full replay', { pa, pb });

  }
  // F: the receipts' revs on the line of history are strictly increasing, and the head is at the last one
  {
    const revs = H.store.receipts().map(x => x.receipt.rev).filter(r => r !== 99);
    if (!H.store.receipts().some(x => x.receipt.rev === 99) && !revs.every((r, n) => n === 0 || r > revs[n - 1])) fail(label + ': revs not strictly increasing', { revs: revs.join(',') });
    if (head && revs.length && !H.store.receipts().some(x => x.receipt.rev === 99) && head.meta.rev !== revs.at(-1)) fail(label + ': head rev is not the last rev', { head: head.meta.rev, last: revs.at(-1) });
  }
  // Q: a record whose guarded receipt names none of its ops (quarantined) contributes no effect: the same chat with such a record reduced to its rev numbers gives the same story
  {
    const clean = JSON.parse(J(stripped)); let any = false;
    for (const mm of clean) { const r = mm.extra?.storySuite; if (!r || mm.is_user || r.v !== 2 || !Array.isArray(r.ops) || !Array.isArray(r.receipts)) continue;
      const revs = new Set(r.ops.filter(op => op.path === '/meta/rev').map(op => op.value));
      if (r.receipts.some(rc => rc.guarded === true && !revs.has(rc.rev))) { any = true; r.ops = r.ops.filter(op => op.path === '/meta/rev'); r.spans = [{ n: r.ops.length, story: false }]; r.receipts = r.receipts.map(rc => ({ ...rc, guarded: false })); r.receipts.forEach(rc => { if (rc.data) delete rc.data; }); } }
    if (any && first >= 0) { const cH = mk(clean, 100000); const strip = x => { const y = structuredClone(x); if (y?.meta) delete y.meta.rev; return y; }; const a = J(strip(H.store.head())), b = J(strip(cH.store.head())); if (a !== b) fail(label + ': a quarantined record had an effect', { a, b }); }
  }
  // I: a trusted checkpoint's state is what a full replay of its prefix gives (sampled: the state at a few carriers)
  if (first >= 0) {
    const sH2 = mk(JSON.parse(J(stripped)), 100000); const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite);
    for (let k = 0; k < Math.min(3, idxs.length); k++) { const i = idxs[pick(idxs.length)]; let x, y; try { x = J(H.store.at(i)); y = J(sH2.store.at(i)); } catch { continue; } if (x !== y) fail(label + ': state at a carrier differs from a full replay', { i, x: x.slice(0, 300), y: y.slice(0, 300) }); }
  }
  // B: after a reconcile from the first replan, every recorded boundary is what the chat now gives
  if (label === 'reconcile+' && ran !== false) { const upFrom = ran; ran = false; const bp = H.store.boundaryProblems().filter(x => x.index >= upFrom && !chat[x.index].extra.storySuite.receipts.some(rc => rc.rev === 99) && !H.store.problems().some(p => p.index === x.index && p.code === 'REPLAY_PREREQUISITE') && chat[x.index].extra.storySuite.spans.some(sp => sp.id === x.block && sp.replan)); if (bp.length && process.env.DBGB) { const r2 = H.store.reconcile(upFrom, { rerun }); console.error('second reconcile', JSON.stringify(r2), JSON.stringify(H.store.boundaryProblems())); const sp = chat[bp[0].index].extra.storySuite.spans.find(x => x.id === bp[0].block); console.error(JSON.stringify(sp.replan), sp.source, JSON.stringify(H.store.problems().map(p => [p.index, p.block, p.code]))); }
    if (bp.length) fail(label + ': boundaryProblems', { bp: J(bp).slice(0, 300), problems: J(H.store.problems().map(p => [p.index, p.block, p.code, p.why.slice(0, 60)])), from: H.store.replansFrom() }); }
  const rH = mk(ref);
  if (head && J(rH.store.head()) !== J(head)) fail(label + ': head differs after reload', { a: J(head).slice(0, 300), b: J(rH.store.head()).slice(0, 300) });
  // every earlier state: at(i) equals stripped
}
const trace = [];
let ran = false;   // the index the last reconcile+ went from
import('node:fs').then(()=>{});
const run = (label, fn) => { let res; if (process.env.DUMPBEFORE && fails.length === 0 && label !== 'reconcile') fs.writeFileSync(process.env.DUMPBEFORE, J({ label, chat })); try { res = fn(); trace.push([label, 'ok', res && res.ok === false ? res.code + ':' + res.message : (res && res.ok ? 'ok' + (res.deleted !== undefined ? ' del ' + res.deleted : '') : JSON.stringify(res)?.slice(0, 60))]); } catch (e) { trace.push([label, 'throw', String(e.message).slice(0, 120)]); if (label === 'reconcile+') ran = false; if (!/read-only|newer/.test(String(e.message))) { /* tolerated command errors */ } } check(label); };
let t = 0;
const steps = Number(stepsArg) || 60;
const ids5 = [Q1, Q2, Q5, Q9];
for (let k = 0; k < steps && fails.length < 3; k++) {
  const roll = rnd(); const li = last(); const id = ids5[pick(4)];
  if (rnd() < 0.1) {
    const kind = pick(process.env.NO_NEW ? 10 : 18);
    if (kind < 5) run('showAny', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && (chat[i].swipes?.length ?? 1) > 1); if (!idxs.length) return; const m = chat[idxs[pick(idxs.length)]]; showSwipe(m, pick(m.swipes.length)); afterTimeline(); });
    else if (kind < 9) run('legacy', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite?.checkpoint); if (idxs.length < 2) return; const m = chat[idxs[1 + pick(idxs.length - 1)]]; const r = structuredClone(m.extra.storySuite); delete r.prefix; delete r.covers; delete r.coverHash; m.extra.storySuite = r; H.store.rebuild(); });
    else if (kind < 10) run('orphan', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite?.receipts?.some(rc => rc.guarded === true)); if (!idxs.length) return; const m = chat[idxs[pick(idxs.length)]]; const r = structuredClone(m.extra.storySuite); r.receipts.find(rc => rc.guarded === true).rev = 99; m.extra.storySuite = r; H.store.rebuild(); });
    else if (kind < 12) run('guardEdit', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite?.receipts?.some(rc => rc.data?.v2?.guard)); if (!idxs.length) return; const m = chat[idxs[pick(idxs.length)]]; const r = structuredClone(m.extra.storySuite); const rc = r.receipts.find(x => x.data?.v2?.guard); rc.data.v2.guard.epoch = `ep_0000000${2 + pick(8)}`; m.extra.storySuite = r; H.store.rebuild(); });
    else if (kind < 14) run('sourceEdit', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite?.source); if (!idxs.length) return; const m = chat[idxs[pick(idxs.length)]]; const r = structuredClone(m.extra.storySuite); const tail = `${pick(10)}${pick(10)}${pick(10)}${pick(10)}`; if (pick(2)) r.source.logical = `sr_zzzz${tail}`; else r.source.evidence = `ev_zzzz${tail}`; m.extra.storySuite = r; H.store.rebuild(); });
    else if (kind < 16) run('setting', () => { setting.value = `s${pick(1000)}`; H.store.rebuild(); });
    else run('editReread', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite && !chat[i].extra.storySuite.spans?.some(sp => isMetaSpan(sp) && sp.story)); if (!idxs.length) return; const at = idxs[pick(idxs.length)]; const m = chat[at]; m.mes += ' edited'; m.swipes[m.swipe_id ?? 0] = m.mes; H.store.rebuild(); const story = m.extra.storySuite.receipts.filter(rc => rc.cause === 'story'); if (story.length) return; return H.store.replaceStory(at, { ops: [], receipts: [], rerun }); });
    continue;
  }
  if (roll < 0.2) run('send', () => { chat.push(user(`u${++t}`), reply(`r${t}`)); H.store.ensureInitial(H.registry.initialState()); });
  else if (roll < 0.62) {
    const calls = [['gt.offer', { id, instance: 1 + pick(2) }], ['gt.prove', { id }], ['gt.settle', { id, instance: 1 + pick(2), reward: 1 + pick(5) }], ['gt.quick', { id }], ['gt.hit', { actor: 'ann', amount: 1 + pick(3) }], ['gt.recover', { actor: 'ann' }], ['gt.attempt', { id }], ['gt.collect', { id }], ['gt.tick', { minutes: [0, 5, 30, 60, 90][pick(5)] }], ['gt.withdraw', { id }], ['gt.spend', { amount: 1 + pick(3), key: `s${pick(3)}` }], ['gt.reset', { actor: 'ann' }]];
    const [ty, pl] = calls[pick(calls.length)];
    const cause = (ty === 'gt.attempt' || ty === 'gt.collect') ? 'system' : 'ui';
    run('cmd ' + ty, () => H.bus.command(ty, pl, { cause }));
  }
  else if (roll < 0.68) run('swipe', () => { if (li > 0) { newSwipe(chat[li], `r${++t}s`); H.store.rebuild(); } });
  else if (roll < 0.74) run('show', () => { if (li > 0) { showSwipe(chat[li], pick(chat[li].swipes.length)); afterTimeline(); } });
  else if (roll < 0.77) run('delswipe', () => { if (li > 0 && chat[li].swipes.length > 1) { delSwipe(chat[li], pick(chat[li].swipes.length)); afterTimeline(); } });
  else if (roll < 0.86) run('delmsg', () => { const idxs = chat.map((x, i) => i).filter(i => i > 0); if (!idxs.length) return; const i = idxs[pick(idxs.length)]; chat.splice(i, 1); afterTimeline(); H.store.ensureInitial(H.registry.initialState()); return { ok: true, deleted: i }; });
  else if (roll < 0.875) run('reread', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite); if (!idxs.length) return; const at = idxs[pick(idxs.length)]; const base = H.store.before(at); if (!base) return; const n = 1 + pick(3); const ops = [], receipts = []; for (let k = 1; k <= n; k++) { const rev = base.meta.rev + k; ops.push({ op: 'replace', path: '/domains/gt/minutes', value: 10 * k + pick(5) }, { op: 'replace', path: '/meta/rev', value: rev }); receipts.push({ id: `rc_${(++t).toString(36).padStart(8, 'q')}`, type: 'gt.tick', module: 'zz-guarded', cause: 'story', seed: 1, summary: 'tick', narrate: false, data: {}, rev }); } return H.store.replaceStory(at, { ops, receipts, rerun }); });
  else if (roll < 0.885) run('strip', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite && !chat[i].extra.storySuite.checkpoint); if (!idxs.length) return; const at = idxs[pick(idxs.length)]; const r = structuredClone(chat[at].extra.storySuite); if (pick(2)) delete r.spans; else r.spans = r.spans.map(sp => ({ n: sp.n, story: sp.story })); chat[at].extra.storySuite = r; H.store.rebuild(); });
  else if (roll < 0.89) run('edit', () => { if (li > 0) { chat[li].mes += ' edited'; chat[li].swipes[chat[li].swipe_id] = chat[li].mes; afterTimeline(); } });
  else if (roll < 0.93) run('reload', () => { chat = JSON.parse(J(chat)); H = mk(chat); });
  else if (roll < 0.95) run('reconcile+', () => { const from = H.store.replansFrom(); if (process.env.DUMPBEFORE && fails.length === 0) fs.writeFileSync(process.env.DUMPBEFORE, J({ label: 'reconcile+', from, chat })); if (Number.isInteger(from)) { ran = from; return H.store.reconcile(from, { rerun }); } });
  else if (roll < 0.98) run('reconcile', () => { const idxs = chat.map((x, i) => i).filter(i => !chat[i].is_user && chat[i].extra?.storySuite); if (idxs.length) { const at = idxs[pick(idxs.length)]; if (process.env.DUMPBEFORE && fails.length === 0) fs.writeFileSync(process.env.DUMPBEFORE, J({ label: 'reconcile', at, chat })); return H.store.reconcile(at, { rerun }); } });
  else run('truncate', () => { const rev = H.store.head()?.meta.rev; if (rev > 1) H.store.truncate(H.store.headIndex(), 1 + pick(rev)); });
}
console.log(J({ seed: seedArg, steps, fails: fails.map(f => ({ msg: f.msg, extra: f.extra })) }));
if (process.env.TRACE) { console.log(trace.map(x => x.join(' | ')).join('\n')); console.log(J(chat.map((x, i) => [i, x.is_user ? 'U' : 'R', x.swipe_id, x.extra?.storySuite && { sid: x.extra.storySuite.sid, swipe: x.extra.storySuite.swipe, ops: x.extra.storySuite.ops.length, cp: !!x.extra.storySuite.checkpoint, spans: (x.extra.storySuite.spans ?? []).map(sp => (sp?.n ?? "?") + (sp && isMetaSpan(sp) ? "G" : "")) }]))); }
