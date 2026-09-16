import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import type { Program } from '../../src/ast/ast.js';
import { extract } from '../../src/capability/extractor.js';
import { ExtractError } from '../../src/shared/errors.js';

const capabilityDir = new URL('./', import.meta.url);

// rosetta's source lives with the parser goldens (Section 6's exact script);
// its MANIFEST golden lives here per Section 10 naming.
const sources: Array<{ name: string; url: URL }> = readdirSync(capabilityDir)
  .filter((f) => f.endsWith('.placitum'))
  .sort()
  .map((f) => ({ name: f.replace(/\.placitum$/, ''), url: new URL(f, capabilityDir) }));
sources.push({ name: 'rosetta', url: new URL('../parser/rosetta.placitum', capabilityDir) });

// Deterministic 2-space JSON; key insertion order (net, fsRead, fsWrite, exec,
// env, scoped, deferredToRuntime) is load-bearing. Compared byte-for-byte.
function serialize(manifest: unknown): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

// ponytail: generate goldens with UPDATE_GOLDENS=1 (spec Section 6: generated,
// then hand-reviewed before commit); CI always compares only.
const update = process.env['UPDATE_GOLDENS'] === '1';

describe('Phase 3: manifest goldens (Section 10)', () => {
  it('pairs every manifest source with a .manifest.golden.json 1:1', () => {
    const goldens = readdirSync(capabilityDir)
      .filter((f) => f.endsWith('.manifest.golden.json'))
      .map((f) => f.replace(/\.manifest\.golden\.json$/, ''))
      .sort();
    expect(goldens).toEqual(sources.map((s) => s.name).sort());
  });

  for (const { name, url } of sources) {
    it(`${name} extracts byte-for-byte to its golden`, () => {
      const program: Program = parse(lex(readFileSync(url, 'utf8')));
      const actual = serialize(extract(program));
      const goldenUrl = new URL(`${name}.manifest.golden.json`, capabilityDir);
      if (update) {
        writeFileSync(goldenUrl, actual);
        return;
      }
      const expected = readFileSync(goldenUrl, 'utf8');
      expect(actual).toBe(expected);
    });
  }

  it('E304 fires on a node outside the union (runtime backstop)', () => {
    const bogus = { kind: 'Bogus', needs: [], body: [{ kind: 'Bogus' }] } as unknown as Program;
    let thrown: unknown;
    try {
      extract(bogus);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ExtractError);
    expect((thrown as ExtractError).code).toBe('E304_EXTRACT_UNHANDLED_NODE');
  });
});
