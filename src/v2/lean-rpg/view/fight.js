// The Fight tab (approved mockup, section 5): the Foes block's own tab while the feature is on. It shows only while any foe slot
// is filled. A header "Fight · <place>" with the note about automatic rolls and two pills ("Exchange N" from the latest rolls,
// "N foes · M down"), a card per foe (name, Class pill, five-cell health bar, greyed when Down, a pencil for the name), a card per
// character with the three stage bars, and "Last exchange": the latest reply's battle-log panel with a button that scrolls the chat to
// that reply and closes the game view. Wide screen a grid, phone a stack.
// Every node is built with createElement and textContent.

import { h, shell } from '../../view/widgets/dom.js';
import { editable } from '../../view/widgets/editable.js';
import { meter } from '../../view/widgets/meter.js';
import { CLASS_NAMES } from '../names.js';
import { RPG_STRINGS, fill } from '../strings.js';
import { buildPanel } from './battle-log.js';
import { drawStageBars } from './bars.js';
import { foesOf, readParty, rpgBlocks, soulName, stageMax, stageTone } from './party-data.js';

const F = RPG_STRINGS.fight;
export const FIGHT_WIDGET = 'lean-rpg.fight';
/** The id ends in `fight`, so the navigation puts the tab at Fight's place (screens.js DEFAULT_ORDER). */
export const FIGHT_SCREEN_ID = 'story-block/fight';

/** The foes of every Foes block, filled slots only: `foesOf`'s records with where each one is kept (for the pencil) and its health bar. */
export function readFight(state, { roleOf } = {}) {
    return rpgBlocks(state, { roleOf }).filter(block => block.role === 'foes').flatMap(block => foesOf(block).map(foe => {
        const schema = block.definition.state?.[`hurt${foe.slot}`], max = stageMax('health', schema);
        const nameSchema = block.definition.state?.[`foe${foe.slot}`];
        return { ...foe, module: block.module, subject: block.subject, max, tone: stageTone(Math.min(foe.hurt, max), max), down: foe.hurt <= 0,
            className: soulName(block.definition.state?.[`class${foe.slot}`], foe.class) || CLASS_NAMES[foe.class - 1] || String(foe.class),
            nameMax: Number.isSafeInteger(nameSchema?.max) ? nameSchema.max : 40, locked: nameSchema?.edit === false };
    }));
}

/** Whether any foe slot is filled (the Fight tab shows only then). */
export const hasFoes = (state, options) => rpgBlocks(state, options).some(block => block.role === 'foes' && foesOf(block).length > 0);

/** The Fight screen: a tab and a game-view screen, on only while a foe slot is filled. `roleOf` as for the readers. */
export function createFightScreen({ roleOf } = {}) {
    return Object.freeze({
        id: FIGHT_SCREEN_ID, title: F.title, icon: 'fa-skull', mounts: Object.freeze(['screen', 'tab']),
        template: `<ss-widget name="${FIGHT_WIDGET}"></ss-widget>`,
        active: state => ({ on: hasFoes(state, { roleOf }) }),
        activeNote: 'Shown only while a foe is in the Foes block.',
    });
}

const placeOf = state => {
    const name = state?.domains?.scene?.place?.name;
    return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
};

/**
 * The Fight widget. `deps`: `headState()`, `readerName()`, `roleOf(definition)`, `battleLog` (createBattleLog's handle: `latest()` is the
 * latest reply with recorded rolls, `{ index, model }`, or null), `closeView()` (closes the game view), `showReply(index)` (scrolls the
 * chat to that reply; default: SillyTavern's `.mes[mesid]` element scrolls into view).
 */
