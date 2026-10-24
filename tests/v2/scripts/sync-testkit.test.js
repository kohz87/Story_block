// npm run sync-testkit: the vendored copy keeps the layout, follows imports out of src/v2/, records
// the commit, replaces stale files, and the copied testkit runs a whole host from the module's side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { filesToCopy, syncTestkit } from '../../../scripts/sync-testkit.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('the copy holds testkit/, src/v2/, src/id.js and what they import from src/', () => {
    const files = filesToCopy(root);
    for (const file of ['testkit/index.js', 'testkit/host.js', 'src/v2/runtime.js', 'src/v2/store.js', 'src/id.js', 'src/text.js', 'src/ui/dom.js']) {
        assert.ok(files.includes(file), file);
    }
    assert.ok(!files.some(file => file.startsWith('tests/') || file === 'index.js' || file === 'index.v1.js'));
});

test('sync into a module checkout: layout, VERSION, stale files gone, and the vendored host runs', async () => {
    const module = mkdtempSync(join(tmpdir(), 'sb-sync-'));
    try {
        const stale = join(module, 'tests', 'vendor', 'story-block', 'old.js');
        mkdirSync(join(module, 'tests', 'vendor', 'story-block'), { recursive: true });
        writeFileSync(stale, '// gone');
        const { target, files, commit } = syncTestkit({ from: root, to: module });
        assert.equal(existsSync(stale), false);
        assert.ok(files.length > 50);
        assert.match(readFileSync(join(target, 'VERSION'), 'utf8'), new RegExp(`commit ${commit.replace('+', '\\+')}`));
        const kit = await import(pathToFileURL(join(target, 'testkit', 'index.js')).href);
        const host = await kit.createHost();
        await host.send('Go.', 'Rope.\n<Changes>\n+ item Rope\n</Changes>');
        assert.equal(Object.keys(host.head().domains.inventory.stacks).length, 1);
        host.close();
        assert.throws(() => syncTestkit({ from: root, to: root }), /Story Block itself/);
    } finally {
        rmSync(module, { recursive: true, force: true });
    }
});
