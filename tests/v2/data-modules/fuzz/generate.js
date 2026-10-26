// Random data module definitions for the replay fuzz, and their malformed cousins. Valid ones are built from small safe
// pieces (the checker is the judge: `generate` retries with fewer pieces until validateDataModules accepts it), malformed ones
// by mutating a valid definition at random so that the checker must refuse or accept without ever throwing.
import { validateDataModules } from '../../../../src/v2/data-modules/check.js';

export const rng = seed => {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = () => next();
    r.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    r.pick = list => list[Math.floor(next() * list.length)];
    r.chance = p => next() < p;
    return r;
};

const OPS = ['+', '-', '~', '!'];
const int = (min, max, value = 0) => ({ type: 'int', min, max, default: Math.max(min, Math.min(max, value)) });
const TIERS = ['low', 'mid', 'high'];
const KEYS = ['x', 'y', 'z'];

/**
 * One valid definition. `options`: { scope, clock (a timer on the SD minute), source (the id of a module whose export it imports),
 * offers (kinds that offer then award), characters }.
 */
export function generate(r, slug, { scope = 'chat', clock = false, source = null, offers = false } = {}) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const rich = attempt === 0;
        const definition = {
            slug, name: slug[0].toUpperCase() + slug.slice(1), schema: 1, stateVersion: 1, scope,
            state: {
                a: int(r.int(-10, 0), r.int(10, 60), r.int(-2, 4)), b: int(0, 100, r.int(0, 10)),
                flag: { type: 'bool', default: false }, tier: { type: 'enum', values: TIERS, default: 'low' },
                m: { type: 'map', keys: KEYS, values: int(0, 20, 0) },
            },
            kinds: {}, rules: [], timers: [], rewards: {}, imports: {}, exports: {},
        };
        if (clock) definition.imports.clock = { query: 'director.time', mode: 'prefix', projection: ['minutes'] };
        if (source) definition.imports.src = { query: 'dataModules.public', args: { module: source, export: 'score' }, mode: 'prefix', projection: ['a', 'b'] };
        if (rich || r.chance(0.5)) {
            definition.rewards.prize = {
                bindings: { tier: { type: 'enum', values: TIERS } },
                values: { amount: { binding: 'tier', table: Object.fromEntries(TIERS.map((tier, i) => [tier, { min: i + 1, max: 2 * i + 3, pick: r.pick(['min', 'max', 'midpoint']) }])) } },
                ...(offers ? { when: ['not', ['get', ['flag']]] } : {}),
                effects: [{ op: 'add', path: ['b'], value: ['reward', 'amount'], bounds: 'clamp' }],
            };
        }
        const labelSets = [
            {}, { n: { type: 'int', min: 1, max: 5 } }, { which: { type: 'enum', values: KEYS } },
            { n: { type: 'int', min: 1, max: 5 }, which: { type: 'enum', values: KEYS } }, { tier: { type: 'enum', values: TIERS } },
        ];
        const count = r.int(2, 4);
        for (let i = 0; i < count; i += 1) {
            const labels = r.pick(labelSets);
            const effects = [];
            const amount = labels.n ? ['arg', 'n'] : r.int(-6, 9);
            if (r.chance(0.8)) effects.push({ op: 'add', path: ['a'], value: amount, bounds: 'clamp' });
            if (r.chance(0.6)) effects.push({ op: 'add', path: ['b'], value: r.int(-5, 9), bounds: 'clamp' });
            if (labels.which && r.chance(0.8)) effects.push({ op: 'add', path: ['m', ['arg', 'which']], value: labels.n ? ['arg', 'n'] : r.int(1, 4), bounds: 'clamp' });
            if (r.chance(0.3)) effects.push({ op: 'set', path: ['flag'], value: r.chance(0.5) });
            if (r.chance(0.2)) effects.push({ op: 'set', path: ['tier'], value: r.pick(TIERS) });
            // Constants repeat across actions: these sets can be no-ops with no saved field patch.
            if (r.chance(0.4)) effects.push({ op: 'set', path: ['b'], value: r.pick([0, 5, 100]) });
            if (labels.tier && definition.rewards.prize) effects.push({ op: 'reward', template: 'prize', bind: { tier: ['arg', 'tier'] } });
            if (source && r.chance(0.5)) effects.push({ op: 'set', path: ['b'], value: ['clamp', ['input', 'src', 'a'], 0, 100] });
            if (!effects.length) effects.push({ op: 'set', path: ['flag'], value: true });
            const kind = { op: r.pick(OPS), labels, effects };
            if (r.chance(0.3)) { kind.when = ['ge', ['get', ['a']], r.int(-5, 5)]; kind.refusal = 'Not enough standing yet.'; }
            if (labels.which && r.chance(0.5)) kind.oncePerReply = ['which'];
            if (r.chance(0.3)) kind.ui = true;
            definition.kinds[`k${i}`] = kind;
        }
        if (offers && definition.rewards.prize) {
            definition.kinds.promise = { op: '+', labels: { tier: { type: 'enum', values: TIERS } }, effects: [{ op: 'offer', template: 'prize', key: 'promise', bind: { tier: ['arg', 'tier'] } }] };
            definition.kinds.fulfil = { op: '!', labels: {}, effects: [{ op: 'award', offer: 'promise' }] };
            definition.kinds.clearflag = { op: '!', labels: {}, effects: [{ op: 'set', path: ['flag'], value: false }] };
        }
        if (rich || r.chance(0.5)) definition.rules.push({ id: 'latch', when: ['and', ['ge', ['get', ['b']], r.int(10, 40)], ['not', ['get', ['flag']]]], then: [{ op: 'set', path: ['flag'], value: true }] });
        if (rich && r.chance(0.6)) definition.rules.push({ id: 'bonus', when: ['ge', ['get', ['a']], r.int(2, 9)], then: [{ op: 'add', path: ['b'], value: 1, bounds: 'clamp' }] });
        if (clock) {
            definition.imports.gate = { query: 'director.time', mode: r.pick(['prefix', 'recorded']), projection: ['minutes'] };
            definition.rules.push({ id: 'late', when: ['ge', ['input', 'gate', 'minutes'], r.pick([1030, 1060, 1120])], then: [{ op: 'set', path: ['tier'], value: 'high' }] });
            definition.timers.push({ id: 'tick', clock: 'clock', every: r.pick([15, 30, 60, 90]), effects: [{ op: 'add', path: ['b'], value: ['mul', ['timer', 'periods'], r.int(1, 3)], bounds: 'clamp' }] });
            if (rich) definition.timers[0].effects.push({ op: 'add', path: ['a'], value: ['timer', 'periods'], bounds: 'clamp' });
        }
        definition.exports.score = { fields: ['a', 'b'] };
        if (scope === 'character') definition.imports.actors = { query: 'checks.policy', mode: 'prefix', projection: ['actors.id', 'actors.name'] };
        const verdict = validateDataModules([definition], { packId: 'fz', capabilities: ['data-modules-v1'], definitions: source ? [] : [] });
        if (verdict.ok || source) return definition;
    }
    throw new Error(`no valid generated definition for ${slug}`);
}

