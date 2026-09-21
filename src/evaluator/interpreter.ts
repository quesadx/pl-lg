import { collectStrictDiagnostics } from '../analysis/strict.js';
import type { BinaryExpr, Block, Expr, FnDecl, Program, Statement } from '../ast/ast.js';
import type { Guard } from '../capability/guard.js';
import { assertNever } from '../shared/assert-never.js';
import { CapabilityViolationError, EvalError } from '../shared/errors.js';
import type { PlacitumErrorInit } from '../shared/errors.js';
import { deepEquals, display, isCallable, truthy, typeName } from '../shared/values.js';
import type { CallableValue, Value } from '../shared/values.js';
import type { BangFn } from '../stdlib/stdlib.js';

// Phase 5 — visitor-pattern interpreter: ASTNode + Environment -> Output.
// Lexical scoping throughout: closures and the capability guard are both
// captured at the fn's defining scope, matching the extractor's lexical walk
// exactly (Section 2.3). No I/O here; effectful calls dispatch to the stdlib's
// guard-checked wrappers.

export interface EvalContext {
  globals: ReadonlyMap<string, Value>;
  bangs: Readonly<Record<string, BangFn>>;
  guard: Guard;
}

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

// Section 0 rule 7: a CapabilityViolationError always propagates to the CLI
// envelope — it is rethrown here unchanged (same class, code, message, hint),
// only enriched with the bang-call site so the Section 9.3 formatter can show
// the offending line. Never swallowed, never downgraded.
function locatedViolation(err: CapabilityViolationError, node: Located): CapabilityViolationError {
  return new CapabilityViolationError({
    code: err.code,
    message: err.message,
    severity: err.severity,
    location: { line: node.line, col: node.col, span: node.span },
    ...(err.hint !== undefined ? { hint: err.hint } : {}),
  });
}

// `return` unwinds the current fn call; there is no other abrupt completion.
class ReturnSignal {
  constructor(readonly value: Value) {}
}

class Env {
  private readonly vars = new Map<string, Value>();

  constructor(private readonly parent: Env | null) {}

  lookup(name: string): Value | undefined {
    const own = this.vars.get(name);
    if (own !== undefined) return own;
    return this.parent?.lookup(name);
  }

  owns(name: string): boolean {
    return this.vars.has(name);
  }

  define(name: string, value: Value): void {
    this.vars.set(name, value);
  }

  // Section 4 AssignExpr: the nearest enclosing scope holding the binding.
  assign(name: string, value: Value): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return true;
    }
    return this.parent?.assign(name, value) ?? false;
  }
}

class Closure implements CallableValue {
  readonly kind = 'closure' as const;

  constructor(
    readonly name: string,
    private readonly params: readonly string[],
    private readonly body: Block,
    private readonly env: Env,
    private readonly declGuard: Guard,
    private readonly attenuated: boolean,
    private readonly ctx: EvalContext,
  ) {}

  call(args: Value[]): Value {
    if (args.length !== this.params.length) {
      throw evalError(
        'E503_EVAL_ARITY_MISMATCH',
        `fn \`${this.name}\` expects ${this.params.length} argument(s), got ${args.length}.`,
        'Match the FnDecl parameter list.',
      );
    }
    // A fn with its own needs clause runs under its attenuated child manifest;
    // an inheriting fn keeps the guard of its defining scope (Section 2.3).
    const guard = this.attenuated ? this.declGuard.forScope(this.name) : this.declGuard;
    const env = new Env(this.env);
    this.params.forEach((p, i) => env.define(p, args[i] as Value));
    try {
      execBody(this.body.body, env, guard, this.ctx);
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value;
      throw err;
    }
    return null;
  }
}

function callValue(callee: Value, args: Value[], node: Located): Value {
  if (!isCallable(callee)) {
    throw located(
      evalError(
        'E502_EVAL_NOT_CALLABLE',
        `value of type ${typeName(callee)} is not callable.`,
        'Only functions and closures can be called.',
      ),
      node,
    );
  }
  try {
    return callee.call(args);
  } catch (err) {
    // Callees (closures, natives) throw arity/type errors with no AST node of
    // their own; locate them at the call site. An inner location is never
    // clobbered — only errors that escaped unlocated get one.
    if (err instanceof EvalError && err.location === undefined) throw located(err, node);
    throw err;
  }
}

