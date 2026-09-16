import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { extract } from '../../src/capability/extractor.js';
import { ExtractError } from '../../src/shared/errors.js';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';

const negativeDir = new URL('./negative/', import.meta.url);

const scripts = readdirSync(negativeDir)
  .filter((f) => f.endsWith('.negative.placitum'))
  .sort();

interface ExpectedError {
  code: string;
  phase: string;
}

// Only fixtures whose expected phase is 'extract' run here — later phases
// (e.g. traversal, phase 'guard') stay inert until their phase wires them up.
const expectedFor = (script: string): ExpectedError =>
  JSON.parse(
    readFileSync(new URL(`${script.replace(/\.negative\.placitum$/, '')}.expected-error.json`, negativeDir), 'utf8'),
  ) as ExpectedError;

const extractScripts = scripts.filter((f) => expectedFor(f).phase === 'extract');

describe('Phase 3: extractor negatives (E3xx)', () => {
  it('pairs scripts and .expected-error.json 1:1 in both directions', () => {
    const jsonBasenames = readdirSync(negativeDir)
      .filter((f) => f.endsWith('.expected-error.json'))
      .map((f) => f.replace(/\.expected-error\.json$/, ''))
      .sort();
    const scriptBasenames = scripts.map((f) => f.replace(/\.negative\.placitum$/, ''));
    expect(jsonBasenames).toEqual(scriptBasenames);
  });

  it('covers every reachable E3xx code (E304 is the tsc-backed runtime backstop)', () => {
    const codes = [...new Set(extractScripts.map((f) => expectedFor(f).code.slice(0, 4)))].sort();
    expect(codes).toEqual(['E301', 'E302', 'E303', 'E305']);
  });

  for (const script of extractScripts) {
    const basename = script.replace(/\.negative\.placitum$/, '');

    it(`${script} throws the exact expected code`, () => {
      const expectedRaw = JSON.parse(
        readFileSync(new URL(`${basename}.expected-error.json`, negativeDir), 'utf8'),
      ) as unknown;
      const expected = PlacitumErrorSchema.parse(expectedRaw);

      const source = readFileSync(new URL(script, negativeDir), 'utf8');
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
