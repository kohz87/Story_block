// Reader-only Setup section. Opening, inspecting and cancelling never call a command.
// The second click submits the hashes that were displayed, so a changed library refuses STALE.
export function renderDataModules(el, api) {
    const doc = el.ownerDocument;
    const query = (name, args) => (api.query ?? api.sdk?.query)?.(name, args);
    const command = (name, args) => (api.command ?? api.sdk?.command)?.(name, args);
    const make = (tag, text, parent = el) => {
        const node = doc.createElement(tag); node.textContent = text; parent.appendChild(node); return node;
    };
    const rows = query('dataModules.setup') ?? [];
    if (!rows.length) make('p', 'No data modules installed or pinned. Import a pack in Packs.');
    for (const row of rows) {
        const panel = make('section', ''), definition = row.definition;
        make('h5', `${definition.name} · ${row.packId} ${row.packVersion} · ${definition.scope}`, panel);
        make('p', `${row.status}${row.reason ? `: ${row.reason}` : ''}`, panel);
        make('p', `Definition ${row.hash}; pack ${row.packHash}`, panel);
        make('pre', JSON.stringify({ fields: definition.state, kinds: definition.kinds, rewards: definition.rewards,
            imports: definition.imports, timers: definition.timers, screens: definition.screens.map(screen => screen.id),
            budgets: row.budgets }, null, 2), panel);
        const link = make('a', 'Source pack', panel); link.href = `https://github.com/kohz87/Story_block/blob/stage6/data-modules/docs/v2/DATA_MODULES.md`;
        const chosen = new Set();
        if (definition.scope === 'character') for (const actor of row.actors) {
            const label = make('label', ` ${actor.name} (${actor.id}) `, panel), checkbox = doc.createElement('input');
            checkbox.type = 'checkbox'; checkbox.disabled = row.subjects.includes(actor.id);
            checkbox.checked = checkbox.disabled;
            checkbox.addEventListener('change', () => checkbox.checked ? chosen.add(actor.id) : chosen.delete(actor.id));
            label.appendChild(checkbox);
        }
        const actions = [];
        if (!row.pinned && row.available) actions.push(['Enable for this chat', 'dm.pin']);
        if (row.status === 'Migration available') actions.push(['Migrate', 'dm.migrate']);
        if (row.pinned && definition.scope === 'character' && row.status !== 'Unsupported') actions.push(['Attach selected characters', 'dm.attach']);
        for (const [title, type] of actions) {
            const button = make('button', title, panel); button.type = 'button';
            button.addEventListener('click', () => {
                const subjects = [...chosen], payload = { module: row.module, hash: row.hash, packHash: row.packHash, subjects };
                const preview = make('div', '', panel);
                make('pre', JSON.stringify({ action: type, ...payload, baseline: row.baseline, changes: row.additions ?? null }, null, 2), preview);
                const apply = make('button', title, preview), cancel = make('button', 'Cancel', preview);
                apply.type = cancel.type = 'button'; cancel.addEventListener('click', () => preview.remove());
                apply.addEventListener('click', async () => {
                    apply.disabled = true;
                    const results = type === 'dm.attach' ? await Promise.all(subjects.map(who => command(type, { module: row.module, who }))) : [await command(type, payload)];
                    make('p', results.map(result => result?.ok ? result.receipt?.summary ?? 'Done.' : `${result?.code}: ${result?.message}`).join('\n'), preview);
                });
            });
        }
    }
}
