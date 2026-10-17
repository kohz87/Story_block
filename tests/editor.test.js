// Drives the settings panel and the block editor against a minimal fake DOM, so the
// list actions, the editor form and its validation are covered in CI without jsdom.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parent = null;
        this.attributes = {};
        this.dataset = {};
        this.listeners = {};
        this.style = { setProperty() {} };
        this.className = '';
        this.ownText = '';
        this.value = '';
        this.id = '';
        this.checked = false;
        this.disabled = false;
        this.hidden = false;
        const element = this;
        this.classList = {
            add: (...names) => names.forEach(name => { if (!element.classes().includes(name)) element.className = `${element.className} ${name}`.trim(); }),
            remove: name => { element.className = element.classes().filter(item => item !== name).join(' '); },
            toggle: (name, force) => (force ?? !element.classes().includes(name)) ? element.classList.add(name) : element.classList.remove(name),
            contains: name => element.classes().includes(name),
        };
    }
    classes() { return this.className.split(/\s+/).filter(Boolean); }
    set textContent(value) { this.children = []; this.ownText = String(value); }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    // Like the real DOM, a null or string child becomes text, so a stray null shows up as "null".
    adopt(node) { return node instanceof FakeElement ? node : Object.assign(new FakeElement('#text'), { ownText: String(node) }); }
    append(...nodes) { nodes.forEach(node => this.appendChild(this.adopt(node))); }
    prepend(node) { node.parent = this; this.children.unshift(node); }
    appendChild(node) { node.parent?.removeChild?.(node); node.parent = this; this.children.push(node); return node; }
    removeChild(node) { this.children = this.children.filter(child => child !== node); node.parent = null; }
    remove() { this.parent?.removeChild(this); }
    replaceChildren(...nodes) { this.children = []; this.ownText = ''; this.append(...nodes); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type) { return Promise.all((this.listeners[type] ?? []).map(fn => fn({ type, stopPropagation() {}, preventDefault() {}, target: this }))); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { globalThis.document.activeElement = this; }
    contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    // Compound selectors: tag, #id, .class and [data-x="y"].
    matches(selector) {
        const tag = /^[a-z]+/i.exec(selector)?.[0];
        const id = /#([\w-]+)/.exec(selector)?.[1];
        const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
        const data = [...selector.matchAll(/\[data-([\w-]+)="([^"]*)"\]/g)]
            .map(([, name, value]) => [name.replace(/-(\w)/g, (_, c) => c.toUpperCase()), value]);
        return (!tag || this.tagName === tag.toUpperCase())
            && (!id || this.id === id)
            && classes.every(name => this.classes().includes(name))
            && data.every(([name, value]) => this.dataset[name] === value);
    }
    matchesPath(parts) {
        if (!this.matches(parts.at(-1))) return false;
        let rest = parts.slice(0, -1);
        for (let n = this.parent; n && rest.length; n = n.parent) if (n.matches(rest.at(-1))) rest = rest.slice(0, -1);
        return rest.length === 0;
    }
    querySelectorAll(selector) {
        const parts = selector.trim().split(/\s+/);
        return this.descendants().filter(node => node.matchesPath(parts));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

globalThis.document = { createElement: tag => new FakeElement(tag), activeElement: null, body: new FakeElement('body') };

const { renderSettings, openBlockEditor } = await import('../src/ui/editor.js');
const { TEMPLATES, defaultBlocks } = await import('../src/templates.js');
const { normalizeBlock, MAX_FIELDS } = await import('../src/schema.js');

const custom = normalizeBlock({ id: 'quests', name: 'Quests', icon: '📜', tag: 'Quests', kind: 'stateful', format: 'text', prompt: 'Open quests.' });

function mount(options = {}) {
    const container = new FakeElement('div');
    const changes = [];
    const panel = renderSettings(container, {
        blocks: [...defaultBlocks(), custom],
        templates: TEMPLATES,
        onChange: blocks => changes.push(blocks),
        estimateTokens: block => block.prompt.length / 4,
        ...options,
    });
    return { container, changes, panel, last: () => changes.at(-1) };
}

const rows = container => container.querySelectorAll('.story-block-row');
const ids = container => rows(container).map(row => row.dataset.blockId);
const row = (container, id) => container.querySelector(`.story-block-row[data-block-id="${id}"]`);
const inRow = (container, id, selector) => row(container, id).querySelector(selector);
const texts = (node, selector) => node.querySelectorAll(selector).map(item => item.textContent);
const setValue = (input, value, type = 'input') => { input.value = value; input.dispatch(type); };

test('panel markup: drawer, empty status slot, rows in order with badges and costs', () => {
    const { container } = mount();
    assert.ok(container.querySelector('.story-block-settings .inline-drawer .inline-drawer-toggle.inline-drawer-header'));
    assert.ok(container.querySelector('.inline-drawer-content'));
    const status = container.querySelector('#story_block_status');
    assert.ok(status);
    assert.equal(status.textContent, '');
    assert.deepEqual(ids(container), ['inventory', 'character-sheet', 'scene-notes', 'quests']);
    assert.deepEqual(texts(container, '.story-block-row-name'), ['Inventory', 'Character Sheet', 'Scene Notes', 'Quests']);
    assert.deepEqual(texts(container, '.story-block-row-tag'), ['<Inventory>', '<Character_Sheet>', '<Scene_Notes>', '<Quests>']);
    assert.deepEqual(texts(row(container, 'scene-notes'), '.story-block-badge'), ['Per-turn', 'Free text']);
    assert.deepEqual(texts(row(container, 'inventory'), '.story-block-badge'), ['Stateful', 'Rows']);
    assert.match(inRow(container, 'inventory', '.story-block-row-cost').textContent, /^~\d+ tok$/);
    assert.equal(inRow(container, 'character-sheet', '.story-block-row-cost').textContent, 'off', 'disabled blocks cost nothing');
    // Only Inventory and Quests are enabled by default.
    const expected = Math.round(defaultBlocks()[0].prompt.length / 4) + Math.round(custom.prompt.length / 4);
    assert.equal(container.querySelector('.story-block-total-cost').textContent, `~${expected} tok`);
    assert.ok(!container.textContent.includes('null'), 'no stray null text nodes');
});

test('re-rendering keeps the status text the runtime wrote', () => {
    const { container } = mount();
    container.querySelector('#story_block_status').textContent = 'Last reply: 2 blocks';
    renderSettings(container, { blocks: defaultBlocks(), templates: TEMPLATES, onChange() {} });
    assert.equal(container.querySelector('#story_block_status').textContent, 'Last reply: 2 blocks');
});

test('reset only for blocks whose template exists', () => {
    const { container } = mount();
    assert.ok(inRow(container, 'inventory', '.story-block-reset'));
    assert.equal(inRow(container, 'quests', '.story-block-reset'), null);
    const other = mount({ templates: TEMPLATES.filter(template => template.id !== 'inventory') });
    assert.equal(inRow(other.container, 'inventory', '.story-block-reset'), null);
});

test('enabled and visible toggles call onChange with the full updated list', () => {
    const { container, changes, last } = mount();
    const enabled = inRow(container, 'character-sheet', '.story-block-enabled');
    assert.equal(enabled.checked, false);
    enabled.checked = true;
    enabled.dispatch('change');
    assert.equal(changes.length, 1);
    assert.equal(last().length, 4);
    assert.equal(last().find(block => block.id === 'character-sheet').enabled, true);
    assert.notEqual(inRow(container, 'character-sheet', '.story-block-row-cost').textContent, 'off', 'list re-rendered in place');

    const visible = inRow(container, 'inventory', '.story-block-visible');
    visible.checked = false;
    visible.dispatch('change');
    assert.equal(last().find(block => block.id === 'inventory').visible, false);
    assert.equal(last().find(block => block.id === 'character-sheet').enabled, true, 'earlier change kept');
});

test('move up and down reorder; ends are disabled', () => {
    const { container, last } = mount();
    assert.equal(inRow(container, 'inventory', '.story-block-move-up').disabled, true);
    assert.equal(inRow(container, 'quests', '.story-block-move-down').disabled, true);
    inRow(container, 'quests', '.story-block-move-up').click();
    assert.deepEqual(last().map(block => block.id), ['inventory', 'character-sheet', 'quests', 'scene-notes']);
    assert.deepEqual(ids(container), ['inventory', 'character-sheet', 'quests', 'scene-notes']);
    inRow(container, 'inventory', '.story-block-move-down').click();
    assert.deepEqual(ids(container), ['character-sheet', 'inventory', 'quests', 'scene-notes']);
});

test('duplicate inserts a copy with a new id and tag right after the original', () => {
    const { container, last } = mount();
    inRow(container, 'inventory', '.story-block-duplicate').click();
    const list = last();
    assert.equal(list.length, 5);
    const copy = list[1];
    assert.notEqual(copy.id, 'inventory');
    assert.equal(copy.tag, 'Inventory_2');
    assert.equal(copy.name, 'Inventory (copy)');
    assert.equal(copy.template, 'inventory', 'a copy can still be reset');
    assert.deepEqual(copy.columns, ['Item', 'Qty', 'Note']);
    assert.equal(ids(container)[1], copy.id);
});

test('delete asks for confirmation inline, Keep cancels, Delete removes', () => {
    const { container, changes, last } = mount();
    inRow(container, 'quests', '.story-block-delete').click();
    assert.equal(changes.length, 0, 'nothing deleted before confirming');
    assert.match(inRow(container, 'quests', '.story-block-confirm').textContent, /Delete Quests\?/);
    inRow(container, 'quests', '.story-block-confirm-no').click();
    assert.equal(inRow(container, 'quests', '.story-block-confirm'), null);
    inRow(container, 'quests', '.story-block-delete').click();
    inRow(container, 'quests', '.story-block-confirm-yes').click();
    assert.deepEqual(last().map(block => block.id), ['inventory', 'character-sheet', 'scene-notes']);
    assert.equal(row(container, 'quests'), null);
});

test('reset to default restores the template but keeps id, switches and order', () => {
    const edited = { ...defaultBlocks()[0], name: 'Bag', prompt: 'Mine.', columns: ['A', 'B', 'C'], visible: false };
    const { container, last } = mount({ blocks: [custom, edited] });
    inRow(container, 'inventory', '.story-block-reset').click();
    inRow(container, 'inventory', '.story-block-confirm-yes').click();
    const [first, reset] = last();
    assert.equal(first.id, 'quests');
    assert.equal(reset.id, 'inventory');
    assert.equal(reset.name, 'Inventory');
    assert.equal(reset.prompt, defaultBlocks()[0].prompt);
    assert.deepEqual(reset.columns, ['Item', 'Qty', 'Note']);
    assert.equal(reset.visible, false, 'the reader\'s tab switch is kept');
});

test('add menu: blank block and templates, present ones added as copies', () => {
    const { container, last } = mount({ blocks: [defaultBlocks()[0]] });
    container.querySelector('.story-block-add').click();
    const options = container.querySelectorAll('.story-block-add-option');
    assert.deepEqual(options.map(option => option.dataset.template), ['', 'inventory', 'character-sheet', 'scene-notes']);
    assert.match(options[1].textContent, /add a copy/);
    assert.doesNotMatch(options[2].textContent, /copy/);

    container.querySelector('.story-block-add-option[data-template="character-sheet"]').click();
    assert.deepEqual(last().map(block => block.id), ['inventory', 'character-sheet']);
    assert.equal(last()[1].tag, 'Character_Sheet');
    assert.equal(container.querySelector('.story-block-add-menu'), null, 'menu closes after adding');

    container.querySelector('.story-block-add').click();
    container.querySelector('.story-block-add-option[data-template="inventory"]').click();
    const copy = last()[2];
    assert.equal(copy.id, 'inventory-copy');
    assert.equal(copy.tag, 'Inventory_2');
});

test('blank block opens the editor; saving appends it, cancel leaves the list alone', () => {
    const { container, changes, last } = mount();
    container.querySelector('.story-block-add').click();
    container.querySelector('.story-block-add-option[data-template=""]').click();
    assert.ok(container.querySelector('.story-block-editor'), 'editor replaces the list');
    assert.equal(container.querySelector('.story-block-list'), null);
    assert.ok(container.querySelector('#story_block_status'), 'status slot survives the editor');
    container.querySelector('.story-block-editor-cancel').click();
    assert.equal(changes.length, 0);
    assert.equal(rows(container).length, 4);

    container.querySelector('.story-block-add').click();
    container.querySelector('.story-block-add-option[data-template=""]').click();
    setValue(container.querySelector('.story-block-input-name'), 'Weather Report');
    assert.equal(container.querySelector('.story-block-input-tag').value, 'Weather_Report', 'tag follows the name');
    container.querySelector('.story-block-editor-save').click();
    const added = last().at(-1);
    assert.equal(added.id, 'weather-report');
    assert.equal(added.tag, 'Weather_Report');
    assert.equal(ids(container).at(-1), 'weather-report');
    assert.match(container.querySelector('.story-block-io-message').textContent, /Added Weather Report/);
});

test('editing a block from the list saves it in place', () => {
    const { container, last } = mount();
    inRow(container, 'quests', '.story-block-edit').click();
    const name = container.querySelector('.story-block-input-name');
    assert.equal(name.value, 'Quests');
    setValue(name, 'Quest Log');
    assert.equal(container.querySelector('.story-block-input-tag').value, 'Quests', 'an existing tag does not follow renames');
    setValue(container.querySelector('.story-block-input-prompt'), 'Every open quest for {{user}}.');
    container.querySelector('.story-block-editor-save').click();
    const saved = last().find(block => block.id === 'quests');
    assert.equal(saved.name, 'Quest Log');
    assert.equal(saved.prompt, 'Every open quest for {{user}}.');
    assert.equal(last().indexOf(saved), 3);
    assert.equal(inRow(container, 'quests', '.story-block-row-name').textContent, 'Quest Log');
});

function editor(def, blocks = [...defaultBlocks(), custom]) {
    const container = new FakeElement('div');
    const saved = [];
    let cancelled = 0;
    openBlockEditor(def, { blocks, container, onSave: block => saved.push(block), onCancel: () => { cancelled += 1; } });
    return { container, saved, cancelled: () => cancelled, q: selector => container.querySelector(selector) };
}

test('editor shows every validation error and does not save', () => {
    const { q, saved, container } = editor({ name: 'Draft' });
    setValue(q('.story-block-input-name'), '   ');
    setValue(q('.story-block-input-tag'), 'Inventory');
    setValue(q('.story-block-input-format'), 'fields', 'change');
    setValue(q('.story-block-input-when'), 'keyword', 'change');
    q('.story-block-editor-save').click();
    assert.equal(saved.length, 0);
    const errors = q('.story-block-editor-errors');
    assert.equal(errors.hidden, false);
    const messages = texts(container, '.story-block-editor-errors li');
    assert.ok(messages.includes('Give the block a name.'), messages.join('|'));
    assert.ok(messages.some(text => /already used by Inventory/.test(text)));
    assert.ok(messages.includes('A Fields block needs at least one field.'));
    assert.ok(messages.some(text => /keyword/.test(text)));

    setValue(q('.story-block-input-tag'), '9 bad tag');
    q('.story-block-editor-save').click();
    assert.ok(texts(container, '.story-block-editor-errors li').some(text => /must start with a letter/.test(text)));
    setValue(q('.story-block-input-tag'), 'div');
    q('.story-block-editor-save').click();
    assert.ok(texts(container, '.story-block-editor-errors li').some(text => /reserved/.test(text)));
    assert.equal(saved.length, 0);
});

test('editor saves a valid draft normalized, and cancel calls onCancel', () => {
    const { q, saved, cancelled, container } = editor({ name: 'Draft' });
    setValue(q('.story-block-input-name'), 'Shop Prices');
    setValue(q('.story-block-input-icon'), '💰');
    setValue(q('.story-block-input-kind'), 'turn', 'change');
    q('.story-block-input-visible').checked = false;
    q('.story-block-input-visible').dispatch('change');
    setValue(q('.story-block-input-when'), 'keyword', 'change');
    assert.equal(q('.story-block-when-keyword').hidden, false);
    assert.equal(q('.story-block-when-every').hidden, true);
    setValue(q('.story-block-input-keywords'), 'shop, market , ');
    setValue(q('.story-block-input-scan-depth'), '4');
    q('.story-block-editor-save').click();
    assert.equal(saved.length, 1);
    const [block] = saved;
    assert.equal(block.id, 'shop-prices');
    assert.equal(block.tag, 'Shop_Prices');
    assert.equal(block.icon, '💰');
    assert.equal(block.kind, 'turn');
    assert.equal(block.visible, false);
    assert.deepEqual(block.when, { mode: 'keyword', every: 2, keywords: ['shop', 'market'], scanDepth: 4 });
    assert.equal(q('.story-block-editor-errors').hidden, true);
    assert.ok(!container.textContent.includes('null'));
    q('.story-block-editor-cancel').click();
    assert.equal(cancelled(), 1);
});

test('a hand-edited tag stops following the name', () => {
    const { q } = editor({ name: 'Draft' });
    setValue(q('.story-block-input-tag'), 'Custom');
    setValue(q('.story-block-input-name'), 'Something Else');
    assert.equal(q('.story-block-input-tag').value, 'Custom');
});

test('changing an existing block\'s tag warns that it starts empty', () => {
    const { q } = editor(custom);
    assert.equal(q('.story-block-tag-warning').hidden, true);
    setValue(q('.story-block-input-tag'), 'Quest_Log');
    assert.equal(q('.story-block-tag-warning').hidden, false);
    assert.match(q('.story-block-tag-warning').textContent, /<Quests>/);
});

test('format change updates the default display until the reader picks one', () => {
    const { q, saved } = editor({ name: 'Draft', format: 'text' });
    assert.equal(q('.story-block-input-display').value, 'plain');
    assert.equal(q('.story-block-editor-rows').hidden, true);
    setValue(q('.story-block-input-format'), 'rows', 'change');
    assert.equal(q('.story-block-input-display').value, 'tree');
    assert.equal(q('.story-block-editor-rows').hidden, false);
    assert.equal(q('.story-block-editor-fields').hidden, true);
    setValue(q('.story-block-input-display'), 'plain', 'change');
    setValue(q('.story-block-input-format'), 'fields', 'change');
    assert.equal(q('.story-block-input-display').value, 'plain', 'a picked display is kept');
    assert.equal(q('.story-block-editor-fields').hidden, false);
    setValue(q('.story-block-input-format'), 'rows', 'change');
    const columns = q('.story-block-editor-rows').querySelectorAll('.story-block-input-column');
    assert.equal(columns.length, 3);
    setValue(columns[0], 'Name');
    setValue(columns[2], 'Where');
    setValue(q('.story-block-input-max-depth'), '5', 'change');
    q('.story-block-editor-save').click();
    assert.equal(saved[0].format, 'rows');
    assert.equal(saved[0].display, 'plain');
    assert.deepEqual(saved[0].columns, ['Name', 'Qty', 'Where']);
    assert.equal(saved[0].maxDepth, 5);
    assert.equal(saved[0].fields, undefined);
});

test('an existing block with a non-default display keeps it across format changes', () => {
    const { q } = editor(normalizeBlock({ name: 'Odd', format: 'rows', display: 'plain' }));
    setValue(q('.story-block-input-format'), 'text', 'change');
    assert.equal(q('.story-block-input-display').value, 'plain');
    setValue(q('.story-block-input-format'), 'fields', 'change');
    assert.equal(q('.story-block-input-display').value, 'plain');
});

test('field list editing: add, edit, meter max, reorder, remove, cap and errors', () => {
    const sheet = defaultBlocks()[1];
    const { q, saved, container } = editor(sheet);
    const labels = () => container.querySelectorAll('.story-block-field-label').map(input => input.value);
    assert.deepEqual(labels(), ['HP', 'Stamina', 'Gold', 'Status', 'Skills']);
    const maxInputs = container.querySelectorAll('.story-block-field-max');
    assert.deepEqual(maxInputs.map(input => input.hidden), [false, false, true, true, true], 'max only for meters');

    container.querySelectorAll('.story-block-field-down')[0].click();
    assert.deepEqual(labels(), ['Stamina', 'HP', 'Gold', 'Status', 'Skills']);
    container.querySelectorAll('.story-block-field-up')[4].click();
    assert.deepEqual(labels(), ['Stamina', 'HP', 'Gold', 'Skills', 'Status']);
    container.querySelectorAll('.story-block-field-remove')[2].click();
    assert.deepEqual(labels(), ['Stamina', 'HP', 'Skills', 'Status']);

    q('.story-block-field-add').click();
    const rowsNow = container.querySelectorAll('.story-block-field-row');
    const added = rowsNow.at(-1);
    q('.story-block-editor-save').click();
    assert.ok(texts(container, '.story-block-editor-errors li').includes('Field 5 needs a label.'));
    setValue(added.querySelector('.story-block-field-label'), 'hp');
    q('.story-block-editor-save').click();
    assert.ok(texts(container, '.story-block-editor-errors li').some(text => /both called "hp"/.test(text)));
    assert.equal(saved.length, 0);

    setValue(added.querySelector('.story-block-field-label'), 'Mana');
    setValue(added.querySelector('.story-block-field-type'), 'meter', 'change');
    assert.equal(added.querySelector('.story-block-field-max').hidden, false);
    setValue(added.querySelector('.story-block-field-max'), '30');
    setValue(added.querySelector('.story-block-field-hint'), 'arcane reserve');
    q('.story-block-editor-save').click();
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].fields.map(field => field.label), ['Stamina', 'HP', 'Skills', 'Status', 'Mana']);
    assert.deepEqual(saved[0].fields.at(-1), { label: 'Mana', type: 'meter', max: 30, hint: 'arcane reserve' });
    assert.equal(saved[0].id, 'character-sheet');

    for (let i = 0; i < MAX_FIELDS; i += 1) q('.story-block-field-add').click();
    assert.equal(container.querySelectorAll('.story-block-field-row').length, MAX_FIELDS);
    assert.equal(q('.story-block-field-add').disabled, true);
    assert.equal(q('.story-block-field-count').textContent, `${MAX_FIELDS} / ${MAX_FIELDS} fields`);
});

test('user text never becomes markup', () => {
    const evil = normalizeBlock({ id: 'x', name: '<img src=x onerror=alert(1)>', tag: 'X', prompt: '<script>alert(1)</script>' });
    const { container } = mount({ blocks: [evil] });
    assert.equal(container.querySelector('.story-block-row-name').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(container.querySelector('img'), null);
    inRow(container, 'x', '.story-block-edit').click();
    assert.equal(container.querySelector('.story-block-input-prompt').value, '<script>alert(1)</script>');
    assert.equal(container.querySelector('script'), null);
});

test('import panel: paste merges and reports clashes; file input imports too', async () => {
    const { container, last } = mount();
    container.querySelector('.story-block-import').click();
    const area = container.querySelector('.story-block-import-text');
    assert.ok(area);
    setValue(area, JSON.stringify([
        { id: 'quests', name: 'Quests v2', tag: 'Quests', format: 'text' },
        { id: 'clash', name: 'Clash', tag: 'inventory', format: 'text' },
    ]));
    container.querySelector('.story-block-import-apply').click();
    assert.equal(last().find(block => block.id === 'quests').name, 'Quests v2');
    assert.equal(last().length, 4);
    assert.match(texts(container, '.story-block-io-errors li').join('|'), /"Clash" was not imported: .*already used by Inventory/);
    assert.match(container.querySelector('.story-block-io-message').textContent, /Imported 1 block\./);

    setValue(container.querySelector('.story-block-import-text'), '{ nope');
    container.querySelector('.story-block-import-apply').click();
    assert.match(texts(container, '.story-block-io-errors li')[0], /not valid JSON/);

    const file = container.querySelector('.story-block-import-file');
    file.files = [{ text: async () => JSON.stringify({ version: 1, blocks: [{ id: 'dice', name: 'Dice', tag: 'Dice', kind: 'turn' }] }) }];
    await file.dispatch('change');
    assert.equal(last().at(-1).id, 'dice');
    assert.equal(container.querySelector('.story-block-io-errors'), null);
});

test('export downloads through a Blob URL when it can, else shows the JSON', () => {
    const { container } = mount();
    const created = [];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const clicks = [];
    const realCreate = globalThis.document.createElement;
    globalThis.document.createElement = tag => {
        const node = realCreate(tag);
        if (tag === 'a') node.click = () => clicks.push({ href: node.href, download: node.download });
        return node;
    };
    try {
        URL.createObjectURL = blob => { created.push(blob); return 'blob:fake'; };
        URL.revokeObjectURL = () => {};
        container.querySelector('.story-block-export').click();
        assert.equal(created.length, 1);
        assert.deepEqual(clicks, [{ href: 'blob:fake', download: 'story-blocks.json' }]);
        assert.match(container.querySelector('.story-block-io-message').textContent, /Downloaded/);
        container.querySelector('.story-block-export-show').click();
        assert.equal(JSON.parse(container.querySelector('.story-block-export-text').value).blocks.length, 4);

        URL.createObjectURL = undefined;
        const other = mount();
        other.container.querySelector('.story-block-export').click();
        const parsed = JSON.parse(other.container.querySelector('.story-block-export-text').value);
        assert.equal(parsed.version, 1);
        assert.deepEqual(parsed.blocks.map(block => block.id), ['inventory', 'character-sheet', 'scene-notes', 'quests']);
    } finally {
        URL.createObjectURL = original.create;
        URL.revokeObjectURL = original.revoke;
        globalThis.document.createElement = realCreate;
    }
});

test('setBlocks refreshes the list without calling onChange', () => {
    const { container, changes, panel } = mount();
    panel.setBlocks([custom]);
    assert.deepEqual(ids(container), ['quests']);
    assert.equal(changes.length, 0);
    assert.deepEqual(panel.getBlocks().map(block => block.id), ['quests']);
});
