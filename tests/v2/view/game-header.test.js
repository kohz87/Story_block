// The game view's header data (UI stage 5a, src/v2/view/game-header.js): the lead and the scene through the queries, the
// portrait's order (persona avatar, card avatar, the module's picture, the initial), and nothing thrown when a module is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardAvatarUrl, gameHeroProps, personaAvatarUrl, portraitOf, readHeroContext } from '../../../src/v2/view/game-header.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const STATE = { domains: {} };
const ren = { id: 'ac_ren00001', name: 'Ren', level: 4, role: 'ranger', hp: { cur: 20, max: 82 }, mp: { cur: 3, max: 10 }, sp: { cur: 0, max: 0 }, conditions: [{ kind: 'poisoned', stacks: 1 }] };
const answers = (extra = {}) => (name, args) => {
    const table = {
        'party.pc': ren,
        'party.terms': { levelName: 'Level', xpName: 'Soul growth' },
        'scene.place': { name: 'Bluewatch Village', region: 'Lowmere' },
        'scene.weather': { text: 'Drizzle' },
        'director.time': { minutes: 1200 },
        ...extra,
    };
    return name in table ? table[name] : null;
};
const fmt = minutes => `Day 1, ${minutes}`;

test('no state (no chat) gives no header', () => {
    assert.equal(gameHeroProps({ state: null, query: answers() }), null);
});

test('the lead: name, level under the Terms word, the pools that have a maximum, and the conditions', () => {
    const props = gameHeroProps({ state: STATE, query: answers(), formatTime: fmt, context: {} });
    assert.equal(props.name, 'Ren');
    assert.equal(props.level, 'Level 4');
    assert.equal(props.title, 'ranger');
    assert.deepEqual(props.bars.map(bar => [bar.kind, bar.label, bar.value, bar.max, bar.text]), [
        ['hp', 'HP', 20, 82, '20 / 82'], ['mp', 'MP', 3, 10, '3 / 10'],
    ], 'SP has no maximum, so no bar');
    assert.deepEqual(props.statuses.map(entry => [entry.id, entry.label, entry.tone]), [['poisoned', 'poisoned', 'bad']]);
});

test('the scene: place, time through the host formatter, weather', () => {
    const props = gameHeroProps({ state: STATE, query: answers(), formatTime: fmt, context: {} });
    assert.equal(props.place, 'Bluewatch Village');
    assert.equal(props.time, 'Day 1, 1200');
    assert.equal(props.weather, 'Drizzle');
});

test('without a module the lead is the persona, and the parts that are missing are empty', () => {
    const props = gameHeroProps({ state: STATE, query: answers({ 'party.pc': null, 'party.terms': null, 'scene.weather': null, 'director.time': null }), formatTime: null, context: { personaName: 'Mira' } });
    assert.equal(props.name, 'Mira');
    assert.equal(props.level, '');
    assert.deepEqual(props.bars, []);
    assert.equal(props.time, '');
    assert.equal(props.weather, '');
    assert.equal(props.place, 'Bluewatch Village', 'the scene does not depend on the lead');
});

test('a query that throws is a missing answer, not an error', () => {
    const query = (name, args) => {
        if (name === 'party.pc') throw new Error('no module answers');
        return answers()(name, args);
    };
    const props = gameHeroProps({ state: STATE, query, formatTime: fmt, context: { personaName: 'Mira' } });
    assert.equal(props.name, 'Mira');
    assert.equal(props.place, 'Bluewatch Village');
});

test('long names and places are cut to the widget limits (60 for the name, 40 for the place)', () => {
    const long = 'N'.repeat(70);
    const props = gameHeroProps({ state: STATE, query: answers({ 'party.pc': { ...ren, name: long }, 'scene.place': { name: 'P'.repeat(90) } }), formatTime: fmt, context: {} });
    assert.equal(props.name.length, 60);
    assert.equal(props.place.length, 40);
});

