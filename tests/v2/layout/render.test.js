import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLayout, tabFromLayout, part } from '../../../src/v2/layout/index.js';
import { mount, fakeQuery, layoutOf, one, settle } from './helpers/fake-dom.js';
import { texts } from '../../ui-fake-dom.js';

const pc = Object.freeze({ id: 'ac_pc000001', name: 'Ren', level: 5, tags: ['a', 'b'], hp: { cur: 77, max: 82 }, portrait: 'https://example.com/ren.png' });

test('containers draw their children with ss-l- classes', () => {
    const { host } = mount();
    const result = renderLayout(host, layoutOf({
        type: 'box', title: 'Party', children: [
            { type: 'row', children: [{ type: 'text', value: 'a' }, { type: 'text', value: 'b' }] },
            { type: 'col', children: [{ type: 'text', value: 'c' }] },
            { type: 'grid', cols: 3, children: [{ type: 'text', value: 'd' }] },
        ],
    }));
    assert.deepEqual(result, { ok: true, errors: [], problems: [] });
    const root = one(host, '.ss-l-root');
    assert.equal(root.dataset.layout, 'test');
    assert.equal(one(root, '.ss-l-box-title').textContent, 'Party');
    assert.deepEqual(texts(one(root, '.ss-l-row'), '.ss-l-text'), ['a', 'b']);
    assert.deepEqual(texts(one(root, '.ss-l-col'), '.ss-l-text'), ['c']);
    const grid = one(root, '.ss-l-grid');
    assert.equal(grid.style.getPropertyValue('--ss-l-cols'), '3');
    for (const node of root.descendants()) {
        for (const name of node.classes()) assert.ok(name.startsWith('ss-l-') || name === 'fa-solid' || name.startsWith('fa-'), `class ${name}`);
    }
});

test('text, badge and meter show literals and bound values', () => {
    const { host } = mount();
    const query = fakeQuery({ 'party.pc': pc });
    renderLayout(host, layoutOf({
        type: 'col', children: [
            { type: 'text', variant: 'title', bind: { query: 'party.pc', path: 'name' } },
            { type: 'text', label: 'Level', value: { query: 'party.pc', path: 'level' } },
            { type: 'badge', value: 'rare', tone: 'rare' },
            { type: 'badge', value: '' },
            { type: 'meter', label: 'HP', bind: { query: 'party.pc', path: 'hp' } },
            { type: 'meter', value: 3, max: 4 },
            { type: 'text', value: true },
            { type: 'text', bind: { query: 'party.pc', path: 'tags' } },
        ],
    }), { query });
    const textNodes = host.querySelectorAll('.ss-l-text');
    assert.equal(textNodes[0].textContent, 'Ren');
    assert.ok(textNodes[0].classList.contains('ss-l-text-title'));
    assert.equal(one(textNodes[1], '.ss-l-label').textContent, 'Level');
    assert.equal(one(textNodes[1], '.ss-l-value').textContent, '5');
    assert.equal(textNodes[2].textContent, 'yes');
    assert.equal(textNodes[3].textContent, 'a, b');

    const badges = host.querySelectorAll('.ss-l-badge');
    assert.equal(badges.length, 1, 'an empty badge is not drawn');
    assert.ok(badges[0].classList.contains('ss-l-tone-rare'));

    const [hp, plain] = host.querySelectorAll('.ss-l-meter');
    assert.equal(one(hp, '.ss-l-meter-num').textContent, '77 / 82');
    assert.equal(hp.getAttribute('aria-valuenow'), '77');
    assert.equal(hp.getAttribute('aria-valuemax'), '82');
    assert.equal(one(hp, '.ss-l-meter-fill').style.width, '93.9%');
    assert.equal(one(plain, '.ss-l-meter-fill').style.width, '75%');
    assert.equal(query.calls.length, 1, 'one query call per name and args per drawing');
    assert.deepEqual(query.calls[0], ['party.pc', {}]);
});

test('a meter clamps to 0-100% and reports a non-number', () => {
    const { host } = mount();
    const result = renderLayout(host, layoutOf({
        type: 'col', children: [
            { type: 'meter', value: 120, max: 100 },
            { type: 'meter', value: -5, max: 100 },
            { type: 'meter', value: 'lots', max: 100 },
        ],
    }));
    const fills = host.querySelectorAll('.ss-l-meter-fill').map(node => node.style.width);
    assert.deepEqual(fills, ['100%', '0%', '0%']);
    assert.equal(host.querySelectorAll('.ss-l-meter-num')[2].textContent, '—');
    assert.match(result.problems[0], /root\.children\[2\]: a meter needs a number/);
});

