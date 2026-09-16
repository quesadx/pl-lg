# Placitum — Build Progress & Handoff

> For the next AI agent: read `placitum-implementation.md` first (it is authoritative),
> then this file. Work one phase at a time; do not start Phase N+1 code until Phase N's
> CI gate is green (Section 0, rule 5).

## Environment

- **No node/npm on the host.** Everything runs inside the nix dev shell:
  - `nix develop` — interactive shell (node 22 + npm)
  - `nix develop --command npm run ci` — one-shot gate
  - Fresh clone: `nix develop --command bash -c "npm ci && npm run ci"`
- `flake.nix` provides **only** `nodejs_22`. All JS deps come from npm (Section 8.3
  allow-list); the shell never needs rebuilding for dep changes.
- `flake.nix` / `flake.lock` are registered with `git add -N` (intent-to-add) so nix
  flakes can see them in the git tree. Do not commit unless the user asks.

## Status

| Phase | State | CI gate |
|---|---|---|
| **0 — Scaffolding & test harness** | **DONE** | green (2026-09-15) |
| **1 — Lexer** | **DONE** | green (2026-09-15) |
| 2 — Parser & AST | next | — |

Gate runs, in order: `check-deps` → `tsc --noEmit` → `eslint` → `vitest run`
(= `npm run ci`). Last verified: 22/22 tests passing (5 phase0 + 17 lexer).

## Phase 0 DoD checklist

- [x] `tsconfig.json` in place; `tsc --noEmit` passes.
- [x] `.eslintrc.json` in place; import boundary **proven to fire**: a temporary
  `src/evil-import-fixture.ts` importing `fs` failed with
  `1:1 error 'fs' import is restricted ... no-restricted-imports` (exit 1), then was deleted.
- [x] `scripts/check-deps.mjs` fails the build on non-allow-listed direct deps.
      **Failure path proven:** injecting `left-pad` into the lockfile root entry →
      `check-deps: dependencies outside the Section 8.3 allow-list:\n  left-pad`, exit 1;
      lockfile restored byte-perfect (`cmp`), happy path re-verified.
- [x] `npm run ci` chains `check-deps` → `tsc` → `eslint` → `vitest`.
- [x] 3 negative fixtures in `tests/capability/negative/`, each schema-validated
  against `PlacitumErrorSchema` by `tests/phase0/expected-errors.test.ts`.
      **Pairing check proven:** an orphaned `orphan.negative.placitum` (no expected-error
      sibling) failed both the set-equality test and the per-script validation; then removed.

### "Otherwise-empty src/" interpretation

The CI gate says "green on an otherwise-empty `src/`", but the fixtures must validate
against `PlacitumErrorSchema` — so `src/` holds exactly one file: `src/shared/errors.ts`
(the Section 9.3 envelope). No other src/ code exists; this is the minimal reading.

## Deviations from placitum-implementation.md (all user-approved; md already updated)

1. **`tsconfig.rootDir: "."`** (was `./src`). As written, Section 8.2 rejected
   `tests/**` with TS6059 even under `--noEmit`. Section 8.2 in the md is fixed.
2. **ESLint override paths prefixed with `src/`** (`src/host-bindings/**`,
   `src/capability/guard.ts`) — overrides are repo-root-relative; Section 3's tree
   lives under `src/` per the tsconfig `include`. Md updated.
3. **`tests/**` override also disables `no-restricted-imports`.** Golden-file tests
   must read fixtures via `node:fs`; the import boundary guards the language
   runtime, not the test harness. Md updated.
4. **`@types/node` added to the Section 8.3 allow-list** (dev, types-only).
   Without it `tsc` cannot type `node:fs` / `URL` / `import.meta.url` in any TS
   test — every phase's golden tests require it. Md + `check-deps.mjs` updated.
5. **Version pins to keep Section 8.1 byte-exact:** `eslint@8.57.1` +
   `@typescript-eslint/*@^7` (v8 removed `recommended-requiring-type-checking`;
   eslint 9 ignores `.eslintrc.json`). Known cost: eslint 8 is EOL and its
   transitive dev deps carry 5 `npm audit` findings (dev-only, no runtime ship).
   Upgrade path: migrate to flat config + ts-eslint v8 when the spec's config
   format is revisited.

## Decisions within spec latitude

- **`check-deps` audits direct dependencies only** (package-lock root entry:
  `dependencies` + `devDependencies` + `optionalDependencies`).
  Transitive deps are pinned by the lockfile itself; a literal full-lockfile audit
  against the 9-package allow-list is impossible (eslint alone pulls ~80 transitives).
