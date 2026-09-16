# Placitum 1.0 — Test Findings & Fix List

**Source:** execution of `placitum-v1-test-plan-3.md` (Rev. 2) against the shipped
1.0 binary (`dist/cli/bin.js`, commit `5d1bac1`) on macOS (darwin), 2026-09-16.
**Baseline:** `npm ci && npm run ci` = 174/174 green before and after testing.
**Verdict:** shippable — no blocking product bugs. This file lists the fixes worth
making, in priority order, with exact evidence and verification steps.

Evidence (per-test stdout/stderr/exit) lives in `/tmp/placitum-tests/out/`;
fixtures in `/tmp/placitum-tests/scripts/`.

---

## 1. Product fixes

### FIX-1 — `E503_EVAL_ARITY_MISMATCH` renders without a source location (minor, recommended)

**Observed** — three ways to trip E503, all header+hint only, no `--> file:line:col`:

```
$ placitum run arity-fn.placitum      # fn add(a,b){...}; add(1)
error[E503_EVAL_ARITY_MISMATCH]: fn `add` expects 2 argument(s), got 1.
  = hint: Match the FnDecl parameter list.

$ placitum run arity-pure.placitum    # let x = json.parse()
error[E503_EVAL_ARITY_MISMATCH]: json.parse expects 1 argument(s), got 0.
  = hint: Match the function signature.

$ placitum run arity-bang.placitum    # needs net("127.0.0.1"); curl!()
error[E503_EVAL_ARITY_MISMATCH]: curl expects 1-2 argument(s), got 0.
  = hint: Match the function signature.
```

Every other observed error (including E500–E506 siblings) carries a location.
The envelope schema makes `location` optional (`placitum-implementation.md` §9.3,
line 880), so this is cosmetic — but E503 is the only E-code that never has one.

**Root cause** — the arity checks run inside the callee, which has no AST node:

- `src/evaluator/interpreter.ts:106-112` — `Closure.call()` throws the fn-arity E503.
- `src/evaluator/interpreter.ts:139` — `callValue()` wraps E502 with `located(...)`
  but returns `callee.call(args)` unwrapped, so the E503 escapes unlocated.
- `src/evaluator/interpreter.ts:170` — `evalBangCall()` calls `effect(guard, args)`
  and only locates `CapabilityViolationError`; bang E503 escapes unlocated.
- `src/stdlib/stdlib.ts:61-68` (`native`) and `:76-85` (`bangNative`) — throw sites,
  no node available.

**Fix (minimal, two catch sites — do not thread nodes into stdlib):**

1. In `callValue` (interpreter.ts:139), catch the thrown error and rethrow
   `located(err, node)` when it is an `EvalError` lacking a location (or when
   `err.code === 'E503_EVAL_ARITY_MISMATCH'`). `located()` already exists and is
   used for E502/E501 in the same file; it preserves class/code/message/hint.
2. In `evalBangCall` (interpreter.ts:169-174), extend the existing try/catch: the
   `CapabilityViolationError` branch stays; add an EvalError branch that rethrows
   `located(err, node)` (keep `throw err` for everything else).

Do not move the checks; the guard/eval chokepoint layout should not change.

**Verify:**

```bash
cat > /tmp/arity.placitum <<'EOF'
fn add(a, b) { return a + b }
let x = add(1)
EOF
node dist/cli/bin.js run /tmp/arity.placitum
# expect additionally:  --> /tmp/arity.placitum:2:9  + excerpt + caret under add(1)

printf 'let x = json.parse()\n' > /tmp/arity2.placitum
node dist/cli/bin.js run /tmp/arity2.placitum    # expect location too

printf 'needs net("127.0.0.1")\nlet r = curl!()\n' > /tmp/arity3.placitum
node dist/cli/bin.js run /tmp/arity3.placitum    # expect location too
```

Add/extend a test asserting E503 carries `location` (the negative runner only
checks codes; a `semantics.test.ts`/`chokepoint.test.ts` case is the cheap spot).
`npm run ci` must stay at 174/174 or higher.

### FIX-2 — DEFER-4/5 error wording (optional, message fidelity only)

`placitum run file --attenuate` and `--rewind-to=3` are rejected with:

```
error[E602_CLI_INVALID_FLAG]: error: unknown command 'run /tmp/.../rosetta.placitum --attenuate'
```

The plan expected "unrecognized option on `run`". The code, exit status (1), and
no-fallthrough property are correct; only the commander-derived message names
"unknown command" with the full argv. **No code change recommended** — commander's
`allowExcessArguments(false)` path produces this; forcing a nicer message adds
surface for zero safety gain. Fix the plan's expectation instead (T-8 below).

---

## 2. Test-plan corrections (`placitum-v1-test-plan-3.md`, Rev. 2)

These are doc/fixture errors, verified against actual behavior. Product behavior
is correct in every case — do **not** change `src/` for these.

