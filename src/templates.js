// Built-in templates. They are ordinary block definitions: the reader can edit,
// duplicate, disable or delete them, and "Reset to default" restores the copy here.

import { normalizeBlock } from './schema.js';

export const TEMPLATES = [
    {
        id: 'inventory',
        template: 'inventory',
        name: 'Inventory',
        icon: '🎒',
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
        tag: 'CYOA',
        enabled: false,
        visible: true,
        kind: 'turn',
        format: 'text',
        display: 'choices',
        prompt: 'Four short actions {{user}} could take next, each a different direction (talk, act, investigate, leave…). Write them as things {{user}} does, under 15 words each, never decided for them.',
        layout: '1. [Short suggestion]\n2. [Short suggestion]\n3. [Short suggestion]\n4. [Short suggestion]',
        when: { mode: 'always' },
    },
    {
        id: 'character-sheet',
        template: 'character-sheet',
        name: 'Character Sheet',
        icon: '🛡️',
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

export function templateById(id) {
    const template = TEMPLATES.find(item => item.id === id || item.template === id);
    return template ? normalizeBlock(template) : null;
}

/** The block list a new install starts with. */
export function defaultBlocks() {
    return TEMPLATES.map(template => normalizeBlock(template));
}
