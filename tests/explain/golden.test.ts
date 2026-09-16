import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import type { Program } from '../../src/ast/ast.js';
import { extract } from '../../src/capability/extractor.js';
import { explain } from '../../src/cli/explain.js';

const explainDir = new URL('./', import.meta.url);

// rosetta's source lives with the parser goldens (Section 6's exact script),
// kitchen-sink's with the capability goldens; their explain goldens live here
// per Section 10 naming. Kitchen-sink covers what rosetta cannot: wildcard net,
// optional env, exec/fsWrite grants, and top-level deferred entries.
const sources: Array<{ name: string; url: URL }> = [
  { name: 'rosetta', url: new URL('../parser/rosetta.placitum', explainDir) },
  { name: 'kitchen-sink', url: new URL('../capability/kitchen-sink.placitum', explainDir) },
];

// ponytail: generate goldens with UPDATE_GOLDENS=1 (spec Section 6: generated,
// then hand-reviewed before commit); CI always compares only.
const update = process.env['UPDATE_GOLDENS'] === '1';

describe('Phase 6: explain goldens (Section 10)', () => {
  it('pairs every explain source with a .explain.golden.txt 1:1', () => {
    const goldens = readdirSync(explainDir)
      .filter((f) => f.endsWith('.explain.golden.txt'))
      .map((f) => f.replace(/\.explain\.golden\.txt$/, ''))
      .sort();
    expect(goldens).toEqual(sources.map((s) => s.name).sort());
  });

  for (const { name, url } of sources) {
    it(`${name} renders byte-for-byte to its golden`, () => {
      const program: Program = parse(lex(readFileSync(url, 'utf8')));
      const actual = explain(extract(program));
      const goldenUrl = new URL(`${name}.explain.golden.txt`, explainDir);
      if (update) {
        writeFileSync(goldenUrl, actual);
        return;
      }
      expect(actual).toBe(readFileSync(goldenUrl, 'utf8'));
    });
  }
});
