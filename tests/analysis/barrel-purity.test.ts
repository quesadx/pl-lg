import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extract } from '../../src/capability/extractor.js';
import { explain } from '../../src/cli/explain.js';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { loadVmModule } from '../helpers/vm-sandbox.js';

// LSP contract (placitum-lsp-implementation.md §5.1): the public barrel is the
// only import the language server is allowed to use, and its runtime closure
// must stay I/O-free — no host-bindings, no guard, no evaluator. The vm harness
// throws on any import outside this list, so a new runtime dependency (or an
// accidental value import of host-bindings from stdlib) fails loudly here.

const CLOSURE = [
  'src/index.ts',
  'src/lexer/lexer.ts',
  'src/parser/parser.ts',
  'src/capability/extractor.ts',
  'src/cli/explain.ts',
  'src/cli/format-error.ts',
  'src/analysis/analyze.ts',
  'src/analysis/strict.ts',
  'src/shared/errors.ts',
  'src/shared/error-schema.ts',
  'src/shared/manifest.ts',
  'src/shared/glob-to-regex.ts',
  'src/shared/printable.ts',
  'src/shared/values.ts',
  'src/shared/assert-never.ts',
  'src/stdlib/stdlib.ts',
] as const;

interface AnalyzeResultShape {
  complete: boolean;
  diagnostics: { code: string }[];
  manifest: unknown;
}

interface Barrel {
  analyzeSource: (source: string) => AnalyzeResultShape;
  explain: (manifest: unknown) => string;
  BANG_SIGNATURES: Record<string, unknown>;
}

describe('LSP barrel: purity smoke test (no I/O in the public import closure)', () => {
  const barrel = loadVmModule<Barrel>(
    { closure: CLOSURE, bareImports: { zod: { z } } },
    'src/index.ts',
  );

  it('analyzes a source string inside the sandbox', () => {
    const result = barrel.analyzeSource('needs net("api.example.com")\ncurl!("https://api.example.com")\n');
    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).not.toBeNull();
  });

  it('renders explain output byte-identical to the normal run', () => {
    const source = readFileSync(new URL('../parser/rosetta.placitum', import.meta.url), 'utf8');
    const manifest = extract(parse(lex(source)));
    expect(barrel.explain(manifest)).toBe(explain(manifest));
  });

  it('exposes the stdlib signature table used by completion/hover', () => {
    expect(Object.keys(barrel.BANG_SIGNATURES)).toContain('fs.readFile');
  });
});
