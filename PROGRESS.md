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
| **2 — Parser & AST** | **DONE** | green (2026-09-15) |
| **3 — Static Capability Extraction** | **DONE** | green (2026-09-16) |
| **4 — CapabilityGuard** | **DONE** | green (2026-09-16) |

Gate runs, in order: `check-deps` → `tsc --noEmit` → `eslint` → `vitest run`
(= `npm run ci`). Last verified: 105/105 tests passing (10 phase0 + 16 lexer +
19 parser + 37 capability [19 patterns, 9 extract-negatives, 4 manifest-goldens,
3 extractor-behavior, 2 purity] + 23 guard [3 negatives, 20 unit]).
Test count dropped 110 → 105 in the post-audit refinement: five duplicated
pairing `it`s were consolidated into the shared fixture loader's throw.

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

## Phase 2 DoD checklist

- [x] Full EBNF (Section 4) implemented with the exact precedence table
      (`=` right-assoc lowest → pipe → `||` → `&&` → eq → rel → add → mul →
      unary → postfix); statements recursive-descent, expressions Pratt
      (`parseBinaryLevel` + one method per tier).
- [x] `E202` fires for `needs` mid-`if`-block, after a fn's first non-needs
      statement, and top-level after a statement (3 fixtures).
- [x] Every Section 7.1 interface producible — coverage test walks rosetta +
      kitchen-sink with an exhaustive `switch` + `assertNever` over
      `ASTNode | CapabilityToken` and asserts all 34 kinds appear.
      (`CapabilityToken` nodes are not in `ASTNode` itself — Section 7.1 —
      so the walker's union is the two combined.)
- [x] `E205` fires for prior-call chains (`getFn().g!(1)`) and paren-rooted
      chains (`(x).y!(1)`, via a `primaryParenthesized` flag), keeping
      `BangCall.target` a compile-time-known dotted string.
- [x] `tests/parser/rosetta.ast.golden.json` generated from Section 6's exact
      script, then hand-reviewed (span/col arithmetic, flat pipes, raw
      un-desugared bare stages, dotted bang targets) before commit.
- [x] Negatives cover every E2xx code (13 scripts: 5×E201 incl. member/call
      assignment targets and bang-without-parens, 3×E202, E203, 2×E204 incl.
      `only(only(...))`, 2×E205, E206), each schema-valid and code-exact.
- CI gate: goldens byte-for-byte (2-space JSON, deterministic key order
  `kind,line,col,span,fields`), all E2xx exact. 20/20 parser tests.

### Phase 2 deviations & decisions (md updated where marked)

1. **`AssignExpr ::= IDENTIFIER "=" AssignExpr | PipeExpr` added to Section 4
   (user-approved; md + appendix updated).** The 7.1 union had `AssignExpr`
   with no grammar production, and the language had no way to reassign —
   `while` accumulators were impossible. Assignment is lowest precedence,
   right-assoc (`a = b = 9`), bare-identifier targets only (`u.a = 2` and
   `f() = 5` are E201). **Phase 5 forward-note:** assignment writes the
   nearest enclosing scope holding the binding, else `E500`; the assignment
   expression yields the assigned value; closures capture environments by
   reference (now load-bearing).
2. **Newline policy:** NEWLINE terminates statements only at grouping depth 0;
   inside `(...)` arg lists, `[...]`, object literals, and f-string
   interpolations it is skipped (forced by the lexer allowing newlines in
   interpolations; multi-line calls come free). Block braces are not tracked.
3. **Statement terminators:** NEWLINE (consumed), `}` (lookahead — one-line
   blocks like `fn f() { return 1 }`), or EOF (no trailing newline).
4. **Golden authoring:** fixtures + harnesses written first (failed on the
   missing parser module), then goldens generated via `UPDATE_GOLDENS=1`
   and hand-reviewed (spec Section 6 sanctions generate-then-review).
   `UPDATE_GOLDENS` is dev-only; CI always compares.
5. **`only` lexes as the ONLY keyword** (unlike fs/net/exec/env which are
   IDENTIFIERs), so `parseCapabilityToken` accepts both token kinds.
6. **Trailing commas rejected** (grammar has none) — fall out as E201.
7. **f-string `{a}{b}`** produces two adjacent expr parts; the 7.1 comment
   says "alternating" but nothing enforces it. Ignored.

## Phase 3 DoD checklist

- [x] Purity smoke test: extractor runs inside Node `vm`; its runtime closure
      (`capability/extractor.ts`, `shared/glob-to-regex.ts`,
      `shared/assert-never.ts`, `shared/errors.ts`) is transpiled to CJS via
      `ts.transpileModule` and loaded through a mini-`require` that serves only
      closure members — anything else (fs, zod, bare imports) throws.
      **Proven to fire:** injecting `import { readFileSync } from 'node:fs'`
      (+ a use) into extractor.ts fails with `purity violation: ... imports
      "node:fs"`; reverted, green again. Note: an *unused* value import is
      elided by TS CJS emit, so it never reaches the sandbox — unreachable
      code can't do I/O, which is the property that matters. Rosetta +
      kitchen-sink extract inside the vm byte-identical to the normal run.
- [x] Exhaustiveness: statement/expr/token switches each end in an E304-flavored
      `assertNever` (`unhandled(x: never)` — same compile-time guarantee, the
      runtime backstop carries the `E304_EXTRACT_UNHANDLED_NODE` envelope).
      E304 exercised by a unit test with a cast bogus-kind node (the parser
      can never produce one).
- [x] Glob-to-regex unit tested against strings alone (`patterns.test.ts`,
      zero filesystem contact): `*` stays within a segment, `**` (whole
      segment only) crosses `/`, metachars literal, anchored, E302/E305.
- [x] E303 fires (`e303-attenuation-escalation`; **plus
      `e303-multi-token-escalation` from the post-phase audit — the original
      `checkAttenuation` loop `return`ed after the first needs token, so a
      second escalating token in `needs only(...), fs.read(...)` slipped past
      E303 and self-covered via the child manifest; fixed to `continue`,
      regression fixture committed**). E305 in net/exec/glob positions
      (`net-star`, `e305-exec-star`, `e305-fs-star`); E301 fs-literal
      (`uncovered-bang`) and **net-literal (`e301-uncovered-net`, added in
      audit — the URL-parse branch was otherwise untested)**; E302
      (`e302-invalid-glob`). Negative runner filters by the expected-error's
      `phase` field, so `traversal` (phase `guard`) stays inert until Phase 4 —
      by design, that fixture must *pass* extraction (string-match) and die in
      the guard's realpath.
- [x] `tests/capability/rosetta.manifest.golden.json` generated, then
      hand-reviewed: deferred span [168,192] cross-checked against the
      hand-reviewed parser AST golden; scoped contains only `fetch_status`
      (attenuated net + its piped-curl DeferredCheck); top-level
      `deferredToRuntime` is empty (readFile literal covered, `print!`
      ambient-skipped). `kitchen-sink.manifest.golden.json` additionally pins
      deferred-bubbling from an inheriting fn, scoped covered literals,
      wildcard-net literal coverage, env optional, and reason-string formats
      (spans verified byte-exact against source offsets).
- CI gate: green — purity passes, both manifest goldens byte-for-byte, all
  E3xx negatives exact.

### Phase 3 deviations & decisions

1. **`src/shared/error-schema.ts` split out of `errors.ts`** (user-approved in
   plan): the zod schema + `PlacitumError` type moved so error *classes* stay
   runtime-pure (no zod) — the purity closure imports `errors.ts` for
   `ExtractError`. `errors.ts` re-exports the type only (type-only, erased).
   Tests import `PlacitumErrorSchema` from `error-schema.js` (3 files updated).
   Zod validates at trust boundaries (Section 7.3); classes don't need it.
2. **E303 "strict subset" = ⊆ (equality allowed)** — the Rosetta example
   attenuates to the identical net token; banning equality would fail its own
   spec example. Escalation (anything wider) is E303.
3. **Subset checks are pattern-structural, not string equality:**
   `globCovers(parent, child)` = segment-recursive language containment for
   the mini-glob (`**` ≥ 1 segment, `*` in-segment; handles
   `only(fs.read("/etc/config/*.json"))` under `fs.read("/etc/config/**")`).
   Net: exact child covered by exact-equal or single-label-matching wildcard
   parent; a wildcard child (`*.example.com`) is covered ONLY by the identical
   parent wildcard (strict single-leading-label rule makes `*.example.com ⊄
   *.com` correct). Env: name membership only — child optionality ignored
   (privilege is reading the var; absence is E406's runtime job).
4. **`BANG_REGISTRY` is the single definition of the effectful surface**:
   `fs.readFile`/`fs.writeFile`/`curl` (relevant arg always `args[0]`).
   Ambient `print!`/`eprint!` and unknown targets (user fns — grammar permits
   banging pure fns) are skipped. **Phase 5 must add a sync test: every
   effectful stdlib name ⊆ registry**, and exec/env bang names get registered
   when the stdlib defines them (not guessed now — a wrong guess is a silent
   coverage hole because unknown targets are skipped).
5. **Piped bang stages (`PipeExpr.stages[i], i≥1`) always defer** (Section 5
   rule 4): the piped value becomes arg 0 at runtime, so a literal in
   `args[0]` is the wrong argument to check. Stage 0 bangs check normally.
6. **net literals:** `curl!("https://host/path")` parses via the WHATWG `URL`
   global (no I/O) and host-matches the net grants; a literal that isn't an
   absolute URL defers to runtime. The vm purity context provides `URL` for
   this reason. Hosts compare case-insensitively.
7. **Manifest = grants, not call sites.** Arrays mirror `needs` declaration
   order, no dedup. Statically-proven covered literals are recorded nowhere;
   `scoped` holds only fns with their own `needs` clause; deferred entries
   bubble to the scope whose manifest governs them (inheriting fns defer into
   the enclosing manifest). **Duplicate fn ids: last wins in `scoped`** —
   Phase 5 should reject redeclaration.
8. **DeferredCheck reason strings are pinned by the goldens**: piped vs
   non-literal (`(Identifier \`name\`)` / `(MemberExpr)` / `(absent)`) vs
   non-absolute-URL — keep the format stable; changing it regolds.
9. `compileManifest` (Section 7.3) lives in `shared/manifest.ts` with the Zod
   schemas and is unit-tested; the extractor emits `SerializedManifest` and
   uses `globToRegex` directly for its static checks. The spec's "extractor
   calls compileManifest once" is deferred to whoever hands the manifest to
   the guard (Phase 4 wiring decision; E407's manifest-hash question too).

### Post-phase audit (2026-09-16)

Full re-read of `extractor.ts` against Sections 2.1–2.3 / 5 / 7 / 11 after the
first green CI, hunting for escapes. Findings, all resolved:

1. **Security bug — E303 checked only the first needs token.**
   `checkAttenuation`'s switch cases `return`ed inside the token loop, so
   `fn f() needs only(net("api.example.com")), fs.read("/etc/passwd")` under a
   parent that never granted fs.read extracted cleanly (and the body's
   `/etc/passwd` literal then "covered" against the child's own inflated
   manifest). Fixed to `continue` (src/capability/extractor.ts). Regression
   fixture `e303-multi-token-escalation` reproduces the escape (verified to
   extract cleanly before the fix). Also dropped the unused `child` parameter.
2. **Untested net branch.** The `curl!` literal URL-parse path (E301 +
   non-URL defer) had only golden coverage on the happy path. Added
   `e301-uncovered-net` fixture and `tests/capability/extract.test.ts`
   (non-URL literal defers; attenuated-fn body literal is E301 against the
   CHILD manifest; inheriting fn passes covered literals with no `scoped`
   entry).
3. **Dead code removed:** `assert-never.ts` entry in the purity CLOSURE
   (nothing in the closure imports it since extractor uses its E304-flavored
   `unhandled`), and the unused `hostToRegex` re-export from
   `shared/manifest.ts` (Phase 4 can import from `glob-to-regex.js`).
4. Verified clean: no `any` / `@ts-ignore` / `@ts-expect-error` anywhere in
   `src/`; no dependency or config changes; goldens byte-stable; runner
   pairing/phase-filtering still correct (6 extract-phase fixture pairs).

CI gate after audit: 86/86 green.

## Phase 4 DoD checklist

- [x] `authorize()` canonicalizes (Section 2.2 step 5) **before** matching;
      symlink pointing outside every granted `fsRead` glob rejected with E403
      (`guard.test.ts` "symlink pointing outside"; real `symlinkSync` in a
      tmpdir sandbox).
- [x] Naive-string-match false-negative test: `../` whose string matches the
      grant but whose canonical resolution doesn't — the Phase 0 `traversal`
      fixture (E403) executes and passes through the negative runner, plus an
      existing-path unit variant and a write-side fixture
      (`e403-write-traversal`, exercises parent-dir canonicalization).
- [x] Net matching: exact default; `*.example.com` accepts `api.example.com`,
      rejects `evil.com` and `notexample.com` (substring false-positive class),
      and also rejects bare `example.com` (single-leading-label rule). E401.
- [x] Exec targets get the same realpath treatment: symlinked binary outside
      the granted exec pattern → E403 (escape class); plainly-outside binary
      → E405.
- [x] TOCTOU: `authorize` returns the canonical value byte-identical to
      `realpathSync` output, never the raw input (guard-side half; Phase 5's
      host-binding spy test completes the chain — no host-bindings exist
      before Phase 5 by phase discipline).
- [x] All Phase 0 guard fixtures execute and throw their paired
      `.expected-error.json` code exactly (`traversal` → E403).
- CI gate: green — 110/110, all E4xx exact (E401/E402/E403/E404/E405/E406
      live; E407 deliberately not, see decisions).

### Phase 4 deviations & decisions

1. **ESLint `node:`-prefix bypass closed** (user-approved in plan; Section 8.1
   in the md updated to match). `no-restricted-imports` listed only bare
   spellings, so `import 'node:fs'` sailed past the boundary in any src file.
   All 8 modules now have both spellings in the global rule; the guard.ts
   override gained `node:` variants plus `os`/`dgram`/`tls`/`fs/promises`
   (which the spec's override never restricted — prose says "fs for
   realpathSync only", config now says it too). **Proven both directions:**
   `node:fs` outside host-bindings → error, exit 1; `node:child_process`
   inside guard.ts → error, exit 1; fixtures deleted/restored after.
2. **Deny-code split** (user-approved): raw string matched a grant but the
   canonical value doesn't → **E403** (symlink/`..` escape class, what
   `traversal` pins); neither raw nor canonical matched → the category's
   plain code (E402/E404/E405). Fail-closed everywhere; invalid runtime URL
   → E401 ("no net grant can cover it").
3. **ENOENT → lexical fallback in `canonicalizeExisting`.** Spec says
   realpath for paths that must already exist but is silent on missing ones;
   without a fallback the committed `traversal` fixture (`/safe/../etc/passwd`,
   no root to create `/safe`) would throw raw ENOENT instead of E403. Safe
   because a path with missing components can't be resolved differently by a
   host op that *succeeds* — the host op ENOENTs too, so the fallback grants
   nothing. Other errnos propagate (I/O errors, not capability questions).
   fsWrite follows 2.2 step 5.2: realpath the parent, reject a residual
   `..`/`.` leaf → E403, canonical = parent-realpath + leaf.
4. **macOS canonicalization note:** `/var` → `/private/var`, `/etc` →
   `/private/etc` — canonical-only matching means grants built from
   unresolved paths self-destruct. Tests build grants from
   `realpathSync(tmpdir)`; document for users when `explain` lands (Phase 6).
5. **`BANG_REGISTRY` + `EffectCategory` exported** from extractor.ts (was
   module-private): the guard negative runner maps bang target → category
   through it, and Phase 5's planned "stdlib ⊆ registry" sync test needs it.
   Single source of truth preserved.
6. **`requireEnv(env)` takes the env record as a parameter** (callers pass
   `process.env`) — the guard stays free of ambient state reads and testable
   with plain objects. E406 on first missing non-optional var; optional
   absence fine. Per-read env authorization is Phase 5's to design (no env
   bang exists in the stdlib yet).
7. **E407 (manifest hash) deferred** to whoever wires instantiation with a
   provenance hash — Phase 5 evaluator or Phase 9 CLI. No caller exists to
   feed it a hash today; deciding the scheme now would be untested surface.
8. **Guard negative runner** (`tests/guard/negative.test.ts`) scans both
   `tests/guard/negative/` and `tests/capability/negative/` (where Phase 0
   put `traversal`), phase-filtered to `guard`. Pre-evaluator harness:
   lex → parse → extract (must pass) → `compileManifest` → walk the AST for
   `BangCall`s (exhaustive switch + assertNever, house style) → authorize
   literal `args[0]` via BANG_REGISTRY category → assert exact code. A guard
   fixture whose relevant arg isn't a string literal fails loudly — only the
   evaluator (Phase 5) can drive deferred values.
9. **`vite.config.ts` added** (new file, not in spec — dev tooling):
   direnv's `.direnv/flake-inputs/` holds full source snapshots of flake
   inputs and vitest was executing their tests (tsc/eslint never saw them;
   eslint ignores dot-dirs, tsconfig includes only src+tests). Excludes
   `.direnv/**` on top of vitest's defaults; exempted from eslint via
   `ignorePatterns` next to `scripts/` (typed linting needs tsconfig
   membership, which Section 8.2 pins to src+tests).
10. `CapabilityViolationError` lives in `shared/errors.ts` per the Phase 1
    convention (purity closure unaffected — no new imports). Guard imports
    only `node:fs` (realpathSync) + `node:path` (pure) + shared modules.

### Post-audit refinements (2026-09-16)

Whole-tree over-engineering audit after the Phase 4 gate; five cuts applied,
all CI-green:

1. **Guard negative runner walker (~90 → 7 lines).** The hand-rolled
   `walkStatements`/`walkExpr` exhaustive switches only collected `BangCall`s;
   replaced with a reflective `collectBangCalls` (array/object recursion, push
   on `kind === 'BangCall'`). Coverage cannot regress: `coverage.test.ts`
   still pins the Section 7.1 union exhaustively, and a collector miss would
   fail `executeAgainstGuard` ("expected a CapabilityViolationError, got none").
2. **Shared fixture loader (`tests/helpers/negative-fixtures.ts`).** The
   pairing/basename/read block was duplicated across five phase runners (the
   fifth copy added in Phase 4). One `loadNegativeFixtures(dir)` returns
   `{basename, source, rawExpected, expected}`; the five pairing `it`s are
   gone. Pairing enforcement moved into the loader as a loud throw —
   **re-proven to fire** with an orphan fixture (`negative fixture pairing
   broken in ...` + both file lists), removed after.
3. **`.eslintrc.json` patterns groups (~34 → 16 entries).** Bare + `node:`
   spellings collapsed into one `patterns` group per module (the `fs` group
   also covers `fs/*` subpaths); md Section 8.1 synced (also gained the
   missing `vite.config.ts` ignorePatterns entry). **Re-proven both
   directions:** `node:fs/promises` in a src fixture → error, exit 1;
   `node:child_process` in guard.ts → error, exit 1; `node:fs` in guard.ts →
   clean.
4. **Guard corpus test de-brittled.** Hardcoded
   `['e403-write-traversal', 'traversal']` replaced by `length >= 2` + every
   expected code matches `^E4\d{2}_` — no edit needed when a guard fixture is
   added, still catches corpus loss or a mis-phased fixture.
5. **`isENOENT` inlined** into `canonicalizeExisting` (single caller).

Net: -145 lines, -0 deps. Test count 110 → 105: five pairing `it`s became the
loader's throw, same enforcement (an unpaired fixture still fails CI).

## Next: Phase 5 — Tree-Walking Evaluator (DoD in Section 11)

Visitor interpreter, lexical scoping, closures capture defining env (by
reference — load-bearing since Phase 2's AssignExpr). Key notes accumulated
from Phases 2–4:

- **Stdlib wrapper shape:** resolve args → `CapabilityGuard.authorize` → call
  `/host-bindings` with the **returned canonical value**, never the original
  argument (TOCTOU, Section 2.2 step 6). Spy test: no host-binding entry
  point is reachable without an intervening `authorize` call — this also
  completes Phase 4's TOCTOU test.
- **Sync test:** every effectful stdlib name ⊆ `BANG_REGISTRY` (now
  exported); register env bang names when the stdlib actually defines them.
- **`print!`/`eprint!`:** route through the choke point but unconditionally
  authorized (Section 1) — the guard needs an ambient path when the stdlib
  lands; no manifest entry, no `needs`.
- **Scope wiring:** a fn with its own `needs` uses `guard.forScope(id)`
  (plain Error on missing id = wiring bug); inheriting fns use the enclosing
  guard. `requireEnv(process.env)` once per run before evaluation.
- **E407** manifest-hash scheme: decide when the evaluator/CLI actually
  wires instantiation.
- Reject duplicate `fn` redeclaration (Phase 3 let last-win in `scoped`).
- Assignment writes the nearest enclosing scope holding the binding, else
  E500; `#!strict` pipe-chain type pre-pass before first side effect
  (E501/E505); negatives E500–E505 will need real evaluation in the runner,
  not Phase 4's literal-arg harness.

