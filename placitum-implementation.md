---
title: Placitum — AI Implementation Directive
version: 2.0
status: Authoritative — supersedes v1.0 for all implementation questions
tech_stack: TypeScript (Node.js, strict mode, zero `any`)
target_audience: Autonomous AI Coding Agent (no human intervention expected mid-build)
---

# Placitum — AI Implementation Directive

This document is the complete, self-contained specification for implementing Placitum, a
capability-secure shell language. It supersedes any prior version. Where this document and
your own inferences disagree, this document wins. Where two sections of this document appear
to disagree, **Section 2 (Compile-Time / Runtime Boundary) and Section 7 (Data Structures
Reference) are authoritative** — they exist specifically to resolve ambiguity.

---

## 0. Agent Execution Rules — Read First

> **These rules govern how you work, not just what you build. Obey them even when a shortcut
> looks safe.**

1. **Test-Driven Development is mandatory.** For every phase, write the failing
   `*.negative.placitum` / `*.golden.json` fixtures first, watch them fail for the right
   reason, then write the implementation that makes them pass.
2. **Never use `any`.** Never use `@ts-ignore` or `@ts-expect-error` to silence a type error.
   If `tsc` cannot exhaustively check a `switch` over `ASTNode['kind']`, that is a signal the
   discriminated union in Section 7 is incomplete or misused — fix the union, do not suppress
   the check.
3. **Only install dependencies on the Allow-List (Section 8.3).** If a task seems to need
   something else, hand-roll it in the appropriate directory instead of adding a package.
4. **Never weaken `tsconfig.json` or `.eslintrc.json`** to make code compile or lint clean. If
   a rule blocks code you're writing, that is a signal the code belongs in a different module
   (e.g., an `fs` import belongs in `/host-bindings`), not that the rule is wrong.
5. **Work one phase at a time, strictly in order (0 → 9).** Do not write Phase *N+1*
   implementation code until Phase *N*'s CI Gate (Section 11) is fully green. Do not write
   "while I'm in the area" code for a later phase — it creates untested effectful surface area.
6. **Every new stdlib function that reaches `/host-bindings` ships with at least one
   `*.negative.placitum` test**, in the same commit, proving `CapabilityGuard` denies an
   unauthorized use of it.
7. **Never catch and discard `CapabilityViolationError`.** It always propagates to the CLI
   error envelope (Section 9) or, during `rewind`, halts replay.
8. **Treat all output of Phase 7 (AI-Agent mode) as untrusted text** — including manifests
   that look like they came from Placitum's own serializer. Always re-parse and re-verify
   through the real Phase 2 / Phase 3 pipeline before trusting it, even from inside this same
   codebase's own tooling.
9. **If you hit a genuine contradiction this document doesn't resolve, stop.** Write it to
   `docs/BLOCKED.md` with an exact section reference instead of guessing and moving on.

---

## 1. Project Philosophy & Core Invariants

Placitum is a security-first, capability-secure shell language. Its single organizing idea:
**an effectful operation must be syntactically visible, statically enumerable, and runtime-
enforced — by construction, not by convention.**

* **Single Source of Truth.** The `CapabilityManifest` (Section 7.2) is the only
  representation of "what this script may do." It is produced once, by Phase 3, and consumed
  read-only by both the `explain` renderer (Phase 6) and the `CapabilityGuard` (Phase 4). No
  module re-derives capabilities independently.
* **Zero Implicit Reachability.** The evaluator and standard library contain no I/O. The
  interpreter does not trust itself.
* **The Choke Point.** `fs`, `child_process`, `net`, `http`, `https`, `os`, `dgram`, and `tls`
  are importable in exactly one directory: `/host-bindings`. Every stdlib function that
  touches the outside world is a thin wrapper around a `CapabilityGuard` call. If the guard
  denies a request, the corresponding syscall is physically unreachable from that code path.
* **Effectful Operations Are Syntactically Marked — With No Escape Hatch.** Every operation
  backed by `/host-bindings` is exposed to user scripts *only* as a `BangCall` (Section 4).
  There is no non-bang alias, no "advanced" stdlib object whose methods are plain callables,
  and no way to obtain a first-class reference to an effectful stdlib function and invoke it
  through an ordinary `CallExpr`. **This is what makes Phase 3's coverage claim sound**: the
  extractor finds 100% of effectful call sites by scanning for `BangCall` nodes alone. If any
  effectful capability were reachable through a plain `CallExpr`, static coverage could never
  be proven complete, and the rest of this document's security argument collapses.
* **Ambient I/O is explicit and bounded.** `print!` / `eprint!` (writes to the *invoking
  process's own* stdout/stderr) still route through `CapabilityGuard` → `/host-bindings` (so
  the import boundary and the `rewind` audit log stay complete), but `CapabilityGuard`
  unconditionally authorizes them. They are not part of a script's declared `needs` surface,
  because writing to the terminal that is already running the script doesn't grant reach into
  external state. Do not invent a "stdout capability" in the manifest, and do not require
  `needs` for `print!`.
* **Defense-in-Depth.** Static verification (Phase 3) proves coverage wherever a target is a
  compile-time literal. Runtime guarding (Phase 4) is the backstop for everything statically
  unprovable — it is not optional, and it is not redundant with Phase 3.
* **Type Safety as Security.** Strict discriminated unions, `strict: true`, and exhaustiveness
  checking (`switch` + `assertNever`, never a fallthrough `default`). The build fails if any
  `ASTNode` kind is unhandled in the extractor or evaluator.

---

## 2. Compile-Time / Runtime Boundary & Capability Lifecycle

The base spec contains an apparent contradiction: *"Static extraction does NO I/O"* alongside
*"path canonicalization via `realpath`"* as a stated requirement of the security model.
**These are not the same phase's job.** This section is the fix.

### 2.1 The boundary, stated precisely

| | Phase 3 — Static Capability Extractor | Phase 4 — CapabilityGuard |
|---|---|---|
| When it runs | Once, at parse time, on the AST | Once per effectful call, at evaluation time |
| I/O permitted | **None. Ever.** Pure function `ASTNode → SerializedCapabilityManifest`. | Yes — this is the only place `fs.realpathSync` may be called outside `/host-bindings` itself. |
| Input | Syntax only | A fully-resolved runtime value (the actual string, now known) |
| Glob handling | Compiles a glob **string** to a `RegExp` via pure string transformation — no filesystem contact, works even if the path never exists. | Canonicalizes the **runtime value** (resolves symlinks, `..`, `.`) and matches the canonical result against the regex Phase 3 already compiled. |
| What it can't know | Whether a given runtime path, after symlink resolution, actually lands inside the granted glob. | Nothing new about the *program* — it only ever evaluates one already-parsed, already-extracted script. |

