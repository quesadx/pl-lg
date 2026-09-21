---
title: Placitum LSP — AI Implementation Directive
version: 1.0
status: Authoritative — the plan of record for the Placitum language server
tech_stack: TypeScript (Node.js, strict mode), JSON-RPC over stdio via `vscode-languageserver`
target_audience: Autonomous AI Coding Agent working in a NEW repository (`placitum-lsp`)
companion_docs:
  - placitum-implementation.md  (authoritative language spec — read before this file)
  - PROGRESS.md                  (build history, deviations, decisions)
source_repo: https://github.com/quesadx/pl-lg (core language, package name `placitum`, v1.0.0)
---

# Placitum LSP — AI Implementation Directive

This document is the complete, self-contained specification for building the Placitum
language server. It is written for an autonomous AI coding agent working in a **separate
repository**. Where this document and the core repo's `placitum-implementation.md` disagree
about **language semantics**, the core spec wins. Where they disagree about **LSP behavior**,
this document wins.

---

## 0. Agent Execution Rules — Read First

1. **Read the core repo first.** `placitum-implementation.md` (language spec), `PROGRESS.md`
   (decisions/deviations), and the `src/` tree in `quesadx/pl-lg` are authoritative for what
   the language *is*. This document tells you what to build *around* it.
2. **TDD is mandatory.** For every phase, write the failing test/fixture first (protocol
   fixture, golden, or unit test), watch it fail for the right reason, then implement.
3. **Never use `any`, `@ts-ignore`, or `@ts-expect-error`.** The core repo's lint rules and
   `tsconfig` strictness (Section 8.2 of the core spec) are the baseline; copy them.
4. **Only install dependencies from the allow-list in §4.3 of this document.** If you think
   you need something else, hand-roll it or stop and write the blocker down.
5. **The server must never execute Placitum code.** Only the *pure* core phases are allowed:
   lex, parse, extract, explain, manifest compile, signatures. Never import or call the
   evaluator, the guard, the stdlib runtime, or `/host-bindings`. See §3.
6. **stdout is the JSON-RPC channel.** Nothing may ever be printed to stdout outside framed
   protocol messages — not even on crash. Logs go to stderr and/or
   `connection.console.log`. A test must enforce this.
7. **Work one phase at a time, in order.** Do not start phase N+1 until phase N's CI gate
   (§13) is fully green. Phase 0 is blocked on a small, explicitly enumerated set of changes
   in the core repo (§5); do that first and pin the resulting commit.
8. **Write every user-facing string in English**, matching the core repo.
9. **If you hit a genuine contradiction this document does not resolve, stop.** Write it to
   `docs/BLOCKED.md` with an exact section reference instead of guessing.

---

## 1. Mission, Scope, Non-Goals

### 1.1 Mission

Ship a production-grade LSP server for Placitum that:

- works over stdio with **any** spec-compliant editor client (Neovim, Helix, VS Code,
  Emacs/eglot, Zed, Sublime, Kate, Vim);
- reuses the core language implementation **verbatim** (never re-implements the lexer,
  parser, extractor, or explain renderer);
- understands Placitum's defining feature — the capability system — in diagnostics, hover,
  completion, code actions, code lens, and a custom manifest request;
- is ready for a thin VS Code extension (built by another teammate) without any VS
  Code-specific server code;
- never executes user code; static analysis only.

### 1.2 Non-goals (explicitly out of scope for v1.0 of the server)

| Non-goal | Why / when to revisit |
|---|---|
| Formatting (`textDocument/formatting`) | The language has no formatter; inventing one is a separate project. Skip entirely. |
| Cross-file features (modules, imports) | Placitum has no module system; every file is a program. References/rename are single-file by construction. |
| Type checking beyond core's semantics | The language is dynamically typed; only *definitely-certain* static errors are reported (§6.5). |
| Executing/simulating scripts | Security invariant (§3). No evaluator, ever. |
| Runtime capability denials as diagnostics | Not statically knowable. Surfaced as hover/code-lens information instead. |
| Tree-sitter grammar / syntax highlighting | Separate deliverable (or teammate). Semantic tokens are best-effort without it. |
| VS Code extension code | Teammate's repo; §9 gives them a complete handoff spec. |
| `rewind`/AI-agent modes | Deferred in core; out of scope here. |
| Multi-error recovery in core | Required for a great experience but lives in the core repo (§5, Phase 0b). The LSP must degrade gracefully to one-diagnostic mode if it is unavailable. |
| Pull diagnostics (`textDocument/diagnostic`) | Push diagnostics work in every target client. Do not advertise the pull provider. |
| Semantic token delta/range requests | Full tokens only; files are small. Add delta only if profiling ever demands it. |
| Standalone single-file binary | Editors can find `node`; VS Code bundles the server module. Revisit only on user request. |

### 1.3 Compatibility contract (what "works everywhere" means concretely)

The server MUST work with a minimal client that only implements: `initialize`,
`textDocument/didOpen|didChange|didClose`, and receives `textDocument/publishDiagnostics`.
Every other capability is a bonus that must never be *required* for initialization to
succeed. Specifically:

- No dynamic registration as a prerequisite; if the client supports it, optionally register
  `workspace/didChangeWatchedFiles` for `.placitum` files (workspace symbols refresh).
- `rootUri` / `workspaceFolders` may be `null`; single-file mode must be fully functional.
- `positionEncoding`: advertise `utf-16` (LSP default; core spans are UTF-16 code-unit
  offsets — see §6.2). Never require the client to implement another encoding.
- Hover/`completionItem`/symbol markup: send `MarkupContent` only if
  `clientCapabilities.textDocument.hover.contentFormat` includes `markdown`; otherwise send
  `MarkedString`-compatible plain strings. Same rule for `documentation` fields.
- Honor both flat (`SymbolInformation[]`) and hierarchical (`DocumentSymbol[]`) symbol
  responses based on client capability.
- Never write to the user's filesystem directly. All edits go through `WorkspaceEdit`.
- Respond `MethodNotFound` to unknown requests and ignore unknown notifications.

---

## 2. Language Reference for LSP Implementers

This section is a condensed but complete reference. The core spec remains authoritative.

### 2.1 What Placitum is

A capability-secure shell language. One organizing idea: **every effectful operation is
syntactically visible (`name!(...)`), statically enumerable, and runtime-enforced**. A file
is a complete program. There are no imports, modules, classes, exceptions, or type
annotations.

### 2.2 Files and CLI

- Source files: `*.placitum`, UTF-8. The LSP must also accept any file the editor associates
  with language id `placitum`.
- CLI (core): `placitum run <file>`, `placitum explain <file>`, `--version` = `1.0.0`.
- Error envelope (used verbatim in diagnostics), from core `shared/error-schema.ts`:

```ts
interface PlacitumError {
  code: string;              // ^E\d{3}_[A-Z_]+$
  phase: 'lex'|'parse'|'extract'|'guard'|'eval'|'cli'|'agent'|'replay';
  severity: 'error'|'warning';
  message: string;
  location?: { line: number; col: number; span?: readonly [number, number] }; // 1-indexed line/col
  hint?: string;
}
```

- `line`/`col` are 1-indexed; `col` counts **UTF-16 code units**; `span` is a
  `[start, end)` UTF-16 code-unit offset pair into the full source string.

### 2.3 Lexical structure (summary — exact rules in core spec §4)

| Category | Tokens / rules |
|---|---|
| Keywords | `needs let fn if else while for in return not only true false null` |
| Not keywords | `fs net exec env read write` lex as `IDENTIFIER` (used in `needs` and member paths) |
| Literals | `STRING` (`"..."`), `NUMBER` (int or single decimal, no exponent/hex), `f"..."` (`FSTRING_START`/`STRING_CHUNK`/`FSTRING_END`) |
| Comments | `#` to end of line, anywhere. `#!name` is a `PRAGMA` only on physical line 1. |
| `!` | `BANG` only immediately after an identifier/member chain, no whitespace. `!=` wins by maximal munch. `not` is the only logical negation. |
| `\|` vs `\|\|` | maximal munch; single `\|` is pipe |
| Newlines | statement terminators; runs of blank/comment-only lines collapse into ONE `NEWLINE` token. `\r` is whitespace. EOF terminates a final statement. |
| Escapes | `\n \t \r \\ \"`; inside f-string text also `\{ \}` |
| Grouping | newlines are skipped inside `(...)`, `[...]`, `{...}` object literals and f-string interpolations (parser `groupDepth`), NOT inside block braces |

### 2.4 Grammar (EBNF, core spec §4)

```ebnf
Program         ::= Pragma? NeedsDecl* Statement*
Pragma          ::= "#!" IDENTIFIER NEWLINE            (* only physical line 1 *)
NeedsDecl       ::= "needs" CapabilityList NEWLINE
CapabilityList  ::= CapabilityToken ("," CapabilityToken)*
CapabilityToken ::= FsReadCap | FsWriteCap | NetCap | ExecCap | EnvCap | OnlyCap
FsReadCap       ::= "fs" "." "read"  "(" STRING ")"
FsWriteCap      ::= "fs" "." "write" "(" STRING ")"
NetCap          ::= "net"  "(" STRING ")"
ExecCap         ::= "exec" "(" STRING ")"
EnvCap          ::= "env"  "(" IDENTIFIER "?"? ")"
OnlyCap         ::= "only" "(" CapabilityToken ")"    (* no nesting *)

Statement       ::= LetStmt | FnDecl | IfStmt | WhileStmt | ForStmt
                  | ReturnStmt | ExprStmt | NeedsDecl            (* last only in the 2 legal spots *)
LetStmt         ::= "let" IDENTIFIER "=" Expr NEWLINE
FnDecl          ::= "fn" IDENTIFIER "(" ParamList? ")" NeedsDecl? Block
Block           ::= "{" Statement* "}"
IfStmt          ::= "if" Expr Block ("else" (IfStmt | Block))?
WhileStmt       ::= "while" Expr Block
ForStmt         ::= "for" IDENTIFIER "in" Expr Block
ReturnStmt      ::= "return" Expr? NEWLINE
ExprStmt        ::= Expr NEWLINE

Expr            ::= AssignExpr
AssignExpr      ::= IDENTIFIER "=" AssignExpr | PipeExpr     (* lowest, right-assoc, bare ident target *)
PipeExpr        ::= OrExpr ("|" OrExpr)*                     (* flat stages, never nested *)
OrExpr          ::= AndExpr ("||" AndExpr)*
AndExpr         ::= EqExpr ("&&" EqExpr)*
EqExpr          ::= RelExpr (("==" | "!=") RelExpr)*
RelExpr         ::= AddExpr (("<" | ">" | "<=" | ">=") AddExpr)*
AddExpr         ::= MulExpr (("+" | "-") MulExpr)*
MulExpr         ::= UnaryExpr (("*" | "/") UnaryExpr)*
UnaryExpr       ::= ("not" | "-") UnaryExpr | Postfix
Postfix         ::= Primary { MemberAccess | Call | BangCall }
Primary         ::= IDENTIFIER | Literal | FStringExpr | ArrayLiteral | ObjectLiteral | "(" Expr ")"
ArrayLiteral    ::= "[" (Expr ("," Expr)*)? "]"
ObjectLiteral   ::= "{" (IDENTIFIER ":" Expr ("," IDENTIFIER ":" Expr)*)? "}"
FStringExpr     ::= 'f"' (CHAR | "{" Expr "}")* '"'
```

