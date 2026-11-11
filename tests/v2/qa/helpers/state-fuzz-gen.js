// QA fuzz helper: the seeded generators of state-fuzz (item/place/people lists, change lines, reply
// texts, UI commands) and the bonus-paid counter. Split out of state-fuzz-run.js to keep files small.
// Not a test file (the test glob does not match helpers/).
import { readRecord } from '../../../../src/v2/persist.js';
import { carriers, rebuildAt } from './oracle.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';

const ITEMS = ['Rope', 'Lamp', 'Moonveil Trout', 'Iron Key', 'Apple', 'Torch'];
const PLACES = ['Bluewatch Village', 'The Weir', 'Old Mill'];
const PEOPLE = ['Fenna', 'Kael', 'Lyra'];
const WORDS = ['ember', 'frost', 'gale', 'stone', 'tide'];
const MOUNTS = ['Grey Mare', 'Burr', 'Old Flea', 'Pia', 'Tansy', 'Rook', 'Dune', 'Wren'];

export function changeLine(r) {
    switch (r.int(0, 11)) {
        case 0: case 1: return `+ item ${r.pick(ITEMS)} | qty: ${r.int(1, 3)}`;
        case 2: return `- item ${r.pick(ITEMS)} | qty: ${r.int(1, 2)}`;
        case 3: return `~ item ${r.pick(ITEMS)} | note: ${r.pick(WORDS)}-marked`;
        case 4: return `+ coin ${r.int(1, 20)} | from: ${r.pick(PEOPLE)}`;
        case 5: return `- coin ${r.int(1, 12)} | to: ${r.pick(PEOPLE)}`;
        case 6: return `~ place ${r.pick(PLACES)} | kind: settlement`;
        case 7: return `${r.pick(['+', '-'])} present ${r.pick(PEOPLE)}`;
        case 8: return `! probe ${r.pick(WORDS)}`;
        case 9: return r.pick(['+ dragon Smaug', 'not a change line', '* - item', '~ wound Ren — a scratch']);
        // A story check line (`? roll`, checks/line.js): a die the reply was not offered, a name nobody has, a skill the sheet lacks, or a stat of Astra's: read, refused or worked, never skipped silently.
        case 10: { const line = `? roll ${r.pick(['Astra', 'Astra', 'Nobody', 'Fenna'])} | ${r.pick(['str', 'cha', 'Cut', 'juggling'])} | ${r.pick(['easy', 'normal', 'hard', 'very hard', 'bogus'])} | ${r.int(1, 20)}`; return process.env.QA_NO_CHECKLINE ? '! probe quiet' : line; }
        // Loot to pick from (story-block.loot): laid out by the reply, taken by a ui burst below.
        default: return r.chance(0.5) ? `+ item ${r.pick(ITEMS)}` : `? loot ${r.pick(ITEMS)}, ${r.pick(ITEMS)} x${r.int(1, 3)} — ${r.pick(PLACES)}`;
    }
}

