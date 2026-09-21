import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../../src/analysis/analyze.js';
import { extract } from '../../src/capability/extractor.js';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';

// LSP contract (placitum-lsp-implementation.md §5.2): analyzeSource is the
// tolerant single entry point the language server consumes. It must never
// throw on malformed input, always expose whatever tokens were produced, and
// only publish a manifest when the whole pipeline succeeded.

function expectSchemaValid(result: ReturnType<typeof analyzeSource>): void {
  for (const diagnostic of result.diagnostics) {
    expect(PlacitumErrorSchema.safeParse(diagnostic).success).toBe(true);
  }
}

describe('analyzeSource — clean input', () => {
  it('returns a complete analysis whose manifest equals the strict pipeline', () => {
    const source = 'needs net("api.example.com")\nlet r = curl!("https://api.example.com/x")\n';
    const result = analyzeSource(source);
    expectSchemaValid(result);
    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.program).not.toBeNull();
    expect(result.manifest).toEqual(extract(parse(lex(source))));
    expect(result.tokens.length).toBeGreaterThan(0);
  });
});

describe('analyzeSource — extract errors', () => {
  it('keeps the E301 diagnostic and the recovered program but withholds the manifest', () => {
    const result = analyzeSource('let x = fs.readFile!("/nope")\n');
    expectSchemaValid(result);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E301_EXTRACT_UNCOVERED_CAPABILITY']);
    expect(result.program).not.toBeNull();
    expect(result.manifest).toBeNull();
    expect(result.complete).toBe(false);
  });
});

describe('analyzeSource — syntax recovery', () => {
  it('reports every statement-level error, not just the first', () => {
    const result = analyzeSource('let = 1\nlet = 2\n');
    expectSchemaValid(result);
    const e201 = result.diagnostics.filter((d) => d.code === 'E201_PARSE_UNEXPECTED_TOKEN');
    expect(e201).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.manifest).toBeNull();
  });

  it('synthesizes the missing brace for an unterminated block', () => {
    const result = analyzeSource('fn f() {\n    let x = 1\n');
    expectSchemaValid(result);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E203_PARSE_UNTERMINATED_BLOCK']);
    expect(result.program?.body).toHaveLength(1);
    expect(result.program?.body[0]?.kind).toBe('FnDecl');
  });

  it('recovers from a stray closing brace at the top level', () => {
    const result = analyzeSource('}\nlet x = 1\n');
    expectSchemaValid(result);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.program?.body.some((s) => s.kind === 'LetStmt')).toBe(true);
  });

  it('terminates on an unterminated f-string interpolation', () => {
    const result = analyzeSource('let s = f"a {b');
    expectSchemaValid(result);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E102_LEX_UNTERMINATED_FSTRING_EXPR']);
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.program).toBeNull();
  });
});

describe('analyzeSource — lex errors', () => {
  it('returns the partial token stream and skips parsing', () => {
    const result = analyzeSource('let x = "abc\nlet y = 3\n');
    expectSchemaValid(result);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E101_LEX_UNTERMINATED_STRING']);
    expect(result.tokens.some((t) => t.value === 3)).toBe(true);
    expect(result.program).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('recovers from a lone ampersand and keeps lexing', () => {
    const result = analyzeSource('let x = 1 & 2\nlet y = 3\n');
    expectSchemaValid(result);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E104_LEX_UNEXPECTED_CHARACTER']);
    expect(result.tokens.some((t) => t.value === 3)).toBe(true);
  });

  it('recovers from a malformed number', () => {
    const result = analyzeSource('let x = 1.2.3\nlet y = 4\n');
    expectSchemaValid(result);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E106_LEX_INVALID_NUMBER']);
    expect(result.tokens.some((t) => t.value === 4)).toBe(true);
  });
});

describe('analyzeSource — comment trivia', () => {
  it('collects bare-comment spans', () => {
    const result = analyzeSource('# first\nlet x = 1\n# second\n');
    expect(result.comments).toHaveLength(2);
    const source = '# first\nlet x = 1\n# second\n';
    expect(source.slice(result.comments[0]?.span[0], result.comments[0]?.span[1])).toBe('# first');
    expect(source.slice(result.comments[1]?.span[0], result.comments[1]?.span[1])).toBe('# second');
  });

  it('does not treat `#` inside a string or f-string text as a comment', () => {
    const result = analyzeSource('let a = "x # y"\nlet b = f"# {a}"\n');
    expect(result.comments).toHaveLength(0);
  });

  it('does not record the line-1 pragma as a comment', () => {
    const result = analyzeSource('#!strict\nlet x = 1\n');
    expect(result.comments).toHaveLength(0);
    expect(result.program?.pragmas).toEqual(['strict']);
  });
});
