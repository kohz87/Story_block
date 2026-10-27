// The Assist wall and generative offers (GENERATIVE_OFFERS_SPEC §12.2, Story Block 2.5.0): the safety net never writes a job
// (`+ quest`) or a teacher (`+ trainer`), under any Assist setting. The narrator offers those in its own words; the safety net
// reads a finished reply and never decides what the world holds. `~ quest` (progress) and `- quest` (a turn-in, checked by its
// owner) keep working exactly as before.
//
//   1. the wall itself (`refusedWhy`, `safeLines`): every spelling the change-line parser reads, with and without an allow-list,
//      before and after the reader sent;
//   2. the extractor, for every combination of the five Assist settings (a test keeps this list equal to the settings Story Block
//      declares), with a model that answers `+ quest` and `+ trainer` lines;
//   3. the real host, on both paths a safety-net line can take (applied on the reply, and applied late on the next one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KINDS, KIND_CHOICES, SETTING, allowedKinds, createAssistPart, parseExtractorAnswer, refusedWhy, safeLines } from '../../../src/v2/assist/index.js';
import { assistSections } from '../../../src/v2/capture.js';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { fakeModel, flush } from './helpers/fakes.js';

const JOBS = /^\s*\+\s*(?:quest|trainer)\b/im;
const OFFER_WHY = /never offers jobs or teachers/;
const parse = raw => {
    const out = safeLines(raw, null);
    return { kept: out.lines, refused: out.refused };
};

// ---- 1. the wall -------------------------------------------------------------------------------------------------

const OFFER_LINES = [
    '+ quest Rat Job | giver: the innkeeper | type: cull | goal: kill 4 rats | reward: 5 silver | due: in 2 days',
    '+quest Rat Job',
    '+ Quest Rat Job',
    '+  QUEST  Rat Job',
    '+ quest Rat Job | like: open-hunt-f',
    '+ quest Rat Job | reward: 9999 gold',
    '+ trainer Old Soldier — spear and shield drills | fee: 4 silver',
    '+trainer Old Soldier',
    '+ Trainer Old Soldier | like: open-blade-drills',
    '+   TRAINER Old Soldier — blades',
];

// Every shape of allow-list a reader could type, including the ones that name the offers on purpose.
const KIND_SETTINGS = [
    undefined,
    '',
    DEFAULT_KINDS,
    '+ quest',
    '+ trainer',
    '+ quest, + trainer',
    '+quest,+trainer',
    '+ QUEST; + TRAINER',
    '+ quest\n+ trainer\n~ quest\n- quest',
    `${DEFAULT_KINDS}, + quest, + trainer`,
    '! time, ~ time, ~ place, + present, - present, ~ weather, ~ quest, - quest, ~ wound, - item, + quest, + trainer, + item, + coin, + xp, + loot, + reward, + join, + skill, ? check, ? loot, ~ wound',
    'quest, trainer',
];

test('the wall refuses + quest and + trainer in every spelling, with no allow-list and with every allow-list', () => {
    for (const raw of OFFER_LINES) {
        const { kept, refused } = parse(raw);
        assert.deepEqual(kept, [], raw);
        assert.equal(refused.length, 1, raw);
        assert.match(refused[0].why, OFFER_WHY, raw);
        for (const setting of KIND_SETTINGS) {
            for (const late of [false, true]) {
                const out = safeLines(raw, allowedKinds(setting), { late });
                assert.deepEqual(out.lines, [], `${raw} | ${JSON.stringify(setting)} | late ${late}`);
                assert.equal(out.refused.length, 1);
                assert.ok(out.refused[0].why, 'a reason is given');
            }
        }
    }
});

