// Scene display: World State text drawn as a scene board.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const scene = await import('../src/ui/displays/scene.js');
const { templateById } = await import('../src/templates.js');

const def = templateById('world-state');
let keys = 0;

// The same realistic reply as tests/scene.test.js (not imported: that would re-run its tests here).
const FULL = `**📅 Time:** Day 14 of Harvestmoon, dusk | **🌤 Loc:** Heron Ford | Willow camp | **🌡 Wx:** Light rain, cool, firelight

---

**🧍 Maelis:**
* *Outfit:* Travel leathers, forearm bound in linen
* *Position:* By the fire, sharpening the short sword
* *Visible Condition:* Tired, a bruise on the jaw
* *Carrying:* Short sword, whetstone

---

**👥 NPCs Present:**
**Astra — companion:**
* *Outfit:* Borrowed grey cloak over a mail shirt
* *Position:* At the wagon, counting rations
* *Mood:* Wary — keeps glancing at the treeline
* *Agenda:* Make the food last to the city
* *Secret:* She recognised the guild seal on the cutters' blades

**Merrit (ferryman):**
* *Outfit:* Oilskin coat
* *Position:* Sitting on an upturned crate
* *Mood:* [Current visible emotional surface]
* *Agenda:* Get paid
* *Secret:* [What they know or want that {{user}} does not]
* *Weapon:* A boat hook

*[Repeat for each NPC currently in the scene]*

---
**📡 Off-Screen:**
* Captain Ivo — at the toll gate, questioning travellers
* **Sera** waiting at the inn

---
**🔥 Unresolved Threads:**
* Who hired the cutters?
* The guild collector arrives in two days
**🌱 Planted Seeds:** A lantern across the ford (someone is watching, 2 turns); The torn map (3 turns)
**⏳ Consequence Timers:** Unpaid toll, guards come looking, 3 turns
**🎯 Arc Phase:** Escalation
**🎬 Scene Phase:** Building`;

function show(options) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    // A fresh uiKey per pane, so a secret revealed in one test does not leak into the next.
    scene.render(pane, { def, uiKey: `test-${++keys}`, ...options });
    return pane;
}

test('chips for time, place and weather, with labels for screen readers', () => {
    const pane = show({ state: { text: FULL } });
    assert.ok(pane.classList.contains('story-block-display-scene'));
    assert.equal(pane.querySelector('.story-block-title').textContent, 'World State');
    assert.equal(pane.querySelector('.story-block-summary').textContent, '3 present');
    assert.deepEqual(texts(pane, '.story-block-scene-chip-text'), ['Day 14 of Harvestmoon, dusk', 'Heron Ford · Willow camp', 'Light rain, cool, firelight']);
    assert.deepEqual(texts(pane, '.story-block-scene-chip .story-block-scene-sr'), ['Time: ', 'Location: ', 'Weather: ']);
    assert.ok(pane.querySelectorAll('.story-block-scene-chip i').every(glyph => glyph.getAttribute('aria-hidden') === 'true'));
});

test('a card per person, the PC first and marked as you', () => {
    const pane = show({ state: { text: FULL } });
    const cards = pane.querySelectorAll('.story-block-scene-person');
    assert.deepEqual(cards.map(card => card.querySelector('.story-block-scene-name').textContent), ['Maelis', 'Astra', 'Merrit']);
    assert.ok(cards[0].classList.contains('is-pc'));
    assert.equal(cards[0].querySelector('.story-block-scene-tag.is-you').textContent, 'you');
    assert.equal(cards[1].querySelector('.story-block-scene-tag.is-you'), null);
    assert.equal(cards[1].querySelector('.story-block-scene-tag').textContent, 'companion');
    assert.equal(cards[1].querySelector('.story-block-scene-avatar').textContent, 'A');

    // Mood as a pill (first clause), the full line as a row because the pill shortened it.
    assert.equal(cards[1].querySelector('.story-block-scene-mood').textContent, 'Wary');
    assert.deepEqual(texts(cards[1], '.story-block-scene-k'), ['Outfit', 'Position', 'Mood', 'Agenda']);
    assert.equal(cards[1].querySelector('.story-block-scene-row.is-position .story-block-scene-v').textContent, 'At the wagon, counting rations');
    assert.deepEqual(texts(cards[0], '.story-block-scene-k'), ['Outfit', 'Position', 'Visible Condition', 'Carrying']);
    assert.deepEqual(texts(cards[2], '.story-block-scene-k'), ['Outfit', 'Position', 'Agenda', 'Weapon'], 'unknown fields follow');
    assert.equal(pane.querySelector('.story-block-scene-people').getAttribute('role'), 'list');
});

