Here is the fully corrected and clean Markdown document, with all formatting artifacts and code block errors resolved.

```markdown
# Placitum — Syntax Simplification Proposal

Scope: Section 4 (Grammar Specification) and Section 5 (Pipe Operator Semantics) only.
Capability semantics, the `BangCall`-only effectful-reachability invariant, and the Section 7.1
AST concept set are unchanged. Where a proposal reshapes a `kind` or field, it's noted inline.

---

## 1. Summary Table

| Construct | Current | Bash does | Proposed | Verdict |
|---|---|---|---|---|
| Bang-call marker | `curl!(...)` | no equivalent; `!` is history-expansion (interactive only) / test-negation | unchanged | **Keep** — real bash collision risk is near zero (history expansion is off in scripts; test-negation `!` was already reassigned to `not`), and it's already one keystroke |
| New binding | `let x = expr` | `x=value`, no keyword | unchanged | **Keep** — needed to distinguish a fresh binding from the reassignment case below; see fix |
| Reassignment | *undefined in Section 4* (AST-only `AssignExpr`, no grammar production) | `x=value` | add `AssignExpr`, reachable only from `ExprStmt` (never nested inside a pipe stage, argument list, or condition) | **Fix** — closes a real gap between Section 4 and Section 7.1; lands on bash's exact bare spelling, and staying statement-scoped avoids the classic `if (x = 5)` typo-for-`==` bug at zero precedence-table cost |
| Function declaration | `fn name(params) { }` | `name() { ...; }`, no keyword | unchanged | **Keep** — dropping `fn` creates a real `FnDecl` vs. `CallExpr`-then-`Block` ambiguity (see §2.4) |
| Blocks | `{ }` | `{ ...; }` | unchanged | **Keep** — confirmed no collision with `ObjectLiteral`; grammar position always disambiguates |
| Capability declarations | `fs.read("...")`, `net("...")`, dotted/parenthesized | no equivalent concept | unchanged | **Keep** — dotted form visually mirrors the matching bang-call site (`fs.readFile!(...)`); flag and colon spellings don't compose with `only(...)` as cleanly |
| String interpolation | `f"...{expr}..."` | `"$var"` / `"${expr}"` | keep `f"` prefix, change inner delimiter to `${expr}` | **Change (partial)** — adopts bash's exact `${}` punctuation and removes a brace-expansion false-friend, without dropping the marker Phase 3 relies on |
| Comments / pragmas | `#`, `#!` | identical | unchanged | **Keep** — already bash-identical, nothing to close |
| Logical negation | `not` | `!` (already claimed by bang-calls) | unchanged | **Keep** — no shorter spelling exists that doesn't reopen the ambiguity `not` was introduced to close |
| `for` loop | `for x in y { }` | `for x in y; do ... done` | unchanged | **Keep** — already shorter than bash and matches the broader modern-language convention, not just a narrower bash one |
| Statement terminator | `NEWLINE` only | `NEWLINE` or `;` | add `;` as an alternate terminator | **Change (additive)** — small, zero-cost bash convenience; no existing use of `;` anywhere in the grammar to collide with |

---

## 2. Grammar Deltas for Accepted Changes

### 2.1 Reassignment (`AssignExpr`) — closing a spec gap

**Current state.** Section 7.1 already declares:

```ts
interface AssignExpr extends BaseNode {
  kind: 'AssignExpr';
  id: string;
  value: Expr;
}

```

`AssignExpr` is a member of the `Expr` union — but no production in Section 4's EBNF ever
constructs one. As written, the grammar has no way to reach this node at all. This is the same
class of contradiction Section 2 was written to resolve for `realpath`, just smaller: an AST
shape with no producing grammar rule.

This directly answers analysis dimension #2 ("if you drop `let`, what ambiguity does that
introduce?"): the AST already encodes two *different* concepts — `LetStmt` (introduce a new
binding) and `AssignExpr` (mutate an existing one) — and only `LetStmt` currently has a
spelling. If `let` were dropped and bash's bare `x=5` were reused for *both* concepts, the
parser could no longer tell, without a symbol-table lookup mid-parse, whether a given line
introduces scope or mutates it. That's exactly the ambiguity `let` exists to prevent, so `let`
stays. The fix instead is to give the already-declared `AssignExpr` its missing grammar rule,
which happens to be the most bash-faithful spelling in the entire proposal (bare `x = expr`).

