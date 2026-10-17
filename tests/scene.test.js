// World State text → scene (parseScene) and scene changes (diffScene).
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffScene, parseScene, phaseStep, stripMarkdown } from '../src/scene.js';
import { templateById } from '../src/templates.js';

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

test('full layout: header cells, PC, NPCs, off-screen, threads, seeds, timers, phases', () => {
    const scene = parseScene(FULL);
    assert.equal(scene.time, 'Day 14 of Harvestmoon, dusk');
    assert.equal(scene.location, 'Heron Ford | Willow camp', 'a pipe inside a value does not split the cell');
    assert.equal(scene.weather, 'Light rain, cool, firelight');
    assert.deepEqual(scene.pc, {
        name: 'Maelis',
        role: '',
        fields: {
            Outfit: 'Travel leathers, forearm bound in linen',
            Position: 'By the fire, sharpening the short sword',
            'Visible Condition': 'Tired, a bruise on the jaw',
            Carrying: 'Short sword, whetstone',
        },
    });
    assert.deepEqual(scene.people.map(person => [person.name, person.role]), [['Astra', 'companion'], ['Merrit', 'ferryman']]);
    assert.equal(scene.people[0].fields.Mood, 'Wary — keeps glancing at the treeline');
    assert.equal(scene.people[0].fields.Secret, 'She recognised the guild seal on the cutters\' blades');
    assert.deepEqual(scene.people[1].fields, {
        Outfit: 'Oilskin coat',
        Position: 'Sitting on an upturned crate',
        Agenda: 'Get paid',
        Weapon: 'A boat hook',
    }, 'unfilled placeholders dropped, unknown labels kept');
    assert.deepEqual(scene.offscreen, [
        { name: 'Captain Ivo', text: 'at the toll gate, questioning travellers' },
        { name: 'Sera', text: 'waiting at the inn' },
    ]);
    assert.deepEqual(scene.threads, ['Who hired the cutters?', 'The guild collector arrives in two days']);
    assert.deepEqual(scene.seeds, ['A lantern across the ford (someone is watching, 2 turns)', 'The torn map (3 turns)']);
    assert.deepEqual(scene.timers, ['Unpaid toll, guards come looking, 3 turns']);
    assert.equal(scene.arc, 'Escalation');
    assert.equal(scene.phase, 'Building');
});

test('compact layout: Time & Loc split at " at ", PC inline, one bullet per NPC', () => {
    const scene = parseScene([
        '**Time & Loc:** Dusk at Heron Ford',
        '**PC:** Travel leathers | Crouched by the fire',
        '**NPCs Present:**',
        '* Astra: Grey cloak | At the wagon',
        '* Merrit: Oilskin coat | On a crate, looking at the river',
    ].join('\n'));
    assert.equal(scene.time, 'Dusk');
    assert.equal(scene.location, 'Heron Ford');
    assert.deepEqual(scene.pc, { name: '', role: '', fields: { Outfit: 'Travel leathers', Position: 'Crouched by the fire' } });
    assert.deepEqual(scene.people, [
        { name: 'Astra', role: '', fields: { Outfit: 'Grey cloak', Position: 'At the wagon' } },
        { name: 'Merrit', role: '', fields: { Outfit: 'Oilskin coat', Position: 'On a crate, looking at the river' } },
    ]);
});

test('compact layout: a place containing " at " keeps its tail; an NPC without a pipe is still a person', () => {
    const scene = parseScene([
        '**Time & Loc:** Noon at The Rest at Kell Bridge',
        '**PC:** Cloak | Standing',
        '**NPCs Present:**',
        '* Astra: Grey cloak | At the wagon',
        '* Merrit: Leaning on the rail',
    ].join('\n'));
    assert.equal(scene.location, 'The Rest at Kell Bridge');
    assert.deepEqual(scene.people.map(person => person.name), ['Astra', 'Merrit']);
    assert.deepEqual(scene.people[1].fields, { Note: 'Leaning on the rail' }, 'one value without a pipe is not guessed to be the outfit');
});

