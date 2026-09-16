import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { LexError } from '../../src/shared/errors.js';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';
import { loadNegativeFixtures } from '../helpers/negative-fixtures.js';

const fixtures = loadNegativeFixtures(new URL('./negative/', import.meta.url));

describe('Phase 1: lexer negatives (E1xx)', () => {
  it('covers every E1xx code in the Section 9.2 catalog', () => {
    const codes = fixtures.map((f) => f.basename.slice(0, 4)).sort();
    expect(codes).toEqual(['e101', 'e102', 'e103', 'e104', 'e104', 'e105', 'e106']);
  });

  for (const { basename, source, rawExpected } of fixtures) {
    it(`${basename}.negative.placitum throws the exact expected code`, () => {
      const expected = PlacitumErrorSchema.parse(rawExpected);
      let thrown: unknown;
      try {
        lex(source);
      } catch (err) {
        thrown = err;
      }
      if (!(thrown instanceof LexError)) {
        throw new Error(`expected LexError, got: ${String(thrown)}`);
      }
      expect(thrown.code).toBe(expected.code);
      expect(PlacitumErrorSchema.safeParse(thrown.toEnvelope()).success).toBe(true);
    });
  }
});