**Keep it statement-scoped, not a general `Expr` alternative.** The obvious first cut —
slotting `AssignExpr` in above `PipeExpr` (`Expr ::= AssignExpr | PipeExpr`) — parses fine, but
costs more than it needs to:

* It lets `=` appear anywhere an `Expr` is legal: inside an `if`/`while` condition, a pipe
stage, an `ArgList`, an `ArrayLiteral`. That reopens the classic C-family `if (x = 5)` bug —
a typo for `==` that silently compiles — inside a language whose entire premise is
compile-time visibility of what a script does.
* It adds a new precedence tier above `PipeExpr`, which contradicts Phase 2's own Definition of
Done ("the exact precedence table, pipe lowest → unary/postfix highest") — a downstream
document this proposal has no business quietly invalidating.
* Bash gets no benefit from it either: `x=y=z` isn't something bash's word-splitting model can
express, so a `PipeExpr`-level `AssignExpr` buys zero extra bash-familiarity over a
statement-scoped one.

Scoping `AssignExpr` to `ExprStmt` only avoids all three at once: it can't appear inside a
condition or argument list by construction (not by convention — the same standard everything
else in this grammar is held to), it leaves the existing pipe-to-postfix precedence ladder
completely untouched, and it still reads exactly like bash's bare `x=value`.

**Old (missing) production:** none.

**New production:**

```ebnf
ExprStmt        ::= (AssignExpr | Expr) StmtEnd
AssignExpr      ::= IDENTIFIER "=" Expr   (* not itself an Expr — no chaining *)

```

> **Critical Parsing Rule — `AssignExpr` resolution, statement-scoped (LL(2), no
> backtracking).** `AssignExpr` is reachable only from `ExprStmt` — never from inside a
> `PipeExpr`, an `ArgList`, or an `if`/`while` condition. `=` (single) is not used anywhere else
> in the grammar — only the two-character forms `==`, `!=`, `<=`, `>=` appear elsewhere, and the
> lexer already munches `=` vs `==` maximally to support `EqExpr` today. So, when starting to
> parse an `ExprStmt`, peek two tokens: `IDENTIFIER` followed by a single `=` (not doubled to
> `==`). If both match, consume them and parse the right-hand side as a plain `Expr` — assignment
> does not chain (`a = b = c` is intentionally unsupported, matching bash, where assignment is
> never itself an operand). On any other lookahead, parse an ordinary `Expr` instead. This
> reuses the existing `=`/`==` maximal-munch rule, introduces no new token, and leaves the
> `PipeExpr`-through-`Postfix` precedence ladder completely untouched — Phase 2's "pipe lowest →
> unary/postfix highest" claim still holds without qualification.

This is additive to the AST (nothing added or removed in Section 7.1 — `ExprStmt.expression`
simply may now hold a node of kind `'AssignExpr'`, which the `Expr` union already permits) and
is a pure grammar fix, not a stylistic call — the "verdict" column lists it as **Fix** rather
than **Change** for that reason.

### 2.2 String interpolation delimiter

**Old production:**

```ebnf
FStringExpr     ::= 'f"' ( CHAR | "{" Expr "}" )* '"'

```

**New production:**

```ebnf
FStringExpr     ::= 'f"' ( CHAR | "${" Expr "}" )* '"'

```

**Why keep `f"` at all, given bash drops any prefix.** Bash's `"$var"` looks natural because in
bash *every* double-quoted string is potentially interpolating — there's no separate "plain"
string type to mark. Placitum isn't in that position: several `STRING` literals in this grammar
are load-bearing compile-time constants that Phase 3 must be able to treat as pure, static
strings — `fs.read("...")`'s glob, `net("...")`'s host, `exec("...")`'s pattern. If the `f`
marker were dropped and *any* double-quoted string could interpolate, either (a) capability
strings would need a special carve-out forbidding `$`/`${` inside them specifically — an
invisible, context-dependent rule that breaks "one token means one thing everywhere," or (b) an
ordinary string literal could silently become dynamic with no visual signal, which cuts directly
against Section 1's "syntactically visible... by construction, not by convention" principle.
That's the same category of trade-off the base spec already made explicit for `!`
(Appendix: "no logical-NOT operator spelled `!`... this removes the classic ambiguity"). The `f`
prefix isn't ceremony here — it's the string-literal analogue of the bang-call marker, so it's
kept.

**What's still worth taking from bash.** The *inner* delimiter is free to change independent of
that prefix. Bash's own interpolation punctuation is `$` immediately followed by `{`; adopting
`${expr}` in place of bare `{expr}` buys two things:

