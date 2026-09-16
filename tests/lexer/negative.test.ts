import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { LexError, PlacitumErrorSchema } from '../../src/shared/errors.js';

const negativeDir = new URL('./negative/', import.meta.url);

const scripts = readdirSync(negativeDir)
  .filter((f) => f.endsWith('.negative.placitum'))
  .sort();

describe('Phase 1: lexer negatives (E1xx)', () => {
  it('pairs scripts and .expected-error.json 1:1 in both directions', () => {
    const jsonBasenames = readdirSync(negativeDir)
      .filter((f) => f.endsWith('.expected-error.json'))
      .map((f) => f.replace(/\.expected-error\.json$/, ''))
      .sort();
    const scriptBasenames = scripts.map((f) => f.replace(/\.negative\.placitum$/, ''));
    expect(jsonBasenames).toEqual(scriptBasenames);
  });

  it('covers every E1xx code in the Section 9.2 catalog', () => {
    const codes = scripts.map((f) => f.slice(0, 4)).sort();
    expect(codes).toEqual(['e101', 'e102', 'e103', 'e104', 'e104', 'e105', 'e106']);
  });

  for (const script of scripts) {
    const basename = script.replace(/\.negative\.placitum$/, '');

    it(`${script} throws the exact expected code`, () => {
      const expectedRaw = JSON.parse(
        readFileSync(new URL(`${basename}.expected-error.json`, negativeDir), 'utf8'),
      ) as unknown;
      const expected = PlacitumErrorSchema.parse(expectedRaw);

      const source = readFileSync(new URL(script, negativeDir), 'utf8');
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