export function createFightWidget({ headState = () => null, readerName = () => '', roleOf, battleLog = null, closeView = () => {}, showReply = null } = {}) {
    return {
        props: {}, primary: null, validate: () => [],
        render: (el, _props, api) => shell(el, 'section', 'rpg-fight', ({ doc, root }) => {
            let handles = [], alive = true;
            const clear = () => {
                for (const handle of handles) handle.destroy?.();
                handles = [];
                root.replaceChildren();
            };
            const scroll = showReply ?? (index => doc.querySelector(`.mes[mesid="${index}"]`)?.scrollIntoView?.({ block: 'start' }));
            const latest = () => { try { return battleLog?.latest?.() ?? null; } catch { return null; } };

            function foeCard(parent, foe) {
                const node = h(doc, 'article', `rpg-foe ss-glass${foe.down ? ' rpg-down' : ''}`);
                node.setAttribute('data-foe', foe.name);
                parent.appendChild(node);
                const top = h(doc, 'div', 'rpg-foe-top');
                top.appendChild(h(doc, 'p', 'rpg-name', foe.count > 1 ? `${foe.name} ${fill(RPG_STRINGS.battle.count, { n: foe.count })}` : foe.name));
                const side = h(doc, 'span', 'rpg-foe-side'), edit = h(doc, 'span', 'rpg-foe-edit');
                side.append(h(doc, 'span', 'ss-pill', fill(F.class, { name: foe.className })), edit);
                top.appendChild(side);
                node.appendChild(top);
                handles.push(editable.render(edit, { value: foe.name, kind: 'text', maxLength: foe.nameMax, label: fill(F.edit, { name: foe.name }), displayValue: false,
                    command: foe.locked ? '' : 'dm.set', payload: { module: foe.module, field: `foe${foe.slot}`, ...(foe.subject ? { who: foe.subject } : {}) } }, { command: api?.command }));
                const bar = h(doc, 'div', 'rpg-foe-bar');
                node.appendChild(bar);
                handles.push(meter.render(bar, { label: F.health, value: Math.min(foe.hurt, foe.max), max: foe.max, tone: foe.tone, text: foe.down ? F.down : foe.word, segments: foe.max, icon: 'fa-heart' }, {}));
            }

            function draw() {
                if (!alive) return;
                clear();
                const state = headState(), foes = readFight(state, { roleOf }), party = readParty(state, { own: readerName(), roleOf });
                const shown = latest(), place = placeOf(state);
                const head = h(doc, 'div', 'rpg-head');
                const title = h(doc, 'div', 'rpg-fight-title');
                title.appendChild(h(doc, 'h3', '', place ? fill(F.titleAt, { place }) : F.title));
                title.appendChild(h(doc, 'p', 'rpg-fight-note', F.note));
                const pills = h(doc, 'div', 'rpg-pills');
                const rounds = shown?.model?.rounds ?? [];
                if (rounds.length) pills.appendChild(h(doc, 'span', 'ss-pill rpg-exchange', fill(F.exchange, { n: rounds.at(-1).n })));
                const total = foes.reduce((sum, foe) => sum + foe.count, 0), down = foes.reduce((sum, foe) => sum + (foe.down ? foe.count : 0), 0);
                pills.appendChild(h(doc, 'span', 'ss-pill rpg-foe-count', fill(total === 1 ? F.foesOne : F.foes, { n: total, down })));
                head.append(title, pills);
                root.appendChild(head);

                if (foes.length) {
                    root.appendChild(h(doc, 'h4', 'rpg-fight-h', F.foesHead));
                    const grid = h(doc, 'div', 'rpg-foes');
                    root.appendChild(grid);
                    for (const foe of foes) foeCard(grid, foe);
                }
                if (party.length) {
                    root.appendChild(h(doc, 'h4', 'rpg-fight-h', F.partyHead));
                    const grid = h(doc, 'div', 'rpg-fight-party');
                    root.appendChild(grid);
                    for (const character of party) {
                        const card = h(doc, 'article', `rpg-pc ss-glass${character.alive ? '' : ' rpg-fallen'}`);
                        card.setAttribute('data-character', character.name);
                        card.appendChild(h(doc, 'p', 'rpg-name', character.name));
                        drawStageBars(doc, card, character, { api: null, handles });
                        grid.appendChild(card);
                    }
                }
                if (shown?.model) {
                    const row = h(doc, 'div', 'rpg-fight-lasthead');
                    row.appendChild(h(doc, 'h4', 'rpg-fight-h', F.lastHead));
                    const go = h(doc, 'button', 'ss-button rpg-see', F.seeIt);
                    go.setAttribute('type', 'button');
                    go.addEventListener('click', () => { try { closeView(); } finally { scroll(shown.index); } });
                    row.appendChild(go);
                    root.appendChild(row);
                    const last = h(doc, 'div', 'rpg-fight-last');
                    last.appendChild(buildPanel(doc, shown.model, { folded: false, variant: 'inline', index: shown.index }));
                    root.appendChild(last);
                }
            }

            draw();
            return {
                update() { draw(); },
                destroy() { alive = false; clear(); },
            };
        }),
    };
}
