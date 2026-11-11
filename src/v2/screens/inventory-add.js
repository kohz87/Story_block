// The Inventory header's inline form for the reader's own items, and the folded "Worn (N)" row (gear on) that shows or hides the worn pieces.
import { STRINGS } from '../strings.js';
import { h, s as svg, shell } from '../view/widgets/dom.js';
import { editable } from '../view/widgets/editable.js';
import { addFields, addPlan } from '../view/gear-form.js';

export const INVENTORY_ADD_WIDGET = 'story-block.inventory-add';
const S = STRINGS.inventory;

export function createInventoryAddWidget() {
    return Object.freeze({
        props: {}, primary: null, validate: () => [],
        render(el, _props, api) {
            return shell(el, 'span', 'inventory-add', ({ doc, root, listen, cleanup }) => {
                const open = h(doc, 'button', 'ss-button ss-button-primary', S.addItem);
                open.setAttribute('type', 'button');
                const form = h(doc, 'span', 'inv-add-form');
                const name = h(doc, 'input', 'ss-input');
                const qty = h(doc, 'input', 'ss-input');
                const note = h(doc, 'input', 'ss-input');
                name.setAttribute('aria-label', S.itemName);
                qty.setAttribute('aria-label', S.itemCount);
                note.setAttribute('aria-label', S.itemNote);
                qty.setAttribute('type', 'number'); qty.setAttribute('min', '1'); qty.setAttribute('step', '1');
                const save = h(doc, 'button', 'ss-button ss-button-primary', S.save);
                const cancel = h(doc, 'button', 'ss-button', S.cancel);
                for (const button of [save, cancel]) button.setAttribute('type', 'button');
                const error = h(doc, 'span', 'inv-add-error'); error.setAttribute('role', 'alert');
                form.append(name, qty, note, save, cancel, error);
                root.appendChild(open);
                // Made only when a gear-on chat needs it, so the gear-off screen stays byte-for-byte as it was.
                let notice = null;
                const say = text => {
                    if (!notice) { notice = h(doc, 'span', 'inv-add-error'); notice.setAttribute('role', 'alert'); root.appendChild(notice); }
                    notice.textContent = text;
                };
                let alive = true;
                const close = () => { form.remove(); open.hidden = false; open.focus?.(); };
                // Gear in fights on (`q.gx` answers): the same grouped form as Edit (view/gear-form.js), full width under the button, in place of the inline row.
                const gearView = () => { try { return api?.resolve?.('q.gx') ?? null; } catch { return null; } };
                let gearForm = null;
                const closeGear = () => {
                    gearForm?.handle.destroy();
                    gearForm?.slot.remove();
                    gearForm = null;
                    open.hidden = false;
                    open.focus?.();
                };
                const beginGear = view => {
                    const kit = view.kit?.open === true;
                    const slot = h(doc, 'span', 'inv-add-gear');
                    root.appendChild(slot);
                    const props = { kind: 'fields', bare: true, open: true, always: true, label: S.addItem, intro: kit ? `${STRINGS.inventory.gear.form.kitHint} ${STRINGS.inventory.gear.form.kitGreeting}` : '',
                        fields: addFields({ kit, owners: view.owners }), plan: addPlan({ kit }), onClose: closeGear };
                    open.hidden = true;
                    gearForm = { slot, handle: editable.render(slot, props, api) };
                };
                cleanup(() => gearForm?.handle.destroy());
                const begin = () => {
                    if (typeof api?.command !== 'function') return;
                    const view = gearView();
                    if (view?.kit?.empty === true) { say(STRINGS.inventory.gear.form.noGreeting); return; }
                    if (notice) say('');
                    if (view && !gearForm) { beginGear(view); return; }
                    name.value = ''; qty.value = '1'; note.value = ''; error.textContent = '';
                    open.hidden = true; root.appendChild(form); name.focus?.();
                };
                const submit = async () => {
                    const amount = Number(qty.value);
                    if (!/^\d+$/.test(qty.value) || !Number.isSafeInteger(amount) || amount < 1) { error.textContent = S.countError; return; }
                    save.disabled = true;
                    let result;
                    try { result = await api.command('inventory.add', { name: name.value, qty: amount, note: note.value }); }
                    catch (failure) { result = { ok: false, message: String(failure?.message ?? failure) }; }
                    save.disabled = false;
                    if (!alive) return;
                    if (result?.ok) close(); else error.textContent = result?.message || S.addError;
                };
                listen(open, 'click', begin);
                listen(save, 'click', submit);
                listen(cancel, 'click', close);
                listen(form, 'keydown', event => {
                    if (event.key === 'Escape') { event.preventDefault?.(); close(); }
                    else if (event.key === 'Enter') { event.preventDefault?.(); submit(); }
                });
                // With Gear in fights on (the screen's `q.gx` answers) the button is the slim pill of the filter row on a phone too: the compact pill
                // (`ss-tap-pill`: about 30px drawn with a 44px tap area) in place of the 44px block every phone button is.
                const slim = () => { try { return api?.resolve?.('q.gx') != null; } catch { return false; } };
                const update = () => { open.hidden = typeof api?.command !== 'function' || gearForm !== null; if (slim()) open.classList.add('ss-tap-pill'); else open.classList.remove('ss-tap-pill'); };
                update();
                return { update, destroy() { alive = false; } };
            });
        },
    });
}

