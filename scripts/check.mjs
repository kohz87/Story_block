// Syntax-checks every shipped module (index.js and everything under src/, testkit/ and examples/).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (name === 'node_modules') return [];
        return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') || path.endsWith('.mjs') ? [path] : [];
    });
}

for (const file of ['index.js', ...walk('src'), ...walk('testkit'), ...walk('examples'), ...walk('scripts')]) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log('syntax ok');
