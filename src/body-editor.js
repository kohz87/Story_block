// Edit one block's current content by hand: the stored body in a textarea, checked with
// the block's own parser before it is written back into the chat.

import { formatFor } from './formats/index.js';
import { escapeBody, unescapeBody } from './formats/escape.js';

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
    const note = document.createElement('div');
    note.className = 'story-block-body-editor-note';
    note.textContent = `Edit ${def.name}. Format: ${format.rules(def)}`;
    root.appendChild(note);
    const textarea = document.createElement('textarea');
    textarea.className = 'text_pole story-block-body-editor-textarea';
    textarea.spellcheck = false;
    textarea.value = def.format === 'rows' ? String(body ?? '') : unescapeBody(body);
    root.appendChild(textarea);

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
