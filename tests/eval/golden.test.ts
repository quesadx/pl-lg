import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runSource } from '../../src/evaluator/run.js';
import { captureHosts, permissiveGuard } from './helpers/fakes.js';
import type { HostBindings } from '../../src/host-bindings/index.js';

// Phase 5: evaluator output goldens (Section 10). Both scripts run with the
// permissive stub guard so the goldens are byte-identical on every platform;
// real-guard behavior is covered by chokepoint.test.ts.
interface EvalCase {
  name: string;
  source: string;
  hosts?: Partial<HostBindings>;
}

const configJson = JSON.stringify({
  enabled: true,
  name: 'app',
  endpoints: ['https://api.example.com/one', 'https://api.example.com/two'],
});

const cases: EvalCase[] = [
  {
    name: 'control-flow',
    source: readFileSync(new URL('./control-flow.placitum', import.meta.url), 'utf8'),
  },
  {
    name: 'rosetta',
    source: readFileSync(new URL('../parser/rosetta.placitum', import.meta.url), 'utf8'),
    hosts: {
      readFile: (): string => configJson,
      fetch: (): { status: number; body: string } => ({ status: 200, body: '{"status":"ok"}' }),
    },
  },
];

// ponytail: UPDATE_GOLDENS=1 regenerates (spec Section 6: generated, then
// hand-reviewed); CI only compares.
const update = process.env['UPDATE_GOLDENS'] === '1';

describe('Phase 5: evaluator goldens (Section 10)', () => {
  it('pairs every evaluated script with an .eval.golden.json', () => {
    const goldens = readdirSync(new URL('./', import.meta.url))
      .filter((f) => f.endsWith('.eval.golden.json'))
      .map((f) => f.replace(/\.eval\.golden\.json$/, ''))
      .sort();
    expect(goldens).toEqual(cases.map((c) => c.name).sort());
  });

  for (const { name, source, hosts: overrides } of cases) {
    it(`${name} evaluates to its golden output`, () => {
      const { hosts, stdout, stderr } = captureHosts(overrides ?? {});
      runSource(source, { env: { API_KEY: 'test-key' }, guard: permissiveGuard(), hosts });
      const actual = JSON.stringify({ stdout, stderr }, null, 2) + '\n';
      const goldenUrl = new URL(`./${name}.eval.golden.json`, import.meta.url);
      if (update) {
        writeFileSync(goldenUrl, actual);
        return;
      }
      expect(actual).toBe(readFileSync(goldenUrl, 'utf8'));
    });
  }
});