// Small generated semantic probes. Both original review bugs agreed live/cold, so these also
// assert that deleting a source retracts the dependent action, rather than only testing parity.
export function witnessDefinition(r) {
    const score = r.int(3, 9), minutes = 1000 + r.pick([30, 60, 90, 120]);
    return {
        slug: 'witness', name: 'Witness', schema: 1, stateVersion: 1, scope: 'chat',
        state: { score: int(1, score, 1), title: { type: 'bool', default: false },
            armed: { type: 'bool', default: false }, 'clock-title': { type: 'bool', default: false } },
        imports: { clock: { query: 'director.time', mode: r.pick(['recorded', 'recorded', 'prefix']), projection: ['minutes'] } },
        kinds: {
            reset: { op: '!', labels: {}, effects: [
                { op: 'set', path: ['score'], value: 1 },
                ...['title', 'armed', 'clock-title'].map(key => ({ op: 'set', path: [key], value: false })),
            ] },
            prime: { op: '!', labels: {}, effects: [{ op: 'set', path: ['score'], value: score }] },
            repeat: { op: '!', labels: {}, when: ['ge', ['get', ['score']], 1], effects: [
                { op: 'set', path: ['score'], value: score }, { op: 'reward', template: 'title', bind: {} },
            ] },
            arm: { op: '!', labels: {}, effects: [{ op: 'set', path: ['armed'], value: true }] },
        },
        rewards: { title: { bindings: {}, values: {}, when: ['ge', ['get', ['score']], score],
            effects: [{ op: 'set', path: ['title'], value: true }] } },
        rules: [{ id: 'late', when: ['and', ['get', ['armed']], ['ge', ['input', 'clock', 'minutes'], minutes]],
            then: [{ op: 'set', path: ['clock-title'], value: true }] }],
    };
}

/** Random damage to a valid definition: the checker may refuse or accept, but must not throw. */
export function mutate(r, definition) {
    const copy = structuredClone(definition);
    const spots = [];
    const walk = (node, path) => {
        if (node === null || typeof node !== 'object') return;
        for (const key of Object.keys(node)) { spots.push([node, key, [...path, key]]); walk(node[key], [...path, key]); }
    };
    walk(copy, []);
    const [node, key] = r.pick(spots);
    const damage = r.int(0, 9);
    const bad = [undefined, null, -1, 1e400, 2 ** 60, 'x'.repeat(300), [], {}, ['unknown'], ['get'], ['add', 1], ['__proto__'], 'constructor', true][r.int(0, 13)];
    if (damage < 4) node[key] = bad;
    else if (damage < 6) delete node[key];
    else if (damage < 7) node[`${key}2`] = bad;
    else if (damage < 8) { node.__proto__ = { polluted: true }; }
    else if (damage < 9) node[key] = [node[key], node[key], node[key]];
    else {
        // A deep expression.
        let deep = 1;
        for (let i = 0; i < 12; i += 1) deep = ['add', deep, 1];
        node[key] = deep;
    }
    return copy;
}
