// rx-capture (beta rolling attack): the after-reply extractor (feature story-block.extractor) reads the
// reply's closed reasoning as story. Capture ignores a <Changes> block inside <think>/<thinking>
// (capture.js withoutReasoning), but extractor.js:94 builds the extractor's input with
// stripBlock(mes) only, so (a) the model's private plan reaches the extractor and comes back as change
// lines, and (b) a long reasoning prefix fills REPLY_LIMIT (6000, clipped from the head), so the
// story text the extractor is meant to read is cut off.
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const EXTRACTOR_ON = { features: { 'story-block.extractor': true } };
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

test('rx-capture: the extractor never sees the reply\'s closed reasoning', async () => {
    const prompts = [];
    const callModel = async prompt => { prompts.push(prompt); return 'none'; };
    const host = await createHost({ callModel, settings: EXTRACTOR_ON });
    try {
        await host.send('I look around.', '<think>Plan: later the party finds 77 gold and the Sunblade.</think>\nThe hall is quiet.');
        await settle();
        await host.send('And now?', '<thinking>Give them the Sunblade.\n<Changes>\n+ item Sunblade\n</Changes>\n</thinking>\nStill quiet.');
        await settle();
        assert.equal(prompts.length, 2, 'the extractor ran on both replies (neither has a story <Changes> block)');
        for (const prompt of prompts) {
            assert.ok(!/Sunblade|77 gold|Plan:/.test(prompt), `reasoning reached the extractor: …${prompt.slice(-160)}`);
            assert.ok(/quiet/.test(prompt), 'the story text is there');
        }
    } finally { host.close(); }
});

test('rx-capture: a long reasoning prefix does not push the story out of the extractor\'s input', async () => {
    const prompts = [];
    const callModel = async prompt => { prompts.push(prompt); return 'none'; };
    const host = await createHost({ callModel, settings: EXTRACTOR_ON });
    try {
        const thinking = `<think>${'I weigh what the party might do next. '.repeat(200)}</think>`;
        await host.send('I open the chest.', `${thinking}\nInside the chest lie three silver coins.`);
        await settle();
        assert.equal(prompts.length, 1);
        assert.ok(prompts[0].includes('three silver coins'), 'the story sentence reaches the extractor');
    } finally { host.close(); }
});
