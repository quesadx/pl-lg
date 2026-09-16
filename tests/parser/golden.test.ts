import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import type { Program } from '../../src/ast/ast.js';

const parserDir = new URL('./', import.meta.url);

const sources = readdirSync(parserDir)
  .filter((f) => f.endsWith('.placitum'))
  .sort();

// Deterministic 2-space JSON; key insertion order in parser-constructed nodes
// is load-bearing. Compared byte-for-byte per the Phase 2 CI gate.
function serialize(ast: Program): string {
  return JSON.stringify(ast, null, 2) + '\n';
}

// ponytail: generate goldens with UPDATE_GOLDENS=1 (spec Section 6: generated,
// then hand-reviewed before commit); CI always compares only.
const update = process.env['UPDATE_GOLDENS'] === '1';

describe('Phase 2: parser goldens (Section 10)', () => {
  it('pairs every .placitum with a .ast.golden.json 1:1', () => {
    const goldens = readdirSync(parserDir)
      .filter((f) => f.endsWith('.ast.golden.json'))
      .map((f) => f.replace(/\.ast\.golden\.json$/, ''))
      .sort();
    expect(goldens).toEqual(sources.map((f) => f.replace(/\.placitum$/, '')));
  });

  for (const file of sources) {
    it(`${file} parses byte-for-byte to its golden`, () => {
      const source = readFileSync(new URL(file, parserDir), 'utf8');
      const actual = serialize(parse(lex(source)));
      const goldenUrl = new URL(file.replace(/\.placitum$/, '.ast.golden.json'), parserDir);
      if (update) {
        writeFileSync(goldenUrl, actual);
        return;
      }
      const expected = readFileSync(goldenUrl, 'utf8');
      expect(actual).toBe(expected);
    });
  }
});
