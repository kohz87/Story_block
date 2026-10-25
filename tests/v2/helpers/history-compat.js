import { createHost } from '../../../testkit/index.js';
import { rulesModule, clone } from './timeline.js';
import { seedCrypto } from '../qa/helpers/seeded.js';

export async function historyCompat(guarded) {
    const undo = seedCrypto(603);
    const host = await createHost({ modules: [rulesModule()] });
    try {
        await host.send('Begin.', 'Here.\n<Changes>\n+ coin 7\n</Changes>');
        if (guarded) await host.sdk.command('tl.guarded', { epoch: 'ep_00000001' });
        await host.send('Go.', 'There.\n<Changes>\n+ coin 3\n</Changes>');
        await host.cont(' Still here.');
        await host.sdk.reread(host.ctx.chat.length - 1);
        await host.swipe('Elsewhere.\n<Changes>\n+ coin 2\n</Changes>');
        await host.st.swipeTo(host.ctx.chat.length - 1, 0);
        await host.store.flush();
        return clone({ chat: host.ctx.chat, metadata: host.ctx.chatMetadata, head: host.head() });
    } finally { host.close(); undo(); }
}
