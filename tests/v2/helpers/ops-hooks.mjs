// Module hook: while src/v2/ops.js has not landed, `./ops.js` imported by store.js resolves to the stub.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stub = new URL('./ops-stub.js', import.meta.url).href;

export async function resolve(specifier, context, next) {
    if (specifier === './ops.js' && context.parentURL?.endsWith('/src/v2/store.js')
        && !existsSync(fileURLToPath(new URL(specifier, context.parentURL)))) {
        return { url: stub, shortCircuit: true };
    }
    return next(specifier, context);
}