### T-1 — §2.1 and B-4: macOS prediction is wrong; actual is E501, not E402

- Current text (B-4 row, line 345; §2.1 lines 255-259): on macOS expect
  `E402_GUARD_FS_READ_DENIED` "regardless of whether the file exists".
- **Observed:** `E501_EVAL_TYPE_MISMATCH` —
  `fs.readFile("/etc/config/app.json") failed: ENOENT...` with hint
  `The operation was authorized; this is a host failure, not a capability denial.`
- **Mechanism:** `canonicalizeExisting` uses a lexical fallback when the path
  doesn't exist (PROGRESS.md Phase 4 decision 3), so the *missing* literal still
  matches the raw grant; the host op then ENOENTs. Canonical-only mismatch
  (E402/E403) only happens when the path **exists** and resolves elsewhere.
  Verified both ways with a raw grant under `/tmp` (macOS symlink):
  - existing `/tmp/.../safe/app.json` → `E403_GUARD_PATH_TRAVERSAL`
  - missing `/tmp/.../safe/nope.json` → `E501 ENOENT`
- **Rewrite:** B-4's macOS column should say E501 (same as Linux) for a missing
  file, and note that a file that *does* exist under `/etc` would instead be
  denied E403 (canonical `/private/etc/...` vs raw grant). §2.1's "self-destruct"
  paragraph is right for existing paths only; qualify it.
- B-3 stands: E406 fires before any statement regardless of file presence.

### T-2 — Part F rows G-401a/b/c, G-402, G-404: as-written fixtures never reach the guard

- **Observed:** all five fail at extraction with `E301_EXTRACT_UNCOVERED_CAPABILITY`
  because their bang arguments are compile-time literals outside the grant
  (e.g. `curl!("https://evil.com/status")` under `needs net("api.example.com")`).
  Extraction preempts the guard — fail-closed, but the rows' expected guard codes
  are unreachable in that fixture shape.
- **E401/E402/E404 are live and correct** via deferred (non-literal) targets.
  Verified replacement fixtures (all produced the expected code + `-->` location):

```placitum
# G-401a-alt
needs net("api.example.com")
let host = "evil.com"
let r = curl!("https://" + host + "/status")
print!(r)
# → E401_GUARD_NET_DENIED: host "evil.com" ... matches no granted net() capability

# G-401b-alt (substring false-positive)
needs net("*.example.com")
let host = "notexample.com"
let r = curl!("https://" + host + "/status")
print!(r)
# → E401

# G-401c-alt (bare-parent rule)
needs net("*.example.com")
let host = "example.com"
let r = curl!("https://" + host + "/status")
print!(r)
# → E401

# G-402-alt
needs fs.read("/private/tmp/placitum-tests/safe/**")   # $SAFE_ROOT
let p = "/private/tmp/placitum-tests" + "/other/x.json"
let d = fs.readFile!(p)
print!(d)
# → E402_GUARD_FS_READ_DENIED

# G-404-alt
needs fs.write("/private/tmp/placitum-tests/safe/**")  # $SAFE_ROOT
let p = "/private/tmp/placitum-tests" + "/other/out.txt"
fs.writeFile!(p, "x")
# → E404_GUARD_FS_WRITE_DENIED
```

- **Rewrite:** either swap these five rows for the deferred variants above, or
  keep the literal fixtures and add a note: "as-written these hit E301 at
  extraction (which satisfies the no-side-effect intent); use the deferred
  variants to exercise the guard." G-403 rows are fine as written (their literals
  string-match the grant, extraction passes, guard denies).
- G-401a's "no network call should actually occur" property also holds for the
  deferred variant: denial happens before the host binding runs.

### T-3 — EVAL-506c: fixture never calls `f()`, and uses `;` (not in the grammar)

- Current fixture (line 555): `let x = 1` / `fn f() { let x = 2; print!(x) }` /
  `print!(x)` — expected "2 then 1".
- **Observed:** prints only `1`. `f` is declared but never called, and semicolons
  are not a token in this language (`tests/**/*.placitum` has none; no SEMICOLON
  token in the grammar).
- **Verified fix:**

```placitum
let x = 1
fn f() {
    let x = 2
    print!(x)
}
f()
print!(x)
```

→ prints `2` then `1`, exit 0. (Inner-scope shadowing is legal; it does not leak.)

### T-4 — PARSE-POS2: missing top-level `needs`, causing a misleading E303

- Current fixture (line 405): `fn f(x) needs only(net("a.com")) { return x }`
  with no top-level grant.
- **Observed:** `E303_EXTRACT_ATTENUATION_ESCALATION` — parse succeeded (an E202
  would have fired first), but the row reads as a failure unless you know the
  round-2 rule applied to POS6/REGR-4 also applies here.
- **Rewrite:** add `needs net("a.com")` as line 1 (same fix as EXTRACT-POS6 /
  REGR-4), then expect a clean `explain` exit 0.

### T-5 — G-405: record the actual code (E502), drop the best-guess hedge

