// ss.meter's marks (Wave C): the ceiling notch, stage ticks, the change since the last reply and the
// critical bands. Each is left out when not given or outside the range, and the spoken value names it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaText, meter, meterStage, meterTicks, meterWarning } from '../../../../src/v2/view/widgets/meter.js';
import { fakeApi, host, installDom } from './fake-dom.js';

function mount(props) {
    const doc = installDom();
    const el = host(doc);
    const handle = meter.render(el, props, fakeApi());
    const q = selector => el.querySelector(selector);
    return { el, handle, root: el.children[0], q, track: q('.ss-w-meter-track') };
}

test('meter: no marks by default (old props draw as before)', () => {
    const m = mount({ value: 77, max: 82, label: 'HP' });
    for (const part of ['.ss-w-meter-ceiling', '.ss-w-meter-above', '.ss-w-meter-ticks', '.ss-w-meter-stage', '.ss-w-meter-delta', '.ss-w-lo', '.ss-w-hi']) {
        assert.ok(m.q(part).hidden, `${part} hidden`);
    }
    assert.equal(m.root.getAttribute('aria-valuetext'), '77 / 82');
    assert.ok(!m.root.classList.contains('ss-w-critical'));
    assert.equal(m.track.style.getPropertyValue('--ss-w-ceiling'), '');
});

test('meter: ceiling notch at its place in the range, shaded above, spoken; outside the range left out', () => {
    const m = mount({ value: 40, max: 100, ceiling: 60 });
    assert.ok(!m.q('.ss-w-meter-ceiling').hidden);
    assert.ok(!m.q('.ss-w-meter-above').hidden);
    assert.equal(m.track.style.getPropertyValue('--ss-w-ceiling'), '0.6');
    assert.ok(m.root.classList.contains('ss-w-capped'));
    assert.equal(m.q('.ss-w-meter-ceiling').getAttribute('title'), 'Up to 60 for now');
    assert.equal(m.root.getAttribute('aria-valuetext'), '40 / 100, can go up to 60 for now');
    m.handle.update({ value: 40, max: 100, min: 20, ceiling: '60' });
    assert.equal(m.track.style.getPropertyValue('--ss-w-ceiling'), '0.5', 'string number, ratio from min');
    for (const ceiling of [100, 150, 10, 'lots', null]) {
        m.handle.update({ value: 40, max: 100, min: 20, ceiling });
        assert.ok(m.q('.ss-w-meter-ceiling').hidden, `ceiling ${ceiling} left out`);
        assert.equal(m.track.style.getPropertyValue('--ss-w-ceiling'), '');
        assert.ok(!m.root.classList.contains('ss-w-capped'));
    }
});

test('meter: stage ticks sorted, capped, cut to one line; the stage reached is named', () => {
    const ticks = meterTicks([{ at: 60, label: 'Close' }, { at: '20', label: 'Wary\nat first' }, { at: 'x', label: 'bad' }, { at: 500, label: 'off' }, null, { label: 'no at' }], -100, 100);
    assert.deepEqual(ticks.map(t => [t.at, t.label]), [[20, 'Wary at first'], [60, 'Close']]);
    assert.equal(ticks[0].ratio, 0.6);
    assert.equal(meterStage(ticks, 10), null);
    assert.equal(meterStage(ticks, 20).label, 'Wary at first');
    assert.equal(meterStage(ticks, 99).label, 'Close');
    assert.equal(meterTicks(Array.from({ length: 40 }, (_, i) => ({ at: i, label: 'x' })), 0, 100).length, 16);
    assert.equal(meterTicks([{ at: 1, label: 'é'.repeat(80) }], 0, 2)[0].label.length, 40);
    assert.deepEqual(meterTicks('nope', 0, 10), []);
    assert.deepEqual(meterTicks([{ at: 1 }], 5, 5), [], 'an empty range has no ticks');

    const m = mount({ value: 35, min: -100, max: 100, ticks: [{ at: 0, label: 'Neutral' }, { at: 30, label: 'Friendly' }, { at: 70, label: 'Close' }], label: 'Trust' });
    const marks = m.el.querySelectorAll('.ss-w-meter-tick');
    assert.equal(marks.length, 3);
    assert.deepEqual(marks.map(mark => mark.style.getPropertyValue('--ss-w-at')), ['0.5', '0.65', '0.85']);
    assert.deepEqual(marks.map(mark => mark.classList.contains('ss-w-on')), [false, true, false]);
    assert.equal(marks[1].getAttribute('title'), 'Friendly (30)');
    assert.equal(m.q('.ss-w-meter-stage').textContent, 'Friendly');
    assert.equal(m.root.getAttribute('aria-valuetext'), '35 / 100, Friendly');
    m.handle.update({ value: -50, min: -100, max: 100, ticks: [{ at: 0, label: 'Neutral' }] });
    assert.ok(m.q('.ss-w-meter-stage').hidden, 'below the first tick: no stage');
    m.handle.update({ value: -50, min: -100, max: 100 });
    assert.ok(m.q('.ss-w-meter-ticks').hidden);
    assert.equal(m.el.querySelectorAll('.ss-w-meter-tick').length, 0);
});

