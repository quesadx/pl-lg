import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lex, type Token } from '../../src/lexer/lexer.js';

const lexerDir = new URL('./', import.meta.url);

const sources = readdirSync(lexerDir)
  .filter((f) => f.endsWith('.placitum'))
  .sort();

// One token per line: deterministic, diff-friendly, and compared byte-for-byte
// per the Phase 1 CI gate.
function serialize(tokens: Token[]): string {
  return '[\n' + tokens.map((t) => JSON.stringify(t)).join(',\n') + '\n]\n';
}

describe('Phase 1: lexer goldens (Section 10)', () => {
  it('pairs every .placitum with a .lex.golden.json 1:1', () => {
    const goldens = readdirSync(lexerDir)
      .filter((f) => f.endsWith('.lex.golden.json'))
      .map((f) => f.replace(/\.lex\.golden\.json$/, ''))
      .sort();
    expect(goldens).toEqual(sources.map((f) => f.replace(/\.placitum$/, '')));
  });

  for (const file of sources) {
    it(`${file} lexes byte-for-byte to its golden`, () => {
      const source = readFileSync(new URL(file, lexerDir), 'utf8');
      const actual = serialize(lex(source));
      const expected = readFileSync(
        new URL(file.replace(/\.placitum$/, '.lex.golden.json'), lexerDir),
        'utf8',
      );
      expect(actual).toBe(expected);
    });
  }
});