test('loose output: no bold, blank lines, "-" bullets, other emoji or none, multi-line values', () => {
    const scene = parseScene([
        '⏰ Time: Night  |  Location: The Gilded Goose  |  Weather: Storm',
        '',
        '',
        '🧍 Maelis:',
        '- outfit: wet cloak',
        '- POSITION: at the bar',
        '',
        '',
        'NPCs Present:',
        '### Astra',
        '- Clothing: mail shirt',
        '- Mood: tense',
        '- Position: by the door,',
        '  watching the street',
        '- Secret: knows the barkeep',
        '',
        '• **Barkeep Hollis** (owner)',
        '• Mood: nervous',
        '',
        'Off-Screen: None',
        'Threads:',
        '- The missing courier',
        'Seeds:',
        '- A ring on the barkeep\'s hand',
        'Timers: The storm passes in 2 turns',
        'Arc Phase: Complication',
        'Scene Phase: Midpoint Tension',
    ].join('\n'));
    assert.equal(scene.time, 'Night');
    assert.equal(scene.location, 'The Gilded Goose');
    assert.equal(scene.weather, 'Storm');
    assert.deepEqual(scene.pc.fields, { Outfit: 'wet cloak', Position: 'at the bar' }, 'field names case-insensitive');
    assert.equal(scene.people[0].name, 'Astra');
    assert.deepEqual(scene.people[0].fields, {
        Outfit: 'mail shirt',
        Mood: 'tense',
        Position: 'by the door, watching the street',
        Secret: 'knows the barkeep',
    });
    assert.deepEqual(scene.people[1], { name: 'Barkeep Hollis', role: 'owner', fields: { Mood: 'nervous' } });
    assert.deepEqual(scene.offscreen, []);
    assert.deepEqual(scene.threads, ['The missing courier']);
    assert.deepEqual(scene.seeds, ['A ring on the barkeep\'s hand']);
    assert.deepEqual(scene.timers, ['The storm passes in 2 turns']);
    assert.equal(scene.arc, 'Complication');
    assert.equal(scene.phase, 'Midpoint Tension');
});

test('loose output: header cells on separate lines and the PC named by a "Player" label', () => {
    const scene = parseScene([
        '**Time:** Morning',
        '**Location:** Market square',
        '**Player — Maelis:**',
        '* Outfit: Leathers',
        '**👥 NPCs Present:**',
        '**👤 Astra:**',
        '* Position: At the stall',
    ].join('\n'));
    assert.equal(scene.time, 'Morning');
    assert.equal(scene.location, 'Market square');
    assert.equal(scene.pc.name, 'Maelis');
    assert.deepEqual(scene.pc.fields, { Outfit: 'Leathers' });
    assert.deepEqual(scene.people.map(person => person.name), ['Astra']);
});

test('the first person is the PC only when the NPCs divider follows them', () => {
    const withDivider = parseScene('**Maelis:**\n* Outfit: Leathers\n**NPCs Present:**\n**Astra:**\n* Mood: wary');
    assert.equal(withDivider.pc.name, 'Maelis');
    assert.deepEqual(withDivider.people.map(person => person.name), ['Astra']);
    const without = parseScene('**Astra:**\n* Mood: wary\n**Merrit:**\n* Mood: bored');
    assert.equal(without.pc, null);
    assert.deepEqual(without.people.map(person => person.name), ['Astra', 'Merrit']);
});

test('placeholders: unfilled ones dropped, a bracketed answer kept, an unfilled name ends the person', () => {
    const scene = parseScene([
        '**📅 Time:** Dusk | **🌤 Loc:** [Place | Region] | **🌡 Wx:** [Weather, Temp, Lighting]',
        '**🧍 {{user}}:**',
        '* *Outfit:* [Current clothing, accessories, state of dress]',
        '* *Position:* Kneeling',
        '**👥 NPCs Present:**',
        '**Astra:**',
        '* *Mood:* [anxious]',
        '**[NPC Name]:**',
        '* *Outfit:* [Current clothing]',
        '* *Mood:* [Current visible emotional surface]',
        '**🎯 Arc Phase:** [Setup / Escalation / Complication / Crisis / Resolution]',
    ].join('\n'));
    assert.equal(scene.time, 'Dusk');
    assert.equal(scene.location, '');
    assert.equal(scene.weather, '');
    assert.deepEqual(scene.pc, { name: '', role: '', fields: { Position: 'Kneeling' } }, 'an unsubstituted {{user}} is no name');
    assert.deepEqual(scene.people, [{ name: 'Astra', role: '', fields: { Mood: 'anxious' } }]);
    assert.equal(scene.arc, '');
});

test('placeholders: a customised layout\'s own placeholders are dropped too', () => {
    const text = '**Time:** Dusk\n**Astra:**\n* Mood: wary\n* Hunger: [How hungry they look]';
    assert.equal(parseScene(text).people[0].fields.Hunger, 'How hungry they look');
    const custom = parseScene(text, { layout: '* Hunger: [How hungry they look]' });
    assert.equal(custom.people[0].fields.Hunger, undefined);
});

