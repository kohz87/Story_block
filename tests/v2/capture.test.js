// The change-line grammar (docs/v2/SPEC.md §4.4) and the <Changes> block in a reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBlock, hideBlock, parseChanges, stripBlock, withoutReasoning } from '../../src/v2/capture.js';

const one = text => {
    const { lines, problems } = parseChanges(text);
    assert.deepEqual(problems, []);
    assert.equal(lines.length, 1);
    return lines[0];
};

test('reads every op of the spec example', () => {
    const { lines, problems } = parseChanges([
        '+ item Moonveil Trout | qty: 1 | note: violet-streaked, from the lake',
        '- item Rope | qty: 1',
        '~ quest Granary Rats | step: the cellar is cleared',
        '! event Dragon sighted — smoke over the eastern ridge',
        '? check stealth — slipping past the gate guard | dc: hard',
    ].join('\n'));
    assert.deepEqual(problems, []);
    assert.deepEqual(lines.map(({ op, kind, name, text, labels, index }) => ({ op, kind, name, text, labels, index })), [
        { op: '+', kind: 'item', name: 'Moonveil Trout', text: '', labels: { qty: '1', note: 'violet-streaked, from the lake' }, index: 0 },
        { op: '-', kind: 'item', name: 'Rope', text: '', labels: { qty: '1' }, index: 1 },
        { op: '~', kind: 'quest', name: 'Granary Rats', text: '', labels: { step: 'the cellar is cleared' }, index: 2 },
        { op: '!', kind: 'event', name: 'Dragon sighted', text: 'smoke over the eastern ridge', labels: {}, index: 3 },
        { op: '?', kind: 'check', name: 'stealth', text: 'slipping past the gate guard', labels: { dc: 'hard' }, index: 4 },
    ]);
    assert.equal(lines[0].raw, '+ item Moonveil Trout | qty: 1 | note: violet-streaked, from the lake');
});

test('the Director\'s v1 lines keep their kind, name and text', () => {
    const quest = one('~ Quests: North Levee Vipers — step: completed, voucher paid');
    assert.deepEqual({ op: quest.op, kind: quest.kind, name: quest.name, text: quest.text, labels: quest.labels },
        { op: '~', kind: 'quests', name: 'North Levee Vipers', text: 'step: completed, voucher paid', labels: {} });
    const agenda = one('+ agenda Courier — now: rides north | then: reaches Haywane');
    assert.equal(agenda.name, 'Courier');
    assert.equal(agenda.text, 'now: rides north');
    assert.deepEqual(agenda.labels, { then: 'reaches Haywane' });
    const clock = one('~ clock Flood Rising — 3/6 | due: day 4');
    assert.equal(clock.text, '3/6');
    assert.deepEqual(clock.labels, { due: 'day 4' });
    assert.equal(one('- hook Missing Ferryman — found drowned').text, 'found drowned');
    assert.equal(one('! beat Bell Tower — the bell rings at midnight').kind, 'beat');
});

test('the text separator is an em dash, an en dash or a spaced hyphen; names keep their hyphens', () => {
    assert.equal(one('! event Fire — the mill burns').text, 'the mill burns');
    assert.equal(one('! event Fire–the mill burns').text, 'the mill burns');
    assert.equal(one('! event Fire - the mill burns').text, 'the mill burns');
    const hyphen = one('+ present Jean-Luc');
    assert.equal(hyphen.name, 'Jean-Luc');
    assert.equal(hyphen.text, '');
    assert.equal(one('+ present Hall-Warden Brin - arrives late').name, 'Hall-Warden Brin');
});

test('labels are lowercased, values trimmed; a part with no label is more text', () => {
    const line = one('+ item Iron Key | QTY:  2  | Note: rusty | found under the floor');
    assert.deepEqual(line.labels, { qty: '2', note: 'rusty' });
    assert.equal(line.text, 'found under the floor');
    // 09:00 is not a label; the value of a label may hold a colon.
    const time = one('~ time Morning | at: 09:00 | 10:30');
    assert.deepEqual(time.labels, { at: '09:00' });
    assert.equal(time.text, '10:30');
    // A label written twice keeps both values.
    assert.deepEqual(one('+ item Cloak | note: wool | note: patched').labels, { note: 'wool; patched' });
});

test('bullets, numbers, bold, quotes, blank lines, code fences and the tags are tolerated', () => {
    const { lines, problems } = parseChanges([
        '```',
        '<Changes>',
        '',
        '* + item Rope | qty: 1',
        '- - item Lantern',
        '• ~ quest Granary Rats | step: two',
        '1. ! event Storm — thunder',
        '> ? check climb — the wall | dc: 12',
        '**+ present** Fenna',
        '- item Bread',
        '</Changes>',
        '```',
        '(none)',
    ].join('\n'));
    assert.deepEqual(problems, []);
    assert.deepEqual(lines.map(line => `${line.op} ${line.kind} ${line.name}`), [
        '+ item Rope', '- item Lantern', '~ quest Granary Rats', '! event Storm', '? check climb', '+ present Fenna', '- item Bread',
    ]);
    assert.deepEqual(lines.map(line => line.index), [0, 1, 2, 3, 4, 5, 6]);
});