test('an unnamed PC (compact layout) reads "You" without a second tag', () => {
    const pane = show({ state: { text: '**Time & Loc:** Dusk at Heron Ford\n**PC:** Leathers | By the fire\n**NPCs Present:**\n* Astra: Cloak | At the wagon' } });
    const pc = pane.querySelector('.story-block-scene-person.is-pc');
    assert.equal(pc.querySelector('.story-block-scene-name').textContent, 'You');
    assert.equal(pc.querySelector('.story-block-scene-tag.is-you'), null);
    assert.deepEqual(texts(pane, '.story-block-scene-chip-text'), ['Dusk', 'Heron Ford']);
});

test('a secret stays hidden, and out of the page, until revealed', () => {
    const pane = show({ state: { text: FULL } });
    const astra = pane.querySelectorAll('.story-block-scene-person')[1];
    const toggle = astra.querySelector('.story-block-scene-reveal');
    const body = astra.querySelector('.story-block-scene-secret-text');
    assert.equal(toggle.textContent, 'Reveal secret');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), body.id);
    assert.ok(body.hasAttribute('hidden'));
    assert.doesNotMatch(pane.textContent, /guild seal/);

    let reached = 0;
    pane.addEventListener('click', () => { reached += 1; });
    toggle.click();
    assert.equal(reached, 0, 'the click does not reach the message');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.textContent, 'Hide secret');
    assert.equal(body.textContent, 'She recognised the guild seal on the cutters\' blades');
    assert.ok(!body.hasAttribute('hidden'));

    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(body.textContent, '');
    // Merrit's secret was an unfilled placeholder: no button for nothing.
    assert.equal(pane.querySelectorAll('.story-block-scene-reveal').length, 1);
});

test('a revealed secret stays revealed across a re-render, a new secret starts hidden', () => {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    scene.render(pane, { def, uiKey: 'reveal-memory', state: { text: FULL } });
    pane.querySelector('.story-block-scene-reveal').click();
    scene.render(pane, { def, uiKey: 'reveal-memory', state: { text: FULL } });
    assert.match(pane.querySelector('.story-block-scene-secret-text').textContent, /guild seal/);
    scene.render(pane, { def, uiKey: 'reveal-memory', state: { text: FULL.replace('She recognised the guild seal', 'She owes the guild') } });
    assert.equal(pane.querySelector('.story-block-scene-secret-text').textContent, '');
});

test('off-screen, threads, seeds and timers, arc and scene phase rails', () => {
    const pane = show({ state: { text: FULL } });
    assert.deepEqual(texts(pane, '.story-block-scene-off-name'), ['Captain Ivo', 'Sera']);
    assert.deepEqual(texts(pane, '.story-block-scene-items.is-threads .story-block-scene-item'), ['Who hired the cutters?', 'The guild collector arrives in two days']);
    assert.equal(pane.querySelectorAll('.story-block-scene-items.is-seeds .story-block-scene-item').length, 2);
    assert.deepEqual(texts(pane, '.story-block-scene-items.is-timers .story-block-scene-item'), ['Unpaid toll, guards come looking, 3 turns']);

    const [arc, phase] = pane.querySelectorAll('.story-block-scene-phase');
    assert.equal(arc.querySelector('.story-block-scene-phase-name').textContent, 'Escalation');
    const steps = arc.querySelectorAll('.story-block-scene-step');
    assert.equal(steps.length, 5);
    assert.deepEqual(steps.map(step => step.classList.contains('is-done')), [true, false, false, false, false]);
    assert.ok(steps[1].classList.contains('is-current'));
    assert.equal(steps[1].getAttribute('aria-current'), 'step');
    assert.equal(arc.querySelector('.story-block-scene-rail').getAttribute('aria-label'), 'Arc: Escalation, step 2 of 5');
    assert.equal(phase.querySelector('.story-block-scene-step.is-current .story-block-scene-step-name').textContent, 'Building');
});

