// An inline reader edit. The value is displayed as text; saving sends one ordinary UI command.
import { oneLine } from '../../../text.js';
import { STRINGS, fill } from '../../strings.js';
import { h, iconNode, shell } from './dom.js';
import { defineWidget, resolveProps } from './props.js';

const E = STRINGS.editable;
const props = {
    value: { type: 'any', default: '' },
    kind: { type: 'string', default: 'text' },
    min: { type: 'number', default: null },
    max: { type: 'number', default: null },
    maxLength: { type: 'number', default: 240 },
    options: { type: 'array', default: Object.freeze([]) },
    label: { type: 'string', default: '' },
    command: { type: 'string', default: '' },
    payload: { type: 'object', default: Object.freeze({}) },
    valueKey: { type: 'string', default: 'value' },
};
const cut = (value, max) => [...oneLine(value)].slice(0, Math.max(0, Math.floor(max))).join('');

function render(el, input, api) {
    return shell(el, 'span', 'editable', ({ doc, root, listen }) => {
        const shown = h(doc, 'span', 'ss-w-editable-value');
        const pencil = h(doc, 'button', 'ss-iconbutton ss-w-editable-pencil');
        pencil.setAttribute('type', 'button');
        const glyph = iconNode(doc, 'ph-pencil-simple');
        if (glyph) pencil.appendChild(glyph);
        const form = h(doc, 'span', 'ss-w-editable-form');
        const chips = h(doc, 'span', 'ss-w-editable-chips');
        const fieldSlot = h(doc, 'span', 'ss-w-editable-field');
        const add = h(doc, 'button', 'ss-button ss-w-editable-add', E.add);
        const save = h(doc, 'button', 'ss-button ss-button-primary ss-w-editable-save', E.save);
        const cancel = h(doc, 'button', 'ss-button ss-w-editable-cancel', E.cancel);
        for (const button of [add, save, cancel]) button.setAttribute('type', 'button');
        const error = h(doc, 'span', 'ss-w-editable-error');
        error.setAttribute('role', 'alert');
        form.append(chips, fieldSlot, add, save, cancel, error);
        root.append(shown, pencil, form);
        let p = resolveProps(props, input);
        let field = null;
        let entries = [];
        let editing = false;
        let busy = false;
        let alive = true;

        function drawChips() {
            chips.replaceChildren(...entries.map((value, index) => {
                const chip = h(doc, 'span', 'ss-chip');
                const name = h(doc, 'span', '', value);
                const remove = h(doc, 'button', 'ss-w-editable-remove', '×');
                remove.setAttribute('type', 'button');
                remove.setAttribute('aria-label', fill(E.remove, { value }));
                remove.setAttribute('data-index', String(index));
                chip.append(name, remove);
                return chip;
            }));
        }

        function draw() {
            const list = p.kind === 'list';
            const value = list && Array.isArray(p.value) ? p.value.join(', ') : String(p.value ?? '');
            shown.textContent = value;
            pencil.hidden = editing || !p.command || typeof api?.command !== 'function';
            pencil.setAttribute('aria-label', fill(E.edit, { label: p.label || E.value }));
            pencil.setAttribute('title', fill(E.edit, { label: p.label || E.value }));
            shown.hidden = editing;
            form.hidden = !editing;
        }

        function open() {
            if (!p.command || typeof api?.command !== 'function') return;
            editing = true;
            error.textContent = '';
            entries = Array.isArray(p.value) ? p.value.map(String) : [];
            const choice = p.kind === 'choice';
            field = h(doc, choice ? 'select' : 'input', choice ? 'ss-select' : 'ss-input');
            field.setAttribute('aria-label', p.label || E.value);
            if (!choice) {
                field.setAttribute('type', p.kind === 'number' ? 'number' : 'text');
                if (p.kind === 'number') {
                    field.setAttribute('step', '1');
                    if (p.min !== null) field.setAttribute('min', String(p.min));
                    if (p.max !== null) field.setAttribute('max', String(p.max));
                }
            }
            if (choice) for (const item of p.options) {
                const value = typeof item === 'object' && item !== null ? item.value : item;
                const label = typeof item === 'object' && item !== null ? (item.label ?? value) : item;
                const option = h(doc, 'option', '', label);
                option.value = String(value ?? '');
                field.appendChild(option);
            }
            field.value = p.kind === 'list' ? '' : String(p.value ?? '');
            fieldSlot.replaceChildren(field);
            chips.hidden = p.kind !== 'list';
            add.hidden = p.kind !== 'list';
            drawChips();
            draw();
            field.focus?.();
        }

        function close() {
            editing = false;
            draw();
            pencil.focus?.();
        }
        function addEntry() {
            const value = cut(field?.value, p.maxLength);
            if (value) entries.push(value);
            if (field) field.value = '';
            drawChips();
        }
        async function submit() {
            if (busy || !field) return;
            let value;
            if (p.kind === 'number') {
                const raw = String(field.value).trim();
                if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) { error.textContent = E.wholeNumber; return; }
                value = Number(raw);
                if (p.min !== null) value = Math.max(p.min, value);
                if (p.max !== null) value = Math.min(p.max, value);
                field.value = String(value);
            } else if (p.kind === 'list') {
                addEntry();
                value = [...entries];
            } else value = cut(field.value, p.maxLength);
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(p.valueKey) || ['constructor', 'prototype', '__proto__'].includes(p.valueKey)) return;
            busy = true;
            save.disabled = true;
            let result;
            try { result = await api.command(p.command, { ...p.payload, [p.valueKey]: value }); }
            catch (failure) { result = { ok: false, message: String(failure?.message ?? failure) }; }
            busy = false;
            save.disabled = false;
            if (!alive) return;
            if (result?.ok) close();
            else error.textContent = result?.message || E.failed;
        }
        listen(chips, 'click', event => {
            const index = Number(event.target?.getAttribute?.('data-index'));
            if (event.target?.getAttribute?.('data-index') !== null && Number.isInteger(index)) { entries.splice(index, 1); drawChips(); }
        });
        listen(pencil, 'click', open);
        listen(add, 'click', addEntry);
        listen(save, 'click', submit);
        listen(cancel, 'click', close);
        listen(form, 'input', event => {
            if (event.target !== field || p.kind !== 'number' || !/^-?\d+$/.test(field.value)) return;
            let value = Number(field.value);
            if (!Number.isSafeInteger(value)) return;
            if (p.min !== null) value = Math.max(p.min, value);
            if (p.max !== null) value = Math.min(p.max, value);
            field.value = String(value);
        });
        listen(form, 'keydown', event => {
            if (event.key === 'Escape') { event.preventDefault?.(); close(); }
            else if (event.key === 'Enter') { event.preventDefault?.(); submit(); }
        });
        function update(next) { p = resolveProps(props, next); draw(); }
        update(input);
        return { update, destroy() { alive = false; } };
    });
}

export const editable = defineWidget({ props, primary: 'value', render });