function resolveDotted(target: string, env: Env): Value | undefined {
  const segments = target.split('.');
  let current = env.lookup(segments[0] as string);
  for (let i = 1; i < segments.length; i++) {
    if (current === undefined) return undefined;
    if (current === null || typeof current !== 'object' || Array.isArray(current) || isCallable(current)) {
      return undefined;
    }
    const key = segments[i] as string;
    if (!Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, Value>)[key] as Value;
  }
  return current;
}

function evalBangCall(
  target: string,
  args: Value[],
  node: Located,
  env: Env,
  guard: Guard,
  ctx: EvalContext,
): Value {
  // hasOwn: target is source-controlled; a plain index would dispatch to
  // Object.prototype members for names like `constructor` or `__proto__`.
  const effect = Object.hasOwn(ctx.bangs, target) ? ctx.bangs[target] : undefined;
  if (effect !== undefined) {
    try {
      return effect(guard, args);
    } catch (err) {
      if (err instanceof CapabilityViolationError) throw locatedViolation(err, node);
      // stdlib wrappers throw arity/type errors with no AST node of their own;
      // locate them at the bang-call site. Never clobber an inner location.
      if (err instanceof EvalError && err.location === undefined) throw located(err, node);
      throw err;
    }
  }
  // The grammar permits banging pure fns; effectful names are never bound in
  // the environment, so a plain CallExpr on them cannot happen (Section 1).
  const callee = resolveDotted(target, env);
  if (callee === undefined) {
    throw located(
      evalError(
        'E502_EVAL_NOT_CALLABLE',
        `bang target \`${target}\` is not defined.`,
        'Declare the function, or use a registered effectful stdlib name.',
      ),
      node,
    );
  }
  return callValue(callee, args, node);
}

function evalBinary(expr: BinaryExpr, env: Env, guard: Guard, ctx: EvalContext): Value {
  const operator = expr.operator;
  // Short-circuit before evaluating the right operand.
  if (operator === '&&' || operator === '||') {
    const left = evalExpr(expr.left, env, guard, ctx);
    if (operator === '&&') {
      return truthy(left) ? truthy(evalExpr(expr.right, env, guard, ctx)) : false;
    }
    return truthy(left) ? true : truthy(evalExpr(expr.right, env, guard, ctx));
  }

  const left = evalExpr(expr.left, env, guard, ctx);
  const right = evalExpr(expr.right, env, guard, ctx);
  switch (operator) {
    case '+':
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      throw located(
        evalError(
          'E501_EVAL_TYPE_MISMATCH',
          `operator "+" cannot combine ${typeName(left)} and ${typeName(right)}.`,
          'Both operands must be numbers, or both strings.',
        ),
        expr,
      );
    case '-':
    case '*':
    case '/': {
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw located(
          evalError(
            'E501_EVAL_TYPE_MISMATCH',
            `operator "${operator}" requires numbers, got ${typeName(left)} and ${typeName(right)}.`,
            'Both operands must be numbers.',
          ),
          expr,
        );
      }
      if (operator === '-') return left - right;
      if (operator === '*') return left * right;
      if (right === 0) {
        throw located(evalError('E504_EVAL_DIVISION_BY_ZERO', 'division by zero.', 'Guard the divisor before dividing.'), expr);
      }
      return left / right;
    }
    case '<':
    case '>':
    case '<=':
    case '>=':
      // ponytail: numbers only; lexicographic string comparison if a script asks.
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw located(
          evalError(
            'E501_EVAL_TYPE_MISMATCH',
            `operator "${operator}" compares numbers only, got ${typeName(left)} and ${typeName(right)}.`,
            'Both operands must be numbers.',
          ),
          expr,
        );
      }
      if (operator === '<') return left < right;
      if (operator === '>') return left > right;
      if (operator === '<=') return left <= right;
      return left >= right;
    case '==':
      return deepEquals(left, right);
    case '!=':
      return !deepEquals(left, right);
    default:
      return assertNever(operator);
  }
}

