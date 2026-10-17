// Body escaping shared by every format.
//
// Block bodies travel inside a hidden HTML comment and inside <Tag>…</Tag>, so three
// things must never appear raw in a stored body: "-->" (ends the comment), the
// block's own tag (ends or nests the block) and the <Blocks> envelope tag. A
// backslash escapes them; a literal backslash is doubled. Unescaping only touches
// those sequences, so text a model wrote with an ordinary backslash survives.

function tagAlternation(tag) {
    const names = ['Blocks'];
    if (tag && /^[A-Za-z][A-Za-z0-9_]*$/.test(tag)) names.push(tag);
    return names.join('|');
}

export function escapeBody(text, tag) {
    const tags = new RegExp(`<(\\/?)(${tagAlternation(tag)})\\b`, 'gi');
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/-->/g, '--\\>')
        .replace(tags, (_match, slash, name) => `<\\${slash}${name}`);
}

export function unescapeBody(text) {
    return String(text ?? '').replace(/\\\\|--\\>|<\\(?=\/?[A-Za-z])/g, match => {
        if (match === '\\\\') return '\\';
        if (match === '--\\>') return '-->';
        return '<';
    });
}
