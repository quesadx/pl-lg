import { describe, expect, it } from 'vitest';
import { calleeSignature, collectStrictDiagnostics, inferType } from '../../src/analysis/strict.js';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { PURE_SIGNATURES } from '../../src/stdlib/stdlib.js';

// LSP contract (placitum-lsp-implementation.md §5.3): the #!strict pre-pass is
// a pure collector so the language server can reuse it without executing
// anything. evaluate() still throws the first collected error.

function programOf(source: string): ReturnType<typeof parse> {
  return parse(lex(source));
}

describe('collectStrictDiagnostics', () => {
  it('returns the same E505 the evaluator throws, located at the failing stage', () => {
    const program = programOf('#!strict\nprint!("boom") | json.parse');
    const errors = collectStrictDiagnostics(program);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('E505_EVAL_PIPE_TYPE_ERROR');
    expect(errors[0]?.location?.line).toBe(2);
    expect(errors[0]?.location?.col).toBe(18);
  });

  it('collects one error per broken chain', () => {
    const program = programOf('#!strict\nprint!("a") | json.parse\nprint!("b") | json.parse');
    expect(collectStrictDiagnostics(program).map((e) => e.code)).toEqual([
      'E505_EVAL_PIPE_TYPE_ERROR',
      'E505_EVAL_PIPE_TYPE_ERROR',
    ]);
  });

  it('is empty without #!strict', () => {
    expect(collectStrictDiagnostics(programOf('print!("boom") | json.parse'))).toEqual([]);
  });

  it('is empty for a well-typed strict chain', () => {
    expect(collectStrictDiagnostics(programOf('#!strict\n"{}" | json.parse'))).toEqual([]);
  });
});

describe('inferType / calleeSignature (exported for the LSP)', () => {
  it('infers literal, f-string, array and object types', () => {
    const program = programOf('1\nf"x"\n[1]\n{ a: 1 }');
    const kinds = program.body.map((stmt) =>
      stmt.kind === 'ExprStmt' ? inferType(stmt.expression) : 'nope',
    );
    expect(kinds).toEqual(['number', 'string', 'array', 'object']);
  });

  it('resolves a pure stdlib callee signature', () => {
    const stmt = programOf('json.parse("{}")').body[0];
    if (stmt?.kind !== 'ExprStmt' || stmt.expression.kind !== 'CallExpr') {
      throw new Error('fixture shape changed');
    }
    expect(calleeSignature(stmt.expression.callee)).toEqual(PURE_SIGNATURES['json.parse']);
  });
});