test('the offer wall answers before the generic allow-list message, so the reason is always the same sentence', () => {
    for (const setting of KIND_SETTINGS) {
        for (const kind of ['quest', 'trainer']) {
            assert.match(refusedWhy({ op: '+', kind, name: 'Anything', labels: {} }, allowedKinds(setting)), OFFER_WHY, `${kind} ${JSON.stringify(setting)}`);
            // Even a line that also carries a value label is refused as an offer, never let through for another reason.
            assert.match(refusedWhy({ op: '+', kind, name: 'Anything', labels: { reward: '5 silver', fee: '4 silver' } }, allowedKinds(setting)), OFFER_WHY);
        }
    }
    assert.match(refusedWhy({ op: '+', kind: 'quest', name: 'X', labels: {} }, null), OFFER_WHY);
    assert.match(refusedWhy({ op: '+', kind: 'trainer', name: 'X', labels: {} }, null, { late: true }), /./);
});

test('~ quest, - quest and the rest of the default kinds are untouched', () => {
    const allow = allowedKinds(DEFAULT_KINDS);
    for (const [line, expected] of [
        [{ op: '~', kind: 'quest', name: 'Pelts', labels: { step: '2' } }, ''],
        [{ op: '-', kind: 'quest', name: 'Pelts', labels: {} }, ''],
        [{ op: '+', kind: 'present', name: 'Elula', labels: {} }, ''],
        [{ op: '~', kind: 'place', name: 'Old Mill', labels: {} }, ''],
        [{ op: '-', kind: 'item', name: 'Wolf Pelt', labels: { to: 'Elula' } }, ''],
    ]) assert.equal(refusedWhy(line, allow), expected, JSON.stringify(line));
    // A turn-in read after the reader had sent is still left to the next reply, as before.
    assert.match(refusedWhy({ op: '-', kind: 'quest', name: 'Pelts', labels: {} }, null, { late: true }), /turn-in/);
    // Other `+` kinds keep their old reasons (these are not offers).
    assert.match(refusedWhy({ op: '+', kind: 'item', name: 'Rope', labels: {} }, allow), /never adds items, coin or rewards/);
    assert.match(refusedWhy({ op: '+', kind: 'coin', name: '5', labels: {} }, allow), /never writes coin/);
    // Neither are quests or trainers named by a longer word, which are different kinds the host does not know.
    for (const kind of ['quests', 'questline', 'trainers', 'trainee']) {
        assert.doesNotMatch(refusedWhy({ op: '+', kind, name: 'X', labels: {} }, null), OFFER_WHY, kind);
    }
});

test('a mixed answer keeps the allowed lines and refuses only the offers', () => {
    const answer = [
        '~ place The Mill',
        '+ quest Rat Job | giver: x | reward: 5 silver',
        '~ quest Pelts | step: 2',
        '+ trainer Old Soldier — blades | fee: 4 silver',
        '- quest Pelts',
        '+ present Elula',
    ].join('\n');
    const allow = allowedKinds(`${DEFAULT_KINDS}, + quest, + trainer`);
    const out = parseExtractorAnswer(answer, ['place', 'quest', 'trainer', 'present'], allow);
    assert.deepEqual(out.lines, ['~ place The Mill', '~ quest Pelts | step: 2', '- quest Pelts', '+ present Elula']);
    assert.deepEqual(out.refused.map(item => item.line.split(' | ')[0]), ['+ quest Rat Job', '+ trainer Old Soldier — blades']);
    assert.ok(out.refused.every(item => OFFER_WHY.test(item.why)));
    assert.equal(out.dropped, 2);
});

test('no chip on the settings page can allow an offer', () => {
    for (const choice of KIND_CHOICES) {
        assert.doesNotMatch(choice.value, /^\+ (?:quest|trainer)$/);
    }
    assert.equal(allowedKinds(DEFAULT_KINDS).has('+ quest'), false);
    assert.equal(allowedKinds(DEFAULT_KINDS).has('+ trainer'), false);
});

// ---- 2. the extractor, for every combination of Assist settings ----------------------------------------------------

