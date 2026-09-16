import { describe, expect, it } from 'vitest';
import { runSource } from '../../src/evaluator/run.js';
import { EvalError } from '../../src/shared/errors.js';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';
import { loadNegativeFixtures } from '../helpers/negative-fixtures.js';
import { captureHosts, permissiveGuard } from './helpers/fakes.js';

// Phase 5: eval-phase negatives run the real pipeline end to end
// (lex -> parse -> extract -> compile -> evaluate) and must throw their paired
// E5xx code exactly.
const fixtures = loadNegativeFixtures(new URL('./negative/', import.meta.url)).filter(
  (f) => f.expected.phase === 'eval',
);

describe('Phase 5: evaluator negatives (E5xx)', () => {
  it('covers every reachable E5xx code', () => {
    const codes = [...new Set(fixtures.map((f) => f.expected.code.slice(0, 4)))].sort();
    expect(codes).toEqual(['E500', 'E501', 'E502', 'E503', 'E504', 'E505', 'E506']);
  });

  for (const { basename, source, rawExpected } of fixtures) {
    it(`${basename}.negative.placitum throws the exact expected code`, () => {
      const expected = PlacitumErrorSchema.parse(rawExpected);
      const { hosts } = captureHosts();
      let thrown: unknown;
      try {
        runSource(source, { env: {}, guard: permissiveGuard(), hosts });
      } catch (err) {
        thrown = err;
      }
      if (!(thrown instanceof EvalError)) {
        throw new Error(`expected EvalError, got: ${String(thrown)}`);
      }
      expect(thrown.code).toBe(expected.code);
      expect(PlacitumErrorSchema.safeParse(thrown.toEnvelope()).success).toBe(true);
    });
  }
});
