// The state the gear screens' tests draw: a chat with worn pieces, a bag and a few goods, built by story lines (so it is the same for the gear-on and the
// gear-off host), and a serialiser for the rendered screen (tag, class, attributes and text, no ids that change from run to run).
import { createHost } from '../../../testkit/index.js';

export const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// A rules module of the kind part 2 is: it wears the piece in a slot from a story line (`~ hit weapon 1`).
export const FIGHT = {
    id: 'zz-fight', name: 'zz fight', version: '0.0.0',
    capture: {
        kinds: { hit: { grammar: '~ hit <slot> <steps>' } },
        apply(ctx, change) {
            const [slot, steps] = change.name.split(' ');
            return ctx.call('gear.wear', { owner: 'party', slot, steps: Number(steps ?? 1) });
        },
    },
};

export const LINES = [
    '+ item Iron Cap | rarity: uncommon | slot: head | equipped: head',
    '+ item Boiled Leather Jerkin | equipped: body',
    '+ item Cane Sword | rarity: rare | equipped: weapon',
    '+ item Oak Buckler | rarity: uncommon | equipped: off-hand',
    '+ item Moss-Agate Ring | rarity: uncommon | equipped: accessory',
    '+ item Healing Salve | qty: 2',
    '+ item Sealed Letter | note: For the Guild Office clerk',
];

/** A host with these things; `gear` switches the feature on (with the RPG), `wear` runs the fight lines after. */
export async function gearHost(t, { gear = true, wear = ['~ hit body 2', '~ hit weapon 1', '~ hit off-hand 3'], extra = [] } = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [FIGHT], settings: gear ? { features: { 'story-block.gear': true, 'story-block.rpg': true } } : {} });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Loot.', reply('Gear.', [...LINES, ...extra]));
    if (wear.length && gear) await host.send('Fight.', reply('A blow.', wear));
    return host;
}

/** A rendered element as text: `<tag class attrs style>children</tag>`, attributes sorted, the generated ids and payloads left out. */
export function dump(node) {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    const tag = node.tagName.toLowerCase();
    const attrs = Object.keys(node.attributes ?? {}).sort().filter(name => !/^(id|aria-controls|data-ss-id)$/.test(name)).map(name => `${name}="${node.attributes[name]}"`);
    const style = Object.keys(node.styleProps ?? {}).sort().map(name => `${name}:${node.styleProps[name]}`).join(';');
    const classes = node.classes().sort().join(' ');
    return `<${tag}${classes ? ` class="${classes}"` : ''}${attrs.length ? ` ${attrs.join(' ')}` : ''}${style ? ` style="${style}"` : ''}>${node.childNodes.map(dump).join('')}</${tag}>`;
}
