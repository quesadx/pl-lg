# Placitum — Build Progress & Handoff

> For the next AI agent: read `placitum-implementation.md` first (it is authoritative),
> then this file. Work one phase at a time; do not start Phase N+1 code until Phase N's
> CI gate is green (Section 0, rule 5). Phases 7 and 8 are deferred optional post-1.0
> work (user-approved 2026-09-16): the 1.0 build order is 0 → 6 then 9.

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
| **5 — Tree-Walking Evaluator** | **DONE** | green (2026-09-16) |
| **6 — `placitum explain`** | **DONE** | green (2026-09-16) |
| **7 — AI-Agent mode** | **DEFERRED** | optional post-1.0 (user-approved 2026-09-16) |
| **8 — `rewind`** | **DEFERRED** | optional post-1.0 (user-approved 2026-09-16) |
| **9 — CLI, packaging & hardening** | **DONE** | green (2026-09-16) — final release gate |

Gate runs, in order: `check-deps` → `tsc --noEmit` → `eslint` → `tsc -p
tsconfig.build.json` (build) → `vitest run` (= `npm run ci`). Last verified:
178/178 tests passing (10 phase0 + 16 lexer + 19 parser + 37 capability + 23
guard + 39 eval + 11 explain + 23 cli [13 e2e, 9 formatter, 1 console-ban]);
the 4 over the pre-fix 174 are the FIX-1 location assertions (see "Post-1.0
fixes" below).
Phase 9 added the `build` step to the CI chain (user-approved): it is the first
phase with an emit target, so a broken build config now fails the gate instead
of shipping silently.

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
6. **Phases 7 (AI-Agent mode) and 8 (`rewind`) deferred as optional post-1.0
   work** (user-approved 2026-09-16). Md amended: Section 0 rule 5, the
   Section 11 deferral note + Phase 7/8 headings, Phase 9's `--help`/CI-gate
   lines, and the `commander` allow-list row. The 1.0 build order is 0 → 6 → 9;
   the deferred phases' DoDs apply unchanged whenever they are built. Dormant
   until then: E7xx/E8xx codes, `tests/agent/`/`tests/replay/` naming, and the
   guard's ambient-write routing rationale (the routing itself already exists).

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

## Phase 5 DoD checklist

- [x] Closures capture their defining environment by reference — and the
      capability guard is captured lexically with them. Control-flow golden's
      `make_counter`/`bump` mutates captured `n` across calls (11/12/13).
- [x] Every effectful stdlib fn is a thin wrapper: args → `guard.authorize` →
      host binding called with the **authorized** value. `chokepoint.test.ts`
      spies both sides: the log is `authorize → host` per call, and a guard
      stub that stamps `canonical:` prefixes proves hosts never receive the raw
      argument (this also completes Phase 4's TOCTOU test).
- [x] `print!`/`eprint!` route through the same choke point, unconditionally
      authorized, no manifest entry, no `needs` (real-guard test).
- [x] Pipe semantics rules 1 & 2 golden: rosetta has both forms (`url |
      curl!({...})` prepend-into-args, `fs.readFile!(...) | json.parse` bare
      stage, `endpoint | fetch_status` user fn); control-flow adds
      `"mid" | surround("*")` and bang-on-pure-fn `surround!("z", "-")`.
- [x] `#!strict` runs its whole-program pipe pre-pass before evaluation; a
      chokepoint test proves E505 fires with captured stdout still empty (the
      chain's first side effect never ran).
- [x] Goldens: `rosetta.eval.golden.json` (the exact Section 6 script, fake
      hosts) + `control-flow.eval.golden.json` (if/else, while+assignment,
      for, closures, f-strings, both pipe rules, operator/deep-equal/truthiness
      matrix, top-level `return` stops before "never printed").
- [x] Negatives E500–E506 (9 fixtures, real evaluation): unbound read/assign,
      mixed `+`, non-callable, arity, `/0`, strict-pipe, fn + let
      redeclaration.
- [x] Sync test: `EFFECTFUL_STDLIB` == `BANG_REGISTRY` keys, ambient names
      excluded, `BANG_SIGNATURES` ⊇ registry+ambient, every bang implemented.
- [x] `requireEnv(env)` once per run in `runSource`; runtime E406 covered
      end-to-end; attenuated `needs only(...)` fn denies at runtime via
      `forScope` (E401 test) even when the parent granted the host.
- CI gate: green — 137/137, all E5xx exact.

### Phase 5 deviations & decisions

1. **Bangs receive the lexical guard at the call site (user-ratified fix).**
   First implementation built stdlib wrappers once over the top-level guard, so
   a `fn needs only(...)` body still authorized against the top manifest — the
   attenuation E401 test caught it. `buildStdlib(hosts)` now returns
   `BangFn = (guard, args)` and the evaluator threads the current lexical
   guard through evaluation; `Closure` captures `declGuard` + `attenuated`,
   swapping to `declGuard.forScope(fnId)` for its own `needs` clause. Matches
   the extractor's lexical walk exactly.
2. **`E506_EVAL_REDECLARATION` added** (user-approved; Section 9.2 catalog +
   appendix updated, Phase 5 DoD now says E500–E506). Required because
   `scoped` is keyed by fn id: a closure captured before a redeclaration would
   run against the *later* fn's attenuated manifest. Same-scope `let`/`fn`
   redeclare → E506; inner-scope shadowing stays legal (top-level `let json`
   collides with the stdlib global and is E506 too — consistent, fail-closed).
3. **Sync HTTP via one-shot subprocess** (user-approved): `execFileSync(
   process.execPath, ['--input-type=module', '-e', <tiny global-fetch
   script>])`, 30s timeout, output `{status, body}`. Failures wrap to E501.
   ponytail: one process per request; swap for an in-process Atomics bridge if
   volume matters. The localhost integration test runs its HTTP server in a
   **child process** — an in-process server deadlocks (execFileSync blocks the
   test process's event loop) and was the first run's 30s ETIMEDOUT.
4. **E501 is the eval runtime-error umbrella** for host failures (ENOENT,
   fetch failure, invalid JSON): no dedicated E-code exists; message names the
   operation and the hint says it was authorized (host failure, not denial).
5. **Semantic defaults (user-approved, all ponytail-commented in code):**
   `curl!` → `{status, body}`, options `{method?, body?}` GET default; JS-like
   truthiness; structural `==`; missing member → `null` (prototype chain never
   consulted); `+` num/num or str/str only; comparisons numbers only; `for`
   over arrays only; assignment expression yields the value; top-level
   `return` stops the program; `/0` → E504.
6. **Goldens run the permissive stub guard** (user-approved): rosetta's
   `/etc/config` + `api.example.com` grants would be platform-dependent under
   the real guard (macOS `/etc → /private/etc`). Real-guard behavior is
   covered separately with `realpathSync(tmpdir)` grants and a `127.0.0.1`
   fetch integration.
7. **Effectful names are never bound in the environment.** Only the pure
   `json` namespace is a global; `fs.readFile`/`curl`/`print` are reachable
   solely through `ctx.bangs` dispatch, so a plain `CallExpr` on them is E500
   by construction (Section 1 invariant held structurally, not by convention).
   Bang target resolution checks the effectful table first, then the env
   (pure fns may be banged; `json.parse!` resolves through the namespace).
8. **Strict pre-pass is pipe-chains-only** (per DoD): literals, bang/callee
   signatures (`BANG_SIGNATURES`, `PURE_SIGNATURES`), f-strings, arrays,
   objects, arithmetic/comparison results; identifiers/members are `unknown`
   and never a rejection reason. Runs over all statements before evaluation.
9. **E407 still deferred** (no provenance hash wired anywhere; revisit with
   the Phase 9 CLI instantiation). No `env.get` bang exists, so no env bang
   names were registered (Phase 3 decision 4 honored).
10. **New files:** `src/shared/values.ts`, `src/evaluator/interpreter.ts`,
    `src/evaluator/run.ts`, `src/stdlib/stdlib.ts`,
    `src/host-bindings/index.ts`; `EvalError` + `Guard` interface + ambient
    request kind added to existing shared/capability modules.
    Known ceiling: unbounded recursion is a raw RangeError (no depth limit);
    add one if a script ever needs it.

### Post-phase bug fixes (2026-09-16)

Adversarial probing of Phase 5 scripts surfaced two latent bugs (pre-existing,
both fixed with regression coverage; gate 140/140 after):

1. **Parser: `primaryParenthesized` was sticky.** After any parenthesized
   primary earlier in the file, every later bang call failed E205 —
   `let x = (1 + 2)` followed by `print!(x)` would not parse. The flag is now
   reset per primary; `(x).y!(...)` still E205 (fixture unchanged).
   Regression: control-flow golden gained a paren expression + bang line.
2. **Prototype-chain lookups on source-keyed plain objects.** `KEYWORDS` in the
   lexer returned `Object.prototype.constructor` for the identifier
   `constructor` (same for `toString`/`hasOwnProperty`/`__proto__`) — a
   garbage-kind token, surfacing as E104. `BANG_REGISTRY` (extractor),
   `ctx.bangs` + the signature tables (interpreter) and `manifest.scoped`
   (guard) had the same leak; the extractor's `scoped` map is now
   null-prototype so `fn __proto__() needs ...` cannot mutate its prototype.
   All lookups use `Object.hasOwn`. Regression: control-flow golden identifiers
   `constructor`/`valueOf` + `{ __proto__: 5 }` literal; real-guard chokepoint
   test with `fn constructor() needs only(...)` and `fn __proto__()
   needs only(...)`; E502 semantics cases for `constructor!`/`__proto__!`.

## Phase 6 DoD checklist

- [x] Purity smoke test analogous to Phase 3's: that phase's transpile/
      mini-require machinery was extracted to `tests/helpers/vm-sandbox.ts`
      (shared by both purity tests — `tests/capability/purity.test.ts`
      refactored onto it, behavior unchanged). The explain closure
      (`cli/explain.ts`, `shared/manifest.ts`, `shared/glob-to-regex.ts`,
      `shared/errors.ts`) runs in the vm with zod as the single allowlisted
      bare import (a pure validator — fs/net/os/child_process still don't
      exist in the context); rosetta renders byte-identical inside and
      outside the sandbox.
- [x] Output visually separates statically-proven grants from
      `deferredToRuntime` entries: `grants (statically proven):` (all five
      categories — `(none)` is an explicit claim, not an omission; net
      wildcards render raw; env shows `(required)`/`(optional)`), then each
      attenuated fn's scoped manifest (recursive — the extractor nests scoped
      for fns declared inside fns), then `deferred to runtime:` with
      `category [span] reason` lines; blank lines + two-space indents do the
      visual separation.
- [x] `tests/explain/rosetta.explain.golden.txt` + (user-approved)
      `kitchen-sink.explain.golden.txt` — rosetta alone renders no wildcard
      net, no optional env, no exec/fsWrite grants, no top-level deferred
      entries. Generated via `UPDATE_GOLDENS=1`, then hand-reviewed against
      the manifest goldens' patterns/spans/reason strings before commit.
- CI gate: green — 150/150, explain goldens byte-for-byte.

### Phase 6 decisions

1. **Renderer consumes the `SerializedManifest`, not the compiled
   `CapabilityManifest`.** It displays only raw patterns, and the serialized
   form is the published artifact (Section 2.2 step 3) that explain, audit
   and Phase 7 round-trip through JSON. `explain(manifest: unknown): string`
   validates via the existing zod schema; failure is
   `E603_EXPLAIN_RENDER_FAILURE` (first `CliError` — phase `cli`, added to
   `shared/errors.ts` per the class-hierarchy convention). Zod reuse was
   user-approved; it is why the purity harness gained its single allowlisted
   bare import.
2. **zod `z.record` silently drops an own `__proto__` key — explain must
   not.** A fn literally named `__proto__` is legal and deliberately
   preserved (extractor's null-proto `scoped`; guard/evaluator regression
   tests), but zod's record assigns entries into a plain object, so that
   child becomes the record's *prototype* instead of an own entry (probed:
   `own __proto__: false`). Since explain is the security-transparency
   surface, under-reporting a scoped manifest is a bug: `repairScoped`
   re-attaches any child present in the raw input but absent from the parsed
   output, re-validated through the same schema (never trusted because it
   "should" have passed), and recurses for nested scoped. Fail-closed on the
   recovered child's validation. Both regression tests (hand-built manifest
   and the real lex→parse→extract path) were **proven to fire** by reverting
   `repairScoped` (both fail), then the fix was restored.
3. **Canonicalization note pays the Phase 4 decision-4 debt.** One footer
   line (`note: path grants match the canonicalized path (symlinks and .. are
   resolved before matching)`) appears only when fsRead/fsWrite/exec grants
   exist. The top-level check is complete because E303 attenuation forbids a
   scoped child from carrying a path grant the parent lacks.
4. **Deferred spans render as raw source offsets** (`[168..192]`): the
   renderer has zero I/O, so it has no source text to translate them to
   line:col. A Phase 9 CLI could post-process if wanted; nothing re-derives.
5. **Renderer lives in `src/cli/explain.ts`** (Section 3 tree; E6xx is thrown
   by `cli/`). It *returns* the string and never prints — Phase 9's CLI owns
   stdout; Phase 6 ships no CLI wiring (no commander install yet, per phase
   discipline).
6. **Alignment constants are pinned by the goldens**: grant labels pad to 10,
   deferred categories to 9; `Object.entries` order = source declaration
   order, so output is deterministic.

### Post-phase fix (2026-09-16)

1. **Explain rendered manifest strings raw — control characters could forge
   output lines.** `\n` is a legal source-string escape, so the extractor can
   publish a grant pattern containing a newline; Phase 7 manifests are
   untrusted JSON with arbitrary `reason` and `scoped`-key strings. Rendered
   raw, `net("evil\n  exec      /bin/rm")` emitted a line indistinguishable
   from a genuine grant line in the transparency tool. `printable()` now
   JSON-quotes any string containing C0 controls/DEL, applied to every
   free-text field (patterns, env names, fn ids, deferred reasons) and the
   E603 detail; normal strings render verbatim (goldens unchanged).
   Regression test **proven to fire** before the fix (hand-built manifest;
   pipeline reachability is extractor-tested). Gate 151/151.

## Phase 9 DoD checklist

- [x] Every `PlacitumError` renders through the single Section 9.3 formatter:
      `src/cli/format-error.ts` is the only error->text function; `runCli`
      catches `PlacitumErrorBase` (and commander usage errors, re-coded E602)
      and writes `formatError(err.toEnvelope(), source)`. The grep-based CI
      check is `tests/cli/console-ban.test.ts`: zero `console.` in `src/`
      (host output stays in `/host-bindings`, CLI output in `cli/`).
- [x] `placitum run|explain --help` and `--version` (plus bare `placitum`)
      produce deterministic, tested output — same bytes across invocations,
      listed subcommands, `1.0.0` (package.json version asserted equal to the
      `VERSION` constant).
- [x] End-to-end release gate: the exact Section 6 Rosetta Stone script runs
      through `run` (stub hosts/guard for platform independence, per Phase 5
      decision 6) producing the pinned eval golden, and `explain` produces the
      exact explain golden byte-for-byte. Real full-stack verification of the
      built binary (`node dist/cli/bin.js`) with the real guard/hosts/fs done
      manually in a tmpdir (read + exit 0; E403 traversal renders with
      location and exit 1).
- [x] (Optional, non-blocking) secondary sandbox documented as skipped — see
      decision 7.
- [x] Packaging: `bin.placitum -> dist/cli/bin.js`, version `1.0.0`, `build`
      script + `tsconfig.build.json` (src-only include; the main config also
      includes `tests/`), build step added to the CI chain. `private: true`
      retained (local binary; no publish).

## Phase 9 deviations & decisions

1. **Script reading is a `/host-bindings` export, not a scoped ESLint
   exception.** `readSourceFile(path)` (raw `readFileSync`, errors unwrapped)
   lives beside the host bindings; the CLI maps any read failure to E601.
   This is harness I/O — the CLI reading its own input, like node reading a
   `.js` file — not a script capability: no bang, not in any manifest, no
   guard call. Section 0 rule 6 does not apply (nothing script-reachable was
   added).
2. **`runCli(argv, io): number` + `bin.ts`.** All process wiring sits in
   `src/cli/bin.ts` (`process.argv`/`stdout`/`stderr`/`exitCode`), making the
   whole CLI testable in-process — the release gate is a vitest test, not a
   subprocess invoker. `CliIo` carries the test seams (`readFile`, `env`,
   `guard`, `hosts`); production defaults are real. `bin.ts` is a separate
   entry file rather than an `import.meta.url === pathToFileURL(argv[1])`
   guard because npm's bin shims can `exec` a symlinked path, which would make
   the guard silently skip `main()` on global links.
3. **Commander wiring:** `exitOverride()` + `configureOutput.writeErr` no-op
   (commander's own error line is suppressed and re-rendered as E602, so
   stderr has exactly one shape); `exitCode === 0` commander errors (help,
   version, `help` subcommand) return 0 — their output already went to
   `writeOut`. `allowExcessArguments(false)`. Section 9.2's E602 covers
   unknown commands/options, missing arguments, and excess arguments.
4. **`E601` wraps any read failure** — ENOENT, EISDIR, EACCES — with the raw
   errno text in the message (fail closed; the truth is in the message). The
   catalog only defines the not-found case and inventing a second code would
   need a spec change.
5. **Guard denials now carry the bang-call location** (interpreter
   `locatedViolation`). Previously only `EvalError`s were located, so
   Section 9.3's excerpt format was unreachable for the runtime security
   errors it literally depicts. The error is rethrown as the same class with
   code/message/severity/hint preserved — never caught and discarded
   (Section 0 rule 7). New user-visible behavior: E401–E406 render with
   `--> file:line:col` + caret span.
6. **`printable()` hoisted to `src/shared/printable.ts`** (from
   `cli/explain.ts`), shared by explain and the formatter; the explain purity
   closure gained the file (no imports, still I/O-free). Formatter excerpt
   lines use a separate one-for-one C0 replacement (`?`, tab kept) because
   JSON-quoting a source line would break caret alignment — a script file can
   carry terminal escapes and the excerpt renders them.
7. **Secondary sandbox skipped, documented** (optional/non-blocking DoD, user
   approved): Node `--permission` / Deno permission flags express *static*
   allow-lists, but Placitum's reach is a runtime manifest per script
   (variables, globs, symlink-resolved paths). A generic jailed wrapper would
   either break legitimate grants or document a sandbox it cannot enforce;
   `CapabilityGuard` remains the enforcement layer and the import boundary is
   the build-time check. Revisit if per-script permission flags ever become
   expressible at spawn time.
8. **E407 (manifest provenance hash) still deferred** — the CLI hands the
   manifest extractor -> compileManifest -> guard in one straight in-process
   line, with no serialization boundary to tamper with; the hash protects the
   Phase 7 JSON round-trip. Wire it with Phase 7.
9. **`env()` remains declaration-only** in 1.0: the guard's `requireEnv`
   enforces presence (E406) but no `env.get` bang exists, so a script cannot
   read an env var — a pre-existing Phase 5 deferral (no guessed bang names),
   not a Phase 9 regression. Adding `env.get` later needs its TDD negatives
   per rule 6.

### Phase 9 post-phase audit (2026-09-16)

Adversarial probing of the CLI boundary after the first green gate:

1. **Excerpt lines rendered script-controlled bytes raw** — a shared
   `.placitum` file carrying terminal escapes would inject them into the
   runner's terminal the moment any error excerpted that line (the Phase 6
   explain-forgery class, new surface). Fixed: one-for-one C0/DEL -> `?`
   replacement (tab kept) so caret columns stay aligned; unit-tested with a
   real ESC byte.
