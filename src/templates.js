// Built-in templates. They are ordinary block definitions: the reader can edit,
// duplicate, disable or delete them, and "Reset to default" restores the copy here.

import { normalizeBlock } from './schema.js';

export const TEMPLATES = [
    {
        id: 'inventory',
        template: 'inventory',
        name: 'Inventory',
        icon: '🎒',
        short: 'Items',
        tag: 'Inventory',
        enabled: true,
        visible: true,
        kind: 'stateful',
        format: 'rows',
        display: 'tree',
        columns: ['Item', 'Qty', 'Note'],
        maxDepth: 3,
        prompt: [
            "Everything {{user}}'s party owns or carries: items, money, gear and supplies.",
            'Apply only gains, losses, transfers, spending, consumption and equipment changes that this reply actually completes. Planned, attempted, interrupted, hypothetical or uncertain changes do not count; when a change cannot be worked out safely, keep the previous value instead of guessing. Never create a negative balance.',
            // (0.9.15) Rewritten each reply, an unchanged note drifted ("heal 20" became "weak restorative fluid").
            'Copy every row this reply does not change exactly as it was, note included, word for word; when only the quantity changes, keep the note. Numbers and tags in a note (heal 20, uncommon · ATK +4) are rules: never reword them.',
        ].join('\n'),
        when: { mode: 'always' },
    },
    {
        // Megumin Suite's World State layout (GPL-3.0), kept label for label: NPC State Delta
        // and Megumin's own readers parse these labels, so a chat can move between them.
        id: 'world-state',
        template: 'world-state',
        name: 'World State',
        icon: '📌',
        short: 'World',
        tag: 'World_State',
        enabled: false,
        visible: true,
        kind: 'stateful',
        format: 'text',
        display: 'scene',
        prompt: [
            'The scene as a camera would see it right now: when and where, who is present and how they look, plus what is happening off-screen and what is still unresolved.',
            'Describe only the present scene and people the story has established. Moods and positions follow this reply; outfits change only when the story changes them. A Secret is something {{user}} does not know. Drop threads once they resolve.',
        ].join('\n'),
        layout: [
            '**📅 Time:** [Year, Month Day, time of day] | **🌤 Loc:** [Place | Region] | **🌡 Wx:** [Weather, Temp, Lighting]',
            '',
            '---',
            '',
            '**🧍 {{user}}:**',
            '* *Outfit:* [Current clothing, accessories, state of dress]',
            '* *Position:* [Posture, where in the space]',
            '* *Visible Condition:* [Injuries, exhaustion, anything a camera would catch]',
            '* *Carrying:* [What is in their hands, pockets or bag, if known]',
            '',
            '---',
            '',
            '**👥 NPCs Present:**',
            '**[NPC Name]:**',
            '* *Outfit:* [Current clothing]',
            '* *Position:* [Where in the space, posture, what they are doing]',
            '* *Mood:* [Current visible emotional surface]',
            '* *Agenda:* [What they want right now in this scene]',
            '* *Secret:* [What they know or want that {{user}} does not]',
            '',
            '*[Repeat for each NPC currently in the scene]*',
            '',
            '---',
            '**📡 Off-Screen:**',
            '* [NPC Name] [What they are plausibly doing right now, and where]',
            '',
            '---',
            '**🔥 Unresolved Threads:**',
            '* [Active tension, unanswered question or simmering conflict, one line each, 3–5 at most]',
            '**🌱 Planted Seeds:** [Foreshadowing and what it hints at, turns since planted]',
            '**⏳ Consequence Timers:** [Action or inaction, expected ripple, turns remaining]',
            '**🎯 Arc Phase:** [Setup / Escalation / Complication / Crisis / Resolution]',
            '**🎬 Scene Phase:** [Early Simmer / Building / Midpoint Tension / Climax / Breather]',
        ].join('\n'),
        when: { mode: 'always' },
    },
    {
        id: 'choices',
        template: 'choices',
        name: 'Choices',
        icon: '🎲',
        short: 'Choices',
        tag: 'CYOA',
        enabled: false,
        visible: true,
        kind: 'turn',
        format: 'text',
        display: 'choices',
        prompt: [
            'Four actions {{user}} could take next, written as things {{user}} does, under 15 words each, never decided for them.',
            'Make them this story\'s choices, not generic ones: fit {{user}}\'s persona, abilities and relationships, {{char}}\'s personality, and the setting\'s rules and lore as established above. At least one should use something specific already in play — a person, an item, a rumour, a place, an unresolved thread. Each points a different way (talk, act, investigate, leave…), and none repeats an option from the last reply.',
        ].join('\n'),
        layout: '1. [Short suggestion]\n2. [Short suggestion]\n3. [Short suggestion]\n4. [Short suggestion]',
        when: { mode: 'always' },
    },
    {
        // Megumin Suite's dice (GPL-3.0): the extension rolls, the model only decides whether
        // an attempt needs a roll and how hard it is, and writes the roll line before the scene.
        id: 'dice',
        template: 'dice',
        name: 'Dice',
        icon: '🎲',
        short: 'Dice',
        tag: 'Dice',
        enabled: false,
        visible: true,
        optional: true,
        repeating: true,
        kind: 'lead',
        format: 'text',
        display: 'dice',
        rolls: { count: 3, sides: 20 },
        prompt: `The die is rolled for you before the scene is written, and the scene answers it.\n- This reply's rolls, in order: {{rolls}}. Take them in order, one per attempt. Never invent a number, never reuse one, never swap one because it suits the scene. Decide whether an attempt needs a roll before you read the list; when the list runs out, there are no more rolls this reply.\n- Gate: roll only when {{user}} attempts something that can fail at real cost; one roll per attempt; never roll on what {{user}} feels, wants or decides.\n- Difficulty, fixed from the task and its opposition before you read the roll, never from what the scene wants: 5 trivial · 10 easy · 15 ordinary · 20 hard · 25 very hard · 30 near-impossible. Modifier −3 to +3, only from competence already established on the page.\n- Read: total ≥ DC → success · DC−1 or DC−2 → success, at a cost · DC−3 or lower → fail, and the world moves · natural 20 → more than asked · natural 1 → fail, and it takes something.\n- Failure is a scene, not a wall: later, poorer, seen, hurt, or holding a worse version of what they wanted. No reset, no rescue in the same beat. A retry is a new attempt at a higher difficulty.\n- One line per roll: 🎲 attempt — d20+N vs DC → roll+N = total · verdict. Nothing else in the block, and no numbers, dice or luck anywhere in the story.`,
        layout: '🎲 [attempt] — d20+[N] vs [DC] → [roll]+[N] = [total] · [verdict]',
        when: { mode: 'always' },
    },
    {
        id: 'dice-everyone',
        template: 'dice-everyone',
        name: 'Dice: Everyone',
        icon: '🎲',
        short: 'Dice',
        tag: 'Dice_All',
        enabled: false,
        visible: true,
        optional: true,
        repeating: true,
        kind: 'lead',
        format: 'text',
        display: 'dice',
        rolls: { count: 6, sides: 20 },
        prompt: `The die is rolled for you before the scene is written, and the scene answers it.\n- This reply's rolls, in order: {{rolls}}. Take them in order, one per attempt, whoever makes it. Never invent a number, never reuse one, never swap one because it suits the scene. Decide whether an attempt needs a roll before you read the list; when the list runs out, there are no more rolls this reply.\n- Gate: roll for anyone who attempts something that can fail at real cost — {{user}}, an NPC in the scene, anyone acting; one roll per attempt; never roll on what a character feels, wants or decides, and not for background business nobody is watching.\n- Difficulty, fixed from the task and its opposition before you read the roll, never from what the scene wants: 5 trivial · 10 easy · 15 ordinary · 20 hard · 25 very hard · 30 near-impossible. Modifier −3 to +3, only from competence already established on the page.\n- Read: total ≥ DC → success · DC−1 or DC−2 → success, at a cost · DC−3 or lower → fail, and the world moves · natural 20 → more than asked · natural 1 → fail, and it takes something.\n- Failure is a scene, not a wall: later, poorer, seen, hurt, or holding a worse version of what they wanted. No reset, no rescue in the same beat. A retry is a new attempt at a higher difficulty.\n- One line per roll: 🎲 who does what — d20+N vs DC → roll+N = total · verdict. Nothing else in the block, and no numbers, dice or luck anywhere in the story.`,
        layout: '🎲 [who does what] — d20+[N] vs [DC] → [roll]+[N] = [total] · [verdict]\n[one line per roll, every roll of this reply]',
        when: { mode: 'always' },
    },
    {
        // Megumin Suite's NPC Inner Chatter (GPL-3.0), with instructions that ground each voice
        // in what the story has established. NPC State Delta reads this tag as evidence.
        id: 'inner-chatter',
        template: 'inner-chatter',
        name: 'NPC Inner Chatter',
        icon: '💭',
        short: 'Chatter',
        tag: 'NPC_Inner_Chatter',
        enabled: false,
        visible: true,
        optional: true,
        kind: 'turn',
        format: 'text',
        display: 'chatter',
        prompt: [
            'What the NPCs in this scene think and say where {{user}} cannot hear: the layer under their public faces.',
            'Two or more NPCs present: a few lines of private talk between them, behind {{user}}\'s back. One NPC: their unspoken thought.',
            'Voice each NPC from who they are as established above — their personality, speech habits, history, goals and relationships in the character card, lorebook entries and any NPC dossiers — not a generic inner voice. They know only what they have seen, been told or worked out; never give them knowledge they could not have.',
            'Honest and unguarded, contrasting with what they show. 40 words at most in all. Leave the block out when no NPC is present.',
        ].join('\n'),
        layout: '[NPC Name]: [what they say or think, in their own voice]\n[Other NPC Name]: [their reply, if two or more NPCs are present]',
        when: { mode: 'always' },
    },
    {
        id: 'character-sheet',
        template: 'character-sheet',
        name: 'Character Sheet',
        icon: '🛡️',
        short: 'Sheet',
        tag: 'Character_Sheet',
        enabled: false,
        visible: true,
        kind: 'stateful',
        format: 'fields',
        display: 'fields',
        fields: [
            { label: 'HP', type: 'meter', max: 100 },
            { label: 'Stamina', type: 'meter', max: 100 },
            { label: 'Gold', type: 'number' },
            { label: 'Status', type: 'text', hint: 'conditions, or "fine"' },
            { label: 'Skills', type: 'list', hint: 'Name rank, comma separated' },
        ],
        prompt: [
            "{{user}}'s own condition and abilities, nobody else's.",
            'A number moves only when something in this reply moved it. Meters move at most 10 in one reply unless the scene plainly earns more. Skills change only when the story changes them.',
        ].join('\n'),
        when: { mode: 'always' },
    },
    {
        id: 'scene-notes',
        template: 'scene-notes',
        name: 'Scene Notes',
        icon: '📝',
        short: 'Notes',
        tag: 'Scene_Notes',
        enabled: false,
        visible: true,
        kind: 'turn',
        format: 'text',
        display: 'plain',
        prompt: 'Two or three short lines on what just changed in the scene and what is now at stake. No story prose; never repeat earlier notes.',
        when: { mode: 'always' },
    },
];

