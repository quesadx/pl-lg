import type {
  CapabilityToken,
  Expr,
  FnDecl,
  Program,
  Statement,
} from '../ast/ast.js';
import { ExtractError } from '../shared/errors.js';
import type { PlacitumErrorInit } from '../shared/errors.js';
import { globCovers, globToRegex, hostToRegex } from '../shared/glob-to-regex.js';
import type { DeferredCheck, HostPattern, SerializedManifest } from '../shared/manifest.js';

// Phase 3 — pure ASTNode -> SerializedCapabilityManifest (Sections 2.1-2.3, 7.2,
// 7.3). No I/O, ever: glob strings compile to regex here; canonicalizing a
// concrete runtime path is Phase 4's job.

// The single definition of the effectful bang-call surface (Section 1: every
// effectful operation is reachable ONLY via BangCall — this registry is that
// surface). Every other target — ambient print!/eprint! (Section 1: routed
// through the choke point at runtime but unconditionally authorized, never in
// the manifest) or a user-fn call (the grammar permits banging pure fns) — is
// skipped here. Phase 5's stdlib must not add an effectful name outside this
// registry; a sync test lands with the stdlib.
// ponytail: every entry's relevant argument is args[0]; add an index if a
// stdlib function ever needs another.
export type EffectCategory = 'net' | 'fsRead' | 'fsWrite' | 'exec';

export const BANG_REGISTRY: Readonly<Record<string, EffectCategory>> = {
  'fs.readFile': 'fsRead',
  'fs.writeFile': 'fsWrite',
  curl: 'net',
};

// E304-flavored assertNever: same compile-time exhaustiveness guarantee, but the
// runtime backstop carries the Section 9.2 envelope code.
function unhandled(x: never): ExtractError {
  return new ExtractError({
    code: 'E304_EXTRACT_UNHANDLED_NODE',
    message: `extractor hit an unrecognized node: ${JSON.stringify(x)}`,
    hint: 'This should be unreachable (tsc checks exhaustiveness); the AST union is inconsistent.',
  });
}

interface Scope {
  net: HostPattern[];
  fsRead: string[];
  fsWrite: string[];
  exec: string[];
  env: { name: string; optional: boolean }[];
  scoped: Record<string, SerializedManifest>;
  deferred: DeferredCheck[];
}

function serialize(scope: Scope): SerializedManifest {
  return {
    net: scope.net,
    fsRead: scope.fsRead.map((raw) => ({ raw })),
    fsWrite: scope.fsWrite.map((raw) => ({ raw })),
    exec: scope.exec.map((raw) => ({ raw })),
    env: scope.env,
    scoped: scope.scoped,
    deferredToRuntime: scope.deferred,
  };
}

function located(
  err: ExtractError,
  node: { line: number; col: number; span: readonly [number, number] },
): ExtractError {
  const init: PlacitumErrorInit = {
    code: err.code,
    phase: err.phase,
    message: err.message,
    location: { line: node.line, col: node.col, span: node.span },
  };
  if (err.hint !== undefined) init.hint = err.hint;
  return new ExtractError(init);
}

// Compile one needs token into grant entries, validating its pattern (E302 /
// E305 fire here, with the token's source location).
function addToken(token: CapabilityToken, scope: Scope): void {
  const t = token.kind === 'OnlyCapability' ? token.inner : token; // only() unwraps; nesting is a parse error
  switch (t.kind) {
    case 'FsReadCapability':
    case 'FsWriteCapability':
    case 'ExecCapability': {
      try {
        globToRegex(t.pattern);
      } catch (err) {
        throw located(err as ExtractError, t);
      }
      const key = t.kind === 'FsReadCapability' ? 'fsRead' : t.kind === 'FsWriteCapability' ? 'fsWrite' : 'exec';
      scope[key].push(t.pattern);
      return;
    }
    case 'NetCapability': {
      const hp: HostPattern = { type: t.pattern.startsWith('*.') ? 'wildcard' : 'exact', pattern: t.pattern };
      try {
        hostToRegex(hp.type, hp.pattern);
      } catch (err) {
        throw located(err as ExtractError, t);
      }
      scope.net.push(hp);
      return;
    }
    case 'EnvCapability':
      scope.env.push({ name: t.name, optional: t.optional });
      return;
    default:
      throw unhandled(t);
  }
}

function buildScope(tokens: readonly CapabilityToken[]): Scope {
  // Null prototype: `scoped` is keyed by source-controlled fn ids, so `id` could
  // be `__proto__` — a plain object would mutate its own prototype on assignment.
  const scope: Scope = {
    net: [],
    fsRead: [],
    fsWrite: [],
    exec: [],
    env: [],
    scoped: Object.create(null) as Record<string, SerializedManifest>,
    deferred: [],
  };
  for (const token of tokens) addToken(token, scope);
  return scope;
}