- **`traversal.negative.placitum` implies a Phase 3 glob requirement:** for the literal
  `/safe/../etc/passwd` to statically pass under `needs fs.read("/safe/**")`, the glob
  compiler must support `**` (crossing `/`); a single `*` must NOT cross `/` (classic
  glob semantics, per the spec's `/etc/config/*.json` example). Build that into
  `shared/` glob-to-regex in Phase 3.
- **Deps installed so far:** zod, typescript, eslint stack, vitest, @types/node.
  `commander` (Phase 9), `tsx` (iteration), `prettier` (formatting) deferred until needed.
- **Fixture error-code choices** (fixtures are inert until their phase wires them up):
  - `traversal.negative.placitum` → **E403**. `needs fs.read("/safe/**")` string-matches
    the literal `/safe/../etc/passwd` statically, so extraction passes and the guard's
    realpath must catch the escape — exactly Phase 4's naive-string-match test class.
  - `net-star.negative.placitum` → **E305** (bare `*` rejected at extraction).
  - `uncovered-bang.negative.placitum` → **E301** (literal target, no covering needs).
- No GitHub Actions — CI gate is the local `npm run ci` (user's call; revisit when
  remote gating is needed).

## Phase 1 DoD checklist

- [x] Every token carries exact `line`/`col`/`span` (byte-for-byte goldens prove it).
- [x] Stateful f-string lexing: mode stack (`fstringDepths` = braceDepth per
  interpolation `{`), nested braces + nested f-strings, `\{`/`\}` escapes.
- [x] `#!` only on physical line 1; bare `#` line comment anywhere (incl.
  comment-only lines collapsed into the preceding NEWLINE run).
- [x] `BANG` only when previous token is IDENTIFIER and `prev.span[1] === pos`
  (offset adjacency = no whitespace); `!=` wins by maximal munch; else E104.
- [x] 7 goldens, one per token category (string, fstring, number, pragma, bang,
  punctuation, keyword), hand-written first per TDD — fixtures failed on missing
  module, then 3 hand-span errors were found and fixed in the *goldens*
  (bang RPAREN/NEWLINE cols, number/string NEWLINE cols); lexer was right each time.
- [x] Negatives cover E101–E106 (2× E104: bare `!x`, `foo !()`), each throws the
  exact code; thrown envelope + expected file both validated against
  `PlacitumErrorSchema`.

### Phase 1 decisions within spec latitude

- **Token model:** `{ kind, value?, line, col, span }`; `value` only on
  IDENTIFIER/STRING/STRING_CHUNK/NUMBER/PRAGMA. Key insertion order is
  load-bearing for byte-exact goldens. Golden format: one token per line.
- **Keywords:** `needs let fn if else while for in return not only true false null`.
  `fs`/`net`/`exec`/`env`/`read`/`write` lex as IDENTIFIER (also member-path
  segments); parser interprets them in needs-context. `true`/`false`/`null`
  lex as keyword tokens; parser builds the literals.
- **E106 defined:** after `DIGIT+ ("." DIGIT+)?`, a directly-following `.` or
  identifier-start char is malformed (`1.2.3`, `1.`, `1.x`, `123abc`). Numbers
  have no members and no exponent/hex forms, so this costs nothing.
- **E105 also covers** a malformed line-1 pragma (`#!` with no identifier) —
  only pragma lex code available.
- **NEWLINEs collapsed** (blank/comment-only runs → one token); `\r` is
  whitespace (CRLF → one NEWLINE). Parser must treat EOF as an implicit
  statement terminator when the file lacks a trailing newline.
- **F-string token stream is flat:** FSTRING_START, non-empty STRING_CHUNKs
  (decoded value, raw span), normal expr tokens, FSTRING_END. Empty chunks
  skipped. Newlines allowed inside interpolations, not in literal text.
- **Error hierarchy in `src/shared/errors.ts`:** `PlacitumErrorBase` (envelope
  fields + `toEnvelope()`) + `LexError`; later phases append their classes here
  so `instanceof` checks (Section 0 rule 7) stay one-import.

## Next: Phase 2 — Parser & AST (DoD in Section 11)

`Token[] → ASTNode` per Section 4 grammar + Section 7.1 types. Key requirements:
- Full EBNF with exact precedence (pipe lowest → unary/postfix highest);
  statements recursive-descent, expressions Pratt.
- `E202` for `needs` in every illegal position (mid-block, after a function's
  first non-needs statement, second top-level needs block after other statements).
- Every Section 7.1 interface producible; `satisfies ASTNode` check on output.
- `E205` for invalid bang-call targets (`getFn()!(...)`, literal `!(...)`, etc.).
- Golden AST for the Rosetta Stone example → `tests/parser/rosetta.ast.golden.json`.
- Negatives for every E2xx code; TDD per Section 0 rule 1.
- Lexer emits EOF without a trailing NEWLINE — parser treats EOF as terminator.
- AST types belong in `src/ast/` (pure data definitions, no logic, Section 3).