Placement rules you must respect:

- `needs` is legal **only** (a) top-level before the first non-`needs` statement, or (b) as
  the clause immediately after a `FnDecl` parameter list. Elsewhere → `E202`.
- A `!(...)` suffix requires that everything before it in the postfix chain is a bare
  identifier followed by zero or more `.identifier` accesses. Otherwise `E205`. This makes
  `BangCall.target` a compile-time dotted string — the LSP depends on this for capability
  features and completion.
- `only(only(...))` → `E204`. Duplicate fn params → `E206`.

### 2.5 Semantics that LSP features depend on

- **Scope model (mirror exactly — core `evaluator/interpreter.ts`):**
  - Program scope is seeded with builtin globals (`json`, a native namespace; future globals
    possible) and holds top-level `let`/`fn` bindings.
  - `fn` creates a scope containing its **parameters**; the function body executes directly
    in that same scope (so `fn f(x) { let x = 1 }` is a same-scope redeclaration, `E506`).
    The fn name binding is created in the *enclosing* scope before the body ever runs, so
    recursion works.
  - `if` consequent/alternate bodies, `while` bodies: a fresh child scope per execution
    (per loop iteration for `while`).
  - `for` creates a loop scope containing the **iterator**, and the body runs in a child of
    that per iteration.
  - `let` evaluates its initializer in the *current* scope **before** defining the name
    (`let x = x` reads an outer `x`, or is `E500`).
  - Assignment `x = v` writes the **nearest enclosing scope** that declares `x`; if none,
    `E500`. Assignment is legal on parameters and builtin globals (e.g. `json = 1`).
  - Same-scope redeclaration of `let`/`fn` (including `let` colliding with the `json`
    builtin) is `E506`. Inner-scope shadowing is legal.
  - **Use-before-declaration is not an error in general** (closures look up names at call
    time, and a later `let` in the same scope may exist by then). Only *unresolvable* names
    are `E500`. Do not flag "used before let".
  - Effectful names (`fs.readFile`, `curl`, `print`, …) are **never bound** in any scope.
    They are reachable only through `BangCall`, whose `target` is a string in the AST (not an
    `Identifier`), so the binder never sees them as variable references.
- **Values/types (for hover/completion only):** `null | boolean | number | string | array |
  object | function`. `json.parse` returns `unknown`. `curl!` returns
  `{ status: number, body: string }`.
- **Truthiness:** `false`, `null`, `0`, `""` are falsy; everything else (including `[]`,
  `{}`) is truthy.
- **Pipes (core spec §5):** bare stage (`f` or `obj.f`) receives the value as its **sole**
  argument; a stage with an explicit arg list (`f(a)` / `x!()`) receives it **prepended** as
  argument 0. Chains are flat.
- **`#!strict` (pragma):** enables a pipe-chain type pre-pass. Types: string/number/boolean/
  null/array/object/unknown; `unknown` is never a rejection. `E505` on a definite mismatch.
  `E501` covers definite runtime type errors elsewhere (e.g. `1 + "a"`).
- **Capabilities:**
  - `needs` tokens grant: `fs.read(glob)`, `fs.write(glob)`, `net(host|*.host)`, `exec(glob)`,
    `env(NAME?)`; `only(...)` unwraps in a fn's clause.
  - Glob syntax is tiny: `*` within a path segment, `**` as a whole segment crosses `/`,
    bare `*`/`**` → `E305`; malformed `**` usage / empty → `E302`.
  - `net` is exact host or single-leading-label wildcard `*.example.com` (never bare `*`).
  - A literal-argument bang call not covered by in-scope `needs` → `E301`. A non-literal
    argument or a piped bang stage → recorded as *deferred to runtime* (not an error).
  - A child fn's `needs only(...)` may only attenuate (⊆) the enclosing manifest → `E303`
    otherwise. A fn with no `needs` inherits the enclosing manifest unchanged.
  - `print!` / `eprint!` are ambient: always authorized, never in a manifest, no `needs`
    required.
  - Effectful registry (core `BANG_REGISTRY`): `fs.readFile`→fsRead, `fs.writeFile`→fsWrite,
    `curl`→net. Ambient: `print`, `eprint`. Pure: `json.parse`.
- **Runtime errors (`E4xx` guard, `E5xx` eval)** are **not** statically knowable in general;
  LSP reports only the definitely-certain subset (see §6.5).

### 2.6 Error catalog (all codes the LSP can see; core spec §9.2)

| Code | Meaning | LSP handling |
|---|---|---|
| `E101` | Unterminated string / f-string | diagnostic + quick fix "insert closing `\"`" |
| `E102` | Unterminated f-string `{` interpolation | diagnostic |
| `E103` | Invalid escape | diagnostic |
| `E104` | Unexpected character / misplaced `!` | diagnostic (+ quick fix for space-before-`!`) |
| `E105` | Invalid pragma placement | diagnostic |
| `E106` | Malformed number | diagnostic |
| `E201` | Unexpected token | diagnostic |
| `E202` | `needs` not at top | diagnostic |
| `E203` | Unterminated block | diagnostic + quick fix "insert `}` at EOF" |
| `E204` | Invalid capability token | diagnostic |
| `E205` | Invalid bang-call target | diagnostic |
| `E206` | Duplicate parameter | diagnostic |
| `E301` | Uncovered capability (literal) | diagnostic + quick fix "add `needs`" |
| `E302` | Invalid glob | diagnostic |
| `E303` | Attenuation escalation | diagnostic (+ optional "use parent grant" fix) |
| `E304` | Extractor unhandled node (internal) | diagnostic, severity Error, log |
| `E305` | Over-privileged wildcard | diagnostic |
| `E401`–`E407` | Guard runtime denials | never as diagnostics; hover/code lens info |
| `E500` | Unbound variable / assignment target | diagnostic (unknown name only) |
| `E501` | Type mismatch | diagnostic only when statically certain |
| `E502` | Not callable | diagnostic only when statically certain |
| `E503` | Arity mismatch | diagnostic when callee + arity are statically known |
| `E504` | Division by zero | diagnostic when both operands are literal |
| `E505` | Strict pipe type error | diagnostic via core's strict collector |
| `E506` | Same-scope redeclaration | diagnostic + quick fix "rename" |

---

## 3. Hard Constraints & Security Posture

1. **No execution.** The LSP imports only pure core modules. Banned imports (enforced by
   ESLint `no-restricted-imports`, see §4.4): `placitum/evaluator*`, `placitum/stdlib*`,
   `placitum/host-bindings*`, `placitum/capability/guard*`, and any deep import into the
   `placitum` package (`placitum/*`) other than the root barrel.
2. **No OS/network primitives** in feature code: `child_process`, `net`, `http`, `https`,
   `os`, `dgram`, `tls` are banned server-wide. `node:fs` is allowed **only** in
   `src/workspace/files.ts` (reading workspace files for workspace symbols) and
   `src/log.ts` (log file). Direct writes to user files are banned; edits go through
   `WorkspaceEdit`.
3. **Treat file contents as untrusted text.** Never `eval`, never `require(userInput)`,
   never shell out. A malicious `.placitum` file must only ever produce diagnostics.
4. **stdout purity.** Enforce with a test that spawns the built server, drives it, and
   asserts every stdout line is a valid `Content-Length`-framed JSON-RPC message.
5. **Fail closed, never crash.** Any unexpected exception in a handler is caught, logged to
   stderr/`console`, and returned as a JSON-RPC error (or a `window/showMessage` for async
   diagnostics). One bad file must never take the server down.
6. **No telemetry, no network calls, no analytics.**
7. **Capability transparency is a first-class feature, not a decoration.** The server's
   capability features (hover/code lens/manifest request) must always reflect the *extractor's*
   output, never a re-derived approximation, whenever the file parses cleanly.

---

## 4. Repository Layout, Stack & Dependencies

### 4.1 Stack