Static extraction never touches the disk — it doesn't need to. Canonicalizing a *pattern*
(`/etc/config/*.json`) is meaningless without a concrete path to resolve; canonicalizing a
*runtime value* (`/etc/config/../config/app.json` after the user's variable substitution) is
exactly the job of `realpath`, and `realpath` requires a live filesystem — so it can only run
at Phase 4, per-call, against the value that actually exists at that moment.

### 2.2 Lifecycle of one capability check, source to syscall

1. **Parse (Phase 2).** Source becomes an `ASTNode` tree. A `fs.readFile!("...")` bang-call is
   just a `BangCall` node with `target: "fs.readFile"` and literal or computed `args`.
2. **Extract (Phase 3, pure).** The extractor walks the tree once. For each `BangCall`, if its
   relevant argument is a compile-time-literal string, the extractor compiles that literal
   into a `GlobPattern` / `HostPattern` / `ExecPattern` (Section 7.2) and checks it against the
   in-scope `needs` tokens. If the argument is *not* a literal (built from a variable,
   concatenation, `f"..."`, etc.), the extractor cannot know it — it emits a `DeferredCheck`
   entry instead of guessing, and does **not** attempt partial resolution.
3. **Publish the manifest.** The resulting `SerializedCapabilityManifest` is the single
   artifact both `explain` (Phase 6) and `CapabilityGuard` (Phase 4) read. Neither re-derives
   it; `CapabilityGuard` is instantiated once per run with this manifest already compiled
   (`RegExp` objects rebuilt locally from `raw` strings — see Section 7.3).
4. **Evaluate (Phase 5).** When the evaluator reaches the `BangCall`, it does not touch
   `/host-bindings`. It calls the matching stdlib wrapper (e.g. `stdlib.fs.readFile`), which
   now has the fully-resolved runtime argument (variables substituted, concatenation done).
5. **Authorize (Phase 4, the only place `realpath` runs outside `/host-bindings`).**
   `CapabilityGuard.authorize(request)`:
   1. Takes the concrete runtime value from step 4.
   2. If it's a filesystem request, canonicalizes it (`fs.realpathSync` for paths that must
      already exist; for paths being newly created, canonicalize the parent directory and
      manually reject any residual `..` segment in the leaf) — the **only** realpath call in
      the entire runtime.
   3. Matches the canonical value against the manifest's pre-compiled `regex` /
      `HostPattern` list (exec targets get the same treatment — see Section 7.2's note).
   4. On a match, returns an authorized, already-canonicalized payload. On no match, throws
      `CapabilityViolationError` (`E4xx`, Section 9).
6. **Execute (`/host-bindings`).** The stdlib wrapper hands the *already-canonicalized* value
   from step 5 straight to the host binding — it never re-resolves the original argument. This
   is a deliberate TOCTOU (time-of-check-to-time-of-use) defense: what was authorized is
   byte-identical to what is executed.

### 2.3 Function attenuation (`needs only(...)`)

A child `fn`'s `needs only(TOKEN)` clause must resolve to a manifest that is a **strict
subset** of its enclosing scope's manifest — computed and verified at Phase 3, not Phase 4.
`only(net("evil.com"))` inside a function whose enclosing scope was only granted
`net("api.example.com")` is a Phase 3 error (`E303`), not a runtime denial; escalation attempts
never reach `CapabilityGuard` at all. A `FnDecl` with no `needs` clause **inherits its parent's
manifest unchanged** (it is not automatically attenuated to nothing).

---

## 3. Directory Structure & Import Boundary

```
/
├── ast/               # Pure data definitions for ASTNodes (Discriminated Unions). No logic.
├── capability/         
│   ├── extractor.ts    # Phase 3. Pure. ASTNode -> SerializedCapabilityManifest.
│   └── guard.ts         # Phase 4. The only module (besides host-bindings) allowed to import fs for realpath.
├── cli/                # CLI entrypoints (run, explain, audit, rewind).
├── evaluator/          # Tree-walking interpreter and environment closures.
├── host-bindings/      # THE ONLY DIRECTORY ALLOWED TO IMPORT fs / child_process / net / http / https / os / dgram / tls.
├── lexer/              # Hand-rolled character scanner.
├── parser/             # Recursive-descent (statements) + Pratt (expressions) parser.
├── stdlib/              # Builtin functions. Every effectful one wraps exactly one CapabilityGuard call. No direct I/O.
├── shared/              # Pure, dependency-free helpers (e.g. glob-string → RegExp compiler) usable from both extractor and guard.
└── tests/               # Golden files, negative tests, adversarial scripts (see Section 10).
```

**Architectural Import Boundary.** `no-restricted-imports` (Section 8.1) is a *build-blocking*
CI check, not a style preference: no module outside `/host-bindings` may import `fs`,
`child_process`, `net`, `http`, `https`, `os`, `dgram`, or `tls`. `capability/guard.ts` is the
sole exception, and only for `fs.realpathSync` (Section 2.2 step 5) — this is enforced with a
scoped ESLint `override`, not a blanket exemption for the whole `capability/` directory.
`path` (pure string manipulation, no syscalls) is permitted everywhere; it performs no I/O and
carries none of the `../` traversal risk on its own — the risk is entirely in trusting an
*unresolved* path against a pattern, which is exactly what `realpath` in the guard prevents.

---

## 4. Grammar Specification (EBNF)

```ebnf
(* ---- Top level ---- *)
Program         ::= Pragma? NeedsDecl* Statement*
Pragma          ::= "#!" IDENTIFIER NEWLINE        (* only recognized on physical line 1 *)

(* ---- Capabilities ---- *)
NeedsDecl       ::= "needs" CapabilityList NEWLINE
CapabilityList  ::= CapabilityToken ("," CapabilityToken)*
CapabilityToken ::= FsReadCap | FsWriteCap | NetCap | ExecCap | EnvCap | OnlyCap
FsReadCap       ::= "fs" "." "read"  "(" STRING ")"
FsWriteCap      ::= "fs" "." "write" "(" STRING ")"
NetCap          ::= "net"  "(" STRING ")"
ExecCap         ::= "exec" "(" STRING ")"
EnvCap          ::= "env"  "(" IDENTIFIER "?"? ")"
OnlyCap         ::= "only" "(" CapabilityToken ")"  (* no nested only(); parser rejects only(only(...)) *)

(* ---- Statements ---- *)
Statement       ::= LetStmt | FnDecl | IfStmt | WhileStmt | ForStmt
                   | ReturnStmt | ExprStmt | NeedsDecl
LetStmt         ::= "let" IDENTIFIER "=" Expr NEWLINE
FnDecl          ::= "fn" IDENTIFIER "(" ParamList? ")" NeedsDecl? Block
ParamList       ::= IDENTIFIER ("," IDENTIFIER)*
Block           ::= "{" Statement* "}"
IfStmt          ::= "if" Expr Block ("else" (IfStmt | Block))?
WhileStmt       ::= "while" Expr Block
ForStmt         ::= "for" IDENTIFIER "in" Expr Block
ReturnStmt      ::= "return" Expr? NEWLINE
ExprStmt        ::= Expr NEWLINE

(* ---- Expressions, lowest to highest precedence ---- *)
Expr            ::= AssignExpr
AssignExpr      ::= IDENTIFIER "=" AssignExpr | PipeExpr
                    (* lowest precedence, right-associative; the target must be a bare
                       IDENTIFIER — `let` introduces bindings, `=` reassigns existing ones *)
PipeExpr        ::= OrExpr ("|" OrExpr)*
OrExpr          ::= AndExpr ("||" AndExpr)*
AndExpr         ::= EqExpr ("&&" EqExpr)*
EqExpr          ::= RelExpr (("==" | "!=") RelExpr)*
RelExpr         ::= AddExpr (("<" | ">" | "<=" | ">=") AddExpr)*
AddExpr         ::= MulExpr (("+" | "-") MulExpr)*
MulExpr         ::= UnaryExpr (("*" | "/") UnaryExpr)*
UnaryExpr       ::= ("not" | "-") UnaryExpr | Postfix
Postfix         ::= Primary { MemberAccess | Call | BangCall }
MemberAccess    ::= "." IDENTIFIER
Call            ::= "(" ArgList? ")"
BangCall        ::= "!" "(" ArgList? ")"
ArgList         ::= Expr ("," Expr)*
Primary         ::= IDENTIFIER | Literal | FStringExpr
                   | ArrayLiteral | ObjectLiteral | "(" Expr ")"
Literal         ::= STRING | NUMBER | "true" | "false" | "null"
ArrayLiteral    ::= "[" (Expr ("," Expr)*)? "]"
ObjectLiteral   ::= "{" (ObjectProperty ("," ObjectProperty)*)? "}"
ObjectProperty  ::= IDENTIFIER ":" Expr
FStringExpr     ::= 'f"' ( CHAR | "{" Expr "}" )* '"'
```

> **Critical Parsing Rule — bang-call target resolution.** A `!(...)` suffix is only
> syntactically valid when everything preceding it in the postfix chain is a bare `IDENTIFIER`
> followed by zero or more `.IDENTIFIER` member accesses — e.g. `curl!(...)` or
> `fs.readFile!(...)`. If a prior `(...)` call, an array/object literal, or any non-identifier
> expression appears anywhere before the `!`, the parser **must** reject with
> `E205_PARSE_INVALID_BANG_CALL_TARGET`. This guarantees `BangCall.target` is always a
> compile-time-known dotted string — Phase 3 depends on this absolutely; it has no way to
> classify the effect surface of a computed callee.
>
> **Critical Lexical Rule — `!` has exactly one legal position.** There is no logical-NOT
> operator spelled `!`; use the `not` keyword. This removes the classic ambiguity between "this
> is an effectful call" and "negate this boolean." A `!` anywhere except immediately after a
> valid bang-call target (no whitespace) is `E104_LEX_UNEXPECTED_CHARACTER`.
>
> **Critical Lexical Rule — `|` vs `||` (maximal munch).** The pipe operator is a single `|`;
> logical-or is `||`. The lexer must attempt the two-character match first and only emit a
> lone `PIPE` token when the next character isn't a second `|` — the same longest-match
> discipline already used for `=` vs `==`. This is a one-line lexer rule, not a grammar
> ambiguity: by the time the parser sees tokens, `|` and `||` are already distinct.
>
> **Critical Grammar Rule — `needs` placement.** `NeedsDecl` is only valid (a) at the very top
> of `Program`, before any non-`NeedsDecl` statement, or (b) as the optional clause immediately
> after a `FnDecl`'s parameter list, before its `Block`. Anywhere else — inside an `if`/`while`/
> `for` body, after the first non-`needs` statement in a function, as a second top-level block
> separated by other statements — is `E202_PARSE_NEEDS_NOT_AT_TOP`.

---

## 5. Pipe Operator Semantics

The pipe token is a single `|` — one keystroke, no shift key, and visually lighter than a
multi-character arrow. It reads left-to-right like a shell pipeline (`cmd1 | cmd2`), which
fits a language whose whole premise is a capability-secure shell. It is not just
left-associative chaining sugar, though — its argument-insertion rule must be fixed for the
evaluator and extractor to agree, so it is specified here explicitly:

1. **Bare right-hand stage** (an `Identifier` or `MemberExpr` with no trailing call at all):
   the left-hand value becomes its **sole argument**.
   `x | f` ≡ `f(x)` — `x | json.parse` ≡ `json.parse(x)`.
2. **Right-hand stage already has an explicit argument list** (`CallExpr` or `BangCall`): the
   left-hand value is inserted as the **first** argument; explicit arguments follow it.
   `x | f(a, b)` ≡ `f(x, a, b)` — `url | curl!({ method: "GET" })` ≡ `curl!(url, { method: "GET" })`.
3. **Parsing keeps the chain flat, not nested.** `a | b | c` parses to a single
   `PipeExpr { stages: [a, b, c] }` — never nested `PipeExpr`s. This keeps both the evaluator
   (a linear left-fold over `stages`) and the extractor (a single flat array to scan for
   `BangCall` stages) simple. The desugaring rules above are applied by the *evaluator* (and,
   where relevant, the extractor's search for `BangCall` targets) when interpreting each stage
   — the AST itself stores the raw, un-desugared `Expr` for each stage.
4. Extraction is unaffected by which desugaring rule applies to a given `BangCall`'s piped
   argument: since that argument is by definition not a literal in the source text, it is
   `deferred-to-runtime` regardless of rule 1 vs. rule 2. Pipe semantics matter for the
   evaluator's correctness, not for what Phase 3 can prove.

---

## 6. Rosetta Stone Example

```placitum
#!strict

needs fs.read("/etc/config/*.json"), net("api.example.com"), env(API_KEY)

fn fetch_status(url) needs only(net("api.example.com")) {
    let response = url | curl!({ method: "GET" })
    return response
}

let config = fs.readFile!("/etc/config/app.json") | json.parse

if config.enabled {
    let result = fetch_status("https://api.example.com/status")
    print!(f"status={result.status} config={config.name}")
} else {
    print!("fetch disabled by config")
}

for endpoint in config.endpoints {
    let health = endpoint | fetch_status
    print!(f"{endpoint} -> {health.status}")
}
```

This exercises every required feature: a top-level `needs`, a `fn` with an attenuated
per-function `needs only(...)`, `let` bindings, both pipe-argument-insertion forms (Section 5,
rules 1 and 2), bang-calls (`curl!`, `fs.readFile!`, `print!`), `if`/`else`, `for`, member
access, and `f"..."` interpolation. `tests/parser/rosetta.ast.golden.json` and
`tests/capability/rosetta.manifest.golden.json` (Section 10) are generated from this exact
script and must be hand-reviewed before being committed as reference goldens.

---

## 7. Data Structures Reference

Exhaustiveness checking relies entirely on the `kind` discriminator. Every `switch` over
`ASTNode['kind']` (or `CapabilityToken['kind']`) must end in a `default: return assertNever(x)`
— never a bare `default`, never an omitted case.

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled node: ${JSON.stringify(x)}`);
}
```

### 7.1 AST

```ts
interface BaseNode {
  readonly line: number;                    // 1-indexed line of the node's first token
  readonly col: number;                     // 1-indexed column of the node's first token
  readonly span: readonly [number, number]; // [startOffset, endOffset) into the source buffer
}

// ---- Root ----
interface Program extends BaseNode {
  kind: 'Program';
  pragmas: string[];        // e.g. ["strict"], parsed from "#!strict" — line-1 only
  needs: NeedsDecl[];       // top-level needs blocks only (grammar-enforced position)
  body: Statement[];
}

// ---- Capabilities ----
type CapabilityToken =
  | FsReadCapability
  | FsWriteCapability
  | NetCapability
  | ExecCapability
  | EnvCapability
  | OnlyCapability;

interface FsReadCapability extends BaseNode {
  kind: 'FsReadCapability';
  pattern: string;              // raw glob, e.g. "/etc/config/*.json"
}
interface FsWriteCapability extends BaseNode {
  kind: 'FsWriteCapability';
  pattern: string;
}
interface NetCapability extends BaseNode {
  kind: 'NetCapability';
  pattern: string;               // exact host, or "*.<host>" — see Section 7.2 HostPattern rules
}
interface ExecCapability extends BaseNode {
  kind: 'ExecCapability';
  pattern: string;                // binary path or glob
}
interface EnvCapability extends BaseNode {
  kind: 'EnvCapability';
  name: string;
  optional: boolean;              // true for env(NAME?)
}
interface OnlyCapability extends BaseNode {
  kind: 'OnlyCapability';
  inner: Exclude<CapabilityToken, OnlyCapability>; // only() never nests
}

interface NeedsDecl extends BaseNode {
  kind: 'NeedsDecl';
  tokens: CapabilityToken[];
}

// ---- Statements ----
type Statement =
  | LetStmt | FnDecl | IfStmt | WhileStmt | ForStmt
  | ReturnStmt | ExprStmt | NeedsDecl;

interface LetStmt extends BaseNode {
  kind: 'LetStmt';
  id: string;
  init: Expr;
}
interface Param extends BaseNode {
  kind: 'Param';
  id: string;
}
interface Block extends BaseNode {
  kind: 'Block';
  body: Statement[];
}
interface FnDecl extends BaseNode {
  kind: 'FnDecl';
  id: string;
  params: Param[];
  needs: NeedsDecl | null;   // null = inherits enclosing scope's manifest unchanged (Section 2.3)
  body: Block;
}
interface IfStmt extends BaseNode {
  kind: 'IfStmt';
  test: Expr;
  consequent: Block;
  alternate: Block | IfStmt | null;
}
interface WhileStmt extends BaseNode {
  kind: 'WhileStmt';
  test: Expr;
  body: Block;
}
interface ForStmt extends BaseNode {
  kind: 'ForStmt';
  iterator: string;
  iterable: Expr;
  body: Block;
}
interface ReturnStmt extends BaseNode {
  kind: 'ReturnStmt';
  argument: Expr | null;
}
interface ExprStmt extends BaseNode {
  kind: 'ExprStmt';
  expression: Expr;
}

// ---- Expressions ----
type Expr =
  | PipeExpr | BangCall | CallExpr | MemberExpr | FStringExpr | Identifier
  | StringLiteral | NumberLiteral | BooleanLiteral | NullLiteral
  | ArrayLiteral | ObjectLiteral | BinaryExpr | UnaryExpr | AssignExpr;

interface PipeExpr extends BaseNode {
  kind: 'PipeExpr';
  stages: Expr[];    // length >= 2, flat (Section 5, rule 3) — never nested PipeExpr
}
interface BangCall extends BaseNode {
  kind: 'BangCall';
  target: string;     // compile-time-known dotted path, e.g. "curl", "fs.readFile" (Section 4 rule)
  args: Expr[];
}
interface CallExpr extends BaseNode {
  kind: 'CallExpr';
  callee: Expr;        // user-defined fn or a pure stdlib reference — never an effectful binding
  args: Expr[];
}
interface MemberExpr extends BaseNode {
  kind: 'MemberExpr';
  object: Expr;
  property: string;    // dot-access only; no computed/bracket indexing in v1
}
interface FStringExpr extends BaseNode {
  kind: 'FStringExpr';
  parts: (string | Expr)[]; // alternating literal chunks and interpolated expressions
}
interface Identifier extends BaseNode {
  kind: 'Identifier';
  name: string;
}
interface StringLiteral extends BaseNode {
  kind: 'StringLiteral';
  value: string;
}
interface NumberLiteral extends BaseNode {
  kind: 'NumberLiteral';
  value: number;
}
interface BooleanLiteral extends BaseNode {
  kind: 'BooleanLiteral';
  value: boolean;
}
interface NullLiteral extends BaseNode {
  kind: 'NullLiteral';
}
interface ArrayLiteral extends BaseNode {
  kind: 'ArrayLiteral';
  elements: Expr[];
}
interface ObjectProperty extends BaseNode {
  kind: 'ObjectProperty';
  key: string;
  value: Expr;
}
interface ObjectLiteral extends BaseNode {
  kind: 'ObjectLiteral';
  properties: ObjectProperty[];
}
type BinaryOperator = '+' | '-' | '*' | '/' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||';
interface BinaryExpr extends BaseNode {
  kind: 'BinaryExpr';
  operator: BinaryOperator;
  left: Expr;
  right: Expr;
}
type UnaryOperator = '-' | 'not';
interface UnaryExpr extends BaseNode {
  kind: 'UnaryExpr';
  operator: UnaryOperator;
  argument: Expr;
}
interface AssignExpr extends BaseNode {
  kind: 'AssignExpr';
  id: string;          // bare identifier target (Section 4); `let` introduces, `=` reassigns
  value: Expr;
}

// ---- The complete union ----
type ASTNode = Program | Statement | Expr | Param | Block | ObjectProperty;
```

### 7.2 Capability Manifest

> **Resolved vs. base spec — read before implementing:**
> 1. `exec` is `ExecPattern[]`, not `string[]`. The realpath-before-match rule (Section 2.2
>    step 5.2) applies to exec targets exactly as it does to `fsRead`/`fsWrite` — a symlinked
>    binary must not bypass an exec grant — so exec needs a compiled regex too.
> 2. `scoped` is `Record<string, CapabilityManifest>`, not `Map`. The manifest must round-trip
>    through JSON (for `explain`, `audit`, and Phase 7's LLM-facing I/O); `Map` does not
>    serialize to JSON. Use `Record`/plain object everywhere the manifest crosses a
>    serialization boundary.
> 3. A `deferredToRuntime` field is added. Phase 3's own rules require tagging non-literal
>    targets as deferred — the original schema had nowhere to put that tag.

```ts
interface HostPattern {
  type: 'exact' | 'wildcard';
  pattern: string;
  // 'wildcard' patterns are restricted to a single leading label wildcard: "*.example.com".
  // A bare "*" (match-everything) is never valid at any stage and is rejected at extraction
  // time (E305_EXTRACT_OVERPRIVILEGED_WILDCARD), not deferred and not silently narrowed.
}

interface GlobPattern {
  raw: string;
  regex: RegExp;   // compiled via a pure string transform in Phase 3 — never touches disk
}

interface ExecPattern {
  raw: string;
  regex: RegExp;   // same compiler as GlobPattern; canonicalized against at guard time like fsRead/fsWrite
}

interface EnvRequirement {
  name: string;
  optional: boolean;
}

interface DeferredCheck {
  nodeSpan: readonly [number, number];
  category: 'net' | 'fsRead' | 'fsWrite' | 'exec';
  reason: string;   // e.g. "argument is not a compile-time string literal (Identifier `userUrl`)"
}

interface CapabilityManifest {
  net: HostPattern[];
  fsRead: GlobPattern[];
  fsWrite: GlobPattern[];
  exec: ExecPattern[];
  env: EnvRequirement[];
  scoped: Record<string, CapabilityManifest>;  // FnId -> attenuated child manifest
  deferredToRuntime: DeferredCheck[];
}
```

### 7.3 Serialization boundary & Zod schemas

`RegExp` is not JSON-serializable, and — more importantly — **a `RegExp` must never be
deserialized from untrusted JSON.** Accepting a pre-compiled pattern from an external source
(including Phase 7's LLM-facing pipeline) would let an attacker or a hallucinating model hand
in an already-overpermissive matcher that bypasses the real compiler entirely. The rule: only
`raw` strings cross any trust boundary; `regex` is **always** recompiled locally, on load,
through the same Phase 3 compiler function that produced it the first time.

This is also why AST nodes get no Zod schema: the parser is the *only* producer of `ASTNode`
values, and it is never fed untrusted pre-built ASTs — only untrusted *source text*, which the
real lexer/parser must always process from scratch (Section 0, rule 8). Zod validation is
reserved for the two data shapes that legitimately cross a serialization boundary: the
manifest (below) and the error envelope (Section 9).

```ts
import { z } from 'zod';

const HostPatternSchema = z.object({
  type: z.enum(['exact', 'wildcard']),
  pattern: z.string().min(1),
});

const SerializedGlobPatternSchema = z.object({
  raw: z.string().min(1),
  // No `regex` field here on purpose — see the note above. Callers must run `raw` through
  // the Section 2.1 pure compiler locally to obtain an in-memory `GlobPattern`/`ExecPattern`.
});

const EnvRequirementSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  optional: z.boolean(),
});

const DeferredCheckSchema = z.object({
  nodeSpan: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  category: z.enum(['net', 'fsRead', 'fsWrite', 'exec']),
  reason: z.string().min(1),
});

interface SerializedManifest {
  net: z.infer<typeof HostPatternSchema>[];
  fsRead: z.infer<typeof SerializedGlobPatternSchema>[];
  fsWrite: z.infer<typeof SerializedGlobPatternSchema>[];
  exec: z.infer<typeof SerializedGlobPatternSchema>[];
  env: z.infer<typeof EnvRequirementSchema>[];
  scoped: Record<string, SerializedManifest>;
  deferredToRuntime: z.infer<typeof DeferredCheckSchema>[];
}

const SerializedCapabilityManifestSchema: z.ZodType<SerializedManifest> = z.lazy(() =>
  z.object({
    net: z.array(HostPatternSchema),
    fsRead: z.array(SerializedGlobPatternSchema),
    fsWrite: z.array(SerializedGlobPatternSchema),
    exec: z.array(SerializedGlobPatternSchema),
    env: z.array(EnvRequirementSchema),
    scoped: z.record(z.string(), SerializedCapabilityManifestSchema),
    deferredToRuntime: z.array(DeferredCheckSchema),
  }),
);
```

`compileManifest(s: SerializedManifest): CapabilityManifest` is the single pure function
(in `shared/`) that turns validated `raw` strings into `RegExp`s — the extractor calls it once
when producing a manifest, and Phase 7 calls it again on any manifest reconstructed from an
LLM interaction, so the recompiled regex is always locally trusted, never imported wholesale.

---

## 8. Security Tooling & Configuration

### 8.1 `.eslintrc.json`

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": "./tsconfig.json",
    "sourceType": "module",
    "ecmaVersion": 2022
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "ignorePatterns": ["dist/", "scripts/", "vite.config.ts"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          { "group": ["fs", "node:fs", "fs/*", "node:fs/*"], "message": "OS primitives are only permitted inside /host-bindings. Route through CapabilityGuard." },
          { "group": ["child_process", "node:child_process"], "message": "Process spawning is only permitted inside /host-bindings. Route through CapabilityGuard." },
          { "group": ["net", "node:net"], "message": "Network primitives are only permitted inside /host-bindings. Route through CapabilityGuard." },
          { "group": ["http", "node:http"], "message": "Network primitives are only permitted inside /host-bindings. Route through CapabilityGuard." },
          { "group": ["https", "node:https"], "message": "Network primitives are only permitted inside /host-bindings. Route through CapabilityGuard." },
          { "group": ["os", "node:os"], "message": "OS primitives are only permitted inside /host-bindings. Route through CapabilityGuard." },
          { "group": ["dgram", "node:dgram"], "message": "Network primitives are only permitted inside /host-bindings. Route through CapabilityGuard." },
          { "group": ["tls", "node:tls"], "message": "Network primitives are only permitted inside /host-bindings. Route through CapabilityGuard." }
        ]
      }
    ]
  },
  "overrides": [
    {
      "files": ["src/host-bindings/**/*.ts"],
      "rules": { "no-restricted-imports": "off" }
    },
    {
      "files": ["src/capability/guard.ts"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              { "group": ["child_process", "node:child_process"], "message": "guard.ts may only import 'fs' for realpathSync — no process spawning here." },
              { "group": ["net", "node:net"], "message": "guard.ts may only import 'fs' for realpathSync — no sockets here." },
              { "group": ["http", "node:http"], "message": "guard.ts may only import 'fs' for realpathSync." },
              { "group": ["https", "node:https"], "message": "guard.ts may only import 'fs' for realpathSync." },
              { "group": ["os", "node:os"], "message": "guard.ts may only import 'fs' for realpathSync." },
              { "group": ["dgram", "node:dgram"], "message": "guard.ts may only import 'fs' for realpathSync." },
              { "group": ["tls", "node:tls"], "message": "guard.ts may only import 'fs' for realpathSync." },
              { "group": ["fs/*", "node:fs/*"], "message": "guard.ts imports fs for realpathSync only — the sync spelling, not fs/promises." }
            ]
          }
        ]
      }
    },
    {
      "files": ["tests/**/*.ts"],
      "rules": {
        "@typescript-eslint/no-explicit-any": "off",
        "no-restricted-imports": "off"
      }
    }
  ]
}
```

### 8.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "rootDir": ".",
    "outDir": "./dist",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

### 8.3 Dependency Allow-List

If it isn't in this table, do not install it — hand-roll the functionality in the appropriate
directory instead.

| Package | Scope | Rationale |
|---|---|---|
| `zod` | runtime | Validates the manifest and error envelope at every trust boundary (Sections 7.3, 9). |
| `typescript` | dev | Compiler. |
| `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | dev | Enforces Section 8.1. |
| `vitest` | dev | Test runner + golden-file snapshotting. |
| `tsx` | dev | Runs `.ts` directly for local iteration / CI scripts. |
| `commander` | runtime | CLI argument parsing for Phase 9 (`run`, `explain`, `audit`, `rewind` subcommands). |
| `prettier` | dev | Formatting only — never used to silence a lint error. |
| `@types/node` | dev | Type declarations for the Node.js host runtime — types-only, zero runtime/audit surface; required for `tsc` to type host APIs used by tests and `/host-bindings`. |

