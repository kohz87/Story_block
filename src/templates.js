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
