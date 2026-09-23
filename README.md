# pl-lg

Placitum is a small, bash-like programming language with capability-aware I/O.
Every script declares what it may touch in a `needs` clause; literal uses are
proven against that declaration before execution, and everything else is
checked by a runtime guard. There is no ambient filesystem, network, or
environment access.

## Quick start

```bash
npm install
npm run ci
./local-deploy.sh        # optional: build + install `placitum` into ~/.local/bin
```

```placitum
# hello.placitum
print!("hello, world")
```

```bash
placitum run hello.placitum
placitum explain hello.placitum   # show the capability manifest, execute nothing
```

## Language reference

### Program structure

A program is a sequence of newline-terminated statements — one statement per
line. A closing `}` or end of input also terminates the last statement of a
block. `;` is not part of the language (E104), and two statements cannot share a
line.

```placitum
#!strict                       # optional pragma; physical line 1 only
# a comment, to end of line
needs fs.read("**/config.json")

let x = 1
print!(x)
```

- The only pragma with an effect is `#!strict` (see [Strict mode](#strict-mode)).
  `#!name` is recognized only on physical line 1; a `#!` elsewhere is E105.
- `#` starts a comment. Blank and comment-only lines are ignored.
- `needs` is allowed only before the first non-`needs` statement at the top of
  the program, or directly after a function's parameter list (E202 otherwise).
  Multiple `needs` lines are allowed.
- Statements: `let`, assignment, `fn`, `if`/`else`, `while`, `for`, `return`,
  and expression statements. There is no `break`, `continue`, `import`, or
  module system.

### Values and types

| Type | Literals / producers | Truthiness | Display (`print!`, f-strings) |
| --- | --- | --- | --- |
| `string` | `"text"`, `f"..."` | `""` is falsy | raw text |
| `number` | `42`, `3.14` | `0` is falsy | decimal, e.g. `2.5` |
| `boolean` | `true`, `false` | `false` is falsy | `true` / `false` |
| `null` | `null` | falsy | `null` |
| `array` | `[1, "two"]`, `json.parse` | always truthy | JSON: `[1,"two"]` |
| `object` | `{ key: value }`, `json.parse`, `curl!` | always truthy | JSON |
| function | `fn`, the `json` builtin | always truthy | `[closure name]` / `[native name]` |

- Numbers are IEEE doubles (`10 / 4` is `2.5`); there is no integer type and no
  exponent, hex, underscore, or leading-dot forms (`3.` and `1e3` are E106).
- Equality (`==` / `!=`) is deep for arrays and objects. Functions compare by
  identity: a function equals only itself. `0 == -0` is true.
- Object keys are bare identifiers (`{ name: "x" }`); there are no computed or
  quoted keys.

### Variables

```placitum
let name = "value"   # declare; an initializer is required
name = "other"       # reassign an existing binding (E500 if it never existed)
```

- `let` may not redeclare a name in the same scope (E506); inner scopes may
  shadow outer names.
- Every block (`if`/`while`/`for` bodies, function bodies) is a scope; a `let`
  inside a block is invisible outside it.
- Function parameters are locals of their function's scope.
- The `json` builtin is a top-level binding; it cannot be redeclared at the top
  level (shadow it in an inner scope if you must).

### Strings and f-strings

Strings are double-quoted and single-line. Escapes: `\n`, `\t`, `\r`, `\\`,
`\"`; f-string text additionally allows `\{` and `\}`.

```placitum
let who = "world"
print!(f"hello {who}, {1 + 1}!")   # hello world, 2!
```

Interpolations may hold any expression; the value renders by the Display column
above. `f"..."` produces a `string`. Everything outside `{...}` is literal text.

### Operators

| Precedence (high → low) | Operators | Notes |
| --- | --- | --- |
| postfix | `.member`, `call(...)`, `target!(...)` | members exist on objects only; a missing member reads `null`; bang calls always need `(...)` |
| unary | `not`, `-` | `not` yields a boolean; unary `-` requires a number |
| multiplicative | `*`, `/` | numbers only; `/ 0` is E504 |
| additive | `+`, `-` | `+` is number+number or string+string (no mixing); `-` numbers only |
| relational | `<`, `<=`, `>`, `>=` | numbers only, no string ordering |
| equality | `==`, `!=` | deep equality, any types |
| logical AND | `&&` | short-circuits; yields a boolean from the truthiness table |
| logical OR | `\|\|` | short-circuits; yields a boolean |
| pipe | `\|` | see [Pipes and builtins](#pipes-and-builtins) |
| assignment | `=` | bare identifier target; lowest precedence, right-associative |

- There is no indexing: `xs[0]` is a parse error. Arrays are traversed with
  `for..in` only.
- `?` is **not** a conditional operator; the token appears only in
  `env(NAME?)`. There is no ternary.
- There are no compound assignment (`+=`) or increment (`++`) operators.

### Control flow

```placitum
if score >= 5 {
    print!("healthy")
} else if score > 0 {
    print!("degraded")
} else {
    print!("down")
}

while retries > 0 {
    retries = retries - 1
}

for endpoint in config.endpoints {   # arrays only; anything else is E501
    print!(endpoint)
}
```

- Conditions use the truthiness table; `if`/`while` impose no type on the test.
- `else` must follow the `}` on the same line; a newline before `else` is a
  parse error.
- The `for` iterator is bound per element and only inside the loop body.
- `return` inside a function returns its value (`null` without an argument). A
  top-level `return` ends the script.
- Objects are not iterable (only arrays are), and there is no way to enumerate
  object keys.

### Functions

```placitum
fn add(a, b) {
    return a + b
}

fn make_counter(start) {
    let n = start
    fn bump() {                 # closures capture and can mutate outer lets
        n = n + 1
        return n
    }
    return bump
}
```

- `fn name(params) { ... }`. No defaults, no variadics, no overloading; arity
  must match exactly (E503). Duplicate parameter names are E206.
- There is no hoisting: a function must be declared before it is called (E500
  otherwise). Recursion works.
- Functions are first-class values: assign them, pass them, return them, store
  them in objects or arrays, call members (`box.call(2, 3)`), and pipe into them
  (`"hey" | shout`).
- Printing a function directly shows `[closure name]` or `[native name]`;
  printing a container that holds one dumps internals — avoid it.
- Calling a non-callable value is E502 (including calling an undefined name).

#### Capability attenuation

A function may declare its own `needs` clause directly after its parameter
list. Its body then runs under a guard restricted to exactly those tokens:

```placitum
needs fs.read("**/config.json"), fs.write("**/log.txt")

fn read_config(path) needs only(fs.read("**/config.json")) {
    return fs.readFile!(path) | json.parse   # only this read grant exists here
}
```

- The clause must attenuate — every token must already be covered by the
  enclosing scope's grants, or E303 (equality is allowed).
- `only(token)` is the explicit single-token form; nesting `only(only(...))` is
  E204. It is equivalent to writing that one token.
- A function without a `needs` clause inherits the enclosing guard unchanged.
- This is how a helper can be handed to untrusted code without handing over the
  caller's whole manifest.

### Pipes and builtins

`|` builds a flat, left-associative chain. Each stage receives the piped value:

| Stage form | Call it performs |
| --- | --- |
| `name` or `obj.name` (bare callee) | `callee(value)` |
| `f(extra, args)` | `f(value, extra, args)` |
| `target!(extra, args)` | `target!(value, extra, args)` |

```placitum
let config = fs.readFile!("app.json") | json.parse
print!(f"name={config.name}")
print!("mid" | wrap("[", "]"))       # wrap("mid", "[", "]")
```

Bare `target!` (no parentheses) is a parse error: `"url" | curl!()` is the
zero-extra-argument form.

Builtins:

| Call | Signature | Grant required |
| --- | --- | --- |
| `json.parse(text)` | `(string) -> any` | none — pure; invalid JSON is E501 |
| `fs.readFile!(path)` | `(string) -> string` | `fs.read(...)` |
| `fs.writeFile!(path, contents)` | `(string, string) -> null` | `fs.write(...)` |
| `curl!(url)` / `curl!(url, opts)` | `(string, { method?, body? }) -> { status, body }` | `net(...)` |
| `print!(value)` | `(any) -> null` | none — stdout is always writable |
| `eprint!(value)` | `(any) -> null` | none — stderr is always writable |

- `curl!` defaults to `GET` with no body; `status` is a number and `body` a
  string. Host failures (DNS, refused connection) are E501 host errors, not
  capability denials.
- `print!` and `eprint!` append a newline.
- Effectful builtins are reachable only as bang calls with `!` attached
  directly to the target: `fs.readFile!(...)` works, `fs.readFile(...)` is E500
  (`fs` is not a binding), and a space before `!` is E104.
- `json.parse` is the only pure builtin. There is no `len`, no string methods
  (`.length` on a string is E501), and no standard library beyond this table.
- `exec(...)` is a declarable capability enforced at runtime (E405), but no
  builtin currently consumes it — it is reserved.
- `env(NAME)` requirements are enforced once at startup (E406); `env(NAME?)` is
  optional. No builtin reads environment values into a script in v1.

### Capabilities

```placitum
needs fs.read("data/**/*.json"), fs.write("out/*.txt"), net("api.example.com"), net("*.internal.example.com"), env(API_KEY), env(DEBUG?)
```

| Token | Pattern rules |
| --- | --- |
| `fs.read("glob")` / `fs.write("glob")` | `*` matches within one path segment (never `/`); `**` as a whole segment matches any run of segments; everything else is literal. A bare `*`/`**` is E305; `**` inside a segment or an empty pattern is E302. |
| `net("host")` | Exact host (case-insensitive), or `*.example.com` matching exactly one leading label. A bare `*`/`**` is E305. |
| `exec("glob")` | Path-glob rules like `fs`; reserved — nothing consumes it yet. |
| `env(NAME)` / `env(NAME?)` | Required / optional environment variable. |
| `only(token)` | Valid only in a function's `needs` clause: exactly that one grant. |

Enforcement happens in two places:

1. **Compile-time proof.** Every bang call whose first argument is a string
   literal is checked against the in-scope grants before execution; a miss is
   E301. Piped values and non-literal arguments cannot be known statically and
   are deferred to runtime. (One gap: a literal call nested inside another bang
   call's argument list, e.g. `print!(fs.readFile!("/etc/hosts"))`, is checked
   at runtime only.)
2. **Runtime enforcement.** The guard canonicalizes paths (`..`, symlinks) and
   matches the canonical path against the grants. A value that string-matched
   but canonicalizes outside its grant is E403; no match is E402 (read), E404
   (write), E405 (exec), or E401 (network).

`placitum explain <file>` prints exactly what was proven statically, what each
function attenuates to, and what was deferred.

- Filesystem grants match the canonical **absolute** path, so a pattern must be
  absolute (`"/etc/config/*.json"`) or use `**` to span directories
  (`"**/rosetta-out.json"`).
- Grants belong to one script invocation; nothing is inherited from the
  invoking shell.

### Strict mode

`#!strict` on line 1 adds one pre-execution pass: each pipe stage whose first
parameter type is statically known (the builtins above) is checked against the
type the previous stage produces. `5 | json.parse` fails with E505 before
anything runs; a variable stage is `unknown` and passes. It is a lint, not a
sandbox — the runtime guard still runs.

### Errors

Every failure prints one envelope to stderr and exits 1:

```
error[E402_GUARD_FS_READ_DENIED]: "/private/etc/hosts" (fsRead, canonicalized from "/etc/hosts") matches no granted capability
 --> script.placitum:3:8
  |
3 | print!(fs.readFile!("/etc/hosts"))
  |        ^^^^^^^^^^^^^^^^^^^^^^^^^^
  |
  = hint: Request the exact path/glob in a needs declaration.
```

| Phase | Codes |
| --- | --- |
| lex | E101 unterminated string, E102 unterminated f-string interpolation, E103 invalid escape, E104 unexpected character, E105 invalid pragma, E106 invalid number |
| parse | E201 unexpected token, E202 `needs` not at top, E203 unterminated block, E204 invalid capability token, E205 invalid bang target, E206 duplicate parameter |
| extract | E301 uncovered literal capability, E302 invalid glob, E303 attenuation escalation, E304 internal, E305 overprivileged wildcard |
| guard | E401 net denied, E402 fs read denied, E403 path traversal/escape, E404 fs write denied, E405 exec denied, E406 required env var missing |
| eval | E500 unbound variable, E501 type mismatch, E502 not callable, E503 arity mismatch, E504 division by zero, E505 strict pipe type error, E506 redeclaration |
| cli | E601 script file unreadable, E602 invalid flag/arguments, E603 explain render failure |

### CLI

```
placitum run <file>       execute a script
placitum explain <file>   print the capability manifest without executing
placitum --version        print the version
placitum --help           usage
```

- Bare `placitum` prints help and exits 0. Unknown flags/subcommands and
  missing or excess arguments are E602.
- A script that cannot be read (missing, directory, permissions) is E601.
- Script output goes through `print!`/`eprint!` only. The exit code is 1 on any
  error and 0 otherwise; a top-level `return` exits 0.

## Complete rosetta (runnable)

[`examples/rosetta.placitum`](examples/rosetta.placitum) is a runnable tour of
the whole language — strings, files, pipes, functions, loops, and capabilities.
It only writes one file (`rosetta-out.json`) and makes no network calls:

```bash
placitum run examples/rosetta.placitum
```

| Intent | Placitum | Bash-like equivalent |
| --- | --- | --- |
| Comment | `# note` | `# note` |
| Strict-mode pragma | `#!strict` | `set -euo pipefail` |
| Declare capabilities | `needs fs.read("**/x.json"), net("api.example.com"), env(TOKEN?)` | none — ambient access by default |
| Declare a value | `let retries = 3` | `retries=3` |
| String escapes | `"a\tb \"q\""` | `$'a\tb "q"'` |
| Interpolate text | `f"{name} -> {verdict}"` | `printf '%s -> %s\n' "$name" "$verdict"` |
| Object literal | `{ name: "gw", stride: 2.5 }` | associative array (bash 4) |
| Array literal | `["alpha", "beta"]` | `("alpha" "beta")` |
| Member access | `config.name` | `${config[name]}` |
| Define a function | `fn classify(score) { ... }` | `classify() { ...; }` |
| Attenuate a function | `fn f(p) needs only(fs.read("**/x.json")) { ... }` | none |
| Return | `return "healthy"` | `echo healthy` / `return` |
| Conditional | `if verdict == "healthy" { ... } else { ... }` | `if [ "$verdict" = healthy ]; then ...; else ...; fi` |
| While loop | `while retries > 0 { ... }` | `while [ "$retries" -gt 0 ]; do ...; done` |
| Iterate | `for e in config.endpoints { ... }` | `for e in "${endpoints[@]}"; do ...; done` |
| Logical operators | `a && not b \|\| c` | `a && ! b \|\| c` |
| Comparisons | `score >= config.threshold` | `[ "$score" -ge "$threshold" ]` |
| Arithmetic | `total * config.stride` | `$((total * stride))` (integers only) |
| Pipe to a pure function | `text \| json.parse` | `jq .` |
| Pipe to an effectful call | `"url" \| curl!({ method: "GET" })` | `echo "$url" \| curl ...` |
| Read a file | `fs.readFile!(path)` | `cat "$path"` |
| Write a file | `fs.writeFile!(path, text)` | `printf '%s' "$text" > "$path"` |
| HTTP request | `curl!(url, { method: "GET" })` | `curl -X GET "$url"` |
| Print | `print!(x)` / `eprint!(x)` | `echo "$x"` / `echo "$x" >&2` |
| End the script | top-level `return` | `exit` |

Filesystem grants are matched against the canonical (absolute) path at runtime,
so use a `"**/name"` pattern when the script should stay location-independent.

## Canonical capability example

The spec's canonical example (not runnable as-is — it reads
`/etc/config/app.json` and calls a network host). It shows declaration, an
attenuated function, a compile-time-deferred URL, a pipe, and a loop:

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

## Local install

`./local-deploy.sh` builds the repo and installs a `placitum` launcher into
`~/.local/bin`. If one is already there it compares versions and asks before
updating, downgrading, or reinstalling.

## Development

```bash
npm install
npm run ci
```