test('image draws safe URLs only, also when they come from a query', () => {
    const { host } = mount();
    const query = fakeQuery({ 'party.pc': { ...pc, bad: 'javascript:alert(1)' } });
    const result = renderLayout(host, layoutOf({
        type: 'row', children: [
            { type: 'image', bind: { query: 'party.pc', path: 'portrait' }, alt: 'Ren', size: 'small' },
            { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' },
            { type: 'image', bind: { query: 'party.pc', path: 'bad' } },
            { type: 'image', bind: { query: 'party.pc', path: 'missing' } },
        ],
    }), { query });
    const images = host.querySelectorAll('img');
    assert.deepEqual(images.map(node => node.getAttribute('src')), ['https://example.com/ren.png', 'data:image/png;base64,iVBORw0KGgo=']);
    assert.equal(images[0].getAttribute('alt'), 'Ren');
    assert.equal(images[0].getAttribute('referrerpolicy'), 'no-referrer');
    assert.ok(images[0].classList.contains('ss-l-image-small'));
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /root\.children\[2\]: .*not an allowed image URL/);
});

test('lists draw one item per row with $item and $index, records in stored order', () => {
    const { host } = mount();
    const query = fakeQuery({
        'inventory.items': () => ({
            it_b: { id: 'it_b', name: 'Rope', qty: 2, tags: ['tool'] },
            it_a: { id: 'it_a', name: 'Trout', qty: 1, tags: [] },
        }),
        'npc.dossier': ({ name }) => ({ note: `about ${name}` }),
    });
    renderLayout(host, layoutOf({
        type: 'list', bind: { query: 'inventory.items' },
        item: {
            type: 'row', children: [
                { type: 'text', value: '$index' },
                { type: 'text', value: '$item.name' },
                { type: 'badge', label: '×', value: '$item.qty' },
                { type: 'text', bind: { query: 'npc.dossier', args: { name: '$item.name' }, path: 'note' } },
                { type: 'list', bind: '$item.tags', item: { type: 'text', value: '$item' } },
            ],
        },
    }), { query });
    const rows = host.querySelectorAll('.ss-l-root > .ss-l-list > .ss-l-item');
    assert.equal(rows.length, 2);
    assert.deepEqual(texts(rows[0], ':scope > .ss-l-row > .ss-l-text'), ['0', 'Rope', 'about Rope']);
    assert.deepEqual(texts(rows[1], ':scope > .ss-l-row > .ss-l-text'), ['1', 'Trout', 'about Trout']);
    assert.equal(one(rows[0], '.ss-l-badge .ss-l-value').textContent, '2');
    assert.deepEqual(texts(rows[0], ':scope .ss-l-list .ss-l-text'), ['tool'], 'inner $item is the inner row');
    assert.deepEqual(query.calls.filter(([name]) => name === 'npc.dossier').map(([, args]) => args), [{ name: 'Rope' }, { name: 'Trout' }]);
});

test('a list shows its empty text, a limit and "and N more"', () => {
    const { host } = mount();
    const many = Array.from({ length: 5 }, (_, i) => ({ n: i }));
    const query = fakeQuery({ none: [], many });
    renderLayout(host, layoutOf({
        type: 'col', children: [
            { type: 'list', bind: { query: 'none' }, empty: 'Nothing here.', item: { type: 'text', value: '$item.n' } },
            { type: 'list', bind: { query: 'many' }, limit: 2, item: { type: 'text', value: '$item.n' } },
        ],
    }), { query });
    const [empty, limited] = host.querySelectorAll('.ss-l-list');
    assert.equal(one(empty, '.ss-l-empty').textContent, 'Nothing here.');
    assert.deepEqual(texts(limited, '.ss-l-text'), ['0', '1']);
    assert.equal(one(limited, '.ss-l-more').textContent, 'and 3 more');
});

