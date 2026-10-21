// The events part (MODULES §A): its shape, its default wiring through the public sdk, and the Events
// debug section of the settings overlay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE, createEventsPart, packEvents, part, renderEventsSection, summaryLine } from '../../../src/v2/events/index.js';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { baseState, createFakeHost } from './helpers/fake-host.js';
import { fireEvent } from '../../../src/v2/events/engine.js';

test('the part: one internal command, one query, the beforeGenerate hook, an Events settings section', () => {
    assert.deepEqual(Object.keys(part.commands), [FIRE]);
    assert.equal(FIRE, 'events.fire');
    assert.deepEqual(Object.keys(part.queries), ['events.status']);
    assert.deepEqual(Object.keys(part.hooks), ['beforeGenerate']);
    assert.deepEqual(part.domains, {});
    assert.deepEqual(part.kinds, {});
    assert.deepEqual(part.tabs, []);
    assert.equal(part.context, undefined, 'nothing for the prompt: cues arrive as untold receipts');
    assert.equal(part.settings.section, 'Events');
    assert.deepEqual(part.settings.defaults, {});
    assert.equal(typeof part.settings.render, 'function');
});

test('packEvents reads packs.content({ kind: "events" }) from the view', () => {
    const asked = [];
    assert.deepEqual(packEvents({ query: (name, args) => { asked.push([name, args]); return [{ id: 'a' }]; } }), [{ id: 'a' }]);
    assert.deepEqual(asked, [['packs.content', { kind: 'events' }]]);
    assert.deepEqual(packEvents({ query: () => null }), []);
    assert.deepEqual(packEvents({}), []);
});

test('the default part reaches the host through globalThis.StoryBlock.sdk', () => {
    const defs = [{ id: 'pack.demo/bells', when: 'true', cue: 'Bells ring.' }];
    const host = createFakeHost({ commands: { [FIRE]: fireEvent }, queries: { 'packs.content': () => defs } });
    const previous = globalThis.StoryBlock;
    try {
        delete globalThis.StoryBlock;
        const fresh = createEventsPart();
        fresh.hooks.beforeGenerate(host.view());
        assert.deepEqual(fresh.queries['events.status'](host.state()).lastRun.failed, [{ id: 'pack.demo/bells', code: 'FAILED', message: 'Story Block is not ready.' }]);
        globalThis.StoryBlock = { sdk: { command: host.command, query: host.query } };
        assert.equal(fresh.hooks.beforeGenerate(host.view()), undefined);
        assert.deepEqual(host.receipts.map(receipt => receipt.summary), ['Bells ring.']);
        const status = fresh.queries['events.status'](host.state());
        assert.deepEqual(status.fired, ['pack.demo/bells'], 'the status query reads packs through sdk.query');
    } finally {
        if (previous === undefined) delete globalThis.StoryBlock;
        else globalThis.StoryBlock = previous;
    }
});

test('createEventsPart with injected dependencies: the hook commits through them', () => {
    const host = createFakeHost({ state: baseState(), commands: { [FIRE]: fireEvent } });
    const injected = createEventsPart({ events: () => [{ id: 'x', when: 'true', cue: 'X.' }], command: host.command, query: host.query });
    injected.hooks.beforeGenerate(host.view());
    assert.deepEqual(injected.queries['events.status'](host.state()).fired, ['x']);
    // Called with tools (MODULES §F.3), the status asks tools.query over the same state.
    const asked = [];
    const fromPacks = createEventsPart({ command: host.command }).queries['events.status'](host.state(), {}, { query: (name, args) => { asked.push([name, args]); return [{ id: 'z', when: 'true', cue: 'Z.' }]; } });
    assert.deepEqual(fromPacks.due, ['z']);
    assert.deepEqual(asked, [['packs.content', { kind: 'events' }]]);
    // Commands of the part run on the real bus as on the fake one.
    assert.equal(injected.commands[FIRE], fireEvent);
});