// (0.9.15) Built-in instructions as earlier versions wrote them, by template: a block whose
// instruction is still one of these (never edited) is given the current one; an edited one stays.
const EARLIER_PROMPTS = {
    inventory: [
        [
            "Everything {{user}}'s party owns or carries: items, money, gear and supplies.",
            'Apply only gains, losses, transfers, spending, consumption and equipment changes that this reply actually completes. Planned, attempted, interrupted, hypothetical or uncertain changes do not count; when a change cannot be worked out safely, keep the previous value instead of guessing. Never create a negative balance.',
        ].join('\n'),
    ],
};

/** The stored blocks with an unedited built-in instruction brought up to date (a new list when any is). */
export function upgradePrompts(blocks) {
    let changed = false;
    const out = (blocks ?? []).map(block => {
        const earlier = EARLIER_PROMPTS[block?.template];
        if (!earlier?.includes(String(block.prompt ?? '').trim())) return block;
        const current = TEMPLATES.find(item => item.id === block.template)?.prompt;
        if (!current || current === block.prompt) return block;
        changed = true;
        return { ...block, prompt: current };
    });
    return changed ? out : blocks;
}

export function templateById(id) {
    const template = TEMPLATES.find(item => item.id === id || item.template === id);
    return template ? normalizeBlock(template) : null;
}

/** The block list a new install starts with. */
export function defaultBlocks() {
    return TEMPLATES.map(template => normalizeBlock(template));
}