1. **Removes a false-friend.** A bash user reading `f"count: {n}"` may momentarily read `{n}`
as brace-expansion syntax (`{a,b}`, `{1..5}`), which is unrelated. `${n}` is unambiguous —
it's exactly bash's parameter-expansion spelling.
2. **Shrinks the escaping surface.** Under the old grammar, a literal `{` inside an f-string is
already special (it always opens an interpolation) and needs `\{` to escape. Under the new
grammar, a bare `{` or `}` is never special — only `$` immediately followed by `{` is — so
literal braces need no escaping at all, and only a literal `$` needs an escape.

> **Critical Lexical Rule — `$` has exactly one legal interpolation form inside `f"..."`.**
> Inside an `FStringExpr`, the lexer must attempt the two-character match `${` first (the same
> longest-match discipline as `|` vs `||` and `=` vs `==`). A lone `$` not immediately followed
> by `{` is an ordinary literal character — this matches bash's own behavior where `$5` in a
> non-variable context is just the text `$5` — and requires no escape. A literal `$` — including
> one that would otherwise be followed by `{` — is escaped exactly like any other special
> character with `\$`; there is no separate two-character `\${` escape token. Plain `{` and `}`
> outside of a preceding `$` are always literal characters and never need escaping (a strict
> reduction in escaping surface versus the current grammar, where bare `{` is unconditionally
> special). The nested-brace-depth counting the lexer already performs to find an
> interpolation's matching `}` (needed today, e.g. for an `ObjectLiteral` argument inside an
> interpolation) is unchanged — only the opening sequence gained a `$`.

### 2.3 Statement terminator

**Old production:**

```ebnf
LetStmt         ::= "let" IDENTIFIER "=" Expr NEWLINE
ReturnStmt      ::= "return" Expr? NEWLINE
ExprStmt        ::= Expr NEWLINE
NeedsDecl       ::= "needs" CapabilityList NEWLINE

```

**New production:**

```ebnf
StmtEnd         ::= NEWLINE | ";"
LetStmt         ::= "let" IDENTIFIER "=" Expr StmtEnd
ReturnStmt      ::= "return" Expr? StmtEnd
ExprStmt        ::= Expr StmtEnd
NeedsClause     ::= "needs" CapabilityList
NeedsDecl       ::= NeedsClause StmtEnd

```

`;` does not appear anywhere else in the current grammar (capability and argument lists use
`,`; object properties use `:`), so this is purely additive with no new ambiguity and no new
maximal-munch rule — a `;` token is unconditionally a `StmtEnd`. This is a small, optional
convenience (`let a = 1; let b = 2` on one line) matching a habit every bash user already has;
`NEWLINE` remains the default and the only terminator anyone is required to type.

Three edge cases, pinned down so they aren't left to whoever implements this to guess at:

* **`;` is a terminator, not a statement.** A stray or doubled `;` (`let a = 1;; let b = 2`) is
`E201_PARSE_UNEXPECTED_TOKEN` at the second `;`, exactly like any other unexpected token —
there is no such thing as a silently-accepted empty statement.
* **A trailing `;` right before a `Block`'s closing `}`** (`{ let a = 1; }`) already works with
no special-casing: it's just that statement's own terminator, immediately followed by `}`,
and `Block ::= "{" Statement* "}"` already allows zero further statements after the last one.
This is the same shape bash itself requires for a `{ cmd; }` group command, so it costs
nothing extra and needs no new rule.
* **Blank lines are cleanly skipped.** To avoid empty statement errors on blank lines, the
lexer explicitly collapses contiguous `NEWLINE`s and ignores blank/comment-only lines, only
emitting `NEWLINE` tokens to terminate lines with actual code.

### 2.4 Constructs considered and explicitly kept unchanged

