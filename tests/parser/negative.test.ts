import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { ParseError } from '../../src/shared/errors.js';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';
import { loadNegativeFixtures } from '../helpers/negative-fixtures.js';

const fixtures = loadNegativeFixtures(new URL('./negative/', import.meta.url));

describe('Phase 2: parser negatives (E2xx)', () => {
  it('covers every E2xx code in the Section 9.2 catalog', () => {
    const codes = [...new Set(fixtures.map((f) => f.basename.slice(0, 4)))].sort();
    expect(codes).toEqual(['e201', 'e202', 'e203', 'e204', 'e205', 'e206']);
  });

  for (const { basename, source, rawExpected } of fixtures) {
    it(`${basename}.negative.placitum throws the exact expected code`, () => {
      const expected = PlacitumErrorSchema.parse(rawExpected);
      let thrown: unknown;
      try {
        parse(lex(source));
      } catch (err) {
        thrown = err;
      }
      if (!(thrown instanceof ParseError)) {
        throw new Error(`expected ParseError, got: ${String(thrown)}`);
      }
      expect(thrown.code).toBe(expected.code);
      expect(PlacitumErrorSchema.safeParse(thrown.toEnvelope()).success).toBe(true);
    });
  }
});
