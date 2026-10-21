// Test helpers for the template renderer: the v1 fake DOM, a printer for what was rendered, a counter of
// DOM writes (to prove a second render changes nothing), and a tiny stand-in for the events condition
// language (paths, literals, ! && || == != < <= > >=, + - * /, calls to scope functions).
import { FakeElement, FakeText, installFakeDom } from '../../../ui-fake-dom.js';

export { installFakeDom };

/** The rendered tree as compact HTML-like text (attributes sorted; style variables listed). */
export function print(node) {
    if (node.nodeType === 3) return node.data;
    const tag = node.tagName.toLowerCase();
    const attrs = [];
    if (node.className) attrs.push(`class="${node.className}"`);
    if (node.id) attrs.push(`id="${node.id}"`);
    for (const name of node.attributeNames().sort()) if (name !== 'class' && name !== 'id') attrs.push(`${name}="${node.getAttribute(name)}"`);
    const vars = Object.entries(node.styleProps).map(([k, v]) => `${k}:${v}`).join(';');
    if (vars) attrs.push(`style="${vars}"`);
    const inner = node.childNodes.map(print).join('');
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${inner}</${tag}>`;
}

export const inner = el => el.childNodes.map(print).join('');

/** Count DOM writes while `fn` runs. */
export function countWrites(fn) {
    let writes = 0;
    const restore = [];
    const wrap = (proto, name) => {
        const original = proto[name];
        proto[name] = function (...args) { writes += 1; return original.apply(this, args); };
        restore.push(() => { proto[name] = original; });
    };
    for (const name of ['setAttribute', 'removeAttribute', 'insertBefore', 'replaceChildren']) wrap(FakeElement.prototype, name);
    for (const proto of [FakeElement.prototype, FakeText.prototype]) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'textContent');
        Object.defineProperty(proto, 'textContent', { ...descriptor, set(value) { writes += 1; descriptor.set.call(this, value); } });
        restore.push(() => Object.defineProperty(proto, 'textContent', descriptor));
    }
    try {
        fn();
    } finally {
        restore.forEach(undo => undo());
    }
    return writes;
}

// ---------------------------------------------------------------------------------------------------
// A tiny condition language for tests (the real one is src/v2/events).

export function fakeEvaluate(expr, scope) {
    const tokens = tokenize(expr);
    let at = 0;
    const peek = () => tokens[at];
    const next = () => tokens[at++];
    const expect = value => {
        if (next()?.value !== value) throw new Error(`expected ${value} in ${expr}`);
    };
    const binary = (levels, index) => {
        if (index === levels.length) return unary();
        let left = binary(levels, index + 1);
        while (peek() && levels[index].includes(peek().value) && peek().type === 'op') {
            const op = next().value;
            const right = binary(levels, index + 1);
            left = apply(op, left, right);
        }
        return left;
    };
    const levels = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/']];
    const unary = () => {
        if (peek()?.value === '!') { next(); return !unary(); }
        if (peek()?.value === '-') { next(); return -unary(); }
        return postfix(primary());
    };
    const primary = () => {
        const token = next();
        if (!token) throw new Error(`unexpected end of ${expr}`);
        if (token.type === 'num' || token.type === 'str') return token.value;
        if (token.value === '(') { const value = binary(levels, 0); expect(')'); return value; }
        if (token.type === 'name') {
            if (token.value === 'true') return true;
            if (token.value === 'false') return false;
            if (token.value === 'null') return null;
            return Object.hasOwn(scope, token.value) ? scope[token.value] : undefined;
        }
        throw new Error(`unexpected ${token.value} in ${expr}`);
    };
    const postfix = value => {
        for (;;) {
            if (peek()?.value === '.') { next(); const key = next().value; value = value != null && Object.hasOwn(Object(value), key) ? value[key] : undefined; }
            else if (peek()?.value === '[') { next(); const key = binary(levels, 0); expect(']'); value = value != null && Object.hasOwn(Object(value), key) ? value[key] : undefined; }
            else if (peek()?.value === '(') {
                next();
                const args = [];
                while (peek()?.value !== ')') { args.push(binary(levels, 0)); if (peek()?.value === ',') next(); }
                next();
                value = typeof value === 'function' ? value(...args) : undefined;
            } else return value;
        }
    };
    const value = binary(levels, 0);
    if (at !== tokens.length) throw new Error(`trailing ${tokens[at].value} in ${expr}`);
    return value;
}

function apply(op, a, b) {
    switch (op) {
        case '||': return a || b;
        case '&&': return a && b;
        case '==': return a === b;
        case '!=': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        default: throw new Error(op);
    }
}

function tokenize(expr) {
    const tokens = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*)|(\|\||&&|==|!=|<=|>=|[<>!+\-*/().,[\]]))/y;
    let match;
    while (re.lastIndex < expr.length && (match = re.exec(expr))) {
        if (match[1]) tokens.push({ type: 'num', value: Number(match[1]) });
        else if (match[2] !== undefined || match[3] !== undefined) tokens.push({ type: 'str', value: match[2] ?? match[3] });
        else if (match[4]) tokens.push({ type: 'name', value: match[4] });
        else tokens.push({ type: 'op', value: match[5] });
    }
    if (expr.slice(re.lastIndex).trim()) throw new Error(`cannot read ${expr}`);
    return tokens;
}
