// The RPG block templates: the keys and ranges the RPG reads, the block limits, and the party fixture
// (Wessel, Ren and Tamsin as in mockup v3) that the RPG tests share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STANDARD_TEMPLATES, SKILL_SETS, characterV1For } from '../../../src/v2/lean-rpg/templates.js';
import { CREATION, ROLES, STATS, USES } from '../../../src/v2/lean-rpg/index.js';
import { validateDataModules, DM_LIMITS as L } from '../../../src/v2/data-modules/check.js';

const party = JSON.parse(readFileSync(new URL('fixtures/party.json', import.meta.url), 'utf8'));
const template = name => STANDARD_TEMPLATES.find(entry => entry.name === name).definition;
const CHECK = { packId: 'chat', capabilities: ['data-modules-v1', 'story-director'] };
const COMBAT_HEADINGS = ['No Plot Armor:', 'Exchanges:', 'Weight & Risk:', 'Believable Outcomes:'];

test('the four templates come in chooser order, each with a known role', () => {
    assert.deepEqual(STANDARD_TEMPLATES.map(entry => entry.name), ['Character', 'Skills', 'Foes', 'Combat rules']);
    assert.deepEqual(STANDARD_TEMPLATES.map(entry => entry.definition.role), ['character', 'skills', 'foes', 'rules']);
    for (const { definition } of STANDARD_TEMPLATES) assert.ok(ROLES.includes(definition.role), definition.role);
});

test('each template is a chat-scoped data module with a unique slug, schema 1 and a state version, and fits the byte limit', () => {
    const slugs = STANDARD_TEMPLATES.map(entry => entry.definition.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const { definition } of STANDARD_TEMPLATES) {
        assert.equal(definition.scope, 'chat');
        assert.equal(definition.schema, 1);
        assert.ok(Number.isSafeInteger(definition.stateVersion) && definition.stateVersion >= 1, definition.slug);
        assert.match(definition.slug, /^[a-z0-9][a-z0-9-]{0,39}$/);
        assert.ok(Buffer.byteLength(JSON.stringify(definition)) <= L.definitionBytes, definition.slug);
    }
});

test('every block stays inside the field, kind and text limits', () => {
    for (const { definition } of STANDARD_TEMPLATES) {
        // The block engine's limit is DM_LIMITS.fields (32), not 16. (Pinned change, extra skill slots: the Skills block's eight slots of six fields, its `who`
        // and the signature mark are 50, inside DM_LIMITS.skillsFields, the limit of a block with the role `skills`.)
        assert.ok(Object.keys(definition.state).length <= (definition.role === 'skills' ? L.skillsFields : L.fields), `${definition.slug} fields`);
        assert.ok(Object.keys(definition.kinds).length <= L.kinds, `${definition.slug} kinds`);
        for (const field of Object.values(definition.state)) if (field.type === 'text') assert.ok(field.max <= L.text);
        for (const kind of Object.values(definition.kinds)) for (const label of Object.values(kind.labels)) {
            if (label.type === 'text') assert.ok(label.max <= L.text);
        }
    }
});

test('the Character block has the keys the RPG reads, with their ranges and stage names', () => {
    const { state, kinds } = template('Character');
    assert.deepEqual(Object.keys(state), ['who', 'about', 'health', 'mana', 'stamina', ...STATS, 'points', 'level', 'xp', 'rise', 'cap', 'down', 'alive', 'left', 'health-blocks', 'stamina-blocks', 'mana-blocks']);
    assert.equal(state.who.type, 'text');
    assert.deepEqual([state.about.type, state.about.max, state.about.label], ['text', 240, 'Who they are']);
    assert.notEqual(state.about.prompt, false, 'who they are is read by the AI in the tail');
    assert.equal(state.about.edit, undefined, 'and the reader can edit it');
    // (the bars are rows of blocks with the doubled sizes, scale 2: up to 2 x (4 + 20/5) = 16 each, with a hidden field that remembers its size; no stage names)
    assert.deepEqual([state.health.min, state.health.max, state.health.blocks, state.health.scale], [0, 16, 'health', 2]);
    assert.deepEqual([state.mana.min, state.mana.max, state.mana.blocks, state.mana.scale], [0, 16, 'mana', 2]);
    assert.deepEqual([state.stamina.min, state.stamina.max, state.stamina.blocks, state.stamina.scale], [0, 16, 'stamina', 2]);
    for (const key of ['health-blocks', 'stamina-blocks', 'mana-blocks']) assert.deepEqual([state[key].edit, state[key].prompt], [false, false], key);
    for (const stat of STATS) assert.deepEqual([state[stat].min, state[stat].max], [1, 20], stat);
    assert.deepEqual([state.points.min, state.points.max], [0, 60]);
    assert.deepEqual([state.level.min, state.level.max, state.level.default, state.level.label], [1, 99, 1, 'Level']);
    assert.equal(state.level.names, undefined, 'a level is a number, no longer named I to IX');
    assert.equal(state.soul, undefined, 'no Soul Class field in a new template');
    assert.deepEqual([state.cap.min, state.cap.max, state.cap.default, state.cap.label, state.cap.prompt], [1, 99, 99, 'Level cap', false]);
    assert.deepEqual([state.xp.min, state.xp.max], [0, 9999], "XP past 100 is kept for the rise");
    assert.equal(state.down.type, 'bool');
    assert.equal(state.down.prompt, false, 'Down is hidden from the narrator');
    assert.equal(state.alive.type, 'bool');
    assert.deepEqual(Object.keys(kinds), ['set-health', 'set-mana', 'set-stamina', 'add-xp', 'button-rest']);
    assert.equal(kinds['button-rest'].ui, true);
    // Stats and points are set by the reader only: no kind writes them.
    const touched = Object.values(kinds).flatMap(kind => kind.effects.map(effect => effect.path[0]));
    for (const field of [...STATS, 'points']) assert.ok(!touched.includes(field), field);
});