**Explicitly banned, with reasons an agent might otherwise reach for them:**
- Any glob library (`minimatch`, `micromatch`, `fast-glob`, …) — glob-to-regex compilation is
  a hand-rolled pure function in `shared/`, per Section 2.1; a third-party glob engine is both
  an unaudited dependency and an unnecessary one since only a small, security-relevant subset
  of glob syntax needs support.
- Any HTTP client (`axios`, `node-fetch`, `undici`, …) — all network access goes through
  `/host-bindings` using Node's built-in `http`/`https`/`net` directly; adding an HTTP client
  library would create a second, unaudited path to the network.
- `fs-extra`, `shelljs`, `execa`, or similar convenience wrappers — they wrap the exact
  primitives `/host-bindings` already wraps, and would give another module a reason to import
  something other than `fs`/`child_process`, defeating the point of the import boundary.
- `lodash`/`ramda` — the codebase is small enough that hand-rolled utilities keep the
  dependency surface minimal, which matters more here than elsewhere given the security goal.

---

## 9. Error Taxonomy & Envelope

### 9.1 Code ranges

| Range | Phase | Thrown by |
|---|---|---|
| `E1xx` | Lexer | `lexer/` |
| `E2xx` | Parser | `parser/` |
| `E3xx` | Static Capability Extraction | `capability/extractor.ts` |
| `E4xx` | CapabilityGuard (runtime security) | `capability/guard.ts` |
| `E5xx` | Evaluator | `evaluator/` |
| `E6xx` | CLI / explain | `cli/` |
| `E7xx` | AI-Agent mode | `cli/agent/` |
| `E8xx` | rewind / replay | `cli/rewind.ts` |

