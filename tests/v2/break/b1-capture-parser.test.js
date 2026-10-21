// Parser findings in src/v2/capture.js (B-b1-capture-7, -8, -9, -10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBlock, hideBlock, parseChanges, stripBlock } from '../../../src/v2/capture.js';

// B-b1-capture-7: labels are a plain {} (V2_LOG bug 7, "null-prototype labels", has not landed):
// `| constructor: x` reads as Object itself, a function, and the written value is lost.
test('a "constructor" label keeps the text written', () => {
    const [line] = parseChanges('+ hook Rats | constructor: the cellar').lines;
    assert.equal(typeof line.labels.constructor, 'string');
    assert.equal(line.labels.constructor, 'the cellar');
});

// B-b1-capture-8: `qty:3` (no space after the colon, a common model drift) is not a label; it
// becomes the line's text, so `- item Rope | qty:3` takes away one, not three, with no Problem.
test('"| qty:3" is read as the qty label (or the line is a Problem), never as text', () => {
    const { lines, problems } = parseChanges('- item Rope | qty:3');
    if (problems.length) return;
    assert.equal(lines[0].labels.qty, '3', JSON.stringify(lines[0]));
    assert.equal(lines[0].text, '');
});

// B-b1-capture-9: a nested <Changes> (the model opens the block twice) ends at the first close:
// the lines after it are lost and stay in the story text and the prompt history.
test('a nested <Changes> block loses no line and leaves none in the story', () => {
    const mes = 'The story.\n<Changes>\n<Changes>\n+ coin 5\n</Changes>\n+ coin 6\n</Changes>';
    const lines = parseChanges(extractBlock(mes)).lines.map(line => line.name);
    assert.deepEqual(lines, ['5', '6']);
    assert.equal(stripBlock(hideBlock(mes)), 'The story.');
});

// B-b1-capture-10: hideBlock escapes `-->` in a value but not `--!>`, which also ends an HTML
// comment, so the hidden block ends early in the page and the rest of it is drawn as markup.
test('a value with --!> cannot end the hidden comment early', () => {
    const hidden = hideBlock('The story.\n<Changes>\n+ item Rope | note: --!> <img src=x onerror=alert(1)>\n</Changes>');
    const body = hidden.slice(hidden.indexOf('<!--') + 4);
    // The first place an HTML parser would end the comment must be the final "-->".
    const end = body.search(/--!?>/);
    assert.equal(end, body.length - 3, hidden);
});
