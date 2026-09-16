import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { extract } from '../../src/capability/extractor.js';
import { ExtractError } from '../../src/shared/errors.js';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';
import { loadNegativeFixtures } from '../helpers/negative-fixtures.js';

// Only fixtures whose expected phase is 'extract' run here — later phases
// (e.g. traversal, phase 'guard') are driven by tests/guard/negative.test.ts.
const fixtures = loadNegativeFixtures(new URL('./negative/', import.meta.url)).filter(
  (f) => f.expected.phase === 'extract',
);

describe('Phase 3: extractor negatives (E3xx)', () => {
  it('covers every reachable E3xx code (E304 is the tsc-backed runtime backstop)', () => {
    const codes = [...new Set(fixtures.map((f) => f.expected.code.slice(0, 4)))].sort();
    expect(codes).toEqual(['E301', 'E302', 'E303', 'E305']);
  });

  for (const { basename, source, rawExpected } of fixtures) {
    it(`${basename}.negative.placitum throws the exact expected code`, () => {
      const expected = PlacitumErrorSchema.parse(rawExpected);
      let thrown: unknown;
      try {
        extract(parse(lex(source)));
      } catch (err) {
        thrown = err;
      }
      if (!(thrown instanceof ExtractError)) {
        throw new Error(`expected ExtractError, got: ${String(thrown)}`);
      }
      expect(thrown.code).toBe(expected.code);
      expect(PlacitumErrorSchema.safeParse(thrown.toEnvelope()).success).toBe(true);
    });
  }
});
