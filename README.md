# pl-lg

Placitum is a small, bash-like programming language with capability-aware I/O.

## Token cheat sheet

### Literals and names

| Token | Syntax | Description |
| --- | --- | --- |
| `IDENTIFIER` | `name`, `_value`, `item2` | Variable, function, or member name. |
| `STRING` | `"hello"` | Double-quoted string. |
| `NUMBER` | `42`, `3.14` | Integer or decimal number. |
| `FSTRING_START` / `FSTRING_END` | `f"..."` | Start and end of an interpolated string. |
| `STRING_CHUNK` | `f"hello {name}"` | Literal text inside an interpolated string. |
| `PRAGMA` | `#!strict` | File pragma; recognized only on the first line. |
| `NEWLINE` | line break | Statement terminator. Blank and comment-only lines are collapsed. |
| `EOF` | — | End of input. |

### Keywords

| Token | Syntax | Description |
| --- | --- | --- |
| `NEEDS` | `needs` | Declare required capabilities. |
| `LET` | `let` | Bind a value to a name. |
| `FN` | `fn` | Define a function. |
| `IF` / `ELSE` | `if`, `else` | Conditional execution. |
| `WHILE` | `while` | Loop while a condition is true. |
| `FOR` / `IN` | `for`, `in` | Iterate over a value. |
| `RETURN` | `return` | Return from a function. |
| `NOT` | `not` | Logical negation. |
| `ONLY` | `only` | Restrict a function's capabilities. |
| `TRUE` / `FALSE` | `true`, `false` | Boolean literals. |
| `NULL` | `null` | Null value. |

### Punctuation and operators

| Token | Syntax | Description |
| --- | --- | --- |
| `LPAREN` / `RPAREN` | `(` `)` | Grouping and call arguments. |
| `LBRACE` / `RBRACE` | `{` `}` | Blocks and object literals. |
| `LBRACKET` / `RBRACKET` | `[` `]` | Indexing and arrays. |
| `COMMA` | `,` | Separates arguments or items. |
| `DOT` | `.` | Member access. |
| `COLON` | `:` | Object key/value separator. |
| `QUESTION` | `?` | Conditional-expression operator. |
| `PIPE` | `\|` | Pass a value to the next expression. |
| `OR` | `\|\|` | Logical OR. |
| `AND` | `&&` | Logical AND. |
| `EQ` / `NEQ` | `==`, `!=` | Equality and inequality. |
| `LT` / `GT` | `<`, `>` | Less-than and greater-than comparisons. |
| `LTE` / `GTE` | `<=`, `>=` | Inclusive comparisons. |
| `ASSIGN` | `=` | Assignment. |
| `PLUS` / `MINUS` | `+`, `-` | Addition and subtraction. |
| `STAR` / `SLASH` | `*`, `/` | Multiplication and division. |
| `BANG` | `name!(...)` | Capability-aware bang call; `!` must immediately follow its target. |

### Notes

- `#` starts a line comment. `#!name` is a pragma only on line 1.
- Valid string escapes are `\\n`, `\\t`, `\\r`, `\\\\`, and `\\"`; f-strings also allow `\\{` and `\\}`.
- `fs`, `net`, `exec`, `env`, `read`, and `write` are identifiers, not keywords. They are used in capability declarations and member paths.
- Newlines terminate statements, so keep related expressions on the same line when needed.

## Rosetta example

The following example shows capabilities, functions, pipelines, conditionals, loops, member access, bang calls, and string interpolation in one program:

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

| Intent | Placitum | Bash-like equivalent |
| --- | --- | --- |
| Declare a value | `let config = value` | `config=value` |
| Define a function | `fn fetch_status(url) { ... }` | `fetch_status() { ...; }` |
| Pipe a value | `value | transform` | `echo "$value" | transform` |
| Call a capability-aware operation | `fs.readFile!(path)` | `cat "$path"` |
| Conditional | `if condition { ... } else { ... }` | `if command; then ...; else ...; fi` |
| Iterate | `for item in items { ... }` | `for item in ...; do ...; done` |
| Interpolate text | `f"status={result.status}"` | `printf 'status=%s\\n' "$status"` |

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

### Local install

`./local-deploy.sh` builds the repo and installs a `placitum` launcher into
`~/.local/bin`. If one is already there it compares versions and asks before
updating, downgrading, or reinstalling.

## Development

```bash
npm install
npm run ci
```