test('a phase off the ladder is shown as written, without a rail', () => {
    const pane = show({ state: { text: FULL.replace('**🎯 Arc Phase:** Escalation', '**🎯 Arc Phase:** Aftermath') } });
    const arc = pane.querySelector('.story-block-scene-phase.is-arc');
    assert.equal(arc.querySelector('.story-block-scene-phase-name').textContent, 'Aftermath');
    assert.equal(arc.querySelector('.story-block-scene-rail'), null);
});

const NEXT = FULL
    .replace('Day 14 of Harvestmoon, dusk', 'Day 14 of Harvestmoon, night')
    .replace('* *Position:* At the wagon, counting rations', '* *Position:* Beside Maelis at the fire')
    .replace('* *Mood:* Wary — keeps glancing at the treeline', '* *Mood:* Relieved')
    .replace('She recognised the guild seal', 'She was paid by the guild')
    .replace('* *Carrying:* Short sword, whetstone\n', '')
    .replace(/\*\*Merrit \(ferryman\):\*\*[\s\S]*?\* \*Weapon:\* A boat hook\n/, '**Ivo — captain:**\n* *Outfit:* Steel cap\n* *Position:* Wading across the ford\n')
    .replace('* Who hired the cutters?\n', '* Who hired the cutters?\n* Why is the captain here?\n')
    .replace('* The guild collector arrives in two days\n', '');

test('changes from previousState: marked on chips, rows, new people and threads; secrets never', () => {
    const pane = show({ state: { text: NEXT }, previousState: { text: FULL } });
    const time = pane.querySelector('.story-block-scene-chip.is-time');
    assert.ok(time.classList.contains('is-changed'));
    assert.equal(time.title, 'Was: Day 14 of Harvestmoon, dusk');

    const astra = pane.querySelectorAll('.story-block-scene-person')[1];
    const position = astra.querySelector('.story-block-scene-row.is-position');
    assert.ok(position.classList.contains('is-changed'));
    assert.equal(position.querySelector('.story-block-scene-change-text').textContent, 'At the wagon, counting rations → Beside Maelis at the fire');
    assert.ok(astra.querySelector('.story-block-scene-mood').classList.contains('is-changed'));
    assert.equal(astra.querySelector('.story-block-scene-row.is-mood .story-block-scene-change-text').textContent, 'Wary — keeps glancing at the treeline → Relieved');

    const maelis = pane.querySelector('.story-block-scene-person.is-pc');
    const dropped = maelis.querySelector('.story-block-scene-row.is-dropped');
    assert.equal(dropped.querySelector('.story-block-scene-k').textContent, 'Carrying');
    assert.equal(dropped.querySelector('.story-block-scene-change-text').textContent, 'Short sword, whetstone → —');

    const ivo = pane.querySelectorAll('.story-block-scene-person')[2];
    assert.ok(ivo.classList.contains('is-added'));
    assert.equal(ivo.querySelector('.story-block-scene-tag.is-new').textContent, 'new');
    assert.ok(pane.querySelector('.story-block-scene-items.is-threads .story-block-scene-item.is-added').textContent.startsWith('Why is the captain'));

    assert.deepEqual(texts(pane, '.story-block-scene-removed'), ['Left the scene: Merrit', 'Dropped threads: The guild collector arrives in two days']);
    assert.match(pane.querySelector('.story-block-scene-delta').textContent, /^Δ \d+ changes$/);
    assert.equal(astra.querySelector('.story-block-scene-secret .story-block-scene-change'), null);
    assert.doesNotMatch(pane.textContent, /guild seal|paid by the guild/);
});