### 9.2 Catalog

| Code | Meaning |
|---|---|
| `E101_LEX_UNTERMINATED_STRING` | String literal not closed before EOL/EOF. |
| `E102_LEX_UNTERMINATED_FSTRING_EXPR` | `{` inside `f"..."` not closed before the string ends. |
| `E103_LEX_INVALID_ESCAPE` | Unknown `\x` escape sequence. |
| `E104_LEX_UNEXPECTED_CHARACTER` | Includes any `!` not immediately following a valid bang-call target. |
| `E105_LEX_INVALID_PRAGMA` | `#!` used anywhere other than physical line 1. |
| `E106_LEX_INVALID_NUMBER` | Malformed numeric literal. |
| `E201_PARSE_UNEXPECTED_TOKEN` | Generic grammar violation. |
| `E202_PARSE_NEEDS_NOT_AT_TOP` | `needs` outside the two legal positions (Section 4). |
| `E203_PARSE_UNTERMINATED_BLOCK` | Missing closing `}`. |
| `E204_PARSE_INVALID_CAPABILITY_TOKEN` | Malformed token inside a `needs` list. |
| `E205_PARSE_INVALID_BANG_CALL_TARGET` | `!` preceded by anything other than a static dotted-identifier path (Section 4). |
| `E206_PARSE_DUPLICATE_PARAM` | Repeated parameter name in a `FnDecl`. |
| `E301_EXTRACT_UNCOVERED_CAPABILITY` | An effectful `BangCall` with a literal target not covered by any in-scope `needs`. |
| `E302_EXTRACT_INVALID_GLOB` | A capability pattern that fails to compile to a regex. |
| `E303_EXTRACT_ATTENUATION_ESCALATION` | A child `needs only(...)` requests outside the parent manifest (Section 2.3). |
| `E304_EXTRACT_UNHANDLED_NODE` | Extractor's exhaustiveness switch hit an unrecognized `kind` (should be caught by `tsc`; this is the runtime backstop). |
| `E305_EXTRACT_OVERPRIVILEGED_WILDCARD` | A bare `"*"` net/exec/glob pattern. |
| `E401_GUARD_NET_DENIED` | Runtime host doesn't match any granted `HostPattern`. |
| `E402_GUARD_FS_READ_DENIED` | Runtime path (post-canonicalization) doesn't match any granted `fsRead` glob. |
| `E403_GUARD_PATH_TRAVERSAL` | Canonicalization revealed the path escapes every granted glob (symlink or `..`). |
| `E404_GUARD_FS_WRITE_DENIED` | As `E402`, for `fsWrite`. |
| `E405_GUARD_EXEC_DENIED` | Runtime binary path (post-canonicalization) doesn't match any granted `exec` pattern. |
| `E406_GUARD_ENV_MISSING` | A declared, non-optional `env(...)` variable is unset at runtime. |
| `E407_GUARD_MANIFEST_TAMPERED` | The manifest the guard was instantiated with doesn't match the hash the extractor produced for this source file. |
| `E500_EVAL_UNBOUND_VAR` | Reference to an undeclared identifier. |
| `E501_EVAL_TYPE_MISMATCH` | `#!strict` pipe-chain inference failure, or a runtime type error. |
| `E502_EVAL_NOT_CALLABLE` | `CallExpr`/`BangCall` target doesn't resolve to a function. |
| `E503_EVAL_ARITY_MISMATCH` | Wrong argument count for a user-defined `fn`. |
| `E504_EVAL_DIVISION_BY_ZERO` | Self-explanatory. |
| `E505_EVAL_PIPE_TYPE_ERROR` | `#!strict` pre-pass rejected a pipe stage's inferred type. |
| `E506_EVAL_REDECLARATION` | A `let`/`fn` name redeclared in the same lexical scope (shadowing in an inner scope remains legal). |
| `E601_CLI_FILE_NOT_FOUND` | Input script path doesn't exist. |
| `E602_CLI_INVALID_FLAG` | Unrecognized CLI flag/subcommand. |
| `E603_EXPLAIN_RENDER_FAILURE` | Malformed manifest passed to the (otherwise I/O-free) `explain` renderer. |
| `E701_AGENT_UNTRUSTED_PARSE_FAILURE` | LLM-generated `.placitum` text failed the real Phase 2 parser. |
| `E702_AGENT_VERIFY_FAILURE` | LLM-generated script parsed, but Phase 3 extraction found capabilities the proposed manifest diff didn't disclose. |
| `E703_AGENT_ATTENUATION_REJECTED` | LLM-proposed `only(...)` attempts escalation (same rule as `E303`, surfaced with agent context). |
| `E801_REPLAY_HASH_MISMATCH` | A recorded external-state hash doesn't match what's on disk/network at replay time. |
| `E802_REPLAY_LOG_CORRUPT` | The append-only log fails its own structural validation. |
| `E803_REPLAY_STEP_OUT_OF_RANGE` | Requested replay step N exceeds the log length. |

