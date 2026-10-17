// Keeps the card mounted under the latest assistant message (port of Inventory Block's
// mount scheduling). SillyTavern and other extensions re-render messages at will, so a
// MutationObserver on #chat re-mounts after any change outside the card itself.
//
// Mounting is suspended while a reply generates: the newest message is still streaming
// and a card drawn now would show the previous reply's blocks under the new text.

import { mountCard, unmountCard } from './ui/card.js';

let buildTabs = null;
let observer = null;
let observerRetry = null;
let timer = null;
let suspended = false;

function mountNow() {
    if (suspended || !buildTabs) return;
    const target = buildTabs();
    if (!target?.messageElement || !target.tabs?.length) {
        unmountCard(document);
        return;
    }
    // Only one card exists at a time: the previous reply's card goes when a new reply arrives.
    for (const card of [...document.querySelectorAll('.story-block-card')]) {
        if (!target.messageElement.contains(card)) card.remove();
    }
    mountCard(target.messageElement, target.tabs, { uiKey: target.uiKey, compatMarkup: target.compatMarkup !== false });
}

function ensureObserver() {
    const chat = document.querySelector('#chat');
    if (!chat || typeof MutationObserver !== 'function') {
        if (!chat && !observerRetry) {
            observerRetry = setTimeout(() => {
                observerRetry = null;
                ensureObserver();
                scheduleMount(0);
            }, 250);
        }
        return;
    }
    if (observer?.storyBlockChat === chat) return;
    observer?.disconnect();
    observer = new MutationObserver(mutations => {
        const relevant = mutations.some(mutation => {
            const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
            return !target?.closest?.('.story-block-card');
        });
        if (relevant) scheduleMount(60);
    });
    observer.storyBlockChat = chat;
    observer.observe(chat, { childList: true, subtree: true });
}

export function scheduleMount(delay = 30) {
    ensureObserver();
    if (suspended) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        mountNow();
    }, delay);
}

export function setMountSuspended(value) {
    const next = Boolean(value);
    if (suspended === next) return;
    suspended = next;
    if (suspended) {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
    }
    scheduleMount(0);
}

/** `builder()` returns `{ messageElement, tabs, uiKey, compatMarkup }` or null. */
export function initializeMount(builder) {
    buildTabs = builder;
    ensureObserver();
    scheduleMount(0);
}