test('the unfilled template itself is not a scene', () => {
    assert.equal(parseScene(templateById('world-state').layout), null);
});

test('null for text that is not a World State', () => {
    assert.equal(parseScene(''), null);
    assert.equal(parseScene(null), null);
    assert.equal(parseScene('She walked into the tavern and ordered an ale. It was raining.'), null);
    assert.equal(parseScene('HP: 80\nGold: 5\nStatus: fine'), null, 'a character sheet');
    assert.equal(parseScene('1. Ask Astra what she saw\n2. Take first watch\n3. Follow the light'), null, 'choices');
    assert.equal(parseScene('**Time:** Dusk'), null, 'one header cell and nothing else');
    assert.equal(parseScene('**Note:** The guards are on alert tonight.'), null, 'one bold label is not a person');
    assert.equal(parseScene('**Astra:** She is wary and keeps to the door.'), null, 'nor one bold name with a sentence');
});

test('null rather than a board that drops a sentence', () => {
    const text = `${FULL}\n\nThe guards have started asking questions about the stranger with the sword.`;
    // The stray line follows Scene Phase, where nothing can hold it.
    assert.equal(parseScene(text), null);
    const midPerson = FULL.replace('* *Agenda:* Get paid', '* *Agenda:* Get paid\nHe hums an old river song under his breath.');
    assert.equal(parseScene(midPerson).people[1].fields.Agenda, 'Get paid He hums an old river song under his breath.', 'a line under a field continues it');
});

test('a bullet under nobody in the cast is not silently lost', () => {
    assert.equal(parseScene('**Time:** Dusk\n**👥 NPCs Present:**\n**[NPC Name]:**\n* Outfit: A long red coat with brass buttons'), null);
});

test('stripMarkdown and phaseStep', () => {
    assert.equal(stripMarkdown('**bold** and *italic* and __u__'), 'bold and italic and u');
    assert.equal(stripMarkdown('2 * 3 * 4'), '2 * 3 * 4');
    assert.equal(phaseStep('arc', 'Escalation'), 1);
    assert.equal(phaseStep('arc', 'late crisis, heading to resolution'), 3);
    assert.equal(phaseStep('phase', 'midpoint tension'), 2);
    assert.equal(phaseStep('phase', 'Aftermath'), -1);
    assert.equal(phaseStep('arc', ''), -1);
});

// ---- diffScene -------------------------------------------------------------------------

const NEXT = FULL
    .replace('Day 14 of Harvestmoon, dusk', 'Day 14 of Harvestmoon, night')
    .replace('* *Position:* At the wagon, counting rations', '* *Position:* Beside Maelis at the fire')
    .replace('She recognised the guild seal', 'She was paid by the guild')
    .replace(/\*\*Merrit \(ferryman\):\*\*[\s\S]*?\* \*Weapon:\* A boat hook\n/, '**Ivo — captain:**\n* *Outfit:* Steel cap\n* *Position:* Wading across the ford\n')
    .replace('* Who hired the cutters?\n', '* Who hired the cutters?\n* Why is the captain here?\n')
    .replace('* The guild collector arrives in two days\n', '')
    .replace('**🎬 Scene Phase:** Building', '**🎬 Scene Phase:** Midpoint Tension');

test('diffScene: scene fields, people joining and leaving, field changes, threads', () => {
    const changes = diffScene(FULL, NEXT);
    assert.deepEqual(changes, [
        { type: 'changed', label: 'Time', from: 'Day 14 of Harvestmoon, dusk', to: 'Day 14 of Harvestmoon, night' },
        { type: 'changed', label: 'Scene Phase', from: 'Building', to: 'Midpoint Tension' },
        { type: 'changed', label: 'Astra · Position', from: 'At the wagon, counting rations', to: 'Beside Maelis at the fire' },
        { type: 'added', label: 'Ivo', to: 'Wading across the ford' },
        { type: 'removed', label: 'Merrit', from: 'Sitting on an upturned crate' },
        { type: 'added', label: 'Why is the captain here?' },
        { type: 'removed', label: 'The guild collector arrives in two days' },
    ]);
});

