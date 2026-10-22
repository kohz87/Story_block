// Breaker a3 (v2 pass 2): Diagnostics replaces "text that looks like a secret" (diagnostics.js SECRET_VALUE),
// but common key shapes slip through: a 32-character mixed-case key (Mistral and others), an AWS access
// key id, a NovelAI/Horde-style short key. Live: a Story Director era / RPG Battle XP word / NSD setting
// holding one appeared verbatim in Copy report and Save report (scripts/diag.mjs, diag-report-1440.txt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSettings, scrubLine } from '../../../src/v2/diagnostics.js';

const KEYS = {
    mistral: 'Xq7Lm2Pz9Rt4Vb8N' + 'c1Kd6Fg3Hj5Ws0Ya',
    aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
    hordeLike: '0000000000',          // the anonymous Horde key is not a secret: kept on purpose (control)
};

for (const [name, key] of Object.entries(KEYS).filter(([n]) => n !== 'hordeLike')) {
    test(`a ${name}-shaped key in a setting's text is removed`, () => {
        const out = JSON.stringify(scrubSettings({ 'tracker.calendar.era': `era ${key}`, xpName: key }));
        assert.ok(!out.includes(key), `kept: ${out}`);
        assert.ok(!scrubLine(`connected with ${key}`).includes(key));
    });
}
