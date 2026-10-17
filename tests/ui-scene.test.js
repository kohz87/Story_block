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

test('hidden off-screen: a count and Reveal, no entries in the page until revealed; remembered', () => {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    scene.render(pane, { def, uiKey: 'offscreen-memory', state: { text: FULL }, hideOffscreen: true });
    const section = pane.querySelector('.story-block-scene-section.is-offscreen');
    assert.ok(section.classList.contains('is-locked'));
    assert.equal(section.querySelector('.story-block-scene-off-count').textContent, '2 behind the scenes');
    assert.equal(section.querySelectorAll('.story-block-scene-off-item').length, 0);
    assert.doesNotMatch(pane.textContent, /Captain Ivo|toll gate|Sera/);
    // The secret's button comes first; the off-screen one sits in its heading.
    const toggle = section.querySelector('.story-block-scene-reveal');
    assert.equal(toggle.textContent, 'Reveal');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), section.querySelector('.story-block-scene-off-body').id);

    let reached = 0;
    pane.addEventListener('click', () => { reached += 1; });
    toggle.click();
    assert.equal(reached, 0, 'the click does not reach the message');
    assert.equal(toggle.textContent, 'Hide');
    assert.ok(!section.classList.contains('is-locked'));
    assert.deepEqual(texts(section, '.story-block-scene-off-name'), ['Captain Ivo', 'Sera']);
    assert.equal(section.querySelector('.story-block-scene-off-count').textContent, '');

    // Stays revealed across a re-render, even when the entries move on.
    scene.render(pane, { def, uiKey: 'offscreen-memory', state: { text: FULL.replace('at the toll gate', 'at the bridge') }, hideOffscreen: true });
    assert.match(pane.querySelector('.story-block-scene-section.is-offscreen').textContent, /at the bridge/);
    pane.querySelector('.story-block-scene-section.is-offscreen .story-block-scene-reveal').click();
    assert.doesNotMatch(pane.textContent, /Captain Ivo/);
    // The secret is still its own, hidden.
    assert.doesNotMatch(pane.textContent, /guild seal/);
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

