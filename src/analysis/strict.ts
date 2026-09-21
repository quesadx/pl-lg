import type { Expr, Program, Statement } from '../ast/ast.js';
import { assertNever } from '../shared/assert-never.js';
import { EvalError } from '../shared/errors.js';
import type { PlacitumErrorInit } from '../shared/errors.js';
import type { NativeSig, TypeName } from '../shared/values.js';
import { BANG_SIGNATURES, PURE_SIGNATURES } from '../stdlib/stdlib.js';

// LSP contract (placitum-lsp-implementation.md §5.3) — pure AST -> E5xx
// collector for the #!strict pipe pre-pass. evaluate() throws the first
// collected error before any statement runs (Section 11 Phase 5 preserved);
// the language server consumes the whole list without executing anything.

interface Located {
  line: number;
  col: number;
  span: readonly [number, number];
}

function evalError(code: string, message: string, hint: string): EvalError {
  return new EvalError({ code, message, hint });
}

function located(err: EvalError, node: Located): EvalError {
  const init: PlacitumErrorInit = {
    code: err.code,
    phase: err.phase,
    message: err.message,
    location: { line: node.line, col: node.col, span: node.span },
  };
  if (err.hint !== undefined) init.hint = err.hint;
  return new EvalError(init);
}

// The #!strict gate lives here, not in the callers: only a program that opted
// in gets pipe-chain diagnostics at all.
export function collectStrictDiagnostics(program: Program): EvalError[] {
  if (!program.pragmas.includes('strict')) return [];
  const errors: EvalError[] = [];
  for (const stmt of program.body) checkStmt(stmt, errors);
  return errors;
}

export function inferType(expr: Expr): TypeName {
  switch (expr.kind) {
    case 'StringLiteral':
      return 'string';
    case 'NumberLiteral':
      return 'number';
    case 'BooleanLiteral':
      return 'boolean';
    case 'NullLiteral':
      return 'null';
    case 'FStringExpr':
      return 'string';
    case 'ArrayLiteral':
      return 'array';
    case 'ObjectLiteral':
      return 'object';
    case 'Identifier':
    case 'MemberExpr':
      return 'unknown';
    case 'PipeExpr':
      return inferType(expr.stages[expr.stages.length - 1] as Expr);
    case 'BangCall':
      return signatureRet(
        Object.hasOwn(BANG_SIGNATURES, expr.target) ? BANG_SIGNATURES[expr.target] : undefined,
      );
    case 'CallExpr':
      return signatureRet(calleeSignature(expr.callee));
    case 'BinaryExpr':
      switch (expr.operator) {
        case '+': {
          const left = inferType(expr.left);
          const right = inferType(expr.right);
          if (left === 'string' && right === 'string') return 'string';
          if (left === 'number' && right === 'number') return 'number';
          return 'unknown';
        }
        case '-':
        case '*':
        case '/':
          return 'number';
        default:
          return 'boolean'; // comparisons, ==/!=, &&/||
      }
    case 'UnaryExpr':
      return expr.operator === '-' ? 'number' : 'boolean';
    case 'AssignExpr':
      return inferType(expr.value);
    default:
      return assertNever(expr);
  }
}

export function calleeSignature(callee: Expr): NativeSig | null {
  if (callee.kind === 'Identifier') return null; // user fns are untyped in v1
  if (callee.kind === 'MemberExpr' && callee.object.kind === 'Identifier') {
    const name = `${callee.object.name}.${callee.property}`;
    return Object.hasOwn(PURE_SIGNATURES, name) ? (PURE_SIGNATURES[name] ?? null) : null;
  }
  return null;
}

// 'any' as a return type carries no static information.
function signatureRet(sig: NativeSig | null | undefined): TypeName {
  const ret = sig?.ret;
  return ret === undefined || ret === 'any' ? 'unknown' : ret;
}

function stageSignature(stage: Expr): NativeSig | null {
  if (stage.kind === 'BangCall') {
    return Object.hasOwn(BANG_SIGNATURES, stage.target) ? (BANG_SIGNATURES[stage.target] ?? null) : null;
  }
  if (stage.kind === 'CallExpr') return calleeSignature(stage.callee);
  if (stage.kind === 'Identifier' || stage.kind === 'MemberExpr') return calleeSignature(stage);
  return null;
}