test('the Skills block has eight slots of name, description, stat, resource, rank and practice and the signature mark: 50 fields, 16 kinds', () => {
    const { state, kinds, rules } = template('Skills');
    assert.equal(Object.keys(state).length, 50);
    assert.equal(Object.keys(kinds).length, 16);
    assert.equal(state.who.type, 'text');
    for (let n = 1; n <= 8; n++) {
        assert.deepEqual([state[`skill${n}`].type, state[`skill${n}`].max], ['text', 40]);
        assert.deepEqual([state[`about${n}`].type, state[`about${n}`].max], ['text', 120]);
        assert.notEqual(state[`about${n}`].prompt, false, 'what a skill does is read by the AI');
        assert.deepEqual([state[`stat${n}`].type, state[`stat${n}`].values], ['enum', [...STATS]]);
        assert.deepEqual([state[`uses${n}`].type, state[`uses${n}`].values, state[`uses${n}`].default], ['enum', ['stamina', 'mana'], 'stamina']);
        assert.deepEqual([state[`rank${n}`].min, state[`rank${n}`].max], [0, 3]);
        assert.deepEqual(Object.values(state[`rank${n}`].names), ['Novice', 'Adept', 'Expert', 'Master']);
        assert.deepEqual([state[`practice${n}`].min, state[`practice${n}`].max], [0, 100]);
        assert.equal(state[`rank${n}`].edit, false, `rank ${n} only moves through play`);
        assert.equal(state[`practice${n}`].edit, false, `practice ${n} only moves through play`);
        for (const key of ['skill', 'about', 'stat', 'uses']) assert.notEqual(state[`${key}${n}`].edit, false, `${key}${n} is the reader's to fix`);
        assert.ok(kinds[`learn-${n}`] && kinds[`practice-${n}`], `kinds for slot ${n}`);
        assert.deepEqual(Object.keys(kinds[`learn-${n}`].labels), ['name', 'about', 'stat', 'uses']);
        assert.deepEqual(kinds[`learn-${n}`].effects.map(effect => effect.path[0]), [`skill${n}`, `about${n}`, `stat${n}`, `uses${n}`], 'a learn line sets the four and nothing else');
        assert.ok(rules.some(rule => rule.id === `rank-up-${n}`), `rank rule for slot ${n}`);
    }
});

test('the Foes block has four slots of name, count, level (1 to 99) and health blocks', () => {
    const { state, kinds } = template('Foes');
    for (let n = 1; n <= 4; n++) {
        assert.equal(state[`foe${n}`].type, 'text');
        assert.deepEqual([state[`count${n}`].min, state[`count${n}`].max], [0, 99]);
        assert.deepEqual([state[`level${n}`].min, state[`level${n}`].max, state[`level${n}`].default], [1, 99, 1]);
        assert.equal(state[`class${n}`], undefined, 'no Soul Class on a foe');
        assert.deepEqual([state[`hurt${n}`].min, state[`hurt${n}`].max, state[`hurt${n}`].blocks], [0, 8, 'foe']);
        for (const kind of [`set-slot-${n}`, `hurt-${n}`, `clear-${n}`]) assert.ok(kinds[kind], kind);
    }
});

