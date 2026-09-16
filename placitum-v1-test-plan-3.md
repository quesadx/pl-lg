# Placitum v1.0 — Release Test Plan (Reviewed Edition, Rev. 3)

**Covers:** Phases 0–6 and 9 (the shipped 1.0 surface: `run`, `explain`).
**Explicitly out of scope:** Phase 7 (AI-Agent mode: `infer`/`audit`/`run --attenuate`) and
Phase 8 (`rewind`). Both are deferred, post-1.0, and **not implemented** — this plan tests
that they fail safely rather than testing anything they'd do, and E7xx/E8xx codes are not
expected to be reachable anywhere below.

Source documents used to build this plan: `placitum-implementation.md` (v2.0, authoritative
spec) and `PROGRESS.md` (build log, current as of 2026-09-16, 178/178 automated tests green).

**Review provenance.** This edition was checked line-by-line against both source documents.
Ten substantive issues turned up — a platform-dependent expected result that was left vague,
a missing warning that invalidates most of one section's results on macOS, a real markdown
formatting bug, a security section with no positive control, a check that pointed at a tool
that can't do what was asked of it, two mis-numbered cross-references, and a few smaller
sharpenings. They're listed in full just below. Everything else in the original plan held up
under review and is carried over unchanged — it was already careful and well-caveated.

---

## Reviewer's note — what changed in this pass

1. **B-4's expected result was a shrug ("E402 or a host-level not-found — confirm which")
   when the spec actually answers this.** `/etc/config/app.json` is covered by the grant
   (`EXTRACT-POS2` already establishes single-`*` same-segment coverage), so the guard
   authorizes it; the failure is the *host operation* ENOENTing on a file that isn't there.
   Per `PROGRESS.md`'s Phase 5 decision 4, that's `E501_EVAL_TYPE_MISMATCH` — used as the
   umbrella code for host-level failures (ENOENT, fetch failure, invalid JSON), not a type
   error in the usual sense. Fixed, with the platform wrinkle noted below folded in.
2. **New §2.1, "Platform note — path canonicalization on macOS."** Nothing in the original
   plan warned that `/tmp`, `/etc`, and `/var` are themselves symlinks into `/private/...` on
   macOS, and that `CapabilityGuard` matches the *canonical* runtime path against the *raw*
   grant string (`PROGRESS.md` Phase 4 decision 4 states this outright: grants built from
   unresolved paths "self-destruct" on macOS, which is why the project's own automated tests
   build grants from `realpathSync(tmpdir)`). Without this, nearly every fixture in Part F
   silently tests the wrong thing on macOS: **a completely broken traversal check would still
   "pass" those tests**, because the grant never matches the canonical prefix at all, traversal
   or not. It also means Part B's B-2 can never complete end-to-end on macOS, independent of
   whether the referenced file exists. Both are now called out explicitly, with a concrete
   fix for Part F and an honest "no fix exists" for Part B.
3. **Part F had a real markdown bug and a real coverage gap.** `G-401-pos`, `G-406b`, and
   `G-406c` were written as 3-cell rows inside a 4-column table, so they rendered shifted one
   column left (fixture text landing under the "Code" header). Separately, Part F — alone
   among the lettered Parts — had no positive control proving a legitimately-granted
   `fs.read`/`fs.write` actually succeeds; every other row in the section demonstrates a
   *denial*, which means a guard that denies everything unconditionally would pass the whole
   section. Fixed by splitting the positive cases into their own 3-column table (matching the
   convention Parts C/D/E already use) and adding `G-402-pos` / `G-404-pos`.
