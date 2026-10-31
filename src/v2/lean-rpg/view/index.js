// The Lean RPG's screens, mounted by ui-host.js only while the feature `story-block.lean-rpg` is on (a dynamic import(),
// so with the feature off none of this file or its siblings is ever loaded). One call wires everything:
//   * the stylesheet (lean-rpg.css), added to the page's head;
//   * the Party tab (a screen that shows while the chat has a Character block) and its widget, with the Spend points sheet;
//   * the battle log in the replies (at the narrator's `[battle]` marker, else a card under the reply);
//   * the "Changed this reply" lines (`cardLines`) and the Lean RPG fold on the Features settings page (`settingsBodies`).
// `destroy()` takes all of it away again (the feature was switched off).

import { createBattleLog } from './battle-log.js';
import { rpgReplyLines } from './changes-lines.js';
import { PARTY_WIDGET, createPartyScreen, createPartyWidget } from './party.js';
import { withLeanRpgSettings } from './settings.js';

export { PARTY_SCREEN_ID, PARTY_WIDGET } from './party.js';
export { rpgReplyLines } from './changes-lines.js';
export const PACK = 'lean-rpg';
const STYLE_ATTR = 'data-ss-lean-rpg';

function addStyle(doc) {
    try {
        if (doc.querySelector?.(`link[${STYLE_ATTR}]`)) return null;
        const link = doc.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute(STYLE_ATTR, '');
        link.setAttribute('href', new URL('./lean-rpg.css', import.meta.url).href);
        (doc.head ?? doc.body).appendChild(link);
        return link;
    } catch {
        // A page with no head, or an address that cannot be made: the screens still work, with the base look.
        return null;
    }
}

/**
 * mountLeanRpg({ doc, ctx, store, events, screens, widgets, headState, readerName, roleOf, featureOn, openScreen, openBlock, refresh })
 * → { cardLines({ index, state, before, record, problems }), settingsBodies(bodies), battleLog, destroy() }.
 * `screens` is the screen registry (`setPack`, `removePack`); `widgets` the host's own widget table (the Party widget is added
 * to it); `headState()` the head state; `featureOn()` whether the feature is on now; `openBlock(module)` opens the Blocks page at that
 * block; `refresh()` redraws the tabs.
 */
export function mountLeanRpg({ doc, ctx, store, events = null, screens, widgets, headState, readerName = () => '', roleOf, featureOn = () => true, openScreen = null, openBlock = null, refresh = () => {} }) {
    const link = addStyle(doc);
    widgets[PARTY_WIDGET] = createPartyWidget({ headState, readerName, roleOf, openScreen, openBlock });
    screens.setPack(PACK, [createPartyScreen({ roleOf })]);
    const battleLog = createBattleLog({ ctx, doc, store, events, featureOn, roleOf });
    battleLog.refreshAll();
    refresh();
    return {
        battleLog,
        cardLines: info => { try { return rpgReplyLines({ ...info, roleOf }); } catch { return []; } },
        settingsBodies: bodies => withLeanRpgSettings(bodies, { featureOn }),
        destroy() {
            battleLog.destroy();
            screens.removePack(PACK);
            delete widgets[PARTY_WIDGET];
            link?.remove();
            refresh();
        },
    };
}
