// The touch-first fight board: bars, a scrolling log and numbered choice buttons.
// It reads the staged session and calls its pure rules; only metadata holds unsent choices.
// Text is placed in DOM nodes, never interpreted as markup.

import { h } from '../../view/widgets/dom.js';
import { meter } from '../../view/widgets/meter.js';
import { drawStageBars } from '../view/bars.js';
import { readFoes, readParty } from '../view/party-data.js';
import { readSheet } from '../read.js';
import { planGear } from '../gear.js';
import { isStandard } from '../rules.js';
import { boardFlags } from './overrides.js';
import { boardChoices, pendingAwards, targetLabel } from './view-data.js';
import { boardSession, discardBoard, openBoard, reconcileBoard, stageExchange } from './session.js';
import { playBoard } from './engine.js';
import { barMovement, settledNote } from './note.js';

const button = (doc, text, cls, click) => {
    const node = h(doc, 'button', cls, text);
    node.setAttribute('type', 'button');
    node.addEventListener('click', click);
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

export function createBoardView({ doc, headState, meta, save, store, rules, query, readerName, roleOf, levels, on = () => false } = {}) {
    let chosen = [], targeting = null, confirm = false, busy = false, generation = 0, activeId = null, keyRoot = null, listening = false, lockedChoices = [];
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
    const reset = () => { chosen = []; targeting = null; confirm = false; };
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
        if (!on() || !isStandard(rules())) return null;
        reconcileBoard(meta(), id => (store?.receipts?.() ?? []).some(entry => entry?.receipt?.id === id));
        const session = current();
        if (!session || !isStandard(session.setup?.rules) || session.anchor !== store?.carrierSid?.(store.headIndex?.())) return null;
        if (session.id !== activeId) { activeId = session.id; reset(); }
        fresh(session, state);
        return { session, played: playBoard(state, session.setup, session.exchanges) };
    };
    const offer = (root, redraw) => {
        if (!on() || !isStandard(rules())) return;
        const state = headState(), sheet = readSheet(state);
        if (!sheet.foes.some(foe => foe.filled && foe.hurt > 0)) return;
        const box = h(doc, 'div', 'rpg-board-offer ss-glass');
        box.appendChild(h(doc, 'p', '', 'Choose each exchange on the fight board, or keep telling the story.'));
        box.appendChild(button(doc, 'Fight on the board', 'ss-button ss-button-primary rpg-board-open', () => {
            if (!isStandard(rules())) return;
            const sid = store?.carrierSid?.(store.headIndex?.()), { gear, weapons } = equipment(headState());
            const result = openBoard(meta(), headState(), { sid, rules: rules(), gear, weapons });
            if (result.error) { box.appendChild(h(doc, 'p', 'rpg-board-error', result.error)); return; }
            persist(); reset(); redraw();
        }));
        root.appendChild(box);
    };
    const render = (root, snapshot, redraw, handles, settings = {}) => {
        const { session, played } = snapshot, thisGeneration = ++generation;
        if (!listening) { doc.addEventListener?.('keydown', keydown, true); listening = true; }
        keyRoot = root;
        root.classList.add('rpg-board-active');
        if (played.error) { root.appendChild(h(doc, 'p', 'rpg-board-error', played.error)); return; }
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
        const data = boardChoices(state, session.setup, chosen), ended = played.result.stop !== 'open';
        if (confirm) {
            panel.appendChild(h(doc, 'p', '', 'Discard this fight and its unsent exchanges?'));
            panel.appendChild(button(doc, 'Discard fight', 'ss-button rpg-board-confirm', () => { discardBoard(meta()); persist(); reset(); redraw(); }));
            panel.appendChild(button(doc, 'Cancel', 'ss-button', () => { confirm = false; redraw(); }));
        } else if (ended) {
            panel.appendChild(h(doc, 'h4', 'rpg-board-end', `Fight ${played.result.stop}`));
            panel.appendChild(h(doc, 'p', '', 'Your next message carries this fight; the narrator tells it first.'));
            const awards = pendingAwards(state, session, played.result, settings);
            const xp = awards.xp.filter(item => item.amount > 0).map(item => `${item.who} +${item.amount} XP`).join(', ');
            const practice = awards.practice.map(item => `${item.who}: ${item.skill} +${item.amount}`).join(', ');
            panel.appendChild(h(doc, 'p', 'rpg-board-awards', `Pending XP: ${xp || 'none'}. Pending practice: ${practice || 'none'}.`));
        } else {
            panel.appendChild(h(doc, 'p', 'rpg-board-prompt', targeting ? 'Choose a target' : `${data.actor?.who ?? 'Party'}: choose an action`));
            if (!targeting) panel.appendChild(h(doc, 'p', 'rpg-board-defence', `Defence: ${data.defence ?? 'plain defence'}, automatic`));
            const list = h(doc, 'div', 'rpg-board-choices');
            const options = targeting ? data.foes.map(foe => ({ label: targetLabel(foe), target: foe.slot })) : data.choices;
            const take = item => {
                if (busy || thisGeneration !== generation || item.reason) return;
                if (targeting) { chosen.push({ ...targeting, target: item.target }); targeting = null; }
                else if (item.action.kind === 'flee') chosen = [item.action];
                else if (!item.action.area && data.foes.length > 1) targeting = item.action;
                else chosen.push({ ...item.action, ...(!item.action.area ? { target: data.foes[0]?.slot } : {}) });
                let rolled = false;
                if (!targeting && (chosen[0]?.kind === 'flee' || chosen.length === data.actors.length)) {
                    const result = stageExchange(meta(), headState(), chosen);
                    reset();
                    if (result.error) panel.appendChild(h(doc, 'p', 'rpg-board-error', result.error));
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
        const tools = h(doc, 'div', 'rpg-board-actions');
        tools.appendChild(button(doc, 'Discard fight', 'ss-button rpg-board-discard', () => { confirm = true; redraw(); }));
        panel.appendChild(tools);
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
    return { snapshot, offer, render, clear() { keyRoot = null; generation += 1; }, destroy() { keyRoot = null; doc.removeEventListener?.('keydown', keydown, true); listening = false; } };
}
