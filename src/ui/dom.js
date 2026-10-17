// Small DOM helpers shared by the card and the displays.
//
// Everything model- or user-written goes through textContent or text nodes. innerHTML
// is never used here: block names, labels and states are all reader/model text.

export function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '' && text !== null && text !== undefined) node.textContent = String(text);
    return node;
}

export function button(className, { text = '', title = '', icon = '' } = {}) {
    const node = el('button', className, text);
    node.type = 'button';
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    if (icon) {
        const glyph = el('i', `fa-solid ${icon}`);
        glyph.setAttribute('aria-hidden', 'true');
        node.prepend(glyph);
    }
    return node;
}

// Clicks inside the card must not reach SillyTavern's message handlers (or a host
// card's delegated listeners), which would treat them as clicks on the message.
export function stop(handler) {
    return event => {
        event.stopPropagation();
        handler(event);
    };
}

export function plural(count, word = 'item') {
    return `${count} ${count === 1 ? word : `${word}s`}`;
}

/**
 * Countable noun for a column label: "Item" -> "item"/"items", "NPC" -> "NPC"/"NPCs".
 * Only a plain capitalised word is lower-cased, so acronyms keep their spelling.
 */
export function noun(label, count = 2) {
    let word = String(label ?? '').trim() || 'item';
    if (/^[A-Z][a-z]+$/.test(word)) word = word.toLowerCase();
    return count === 1 || /s$/i.test(word) ? word : `${word}s`;
}

export function unitWord(label, count) {
    return `${count} ${noun(label, count)}`;
}

export function blockName(def) {
    return String(def?.name ?? '').trim() || 'Block';
}

/**
 * Clear `pane` and lay down what every display shares: a header (name, summary,
 * Edit), then the error / cut-off notices. Returns the header's actions element so
 * a display can add its own buttons.
 */
export function renderFrame(pane, { def, error, truncated, onEdit, display, summary = '' } = {}) {
    pane.replaceChildren();
    pane.classList.add('story-block-display', `story-block-display-${display}`);
    const name = blockName(def);

    const head = el('div', 'story-block-head');
    const titles = el('div', 'story-block-head-titles');
    titles.appendChild(el('span', 'story-block-title', name));
    if (summary) titles.appendChild(el('span', 'story-block-summary', summary));
    head.appendChild(titles);
    const actions = el('div', 'story-block-actions');
    if (typeof onEdit === 'function') {
        const edit = button('menu_button story-block-icon-button story-block-edit', { title: `Edit ${name}`, icon: 'fa-pen-to-square' });
        edit.addEventListener('click', stop(() => onEdit()));
        actions.appendChild(edit);
    }
    head.appendChild(actions);
    pane.appendChild(head);

    renderNotices(pane, { def, error, truncated });
    return actions;
}

export function renderNotices(pane, { def, error, truncated } = {}) {
    const name = blockName(def);
    if (error) {
        const text = String(error).trim().replace(/\.$/, '');
        pane.appendChild(notice('is-error', `This reply's ${name} couldn't be read: ${text}. Showing the last valid state.`));
    }
    if (truncated) {
        // Stateful blocks never take a cut-off copy; a turn block may show what arrived.
        const tail = def?.kind !== 'stateful' ? ' What arrived may be incomplete.' : ' Showing the last valid state.';
        pane.appendChild(notice('is-truncated', `This reply's ${name} was cut off before it finished.${error ? '' : tail}`));
    }
}

function notice(kind, text) {
    const node = el('div', `story-block-notice ${kind}`);
    node.setAttribute('role', 'note');
    const glyph = el('i', `fa-solid ${kind === 'is-error' ? 'fa-triangle-exclamation' : 'fa-scissors'}`);
    glyph.setAttribute('aria-hidden', 'true');
    node.append(glyph, el('span', 'story-block-notice-text', text));
    return node;
}

export function emptyText(def, state) {
    const name = blockName(def);
    return state === null || state === undefined ? `No ${name} yet.` : `${name} is empty.`;
}

export function renderEmpty(parent, text) {
    return parent.appendChild(el('div', 'story-block-empty', text));
}
