// The touch-first fight board: bars, a scrolling log and numbered choice buttons.
// It reads the staged session and calls its pure rules; only metadata holds unsent choices.
// Text is placed in DOM nodes, never interpreted as markup.

import { button, h } from '../../view/widgets/dom.js';
import { discardHeld, heldForSid } from '../../turn/held-board.js';
import { meter } from '../../view/widgets/meter.js';
import { drawStageBars } from '../view/bars.js';
import { readFoes, readParty } from '../view/party-data.js';
import { readSheet } from '../read.js';
import { planGear } from '../gear.js';
import { isStandard } from '../rules.js';
import { boardFlags } from './overrides.js';
import { boardChoices, pendingAwards, targetLabel } from './view-data.js';
import { boardSession, discardBoard, openBoard, reconcileBoard, stageExchange } from './session.js';
import { equipmentForBoard, playBoard } from './engine.js';
import { barMovement, settledNote } from './note.js';
import { dropOf } from '../ambush.js';

// Send acts on the press itself: the board may redraw between press and release (a save, a head event), which would
// lose the click on a replaced button and make the reader press twice. Fires once; a keyboard click still works.
export const pressButton = (doc, text, cls, act) => {
    const node = h(doc, 'button', cls, text);
    node.setAttribute('type', 'button');
    let fired = false;
    const fire = event => { if (fired || node.disabled) return; fired = true; event.preventDefault(); act(); };
    node.addEventListener('pointerdown', event => { if (event.button === 0 || event.pointerType === 'touch') fire(event); });
    node.addEventListener('click', fire);
    return node;
};
const signed = n => n >= 0 ? `+${n}` : String(n);
const labelLine = line => {
    const pc = line.pc ?? {}, foe = line.foe ?? {}, who = line.flee ? `${pc.who} flees` : line.kind === 'foe' ? `${foe.name} attacks ${pc.who}` : `${pc.who} → ${foe.name}`;
    const bonus = (pc.statBonus ?? 0) + (pc.classBonus ?? 0) + (pc.rank ?? 0) + (pc.edge ?? 0);
    const changes = [line.damage ? barMovement(line.damage) : '', line.cost ? barMovement(line.cost, true) : ''].filter(Boolean);
    const skill = line.skill ? ` (${line.skill})` : '';
    const verdict = `${line.kind === 'foe' ? `${pc.who}'s defence${skill}: ` : ''}${String(line.outcome).toUpperCase()}`;
    return `${who}${line.kind === 'foe' ? '' : skill}: d20 ${pc.die} ${signed(bonus)} = ${pc.total} vs ${foe.total ?? line.dc} — ${verdict}${line.decisive ? ', DECISIVE' : ''}${changes.length ? ` · ${changes.join(' · ')}` : ''}`;
};