* **Bang-calls (`!(...)`).** Bash's `!` collisions (history expansion, test-negation) are both
either disabled in non-interactive scripts or already reassigned to `not` in this grammar.
The suffix costs one character and preserves the load-bearing "effectful calls are
`BangCall`-shaped" invariant with zero ambiguity. No change proposed.
* **`fn` keyword.** Dropping it to mimic bash's `name() { ... }` would collide with the existing
`Call` production: `Postfix ::= Primary { ... | Call | ... }` already permits
`IDENTIFIER "(" ArgList? ")"` as an ordinary expression. Without `fn`, the token sequence
`foo(a, b) { ... }` at statement position is ambiguous between "declare a function named
`foo`" and "call `foo(a, b)` as an `ExprStmt`, followed by an unrelated `Block` statement."
Resolving that requires unbounded lookahead past the entire parameter list to see whether a
`{` follows — exactly the kind of ambiguity the bash-alignment heuristic says not to chase
into. `fn` stays.
* **Blocks (`{ }`).** Verified against `ObjectLiteral`'s `{ }`: `Block` only appears in
fixed, keyword-introduced positions (`if`/`while`/`for`/`fn` bodies) that are never
themselves `Expr` positions, while `ObjectLiteral` is only reachable through `Primary`
(an `Expr` position). The one edge case — `if {a: 1} { ... }`, where the condition itself is
an object literal — parses unambiguously because `IfStmt` requires a complete `Expr` before
the `Block` can begin, so the first `{` is consumed as `Primary`'s `ObjectLiteral` and the
second is the mandatory `Block`. No fix needed; noted here only because dimension #4 asked
for confirmation rather than assumption.
* **Capability declarations.** The dotted form (`fs.read(...)`) already reads as the natural
extension of the dotted call-site syntax it authorizes (`fs.readFile!(...)`), which is a
stronger readability signal than either alternative considered: a flag form
(`--fs-read=/etc/*.json`) has no natural way to express `only(...)`'s wrapping without
inventing new flag-of-flags syntax, and a colon form (`fs:read(...)`) buys no bash-familiarity
(bash has no capability concept to model against) while breaking the visual echo with the
call site. Kept as-is.
* **Comments/pragmas (`#`, `#!`).** Already identical to bash/POSIX shell. Confirmed, no
change.
* **`not` for negation.** `!` is unavailable (claimed by bang-calls); no shorter or more
bash-adjacent spelling exists that doesn't reopen that exact collision. Kept as the base
spec's Appendix already resolved it.
* **`for x in y { }`.** Bash's `do...done` is widely considered its worst-aged syntax; copying
it would serve familiarity at the cost of readability without even being uniquely "more
bash-like" in any way that helps, since Placitum's shorter form already matches the broader
for-loop convention most programmers (not just bash users) already know. Kept as-is.

### 2.5 Downstream housekeeping this proposal requires

Sections 8–11 are out of scope for redesign, but two lines inside them name the *old* `{expr}`
delimiter explicitly and will quietly go stale if merged as-is:

* **Section 9.2, `E102_LEX_UNTERMINATED_FSTRING_EXPR`** currently reads "`{` inside `f"..."` not
closed before the string ends." → update to "`${` inside `f"..."` not closed before the
string ends."
* **Section 11, Phase 1 DoD** currently reads "Stateful `f"...{expr}..."` lexing (switches to
expression mode inside `{ }` and back), including nested braces and `\{`/`\}` escapes in
literal text." → update to "Stateful `f"...${expr}..."` lexing (switches to expression mode
after `${` and back to literal mode at the matching `}`), including nested braces and a `\$`
escape for a literal dollar sign in literal text."

No new error code is needed for `AssignExpr`: a malformed left-hand side (e.g. `5 = x`) never
matches the `IDENTIFIER "="` lookahead in the first place, so it's parsed — and rejected — as an
ordinary `Expr` through the existing `E201_PARSE_UNEXPECTED_TOKEN`.

Separately, not a spec edit but worth stating plainly: every golden fixture keyed to the literal
text of the Rosetta Stone example — `tests/parser/rosetta.ast.golden.json` (Phase 2),
`tests/capability/rosetta.manifest.golden.json` (Phase 3), the Phase 5 eval-output goldens, and
`tests/explain/rosetta.explain.golden.txt` (Phase 6) — must be regenerated against the rewritten
example below, not hand-patched; its content changed (`${}` delimiter, one `;`-joined line, two
`AssignExpr` reassignments), so the old goldens no longer describe it.

---

## 3. Rewritten Section 4 — Grammar Specification (EBNF)

