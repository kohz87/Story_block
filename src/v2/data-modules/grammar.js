// The narrator's grammar for pinned data modules, generated from the frozen declarations (never an author
// regex, never a second `<Changes>` parser): decision 6's short slug reference when it is unique among the
// chat's active pins, the full `pack.<id>/<slug>` otherwise. Shared by the prompt's static part and Setup.
import { DM_LIMITS as L } from './schema.js';
import { oneLine } from '../../text.js';

/** The name a `dm` line uses for module `id` among the active ids: the bare slug when unique, else the full ID. */
export function referenceOf(ids, id) {
    const slug = String(id).split('/')[1];
    return ids.filter(other => String(other).split('/')[1] === slug).length === 1 ? slug : id;
}

const valuesOf = schema => schema.type === 'enum' ? schema.values.map(value => oneLine(value)).join('|')
    : schema.type === 'int' ? `${schema.min}..${schema.max}` : schema.type === 'text' ? 'text' : 'true|false';

/** One line of grammar for a kind: "+ dm reputation — reason | kind: gain | faction: guild|watch|compact". */
export function kindGrammar(definition, name, reference) {
    const kind = definition.kinds[name];
    return `${kind.op} dm ${reference} — reason | kind: ${name}${definition.scope === 'character' ? ' | who: attached actor' : ''}`
        + Object.entries(kind.labels).map(([label, schema]) => ` | ${label}: ${valuesOf(schema)}`).join('');
}

/** A concrete example line for a kind, using each label's first legal value (Setup shows these). */
export function kindExample(definition, name, reference) {
    const kind = definition.kinds[name];
    const first = schema => schema.type === 'enum' ? schema.values[0] : schema.type === 'int' ? schema.min : schema.type === 'text' ? 'text' : true;
    return `${kind.op} dm ${reference} — why it happens | kind: ${name}${definition.scope === 'character' ? ' | who: Name' : ''}`
        + Object.entries(kind.labels).map(([label, schema]) => ` | ${label}: ${first(schema)}`).join('');
}

/** The lines a module adds to the static part, one per kind, within the module's character budget (whole lines only). */
export function moduleGrammar(definition, reference) {
    const prompt = definition.prompt ? [...oneLine(definition.prompt)].slice(0, 600).join('') : '';
    const lines = prompt ? [prompt] : [];
    let used = prompt ? [...prompt].length : 0;
    for (const name of Object.keys(definition.kinds)) {
        const line = kindGrammar(definition, name, reference);
        const next = used + (lines.length ? 1 : 0) + [...line].length;
        if (next > L.staticCharacters) break;
        lines.push(line);
        used = next;
    }
    return lines.join('\n');
}