export const WORN_FOLD_WIDGET = 'story-block.worn-fold';
const G = S.gear;

/**
 * The "Worn (N)" row: a drawn chevron on the left (as the Party card's Left row), the count, and, folded, who wears how many ("Astra 5 · Sister Temiwa 1").
 * Props: `rows` (the screen's `q.gx.rows`) and `open` ('1' open, '0' closed, '' not chosen yet this view). Open or folded is the viewer's choice, per chat on this device
 * (localStorage, never game state; a storage that throws means folded); the screen's draft `wornOpen` carries it to the rows below (the template shows them while it is '1').
 */
export function createWornFoldWidget({ chatKey = () => '', storage = undefined } = {}) {
    const key = () => `story-block.inventoryWornOpen|${chatKey()}`;
    const area = () => { try { return storage === undefined ? globalThis.localStorage : storage; } catch { return null; } };
    const kept = new Map();
    const stored = () => { if (kept.has(key())) return kept.get(key()); try { return area()?.getItem?.(key()) === '1'; } catch { return false; } };
    const keep = on => { kept.set(key(), on); try { if (on) area()?.setItem?.(key(), '1'); else area()?.removeItem?.(key()); } catch { /* the choice lasts this page only */ } };
    return Object.freeze({
        props: {}, primary: null, validate: () => [],
        render(el, first, api) {
            return shell(el, 'div', 'worn-fold', ({ doc, root, listen }) => {
                let props = first ?? {};
                const draw = () => {
                    const worn = Object.values(props.rows ?? {}).filter(row => row && typeof row.place === 'string' && row.place !== '');
                    root.hidden = worn.length === 0;
                    const hadFocus = Boolean(doc.activeElement && root.contains?.(doc.activeElement));   // (the redraw replaces the button: its replacement keeps the focus)
                    root.replaceChildren();
                    if (!worn.length) return;
                    const opened = props.open === '1';
                    const by = new Map();
                    for (const row of worn) by.set(row.by, (by.get(row.by) ?? 0) + 1);
                    const button = h(doc, 'button', `worn-fold-btn${opened ? ' worn-open' : ''}`);
                    button.setAttribute('type', 'button');
                    button.setAttribute('aria-expanded', String(opened));
                    button.setAttribute('title', G.wornFoldTitle);
                    const chevron = h(doc, 'span', 'worn-chev');
                    const drawn = svg(doc, 'svg', { viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
                    drawn.appendChild(svg(doc, 'path', { d: 'M4.5 2.5 8 6l-3.5 3.5' }));
                    chevron.appendChild(drawn);
                    button.append(chevron, h(doc, 'b', '', G.wornFold.replace('{n}', String(worn.length))));
                    if (!opened) button.appendChild(h(doc, 'span', 'worn-names', [...by].map(([name, n]) => `${name} ${n}`).join(' \u00b7 ')));
                    listen(button, 'click', () => { keep(!opened); api?.draft?.set?.('wornOpen', opened ? '0' : '1'); });
                    root.appendChild(button);
                    if (hadFocus) button.focus?.();
                };
                draw();
                // Folded for the first look, unless this chat was left open on this device: the draft is filled once the draw is done.
                if (props.open === '' && stored()) Promise.resolve().then(() => api?.draft?.set?.('wornOpen', '1'));
                return { update(next) { props = next ?? {}; draw(); } };
            });
        },
    });
}