```ebnf
(* ---- Top level ---- *)
Program         ::= Pragma? NeedsDecl* Statement*
Pragma          ::= "#!" IDENTIFIER NEWLINE        (* only recognized on physical line 1 *)

(* ---- Capabilities ---- *)
NeedsClause     ::= "needs" CapabilityList
NeedsDecl       ::= NeedsClause StmtEnd
CapabilityList  ::= CapabilityToken ("," CapabilityToken)*
CapabilityToken ::= FsReadCap | FsWriteCap | NetCap | ExecCap | EnvCap | OnlyCap
FsReadCap       ::= "fs" "." "read"  "(" STRING ")"
FsWriteCap      ::= "fs" "." "write" "(" STRING ")"
NetCap          ::= "net"  "(" STRING ")"
ExecCap         ::= "exec" "(" STRING ")"
EnvCap          ::= "env"  "(" IDENTIFIER "?"? ")"
OnlyCap         ::= "only" "(" CapabilityToken ")"  (* no nested only(); parser rejects only(only(...)) *)

(* ---- Statements ---- *)
StmtEnd         ::= NEWLINE | ";"
Statement       ::= LetStmt | FnDecl | IfStmt | WhileStmt | ForStmt
                   | ReturnStmt | ExprStmt | NeedsDecl
LetStmt         ::= "let" IDENTIFIER "=" Expr StmtEnd
FnDecl          ::= "fn" IDENTIFIER "(" ParamList? ")" NeedsClause? Block
ParamList       ::= IDENTIFIER ("," IDENTIFIER)*
Block           ::= "{" Statement* "}"
IfStmt          ::= "if" Expr Block ("else" (IfStmt | Block))?
WhileStmt       ::= "while" Expr Block
ForStmt         ::= "for" IDENTIFIER "in" Expr Block
ReturnStmt      ::= "return" Expr? StmtEnd
ExprStmt        ::= (AssignExpr | Expr) StmtEnd        (* AssignExpr: statement-scoped, §2.1 *)
AssignExpr      ::= IDENTIFIER "=" Expr                (* not itself an Expr — no chaining *)

(* ---- Expressions, lowest to highest precedence — unchanged: pipe lowest ---- *)
Expr            ::= PipeExpr
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
FStringExpr     ::= 'f"' ( CHAR | "${" Expr "}" )* '"'

```

> **Critical Lexical Rule — Whitespace & Blank Lines.** The lexer must collapse consecutive
> `NEWLINE` characters into a single `NEWLINE` token, and completely ignore blank lines (lines
> containing only whitespace/comments). `NEWLINE` tokens are only emitted when terminating a
> line that contains actual code tokens.
> **Critical Parsing Rule — bang-call target resolution.** Unchanged. A `!(...)` suffix is only
> syntactically valid when everything preceding it in the postfix chain is a bare `IDENTIFIER`
> followed by zero or more `.IDENTIFIER` member accesses — e.g. `curl!(...)` or
> `fs.readFile!(...)`. If a prior `(...)` call, an array/object literal, or any non-identifier
> expression appears anywhere before the `!`, the parser **must** reject with
> `E205_PARSE_INVALID_BANG_CALL_TARGET`. `BangCall.target` is always a compile-time-known dotted
> string.
> **Critical Lexical Rule — `!` has exactly one legal position.** Unchanged. There is no
> logical-NOT operator spelled `!`; use the `not` keyword. A `!` anywhere except immediately
> after a valid bang-call target (no whitespace) is `E104_LEX_UNEXPECTED_CHARACTER`.
> **Critical Lexical Rule — `|` vs `||` (maximal munch).** Unchanged. The pipe operator is a
> single `|`; logical-or is `||`. The lexer attempts the two-character match first.
> **Critical Grammar Rule — `needs` placement.** Unchanged. `NeedsDecl` is only valid at the
> very top of `Program`, before any non-`NeedsDecl` statement, or as the optional clause
> immediately after a `FnDecl`'s parameter list, before its `Block`. Anywhere else is
> `E202_PARSE_NEEDS_NOT_AT_TOP`.
> **Critical Parsing Rule — `AssignExpr` resolution, statement-scoped (LL(2), no
> backtracking).** New — see §2.1. `AssignExpr` is reachable only from `ExprStmt`, never from
> inside a `PipeExpr`, an `ArgList`, or an `if`/`while` condition. `IDENTIFIER "="` (single `=`,
> not `==`) at the start of an `ExprStmt` uniquely predicts it; any other lookahead falls
> through to an ordinary `Expr`. Reuses the existing `=`/`==` maximal-munch rule already
> required for `EqExpr`; introduces no new token and leaves the `PipeExpr`-through-`Postfix`
> precedence ladder untouched.
> **Critical Lexical Rule — `$` has exactly one legal interpolation form.** New — see §2.2.
> Inside `f"..."`, the lexer attempts `${` first (maximal munch); a lone `$` is a literal
> character; a literal `$` is escaped with `\$` (no separate `\${` token). Bare `{`/`}` are
> never special and never need escaping.