2. **Every error class probed end-to-end through the built binary** (not just
   vitest): E101 + E301 (extract/lex errors excerpt through the formatter),
   E403 (guard denial with call-site location), E601 (missing file), E602
   (unknown/bogus flags). All rendered with the single formatter, exit codes
   0/1 correct, stdout clean on failure.
3. **Formatter fail-closed checks:** out-of-range location line -> excerpt
   skipped, header + hint still render (unit test added); missing span ->
   single caret; span past EOL -> clamped; span-less location -> arrow only.
   The formatter has no throw path (diagnostics cannot fail diagnostics).
4. **Real binary verified with real guard/hosts/fs** in a canonical tmpdir
   (`/private/tmp/...` on macOS): granted fs.read executes and prints, exit 0;
   traversal denies E403 exit 1. `dist/cli/bin.js` keeps the shebang; dist is
   gitignored; `npm link`/publish left to the user (private package).
5. Verified clean: no `any` / `@ts-ignore` / eslint-disable added; zero
   `console.` in src/; goldens untouched (151 prior tests byte-stable);
   check-deps sees commander from the Section 8.3 allow-list (8 direct deps).

CI gate after audit: 174/174 green.

## Post-1.0 fixes

### FIX-1 — E503 call-site location (2026-09-16)

Black-box execution of `placitum-v1-test-plan-3.md` (Rev. 2) against the
shipped binary found one product gap: `E503_EVAL_ARITY_MISMATCH` rendered
header+hint with no `-->` location, for all three throw sites (closure arity,
native arity, bang-native arity). Root cause: the arity checks live in callees
that have no AST node (`Closure.call`, `native`, `bangNative`), and the two
call chokepoints only located guard violations and E502. Fix (no checks moved):
`callValue` and `evalBangCall` now rethrow `located(err, node)` for any
`EvalError` that escaped without a location, never clobbering an inner one —
which also locates the previously-unlocated native `E501`s (`json.parse(1)`,
invalid JSON) for free. 4 new assertions in `tests/eval/semantics.test.ts` pin
exact line/col/span for fn/native/bang cases; black-box verified through
`dist/cli/bin.js` (all three shapes render excerpt + caret, exit 1). Gate:
178/178.

