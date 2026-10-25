// An occurrence (docs/v2/EVIDENCE.md) comes from the allocator in evidence.js and from nowhere else: no other code works one out, and none
// defaults one. A check of the source, so a new path that invents a number (a rank, a count, a zero) is caught here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../src/v2/', import.meta.url));
const files = fs.readdirSync(dir, { recursive: true }).filter(name => String(name).endsWith('.js'));
const source = name => fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test('only evidence.js defines the allocator, and nothing else counts or defaults an occurrence', () => {
    for (const name of files) {
        const text = source(name);
        if (name !== 'evidence.js') {
            assert.equal(/export function (allocator|nextOccurrence)\b/.test(text), false, `${name} defines an allocator`);
            assert.equal(/\bnextOccurrence\s*\(/.test(text), false, `${name} asks for the next occurrence by another way than the allocator`);
        }
        assert.equal(/occurrence\s*(\?\?|\|\|)\s*\d/.test(text), false, `${name} defaults an occurrence`);
        assert.equal(/\b(rank|occurrence)\s*=\s*\d+\b/.test(text), false, `${name} assigns an occurrence a number`);
        assert.equal(/\b(rank|occurrence)\s*=\s*[^=;]*\.length\b/.test(text), false, `${name} counts blocks for an occurrence`);
        assert.equal(/\b(rank|occurrence)\s*\+\+|\b(rank|occurrence)\s*\+=/.test(text), false, `${name} moves an occurrence on by itself`);
    }
});

test('a new occurrence is taken from the allocator where it is given', () => {
    const users = files.filter(name => /\ballocator\(|\.take\(|allocateOccurrence\??\.?\(/.test(source(name))).sort();
    assert.deepEqual(users, ['commands.js', 'evidence.js', 'store.js'], 'the files that take one');
    assert.match(source('store.js'), /allocateOccurrence\(index, key\)[\s\S]{0,300}allocator\(/, 'the store\'s live allocation is the allocator');
    assert.match(source('commands.js'), /No occurrence could be given/, 'a proof with none is refused');
});
