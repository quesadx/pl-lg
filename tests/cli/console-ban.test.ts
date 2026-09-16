import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phase 9 DoD — the grep-based CI check: every PlacitumError reaching the CLI
// boundary renders through the single Section 9.3 formatter. An ad hoc
// console.log/console.error in src/ is exactly the regression this catches;
// host output belongs to /host-bindings, CLI output to src/cli/main.ts.

const srcDir = fileURLToPath(new URL('../../src', import.meta.url));

describe('Phase 9: CLI error funnel (Section 11)', () => {
  it('leaves no ad hoc console.* calls anywhere in src/', () => {
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => readFileSync(join(srcDir, f), 'utf8').includes('console.'));
    expect(offenders).toEqual([]);
  });
});