test('changes from previousState: dots on chips, rows, moods and threads; one folded section words them; secrets never', () => {
    const pane = show({ state: { text: NEXT }, previousState: { text: FULL } });
    assert.ok(pane.querySelector('.story-block-scene-chip.is-time .story-block-change-dot'), 'a dot, not a coloured border');
    assert.equal(pane.querySelectorAll('.story-block-scene-chip.is-changed').length, 0, 'chips keep one look');

    const astra = pane.querySelectorAll('.story-block-scene-person')[1];
    assert.ok(astra.querySelector('.story-block-scene-row.is-position .story-block-scene-k .story-block-change-dot'));
    assert.ok(astra.querySelector('.story-block-scene-person-head .story-block-change-dot'), 'the mood change is a dot beside the pill');
    assert.equal(pane.querySelector('.story-block-scene-change-text'), null, 'no inline from → to under the fields');

    const ivo = pane.querySelectorAll('.story-block-scene-person')[2];
    assert.equal(ivo.querySelector('.story-block-scene-tag.is-new').textContent, 'new');
    assert.equal(pane.querySelectorAll('.story-block-scene-person.is-added').length, 0, 'every card keeps the same border');
    assert.ok(pane.querySelector('.story-block-scene-items.is-threads .story-block-scene-item .story-block-change-dot'));

    const section = pane.querySelector('.story-block-changes');
    assert.equal(section.open, false);
    assert.equal(section.querySelector('.story-block-changes-title').textContent, 'Changed this turn');
    const lines = texts(section, '.story-block-changes-text');
    assert.equal(section.querySelector('.story-block-changes-count').textContent, String(lines.length));
    assert.ok(lines.includes('Astra · Position: At the wagon, counting rations → Beside Maelis at the fire'));
    assert.ok(lines.includes('Maelis · Carrying: Short sword, whetstone → —'));
    assert.ok(lines.includes('Merrit left'));
    assert.ok(lines.includes('Thread closed: The guild collector arrives in two days'));
    assert.ok(lines.some(line => /^Ivo\b.* joined$/.test(line)));
    assert.ok(lines.some(line => line.startsWith('New thread: Why is the captain')));
    assert.equal(pane.querySelector('.story-block-scene-removed'), null);
    assert.equal(pane.querySelector('.story-block-scene-delta'), null);
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
    assert.deepEqual(pane.querySelectorAll('.story-block-scene-chip').filter(chip => chip.querySelector('.story-block-change-dot')).map(chip => chip.classList.contains('is-weather')), [true]);
    assert.ok(pane.querySelector('.story-block-scene-row.is-agenda.is-changed .story-block-change-dot'));
    assert.doesNotMatch(pane.textContent, /old secret|new secret/);
    const section = pane.querySelector('.story-block-changes');
    assert.equal(section.querySelector('.story-block-changes-title').textContent, 'Changed in an earlier reply');
    assert.match(section.querySelector('.story-block-changes-summary').title, /did not update/);
    assert.deepEqual(texts(section, '.story-block-changes-text'), [
        'Weather: Clear → Light rain, cool, firelight',
        'astra · agenda: Sleep → Make the food last to the city',
        'Weird: no longer written',
    ]);
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
    assert.match(show({ state: null }).querySelector('.story-block-empty').textContent, /^No World State in the latest reply\.$/);
    assert.match(show({ state: { text: '  ' } }).querySelector('.story-block-empty').textContent, /^World State is empty\. It fills in as the story goes\.$/);
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

// Many-part lines (`now X | then: Y | on: Z`) are split into short labelled rows; the text
// stays the state exactly as written.
const PIPED = [
    '**📅 Time:** CY 611, Haywane 12, 05:35 pm | **🌤 Loc:** Auvoth | Leased Mansion Main Hall | [59.0, 110.0] | **🌡 Wx:** Freezing rain',
    '',
    '**🧍 {{user}}:**',
    '* *Outfit:* Soaked drake armor',
    '* *Visible Condition:* visible: soaked in sludge | hidden: soul strain 0%',
    '',
    '**📡 Off-Screen:**',
    '* **Senior Listener Geva — now:** District Bailiff Court | then: argues with magistrates | on: Haywane 12, 05:45 pm',
    '* **Hooks:** Inquest at the mansion gate',
    '',
    '**🔥 Unresolved Threads:**',
    '* Who tipped the Bailiff Court | then: warrants reissued | on: Haywane 13',
    '* Cold hands',
].join('\n');

test('scene: piped facts become labelled rows; names lose their "— now"; coordinates are dimmed', () => {
    const pane = show({ state: { text: PIPED } });
    const off = pane.querySelectorAll('.story-block-scene-off-item');
    assert.equal(off[0].querySelector('.story-block-scene-off-name').textContent, 'Senior Listener Geva');
    assert.deepEqual(texts(off[0], 'dt'), ['now', 'then', 'on']);
    assert.deepEqual(texts(off[0], 'dd'), ['District Bailiff Court', 'argues with magistrates', 'Haywane 12, 05:45 pm']);
    assert.equal(off[1].querySelector('dl'), null, 'a single plain fact stays a line of text');
    assert.equal(off[1].querySelector('.story-block-scene-off-text').textContent, 'Inquest at the mansion gate');

    const condition = pane.querySelector('.story-block-scene-row.is-visible-condition');
    assert.deepEqual(texts(condition, 'dt'), ['visible', 'hidden']);
    assert.equal(pane.querySelector('.story-block-scene-row.is-outfit dl'), null, 'a one-part field is untouched');

    assert.equal(pane.querySelector('.story-block-scene-coords').textContent, '[59.0, 110.0]');
    assert.match(pane.querySelector('.story-block-scene-chip.is-location').textContent, /Auvoth · Leased Mansion Main Hall · \[59\.0, 110\.0\]/);

    const threads = pane.querySelector('.story-block-scene-items.is-threads');
    assert.ok(threads.classList.contains('is-rows'), 'a group with a many-part item is drawn as rows');
    assert.equal(threads.querySelector('.story-block-scene-item-head').textContent, 'Who tipped the Bailiff Court');
    assert.deepEqual(texts(threads, 'dt'), ['then', 'on']);
});

test('splitFacts and nameAndLead', () => {
    assert.deepEqual(scene.splitFacts('Court | then: argues | on: noon', 'now'), [
        { label: 'now', value: 'Court' }, { label: 'then', value: 'argues' }, { label: 'on', value: 'noon' },
    ]);
    assert.deepEqual(scene.splitFacts('She said it quietly: run'), [{ label: '', value: 'She said it quietly: run' }], 'labels are at most three words');
    assert.deepEqual(scene.nameAndLead('Senior Listener Geva — now'), { name: 'Senior Listener Geva', lead: 'now' });
    assert.deepEqual(scene.nameAndLead('Jean-Luc'), { name: 'Jean-Luc', lead: '' });
});

test('scene: World is its own list, Hooks read as threads, and `Key — what` items get a heading', () => {
    const text = [
        '**📅 Time:** Haywane 12, dusk | **🌤 Loc:** Auvoth',
        '**🌍 World:**',
        '* Canal Street Granary Fires — Lower city ablaze | then: curfew declared | on: Haywane 12, 06:00 pm',
        '**🔥 Hooks:**',
        '* River stranger — who pulled Ren from the sump | then: he sends word | on: Haywane 15',
        '**⏳ Clocks:**',
        '* Hollin\'s Reach graves — the dead rise | due: Goldwane 28',
    ].join('\n');
    const pane = show({ state: { text } });
    const world = pane.querySelector('.story-block-scene-items.is-world');
    assert.ok(world, 'a World list');
    assert.equal(world.querySelector('.story-block-scene-item-head').textContent, 'Canal Street Granary Fires');
    assert.deepEqual(texts(world, 'dd'), ['Lower city ablaze', 'curfew declared', 'Haywane 12, 06:00 pm']);
    const hooks = pane.querySelector('.story-block-scene-items.is-threads');
    assert.equal(hooks.querySelector('.story-block-scene-item-head').textContent, 'River stranger');
    assert.ok(pane.querySelector('.story-block-scene-items.is-timers'), 'Clocks read as timers');
});
