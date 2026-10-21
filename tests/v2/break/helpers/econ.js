// Shared bits for the b3-economy break tests (Story Block only: core module, testkit host).
import { createHost } from '../../../../testkit/index.js';

export const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
export const coin = (host, owner = 'party') => host.head().domains.inventory.wallets?.[owner]?.coin ?? 0;
export const qtyOf = (host, name) => host.sdk.query('inventory.items', {}).filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

/** A core-only host with one reply in the chat (so commands have a carrier). */
export async function coreHost(options = {}) {
    const host = await createHost(options);
    await host.send('We arrive.', reply('The square.', ['~ place Bluewatch Village | kind: settlement', '+ coin 44']));
    return host;
}

/** A pack with one event, as JSON text. */
export function eventPack(event, id = 'b3-events') {
    return JSON.stringify({
        id, version: '1.0.0', name: 'B3 events', requires: { storyBlock: '^2' },
        content: { events: [event] },
    });
}