### 9.3 Envelope

```ts
interface PlacitumError {
  code: string;    // e.g. "E403_GUARD_PATH_TRAVERSAL" — always matches ^E\d{3}_[A-Z_]+$
  phase: 'lex' | 'parse' | 'extract' | 'guard' | 'eval' | 'cli' | 'agent' | 'replay';
  severity: 'error' | 'warning';
  message: string;
  location?: { line: number; col: number; span?: readonly [number, number] };
  hint?: string;
}

const PlacitumErrorSchema = z.object({
  code: z.string().regex(/^E\d{3}_[A-Z_]+$/),
  phase: z.enum(['lex', 'parse', 'extract', 'guard', 'eval', 'cli', 'agent', 'replay']),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1),
  location: z.object({
    line: z.number().int().positive(),
    col: z.number().int().positive(),
    span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
  }).optional(),
  hint: z.string().optional(),
});
```

A class hierarchy mirrors the phases (`LexError`, `ParseError`, `CapabilityViolationError`,
`EvalError`, …), each extending a common `PlacitumErrorBase extends Error` that carries these
same fields. Every error, of any class, reaches the CLI boundary through one formatter —
never an ad hoc `console.error`.

Text rendering (used by every CLI subcommand):

```
error[E403]: path traversal blocked
  --> script.placitum:12:19
   |
12 |   let secrets = fs.readFile!("../../etc/passwd")
   |                              ^^^^^^^^^^^^^^^^^^^^ resolves outside every granted fs.read() capability
   |
   = hint: request `needs fs.read("/etc/passwd")` explicitly, or remove the traversal.
```