test('lines that do not parse go to problems, and the rest still read', () => {
    const { lines, problems } = parseChanges([
        'The party rests.',
        '+ item Rope',
        '+',
        '~ quest — no name here',
        '+ 12 apples',
    ].join('\n'));
    assert.deepEqual(lines.map(line => line.name), ['Rope']);
    assert.equal(problems.length, 4);
    assert.match(problems[0], /^Line 1 "The party rests\." is not a change line: it does not start with/);
    assert.match(problems[1], /Line 3 .*no kind/);
    assert.match(problems[2], /Line 4 .*the quest has no name/);
    assert.match(problems[3], /Line 5 .*no kind/);
    assert.deepEqual(parseChanges(''), { lines: [], problems: [] });
    assert.deepEqual(parseChanges(null), { lines: [], problems: [] });
});

test('extractBlock finds the block, bare, cut off or hidden; null without one', () => {
    const reply = 'Ren lands the fish.\n\n<Changes>\n+ item Moonveil Trout | qty: 1\n</Changes>';
    assert.equal(extractBlock(reply), '+ item Moonveil Trout | qty: 1');
    assert.equal(extractBlock('No block here.'), null);
    assert.equal(extractBlock('Story.\n<changes>\n- item Rope\n'), '- item Rope', 'a block cut off runs to the end');
    assert.equal(extractBlock('A <Changes >\n! event X — y\n</Changes > b'), '! event X — y');
    assert.equal(extractBlock('One.\n<Changes>\n+ item A\n</Changes>\nTwo.\n<Changes>\n+ item B\n</Changes>'), '+ item A\n+ item B');
    assert.equal(extractBlock('Story.\n<Director>\n~ clock X — 1/4\n</Director>', 'Director'), '~ clock X — 1/4');
    assert.equal(extractBlock(hideBlock(reply)), '+ item Moonveil Trout | qty: 1');
});

test('stripBlock and hideBlock leave the story as written', () => {
    const reply = 'Ren lands the fish.\n\n<Changes>\n+ item Moonveil Trout | qty: 1\n</Changes>\n';
    assert.equal(stripBlock(reply), 'Ren lands the fish.');
    const hidden = hideBlock(reply);
    assert.match(hidden, /^Ren lands the fish\.\n\n<!-- STORY_SUITE_V2\n<Changes>\n\+ item Moonveil Trout \| qty: 1\n<\/Changes>\n-->$/);
    assert.equal(hideBlock(hidden), hidden, 'hiding twice changes nothing');
    assert.equal(stripBlock(hidden), 'Ren lands the fish.');
    assert.equal(stripBlock('No block.'), 'No block.');
    assert.equal(hideBlock('No block.'), 'No block.');
    // Another extension's comment stays.
    assert.equal(stripBlock('Story. <!-- other note -->\n<Changes>\n+ item A\n</Changes>'), 'Story. <!-- other note -->');
    // An arrow inside the block cannot end the comment early.
    const arrow = hideBlock('S.\n<Changes>\n! event Sign — it reads -->\n</Changes>');
    assert.equal(arrow.match(/-->/g).length, 1);
});

test('a change block drafted inside closed reasoning is not read, so it is not applied twice', () => {
    const mes = '<think>Plan:\n<Changes>\n+ item Rope\n</Changes>\nok</think>The story.\n<Changes>\n+ item Rope\n</Changes>';
    assert.equal(extractBlock(mes), '+ item Rope');
    assert.equal(extractBlock('<thinking a="1">x <Changes>\n- item Oar\n</Changes></thinking>No block here.'), null);
    assert.equal(extractBlock('<reasoning>r</reasoning>\n<Changes>\n~ place Gate\n</Changes>'), '~ place Gate');
});

test('an unclosed reasoning tag keeps the block after it', () => {
    assert.equal(extractBlock('<think>cut off\n<Changes>\n+ item Rope\n</Changes>'), '+ item Rope');
    assert.equal(withoutReasoning('a<think>b</think>c'), 'ac');
});

test('hiding leaves a draft inside reasoning where it is, so the hidden block is read once', () => {
    const mes = '<think>\n<Changes>\n+ item Rope\n</Changes>\n</think>The story.\n<Changes>\n+ item Rope\n</Changes>';
    const hidden = hideBlock(mes);
    assert.equal(extractBlock(hidden), '+ item Rope');
    assert.ok(hidden.startsWith('<think>\n<Changes>'));
});
