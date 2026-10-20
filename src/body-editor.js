// Edit one block's current content by hand: the stored body in a textarea, checked with
// the block's own parser before it is written back into the chat.

import { formatFor } from './formats/index.js';
import { escapeBody, unescapeBody } from './formats/escape.js';
import { sceneHeaderFields, setSceneHeaderField } from './scene.js';
import { el as element } from './ui/dom.js';

const SCENE_FIELDS = [
    { key: 'time', label: 'Time' },
    { key: 'location', label: 'Location' },
    { key: 'weather', label: 'Weather' },
];

// A scene board's header (time, place, weather) as inputs above the text: the edits most
// often made by hand, without hunting for them in the markup. Each writes into the text.
function sceneFields(textarea) {
    const present = sceneHeaderFields(textarea.value);
    const fields = SCENE_FIELDS.filter(field => field.key in present);
    if (!fields.length) return null;
    const wrap = element('div', 'story-block-body-editor-fields');
    const inputs = new Map();
    for (const field of fields) {
        const label = element('label', 'story-block-body-editor-field');
        const input = element('input', 'text_pole story-block-body-editor-input');
        input.type = 'text';
        input.value = present[field.key];
        input.dataset.field = field.key;
        input.addEventListener('input', () => {
            textarea.value = setSceneHeaderField(textarea.value, field.key, input.value);
        });
        label.append(element('span', 'story-block-body-editor-field-label', field.label), input);
        wrap.appendChild(label);
        inputs.set(field.key, input);
    }
    // Typing in the text keeps the inputs in step (but never overwrites the one being typed in).
    textarea.addEventListener('input', () => {
        const now = sceneHeaderFields(textarea.value);
        for (const [key, input] of inputs) {
            if (document.activeElement !== input && key in now) input.value = now[key];
        }
    });
    return wrap;
}

function toastError(error) {
    globalThis.toastr?.error?.(error instanceof Error ? error.message : String(error), 'Story Block');
}

/**
 * Opens SillyTavern's popup with `body` (stored, escaped text) as editable text.
 * Resolves true once `onSave(newBody)` succeeded, false when cancelled.
 * Rows keep their own backslash escapes visible (they are part of the row syntax);
 * the other formats are shown unescaped and escaped again on save.
 */
export async function openBodyEditor(context, def, body, { onSave } = {}) {
    if (!context?.Popup || !context?.POPUP_TYPE) {
        toastError(new Error('Editing needs SillyTavern\'s Popup API, which this SillyTavern version does not provide.'));
        return false;
    }
    const format = formatFor(def);
    const root = document.createElement('div');
    root.className = 'story-block-body-editor';
    root.appendChild(element('div', 'story-block-body-editor-title', `Edit ${def.name}`));
    root.appendChild(element('div', 'story-block-body-editor-note', 'The block as it stands now. It is checked before it is saved into the latest reply; the next reply carries on from it.'));
    const textarea = document.createElement('textarea');
    textarea.className = 'text_pole story-block-body-editor-textarea';
    textarea.spellcheck = false;
    textarea.value = def.format === 'rows' ? String(body ?? '') : unescapeBody(body);
    const fields = def.display === 'scene' ? sceneFields(textarea) : null;
    if (fields) root.appendChild(fields);
    root.appendChild(textarea);
    // How the block is written, for reference, folded away: it is the model's instruction.
    const help = element('details', 'story-block-body-editor-help');
    help.append(element('summary', '', 'How this block is written'), element('div', 'story-block-body-editor-rules', format.rules(def)));
    root.appendChild(help);

    let saved = false;
    const popup = new context.Popup(root, context.POPUP_TYPE.CONFIRM, '', {
        okButton: `Save ${def.name}`,
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClosing: async closing => {
            if (closing.result !== context.POPUP_RESULT?.AFFIRMATIVE) return true;
            try {
                // Parsers read stored (escaped) text; only rows show that text as-is.
                const raw = def.format === 'rows' ? textarea.value : escapeBody(textarea.value, def.tag);
                const parsed = format.parse(raw, def);
                if (!parsed.ok) throw new Error(parsed.error);
                // Re-serialize through the parser so what lands in the chat is canonical.
                await onSave?.(format.serialize(parsed.state, def));
                saved = true;
                return true;
            } catch (error) {
                toastError(error);
                return false;
            }
        },
    });
    await popup.show();
    return saved;
}
