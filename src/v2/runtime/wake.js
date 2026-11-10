// Story Suite v2: the wake check. A tab that was hidden (a background tab, a phone, a bfcache page) may hold an
// older copy of the chat than the server, because the reader played it on another device meanwhile. Saving that old
// copy would overwrite the newer story, so a tab that comes back asks the server first, before it saves anything:
// 1. the chat file changed since this tab last loaded or wrote it: Story Block's saves of that chat stop, the chat is
//    loaded again from the server, this tab's unsaved changes are dropped and the reader is told in a toast. The saves
//    stay stopped until the reload is seen (a failed or missing reload keeps them stopped and says so; the next wake tries again);
// 2. the character (or group) has another chat file whose last message is newer than the open one's: a toast says so
//    (no switch, no button).
// How it asks: SillyTavern's chat list (/api/chats/search with an empty query: per file the name, size, message count, last
// message time and the end of the last message), never the whole chat file. This tab keeps a print of what it last loaded
// or wrote: the message count, the last message's date and text, and the file size as the server will list it (worked out
// from the very request body, at the moment it is sent, so a message that changes after is not mixed in). Every write
// it sent lately counts as its own, acknowledged or not, so a save the server applied but this tab has not heard of yet
// never looks foreign; the check also waits for a save on its way before it asks. Where SillyTavern saved the chat itself
// (the tab's chat as it is now differs from what was written), the list's row is compared with the chat in the tab too.
// While the check is pending, or the chat is stopped, nothing is written: a save waits for the answer (and is dropped
// when stale), and a keepalive one (the page is going away, nothing can wait) is skipped and made again after the check.
// Not seen by it: a change of another device that leaves the count, the last message's date and its text as they were
// and the file size within the list's rounding (about 5 bytes up to 1 KB steps, 5 KB around a megabyte): a few characters
// changed in an earlier message; an edit of an earlier message made in this tab through SillyTavern's own editor and
// saved by it looks foreign too (its size changed; the reload brings the tab's own saved copy back); a write of another device
// after the check and before the next save (the server's integrity check covers only a replaced file); a rescue write to
// another chat (not the open one). Where there is no file this page can list (the testkit, a temporary chat) nothing is
// asked. A server that does not answer in time leaves saving as it was, and says so.

export const WAKE_TIMEOUT_MS = 8000;
export const LONG_GAP_MS = 10 * 60 * 1000;
export const RELOAD_WAIT_MS = 5000;
const PREVIEW = 400;
const EMPTY = '[The message is empty]';
const SENT_KEEP = 8;
const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

/**
 * What a chat file lists of its messages: { count, last, preview, size } (the list's message_count, last_mes,
 * preview_message; `size` is the file's bytes when known, else null).
 */
export function fingerprint(messages, size = null) {
    const list = Array.isArray(messages) ? messages : [];
    const last = list[list.length - 1];
    if (!last) return { count: 0, last: null, preview: '', size };
    const mes = String(last.mes || EMPTY);
    return {
        count: list.length,
        last: last.send_date === undefined || last.send_date === null || last.send_date === '' ? null : String(last.send_date),
        preview: mes.length > PREVIEW ? `...${mes.slice(-PREVIEW)}` : mes,
        size,
    };
}
// The list's file_size is text like "12.34KB": its value in bytes and how far that can be from the true size (rounding).
function parseSize(text) {
    const m = /^\s*([\d.]+)\s*([KMGT]?B)\s*$/i.exec(String(text ?? ''));
    if (!m || !(Number(m[1]) >= 0)) return null;
    const unit = UNITS[m[2].toUpperCase()];
    return { bytes: Number(m[1]) * unit, tolerance: (unit === 1 ? 0 : unit * 0.005) + 2 };
}
const rowPrint = row => ({
    count: Number(row?.message_count) || 0, last: row?.last_mes === undefined ? null : String(row.last_mes),
    preview: String(row?.preview_message ?? ''), size: parseSize(row?.file_size),
});
// The list shows a file's date from its last message, or from the file's own time when that has none: a missing date is not compared.
// A size is compared only when both are known.
const same = (a, b) => !!a && !!b && a.count === b.count && a.preview === b.preview && (a.last === null || b.last === null || a.last === b.last);
const sizeFits = (print, server) => print.size === null || !server.size || Math.abs(print.size - server.size.bytes) <= server.size.tolerance;
const timeOf = value => { const t = typeof value === 'number' ? value : Date.parse(String(value ?? '')); return Number.isFinite(t) ? t : NaN; };

/**
 * createWakeCheck({ file, chat, replyBusy, whenIdle, settle, store, reload, say, timers, now, timeoutMs, longMs, reloadMs }) →
 * { loaded(), sent(place, print), hold(options), run(reason), attach(page), blocked() }.
 * `file` is the chat file object (chat-file.js: where, list); `store` gives `unsavedCount`, `discardUnsaved`, `scheduleSave`;
 * `reload()` loads the open chat again from the server (`loaded()` must then be told: the head event); `settle()` resolves
 * when no save is on its way; `say(text, kind)` shows a toast ('warning' | 'info').
 */