const GRAMMAR = [
    '+ quest Name | giver: who | type: cull | goal: what to do | reward: an amount | due: how long',
    '+ trainer Name — what they teach | fee: an amount',
    '~ quest Name | step: text',
    '- quest Name',
    '~ place Name | kind: settlement|wild|dungeon',
];
const ANSWER = '+ quest Rat Job | giver: the innkeeper | type: cull | goal: kill 4 rats | reward: 5 silver | due: in 2 days\n'
    + '+ trainer Old Soldier — spear and shield drills | fee: 4 silver\n'
    + '+quest Cellar Trouble\n'
    + '~ quest Pelts | step: 2';

function extractorWith(values) {
    const callModel = fakeModel(ANSWER);
    const captured = [];
    const part = createAssistPart({
        callModel,
        settings: () => values,
        grammar: () => GRAMMAR,
        chatId: () => 'chat-1',
        capture: async (text, at) => { captured.push({ text, ...at }); return { receipts: [] }; },
        warn: () => {},
    });
    const run = () => part.hooks.afterReply({ index: 2, swipe: 0, type: 'normal', mes: 'The innkeeper asks you about rats in the cellar.' });
    return { run, captured, callModel };
}

test('the five Assist settings this matrix covers are all the settings Story Block declares', () => {
    assert.deepEqual(Object.values(SETTING).sort(), ['assistClassifier', 'assistExtractor', 'assistExtractorKinds', 'assistExtractorProfile', 'assistProfile']);
});

test('under every combination of every Assist setting, no + quest and no + trainer reaches the capture', async () => {
    let combinations = 0;
    let withControl = 0;
    for (const classifier of [false, true]) for (const extractor of [false, true]) for (const profile of ['', 'cheap model']) for (const extractorProfile of ['', 'tiny model']) for (const kinds of KIND_SETTINGS) {
        combinations += 1;
        const values = { [SETTING.classifier]: classifier, [SETTING.extractor]: extractor, [SETTING.profile]: profile, [SETTING.extractorProfile]: extractorProfile };
        if (kinds !== undefined) values[SETTING.extractorKinds] = kinds;
        const { run, captured, callModel } = extractorWith(values);
        await run();
        const label = JSON.stringify(values);
        if (!extractor) {
            assert.equal(callModel.calls.length, 0, `off: no call. ${label}`);
            assert.deepEqual(captured, [], label);
            continue;
        }
        for (const item of captured) assert.doesNotMatch(item.text, JOBS, `a job or a teacher was captured. ${label}`);
        // The wall refuses only the offers: where the setting allows `~ quest`, the progress line still gets through.
        const allowsProgress = allowedKinds(kinds ?? DEFAULT_KINDS).has('~ quest');
        if (allowsProgress) {
            withControl += 1;
            assert.deepEqual(captured.map(item => item.text), ['~ quest Pelts | step: 2'], label);
        } else {
            assert.deepEqual(captured, [], label);
        }
        // The profile settings only choose the connection; the extractor's own wins over the shared one.
        if (callModel.calls.length) assert.equal(callModel.calls[0].options.profile, extractorProfile || profile, label);
    }
    assert.equal(combinations, 2 * 2 * 2 * 2 * KIND_SETTINGS.length);
    assert.ok(withControl > 20, 'the control line was seen under many settings');
});

// ---- 3. the real host, on both paths -------------------------------------------------------------------------------

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const WIDE = { [SETTING.extractor]: true, [SETTING.extractorKinds]: `${DEFAULT_KINDS}, + quest, + trainer` };

// A stand-in for the module that owns `quest` and `trainer` (RPG Battle): it records every line the host hands it, so a line that
// got past the wall would show.
function offersModule(seen) {
    return {
        id: 'offers-stand-in', name: 'Offers stand-in', version: '1.0.0',
        capture: {
            kinds: {
                quest: { grammar: GRAMMAR[0] },
                trainer: { grammar: GRAMMAR[1] },
            },
            apply(ctx, line) {
                seen.push(`${line.op} ${line.kind} ${line.name}`);
                return { summary: `Took ${line.op} ${line.kind} ${line.name}.`, narrate: false };
            },
        },
    };
}

