// Which native checkpoints the chats of this install still refer to (docs/v2/TIMELINE.md, checkpoint clean-up).
//
// The answer is deliberately conservative. Every character and group chat is listed through SillyTavern and read in
// full; the timeline archive in each chat header is walked for checkpoint ids, and the open chat's live metadata is
// read as well. If any list, read or parse fails, or a chat was written by a newer timeline schema, `complete` is
// false: the caller must then keep every checkpoint file. A complete answer is still only the set of references the
// chats carry; it never deletes anything itself.
//
// The timeline fields that can name a native checkpoint include the journal (make, restore, native change and head
// selection entries), the prefix map's before/after records, the selected and baseline records, snapshot and payload
// participants, pins and any nested `checkpoint`/`checkpoints` field. The walk below covers all of them without naming
// another module's checkpoint format.

export const TIMELINE_SCHEMA = 1;

const EXT = /\.jsonl$/i;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const reasonOf = error => String(error?.message || error || 'could not be read');

function liveContext() {
    try { return globalThis.SillyTavern?.getContext?.() ?? null; } catch { return null; }
}

function fetchNow(...args) {
    return globalThis.fetch(...args);
}

function checkpointKey(name) {
    return /checkpoints?(?:ids?)?$/i.test(String(name ?? ''));
}

/** Add every checkpoint id under a `checkpoint`/`checkpoints` field in a timeline archive (a Set). */
export function collectCheckpointReferences(timeline) {
    const found = new Set();
    const seen = new WeakSet();
    const stringsUnder = value => {
        if (typeof value === 'string') {
            const id = value.trim();
            if (id) found.add(id);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) stringsUnder(item);
            return;
        }
        if (!isRecord(value)) return;
        if (seen.has(value)) return;
        seen.add(value);
        for (const [key, item] of Object.entries(value)) {
            if (checkpointKey(key)) found.add(String(key).trim());
            stringsUnder(item);
        }
    };
    const walk = value => {
        if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return;
        }
        if (!isRecord(value)) return;
        if (seen.has(value)) return;
        seen.add(value);
        for (const [key, item] of Object.entries(value)) {
            if (checkpointKey(key)) stringsUnder(item);
            else walk(item);
        }
    };
    walk(timeline);
    return found;
}

/** The archive in one chat's first file row, or a refusal that makes the whole scan incomplete. */
function timelineOfChat(payload) {
    if (Array.isArray(payload)) {
        if (!payload.length) throw new Error('the chat file is empty');
        if (!isRecord(payload[0])) throw new Error('the chat file has no header');
        const metadata = payload[0].chat_metadata;
        if (metadata === undefined || metadata === null) return null;
        if (!isRecord(metadata)) throw new Error('the chat metadata is not an object');
        return timelineOfMetadata(metadata);
    }
    if (isRecord(payload) && Object.hasOwn(payload, 'chat_metadata')) {
        const metadata = payload.chat_metadata;
        if (metadata === undefined || metadata === null) return null;
        if (!isRecord(metadata)) throw new Error('the chat metadata is not an object');
        return timelineOfMetadata(metadata);
    }
    throw new Error('the chat file could not be parsed');
}

function timelineOfMetadata(metadata) {
    const suite = metadata.storySuite;
    if (suite === undefined || suite === null) return null;
    if (!isRecord(suite)) throw new Error('the Story Suite metadata is not an object');
    const timeline = suite.timeline;
    if (timeline === undefined || timeline === null) return null;
    if (!isRecord(timeline)) throw new Error('the timeline archive is not an object');
    if (timeline.v !== undefined) {
        if (!Number.isInteger(timeline.v) || timeline.v < 1) throw new Error('the timeline archive version is not valid');
        if (timeline.v > TIMELINE_SCHEMA) throw new Error(`timeline archive version ${timeline.v} is from a newer version`);
    }
    return timeline;
}

async function postJson(fetchFn, context, url, body) {
    if (typeof fetchFn !== 'function') throw new Error('SillyTavern cannot be reached');
    if (typeof context?.getRequestHeaders !== 'function') throw new Error('SillyTavern request headers are not available');
    const response = await fetchFn(url, {
        method: 'POST',
        headers: context.getRequestHeaders(),
        cache: 'no-cache',
        body: JSON.stringify(body),
    });
    if (!response?.ok) throw new Error(`the server answered ${response?.status ?? 'nothing'}`);
    try { return await response.json(); } catch { throw new Error('the server answer was not JSON'); }
}

function chatFileId(file) {
    return String(file?.file_id ?? file?.file_name ?? file?.fileName ?? file?.name ?? '').replace(EXT, '').trim();
}

