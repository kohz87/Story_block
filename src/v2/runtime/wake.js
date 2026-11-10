// Story Suite v2: the wake check. A tab that was hidden (a background tab, a phone, a bfcache page) may hold an
// older copy of the chat than the server, because the reader played it on another device meanwhile. Saving that old
// copy would overwrite the newer story, so a tab that comes back asks the server first, before it saves anything:
// 1. the chat file changed since this tab last loaded or wrote it: Story Block's saves of it stop, its unsaved changes
//    are dropped, the chat is loaded again from the server and the reader is told in a toast;
// 2. the character (or group) has another chat file whose last message is newer than the open one's: a toast says so
//    (no switch, no button).
// How it asks: SillyTavern's chat list (/api/chats/search with an empty query: per file the name, size, message count, last
// message time and the end of the last message), never the whole chat file. This tab keeps a fingerprint of what it last
// loaded or wrote (the message count, the last message's date and text, from the very messages it sent), so its own saves,
// keepalive ones included, never look like another device's. The server's row is also compared with the chat as it is now
// in this tab: where SillyTavern saved the chat itself, the two agree and nothing is done.
// Not seen by it: a change of another device that leaves the count, the last message's date and its text as they were
// (an edit of an earlier message, a metadata-only change); and a write of another device after the check and before the
// next save (the server's own integrity check covers only a replaced file). SillyTavern's own saves are not held.
// While a reply is being built the check waits for it to end. Where there is no file this page can list (the testkit,
// a temporary chat) nothing is asked. A server that does not answer in time leaves saving as it was, and says so.

export const WAKE_TIMEOUT_MS = 8000;
export const LONG_GAP_MS = 10 * 60 * 1000;
const PREVIEW = 400;
const EMPTY = '[The message is empty]';

/** What a chat file lists of its messages: { count, last, preview } (the list's message_count, last_mes, preview_message). */
export function fingerprint(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const last = list[list.length - 1];
    if (!last) return { count: 0, last: null, preview: '' };
    const mes = String(last.mes || EMPTY);
    return {
        count: list.length,
        last: last.send_date === undefined || last.send_date === null || last.send_date === '' ? null : String(last.send_date),
        preview: mes.length > PREVIEW ? `...${mes.slice(-PREVIEW)}` : mes,
    };
}
const rowPrint = row => ({ count: Number(row?.message_count) || 0, last: row?.last_mes === undefined ? null : String(row.last_mes), preview: String(row?.preview_message ?? '') });
// The list shows a file's date from its last message, or from the file's own time when that has none: a missing date is not compared.
const same = (a, b) => !!a && !!b && a.count === b.count && a.preview === b.preview && (a.last === null || b.last === null || a.last === b.last);
const timeOf = value => { const t = typeof value === 'number' ? value : Date.parse(String(value ?? '')); return Number.isFinite(t) ? t : NaN; };

/**
 * createWakeCheck({ file, chat, replyBusy, whenIdle, store, reload, say, timers, now, timeoutMs, longMs }) →
 * { loaded(), wrote(place, messages), hold(), run(reason), attach(page) }.
 * `file` is the chat file object (chat-file.js: where, list); `store` gives `unsavedCount`, `discardUnsaved`;
 * `reload()` loads the open chat again from the server; `say(text, kind)` shows a toast ('warning' | 'info').
 */
export function createWakeCheck({
    file, chat, replyBusy = () => false, whenIdle = () => Promise.resolve(), store, reload = null, say = null,
    timers = globalThis, now = () => Date.now(), timeoutMs = WAKE_TIMEOUT_MS, longMs = LONG_GAP_MS,
}) {
    const base = new Map();       // chat id → fingerprint of what this tab last loaded or wrote
    const warned = new Set();     // "chat id|other file": a newer chat already told of
    let touched = now();          // the last time this tab loaded, wrote or checked
    let pending = null;
    let waiting = false;
    let downTold = false;
    const tell = (text, kind) => { try { say?.(text, kind); } catch { /* a missing toastr is not an error */ } };
    const placeNow = () => { try { return file.where(); } catch { return null; } };

    function loaded() {
        const place = placeNow();
        if (!place) return;
        base.set(place.chatId, fingerprint(chat()));
        touched = now();
    }
    function wrote(place, messages) {
        if (!place?.chatId) return;
        base.set(place.chatId, fingerprint(messages));
        touched = now();
    }

    function timeout() {
        return new Promise(resolve => {
            const timer = timers.setTimeout(() => resolve(null), timeoutMs);
            timer?.unref?.();
        });
    }

    async function check(place, reason) {
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
        // The chat may have been switched, or a reply started, while the server was asked.
        if (placeNow()?.chatId !== place.chatId) return;
        if (replyBusy()) { later(reason); return; }
        touched = now();
        const row = rows.find(entry => entry?.file_name === place.chatId);
        if (!row || !(Number(row.message_count) > 0)) return;
        const server = rowPrint(row);
        const mine = base.get(place.chatId);
        if (!same(server, mine) && !same(server, fingerprint(chat()))) {
            await stale(place);
            return;
        }
        base.set(place.chatId, server);
        newer(place, row, rows);
    }

    async function stale(place) {
        const dropped = store.discardUnsaved();
        base.delete(place.chatId);
        const note = dropped > 0 ? ` ${dropped} unsaved change${dropped === 1 ? '' : 's'} in this tab ${dropped === 1 ? 'was' : 'were'} dropped.` : '';
        tell(`This chat changed on another device. Reloaded the newer copy.${note}`, 'warning');
        try { await reload?.(); } catch (error) { console.warn('[Story Suite] the newer copy of the chat could not be loaded', error); }
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

    // A reply was in progress: the check is made when it ends.
    function later(reason) {
        if (waiting) return;
        waiting = true;
        Promise.resolve(whenIdle()).then(() => { waiting = false; run(reason); }, () => { waiting = false; });
    }

    /** Asks the server now (see the top of this file). Never throws; → a promise that settles when the check is over. */
    function run(reason = 'wake') {
        if (pending) return pending;
        const place = placeNow();
        if (!place) return Promise.resolve();
        if (replyBusy()) { later(reason); return Promise.resolve(); }
        touched = now();   // a check that gets no answer is not asked again at every save
        pending = check(place, reason).catch(error => { console.warn('[Story Suite] the wake check failed', error); })
            .finally(() => { pending = null; });
        return pending;
    }

    /**
     * The saver asks before each save (not a keepalive one): a promise while a check is pending, or one is due because
     * this tab did nothing with the chat for a long time (a visibility event missed); else null, and the save goes on.
     */
    function hold() {
        if (pending) return pending;
        if (placeNow() && now() - touched > longMs) return run('a long wait');
        return null;
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

    return { loaded, wrote, hold, run, attach };
}