test('a rise is a plain rule: XP at 100 raises the Level (below the cap), resets XP and gives a point every third level, practice at 100 raises the rank', () => {
    const character = template('Character');
    const levelUp = character.rules.find(rule => rule.id === 'level-up');
    assert.equal(character.rules.some(rule => rule.id === 'class-up'), false);
    assert.deepEqual(levelUp.when, ['and', ['ge', ['get', ['xp']], 100], ['lt', ['get', ['level']], ['get', ['cap']]]]);
    const rise = ['min', ['floorDiv', ['get', ['xp']], 100], ['sub', ['get', ['cap']], ['get', ['level']]]];
    assert.deepEqual(levelUp.then, [{ op: 'set', path: ['rise'], value: rise },
        { op: 'add', path: ['points'], value: ['sub', ['floorDiv', ['add', ['get', ['level']], ['get', ['rise']]], 3], ['floorDiv', ['get', ['level']], 3]], bounds: 'clamp' },
        { op: 'add', path: ['level'], value: ['get', ['rise']], bounds: 'clamp' }, { op: 'add', path: ['xp'], value: ['mul', ['get', ['rise']], -100], bounds: 'clamp' }, { op: 'set', path: ['rise'], value: 0 }],
        '2.17.0: the rise is worked out once (min of the XP\'s hundreds and the room under the cap), carries the XP over 100 and gives a point for every multiple of 3 crossed');
    assert.deepEqual(character.rules.find(rule => rule.id === 'xp-cap').then, [{ op: 'set', path: ['xp'], value: 100 }], 'at the cap the XP past 100 is not kept');
    for (const rule of template('Skills').rules) {
        const n = rule.id.at(-1);
        assert.deepEqual(rule.when, ['and', ['ge', ['get', [`practice${n}`]], 100], ['lt', ['get', [`rank${n}`]], 3]]);
        assert.deepEqual(rule.then, [{ op: 'add', path: [`rank${n}`], value: 1, bounds: 'clamp' }, { op: 'set', path: [`practice${n}`], value: 0 }]);
    }
});

test('death is a latch of two reply-end functions in that order, then a card that ends the story', () => {
    const { replyEnd, cards } = template('Character');
    const ends = replyEnd.filter(fn => fn.type === 'reply-end');
    assert.equal(ends.length, 2);
    assert.deepEqual(ends[0].effects, [{ op: 'set', path: ['alive'], value: false }]);
    assert.deepEqual(ends[0].when, ['and', ['eq', ['get', ['health']], 0], ['get', ['down']]]);
    assert.deepEqual(ends[1].effects, [{ op: 'set', path: ['down'], value: ['eq', ['get', ['health']], 0] }]);
    assert.equal(cards.length, 1);
    const card = cards[0];
    assert.equal(card.tone, 'end');
    assert.equal(card.title, 'The story ends here');
    assert.ok(card.text.length <= 240 && card.title.length <= 60);
});

test('the combat rules text is the [COMBAT SYSTEM] prompt with a line on rolls and one of XP guidance', () => {
    const { prompt, state, kinds } = template('Combat rules');
    const lines = prompt.split('\n');
    assert.equal(lines.length, 7);
    assert.equal(lines[0], '[COMBAT SYSTEM]');
    COMBAT_HEADINGS.forEach((heading, index) => assert.ok(lines[index + 1].startsWith(heading), heading));
    assert.match(lines[5], /^Rolls: tell the rolled result as given; code moves the bars for hits, heals, skill costs: never set those\.$/);
    assert.match(lines[6], /^XP guide: code gives XP for a won fight and practises rolled skills; write none for them\. Other deeds 5 to 40\.$/);
    assert.ok([...prompt].length <= 1200);
    assert.deepEqual(state, {});
    assert.deepEqual(kinds, {});
});

// Without the block-engine keys (role, names, prompt: false, replyEnd, cards), each definition is still a plain
// 2.7 definition: the shapes the RPG adds sit only in those keys.
test('without the new block-engine keys, each template passes the data-module checker', () => {
    for (const { definition } of STANDARD_TEMPLATES) {
        const legacy = definition.role === 'character' ? characterV1For() : structuredClone(definition);
        // (pinned change, extra skill slots: the Skills block's eight slots need the role's larger field limit, so its role stays)
        if (definition.role !== 'skills') delete legacy.role;
        delete legacy.replyEnd;
        delete legacy.cards;
        for (const field of Object.values(legacy.state)) {
            delete field.names;
            delete field.prompt;
        }
        // The combat prompt is over 2.7's 600-character cap (1200 now).
        if ([...(legacy.prompt ?? '')].length > 600) delete legacy.prompt;
        const result = validateDataModules([legacy], CHECK);
        assert.equal(result.ok, true, `${definition.slug}: ${JSON.stringify(result.errors)}`);
    }
});