---

## 4. Rewritten Section 6 — Rosetta Stone Example

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
    print!(f"status=${result.status} config=${config.name}")
} else {
    print!("fetch disabled by config")
}

let attempts = 0; let healthy = 0

for endpoint in config.endpoints {
    attempts = attempts + 1
    let health = endpoint | fetch_status
    if health.status == "ok" { healthy = healthy + 1 }
    print!(f"${endpoint} -> ${health.status}")
}

print!(f"checked ${attempts}, healthy ${healthy}")

```

This exercises everything the original example did — a top-level `needs`, a `fn` with an
attenuated per-function `needs only(...)`, `let` bindings, both pipe-argument-insertion forms
(Section 5, rules 1 and 2), bang-calls, `if`/`else`, `for`, member access, and f-string
interpolation with the new `${...}` delimiter — plus the two additive constructs from this
proposal: a `;`-separated pair of `let` statements, and bare `attempts = attempts + 1` /
`healthy = healthy + 1` reassignments via the newly-specified `AssignExpr`, contrasted directly
against the `let` bindings a few lines above them.

---

## 5. Rejected Ideas

* **Dropping the `f"` prefix entirely** and going full bash (`"$var"`/`"${expr}"` on every
string). Rejected: several `STRING` literals in this grammar (capability patterns, `env()`
names) must stay compile-time-literal for Phase 3, and the `f` prefix is the visible signal
that separates "this string may be dynamic" from "this string must be static" — dropping it
either forces an invisible, position-dependent carve-out for capability strings or silently
weakens the "syntactically visible by construction" principle in Section 1. Kept `f"`, changed
only the inner delimiter (§2.2).
* **Dropping `fn` for bash-style `name() { ... }`.** Rejected: collides with the existing `Call`
production, making `foo(a, b) { ... }` ambiguous between a function declaration and a call
expression followed by an unrelated block; resolving it needs unbounded lookahead. Kept `fn`.
* **Dropping `let` and unifying binding/reassignment under bash's bare `x=5`.** Rejected: the
AST already distinguishes `LetStmt` from `AssignExpr` (Section 7.1), and collapsing both onto
one spelling makes "is this a new binding or a mutation?" undecidable without a symbol-table
lookup mid-parse — the exact ambiguity `let` exists to prevent. Kept `let`; gave `AssignExpr`
its missing grammar rule instead (§2.1), which lands on bash's exact bare spelling for the
reassignment case where it's actually safe to use it.
* **Making `AssignExpr` a general `Expr` alternative** reachable inside pipe stages, argument
lists, and conditions (the way C-family languages treat assignment). Rejected: it reopens the
classic `if (x = 5)` typo-for-`==` bug and adds a new precedence tier above `PipeExpr`,
silently invalidating Phase 2's existing "pipe lowest" precedence claim — for no
bash-familiarity benefit, since bash doesn't support nested assignment either. Scoped
`AssignExpr` to `ExprStmt` only instead (§2.1).
* **Right-associative chained assignment** (`a = b = c`). Rejected: bash has no equivalent —
each `x=v` is a standalone word, never composable — so chaining serves no bash-alignment goal
and only adds a recursive right-hand side to `AssignExpr` for a feature nobody asked for.
`AssignExpr`'s right-hand side is a plain, non-chaining `Expr`.
* **Flag-style capability declarations** (`--fs-read=/etc/*.json`). Rejected: no bash concept to
model against, and no clean way to express `only(...)`'s wrapping without inventing
flag-of-flags syntax. Kept the dotted form, which already mirrors the matching bang-call site.
* **Colon-style capability declarations** (`fs:read(...)`). Rejected: no bash-familiarity gain
(bash has no namespacing), and it breaks the visual echo with `fs.readFile!(...)` that the dot
form already provides for free.
* **Requiring bash's exact no-space `x=5`.** Rejected: every other binary operator in this
grammar (`a + b`, `a == b`) is written with surrounding whitespace; importing bash's
whitespace-sensitivity here would be inconsistent with the rest of Section 4 and reintroduces
a well-known bash footgun (`x = 5` fails in real bash) into a language whose whole pitch is
removing bash footguns, not collecting them.
* **Making `;` a required terminator** (matching bash's need for it on multi-statement lines).
Rejected: `NEWLINE` already covers the common case with zero typing cost; requiring `;`
everywhere would be a pure regression for the one-statement-per-line style the rest of the
grammar assumes. Made `;` optional and additive instead (§2.3).

```

```