test('buttons call command with the payload resolved from the row', async () => {
    const { host } = mount();
    const calls = [];
    const command = async (type, payload) => {
        calls.push([type, payload]);
        return type === 'item.use' ? { ok: true } : { ok: false, code: 'NOT_ENOUGH', message: 'There is no Rope left.' };
    };
    const query = fakeQuery({ 'inventory.items': [{ id: 'it_a', owner: 'ac_pc000001', qty: 1 }] });
    renderLayout(host, layoutOf({
        type: 'list', bind: { query: 'inventory.items' },
        item: {
            type: 'row', children: [
                { type: 'button', label: 'Use', icon: 'fa-flask', command: 'item.use', payload: { stack: '$item.id', target: '$item.owner', note: ['$index', 'fixed'] } },
                { type: 'button', label: 'Drop', command: 'inventory.drop', payload: { stack: '$item.id', qty: 1 } },
            ],
        },
    }), { query, command });
    const [use, drop] = host.querySelectorAll('button.ss-l-button');
    assert.equal(use.type, 'button');
    assert.equal(one(use, '.ss-l-button-label').textContent, 'Use');
    assert.ok(one(use, 'i').classList.contains('fa-flask'));

    let bubbled = 0;
    host.addEventListener('click', () => { bubbled += 1; });
    use.click();
    assert.equal(use.disabled, true, 'disabled while the command runs');
    await settle();
    assert.equal(use.disabled, false);
    drop.click();
    await settle();
    assert.deepEqual(calls, [
        ['item.use', { stack: 'it_a', target: 'ac_pc000001', note: [0, 'fixed'] }],
        ['inventory.drop', { stack: 'it_a', qty: 1 }],
    ]);
    assert.equal(bubbled, 0, 'clicks do not reach the page around the layout');
    const statuses = host.querySelectorAll('.ss-l-status').map(node => node.textContent);
    assert.deepEqual(statuses, ['', 'There is no Rope left.']);
});

test('a thrown command shows its message; no command means disabled buttons', async () => {
    const { host } = mount();
    renderLayout(host, layoutOf({ type: 'button', label: 'Go', command: 'a.b' }), { command: () => { throw new Error('Not now.'); } });
    host.querySelector('button').click();
    await settle();
    assert.equal(one(host, '.ss-l-status').textContent, 'Not now.');

    renderLayout(host, layoutOf({ type: 'button', label: 'Go', command: 'a.b' }));
    const button = host.querySelector('button');
    assert.equal(button.disabled, true);
    assert.equal(button.title, 'Not available here');
});

test('the payload is a copy: a command changing it does not change the next click', async () => {
    const { host } = mount();
    const seen = [];
    renderLayout(host, layoutOf({ type: 'button', label: 'Go', command: 'a.b', payload: { list: [1] } }), {
        command: (type, payload) => { seen.push(JSON.stringify(payload)); payload.list.push(2); return { ok: true }; },
    });
    host.querySelector('button').click();
    await settle();
    host.querySelector('button').click();
    await settle();
    assert.deepEqual(seen, ['{"list":[1]}', '{"list":[1]}']);
});