The same execution produced nine doc-only corrections (T-1..T-9) plus FIX-2
(expectation wording only, no code), applied as Rev. 3 of
`placitum-v1-test-plan-3.md`; evidence in `placitum-v1-test-plan-3-findings.md`.
Product behavior was correct in all nine — no other `src/` change.

## Post-1.0: LSP core prerequisites (2026-09-21)

User asked for the core-side contract required by `placitum-lsp-implementation.md` §5 (the
language server is built in a separate repo). All items landed; gate 199/199 (178 prior +
21 new).

- **Public barrel `src/index.ts` + package exports.** Exports the pure pipeline, the
  stdlib signature tables, manifest schema/compiler and the error types the LSP consumes;
  deliberately does NOT export the evaluator, guard, stdlib runtime or host-bindings.
  `package.json` gained `main`/`types`/`exports`/`files` and a `prepare` script so
  git-dependency installs build themselves; `private: true` retained (the LSP pins a
  commit SHA, not a semver).
- **`analyzeSource` (`src/analysis/analyze.ts`).** Never throws on malformed input:
  recovered `program`, `manifest` only when diagnostics is empty, every diagnostic,
  tolerant `tokens`, `comments` trivia, `complete` flag. Gating prevents cascades — a lex
  error skips parsing (partial tokens still returned for semantic tokens/completion), a
  parse error skips extraction.