export function replyText(r, step) {
    const story = `Reply of step ${step}: the story goes on.`;
    if (r.chance(0.2)) return story;
    const lines = Array.from({ length: r.int(1, 5) }, () => changeLine(r));
    // The weather (MODULES §F120), by step so the seeds draw the same chats.
    if (step % 6 === 4) lines.push(`~ weather ${WORDS[step % WORDS.length]} and rain`);
    // The party's mounts (story-block.mounts), by step too: a few rows come, change and go, and the cap of six is reached now and then.
    if (step % 5 === 2) lines.push(`${['+', '+', '~', '-'][step % 4]} mount ${MOUNTS[step % MOUNTS.length]} | kind: ${['horse', 'mule', 'cart'][step % 3]} | condition: ${WORDS[step % WORDS.length]}`);
    // Your look (MODULES §F126), by step too: all three parts, one part, or a part cleared.
    if (step % 7 === 2) lines.push(`~ you rank: ${WORDS[(step + 1) % WORDS.length]} rank | wearing: ${WORDS[step % WORDS.length]} cloak | condition: ${WORDS[(step + 2) % WORDS.length]}-worn`);
    else if (step % 5 === 3) lines.push(`~ you condition: step ${step} chilled`);
    else if (step % 9 === 4) lines.push(step % 2 ? '~ you rank:' : `~ you rank: step ${step} novice`);
    else if (step % 11 === 6) lines.push(step % 2 ? '~ you wearing:' : `~ you wearing: step ${step} boots | condition:`);
    if (r.chance(0.1)) return `${story}\n<Changes>\n${lines[0]}\n</Changes>\nMore story.\n<Changes>\n${lines.slice(1).join('\n')}\n</Changes>`;
    return `${story}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
}

// A UI command the reader could press now: [type, payload].
export function uiCommand(r, host) {
    const head = host.head();
    const stacks = Object.values(head?.domains?.inventory?.stacks ?? {})
        .sort((a, b) => (a.def + a.qty + a.note < b.def + b.qty + b.note ? -1 : 1));
    const choices = [
        ['probe.tick', {}],
        ['probe.pay', {}],
        ['probe.broken', {}],
        ['wallet.pay', { owner: 'party', amount: r.int(1, 8) }],
        ['wallet.receive', { owner: 'party', amount: r.int(1, 4) }],
    ];
    if (stacks.length) {
        const stack = r.pick(stacks);
        choices.push(['inventory.drop', { stack: stack.id, qty: r.int(1, 2) }]);
        if (stack.qty >= 2) choices.push(['inventory.split', { stack: stack.id, qty: 1 }]);
        const twin = stacks.find(other => other !== stack && other.def === stack.def);
        if (twin) choices.push(['inventory.merge', { stack: stack.id, into: twin.id }]);
    }
    // The reader's own gear (gear on, docs/v2/GEAR.md "Your own gear"): add with kind, slot, rarity, bonus and Equip on, and the Edit of kind, slot, rarity and bonus, kit open or not.
    const GEAR_NAMES = ['Wolfskin Cap', 'Lucky Bone', 'Oak Shield', 'Rope', 'Torch'];
    choices.push(['inventory.add', { name: r.pick(GEAR_NAMES), qty: r.int(1, 2), kind: r.pick(['equipment', 'equipment', 'goods', 'consumable']), slot: r.pick(['head', 'weapon', 'accessory-1', 'accessory-2', '', 'bogus']),
        rarity: r.pick(['common', 'rare', 'legendary', 'mythic']), stats: r.pick([{}, { VIT: 1 }, { STR: 2, DEX: 2 }, { WIS: 1 }, { STR: 1, DEX: 1, INT: 1 }]), ...(r.chance(0.4) ? { equip: 'party' } : {}) }]);
    if (stacks.length) {
        const stack = r.pick(stacks);
        choices.push(['inventory.edit', { stack: stack.id, group: true, kind: r.pick(['equipment', 'goods', 'quest']), slot: r.pick(['head', 'body', '', 'bogus']), rarity: r.pick(['common', 'epic']), stats: r.pick([{}, { AGI: 1 }, { LUK: 3 }]) }]);
    }
    // Kind = Equipment on a name the chat already has as something else (inventory.js `remakeAsEquipment`): the reader's own item is remade, anything else refused. A whole stack
    // is dropped now and then first (a burst of 1 to 3 commands often does both), so the definition is left with no stack.
    const loose = Object.values(head?.domains?.inventory?.defs ?? {}).filter(def => def.id.startsWith('story/') && def.kind !== 'equipment').sort((a, b) => (a.id < b.id ? -1 : 1));
    if (loose.length) {
        const def = r.pick(loose);
        choices.push(['inventory.add', { name: def.name, qty: 1, kind: 'equipment', slot: r.pick(['head', 'weapon', 'accessory-1', '']), ...(r.chance(0.4) ? { equip: 'party' } : {}) }]);
        const own = stacks.find(stack => stack.def === def.id);
        if (own) choices.push(['inventory.drop', { stack: own.id, qty: own.qty }]);
    }
    choices.push(['inventory.drop', { stack: 'it_00000000', qty: 1 }]);
    // A skill rename's flag carry (rpg.boardSkillCarry, no feature gate): a real skill of the sheet when there is one, else a name the sheet lacks (refused).
    const actor = readSheet(head ?? {}).characters?.find(entry => entry.skills?.length);
    const skill = actor && r.pick(actor.skills);
    choices.push(['rpg.boardSkillCarry', skill ? { module: actor.module, slot: skill.slot, from: r.pick(['Old Name', skill.name]), name: skill.name } : { module: 'fuzz-hero', slot: 1, from: 'Old Name', name: 'New Name' }]);
    const offers = Object.keys(head?.domains?.inventory?.loot ?? {}).sort();
    if (offers.length) choices.push(['inventory.lootTake', { sid: r.pick(offers), pick: [0, r.int(0, 1)] }]);
    return r.pick(choices);
}

export function bonusPaidOnLine(host) {
    // A skipped block takes only its own receipts with it (store.js replays block by block). The
    // store reports the blocks skipped since the latest checkpoint; the oracle finds the older ones.
    const chat = host.ctx.chat;
    const skipped = new Set();
    // One rebuild per checkpoint segment: at the carrier before each later checkpoint, and at the head.
    const list = carriers(chat);
    const ends = list.filter((index, at) => at === list.length - 1 || readRecord(chat[list[at + 1]])?.checkpoint);
    for (const index of ends) {
        for (const entry of rebuildAt(chat, index).skipped) for (const rev of entry.revs) skipped.add(`${entry.index}:${rev}`);
    }
    let paid = 0;
    for (const index of carriers(chat)) {
        const record = readRecord(chat[index]);
        paid += (record?.receipts ?? []).filter(receipt => receipt.type === 'probe.pay' && !skipped.has(`${index}:${receipt.rev}`)).length;
    }
    return paid;
}