test('when hides its children unless the condition holds, with the row in scope', () => {
    const { host } = mount();
    const seen = [];
    const evaluate = (cond, scope) => {
        seen.push([cond, scope.item?.name ?? null, scope.index ?? null, typeof scope.query]);
        if (cond === 'boom') throw new Error('bad condition');
        return cond === 'yes' || (cond === 'item.points > 0' && scope.item.points > 0);
    };
    const query = fakeQuery({ actors: [{ name: 'Ren', points: 2 }, { name: 'Lyra', points: 0 }] });
    const result = renderLayout(host, layoutOf({
        type: 'col', children: [
            { type: 'when', cond: 'yes', children: [{ type: 'text', value: 'shown' }] },
            { type: 'when', cond: 'no', children: [{ type: 'text', value: 'hidden' }] },
            { type: 'when', cond: 'boom', children: [{ type: 'text', value: 'hidden too' }] },
            { type: 'list', bind: { query: 'actors' }, item: { type: 'when', cond: 'item.points > 0', children: [{ type: 'text', value: '$item.name' }] } },
        ],
    }), { query, evaluate });
    assert.deepEqual(texts(host, '.ss-l-text'), ['shown', 'Ren']);
    assert.deepEqual(seen.slice(3), [['item.points > 0', 'Ren', 0, 'function'], ['item.points > 0', 'Lyra', 1, 'function']]);
    assert.match(result.problems.join('\n'), /root\.children\[2\]: the condition failed: bad condition/);

    // No evaluator (a host without the condition language): hidden, and said so.
    const second = renderLayout(host, layoutOf({ type: 'when', cond: 'yes', children: [{ type: 'text', value: 'x' }] }));
    assert.equal(host.querySelectorAll('.ss-l-text').length, 0);
    assert.match(second.problems[0], /conditions can't be checked here/);
});

test('tabs switch pages and keep the choice across redraws of the same element', () => {
    const { host } = mount();
    const layout = layoutOf({
        type: 'tabs', pages: [
            { title: 'Stats', node: { type: 'text', value: 'stats page' } },
            { title: 'Skills', node: { type: 'text', value: 'skills page' } },
        ],
    });
    renderLayout(host, layout);
    const tabs = host.querySelectorAll('.ss-l-tab');
    assert.deepEqual(tabs.map(node => node.textContent), ['Stats', 'Skills']);
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    assert.equal(one(host, '.ss-l-tabpanel').textContent, 'stats page');
    tabs[1].click();
    assert.equal(one(host, '.ss-l-tabpanel').textContent, 'skills page');
    assert.ok(tabs[1].classList.contains('ss-l-tab-active'));
    assert.ok(!tabs[0].classList.contains('ss-l-tab-active'));

    renderLayout(host, layout);
    assert.equal(one(host, '.ss-l-tabpanel').textContent, 'skills page', 'a redraw keeps the page');
    const { host: other } = mount();
    renderLayout(other, layout);
    assert.equal(one(other, '.ss-l-tabpanel').textContent, 'stats page', 'another mount has its own choice');
});

test('theme tokens are CSS variables on the layout root only', () => {
    const { host } = mount();
    renderLayout(host, layoutOf({ type: 'box', children: [{ type: 'text', value: 'x' }] }, { theme: { tokens: { accent: '#c8a24a', radius: '8px', font: 'Georgia, serif' } } }));
    const root = one(host, '.ss-l-root');
    assert.deepEqual(root.styleProps, { '--ss-l-accent': '#c8a24a', '--ss-l-radius': '8px', '--ss-l-font': 'Georgia, serif' });
    assert.deepEqual(host.styleProps, {}, 'the mount element is untouched');
    for (const node of root.descendants()) assert.deepEqual(Object.keys(node.styleProps).filter(key => key.startsWith('--ss-l-') && key !== '--ss-l-cols'), []);

    const { host: second } = mount();
    renderLayout(second, layoutOf({ type: 'text', value: 'y' }));
    assert.deepEqual(one(second, '.ss-l-root').styleProps, {}, 'one layout\'s theme never reaches another');
});

test('failed and missing queries leave parts empty and are listed as problems', () => {
    const { host } = mount();
    const query = fakeQuery({ obj: { a: { b: 1 } }, later: () => Promise.resolve(1) });
    const result = renderLayout(host, layoutOf({
        type: 'col', children: [
            { type: 'text', bind: { query: 'nope' } },
            { type: 'text', bind: { query: 'obj', path: 'a' } },
            { type: 'text', bind: { query: 'obj', path: 'a.missing.deeper' } },
            { type: 'text', bind: { query: 'later' } },
            { type: 'text', value: 'still drawn' },
        ],
    }), { query });
    assert.deepEqual(texts(host, '.ss-l-text'), ['', '', '', '', 'still drawn']);
    assert.equal(result.ok, true);
    assert.match(result.problems[0], /root\.children\[0\]: query nope failed: no query nope/);
    assert.match(result.problems[1], /root\.children\[1\]: a list or record can't be shown as text/);
    assert.match(result.problems[2], /query later answered later/);
    assert.equal(result.problems.length, 3);

    const noData = renderLayout(host, layoutOf({ type: 'text', bind: { query: 'obj' } }));
    assert.match(noData.problems[0], /there is no data to show here/);
});

test('paths only follow own properties', () => {
    const { host } = mount();
    const query = fakeQuery({ obj: { name: 'x' } });
    renderLayout(host, layoutOf({ type: 'text', bind: { query: 'obj', path: 'name.length' } }), { query });
    assert.equal(one(host, '.ss-l-text').textContent, '');
});

test('an invalid layout draws its errors as text instead of the screen', () => {
    const { host } = mount();
    const result = renderLayout(host, layoutOf({ type: 'marquee', value: '<b>hi</b>' }));
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ['root: "marquee" is not a node type']);
    assert.ok(one(host, '.ss-l-invalid'));
    assert.deepEqual(texts(host, '.ss-l-invalid-list li'), ['root: "marquee" is not a node type']);
});

test('text from data stays text: markup and scripts are never parsed', () => {
    const { host } = mount();
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const query = fakeQuery({ evil: { name: evil } });
    renderLayout(host, layoutOf({
        type: 'box', title: evil, children: [
            { type: 'text', bind: { query: 'evil', path: 'name' } },
            { type: 'button', label: evil, command: 'a.b' },
        ],
    }), { query });
    assert.equal(one(host, '.ss-l-box-title').textContent, evil);
    assert.equal(one(host, '.ss-l-text').textContent, evil);
    assert.equal(host.querySelectorAll('img').length, 0);
    assert.equal(host.querySelectorAll('script').length, 0);
});

test('widgets from a registry render with resolved props and the api', async () => {
    const { host } = mount();
    const seen = [];
    const widgets = {
        'rpg-battle.actor-card': {
            render(el, props, api) {
                seen.push({ props, item: api.item, index: api.index, hasQuery: typeof api.query === 'function' });
                const name = el.ownerDocument.createElement('span');
                name.textContent = props.value?.name ?? '';
                el.appendChild(name);
                api.command('party.rest', { actor: props.actor });
            },
        },
        broken: { render() { throw new Error('kaput'); } },
        text: { render() { throw new Error('a widget never replaces a built-in'); } },
    };
    const calls = [];
    const query = fakeQuery({ 'party.actors': [{ id: 'ac_1', name: 'Ren' }], 'party.actor': ({ id }) => ({ id, name: `Actor ${id}` }) });
    const result = renderLayout(host, layoutOf({
        type: 'col', children: [
            { type: 'list', bind: { query: 'party.actors' }, item: { type: 'rpg-battle.actor-card', props: { actor: '$item.id', compact: true }, bind: { query: 'party.actor', args: { id: '$item.id' } } } },
            { type: 'broken' },
            { type: 'text', value: 'plain' },
        ],
    }), { query, widgets, command: (type, payload) => { calls.push([type, payload]); return { ok: true }; } });
    assert.equal(result.ok, true);
    const card = one(host, '[data-widget="rpg-battle.actor-card"]');
    assert.ok(card.classList.contains('ss-l-widget'));
    assert.equal(card.textContent, 'Actor ac_1');
    assert.deepEqual(seen, [{ props: { actor: 'ac_1', compact: true, value: { id: 'ac_1', name: 'Actor ac_1' } }, item: { id: 'ac_1', name: 'Ren' }, index: 0, hasQuery: true }]);
    assert.deepEqual(calls, [['party.rest', { actor: 'ac_1' }]]);
    assert.equal(one(host, '[data-widget="broken"]').childNodes.length, 0);
    assert.match(result.problems.join('\n'), /root\.children\[1\]: widget broken failed: kaput/);
    assert.equal(texts(host, '.ss-l-text').at(-1), 'plain');
});

test('drawing stops at the part budget', () => {
    const { host } = mount();
    const rows = Array.from({ length: 200 }, (_, i) => ({ i, sub: Array.from({ length: 20 }, () => 0) }));
    const query = fakeQuery({ rows });
    const result = renderLayout(host, layoutOf({ type: 'list', bind: { query: 'rows' }, item: { type: 'list', bind: '$item.sub', item: { type: 'text', value: '$item' } } }), { query });
    assert.ok(host.querySelectorAll('.ss-l-text').length < 3000);
    assert.match(result.problems.join('\n'), /more than 3000 parts/);
});

test('tabFromLayout gives the tab host a tab that renders from view and api', async () => {
    const { host } = mount();
    const layout = layoutOf({
        type: 'col', children: [
            { type: 'text', bind: { query: 'party.pc', path: 'name' } },
            { type: 'when', cond: 'yes', children: [{ type: 'button', label: 'Rest', command: 'party.rest', payload: { kind: 'short' } }] },
            { type: 'my.widget' },
        ],
    }, { id: 'pack.demo/sheet', title: 'Sheet', icon: 'fa-id-card' });
    const tab = tabFromLayout(layout, { widgets: { 'my.widget': { render(el) { el.dataset.mine = 'base'; } } } });
    assert.equal(tab.id, 'pack.demo/sheet');
    assert.equal(tab.title, 'Sheet');
    assert.equal(tab.icon, 'fa-id-card');
    assert.equal(typeof tab.render, 'function');

    const calls = [];
    const view = { state: {}, query: fakeQuery({ 'party.pc': pc }), settings: {}, chat: { length: 3, lastUser: '' } };
    const api = {
        command: (type, payload) => { calls.push([type, payload]); return Promise.resolve({ ok: true }); },
        evaluate: cond => cond === 'yes',
        widgets: { 'my.widget': { render(el) { el.dataset.mine = 'api'; } } },
    };
    const result = tab.render(host, view, api);
    assert.equal(result.ok, true);
    assert.equal(one(host, '.ss-l-text').textContent, 'Ren');
    assert.equal(one(host, '[data-widget="my.widget"]').dataset.mine, 'api', 'api widgets win over the tab\'s own');
    host.querySelector('button').click();
    await settle();
    assert.deepEqual(calls, [['party.rest', { kind: 'short' }]]);

    // A read-only mount (no api): buttons disabled, conditions hidden.
    tab.render(host, view);
    assert.equal(host.querySelectorAll('button').length, 0);
});

test('the part registers nothing in the state', () => {
    assert.deepEqual(part.domains, {});
    assert.deepEqual(part.commands, {});
    assert.deepEqual(part.queries, {});
    assert.equal(part.context.static(), '');
    assert.deepEqual(part.tabs, []);
});

test('ensureLayoutStyles puts the stylesheet in the page once', async () => {
    const { ensureLayoutStyles, LAYOUT_CSS, LAYOUT_STYLE_ID } = await import('../../../src/v2/layout/index.js');
    const { doc } = mount();
    assert.equal(ensureLayoutStyles(doc), false, 'no <head>, nothing to do');
    doc.head = doc.createElement('head');
    doc.getElementById = id => doc.head.querySelector(`#${id}`);
    assert.equal(ensureLayoutStyles(doc), true);
    assert.equal(ensureLayoutStyles(doc), true);
    const styles = doc.head.querySelectorAll('style');
    assert.equal(styles.length, 1);
    assert.equal(styles[0].id, LAYOUT_STYLE_ID);
    assert.equal(styles[0].textContent, LAYOUT_CSS);
});

test('a screen\'s bare tree { root } renders; a tab without id, title or icon shows why', () => {
    const { host } = mount();
    const result = renderLayout(host, { root: { type: 'text', value: 'bare' }, theme: { tokens: { accent: 'teal' } } });
    assert.equal(result.ok, true);
    assert.equal(one(host, '.ss-l-text').textContent, 'bare');
    assert.equal(one(host, '.ss-l-root').dataset.layout, undefined);
    assert.equal(one(host, '.ss-l-root').style.getPropertyValue('--ss-l-accent'), 'teal');
    assert.deepEqual(renderLayout(host, { id: 'BAD', root: { type: 'text', value: 'x' } }).errors, ['layout.id: must be a short lowercase id (letters, digits, . _ / -)'], 'present fields are still checked');

    const tab = tabFromLayout({ root: { type: 'text', value: 'bare' } });
    const shown = tab.render(host, {}, {});
    assert.equal(shown.ok, false);
    assert.deepEqual(shown.errors, [
        'layout.id: must be a short lowercase id (letters, digits, . _ / -)',
        'layout.title: must be text of 1 to 60 characters',
        'layout.icon: must be a Font Awesome icon name like fa-box',
    ]);
    assert.ok(one(host, '.ss-l-invalid'));
});

test('widgets also get preview, commit and on when the host gives them', () => {
    const { host } = mount();
    let api;
    const preview = () => {};
    const commit = () => {};
    const on = () => {};
    const tab = tabFromLayout(layoutOf({ type: 'my.board' }), { widgets: { 'my.board': { render(el, props, given) { api = given; } } } });
    tab.render(host, { query: () => null }, { preview, commit, on, evaluate: 'not a function' });
    assert.equal(api.preview, preview);
    assert.equal(api.commit, commit);
    assert.equal(api.on, on);
    assert.equal(api.evaluate, undefined);
    assert.equal(api.command, undefined);

    renderLayout(host, layoutOf({ type: 'my.board' }), { widgets: { 'my.board': { render(el, props, given) { api = given; } } } });
    assert.deepEqual(Object.keys(api).sort(), ['command', 'evaluate', 'index', 'item', 'query']);
});