test('diffScene: secrets never appear, even when they change', () => {
    const changes = diffScene(FULL, NEXT);
    const all = JSON.stringify(changes);
    assert.doesNotMatch(all, /secret/i);
    assert.doesNotMatch(all, /guild seal|paid by the guild/);
    const added = diffScene(FULL.replace('* *Agenda:* Get paid', '* *Agenda:* Get paid\n* *Secret:* He smuggles for the cutters'), FULL);
    assert.doesNotMatch(JSON.stringify(added), /smuggles|Secret/);
});

test('diffScene: PC fields under the PC\'s name, or "You" when unnamed', () => {
    const changes = diffScene(FULL, FULL.replace('Short sword, whetstone', 'Whetstone'));
    assert.deepEqual(changes, [{ type: 'changed', label: 'Maelis · Carrying', from: 'Short sword, whetstone', to: 'Whetstone' }]);
    const compact = diffScene('**PC:** Leathers | Standing\n**NPCs Present:**\n* Astra: Cloak | Sitting', '**PC:** Leathers | Sitting\n**NPCs Present:**\n* Astra: Cloak | Sitting');
    assert.deepEqual(compact, [{ type: 'changed', label: 'You · Position', from: 'Standing', to: 'Sitting' }]);
});

test('diffScene: whitespace and markdown-only differences are not changes', () => {
    const reformatted = FULL
        .replace('* *Outfit:* Oilskin coat', '-   **Outfit:**   Oilskin   coat')
        .replace('* Who hired the cutters?', '* *Who hired the cutters?*');
    assert.deepEqual(diffScene(FULL, reformatted), []);
    assert.deepEqual(diffScene(FULL, FULL), []);
});

test('diffScene: [] when either side does not parse', () => {
    assert.deepEqual(diffScene('Just prose about the evening and the rain.', FULL), []);
    assert.deepEqual(diffScene(FULL, ''), []);
    assert.deepEqual(diffScene(null, null), []);
});

test('a bold name with its role outside the bold, and a bold scene cell after the cast', () => {
    const scene = parseScene([
        '**Time:** Dusk',
        '**Astra** — companion',
        '* Mood: wary',
        '**Merrit** (ferryman)',
        '- Outfit: Oilskin coat',
        '- Location: by the boat',
        '**Weather:** Fog rolling in',
    ].join('\n'));
    assert.deepEqual(scene.people, [
        { name: 'Astra', role: 'companion', fields: { Mood: 'wary' } },
        { name: 'Merrit', role: 'ferryman', fields: { Outfit: 'Oilskin coat', Location: 'by the boat' } },
    ]);
    assert.equal(scene.weather, 'Fog rolling in');
});

test('a time with a colon in it stays one value', () => {
    const scene = parseScene('Time: 8:30 PM | Loc: Docks\n**Astra:**\n* Mood: calm');
    assert.equal(scene.time, '8:30 PM');
    assert.equal(scene.location, 'Docks');
});

test('sceneHeaderFields and setSceneHeaderField: the header cells a hand editor offers', async () => {
    const { sceneHeaderFields, setSceneHeaderField } = await import('../src/scene.js');
    const text = '**📅 Time:** CY 611, Haywane 12, 05:35 pm | **🌤 Loc:** Auvoth | Seventh Seal Terrace | [59.0, 110.0] | **🌡 Wx:** Freezing rain\n---\n**🧍 Ren:**\n* *Outfit:* Drake armor';
    assert.deepEqual(sceneHeaderFields(text), { time: 'CY 611, Haywane 12, 05:35 pm', location: 'Auvoth | Seventh Seal Terrace | [59.0, 110.0]', weather: 'Freezing rain' });
    const moved = setSceneHeaderField(text, 'location', 'Shorn | North Gate | [50, 95]');
    assert.equal(moved.split('\n')[0], '**📅 Time:** CY 611, Haywane 12, 05:35 pm | **🌤 Loc:** Shorn | North Gate | [50, 95] | **🌡 Wx:** Freezing rain');
    assert.equal(moved.split('\n').slice(1).join('\n'), text.split('\n').slice(1).join('\n'), 'the rest untouched');
    assert.match(setSceneHeaderField(text, 'weather', 'Clear\nand cold'), /\*\*🌡 Wx:\*\* Clear and cold\n/);
    assert.equal(setSceneHeaderField('Time: dusk | Loc: Heron Ford', 'time', 'dawn'), 'Time: dawn | Loc: Heron Ford');
    assert.equal(setSceneHeaderField(text, 'mood', 'x'), text, 'an unknown cell changes nothing');
    assert.deepEqual(sceneHeaderFields('Just prose.'), {});
});