---

## 10. Test Artifact Naming Conventions

| Artifact | Pattern | Location |
|---|---|---|
| Lexer token-stream snapshot | `*.lex.golden.json` | `tests/lexer/` |
| Parser AST snapshot | `*.ast.golden.json` | `tests/parser/` |
| Capability manifest snapshot | `*.manifest.golden.json` | `tests/capability/` |
| Security-violation script (must fail) | `*.negative.placitum` | `tests/capability/negative/`, `tests/guard/negative/` |
| Expected error for a `.negative.placitum` | `<same-basename>.expected-error.json` (validates against `PlacitumErrorSchema`) | same directory as the script |
| Evaluator output snapshot | `*.eval.golden.json` | `tests/eval/` |
| `explain` CLI output snapshot | `*.explain.golden.txt` | `tests/explain/` |
| Adversarial LLM-output fixture (Phase 7) | `*.agent.negative.placitum`, `*.agent.golden.json` | `tests/agent/` |
| Rewind/replay log fixture | `*.rewind.golden.json` | `tests/replay/` |

Every `*.negative.placitum` file is paired 1:1 with an `*.expected-error.json` of the same
basename — a test runner iterates the negative directory and asserts the actual thrown
`PlacitumError.code` matches the expected file's `code` field exactly.

---