function describeStage(stage: Expr): string {
  if (stage.kind === 'BangCall') return `${stage.target}!`;
  if (stage.kind === 'Identifier') return stage.name;
  if (stage.kind === 'MemberExpr' && stage.object.kind === 'Identifier') return `${stage.object.name}.${stage.property}`;
  if (stage.kind === 'CallExpr') return describeStage(stage.callee);
  return stage.kind;
}

function checkPipe(pipe: { stages: readonly Expr[] }, errors: EvalError[]): void {
  const stages = pipe.stages;
  let produced = inferType(stages[0] as Expr);
  for (let i = 1; i < stages.length; i++) {
    const stage = stages[i] as Expr;
    const sig = stageSignature(stage);
    const expected = sig?.params[0];
    if (
      expected !== undefined &&
      expected !== 'any' &&
      expected !== 'unknown' &&
      produced !== 'unknown' &&
      produced !== expected
    ) {
      errors.push(
        located(
          evalError(
            'E505_EVAL_PIPE_TYPE_ERROR',
            `strict pipe-chain check: stage ${i + 1} (${describeStage(stage)}) expects ${expected} as its first argument, but stage ${i} (${describeStage(stages[i - 1] as Expr)}) produces ${produced}.`,
            "Fix the chain so the piped value matches each stage's first parameter, or drop #!strict.",
          ),
          stage,
        ),
      );
    }
    const ret = sig?.ret;
    produced = ret === undefined || ret === 'any' ? inferType(stage) : ret;
  }
}

function checkExpr(expr: Expr, errors: EvalError[]): void {
  switch (expr.kind) {
    case 'PipeExpr':
      checkPipe(expr, errors);
      expr.stages.forEach((stage) => checkExpr(stage, errors));
      return;
    case 'BangCall':
      expr.args.forEach((arg) => checkExpr(arg, errors));
      return;
    case 'CallExpr':
      checkExpr(expr.callee, errors);
      expr.args.forEach((arg) => checkExpr(arg, errors));
      return;
    case 'MemberExpr':
      checkExpr(expr.object, errors);
      return;
    case 'FStringExpr':
      for (const part of expr.parts) if (typeof part !== 'string') checkExpr(part, errors);
      return;
    case 'ArrayLiteral':
      expr.elements.forEach((element) => checkExpr(element, errors));
      return;
    case 'ObjectLiteral':
      for (const property of expr.properties) checkExpr(property.value, errors);
      return;
    case 'BinaryExpr':
      checkExpr(expr.left, errors);
      checkExpr(expr.right, errors);
      return;
    case 'UnaryExpr':
      checkExpr(expr.argument, errors);
      return;
    case 'AssignExpr':
      checkExpr(expr.value, errors);
      return;
    case 'Identifier':
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      return;
    default:
      return assertNever(expr);
  }
}

function checkStmt(stmt: Statement, errors: EvalError[]): void {
  switch (stmt.kind) {
    case 'LetStmt':
      checkExpr(stmt.init, errors);
      return;
    case 'FnDecl':
      checkBody(stmt.body.body, errors);
      return;
    case 'IfStmt':
      checkExpr(stmt.test, errors);
      checkBody(stmt.consequent.body, errors);
      if (stmt.alternate !== null) {
        if (stmt.alternate.kind === 'IfStmt') checkStmt(stmt.alternate, errors);
        else checkBody(stmt.alternate.body, errors);
      }
      return;
    case 'WhileStmt':
      checkExpr(stmt.test, errors);
      checkBody(stmt.body.body, errors);
      return;
    case 'ForStmt':
      checkExpr(stmt.iterable, errors);
      checkBody(stmt.body.body, errors);
      return;
    case 'ReturnStmt':
      if (stmt.argument !== null) checkExpr(stmt.argument, errors);
      return;
    case 'ExprStmt':
      checkExpr(stmt.expression, errors);
      return;
    case 'NeedsDecl':
      return;
    default:
      return assertNever(stmt);
  }
}

function checkBody(body: readonly Statement[], errors: EvalError[]): void {
  for (const stmt of body) checkStmt(stmt, errors);
}