4. **PARSE-POS3 told the tester to use `explain` to check whether a pipe chain parses flat.**
   `explain` renders the capability manifest (Phase 6's `CapabilityManifest → Stdout String`);
   it has no AST-inspection surface at all, so that check never worked as written. Rewritten
   to test the actual externally-observable *consequence* of flat-vs-nested parsing — a
   `BangCall` buried in a pipe's middle stage must still be found by the extractor's flat
   scan — which `explain` genuinely can show, and which is the property Section 5 rule 3
   actually cares about protecting.
5. **LEX-102's fixture was ambiguous between two different error codes.** `f"value: {1 + 2"`
   ends in `2"` — inside an open interpolation, that trailing `"` could just as easily start a
   fresh (now-unterminated) string token as it could terminate the outer f-string, meaning the
   fixture could plausibly throw `E101` instead of the intended `E102`. Removed the trailing
   quote so only "hits EOF with the interpolation still open" is possible.
6. **EXTRACT-302's fixture wasn't grounded in anything either document actually says fails to
   compile.** `/etc/[invalid` guesses at a bracket-class failure, but Phase 3's own notes in
   `PROGRESS.md` say the compiler renders "metachars literal" — which reads as *escaping* odd
   characters rather than rejecting them. Replaced with a pattern that violates a rule the
   documents do state explicitly (`**` is "whole segment only"): `/etc/**config`. Still marked
   advisory rather than blocking in Appendix A, since this remains a best-effort guess.
7. **G-405's hedge is now a specific best guess, not just "record whichever."** Given `exec`
   is absent from every `BANG_REGISTRY` listing anywhere in `PROGRESS.md`, an `exec!(...)`
   call should resolve at evaluation time as neither a registered effectful stdlib entry nor
   an ordinary bound identifier — i.e. most likely `E500_EVAL_UNBOUND_VAR`, not `E502`. Still
   advisory (see footnote in Appendix A).
8. **G-406a wasn't checking the property that actually matters.** Per the Phase 5 DoD,
   `requireEnv` runs once, before any statement evaluates — so a missing `env(...)` var should
   produce **zero stdout**, exactly like B-3's env-before-network check. Added that assertion
   explicitly instead of leaving it implicit.
9. **Appendix A's release-blocking paragraph silently dropped two entire row groups.**
   Neither `SETUP-1..6` nor `B-1..B-4` appeared in either the "release-blocking" or the
   "high-priority, triageable" sentence — meaning a project that doesn't even build, or whose
   own flagship example script doesn't run, had no formally-assigned severity. Both are now
   explicit blockers.
10. **Two mis-numbered cross-references** ("see G-401-pos in Part 7" and "using G-403-traversal
    from Part 7") both actually point at Part F (§9); "Part 7" doesn't exist in this document's
    numbering. Fixed both. Also cleaned up ID-precision in Appendix A (`502a-b` instead of
    folding it into a range that implies a bare `502`; `202a-c`; `602a-d`) and added a concrete
    fixture to EXPLAIN-6's negative case, which previously described a check without giving
    the tester anything to run.

---

## Reviewer's note — round 2 (independent cross-check against source docs)

A second pass, checked directly against `placitum-implementation.md` and `PROGRESS.md` rather
than against the first review's own reasoning, found four more issues — three of them in
rows this document marks release-blocking. All four are fixed in place below; nothing else
changed.

1. **EXTRACT-POS5 had `needs` after a `let`.** `needs net("example.com")` appeared as the
   *second* statement, following `let userUrl = ...`. Per Section 4's grammar, `NeedsDecl` is
   only legal before any non-`needs` statement at the top level — this fixture would throw
   `E202_PARSE_NEEDS_NOT_AT_TOP` before extraction ever ran, never exercising the
   non-literal-argument deferral it was meant to test. Fixed by moving `needs` to line 1.
2. **PARSE-POS3's "corrected" expectation still contradicted `PROGRESS.md`'s own Phase 3
   decision 5.** That decision states any bang call at pipe position `i ≥ 1` **always
   defers** — the piped value becomes `args[0]` at runtime no matter what's written in
   source. The fixture puts `fs.readFile!()` at pipe position 1 and then asked the tester to
   confirm the grant shows up under `grants (statically proven):`; a correct implementation
   will instead (correctly) put it under `deferred to runtime:`, so the test as written would
   fail against working code. Rewritten to expect a `category: fsRead` entry under
   `deferred to runtime:`, with the actual property under test being that the entry appears
   **at all** (a nested-parse bug would drop it silently, not just miscategorize it).
3. **EXTRACT-POS6 and REGR-4 were missing the top-level grant their own child `only(...)`
   needed.** Both fixtures declare `fn __proto__() needs only(net("a.com")) { ... }` with no
   preceding `needs net("a.com")` at the top level. Per Section 2.3, a child's `only(...)`
   must be a strict subset of the *enclosing* manifest, and a top level with no `needs` at
   all has an empty manifest — so `only(net("a.com"))` against nothing is an escalation and
   throws `E303_EXTRACT_ATTENUATION_ESCALATION`, not the clean extraction/explain output both
   tests expect. (Contrast with EXTRACT-POS4 immediately above POS6 in the original, which
   *does* include the top-level grant and was correct as written.) Fixed by adding
   `needs net("a.com")` as the first line of both fixtures.
4. **Two minor nits:** Appendix A's parser row listed `203..206`, which reads as a
   contiguous 203/204/205/206 even though 205 only exists as `205a`/`205b` — brought in line
   with how `502a-b`/`202a-c`/`602a-d` are already written elsewhere in the same table.
   G-403-traversal's claim that it's "the exact scenario Section 9.3's formatter example
   depicts" is now "mirrors the exact shape" — same rendered structure and the same
   `secrets` variable name, but the literal path necessarily differs (a test tmpdir, not
    `../../etc/passwd`).

---

## Reviewer's note — round 3 (post-execution corrections)

This edition was executed against the shipped 1.0 binary (commit `5d1bac1`, macOS,
2026-09-16); the full evidence log and per-test observations live in
`placitum-v1-test-plan-3-findings.md`. The verdict was shippable — no blocking product bugs —
and the corrections below (T-1..T-9 there, plus FIX-2's wording-only note) are applied in
place here; product behavior was correct in every case, so no `src/` change follows from any
of them. The one product fix to come out of that execution — `E503_EVAL_ARITY_MISMATCH` now
carries a source location (FIX-1 in the findings file) — added 4 evaluator assertions, so the
automated baseline throughout this doc is now 178/178 (was 174/174).

1. **T-1/T-7 — macOS canonicalization: the mechanism is "existing paths only."** The guard's
   lexical fallback for missing paths (`PROGRESS.md` Phase 4 decision 3) means a missing
   `/etc/config/app.json` fails `E501` ENOENT on macOS too, exactly as on Linux; only an
   *existing* file canonicalizes to `/private/etc/...` and gets `E403`. B-2, B-4, and §2.1 now
   state both modes instead of the blanket "can never match".
2. **T-2 — Part F's net/fs denials use deferred targets.** Literal bang arguments outside the
   grant are preempted by `E301` at extraction (fail-closed), so the `E401`/`E402`/`E404`
   codes the rows target were unreachable as written. Five rows now build the target from a
   variable so the guard is the layer under test, with a note explaining why; the no-network
   property on G-401a still holds.
3. **T-3 — EVAL-506c's fixture never called `f()` and used `;`** (not a token in the
   grammar), so it printed only `1`. Replaced with the verified fixture that prints `2`, `1`.
4. **T-4 — PARSE-POS2 gained its top-level `needs net("a.com")`.** Without it the round-2 rule
   from EXTRACT-POS6/REGR-4 applies: parse succeeds but the row hits `E303`.
5. **T-5 — G-405 records the actual code, `E502`**, not the round-1 `E500` guess. E405 is
   script-unreachable in 1.0; §1.1 now records this as resolved.
6. **T-6 — EXTRACT-302 fires exactly as written** (`"/etc/**config" uses "**" inside the
   segment "**config"`, matching the repo's own `e302-invalid-glob` fixture); the advisory
   hedge is dropped from §1.2, the row, and Appendix A.
7. **T-8 — §12's format snippet is illustrative of shape, not byte layout.** The shipped
   formatter renders the full envelope code and a one-space gutter, and the caret spans the
   whole denied bang call (Phase 9 decision 5); `tests/cli/format-error.test.ts` is the pinned
   byte format. DEFER-4/5's expected wording now matches commander's actual message.
8. **T-9 — SEM-3/SEM-4 use reachable resources**: the local `127.0.0.1:8991` server and a
   canonical `$SAFE_ROOT` file, instead of the IANA example domain and the unmatchable `/etc`
   grant.
9. **FIX-2 (no code change):** `run --attenuate` / `--rewind-to=3` are rejected with an
   unknown-command-style `E602` naming the full argv. Exit status and no-fallthrough are
   correct; the plan's expectation was the only inaccuracy (folded into T-8 above).

---

## 0. How to use this document

This is a **black-box / end-to-end test plan** for a human (or agent) tester to run against
the actual built `placitum` binary. It is a companion to — not a replacement for — the
existing automated `vitest` suite. The automated suite proves the implementation matches its
own golden files; this plan proves the *shipped product* behaves the way the specification
says it should, including several places where the two documents describe past bugs that
are worth re-checking as regressions.

Every test has:
- **ID** — for tracking in the checklist (Appendix A).
- **Setup** — a `.placitum` script and/or shell commands.
- **Action** — the command to run.
- **Expected** — what should happen (exit code, stdout/stderr shape, error code).

**Revision history caveat (superseded).** Rev. 2's fixtures were derived from the spec before
execution; this section originally warned that some might need adjustment against the real
parser. Rev. 3 closes that loop: the full suite was executed against the shipped binary on
2026-09-16 (evidence in `placitum-v1-test-plan-3-findings.md`), and every fixture below is
the corrected, verified version. §1's items are annotated with their observed resolutions
where execution settled them; a fixture that still fails is now either a product bug or a
plan bug worth recording, not an expected documentation gap.

---

## 1. Known ambiguities — verify these first

Before running the suite, spend ten minutes confirming these, since several later tests
depend on the answer:

1. **Is `exec!` actually wired to a stdlib bang function?**
   **Resolved by execution (2026-09-16):** no — `BANG_REGISTRY` contains only
   `fs.readFile` / `fs.writeFile` / `curl`; no `exec` bang exists in 1.0, and the Rosetta
   Stone example never calls one. An `exec!(...)` call reaches the evaluator, finds no
   registered effectful entry and no ordinary binding, and throws
   `E502_EVAL_NOT_CALLABLE: bang target \`exec\` is not defined` — an earlier, fail-closed
   failure. `E405_GUARD_EXEC_DENIED` is therefore **script-unreachable in 1.0**; it exists in
   `guard.ts` and is exercised only by direct guard unit tests. G-405 below records this.
2. **Exact "invalid glob" trigger for E302.**
   **Resolved by execution (2026-09-16):** `needs fs.read("/etc/**config")` fires E302 exactly
   as written (`"/etc/**config" uses "**" inside the segment "**config"`), matching the
   repo's own `tests/capability/negative/e302-invalid-glob` (`a**b`). The rule is real, not
   advisory: `**` is valid only as a whole path segment. EXTRACT-302 is now release-blocking
   like its siblings.
3. **Exact `#!strict` pipe-type-error trigger for E505.** The spec confirms the pre-pass
   checks literals, bang/pure signatures, f-strings, arrays, objects, and arithmetic/
   comparison results, and that identifiers/members are `unknown` (so they can't be the
   thing that trips it). §8's E505 test is a best effort at a signature-level mismatch —
   adjust the offending stage if it doesn't fire, but keep the **assertion that matters**:
   no side effect before the failing stage ran.
4. **`env(NAME)` has no way to read the value.** Per `PROGRESS.md` Phase 9 decision 9, there
   is no `env.get` bang in 1.0. `needs env(...)` only gates *presence* at start (E406); a
   script cannot retrieve the variable's contents. Tests below only check presence, never
   value.
5. **CLI subcommand names.** This plan assumes `placitum run <file>` and
   `placitum explain <file>`, matching every reference in `PROGRESS.md`. Confirm with
   `placitum --help`.

---

## 2. Prerequisites

```bash
# From a fresh clone, per PROGRESS.md's documented environment:
nix develop --command bash -c "npm ci && npm run ci"
```

Record the summary line. Expected baseline (per `PROGRESS.md`, last verified 2026-09-16,
including the `E503`-location fix whose 4 new assertions took it from 174 to 178):

```
178/178 tests passing
(10 phase0 + 16 lexer + 19 parser + 37 capability + 23 guard + 39 eval + 11 explain
 + 23 cli [13 e2e, 9 formatter, 1 console-ban])
```

Gate order: `check-deps` → `tsc --noEmit` → `eslint .` → `tsc -p tsconfig.build.json` (build)
→ `vitest run`.

| ID | Check | Expected |
|---|---|---|
| SETUP-1 | `nix develop` opens interactively | node 22 + npm on `PATH` |
| SETUP-2 | `npm run ci` full gate | exit 0, 178/178, order above |
| SETUP-3 | `ls dist/cli/bin.js` after build | file exists |
| SETUP-4 | `head -1 dist/cli/bin.js` | shebang line (`#!/usr/bin/env node` or similar) |
| SETUP-5 | `grep '"version"' package.json` | `1.0.0` |
| SETUP-6 | `grep '"private"' package.json` | `true` |

If SETUP-2 doesn't match 178/178 exactly, **stop and reconcile against `PROGRESS.md` before
continuing** — the rest of this plan assumes that baseline is currently green.

From here on, assume a `placitum` binary is on `PATH` (via `npm link`, `node dist/cli/bin.js`,
or an alias) unless a test says otherwise. Substitute freely.

### 2.1 Platform note — path canonicalization on macOS

Read this once before running anything in Part F (guard) or the real-filesystem cases in
Part B.

`CapabilityGuard.authorize()` canonicalizes every runtime path with `fs.realpathSync` (or a
lexical fallback for paths that don't exist yet — see G-403-write) *before* matching it
against a grant (implementation §2.2 step 5). It matches that **canonical** value against a
regex compiled from the **raw, unresolved** grant string (implementation §2.1) — the grant
string itself is never canonicalized, because static extraction never touches the disk.

On macOS, `/tmp`, `/var`, and `/etc` are themselves symlinks into `/private/...`.
`PROGRESS.md`'s Phase 4 decision 4 calls this out directly: grants built from unresolved
paths "self-destruct" on macOS, which is exactly why the project's own automated tests build
grants from `realpathSync(tmpdir)` rather than a literal path. On Linux none of `/tmp`,
`/var`, `/etc` are symlinks, so this never comes up.

**Practical effect if you skip this:**
- Every fixture in Part F below that writes `needs fs.read("/tmp/placitum-tests/safe/**")`
  (or the `fs.write` equivalent) as a literal grant will deny *every access to an existing
  path* under that directory on macOS — including the ones that are supposed to succeed —
  regardless of whether the specific test is exercising a traversal bug. (A path that does
  *not* exist takes the guard's lexical fallback instead — `PROGRESS.md` Phase 4 decision 3
  — and fails later, on the host operation, as `E501`.) The traversal fixtures
  (`G-403-*`) will still report `E403`/`E402`, but possibly for the wrong reason: not because
  the traversal logic caught anything, but because the grant never matched the canonical
  prefix at all. **A completely broken traversal check would pass those tests too**, on an
  unpatched macOS grant. Treat any Part F result on macOS as provisional until the fix below
  is applied.
- Rosetta's own `needs fs.read("/etc/config/*.json")` (Part B) can **never fully succeed** on
  macOS as literally written. Two failure modes, depending on whether the file exists:
  *present* → it canonicalizes to `/private/etc/config/app.json`, which the raw grant string
  never matches (`E403_GUARD_PATH_TRAVERSAL`); *absent* → the guard's lexical fallback
  (`PROGRESS.md` Phase 4 decision 3) lets the raw grant match, and the host operation then
  ENOENTs (`E501_EVAL_TYPE_MISMATCH`, the documented host-failure umbrella). B-2 is not
  achievable end-to-end on macOS either way; see the revised B-2/B-4 notes in Part B.

**Fix, for Part F:**

```bash
mkdir -p /tmp/placitum-tests/safe
SAFE_ROOT="$(cd /tmp/placitum-tests/safe && pwd -P)"   # canonical form
TESTS_ROOT="$(dirname "$SAFE_ROOT")"                    # identical to the literal
echo "Use this prefix in every fs.read()/fs.write() grant in Part F: $SAFE_ROOT"
```

Every `needs fs.read("/tmp/placitum-tests/safe/**")` (and the `fs.write` equivalent) in Part F
below should use `$SAFE_ROOT` in place of the literal `/tmp/placitum-tests/safe`. On Linux
this is a no-op — `$SAFE_ROOT` prints back the same string. On macOS it prints
`/private/tmp/placitum-tests/safe`. The **bang-call argument being tested** (the traversal
target itself) does *not* need this treatment — it gets canonicalized at runtime no matter
what prefix you type, which is the entire point of G-403-traversal.

**No fix exists for Part B's `/etc/config/*.json`** — it's the literal spec example, and
`/etc` isn't yours to remap. For a genuine end-to-end B-2 pass, run it on Linux (a container
is enough), or accept that B-2 is Linux-only for this release.

---

## 3. Fixture workspace

Run everything from a scratch directory so nothing here touches the repo itself:

```bash
mkdir -p /tmp/placitum-tests && cd /tmp/placitum-tests
mkdir -p scripts safe unsafe other
```

Individual scripts are given inline below with the filename to save them under, relative to
`/tmp/placitum-tests/scripts/`. (`other/` is referenced by G-402/G-404 as `$TESTS_ROOT/other`.)

---

## 4. Part A — CLI surface: help, version, bare invocation

| ID | Command | Expected |
|---|---|---|
| CLI-A1 | `placitum --version` | prints `1.0.0`, exit 0 |
| CLI-A2 | `placitum --help` | lists `run` and `explain` **only** — no `infer`, `audit`, `rewind` — exit 0 |
| CLI-A3 | `placitum` (no args) | deterministic help/usage output, exit 0 (per `PROGRESS.md`: "commander errors with exitCode 0 — help, version, help subcommand — return 0") |
| CLI-A4 | `placitum help` | same shape as CLI-A3, exit 0 |
| CLI-A5 | `placitum run --help` | usage for `run`, exit 0 |
| CLI-A6 | `placitum explain --help` | usage for `explain`, exit 0 |
| CLI-A7 | Run CLI-A1/A2/A3 twice each | **byte-identical output both times** (DoD requires deterministic output) |

---

## 5. Part B — Happy path: the Rosetta Stone script

`scripts/rosetta.placitum` (verbatim from spec Section 6):

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

| ID | Test | Notes |
|---|---|---|
| B-1 | `placitum explain scripts/rosetta.placitum` | No filesystem/network needed — extraction is pure. See Part H for the exact expected shape. |
| B-2 | `placitum run scripts/rosetta.placitum` against **real** `/etc/config/app.json` + real `api.example.com` | Needs real network + a real config file at that exact path — only attempt this if your environment genuinely has both, **and see §2.1: this cannot complete on macOS either way**. With the file *absent*: the guard's lexical fallback matches the raw grant and the host operation ENOENTs — `E501` (same as Linux). With the file *present*: it canonicalizes to `/private/etc/...`, which the raw grant never matches — `E403_GUARD_PATH_TRAVERSAL`. This exact scenario is already pinned byte-for-byte by `tests/eval/rosetta.eval.golden.json` against **stub** hosts, so a real-world run is a bonus sanity check on Linux, not the primary evidence. |
| B-3 | `placitum run scripts/rosetta.placitum` with `/etc/config/app.json` present but `API_KEY` unset | Expect `E406_GUARD_ENV_MISSING`, before any network or filesystem call — `requireEnv` runs once, before any statement, per the Phase 5 DoD. Assert stdout is empty. |
| B-4 | `placitum run scripts/rosetta.placitum` with `API_KEY` set but no file at `/etc/config/app.json` | On **both Linux and macOS**: the grant statically covers `/etc/config/app.json` (single `*` matches a same-segment literal, per EXTRACT-POS2), and the missing path takes the guard's lexical fallback, so the guard authorizes it — the *host operation* then ENOENTs. Per Phase 5 decision 4, that's `E501_EVAL_TYPE_MISMATCH` (the documented umbrella code for host-level failures), not a guard denial. Confirm the hint names the operation and says it was authorized (a host failure, not a capability denial), per that same decision. One platform wrinkle: if a file *did* exist at that path, macOS would canonicalize it to `/private/etc/...`, which the raw grant never matches — that variant is `E403_GUARD_PATH_TRAVERSAL`, not `E501`. |

For a fully offline positive-path re-creation of the same shape (no real network needed), use
a local file + a local HTTP server — see G-401-pos in Part F (§9).

---

## 6. Part C — Lexer (`E1xx`)

Each of these is a **parse-time** failure — run with `placitum run` (or `explain`, same
extraction-time surface for these), and check the error code plus that `location.line/col`
land on the offending character.

| ID | Code | Fixture (`scripts/<id>.placitum`) | Expected |
|---|---|---|---|
| LEX-101 | `E101_LEX_UNTERMINATED_STRING` | `let x = "unterminated` | fails before EOF, code exact |
| LEX-102 | `E102_LEX_UNTERMINATED_FSTRING_EXPR` | `let x = f"value: {1 + 2` (note: no trailing `"` — see below) | unterminated `{` in f-string, hits EOF while still inside the interpolation |
| LEX-103 | `E103_LEX_INVALID_ESCAPE` | `let x = "bad \q escape"` | unknown escape |
| LEX-104a | `E104_LEX_UNEXPECTED_CHARACTER` | `let x = !true` | `!` not after an identifier chain |
| LEX-104b | `E104_LEX_UNEXPECTED_CHARACTER` | `print!("ok")` on line 1, then `foo !()` on line 2 | `!` preceded by **whitespace** — still illegal even though `foo` is an identifier (no offset adjacency) |
| LEX-105 | `E105_LEX_INVALID_PRAGMA` | `let x = 1` then `#!strict` on line 2 | pragma only legal on physical line 1 |
| LEX-106 | `E106_LEX_INVALID_NUMBER` | `let x = 1.2.3` | malformed number |

**On LEX-102's fixture:** the original version of this test ended with a trailing `"`
(`f"value: {1 + 2"`), which is ambiguous — inside an open `{` interpolation, the lexer is
back in ordinary token mode, so that trailing `"` could just as plausibly start a *new*
(now-unterminated) string literal as it could close the outer f-string, meaning the fixture
could throw `E101` instead of the intended `E102` depending on how the real lexer treats a
bare quote inside an interpolation. Dropping the trailing `"` removes the ambiguity: the only
way to reach EOF from here is with the `{` still open, which is exactly what `E102` covers.

Also confirm the **positive** side of a couple of these while you're in here:

| ID | Fixture | Expected |
|---|---|---|
| LEX-POS1 | `#!strict` as the literal first line of a file, then a blank line, then code | pragma accepted, no `E105` |
| LEX-POS2 | `let x = f"a {1+1} b \{literal\} c"` | escaped braces render as literal `{`/`}`, interpolation still works |
| LEX-POS3 | A line starting with a bare `#` comment, and a comment-only run of several lines | no lex error, collapses to one NEWLINE per spec |

---

## 7. Part D — Parser (`E2xx`)

| ID | Code | Fixture | Expected |
|---|---|---|---|
| PARSE-201 | `E201_PARSE_UNEXPECTED_TOKEN` | `let 5 = x` | `let` requires an identifier target |
| PARSE-202a | `E202_PARSE_NEEDS_NOT_AT_TOP` | `if true {`<br>`    needs fs.read("/tmp/*")`<br>`}` | `needs` inside an `if` block |
| PARSE-202b | `E202_PARSE_NEEDS_NOT_AT_TOP` | `needs fs.read("/tmp/*")`<br>`let x = 1`<br>`needs net("example.com")` | second top-level `needs`, separated by a statement |
| PARSE-202c | `E202_PARSE_NEEDS_NOT_AT_TOP` | `fn f() {`<br>`    let x = 1`<br>`    needs fs.read("/tmp/*")`<br>`}` | `needs` after a fn's first non-`needs` statement |
| PARSE-203 | `E203_PARSE_UNTERMINATED_BLOCK` | `fn f() {`<br>`    let x = 1` (no closing `}`, EOF) | missing `}` |
| PARSE-204 | `E204_PARSE_INVALID_CAPABILITY_TOKEN` | `needs fs.read(123)` | capability pattern must be a `STRING`, not a number |
| PARSE-205a | `E205_PARSE_INVALID_BANG_CALL_TARGET` | `let x = getFn().g!(1)` | bang after a prior `(...)` call in the chain |
| PARSE-205b | `E205_PARSE_INVALID_BANG_CALL_TARGET` | `let x = (y).z!(1)` | bang after a parenthesized primary |
| PARSE-206 | `E206_PARSE_DUPLICATE_PARAM` | `fn f(a, a) { return a }` | repeated parameter name |

Positive/coverage checks:

| ID | Fixture | Expected |
|---|---|---|
| PARSE-POS1 | `needs fs.read("/tmp/*")` as the very first line of the file | legal top-of-program position, no `E202` |
| PARSE-POS2 | `needs net("a.com")`<br>`fn f(x) needs only(net("a.com")) { return x }` | legal fn-level position, no `E202` — and with the top-level grant present, the child `only(...)` is a legal subset, so `explain` exits 0 cleanly. (Without line 1, the child request escalates past an empty parent manifest and throws `E303`; parse still succeeds, so the row would read as a failure unless you know that round-2 rule.) |
| PARSE-POS3 | See below — tests that a flat, multi-stage pipe chain is parsed correctly | see rationale and fixture below |
| PARSE-POS4 | `let a = (1 + 2)` on one line, then `print!(a)` on the next | **this is the exact `primaryParenthesized`-stickiness regression** (see REGR-3) — a parenthesized primary earlier in the file must not poison a later, unrelated bang call |

**PARSE-POS3, corrected.** The original version of this check suggested confirming pipe
flatness "via `explain` or by inspecting behavior." Neither works as stated: `explain`
renders the `CapabilityManifest`, not the AST, so it has no way to show whether a `PipeExpr`
parsed flat or nested — and pure runtime behavior is also a poor proxy, since a linear
left-fold evaluator would very likely produce the same visible output whether the underlying
AST were flat or nested.

What flatness actually protects, per Section 5 rule 3, is the extractor's ability to find
*every* `BangCall` in a pipe chain by scanning a single flat array. That claim genuinely is
black-box observable: put an effectful bang call in the **middle** of a three-stage pipe and
confirm the extractor still finds and correctly categorizes it via `explain` — no real file
needs to exist, since extraction never touches disk.

```placitum
needs fs.read("/etc/config/*.json")

let path = "/etc/config/app.json"
let result = path | fs.readFile!() | json.parse
print!(result.ok)
```

Run `placitum explain scripts/parse-pos3.placitum` (not `run` — no real file is needed) and
confirm a `category: fsRead` entry for this call appears under `deferred to runtime:`.
**This is the expected outcome, not a bug to route around:** per `PROGRESS.md`'s Phase 3
decision 5, any bang call at pipe position `i ≥ 1` always defers, because the piped value
becomes `args[0]` at runtime regardless of what's written in source — a literal-looking
`fs.readFile!()` here is never statically provable. What the flatness property actually buys
you is that the entry shows up **at all**: if the extractor only scanned the first or last
stage of the pipe (a nested-parse symptom), this middle-stage `BangCall` would be missed by
the scan entirely and the deferred entry would be silently absent from the manifest —
*that* absence, not which section it lands in, is the failure mode this test is checking for.

---

## 8. Part E — Static Capability Extraction (`E3xx`)

| ID | Code | Fixture | Expected |
|---|---|---|---|
| EXTRACT-301a | `E301_EXTRACT_UNCOVERED_CAPABILITY` | `let data = fs.readFile!("/etc/passwd")`<br>`print!(data)` (no `needs` at all) | literal fs target, nothing covers it |
| EXTRACT-301b | `E301_EXTRACT_UNCOVERED_CAPABILITY` | `let r = curl!("https://evil.com/data")`<br>`print!(r)` (no `needs`) | literal net target, nothing covers it |
| EXTRACT-302 | `E302_EXTRACT_INVALID_GLOB` | `needs fs.read("/etc/**config")` | `**` used mid-segment rather than as a whole segment on its own — violates the documented "`**` (whole segment only) crosses `/`" rule (`PROGRESS.md` Phase 3 notes). **Confirmed by execution (2026-09-16):** fires exactly as written (`"/etc/**config" uses "**" inside the segment "**config"`), matching the repo's own `e302-invalid-glob` unit fixture. Release-blocking like its siblings (see §1.2). |
| EXTRACT-303a | `E303_EXTRACT_ATTENUATION_ESCALATION` | `needs net("api.example.com")`<br><br>`fn evil() needs only(net("evil.com")) {`<br>`    print!("unreachable")`<br>`}` | child requests a host the parent never granted |
| EXTRACT-303b (regression) | `E303_EXTRACT_ATTENUATION_ESCALATION` | `needs net("api.example.com")`<br><br>`fn f() needs only(net("api.example.com")), fs.read("/etc/passwd") {`<br>`    let data = fs.readFile!("/etc/passwd")`<br>`    print!(data)`<br>`}` | **this is the exact multi-token escalation bug** from `PROGRESS.md`'s Phase 3 audit — the *first* needs token (net) is a legal subset, the *second* (fs.read) is the escalation. Confirms the extractor checks every token in a `needs only(...)` list, not just the first. |
| EXTRACT-305a | `E305_EXTRACT_OVERPRIVILEGED_WILDCARD` | `needs net("*")` | bare `*` net |
| EXTRACT-305b | `E305_EXTRACT_OVERPRIVILEGED_WILDCARD` | `needs exec("*")` | bare `*` exec |
| EXTRACT-305c | `E305_EXTRACT_OVERPRIVILEGED_WILDCARD` | `needs fs.read("*")` | bare `*` glob |

Positive/coverage checks — these must extract **cleanly** (exit 0 from `explain`, no error):

| ID | Fixture | Expected |
|---|---|---|
| EXTRACT-POS1 | `needs fs.read("/safe/**")`<br>`let x = fs.readFile!("/safe/../etc/passwd")` | **string-literal covers this statically** — `/safe/../etc/passwd` string-matches under `**`; this must extract cleanly and fail later, at runtime, in the guard (see G-403). This is the load-bearing case behind the Phase 0 `traversal` fixture. |
| EXTRACT-POS2 | `needs fs.read("/etc/config/*.json")`<br>`let x = fs.readFile!("/etc/config/app.json")` | single `*` covers a same-segment literal (Rosetta's own grant, in isolation) |
| EXTRACT-POS3 | `needs fs.read("/etc/config/*.json")`<br>`let x = fs.readFile!("/etc/config/sub/app.json")` | single `*` must **not** cross `/` — expect `E301` here (uncovered), proving `*` ≠ `**` |
| EXTRACT-POS4 | `needs net("*.example.com")`<br>`fn f() needs only(net("*.example.com")) { }` | identical wildcard attenuates to itself — E303's "strict subset" is ⊆, equality allowed |
| EXTRACT-POS5 | `needs net("example.com")`<br>`let userUrl = "https://" + "example.com"`<br>`let r = curl!(userUrl)` | non-literal argument (built from concatenation) — must **defer to runtime**, not statically approve or reject; confirm via `explain`'s `deferred to runtime:` section, not a hard error at extraction. (`needs` must be the first statement — it cannot follow the `let`, or the script fails to parse with `E202` before extraction runs.) |
| EXTRACT-POS6 | `needs net("a.com")`<br>`fn __proto__() needs only(net("a.com")) { print!("ok") }`<br>`fn constructor() needs only(net("a.com")) { print!("ok") }` | fn names `__proto__`/`constructor` must extract as ordinary scoped entries, not silently vanish into `Object.prototype` — see REGR-2. (The top-level `needs net("a.com")` is required: without it, each `only(net("a.com"))` escalates past an empty parent manifest and throws `E303` instead of extracting cleanly.) |

---

## 9. Part F — CapabilityGuard runtime (`E4xx`)

**Before running anything below, read §2.1** if you're on macOS — every grant in this section
needs to be built from the canonical path, or you'll be testing the wrong thing.

Set up the traversal/symlink fixtures once, real filesystem:

```bash
mkdir -p /tmp/placitum-tests/safe
SAFE_ROOT="$(cd /tmp/placitum-tests/safe && pwd -P)"   # see §2.1 — resolves the
TESTS_ROOT="$(dirname "$SAFE_ROOT")"                    # /tmp symlink on macOS
echo '{"secret":true}' > "$TESTS_ROOT/secret-outside.json"
echo '{"ok":true}'     > "$SAFE_ROOT/app.json"
ln -s "$TESTS_ROOT/secret-outside.json" "$SAFE_ROOT/escape-link.json"
```

Below, `$SAFE_ROOT` and `$TESTS_ROOT` appear literally in each fixture's `needs` line —
substitute the values printed above (identical to the plain `/tmp/placitum-tests/...` paths
on Linux; resolved to `/private/tmp/...` on macOS).

| ID | Code | Fixture | Expected |
|---|---|---|---|
| G-401a | `E401_GUARD_NET_DENIED` | `needs net("api.example.com")`<br>`let host = "evil.com"`<br>`let r = curl!("https://" + host + "/status")`<br>`print!(r)` | host not granted at all — **no network call should actually occur**; denial happens before the host binding runs |
| G-401b (substring false-positive) | `E401_GUARD_NET_DENIED` | `needs net("*.example.com")`<br>`let host = "notexample.com"`<br>`let r = curl!("https://" + host + "/status")` | `notexample.com` must not match `*.example.com` as a substring |
| G-401c (bare-parent rule) | `E401_GUARD_NET_DENIED` | `needs net("*.example.com")`<br>`let host = "example.com"`<br>`let r = curl!("https://" + host + "/status")` | the bare parent host is **not** covered by its own single-label wildcard |
| G-402 | `E402_GUARD_FS_READ_DENIED` | `needs fs.read("$SAFE_ROOT/**")`<br>`let p = "$TESTS_ROOT" + "/other/x.json"`<br>`let d = fs.readFile!(p)` | plainly outside the grant, no traversal trick |
| G-403-traversal (flagship test) | `E403_GUARD_PATH_TRAVERSAL` | `needs fs.read("$SAFE_ROOT/**")`<br>`let secrets = fs.readFile!("$SAFE_ROOT/../secret-outside.json")` | string matches the grant, canonical resolution escapes it — **this mirrors the exact shape Section 9.3's formatter example depicts** (same rendered structure, same `secrets` variable name; the literal path necessarily differs, since it's a test tmpdir rather than `../../etc/passwd`); confirm the rendered output matches that shape (see Part I) |
| G-403-symlink | `E403_GUARD_PATH_TRAVERSAL` | `needs fs.read("$SAFE_ROOT/**")`<br>`let secrets = fs.readFile!("$SAFE_ROOT/escape-link.json")` | symlink inside the granted dir resolves outside it |
| G-403-write | `E403_GUARD_PATH_TRAVERSAL` | `needs fs.write("$SAFE_ROOT/**")`<br>`fs.writeFile!("$SAFE_ROOT/../escape.txt", "pwned")` | write-side traversal via parent-dir canonicalization |
| G-404 | `E404_GUARD_FS_WRITE_DENIED` | `needs fs.write("$SAFE_ROOT/**")`<br>`let p = "$TESTS_ROOT" + "/other/out.txt"`<br>`fs.writeFile!(p, "x")` | plainly outside the grant |
| G-405 * | `E502_EVAL_NOT_CALLABLE` (earlier failure; see §1.1) | `needs exec("/usr/bin/echo")`<br>`exec!("/bin/ls")` | **Confirmed by execution (2026-09-16):** `E502_EVAL_NOT_CALLABLE: bang target \`exec\` is not defined` — an earlier, fail-closed failure, not a guard denial. No `exec` bang exists in 1.0, so `E405_GUARD_EXEC_DENIED` is **unreachable from any script** (it exists in `guard.ts` and is exercised by direct guard unit tests). Recorded as the baseline the next release's exec work must change. |
| G-406a | `E406_GUARD_ENV_MISSING` | `needs env(API_KEY)`<br>`print!("started")`, run with `API_KEY` unset | required var missing. **Also assert stdout is empty** — per the Phase 5 DoD, `requireEnv` runs once, before any statement, so `print!("started")` must never execute, exactly like B-3. |
| G-407 | `E407_GUARD_MANIFEST_TAMPERED` | — | **deliberately not testable in 1.0.** Per `PROGRESS.md` Phase 9 decision 8, no provenance hash is wired anywhere yet. Confirm this code is simply unreachable right now rather than attempting to trigger it. |

**Why G-401a/b/c, G-402, and G-404 assemble their target from a variable.** A *literal* bang
argument outside the grant never reaches the guard: static extraction preempts it with
`E301_EXTRACT_UNCOVERED_CAPABILITY` (`PROGRESS.md` Phase 3 — extraction is the first
enforcement layer; both layers fail closed). That behavior is correct, but it means the
`E401`/`E402`/`E404` codes these rows exist to exercise are unreachable from the original
literal fixtures. Building the target at runtime (`"https://" + host + "/status"`,
`"$TESTS_ROOT" + "/other/x.json"`) defers the check to the guard, which is the layer under
test here. G-401a's no-network property still holds in the deferred form: the guard denies
before the host binding runs. The `G-403-*` rows deliberately keep literals — those
string-match the grant, so extraction passes and canonicalization is exactly what the guard
must catch.

**Positive/coverage checks** — these must succeed (exit 0), proving the same grant categories
tested above can also *allow* access. Without these, a guard that denied everything
unconditionally would pass the entire table above.

| ID | Fixture | Expected |
|---|---|---|
| G-401-pos | `needs net("127.0.0.1")`<br>`let r = curl!("http://127.0.0.1:8991/status")`<br>`print!(r.status)` | positive control — see below for a local server to make this pass end-to-end without needing real internet access |
| G-402-pos | `needs fs.read("$SAFE_ROOT/**")`<br>`let d = fs.readFile!("$SAFE_ROOT/app.json")`<br>`print!(d)` | reading a file legitimately inside the granted directory succeeds, exit 0, prints `{"ok":true}` |
| G-404-pos | `needs fs.write("$SAFE_ROOT/**")`<br>`fs.writeFile!("$SAFE_ROOT/out.txt", "hello from placitum")` | run, then `cat "$SAFE_ROOT/out.txt"` from the shell — exit 0, file exists afterward with exactly that content |
| G-406b | same script as G-406a, run with `API_KEY=x placitum run ...` | starts fine, exit 0, prints `started` |
| G-406c | `needs env(API_KEY?)`<br>`print!("started")`, run with `API_KEY` unset | **must not error** — optional means absence is fine, prints `started`, exit 0 |

**Local server for G-401-pos** (avoids depending on real internet access):

```bash
node -e '
const http = require("http");
http.createServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({status:200,ok:true}))}).listen(8991);
' &
SERVER_PID=$!
# run G-401-pos here
kill $SERVER_PID
```

Also worth a manual spot-check rather than a pass/fail line item: **TOCTOU byte-identity.**
The DoD claims the value handed to `/host-bindings` is byte-identical to what was authorized
(canonicalized), never the raw argument. This is hard to observe purely from CLI output; the
closest black-box proxy is G-403-symlink succeeding/failing consistently with the *canonical*
path rather than the literal one — if it ever behaved as though the raw symlink path were
what got checked, that would be visible as an inconsistent grant. Treat `chokepoint.test.ts`
(already in the automated suite) as the authoritative source for this property.

\* Footnote for Appendix A: treat G-405 as advisory — `exec!` is not a real bang in 1.0
(§1.1), so `E502` is the expected, fail-closed outcome and no `E405` result is achievable.
Keep it non-blocking; revisit when `exec` ships.

---

## 10. Part G — Evaluator (`E5xx`) and language semantics

### Error codes

| ID | Code | Fixture | Expected |
|---|---|---|---|
| EVAL-500 | `E500_EVAL_UNBOUND_VAR` | `print!(undefinedVar)` | reference to an undeclared identifier |
| EVAL-501 | `E501_EVAL_TYPE_MISMATCH` | `let x = 1 + "two"`<br>`print!(x)` | `+` is num/num or str/str only |
| EVAL-502a | `E502_EVAL_NOT_CALLABLE` | `let x = 5`<br>`let y = x(1)` | plain `CallExpr` on a non-function |
| EVAL-502b (regression) | `E502_EVAL_NOT_CALLABLE` | `let __proto__ = 5`<br>`__proto__!(1)` | prototype-chain-name regression, bang form — see REGR-2 |
| EVAL-503 | `E503_EVAL_ARITY_MISMATCH` | `fn add(a, b) { return a + b }`<br>`let x = add(1)` | wrong argument count. Also confirm the rendered error carries a source location (`--> file:line:col`, excerpt, caret under `add(1)`) — for user fns, native calls (`json.parse()`), and bang calls (`curl!()`) alike (FIX-1 in the findings file; pinned by `tests/eval/semantics.test.ts`). |
| EVAL-504 | `E504_EVAL_DIVISION_BY_ZERO` | `let x = 1 / 0`<br>`print!(x)` | self-explanatory |
| EVAL-505 | `E505_EVAL_PIPE_TYPE_ERROR` | see §1.3 — construct a `#!strict` pipe chain with a stage whose inferred type is wrong for the next stage, with at least one `print!` stage **earlier** in the chain | **assert stdout is empty** even though a `print!` stage textually precedes the failing one — the whole chain is pre-checked before any stage runs |
| EVAL-506a | `E506_EVAL_REDECLARATION` | `let x = 1`<br>`let x = 2`<br>`print!(x)` | same-scope `let` redeclared |
| EVAL-506b | `E506_EVAL_REDECLARATION` | `let json = 5`<br>`print!(json)` | **direct regression from `PROGRESS.md` Phase 5 decision 2** — colliding with the stdlib global `json` at top level is `E506`, not a silent shadow |
| EVAL-506c (positive) | `let x = 1`<br>`fn f() {`<br>`    let x = 2`<br>`    print!(x)`<br>`}`<br>`f()`<br>`print!(x)` | shadowing in an **inner** scope stays legal — expect `2` then `1`, exit 0. (The corrected fixture actually calls `f()` and drops the `;` separators: semicolons are not a token in this grammar, and the original fixture printed only `1` because `f` was never invoked.) |

### Semantics (no error expected)

| ID | Fixture | Expected |
|---|---|---|
| SEM-1 (closures) | `fn make_counter() {`<br>`    let n = 0`<br>`    fn bump() {`<br>`        n = n + 1`<br>`        return n`<br>`    }`<br>`    return bump`<br>`}`<br>`let counter = make_counter()`<br>`print!(counter())`<br>`print!(counter())`<br>`print!(counter())` | prints `1`, `2`, `3` — closures capture their defining environment by reference, mutation persists across calls |
| SEM-2 (pipe rule 1 — bare stage) | `let x = "{\"a\":1}" | json.parse`<br>*(the one pure stdlib function confirmed by the Rosetta example; substitute another single-arg pure fn your build ships if you have one, e.g. `trim`)* | `x | f` ≡ `f(x)` |
| SEM-3 (pipe rule 2 — explicit args) | `needs net("127.0.0.1")`<br>`let url = "http://127.0.0.1:8991/status"`<br>`let r = url | curl!({ method: "GET" })`<br>`print!(r.status)` | ≡ `curl!(url, { method: "GET" })` — piped value becomes the **first** arg, explicit args follow. Run against the local server from Part F (§9): `api.example.com` is an IANA example domain with no service, so a real request to it can only fail. |
| SEM-4 (flat pipe chain) | `needs fs.read("$SAFE_ROOT/**")`<br>`let path = "$SAFE_ROOT/app.json"`<br>`let result = path | fs.readFile!() | json.parse`<br>`print!(result.ok)` | single flat `PipeExpr`, not nested — behaviorally: all three stages run left-to-right once each, exit 0, prints `true`. (PARSE-POS3's `/etc` fixture can't pass the guard on macOS; this uses the canonical `$SAFE_ROOT` file from §2.1/§9 instead — requires the §9 setup's `app.json`.) |
| SEM-5 (`print!` needs no grant) | `print!("hello")` with **no `needs` decl at all** | exit 0 — ambient, unconditionally authorized, no manifest entry required |
| SEM-6 (top-level `return`) | `print!("before")`<br>`return`<br>`print!("after")` | only `before` printed — top-level `return` stops the program |
| SEM-7 (truthiness/equality) | assorted `if`/`==` checks per decision 5 (JS-like truthiness; structural `==`; missing member → `null`) | spot-check a few: `if 0 { print!("no") } else { print!("yes") }`, `if [1,2] == [1,2] { print!("structural") }`, `let o = {a:1}; print!(o.b)` → `null` |

---

## 11. Part H — `explain` (Phase 6)

Run `placitum explain scripts/rosetta.placitum` and check the rendered shape against the
DoD's stated structure:

| ID | Check |
|---|---|
| EXPLAIN-1 | Output separates `grants (statically proven):` from `deferred to runtime:` sections |
| EXPLAIN-2 | All five grant categories appear even when empty — `(none)` is rendered explicitly, not omitted |
| EXPLAIN-3 | Net wildcards render raw (e.g. `*.example.com`, not translated to a regex) |
| EXPLAIN-4 | `env(...)` entries show `(required)` or `(optional)` |
| EXPLAIN-5 | `fetch_status`'s attenuated `needs only(net("api.example.com"))` appears as its own nested/scoped section |
| EXPLAIN-6 | A canonicalization footer note appears (per Phase 6 decision 3) **only when** an `fsRead`/`fsWrite`/`exec` grant is present. Confirmed present for the Rosetta script (which has `fs.read`). For the absent case, run `explain` on a net-only script and confirm the footer is gone: `needs net("api.example.com")` / `let r = curl!("https://api.example.com/status")` / `print!(r.status)`. |
| EXPLAIN-7 | Deferred entries (if any in your test script) render as `category [start..end] reason` with **raw source offsets**, not line:col — this is a documented, deliberate limitation (Phase 6 decision 4) |
| EXPLAIN-8 | Run `explain` on the same script twice — byte-identical output (alignment constants, `Object.entries` order = declaration order) |

**Regression — control-character injection (Phase 6 post-phase fix):**

```placitum
needs fs.read("/safe\n  exec      /bin/rm/**")
```

| ID | Expected |
|---|---|
| EXPLAIN-REGR | The embedded literal newline (via the string escape) must **not** produce a forged extra line in the `explain` output that looks like a second, unrelated grant. It should render as a single JSON-quoted string (control character escaped), e.g. something like `"/safe\n  exec      /bin/rm/**"` on one line. If you instead see what looks like two separate grant-looking lines, that's the exact bug this test targets — flag as a regression, not a nitpick. |

---

## 12. Part I — CLI error envelope & formatting (`E6xx`)

| ID | Code | Command | Expected |
|---|---|---|---|
| CLI-601 | `E601_CLI_FILE_NOT_FOUND` | `placitum run scripts/does-not-exist.placitum` | file not found, exit 1 |
| CLI-602a | `E602_CLI_INVALID_FLAG` | `placitum run --nonexistent-flag scripts/rosetta.placitum` | unknown option |
| CLI-602b | `E602_CLI_INVALID_FLAG` | `placitum run` (no file argument) | missing required argument |
| CLI-602c | `E602_CLI_INVALID_FLAG` | `placitum run scripts/rosetta.placitum extra-arg` | excess arguments (`allowExcessArguments(false)`) |
| CLI-602d | `E602_CLI_INVALID_FLAG` | `placitum bogus-subcommand` | unknown command |
| CLI-603 | `E603_EXPLAIN_RENDER_FAILURE` | — | Only reachable with a hand-corrupted internal manifest; not normally triggerable from the CLI on a real script. Treat as covered by the automated suite unless your build exposes a raw "explain a manifest JSON file" entry point. |

For every `E6xx` case above, also confirm the **shape**, not just the code:

- stderr carries the formatted error (single shape, matching Section 9.3's format), **not**
  commander's own default usage dump — the spec says commander's own error line is
  suppressed and re-rendered as `E602`.
- stdout is **clean** (empty) on every failure case.
- exit code is `1` for every error above; recall CLI-A1–A4 (help/version/bare/`help`) are the
  documented `exitCode === 0` exceptions, not these.

**Format check**, using G-403-traversal from Part F (§9). The snippet below illustrates the
*shape* (header, location, excerpt, caret, hint) — it is **not** the byte layout the shipped
formatter emits. Execution showed the full envelope code and a one-space gutter, and the
caret spanning the whole denied bang call rather than just the string argument (Phase 9
decision 5, "caret at the bang-call site" — this is what satisfies REGR-7). The pinned byte
format lives in `tests/cli/format-error.test.ts`; compare your real G-403 render against that
test for bytes, and against this shape for structure:

```
error[E403_GUARD_PATH_TRAVERSAL]: path traversal blocked
 --> script.placitum:12:17
  |
12 |   let secrets = fs.readFile!("../../etc/passwd")
  |                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ resolves outside every granted fs.read() capability
  |
  = hint: request `needs fs.read("/etc/passwd")` explicitly, or remove the traversal.
```

| ID | Check |
|---|---|
| FMT-1 | `error[Exxx_FULL_CODE]: <message>` header line — full envelope code, not abbreviated |
| FMT-2 | ` --> file:line:col` pointing at the actual offending expression (one-space gutter) |
| FMT-3 | Source excerpt line, prefixed with the line number |
| FMT-4 | Caret (`^`) span underlining the offending expression — for guard denials, the whole bang call (Phase 9 decision 5), not just the string argument |
| FMT-5 | `= hint: ...` footer present and actionable |
| FMT-6 | Also check the **degraded cases** the formatter is documented to fail closed on: an out-of-range location (header + hint still render, excerpt skipped), a missing span (single caret), a span past end-of-line (clamped), a span-less location (arrow only, no caret) — these need synthetic/internal triggering; at minimum confirm the formatter never itself throws on the errors you *can* produce above. |

---

## 13. Part J — Security regression suite (previously-found-and-fixed bugs)

These are drawn directly from `PROGRESS.md`'s "post-phase audit" sections. Each represents a
real bug that was found and fixed during development — worth explicit re-verification on the
shipped 1.0 binary, not just trusting the historical fix.

| ID | Original bug | Regression test | Expected now |
|---|---|---|---|
| REGR-1 | E303 only checked the first `needs` token in a child's list (`return` instead of `continue`), letting a second, escalating token slip through | EXTRACT-303b above | `E303`, not a clean extraction |
| REGR-2 | `constructor`/`__proto__`/`toString`/`hasOwnProperty` as fn or variable names leaked through JS's own prototype chain in `KEYWORDS`, `BANG_REGISTRY`, `ctx.bangs`, and `manifest.scoped` | EXTRACT-POS6 (extractor), EVAL-502b (evaluator) — also try `let __proto__ = 5; print!(__proto__)` as a plain (non-bang) variable | Both extract and evaluate `__proto__`/`constructor` as *ordinary* named entries — no silent disappearance, no prototype mutation |
| REGR-3 | A `primaryParenthesized` flag was sticky: any parenthesized primary earlier in the file made every *later, unrelated* bang call fail `E205` | PARSE-POS4 above | `(x).y!(...)` still correctly fails `E205`, but a plain `let x = (1 + 2)` followed by an unrelated `print!(x)` must parse fine |
| REGR-4 | `explain`'s use of a `z.record`-based Zod schema silently drops an own `__proto__` key from a scoped manifest, under-reporting it | `needs net("a.com")` then `fn __proto__() needs only(net("a.com")) { }` then `placitum explain` on that script | the `__proto__` fn's scoped manifest **appears** in the explain output — under-reporting here is a transparency bug, not a cosmetic one. (The top-level `needs net("a.com")` is required so the child's `only(...)` is a legal subset rather than an `E303` escalation.) |
| REGR-5 | `explain` rendered manifest strings raw — a grant pattern containing an embedded newline (via a legal string escape) could forge what looked like an extra, unrelated grant line | EXPLAIN-REGR above | control characters are JSON-quoted, never rendered raw |
| REGR-6 | `no-restricted-imports` only listed bare module spellings (`fs`), so `import 'node:fs'` bypassed the boundary entirely | Code-level, not CLI-level — see "developer-only" note below | N/A from the CLI; if you have repo access, confirm both `fs` and `node:fs` are still banned outside `/host-bindings` |
| REGR-7 | Guard denials (`E401`–`E406`) previously rendered without a source location — only `EvalError`s carried one | Any G-4xx test in Part F | the rendered error includes `--> file:line:col` and a caret at the bang-call site, not just a bare message |

**Developer-only checks (need repo access, not just the binary)** — optional, but cheap
re-verification of the CI harness's own self-tests, matching PROGRESS.md's "proven to fire"
claims:

```bash
# Import-boundary re-proof (revert after!)
echo "import { readFileSync } from 'fs';" >> src/evaluator/interpreter.ts
nix develop --command npx eslint src/evaluator/interpreter.ts   # expect: error, exit 1
git checkout -- src/evaluator/interpreter.ts                     # revert

# check-deps re-proof (revert after!)
# temporarily add an unlisted package to package-lock.json's root dependencies, then:
nix develop --command node scripts/check-deps.mjs                # expect: fails, names the package
git checkout -- package-lock.json                                 # revert, then diff to confirm byte-identical
```

---

## 14. Part K — Deferred-phase boundary (Phases 7 & 8 must fail *safely*)

This is the section that matters most for this specific release: Phases 7 and 8 are **not
built**. The goal here isn't "does `infer` work" (it can't) — it's "does the CLI refuse
cleanly, with no crash, no hang, and critically no silent fallthrough to running the script
anyway."

| ID | Command | Expected |
|---|---|---|
| DEFER-1 | `placitum infer scripts/rosetta.placitum` | `E602` unknown command, exit 1 — **not** a crash, **not** a hang, **not** a silent `run` |
| DEFER-2 | `placitum audit scripts/rosetta.placitum` | same as above |
| DEFER-3 | `placitum rewind scripts/rosetta.placitum` | same as above |
| DEFER-4 | `placitum run scripts/rosetta.placitum --attenuate` | `E602_CLI_INVALID_FLAG` (the flag doesn't exist yet; commander reports it as an unknown-command-style usage error naming the full argv — exit 1, no fallthrough to running the script) |
| DEFER-5 | `placitum run scripts/rosetta.placitum --rewind-to=3` | same — no such flag |
| DEFER-6 | Search all output from DEFER-1..5 | **no `E7xx` or `E8xx` code ever appears** — those ranges should be completely dormant in this release, per `PROGRESS.md`'s explicit note that they're "dormant until then" |
| DEFER-7 | Timing check on DEFER-1..5 | each returns near-instantly — no hang waiting on an unimplemented resource (e.g. a replay log file that doesn't exist) |

---

## 15. Part L — Packaging & distribution

| ID | Check | Expected |
|---|---|---|
| PKG-1 | `node dist/cli/bin.js --version` (bypassing any shim) | `1.0.0`, matches `package.json` |
| PKG-2 | `npm link` then `placitum --version` from an unrelated directory | works globally, same version |
| PKG-3 | `dist/` is gitignored | `git status` after a build shows no `dist/` changes |
| PKG-4 | `npm publish --dry-run` | should refuse or no-op — `private: true` |
| PKG-5 | Run `placitum run` via a **symlinked** global bin (if your platform's npm link produces one) | still executes correctly — this is exactly why `bin.ts` is a separate entry file rather than an `import.meta.url` self-check, per `PROGRESS.md` Phase 9 decision 2 |

---

## 16. Explicitly not in scope for this test plan

Recorded here so nobody mistakes an absence for an oversight:

- **Phase 7 (`infer`/`audit`/`run --attenuate`) and Phase 8 (`rewind`) functionality.** Not
  built. Part K above tests their *absence*, not their behavior.
- **`E701`–`E703`, `E801`–`E803`.** Should not be reachable; see DEFER-6.
- **`E407` (manifest provenance hash).** Deliberately unwired in 1.0 (G-407).
- **Secondary OS-level sandbox** (Deno/Node `--permission` flags). Explicitly skipped by
  design decision (Phase 9 decision 7, "documented as skipped") — `CapabilityGuard` is the
  sole enforcement layer for 1.0, by design, not by gap.
- **`env.get` or any way to read an env var's value from a script.** Doesn't exist yet
  (Phase 9 decision 9).
- **TOCTOU byte-identity at the bytecode/memory level.** Only spot-checkable black-box; the
  authoritative test is the existing `chokepoint.test.ts`.

---

## Appendix A — Master checklist

Copy this table into your tracker; check off as you go.

| ID | Area | Pass? |
|---|---|---|
| SETUP-1..6 | Environment & build | ☐ |
| CLI-A1..A7 | CLI surface | ☐ |
| B-1..B-4 | Rosetta end-to-end | ☐ |
| LEX-101..106 (104 has two sub-cases, a/b), LEX-POS1..3 | Lexer | ☐ |
| PARSE-201, 202a-c, 203, 204, 205a-b, 206, PARSE-POS1..4 | Parser | ☐ |
| EXTRACT-301a-b, 302, 303a-b, 305a-c, EXTRACT-POS1..6 | Static extraction | ☐ |
| G-401a-c, 401-pos, 402, 402-pos, 403-traversal, 403-symlink, 403-write, 404, 404-pos, 405, 406a-c, 407 | Guard | ☐ |
| EVAL-500, 501, 502a-b, 503, 504, 505, 506a-c | Evaluator errors | ☐ |
| SEM-1..7 | Language semantics | ☐ |
| EXPLAIN-1..8, EXPLAIN-REGR | `explain` | ☐ |
| CLI-601, 602a-d, 603, FMT-1..6 | CLI error envelope | ☐ |
| REGR-1..7 | Security regression suite | ☐ |
| DEFER-1..7 | Deferred-phase boundary | ☐ |
| PKG-1..5 | Packaging | ☐ |

**Release recommendation:** treat `SETUP`, `B` (Rosetta end-to-end), `LEX`, `PARSE`,
`EXTRACT`, `G`, `EVAL`, `CLI`, `FMT`, and `REGR` rows, and every `DEFER` row, as
release-blocking if failed — a project that doesn't build, or whose own flagship example
script doesn't run, isn't shippable regardless of how the rest of the suite looks. Treat
`SEM`/`EXPLAIN`/`PKG` rows as high-priority but individually triageable.

**Exceptions within the blocking rows above** (see the relevant row for full reasoning):
- `G-405` — `exec!` is not a real bang in 1.0 (§1.1): expect `E502` (fail-closed), not `E405`.
  Advisory in the sense that no `E405` result is achievable from a script; the recorded
  `E502` outcome is the pass condition.
- `B-2` — cannot complete end-to-end on macOS regardless of build correctness (§2.1): `E501`
  if the file is absent, `E403` if present. Not blocking on that platform specifically, but
  should pass on Linux.

---

## Appendix B — Error code quick reference (1.0 scope only)

E7xx and E8xx are intentionally omitted — they belong to the deferred phases and should not
appear anywhere in this release's output (see DEFER-6).

| Code | Phase | Meaning |
|---|---|---|
| E101 | lex | Unterminated string |
| E102 | lex | Unterminated f-string expression |
| E103 | lex | Invalid escape sequence |
| E104 | lex | Unexpected character (incl. misplaced `!`) |
| E105 | lex | `#!` pragma not on physical line 1 |
| E106 | lex | Malformed number literal |
| E201 | parse | Generic unexpected token |
| E202 | parse | `needs` outside its two legal positions |
| E203 | parse | Unterminated block (missing `}`) |
| E204 | parse | Malformed capability token |
| E205 | parse | Invalid bang-call target shape |
| E206 | parse | Duplicate parameter name |
| E301 | extract | Uncovered literal capability |
| E302 | extract | Glob string fails to compile |
| E303 | extract | Child `needs only(...)` escalates past its parent |
| E304 | extract | Unhandled AST node (internal backstop; not externally triggerable) |
| E305 | extract | Bare `"*"` wildcard |
| E401 | guard | Net host denied |
| E402 | guard | fs read denied |
| E403 | guard | Path traversal (canonicalization escape) |
| E404 | guard | fs write denied |
| E405 | guard | Exec target denied |
| E406 | guard | Required env var missing |
| E407 | guard | Manifest tampered (deferred/unreachable in 1.0) |
| E500 | eval | Unbound variable |
| E501 | eval | Type mismatch **— also the umbrella code for host-level runtime failures (ENOENT, fetch failure, invalid JSON); see B-4** |
| E502 | eval | Target not callable |
| E503 | eval | Arity mismatch |
| E504 | eval | Division by zero |
| E505 | eval | `#!strict` pipe pre-pass type error |
| E506 | eval | Same-scope redeclaration |
| E601 | cli | File not found |
| E602 | cli | Invalid flag/command/argument |
| E603 | cli | `explain` render failure on a malformed manifest |