- **Tolerant modes.** `lexTolerant` records lexical errors and advances deterministically
  per error kind (E101–E106) while collecting comment spans; `parseTolerant` panic-syncs
  at statement boundaries (NEWLINE consumed, RBRACE/EOF left for the enclosing loop),
  drops the failed statement, resets `groupDepth`, and synthesizes the E203 close at EOF.
  `lex`/`parse` keep the strict throw-first contract byte-for-byte — all existing goldens
  and negatives unchanged.
- **`src/analysis/strict.ts`.** The `#!strict` pre-pass moved verbatim out of
  `interpreter.ts`; `collectStrictDiagnostics` now owns the pragma gate (no pragma → `[]`)
  and collects every E505; `inferType`/`calleeSignature` exported for LSP hover. `evaluate()`
  throws the first collected error before any statement runs (chokepoint test still proves
  the chain's first side effect never executes).
- **Tests.** `tests/analysis/{analyze,strict,barrel-purity}.test.ts`; the vm-sandbox
  barrel test proves the public import closure is I/O-free. First CI run caught a real bug
  before landing: `recover()` ignored the tolerant flag, so strict `parse()` swallowed
  E2xx and 12 parser negatives failed — fixed at the root (one guard in `recover`), re-run
  green.

Note for the LSP repo: pin the commit that lands this (or a `lsp-v1` tag) and record it in
that repo's `docs/CORE-VERSION.md` per §5.4.

## Next: 1.0 complete

The `run`/`explain` surface, packaging, and final release gate are done. No
further phase is queued: Phases 7 (`infer`/`audit`/`run --attenuate`) and 8
(`rewind`) are user-deferred optional post-1.0 work with unchanged DoDs
(below). Open follow-ups if wanted: `npm link` (or publish) for a global
`placitum` command, an `env.get` bang, and the Phase 7/8 builds.

## Deferred (optional, post-1.0): Phases 7 & 8

User-approved 2026-09-16; md updated (Section 0 rule 5, Section 11 deferral note
and headings, Phase 9 DoD/gate, commander allow-list row). Build order is
0 → 6 → 9; their DoDs and CI gates apply unchanged whenever they are built.

Phase 7 notes (for whenever it is built): every LLM-produced script goes through
the real Phase 2 parser + Phase 3 extractor before any diff is shown;
manifest-shaped JSON is validated against `SerializedCapabilityManifestSchema`
(Section 7.3) and regexes are never accepted from JSON. Phase 6's
`explain(manifest)` is the rendering primitive for diffs, and `repairScoped`'s
lesson generalizes: **any manifest JSON that round-trips through `z.record` must
be checked for dropped `__proto__` scoped entries before a diff is trusted** —
the Phase 7 diff path is a disclosure surface and the "looks narrower than it
parses" adversarial fixture is exactly this class of bug.

Phase 8 notes: append-only log of effectful I/O with content hashes, E801–E803,
pure playback to step N then live resumption through the normal guard. The
ambient-write choke-point routing (Section 1) already exists in `guard.ts` /
`stdlib.ts`, so the log has a complete hook point when this lands.