/** The chat list of this install: character chat files, then group chat files. */
async function siltyTavernChatList({ context, fetchFn }) {
    const chats = [];
    const unreadable = [];
    const seen = new Set();
    const add = chat => {
        const key = `${chat.kind}|${chat.avatar ?? ''}|${chat.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        chats.push(chat);
    };
    const characters = Array.isArray(context?.characters) ? context.characters : null;
    const groups = Array.isArray(context?.groups) ? context.groups : null;
    if (!characters) unreadable.push({ chat: 'character list', reason: 'SillyTavern did not provide its characters' });
    if (!groups) unreadable.push({ chat: 'group list', reason: 'SillyTavern did not provide its groups' });
    if (characters) {
        for (const character of characters) {
            const avatar = String(character?.avatar ?? '').trim();
            const name = String(character?.name ?? avatar).trim();
            if (!avatar) {
                unreadable.push({ chat: `character ${name || '(unnamed)'}`, reason: 'it has no avatar file to list chats with' });
                continue;
            }
            let answer;
            try {
                answer = await postJson(fetchFn, context, '/api/characters/chats', { avatar_url: avatar, simple: true });
            } catch (error) {
                unreadable.push({ chat: `character ${name}`, reason: reasonOf(error) });
                continue;
            }
            if (isRecord(answer) && answer.error) {
                unreadable.push({ chat: `character ${name}`, reason: 'SillyTavern could not list its chats' });
                continue;
            }
            const list = Array.isArray(answer) ? answer : isRecord(answer) ? Object.values(answer) : null;
            if (!list) {
                unreadable.push({ chat: `character ${name}`, reason: 'the chat list was not a list' });
                continue;
            }
            for (const file of list) {
                const id = chatFileId(file);
                if (!id) {
                    unreadable.push({ chat: `character ${name}`, reason: 'a listed chat has no file name' });
                    continue;
                }
                add({ kind: 'character', label: `${name} / ${id}`, name, avatar, id });
            }
        }
    }
    if (groups) {
        for (const group of groups) {
            const groupName = String(group?.name ?? group?.id ?? 'group');
            const ids = [
                ...(Array.isArray(group?.chats) ? group.chats : []),
                group?.chat_id,
            ].map(value => String(value ?? '').replace(EXT, '').trim()).filter(Boolean);
            for (const id of new Set(ids)) add({ kind: 'group', label: `${groupName} / ${id}`, id });
        }
    }
    return { chats, unreadable };
}

async function readSillyTavernChat(chat, { context, fetchFn }) {
    if (chat.kind === 'group') {
        return postJson(fetchFn, context, '/api/chats/group/get', { id: chat.id });
    }
    return postJson(fetchFn, context, '/api/chats/get', { ch_name: chat.name, file_name: chat.id, avatar_url: chat.avatar });
}

/**
 * Checkpoint ids still named by every chat's timeline, through SillyTavern's chat list and chat read.
 * `list`/`read` are seams for tests; without them the SillyTavern endpoints are used.
 * → `{ complete, referenced: string[], unreadable: [{ chat, reason }] }`. `complete` is false if ANY chat or
 * list could not be read, parsed or carries a newer timeline schema.
 */
export async function referencedCheckpoints({ context = liveContext, fetchFn = fetchNow, list = null, read = null } = {}) {
    const found = new Set();
    const unreadable = [];
    const ctx = typeof context === 'function' ? context() : context;
    if (!ctx) unreadable.push({ chat: 'SillyTavern', reason: 'its context is not available' });
    const listed = typeof list === 'function'
        ? await list({ context: ctx, fetchFn })
        : await siltyTavernChatList({ context: ctx, fetchFn });
    if (Array.isArray(listed)) {
        for (const chat of listed) {
            try {
                const payload = await (typeof read === 'function' ? read(chat, { context: ctx, fetchFn }) : readSillyTavernChat(chat, { context: ctx, fetchFn }));
                const timeline = timelineOfChat(payload);
                if (timeline) for (const id of collectCheckpointReferences(timeline)) found.add(id);
            } catch (error) {
                unreadable.push({ chat: chat?.label ?? chat?.id ?? 'chat', reason: reasonOf(error) });
            }
        }
    } else if (listed && typeof listed === 'object') {
        if (Array.isArray(listed.unreadable)) unreadable.push(...listed.unreadable);
        for (const chat of Array.isArray(listed.chats) ? listed.chats : []) {
            try {
                const payload = await (typeof read === 'function' ? read(chat, { context: ctx, fetchFn }) : readSillyTavernChat(chat, { context: ctx, fetchFn }));
                const timeline = timelineOfChat(payload);
                if (timeline) for (const id of collectCheckpointReferences(timeline)) found.add(id);
            } catch (error) {
                unreadable.push({ chat: chat?.label ?? chat?.id ?? 'chat', reason: reasonOf(error) });
            }
        }
    } else {
        unreadable.push({ chat: 'chat list', reason: 'the chat list could not be read' });
    }
    // The open chat can be newer than its file (an unsaved turn); never leave its live references out.
    if (ctx?.chatMetadata && typeof ctx.chatMetadata === 'object') {
        try {
            const timeline = timelineOfMetadata(ctx.chatMetadata);
            if (timeline) for (const id of collectCheckpointReferences(timeline)) found.add(id);
        } catch (error) {
            unreadable.push({ chat: 'open chat', reason: reasonOf(error) });
        }
    }
    return { complete: unreadable.length === 0, referenced: [...found].sort(), unreadable };
}
