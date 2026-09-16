import { describe, expect, it } from 'vitest';
import { runSource } from '../../src/evaluator/run.js';
import { EvalError, PlacitumErrorBase } from '../../src/shared/errors.js';
import { captureHosts, permissiveGuard } from './helpers/fakes.js';

// Runtime type-error matrix beyond what the goldens and the E5xx fixtures pin.
function outcome(source: string): string {
  try {
    runSource(source, { env: {}, guard: permissiveGuard(), hosts: captureHosts().hosts });
    return 'no error';
  } catch (err) {
    return err instanceof PlacitumErrorBase ? err.code : String(err);
  }
}

describe('Phase 5: evaluator type errors', () => {
  const cases: Array<[string, string]> = [
    ['let s = "a" - 1', 'E501_EVAL_TYPE_MISMATCH'],
    ['let s = "a" * 2', 'E501_EVAL_TYPE_MISMATCH'],
    ['let s = -"a"', 'E501_EVAL_TYPE_MISMATCH'],
    ['let s = "a" < "b"', 'E501_EVAL_TYPE_MISMATCH'],
    ['let s = null + null', 'E501_EVAL_TYPE_MISMATCH'],
    ['let n = 1\nlet s = n.name', 'E501_EVAL_TYPE_MISMATCH'],
    ['for x in 5 {\n    print!(x)\n}', 'E501_EVAL_TYPE_MISMATCH'],
    ['let p = "not json" | json.parse', 'E501_EVAL_TYPE_MISMATCH'],
    ['notafn!(1)', 'E502_EVAL_NOT_CALLABLE'],
    ['constructor!(1)', 'E502_EVAL_NOT_CALLABLE'],
    ['__proto__!()', 'E502_EVAL_NOT_CALLABLE'],
    ['json.parse!()', 'E503_EVAL_ARITY_MISMATCH'],
  ];

  for (const [source, code] of cases) {
    it(`${JSON.stringify(source)} -> ${code}`, () => {
      expect(outcome(source)).toBe(code);
    });
  }
});

// FIX-1: errors thrown inside callees (closure arity, native arity/type) have
// no AST node of their own, so the evaluator locates them at the call site;
// the Section 9.3 formatter needs line/col/span to render excerpt + caret.
describe('Phase 5: call-site errors carry the call location', () => {
  const cases: Array<[string, string, number, number, [number, number]]> = [
    ['fn add(a, b) { return a + b }\nlet x = add(1)', 'E503_EVAL_ARITY_MISMATCH', 2, 9, [38, 44]],
    ['let x = json.parse()', 'E503_EVAL_ARITY_MISMATCH', 1, 9, [8, 20]],
    ['print!()', 'E503_EVAL_ARITY_MISMATCH', 1, 1, [0, 8]],
    ['let x = json.parse(1)', 'E501_EVAL_TYPE_MISMATCH', 1, 9, [8, 21]],
  ];

  for (const [source, code, line, col, span] of cases) {
    it(`${JSON.stringify(source)} -> ${code} at ${line}:${col}`, () => {
      let thrown: unknown;
      try {
        runSource(source, { env: {}, guard: permissiveGuard(), hosts: captureHosts().hosts });
      } catch (err) {
        thrown = err;
      }
      if (!(thrown instanceof EvalError)) throw new Error(`expected EvalError, got: ${String(thrown)}`);
      expect(thrown.code).toBe(code);
      expect(thrown.location).toEqual({ line, col, span });
    });
  }
});