async function hostWith(model, seen) {
    const host = await createHost({ callModel: model, modules: [offersModule(seen)], settings: { modules: { 'story-block': WIDE } } });
    host.features?.set?.('story-block.extractor', true);
    return host;
}

test('on the real host: an answer applied on the reply never carries an offer, whatever the allow-list says', { skip }, async () => {
    const seen = [];
    const model = fakeModel('+ quest Rat Job | giver: the innkeeper | reward: 5 silver\n+ trainer Old Soldier — blades | fee: 4 silver\n~ quest Pelts | step: 2\n~ place Old Mill | kind: settlement');
    const host = await hostWith(model, seen);
    const turn = new Promise(resolve => host.sdk.on('turn', item => { if (item.type === 'late') resolve(item); }));
    const { index } = await host.send('I ask about the rats.', 'The innkeeper wants the cellar cleared. You walk to the old mill.');
    await turn;
    await flush();
    const stored = assistSections(host.ctx.chat[index].mes);
    assert.ok(stored.now.length >= 1, 'the safety net did run on this reply');
    assert.ok(stored.now.every(line => !JOBS.test(line)), JSON.stringify(stored.now));
    assert.deepEqual(seen.filter(line => /^\+ /.test(line)), [], 'no + quest or + trainer reached the owner');
    assert.ok(seen.includes('~ quest Pelts'), 'the progress line did');
    assert.equal(host.sdk.query('scene.place').name, 'Old Mill');
    // Re-read replays what is stored, which holds no offer, and asks the model nothing.
    const calls = model.calls.length;
    const again = await host.sdk.reread(index);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(model.calls.length, calls);
    assert.deepEqual(seen.filter(line => /^\+ /.test(line)), []);
    host.close();
});

test('on the real host: a late answer, applied on the next reply, never carries an offer either', { skip }, async () => {
    const seen = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const model = async () => {
        calls += 1;
        if (calls > 1) return 'none';
        await held;
        return '+ quest Rat Job | giver: the innkeeper\n+ trainer Old Soldier — blades\n~ quest Pelts | step: 2\n+ present Elula';
    };
    const host = await hostWith(model, seen);
    const first = await host.send('I ask about the rats.', 'The innkeeper wants the cellar cleared. Elula comes in.');
    await wait(5);
    const intercept = host.st.interceptor;
    host.st.interceptor = async (...args) => { await intercept(...args); release(); await wait(20); };
    const second = await host.send('I nod.', 'She sits down.');
    host.st.interceptor = intercept;
    const stored = assistSections(host.ctx.chat[first.index].mes);
    assert.ok(stored.next.length >= 1, 'the late answer was kept on the reply it read');
    assert.ok(stored.next.every(line => !JOBS.test(line)), JSON.stringify(stored.next));
    assert.ok(host.ctx.chat[second.index].extra.storySuite.receipts.some(receipt => receipt.assist === 'late'), 'and applied late');
    assert.deepEqual(seen.filter(line => /^\+ /.test(line)), []);
    host.close();
});

test('on the real host: the narrator\'s own + quest and + trainer lines still reach their owner (the wall is for the safety net only)', { skip }, async () => {
    const seen = [];
    const host = await hostWith(fakeModel('none'), seen);
    await host.send('I ask about the rats.', 'The innkeeper wants the cellar cleared.\n<Changes>\n+ quest Rat Job | giver: the innkeeper | reward: 5 silver\n+ trainer Old Soldier — blades | fee: 4 silver\n</Changes>');
    await flush();
    assert.deepEqual(seen.filter(line => /^\+ /.test(line)).sort(), ['+ quest Rat Job', '+ trainer Old Soldier']);
    host.close();
});