## 11. Phased Build Plan — Definition of Done & CI Gates

**Global rule (restated from Section 0.5): Phase N+1 implementation code must not be written
until Phase N's CI Gate below is fully green.**

### Phase 0 — Scaffolding & Security-First Test Harness
- **Goal:** CI pipeline, import boundary, and adversarial test corpus exist before any language feature does.
- **DoD:**
  - [ ] `tsconfig.json` (Section 8.2) in place; `tsc --noEmit` passes on an empty `src/`.
  - [ ] `.eslintrc.json` (Section 8.1) in place; a temporary fixture file that imports `fs` outside `/host-bindings` is added, confirmed to fail lint, then deleted — proving the rule actually fires, not just exists.
  - [ ] A `check-deps` CI script fails the build if `package-lock.json` contains anything outside Section 8.3's Allow-List.
  - [ ] CI runs, in order: `check-deps` → `tsc --noEmit` → `eslint .` → `vitest run`.
  - [ ] At least 3 `*.negative.placitum` fixtures exist in `tests/capability/negative/` (a `../` traversal, an overprivileged `net("*")`, a `BangCall` with no covering `needs`), each with a schema-valid `*.expected-error.json` per Section 10 — they don't need to pass yet (no parser exists), but they must exist and validate against `PlacitumErrorSchema`.
- **CI Gate:** pipeline green on an otherwise-empty `src/`.

### Phase 1 — Lexer
- **Goal:** Hand-rolled scanner, `Source String → Token[]`.
- **DoD:**
  - [ ] Every token carries exact `line`/`col`/`span`.
  - [ ] Stateful `f"...{expr}..."` lexing (switches to expression mode inside `{ }` and back), including nested braces and `\{`/`\}` escapes in literal text.
  - [ ] `#!` recognized only on physical line 1 (Section 4); a bare `#` starts a line comment anywhere.
  - [ ] `!` lexes as a single `BANG` token only directly after an identifier/member-access chain with no whitespace; any other position is `E104`.
  - [ ] `≥1` golden `*.lex.golden.json` per token category (string, f-string, number, pragma, bang, punctuation, keyword).
  - [ ] Negative tests cover `E101`–`E106`.
- **CI Gate:** 100% of `tests/lexer/*.lex.golden.json` match byte-for-byte; all `E1xx` negatives throw the exact code.

### Phase 2 — Parser & AST
- **Goal:** `Token[] → ASTNode` per the Section 4 grammar and Section 7.1 types.
- **DoD:**
  - [ ] Full EBNF (Section 4) implemented with the exact precedence table (pipe lowest → unary/postfix highest).
  - [ ] `E202` fires for `needs` in every illegal position: mid-block, after a function's first non-`needs` statement, and a second top-level `needs` block separated from the first by another statement.
  - [ ] Every interface in Section 7.1 is producible; a test asserts (via a TS `satisfies ASTNode` check on parser output) that nothing outside the union is ever constructed.
  - [ ] `E205` fires for the disallowed bang-call-target shapes described in Section 4's callout (e.g. `getFn()!(...)`).
  - [ ] Golden AST snapshot for the full Rosetta Stone example (Section 6) → `tests/parser/rosetta.ast.golden.json`.
  - [ ] Negative tests cover every `E2xx` code.
- **CI Gate:** all parser goldens match; all `E2xx` negatives throw the exact code.

### Phase 3 — Static Capability Extraction
- **Goal:** Pure `ASTNode → SerializedCapabilityManifest` (Section 7.2/7.3).
- **DoD:**
  - [ ] A "purity smoke test" runs the extractor inside a Node `vm` context with `fs`/`net`/`child_process`/etc. set to `undefined`, so an accidental import throws immediately rather than silently succeeding via module caching.
  - [ ] An exhaustiveness `switch` over `ASTNode['kind']` with `assertNever` in the default case — every effectful node kind (`BangCall`) is either matched against an in-scope `needs` token or produces a `DeferredCheck`; nothing is silently dropped.
  - [ ] Glob-to-regex compilation (Section 2.1) is unit tested against strings alone, with zero filesystem contact.
  - [ ] `E303` fires when a child `needs only(...)` requests outside the parent manifest.
  - [ ] `E305` fires for any bare `"*"` pattern in `net`/`exec`/glob position.
  - [ ] `tests/capability/rosetta.manifest.golden.json` generated from Section 6's example and hand-reviewed before commit.
- **CI Gate:** purity smoke test passes; all manifest goldens match; all `E3xx` negatives throw the exact code.

### Phase 4 — CapabilityGuard
- **Goal:** Runtime enforcer; only entry point to `/host-bindings` outside `/host-bindings` itself.
- **DoD:**
  - [ ] `authorize()` canonicalizes (Section 2.2 step 5) **before** matching; a test proves a symlink pointing outside every granted `fsRead` glob is rejected with `E403`.
  - [ ] A test specifically targets naive-string-match false negatives: a `../` sequence whose *string* happens to still look like it's inside an allowed directory, but whose *canonical* resolution is not.
  - [ ] Net matching: exact-match default verified; `"*.example.com"` verified to reject `evil.com` and `notexample.com` (substring false-positive class) and accept `api.example.com`.
  - [ ] Exec targets get the same realpath treatment as `fsRead`/`fsWrite` (Section 7.2 note 1); a symlinked binary outside the granted `exec` pattern is rejected.
  - [ ] A TOCTOU test asserts the value handed to `/host-bindings` is byte-identical to the value that was authorized.
  - [ ] All `*.negative.placitum` guard fixtures from Phase 0 now execute and throw their paired `.expected-error.json` code exactly.
- **CI Gate:** all guard negative tests pass with exact `E4xx` codes.

