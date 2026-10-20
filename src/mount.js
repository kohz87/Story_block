// Keeps the blocks on screen (port of Inventory Block's mount scheduling): in the sidebar,
// with an optional "This turn" strip under the latest assistant message, or as the card
// under that message. SillyTavern and other extensions re-render messages at will, so a
// MutationObserver on #chat re-mounts after any change outside our own elements.
//
// Mounting is suspended while a reply generates: the newest message is still streaming
// and blocks drawn now would show the previous reply's state under the new text.

import { mountCard, unmountCard } from './ui/card.js';
import { mountSidebar, openSidebar, unmountSidebar } from './ui/sidebar.js';
import { mountStrip, unmountStrip } from './ui/strip.js';

let buildTabs = null;
let observer = null;
let observerRetry = null;
let timer = null;
let suspended = false;

function unmountAll() {
    unmountCard(document);
    unmountSidebar();
    unmountStrip(document);
}

function mountNow() {
    if (suspended || !buildTabs) return;
    const target = buildTabs();
    if (!target?.tabs?.length) {
        unmountAll();
        return;
    }
    if (target.display === 'card') {
        unmountSidebar();
        unmountStrip(document);
        if (!target.messageElement) return unmountCard(document);
        // Only one card exists at a time: the previous reply's card goes when a new reply arrives.
        for (const card of [...document.querySelectorAll('.story-block-card')]) {
            if (!target.messageElement.contains(card)) card.remove();
        }
        mountCard(target.messageElement, target.tabs, { uiKey: target.uiKey, compatMarkup: target.compatMarkup !== false });
        return;
    }
    unmountCard(document);
    mountSidebar(target.tabs, {
        uiKey: target.uiKey,
        meta: target.meta,
        pinned: target.pinned !== false,
        onPinnedChange: target.onPinnedChange,
        onSuite: target.onSuite,
        showSuite: target.showSuite === true,
        layout: target.layout === 'rows' ? 'rows' : 'rail',
    });
    if (target.strip && target.messageElement) {
        mountStrip(target.messageElement, target.strip, { onOpen: tabId => openSidebar(tabId) });
    } else {
        unmountStrip(document);
    }
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
            return !target?.closest?.('.story-block-card, .story-block-strip');
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

/**
 * `builder()` returns null or `{ display: 'sidebar' | 'card', messageElement, tabs, uiKey, meta,
 * pinned, onPinnedChange, onSuite, showSuite, strip: items | null, compatMarkup }`.
 */
export function initializeMount(builder) {
    buildTabs = builder;
    ensureObserver();
    scheduleMount(0);
}
