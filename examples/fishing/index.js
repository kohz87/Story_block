// Story Suite Fishing: a reference activity for Story Block v2. A separate SillyTavern extension that
// uses nothing from Story Block but its public sdk (globalThis.StoryBlock.ready).

import { fishingModule } from './src/module.js';

export { renderFishing } from './src/widget.js';

const host = globalThis.StoryBlock;
if (host?.ready && typeof host.ready.then === 'function') {
    host.ready.then(sdk => sdk.registerModule(fishingModule(sdk)))
        .catch(error => console.error('[Story Suite Fishing] Could not register with Story Block:', error));
} else {
    console.warn('[Story Suite Fishing] Story Block v2 is needed; fishing stays off.');
}