### Phase 5 — Tree-Walking Evaluator
- **Goal:** Visitor-pattern interpreter, lexical scoping, `ASTNode + Environment → Output`.
- **DoD:**
  - [ ] Closures capture their defining environment, not the call-site environment.
  - [ ] Every effectful stdlib function is a thin wrapper: resolve args → `CapabilityGuard.authorize` → the matching `/host-bindings` call, nothing else; a test spies on host-binding entry points and asserts no stdlib function reaches one without an intervening `authorize` call.
  - [ ] `print!`/`eprint!` route through the same choke point but are unconditionally authorized (Section 1) — a test confirms they need no `needs` declaration.
  - [ ] Pipe semantics (Section 5, rules 1–2) are implemented exactly as specified; both forms are covered by golden tests.
  - [ ] `#!strict` runs its type-inference pre-pass over the whole pipe chain before any evaluation begins — a test proves a type error later in a chain is caught before the chain's first side effect runs.
  - [ ] Golden eval-output tests for the Rosetta Stone example and each control-flow construct.
  - [ ] Negative tests cover `E500`–`E506`.
- **CI Gate:** all eval goldens and `E5xx` negatives pass.

### Phase 6 — `placitum explain`
- **Goal:** `CapabilityManifest → Stdout String`, zero I/O.
- **DoD:**
  - [ ] A purity smoke test analogous to Phase 3's.
  - [ ] Output visually separates statically-proven grants from `deferredToRuntime` entries.
  - [ ] `tests/explain/rosetta.explain.golden.txt` for the Rosetta Stone example.
- **CI Gate:** explain goldens match byte-for-byte.

### Phase 7 — AI-Agent Mode (`infer`, `audit`, `run --attenuate`)
- **Goal:** LLM-assisted manifest minimization, with the LLM never bypassing the compiler.
- **DoD:**
  - [ ] Every LLM-produced `.placitum` script is passed through the real Phase 2 parser and Phase 3 extractor before any diff is shown to the user — no bespoke "trust the LLM's JSON" path exists anywhere in this phase.
  - [ ] Any manifest-shaped JSON from the LLM is validated against `SerializedCapabilityManifestSchema` (Section 7.3) before being compiled; since `regex` is never accepted from JSON, an injected lenient-regex string cannot reach the guard.
  - [ ] `tests/agent/` includes at least one adversarial fixture per category: a script that looks narrower in a diff than it actually parses to, a manifest JSON with a hand-crafted-lenient pattern in a `raw` field, and a script attempting `only()` escalation.
  - [ ] `E701`–`E703` each have a passing negative test.
- **CI Gate:** all agent-mode adversarial fixtures rejected with the correct code.

### Phase 8 — `rewind` (Replay Debugger)
- **Goal:** Append-only log of effectful I/O with deterministic replay to step N.
- **DoD:**
  - [ ] Every effectful call is logged with a content hash of relevant external state (file contents before/after, response body, etc.).
  - [ ] A deliberately corrupted `*.rewind.golden.json` fixture (one byte flipped in a recorded hash) throws `E801` — replay never silently continues against stale data.
  - [ ] Malformed log structure throws `E802`; an out-of-range step request throws `E803`.
  - [ ] Replay of already-recorded steps is itself pure playback (no side effects); live execution resumes through the normal `CapabilityGuard` path only after step N.
- **CI Gate:** `E801`–`E803` fixtures all pass; a live-resumption-after-replay test passes.

### Phase 9 — CLI, Packaging & Hardening
- **Goal:** Final binary, deterministic error UX, optional secondary sandbox.
- **DoD:**
  - [ ] Every `PlacitumError` reaching the CLI boundary renders through the single formatter in Section 9.3 — a grep-based CI check confirms no ad hoc `console.error(err)` remains anywhere in `src/`.
  - [ ] `placitum run|explain|audit|rewind --help` and `--version` produce deterministic, tested output.
  - [ ] (Optional, non-blocking) the compiled binary is wrapped with Deno permission flags or Node's `--permission` as a secondary sandbox layer — documented explicitly as defense-in-depth, never as a substitute for `CapabilityGuard`.
- **CI Gate:** an end-to-end test runs the Rosetta Stone example through `run`, `explain`, and `audit` successfully. This is the final release gate.

---

## Appendix — Resolved Ambiguities (changelog vs. base spec)

| Base spec said | Ambiguity/gap | Resolution in this directive |
|---|---|---|
| "Static extraction does NO I/O" + "path canonicalization via realpath" | Contradiction — realpath is a syscall | `realpath` moved entirely to Phase 4 (`CapabilityGuard.authorize`); Phase 3 only compiles glob *strings* to regex, never touches a concrete path (Section 2). |
| `CapabilityManifest.scoped: Map<...>` | `Map` doesn't survive JSON serialization, but the manifest must round-trip through `explain`/`audit`/Phase 7 | Changed to `Record<string, CapabilityManifest>` (Section 7.2, note 2). |
| `CapabilityManifest.exec: string[]` | Inconsistent with the realpath-before-match rule that applies to `fsRead`/`fsWrite` | Changed to `ExecPattern[]` (Section 7.2, note 1). |
| Phase 3: "dynamic values... must be tagged as deferred-to-runtime" | No field existed to hold that tag | Added `CapabilityManifest.deferredToRuntime: DeferredCheck[]` (Section 7.2, note 3). |
| `!` mentioned only as a "load-bearing trailing token" | Could collide with a logical-NOT operator | Logical negation uses the `not` keyword; `!` is reserved exclusively for bang-call syntax (Section 4). |
| Pipe operator spelled `|>`, given no argument-binding semantics | `|>` is a two-character reach on most layouts, and the base spec never said where the piped value lands in a call | Token simplified to a single `|` (shell-idiomatic, disambiguated from `||` by maximal munch — Section 4), with an explicit two-rule argument-insertion desugaring (Section 5). |
| No stated rule preventing effectful stdlib functions from being called without `!` | Would break Phase 3's "scan for `BangCall`" coverage claim | Made explicit invariant: effectful operations are reachable *only* via `BangCall` syntax (Section 1). |
| No guidance on `print!`/stdout | Ambiguous whether output needs a capability | Declared ambient/always-authorized, still routed through the choke point for `rewind` completeness (Section 1). |
| `AssignExpr` present in the Section 7.1 union, but no grammar production for it | The parser could never produce it, making the Phase 2 DoD ("every interface in Section 7.1 is producible") unsatisfiable — and the language had no way to reassign variables, so `while` loops could not mutate accumulators | Added `AssignExpr ::= IDENTIFIER "=" AssignExpr | PipeExpr` (lowest precedence, right-associative, bare-identifier target) to Section 4. `let` remains the only binder; assignment writes the nearest enclosing scope holding the binding, else `E500` (evaluator semantics, Phase 5). User-approved during Phase 2. |
| No error code for same-scope redeclaration. Phase 3's extractor keys `scoped` manifests by fn id, last-wins, so a closure captured before a redeclaration would execute its body under the *later* fn's attenuated manifest — an id-collision hole | Added `E506_EVAL_REDECLARATION` (Section 9.2): same-scope `let`/`fn` redeclaration is a Phase 5 error; shadowing in an inner scope stays legal. User-approved during Phase 5. |