export function createWakeCheck({
    file, chat, replyBusy = () => false, whenIdle = () => Promise.resolve(), settle = () => Promise.resolve(), store, reload = null,
    say = null, timers = globalThis, now = () => Date.now(), timeoutMs = WAKE_TIMEOUT_MS, longMs = LONG_GAP_MS, reloadMs = RELOAD_WAIT_MS,
}) {
    const base = new Map();       // chat id → { prints: [newest last], seen }: what this tab loaded or wrote; seen: the server listed it
    const warned = new Set();     // "chat id|other file": a newer chat already told of
    const stopped = new Set();    // chat ids found stale and not yet reloaded: nothing is written to them
    let touched = now();          // the last time this tab loaded, wrote or checked
    let pending = null;
    let reloading = null;
    let loads = 0;                // how many times a chat was loaded (the reload's proof)
    let loadWaiter = null;
    let skipped = false;          // a save was skipped while the check ran: made again after it
    let downTold = false;
    const tell = (text, kind) => { try { say?.(text, kind); } catch { /* a missing toastr is not an error */ } };
    const placeNow = () => { try { return file.where(); } catch { return null; } };
    const entry = id => { let e = base.get(id); if (!e) { e = { prints: [], seen: false }; base.set(id, e); } return e; };
    const remember = (id, print, seen) => {
        const e = entry(id);
        // A write replaces what was only loaded (its size was never known: it would match any size).
        if (print.size !== null) e.prints = e.prints.filter(p => p.size !== null);
        e.prints.push(print);
        if (e.prints.length > SENT_KEEP) e.prints.shift();
        if (seen) e.seen = true;
    };

    function loaded() {
        const place = placeNow();
        loads++;
        loadWaiter?.();
        if (!place) return;
        if (!reloading) stopped.delete(place.chatId);
        const print = fingerprint(chat());
        base.set(place.chatId, { prints: [print], seen: false });
        touched = now();
        baseline(place, print);
    }
    /** A write of this chat has just been sent (chat-file.js onSent): its print, made from the request itself. */
    function sent(place, print) {
        if (!place?.chatId || !print) return;
        remember(place.chatId, print, true);
        touched = now();
    }
    // Right after a load the file's size is learned from the list (nothing was written yet): so an earlier message
    // changed elsewhere before the first wake still shows. Best effort, never told to the reader.
    async function baseline(place, print) {
        try {
            const rows = await Promise.race([file.list(place), timeout()]);
            const e = base.get(place.chatId);
            if (!Array.isArray(rows) || !e || e.prints.length !== 1 || e.prints[0] !== print || placeNow()?.chatId !== place.chatId) return;
            const row = rows.find(r => r?.file_name === place.chatId);
            if (!row) return;
            const server = rowPrint(row);
            if (!same(server, print) || !server.size) return;
            print.size = server.size.bytes;
            e.seen = true;
        } catch { /* the first wake check will learn it */ }
    }

    function timeout() {
        return new Promise(resolve => {
            const timer = timers.setTimeout(() => resolve(null), timeoutMs);
            timer?.unref?.();
        });
    }

    async function check(place) {
        // A save on its way finishes first: it is this tab's own and the server's row must include it.
        try { await Promise.race([Promise.resolve(settle()), timeout()]); } catch { /* it failed on its own */ }
        const abort = typeof AbortController === 'function' ? new AbortController() : null;
        let rows = null;
        try {
            rows = await Promise.race([file.list(place, abort ? { signal: abort.signal } : {}), timeout()]);
        } catch { rows = null; }
        if (!Array.isArray(rows)) {
            abort?.abort();
            if (!downTold) {
                downTold = true;
                tell('Could not check whether this chat changed on another device (the server did not answer). Saving as usual.', 'warning');
            }
            return;
        }
        downTold = false;
        // The chat may have been switched while the server was asked.
        if (placeNow()?.chatId !== place.chatId) return;
        touched = now();
        const e = base.get(place.chatId);
        const row = rows.find(r => r?.file_name === place.chatId);
        if (!row) {
            // A chat the server has listed before that is gone from the list was deleted or renamed elsewhere; one it never listed is new.
            if (e?.seen) stop(place);
            return;
        }
        const server = rowPrint(row);
        if (!(server.count > 0) && !(e?.prints.some(p => p.count === 0))) { if (e?.seen) stop(place); return; }
        const mine = (e?.prints ?? []).find(p => same(server, p) && sizeFits(p, server));
        // Where SillyTavern saved the chat itself the tab's chat has moved past everything written; the row then matches it.
        const now_ = fingerprint(chat());
        const moved = !(e?.prints ?? []).some(p => same(now_, p));
        if (!mine && !(moved && same(server, now_))) { stop(place); return; }
        const kept = { ...(mine ?? now_), size: server.size ? server.size.bytes : null };
        base.set(place.chatId, { prints: [kept], seen: true });
        newer(place, row, rows);
    }

    // The chat is stale: nothing is written to it until the newer copy is loaded.
    function stop(place) {
        stopped.add(place.chatId);
        recover(place);
    }

    function loadedSince(count) {
        if (loads !== count) return Promise.resolve(true);
        return new Promise(resolve => {
            const timer = timers.setTimeout(() => { loadWaiter = null; resolve(false); }, reloadMs);
            timer?.unref?.();
            loadWaiter = () => { timers.clearTimeout(timer); loadWaiter = null; resolve(true); };
        });
    }

    function recover(place) {
        if (reloading) return reloading;
        reloading = (async () => {
            // A reply is never cut by the reload: it ends first. Saves of the chat are stopped meanwhile.
            if (replyBusy()) { try { await whenIdle(); } catch { /* the reply failed: the reload goes on */ } }
            if (placeNow()?.chatId !== place.chatId) { stopped.delete(place.chatId); return; }
            const before = store.unsavedCount?.() ?? 0;
            const count = loads;
            let ok = false;
            try {
                await reload?.();
                ok = await loadedSince(count);
            } catch (error) { console.warn('[Story Suite] the newer copy of the chat could not be loaded', error); }
            if (!ok) {
                tell('This chat changed on another device, but the newer copy could not be loaded. Saving of this chat is paused: reload the page.', 'warning');
                return;
            }
            const dropped = Math.max(before, store.discardUnsaved?.() ?? 0);
            stopped.delete(place.chatId);
            const note = dropped > 0 ? ` ${dropped} unsaved change${dropped === 1 ? '' : 's'} in this tab ${dropped === 1 ? 'was' : 'were'} dropped.` : '';
            tell(`This chat changed on another device. Reloaded the newer copy.${note}`, 'warning');
        })().catch(error => { console.warn('[Story Suite] the wake check could not recover the chat', error); })
            .finally(() => { reloading = null; });
        return reloading;
    }

    function newer(place, row, rows) {
        const open = timeOf(row.last_mes);
        if (Number.isNaN(open)) return;
        let best = null;
        for (const other of rows) {
            if (!other || other.file_name === place.chatId || !(Number(other.message_count) > 0)) continue;
            const at = timeOf(other.last_mes);
            if (at > open && (!best || at > best.at)) best = { at, name: String(other.file_name) };
        }
        if (!best || warned.has(`${place.chatId}|${best.name}`)) return;
        warned.add(`${place.chatId}|${best.name}`);
        tell(`A newer chat exists for this character: ${best.name}. Open it from Manage chats.`, 'info');
    }

    /** Asks the server now (see the top of this file). Never throws; → a promise that settles when the check is over. */
    function run(reason = 'wake') {
        const place = placeNow();
        if (!place) return Promise.resolve();
        // A stale chat whose reload failed: asked again at every wake.
        if (stopped.has(place.chatId)) { recover(place); return reloading ?? Promise.resolve(); }
        if (pending) return pending;
        touched = now();   // a check that gets no answer is not asked again at every save
        pending = check(place).catch(error => { console.warn(`[Story Suite] the wake check failed (${reason})`, error); })
            .finally(() => {
                pending = null;
                if (skipped && !stopped.has(place.chatId)) { skipped = false; try { store.scheduleSave?.(); } catch { /* saved later */ } }
            });
        return pending;
    }

    /**
     * The saver asks before each write of the open chat (and before an urgent one): null = go on; false = do not write (the
     * chat is stale, or a keepalive save met a check that is pending or due: it is made again after the check); a promise
     * (resolving to false when the chat turned out stale) while a check is pending, or one is due because this tab did
     * nothing with the chat for a long time (a visibility event missed).
     */
    function hold({ keepalive = false } = {}) {
        const place = placeNow();
        if (!place) return null;
        if (stopped.has(place.chatId)) { skipped = true; return false; }
        let gate = pending;
        if (!gate && now() - touched > longMs) gate = run('a long wait');
        if (!gate) return null;
        if (keepalive) { skipped = true; return false; }
        return gate.then(() => !stopped.has(place.chatId));
    }

    function attach(page) {
        if (typeof page?.addEventListener !== 'function') return () => {};
        const doc = page.document ?? null;
        const onVisible = () => { if (doc?.visibilityState === 'visible') run('visible'); };
        const onShow = () => { run('pageshow'); };
        const onResume = () => { run('resume'); };
        doc?.addEventListener?.('visibilitychange', onVisible);
        doc?.addEventListener?.('resume', onResume);
        page.addEventListener('pageshow', onShow);
        return () => {
            doc?.removeEventListener?.('visibilitychange', onVisible);
            doc?.removeEventListener?.('resume', onResume);
            page.removeEventListener?.('pageshow', onShow);
        };
    }

    return { loaded, sent, hold, run, attach, blocked: () => stopped.size > 0 };
}
