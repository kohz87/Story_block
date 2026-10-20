// What Story Block adds to the next ordinary reply, in tokens (v0.9.1): Story Suite's
// `api.manage.tokens()` contract (docs/STORY_SUITE.md). An estimate at about 4 characters a
// token, from the same entries and the same buildContext the reply's prompt is built from: no
// model call, cheap, and pure, so it is tested without SillyTavern.
//
// `input` is the context section Story Block injects (kept blocks included); `output` is what
// it asks the model to write back: each writable block's current state, or its skeleton when
// it has none yet (optional blocks counted as if written), plus the envelope around them.

import { formatFor } from './formats/index.js';
import { ENVELOPE_MARKER } from './envelope.js';
import { buildContextParts } from './prompt.js';
import { promptRolls } from './dice.js';
import { changesOnly, changesTag } from './changes.js';
import { changeSkeleton } from './formats/rows.js';

export const CHARS_PER_TOKEN = 4;
export const RULES_PART = 'Rules and envelope';

/** Rough tokens in `text`: about 4 characters each. */
export function tokensOf(text) {
    return Math.round(String(text ?? '').length / CHARS_PER_TOKEN);
}

// The block as the model would write it back: its state, else its skeleton (rolls filled in).
function writtenBack(entry, substitute) {
    const { def } = entry;
    if (def.kept) return '';
    // (0.9.19) A list written as changes only asks for a few change lines, not the whole list.
    if (changesOnly(def)) return `<${changesTag(def)}>\n${changeSkeleton(def)}\n</${changesTag(def)}>`;
    const format = formatFor(def);
    const state = def.kind === 'stateful' && entry.state && !format.isEmpty(entry.state) ? format.serialize(entry.state, def) : null;
    const body = state ?? String(substitute(String(format.skeleton(def) ?? '').replaceAll('{{rolls}}', promptRolls(entry.rolls))) ?? '');
    return `<${def.tag}>\n${String(body).trim()}\n</${def.tag}>`;
}

const ENVELOPE = `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n</Blocks>\n-->`;

/**
 * `{ input, output, parts: [{ label, input, output }] }` for the prompt entries a reply would get
 * ({ def, state, body, rolls, note }, as prepareGeneration builds them). A block's input is what
 * its own sections bring (about what switching it off would save); what they share (the rules
 * and the envelope) is one more part, so the parts add up to the totals. A kept block is listed
 * as "Name (kept by Owner)" and never adds output; one not written yet adds nothing.
 * (0.9.22) The section is built once, each block's share read from its sections' lengths, rather
 * than built again without each block in turn. `options.staticDefs`/`ruleDefs` as buildContextParts.
 */
export function contextTokens(entries, { substitute = text => text, staticDefs = null, ruleDefs = null } = {}) {
    const list = (Array.isArray(entries) ? entries : []).filter(entry => entry?.def);
    const sizes = new Map();
    const built = buildContextParts(list, { substitute, staticDefs, ruleDefs, sizes });
    const input = tokensOf([built.static, built.tail].filter(Boolean).join('\n\n'));
    if (!input) return { input: 0, output: 0, parts: [] };
    const parts = list.map(entry => {
        const { def } = entry;
        return {
            label: def.kept ? `${def.name} (kept by ${def.owner})` : String(def.name ?? def.tag),
            // Rounded down, so the parts never add up to more than the whole.
            input: Math.min(input, Math.floor((sizes.get(entry) ?? 0) / CHARS_PER_TOKEN)),
            output: tokensOf(writtenBack(entry, substitute)),
        };
    }).filter(part => part.input || part.output);
    const writable = list.filter(entry => !entry.def.kept);
    // A "first" block has its own envelope before the story.
    const envelopes = (writable.some(entry => entry.def.kind === 'lead') ? 1 : 0) + (writable.some(entry => entry.def.kind !== 'lead') ? 1 : 0);
    const shared = {
        label: RULES_PART,
        input: Math.max(0, input - parts.reduce((sum, part) => sum + part.input, 0)),
        output: envelopes * tokensOf(ENVELOPE),
    };
    const all = shared.input || shared.output ? [...parts, shared] : parts;
    return { input, output: all.reduce((sum, part) => sum + part.output, 0), parts: all };
}
