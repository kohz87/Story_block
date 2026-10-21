// Story Block v2 for SillyTavern (docs/v2/SPEC.md): the host Story Suite's modules register with.
//
// This file only wires SillyTavern to the v2 runtime (src/v2/runtime.js) and puts the host's UI on the
// page (src/v2/ui-host.js). v1's code stays in the repository (index.v1.js, src/*.js) and is not loaded.
//
// Order of things:
// 1. `globalThis.StoryBlock = { apiVersion: 2, ready, sdk }` is set at once, so a module loaded before
//    or after this file finds it; `ready` resolves to the sdk once the host is up (step 4).
// 2. The runtime: registry with the core module (scene, inventory, packs, events, standard widgets),
//    settings under extension_settings.storySuite, the store over the chat, the command bus, the turn.
// 3. The turn is installed: the generate interceptor named in manifest.json, the prompt and message
//    events, and the v1 prompt keys cleared.
// 4. The UI (bar, story panel, settings overlay, drawer, mounts), then markReady().

import { createRuntime, VERSION } from './src/v2/runtime.js';
import { INTERCEPTOR_NAME } from './src/v2/turn.js';
import { mountUi } from './src/v2/ui-host.js';
import { packs as livePacks, part as livePacksPart, resolveItem, startState } from './src/v2/packs/index.js';

const LOG = '[Story Block v2]';

function boot() {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (!ctx) {
        console.error(`${LOG} SillyTavern's context is not available; Story Block did not start.`);
        return;
    }
    let ui = null;
    const runtime = createRuntime({
        ctx,
        packs: { part: livePacksPart, packs: livePacks, resolveItem, startState },
        onBlocked: (reason, moduleId) => ui?.blocked(reason, moduleId),
        onSaveError: error => globalThis.toastr?.error?.(`The story could not be saved: ${error?.message ?? error}`, 'Story Block'),
        onRegister: () => ui?.syncScreens(),
    });
    const { sdk, turn, markReady } = runtime;
    globalThis.StoryBlock = Object.freeze({ apiVersion: 2, version: VERSION, ready: sdk.ready, sdk });

    turn.install({ globalName: INTERCEPTOR_NAME });
    turn.onChatChanged().catch(error => console.warn(`${LOG} the first chat could not be read`, error));
    try {
        ui = mountUi({ runtime, ctx, version: VERSION });
    } catch (error) {
        console.error(`${LOG} the Story Suite UI could not be shown`, error);
    }
    // A pack installed or switched on changes the screens and the start of new chats.
    livePacks.subscribe?.(() => ui?.syncScreens());
    const types = ctx.eventTypes ?? ctx.event_types ?? {};
    if (types.APP_READY) ctx.eventSource?.on?.(types.APP_READY, () => ui?.refresh());
    if (types.CHAT_CHANGED) ctx.eventSource?.on?.(types.CHAT_CHANGED, () => { ui?.clearBlocked(); ui?.refresh(); });
    markReady();
    console.info(`${LOG} ${VERSION} ready`);
}

boot();