function evalExpr(expr: Expr, env: Env, guard: Guard, ctx: EvalContext): Value {
  switch (expr.kind) {
    case 'Identifier': {
      const value = env.lookup(expr.name);
      if (value === undefined) {
        throw located(
          evalError(
            'E500_EVAL_UNBOUND_VAR',
            `identifier \`${expr.name}\` is not declared in any enclosing scope.`,
            'Declare it with `let` before use.',
          ),
          expr,
        );
      }
      return value;
    }
    case 'StringLiteral':
      return expr.value;
    case 'NumberLiteral':
      return expr.value;
    case 'BooleanLiteral':
      return expr.value;
    case 'NullLiteral':
      return null;
    case 'FStringExpr':
      return expr.parts
        .map((part) => (typeof part === 'string' ? part : display(evalExpr(part, env, guard, ctx))))
        .join('');
    case 'ArrayLiteral':
      return expr.elements.map((e) => evalExpr(e, env, guard, ctx));
    case 'ObjectLiteral': {
      const object: Record<string, Value> = {};
      for (const property of expr.properties) {
        // defineProperty (not `object[key] =`): a literal `__proto__` key must
        // stay an own data property instead of mutating the prototype.
        Object.defineProperty(object, property.key, {
          value: evalExpr(property.value, env, guard, ctx),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return object;
    }
    case 'MemberExpr': {
      const object = evalExpr(expr.object, env, guard, ctx);
      if (object === null || Array.isArray(object) || typeof object !== 'object' || isCallable(object)) {
        throw located(
          evalError(
            'E501_EVAL_TYPE_MISMATCH',
            `cannot read member "${expr.property}" of ${typeName(object)}.`,
            'Only objects have members.',
          ),
          expr,
        );
      }
      const record = object as Record<string, Value>;
      // Missing members read as null (JSON-friendly); prototype chain is never consulted.
      return Object.hasOwn(record, expr.property) ? (record[expr.property] as Value) : null;
    }
    case 'CallExpr': {
      const callee = evalExpr(expr.callee, env, guard, ctx);
      const args = expr.args.map((a) => evalExpr(a, env, guard, ctx));
      return callValue(callee, args, expr);
    }
    case 'BangCall': {
      const args = expr.args.map((a) => evalExpr(a, env, guard, ctx));
      return evalBangCall(expr.target, args, expr, env, guard, ctx);
    }
    case 'PipeExpr': {
      let value = evalExpr(expr.stages[0] as Expr, env, guard, ctx);
      for (let i = 1; i < expr.stages.length; i++) {
        const stage = expr.stages[i] as Expr;
        // Section 5 rule 2: an explicit argument list gets the value prepended.
        if (stage.kind === 'BangCall') {
          const args = [value, ...stage.args.map((a) => evalExpr(a, env, guard, ctx))];
          value = evalBangCall(stage.target, args, stage, env, guard, ctx);
          continue;
        }
        if (stage.kind === 'CallExpr') {
          const callee = evalExpr(stage.callee, env, guard, ctx);
          const args = [value, ...stage.args.map((a) => evalExpr(a, env, guard, ctx))];
          value = callValue(callee, args, stage);
          continue;
        }
        // Section 5 rule 1: a bare stage receives the value as its sole argument.
        const callee = evalExpr(stage, env, guard, ctx);
        value = callValue(callee, [value], stage);
      }
      return value;
    }
    case 'BinaryExpr':
      return evalBinary(expr, env, guard, ctx);
    case 'UnaryExpr': {
      const argument = evalExpr(expr.argument, env, guard, ctx);
      if (expr.operator === 'not') return !truthy(argument);
      if (typeof argument !== 'number') {
        throw located(
          evalError(
            'E501_EVAL_TYPE_MISMATCH',
            `unary "-" requires a number, got ${typeName(argument)}.`,
            'Negate a number.',
          ),
          expr,
        );
      }
      return -argument;
    }
    case 'AssignExpr': {
      const value = evalExpr(expr.value, env, guard, ctx);
      if (!env.assign(expr.id, value)) {
        throw located(
          evalError(
            'E500_EVAL_UNBOUND_VAR',
            `assignment to \`${expr.id}\` finds no declared binding in any enclosing scope.`,
            '`=` only reassigns existing bindings; declare it with `let` first.',
          ),
          expr,
        );
      }
      return value;
    }
    default:
      return assertNever(expr);
  }
}

function execFnDecl(stmt: FnDecl, env: Env, guard: Guard, ctx: EvalContext): void {
  if (env.owns(stmt.id)) {
    throw located(
      evalError(
        'E506_EVAL_REDECLARATION',
        `fn \`${stmt.id}\` is already declared in this scope.`,
        'Rename one binding; inner scopes may shadow, the same scope may not.',
      ),
      stmt,
    );
  }
  const closure = new Closure(
    stmt.id,
    stmt.params.map((p) => p.id),
    stmt.body,
    env,
    guard,
    stmt.needs !== null,
    ctx,
  );
  env.define(stmt.id, closure);
}

function execStmt(stmt: Statement, env: Env, guard: Guard, ctx: EvalContext): void {
  switch (stmt.kind) {
    case 'LetStmt': {
      if (env.owns(stmt.id)) {
        throw located(
          evalError(
            'E506_EVAL_REDECLARATION',
            `let \`${stmt.id}\` is already declared in this scope.`,
            'Rename one binding; inner scopes may shadow, the same scope may not.',
          ),
          stmt,
        );
      }
      env.define(stmt.id, evalExpr(stmt.init, env, guard, ctx));
      return;
    }
    case 'FnDecl':
      execFnDecl(stmt, env, guard, ctx);
      return;
    case 'IfStmt':
      if (truthy(evalExpr(stmt.test, env, guard, ctx))) {
        execBody(stmt.consequent.body, new Env(env), guard, ctx);
      } else if (stmt.alternate !== null) {
        if (stmt.alternate.kind === 'IfStmt') execStmt(stmt.alternate, env, guard, ctx);
        else execBody(stmt.alternate.body, new Env(env), guard, ctx);
      }
      return;
    case 'WhileStmt':
      while (truthy(evalExpr(stmt.test, env, guard, ctx))) {
        execBody(stmt.body.body, new Env(env), guard, ctx);
      }
      return;
    case 'ForStmt': {
      const iterable = evalExpr(stmt.iterable, env, guard, ctx);
      if (!Array.isArray(iterable)) {
        throw located(
          evalError(
            'E501_EVAL_TYPE_MISMATCH',
            `for-loop iterable must be an array, got ${typeName(iterable)}.`,
            'Iterate an array value.',
          ),
          stmt,
        );
      }
      for (const item of iterable) {
        const loopEnv = new Env(env);
        loopEnv.define(stmt.iterator, item);
        execBody(stmt.body.body, loopEnv, guard, ctx);
      }
      return;
    }
    case 'ReturnStmt':
      throw new ReturnSignal(stmt.argument === null ? null : evalExpr(stmt.argument, env, guard, ctx));
    case 'ExprStmt':
      evalExpr(stmt.expression, env, guard, ctx);
      return;
    case 'NeedsDecl':
      return; // unreachable in walked bodies — E202 confines needs to the two legal positions
    default:
      return assertNever(stmt);
  }
}

function execBody(body: readonly Statement[], env: Env, guard: Guard, ctx: EvalContext): void {
  for (const stmt of body) execStmt(stmt, env, guard, ctx);
}



export function evaluate(program: Program, ctx: EvalContext): void {
  // Section 11 Phase 5: the whole-program pre-pass fails before the first
  // statement runs. evaluate keeps the throw-first contract; the collector
  // (which owns the #!strict gate) is the single implementation the LSP
  // also consumes.
  const [strictError] = collectStrictDiagnostics(program);
  if (strictError !== undefined) throw strictError;
  const env = new Env(null);
  for (const [name, value] of ctx.globals) env.define(name, value);
  try {
    execBody(program.body, env, ctx.guard, ctx);
  } catch (err) {
    if (!(err instanceof ReturnSignal)) throw err; // a top-level return just stops the program
  }
}