const sample = {
    events: [
        { id: 'a-gate', pack: 'pack.demo', status: 'fired', why: 'It has happened on this line of the story.', once: true, after: null, when: 'true', cue: 'A.' },
        { id: 'b-camp', pack: 'pack.demo', status: 'due', why: 'Its condition is met: it happens before the next reply.', once: true, after: 'a-gate', when: 'true', cue: 'B.' },
        { id: 'rain', pack: null, status: 'waiting', why: 'Its condition is not met yet.', once: false, after: null, when: 'time() > 600', cue: 'Rain.' },
        { id: '<img src=x onerror=alert(1)>', pack: null, status: 'invalid', why: 'The event "<b>x</b>" has no cue to tell.', once: null, after: null, when: null, cue: null },
    ],
    problems: ['The event list could not be read: nope'],
    lastRun: { fired: ['a-gate'], failed: [{ id: 'rain', code: 'FAILED', message: 'Busy.' }] },
};

test('summaryLine counts events by where they stand', () => {
    assert.equal(summaryLine(sample), '4 events: 1 happened, 1 due, 1 waiting, 1 problem.');
    assert.equal(summaryLine({ events: [sample.events[0]] }), '1 event: 1 happened.');
    assert.equal(summaryLine({ events: [] }), 'No events: no enabled pack defines any.');
    assert.equal(summaryLine(null), 'No events: no enabled pack defines any.');
});

test('the Events section lists every event with its status and reason, as text only', () => {
    const doc = installFakeDom();
    const target = doc.createElement('div');
    let reads = 0;
    const root = renderEventsSection(target, () => { reads += 1; return sample; });
    assert.equal(target.children[0], root);
    assert.equal(root.querySelector('.ss-events-summary').textContent, '4 events: 1 happened, 1 due, 1 waiting, 1 problem.');
    const rows = root.querySelectorAll('.ss-events-row');
    assert.deepEqual(rows.map(row => row.dataset.status), ['fired', 'due', 'waiting', 'invalid']);
    assert.deepEqual(texts(root, '.ss-events-id'), ['a-gate', 'b-camp', 'rain', '<img src=x onerror=alert(1)>']);
    assert.equal(rows[1].textContent, 'b-camp (pack.demo) · due · after a-gateIts condition is met: it happens before the next reply.true');
    assert.equal(rows[2].querySelector('.ss-events-repeat').textContent, ' · repeats');
    assert.equal(rows[2].querySelector('.ss-events-when').textContent, 'time() > 600');
    assert.equal(rows[3].querySelector('.ss-events-why').textContent, 'The event "<b>x</b>" has no cue to tell.');
    assert.equal(root.querySelectorAll('img').length + root.querySelectorAll('b').filter(node => node.className !== 'ss-events-id').length, 0, 'pack text never becomes markup');
    assert.deepEqual(texts(root, '.ss-events-problem'), ['The event list could not be read: nope']);
    assert.equal(root.querySelector('.ss-events-last').textContent, 'Before the last reply, happened: a-gate; refused: rain (Busy.).');
    assert.equal(reads, 1);
    root.querySelector('.ss-events-refresh').dispatch('click');
    assert.equal(reads, 2, 'Refresh reads the status again');
});

test('the Events section handles an empty status, a throwing reader and a promised status', async () => {
    const doc = installFakeDom();
    const empty = renderEventsSection(doc.createElement('div'), { events: [] });
    assert.equal(empty.querySelector('.ss-events-summary').textContent, 'No events: no enabled pack defines any.');
    assert.equal(empty.querySelector('.ss-events-last').textContent, 'Before the last reply, no event happened.');
    const broken = renderEventsSection(doc.createElement('div'), () => { throw new Error('No host.'); });
    assert.deepEqual(texts(broken, '.ss-events-problem'), ['The events could not be read: No host.']);
    let resolve;
    const later = renderEventsSection(doc.createElement('div'), () => new Promise(done => { resolve = done; }));
    assert.deepEqual(texts(later, '.ss-events-problem'), ['Reading the events…']);
    resolve(sample);
    await new Promise(done => setImmediate(done));
    assert.equal(later.querySelectorAll('.ss-events-row').length, 4);
});

test('settings.render asks api.query("events.status") when the overlay offers it', () => {
    const doc = installFakeDom();
    const asked = [];
    const target = doc.createElement('div');
    part.settings.render(target, { query: name => { asked.push(name); return sample; } });
    assert.deepEqual(asked, ['events.status']);
    assert.equal(target.querySelectorAll('.ss-events-row').length, 4);
});