export function createBoardView({ doc, headState, meta, save, store, rules, query, readerName, roleOf, levels, on = () => false, start = null } = {}) {
    let notice = '', chosen = [], targeting = null, confirm = false, busy = false, generation = 0, activeId = null, keyRoot = null, listening = false, lockedChoices = [];
    const releaseAfterResult = () => {
        const wait = () => setTimeout(() => {
            busy = false;
            for (const line of lockedChoices) line.disabled = false;
            lockedChoices = [];
        }, 400);
        const frame = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView);
        if (frame) frame(() => frame(wait)); else wait();
    };
    const persist = () => { try { save?.(); } catch { /* staging still works in this page */ } };
    const current = () => boardSession(meta());
    const reset = () => { chosen = []; targeting = null; confirm = false; notice = ''; };
    const equipment = state => {
        const sheet = readSheet(state), gear = planGear(sheet, (name, args) => query?.(name, args), readerName());
        const weapons = {};
        for (const [key, entry] of Object.entries(gear?.who ?? {})) for (const owner of entry.own ?? []) {
            let item = null;
            try { item = query?.('inventory.gear', { owner })?.slots?.weapon; } catch { /* no equipment */ }
            if (item && !item.broken) { weapons[key] = item; break; }
        }
        return { gear, weapons };
    };
    const fresh = (session, state) => {
        if (session.exchanges.length) return;
        const { gear, weapons } = equipment(state);
        session.setup.flags = boardFlags(state);
        session.setup.weapons = weapons;
        if (gear) session.setup.gear = gear; else delete session.setup.gear;
    };
    const snapshot = state => {
        if (!on()) return null;
        reconcileBoard(meta(), id => (store?.receipts?.() ?? []).some(entry => entry?.receipt?.id === id));
        const index = store?.headIndex?.(), sid = store?.carrierSid?.(index);
        const held = heldForSid(meta(), sid, (store?.receipts?.() ?? []).filter(entry => entry.index === index).map(entry => entry.receipt));
        const heldBoard = held?.current?.prechecks?.find(step => step.type === 'rpg.resolve' && step.payload?.board)?.payload.board;
        const session = current() ?? (heldBoard ? { ...heldBoard, origin: heldBoard.id.split(':')[0] } : null);
        if (!session) return null;
        const matched = session.anchor === sid;
        if (!held && !matched && !session.exchanges.length) return null;
        if (session.id !== activeId) { activeId = session.id; reset(); }
        if (!held) fresh(session, state);
        const played = held ? { error: meta()?.rpgFightHeldDiscarded?.[sid]
            ? 'The fight was discarded. Regenerate the held reply.'
            : 'The fight reply is waiting. Restore the sheet or gear, or discard the fight and regenerate the reply.' }
            : !matched ? { error: 'The fight no longer matches this reply. Restore the reply or discard the fight.' }
            : !isStandard(rules()) ? { error: 'The fight board needs Standard rules. Switch back to Standard or discard this fight.' }
            : playBoard(state, session.setup, session.exchanges);
        return { session, played, heldSid: held ? sid : null };
    };
    const open = ({ state = headState(), opening = null, result: approach = null } = {}) => {
        if (!on() || !isStandard(rules())) return false;
        const sid = store?.carrierSid?.(store.headIndex?.()), { gear, weapons } = equipment(state);
        const result = openBoard(meta(), state, { sid, rules: rules(), gear, weapons });
        if (result.error) return false;
        if (opening) {
            result.session.setup.opening = structuredClone(opening);
            result.session.setup.approach = structuredClone(approach?.checks ?? []);
            result.session.setup.drop = dropOf(approach);
        }
        persist(); reset();
        return true;
    };
    const offer = (root, redraw) => {
        if (!on() || !isStandard(rules())) return;
        const state = headState(), sheet = readSheet(state);
        if (!sheet.foes.some(foe => foe.filled && foe.hurt > 0)) return;
        const box = h(doc, 'div', 'rpg-board-offer ss-glass');
        box.appendChild(h(doc, 'p', '', 'Choose each exchange on the fight board, or keep telling the story.'));
        box.appendChild(button(doc, 'Fight on the board', 'ss-button ss-button-primary rpg-board-open', () => {
            if (!open()) { box.appendChild(h(doc, 'p', 'rpg-board-error', 'The fight could not be opened.')); return; }
            redraw();
        }));
        root.appendChild(box);
    };
    const render = (root, snapshot, redraw, handles, settings = {}) => {
        const { session, played, heldSid } = snapshot, thisGeneration = ++generation;
        const discard = () => { discardBoard(meta()); if (heldSid) discardHeld(meta(), heldSid); start?.discard?.(); persist(); reset(); redraw(); };
        const confirmDiscard = panel => {
            panel.appendChild(h(doc, 'p', '', 'Discard this fight and its unsent exchanges?'));
            panel.appendChild(button(doc, 'Discard fight', 'ss-button rpg-board-confirm', discard));
            panel.appendChild(button(doc, 'Cancel', 'ss-button', () => { confirm = false; redraw(); }));
        };
        if (notice) root.appendChild(h(doc, 'p', 'rpg-board-error', notice));
        if (!listening) { doc.addEventListener?.('keydown', keydown, true); listening = true; }
        keyRoot = root;
        root.classList.add('rpg-board-active');
        if (played.error) {
            root.appendChild(h(doc, 'p', 'rpg-board-error', played.error));
            const panel = h(doc, 'div', 'rpg-board-controls');
            if (confirm) confirmDiscard(panel); else panel.appendChild(button(doc, 'Discard fight', 'ss-button rpg-board-discard', () => { confirm = true; redraw(); }));
            root.appendChild(panel);
            return;
        }
        const state = played.state, { ranks, playerRank } = levels(), party = readParty(state, { own: readerName(), roleOf, ranks, playerRank }), foes = readFoes(state, { roleOf, ranks });
        const status = h(doc, 'div', 'rpg-board-status');
        status.appendChild(h(doc, 'h3', '', 'Fight'));
        const cards = h(doc, 'div', 'rpg-board-cards');
        for (const foe of foes) {
            const card = h(doc, 'article', 'rpg-foe ss-glass');
            card.appendChild(h(doc, 'p', 'rpg-name', `${foe.name} · ${foe.levelText}`));
            const slot = h(doc, 'div', 'rpg-bar-meter'); card.appendChild(slot);
            handles.push(meter.render(slot, { label: 'Health', value: foe.hurt, max: foe.max ?? 5, tone: foe.hurt ? 'warn' : 'bad', text: foe.word, segments: foe.max ?? 5 }, {}));
            cards.appendChild(card);
        }
        for (const character of party) {
            const card = h(doc, 'article', 'rpg-pc ss-glass');
            card.appendChild(h(doc, 'p', 'rpg-name', character.name));
            const bars = Object.fromEntries(Object.entries(character.bars).map(([key, bar]) => [key, { ...bar, text: bar.word }]));
            drawStageBars(doc, card, { ...character, bars }, { api: null, handles });
            cards.appendChild(card);
        }
        status.appendChild(cards);
        if (played.result.order.length) status.appendChild(h(doc, 'p', 'rpg-board-order', `Order: ${played.result.order.map(item => item.name).join(' · ')}`));
        root.appendChild(status);
        const log = h(doc, 'div', 'rpg-board-log rpg-battle');
        log.setAttribute('aria-live', 'polite');
        const history = (store?.receipts?.() ?? []).map(entry => entry.receipt?.data?.v2?.result).filter(result => result?.board?.id === session.id);
        for (const result of [...history, played.result]) {
            for (const line of result.opening ?? []) log.appendChild(h(doc, 'p', '', `Opening · ${labelLine(line)}`));
            for (const round of result.rounds ?? []) {
                log.appendChild(h(doc, 'p', 'rpg-board-round', `Exchange ${round.n}`));
                for (const line of round.lines) log.appendChild(h(doc, 'p', '', labelLine(line)));
            }
        }
        if (!log.childNodes.length) log.appendChild(h(doc, 'p', '', 'Choose an action to begin.'));
        root.appendChild(log);
        const panel = h(doc, 'div', 'rpg-board-controls');
        const gear = session.setup.gear ? equipmentForBoard(state, session.setup.gear) : {};
        const data = boardChoices(state, { ...session.setup, ...gear }, chosen), ended = played.result.stop !== 'open', sending = ended && Boolean(start?.sending?.());
        if (confirm) confirmDiscard(panel);
        else if (ended) {
            panel.appendChild(h(doc, 'h4', 'rpg-board-end', `Fight ${played.result.stop}`));
            panel.appendChild(h(doc, 'p', '', start?.waiting?.() ? 'Your waiting message carries the approach and this fight in one reply.' : 'Your next message carries this fight; the narrator tells it first.'));
            const awards = pendingAwards(state, session, played.result, settings);
            const xp = awards.xp.filter(item => item.amount > 0).map(item => `${item.who} +${item.amount} XP`).join(', ');
            const practice = awards.practice.map(item => `${item.who}: ${item.skill} +${item.amount}`).join(', ');
            panel.appendChild(h(doc, 'p', 'rpg-board-awards', `Pending XP: ${xp || 'none'}. Pending practice: ${practice || 'none'}.`));
            if (sending) panel.appendChild(h(doc, 'p', 'rpg-board-sending', 'Sending… the narrator is writing the reply.'));
            else if (start?.waiting?.()) panel.appendChild(pressButton(doc, 'Send with this fight', 'ss-button ss-button-primary rpg-board-send', () => {
                start.send(); redraw();
            }));
        } else {
            panel.appendChild(h(doc, 'p', 'rpg-board-prompt', targeting ? 'Choose a target' : `${data.actor?.who ?? 'Party'}: choose an action`));
            if (!targeting) panel.appendChild(h(doc, 'p', 'rpg-board-defence', `Defence: ${data.defence ?? 'plain defence'}, automatic`));
            const list = h(doc, 'div', 'rpg-board-choices');
            const options = targeting ? data.foes.map(foe => ({ label: targetLabel(foe), target: foe.slot })) : data.choices;
            const take = item => {
                if (busy || thisGeneration !== generation || item.reason) return;
                notice = '';
                if (targeting) { chosen.push({ ...targeting, target: item.target }); targeting = null; }
                else if (item.action.kind === 'flee') chosen = [item.action];
                else if (!item.action.area && data.foes.length > 1) targeting = item.action;
                else chosen.push({ ...item.action, ...(!item.action.area ? { target: data.foes[0]?.slot } : {}) });
                let rolled = false;
                if (!targeting && (chosen[0]?.kind === 'flee' || chosen.length === data.actors.length)) {
                    const result = stageExchange(meta(), headState(), chosen);
                    reset();
                    if (result.error) notice = result.error;
                    else { persist(); busy = true; rolled = true; }
                }
                redraw();
                if (rolled) releaseAfterResult();
            };
            options.forEach((item, at) => {
                const line = button(doc, `${at + 1}  ${item.label}${item.reason ? ` — ${item.reason}` : ''}`, 'rpg-board-choice', () => take(item));
                line.disabled = Boolean(item.reason) || busy;
                if (busy && !item.reason) lockedChoices.push(line);
                line.setAttribute('data-choice', String(at + 1)); list.appendChild(line);
            });
            panel.appendChild(list);
            if (targeting) panel.appendChild(button(doc, 'Back', 'ss-button rpg-board-back', () => { targeting = null; redraw(); }));
        }
        if (ended) panel.classList.add('rpg-board-ended');
        if (!sending) {
            const tools = h(doc, 'div', 'rpg-board-actions');
            tools.appendChild(button(doc, 'Discard fight', 'ss-button rpg-board-discard', () => { confirm = true; redraw(); }));
            panel.appendChild(tools);
        }
        const details = h(doc, 'details', 'rpg-board-note');
        details.appendChild(h(doc, 'summary', '', 'What the narrator will be told'));
        details.appendChild(h(doc, 'p', '', settledNote(played.result)));
        panel.appendChild(details);
        root.appendChild(panel);
        log.scrollTop = log.scrollHeight;
    };
    const keydown = event => {
        if (!keyRoot || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (event.key === 'Escape' && targeting) { event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); keyRoot.querySelector('.rpg-board-back')?.click(); return; }
        if (/^[1-9]$/u.test(event.key)) { const node = keyRoot.querySelector(`[data-choice="${event.key}"]`); if (node && !node.disabled) { event.preventDefault?.(); node.click(); } }
    };
    return { open, snapshot, offer, render, clear() { keyRoot = null; generation += 1; }, destroy() { keyRoot = null; doc.removeEventListener?.('keydown', keydown, true); listening = false; } };
}