test('changes passed in win over previousState; secret changes are filtered out; earlier reply noted', () => {
    const changes = [
        { type: 'changed', label: 'Weather', from: 'Clear', to: 'Light rain, cool, firelight' },
        { type: 'changed', label: 'Astra · Secret', from: 'old secret', to: 'new secret' },
        { type: 'changed', label: 'astra · agenda', from: 'Sleep', to: 'Make the food last to the city' },
        { type: 'removed', label: 'Weird' },
    ];
    const pane = show({ state: { text: FULL }, previousState: { text: NEXT }, changes, changesFromEarlierReply: true });
    assert.deepEqual(pane.querySelectorAll('.story-block-scene-chip.is-changed').map(chip => chip.classList.contains('is-weather')), [true]);
    assert.equal(pane.querySelector('.story-block-scene-row.is-agenda.is-changed .story-block-scene-change-text').textContent, 'Sleep → Make the food last to the city');
    assert.doesNotMatch(pane.textContent, /old secret|new secret/);
    assert.equal(pane.querySelector('.story-block-scene-delta').textContent, 'Δ 3 changes · earlier reply');
    assert.match(pane.querySelector('.story-block-scene-delta').title, /earlier reply/);
    assert.deepEqual(texts(pane, '.story-block-scene-removed'), ['No longer written: Weird']);
});

test('text that is not a World State falls back to the plain display, every word kept', () => {
    const text = 'The camp is quiet tonight.\nAstra keeps **watch** by the wagon.';
    const pane = show({ state: { text } });
    assert.ok(pane.classList.contains('story-block-display-plain'));
    assert.ok(!pane.classList.contains('story-block-display-scene'));
    assert.equal(pane.querySelector('.story-block-plain-text').textContent, 'The camp is quiet tonight.Astra keeps watch by the wagon.');
    assert.equal(pane.querySelector('.story-block-scene'), null);

    const stray = show({ state: { text: `${FULL}\nThe guards have started asking questions about the stranger.` } });
    assert.match(stray.querySelector('.story-block-plain-text').textContent, /asking questions about the stranger/);

    // Re-rendering a fallback pane as a board drops the plain class.
    scene.render(pane, { def, state: { text: FULL } });
    assert.ok(pane.classList.contains('story-block-display-scene'));
    assert.ok(!pane.classList.contains('story-block-display-plain'));

    const rows = show({ state: { categories: [{ name: 'General', items: [{ name: 'Rope', quantity: '1', remark: '' }] }] } });
    assert.match(rows.textContent, /Rope/, 'a non-text state still reads');
});

test('empty, missing, error, truncated, edit; model text stays text', () => {
    assert.match(show({ state: null }).querySelector('.story-block-empty').textContent, /^No World State yet\.$/);
    assert.match(show({ state: { text: '  ' } }).querySelector('.story-block-empty').textContent, /^World State is empty\.$/);
    let edits = 0;
    const pane = show({
        state: { text: FULL.replace('Oilskin coat', '<img src=x onerror=alert(1)>') },
        error: 'The block is empty.',
        truncated: true,
        onEdit: () => { edits += 1; },
    });
    const notices = texts(pane, '.story-block-notice');
    assert.equal(notices[0], 'This reply\'s World State couldn\'t be read: The block is empty. Showing the last valid state.');
    assert.equal(notices[1], 'This reply\'s World State was cut off before it finished.');
    pane.querySelector('.story-block-edit').click();
    assert.equal(edits, 1);
    assert.equal(pane.querySelector('.story-block-edit').getAttribute('aria-label'), 'Edit World State');
    assert.equal(pane.querySelectorAll('img').length, 0);
    assert.match(pane.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.equal(show({ state: { text: FULL } }).querySelector('.story-block-edit'), null);
    assert.ok(show({ state: { text: 'Prose only, no scene here at all.' }, error: 'Bad' }).querySelector('.story-block-notice.is-error'), 'fallback keeps the notices');
});