// Section 2.3 — the child manifest must be a subset of the parent's (equality
// allowed: "strict subset" bans escalation, not identical attenuation).
function hostCovers(parent: HostPattern, child: HostPattern): boolean {
  const p = parent.pattern.toLowerCase();
  const c = child.pattern.toLowerCase();
  if (child.type === 'wildcard') {
    // *.x only covers *.x: a wildcard child can reach single-label.x hosts that
    // no other single-leading-label pattern is guaranteed to include.
    return parent.type === 'wildcard' && p === c;
  }
  if (parent.type === 'exact') return p === c;
  const base = p.slice(2); // parent "*.base"
  const prefix = c.slice(0, -(base.length + 1));
  return c.endsWith(`.${base}`) && prefix !== '' && !prefix.includes('.');
}

function checkAttenuation(parent: Scope, fn: FnDecl): void {
  const fail = (token: CapabilityToken, detail: string): void => {
    throw new ExtractError({
      code: 'E303_EXTRACT_ATTENUATION_ESCALATION',
      message: `fn ${fn.id}: ${detail} requests a capability outside the enclosing scope's manifest.`,
      hint: 'A needs clause on a fn may only attenuate to a subset of the enclosing needs tokens.',
      location: { line: token.line, col: token.col, span: token.span },
    });
  };

  // Every token must be checked — `continue`, not `return` (an early return
  // here once let a second escalating token slip past this gate).
  const tokens = fn.needs?.tokens ?? [];
  for (const token of tokens) {
    const t = token.kind === 'OnlyCapability' ? token.inner : token;
    switch (t.kind) {
      case 'NetCapability':
        if (!parent.net.some((p) => hostCovers(p, { type: t.pattern.startsWith('*.') ? 'wildcard' : 'exact', pattern: t.pattern }))) {
          fail(token, `net("${t.pattern}")`);
        }
        continue;
      case 'FsReadCapability':
        if (!parent.fsRead.some((p) => globCovers(p, t.pattern))) fail(token, `fs.read("${t.pattern}")`);
        continue;
      case 'FsWriteCapability':
        if (!parent.fsWrite.some((p) => globCovers(p, t.pattern))) fail(token, `fs.write("${t.pattern}")`);
        continue;
      case 'ExecCapability':
        if (!parent.exec.some((p) => globCovers(p, t.pattern))) fail(token, `exec("${t.pattern}")`);
        continue;
      case 'EnvCapability':
        // ponytail: optionality is ignored on attenuation — the privilege (reading
        // the var) is what must be granted; absence is E406's runtime job.
        if (!parent.env.some((e) => e.name === t.name)) fail(token, `env(${t.name})`);
        continue;
      default:
        throw unhandled(t);
    }
  }
}

function defer(scope: Scope, bang: { span: readonly [number, number] }, category: EffectCategory, reason: string): void {
  scope.deferred.push({ nodeSpan: bang.span, category, reason });
}

function describeArg(arg: Expr | undefined): string {
  if (arg === undefined) return 'absent';
  return arg.kind === 'Identifier' ? `Identifier \`${arg.name}\`` : arg.kind;
}

// Static check of one (non-piped) bang call against the in-scope grants.
function checkBangCall(bang: { target: string; args: readonly Expr[]; line: number; col: number; span: readonly [number, number] }, scope: Scope): void {
  // hasOwn: the target is source-controlled, and a plain-object table would
  // return Object.prototype members for names like `constructor`.
  const category = Object.hasOwn(BANG_REGISTRY, bang.target) ? BANG_REGISTRY[bang.target] : undefined;
  if (category === undefined) return; // ambient or user-fn — nothing to extract
  const arg = bang.args[0];
  if (arg === undefined || arg.kind !== 'StringLiteral') {
    defer(scope, bang, category, `argument 0 is not a compile-time string literal (${describeArg(arg)})`);
    return;
  }
  if (category === 'net') {
    let host: string;
    try {
      host = new URL(arg.value).hostname; // already lowercased
    } catch {
      defer(scope, bang, category, `argument 0 is not an absolute URL ("${arg.value}")`);
      return;
    }
    const covered = scope.net.some((h) => hostToRegex(h.type, h.pattern).test(host));
    if (!covered) {
      throw new ExtractError({
        code: 'E301_EXTRACT_UNCOVERED_CAPABILITY',
        message: `${bang.target}!("${arg.value}") reaches host "${host}" that no in-scope needs net(...) token covers.`,
        hint: 'Add a needs net(...) grant for that host, or build the URL from a variable so it is checked at runtime.',
        location: { line: bang.line, col: bang.col, span: bang.span },
      });
    }
    return;
  }
  const covered = scope[category].some((raw) => globToRegex(raw).test(arg.value));
  if (!covered) {
    const cap = category === 'fsRead' ? 'fs.read' : category === 'fsWrite' ? 'fs.write' : 'exec';
    throw new ExtractError({
      code: 'E301_EXTRACT_UNCOVERED_CAPABILITY',
      message: `${bang.target}!("${arg.value}") has a compile-time-literal target that no in-scope needs ${cap}(...) token covers.`,
      hint: `Add needs ${cap}("${arg.value}") at the top of the script, or delete the call.`,
      location: { line: bang.line, col: bang.col, span: bang.span },
    });
  }
}

