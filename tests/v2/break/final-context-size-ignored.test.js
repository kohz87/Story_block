// Final soak (live, SillyTavern 1.19, chat completion at its default 4,095-token context, 300 for the reply):
// 334 of the first 505 main requests reached the model with NO chat history and NO user message: only the
// main prompt, Story Suite's static part (8,937 characters, ~2,230 tokens with all four modules) and the
// character line. SillyTavern fits the extension prompts first and drops the conversation when the rest no
// longer fits. Story Block's generation interceptor is handed the context size (turn.js
// `interceptor(_chat, _contextSize, ...)`) and ignores it: the tail is cut only to its own 1,500-token
// budget, and the reader is never told. Here, 200 replies in: static (~2,230) + tail (~1,280) + the reply's 300 leave under 300 of
// 4,095 tokens for SillyTavern's own prompt and the whole conversation.
// Expected: the tail is cut to leave room for the conversation (here a quarter of the context), or a
// Problem tells the reader the context is too small. Invariant 5 (the tail stays within budget: the
// budget has to be the one the reader's context allows).
// Needs the four checkouts side by side (helpers/suite-final.js); skipped otherwise. The same rules on
// Story Block alone: final-context-size-sb.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

let suite = null;
try { suite = await import('./helpers/suite-final.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const started = (...args) => suite.started(...args);

const tokens = text => Math.ceil(String(text ?? '').length / 4);   // Story Block's own estimate (prompt.js)

test('final: with a 4,095-token context, Story Suite\'s prompt parts leave room for the conversation', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await started();
    t.after(() => h.close());
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
    // 200 replies of the soak's generator (harness/break-scripts/gen.mjs, seed 5), as the live soak wrote them.
    const replies = JSON.parse(readFileSync(new URL('./helpers/replies-200.json', import.meta.url), 'utf8'));
    for (const [user, text] of replies) await h.send(user, text);
    const CONTEXT = 4095, REPLY = 300;
    const real = h.st.interceptor ?? globalThis.storyBlockGenerationInterceptor;
    h.st.interceptor = (chat, _size, abort, type) => real(chat, CONTEXT, abort, type);
    await h.send('I look around.', 'Quiet.');
    const last = key => h.st.promptLog.filter(entry => entry.key === key && entry.value).at(-1)?.value ?? '';
    const used = tokens(last('story_suite_static')) + tokens(last('story_suite_tail_1'));
    const told = h.store.problems?.().some(problem => /context/i.test(String(problem.why ?? problem.message ?? ''))) ?? false;
    assert.ok(told || CONTEXT - REPLY - used >= CONTEXT / 4,
        `Story Suite uses ${used} of ${CONTEXT} tokens (+${REPLY} for the reply), leaving ${CONTEXT - REPLY - used} for the conversation, and nothing says so`);
});
