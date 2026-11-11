// The style sheets that were split into parts (glass, mounts, settings, host): one text per original name, read from
// the parts in the order host.css imports them, so a test can look for a rule without knowing which part holds it.
import { readFileSync } from 'node:fs';

const VIEW = new URL('../../../src/v2/view/', import.meta.url);
const text = name => readFileSync(new URL(name, VIEW), 'utf8');

/** host.css itself: the head comment and the @import list. */
export const hostImports = () => text('host.css');

/** The parts of `name` ('glass', 'mounts', 'settings' or 'host') joined in load order. */
export function cssOf(name) {
    const parts = [...hostImports().matchAll(/@import url\('\.\/(.+?\.css)'\);/g)].map(m => m[1]).filter(file => file.startsWith(`${name}-`));
    if (!parts.length) throw new Error(`no parts of ${name}.css`);
    return parts.map(text).join('');
}