- TypeScript strict (copy the core repo's `tsconfig.json` including
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- Node.js `>=20` (`engines`), ESM (`"type": "module"`), built with plain `tsc`.
- `vscode-languageserver` + `vscode-languageserver-textdocument` (protocol + document sync).
  These are the reference implementation of LSP; do not hand-roll JSON-RPC framing.
- `vitest` for tests.
- No bundler required for the server; the VS Code teammate bundles with their own tooling.

### 4.2 Layout

```
placitum-lsp/
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── src/
│   ├── bin.ts                  # #!/usr/bin/env node — CLI flags, then startServer()
│   ├── server.ts               # connection, onInitialize, capability wiring
│   ├── documents.ts            # TextDocument map, change events, analysis cache, debounce
│   ├── config.ts               # settings resolution + defaults (workspace/configuration)
│   ├── log.ts                  # stderr/file logging, trace levels
│   ├── workspace/
│   │   └── files.ts            # the ONLY fs reader: workspace .placitum scan, watch refresh
│   ├── analysis/
│   │   ├── core-adapter.ts     # the ONLY importer of `placitum` — frozen adapter surface
│   │   ├── positions.ts        # span/line/col <-> Position/Range (UTF-16), clamping
│   │   ├── comments.ts         # comment trivia from source + tolerant token gaps
│   │   ├── binder.ts           # scopes, bindings, occurrences (mirrors §2.5)
│   │   ├── types.ts            # TypeInfo + inference (mirrors core inferType)
│   │   ├── checks.ts           # definitely-certain static E5xx checks
│   │   ├── capabilities.ts     # effective grants, deferred checks, coverage queries
│   │   └── model.ts            # Analysis { program, manifest, binder, types, diagnostics… }
│   └── features/
│       ├── diagnostics.ts  hover.ts  completion.ts  signature.ts
│       ├── definition.ts   references.ts  rename.ts  symbols.ts
│       ├── semantic-tokens.ts  folding.ts  selection.ts  highlights.ts
│       ├── code-actions.ts  code-lens.ts  inlay-hints.ts  manifest-command.ts
├── editors/                    # ready-to-copy client recipes (§8)
│   ├── neovim/  helix/  emacs/  zed/  sublime/  vim/  kate/
├── tests/
│   ├── unit/                   # binder, positions, types, checks, comments
│   ├── protocol/               # in-process JSON-RPC client harness + fixtures
│   ├── fixtures/               # *.placitum inputs + expected result JSON
│   └── e2e/                    # real server spawn, stdout purity, editor scripts
└── docs/
    ├── VSCODE-HANDOFF.md       # teammate spec (§9)
    └── BLOCKED.md              # only if a contradiction is hit
```

### 4.3 Dependency allow-list

| Package | Scope | Rationale |
|---|---|---|
| `vscode-languageserver` | runtime | Protocol types, connection, framing. |
| `vscode-languageserver-textdocument` | runtime | LSP text documents + `positionAt`/`offsetAt`. |
| `placitum` | runtime | The core language, pinned to a commit SHA (§5.4). |
| `typescript` | dev | Compiler. |
| `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` | dev | Same versions as core (eslint 8.57.1, ts-eslint ^7). |
| `vitest` | dev | Tests. |
| `@types/node` | dev | Node types. |
| `tsx` | dev | Scripts/iteration, same as core. |

**Banned** (same reasoning as core §8.3): any JSON-RPC/LSP alternative, any glob library,
any HTTP client, `lodash`/`ramda`, `fs-extra`, bundlers (unless a benchmark proves startup
matters; then discuss first), tree-sitter packages (separate deliverable). Add a
`scripts/check-deps.mjs` copied from core, with this allow-list.

### 4.4 ESLint import boundary (server-specific)

Copy core's config and add/override:

```jsonc
{
  "rules": {
    "no-restricted-imports": ["error", { "patterns": [
      { "group": ["child_process", "node:child_process"],
        "message": "The language server never spawns processes." },
      { "group": ["net", "node:net", "http", "node:http", "https", "node:https", "os", "node:os", "dgram", "node:dgram", "tls", "node:tls"],
        "message": "The language server makes no network/OS calls." },
      { "group": ["placitum/*"],
        "message": "Import the core only through the root barrel (`placitum`), via src/analysis/core-adapter.ts." },
      { "group": ["placitum/dist/*"],
        "message": "Never deep-import core internals; use the public API (see directive §5)." }
    ]}
  },
  "overrides": [
    { "files": ["src/workspace/files.ts", "src/log.ts"],
      "rules": { "no-restricted-imports": ["error", { "patterns": [
        { "group": ["child_process", "node:child_process", "net", "node:net", "http", "node:http", "https", "node:https", "os", "node:os", "dgram", "node:dgram", "tls", "node:tls"], "message": "No process/network/OS access." }
      ]}]}},
    { "files": ["src/analysis/core-adapter.ts"], "rules": { "no-restricted-imports": "off" } }
  ]
}
```

The `core-adapter.ts` exception exists only so a future core-version fallback is one file.

---

## 5. Phase 0 — Core Repository Contract (blocking prerequisite)

The LSP repo depends on `quesadx/pl-lg`. The core originally had no `exports` map, no
barrel, and analysis functions that throw on the first error. **Status (2026-09-21):
implemented on the core `dev` branch** — §5.1–5.3 below now describe the shipped API
(and the tests that pin it). The remaining step for the LSP repo is §5.4: pin the exact
commit SHA. The fallback paragraph at the end of this section no longer applies.

### 5.1 Mandatory: public barrel + package exports (core repo)

`src/index.ts` re-exports (names match this spec; `isCallable`/`Value`/`CallableValue`/
`PlacitumErrorInit`/`ErrorSource`/`GlobPattern`/`ExecPattern`/`EnvRequirement`/
`SerializedGlobPattern`/`BangFn`/`Stdlib` and the tolerant-mode types `lexTolerant`,
`parseTolerant`, `TolerantLexResult`, `TolerantParseResult`, `AnalysisResult`,
`CommentTrivia` are exported in addition):

```ts
// pipeline (pure, throws on first error — v1.0 behavior)
export { lex } from './lexer/lexer.js';
export { parse } from './parser/parser.js';
export { extract, BANG_REGISTRY } from './capability/extractor.js';
export { explain } from './cli/explain.js';
export { formatError } from './cli/format-error.js';

// types
export type { Token, TokenKind } from './lexer/lexer.js';
export type { EffectCategory } from './capability/extractor.js';
export type { Program, Expr, Statement, /* … all ASTNode types … */ } from './ast/ast.js';
export type { NativeSig, TypeName } from './shared/values.js';
export type { SerializedManifest, CapabilityManifest, HostPattern, DeferredCheck } from './shared/manifest.js';
export type { PlacitumError } from './shared/error-schema.js';

// data / tables the LSP needs for completion, hover, capability UX
export { SerializedCapabilityManifestSchema, compileManifest } from './shared/manifest.js';
export { globToRegex, globCovers, hostToRegex } from './shared/glob-to-regex.js';
export { AMBIENT_BANGS, EFFECTFUL_STDLIB, BANG_SIGNATURES, PURE_SIGNATURES } from './stdlib/stdlib.js';
export { display, typeName, truthy, deepEquals } from './shared/values.js';

// errors
export { PlacitumErrorBase, LexError, ParseError, ExtractError, EvalError, CapabilityViolationError, CliError } from './shared/errors.js';
export { PlacitumErrorSchema } from './shared/error-schema.js';
```

`stdlib.ts` is safe to import: its `Guard`/`HostBindings` references are type-only and its
effectful functions require an injected guard; it performs no I/O at module load. Verify
this in the core PR with a Node smoke test that imports the barrel in a context where `fs`
is unavailable (reuse the repo's existing `tests/helpers/vm-sandbox.ts` machinery).

Also in `package.json`:

```jsonc
{
  "private": true,
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": { "prepare": "npm run build" }
}
```

`prepare` makes git-dependency installs build automatically. Keep `private: true`; install
via git + commit SHA. (If the user later publishes to npm, nothing in the LSP changes except
the version specifier.)

### 5.2 Mandatory: `analyzeSource` (single-error acceptable, tolerant preferred)

Add `src/analysis/analyze.ts`:

```ts
export interface AnalysisResult {
  program: Program | null;            // recovered AST when lexing is clean; null otherwise
  manifest: SerializedManifest | null;// non-null iff diagnostics is empty (extract succeeded)
  diagnostics: PlacitumError[];       // every error found, in source order
  tokens: Token[];                    // tolerant token stream (partial on lexical errors)
  comments: CommentTrivia[];          // trivia spans, collected by the lexer
  complete: boolean;                  // diagnostics.length === 0
}

export interface CommentTrivia { span: readonly [number, number]; } // defined in lexer/lexer.ts

export function analyzeSource(source: string): AnalysisResult;
```

Implemented behavior (tolerant — never throws on malformed input):

- The lexer records diagnostics and advances deterministically: E101/E102 close the
  literal at the current position, E103 skips the invalid escape pair, E104/E105/E106
  skip the offending characters/token. Every recovery path guarantees `pos` advanced.
- A lex error skips parsing entirely (`program: null`): the partial token stream is still
  returned for semantic tokens/completion, but no AST-based feature runs on it.
- A parse error (E201–E206) is recorded and the parser **panic-syncs**: skip tokens until
  `NEWLINE` (consumed), `RBRACE` or `EOF` (left for the enclosing loop). The failed
  statement is dropped and parsing continues at the next one; `E203` synthesizes the
  missing close at EOF so the enclosing statement can finish. `groupDepth` resets during
  resync, restoring NEWLINE statement termination.
- `extract()` runs **only** when zero lex/parse diagnostics were recorded (recovered ASTs
  must not produce cascading capability errors).
- `lex()` / `parse()` keep the strict fail-on-first-error contract byte-for-byte
  (existing goldens and negatives are unchanged); tolerant behavior lives in
  `lexTolerant()` / `parseTolerant()`.
- Tests: `tests/analysis/analyze.test.ts` (two syntax errors both reported; extract error
  after a clean parse; tokens non-empty despite a lex error; E102/E203 recovery; comment
  trivia; `complete` semantics) and `tests/analysis/barrel-purity.test.ts` (vm sandbox:
  importing the barrel drags no I/O).

### 5.3 Mandatory: strict-pipe diagnostics collector + type inference export

Implemented in `src/analysis/strict.ts` (moved verbatim out of `evaluator/interpreter.ts`
so the barrel's import closure excludes the evaluator):

```ts
export function collectStrictDiagnostics(program: Program): EvalError[];
export function inferType(expr: Expr): TypeName;         // exact prior semantics
export function calleeSignature(callee: Expr): NativeSig | null;
```

- The `#!strict` gate lives **inside** `collectStrictDiagnostics` (no pragma → `[]`), so
  no caller can forget it.
- `evaluate()` calls the collector and throws its first error before any statement runs,
  preserving the Phase 5 gate (`tests/eval/chokepoint.test.ts` proves no side effect runs).
- Tests: `tests/analysis/strict.test.ts` pins the E505 code/location, multiple broken
  chains, the no-pragma and well-typed cases, plus `inferType`/`calleeSignature`.

### 5.4 Version pinning

After the core PR merges to `main`:

1. Create a tag, e.g. `lsp-v1` (or use the merge commit SHA; SHA is preferred for
   reproducibility).
2. In the LSP repo: `npm i "placitum@git+https://github.com/quesadx/pl-lg.git#<sha>"`.
3. Record the SHA in `package.json` **and** in `docs/CORE-VERSION.md` with the four API
   items this document requires (barrel, `analyzeSource`, `collectStrictDiagnostics`/
   `inferType`, `package.json` exports).
4. `core-adapter.ts` holds every core call behind small typed wrappers and a
   `CORE_API_VERSION` constant. If a future core changes an API, only this file changes.

The earlier fallback (single-error diagnostics, LSP-side re-implementation of the strict
collector) is **obsolete**: the tolerant core API shipped. `core-adapter.ts` must not
re-implement any core logic — every capability/diagnostic/type answer comes from the
barrel. **Do not** duplicate the lexer, parser, or the strict collector in the LSP repo.

---

## 6. Analysis Engine

Everything a feature needs hangs off one `Analysis` object per document version.

### 6.1 Pipeline

```
didOpen/didChange/didClose
        │
        ▼
documents.ts: update TextDocument (incremental), bump version
        │
        ▼
core-adapter.analyze(source)
        ├── diagnostics: PlacitumError[]
        ├── tokens + comments (or [] / computed in LSP)
        └── program/manifest (only when complete)
        │
        ▼
binder.ts      -> scopes, bindings, occurrences           (needs tokens or a source walk)
types.ts       -> TypeInfo per expression/binding         (needs program)
checks.ts      -> static E5xx diagnostics                 (needs program)
capabilities.ts-> grants per scope, deferred checks       (needs manifest)
        │
        ▼
Analysis { version, text, parse, tokens, comments, binder, types, manifest, diagnostics }
        │
        ▼
features/*   (all functions are pure: Analysis + Position -> LSP result)
```

Re-analysis is synchronous and fast (< 5 ms for typical files). Cache the latest `Analysis`
per URI; invalidate on change. Debounce `publishDiagnostics` by ~80 ms and cancel pending
work on the next change (a `setTimeout` handle is enough — no worker threads).

### 6.2 Positions and ranges (`positions.ts`)

- Use `TextDocument.positionAt(offset)` / `offsetAt(position)` from
  `vscode-languageserver-textdocument`. The package's default encoding is UTF-16, matching
  core spans. Advertise `positionEncoding: "utf-16"` in `initialize` (clients must honor a
  server-declared encoding; if a client still requests `utf-8`, fall back to a documented
  conversion in this module only).
- Convert every core location: `Range(start = positionAt(span[0]), end = span[1] !==
  undefined ? positionAt(span[1]) : positionAt(offset of line/col + 1))`. When `span` is
  absent, build a 1-code-unit range at `(line-1, col-1)`.
- **Clamp everything**: `line`/`col` beyond EOF, negative offsets, `span[1] <= span[0]`,
  offsets inside a CRLF pair. Diagnostics must never fail diagnostics; on any inconsistent
  input return a zero-width range at the clamped position.
- Core `line` is 1-based and `col` is 1-based UTF-16; always subtract one. Do the conversion
  in exactly one module and never inline arithmetic in features.

### 6.3 Binder (`binder.ts`) — mirror §2.5 exactly

Data model:

```ts
type ScopeKind = 'program' | 'fn' | 'block' | 'for-loop';
interface Scope { id: number; kind: ScopeKind; parent: number | null; span: [number, number];
                  bindings: Map<string, Binding>; declarations: Binding[]; }
interface Binding { id: number; name: string; kind: 'let' | 'fn' | 'param' | 'iterator' | 'builtin';
                    scope: number; declSpan: [number, number]; nameSpan: [number, number];
                    node: LetStmt | FnDecl | Param | ForStmt | null; type: TypeInfo; }
interface Occurrence { span: [number, number]; binding: number; mode: 'read' | 'write'; }
interface BinderResult { scopes: Scope[]; bindings: Binding[]; occurrences: Occurrence[];
                         diagnostics: { code: 'E500' | 'E506'; span: [number, number]; message: string; hint: string }[] }
```

Algorithm (walk the AST, not the token stream):

1. Create the program scope; seed `json` as a `builtin` binding with `type: { kind: 'namespace' }`.
2. `LetStmt`: walk `init` **in the current scope first**, then define `id` in the current
   scope; if the name already exists in that scope (including `json`) → record `E506`.
3. `FnDecl`: define `id` in the current scope before walking the body (recursion, and E506 on
   duplicates). Create a child `fn` scope; define params there; walk the body in that scope.
   Record each param as a binding and each identifier use of it as an occurrence.
4. `IfStmt`: walk test in current; walk consequent/alternate each in a fresh child scope.
   `WhileStmt`: same per body. `ForStmt`: walk iterable in current; create a `for-loop` scope
   with the iterator binding; walk body in a child of that.
5. `Identifier` (expression position): resolve up the scope chain; if none → `E500`
   diagnostic at the identifier span; else record a read occurrence.
6. `AssignExpr`: walk `value`; resolve `id` up the chain; if none → `E500`; else record a
   **write** occurrence. Do not `let`-check rebinding.
7. `MemberExpr` properties, object keys, bang targets, and capability tokens create **no**
   bindings/occurrences. `BangCall.target` is a string: resolve its first segment only if it
   exists in scope (user object with methods); mark occurrences for those segments; never
   report `E500` for an unresolved bang target (it may be a stdlib effect name).
8. F-string interpolations are expressions — walk them.
9. Same-scope duplicate `let`/`fn` pairs and builtin collisions → `E506`. Everything else
   shadowing → legal.

Consistency tests: for each existing core eval-negative fixture that exercises `E500`/`E506`,
assert the binder produces the same code at the same location (copy those small fixtures in
`tests/fixtures/binder/`; do not copy the whole core corpus).

### 6.4 Types (`types.ts`)

Mirror core `inferType` plus object shapes:

```ts
type TypeInfo =
  | { kind: 'unknown' }
  | { kind: 'null' } | { kind: 'boolean' } | { kind: 'number' } | { kind: 'string' }
  | { kind: 'array'; element: TypeInfo }
  | { kind: 'object'; properties: Map<string, TypeInfo> }   // from object literals
  | { kind: 'function'; signature: NativeSig | { params: string[] } | null }
  | { kind: 'namespace'; members: Map<string, TypeInfo> };  // `json`
```

Rules:

- Literals → their types; f-string → string; array literal → array with best-effort element
  type (`unknown` if mixed); object literal → object with property types.
- `let` binding type = type of its initializer (types are per-binding, not flow-sensitive;
  assignments do not widen/narrow in v1 — mark with a `ponytail:` comment).
- `json.parse` → unknown. `curl!` → `{status: number, body: string}` (hard-code from the
  documented stdlib shape). `print!`/`eprint!` → null. Other bangs/pure calls from
  `BANG_SIGNATURES`/`PURE_SIGNATURES` (use core's `calleeSignature` when exported).
- Binary/unary per core `inferType`; member access on an object with a known property →
  that type, otherwise (or missing property) → `null` (runtime reads missing members as
  `null`); member on unknown → unknown; member on scalar/array → `null` (runtime would throw
  `E501`, but only report when the receiver is a literal per §6.5).
- Pipe: desugar per §2.5 and type the result as the last stage's result.
- Unknown propagates and is never used to report errors.

Used by hover, inlay hints, member completion, and pipe-stage completion ranking.

### 6.5 Definitely-certain static checks (`checks.ts`)

Only report what is provably an error under every execution path. Default severity `Error`
for each. If a construct is only *sometimes* wrong, stay silent. Rules (all gated on a
complete parse):

| Code | Rule |
|---|---|
| `E500` | From the binder's unresolved names (§6.3). |
| `E506` | From the binder's same-scope redeclarations. |
| `E505` | `#!strict` only: `collectStrictDiagnostics(program)` from core, mapped 1:1. |
| `E501` | Binary `+` with two literal operands of incompatible types; arithmetic/relational operators with literal non-number operands; unary `-` on a literal non-number; member access on a literal scalar (`"x".y`, `(1).z`, `[1].x`); `json.parse(literal non-string)`; a `for` whose iterable is a literal non-array. |
| `E502` | Call/pipe-stage callee is a literal or an array/object literal, or a binding whose inferred type is definitely a non-function value from a literal initializer. |
| `E503` | Callee is a user `fn` visible in scope (exact param count known) or a stdlib signature; arg count differs — **except** pipe stages, where arg 0 is prepended (account for desugaring). |
| `E504` | `/` with literal `0` divisor on the right. |

Everything else in `E5xx`/`E4xx` stays runtime-only. Mark speculative rules behind config
keys (all default `true` except inlay hints) so users can silence them:

```jsonc
"placitum.diagnostics.scope": true,
"placitum.diagnostics.strictChecks": true,
"placitum.diagnostics.literalTypes": true
```

### 6.6 Capability model (`capabilities.ts`)

Given a complete parse + manifest:

- `effectiveManifestAt(span)`: walk the AST path to the innermost enclosing `FnDecl`; if it
  has a `needs` clause, that fn's entry in `manifest.scoped` is effective; otherwise the
  top-level manifest. (Attenuation means child ⊆ parent, so the top-level is always a
  superset.)
- `describeBang(bangCall)`: category via `BANG_REGISTRY`; whether the call was statically
  covered, deferred (look up `manifest.deferredToRuntime` by `nodeSpan`), or ambient.
- `coverageGrants(category)`: the raw patterns from the effective manifest.
- `enclosingNeedsDecl(span)`: the top-level `NeedsDecl` node, if any (for insertion).

These power hover, code lens, code actions, inlay hints, and the manifest request. Never
re-derive patterns — read the extractor's output.

For a file that parses but fails extraction: the E3xx error is a diagnostic; capability
queries fall back to a conservative "unknown" answer rather than crashing.

---

## 7. LSP Surface — Method by Method

All handlers are registered in `server.ts`. Every feature function takes
`(analysis: Analysis, params) => result` and is unit-testable without a connection.

### 7.1 Initialize and capabilities

Response example (this exact shape is the contract):

```jsonc
{
  "capabilities": {
    "positionEncoding": "utf-16",
    "textDocumentSync": { "openClose": true, "change": 2, "save": { "includeText": false } },
    "completionProvider": { "triggerCharacters": [".", "|", " "], "resolveProvider": false },
    "hoverProvider": true,
    "signatureHelpProvider": { "triggerCharacters": ["(", ","] },
    "definitionProvider": true,
    "typeDefinitionProvider": true,
    "referencesProvider": true,
    "renameProvider": { "prepareProvider": true },
    "documentSymbolProvider": true,
    "workspaceSymbolProvider": true,
    "documentHighlightProvider": true,
    "foldingRangeProvider": true,
    "selectionRangeProvider": true,
    "codeActionProvider": { "codeActionKinds": ["quickfix"], "resolveProvider": false },
    "codeLensProvider": { "resolveProvider": false },
    "inlayHintProvider": { "resolveProvider": false },
    "semanticTokensProvider": {
      "legend": {
        "tokenTypes": ["namespace","variable","parameter","property","function","keyword","comment","string","number","operator","macro"],
        "tokenModifiers": ["declaration","readonly","defaultLibrary","modification"]
      },
      "full": true
    },
    "executeCommandProvider": { "commands": ["placitum.showManifest", "placitum.reanalyze", "placitum.addNeeds"] }
  },
  "serverInfo": { "name": "placitum-lsp", "version": "<package version>" }
}
```

Also handle: `initialized`, `shutdown` → `null`, `exit` → exit code 0 after shutdown, 1
otherwise. Accept settings from `initializationOptions.placitum` and from
`workspace/configuration` under section `placitum`; merge over defaults; react to
`workspace/didChangeConfiguration`.

`completionProvider.triggerCharacters` includes `" "` deliberately: after `needs ` the user
expects capability starters. A space trigger can feel noisy in some clients; if so, drop it
and rely on manual invocation (mark the decision in the code with a `ponytail:` comment).

### 7.2 Documents and diagnostics

- `textDocument/didOpen|didChange|didClose`: maintain `TextDocument`s. Re-analyze on open and
  change; publish `[]` on close (if `clientCapabilities.textDocument.publishDiagnostics`
  allows; otherwise just drop state).
- Diagnostics mapping:
  - `range`: from §6.2.
  - `severity`: Error for all `E1xx`–`E5xx` diagnostics; Warning only if a future check is
    heuristic (none in v1).
  - `code`: the full envelope code string (e.g. `E301_EXTRACT_UNCOVERED_CAPABILITY`).
  - `source`: `"placitum"`.
  - `message`: `err.message`, with `\n\nhint: ${err.hint}` appended when a hint exists.
  - `data`: `{ phase, hint, quickFixes: string[] }` (quick-fix tags for code actions;
    `data` is opaque to clients).
  - `relatedInformation`: for `E506`, the earlier declaration's location; for `E303`, the
    enclosing scope's covering grants are described in the message, not as related info.
- Do not publish capability *information* diagnostics for deferred checks (noise); those
  live in hover/code lens.
- `textDocument/didSave`: re-analyze (no text needed).
- Register a file watcher for `**/*.placitum` on `initialized` **only** if the client
  supports dynamic registration; on `workspace/didChangeWatchedFiles` invalidate the
  workspace-symbol cache.

### 7.3 Completion (`completion.ts`)

Context classification at the cursor, then candidate sets. A context is determined from the
tolerant token stream plus binder results; when in doubt, prefer the general context.

| Context | Detection | Candidates |
|---|---|---|
| Pragma | Line 1, after `#!` | `strict` (kind `Keyword`) |
| `needs` statement | Inside a `NeedsDecl` region (start after `needs`, up to line end) | capability starters: `fs.read(`, `fs.write(`, `net(`, `exec(`, `env(`, `only(` as snippets; existing capability strings already in the file |
| After `fs.` inside `needs` | previous two tokens `IDENTIFIER fs` `DOT` | `read`, `write` |
| After `only(` | token context | the enclosing scope's granted tokens (e.g. `net("api.example.com")`) so attenuation is a pick-list |
| After `env(` | token context | names already declared in any `env(...)` token of the file |
| Member access | previous token `DOT`, preceded by an expression | `json` → `parse`; object binding with known shape → its keys; `curl!` result binding → `status`, `body`; otherwise no candidates (do not guess) |
| Pipe stage | previous non-space token is `PIPE` | user fns (visible in scope), pure stdlib refs (`json.parse`), bang stages whose first parameter accepts the produced type when inferable (rank matched first via `sortText`) |
| General | everything else | in-scope bindings (kind Variable/Parameter/Function by binding kind), user fns as snippets `name(${1})`, effectful stdlib snippets `fs.readFile!(${1})`, `fs.writeFile!(${1}, ${2})`, `curl!(${1})`, ambient `print!`, `eprint!`, pure `json.parse`, keywords legal at statement position (`let`, `fn`, `if`, `while`, `for`, `return`, `needs`), snippets for `if`, `while`, `for`, `fn`, `needs` |

Details:

- Labels must not include the `!` in the identifier part for filter matching, but
  `insertText` should (`fs.readFile!(${1})`). Use `insertTextFormat.Snippet`; set
  `filterText` to `fs.readFile` so typing `fs.read` matches.
- `detail`: `"capability-aware"` for effectful names, `"pure"` for `json.parse`.
- `documentation` (markdown if supported): one-liner + required `needs` category for
  effectful names (`Requires: net(...)`), and the signature.
- `sortText`: `0` for exact-prefix matches, `1` for locals, `2` for builtins/keywords, `3`
  for snippets. Keep deterministic.
- Never edit other text implicitly; only insert at the cursor (`textEdit` with a range that
  replaces the partial identifier if the client can compute one — use `textEdit` start =
  start of current identifier token, end = cursor).
- Completion inside strings → none. Inside comments → none. Inside f-string literal chunks →
  none; inside f-string interpolations → general context.
- If the file has lex errors, completion still works from the tolerant token stream; if no
  tokens exist at all, return keywords + stdlib + snippets only (a fully broken file still
  deserves basic help).

### 7.4 Hover (`hover.ts`)

Return `MarkupContent` (markdown when supported, else plain text). Cases:

| Cursor on | Content |
|---|---|
| Binding reference / declaration | `**let** \`name\`: \`<inferred type or unknown>\`` + the declaration's source line in a code block. For `fn`: signature `fn name(p1, p2)` and, if it has one, `needs only(...)` summary (the fn's effective grants). |
| Builtin `json` | namespace doc: `json.parse(string) -> unknown`. |
| `MemberExpr` property | on `json`: signature; on known object shape: `property: type`; else nothing. |
| Bang call target (range covers `fs.readFile` or the whole `fs.readFile!(...)`) | category, required grant surface, and status: `statically covered by needs net("api.example.com")` / `deferred to runtime (argument is not a compile-time string literal)` / `ambient (no needs required)`. Include the relevant `needs` token(s) as code. |
| Capability token inside `needs` | one-paragraph explanation of the capability category (fs.read/fs.write/net/exec/env/only), plus whether it is used by any bang call in the file (compute from the AST: literal calls covered by it) and, for `only(...)`, the parent's covering token(s). |
| Keyword | one-line doc (table in `hover.ts`; keep it short). |
| `#!strict` pragma | explains the strict pre-pass. |
| Otherwise | `null`. |

Hover ranges: the exact token/span under the cursor (use the AST node span when available,
else the token span). Never return a range that exceeds the line.

### 7.5 Signature help (`signature.ts`)

- On `(` or `,`, find the innermost argument list containing the cursor by scanning tokens
  with a delimiter/grouping stack (respecting strings/f-strings/comments). Then find the
  callee token(s) to its left: dotted identifier chain and optional `!`/`(`.
- Resolve in order: user `fn` in scope (params from `FnDecl.params`) → effectful signature
  from `BANG_SIGNATURES` → pure signature from `PURE_SIGNATURES` → none.
- `activeParameter`: number of top-level commas between the opening paren and the cursor.
  Cap at `parameters.length - 1`.
- `signature.label`: `fn name(a, b)` / `fs.readFile(path: string) -> string`.
  `parameter.label`: `[start, end]` offsets inside `label` so clients highlight correctly.
- Pipe context: if the callee is a pipe stage, its labels include the prepended `piped`
  parameter at index 0 (e.g. `fn f(piped, a)`), because that is what the user's cursor
  position maps to at runtime.
- Empty list / unknown callee → `null`.

### 7.6 Definition, type definition, references, rename

- **Definition** (`definition.ts`): binding under cursor → `LocationLink` with
  `originSelectionRange` (cursor token), `targetUri`, `targetRange` (declaration node),
  `targetSelectionRange` (the identifier span). Object property with a known
  `ObjectProperty` origin → that key. Bang target: user fn/object segment → its declaration;
  stdlib/builtin → `null` (hover explains). Return `Location[]` if the client lacks
  `linkSupport`.
- **Type definition**: same as definition for user bindings; `null` for builtins. Advertise
  the provider only if implemented.
- **References** (`references.ts`): binder occurrences of the resolved binding, plus the
  declaration when `context.includeDeclaration`; `Location[]`, single file. If the cursor is
  on a stdlib/builtin name → `[]`.
- **Rename** (`rename.ts`):
  - `prepareRename`: returns the identifier range + placeholder for renamable bindings
    (`let`/`fn`/`param`/`iterator`). Returns an error (LSP `ResponseError`) for keywords,
    capability names, `json`, effectful names, and unresolved names.
  - `rename`: compute all occurrences (including writes, fn name, params, iterator, and
    occurrences inside f-string interpolations — they are just expressions). Build a
    `WorkspaceEdit` with `changes`. Validate the new name against
    `^[A-Za-z_][A-Za-z0-9_]*$` and against Placitum keywords (`needs`, `let`, …) and reject
    invalid names with a clear message.
  - **Scope-aware, not textual**: renaming a shadowed inner binding must not touch the
    shadowed outer one and vice versa (test fixture mandatory).
  - Collision check: if the new name already exists in the same scope → reject with
    `E506`-style message ("would redeclare…").
- All four respect `clientCapabilities` (`locationLinkSupport`, `changeAnnotations` — plain
  `changes` is acceptable everywhere; prefer `changes` for maximum compatibility).

### 7.7 Symbols

- **Document symbols** (`symbols.ts`), hierarchical when supported:
  - top-level `NeedsDecl` → `SymbolKind.Namespace`, name `needs`, children = one symbol per
    capability token named by its raw form (`fs.read("/etc/**")`, `net("api.example.com")`,
    `env(API_KEY) (optional)`), selection range = token span.
  - `FnDecl` → `SymbolKind.Function`, range = whole decl, selection = id; children = params
    (`SymbolKind.Variable`).
  - `let` at any block level → `SymbolKind.Variable`, range = statement, selection = id.
  - `for` iterator → `SymbolKind.Variable`, searchable within the loop (child of nothing in
    particular; attach to the loop's containing symbol or top level — choose and test).
  - Nested blocks recurse: a `let` inside an `if` appears as a child of that `if`'s nearest
    symbol or at top level if no symbol wraps it (document the choice; keep it stable).
  - Flat mode: emit `SymbolInformation[]` instead when the client lacks
    `hierarchicalDocumentSymbolSupport`.
- **Workspace symbols** (`workspace/files.ts` + `symbols.ts`): `workspaceSymbol` requests
  return top-level `fn`/`let` names across `**/*.placitum` under the workspace roots,
  `containerName` = workspace-relative path. Skip `node_modules`, `.git`, and dot-dirs. Cap
  at `config.workspaceSymbols.maxFiles` (default 2000) and stop scanning after the cap,
  logging a warning. Cache results per file keyed by URI+mtime; invalidate on watched-file
  events. If `rootUri`/folders are absent → `[]`.
  - Do **not** build a persistent index; scan on demand (`ponytail:` note the ceiling).
  - If the file has syntax errors, fall back to a regex scan for `^\s*(fn|let)\s+([A-Za-z_][A-Za-z0-9_]*)`
    so half-typed programs still contribute symbols.

### 7.8 Semantic tokens (`semantic-tokens.ts`)

Build one token per classified span, full response only (`full: true`).

Classification sources:

1. **Comments**: from `comments.ts` (§6.2 helper: scan gaps between token spans; a `#`
   outside any `STRING`/f-string region and outside the line-1 pragma starts a comment to
   end of line). All comment tokens: `comment`. The line-1 pragma (`#!strict`) → `macro`
   for the name and `operator` for `#!` (or `comment` for the whole pair; pick one and pin
   it with a golden).
2. **AST-derived spans** (lookup by span, exact match wins):
   - binding declarations → `function`/`variable`/`parameter` with `declaration` modifier,
     `readonly` for `let`/`param`/`iterator` parameters that are never assignment targets
     (compute from occurrences), `defaultLibrary` for `json`.
   - binding references → same type, no `declaration`; assignments additionally get
     `modification`.
   - object literal property keys → `property`.
   - `json` namespace → `namespace`; `json.parse` → `function` + `defaultLibrary`.
   - bang targets (`fs.readFile`, `curl`, `print`, `eprint`, `fs.writeFile`) → `function` +
     `defaultLibrary`, emitted as **one token spanning the dotted target** (multi-token span
     is fine as long as it stays on one line; all bang targets do — `!` must be adjacent).
3. **Token-kind fallback** (spans not claimed by 1–2): keywords → `keyword`; `IDENTIFIER`
   in needs-context (`fs`, `net`, `exec`, `env`, `only`, `read`, `write`) → `keyword`;
   `STRING` → `string`; `NUMBER` → `number`; `FSTRING_START`/`STRING_CHUNK`/`FSTRING_END` →
   `string`; operator tokens (`+ - * / = == != < > <= >= && || | ! ?`) → `operator`.
   Punctuation (parens, braces, brackets, comma, colon, dot) gets **no** token (client
   default).
4. Merge adjacent tokens of the same type/modifiers; emit deltas (line, startChar, length,
   type, modifiers) sorted by position, no overlaps.

If lexing failed entirely (no tokens), return `{ data: [] }` — clients fall back to their
own highlighting. Never throw.

### 7.9 Folding, selection ranges, document highlights

- **Folding** (`folding.ts`): from the AST when complete — `Block` ranges (fn/if/while/for/
  else), multi-line `ObjectLiteral`/`ArrayLiteral`, multi-line `FstringExpr` (rare), and each
  top-level `NeedsDecl` group (consecutive `needs` lines fold as a `region`). Consecutive
  comment lines (≥2) fold as `comment`. When parsing fails, fall back to a brace-matching
  scan over the token stream (string/f-string aware) so folding never completely dies.
- **Selection ranges** (`selection.ts`): walk the AST ancestor chain containing each
  requested position: token → smallest expression → enclosing expression/statement → block →
  fn → program. Fallback when no AST: token → line → whole document. Return one
  `SelectionRange` per requested position, in order.
- **Document highlights** (`highlights.ts`): occurrences of the binding under the cursor;
  `kind: Read`/`Text` default, `kind: Write` for assignment targets. No highlights for
  members/builtins.

### 7.10 Code actions (`code-actions.ts`)

Only `quickfix`, no resolve. Diagnostics carry `data.quickFixes` tags; the handler maps the
requested diagnostic range + data to edits. Every fix is a plain `WorkspaceEdit` (single
file, `changes`) and must be deterministic.

| Trigger | Fix | Behavior |
|---|---|---|
| `E101` unterminated string/f-string | "Insert closing `\"`" | Insert `"` at end of line. |
| `E104` whitespace before `!` | "Remove whitespace before `!`" | Delete the whitespace between the identifier and `!` (range between token spans). |
| `E203` unterminated block | "Insert `}` at end of file" | Append `}` (with a preceding newline if missing). |
| `E301` uncovered literal bang | "Add `needs <token>`" | See algorithm below. `isPreferred: true`. |
| `E303` escalation | "Replace with enclosing grant" *(optional, Phase 5b)* | Find the first parent token that covers the child token using core `globCovers`/`hostCovers` semantics; replace the child token's text with that parent token's raw text. Only when exactly one covering parent exists. |
| `E500` unresolved name | "Declare with `let`" | Insert `let name = ` before the enclosing statement (indented like it). If the unresolved name is the first segment of a bang/call target, offer "Define function `fn name(...)`" instead/also. |
| `E506` redeclaration | "Rename to `name_2`" | Run the rename machinery with a free `name_N` candidate (same scope, increment until free). |

**Add-`needs` algorithm** (the flagship fix; unit-test all four cases):

1. Find the `BangCall` whose `span` equals the diagnostic range's offsets. Read
   `target` and `args[0]`.
2. If `args[0]` is not a `StringLiteral`, do not offer the fix (the static error only fires
   for literals anyway).
3. Compute the capability token text exactly as the extractor would:
   - `net` → `net("<new URL(value).hostname>")` (hostname already lowercased; if URL parse
     fails, skip the fix).
   - `fsRead` → `fs.read("<value>")`; `fsWrite` → `fs.write("<value>")`; `exec` →
     `exec("<value>")`. Escape `\` and `"` in the inserted string exactly as source syntax
     requires (`\\`, `\"`).
   - Unknown target (user fn) → no fix.
4. If a top-level `NeedsDecl` exists and no token with the same category+pattern is already
   present: insert `, <token>` at its end (`NeedsDecl.span[1]`).
5. Else if no top-level `NeedsDecl` exists: insert `needs <token>\n` after the pragma line
   when `#!` is on line 1, otherwise at offset 0.
6. Else (token already present): return no action.
7. Never add to a fn-level `needs` clause in v1 (top-level is always sound); mark this
   ceiling with a `ponytail:` comment and the upgrade path ("narrowest enclosing scope's
   needs when it already covers the token").

Additional non-fix actions (commands) attached to the same diagnostic/range:

- `placitum.showManifest` — see §7.11.
- `placitum.explainDeferred` — for bang calls whose check is deferred: reveals the effective
  manifest + reason via `window/showMessage` (markdown) or the client command hook.

### 7.11 Code lens, inlay hints, manifest command

- **Code lens** (`code-lens.ts`), config `placitum.codeLens.enable` (default `true`):
  - Above each top-level `NeedsDecl`: title `"N grant(s) · M deferred — show manifest"`,
    command `placitum.showManifest` with the document URI. The counts come from the
    extractor's manifest (0 deferrals and zero grants still renders `"no grants"`).
  - Above each `FnDecl` with a `needs` clause: title `"needs only(...)"` summarizing the
    raw tokens (truncate to ~60 chars), command `placitum.showManifest` (reply includes the
    fn's scoped section).
  - No lens when the file does not parse.
- **Inlay hints** (`inlay-hints.ts`), config `placitum.inlayHints.enable` (default `false`):
  - After each `let` identifier whose inferred type is not `unknown`/`null`: `: string`,
    `: number`, etc. Position = end of the identifier span, `kind: Type`, `paddingLeft: false`.
  - After a bang call whose static coverage is known: `«needs net(...)»` only when the
    config `placitum.inlayHints.capabilities` is `true` (default `false`). Never for
    deferred/ambient.
  - Return only hints intersecting the requested range.
- **Manifest request** (custom, no standard equivalent):
  - Request: `placitum/manifest`, params `{ textDocument: { uri: string } }`.
  - Result: `{ markdown: string; manifest: SerializedManifest | null; diagnostics: PlacitumError[] }`.
  - Implementation: if `Analysis.manifest !== null`, `markdown = explain(manifest)` (core's
    renderer — never a re-implementation); otherwise a markdown list of current diagnostics
    plus "fix syntax errors to see the manifest".
  - `executeCommand placitum.showManifest`: server-side, computes the same content and sends
    it via `window/showMessage` (markdown) with a size cap (~10 KB, then a note), and logs
    the full text to the server log. Editors that can render richer UI use the custom
    request instead (recipes in §8 show Neovim's floating-window example).
  - `executeCommand placitum.reanalyze`: force re-analysis of the URI and republish
    diagnostics.

### 7.12 Logging, tracing, error handling

- Respect `$/setTrace` and `--log-level` (default `info`): `trace` logs every request/response
  method name; `debug` adds analysis timings; `info` logs lifecycle and configuration;
  `error` only failures.
- Logs go to **stderr** always; optionally to `--log-file <path>` (append). Never stdout.
- `window/logMessage` for notable events (e.g. workspace scan cap reached).
- Every handler wraps its body in a try/catch that logs the stack and returns either a safe
  empty result or a JSON-RPC error, never an unhandled rejection.
- Process-level handlers: `uncaughtException`/`unhandledRejection` → log to stderr and keep
  the server alive if the connection is still open (except during shutdown).

---

## 8. Editor Integration (shipped recipes + tests)

`editors/` contains a copy-paste recipe per client, each with a smoke test or manual
checklist. The server must be installable as `placitum-lsp` on `PATH`.
Recommended install (document in README): `npm install -g placitum-lsp` or per-project via
`npx`/`mise`/`nix`. Node `>=20`.

Also ship a minimal `editors/README.md` table: client → recipe path → tested version →
automated? (yes/no).

### 8.1 Neovim (automated E2E)

`editors/neovim/init.lua` (Neovim ≥ 0.11):

```lua
vim.filetype.add({ extension = { placitum = "placitum" } })

vim.lsp.config("placitum", {
  cmd = { "placitum-lsp", "--stdio" },
  filetypes = { "placitum" },
  root_markers = { ".git" },
})

vim.lsp.enable("placitum")

-- Optional: show the capability manifest in a floating window.
vim.api.nvim_create_user_command("PlacitumManifest", function()
  local bufnr = vim.api.nvim_get_current_buf()
  local uri = vim.uri_from_bufnr(bufnr)
  vim.lsp.buf_request(bufnr, "placitum/manifest", { textDocument = { uri = uri } },
    function(_, result)
      if not result then return end
      local lines = vim.split(result.markdown, "\n")
      local win = vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), true, {
        relative = "editor", width = math.min(80, vim.o.columns - 4),
        height = math.min(#lines, vim.o.lines - 4), row = 2, col = 2,
        style = "minimal", border = "rounded", title = " Placitum manifest ",
      })
      vim.api.nvim_buf_set_lines(vim.api.nvim_win_get_buf(win), 0, -1, false, lines)
      vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = vim.api.nvim_win_get_buf(win) })
    end)
end, {})
```

Also ship an `nvim-lspconfig` (0.10) variant. The automated E2E
(`tests/e2e/neovim.lua` + a vitest wrapper):

1. `nvim --headless -u editors/neovim/init.lua -c "lua ..."` opens a fixture with a known
   `E301`, waits for `LspAttach`, asserts `#vim.diagnostic.get(0) == 1` and the code matches.
2. Requests completion at a `.` position and asserts `json.parse` is present.
3. Runs `vim.lsp.buf.rename` on a shadowing fixture and asserts the buffer text.
4. Calls `placitum/manifest` and asserts the reply contains `grants (statically proven):`.

### 8.2 Helix

`editors/helix/languages.toml`:

```toml
[language-server.placitum]
command = "placitum-lsp"
args = ["--stdio"]

[[language]]
name = "placitum"
scope = "source.placitum"
file-types = ["placitum"]
language-servers = ["placitum"]
comment-token = "#"
indent = { tab-width = 4, unit = "    " }
```

Notes for the README: Helix needs a tree-sitter grammar for syntax highlighting; until one
exists, diagnostics/completion/hover/semantic tokens still work
(`:lsp-workspace-command`, `hx --health placitum` to confirm the server is detected). Helix
uses the server's semantic tokens only if the language has a grammar; document that
limitation honestly. Manual checklist: `:lsp-restart`, `:lsp-stop`, `hx --health placitum`,
open a fixture, confirm gutter diagnostics + hover.

### 8.3 Emacs (eglot and lsp-mode)

eglot snippet in `editors/emacs/eglot.el`; require a `placitum-mode` from any major-mode
package or define a trivial one with `define-derived-mode`. lsp-mode registration snippet
provided too. Manual checklist.

### 8.4 Zed

`editors/zed/settings.json` snippet:

```json
{
  "lsp": {
    "placitum-lsp": {
      "binary": { "path": "placitum-lsp", "arguments": ["--stdio"] }
    }
  },
  "languages": {
    "Placitum": {
      "language_servers": ["placitum-lsp"],
      "file_types": ["placitum"]
    }
  }
}
```

Note: Zed requires a language extension (or a manual `languages` entry) for the language
id; the LSP features themselves are standard.

### 8.5 Sublime, Vim, Kate

Provide `LSP-placitum.sublime-settings` (Sublime LSP package), `.vimrc` snippets for
`vim-lsp` and `coc.nvim`, and Kate's `lspclient` JSON. All are configuration only; no server
changes.

### 8.6 Automated E2E scope

- Neovim: full automated flow (§8.1) — it is the canonical “everything works” check.
- Everything else: manual checklist in each recipe, run before the release gate and
  recorded in `docs/EDITOR-CHECKLIST.md` with date + client version.
- A raw JSON-RPC protocol test (§12.2) is the machine-checkable canonical test that does not
  depend on any editor.

---

## 9. VS Code Extension Handoff (teammate spec — do not implement here)

The server is extension-ready when: stdio transport works, `initialize` advertises the
capabilities of §7.1, and no client-specific code exists. The teammate builds a thin client:

`docs/VSCODE-HANDOFF.md` must contain:

1. **Extension skeleton**

   ```jsonc
   // package.json (excerpt)
   {
     "name": "placitum-vscode",
     "engines": { "vscode": "^1.90.0" },
     "activationEvents": ["onLanguage:placitum"],
     "main": "./out/extension.js",
     "contributes": {
       "languages": [{
         "id": "placitum",
         "aliases": ["Placitum", "placitum"],
         "extensions": [".placitum"],
         "configuration": "./language-configuration.json"
       }],
       "grammars": [{ "language": "placitum", "scopeName": "source.placitum", "path": "./syntaxes/placitum.tmLanguage.json" }]
     },
     "dependencies": { "vscode-languageclient": "^9.0.1" }
   }
   ```

2. **Client startup** (`src/extension.ts`): `LanguageClient` with
   `ServerOptions = { command: "<bundled server>/dist/bin.js", transport: TransportKind.stdio }`
   or `run`/`debug` module options. `documentSelector: [{ language: 'placitum' }]`.
   `synchronize.configurationSection: 'placitum'`.
3. **Bundling**: bundle the published `placitum-lsp` + `placitum` packages into
   `server/dist/server.js` with the teammate's bundler of choice (esbuild recommended);
   keep it out of this repo.
4. **TextMate grammar** (`syntaxes/placitum.tmLanguage.json`): keywords, comments,
   strings/f-strings, numbers, capability tokens, bang-call targets, operators. Provide a
   seed grammar from the token cheat sheet in the core README. This is the teammate's
   largest task; semantic tokens improve on it but do not replace it (bracket matching,
   embedded coloring, and fallback when the server is not running).
5. **Language configuration**: `comments.lineComment: "#"`, `brackets`, `autoClosingPairs`
   (`"`, `{`, `[`, `(`), `surroundingPairs`, `folding.markers` (optional).
6. **Commands**: map `placitum.showManifest` to a VS Code command that calls the custom
   `placitum/manifest` request and shows the markdown in a webview/output channel.
7. **Settings** mirroring §11 under the `placitum.*` namespace.
8. **Checklist**: `vsce package` produces a `.vsix`; installing it in a clean VS Code shows
   diagnostics, completion, hover, rename, and the manifest command; no server logs on
   stdout; extension works without a global `placitum-lsp` install.

The server never branches on `clientInfo.name === "Visual Studio Code"`.

---

## 10. Packaging & Distribution

- `package.json`: name `placitum-lsp`, `"type": "module"`, `"bin": { "placitum-lsp": "dist/bin.js" }`,
  `"files": ["dist", "editors", "README.md", "LICENSE"]`, `"engines": { "node": ">=20" }`,
  `"exports": { ".": "./dist/server.js" }` (for the VS Code teammate to import/bundle).
- `dist/bin.js` keeps the shebang; `bin.ts` uses `process.exitCode`, never `process.exit()`
  mid-flight, mirroring the core CLI's discipline.
- CLI flags: `--stdio` (default; accept and ignore `--node-ipc`/`--socket` with a clear
  stderr message and exit 2, so a client that guesses wrongly fails loudly), `--version`,
  `--help`, `--log-level=<error|info|debug|trace>`, `--log-file=<path>`.
- Publishing to npm is the user's call; the repo must pass `npm pack --dry-run` and a
  tarball-install smoke test in CI regardless.
- Do not publish a `placitum` copy; depend on the pinned git SHA (or a future npm package).

---

## 11. Configuration Schema

Served under section `placitum` via `workspace/configuration` when the client supports it;
`initializationOptions.placitum` overrides defaults at startup; otherwise defaults apply.

```jsonc
{
  "placitum.diagnostics.enable": true,
  "placitum.diagnostics.scope": true,          // E500/E506 binder checks
  "placitum.diagnostics.strictChecks": true,   // E505 + literal-type checks
  "placitum.completion.enable": true,
  "placitum.completion.snippets": true,
  "placitum.codeLens.enable": true,
  "placitum.inlayHints.enable": false,
  "placitum.inlayHints.capabilities": false,
  "placitum.workspaceSymbols.enable": true,
  "placitum.workspaceSymbols.maxFiles": 2000,
  "placitum.trace.server": "off"                // VS Code convention; optional
}
```

Parsing must be defensive: unknown keys ignored, wrong types fall back to defaults, and a
config change triggers re-analysis + diagnostics republish.

---

## 12. Testing Strategy & CI Gates

### 12.1 Unit tests (`tests/unit/`)

- `positions`: offset↔position round-trips for ASCII, multi-byte UTF-8, surrogate pairs,
  CRLF, missing trailing newline, EOF, out-of-range spans.
- `comments`: `#` inside strings/f-strings is not a comment; `#!` line 1 is a pragma; two
  comments on one line (impossible by definition) — assert the invariant.
- `binder`: every case in §6.3, especially the let-init-before-define subtlety, closure
  capture (no use-before-declare error), fn/param same-scope redeclaration, `json`
  collision, for/while scoping, shadowing.
- `types`, `checks`: table-driven fixtures matching §6.4/§6.5.
- `capabilities`: effective manifest selection, deferral lookup, add-needs token text for
  fs/net/exec, escaping of quotes/backslashes.

### 12.2 Protocol tests (`tests/protocol/`)

An in-process harness using `vscode-languageserver`'s `createConnection` with
`PassThrough` streams (or a small client over the same streams) plus a fixture runner:

- Lifecycle: minimal client (only open/change) initializes; full client initializes.
- `didOpen` fixture → expected diagnostics JSON (exact ranges/codes/messages); incremental
  `didChange` → updated diagnostics; closing clears them.
- One fixture per feature with expected results (completion lists compared on
  label/kind/insertText; hover markdown; locations; symbol trees; semantic-token arrays;
  folding/selection/highlight arrays; code action titles/edits; code lens counts).
- Robustness: empty file, file with only comments, file with `#!strict`, file with 200
  syntax errors (assert no crash, ≥1 diagnostic), file with astral characters, CRLF file.
- Rename: shadowed bindings, keyword rejection, collision rejection.

Golden files are JSON with a stable key order; use `UPDATE_GOLDENS=1` like the core repo
(dev-only; CI always compares).

### 12.3 End-to-end (`tests/e2e/`)

- Spawn `node dist/bin.js --stdio` and speak raw framed JSON-RPC: `initialize` →
  `initialized` → `didOpen` → wait for diagnostics → `shutdown`/`exit`. Assert exit code 0.
- **stdout purity**: while doing the above, parse every stdout byte as frames; any
  non-framed output fails the test.
- `--version` / `--help` output snapshots.
- Neovim headless E2E (§8.1) — gated on `nvim` being installed (skip with a clear message,
  never fail users without it; document that CI installs it).
- `npm pack --dry-run` contents snapshot + tarball install smoke test in a temp dir.

### 12.4 CI

`npm run ci` = `check-deps` → `tsc --noEmit` → `eslint .` → `tsc -p tsconfig.build.json` →
`vitest run` → protocol/e2e smoke. No remote CI is required by the user yet (core repo
policy); keep the script CI-ready for GitHub Actions if asked.

Performance guard: a unit test analyzes a generated 1,000-line file and asserts < 50 ms per
full analysis on CI hardware (generous; catches accidental O(n²) or fs calls).

---

## 13. Phased Build Plan — DoD & Gates

**Global rule: do not start phase N+1 until phase N's gate is green.**

### Phase 0 — Core contract + LSP scaffold
- Core repo: §5.1–5.3 merged; tag/SHA recorded; all core tests still green (`npm run ci`
  in core).
- LSP repo: `package.json` (pinned core SHA), tsconfig, eslint boundary, vitest,
  `check-deps` (LSP allow-list), `README.md`, `docs/CORE-VERSION.md`,
  `docs/VSCODE-HANDOFF.md` skeleton.
- A smoke test imports the core barrel from `node_modules/placitum` through
  `core-adapter.ts` and runs `analyzeSource` on a Rosetta fixture.
- **Gate:** `npm run ci` green on the scaffold; the smoke test proves the core API contract.

### Phase 1 — Server skeleton + diagnostics
- stdio server, lifecycle, `TextDocument` sync, analysis cache, debounce, diagnostics
  mapping, config defaults, logging/stderr, error containment.
- Protocol fixtures for lifecycle + diagnostics (`E101`, `E201`, `E301`, `E500`, `E505`… pick
  a representative set); stdout-purity E2E; `--version`/`--help`.
- **Gate:** protocol fixtures green; stdout purity green; graceful single-diagnostic mode
  works with both Phase 0a and 0b core behavior.

### Phase 2 — Binder, types, static checks
- `positions`, `comments`, `binder`, `types`, `checks`, `capabilities`.
- All §6 unit tests; binder consistency fixtures copied from core eval-negatives.
- Full diagnostics set (scope + strict + literal types) published.
- **Gate:** diagnostics protocol fixtures green; binder/type unit tests green.

### Phase 3 — Navigation
- Definition, type definition, references, rename(+prepare), document symbols, workspace
  symbols.
- Shadowing rename fixture mandatory; workspace scan cap test.
- **Gate:** feature fixtures green; rename E2E in Neovim green.

### Phase 4 — Intelligence
- Completion (all contexts), signature help, semantic tokens, folding, selection ranges,
  document highlights.
- Semantic-token golden fixture including comments, pragma, bang targets, needs-context
  identifiers, f-strings.
- **Gate:** feature fixtures green; completion/hover manual check recorded for Neovim and
  Helix.

### Phase 5 — Capability UX
- Code actions (all fixes in §7.10), code lens, `placitum/manifest`,
  `placitum.showManifest`, `placitum.reanalyze`, deferred-check hover, inlay hints.
- Add-needs tests: existing needs, no needs, pragma present, duplicate token, net hostname
  lowercasing, escaping.
- **Gate:** capability fixtures green; `placitum/manifest` markdown equals core `explain`
  output for the Rosetta fixture byte-for-byte.

### Phase 6 — Compatibility hardening
- Verify minimal-client behavior (capability-by-capability), flat symbols fallback,
  plaintext hover fallback, no-dynamic-registration path, rootUri-null mode, utf-16
  assertion, method-not-found, config without `workspace/configuration`.
- Editor recipes complete + manual checklist executed for Helix, Emacs, Zed, Sublime, Vim,
  Kate; Neovim automated.
- **Gate:** compatibility matrix in `docs/COMPATIBILITY.md` signed off; all recipe files
  lint-checked (Lua/TOML/JSON syntax where tooling exists).

### Phase 7 — Release packaging
- `npm pack --dry-run` snapshot, tarball install smoke, README (install + per-editor
  quickstart + troubleshooting: logs location, `--log-level`, manifest command), LICENSE,
  CHANGELOG.
- **Gate:** fresh-machine simulation (temp dir + tarball + `placitum-lsp --version` +
  raw E2E) green; `docs/VSCODE-HANDOFF.md` complete and reviewed.

### Phase 8 (optional, only if asked) — Future work
Publish to npm; tree-sitter grammar; pull diagnostics; semantic-token delta; standalone
binary; multi-root workspace symbols. Each needs a new gate.

---

## 14. Acceptance Criteria, Risks, Open Questions

### 14.1 v1.0 acceptance criteria

1. `placitum-lsp --stdio` connects, initializes, and shuts down cleanly with Neovim, Helix,
   Emacs/eglot, and VS Code (manual matrix recorded).
2. All supported diagnostics from a syntactically valid file appear with exact core codes and
   correct ranges; syntax errors produce at least one diagnostic and never a crash.
3. Completion works for every context in §7.3; hover explains bindings, bang calls, and
   capability tokens; rename is scope-correct on shadowing fixtures.
4. The manifest surfaced by `placitum/manifest` is byte-identical to `placitum explain` for
   the same file (when the file parses).
5. The add-`needs` quick fix produces a file that then passes `placitum explain` with the
   capability covered (property test over the E301 fixtures).
6. stdout carries only JSON-RPC frames; logs only on stderr; exit codes correct.
7. Whole CI green: typecheck, lint (boundaries), unit/protocol/E2E, `npm pack` smoke.
8. Core repo untouched except the §5 contract PR; no duplicated lexer/parser anywhere.

### 14.2 Risks & mitigations

| Risk | Mitigation |
|---|---|
| Core API churn breaks the LSP | Pin a SHA; all calls behind `core-adapter.ts`; `docs/CORE-VERSION.md` records the contract. |
| Tolerant parsing regresses core safety/behavior | §5.2 requires zero behavior change for clean sources: all core goldens/tests stay byte-identical; recovery code only runs after a recorded diagnostic. |
| Editors with weak LSP support break on optional features | Capability contract §1.3; full fallbacks tested in Phase 6. |
| Semantic tokens mis-color f-strings/nested braces | Classify from AST spans first, tokens second; golden fixtures for nested/escaped f-strings. |
| stdout pollution | Framing test + the log module is the only logger and writes to stderr. |
| Rename corrupts shadowed code | Binder-based rename only; shadowing fixture in the gate. |
| Workspace scan on huge repos | Cap + skip dirs + on-demand cache; log when capped. |

### 14.3 Open questions (answer before Phase 0 finishes; defaults in parentheses)

1. Can the core repo take the §5 PR? (Default: yes; fallback path is specified.)
2. Should the LSP be published to npm now or stay private? (Default: private, local `npm
   link`/tarball; publishing later changes nothing.)
3. Are inlay hints on by default? (Default: off.)
4. Should completion trigger on space in `needs`? (Default: yes, revisit after use.)
5. Is the tree-sitter grammar part of the teammate's VS Code repo or a separate project?
   (Default: separate; the LSP does not depend on it.)

---

## Appendix A — Core API Surface Used (exact)

```ts
import {
  analyzeSource, lex, lexTolerant, parse, parseTolerant, extract, explain, formatError,
  compileManifest, SerializedCapabilityManifestSchema,
  BANG_REGISTRY, BANG_SIGNATURES, PURE_SIGNATURES, AMBIENT_BANGS, EFFECTFUL_STDLIB,
  globToRegex, globCovers, hostToRegex, display, typeName, isCallable, truthy, deepEquals,
  collectStrictDiagnostics, inferType, calleeSignature,
  PlacitumErrorBase, LexError, ParseError, ExtractError, EvalError, CliError,
} from 'placitum';
import type {
  Program, Statement, Expr, FnDecl, LetStmt, Param, ForStmt, IfStmt, WhileStmt,
  BangCall, CallExpr, MemberExpr, Identifier, StringLiteral, ObjectLiteral, ObjectProperty,
  FStringExpr, PipeExpr, AssignExpr, BinaryExpr, UnaryExpr, NeedsDecl, OnlyCapability,
  SerializedManifest, CapabilityManifest, DeferredCheck, EffectCategory, NativeSig,
  TypeName, Value, Token, TokenKind, TolerantLexResult, TolerantParseResult,
  PlacitumError, PlacitumErrorInit, AnalysisResult, CommentTrivia,
} from 'placitum';
```

The core barrel always exports all of the above (verified by
`tests/analysis/barrel-purity.test.ts`). If a future pin lacks one, that is a versioning
bug: update the pin or bump `CORE_API_VERSION` — never add a runtime fallback branch in
the server.

## Appendix B — Semantic Tokens Legend (frozen)

```
tokenTypes:     ["namespace","variable","parameter","property","function","keyword",
                 "comment","string","number","operator","macro"]
tokenModifiers: ["declaration","readonly","defaultLibrary","modification"]
```

Mappings (from §7.8): `json`→namespace; let/iterator→variable (+readonly when never
assigned); param→parameter; fn name→function(+declaration); object key→property;
`json.parse`→function+defaultLibrary; bang targets→function+defaultLibrary; keywords and
needs-context names→keyword; comments→comment; `#!strict` name→macro; strings and f-string
parts→string; numbers→number; operators and `!`→operator. Assignment targets add
`modification`.

## Appendix C — Message Examples (fixtures must match these shapes)

**initialize response**: see §7.1.

**didOpen** of `file:///tmp/uncovered.placitum` whose entire content is
`let config = fs.readFile!("/etc/app.json")` → server publishes:

```jsonc
{
  "method": "textDocument/publishDiagnostics",
  "params": {
    "uri": "file:///tmp/uncovered.placitum",
    "version": 1,
    "diagnostics": [{
      "range": { "start": { "line": 0, "character": 13 }, "end": { "line": 0, "character": 42 } },
      "severity": 1,
      "code": "E301_EXTRACT_UNCOVERED_CAPABILITY",
      "source": "placitum",
      "message": "fs.readFile!(\"/etc/app.json\") has a compile-time-literal target that no in-scope needs fs.read(...) token covers.\n\nhint: Add needs fs.read(\"/etc/app.json\") at the top of the script, or delete the call."
    }]
  }
}
```

**code action for that diagnostic** (no top-level `needs` exists yet → insert a new line):

```jsonc
{
  "title": "Add needs fs.read(\"/etc/app.json\")",
  "kind": "quickfix",
  "isPreferred": true,
  "edit": { "changes": { "file:///tmp/uncovered.placitum": [{
    "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 0 } },
    "newText": "needs fs.read(\"/etc/app.json\")\n"
  }] } }
}
```

If the same file already had `needs fs.read("/etc/**")` on line 0, the fix instead appends
`fs.read("/etc/app.json")` (as `, fs.read(...)`) at the end of that `NeedsDecl`.

**rename** on a shadowed binding: `changes` contains exactly the occurrences resolving to
that binding (fixture pins the count).

## Appendix D — File-by-File Build Order Checklist

```
[ ] src/bin.ts                  [ ] src/analysis/comments.ts
[ ] src/server.ts               [ ] src/analysis/binder.ts
[ ] src/documents.ts            [ ] src/analysis/types.ts
[ ] src/config.ts               [ ] src/analysis/checks.ts
[ ] src/log.ts                  [ ] src/analysis/capabilities.ts
[ ] src/workspace/files.ts      [ ] src/analysis/model.ts
[ ] src/analysis/core-adapter.ts[ ] src/features/*.ts (15 files)
[ ] src/analysis/positions.ts   [ ] editors/*, tests/*, docs/*
```

Definition of done for every file: types strict, no `any`, boundary-clean lint, unit-tested
if it contains logic, and a one-line header comment describing its single responsibility.