test('meter: the change since the last reply as ▲/▼, spoken in words; 0 and words show nothing', () => {
    assert.equal(deltaText(3), '▲3');
    assert.equal(deltaText(-5), '▼5');
    assert.equal(deltaText('2.5'), '▲2.5');
    assert.equal(deltaText(0), '');
    assert.equal(deltaText(0.001), '', 'rounds to 0');
    assert.equal(deltaText(null), '');
    assert.equal(deltaText('more'), '');
    const m = mount({ value: 77, max: 82, delta: -5 });
    const change = m.q('.ss-w-meter-delta');
    assert.equal(change.textContent, '▼5');
    assert.ok(change.classList.contains('ss-w-down') && !change.classList.contains('ss-w-up'));
    assert.equal(change.getAttribute('aria-hidden'), 'true');
    assert.equal(m.root.getAttribute('aria-valuetext'), '77 / 82, down 5 since the last reply');
    m.handle.update({ value: 80, max: 82, delta: '3' });
    assert.equal(change.textContent, '▲3');
    assert.ok(change.classList.contains('ss-w-up') && !change.classList.contains('ss-w-down'));
    m.handle.update({ value: 80, max: 82, delta: 0 });
    assert.ok(change.hidden);
    assert.equal(m.root.getAttribute('aria-valuetext'), '80 / 82');
});

test('meter: critical bands at either end; a value inside one marks the meter critical', () => {
    assert.equal(meterWarning(10, 20, null), 'low');
    assert.equal(meterWarning(20, 20, null), null, 'the bound itself is not below');
    assert.equal(meterWarning(95, null, 90), 'high');
    assert.equal(meterWarning(50, 20, 90), null);
    assert.equal(meterWarning(5, 'x', 'y'), null);
    const m = mount({ value: 15, max: 100, warnBelow: 25, label: 'HP', tone: 'good' });
    assert.ok(!m.q('.ss-w-lo').hidden);
    assert.ok(m.q('.ss-w-hi').hidden);
    assert.equal(m.track.style.getPropertyValue('--ss-w-warn-lo'), '0.25');
    assert.ok(m.root.classList.contains('ss-w-critical'));
    assert.ok(m.q('.ss-w-lo').classList.contains('ss-w-in'));
    assert.equal(m.root.getAttribute('data-warn'), 'low');
    assert.equal(m.root.getAttribute('aria-valuetext'), '15 / 100, critically low');
    assert.ok(m.root.classList.contains('ss-w-tone-good'), 'the tone is kept; CSS paints the critical fill');
    m.handle.update({ value: 50, max: 100, warnBelow: 25, warnAbove: 80 });
    assert.ok(!m.root.classList.contains('ss-w-critical'));
    assert.equal(m.root.getAttribute('data-warn'), null);
    assert.equal(m.track.style.getPropertyValue('--ss-w-warn-hi'), '0.8');
    assert.ok(!m.q('.ss-w-lo').classList.contains('ss-w-in'));
    m.handle.update({ value: 90, max: 100, warnAbove: 80 });
    assert.equal(m.root.getAttribute('data-warn'), 'high');
    assert.ok(m.q('.ss-w-hi').classList.contains('ss-w-in'));
    assert.ok(m.q('.ss-w-lo').hidden);
    assert.equal(m.track.style.getPropertyValue('--ss-w-warn-lo'), '', 'a band no longer given is removed');
    // A bound outside the range is no band.
    m.handle.update({ value: -5, max: 100, warnBelow: 0, warnAbove: 100 });
    assert.ok(m.q('.ss-w-lo').hidden && m.q('.ss-w-hi').hidden);
    assert.ok(!m.root.classList.contains('ss-w-critical'));
});

test('meter: all marks together, from string props as a template interpolates them', () => {
    const m = mount({ value: '12', max: '40', ceiling: '30', delta: '-8', warnBelow: '10', warnAbove: '35', ticks: [{ at: '10', label: 'Hurt' }, { at: 30, label: 'Fine' }] });
    assert.equal(m.root.getAttribute('aria-valuetext'), '12 / 40, Hurt, down 8 since the last reply, can go up to 30 for now');
    assert.ok(!m.root.classList.contains('ss-w-critical'));
    assert.equal(meter.validate({ ceiling: 'x', ticks: 'y', delta: {}, warnBelow: [], warnAbove: true }).length, 5);
    assert.deepEqual(meter.validate({ ceiling: '3', ticks: [], delta: 1, warnBelow: '2', warnAbove: 9 }), []);
});