function walkExpr(expr: Expr, scope: Scope): void {
  switch (expr.kind) {
    case 'PipeExpr':
      expr.stages.forEach((stage, i) => {
        if (stage.kind === 'BangCall' && i >= 1) {
          // Section 5 rule 4: the piped value becomes argument 0 at runtime —
          // by definition not a source literal, so defer regardless of args.
          const category = BANG_REGISTRY[stage.target];
          if (category !== undefined) {
            defer(scope, stage, category, 'argument 0 is the piped runtime value (not a compile-time literal)');
          }
          return;
        }
        walkExpr(stage, scope);
      });
      return;
    case 'BangCall':
      checkBangCall(expr, scope);
      return;
    case 'CallExpr':
      walkExpr(expr.callee, scope);
      expr.args.forEach((a) => walkExpr(a, scope));
      return;
    case 'MemberExpr':
      walkExpr(expr.object, scope);
      return;
    case 'FStringExpr':
      for (const part of expr.parts) if (typeof part !== 'string') walkExpr(part, scope);
      return;
    case 'ArrayLiteral':
      expr.elements.forEach((e) => walkExpr(e, scope));
      return;
    case 'ObjectLiteral':
      for (const prop of expr.properties) walkExpr(prop.value, scope);
      return;
    case 'BinaryExpr':
      walkExpr(expr.left, scope);
      walkExpr(expr.right, scope);
      return;
    case 'UnaryExpr':
      walkExpr(expr.argument, scope);
      return;
    case 'AssignExpr':
      walkExpr(expr.value, scope);
      return;
    case 'Identifier':
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      return;
    default:
      throw unhandled(expr);
  }
}

function walkStatement(stmt: Statement, scope: Scope): void {
  switch (stmt.kind) {
    case 'LetStmt':
      walkExpr(stmt.init, scope);
      return;
    case 'FnDecl': {
      if (stmt.needs !== null) {
        const child = buildScope(stmt.needs.tokens);
        checkAttenuation(scope, stmt);
        walkBody(stmt.body.body, child);
        scope.scoped[stmt.id] = serialize(child); // ponytail: duplicate fn ids — last wins; Phase 5 should reject redeclaration
      } else {
        walkBody(stmt.body.body, scope); // inherits the enclosing scope's manifest unchanged (Section 2.3)
      }
      return;
    }
    case 'IfStmt':
      walkExpr(stmt.test, scope);
      walkBody(stmt.consequent.body, scope);
      if (stmt.alternate !== null) {
        if (stmt.alternate.kind === 'IfStmt') walkStatement(stmt.alternate, scope);
        else walkBody(stmt.alternate.body, scope);
      }
      return;
    case 'WhileStmt':
      walkExpr(stmt.test, scope);
      walkBody(stmt.body.body, scope);
      return;
    case 'ForStmt':
      walkExpr(stmt.iterable, scope);
      walkBody(stmt.body.body, scope);
      return;
    case 'ReturnStmt':
      if (stmt.argument !== null) walkExpr(stmt.argument, scope);
      return;
    case 'ExprStmt':
      walkExpr(stmt.expression, scope);
      return;
    case 'NeedsDecl':
      return; // unreachable in walked bodies — E202 confines needs to the two legal positions
    default:
      throw unhandled(stmt);
  }
}

function walkBody(body: readonly Statement[], scope: Scope): void {
  for (const stmt of body) walkStatement(stmt, scope);
}

export function extract(program: Program): SerializedManifest {
  const scope = buildScope(program.needs.flatMap((n) => n.tokens));
  walkBody(program.body, scope);
  return serialize(scope);
}