test('the templates pass the data-module checker with the block-engine keys', () => {
    const refused = STANDARD_TEMPLATES.map(({ definition }) => [definition.slug, validateDataModules([definition], CHECK)])
        .filter(([, result]) => !result.ok).map(([slug, result]) => `${slug}: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(refused, []);
});

test('the party fixture gives every block all of its template fields, inside their ranges', () => {
    for (const block of party.blocks) {
        const { state } = template(block.template === 'Foes' ? 'Foes' : block.template);
        // (pinned change, extra skill slots: the fixture's Skills block is one made before them, with five slots and no signature mark: a subset of today's template)
        // (and the Character and Foes blocks are ones made before the bars were rows of blocks: they hold no `*-blocks` fields)
        assert.ok(Object.keys(block.fields).every(key => key in state), block.slug);
        if (block.template !== 'Skills' && block.template !== 'Character') assert.deepEqual(Object.keys(block.fields).sort(), Object.keys(state).sort(), block.slug);
        for (const [key, value] of Object.entries(block.fields)) {
            const field = state[key];
            if (field.type === 'int') {
                assert.ok(Number.isSafeInteger(value) && value >= field.min && value <= field.max, `${block.slug}.${key}`);
            } else if (field.type === 'bool') {
                assert.equal(typeof value, 'boolean', `${block.slug}.${key}`);
            } else if (field.type === 'enum') {
                assert.ok(field.values.includes(value), `${block.slug}.${key}`);
            } else {
                assert.equal(typeof value, 'string', `${block.slug}.${key}`);
                assert.ok([...value].length <= field.max, `${block.slug}.${key}`);
            }
        }
    }
});

test('the party fixture reads as mockup v3: Wessel is Level 15 with 3 points, and his Skills block has Iron Breath at Expert', () => {
    const wessel = party.blocks.find(block => block.slug === 'wessel');
    assert.equal(wessel.fields.level, 15);
    assert.equal(wessel.fields.points, 3);
    const iron = party.blocks.find(block => block.slug === 'wessel-skills');
    assert.equal(iron.fields.skill1, 'Iron Breath');
    assert.equal(template('Skills').state.rank1.names[String(iron.fields.rank1)], 'Expert');
});

test('the built-in skill sets are five, three skills each, every one with what it does, a stat and a resource within the Skills limits', () => {
    assert.deepEqual(SKILL_SETS.map(set => set.name), ['Guild fighter', 'River scout', 'Hedge mage', 'Field medic', 'Silver tongue']);
    assert.equal(new Set(SKILL_SETS.map(set => set.id)).size, 5);
    const { state } = template('Skills');
    for (const set of SKILL_SETS) {
        assert.equal(set.skills.length, 3, set.name);
        assert.ok(set.about.length > 0 && [...set.about].length <= 160, set.name);
        for (const skill of set.skills) {
            assert.ok(skill.name && [...skill.name].length <= state.skill1.max, `${set.name}: ${skill.name}`);
            assert.ok(skill.about && [...skill.about].length <= state.about1.max, `${set.name}: ${skill.name} about`);
            assert.ok(state.stat1.values.includes(skill.stat), `${skill.name} stat`);
            assert.ok(USES.includes(skill.uses), `${skill.name} uses`);
        }
    }
    const mage = SKILL_SETS.find(set => set.id === 'hedge-mage');
    assert.deepEqual(mage.skills.map(skill => [skill.name, skill.stat, skill.uses]), [['Spark', 'int', 'mana'], ['Ward', 'int', 'mana'], ['Lore', 'int', 'stamina']]);
    assert.deepEqual(SKILL_SETS.find(set => set.id === 'guild-fighter').skills.map(skill => [skill.name, skill.stat]), [['Short blade', 'agi'], ['Iron Breath', 'vit'], ['Shield work', 'str']]);
    assert.ok(Object.isFrozen(SKILL_SETS));
});

test('the creation budget is named constants: stats start at 10, 6 points, 8 to 15, up to five skills, one at Adept', () => {
    assert.deepEqual({ start: CREATION.start, budget: CREATION.budget, min: CREATION.min, max: CREATION.max, skills: CREATION.skills, adept: CREATION.adept },
        { start: 10, budget: 6, min: 8, max: 15, skills: 5, adept: 1 });
    const { state } = template('Character');
    assert.equal(CREATION.about, state.about.max);
    assert.equal(CREATION.name, state.who.max);
    assert.equal(CREATION.skillName, template('Skills').state.skill1.max);
    assert.equal(CREATION.skillAbout, template('Skills').state.about1.max);
    assert.ok(Object.isFrozen(CREATION));
});
