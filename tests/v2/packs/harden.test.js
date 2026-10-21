// Security hardening of pack checks (QA report, PR #70, findings 8–11): event attributes found by reading
// tags like a browser (a quoted ">" does not end the tag), data: documents in links, loaders such as
// image-set() in CSS and themes, and host-internal commands in events. Each refusal has its harmless
// neighbour that must still be accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack, unsafeCss } from '../../../src/v2/packs/validate.js';
import { unsafeText } from '../../../src/v2/packs/safety.js';

const base = (extra = {}) => ({ id: 'harden', version: '1.0.0', requires: { storyBlock: '^2' }, content: {}, ...extra });
const withNote = note => base({ content: { items: [{ name: 'Lure', note }] } });
const withScreen = screen => base({ screens: [{ id: 'harden-board', mounts: ['tab'], template: '<div>ok</div>', ...screen }] });
const withEvent = (then, when = 'true') => base({ content: { events: [{ id: 'boom', when, cue: 'Boom.', then }] } });
const ok = input => validatePack(input).ok === true;

test('finding 8: an event attribute after a quoted value holding ">" is refused, in every quoting', () => {
    for (const html of [
        '<img alt=">" src=x onerror=alert(1)>',
        '<img alt=\'>\' src=x onerror=alert(1)>',
        '<img title="a>b" src=x onerror=alert(1)>',
        '<img alt=">"onerror=alert(1)>',
        '<p title="x>y" class=\'a>b\' data-x=">>" onclick="go()">t</p>',
        '<svg><g alt=">" onload=alert(1)/></svg>',
        '<p title="<img src=x onerror=alert(1)>">t</p>',
    ]) {
        assert.match(unsafeText(html), /event attribute/, html);
        assert.equal(ok(withNote(html)), false, html);
    }
});

test('finding 8: harmless tags and conditions are still accepted', () => {
    for (const text of [
        '<img alt=">" src="https://x.example/a.png">',
        'a<b && online == 1',
        "query('party.pc').level < 30 && online == 1 && a<b",
        '<b title="one > two">x</b>',
        '<p data-online="1">x</p>',
        'Dusk <falls> & the bells ring.',
        '<img online>',
    ]) assert.equal(unsafeText(text), '', text);
    assert.equal(ok(withNote('<span title="a>b">bold</span>')), true);
});

test('finding 8: a long run of open tags is read in linear time', () => {
    const text = '<a '.repeat(20000);
    const started = process.hrtime.bigint();
    assert.equal(unsafeText(text), '');
    assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 1000, 'reads quickly');
});

test('finding 10: a link or source holding a data: document is refused; raster data images are not', () => {
    for (const html of [
        '<a href="data:application/xhtml+xml;base64,PHNjcmlwdD4=">x</a>',
        '<a href="data:text/xml,<x/>">x</a>',
        '<a href="data:text/html,hi">x</a>',
        '<a href="data:image/svg+xml,<svg/>">x</a>',
        '<a href="data:,hello">x</a>',
        '<a href="data:application/json,{}">x</a>',
        '<a href="d&#97;ta:foo/bar,x">x</a>',
        '<svg><use href="data:whatever#x"/></svg>',
        '[x](data:text/html,hi)',
    ]) assert.equal(ok(withNote(html)), false, html);
    assert.equal(ok(withScreen({ template: '<a href="data:text/xml,<x/>">x</a>' })), false);
    assert.equal(ok(withNote('<img src="data:image/png;base64,iVBORw0KGgo=">')), true);
    assert.equal(ok(withNote('<a href="https://example.com/a">x</a>')), true);
    assert.equal(ok(withNote('Data: the old ledger, page 3.')), true, 'the word "data:" in prose');
});

test('finding 9: image-set(), -webkit-image-set(), image(), cross-fade() and src() load only https or raster data', () => {
    for (const css of [
        '.a { background-image: image-set("http://evil.example/a.png" 1x); }',
        '.a { background-image: -webkit-image-set("//evil.example/a.png" 1x); }',
        '.a { background-image: image-set(url(https://ok.example/a.png) 1x, "http://evil.example/b.png" 2x); }',
        '.a { background-image: image("http://evil.example/a.png"); }',
        '.a { background-image: cross-fade("http://evil.example/a.png", "https://ok.example/b.png", 50%); }',
        '.a { background-image: image-set(var(--a) 1x); }',
        '.a { background-image: src(var(--a)); }',
        '.a { --a: "http://evil.example/x.png"; }',
    ]) {
        assert.notEqual(unsafeCss(css), '', css);
        assert.equal(ok(withScreen({ css })), false, css);
    }
    for (const css of [
        '.a { background-image: image-set("https://ok.example/a.png" 1x, url(data:image/png;base64,iVBORw0KGgo=) 2x); }',
        '.a::before { content: "Note: kept"; }',
        '.a { font-family: "Fira Sans", sans-serif; }',
    ]) assert.equal(unsafeCss(css), '', css);
});

test('finding 9: a pack theme or screen theme cannot hide a loader either', () => {
    assert.equal(ok(base({ theme: { '--ss-bg': 'image-set("http://evil.example/a.png" 1x)' } })), false);
    assert.equal(ok(base({ theme: { '--ss-bg': '-webkit-image-set("//evil.example/a.png" 1x)' } })), false);
    assert.equal(ok(base({ theme: { '--ss-img': '"http://evil.example/a.png"' } })), false);
    assert.equal(ok(withScreen({ theme: { '--ss-bg': 'image-set(var(--x) 1x)' } })), false);
    const fine = validatePack(base({ theme: { '--ss-accent': '#7c5cff', '--ss-label': '"HP: "', '--ss-bg': 'image-set("https://ok.example/a.png" 1x)' } }));
    assert.equal(fine.ok, true, JSON.stringify(fine.errors));
});

test('finding 11: an event runs only module commands, never the ones Story Block makes for itself', () => {
    for (const command of ['module.init.story-block', 'module.init.rpg-battle', 'capture.coin', 'capture.item', 'events.fire', 'module.anything']) {
        const result = validatePack(withEvent([{ command, payload: {} }]));
        assert.equal(result.ok, false, command);
        assert.match(result.errors[0].message, /Story Block runs itself/, command);
    }
    for (const command of ['wallet.receive', 'inventory.grant', 'events.status-check', 'rpg-battle.start']) {
        const result = validatePack(withEvent([{ command, payload: {} }]));
        assert.equal(result.ok, true, `${command}: ${JSON.stringify(result.errors)}`);
    }
});
