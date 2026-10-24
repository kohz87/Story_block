// A stand-in for SillyTavern's server, for the store's own chat-file saves (src/v2/chat-file.js): the
// endpoints it uses, over `files` (file name → [header, ...messages]). Installed on a testkit host's
// ctx (getRequestHeaders, characters, characterId) and on globalThis.fetch for the test.
export function serveChats(t, h, { name = 'Narrator', avatar = 'narrator.png' } = {}) {
    const server = {
        files: {},
        requests: [],
        failing: false,
        /** The messages of file `id` as saved (no header), or null. */
        messages: id => (server.files[id] ? structuredClone(server.files[id].slice(1)) : null),
    };
    h.ctx.getRequestHeaders = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' });
    h.ctx.characters = [{ name, avatar }];
    h.ctx.characterId = 0;
    const reply = (status, data) => ({
        ok: status >= 200 && status < 300, status, statusText: status === 500 ? 'Internal Server Error' : '',
        json: async () => structuredClone(data),
    });
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const body = JSON.parse(init.body);
        server.requests.push({ url, body, keepalive: init.keepalive === true });
        if (url === '/api/chats/save') {
            if (server.failing) return reply(500, { error: 'An error has occurred, see the console logs for more information.' });
            if (body.avatar_url !== avatar || body.ch_name !== name) return reply(400, { error: 'wrong character' });
            server.files[body.file_name] = structuredClone(body.chat);
            return reply(200, { ok: true });
        }
        if (url === '/api/chats/get') return reply(200, server.files[body.file_name] ?? []);
        return reply(404, {});
    });
    return server;
}