- **Observed:** `E502_EVAL_NOT_CALLABLE: bang target \`exec\` is not defined.`
  (plan's best guess was E500).
- No `exec!` implementation exists in 1.0, so **E405 is unreachable from any
  script** (it exists in `guard.ts` and is exercised by direct guard unit tests).
- **Rewrite:** expected result = "E502 `bang target \`exec\` is not defined` —
  an earlier, fail-closed failure; E405 not reachable from scripts in 1.0."
  Keep the advisory footnote.

### T-6 — EXTRACT-302: remove the advisory caveat — it fires as written

- Fixture `needs fs.read("/etc/**config")` → **E302 exact**:
  `"/etc/**config" uses "**" inside the segment "**config"`.
- Also confirmed the repo's own `tests/capability/negative/e302-invalid-glob`
  (`a**b`) still fires. Drop "best-effort/advisory" from the row and Appendix A
  footnote.

### T-7 — B-2: mechanism note is inaccurate for the missing-file case

- B-2 (line 343) says macOS "can never be satisfied ... regardless of whether the
  file exists". True outcome, imprecise mechanism: with the file absent the
  failure is E501 ENOENT before any network (see T-1); with the file present it
  would be E403 (canonical mismatch). Either way B-2 can't complete here; keep it
  non-blocking, but state both failure modes.

### T-8 — Part I / FMT sample: clarify the rendering constants

- The plan's §12 "exact format" snippet shows `error[E403]` (abbreviated) and a
  two-space `  --> ` gutter. The shipped formatter renders the full envelope code
  (`error[E403_GUARD_PATH_TRAVERSAL]`, which §9.3 line 876 defines as canonical)
  and a one-space gutter. Excerpt/caret/hint shape matches.
- Also: the caret spans the whole denied bang call (`fs.readFile!(...)`), not just
  the string argument as in §9.3's illustration — this is the documented Phase 9
  decision 5 behavior ("caret at the bang-call site") and satisfies REGR-7.
- **Rewrite:** mark the §12 snippet as illustrative of *shape*, not byte layout;
  cite `tests/cli/format-error.test.ts` as the pinned format.
- DEFER-4/5 expected wording: change "E602 unrecognized option on `run`" to
  "E602 (commander reports it as an unknown-command-style usage error)" — see FIX-2.

### T-9 — SEM-2/SEM-3 fixtures assume unavailable resources

- SEM-3 uses `api.example.com`, which is an IANA example domain with no service;
  run it against a local server (`127.0.0.1:8991`, as the plan already does for
  G-401-pos) and keep the property under test = piped value becomes `args[0]`.
- SEM-4 reuses PARSE-POS3 (`/etc/config/app.json`) whose grant can't match on
  macOS; run the same three-stage chain against a canonical `$SAFE_ROOT` file.
- SEM-2's "substitute another single-arg pure fn" note is fine; `json.parse`
  worked as written (`let x = "{\"a\":1}" | json.parse` → `x.a` = `1`).

---

## 3. Do-not-change list (spec-correct behavior that looks like a bug)

A future agent must not "fix" these:

1. **`E301` preempting the guard for uncovered literal targets** — static
   extraction is the first enforcement layer (Section 3); the guard handles
   deferred values. Both fail closed. See T-2.
2. **`E403` (not E402) for a raw, non-canonical grant under a symlinked prefix
   when the target exists** — string-matched but canonical mismatch is the
   documented E403 class (PROGRESS Phase 4 decision 2).
3. **`E501` (not E402) for a missing file under a matched grant** — ENOENT
   lexical fallback (Phase 4 decision 3); the host op fails, not the guard.
4. **`E502` for `exec!`** — no exec bang exists in 1.0; E405 is unit-tested but
   script-unreachable (T-5).
5. **`E503` without a location until FIX-1 lands** — `location` is optional in
   the envelope; do not invent a throwaway location.
6. **`check-deps` auditing direct deps only** — documented decision; a full
   lockfile allow-list audit is impossible with eslint in the tree.
7. **`npm publish --dry-run` exiting 0 on a private package** — npm's dry-run
   simulates the upload and writes nothing; `private: true` is pinned by SETUP-6
   and a real publish cannot succeed (auth/private gate). No repo change needed.

---

## 4. Re-run recipe

```bash
# baseline + gate (from repo root)
nix develop --command bash -c "npm ci && npm run ci"        # must be ≥174/174

# targeted spot checks after FIX-1
node dist/cli/bin.js run /tmp/arity.placitum                # E503 + --> location
node dist/cli/bin.js run /tmp/arity2.placitum               # json.parse arity
node dist/cli/bin.js run /tmp/arity3.placitum               # curl! arity

# full black-box suite artifacts (if still present)
ls /tmp/placitum-tests/out/        # per-ID .out/.err/.exit
ls /tmp/placitum-tests/scripts/    # 83 fixtures incl. *-alt variants
```