test('the portrait: persona avatar first, then the card avatar, then the module\'s picture, else none', () => {
    assert.equal(portraitOf({ personaFile: 'user.png', cardFile: 'ren.png', npcPicture: 'https://x.example/p.png' }), '/thumbnail?type=persona&file=user.png');
    assert.equal(portraitOf({ personaFile: '', cardFile: 'ren card.png', npcPicture: 'https://x.example/p.png' }), '/thumbnail?type=avatar&file=ren%20card.png');
    assert.equal(portraitOf({ personaFile: '', cardFile: '', npcPicture: 'https://x.example/p.png' }), 'https://x.example/p.png');
    assert.equal(portraitOf({}), '');
});

test('the portrait fallback chain reaches the props: the npc picture is asked with the lead\'s name', () => {
    const asked = [];
    const query = (name, args) => {
        if (name === 'npc.portrait') { asked.push(args); return 'https://cdn.example/ren.png'; }
        return answers()(name, args);
    };
    const bare = gameHeroProps({ state: STATE, query, formatTime: fmt, context: {} });
    assert.deepEqual(asked, [{ name: 'Ren' }]);
    assert.equal(bare.portrait, 'https://cdn.example/ren.png');
    const withPersona = gameHeroProps({ state: STATE, query, formatTime: fmt, context: { personaFile: 'me.png' } });
    assert.equal(withPersona.portrait, '/thumbnail?type=persona&file=me.png', 'the persona wins over the module');
});

test('the avatar paths are SillyTavern\'s own, and the context is read without throwing', () => {
    assert.equal(personaAvatarUrl(''), '');
    assert.equal(cardAvatarUrl('a b.png'), '/thumbnail?type=avatar&file=a%20b.png');
    const ctx = { name1: ' Mira ', user_avatar: 'mira.png', characterId: 1, characters: [{ name: 'Ren', avatar: 'ren.png' }, { name: 'Lyra', avatar: 'lyra.png' }] };
    assert.deepEqual(readHeroContext(ctx), { personaName: 'Mira', personaFile: 'mira.png', cardName: 'Lyra', cardFile: 'lyra.png' });
    assert.deepEqual(readHeroContext(null), { personaName: '', personaFile: '', cardName: '', cardFile: '' });
    assert.deepEqual(readHeroContext({ characterId: 5, characters: [] }).cardFile, '');
});

test('a module\'s picture answer is a string or an object (`{ url }` / `{ src }`), and the lead\'s pictures are an ordered list', async () => {
    const { pictureOf, portraitCandidates } = await import('../../../src/v2/view/game-header.js');
    assert.equal(pictureOf('https://x.example/a.png'), 'https://x.example/a.png');
    assert.equal(pictureOf({ url: 'https://x.example/b.png' }), 'https://x.example/b.png');
    assert.equal(pictureOf({ src: 'https://x.example/c.png' }), 'https://x.example/c.png');
    assert.equal(pictureOf(null), '');
    assert.deepEqual(portraitCandidates({ personaFile: 'me.png', cardFile: 'ren.png', npcPicture: 'https://x.example/n.png' }), [
        '/thumbnail?type=persona&file=me.png', '/thumbnail?type=avatar&file=ren.png', 'https://x.example/n.png',
    ]);
    assert.deepEqual(portraitCandidates({ personaFile: '', cardFile: '', npcPicture: '' }), []);
    const props = gameHeroProps({ state: STATE, query: answers({ 'npc.portrait': { url: 'https://cdn.example/ren.png' } }), formatTime: fmt, context: { cardFile: 'ren.png' } });
    assert.deepEqual(props.portraits, ['/thumbnail?type=avatar&file=ren.png', 'https://cdn.example/ren.png'], 'the object answer is used, after the card');
    assert.equal(props.portrait, '/thumbnail?type=avatar&file=ren.png');
});

test('a 70+ character class and role are cut to the header\'s limits (40 each), and the pill line stays bounded', async () => {
    const { heroLine } = await import('../../../src/v2/view/widgets/hero.js');
    const long = 'Soul Class of the Long Wakeful Watchers of the Northern Reaches and Beyond'; // 74 characters
    const props = gameHeroProps({ state: STATE, query: answers({ 'party.pc': { ...ren, role: long, className: long } }), formatTime: fmt, context: {} });
    assert.equal(props.title.length, 40);
    assert.equal(props.className.length, 40);
    assert.ok(heroLine(props).length <= 40 + 40 + 12 + 6, 'the pill line is bounded (class, level, role, separators)');
});

test('the persona\'s avatar file comes from the context, else SillyTavern\'s global user_avatar', () => {
    const saved = globalThis.user_avatar;
    try {
        globalThis.user_avatar = 'global-persona.png';
        assert.equal(readHeroContext({ name1: 'Mira' }).personaFile, 'global-persona.png', 'the global when the context has none');
        assert.equal(readHeroContext({ name1: 'Mira', user_avatar: 'ctx.png' }).personaFile, 'ctx.png', 'the context wins');
    } finally {
        if (saved === undefined) delete globalThis.user_avatar; else globalThis.user_avatar = saved;
    }
});

// The current persona when SillyTavern's context does not carry it (1.19: `user_avatar` is personas.js's own state, not a context
// field): the selected row of the persona list, then the newest user message's picture, then the settings' default persona.
function personaDom() {
    const doc = installFakeDom();
    const block = doc.createElement('div');
    block.id = 'user_avatar_block';
    const row = (file, selected) => {
        const node = doc.createElement('div');
        node.className = selected ? 'avatar-container selected' : 'avatar-container';
        node.setAttribute('data-avatar-id', file);
        return node;
    };
    block.appendChild(row('other.png', false));
    block.appendChild(row('mira.png', true));
    doc.body.appendChild(block);
    const log = doc.createElement('div');
    log.id = 'chat';
    doc.body.appendChild(log);
    const message = (isUser, src) => {
        const node = doc.createElement('div');
        node.className = 'mes';
        node.setAttribute('is_user', isUser ? 'true' : 'false');
        const avatar = doc.createElement('div');
        avatar.className = 'avatar';
        const img = doc.createElement('img');
        img.setAttribute('src', src);
        avatar.appendChild(img);
        node.appendChild(avatar);
        log.appendChild(node);
    };
    return { doc, block, message };
}

test('the persona file: the context first, then the selected persona row, then the newest user message, then the default persona', () => {
    const { doc, block, message } = personaDom();
    assert.equal(readHeroContext({ name1: 'Mira' }, doc).personaFile, 'mira.png', 'the selected row of the persona list');
    assert.equal(readHeroContext({ name1: 'Mira', user_avatar: 'ctx.png' }, doc).personaFile, 'ctx.png', 'the context wins over the list');
    assert.equal(readHeroContext(null, doc).personaFile, 'mira.png', 'the list does not need a context');
    block.querySelector('.avatar-container.selected').className = 'avatar-container';
    assert.equal(readHeroContext({ name1: 'Mira' }, doc).personaFile, '', 'no selected row and no messages: none');
    assert.equal(readHeroContext({ name1: 'Mira', powerUserSettings: { default_persona: 'def.png' } }, doc).personaFile, 'def.png', 'the default persona is the last resort');
    message(true, '/thumbnail?type=persona&file=mira%20x.png');
    assert.equal(readHeroContext({ name1: 'Mira' }, doc).personaFile, 'mira x.png', 'the newest user message\'s picture');
    message(true, '/thumbnail?type=avatar&file=ren.png');
    assert.equal(readHeroContext({ name1: 'Mira' }, doc).personaFile, 'mira x.png', 'a user message with a character\'s picture is not the persona');
    message(false, '/thumbnail?type=persona&file=mira-not-user.png');
    assert.equal(readHeroContext({ name1: 'Mira' }, doc).personaFile, 'mira x.png', 'only user messages count');
});

test('the portrait with the persona from the list: the persona\'s picture, else the card\'s, so a missing persona still falls back', () => {
    const { doc, block } = personaDom();
    assert.equal(portraitOf({ ...readHeroContext({ name1: 'Mira', characterId: 0, characters: [{ name: 'Ren', avatar: 'ren.png' }] }, doc) }), '/thumbnail?type=persona&file=mira.png');
    block.querySelector('.avatar-container.selected').className = 'avatar-container';
    const bare = readHeroContext({ name1: 'Mira', characterId: 0, characters: [{ name: 'Ren', avatar: 'ren.png' }] }, doc);
    assert.equal(portraitOf(bare), '/thumbnail?type=avatar&file=ren.png', 'no persona: the card');
});
